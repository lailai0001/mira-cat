// Jable - MiraPlayer JS Spider
// 站点: https://jable.tv
// 列表: /categories/{slug}/, 翻页 /categories/{slug}/{pg}/ ; /latest-updates/, /hot/
// 搜索: GET /search/{关键词}/
// 详情: /videos/{slug}/, 播放地址 var hlsUrl = '...m3u8'
// 请求: 双通道 — 先框架 req(axios), 失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_jable';
const NAME = 'Jable';
const HOST = 'https://jable.tv';
const UA = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// 兜底分类(站点实测 12 个主题 + 3 个专区)
const FALLBACK_CATS = [
  { type_id: 'home', type_name: '推薦影片' },
  { type_id: 'latest-updates', type_name: '最新更新' },
  { type_id: 'hot', type_name: '熱門影片' },
  { type_id: 'roleplay', type_name: '角色劇情' },
  { type_id: 'chinese-subtitle', type_name: '中文字幕' },
  { type_id: 'uniform', type_name: '制服誘惑' },
  { type_id: 'pantyhose', type_name: '絲襪美腿' },
  { type_id: 'sex-only', type_name: '直接開啪' },
  { type_id: 'groupsex', type_name: '多P群交' },
  { type_id: 'bdsm', type_name: '主奴調教' },
  { type_id: 'pov', type_name: '男友視角' },
  { type_id: 'insult', type_name: '凌辱快感' },
  { type_id: 'private-cam', type_name: '盜攝偷拍' },
  { type_id: 'lesbian', type_name: '女同歡愉' },
  { type_id: 'uncensored', type_name: '無碼解放' },
];

function t(v) { return String(v == null ? '' : v).trim(); }

function absUrl(u) {
  u = t(u).replace(/&amp;/g, '&');
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

async function getText(url, referer, retries = 2) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.6',
    'Referer': referer || HOST + '/',
  };
  for (let i = 0; i < retries; i++) {
    // 通道1: 框架 req (axios)
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const s = t(data);
      if (status === 200 && s.length > 1000) return s;
    } catch { /* 换通道2 */ }
    // 通道2: Node 原生 fetch
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const s = t(await r.text());
      if (s.length > 1000) return s;
    } catch { /* retry */ }
  }
  return '';
}

function catUrl(tid, pg) {
  if (tid === 'home') return pg <= 1 ? HOST + '/' : HOST + '/page/' + pg + '/';
  if (tid === 'latest-updates' || tid === 'hot') return pg <= 1 ? `${HOST}/${tid}/` : `${HOST}/${tid}/${pg}/`;
  return pg <= 1 ? `${HOST}/categories/${tid}/` : `${HOST}/categories/${tid}/${pg}/`;
}

function parseList(html) {
  const items = [];
  if (!html) return items;
  // 按卡片容器切分: <div class="col-6 col-sm-4 col-lg-3"> ... </div>
  const blocks = String(html).split('<div class="col-6 col-sm-4 col-lg-3">');
  const seen = new Set();
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const idm = b.match(/href="https:\/\/jable\.tv\/videos\/([^"\/]+)\/"/);
    const picm = b.match(/data-src="([^"]+)"/);
    const namem = b.match(/<h6 class="title"><a[^>]*>([^<]+)<\/a><\/h6>/);
    const durm = b.match(/<span class="label">([^<]{1,20})<\/span>/);
    if (!idm || !namem || seen.has(idm[1])) continue;
    seen.add(idm[1]);
    items.push({
      vod_id: idm[1],
      vod_name: t(namem[1]),
      vod_pic: absUrl(picm ? picm[1] : ''),
      vod_remarks: durm ? t(durm[1]) : '',
    });
  }
  return items;
}

function parsePagecount(html, pg) {
  // 分页: <a class="page-link" href="/categories/slug/N/">
  let max = pg;
  const re = /<a class="page-link" href="[^"]*\/(\d+)\/"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const p = parseInt(m[1], 10);
    if (p > max) max = p;
  }
  return max;
}

async function init() { return {}; }

async function home() {
  const html = await getText(HOST + '/');
  const list = parseList(html);
  return { class: FALLBACK_CATS, filters: {}, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.type || body.tid || body.id) || 'home';
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await getText(catUrl(tid, pg));
  const list = parseList(html);
  const pagecount = Math.max(parsePagecount(html, pg), pg);
  return { page: pg, pagecount, limit: list.length || 24, total: pagecount * (list.length || 24), list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let ids = body.id || body.ids || '';
  if (!Array.isArray(ids)) ids = [ids];
  const out = [];
  for (const raw of ids) {
    const slug = t(raw).replace(/\.html$/, '').split('/').pop();
    if (!slug) continue;
    const url = `${HOST}/videos/${slug}/`;
    const html = await getText(url);
    if (!html) continue;
    let name = '';
    let m = html.match(/<title>([^<]+)<\/title>/);
    if (m) name = t(m[1]).split(' - Jable')[0];
    if (!name) name = slug;
    let pic = '';
    m = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (m) pic = absUrl(m[1]);
    let playUrl = '';
    m = html.match(/var\s+hlsUrl\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/);
    if (m) playUrl = t(m[1]);
    if (!playUrl) {
      m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
      if (m) playUrl = t(m[1]);
    }
    out.push({
      vod_id: slug,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: name,
      vod_play_from: NAME,
      vod_play_url: playUrl ? `正片$${playUrl}` : '',
    });
  }
  return { list: out };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  const header = { 'User-Agent': UA, 'Referer': HOST + '/' };
  if (/\.m3u8(\?|$)/i.test(id)) return { parse: 0, jx: 0, url: id, header };
  return { parse: 1, jx: 0, url: id, header };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page: pg, pagecount: pg, limit: 24, total: 0, list: [] };
  const url = pg <= 1
    ? `${HOST}/search/${encodeURIComponent(wd)}/`
    : `${HOST}/search/${encodeURIComponent(wd)}/${pg}/`;
  const html = await getText(url);
  const list = parseList(html);
  return { page: pg, pagecount: list.length >= 24 ? pg + 1 : pg, limit: 24, total: list.length, list };
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
