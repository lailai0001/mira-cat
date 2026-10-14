// 八卦 - CatPawOpen 格式
// 转换自 REX forward.bagua，站点 https://www.mrds66.com（WordPress）
// 封面为 AES 加密存储，走 bagua-img-proxy 解密代理出图
import req from '../../util/req.js';

const KEY = 'py_bagua';
const NAME = '八卦';
const BASE_URL = 'https://www.mrds66.com';
const IMG_PROXY = 'https://bagua-img-proxy.li768435813.workers.dev/img?url=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const CATS = [
  { type_id: 'xazd', type_name: '默认' },
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

// 封面走解密代理
function proxyCover(url) {
  url = t(url);
  if (!url) return '';
  if (url.indexOf('data:') === 0) return url;
  // 已经是代理地址则直接返回
  if (url.indexOf('bagua-img-proxy') >= 0) return url;
  return IMG_PROXY + encodeURIComponent(absUrl(url, BASE_URL));
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
  const path = page === 1 ? `/category/${id}/` : `/category/${id}/${page}/`;
  const html = await fetchHtml(BASE_URL + path);
  const list = parseList(html);
  return { page, pagecount: page, list };
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
  return { page, pagecount: page, list };
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
