// 有料 - MiraPlayer JS Spider
// (upload-17.py 转换)
// 启动: INIT_HOSTS /player/do_init_h5 取 api_url/token/uid (md5 签名 + AES-CBC 加密响应)
// 图片: qgtp.m.* 加密域 -> 直连 S3 明文源站 qgjs.m.nzwkzj.com 同路径
// 请求: 双通道 — 先框架 req(axios), 失败再试 Node 原生 fetch
import req from '../../util/req.js';
import crypto from 'crypto';

const KEY = 'py_youliao';
const NAME = '有料';
const SALT = 'a2ef62227536ab01';
const AES_KEY = Buffer.from('ec5279154d05ac2c', 'utf8');
const AES_IV = Buffer.from('515cd1587d7cfbdd', 'utf8');
const CHANNEL = '1031';
const UA = 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ORIGIN = 'https://0zq6w.shddlcd.cn';
const INIT_HOSTS = [
  'https://h5init.qn.pnwkult.com/api',
  'https://init.al.pnwkult.com/api',
  'https://init.youliao88.com/api',
  'https://h5init.m.nbajkbq.com/api',
  'https://h5init.qn.nbajkbq.com/api',
  'https://h5init.al.pnwkult.com/api',
];
const PLAIN_IMG_HOST = 'qgjs.m.nzwkzj.com';
const NEW = 'n_new', REC = 'n_rec', LIB = 'n_lib';

// ---- 会话状态(模块级, App 内复用) ----
const S = { api: '', token: '', uid: '' };

function t(v) { return String(v == null ? '' : v).trim(); }

function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }

function sign(path, tm) { return md5(`${path}?time=${tm}&${SALT}`); }

function aesDec(text) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
    decipher.setAutoPadding(true);
    let plain = decipher.update(text, 'base64', 'utf8');
    plain += decipher.final('utf8');
    return JSON.parse(plain);
  } catch { return null; }
}

function dec(text) {
  const r = aesDec(t(text));
  if (r) return r;
  try { return JSON.parse(t(text)); } catch { return {}; }
}

// 双通道 POST form
async function postForm(url, body, headers, retries = 2) {
  const data = new URLSearchParams(body || {}).toString();
  for (let i = 0; i < retries; i++) {
    try {
      const r = await req.post(url, data, { headers, timeout: 20000, responseType: 'text' });
      if (r.status === 200 && t(r.data).length > 10) return t(r.data);
    } catch { /* 通道2 */ }
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { method: 'POST', headers, body: data, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) continue;
      const s = t(await r.text());
      if (s.length > 10) return s;
    } catch { /* retry */ }
  }
  return '';
}

async function apiPost(base, path, data, auth = true) {
  const tm = Math.floor(Date.now() / 1000).toString();
  let p;
  try { p = new URL(base + path).pathname; } catch { p = path; }
  const h = {
    'time': tm,
    'sign': sign(p, tm),
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': UA,
    'Origin': ORIGIN,
    'Referer': ORIGIN + '/',
  };
  if (auth && S.token && S.uid) {
    h['uid'] = String(S.uid);
    h['token'] = String(S.token);
    h['Access-Token'] = String(S.token);
  }
  const txt = await postForm(base + path, data || {}, h);
  return dec(txt);
}

async function boot() {
  if (S.api) return true;
  for (const host of INIT_HOSTS) {
    const r = await apiPost(host, '/player/do_init_h5', { system: '3', channel: CHANNEL, new_live: '1' }, false);
    const d = (r && r.data) || null;
    if (d && typeof d === 'object' && d.api_url) {
      S.api = String(d.api_url).replace(/\/$/, '') + '/api';
      const pi = d.player_info || {};
      S.token = pi.token || '';
      S.uid = pi.uid || '';
      return true;
    }
  }
  return false;
}

async function call(path, data) {
  if (!(await boot())) return {};
  let r = await apiPost(S.api, path, data);
  if (r && r.code === 3) {
    S.api = '';
    if (await boot()) r = await apiPost(S.api, path, data);
  }
  return (r && typeof r === 'object') ? r : {};
}

function fullM3u8(u) {
  u = t(u);
  if (!/\.m3u8/i.test(u)) return u;
  const i = u.lastIndexOf('/');
  return i > 0 ? u.slice(0, i + 1) + 'index.m3u8' : u;
}

function fmtNum(n) {
  try {
    const v = parseFloat(n);
    if (isNaN(v)) return t(n);
    return v >= 10000 ? (v / 10000).toFixed(1) + 'w' : String(Math.floor(v));
  } catch { return t(n); }
}

function img(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u)) {
    if (u.startsWith('/')) u = ORIGIN + u;
    else return u;
  }
  // qgtp 加密域 -> S3 明文源站同路径
  if (/^https?:\/\/qgtp\.m\./i.test(u)) {
    return u.replace(/^https?:\/\/qgtp\.m\.[a-zA-Z0-9.\-]+/i, 'https://' + PLAIN_IMG_HOST);
  }
  return u;
}

function findPic(obj, depth = 0) {
  if (depth > 3 || !obj || typeof obj !== 'object') return '';
  const keys = ['img', 'video_img', 'cover', 'icon', 'pic', 'image', 'photo', 'thumbnail', 'poster', 'cover_url', 'pic_url', 'img_url', 'thumb'];
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === 'string' && v.trim()) {
      const s = v.trim();
      if (/^https?:\/\//i.test(s) || s.startsWith('//') || s.startsWith('/')) return s;
    }
  }
  for (const k of Object.keys(obj)) {
    if (k === 'data' || k === 'list') continue;
    const v = obj[k];
    if (v && typeof v === 'object') {
      const r = findPic(Array.isArray(v) ? v[0] : v, depth + 1);
      if (r) return r;
    }
  }
  return '';
}

function vod(it) {
  const vid = t(it.video_id || it.id);
  const name = t(it.title || it.video_title || it.name);
  let rem = t(it.video_time || it.time);
  const pn = it.play_num || it.video_play_num;
  if (pn) rem = t(`${rem} ${fmtNum(pn)}`.trim());
  return { vod_id: vid, vod_name: name, vod_pic: img(findPic(it)), vod_remarks: rem };
}

function pick(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object') return [];
  for (const k of ['list', 'data', 'items', 'rows', 'video_list', 'library_list']) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') { const r = pick(v); if (r.length) return r; }
  }
  return [];
}

function dedup(items) {
  const seen = new Set(), out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const v = vod(it);
    if (!v.vod_id || !v.vod_name || seen.has(v.vod_id)) continue;
    seen.add(v.vod_id);
    out.push(v);
  }
  return out;
}

function page(items, pg, limit) {
  const vl = dedup(items);
  const pc = vl.length >= limit ? pg + 1 : pg;
  return { list: vl, page: pg, pagecount: pc, limit, total: pc * limit };
}

let recsCache = null;
async function getRecs() {
  if (recsCache) return recsCache;
  const d = (await call('/video/index', {})).data || {};
  const recs = [];
  for (const b of d.recommend_list || []) {
    if (b && b.cate_id) recs.push({ id: String(b.cate_id), name: t(b.name) });
  }
  recsCache = recs;
  return recs;
}

async function init() { await boot(); return {}; }

async function home() {
  const d = (await call('/video/index', {})).data || {};
  const cls = [
    { type_id: NEW, type_name: '最新' },
    { type_id: REC, type_name: '推荐' },
  ];
  for (const c of d.cate_list || []) {
    if (c && c.cate_id) cls.push({ type_id: String(c.cate_id), type_name: t(c.name || c.cate_id) });
  }
  cls.push({ type_id: LIB, type_name: '片库' });
  const vl = [];
  for (const b of d.recommend_list || []) vl.push(...(b.list || []));
  recsCache = (d.recommend_list || []).filter(b => b && b.cate_id).map(b => ({ id: String(b.cate_id), name: t(b.name) }));
  return { class: cls, filters: {}, list: dedup(vl) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.type || body.tid || body.id);
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!tid) return { page: pg, pagecount: pg, limit: 12, total: 0, list: [] };

  if (tid === NEW) {
    const items = pick((await call('/video/new_update_list', { page: String(pg) })).data);
    return page(items, pg, 12);
  }
  if (tid === REC) {
    const recs = await getRecs();
    const rid = recs.length ? recs[0].id : '29';
    const items = pick((await call('/video/recommend_cate', { cate_id: rid, page: String(pg) })).data);
    return page(items, pg, 12);
  }
  if (tid === LIB) {
    const d = (await call('/video/video_library_list', { page: String(pg) })).data || {};
    return page(d.list || [], pg, 20);
  }
  // 普通分类: 先取子类, 有子类则取第一个子类的列表, 否则取分类列表
  const subs = (((await call('/video/cate2', { cate_id: tid })).data) || []);
  const subList = Array.isArray(subs) ? subs : [];
  if (subList.length && subList[0].id) {
    const items = pick((await call('/video/cate2_list', { cate2_id: String(subList[0].id), page: String(pg) })).data);
    return page(items, pg, 20);
  }
  const d2 = (await call('/video/cate_list', { cate_id: tid, page: String(pg) })).data || {};
  const flat = [];
  for (const x of d2.list || []) {
    if (x && Array.isArray(x.list)) flat.push(...x.list);
    else if (x) flat.push(x);
  }
  return page(flat, pg, 20);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let ids = body.id || body.ids || '';
  if (!Array.isArray(ids)) ids = [ids];
  const out = [];
  for (const raw of ids) {
    const vid = t(raw);
    if (!vid) continue;
    let vi = null;
    for (const p of ['/video/video_info', '/video/video_info_v3']) {
      const r = await call(p, { video_id: vid, uid: S.uid, is_h5: '1' });
      if (r && r.code === 1) {
        const cand = (r.data || {}).video_info || {};
        if (cand.url || cand.video_line) { vi = cand; break; }
      }
    }
    if (!vi) continue;
    let lines = (vi.video_line || []).filter(x => x && x.url);
    if (!lines.length && vi.url) lines = [{ name: '线路1', url: vi.url }];
    const froms = lines.map((l, i) => t(l.name) || `线路${i + 1}`);
    const urls = lines.map(l => `播放$${l.url}`);
    let tags = vi.tags;
    if (Array.isArray(tags)) tags = tags.map(x => (x && x.name) || '').filter(Boolean).join(',');
    out.push({
      vod_id: vid,
      vod_name: t(vi.title || vi.name),
      vod_pic: img(findPic(vi)),
      type_name: t((vi.cate2 || {}).name || tags || ''),
      vod_remarks: t(vi.video_time),
      vod_content: `播放 ${fmtNum(vi.play_num || 0)} ｜ 时长 ${t(vi.video_time)} ｜ ${t(tags)}`,
      vod_play_from: froms.join('$$$') || '线路1',
      vod_play_url: urls.join('$$$'),
    });
  }
  return { list: out };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  const header = { 'User-Agent': UA, 'Referer': ORIGIN + '/' };
  return { parse: 0, jx: 0, url: fullM3u8(id), header };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page: pg, pagecount: pg, limit: 10, total: 0, list: [] };
  let items = pick((await call('/video/search_list', { keyword: wd, page: String(pg) })).data);
  if (!items.length && pg === 1) {
    items = pick((await call('/video/search_video_library', { keyword: wd, page: '1' })).data);
  }
  return page(items, pg, 10);
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
