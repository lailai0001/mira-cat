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
  const headers = {
    'User-Agent': UA,
    'Referer': HOST + '/zh',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  // 双通道: 通道1 框架 req (axios, MiraPlayer 内核可用); 通道2 Node 原生 fetch (站点屏蔽 axios 指纹时用)
  for (let i = 0; i < 2; i++) {
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const t = typeof data === 'string' ? data : String(data || '');
      if (status === 200 && t.length > 500) return t;
    } catch { /* 换通道2 */ }
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.length > 500) return t;
    } catch { /* retry */ }
  }
  return '';
}

// Parse video cards from server-rendered HTML
// Card structure: <div class="group ..."><a href="/zh/videos/{slug}"><img src="POSTER"/></a><a href="/zh/videos/{slug}"><h3 title="TITLE">
function parseCards(html) {
  const list = [];
  const seen = {};
  if (!html) return list;
  // Match the card container to get both poster and title
  const cardRe = /<div class="group cursor-pointer[\s\S]*?<a[^>]*href="(\/zh\/videos\/[\w\-]+)"[^>]*>([\s\S]*?)<\/a>\s*<a[^>]*href="\/zh\/videos\/[\w\-]+"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html))) {
    const href = m[1];
    const imgBlock = m[2];
    const titleBlock = m[3];
    if (seen[href]) continue;
    const tm = titleBlock.match(/title="([^"]+)"/i);
    const title = tm ? decodeHtml(tm[1]) : '';
    if (!title) continue;
    seen[href] = 1;
    // poster from img src in the first <a> (static.worldstatic.com)
    let pic = '';
    const im = imgBlock.match(/<img[^>]*src="([^"]+)"/i);
    if (im) {
      pic = im[1].replace(/&amp;/g, '&');
      if (pic.startsWith('//')) pic = 'https:' + pic;
    }
    list.push({
      vod_id: href,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: '',
    });
  }
  // Fallback: old pattern for search pages or different layouts
  if (!list.length) {
    const re = /<a href="(\/zh\/videos\/[\w\-]+)">([\s\S]*?)<\/a>/gi;
    while ((m = re.exec(html))) {
      const href = m[1];
      const inner = m[2];
      if (seen[href]) continue;
      const tm = inner.match(/title="([^"]+)"/i);
      const title = tm ? decodeHtml(tm[1]) : '';
      if (!title) continue;
      seen[href] = 1;
      let pic = '';
      const im = inner.match(/<img[^>]*src="([^"]+)"/i);
      if (im) pic = im[1].replace(/&amp;/g, '&');
      list.push({ vod_id: href, vod_name: title, vod_pic: pic, vod_remarks: '' });
    }
  }
  return list;
}

const CATS = {
  'new': { path: '/zh/new-releases', name: '最新' },
  'hot': { path: '/zh/hot', name: '热门' },
  'uncensored': { path: '/zh/uncensored', name: '无码' },
  'censored': { path: '/zh/censored', name: '有码' },
  'subtitle': { path: '/zh/subtitle', name: '字幕' },
  'series': { path: '/zh/series', name: '系列' },
  'studios': { path: '/zh/studios', name: '片商' },
};

// videoSources is embedded as escaped JSON in the detail HTML:
// \"videoSources\":[{\"type\":\"raw_1080p\",\"url\":\"https://static.worldstatic.com/...index.txt?t=...\"},...]
// The index.txt is an AES-128 m3u8 playlist (Content-Type: application/vnd.apple.mpegurl)
const QUALITY_ORDER = ['raw_1080p', 'raw_720p', 'raw_480p', 'raw_240p'];
const QUALITY_NAME = { raw_1080p: '1080P', raw_720p: '720P', raw_480p: '480P', raw_240p: '240P' };

function parseVideoSources(html) {
  const tracks = [];
  if (!html) return tracks;
  const m = html.match(/\\"videoSources\\":\[(.*?)\],\\"/s);
  if (!m) return tracks;
  const seen = {};
  const re = /\\"type\\":\\"([^"\\]+)\\",\\"url\\":\\"([^"\\]+)/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) {
    const type = mm[1];
    if (seen[type]) continue;
    seen[type] = 1;
    tracks.push({ type, url: mm[2].replace(/\\u0026/g, '&') });
  }
  // highest quality first
  tracks.sort((a, b) => {
    const ia = QUALITY_ORDER.indexOf(a.type);
    const ib = QUALITY_ORDER.indexOf(b.type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return tracks;
}

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
    // play: multi-quality direct m3u8 from videoSources (1080P first);
    // fallback to page-URL sniffing if not found
    const tracks = parseVideoSources(html);
    let playUrl;
    if (tracks.length) {
      playUrl = tracks.map((tr) => `${QUALITY_NAME[tr.type] || tr.type}$${tr.url}`).join('#');
    } else {
      playUrl = `播放$${id}`;
    }
    if (!name) continue;
    list.push({
      vod_id: id,
      vod_name: name,
      vod_pic: pic,
      vod_content: desc,
      vod_play_from: 'GetAV',
      vod_play_url: playUrl,
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = t(reqIn?.body?.id);
  if (!id) return { parse: 0, url: '' };
  // id may be "1080P$https://..." full track string; keep only the URL part
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  // direct worldstatic m3u8 -> play directly
  if (/^https?:\/\//i.test(id) && /worldstatic\.com/i.test(id)) {
    return {
      parse: 0,
      url: id,
      header: { Referer: HOST + '/zh', 'User-Agent': UA },
    };
  }
  // fallback: sniff on the video page
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
