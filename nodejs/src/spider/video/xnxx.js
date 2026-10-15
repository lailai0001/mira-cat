// XNXX - CatPawOpen JS Spider (全新重写)
// 多镜像域名兜底: xnxx.health 可能被墙, 依次尝试
// 注意: 本站屏蔽 axios, 使用 Node 原生 fetch

const KEY = 'py_xnxx';
const NAME = 'XNXX';
const HOSTS = [
  'https://xnxx.health',
  'https://www.xnxx.health',
  'https://xnxx.com',
  'https://www.xnxx.com',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FALLBACK_CATS = [
  { type_id: 'teen', type_name: 'Teen' },
  { type_id: 'milf', type_name: 'MILF' },
  { type_id: 'big+ass', type_name: 'Big Ass' },
  { type_id: 'big+tits', type_name: 'Big Tits' },
  { type_id: 'amateur', type_name: 'Amateur' },
  { type_id: 'anal', type_name: 'Anal' },
  { type_id: 'asian', type_name: 'Asian' },
  { type_id: 'bbw', type_name: 'BBW' },
  { type_id: 'bdsm', type_name: 'BDSM' },
  { type_id: 'blonde', type_name: 'Blonde' },
  { type_id: 'blowjob', type_name: 'Blowjob' },
  { type_id: 'brunette', type_name: 'Brunette' },
  { type_id: 'casting', type_name: 'Casting' },
  { type_id: 'creampie', type_name: 'Creampie' },
  { type_id: 'cumshot', type_name: 'Cumshot' },
  { type_id: 'deepthroat', type_name: 'Deepthroat' },
  { type_id: 'ebony', type_name: 'Ebony' },
  { type_id: 'fetish', type_name: 'Fetish' },
  { type_id: 'gangbang', type_name: 'Gangbang' },
  { type_id: 'hardcore', type_name: 'Hardcore' },
  { type_id: 'interracial', type_name: 'Interracial' },
  { type_id: 'japanese', type_name: 'Japanese' },
  { type_id: 'latina', type_name: 'Latina' },
  { type_id: 'lesbian', type_name: 'Lesbian' },
  { type_id: 'mature', type_name: 'Mature' },
  { type_id: 'pov', type_name: 'POV' },
  { type_id: 'public', type_name: 'Public' },
  { type_id: 'redhead', type_name: 'Redhead' },
  { type_id: 'shemale', type_name: 'Shemale' },
  { type_id: 'squirt', type_name: 'Squirt' },
  { type_id: 'threesome', type_name: 'Threesome' },
];

let activeHost = null;

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

async function fetchOne(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!r.ok) return '';
    const t = await r.text();
    return t && t.length > 1000 ? t : '';
  } catch { return ''; }
}

async function getText(path) {
  const hosts = activeHost ? [activeHost, ...HOSTS.filter(h => h !== activeHost)] : HOSTS;
  for (const h of hosts) {
    const t = await fetchOne(h + path);
    if (t) { activeHost = h; return t; }
  }
  return '';
}

function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const h = activeHost || HOSTS[0];
  if (u.startsWith('//')) return 'https:' + u;
  return h + (u.startsWith('/') ? u : '/' + u);
}

function parseList(html) {
  const videos = [];
  if (!html) return videos;
  const blocks = html.match(/<div[^>]*class="[^"]*thumb-block[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g)
    || html.match(/<div[^>]*class="[^"]*thumb-block[^"]*"[^>]*>[\s\S]{0,3000}/g) || [];
  const seen = new Set();
  for (const b of blocks) {
    const am = b.match(/<a[^>]*href="(\/video-[^"]+|\/search-video[^"]*)"/i);
    if (!am) continue;
    const href = am[1];
    if (seen.has(href)) continue;
    seen.add(href);
    // 注意: 避免匹配到 data-preview-src, 用负向后顾
    let pic = '';
    const im = b.match(/(?<![\w-])src="([^"]+)"/i) || b.match(/data-src="([^"]+)"/i);
    if (im) pic = absUrl(im[1]);
    const tm = b.match(/title="([^"]{2,200})"/i);
    const name = tm ? tm[1].trim() : href.split('/').pop().replace(/-/g, ' ');
    const dm = b.match(/class="[^"]*duration[^"]*"[^>]*>([^<]+)</i);
    videos.push({
      vod_id: href,
      vod_name: name.slice(0, 120),
      vod_pic: pic,
      vod_remarks: dm ? dm[1].trim() : '',
    });
    if (videos.length >= 60) break;
  }
  return videos;
}

function extractVideoUrl(html) {
  const patterns = [
    /setVideoUrlHigh\(['"]([^'"]+)['"]\)/,
    /setVideoUrlLow\(['"]([^'"]+)['"]\)/,
    /setVideoUrl\(['"]([^'"]+)['"]\)/,
    /"url"\s*:\s*"([^"]+\.mp4[^"]*)"/,
    /"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].replace(/\\\//g, '/');
  }
  const m = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
  return m ? m[0] : '';
}

async function init() { return {}; }

async function home() {
  const html = await getText('/');
  let cats = [];
  if (html) {
    const seen = new Set();
    const re = /<a[^>]*href="\/tags\/([^"]+)"[^>]*>([^<]{2,40})<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null && cats.length < 40) {
      const tid = m[1].replace(/\/$/, '');
      const name = stripTags(m[2]);
      if (!tid || !name || seen.has(tid)) continue;
      seen.add(tid);
      cats.push({ type_id: tid, type_name: name });
    }
  }
  if (cats.length < 5) cats = FALLBACK_CATS;
  return { class: cats, filters: {}, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'teen');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const url = page === 1 ? `/search/${tid}` : `/search/${tid}?p=${page}`;
  const html = await getText(url);
  const list = parseList(html);
  return { page, pagecount: page + (list.length >= 24 ? 1 : 0), limit: 24, total: list.length, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    let href = String(raw).trim();
    if (!href.startsWith('/')) href = '/' + href;
    const html = await getText(href);
    if (!html) continue;
    const tm = html.match(/<h1[^>]*>([^<]{2,200})<\/h1>/i);
    const name = tm ? stripTags(tm[1]) : href;
    const vurl = extractVideoUrl(html);
    if (!vurl) continue;
    list.push({
      vod_id: href,
      vod_name: name,
      vod_pic: '',
      vod_play_from: 'XNXX',
      vod_play_url: `默认$${vurl}`,
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  if (/\.m3u8|\.mp4/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': activeHost || HOSTS[0] } };
  }
  return { parse: 1, url: id, header: { 'User-Agent': UA } };
}

async function search(reqIn) {
  const wd = String(reqIn?.body?.wd || '').trim();
  const page = Math.max(1, parseInt(reqIn?.body?.page, 10) || 1);
  if (!wd) return { page, pagecount: 0, limit: 24, total: 0, list: [] };
  const url = page === 1 ? `/search/${encodeURIComponent(wd)}` : `/search/${encodeURIComponent(wd)}?p=${page}`;
  const html = await getText(url);
  const list = parseList(html);
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
