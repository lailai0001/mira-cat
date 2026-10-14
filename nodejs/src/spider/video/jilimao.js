// 吉利猫 - CatPawOpen JS Spider
// Ported from 2-3.py (HOST=https://jlm7.cc, AppleCMS 改版站)
// 列表: <li><div class="video-item"> ; 详情: /index.php/vod/play/id/{id}.html
// 播放: 播放页 const source / m3u8 / mp4 直出, 否则嗅探
const KEY = 'py_jilimao';
const NAME = '吉利猫';
const HOST = 'https://jlm7.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FALLBACK_CATS = [
  ['46', '日韩自拍'], ['43', '色情主播'], ['44', '国产av'], ['59', '乱伦侵犯'],
  ['47', '日本无码'], ['50', '无码字幕'], ['49', '色情动漫'], ['48', '有码字幕'],
  ['51', '欧美av'], ['52', '18禁重口味'], ['53', '偷拍偷窥'], ['54', '网爆吃瓜'],
  ['55', '传媒a片'], ['56', '探花约炮'], ['57', '三级伦理'], ['58', 'av解说'],
];
const SORTS = [
  { n: '最新', v: 'time' }, { n: '最热', v: 'hits' }, { n: '日榜', v: 'hits_day' },
  { n: '周榜', v: 'hits_week' }, { n: '月榜', v: 'hits_month' }, { n: '评分', v: 'score' },
];

function H() {
  return { 'User-Agent': UA, 'Referer': HOST + '/', 'Accept': 'text/html,application/xhtml+xml' };
}

async function getText(url) {
  // 注: 本站屏蔽 axios 的 TLS 指纹, 必须用 Node 原生 fetch
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { headers: H(), signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return '';
    return await r.text();
  } catch { return ''; }
}

function fix(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return HOST + u;
  return u;
}

function unesc(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}

function parseList(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').match(/<li>\s*<div class="video-item">[\s\S]*?<\/li>/gi) || [];
  for (const b of blocks) {
    const m = b.match(/href="[^"]*?\/vod\/play\/id\/(\d+)\.html"/i);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    let title = '';
    const img = b.match(/<img[^>]*data-src="([^"]+)"[^>]*alt="([^"]*)"/i);
    if (img) title = unesc(img[2]);
    if (!title) {
      const t = b.match(/class="line-clamp-[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/i);
      if (t) title = unesc(t[1]);
    }
    let pic = img ? fix(img[1]) : '';
    if (!pic) {
      const p2 = b.match(/og:image" content="([^"]+)"/i);
      if (p2) pic = fix(p2[1]);
    }
    const rem = b.match(/rounded-large text-white">([^<]+)<\/div>/i);
    out.push({
      vod_id: m[1],
      vod_name: title,
      vod_pic: pic,
      vod_remarks: rem ? rem[1].trim() : '',
    });
  }
  return out;
}

function pagecountOf(html, pg) {
  if (!html || !/class="video-item"/.test(html)) return pg > 1 ? pg : 1;
  if (/title="下一页"/.test(html)) return pg + 1;
  return pg;
}

// 解析 /index.php/label/sort.html 得到动态分类(可能比内置 16 个更多)
function parseSortPage(html) {
  let parents = [];
  const children = {};
  const parts = String(html || '').split(/<h2[^>]*>([^<]+)<\/h2>/i);
  for (let i = 1; i < parts.length; i += 2) {
    const pname = unesc(parts[i]);
    const subs = [];
    const re = /href="\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)</gi;
    let m;
    while ((m = re.exec(parts[i + 1] || '')) !== null) subs.push([m[1], unesc(m[2])]);
    if (!subs.length) continue;
    if (pname === '视频类别') parents = subs;
    else children[pname] = subs;
  }
  if (!parents.length) parents = FALLBACK_CATS;
  return { parents, children };
}

let _catsCache = null;
async function getCats() {
  if (_catsCache) return _catsCache;
  const html = await getText(HOST + '/index.php/label/sort.html');
  const { parents, children } = parseSortPage(html);
  const classes = parents.map(([tid, name]) => ({ type_id: tid, type_name: name }));
  const filters = {};
  for (const [tid, pname] of parents) {
    const f = [{ key: 'by', name: '排序', value: SORTS }];
    const subs = children[pname] || [];
    if (subs.length) {
      f.unshift({
        key: 'sub', name: '子分类',
        value: [{ n: '全部', v: '' }, ...subs.map(([stid, n]) => ({ n, v: stid }))],
      });
    }
    filters[tid] = f;
  }
  _catsCache = { classes, filters };
  return _catsCache;
}

async function init() { return {}; }

async function home() {
  const { classes, filters } = await getCats();
  const list = parseList(await getText(HOST + '/'));
  return { class: classes, filters, list };
}

async function homeVod() {
  return { list: parseList(await getText(HOST + '/')) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || body.tid || '');
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  let f = {};
  try { f = typeof body.filter === 'string' ? JSON.parse(body.filter) : (body.filter || {}); } catch {}
  try { const e = typeof body.extend === 'string' ? JSON.parse(body.extend) : (body.extend || {}); f = { ...f, ...e }; } catch {}
  const cur = /^\d+$/.test(String(f.sub || '')) ? String(f.sub) : tid;
  const by = String(f.by || '');
  let url;
  if (by && /^[a-z_0-9]+$/.test(by)) {
    url = `${HOST}/index.php/vod/show/id/${cur}/by/${by}/page/${pg}.html`;
  } else {
    url = `${HOST}/index.php/vod/type/id/${cur}/page/${pg}.html`;
  }
  const html = await getText(url);
  const list = parseList(html);
  const pagecount = pagecountOf(html, pg);
  return { page: pg, pagecount: list.length ? pagecount : pg, limit: 20, total: 0, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const raw = String(ids[0] || '');
  const m0 = raw.match(/(\d+)/);
  const vid = m0 ? m0[1] : '';
  if (!vid) return { list: [] };
  const html = unesc(await getText(`${HOST}/index.php/vod/play/id/${vid}.html`));
  let name = '';
  let m = html.match(/<h1 class="dx-title[^"]*"[^>]*>([^<]+)<\/h1>/i);
  if (m) name = unesc(m[1]);
  if (!name) {
    m = html.match(/og:title" content="([^"]*)"/i);
    if (m) name = unesc(m[1].split(' - ')[0]);
  }
  let pic = '';
  m = html.match(/og:image" content="([^"]+)"/i);
  if (m) pic = fix(m[1]);
  let vclass = '';
  m = html.match(/href="\/index\.php\/vod\/type\/id\/\d+\.html"[^>]*>([^<]+)<\/a>/i);
  if (m) vclass = unesc(m[1]);
  const tags = [];
  const tre = /href="\/index\.php\/vod\/search\/wd\/([^"]+)\.html"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
  while ((m = tre.exec(html)) !== null) {
    const t = unesc(m[2]);
    if (t && !tags.includes(t)) tags.push(t);
    if (tags.length >= 8) break;
  }
  m = html.match(/>([^<>]*(?:天前|小时前|分钟前))\s*</);
  const playUrl = `${HOST}/index.php/vod/play/id/${vid}.html`;
  return {
    list: [{
      vod_id: vid,
      vod_name: name,
      vod_pic: pic,
      vod_class: vclass,
      tag: tags.join(','),
      vod_remarks: m ? m[1].trim() : '',
      vod_content: tags.length ? '标签：' + tags.join(' / ') : '',
      vod_play_from: NAME,
      vod_play_url: '播放$' + playUrl,
    }],
  };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  let url = /^https?:\/\//i.test(id) ? id : fix(id);
  let parse = 0;
  if (!/\.(m3u8|mp4)/i.test(url)) {
    const html = await getText(url);
    let u2 = '';
    let m = html.match(/const\s+source\s*=\s*['"]([^'"]+)['"]/i);
    if (m) u2 = m[1];
    if (!u2) {
      m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (m) u2 = m[1];
    }
    if (!u2) {
      m = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
      if (m) u2 = m[1];
    }
    if (u2) url = fix(u2);
    else parse = 1;
  }
  return { parse, url, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { list: [] };
  const q = encodeURIComponent(wd);
  const url = pg > 1
    ? `${HOST}/index.php/vod/search/page/${pg}/wd/${q}.html`
    : `${HOST}/index.php/vod/search/wd/${q}.html`;
  const html = await getText(url);
  const list = parseList(html);
  const pagecount = pagecountOf(html, pg);
  return { page: pg, pagecount: list.length ? pagecount : pg, limit: 20, total: 0, list };
}

export default function createSpider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', init);
      fastify.post('/home', home);
      fastify.post('/homeVod', homeVod);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
