// XNXX - CatPawOpen JS Spider
// Ported from xnxx.py (HOST=https://xnxx.health)
// 列表: .thumb-block ; 详情: setVideoUrlHigh/Low ; 播放: 直链 mp4/m3u8
const KEY = 'py_xnxx';
const NAME = 'XNXX';
// 多个镜像域名, 哪个通走哪个 (xnxx.health 在部分网络下可能被墙)
const HOSTS = ['https://xnxx.health', 'https://www.xnxx.health', 'https://xnxx.com', 'https://www.xnxx.com'];
const HOST = HOSTS[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FALLBACK_CATS = [
  ['teen', 'Teen'], ['milf', 'MILF'], ['big+ass', 'Big Ass'], ['big+tits', 'Big Tits'],
  ['amateur', 'Amateur'], ['anal', 'Anal'], ['asian', 'Asian'], ['bbw', 'BBW'],
  ['bdsm', 'BDSM'], ['blonde', 'Blonde'], ['blowjob', 'Blowjob'], ['brunette', 'Brunette'],
  ['casting', 'Casting'], ['creampie', 'Creampie'], ['cumshot', 'Cumshot'],
  ['deepthroat', 'Deepthroat'], ['ebony', 'Ebony'], ['fetish', 'Fetish'],
  ['gangbang', 'Gangbang'], ['hardcore', 'Hardcore'], ['interracial', 'Interracial'],
  ['latina', 'Latina'], ['lesbian', 'Lesbian'], ['masturbation', 'Masturbation'],
  ['mature', 'Mature'], ['pov', 'POV'], ['public', 'Public'], ['redhead', 'Redhead'],
  ['rough', 'Rough'], ['squirt', 'Squirt'], ['threesome', 'Threesome'],
  ['japanese', 'Japanese'], ['chinese', 'Chinese'], ['korean', 'Korean'],
  ['homemade', 'Homemade'], ['verified', 'Verified Amateurs'],
];

function H() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': HOST + '/',
  };
}

function toTryUrls(url) {
  // 把 URL 的域名依次换成各个镜像域名, 哪个通走哪个
  const urls = [];
  const m = String(url || '').match(/^https?:\/\/[^/]+(\/.*)?$/i);
  const path = m ? (m[1] || '/') : String(url || '');
  for (const h of HOSTS) {
    const u = h + path;
    if (!urls.includes(u)) urls.push(u);
  }
  if (!urls.includes(url)) urls.unshift(url);
  return urls;
}

async function fetchOnce(url, cookie) {
  // 注: 本站屏蔽 axios 的 TLS 指纹, 必须用 Node 原生 fetch
  const headers = H();
  if (cookie) headers['Cookie'] = cookie;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch(url, { headers, signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const t = await r.text();
      if (t && t.length > 1000) return t;
    }
    // 403 JS cookie 挑战: 提取 document.cookie="..." 后重试
    if (r.status === 403) {
      const html = await r.text();
      const m = html.match(/document\.cookie\s*=\s*"([^"]+)"/);
      if (m) {
        const nv = m[1].split(';')[0].trim();
        const ctl2 = new AbortController();
        const timer2 = setTimeout(() => ctl2.abort(), 25000);
        const r2 = await fetch(url, { headers: { ...headers, 'Cookie': nv }, signal: ctl2.signal });
        clearTimeout(timer2);
        if (r2.ok) {
          const t2 = await r2.text();
          if (t2 && t2.length > 1000) return t2;
        }
      }
    }
  } catch {}
  return '';
}

async function getText(url, cookie) {
  for (const u of toTryUrls(url)) {
    const t = await fetchOnce(u, cookie);
    if (t) return t;
  }
  return '';
}

function parseList(html) {
  const out = [];
  const blocks = String(html || '').match(/<div[^>]*class="[^"]*thumb-block[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*thumb-block|$)/gi) || [];
  for (const b of blocks) {
    const am = b.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!am) continue;
    let href = am[1].trim();
    if (!href || !(/\/(video-|search-video\/)/.test(href))) continue;
    if (/^https?:\/\//i.test(href)) href = href.replace(HOST, '');
    if (!href.startsWith('/')) href = '/' + href;
    const imgm = b.match(/<img[^>]*?(?:data-src|src)="([^"]+)"/i);
    let name = '';
    const ams = b.match(/<a[^>]*>([^<]{8,140})<\/a>/gi) || [];
    for (const a of ams) {
      const tx = a.replace(/<[^>]+>/g, '').trim();
      if (tx && tx.length >= 8 && !/^https?:\/\//.test(tx)) { name = tx; break; }
    }
    if (!name) {
      const tm = b.match(/title="([^"]{8,140})"/i);
      if (tm) name = tm[1].trim();
    }
    const dm = b.match(/<span[^>]*class="[^"]*(?:duration|time)[^"]*"[^>]*>([^<]{1,10})</i);
    out.push({
      vod_id: href,
      vod_name: name,
      vod_pic: imgm ? imgm[1].replace(/\\/g, '') : '',
      vod_remarks: dm ? dm[1].trim() : '',
    });
    if (out.length >= 40) break;
  }
  return out;
}

function pagecountOf(html, pg) {
  const ms = String(html || '').match(/[?&]p=(\d+)/gi) || [];
  let max = pg;
  for (const s of ms) {
    const n = parseInt(s.match(/(\d+)/)[1], 10);
    if (n > max) max = n;
  }
  return max;
}

function extractVideoUrl(html) {
  const pats = [
    /setVideoUrlHigh\(\s*['"]([^'"]+)['"]\s*\)/i,
    /setVideoUrlLow\(\s*['"]([^'"]+)['"]\s*\)/i,
    /setVideoUrl\(\s*['"]([^'"]+)['"]\s*\)/i,
    /var\s+video_url\s*=\s*['"]([^'"]+)['"]/i,
    /"url"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
    /"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i,
    /(https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*)/i,
    /(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/i,
  ];
  for (const p of pats) {
    const m = String(html || '').match(p);
    if (m) {
      const u = m[1].replace(/\\\//g, '/');
      if (/\.(mp4|m3u8)/i.test(u)) return u;
    }
  }
  return '';
}

let _catsCache = null;
async function getCats() {
  if (_catsCache) return _catsCache;
  const html = await getText(HOST);
  const cats = [];
  const seen = new Set();
  const re = /<a[^>]*href="\/(?:tags|search|best)\/([^\/?&"]+)"[^>]*>([^<]{1,30})<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tid = decodeURIComponent(m[1]).replace(/\+/g, ' ');
    const name = m[2].trim();
    if (!tid || !name || seen.has(tid)) continue;
    seen.add(tid);
    cats.push([m[1], name]);
    if (cats.length >= 60) break;
  }
  _catsCache = cats.length ? cats : FALLBACK_CATS;
  return _catsCache;
}

async function init() { return {}; }

async function home() {
  const cats = await getCats();
  const cls = cats.map(([id, name]) => ({ type_id: id, type_name: name }));
  const filters = {};
  for (const [id] of cats) filters[id] = {};
  return { class: cls, filters, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || body.tid || 'teen');
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  const url = pg > 1 ? `${HOST}/search/${tid}?p=${pg}` : `${HOST}/search/${tid}`;
  const html = await getText(url);
  const list = parseList(html);
  const pagecount = pagecountOf(html, pg);
  return { page: pg, pagecount: list.length ? Math.max(pagecount, pg) : pg, limit: list.length || 24, total: 0, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  let vid = String(ids[0] || '');
  if (!vid) return { list: [] };
  if (!vid.startsWith('/')) vid = '/' + vid;
  const url = /^https?:\/\//i.test(vid) ? vid : HOST + vid;
  const html = await getText(url);
  if (!html) return { list: [] };
  let name = '';
  let m = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (m) name = m[1].trim();
  const picm = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  const vurl = extractVideoUrl(html);
  return {
    list: [{
      vod_id: vid,
      vod_name: name,
      vod_pic: picm ? picm[1] : '',
      vod_play_from: '默认线路',
      vod_play_url: vurl ? '正片$' + vurl : '',
    }],
  };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/^https?:\/\/.*\.(m3u8|mp4)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  if (!id.startsWith('/')) id = '/' + id;
  const url = /^https?:\/\//i.test(id) ? id : HOST + id;
  const html = await getText(url);
  const vurl = extractVideoUrl(html);
  if (vurl) return { parse: 0, url: vurl, header: { 'User-Agent': UA, 'Referer': url } };
  return { parse: 1, url };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { list: [] };
  const q = encodeURIComponent(wd);
  const url = pg > 1 ? `${HOST}/search/${q}?p=${pg}` : `${HOST}/search/${q}`;
  const html = await getText(url);
  const list = parseList(html);
  return { page: pg, pagecount: pagecountOf(html, pg), limit: list.length || 24, total: 0, list };
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
