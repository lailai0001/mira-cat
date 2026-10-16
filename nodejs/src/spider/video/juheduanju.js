import req from '../../util/req.js';
import crypto from 'crypto';

const KEY = 'py_juheduanju';
const NAME = '聚合短剧';
const TIMEOUT = 22000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/* ---------------- 双通道请求 ---------------- */
async function httpGet(url, headers = {}) {
  try {
    const { data } = await req.get(url, { headers, timeout: TIMEOUT, responseType: 'text' });
    if (data !== undefined && data !== null && data !== '') return String(data);
  } catch (e) {}
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    const r = await fetch(url, { headers, signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) return await r.text();
  } catch (e) {}
  return '';
}
async function httpGetJson(url, headers = {}) {
  try {
    const { data } = await req.get(url, { headers, timeout: TIMEOUT, responseType: 'json' });
    if (data !== undefined && data !== null && data !== '') {
      if (typeof data === 'object') return data;
      try { return JSON.parse(String(data)); } catch (e) {}
    }
  } catch (e) {}
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    const r = await fetch(url, { headers, signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) return await r.json();
  } catch (e) {}
  return null;
}
function hasHeader(headers, name) {
  const n = name.toLowerCase();
  return Object.keys(headers || {}).some(k => k.toLowerCase() === n);
}
async function httpPostJson(url, body, headers = {}) {
  const h = { ...headers };
  if (!hasHeader(h, 'content-type')) h['Content-Type'] = 'application/json';
  try {
    const { data } = await req.post(url, body, { headers: h, timeout: TIMEOUT, responseType: 'text' });
    if (data !== undefined && data !== null && data !== '') {
      if (typeof data === 'object') return data;
      const s = String(data);
      try { return JSON.parse(s); } catch (e) { return s; }
    }
  } catch (e) {}
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body), signal: ctl.signal });
    clearTimeout(t);
    const s = await r.text();
    try { return JSON.parse(s); } catch (e) { return s; }
  } catch (e) {}
  return null;
}
async function httpPostForm(url, formStr, headers = {}) {
  const h = { ...headers };
  if (!hasHeader(h, 'content-type')) h['Content-Type'] = 'application/x-www-form-urlencoded';
  try {
    const { data } = await req.post(url, formStr, { headers: h, timeout: TIMEOUT, responseType: 'text' });
    if (data !== undefined && data !== null && data !== '') {
      if (typeof data === 'object') return data;
      const s = String(data);
      try { return JSON.parse(s); } catch (e) { return s; }
    }
  } catch (e) {}
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    const r = await fetch(url, { method: 'POST', headers: h, body: formStr, signal: ctl.signal });
    clearTimeout(t);
    const s = await r.text();
    try { return JSON.parse(s); } catch (e) { return s; }
  } catch (e) {}
  return null;
}
function clean(s) { return String(s || '').replace(/<[^>]+>/g, '').trim(); }
function pick(o, ...keys) {
  if (!o || typeof o !== 'object') return '';
  for (const k of keys) { const v = o[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v); }
  return '';
}
function aesEcbB64(keyStr, text) {
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(keyStr, 'utf8'), null);
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
}

/* ================= 平台: 橙果 ================= */
const CG_SITE = 'https://chengguodj.com';
const CG_CATS = [
  { type_id: 'yuanchuang', type_name: '原创' },
  { type_id: 'mogai', type_name: '魔改' },
  { type_id: 'manju', type_name: '漫剧' },
  { type_id: 'zhenren', type_name: '真人' },
  { type_id: 'aiduanju', type_name: 'AI短剧' },
  { type_id: 'browse', type_name: '全部' },
];
function cgHeaders() { return { 'User-Agent': UA, 'Referer': CG_SITE + '/', 'Accept-Language': 'zh-CN,zh;q=0.9' }; }
function cgProxyPic(u) {
  let s = String(u || '').replace(/\\u002F/g, '/').replace(/\\\//g, '/').trim();
  if (!s) return '';
  if (!s.startsWith('http')) s = CG_SITE + (s.startsWith('/') ? s : '/' + s);
  try { return CG_SITE + '/_img/' + Buffer.from(s, 'utf-8').toString('base64url'); }
  catch (e) { return s; }
}
function cgResolve(arr, v) {
  if (typeof v === 'number' && v >= 0 && v < arr.length && typeof arr[v] !== 'object') return arr[v];
  return v;
}
function cgParseList(html) {
  const vods = [];
  const seen = new Set();
  const m = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return vods;
  try {
    const arr = JSON.parse(m[1].trim());
    for (const item of arr) {
      if (!item || typeof item !== 'object' || !('title' in item)) continue;
      const title = cgResolve(arr, item.title);
      if (!title || typeof title !== 'string') continue;
      let slug = cgResolve(arr, item.slug);
      if (!slug || typeof slug !== 'string') continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      let pic = '';
      let cov = item.cover;
      if (typeof cov === 'number') cov = arr[cov];
      if (cov && typeof cov === 'object') {
        const u = cgResolve(arr, cov.url) || cgResolve(arr, cov.fallback_url);
        if (u && typeof u === 'string') pic = cgProxyPic(u);
      }
      const eps = cgResolve(arr, item.total_episode_count || item.published_episode_count || item.latest_episode_number);
      vods.push({ vod_id: 'chengguo:' + slug, vod_name: title, vod_pic: pic, vod_remarks: eps ? (eps + '集') : '' });
    }
  } catch (e) {}
  return vods;
}
const cg = {
  cats: CG_CATS,
  async list(cat, page) {
    const path = '/' + (cat || 'yuanchuang');
    const url = page > 1 ? CG_SITE + path + '?page=' + page : CG_SITE + path;
    const html = await httpGet(url, cgHeaders());
    return cgParseList(html);
  },
  async search(wd) {
    const html = await httpGet(CG_SITE + '/search?q=' + encodeURIComponent(wd), cgHeaders());
    return cgParseList(html);
  },
  async detail(slug) {
    const html = await httpGet(CG_SITE + '/drama/' + encodeURIComponent(slug), cgHeaders());
    if (!html) return null;
    let name = '';
    const tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (tm) name = clean(tm[1]);
    if (!name) { const t2 = html.match(/<title>([^<]+)<\/title>/i); if (t2) name = t2[1].split('-')[0].trim(); }
    let desc = '';
    const dm = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    if (dm) desc = dm[1].trim();
    let pic = '';
    const pm = html.match(/(?:z-image-loader-url|data-cover-fb|data-src|src)="([^"]+)"/i);
    if (pm) pic = cgProxyPic(pm[1]);
    const labels = {};
    const re = new RegExp('<a\\b[^>]*href="/play/' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(\\d+)"[^>]*>([\\s\\S]*?)</a>', 'gi');
    let m;
    while ((m = re.exec(html))) {
      const n = parseInt(m[1], 10);
      if (n > 0 && !labels[n]) labels[n] = clean(m[2]) || ('第' + n + '集');
    }
    const keys = Object.keys(labels).map(Number).sort((a, b) => a - b);
    if (!keys.length) return null;
    const eps = keys.map(n => ({ no: n, name: labels[n], url: 'chengguo://' + slug + '/' + n }));
    return { name: name || slug, pic, desc, eps };
  },
  async play(slug, no) {
    let html = await httpGet(CG_SITE + '/play/' + encodeURIComponent(slug) + '/' + no, cgHeaders());
    if (!html) return '';
    html = html.replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    const m = html.match(/https?:\/\/[^\s"'\\]{10,300}\.m3u8[^\s"'\\]{0,200}/i);
    return m ? m[0] : '';
  },
};

/* ================= 平台: 七星 ================= */
const QX_SITE = 'https://app.whjzjx.cn';
const QX_AUTH = 'https://u.shytkjgs.com';
const QX_KEY = 'B@ecf920Od8A4df7';
const QX_UA = 'Mozilla/5.0 (Linux; Android 9; V1938T Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36';
const QX_CATS = [
  { type_id: '1', type_name: '剧场' },
  { type_id: '3', type_name: '新剧' },
  { type_id: '2', type_name: '热播' },
  { type_id: '7', type_name: '星选' },
  { type_id: '5', type_name: '阳光' },
];
let qxToken = '', qxTokenAt = 0;
async function qxAuth() {
  if (qxToken && Date.now() - qxTokenAt < 30 * 60 * 1000) return qxToken;
  const payload = JSON.stringify({
    device: '2a50580e69d38388c94c93605241fb306', package_name: 'com.jz.xydj',
    android_id: 'ec1280db12795506', install_first_open: true,
    first_install_time: 1752505243345, last_update_time: 1752505243345,
    report_link_url: '', authorization: '', timestamp: Date.now(),
  });
  const body = aesEcbB64(QX_KEY, payload);
  const j = await httpPostForm(QX_AUTH + '/user/v3/account/login', body, {
    'platform': '1', 'user_agent': QX_UA, 'content-type': 'application/json; charset=utf-8',
  });
  const tk = j && j.data && typeof j.data === 'object' ? String(j.data.token || '') : '';
  if (tk) { qxToken = tk; qxTokenAt = Date.now(); }
  return tk;
}
function qxH(tk) { return { 'authorization': tk, 'platform': '1', 'version_name': '3.8.3.1', 'User-Agent': QX_UA }; }
function qxCard(item, catName) {
  if (item && typeof item === 'object' && item.theater) item = item.theater;
  const vid = pick(item, 'id'); const name = clean(pick(item, 'title'));
  if (!vid || !name) return null;
  let pic = pick(item, 'cover_url');
  if (pic && !pic.startsWith('http')) pic = QX_SITE + (pic.startsWith('/') ? pic : '/' + pic);
  return {
    vod_id: 'qixing:' + vid, vod_name: name, vod_pic: pic,
    vod_remarks: clean(pick(item, 'play_amount_str', 'score_str')),
    vod_class: catName, vod_content: clean(pick(item, 'introduction')).slice(0, 200),
  };
}
async function qxDetailRaw(vid) {
  const tk = await qxAuth();
  if (!tk) return null;
  const j = await httpGetJson(QX_SITE + '/v2/theater_parent/detail?theater_parent_id=' + encodeURIComponent(vid), qxH(tk));
  if (!j || typeof j.data !== 'object' || !j.data) return null;
  return j.data;
}
const qixing = {
  cats: QX_CATS,
  async list(cat, page) {
    const tk = await qxAuth();
    if (!tk) return [];
    const j = await httpGetJson(QX_SITE + '/v1/theater/home_page?theater_class_id=' + encodeURIComponent(cat || '1') + '&page_num=' + page + '&page_size=24', qxH(tk));
    const items = (j && j.data && Array.isArray(j.data.list)) ? j.data.list : [];
    const cn = (QX_CATS.find(c => c.type_id === String(cat)) || {}).type_name || '';
    return items.map(it => qxCard(it, cn)).filter(Boolean);
  },
  async search(wd) {
    const tk = await qxAuth();
    if (!tk) return [];
    const j = await httpPostJson(QX_SITE + '/v3/search', { text: wd }, qxH(tk));
    const items = (j && j.data && j.data.theater && Array.isArray(j.data.theater.search_data)) ? j.data.theater.search_data : [];
    return items.map(it => qxCard(it, '搜索')).filter(Boolean);
  },
  async detail(vid) {
    const d = await qxDetailRaw(vid);
    if (!d) return null;
    const eps = [];
    const seen = new Set();
    for (const raw of (Array.isArray(d.theaters) ? d.theaters : [])) {
      const no = parseInt(pick(raw, 'num'), 10) || (eps.length + 1);
      if (seen.has(no)) continue;
      seen.add(no);
      const src = pick(raw, 'son_video_url');
      if (!src) continue;
      const sn = clean(pick(raw, 'son_title'));
      eps.push({ no, name: (sn && sn !== clean(pick(d, 'title'))) ? ('第' + no + '集 ' + sn) : ('第' + no + '集'), url: 'qixing://' + vid + '/' + no });
    }
    eps.sort((a, b) => a.no - b.no);
    if (!eps.length) return null;
    return { name: clean(pick(d, 'title')) || vid, pic: pick(d, 'cover_url'), desc: clean(pick(d, 'introduction')).slice(0, 400), eps };
  },
  async play(vid, no) {
    const d = await qxDetailRaw(vid);
    if (!d) return '';
    for (const raw of (Array.isArray(d.theaters) ? d.theaters : [])) {
      if ((parseInt(pick(raw, 'num'), 10) || 0) === no) {
        const src = pick(raw, 'son_video_url');
        if (src.startsWith('http')) return src;
      }
    }
    return '';
  },
};

/* ================= 平台: 星芽 ================= */
const XY_SITE = 'https://app.whjzjx.cn';
const XY_AUTH = 'https://u.shytkjgs.com';
const XY_DEVICE = '24250683a3bdb3f118dff25ba4b1cba1a';
const XY_UUID = 'randomUUID_914e7a9b-deac-4f80-9247-db56669187df';
const XY_DEVTOKEN = 'WuoRLUg1r08Z1f0IqSv2q1lvfxrYckKavmnAPYLdkT9P1fPFNRt0RuN3DLLFZqApRDdPD3mM2jB6d79CF2LtM*';
const XY_UA = 'Mozilla/5.0 (Linux; Android 9; RMX1931 Build/PQ3A.190605.05081124; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36';
const XY_APP_UA = 'Mozilla/5.0 (Linux; Android 9; RMX1931 Build/PQ3A.190605.05081124; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36';
const XY_CATS = [
  { type_id: 'juchang', type_name: '剧场', cid: '1' },
  { type_id: 'reboduanju', type_name: '热播剧', cid: '2' },
  { type_id: 'huiyuan', type_name: '会员专享', cid: '8' },
  { type_id: 'xingxuan', type_name: '星选好剧', cid: '7' },
  { type_id: 'xinju', type_name: '新剧', cid: '3' },
  { type_id: 'yangguang', type_name: '阳光剧场', cid: '5' },
];
let xyHeaders = null;
async function xyAuth() {
  if (xyHeaders) return xyHeaders;
  const lh = {
    'User-Agent': 'okhttp/4.10.0', 'Content-Type': 'application/x-www-form-urlencoded',
    'x-app-id': '7', 'platform': '1', 'version_name': '3.3.1', 'app_version': '3.3.1',
    'device_platform': 'android', 'device_id': XY_DEVICE, 'device_type': 'RMX1931',
    'device_brand': 'realme', 'os_version': '9', 'channel': 'default', 'uuid': XY_UUID,
  };
  const form = 'device=' + XY_DEVICE + '&install_first_open=false&first_install_time=1723214205125&last_update_time=1723214205125&report_link_url=';
  const j = await httpPostForm(XY_AUTH + '/user/v1/account/login', form, lh);
  const tk = j && j.data && typeof j.data === 'object' ? String(j.data.token || '').trim() : '';
  if (!tk) return null;
  xyHeaders = { ...lh, 'authorization': tk, 'dev_token': XY_DEVTOKEN, 'user_agent': XY_APP_UA, 'support_h265': '1' };
  return xyHeaders;
}
function xyCard(item, catName) {
  const vid = pick(item, 'id'); const name = clean(pick(item, 'title'));
  if (!vid || !name) return null;
  const total = parseInt(pick(item, 'total'), 10) || 0;
  return {
    vod_id: 'xingya:' + vid, vod_name: name, vod_pic: pick(item, 'cover_url'),
    vod_remarks: total > 0 ? ('共' + total + '集') : '', vod_class: catName,
  };
}
async function xyDetailRaw(vid) {
  const h = await xyAuth();
  if (!h) return null;
  const j = await httpGetJson(XY_SITE + '/v2/theater_parent/detail?theater_parent_id=' + encodeURIComponent(vid), h);
  if (!j || typeof j.data !== 'object' || !j.data) return null;
  return j.data;
}
const xingya = {
  cats: XY_CATS,
  async list(cat, page) {
    const h = await xyAuth();
    if (!h) return [];
    const c = XY_CATS.find(x => x.type_id === String(cat)) || XY_CATS[0];
    const j = await httpGetJson(XY_SITE + '/cloud/v2/theater/home_page?theater_class_id=' + c.cid + '&type=1&class2_ids=0&page_num=' + page + '&page_size=24', h);
    const arr = (j && j.data && Array.isArray(j.data.list)) ? j.data.list : [];
    const items = arr.map(e => (e && typeof e === 'object' && e.theater) ? e.theater : null).filter(Boolean);
    return items.map(it => xyCard(it, c.type_name)).filter(Boolean);
  },
  async search(wd) {
    const h = await xyAuth();
    if (!h) return [];
    const j = await httpPostJson(XY_SITE + '/v3/search', { text: wd }, { ...h, 'Content-Type': 'application/json' });
    const items = (j && j.data && j.data.theater && Array.isArray(j.data.theater.search_data)) ? j.data.theater.search_data : [];
    return items.map(it => xyCard(it, '搜索')).filter(Boolean);
  },
  async detail(vid) {
    const d = await xyDetailRaw(vid);
    if (!d) return null;
    const eps = [];
    const seen = new Set();
    const title = clean(pick(d, 'title'));
    let idx = 0;
    for (const raw of (Array.isArray(d.theaters) ? d.theaters : [])) {
      idx++;
      const no = parseInt(pick(raw, 'num'), 10) || idx;
      if (seen.has(no)) continue;
      seen.add(no);
      const sn = clean(pick(raw, 'son_title'));
      eps.push({ no, name: (sn && sn !== title) ? ('第' + no + '集 ' + sn) : ('第' + no + '集'), url: 'xingya://' + vid + '/' + no });
    }
    eps.sort((a, b) => a.no - b.no);
    if (!eps.length) return null;
    return { name: title || vid, pic: pick(d, 'cover_url'), desc: clean(pick(d, 'introduction')).slice(0, 400), eps };
  },
  async play(vid, no) {
    const d = await xyDetailRaw(vid);
    if (!d) return '';
    for (const raw of (Array.isArray(d.theaters) ? d.theaters : [])) {
      if ((parseInt(pick(raw, 'num'), 10) || 0) === no) {
        const src = pick(raw, 'son_video_url');
        if (src.startsWith('http')) return src;
      }
    }
    return '';
  },
};

/* ================= 平台: 狂飙 ================= */
const KB_SITE = 'https://ai.dramarush.tv';
const KB_UA = 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const KB_PLAY_PREFIX = 'https://raw.shorttv.online/uploads/direct/';
const KB_CATS = [
  { type_id: 't-5jxcit', type_name: '短剧', q: { categorySlug: 't-5jxcit' }, mode: 'all', rounds: 1 },
  { type_id: 'normal_short', type_name: '正规短剧', q: { contentKind: 'SHORT_DRAMA' }, mode: 'normal', rounds: 6 },
  { type_id: 'adult_short', type_name: '成人短剧', q: { tagSlug: 'adult' }, mode: 'adult', rounds: 6 },
];
const KB_PAGE = 12, KB_MAX_EP = 80;
function kbH() { return { 'User-Agent': KB_UA, 'Referer': KB_SITE + '/zh/', 'Accept': 'application/json, text/plain, */*' }; }
async function kbTrpc(name, payload) {
  let target = KB_SITE + '/api/trpc/' + name;
  if (payload) target += '?input=' + encodeURIComponent(JSON.stringify({ json: payload })).replace(/%20/g, '+');
  const j = await httpGetJson(target, kbH());
  const out = j && j.result && j.result.data && j.result.data.json;
  return (out && typeof out === 'object') ? out : {};
}
function kbDrama(item) { return (item && item.drama && typeof item.drama === 'object') ? item.drama : (item || {}); }
function kbIsAdult(item) {
  const drama = kbDrama(item);
  const tags = Array.isArray(drama.tags) ? drama.tags : [];
  return tags.some(t => { const n = String((t && t.name) || ''); return n.startsWith('adult-') || n.includes('不伦') || n.includes('偷情'); });
}
function kbCover(drama) {
  for (const k of ['cover', 'poster']) {
    let raw = String(drama[k] || '');
    if (!raw || raw.includes('dc/img/828ed491f008e85d9caef01a.jpg')) continue;
    raw = raw.replace('https://cdn.shorttv.online/lsj/', 'https://raw.shorttv.online/lsj/');
    if (raw.includes('_minimize.')) return raw;
    const qi = raw.indexOf('?');
    let path = raw, q = '';
    if (qi >= 0) { path = raw.slice(0, qi); q = raw.slice(qi); }
    if (path.lastIndexOf('.') > path.lastIndexOf('/')) raw = path.slice(0, path.lastIndexOf('.')) + '_minimize.webp' + q;
    return raw;
  }
  return '';
}
function kbCard(item, catName) {
  const drama = kbDrama(item);
  const vid = String(drama.id || '').trim();
  const name = clean(drama.title);
  if (!vid || !name) return null;
  const total = parseInt(drama.totalEpisodes, 10) || 0;
  return {
    vod_id: 'kuangbiao:' + vid, vod_name: name, vod_pic: kbCover(drama),
    vod_remarks: total > 0 ? (total + '集') : '', vod_class: catName,
    vod_content: clean(drama.description).slice(0, 200),
  };
}
async function kbBrowsePage(spec, page) {
  let cursor = '', target = [];
  for (let i = 1; i <= page; i++) {
    const data = { limit: KB_PAGE, ...spec.q };
    if (cursor) data.cursor = cursor;
    let out = [], seen = new Set(), next = '';
    for (let r = 0; r < spec.rounds; r++) {
      if (cursor) data.cursor = cursor;
      const body = await kbTrpc('feed.browse', data);
      if (!body) break;
      for (const raw of (Array.isArray(body.items) ? body.items : [])) {
        if (spec.mode === 'adult' && !kbIsAdult(raw)) continue;
        if (spec.mode === 'normal' && kbIsAdult(raw)) continue;
        const drama = kbDrama(raw);
        const k = String(drama.id || '').trim() || clean(drama.title);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(raw);
      }
      next = String(body.nextCursor || '').trim();
      if (out.length >= KB_PAGE || !next) break;
      cursor = next;
    }
    if (i === page) target = out;
    cursor = next;
    if (!next) break;
  }
  return target;
}
async function kbEpTable(dramaId, no) {
  const body = await kbTrpc('episode.watch', { dramaId, episodeNumber: no });
  const table = {};
  for (const ep of (Array.isArray(body.episodes) ? body.episodes : [])) {
    const idx = parseInt(ep && ep.index, 10);
    const id = String((ep && ep.id) || '').trim();
    if (idx > 0 && id) table[idx] = id;
  }
  return { body, table };
}
const kuangbiao = {
  cats: KB_CATS,
  async list(cat, page) {
    const spec = KB_CATS.find(x => x.type_id === String(cat)) || KB_CATS[0];
    const items = await kbBrowsePage(spec, page);
    return items.map(it => kbCard(it, spec.type_name)).filter(Boolean);
  },
  async search(wd) {
    const items = await kbBrowsePage(KB_CATS[0], 1);
    return items.map(it => kbCard(it, '搜索')).filter(Boolean).filter(c => c.vod_name.includes(wd)).slice(0, 20);
  },
  async detail(vid) {
    const { body, table } = await kbEpTable(vid, 1);
    const drama = (body && body.drama && typeof body.drama === 'object') ? body.drama : {};
    let total = parseInt(drama.totalEpisodes, 10) || 0;
    if (total < Object.keys(table).length) total = Object.keys(table).length;
    if (total < 1) total = 1;
    if (total > KB_MAX_EP) total = KB_MAX_EP;
    const eps = [];
    for (let i = 1; i <= total; i++) eps.push({ no: i, name: '第' + i + '集', url: 'kuangbiao://' + vid + '/' + i });
    return { name: clean(drama.title) || vid, pic: kbCover(drama), desc: clean(drama.description).slice(0, 400), eps };
  },
  async play(vid, no) {
    const { table } = await kbEpTable(vid, no);
    const epId = table[no];
    if (epId) return KB_PLAY_PREFIX + epId + '/video.mp4';
    // 兜底: 抓 watch 页面
    const url = KB_SITE + '/zh/watch/' + encodeURIComponent(vid) + '/' + no;
    const html = await httpGet(url, { 'User-Agent': KB_UA, 'Referer': url });
    const m = html && html.match(/https?:\/\/[^\s"'\\]+\.(?:m3u8|mp4)[^\s"'\\]*/i);
    return m ? m[0] : '';
  },
};

/* ================= 平台: 酷我 ================= */
const KW_SITE = 'http://wapi.kuwo.cn/openapi/v1/shortplay';
const KW_PLAY = 'http://nmobi.kuwo.cn/mobi.s';
const KW_UA = 'okhttp/5.1.0';
const KW_CATS = [
  { type_id: '10', type_name: '猜你想看' },
  { type_id: '11', type_name: '土味爱情' },
  { type_id: '12', type_name: '更多精彩' },
  { type_id: '13', type_name: '霸道总裁的人生' },
  { type_id: '14', type_name: '赘婿当道' },
  { type_id: '15', type_name: '漫漫追妻路' },
  { type_id: '16', type_name: '家庭情感' },
];
function kwH() { return { 'User-Agent': KW_UA, 'Accept': 'application/json' }; }
function kwCard(a) {
  if (!a || typeof a !== 'object') return null;
  const vid = String(a.url || '').trim();
  const name = clean(a.title) || clean(a.subTitle);
  if (!vid || !name) return null;
  let remarks = clean(a.currrentDesc);
  if (!remarks) { const n = parseInt(a.songNum, 10) || 0; if (n > 0) remarks = n + '集全'; }
  return { vod_id: 'kuwo:' + vid, vod_name: name, vod_pic: String(a.img || '').trim(), vod_remarks: remarks, vod_class: '酷我短剧' };
}
const kuwo = {
  cats: KW_CATS,
  async list(cat, page) {
    const j = await httpGetJson(KW_SITE + '/moduleMore?currentPage=' + page + '&moduleId=' + encodeURIComponent(cat || '10') + '&rn=12', kwH());
    const items = (j && j.data && Array.isArray(j.data.list)) ? j.data.list : [];
    const seen = new Set();
    const out = [];
    for (const a of items) {
      const c = kwCard(a);
      if (c && !seen.has(c.vod_id)) { seen.add(c.vod_id); out.push(c); }
    }
    return out;
  },
  async search(wd) {
    const out = [], seen = new Set();
    const wl = wd.toLowerCase();
    for (const c of KW_CATS) {
      for (let pg = 1; pg <= 2 && out.length < 30; pg++) {
        const j = await httpGetJson(KW_SITE + '/moduleMore?currentPage=' + pg + '&moduleId=' + c.type_id + '&rn=12', kwH());
        const items = (j && j.data && Array.isArray(j.data.list)) ? j.data.list : [];
        for (const a of items) {
          const card = kwCard(a);
          if (card && !seen.has(card.vod_id) && card.vod_name.toLowerCase().includes(wl)) { seen.add(card.vod_id); out.push(card); }
        }
        if (!items.length) break;
      }
    }
    return out;
  },
  async detail(vid) {
    const j = await httpGetJson(KW_SITE + '/videoList?albumId=' + encodeURIComponent(vid), kwH());
    const data = (j && typeof j.data === 'object' && j.data) || {};
    const info = (typeof data.shortinfo === 'object' && data.shortinfo) || {};
    const eps = [];
    let i = 0;
    for (const it of (Array.isArray(data.list) ? data.list : [])) {
      i++;
      const pay = (it && typeof it.mvpayinfo === 'object' && it.mvpayinfo) || {};
      const vn = String(pay.vid || '').trim();
      if (!vn || vn === '0') continue;
      eps.push({ no: i, name: clean(it.name) || ('第' + i + '集'), url: 'kuwo://' + vid + '/' + vn });
    }
    if (!eps.length) return null;
    return { name: clean(info.title) || vid, pic: String(info.cover || '').trim(), desc: '', eps };
  },
  async play(vid, epvid) {
    const t = await httpGet(KW_PLAY + '?f=web&type=get_url_by_vid&vid=' + encodeURIComponent(epvid), { 'User-Agent': KW_UA });
    if (!t) return '';
    let m = t.match(/^\s*url=(\S+)\s*$/m);
    let media = m ? m[1].trim() : '';
    if (!media) { const i = t.indexOf('url='); if (i >= 0) media = t.slice(i + 4).split(/[\r\n \t]/)[0].trim(); }
    return (media.startsWith('http')) ? media : '';
  },
};

/* ================= 平台: 剧屋(MacCMS) ================= */
const JW_SITE = 'https://www.juwu.tv';
const JW_CATS = [
  { type_id: '1', type_name: '短剧' },
  { type_id: '2', type_name: '情色电影' },
];
function jwH() { return { 'Referer': JW_SITE + '/', 'User-Agent': UA }; }
function jwCleanPic(pic) {
  const s = String(pic || '').trim();
  if (!s) return '';
  let host = '';
  try { host = (new URL(s).hostname || '').toLowerCase(); } catch (e) { return ''; }
  if (!host) return '';
  for (const ph of ['img.test.com', 'huangdouhui.tv']) {
    if (host === ph || host.endsWith('.' + ph)) return '';
  }
  return s;
}
function jwCard(it) {
  if (!it || typeof it !== 'object') return null;
  const vid = String(it.vod_id || '').trim();
  if (!vid) return null;
  return {
    vod_id: 'juwu:' + vid, vod_name: String(it.vod_name || ''), vod_pic: jwCleanPic(it.vod_pic),
    vod_remarks: String(it.vod_remarks || ''), vod_class: String(it.vod_class || ''), vod_content: clean(it.vod_content),
  };
}
async function jwQuery(params) {
  const j = await httpGetJson(JW_SITE + '/api.php/provide/vod/?' + new URLSearchParams(params).toString(), jwH());
  if (!j || j.code !== 1) return [];
  return Array.isArray(j.list) ? j.list : [];
}
function jwPlayEps(raw) {
  let best = [];
  for (const line of String(raw || '').split('$$$')) {
    const eps = [];
    for (const seg of line.split('#')) {
      const di = seg.indexOf('$');
      if (di < 0) continue;
      const addr = seg.slice(di + 1).trim();
      if (addr) eps.push({ name: seg.slice(0, di).trim(), addr });
    }
    if (eps.length > best.length) best = eps;
  }
  return best;
}
const juwu = {
  cats: JW_CATS,
  async list(cat, page) {
    const items = await jwQuery({ ac: 'detail', t: cat || '1', pg: String(page) });
    return items.map(jwCard).filter(Boolean);
  },
  async search(wd) {
    const items = await jwQuery({ ac: 'detail', wd, pg: '1' });
    return items.map(jwCard).filter(Boolean).slice(0, 30);
  },
  async detail(vid) {
    const items = await jwQuery({ ac: 'detail', ids: vid });
    if (!items.length) return null;
    const it = items[0];
    const eps = jwPlayEps(it.vod_play_url).map((e, i) => ({ no: i + 1, name: e.name || ('第' + (i + 1) + '集'), url: 'juwu://' + vid + '/' + (i + 1) }));
    if (!eps.length) return null;
    return { name: String(it.vod_name || ''), pic: jwCleanPic(it.vod_pic), desc: clean(it.vod_content).slice(0, 400), eps };
  },
  async play(vid, no) {
    const items = await jwQuery({ ac: 'detail', ids: vid });
    if (!items.length) return '';
    const eps = jwPlayEps(items[0].vod_play_url);
    const e = eps[no - 1];
    return (e && e.addr.startsWith('http')) ? e.addr : '';
  },
};

/* ================= 平台: 围观 ================= */
const WG_SITE = 'https://api.drama.9ddm.com';
const WG_UA = 'okhttp/4.10.0';
const WG_CATS = [{ type_id: 'all', type_name: '全部' }];
function wgH() { return { 'User-Agent': WG_UA, 'Accept': 'application/json, text/plain, */*', 'Origin': WG_SITE, 'Referer': WG_SITE + '/' }; }
function wgCard(it) {
  if (!it || typeof it !== 'object') return null;
  const vid = String(it.oneId || '').trim();
  const name = clean(it.title);
  if (!vid || !name) return null;
  const count = parseInt(it.episodeCount, 10) || 0;
  return {
    vod_id: 'weiguan:' + vid, vod_name: name,
    vod_pic: String(it.vertPoster || it.horizonPoster || '').trim(),
    vod_remarks: count > 0 ? ('共' + count + '集') : '',
    vod_class: '围观', vod_content: clean(it.description).slice(0, 200),
  };
}
async function wgEpisodes(oneId) {
  const j = await httpGetJson(WG_SITE + '/drama/home/shortVideoDetail?version_code=1000&os_type=1&oneId=' + encodeURIComponent(oneId) + '&page=1&pageSize=1000', wgH());
  if (!j || j.data === undefined || j.data === null || j.data === 'null') return [];
  const arr = Array.isArray(j.data) ? j.data : [j.data];
  return arr.filter(e => e && typeof e === 'object');
}
function wgOrder(ep, index) {
  return (parseInt(ep.playOrder, 10) || parseInt(ep.episode, 10) || (index + 1));
}
function wgPlayUrl(ep) {
  let raw = ep.playSetting !== undefined ? ep.playSetting : ep.videoClarityList;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '';
    try { raw = JSON.parse(t); } catch (e) { return t.startsWith('http') ? t : (String(ep.playUrl || '')); }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const u = pick(raw, 'super', 'high', 'normal', 'url', 'playUrl');
    if (u.startsWith('http')) return u;
  }
  if (Array.isArray(raw)) {
    let best = null;
    for (const it of raw) {
      if (!it || typeof it !== 'object') continue;
      if (!best) best = it;
      const cl = String(it.clarity || '');
      if (['1080P', '1080p', 'super', '超清'].includes(cl)) best = it;
    }
    if (best) { const u = pick(best, 'url', 'playUrl'); if (u.startsWith('http')) return u; }
  }
  const u = String(ep.playUrl || '');
  return u.startsWith('http') ? u : '';
}
const weiguan = {
  cats: WG_CATS,
  async list(cat, page) {
    const j = await httpPostJson(WG_SITE + '/drama/home/search?version_code=1500&os_type=1',
      { audience: '全部受众', page, pageSize: 30, searchWord: '', subject: '全部主题' }, wgH());
    const arr = (j && Array.isArray(j.data)) ? j.data : [];
    const seen = new Set();
    const out = [];
    for (const it of arr) { const c = wgCard(it); if (c && !seen.has(c.vod_id)) { seen.add(c.vod_id); out.push(c); } }
    return out;
  },
  async search(wd) {
    const j = await httpPostJson(WG_SITE + '/drama/home/search?version_code=1500&os_type=1',
      { audience: '全部受众', page: 1, pageSize: 30, searchWord: wd, subject: '全部主题' }, wgH());
    const arr = (j && Array.isArray(j.data)) ? j.data : [];
    return arr.map(wgCard).filter(Boolean).slice(0, 30);
  },
  async detail(vid) {
    const items = await wgEpisodes(vid);
    if (!items.length) return null;
    const first = items[0];
    const eps = [];
    const seen = new Set();
    items.forEach((ep, i) => {
      const order = wgOrder(ep, i);
      if (seen.has(order)) return;
      seen.add(order);
      eps.push({ no: order, name: '第' + order + '集', url: 'weiguan://' + vid + '/' + order });
    });
    eps.sort((a, b) => a.no - b.no);
    if (!eps.length) return null;
    return {
      name: clean(first.title) || vid, pic: String(first.vertPoster || first.horizonPoster || ''),
      desc: clean(pick(first, 'description', 'desc')).slice(0, 400), eps,
    };
  },
  async play(vid, no) {
    const items = await wgEpisodes(vid);
    for (let i = 0; i < items.length; i++) {
      if (wgOrder(items[i], i) === no) return wgPlayUrl(items[i]);
    }
    return '';
  },
};

/* ================= 路由 ================= */
const PLATS = { chengguo: cg, qixing, xingya, kuangbiao, kuwo, juwu, weiguan };
const PLAT_LIST = [
  { key: 'chengguo', name: '橙果' },
  { key: 'qixing', name: '七星' },
  { key: 'xingya', name: '星芽' },
  { key: 'kuangbiao', name: '狂飙' },
  { key: 'kuwo', name: '酷我' },
  { key: 'juwu', name: '剧屋' },
  { key: 'weiguan', name: '围观' },
];
function platCats(key) { return PLATS[key].cats.map(c => ({ type_id: c.type_id, type_name: c.type_name })); }
function splitId(id) {
  const s = String(id || '');
  const i = s.indexOf(':');
  if (i > 0 && PLATS[s.slice(0, i)]) return [s.slice(0, i), s.slice(i + 1)];
  return ['chengguo', s];
}
function parseEpToken(tok) {
  // 形如 qixing://4739/1
  const m = String(tok || '').match(/^([a-z0-9_]+):\/\/(.+)$/);
  if (!m || !PLATS[m[1]]) return null;
  const rest = m[2];
  const cut = rest.lastIndexOf('/');
  if (cut <= 0) return null;
  const no = parseInt(rest.slice(cut + 1), 10);
  if (!no) return null;
  return { plat: m[1], vid: rest.slice(0, cut), no };
}
const PLAY_UA_HEADERS = {
  chengguo: { 'Referer': CG_SITE + '/', 'User-Agent': UA },
  qixing: { 'User-Agent': QX_UA },
  xingya: { 'Referer': XY_SITE + '/', 'User-Agent': 'okhttp/4.10.0' },
  kuangbiao: { 'User-Agent': KB_UA, 'Referer': KB_SITE + '/zh/' },
  kuwo: { 'User-Agent': KW_UA },
  juwu: { 'Referer': JW_SITE + '/', 'User-Agent': UA },
  weiguan: { 'User-Agent': WG_UA, 'Referer': WG_SITE + '/' },
};

/* ================= 接口 ================= */
async function init() { return {}; }

async function home() {
  const filters = {};
  for (const p of PLAT_LIST) {
    const cats = platCats(p.key);
    if (cats.length > 1) {
      filters[p.key] = [{ key: 'class', name: '分类', value: cats.map(c => ({ n: c.type_name, v: c.type_id })) }];
    }
  }
  return {
    class: PLAT_LIST.map(p => ({ type_id: p.key, type_name: p.name })),
    filters,
  };
}

async function homeVod() {
  try {
    const list = await kuwo.list('10', 1);
    return { list: list.slice(0, 12) };
  } catch (e) { return { list: [] }; }
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.tid || body.id || 'chengguo');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const plat = PLATS[tid] || cg;
  const pkey = PLATS[tid] ? tid : 'chengguo';
  const cats = platCats(pkey);
  const sub = String((body.extend && body.extend.class) || body.class || cats[0].type_id);
  const valid = cats.some(c => c.type_id === sub) ? sub : cats[0].type_id;
  let list = [];
  try { list = await plat.list(valid, page); } catch (e) {}
  return { page, pagecount: list.length >= 12 ? page + 1 : page, limit: list.length, total: 9999, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const [pkey, vid] = splitId(body.id);
  if (!vid) return { list: [] };
  let d = null;
  try { d = await PLATS[pkey].detail(vid); } catch (e) {}
  if (!d || !d.eps || !d.eps.length) return { list: [] };
  return {
    list: [{
      vod_id: pkey + ':' + vid,
      vod_name: d.name,
      vod_pic: d.pic || '',
      vod_content: d.desc || '',
      vod_remarks: '共' + d.eps.length + '集',
      vod_play_from: (PLAT_LIST.find(p => p.key === pkey) || {}).name || NAME,
      vod_play_url: d.eps.map(e => e.name + '$' + e.url).join('#'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(body.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const ep = parseEpToken(id);
  if (!ep) {
    // 兜底: 直接 http 媒体
    if (/^https?:\/\//i.test(id)) return { parse: 0, url: id, header: { 'User-Agent': UA } };
    return { parse: 1, url: '', header: {} };
  }
  let url = '';
  try { url = await PLATS[ep.plat].play(ep.vid, ep.no); } catch (e) {}
  if (!url || !/^https?:\/\//i.test(url)) return { parse: 1, url: '', header: {} };
  return { parse: 0, url, header: PLAY_UA_HEADERS[ep.plat] || { 'User-Agent': UA } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  if (!wd) return { page: 1, pagecount: 1, limit: 0, total: 0, list: [] };
  const out = [];
  const seen = new Set();
  const jobs = ['chengguo', 'qixing', 'xingya', 'kuangbiao', 'kuwo', 'juwu', 'weiguan'].map(async (k) => {
    try {
      const r = await PLATS[k].search(wd);
      return (r || []).slice(0, 10);
    } catch (e) { return []; }
  });
  const results = await Promise.all(jobs);
  for (const arr of results) for (const c of arr) {
    if (c && !seen.has(c.vod_id)) { seen.add(c.vod_id); out.push(c); }
  }
  return { page: 1, pagecount: 1, limit: out.length, total: out.length, list: out.slice(0, 60) };
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
