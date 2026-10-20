import req from '../../util/req.js';

// JavGG (py_javgg)
// 站点: https://javgg.net/ (WordPress + DooPlay 主题，无反爬；备用域名 javgg.co)
// 注意: javgg.co 的 /tag/* 归档页全部 500（站方镜像配置坏了），字幕分类改走搜索替代
// 列表: /new-post/[/page/N/]、/trending/[/page/N/]、/genre/{slug}/[/page/N/]
//       搜索型分类: /?s={kw}[&paged=N]（英字幕/中字幕，用搜索代替坏掉的 tag 页）
// 详情: /jav/{番号slug}/  解析 data-post 得到 post_id
// 播放: dooplayer API server1~3 并行收集，并行解码后按优先级取第一个成功：
//   playmate系(playmate.to /embed/): POST {host}/api/s → sx(master.txt)，m3u8/分片无任何 header 要求，
//              1080p，全链路无头可访问（实测分片无头 200）→ 优先级最高
//   vidara系(shadowbyte.site /e/ 等): POST {host}/api/stream {filecode,...} → streaming_url(m3u8)，
//              播放列表/分片无特殊 header 要求（实测 200/200）→ 次优先级（英字幕分类部分视频靠它）
//   vidhide系(earnvidjavgg.xyz / streamhgjav.xyz): 解 Dean Edwards packer → links.hls2(m3u8)，
//              无特殊 header 要求 → 再次优先级（CDN 按请求方网络签发 token；热门分类只有这系线路）
//   f4s系(f4jav.xyz /e/): embed 页 data-video-id → GET {host}/api/play/{vid}?ab=0 → src(m3u8)，
//              m3u8 与分片都强制要求 Origin 头（实测无 Origin 全部 403），播放器内核不转发 → 最低优先级
//   全部解不出 → 返回最高优先级 embed 页走 parse:1 嗅探
// 提速(2026-10-20): 旧版串行收集 3 个 server + 串行解码，每步 25s 超时且 fetch 通道无超时，
//   任一请求挂起整条链拖到分钟级，App 侧等不到结果直接报播放失败；最新分类也因此加载慢。

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

// tasks 已按优先级排序: 高优先级先成功就立刻返回，不等低优先级跑完
function firstByPriority(tasks) {
  return new Promise((resolve) => {
    if (!tasks.length) { resolve(null); return; }
    const results = new Array(tasks.length).fill(undefined);
    const check = () => {
      for (let i = 0; i < tasks.length; i++) {
        if (results[i] === undefined) return; // 更高优先级还没出结果，继续等
        if (results[i]) { resolve(results[i]); return; }
      }
      resolve(null);
    };
    tasks.forEach((task, i) => {
      Promise.resolve()
        .then(task)
        .then(r => { results[i] = r || null; check(); }, () => { results[i] = null; check(); });
    });
  });
}

// 双通道: 先框架 req，失败再原生 fetch
async function getTextInner(url, headers, minLen) {
  const h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const need = minLen || 500;
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: 12000, responseType: 'text' });
    if (status === 200 && data) {
      const txt = typeof data === 'string' ? data : String(data);
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await withTimeout(fetch(url, { headers: h }), 12000);
    if (r.ok) {
      const txt = await r.text();
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 域名 failover: 主站抓不到时切备用域名再试（注意：javgg.co 的 /tag/* 坏了，分类已避开 tag）
async function getText(url, headers, minLen) {
  let txt = await getTextInner(url, headers, minLen);
  if (txt) return txt;
  if (url.includes('javgg.net')) {
    txt = await getTextInner(switchDomain(url, 'javgg.net', 'javgg.co'), headers, minLen);
    if (txt) return txt;
  }
  return '';
}

// POST JSON 双通道
async function postJson(url, body, headers) {
  const h = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const payload = JSON.stringify(body);
  try {
    const { data, status } = await req.post(url, payload, { headers: h, timeout: 12000 });
    if (status === 200 && data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await withTimeout(fetch(url, { method: 'POST', headers: h, body: payload }), 12000);
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

// f4s 系: embed 页 data-video-id → {host}/api/play/{vid}?ab=0 → src(m3u8)
async function tryF4s(embedUrl, durl) {
  try {
    const embedHost = new URL(embedUrl).origin;
    const embedHtml = await getText(embedUrl, { 'Referer': durl });
    if (!embedHtml) return null;
    const vidM = embedHtml.match(/data-video-id="([a-f0-9-]+)"/);
    if (!vidM) return null;
    const vid = vidM[1];
    const apiM = embedHtml.match(/data-api="([^"]+)"/);
    const playApi = apiM ? (apiM[1].startsWith('/') ? embedHost + apiM[1] : apiM[1]) : `${embedHost}/api/play/${vid}`;
    const srcUrl = `${playApi}?ab=0&r=${encodeURIComponent(durl)}`;
    const srcText = await getText(srcUrl, { 'Accept': 'application/json', 'Referer': embedUrl }, 10);
    if (!srcText) return null;
    const srcJson = JSON.parse(srcText);
    const src = t(srcJson.src || srcJson.url);
    if (!src || !/^https?:\/\//.test(src)) return null;
    return {
      parse: 0,
      url: src,
      header: { 'User-Agent': UA, 'Referer': embedUrl, 'Origin': embedHost },
    };
  } catch (e) {
    return null;
  }
}

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

// vidhide 系 (earnvidjavgg.xyz /embed/): 解 packer → var links.hls2(m3u8)
async function tryVidhide(embedUrl, durl) {
  try {
    const html = await getText(embedUrl, { 'Referer': durl });
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

// vidara 系 (shadowbyte.site / dstyladsg.com / vidara*): embed 页 jwplayer 脚本
// POST {origin}/api/stream {filecode, device:'ios', codecs:['h265']}（须带 Origin 头）
// → JSON streaming_url(m3u8)，播放列表/分片无特殊头要求（2026-10-20 实测 200/200, 1080p）
async function tryVidara(embedUrl, durl) {
  try {
    const u = new URL(embedUrl);
    const code = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!code) return null;
    const resp = await postJson(u.origin + '/api/stream',
      { filecode: code, device: 'ios', codecs: ['h265'] },
      { 'Referer': embedUrl, 'Origin': u.origin });
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
async function tryPlaymate(embedUrl, durl) {
  try {
    const u = new URL(embedUrl);
    const code = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!code) return null;
    const resp = await postJson(u.origin + '/api/s', { c: code, d: 'web' }, { 'Referer': embedUrl });
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

// 播放: 并行收集 dooplayer server 1~3 的 embed，并行解码，按优先级取第一个成功
// 优先级（2026-10-20 实测）：
//   playmate(最高: m3u8/分片无任何 header 要求, 1080p, 分片无头实测 200, 解码 2.7-4.0s)
//   vidara(次之: shadowbyte 等, POST /api/stream 得 streaming_url, 播放列表/分片无头实测 200, 解码 ~1s;
//          英字幕等分类的部分视频只有这条非 vidhide 线)
//   vidhide(再次: 解包已实测正确, 无特殊头要求; CDN 按请求方网络签发 token,
//          热门/英字幕/中字幕的大量视频只有 vidhide 系两条线(earnvidjavgg+streamhg))
//   f4s(最低: m3u8 和分片都强制 Origin 头, 实测无 Origin 全 403, 播放器内核不转发 Origin → 手机端必挂)
// 任一解码成功即 parse:0 直链；全部失败返回最高优先级 embed 页走 parse:1 嗅探
// 旧版串行收集+串行解码, 每步 25s 超时叠加可达分钟级 → 最新能播但慢, 其他分类常被 App 播放超时误杀
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

  // 并行收集 3 个 server 的 embed（旧版串行：任一请求挂起都拖慢整条链）
  const fetchEmbed = async (srv) => {
    try {
      const apiText = await getText(`${SITE}/wp-json/dooplayer/v2/${postId}/movie/${srv}`, { 'Accept': 'application/json' }, 10);
      if (!apiText) return null;
      const embedUrl = t(JSON.parse(apiText).embed_url);
      if (!embedUrl || !/^https?:\/\//.test(embedUrl)) return null;
      const host = new URL(embedUrl).hostname;
      let prio = 99; // 其他(lulu等)最低
      let decoder = null;
      if (host.includes('playmate')) {
        prio = 1; decoder = tryPlaymate;
      } else if (host.includes('shadowbyte') || host.includes('dstyladsg') || host.includes('vidara')) {
        prio = 2; decoder = tryVidara;
      } else if (host.includes('earnvidjavgg') || host.includes('vidhide') || host.includes('streamhg')) {
        prio = 3; decoder = tryVidhide;
      } else if (host.includes('f4jav') || host.includes('f4scdn') || /\/e\/[A-Za-z0-9]+/.test(embedUrl)) {
        prio = 4; decoder = tryF4s;
      }
      return { embedUrl, prio, decoder };
    } catch (e) { return null; }
  };
  // 收集限时 12s: 慢的 server 不阻塞已拿到的线路
  const embeds = (await settleWithin([1, 2, 3].map(fetchEmbed), 12000)).filter(Boolean);
  embeds.sort((a, b) => a.prio - b.prio);

  // 并行解码，高优先级线路一成功立刻返回（不再逐个等超时，也不用等全部跑完）
  // 整轮解码设 25s 总上限: 个别线路挂起时宁可走嗅探兜底, 也不让 App 等到播放超时
  const decodable = embeds.filter(e => e.decoder);
  if (decodable.length) {
    const best = await withTimeout(
      firstByPriority(decodable.map(e => () => e.decoder(e.embedUrl, durl))), 25000
    ).catch(() => null);
    if (best) return best;
    // playmate 偶发响应慢/超时：并行一轮全失败时单独再给它一次机会（它是最稳的线）
    const pm = decodable.find(e => e.prio === 1);
    if (pm) {
      const retry = await withTimeout(tryPlaymate(pm.embedUrl, durl), 12000).catch(() => null);
      if (retry) return retry;
    }
  }
  // 没有直链：把最高优先级的 embed 页交给播放器嗅探
  if (embeds.length) {
    return { parse: 1, url: embeds[0].embedUrl, header: { 'User-Agent': UA, 'Referer': durl } };
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
