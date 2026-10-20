import req from '../../util/req.js';

// JavMobile (py_javmobile)
// 站点: https://javmobile.net/ (WordPress JAV 站，无反爬)
// 列表: GET /{cat}/[/page/N/]  30 条/页
// 搜索: GET /?s={kw}[/page/N/]  30 条/页
// 详情: GET /{slug}/  内联 JS var SOURCES = [upload18, audinifer]
// 播放: Server1 upload18.org -> window.PLAYER_CONFIG.m3u8 (helvid.com 直链, parse:0)
//       兜底 Server2 audinifer.com -> 解 pack 混淆 JS 取 m3u8

const KEY = 'py_javmobile';
const NAME = 'JavMobile';
const SITE = 'https://javmobile.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// 手机 UA：helvid 的 token 按设备签发 (d=apple/d=chromium)，用手机 UA 取 token
// 才能保证用户手机端（MiraPlayer 原生 UA）请求分片不 404
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const REFERER = SITE + '/';

// 8 个真实分类 (2026-10-20 从首页导航实测)
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'censored', type_name: '有码' },
  { type_id: 'uncensored', type_name: '无码' },
  { type_id: 'uncensored-leaked', type_name: '破解无码' },
  { type_id: 'chinese-av', type_name: '国产' },
  { type_id: 'amateur', type_name: '素人' },
  { type_id: 'english-subtitle', type_name: '英字' },
  { type_id: 'actresses', type_name: '女优' },
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
    .replace(/&#8217;/g, "'")
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

// 双通道: 先框架 req，失败再原生 fetch
// ua: 覆盖默认 UA（取 helvid token 时必须用手机 UA，否则签出的 d=chromium token 在手机端分片 404）
async function getHtml(url, referer, ua) {
  const headers = {
    'User-Agent': ua || UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
    'Referer': referer || REFERER,
  };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 解析列表卡片: article.loop-post > a[href] > h2.entry-title + img[src]
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<article\s[^>]*class="[^"]*loop-post[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const card = m[1];
    const am = card.match(/<a\s[^>]*href="(https?:\/\/javmobile\.net\/[^"]+\/)"/);
    if (!am) continue;
    const durl = am[1];
    if (seen.has(durl)) continue;
    seen.add(durl);
    let title = '';
    const tm = card.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/);
    if (tm) title = clean(tm[1]);
    let pic = '';
    const im = card.match(/<img[^>]+src="([^"]+)"/);
    if (im) pic = fixUrl(im[1]);
    out.push({
      vod_id: durl,
      vod_name: title || durl.split('/').filter(Boolean).pop(),
      vod_pic: pic,
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  // 取最大的 /page/N/ 数字
  let max = 1;
  const re = /\/page\/(\d+)\//g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max && n < 1000000) max = n;
  }
  return max;
}

async function buildList(url, page, limit, tid) {
  limit = limit || 30;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  let pc = parsePagecount(html);
  // 最新：首页无翻页链接，且各页 HTML 里解析出的 pagecount 会随当前页码波动
  // （如第2页只能看到 /page/2/，pagecount 就变成 2），导致 App 误判已到最后一页。
  // 实测 /page/100/ 仍有 30 条，固定给 100。
  if (tid === 'latest' && list.length > 0) pc = 100;
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

function catUrl(tid, page) {
  let base;
  if (tid === 'latest' || !tid) base = SITE + '/';
  else base = SITE + '/' + tid + '/';
  if (page > 1) base += 'page/' + page + '/';
  return base;
}

// 从详情页提取 SOURCES 数组
function extractSources(html) {
  const m = html.match(/var\s+SOURCES\s*=\s*\[(.*?)\];/s);
  if (!m) return [];
  const urls = [];
  const re = /"(https?:\\?\/\\?\/[^"]+)"/g;
  let x;
  while ((x = re.exec(m[1])) !== null) {
    urls.push(x[1].replace(/\\\//g, '/'));
  }
  return urls;
}

// Server1: upload18 播放页 -> window.PLAYER_CONFIG.m3u8 (带1次重试, 站方偶发 chunked 截断)
// 注意: 必须用手机 UA 请求，helvid 按 UA 签发 token (d=apple)；用桌面 UA 签出的
// d=chromium token 在手机端请求分片会 404，导致播不全/无法快进
async function resolveUpload18(embedUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const html = await getHtml(embedUrl, REFERER, MOBILE_UA);
    if (!html || !html.includes('window.PLAYER_CONFIG')) continue;
    const m = html.match(/window\.PLAYER_CONFIG\s*=\s*(\{.*?\});/s);
    if (!m) continue;
    try {
      const cfg = JSON.parse(m[1]);
      const url = t(cfg.m3u8).replace(/\\\//g, '/');
      // 注意: helvid 的 m3u8 路径是 base64, 字面量无 .m3u8, 用域名+路径特征判断
      if (/^https?:\/\/[^/]*helvid\.com\/m\//.test(url)) return url;
      if (/^https?:\/\//.test(url) && url.includes('.m3u8')) return url;
    } catch (e) { /* ignore */ }
  }
  return '';
}

// Server2: audinifer embed 页 -> 解 pack 混淆 JS 取 m3u8
// 注意: 站方 packer 用单引号包裹 payload: }('PAYLOAD',36,497,'SYMTAB'.split('|')))
function unpackAudinifer(html) {
  const m = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)\)/);
  if (!m) return '';
  let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = m[4].split('|');
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const tok = (n) => {
    let s = '';
    while (n > 0) { s = chars[n % a] + s; n = Math.floor(n / a); }
    return s || '0';
  };
  for (let i = c - 1; i >= 0; i--) {
    if (k[i]) {
      const re = new RegExp('\\b' + tok(i) + '\\b', 'g');
      p = p.replace(re, k[i]);
    }
  }
  const um = p.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
  return um ? um[0] : '';
}

async function resolveAudinifer(embedUrl) {
  const html = await getHtml(embedUrl, REFERER);
  if (!html) return '';
  return unpackAudinifer(html);
}

// 解析播放地址 (实时解析, token 时效约 30 分钟)
// 返回 { url, parse, referer }: referer 必须与取源站点一致,
// helvid.com 会 403 掉 Referer 为 javmobile.net 的请求, 必须用 upload18.org
async function resolvePlay(durl) {
  const html = await getHtml(durl);
  if (!html) return { url: '', parse: 0, referer: '' };
  const sources = extractSources(html);
  // 优先 Server1 (upload18, 直链 m3u8)
  for (const s of sources) {
    if (/upload18\.org/i.test(s)) {
      const m3u8 = await resolveUpload18(s);
      if (m3u8) return { url: m3u8, parse: 0, referer: s };
    }
  }
  // 兜底 Server2 (audinifer, 解混淆)
  for (const s of sources) {
    if (/audinifer\.com/i.test(s)) {
      const m3u8 = await resolveAudinifer(s);
      if (m3u8) return { url: m3u8, parse: 0, referer: s };
      // 解不出来就返回 embed 页走嗅探
      return { url: s, parse: 1, referer: s };
    }
  }
  // 都没有则返回第一个源走嗅探
  if (sources.length) return { url: sources[0], parse: 1, referer: sources[0] };
  return { url: '', parse: 0, referer: '' };
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  return { class: cls, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  return buildList(catUrl(tid, page), page, 30, tid);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+|\/+$/g, '') + '/');

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const tm = html.match(/<h1 class="title">([\s\S]*?)<\/h1>/);
  if (tm) name = clean(tm[1]);
  if (!name) {
    const om = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (om) name = clean(om[1]);
  }
  if (!name) name = durl.split('/').filter(Boolean).pop();

  let pic = '';
  const pm = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (pm) pic = fixUrl(pm[1]);
  // 兜底: 海报 URL 可由 slug 推导 (upload18.cc/v/{大写SLUG}/poster.jpg, 与列表卡片一致)
  if (!pic || pic.includes('cropped-javmobile')) {
    const slug = durl.split('/').filter(Boolean).pop() || '';
    if (slug) pic = `https://upload18.cc/v/${slug.toUpperCase()}/poster.jpg`;
    else pic = '';
  }

  let desc = '';
  const dm = html.match(/<meta name="description" content="([^"]+)"/);
  if (dm) desc = clean(dm[1]);

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: desc || name,
      vod_play_from: 'JavMobile',
      vod_play_url: `正片$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+|\/+$/g, '') + '/');

  const r = await resolvePlay(durl);
  if (!r.url) return { parse: 0, url: '' };
  // Referer 必须与视频源站点一致 (helvid 只认 upload18.org, 否则 403)
  // UA 必须用手机 UA：token 按设备签发 (d=apple)，与取 token 时的 UA 保持一致
  const referer = r.referer || REFERER;
  return {
    parse: r.parse,
    url: r.url,
    header: { 'User-Agent': MOBILE_UA, 'Referer': referer },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url = SITE + '/page/' + page + '/?s=' + encodeURIComponent(wd);
  return buildList(url, page, 30);
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
