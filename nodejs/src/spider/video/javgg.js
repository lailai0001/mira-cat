import req from '../../util/req.js';

// JavGG (py_javgg)
// 站点: https://javgg.net/ (WordPress + DooPlay 主题，无反爬；备用域名 javgg.co)
// 注意: javgg.co 的 /tag/* 归档页全部 500（站方镜像配置坏了），字幕分类改走搜索替代
// 列表: /new-post/[/page/N/]、/trending/[/page/N/]、/genre/{slug}/[/page/N/]
//       搜索型分类: /?s={kw}[&paged=N]（英字幕/中字幕，用搜索代替坏掉的 tag 页）
// 详情: /jav/{番号slug}/  解析 data-post 得到 post_id
// 播放: dooplayer API server1~3，收集后按手机友好度排序解码：
//   playmate系(playmate.to /embed/): POST {host}/api/s → sx(master.txt)，m3u8/分片无任何 header 要求，
//              1080p，全链路无头可访问 → 优先级最高
//   f4s系(f4jav.xyz /e/): embed 页 data-video-id → GET {host}/api/play/{vid}?ab=0 → src(m3u8)，
//              m3u8 强制要求 Origin 头（无头 403），token 带请求方指纹+5分钟时效 → 次优先级
//   vidhide系(earnvidjavgg.xyz /embed/): 解 Dean Edwards packer → var links.hls2(m3u8) → 最低优先级
//   全部解不出 → 返回最高优先级 embed 页走 parse:1 嗅探

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
    const { data, status } = await req.get(url, { headers: h, timeout: 25000, responseType: 'text' });
    if (status === 200 && data) {
      const txt = typeof data === 'string' ? data : String(data);
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers: h });
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
    const { data, status } = await req.post(url, payload, { headers: h, timeout: 25000 });
    if (status === 200 && data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { method: 'POST', headers: h, body: payload });
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

  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_content: content,
      vod_play_from: 'JavGG',
      vod_play_url: `正片$${durl}`,
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

// 播放: 收集 dooplayer server 1~3 的 embed，按解码优先级排序尝试
// 优先级（按手机端友好程度实测排序）：
//   playmate(最高优先: m3u8/分片无任何 header 要求, 1080p, 全链路无头可访问)
//   f4s(次之: m3u8 强制要求 Origin 头、无头 403, token 带请求方指纹+5分钟时效, 播放器不转发 Origin 则必挂)
//   vidhide(最低: 解包逻辑正确, 但其 CDN(acek-cdn.com) 无法从沙箱验证拉取, token 带 asn 参数)
// 任一解码成功即 parse:0 直链；全部失败返回 embed 页走 parse:1 嗅探
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
    const m0 = html0 ? html0.match(/data-post='(\d+)'/) : null;
    postId = m0 ? m0[1] : '';
  } else {
    postId = id.replace(/\D/g, '');
  }
  if (!postId) return { parse: 0, url: '' };
  if (!durl) durl = REFERER;

  // 收集 3 个 server 的 embed
  const embeds = [];
  for (let srv = 1; srv <= 3; srv++) {
    let apiText = '';
    try {
      apiText = await getText(`${SITE}/wp-json/dooplayer/v2/${postId}/movie/${srv}`, { 'Accept': 'application/json' }, 10);
    } catch (e) { continue; }
    if (!apiText) continue;
    let embedUrl = '';
    try { embedUrl = t(JSON.parse(apiText).embed_url); } catch (e) { continue; }
    if (!embedUrl || !/^https?:\/\//.test(embedUrl)) continue;
    let host = '';
    try { host = new URL(embedUrl).hostname; } catch (e) { continue; }
    let prio = 99; // 其他(lulu等)最低
    let decoder = null;
    if (host.includes('playmate')) {
      prio = 1; decoder = tryPlaymate;
    } else if (host.includes('f4jav.xyz') || /\/e\/[A-Za-z0-9]+/.test(embedUrl)) {
      prio = 2; decoder = tryF4s;
    } else if (host.includes('earnvidjavgg') || host.includes('vidhide') || host.includes('streamhg')) {
      prio = 3; decoder = tryVidhide;
    }
    embeds.push({ embedUrl, prio, decoder });
  }

  // 按优先级排序：playmate 优先，其次 f4s，再 vidhide
  embeds.sort((a, b) => a.prio - b.prio);
  for (const e of embeds) {
    if (!e.decoder) continue;
    const direct = await e.decoder(e.embedUrl, durl);
    if (direct) return direct;
  }
  // 没有直链：把第一个 embed 页交给播放器嗅探
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
