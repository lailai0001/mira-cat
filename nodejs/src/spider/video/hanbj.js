// 韩国BJ - CatPawOpen JS Spider
// Ported from KoreanBJ.py (HOST=https://ww1.koreanbj.club)
// 列表: loop-video /video/slug/
// 播放: VOE 系 embed → 六层混淆解包 → m3u8/mp4 直出
// 注：本站屏蔽 axios，统一使用 Node 原生 fetch

const KEY = 'py_hanbj';
const NAME = '韩国BJ';
const HOST = 'https://ww1.koreanbj.club';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CHANNELS = {
  home: { name: '最新', path: '/' },
  'korean-bj': { name: 'Korean BJ', path: '/category/korean-bj/' },
  pandatv: { name: 'PandaTV', path: '/category/pandatv/' },
  onlyfans: { name: 'OnlyFans', path: '/category/onlyfans/' },
  amateur: { name: 'Amateur', path: '/category/amateur-porn/' },
  kpop: { name: 'Kpop Deepfake', path: '/category/kpop-deepfake/' },
  twitch: { name: 'Twitch', path: '/category/twitch/' },
  premium: { name: 'Premium', path: '/category/premium/' },
  stripchat: { name: 'Stripchat', path: '/category/stripchat/' },
  fantrie: { name: 'Fantrie', path: '/category/fantrie/' },
  nude: { name: 'Nude', path: '/category/nude/' },
  pov: { name: 'POV', path: '/category/pov/' },
};

function t(v) {
  return String(v == null ? '' : v).trim();
}

function headers(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': referer || HOST + '/',
  };
}

function absUrl(u, base) {
  const raw = t(u).replace(/\\\//g, '/').replace(/&amp;/g, '&');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  try {
    return new URL(raw, base || HOST).toString();
  } catch {
    return raw;
  }
}

async function getText(url, referer) {
  // 注：本站会 RST axios 的 TLS 连接，改用 Node 原生 fetch
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 22000);
    const r = await fetch(url, {
      headers: headers(referer),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return '';
    return t(await r.text());
  } catch {
    return '';
  }
}

function parseList(html) {
  const videos = [];
  if (!html) return videos;
  const seen = new Set();
  const blocks = html.match(/(?:<article[^>]*)?class="[^"]*loop-video[^"]*"[\s\S]{0,1200}/gi) || [];
  for (const block of blocks) {
    const lm = block.match(/href="(https?:\/\/[^"]+\/video\/[^"]+|\/video\/[^"]+)"[^>]*(?:title="([^"]*)")?/i);
    if (!lm) continue;
    const vodId = absUrl(lm[1].split('?')[0]);
    if (!vodId || seen.has(vodId)) continue;
    seen.add(vodId);
    let name = t(lm[2]);
    if (!name) {
      const tm = block.match(/title="([^"]+)"/);
      name = tm ? t(tm[1]) : vodId.replace(/\/$/, '').split('/').pop();
    }
    name = name.replace(/\s*[–\-]\s*KoreanBJ.*$/i, '').replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim();
    let pic = '';
    const imgRe = /(?:data-src|src)="([^"]+)"/gi;
    let pm;
    while ((pm = imgRe.exec(block)) !== null) {
      const p = pm[1];
      if (/placeholder/i.test(p)) continue;
      if (/\.(jpg|jpeg|png|webp)/i.test(p) || /upload/i.test(p)) {
        pic = absUrl(p);
        break;
      }
    }
    videos.push({
      vod_id: vodId,
      vod_name: name.replace(/\s+/g, ' ').slice(0, 120),
      vod_pic: pic,
      vod_remarks: 'KoreanBJ',
    });
  }
  return videos;
}

// ---------- VOE 解包 (对齐 SupJav) ----------
function rot13(s) {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function b64d(x) {
  try {
    let s = String(x).replace(/[^A-Za-z0-9+/=]/g, '');
    s += '='.repeat((-s.length % 4 + 4) % 4);
    return Buffer.from(s, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function voeDecode(html) {
  try {
    const m = String(html || '').match(/<script[^>]*type=["']application\/json["'][^>]*>(.*?)<\/script>/s);
    if (!m) return {};
    const blk = t(m[1]);
    let raw = blk;
    try {
      const j = JSON.parse(blk);
      raw = Array.isArray(j) && j.length ? String(j[0]) : blk;
    } catch {
      raw = blk;
    }
    let s = String(raw);
    for (const k of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) {
      s = s.split(k).join('_');
    }
    s = s.split('_').join('');
    // 六层：rot13 → b64 → 每字符-3 → b64(反转)
    let tt = b64d(rot13(s));
    tt = [...tt].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join('');
    tt = b64d([...tt].reverse().join(''));
    const cfg = JSON.parse(tt);
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

function extractEmbedUrls(html, pageUrl) {
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    u = absUrl(u, pageUrl);
    if (!u || seen.has(u) || !u.startsWith('http')) return;
    if (/koreanbj\.club/i.test(u) && /\/video\//i.test(u) && !/\/e\//i.test(u)) return;
    if (/googletag|\/ads\/|placeholder|\/trailers\/|test-videos/i.test(u)) return;
    if (/\.webm$/i.test(u)) return;
    seen.add(u);
    urls.push(u);
  };
  const h = String(html || '');
  let m;
  const re1 = /"contentURL"\s*:\s*"([^"]+)"/g;
  while ((m = re1.exec(h)) !== null) add(m[1].replace(/\\\//g, '/'));
  const re2 = /iframe\.setAttribute\(\s*['"]src['"]\s*,\s*['"]([^'"]+)['"]/g;
  while ((m = re2.exec(h)) !== null) add(m[1]);
  const re3 = /<iframe[^>]+(?:src|data-src)=["']([^"']+)/gi;
  while ((m = re3.exec(h)) !== null) add(m[1]);
  const re4 = /https?:\/\/(?:[a-z0-9\-]+\.)?(?:voe|io\d+storege|streamtape|filemoon)[^"'\s<>]+/gi;
  while ((m = re4.exec(h)) !== null) add(m[0]);
  return urls;
}

async function resolveVoe(embedUrl, referer) {
  const html = await getText(embedUrl, referer || HOST + '/');
  if (!html) return { m3u8: '', direct: '' };
  const hits = html.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g) || [];
  if (hits.length && !/test-videos/i.test(hits[0])) return { m3u8: hits[0], direct: '' };
  // JW Player file: 字段（master.txt 实为 m3u8）
  const jw = html.match(/jwplayer\([^)]*\)\.setup\(\{\s*file:\s*"([^"]+)"/i);
  if (jw) {
    const f = jw[1].replace(/\\\//g, '/');
    if (/^https?:\/\//i.test(f)) return { m3u8: f, direct: '' };
  }
  const cfg = voeDecode(html);
  const src = t(cfg.source);
  if (/\.m3u8/i.test(src) || /^https?:\/\//i.test(src)) {
    if (/\.m3u8/i.test(src)) return { m3u8: src, direct: '' };
  }
  const dau = t(cfg.direct_access_url);
  if (/^https?:\/\//i.test(dau)) return { m3u8: '', direct: dau };
  if (/^https?:\/\//i.test(src)) return { m3u8: '', direct: src };
  return { m3u8: '', direct: '' };
}

// ---------- CatPawOpen API ----------
async function init() {
  return {};
}

async function home() {
  const cls = Object.entries(CHANNELS).map(([k, v]) => ({
    type_id: k,
    type_name: v.name,
  }));
  return { class: cls, filters: {}, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.id) || 'home';
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  const info = CHANNELS[tid] || CHANNELS.home;
  const path = info.path;
  let url;
  if (path === '/') {
    url = pg === 1 ? HOST + '/' : HOST + '/page/' + pg + '/';
  } else {
    url = HOST + path;
    if (pg > 1) url = url.replace(/\/$/, '') + '/page/' + pg + '/';
  }
  let html = await getText(url);
  if (!html) html = await getText(url);
  const videos = parseList(html);
  const pages = [...(html.matchAll(/\/page\/(\d+)\//g))].map((x) => parseInt(x[1], 10));
  const pagecount = videos.length ? Math.max(pg, ...pages) : pg;
  return {
    list: videos,
    page: pg,
    pagecount,
    limit: 24,
    total: pagecount * Math.max(videos.length, 1),
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    let url = t(raw);
    if (!/^https?:\/\//i.test(url)) url = absUrl(url);
    const html = await getText(url);
    if (!html) {
      list.push({ vod_id: url, vod_name: 'KoreanBJ' });
      continue;
    }
    let name = '';
    const tm = html.match(/<title>([^<]+)/i);
    if (tm) {
      name = t(tm[1]).replace(/\s*[|\\-–].*$/, '').replace(/&#8211;/g, '-');
    }
    let pic = '';
    const om = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i);
    if (om) pic = absUrl(om[1], url);

    const embeds = extractEmbedUrls(html, url);
    const plays = [];
    for (const emb of embeds) {
      const { m3u8, direct } = await resolveVoe(emb, url);
      if (m3u8) plays.push(['HLS', m3u8]);
      if (direct) plays.push(['MP4', direct]);
      if (!m3u8 && !direct) plays.push(['Embed', emb]);
    }
    if (!plays.length) plays.push(['原页', url]);

    const seen = new Set();
    const uniq = [];
    for (const [n, u] of plays) {
      if (seen.has(u)) continue;
      seen.add(u);
      uniq.push(n + '$' + u);
    }
    list.push({
      vod_id: url,
      vod_name: name || 'KoreanBJ',
      vod_pic: pic,
      vod_remarks: '',
      vod_content: '',
      vod_play_from: 'KoreanBJ',
      vod_play_url: uniq.join('#'),
    });
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  const flag = t(body.flag);
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  const header = { 'User-Agent': UA, Referer: HOST + '/' };
  if (/^\/\//.test(id)) id = 'https:' + id;

  // HLS 直链（含 master.txt 伪装的 m3u8）
  if (/\.(m3u8|mp4)(\?|$)/i.test(id) || /master\.txt/i.test(id) || /^hls$/i.test(flag)) {
    if (/cloudwindow-route|ugc-cdn/i.test(id)) {
      header.Referer = 'https://jeremyparticipantanything.com/';
    }
    return { parse: 0, jx: 0, url: id, header };
  }

  if (/^https?:\/\//i.test(id) && (/\/e\//i.test(id) || /embed/i.test(id))) {
    const { m3u8, direct } = await resolveVoe(id, HOST + '/');
    if (m3u8) {
      header.Referer = id;
      return { parse: 0, jx: 0, url: m3u8, header };
    }
    if (direct) {
      header.Referer = id;
      return { parse: 0, jx: 0, url: direct, header };
    }
    return { parse: 1, jx: 0, url: id, header };
  }

  return { parse: 1, jx: 0, url: id, header };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page: pg, pagecount: pg, limit: 24, total: 0, list: [] };
  const kw = encodeURIComponent(wd);
  const url = pg === 1 ? HOST + '/?s=' + kw : HOST + '/page/' + pg + '/?s=' + kw;
  const html = await getText(url);
  const list = parseList(html);
  return { list, page: pg, pagecount: pg + 1, limit: 24, total: 9999 };
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
