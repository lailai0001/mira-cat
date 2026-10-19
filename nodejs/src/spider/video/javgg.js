import req from '../../util/req.js';

// JavGG (py_javgg)
// 站点: https://javgg.net/ (WordPress + DooPlay 主题，无反爬)
// 列表: /new-post/[/page/N/]、/trending/、/tag/{slug}/[/page/N/]、/genre/{slug}/[/page/N/]
// 详情: /jav/{番号slug}/  解析 data-post 得到 post_id
// 播放: GET /wp-json/dooplayer/v2/{post_id}/movie/1 → embed_url(f4jav.xyz)
//       → embed 页 data-video-id → GET {host}/api/play/{vid}?ab=0&r={durl} → src(m3u8)
//       播放必须带 Origin: {embed_host} header，否则 403

const KEY = 'py_javgg';
const NAME = 'JavGG';
const SITE = 'https://javgg.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 9 个真实分类 (2026-10-20 实测，均为 200 且有内容)
const CATS = [
  { type_id: 'latest', type_name: '最新', url: '/new-post/' },
  { type_id: 'trending', type_name: '热门', url: '/trending/' },
  { type_id: 'english-subtitle', type_name: '英字幕', url: '/tag/english-subtitle/' },
  { type_id: 'chinese-subtitle', type_name: '中字幕', url: '/tag/chinese-subtitle/' },
  { type_id: 'uncensored-leak', type_name: '无码流出', url: '/tag/uncensored-leak/' },
  { type_id: 'censored', type_name: '有码', url: '/tag/censored/' },
  { type_id: 'reduce-mosaic', type_name: '减码破解', url: '/tag/reduce-mosaic/' },
  { type_id: 'genre-4k', type_name: '4K', url: '/genre/4k/' },
  { type_id: 'genre-3p', type_name: '3P', url: '/genre/3p/' },
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

// 双通道: 先框架 req，失败再原生 fetch
// minLen: 最小有效长度 (HTML 页用 500，JSON API 用 10)
async function getText(url, headers, minLen) {
  const h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const need = minLen || 500;
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: 25000, responseType: 'text' });
    if (status === 200 && data) {
      const txt = typeof data === 'string' ? data : String(data);
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { headers: h });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
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
  // 结构1: 列表页
  const re1 = /<article[^>]*class="[^"]*item movies[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  while ((m = re1.exec(html)) !== null) {
    const card = m[1];
    const linkM = card.match(/<a[^>]*href="(https?:\/\/javgg\.net\/jav\/[^"]+\/)"/);
    if (!linkM) continue;
    const imgM = card.match(/<img[^>]*data-src="([^"]+)"/) || card.match(/<img[^>]*src="([^"]+)"/);
    const titleM = card.match(/<div class="titlecontent">([\s\S]*?)<\/div>/);
    const codeM = card.match(/<h3><a[^>]*>([^<]+)<\/a><\/h3>/);
    push(linkM[1], imgM ? fixUrl(imgM[1]) : '', titleM ? clean(titleM[1]) : (codeM ? clean(codeM[1]) : ''));
  }
  // 结构2: 搜索页
  const re2 = /<div class="result-item">([\s\S]*?)<\/article>/g;
  while ((m = re2.exec(html)) !== null) {
    const card = m[1];
    const linkM = card.match(/<a[^>]*href="(https?:\/\/javgg\.net\/jav\/[^"]+\/)"/);
    if (!linkM) continue;
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const titleM = card.match(/<div class="title">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    push(linkM[1], imgM ? fixUrl(imgM[1]) : '', titleM ? clean(titleM[1]) : '');
  }
  return out;
}

function catUrl(tid, page) {
  const cat = CATS.find(c => c.type_id === tid) || CATS[0];
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
  // WordPress 分页: /page/N/
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

  // post_id 用于播放 API
  const postM = html.match(/data-post='(\d+)'/);
  const postId = postM ? postM[1] : '';

  const playId = postId ? `${postId}$${durl}` : durl;
  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_content: content,
      vod_play_from: 'JavGG',
      vod_play_url: `正片$${playId}`,
    }],
  };
}

// 播放: dooplayer API → embed 页 → f4s api/play → m3u8 (需 Origin)
// id 格式: "正片$postId$durl" / "postId$durl" / 完整 durl / 纯 postId
async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.startsWith('正片$')) id = id.slice(3);
  // id 可能是 "postId$durl" 形式，先整体匹配
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

  try {
    // 1. dooplayer API 取 embed 地址 (优先 server 1: f4scom)
    const apiUrl = `${SITE}/wp-json/dooplayer/v2/${postId}/movie/1`;
    const apiText = await getText(apiUrl, { 'Accept': 'application/json' }, 10);
    if (!apiText) return { parse: 0, url: '' };
    const apiJson = JSON.parse(apiText);
    const embedUrl = t(apiJson.embed_url);
    if (!embedUrl || !/^https?:\/\//.test(embedUrl)) return { parse: 0, url: '' };
    const embedHost = new URL(embedUrl).origin;

    // 2. embed 页解析 data-video-id / data-api
    const embedHtml = await getText(embedUrl, { 'Referer': durl });
    if (!embedHtml) return { parse: 0, url: '' };
    const vidM = embedHtml.match(/data-video-id="([a-f0-9-]+)"/);
    const apiM = embedHtml.match(/data-api="([^"]+)"/);
    if (!vidM) return { parse: 0, url: '' };
    const vid = vidM[1];
    const playApi = apiM ? (apiM[1].startsWith('/') ? embedHost + apiM[1] : apiM[1]) : `${embedHost}/api/play/${vid}`;

    // 3. 取播放地址 (ab=0 绕过 adblock 检测)
    const srcUrl = `${playApi}?ab=0&r=${encodeURIComponent(durl)}`;
    const srcText = await getText(srcUrl, { 'Accept': 'application/json', 'Referer': embedUrl }, 10);
    if (!srcText) return { parse: 0, url: '' };
    const srcJson = JSON.parse(srcText);
    const src = t(srcJson.src || srcJson.url);
    if (!src || !/^https?:\/\//.test(src)) return { parse: 0, url: '' };

    // 4. m3u8 必须带 Origin 才能访问 (f4s 锁定)
    return {
      parse: 0,
      url: src,
      header: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Origin': embedHost,
      },
    };
  } catch (e) {
    return { parse: 0, url: '' };
  }
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
