import req from '../../util/req.js';

// JavGG (py_javgg)
// 站点: https://javgg.net/ (WordPress + DooPlay 主题，无反爬；备用域名 javgg.co)
// 注意: javgg.co 的 /tag/* 归档页全部 500（站方镜像配置坏了），字幕分类改走搜索替代
// 列表: /new-post/[/page/N/]、/trending/[/page/N/]、/genre/{slug}/[/page/N/]
//       搜索型分类: /?s={kw}[&paged=N]（英字幕/中字幕，用搜索代替坏掉的 tag 页）
// 详情: /jav/{番号slug}/  解析 data-post 得到 post_id
// 播放: dooplayer API server1~3 并行收集 embed，按宿主分线解码：
//   playmate系(playmate.to /embed/): POST {host}/api/s → sx(master.txt)，m3u8/分片无任何 header 要求，
//              1080p，全链路无头可访问 → 最可靠的直链
//   vidara系(shadowbyte.site /e/ 等): POST {host}/api/stream {filecode,...} → streaming_url(m3u8)，
//              播放列表/分片无特殊 header 要求 → 次可靠的直链（英字幕分类部分视频靠它）
//   vidhide系(earnvidjavgg.xyz / streamhgjav.xyz): 解 Dean Edwards packer → links.hls2(m3u8)。
//              解码只有一步 embed 页 GET，但该宿主响应方差极大（实测 1.3s~16s），且其 CDN
//              (acek-cdn/dramiyos-cdn/premilkyway) 按请求方网络(ASN)签发 token，
//              m3u8/分片只能由与解码同一网络的播放端拉取（spider 与播放器同在手机端，天然一致）
//   f4s系(f4jav.xyz /e/): m3u8 与分片都强制 Origin 头，播放器内核不转发 → spider 直返必挂，
//              只作嗅探兜底（浏览器发请求自带 Origin）
// 播放策略(2026-10-20 第二轮): 上一轮把解码全放在 play() 里现解，实测 play 耗时 3.4~16.1s，
//   超过 App 播放等待 → 只有线路最快的最新/无码/高清无码能播，vidhide 为主的分类全灭。改为：
//   1) detail() 阶段就后台预解码并缓存（模块级 Map，TTL 10 分钟），play() 命中缓存毫秒级直返；
//   2) 未命中时 play() 最多等约 8s（预解码在底层继续，完成后写入缓存，下次点击即直达），
//      超时/失败立刻落 parse:1 嗅探 vidhide/f4 的 embed 页，让播放器在网页环境里自己走
//      播放器逻辑（令牌与会话天然一致），不再硬等到 App 超时；
//   3) 解码竞速改为“高优先级优先 + 低优先级先成功只等 2.5s 宽限”，消除上一轮
//      firstByPriority 被排位靠前的慢线路堵住已成功线路的问题。

const KEY = 'py_javgg';
const NAME = 'JavGG';
const SITE = 'https://javgg.net';
const BACKUP_SITE = 'https://javgg.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 10 个真实分类 (2026-10-20 实测，javgg.net/.co 均 200 且有内容)
// kind: 'path' 普通列表页翻页 /page/N/；'search' 搜索页翻页 &paged=N
const CATS = [
  { type_id: 'latest', type_name: '最新', kind: 'path', url: '/new-post/' },
  { type_id: 'trending', type_name: '热门', kind: 'path', url: '/trending/' },
  { type_id: 'english-subtitle', type_name: '英字幕', kind: 'search', kw: 'english subtitle' },
  { type_id: 'chinese-subtitle', type_name: '中字幕', kind: 'search', kw: 'chinese subtitle' },
  { type_id: 'uncensored', type_name: '无码', kind: 'path', url: '/genre/uncensored/' },
  { type_id: 'hd-uncensored', type_name: '高清无码', kind: 'path', url: '/genre/hd-uncensored/' },
  { type_id: 'minimal-mosaic', type_name: '减码', kind: 'path', url: '/genre/minimal-mosaic/' },
  { type_id: 'digital-mosaic', type_name: '有码', kind: 'path', url: '/genre/digital-mosaic/' },
  { type_id: 'genre-4k', type_name: '4K', kind: 'path', url: '/genre/4k/' },
  { type_id: 'genre-3p', type_name: '3P', kind: 'path', url: '/genre/3p/' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function fixUrl(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return u;
}

function switchDomain(url, from, to) {
  return url.replace(from, to);
}

// 硬超时上限: 防止单个请求挂起拖死整条播放链（旧版 fetch 通道无超时是主要慢因）
function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// 等一组 promise 全部 settle 或超时(ms)即返回已拿到的结果（慢请求不阻塞整条链）
function settleWithin(promises, ms) {
  return new Promise((resolve) => {
    const out = new Array(promises.length).fill(null);
    if (!promises.length) { resolve(out); return; }
    let done = 0;
    const timer = setTimeout(() => resolve(out), ms);
    promises.forEach((p, i) => {
      Promise.resolve(p)
        .then(v => { out[i] = v; }, () => {})
        .finally(() => {
          done++;
          if (done === promises.length) { clearTimeout(timer); resolve(out); }
        });
    });
  });
}

// 并行解码竞速: 最高优先级任务一成功立刻返回；低优先级先成功时，只等 graceMs 盼
// 更高优先级完成，超时就用已成功的低优先级结果；budgetMs 到点返回已有最好结果。
// （上一轮 firstByPriority 必须等排位靠前的任务先出结果，同为 vidhide 的两条线里
//   慢的那条会把已成功的快线堵到超时，是热门分类 play 冲到 16s 的原因之一）
function bestWithin(tasks, budgetMs, graceMs) {
  return new Promise((resolve) => {
    if (!tasks.length) { resolve(null); return; }
    const topPrio = tasks[0].prio;
    let best = null;
    let settled = 0;
    let finished = false;
    let graceTimer = null;
    const finish = (v) => {
      if (finished) return;
      finished = true;
      clearTimeout(budgetTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(v);
    };
    const budgetTimer = setTimeout(() => finish(best ? best.res : null), budgetMs);
    tasks.forEach((task) => {
      Promise.resolve()
        .then(task.run)
        .then((res) => {
          settled++;
          if (res) {
            if (!best || task.prio < best.prio) best = { prio: task.prio, res };
            if (task.prio <= topPrio) { finish(res); return; }
            if (!graceTimer) graceTimer = setTimeout(() => finish(best ? best.res : null), graceMs);
          }
          if (settled === tasks.length) finish(best ? best.res : null);
        }, () => {
          settled++;
          if (settled === tasks.length) finish(best ? best.res : null);
        });
    });
  });
}

// 双通道: 先框架 req，失败再原生 fetch。timeoutMs 可调（预解码给足、play 现解收紧）
async function getTextInner(url, headers, minLen, timeoutMs) {
  const to = timeoutMs || 12000;
  const h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const need = minLen || 500;
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: to, responseType: 'text' });
    if (status === 200 && data) {
      const txt = typeof data === 'string' ? data : String(data);
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await withTimeout(fetch(url, { headers: h }), to);
    if (r.ok) {
      const txt = await r.text();
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 域名 failover: 主站抓不到时切备用域名再试（注意：javgg.co 的 /tag/* 坏了，分类已避开 tag）
async function getText(url, headers, minLen, timeoutMs) {
  let txt = await getTextInner(url, headers, minLen, timeoutMs);
  if (txt) return txt;
  if (url.includes('javgg.net')) {
    txt = await getTextInner(switchDomain(url, 'javgg.net', 'javgg.co'), headers, minLen, timeoutMs);
    if (txt) return txt;
  }
  return '';
}

// POST JSON 双通道
async function postJson(url, body, headers, timeoutMs) {
  const to = timeoutMs || 12000;
  const h = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const payload = JSON.stringify(body);
  try {
    const { data, status } = await req.post(url, payload, { headers: h, timeout: to });
    if (status === 200 && data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await withTimeout(fetch(url, { method: 'POST', headers: h, body: payload }), to);
    if (r.ok) return await r.json();
  } catch (e) { /* ignore */ }
  return null;
}

// 解析列表卡片
// 结构1: 列表页 article.item.movies > .poster > img[data-src] + .titlecontent + a[href="/jav/xxx/"]
// 结构2: 搜索页 div.result-item > article > .image img[src] + .details .title a
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const push = (durl, pic, name) => {
    if (!durl || seen.has(durl)) return;
    seen.add(durl);
    out.push({ vod_id: durl, vod_name: name || durl, vod_pic: pic || '', vod_remarks: '' });
  };
  let m;
  const re1 = /<article[^>]*class="[^"]*item movies[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  while ((m = re1.exec(html)) !== null) {
    const card = m[1];
    const linkM = card.match(/<a[^>]*href="(https?:\/\/javgg\.(net|co)\/jav\/[^"]+\/)"/);
    if (!linkM) continue;
    const imgM = card.match(/<img[^>]*data-src="([^"]+)"/) || card.match(/<img[^>]*src="([^"]+)"/);
    const titleM = card.match(/<div class="titlecontent">([\s\S]*?)<\/div>/);
    const codeM = card.match(/<h3><a[^>]*>([^<]+)<\/a><\/h3>/);
    push(linkM[1], imgM ? fixUrl(imgM[1]) : '', titleM ? clean(titleM[1]) : (codeM ? clean(codeM[1]) : ''));
  }
  const re2 = /<div class="result-item">([\s\S]*?)<\/article>/g;
  while ((m = re2.exec(html)) !== null) {
    const card = m[1];
    const linkM = card.match(/<a[^>]*href="(https?:\/\/javgg\.(net|co)\/jav\/[^"]+\/)"/);
    if (!linkM) continue;
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const titleM = card.match(/<div class="title">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    push(linkM[1], imgM ? fixUrl(imgM[1]) : '', titleM ? clean(titleM[1]) : '');
  }
  return out;
}

function catUrl(tid, page) {
  const cat = CATS.find(c => c.type_id === tid) || CATS[0];
  if (cat.kind === 'search') {
    let base = SITE + '/?s=' + encodeURIComponent(cat.kw);
    if (page > 1) base += '&paged=' + page;
    return base;
  }
  let base = SITE + cat.url;
  if (page > 1) base += 'page/' + page + '/';
  return base;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  return { class: cls, list: [] };
}

function parsePagecount(html, page) {
  const nums = [...html.matchAll(/\/page\/(\d+)\//g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
  const max = nums.length ? Math.max(...nums) : 0;
  return Math.max(max, page, 1);
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await getText(catUrl(tid, page));
  if (!html) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const list = parseCards(html);
  return { page, pagecount: parsePagecount(html, page), limit: 20, total: list.length, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/jav/' + id.replace(/^\//, '') + '/');

  const html = await getText(durl);
  if (!html) return { list: [] };

  let name = '';
  const titleM = html.match(/<title>([^<]+)<\/title>/);
  if (titleM) name = clean(titleM[1]).replace(/\s*[-|]\s*JAVGG.*$/i, '').trim();
  if (!name) {
    const ogM = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (ogM) name = clean(ogM[1]);
  }

  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (picM) pic = fixUrl(picM[1]);

  let content = '';
  const descM = html.match(/<meta property="og:description" content="([^"]+)"/);
  if (descM) content = clean(descM[1]);

  // 把 postId 拼进 play id，play() 可直接调 dooplayer API，省掉再抓一次详情页
  const postM = html.match(/data-post=['"](\d+)['"]/);
  const postId = postM ? postM[1] : '';

  // 关键（第二轮）：detail 阶段就启动后台预解码并缓存结果。
  // 用户看详情页的几秒里把慢线路（尤其 vidhide）解完，点播放时 play() 命中缓存直接返回，
  // 不再让 App 在播放环节干等十几秒。fire-and-forget，不阻塞 detail 返回。
  if (postId) prefetch(postId, durl);

  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_content: content,
      vod_play_from: 'JavGG',
      vod_play_url: `正片$${postId ? postId + '$' + durl : durl}`,
    }],
  };
}

// ---- 播放解码 ----

// Dean Edwards packer 解包
function unpackDean(p, a, c, k) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const tok = (n) => {
    let s = '';
    if (n === 0) return '0';
    while (n > 0) { s = chars[n % a] + s; n = Math.floor(n / a); }
    return s;
  };
  for (let i = c - 1; i >= 0; i--) {
    if (k[i]) {
      const re = new RegExp('\\b' + tok(i).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      p = p.replace(re, k[i]);
    }
  }
  return p;
}

// vidhide 系 (earnvidjavgg.xyz / streamhgjav.xyz): 解 packer → var links.hls2(m3u8)
// 只有一步 embed 页 GET；慢全在该宿主的响应方差上（实测 1.3s~16s）
async function tryVidhide(embedUrl, durl, timeoutMs) {
  try {
    const html = await getText(embedUrl, { 'Referer': durl }, 500, timeoutMs);
    if (!html || !html.includes('eval(function(p,a,c,k,e,d)')) return null;
    const m = html.match(/eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s);
    if (!m) return null;
    const dec = unpackDean(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4].split('|'));
    const lm = dec.match(/["']hls2["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    const src = lm ? lm[1] : (dec.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/) || [])[0];
    if (!src) return null;
    return {
      parse: 0,
      url: src,
      header: { 'User-Agent': UA, 'Referer': embedUrl },
    };
  } catch (e) {
    return null;
  }
}

// vidara 系 (shadowbyte.site / dstyladsg.com / vidara*):
// POST {origin}/api/stream {filecode, device:'ios', codecs:['h265']}（须带 Origin 头）
// → JSON streaming_url(m3u8)，播放列表/分片无特殊头要求（2026-10-20 实测 200/200, 1080p）
async function tryVidara(embedUrl, durl, timeoutMs) {
  try {
    const u = new URL(embedUrl);
    const code = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!code) return null;
    const resp = await postJson(u.origin + '/api/stream',
      { filecode: code, device: 'ios', codecs: ['h265'] },
      { 'Referer': embedUrl, 'Origin': u.origin }, timeoutMs);
    const src = resp && t(resp.streaming_url || resp.src || resp.url);
    if (!src || !/^https?:\/\//.test(src)) return null;
    return {
      parse: 0,
      url: src,
      header: { 'User-Agent': UA, 'Referer': embedUrl },
    };
  } catch (e) {
    return null;
  }
}

// playmate 系 (playmate.to /embed/): POST /api/s {c:filecode,d:'web'} → sx(master.txt)
async function tryPlaymate(embedUrl, durl, timeoutMs) {
  try {
    const u = new URL(embedUrl);
    const code = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!code) return null;
    const resp = await postJson(u.origin + '/api/s', { c: code, d: 'web' }, { 'Referer': embedUrl }, timeoutMs);
    const src = resp && t(resp.sx || resp.src || resp.url);
    if (!src || !/^https?:\/\//.test(src)) return null;
    return {
      parse: 0,
      url: src,
      header: { 'User-Agent': UA, 'Referer': embedUrl },
    };
  } catch (e) {
    return null;
  }
}

// 线路收集 + 分类（play 与预解码共用）
function classifyEmbed(embedUrl) {
  let host = '';
  try { host = new URL(embedUrl).hostname; } catch (e) { return null; }
  if (host.includes('playmate')) return { embedUrl, prio: 1, kind: 'playmate', decoder: tryPlaymate };
  if (host.includes('shadowbyte') || host.includes('dstyladsg') || host.includes('vidara')) return { embedUrl, prio: 2, kind: 'vidara', decoder: tryVidara };
  if (host.includes('earnvidjavgg') || host.includes('vidhide') || host.includes('streamhg')) return { embedUrl, prio: 3, kind: 'vidhide', decoder: tryVidhide };
  if (host.includes('f4jav') || host.includes('f4scdn') || /\/e\/[A-Za-z0-9]+/.test(embedUrl)) return { embedUrl, prio: 4, kind: 'f4', decoder: null };
  return { embedUrl, prio: 99, kind: 'other', decoder: null };
}

async function collectEmbeds(postId) {
  const fetchEmbed = async (srv) => {
    try {
      const apiText = await getText(`${SITE}/wp-json/dooplayer/v2/${postId}/movie/${srv}`, { 'Accept': 'application/json' }, 10);
      if (!apiText) return null;
      const embedUrl = t(JSON.parse(apiText).embed_url);
      if (!embedUrl || !/^https?:\/\//.test(embedUrl)) return null;
      return classifyEmbed(embedUrl);
    } catch (e) { return null; }
  };
  // 并行收集，限时 5s：慢的 server 不阻塞已拿到的线路
  const embeds = (await settleWithin([1, 2, 3].map(fetchEmbed), 5000)).filter(Boolean);
  embeds.sort((a, b) => a.prio - b.prio);
  return embeds;
}

// ---- 解码缓存（detail 预解码的核心）----
// key = postId；缓存线路列表、最终直链结果和进行中的解码 promise。
// vidhide 的 m3u8 URL 里 token 时效以天计（e=129600s），缓存 10 分钟足够安全。
const DECODE_TTL = 10 * 60 * 1000;
const decodeCache = new Map(); // postId -> { at, embeds, result, promise }

function cacheGet(postId) {
  const e = decodeCache.get(postId);
  if (!e) return null;
  if (Date.now() - e.at > DECODE_TTL) { decodeCache.delete(postId); return null; }
  return e;
}

function cacheSet(postId, patch) {
  let e = decodeCache.get(postId);
  if (!e) { e = { at: Date.now(), embeds: null, result: null, promise: null }; decodeCache.set(postId, e); }
  Object.assign(e, patch);
  e.at = Date.now();
  if (decodeCache.size > 300) decodeCache.delete(decodeCache.keys().next().value);
  return e;
}

// 完整解码管线：收集线路 → 并行解码（playmate/vidara/vidhide；f4 直返必挂不参与）
// budgetMs 为整轮竞速预算（到点返回已有最好结果）；单请求超时沿用通道默认 12s，
// 因为竞速层会兜住总时间，预解码在后台跑更需要把慢线路等出结果而不是早早放弃。
async function resolveDirect(postId, durl, budgetMs) {
  const entry = cacheGet(postId);
  let embeds = entry && entry.embeds;
  if (!embeds) {
    embeds = await collectEmbeds(postId);
    cacheSet(postId, { embeds });
  }
  const cands = embeds.filter(e => e.decoder);
  if (!cands.length) return null;
  const res = await bestWithin(
    cands.map(e => ({ prio: e.prio, run: () => e.decoder(e.embedUrl, durl) })),
    budgetMs, 2500
  );
  if (res) cacheSet(postId, { result: res });
  return res;
}

// 启动/复用一次后台解码（detail 预解码与 play 现解共用同一个 promise，不重复发请求）
function prefetch(postId, durl) {
  if (!postId) return null;
  const entry = cacheGet(postId);
  if (entry && entry.result) return Promise.resolve(entry.result);
  if (entry && entry.promise) return entry.promise;
  const p = resolveDirect(postId, durl, 30000).catch(() => null);
  cacheSet(postId, { promise: p });
  p.then(() => {
    const e = cacheGet(postId);
    if (e && e.promise === p) cacheSet(postId, { promise: null });
  });
  return p;
}

// 播放: 缓存直达 → 限时等预解码（约 8s）→ parse:1 嗅探兜底，全程有界，绝不拖到 App 超时
async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.startsWith('正片$')) id = id.slice(3);
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  let postId = '';
  let durl = '';
  const pm = id.match(/^(\d+)\$(https?:\/\/.+)$/);
  if (pm) {
    postId = pm[1];
    durl = pm[2];
  } else if (/^https?:\/\//.test(id)) {
    durl = id;
    const html0 = await getText(durl);
    const m0 = html0 ? html0.match(/data-post=['"](\d+)['"]/) : null;
    postId = m0 ? m0[1] : '';
  } else {
    postId = id.replace(/\D/g, '');
  }
  if (!postId) return { parse: 0, url: '' };
  if (!durl) durl = REFERER;

  // 1) 缓存直达：detail 阶段已预解码完成，毫秒级返回（能播分类的速度也由此改善：
  //    线路列表已随预解码缓存，play 不再重抓 dooplayer，更不用重解一遍）
  const entry = cacheGet(postId);
  if (entry && entry.result) return entry.result;

  // 2) 等预解码/现解，总等待约 8s 封顶。底层解码（30s 预算）不会被取消：
  //    即使这次等超时，它完成后会写缓存，用户再点一次即直达。
  const p = prefetch(postId, durl);
  if (p) {
    const res = await withTimeout(p, 8000).catch(() => null);
    if (res) return res;
    const e2 = cacheGet(postId);
    if (e2 && e2.result) return e2.result;
  }

  // 3) 嗅探兜底：优先 vidhide 的 embed 页，其次 f4，再次任意一条线路。
  //    交给播放器在网页环境里走它自己的播放器逻辑：浏览器发请求自带 Origin/Referer，
  //    令牌与会话也和解码同源同网络，比 spider 硬解直返更可能一次成功；
  //    对 f4-only 的视频这是唯一可行路径（spider 直返 f4 已实测必挂）。
  const embeds = (cacheGet(postId) || {}).embeds || [];
  const sniff = embeds.find(e => e.kind === 'vidhide') || embeds.find(e => e.kind === 'f4') || embeds[0];
  if (sniff) {
    return { parse: 1, url: sniff.embedUrl, header: { 'User-Agent': UA, 'Referer': durl } };
  }
  // 线路列表还没收集到（收集本身也在预解码里进行中）：先把详情页交给嗅探，
  // 好过返回空让 App 直接报失败
  if (durl && durl !== REFERER) {
    return { parse: 1, url: durl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  return { parse: 0, url: '' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
  const html = await getText(url);
  if (!html) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const list = parseCards(html);
  return { page, pagecount: parsePagecount(html, page), limit: 20, total: list.length, list };
}

export default function createSpider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', init);
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
