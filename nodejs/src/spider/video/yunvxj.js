// 欲女心经 - MiraPlayer JS Spider
// 站点: https://rzj.ynxj9.work (upload-16.py 转换)
// 列表: /vodtype/{id}.html, 翻页 /vodtype/{id}-{pg}.html
// 搜索: GET /s/index.html?wd=关键词
// 详情: /{vid}.html, 播放地址 const rawUrl='...m3u8'
// 请求: 双通道 — 先框架 req(axios), 失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_yunvxj';
const NAME = '欲女心经';
const HOST = 'https://rzj.ynxj9.work';
const UA = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// 兜底分类(站点实测 16 个, home 会动态解析更新)
const FALLBACK_CATS = [
  { type_id: '21', type_name: '女神学生' },
  { type_id: '22', type_name: '美女直播' },
  { type_id: '23', type_name: '人妻系列' },
  { type_id: '24', type_name: '强奸乱伦' },
  { type_id: '25', type_name: '自拍偷拍' },
  { type_id: '26', type_name: '制服诱惑' },
  { type_id: '27', type_name: '巨乳系列' },
  { type_id: '28', type_name: '自慰系列' },
  { type_id: '29', type_name: '国产视频' },
  { type_id: '30', type_name: '无码视频' },
  { type_id: '31', type_name: '有码视频' },
  { type_id: '32', type_name: '中文字幕' },
  { type_id: '33', type_name: '日韩精品' },
  { type_id: '34', type_name: '欧美精品' },
  { type_id: '35', type_name: '动漫精品' },
  { type_id: '36', type_name: '三级伦理' },
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
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
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

function parseCats(html) {
  const cats = [];
  const seen = new Set();
  const re = /href="\/vodtype\/(\d+)\.html"[^>]*>\s*<span>([^<]+)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const tid = m[1], tname = t(m[2]);
    if (seen.has(tid) || !tname) continue;
    seen.add(tid);
    cats.push({ type_id: tid, type_name: tname });
  }
  return cats.length ? cats : FALLBACK_CATS;
}

function parseList(html) {
  const items = [];
  if (!html) return items;
  const seen = new Set();
  const ids = [];
  const reId = /href="\/(\d+)\.html"/g;
  let m;
  while ((m = reId.exec(html))) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  const pics = [];
  const rePic = /background(?:-image)?:\s*url\(["']?([^"'\)]+)["']?\)/g;
  while ((m = rePic.exec(html))) pics.push(m[1]);
  const names = [];
  const reName = /<a[^>]*href="\/\d+\.html"[^>]*>([^<]{2,})<\/a>/g;
  while ((m = reName.exec(html))) { const s = t(m[1]); if (s) names.push(s); }
  ids.forEach((vid, i) => {
    const name = names[i] || '';
    if (!name) return;
    items.push({
      vod_id: vid,
      vod_name: name,
      vod_pic: absUrl(pics[i] || ''),
      vod_remarks: '',
    });
  });
  return items;
}

function parsePagecount(html, tid, cur) {
  let max = cur;
  const re = new RegExp('/vodtype/' + tid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)\\.html', 'g');
  let m;
  while ((m = re.exec(html))) {
    const p = parseInt(m[1], 10);
    if (p > max) max = p;
  }
  return max;
}

async function init() { return {}; }

async function home() {
  const html = await getText(HOST + '/ynxj/');
  const cats = parseCats(html);
  const list = parseList(html);
  return { class: cats, filters: {}, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.type || body.tid || body.id);
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!tid) return { page: pg, pagecount: pg, limit: 20, total: 0, list: [] };
  const url = pg === 1
    ? `${HOST}/vodtype/${tid}.html`
    : `${HOST}/vodtype/${tid}-${pg}.html`;
  const html = await getText(url);
  const list = parseList(html);
  const pagecount = Math.max(parsePagecount(html, tid, pg), pg);
  return { page: pg, pagecount, limit: list.length || 20, total: pagecount * (list.length || 20), list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let ids = body.id || body.ids || '';
  if (!Array.isArray(ids)) ids = [ids];
  const out = [];
  for (const raw of ids) {
    const vid = t(raw).replace(/\.html$/, '');
    if (!vid) continue;
    const html = await getText(`${HOST}/${vid}.html`);
    if (!html) continue;
    let name = '';
    let m = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    if (m) name = t(m[1]);
    if (!name) {
      m = html.match(/<title>([^<]+)<\/title>/);
      if (m) name = t(m[1]).split('-')[0];
    }
    if (!name) name = vid;
    let playUrl = '';
    m = html.match(/const\s+rawUrl\s*=\s*['"]([^'"]+)['"]/);
    if (m) playUrl = t(m[1]);
    if (!playUrl) {
      m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
      if (m) playUrl = t(m[1]);
    }
    out.push({
      vod_id: vid,
      vod_name: name,
      vod_pic: '',
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
  if (!wd) return { page: pg, pagecount: pg, limit: 20, total: 0, list: [] };
  const url = `${HOST}/s/index.html?wd=${encodeURIComponent(wd)}${pg > 1 ? `&page=${pg}` : ''}`;
  const html = await getText(url);
  const list = parseList(html);
  return { page: pg, pagecount: list.length >= 20 ? pg + 1 : pg, limit: 20, total: list.length, list };
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
