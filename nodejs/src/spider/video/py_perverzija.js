// Perverzija Tube - 由 REX 模块 user.perverzija（作者 Tiamo）移植
// 站点 https://tube.perverzija.com；播放链：详情页 iframe -> xtremestream 播放器页取 vt
// -> proto_api castsign 取 ct -> castmaster 生成标准 HLS（变体按 q 分档）+ 自适应兜底
// 注意：VM 侧 castsign 一律返回 forbidden-vt（VM 出口被拦，详情/列表/播放器页均通）；
// 本链路为 REX 原作者实测链路，设备侧能否签发以用户真机为准。
import req from '../../util/req.js';

const KEY = 'py_perverzija';
const NAME = 'Perverzija';
const SITE = 'https://tube.perverzija.com';
const XS = 'https://perv.xtremestream.xyz';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATS = [
  { type_id: '/?orderby=date', type_name: '最新' },
  { type_id: '/?orderby=view', type_name: '最多播放' },
  { type_id: '/?orderby=like', type_name: '最多点赞' },
  { type_id: '/featured-scenes/', type_name: '精选场景' },
  { type_id: '/full-movie/', type_name: '完整影片' },
  { type_id: '/vr/', type_name: 'VR' },
  { type_id: '/studio/brazzers/', type_name: 'Brazzers' },
  { type_id: '/studio/realitykings/', type_name: 'RealityKings' },
  { type_id: '/studio/bangbros/', type_name: 'BangBros' },
  { type_id: '/studio/teamskeet/', type_name: 'TeamSkeet' },
  { type_id: '/studio/naughtyamerica/', type_name: 'NaughtyAmerica' },
  { type_id: '/tag/anal/', type_name: '标签热门' },
];

function t(v) { return String(v == null ? '' : v).trim(); }
function clean(s) {
  return t(s).replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&#8216;|&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, ' ');
}
function H(referer, extra) {
  const h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (referer) h.Referer = referer;
  if (extra) Object.assign(h, extra);
  return h;
}
async function getText(url, referer, extra) {
  const { data } = await req.get(url, { headers: H(referer, extra), timeout: 25000 });
  return typeof data === 'string' ? data : JSON.stringify(data || '');
}

function listingHtml(html) {
  const h = String(html || '');
  let start = h.search(/class="(?:video|search)-listing-content/);
  if (start < 0) start = 0;
  let end = h.length;
  for (const mark of ['wp-pagenavi', 'class="pagination', '<nav class="navigation', 'id="footer', 'class="tm_related', 'related-section']) {
    const j = h.indexOf(mark, start);
    if (j > 0 && j < end) end = j;
  }
  return h.slice(start, end);
}

function parseCards(html) {
  const h = listingHtml(html);
  const out = [];
  const seen = {};
  const starts = [];
  const re = /<div[^>]+class="[^"]*\bvideo-item\b[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(h))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const seg = h.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : Math.min(starts[i] + 6000, h.length));
    const a = seg.match(/<a\s+href="(https:\/\/tube\.perverzija\.com\/[^"\/]+\/)"(?:\s+title="([^"]*)")?/);
    if (!a) continue;
    const url = a[1];
    if (seen[url]) continue;
    const img = seg.match(/<img[^>]+src="([^"]+)"/);
    const h3 = seg.match(/<h3[^>]*>[\s\S]{0,200}?<a[^>]*>([\s\S]{1,300}?)<\/a>/);
    const alt = seg.match(/<img[^>]+alt="([^"]*)"/);
    let title = clean(a[2] || (h3 && h3[1]) || (alt && alt[1]) || '');
    if (!title) title = url.replace(/\/$/, '').split('/').pop().replace(/-/g, ' ');
    const p = seg.match(/<p[^>]*>([\s\S]{20,600}?)<\/p>/);
    let desc = clean(p ? p[1] : '');
    if (!desc || desc.length < 20) desc = '';
    seen[url] = 1;
    out.push({ vod_id: 'perv:' + url, vod_name: title, vod_pic: img ? img[1] : '', vod_remarks: desc.slice(0, 60) });
  }
  return out;
}

function pageUrl(path, page) {
  let p = Math.max(1, parseInt(page, 10) || 1);
  let base = String(path || '/');
  let query = '';
  const qi = base.indexOf('?');
  if (qi >= 0) { query = base.slice(qi); base = base.slice(0, qi); }
  if (base.charAt(0) !== '/') base = '/' + base;
  if (!/\/$/.test(base)) base += '/';
  if (p <= 1) return SITE + base + query;
  return SITE + base + 'page/' + p + '/' + query;
}

function slugifyActor(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function home() {
  let list = [];
  try {
    list = parseCards(await getText(pageUrl('/?orderby=date', 1), SITE + '/'));
  } catch (e) { list = []; }
  return { class: CATS, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(Array.isArray(body.id) ? body.id[0] : body.id || body.tid || '/?orderby=date');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let list = [];
  try {
    list = parseCards(await getText(pageUrl(tid, page), SITE + '/'));
  } catch (e) { list = []; }
  return { page, pagecount: list.length ? page + 1 : page, list };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  if (!kw) return { list: [] };
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = SITE + '/?s=' + encodeURIComponent(kw) + (page > 1 ? '&paged=' + page : '');
  let cards = [];
  try { cards = parseCards(await getText(url, SITE + '/')); } catch (e) {}
  if (!cards.length && /\s/.test(kw) && !/\d/.test(kw)) {
    const slug = slugifyActor(kw);
    if (slug) {
      try { cards = parseCards(await getText(SITE + '/stars/' + slug + '/' + (page > 1 ? 'page/' + page + '/' : ''), SITE + '/')); } catch (e) {}
    }
  }
  return { list: cards };
}

function isoToSec(v) {
  const m = String(v || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
}

async function parseDetail(url) {
  const html = await getText(url, SITE + '/');
  const titleM = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]{1,400}?)<\/h1>/) || html.match(/<title>([\s\S]{1,300}?)<\/title>/);
  const title = clean(titleM ? titleM[1] : '').replace(/\s*\|\s*Perverzija\.com\s*$/i, '');
  const coverM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);
  const descM = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/) || html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/);
  const durM = html.match(/"duration"\s*:\s*"(PT[^"]+)"/);
  const iframeM = html.match(/<iframe[^>]+src="([^"]*xtremestream[^"]*)"/) || html.match(/<iframe[^>]+src="([^"]*\/player\/index\.php\?data=([0-9a-f]{32}))[^"]*"/);
  let videoId = '';
  let embed = '';
  if (iframeM) {
    const src = String(iframeM[1]);
    const idM = src.match(/[?&]data=([0-9a-fA-F]{32})/);
    if (idM) videoId = idM[1].toLowerCase();
    const hostM = src.match(/^(https?:\/\/[^\/]+)/);
    if (hostM) embed = hostM[1];
  }
  if (!videoId) {
    const anyId = html.match(/(?:embedUrl|iframe)[^\n]{0,200}?[?&]data=([0-9a-fA-F]{32})/);
    if (anyId) videoId = anyId[1].toLowerCase();
  }
  return { videoId, embed, title, cover: coverM ? coverM[1] : '', desc: clean(descM ? descM[1] : ''), seconds: durM ? isoToSec(durM[1]) : 0 };
}

// 线路缓存 10 分钟：详情与播放共用，避免重复签发
const STREAM_CACHE = new Map();
const STREAM_TTL = 10 * 60 * 1000;

async function playlistAlive(url, referer) {
  try {
    const raw = await getText(url, referer);
    return raw.indexOf('#EXTM3U') >= 0;
  } catch (e) { return false; }
}

async function resolveStream(url, d) {
  if (!d.videoId) throw new Error('未找到播放器 id，可能影片无源');
  const cached = STREAM_CACHE.get(d.videoId);
  if (cached && Date.now() - cached.t < STREAM_TTL) return cached.lines;
  const bases = [];
  const pushBase = (b) => { if (b && bases.indexOf(b) < 0) bases.push(b); };
  pushBase(d.embed);
  pushBase(XS);
  pushBase('https://pervm1.xtremestream.xyz');
  pushBase('https://pervl5.xtremestream.xyz');
  pushBase('https://pervm2.xtremestream.xyz');
  const playerReferer = url;
  let base = '';
  let vt = '';
  let playerUrl = '';
  let lastErr = '';
  for (const b of bases) {
    const tryUrl = b + '/player/index.php?data=' + d.videoId;
    let page = '';
    try { page = await getText(tryUrl, playerReferer); } catch (e) { lastErr = String(e && e.message || e); continue; }
    const vtM = page.match(/boot\(\s*["']?[0-9a-fA-F]{32}["']?\s*,\s*["']([^"']+)["']/);
    if (vtM) { base = b; vt = String(vtM[1]).replace(/\s+/g, ''); playerUrl = tryUrl; break; }
    lastErr = '该子域无 ftk 令牌';
  }
  if (!vt) throw new Error('播放器页未返回 vt 令牌' + (lastErr ? '：' + lastErr : ''));
  const apiBase = base + '/player/proto_api.php?data=' + d.videoId;
  const vtParam = '&vt=' + encodeURIComponent(vt);
  const signResp = await getText(apiBase + '&op=castsign' + vtParam, playerUrl, { 'X-XS-P': '1', 'Accept': '*/*' });
  const ct = String(signResp || '').replace(/\s+/g, '');
  if (!ct || ct.indexOf('forbidden') === 0) throw new Error('castsign 签名失败');
  const cm = apiBase + vtParam + '&ct=' + encodeURIComponent(ct) + '&op=castmaster';
  const autoLine = { name: '自动', desc: '自适应', url: cm };
  let master = '';
  try { master = await getText(cm, playerUrl, { 'X-XS-P': '1', 'Accept': '*/*' }); } catch (e) {}
  let quals = [];
  const re = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)[^\n]*\n(\S+)/g;
  let mm;
  while ((mm = re.exec(master))) {
    const lineUrl = String(mm[3]).trim();
    const qm = lineUrl.match(/[?&]q=(\d+)/);
    if (!qm) continue;
    quals.push({ q: qm[1], label: qm[1] + 'p', url: lineUrl });
  }
  if (!quals.length) {
    for (const fl of ['1080', '720', '480']) {
      quals.push({ q: fl, label: fl + 'p', url: apiBase + vtParam + '&ct=' + encodeURIComponent(ct) + '&op=castmedia&q=' + fl });
    }
  }
  quals.sort((a, b) => parseInt(b.q, 10) - parseInt(a.q, 10));
  const lines = [];
  for (const q of quals) {
    if (!(await playlistAlive(q.url, playerUrl))) continue;
    lines.push({ name: q.label, desc: q.label, url: q.url });
  }
  lines.push(autoLine);
  if (STREAM_CACHE.size > 100) STREAM_CACHE.delete(STREAM_CACHE.keys().next().value);
  STREAM_CACHE.set(d.videoId, { t: Date.now(), lines });
  return lines;
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const url = id.replace(/^perv:/, '');
  if (!url) return { list: [] };
  let d;
  try { d = await parseDetail(url); } catch (e) { return { list: [] }; }
  let playFrom = [];
  let playUrls = [];
  try {
    const lines = await resolveStream(url, d);
    if (lines.length) {
      playFrom.push('Perverzija');
      playUrls.push(lines.map(l => l.name + '$' + l.url).join('#'));
    }
  } catch (e) { /* 无播放线时只出详情，播放失败原因不写进标题 */ }
  return {
    list: [{
      vod_id: 'perv:' + url,
      vod_name: d.title || url,
      vod_pic: d.cover,
      vod_remarks: d.desc.slice(0, 80),
      vod_play_from: playFrom.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const idx = id.indexOf('$');
  let url = idx >= 0 ? id.slice(idx + 1) : id;
  url = t(url);
  if (!url) return { parse: 0, url: '' };
  return { parse: 0, url, header: { 'User-Agent': UA, 'Referer': SITE + '/' } };
}

export default function createSpider() {
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
