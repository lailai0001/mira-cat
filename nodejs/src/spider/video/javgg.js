import req from '../../util/req.js';

// JavGG (py_javgg)
// 站点: https://javgg.net/ (WordPress + DooPlay 主题，无反爬；备用域名 javgg.co)
// 注意: javgg.co 的 /tag/* 归档页全部 500（站方镜像配置坏了），字幕分类改走搜索替代
// 列表: /new-post/[/page/N/]、/trending/[/page/N/]、/genre/{slug}/[/page/N/]
//       搜索型分类: /?s={kw}[&paged=N]（英字幕/中字幕，用搜索代替坏掉的 tag 页）
// 详情: /jav/{番号slug}/  解析 data-post 得到 post_id，透传进 play 的 id
// 播放: dooplayer API server1~3 并行收集 embed，按宿主分线：
//   playmate系(playmate.to /embed/): POST {host}/api/s → sx(master.txt)，m3u8/分片无任何 header 要求，
//              1080p，全链路无头可访问 → spider 直解
//   vidara系(shadowbyte.site /e/ 等): POST {host}/api/stream {filecode,...} → streaming_url(m3u8)，
//              播放列表/分片无特殊 header 要求 → spider 直解（英字幕分类部分视频靠它）
//   vidhide系(earnvidjavgg.xyz / streamhgjav.xyz): 不再 spider 侧解码。其 m3u8 带 asn= 参数，
//              token 按解码请求方的网络(ASN)签发，真机实测：哪怕 spider 在 detail 阶段预解码好
//              直链，播放器拉流时仍被 CDN 拒（全灭）。embed 页普通 GET 200、内联 packer 解开后
//              含完整 hls2 与 jwplayer setup → 改走 parse:1 嗅探 embed 页，让播放器在网页会话内
//              自己取流，令牌与会话同源，绕开 ASN 绑定。
//   f4系(f4jav.xyz /e/): m3u8 与分片都强制 Origin 头，播放器内核不转发 → spider 直返必挂，
//              同样只作 parse:1 嗅探（浏览器发请求自带 Origin）
// 播放策略(2026-10-20 第三轮): 只对 playmate/vidara 两类竞速直解（预算 13s、低优先级先成功
//   等 2.5s 宽限盼高优先级，最高优先级成功立即返回）；没有这两类线路或竞速失败，立刻
//   parse:1 嗅探，目标 vidhide 第一（同系保持 server 顺序）> f4 > other > 第一条 embed。
//   不解 vidhide、不等待。（第二轮的 detail 预解码缓存 + vidhide 直解已被真机证伪，整套删除。）
// 第四轮(2026-10-20): 第三轮嗅探真机仍全灭。矩阵实验定版根因: vidhide 流媒体层按
//   请求方网络身份放行（hls2 CDN 连接层切断、earnvid /stream/ 回 403），换任何请求头
//   都不变，token 按铸造时请求方的网络签发(asn= 明文可见，e=129600 非短时效问题)。
//   → vidhide 改走全链代理 Worker(javgg-vidhide-worker.js): 抓 embed、解包铸 token、
//   拉列表、透传分片全在 Worker 同一出口完成，播放器只连 Worker、零自定义头。
//   Worker 本体已在 VM 用真实样本全链验证（/v 200、719 分片全经 /s 200、Range 206）。
//   下方 VIDHIDE_WORKER 常量填入部署地址后生效；留空则 vidhide 维持第三轮嗅探行为。
// 第六轮(2026-10-20): 第五轮真机: 中字幕分类播不了、清晰度低、提速未显。
//   逐项实测结论: (1) 蜘蛛对中字幕样本的 play 输出与第四轮逐项一致 —— 该分类
//   死线占比高(抽样 12 条中 5 条: 无 hls4 的 vidhide 单线[hls2 被 ASN 锁、
//   hls3 源站 502/404]、javside/javb1[页面三方出口全被拦, 只能嗅探]、voe 嗅探),
//   属站方线路问题、非第五轮回归; 真正的快速通道毒点是"合法 JSON+坏地址"
//   型负载(见 play 内注释), 已加信任门槛回退。(2) 清晰度低在 vidhide 线:
//   master 变体是 480→720→1080 升序、播放器默认吃首档 —— Worker v3 把变体
//   降序并且 /v 直接返回最高档媒体列表; playmate/vidara 的 master 都是单档
//   (实测 playmate 720p 封顶/vidara 1080p, 由源决定, 蜘蛛返回完整 master)。
//   (3) 提速: Worker v2 缓存逻辑经 workerd 复现证明正确, 沙箱出口 POP 轮转
//   测不出命中; v3 改 /v 直达媒体列表省一整跳串行往返, 不再只依赖预热。
// 提速(2026-10-20 第五轮): 第四轮真机全通但播放加载慢。实测瓶颈在串行往返:
//   play() 先 collectEmbeds(3 个 dooplayer API)才返回 Worker /v, 播放器再串行
//   /v→/p→首分片, 每跳 Worker 都实时回源(/v 1.2~2.6s、/p 1.1~1.8s)。
//   → detail 阶段就并行收集线路, 把 embed 列表 base64url 编进 play id;
//     play() 解出后跳过 collectEmbeds: vidhide-only 直接返回 Worker 地址(本地零网络),
//     playmate/vidara 仍竞速直解。旧 id(无 $@ 负载)自动回退原 collectEmbeds 流程。
//   → Worker v2 给 /v、/p 加 Cache API 边缘缓存并在 /v 时后台预热首变体 /p 与首分片。

const KEY = 'py_javgg';
const NAME = 'JavGG';
const SITE = 'https://javgg.net';
const BACKUP_SITE = 'https://javgg.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = SITE + '/';
// vidhide 全链代理 Worker 基址（用户手动部署 javgg-vidhide-worker.js 后填入，
// 如 'https://javgg-vidhide.li768435813.workers.dev'）。留空 = 未部署，
// vidhide 线路维持第三轮的 parse:1 嗅探行为。
const VIDHIDE_WORKER = 'https://javgg-vidhide.li768435813.workers.dev';

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

// base64url（与 avhub 等源同款 Buffer 写法）: detail 把线路 embed 列表编进 play id 用
function b64urlEncode(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  try {
    return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) { return ''; }
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

  // 提速: 在 detail 阶段顺带并行收集线路 embed（有界 4s），编进 play id 的 $@ 负载，
  // play() 解出后跳过 collectEmbeds 往返。收集失败/为空则退回旧 id 形式，
  // play() 会按原流程现场收集，行为与第四轮完全一致。
  let playId = postId ? postId + '$' + durl : durl;
  if (postId) {
    try {
      const embeds = await collectEmbeds(postId, 4000);
      if (embeds && embeds.length) {
        const payload = b64urlEncode(JSON.stringify({ e: embeds.map(e => e.embedUrl) }));
        if (payload) playId += '$@' + payload;
      }
    } catch (e) { /* 保持旧 id 形式 */ }
  }

  const vod = {
    vod_id: durl,
    vod_name: name || durl,
    vod_pic: pic,
    vod_content: content,
    vod_play_from: 'JavGG',
    vod_play_url: `正片$${playId}`,
  };
  subRegister(id, vod);
  return { list: [vod] };
}

// ---- 播放解码（只有 playmate / vidara 两类在 spider 侧直解） ----

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

// 线路收集 + 分类（decoder 只给 playmate/vidara；vidhide/f4/other 一律走嗅探）
function classifyEmbed(embedUrl) {
  let host = '';
  try { host = new URL(embedUrl).hostname; } catch (e) { return null; }
  if (host.includes('playmate')) return { embedUrl, prio: 1, kind: 'playmate', decoder: tryPlaymate };
  if (host.includes('shadowbyte') || host.includes('dstyladsg') || host.includes('vidara')) return { embedUrl, prio: 2, kind: 'vidara', decoder: tryVidara };
  if (host.includes('earnvidjavgg') || host.includes('vidhide') || host.includes('streamhg')) return { embedUrl, prio: 3, kind: 'vidhide', decoder: null };
  if (host.includes('f4jav') || host.includes('f4scdn') || /\/e\/[A-Za-z0-9]+/.test(embedUrl)) return { embedUrl, prio: 4, kind: 'f4', decoder: null };
  return { embedUrl, prio: 99, kind: 'other', decoder: null };
}

async function collectEmbeds(postId, budgetMs) {
  const fetchEmbed = async (srv) => {
    try {
      const apiText = await getText(`${SITE}/wp-json/dooplayer/v2/${postId}/movie/${srv}`, { 'Accept': 'application/json' }, 10);
      if (!apiText) return null;
      const embedUrl = t(JSON.parse(apiText).embed_url);
      if (!embedUrl || !/^https?:\/\//.test(embedUrl)) return null;
      return classifyEmbed(embedUrl);
    } catch (e) { return null; }
  };
  // 并行收集，限时（默认 5s；detail 预收集收紧到 4s）：慢的 server 不阻塞已拿到的线路
  const embeds = (await settleWithin([1, 2, 3].map(fetchEmbed), budgetMs || 5000)).filter(Boolean);
  embeds.sort((a, b) => a.prio - b.prio);
  return embeds;
}

// 播放: playmate/vidara 竞速直解 → 没有或失败立刻 parse:1 嗅探，全程不解 vidhide
async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.startsWith('正片$')) id = id.slice(3);
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  if (/\.m3u8(\?|$)/i.test(id)) {
    return subAttach({ parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
  }
  // 提速快速通道: detail 已把线路 embed 列表编进 id 尾部的 $@ 负载 → 解出后直接用，
  // 跳过 collectEmbeds 的 3 个 dooplayer API 往返（vidhide-only 时 play 本地零网络
  // 立刻返回 Worker 地址）。负载缺失/损坏则剥离后走原流程，旧 id 完全兼容。
  let fastEmbeds = null;
  const fm = id.match(/\$@([A-Za-z0-9_-]+)$/);
  if (fm) {
    try {
      const payload = JSON.parse(b64urlDecode(fm[1]) || '{}');
      const urls = Array.isArray(payload.e) ? payload.e : [];
      const list = urls.map(u => classifyEmbed(t(u))).filter(Boolean);
      // 只信任"像真线路"的负载: 至少一条能归入已知类型(playmate/vidara/
      // vidhide/f4)才用。整包都是 other 时多半是回传环节把地址弄坏了
      // (第六轮 harness 实测: 合法 JSON+坏地址的负载会毒死快速通道、跳过
      // 本该成功的现场收集, play 只剩嗅探坏地址) —— 此时不用负载,
      // 落到下面 collectEmbeds 全流程, 与第四轮行为完全一致。
      if (list.length && list.some(e => e.kind !== 'other')) fastEmbeds = list;
    } catch (e) { /* 负载坏了就当没有 */ }
    id = id.slice(0, fm.index);
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

  const embeds = fastEmbeds || await collectEmbeds(postId);

  // 1) 只对带解码器的 playmate/vidara 竞速直解：最高优先级成功立即返回，
  //    低优先级先成功等 2.5s 宽限盼高优先级，整轮预算 13s
  const cands = embeds.filter(e => e.decoder && (e.kind === 'playmate' || e.kind === 'vidara'));
  if (cands.length) {
    const res = await bestWithin(
      cands.map(e => ({ prio: e.prio, run: () => e.decoder(e.embedUrl, durl) })),
      13000, 2500
    );
    if (res && res.url) {
      return subAttach({ parse: 0, url: res.url, header: { 'User-Agent': UA, 'Referer': durl } }, subsP);
    }
  }

  // 2) vidhide 系：已部署全链代理 Worker 时走 Worker —— play 返回 parse:0 的
  //    Worker /v 地址，铸 token/拉列表/拉分片全在 Worker 同一出口完成，
  //    播放器不需要任何自定义头（真机已证播放器不透传 play 的 header 到分片）。
  //    未部署（常量为空）则不进此分支，维持第三轮嗅探。
  const vh = embeds.find(e => e.kind === 'vidhide');
  if (VIDHIDE_WORKER && vh) {
    return subAttach({
      parse: 0,
      url: VIDHIDE_WORKER + '/v?u=' + encodeURIComponent(vh.embedUrl) + '&r=' + encodeURIComponent(durl),
      header: { 'User-Agent': UA, 'Referer': durl },
    }, subsP);
  }

  // 3) 嗅探：vidhide 第一（同系多条保持 server 顺序，earnvid 在前）> f4 > other > 第一条。
  //    vidhide 直链的 token 按解码出口的 ASN 签发、真机全灭，只有让播放器在 embed 页的
  //    网页会话里自己取流才绕得开；f4 强制 Origin 同理。立刻返回，不解码、不等待。
  const sniff = embeds.find(e => e.kind === 'vidhide')
    || embeds.find(e => e.kind === 'f4')
    || embeds.find(e => e.kind === 'other')
    || embeds[0];
  if (sniff) {
    return subAttach({ parse: 1, url: sniff.embedUrl, header: { 'User-Agent': UA, 'Referer': durl } }, subsP);
  }
  // 线路一条都没收集到：把详情页本身交给嗅探，好过返回空让 App 直接报失败
  if (durl && durl !== REFERER) {
    return subAttach({ parse: 1, url: durl, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
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

// ---------------- 字幕聚合 (Layer A 铺开, 2026-10-23) ----------------
// 与 bestjavporn 试点同一实现 (提交 9c339419, 用户真机确认
// MiraPlayer 可加载并选择字幕): 点播时按片名/番号并行搜迅雷看看
// oracle (首档; 「迅雷」与「迅雷看看」实为同一接口) + SubtitleCat
// (第二档), 合并排序 = 来源档位 -> 语言 (简中>繁中>双语>英文>
// 其他) -> 番号命中 -> 热度, 只收 .srt/.vtt/.ass/.ssa 直链, 上限
// 10 条, 以 TVBox 标准 subs:[{name,url,format}] 挂到 play 结果。
// 总预算 6s、单请求 4~5s、全程框架 req (NOFETCH 安全)、结果缓存
// 10 分钟 (空结果不缓存); 无命中时不带 subs 键, play 返回与接入
// 前逐字段一致。SubHD (下载被站方门控) 与射手 (源站 522) 不接入。
const SUB_UA = (typeof UA !== 'undefined' && UA) ? UA : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

function subCleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// subHttp: 与试点 reqRaw 同语义 (状态码不抛错、仅 2xx 给正文、
// 文本恒等变换防自动 JSON 解析), 底层框架 req。
async function subHttp(url, headers, timeoutMs) {
  try {
    const r = await req.request({
      method: 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    });
    const text = typeof r.data === 'string' ? r.data : (r.data == null ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// play 入参归一: 个别 App 会把 "集名$播放id" 整段传回, 集名短且
// 不含 {/http 时剥掉前缀, 与 detail 登记的 episode id 对齐。
function subNormKey(k) {
  const s = String(k || '');
  const i = s.indexOf('$');
  if (i > 0) {
    const before = s.slice(0, i);
    if (before.length <= 30 && !/[{/]/.test(before) && !/http/i.test(before)) return s.slice(i + 1).trim();
  }
  return s.trim();
}

// detail 侧登记: 片名按 [detail 入参 id, vod_id, 每个 episode 的
// 播放 id] 多键写入 subNameCache, 并以首个 episode id 预热搜索。
function subRegister(detailIds, vod) {
  try {
    if (!vod || !vod.vod_name) return;
    const name = String(vod.vod_name);
    const keys = new Set();
    for (const i of (Array.isArray(detailIds) ? detailIds : [detailIds])) {
      if (i) keys.add(String(i));
    }
    if (vod.vod_id) keys.add(String(vod.vod_id));
    const eps = [];
    for (const grp of String(vod.vod_play_url || '').split('$$$')) {
      for (const seg of grp.split('#')) {
        const k = seg.indexOf('$');
        if (k >= 0) {
          const ep = seg.slice(k + 1);
          if (ep) { keys.add(ep); eps.push(ep); }
        }
      }
    }
    for (const k of keys) subCacheName(k, name);
    const warmKey = eps[0] || (vod.vod_id ? String(vod.vod_id) : '');
    if (warmKey) subWarm(warmKey);
  } catch (e) { /* 字幕登记失败不影响详情 */ }
}

// play 侧挂载: 仅当结果带非空 url 且字幕有命中时才加 subs 键。
async function subAttach(res, subsP) {
  try {
    const subs = await subsP;
    if (subs && subs.length && res && typeof res === 'object' && res.url) res.subs = subs;
  } catch (e) { /* 字幕挂载失败不影响播放结果 */ }
  return res;
}

// ---------------- 字幕聚合 (Layer A 试点, 2026-10-22) ----------------
// 点播时按片名多源搜字幕, 候选以 TVBox 标准 subs 数组挂到 play
// 返回对象上 (播放器是否渲染由播放器决定, 蜘蛛只负责挂载)。
// 来源优先级 (用户钦定): 迅雷 > 迅雷看看 > SubtitleCat > SubHD
// > 射手。实探结论 (报告 castbank/REPORT_subtitle_pilot.md):
// 「迅雷」与「迅雷看看」是同一个 oracle 接口 (api-shoulei-ssl.
// xunlei.com, 按名搜、结果即 .srt 直链), 实现合并为一源占首档;
// SubHD 搜索与 prepare 通但 /down/ 被站方门控 (VM 出口实测 403
// 「下载页面已失效」)、射手 assrt.net 源站经 CF 522 不可达 —
// 两源本轮不接入 (不挂未验证链路)。全程 req 主栈 (subHttp),
// 每源独立超时、总预算 6s、与 resolveLines 并行, 失败全静默;
// 无结果时 play 返回对象不带 subs 键, 与未接入前逐字段一致。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();   // durl -> 片名 (detail 时 best-effort 写入)
const subResultCache = new Map(); // durl -> {ts, subs}

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? subCleanText(slug.replace(/[-_]+/g, ' ')) : '';
}

// 番号抽取 (移植自迅雷看看 REX 组件 extractSearchCode 的核心档)
function subExtractCode(text) {
  const s = String(text || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');
  const pats = [
    /\bFC2(?:[- ]?PPV)?[- ]?\d{5,8}\b/,
    /\bCARIB(?:PR)?[- ]?\d{6,8}\b/,
    /\b1PONDO[- ]?\d{6,8}\b/,
    /\bHEYZO[- ]?\d{3,6}\b/,
    /\b[A-Z]{2,10}[- ]\d{2,8}[A-Z]?\b/,
    /\b[A-Z]{2,10}\d{2,8}[A-Z]?\b/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[0].replace(/\s+/g, '-').replace(/-+/g, '-');
  }
  return '';
}

function subKeys(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const keys = [];
  if (code) keys.push(code);
  if (title && title !== code) keys.push(title);
  if (code && title) {
    const tp = title.replace(new RegExp(code.replace(/-/g, '[- ]?'), 'i'), '').replace(/^[\s\-_:]+|[\s\-_:]+$/g, '').trim();
    if (tp && tp.length >= 3) keys.push(code + ' ' + tp);
  }
  return [...new Set(keys)].filter((k) => k.length >= 2).slice(0, 3);
}

// 语言判定: rank 越小越优先 (简中 > 繁中 > 双语 > 英文 > 其他)
function subLangOf(name, langs) {
  const s = (String(name || '') + ' ' + String(langs || '')).toLowerCase();
  if (/简体|简中|chs|zh[-_. ]?cn|zh[-_. ]?hans/.test(s)) return { tag: '简中', rank: 0 };
  if (/繁体|繁中|cht|zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?hant/.test(s)) return { tag: '繁中', rank: 1 };
  if (/双语|中英|中日|bilingual/.test(s)) return { tag: '双语', rank: 2 };
  if (/英文|english|eng|(^|[-_. ])en([-_. ]|$)/.test(s)) return { tag: '英文', rank: 3 };
  if (/日文|日语|japanese|jpn|(^|[-_. ])ja([-_. ]|$)/.test(s)) return { tag: '日文', rank: 4 };
  return { tag: '', rank: 5 };
}

const SUB_TEXT_RE = /\.(srt|vtt|ass|ssa)(\?|#|$)/i;

// 迅雷看看 (兼「迅雷」位, 同一 oracle 接口): 按名搜, 结果即直链。
// 前 2 个键并行查, 每键返回即入 bag (不互相等候 — 慢键不能扣住
// 快键的结果), 最终由 subMerge 按档位/语言/番号命中/热度排序。
async function subFromXunlei(keys, code, bag) {
  await Promise.all(keys.slice(0, 2).map(async (key) => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 5000);
    if (r.status !== 200 || !r.body) return;
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return;
    for (const it of j.data) {
      if (!it) continue;
      const url = String(it.url || it.Url || '');
      if (!SUB_TEXT_RE.test(url)) continue; // 压缩包/非文本字幕剔除
      const nm = String(it.name || it.Name || '字幕');
      const langs = Array.isArray(it.languages) ? it.languages.join(',') : String(it.langs || it.Langs || '');
      const lang = subLangOf(nm, langs);
      const pop = (Number(it.down_count || it.DownCount || it.downloads || 0) || 0)
        + (Number(it.score || 0) || 0) + (Number(it.fingerprintf_score || it.fingerprint_score || 0) || 0);
      // 个别条目名是裸哈希 (不可读): 显示名换成番号字幕, 匹配/
      // 语言判定仍用原名
      const dispName = /^[0-9a-f]{24,}$/i.test(nm.trim()) ? (code ? code + ' 迅雷字幕' : '迅雷字幕') : nm;
      bag.push({
        src: '迅雷看看', tier: 0, name: dispName, url, lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop,
      });
    }
  }));
}

// SubtitleCat: 搜索页 -> 字幕页 -> 按语言分的 .srt 直链 (逐页入 bag)
async function subFromSubtitleCat(keys, code, bag) {
  const key = keys[0];
  if (!key) return;
  const r = await subHttp('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 5000);
  if (r.status !== 200 || !r.body) return;
  const pages = [];
  const seen = new Set();
  for (const m of r.body.matchAll(/href="(subs\/\d+\/[^"]+\.html)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    pages.push(m[1]);
    if (pages.length >= 3) break;
  }
  await Promise.all(pages.map(async (p) => {
    const pr = await subHttp('https://subtitlecat.com/' + p, { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 4000);
    if (pr.status !== 200 || !pr.body) return;
    for (const m of pr.body.matchAll(/href="(\/subs\/\d+\/[^"]+\.(?:srt|vtt|ass))"/gi)) {
      let nm = m[1].split('/').pop() || '字幕';
      try { nm = decodeURIComponent(nm); } catch (e) { /* 保持原样 */ }
      const lang = subLangOf(nm, '');
      bag.push({
        src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop: 0,
      });
    }
  }));
}

// 合并排序: 来源档位 -> 语言 -> 番号命中 -> 热度; 按 url 与
// (语言|去扩展名文件名) 双键去重 (迅雷与 SubtitleCat 常有同源
// 同名文件、不同直链); 上限 10 条。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.codeHit - a.codeHit) || (b.pop - a.pop) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const seenName = new Set();
  const out = [];
  for (const it of sorted) {
    if (seenUrl.has(it.url)) continue;
    const nameKey = it.lang + '|' + it.name.toLowerCase().replace(/\.(srt|vtt|ass|ssa)$/i, '');
    if (seenName.has(nameKey)) continue;
    seenUrl.add(it.url);
    seenName.add(nameKey);
    const ext = (it.url.match(SUB_TEXT_RE) || [])[1].toLowerCase();
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: ext });
    if (out.length >= 10) break;
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const keys = subKeys(durl);
    let subs = [];
    if (keys.length) {
      const code = subExtractCode(subNameCache.get(durl) || '') || subExtractCode(String(durl || ''));
      const bag = [];
      const jobs = [
        subFromXunlei(keys, code, bag),
        subFromSubtitleCat(keys, code, bag),
      ].map((jp) => Promise.resolve(jp).catch(() => {}));
      const all = Promise.allSettled(jobs);
      // 总预算 6s: 到点先用已入 bag 的部分合并返回; 后台源跑完
      // 后若凑出结果再迟填缓存 (慢出口下 detail 预热靠此命中)。
      // 空结果不缓存 (无字幕的片每次点播重查, 由在途去重兜底)。
      await Promise.race([all, new Promise((r) => setTimeout(r, 6000))]);
      subs = subMerge(bag);
      if (subs.length) {
        subResultCache.set(durl, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(durl, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(durl, p);
  try { return await p; } finally { subInflight.delete(durl); }
}

// detail 入口即预热 (不 await): 慢出口下单趟搜索可达数秒, 让它
// 与详情页的铸造链并行跑, 用户点播时 play 直接命中缓存/在途。
function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
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
