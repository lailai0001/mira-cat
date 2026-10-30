// Javtiful - CatPawOpen JS Spider（2026-10-30 新源）
// 站点：https://javtiful.com/（点播站；首页重定向到 /main）
// 结构（2026-10-30 VM 全链实测）：
//  - 列表：卡片链接 /video/{id}/{slug}；分类 /category/{slug}；
//    分类（首页导航实测 9 个）：affair, amateur, beautiful-girl, big-tits,
//    drama, married-woman, mature-woman, office-lady, school-girls。
//  - 封面：详情 og:image = https://javtiful.com/uploads/uploads/videos/thumbs/…jpg；
//    列表卡片 img 的 data-src/src 同源。
//  - 播放（关键：票据时效约 30 分钟，play 时必须现取现投）：
//    详情页内联 JSON 含 "playback":{"endpoint":"/video/{id}/playback",
//    "ticket":"p1.{id}.0.{ts}.{hash}…"}；POST 该 endpoint，
//    body ticket=<ticket>，头 X-Requested-With: XMLHttpRequest + Referer embed 页，
//    返回 {"success":true,"sources":[{"src":"https://vXXXX.jav.si/hls/…/index.m3u8",
//    "type":"application/vnd.apple.mpegurl","fallbackSrc":"https://vXXXX.jav.si/p/…",
//    "size":720,"label":"720p"}],"defaultQuality":720}。
//    sources 有几档清晰度就列几条线（label/size），另附一条 MP4（fallbackSrc）。
import req from '../../util/req.js';

const KEY = 'py_javtiful';
const NAME = 'Javtiful';
const HOST = 'https://javtiful.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || HOST + '/',
  };
}

async function getText(url, referer) {
  try {
    const { data } = await req.get(url, { headers: H(referer), timeout: 15000 });
    return String(data || '');
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function absUrl(href) {
  href = String(href || '').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return HOST + href;
  return HOST + '/' + href;
}

function imgOf(block) {
  const clean = block.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const m = clean.match(/<img[^>]*>/gi);
  if (m) {
    for (const tag of m) {
      const sm = tag.match(/(?:data-src|data-original|src)\s*=\s*"([^"]+)"/i);
      if (sm && /^https?:\/\//i.test(sm[1]) && !/data:image/i.test(sm[1])) return sm[1];
      const sm2 = tag.match(/(?:data-src|data-original|src)\s*=\s*"([^"]+)"/i);
      if (sm2 && sm2[1].startsWith('/')) return HOST + sm2[1];
    }
  }
  return '';
}

// 卡片：<a href="/video/{id}/{slug}">…img…标题…</a>
function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<a[^>]*href="(\/video\/\d+\/[^"]+)"[^>]*>([\s\S]{0,1200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const inner = m[2];
    let title = '';
    const am = inner.match(/<img[^>]*alt="([^"]+)"/i);
    if (am) title = stripTags(am[1]).replace(/^Thumbnail for\s+/i, '');
    if (!title) title = stripTags(inner);
    if (!title || title.length < 2) continue;
    items.push({ vod_id: absUrl(href), vod_name: title, vod_pic: imgOf(inner), vod_remarks: '' });
    if (items.length >= 60) break;
  }
  return items;
}

const CATS = [
  { type_id: '/category/affair/', type_name: '偷情' },
  { type_id: '/category/amateur/', type_name: '素人' },
  { type_id: '/category/beautiful-girl/', type_name: '美少女' },
  { type_id: '/category/big-tits/', type_name: '巨乳' },
  { type_id: '/category/drama/', type_name: '剧情' },
  { type_id: '/category/married-woman/', type_name: '人妻' },
  { type_id: '/category/mature-woman/', type_name: '熟女' },
  { type_id: '/category/office-lady/', type_name: 'OL' },
  { type_id: '/category/school-girls/', type_name: '校园' },
];

async function init() { return {}; }

async function home() {
  const html = await getText(HOST + '/main', HOST + '/');
  return { class: CATS, filters: {}, list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!tid) tid = '/category/amateur/';
  const base = /^https?:\/\//i.test(tid) ? tid.replace(/\/+$/, '') : HOST + '/' + tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/?page=' + page);
  const html = await getText(url, HOST + '/');
  const list = parseCards(html);
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}

async function fetchPlayback(durl, html) {
  // 详情页内联 JSON： "playback":{"endpoint":"…","ticket":"…"}
  const pm = html.match(/"playback"\s*:\s*\{\s*"endpoint"\s*:\s*"([^"]+)"\s*,\s*"ticket"\s*:\s*"([^"]+)"/i);
  if (!pm) return null;
  const endpoint = pm[1].startsWith('http') ? pm[1] : HOST + pm[1];
  const ticket = pm[2];
  const embedMatch = html.match(/"embedUrl"\s*:\s*"([^"]+)"/i);
  const referer = embedMatch ? embedMatch[1] : durl;
  try {
    const { data } = await req.post(endpoint, 'ticket=' + encodeURIComponent(ticket), {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
      },
      timeout: 15000,
    });
    const j = typeof data === 'string' ? JSON.parse(data) : data;
    if (j && j.success && Array.isArray(j.sources) && j.sources.length) return j.sources;
  } catch {}
  return null;
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const durl = /^https?:\/\//i.test(raw) ? raw : HOST + (String(raw).startsWith('/') ? raw : '/' + raw);
    const html = await getText(durl, HOST + '/');
    const hm = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i);
    const title = hm ? stripTags(hm[1]) : 'Javtiful';
    const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const pic = ogm ? ogm[1] : '';
    const em = html.match(/"embedUrl"\s*:\s*"([^"]+)"/i);
    const embedUrl = em ? em[1] : '';
    let playUrl = '';
    const sources = await fetchPlayback(durl, html);
    if (sources) {
      const lines = [];
      for (const s of sources) {
        if (!s.src) continue;
        const label = s.label || (s.size ? s.size + 'p' : '播放');
        lines.push(label + '$' + s.src);
      }
      const fb = sources.find(s => s.fallbackSrc);
      if (fb) lines.push('MP4$' + fb.fallbackSrc);
      if (lines.length) playUrl = lines.join('#');
    }
    if (!playUrl) playUrl = '网页播放$' + (embedUrl || durl);
    list.push({ vod_id: raw, vod_name: title, vod_pic: pic, vod_play_from: NAME, vod_play_url: playUrl });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  return {
    parse: isVideo ? 0 : 1,
    url: id,
    header: { 'User-Agent': UA, 'Referer': HOST + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const url = HOST + '/search?q=' + encodeURIComponent(wd) + (page > 1 ? '&page=' + page : '');
  const html = await getText(url, HOST + '/');
  const list = parseCards(html);
  return { page, pagecount: 9999, limit: 90, total: list.length, list };
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
