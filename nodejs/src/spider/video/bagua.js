// 八卦 - CatPawOpen 格式
// 转换自 REX forward.bagua，站点 https://www.mrds66.com（Typecho，/archives/ + /category/<slug>/<n>/）
// 2026-10-29 修复（分类无法加载更多 + 封面全空白）：
// ① 翻页：原 category()/search() 恒返回 pagecount: page（第 1 页即 pagecount=1），
//    App 据此认为只有 1 页、永不请求第 2 页；且站方翻页是 Typecho 式
//    /category/<slug>/<n>/（已实测第 2、10 页各 30 条且互不重复），WP 式
//    /category/<slug>/page/<n>/ 反而 404，URL 本身不用改。现从站方分页 UI
//    <span class="page-info"> cur/total </span>（或 data-num、page-navigator 末页链接）
//    取真实总页数，取不到且本页满 30 条时乐观返回 page+1，保证能一直翻下去。
// ② 封面：原 proxyCover 全走 bagua-img-proxy；现全站封面已迁 pic.nihmcl.cn
//    （分类页 30/30 条），实测原图为加密密文（binary/octet-stream，非 JPEG）、
//    bagua 代理回 400 Invalid URL、51chigua 代理回 200 image/jpeg。故按域路由：
//    pic.*.cn 走 51chigua，其余仍走 bagua（两代理各擅长域不同，不写死单一代理）。
import req from '../../util/req.js';

const KEY = 'py_bagua';
const NAME = '八卦';
const BASE_URL = 'https://www.mrds66.com';
const IMG_PROXY = 'https://bagua-img-proxy.li768435813.workers.dev/img?url=';
const IMG_PROXY_51 = 'https://51chigua.li768435813.workers.dev/img?url=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const CATS = [
  { type_id: 'latest', type_name: '最新更新' },
  { type_id: 'mrds', type_name: '每日大赛' },
  { type_id: 'ztds', type_name: '主题大赛' },
  { type_id: 'rstt', type_name: '热搜吃瓜' },
  { type_id: 'xazd', type_name: '校园学生' },
  { type_id: 'blyp', type_name: '必撸大赛' },
  { type_id: 'fctg', type_name: '反差泄密' },
  { type_id: 'mhds', type_name: '网红黑料' },
  { type_id: 'lqdp', type_name: '猎奇重口' },
  { type_id: 'jdsj', type_name: 'AV看片' },
  { type_id: 'mxwh', type_name: '明星大赛' },
  { type_id: 'smdh', type_name: '动漫之家' },
  { type_id: 'dypd', type_name: '影视国漫' },
  { type_id: 'mtds', type_name: 'cos写真' },
  { type_id: 'ysds', type_name: '声控ASMR' },
  { type_id: 'czds', type_name: '寸止挑战' },
  { type_id: 'hjds', type_name: '混剪PMV' },
  { type_id: 'tgds', type_name: '原创投稿' },
  { type_id: 'omjp', type_name: '欧美精品' },
  { type_id: 'qwcs', type_name: '全网参赛' },
  { type_id: 'aijc', type_name: 'AI剧场' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function decodeHtml(s) {
  return t(s)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function cleanText(s) {
  return decodeHtml(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text, re, idx) {
  const m = String(text || '').match(re);
  return m ? decodeHtml(m[idx || 1] || '') : '';
}

function absUrl(url, base) {
  url = t(url);
  if (!url) return '';
  if (/^\/\//.test(url)) return 'https:' + url;
  if (/^https?:\/\//i.test(url)) return url;
  base = t(base || BASE_URL).replace(/\/+$/, '');
  if (url.charAt(0) === '/') return base + url;
  return base + '/' + url;
}

// 封面走解密代理（按域路由：pic.*.cn 走 51chigua，其余走 bagua）。
// 实测：pic.nihmcl.cn 原图为加密密文，bagua 代理回 400 Invalid URL，
// 51chigua 代理回 200 image/jpeg；两代理各擅长域不同，不写死单一代理。
function proxyCover(url) {
  url = t(url);
  if (!url) return '';
  if (url.indexOf('data:') === 0) return url;
  // 已经是代理地址则直接返回
  if (url.indexOf('bagua-img-proxy') >= 0 || url.indexOf('51chigua') >= 0) return url;
  const full = absUrl(url, BASE_URL);
  const host = full.replace(/^https?:\/\//i, '').split('/')[0];
  const proxy = /^pic\.[^/]*\.cn$/i.test(host) ? IMG_PROXY_51 : IMG_PROXY;
  return proxy + encodeURIComponent(full);
}

// 从站方分页 UI 取真实总页数：优先 <span class="page-info"> cur/total </span>，
// 其次 pageNum 输入框的 data-num，再次 page-navigator 内的末页链接；全无则回 0。
function parseTotalPages(html) {
  const h = String(html || '');
  let m = h.match(/page-info">\s*(\d+)\s*\/\s*(\d+)/i);
  if (m) return parseInt(m[2], 10);
  m = h.match(/id=["']pageNum["'][^>]*data-num=["'](\d+)["']/i);
  if (m) return parseInt(m[1], 10);
  const nav = h.match(/<ul class="page-navigator">[\s\S]*?<\/ul>/i);
  if (nav) {
    let max = 0;
    for (const mm of nav[0].matchAll(/\/(\d+)\//g)) {
      const n = parseInt(mm[1], 10);
      if (n > max) max = n;
    }
    if (max) return max;
  }
  return 0;
}

// 总页数兜底：解析不到时，本页满 30 条则乐观返回 page+1（让 App 继续翻页，
// 下一页空时 App 自停），不满 30 条则本页即末页。
function pagecountFor(html, list, page) {
  const total = parseTotalPages(html);
  if (total > 0) return total;
  if (list.length >= 30) return page + 1;
  return page;
}

async function fetchHtml(url) {
  const { data } = await req.get(url, {
    headers: {
      'User-Agent': UA,
      'Referer': BASE_URL + '/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 20000,
  });
  return String(data || '');
}

function parseList(html) {
  const items = [];
  const seen = {};
  const articleRe = /<article\b[^>]*itemtype=["'][^"']*BlogPosting[^"']*["'][^>]*>[\s\S]*?<\/article>/gi;
  let m;
  while ((m = articleRe.exec(html))) {
    const block = m[0];
    if (/class=["'][^"']*ad-item/i.test(block)) continue;
    const href =
      firstMatch(block, /<a\b[^>]*href=["']([^"']*\/archives\/[^"']+)["'][^>]*>/i) ||
      firstMatch(block, /<meta\b[^>]*itemprop=["'][^"']*url[^"']*["'][^>]*content=["']([^"']+)["']/i);
    const title =
      firstMatch(block, /<h2[^>]*class=["'][^"']*post-card-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i) ||
      firstMatch(block, /<meta\b[^>]*itemprop=["']headline["'][^>]*content=["']([^"']+)["']/i);
    const poster =
      firstMatch(block, /loadBannerDirect\(\s*["']([^"']+)["']/i) ||
      firstMatch(block, /<meta\b[^>]*itemprop=["']image["'][^>]*content=["']([^"']+)["']/i);
    if (!href || !title) continue;
    const url = absUrl(href, BASE_URL);
    if (seen[url]) continue;
    seen[url] = 1;
    items.push({
      vod_id: url,
      vod_name: cleanText(title),
      vod_pic: proxyCover(poster),
      vod_remarks: '',
    });
  }
  return items;
}

function extractVideoUrl(html) {
  // dplayer data-config
  let cfgText = firstMatch(html, /<div\b[^>]*class=["'][^"']*dplayer[^"']*["'][^>]*data-config=(["'])([\s\S]*?)\1/i, 2);
  if (cfgText) {
    try {
      const cfg = JSON.parse(decodeHtml(cfgText));
      if (cfg && cfg.video && cfg.video.url) return cfg.video.url;
    } catch (e) {
      const u = firstMatch(cfgText, /"url"\s*:\s*"([^"]+)"/i);
      if (u) return u.replace(/\\\//g, '/');
    }
  }
  const m3u8 = firstMatch(html, /["'](https?:\\?\/\\?\/[^"']+?\.m3u8[^"']*)["']/i);
  if (m3u8) return m3u8.replace(/\\\//g, '/');
  const mp4 = firstMatch(html, /["'](https?:\\?\/\\?\/[^"']+?\.mp4[^"']*)["']/i);
  if (mp4) return mp4.replace(/\\\//g, '/');
  return '';
}

async function home() {
  return { class: CATS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || 'xazd');
  const page = Math.max(1, parseInt(body.page) || 1);
  let path;
  if (id === 'latest') {
    path = page === 1 ? '/' : `/page/${page}/`;
  } else {
    // Typecho 式翻页：/category/<slug>/<n>/（WP 式 /page/<n>/ 在此站 404，勿改）
    path = page === 1 ? `/category/${id}/` : `/category/${id}/${page}/`;
  }
  const html = await fetchHtml(BASE_URL + path);
  const list = parseList(html);
  const pagecount = pagecountFor(html, list, page);
  return { page, pagecount, limit: 30, total: pagecount * 30, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  if (!id) return { list: [] };
  const url = id.startsWith('http') ? id : absUrl(id, BASE_URL);
  const html = await fetchHtml(url);
  const title =
    firstMatch(html, /<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    firstMatch(html, /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  const cover = firstMatch(html, /<meta\b[^>]*itemprop=["']image["'][^>]*content=["']([^"']*)["']/i) ||
    firstMatch(html, /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
  const desc = firstMatch(html, /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const videoUrl = extractVideoUrl(html);
  const playFrom = [];
  const playUrls = [];
  if (videoUrl) {
    playFrom.push('八卦');
    playUrls.push('正片$' + absUrl(videoUrl, BASE_URL));
  }
  return {
    list: [{
      vod_id: url,
      vod_name: cleanText(title) || url,
      vod_pic: proxyCover(cover),
      vod_content: cleanText(desc),
      vod_play_from: playFrom.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "正片$url" 格式
  if (id.indexOf('$') >= 0) id = id.split('$').pop();
  const url = absUrl(id, BASE_URL);
  return {
    parse: 0,
    url,
    header: {
      'User-Agent': UA,
      'Referer': BASE_URL + '/',
    },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, parseInt(body.page) || 1);
  if (!kw) return { list: [] };
  const enc = encodeURIComponent(kw);
  const path = page === 1 ? `/search/${enc}/` : `/search/${enc}/${page}/`;
  const html = await fetchHtml(BASE_URL + path);
  const list = parseList(html);
  const pagecount = pagecountFor(html, list, page);
  return { page, pagecount, limit: 30, total: pagecount * 30, list };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
