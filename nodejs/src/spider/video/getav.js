import req from '../../util/req.js';

const KEY = 'py_getav';
const NAME = 'GetAV';
const HOST = 'https://getav.me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function t(v) {
  return String(v == null ? '' : v).trim();
}

function decodeHtml(s) {
  s = t(s);
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

async function fetchHtml(path) {
  const url = path.startsWith('http') ? path : HOST + path;
  try {
    const { data } = await req.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': HOST + '/zh',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });
    return typeof data === 'string' ? data : String(data || '');
  } catch (e) {
    return '';
  }
}

// Parse video cards from server-rendered HTML
// Card pattern: <a href="/zh/videos/{slug}"> ... <h3 title="TITLE">
function parseCards(html) {
  const list = [];
  const seen = {};
  if (!html) return list;
  const re = /<a href="(\/zh\/videos\/[\w\-]+)">([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const inner = m[2];
    if (seen[href]) continue;
    const tm = inner.match(/title="([^"]+)"/i);
    const title = tm ? decodeHtml(tm[1]) : '';
    if (!title) continue;
    seen[href] = 1;
    // poster: look for img near the link (may be in sibling element, try data around)
    list.push({
      vod_id: href,
      vod_name: title,
      vod_pic: '',
      vod_remarks: '',
    });
  }
  return list;
}

const CATS = {
  'new': { path: '/zh/new-releases', name: '最新' },
  'hot': { path: '/zh/hot', name: '热门' },
  'uncensored': { path: '/zh/uncensored', name: '无码' },
  'censored': { path: '/zh/censored', name: '有码' },
};

async function init() {
  return {};
}

async function home() {
  const classes = Object.keys(CATS).map((k) => ({ type_id: k, type_name: CATS[k].name }));
  return { class: classes, filters: {}, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'new');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATS[tid] || CATS['new'];
  const html = await fetchHtml(`${cat.path}?page=${page}`);
  const list = parseCards(html);
  return {
    page,
    pagecount: list.length >= 20 ? page + 1 : page,
    limit: 24,
    total: list.length,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const id of (ids || []).filter(Boolean)) {
    const html = await fetchHtml(id);
    if (!html) continue;
    // title from <title> or JSON-LD
    let name = '';
    const tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm) name = decodeHtml(tm[1]).split('|')[0].trim();
    // poster from JSON-LD thumbnailUrl
    let pic = '';
    const pm = html.match(/"thumbnailUrl":"([^"]+)"/);
    if (pm) pic = pm[1].replace(/\\u0026/g, '&');
    // description from JSON-LD
    let desc = '';
    const dm = html.match(/"description":"([^"]{0,500})"/);
    if (dm) desc = decodeHtml(dm[1]);
    if (!name) continue;
    list.push({
      vod_id: id,
      vod_name: name,
      vod_pic: pic,
      vod_content: desc,
      vod_play_from: 'GetAV',
      vod_play_url: `播放$${id}`,
    });
  }
  return { list };
}

async function play(reqIn) {
  const id = t(reqIn?.body?.id);
  if (!id) return { parse: 0, url: '' };
  // Stream URL is loaded client-side via JS; use sniffing on the video page
  const pageUrl = id.startsWith('http') ? id : HOST + id;
  return {
    parse: 1,
    url: pageUrl,
    header: { Referer: HOST + '/zh', 'User-Agent': UA },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const html = await fetchHtml(`/zh/search?q=${encodeURIComponent(wd)}&page=${page}`);
  let list = parseCards(html);
  if (!list.length) {
    // fallback: try alternate search path
    const html2 = await fetchHtml(`/zh/search/${encodeURIComponent(wd)}?page=${page}`);
    list = parseCards(html2);
  }
  return { page, pagecount: page, limit: 24, total: list.length, list };
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
