// Uu视频 - MiraPlayer Spider (API版)
// 站点: https://nfu.rftsln9.com (入口 https://utv2.cc)
// 原理: 逆向 JS PoW 验证 (FNV-1a) → 获取 vv_challenge cookie → 调用 JSON API
// API: https://aa3.aa36jn.com:52000/api/v2/home/public/video/...
// 响应解密: XOR (key 来自响应)
// 请求: 双通道 — 先框架 req(axios)，失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_uuvideo';
const NAME = 'Uu视频';
const HOST = 'https://nfu.rftsln9.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// API 服务器列表（从站点 JS 逆向得到）
const API_HOSTS = [
  'https://aa3.aa36jn.com:52000',
  'https://zje.zje0cx.com:52000',
  'https://hlo.hlos8o.com:52000',
  'https://iv4.iv4muy.com:51999',
];

// Cloudflare Worker 代理（解决 .enc 封面和视频 CDN 问题）
// 部署后填入 Worker 域名，如 'https://uu-proxy.xxx.workers.dev'
// 为空时降级为直连（封面可能不显示、播放走嗅探）
const WORKER_HOST = 'https://uu-proxy.li768435813.workers.dev';

// Cookie 缓存
let _cookie = '';
let _cookieTime = 0;
const COOKIE_TTL = 25 * 60 * 1000; // 25分钟

function t(v) {
  return String(v == null ? '' : v).trim();
}

// FNV-1a 哈希（与站点 JS 完全一致）
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  // 转为 8 位 hex（无符号）
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

// Base64URL 解码
function b64urlDecode(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  // Node 和浏览器兼容
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64');
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// XOR 解密 API 响应
function xorDecrypt(dataB64, keyStr) {
  const dataBytes = b64urlDecode(dataB64);
  const keyBytes = new TextEncoder().encode(keyStr);
  const out = new Uint8Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) {
    out[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  const text = new TextDecoder().decode(out);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// 通用 HTTP 请求（双通道）
async function httpGet(url, headers = {}) {
  const h = { 'User-Agent': UA, ...headers };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: 20000, responseType: 'text' });
    if (status === 200) return { text: String(data || ''), headers: {} };
  } catch { /* 通道2 */ }
  // 通道2: fetch
  try {
    if (typeof fetch === 'undefined') return { text: '', headers: {} };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(url, { signal: ctrl.signal, headers: h });
    clearTimeout(timer);
    if (!r.ok) return { text: '', headers: {} };
    const text = await r.text();
    const rh = {};
    r.headers.forEach((v, k) => { rh[k.toLowerCase()] = v; });
    return { text, headers: rh };
  } catch {
    return { text: '', headers: {} };
  }
}

async function httpPost(url, body, headers = {}) {
  const h = { 'User-Agent': UA, ...headers };
  // 通道1: 框架 req
  try {
    const { data, status, headers: rh } = await req.post(url, body, { headers: h, timeout: 20000, responseType: 'text' });
    if (status === 200) return { text: String(data || ''), headers: rh || {}, status };
  } catch { /* 通道2 */ }
  // 通道2: fetch
  try {
    if (typeof fetch === 'undefined') return { text: '', headers: {}, status: 0 };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(url, { method: 'POST', body, signal: ctrl.signal, headers: h });
    clearTimeout(timer);
    const text = await r.text();
    const rh = {};
    r.headers.forEach((v, k) => { rh[k.toLowerCase()] = v; });
    return { text, headers: rh, status: r.status };
  } catch {
    return { text: '', headers: {}, status: 0 };
  }
}

// 求解 PoW 并获取 vv_challenge cookie
async function ensureCookie() {
  if (_cookie && Date.now() - _cookieTime < COOKIE_TTL) return _cookie;

  // 1. 获取挑战页
  const challengeUrl = `${HOST}/videos/more?blockId=2&blockType=hot`;
  const { text: html } = await httpGet(challengeUrl, { Referer: HOST + '/' });
  if (!html || html.length < 5000 || !html.includes('正在验证')) {
    // 可能已经有有效 cookie 或站点变化
    if (_cookie) return _cookie;
    throw new Error('获取挑战页失败');
  }

  // 2. 提取并解码挑战数据
  const scriptMatch = html.match(/var _\w+=\["([^"]+)","([A-Za-z0-9_-]+)"\]/);
  if (!scriptMatch) throw new Error('挑战数据提取失败');
  const b64 = scriptMatch[1];
  const key = scriptMatch[2];

  // 找到最长的 script（主验证逻辑）
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const mainScript = scripts.reduce((a, b) => (a.length > b.length ? a : b), '');
  const m2 = mainScript.match(/var _\w+=\["([^"]+)","([A-Za-z0-9_-]+)"\]/);
  if (!m2) throw new Error('主挑战数据提取失败');

  const b64d = m2[1];
  const keyd = m2[2];
  const decoded = b64urlDecode(b64d);
  const keyBytes = new TextEncoder().encode(keyd);
  // 逆序 XOR（站点 JS 用倒序循环）
  const arr = new Uint8Array(decoded.length);
  for (let i = decoded.length - 1; i >= 0; i--) {
    arr[i] = decoded[i] ^ keyBytes[i % keyBytes.length];
  }
  const jsonText = new TextDecoder().decode(arr);
  const challengeData = JSON.parse(jsonText);
  const { token, postUrl, returnPath } = challengeData[0];

  // 3. 解析 JWT payload
  const payloadB64 = token.split('.')[0];
  const payloadJson = new TextDecoder().decode(b64urlDecode(payloadB64));
  const payload = JSON.parse(payloadJson);
  const { seed, difficulty, maxIterations } = payload;

  // 4. 求解 PoW
  const target = '0'.repeat(difficulty);
  let proof = -1;
  for (let i = 0; i < maxIterations; i++) {
    if (fnv1a(`${seed}|${i}`).startsWith(target)) {
      proof = i;
      break;
    }
  }
  if (proof < 0) throw new Error('PoW 求解失败');

  // 5. 构造 meta 和 key
  const meta = {
    ua: UA,
    lang: 'zh-CN',
    tz: 'Asia/Shanghai',
    screen: '1920x1080',
    webdriver: false,
    framed: false,
  };
  const proofKey = fnv1a([token, meta.ua, meta.lang, meta.tz, meta.screen, String(proof)].join('|'));
  const powResult = { token, proof, meta, path: returnPath, key: proofKey };

  // 6. POST 验证（form-urlencoded 到 postUrl，即 /_view/challenge）
  const body = '__viewChallenge=' + encodeURIComponent(JSON.stringify(powResult));
  const verifyUrl = `${HOST}${postUrl || '/_view/challenge'}`;
  const { headers: rh } = await httpPost(verifyUrl, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'Referer': challengeUrl,
    'Cache-Control': 'no-store',
  });

  // 7. 提取 cookie
  let cookieStr = '';
  if (rh) {
    const sc = rh['set-cookie'] || rh['Set-Cookie'] || '';
    const mCookie = String(sc).match(/vv_challenge=([^;]+)/);
    if (mCookie) cookieStr = `vv_challenge=${mCookie[1]}`;
  }
  if (!cookieStr) throw new Error('未获取到验证 cookie');

  _cookie = cookieStr;
  _cookieTime = Date.now();
  return _cookie;
}

// 调用 API（API 服务器无需 PoW cookie，直接调用；自动 XOR 解密）
async function apiCall(apiPath, params = {}) {
  const query = new URLSearchParams(params).toString();

  for (const base of API_HOSTS) {
    const url = `${base}${apiPath}${query ? '?' + query : ''}`;
    try {
      const { text } = await httpGet(url, {
        'Referer': HOST + '/',
        'Accept': 'application/json',
      });
      if (!text) continue;
      const resp = JSON.parse(text);
      if (resp.code !== 200) continue;
      if (!resp.data) return null;
      // XOR 解密（key 来自响应）
      const decrypted = xorDecrypt(resp.data, resp.key || '');
      return decrypted;
    } catch {
      continue;
    }
  }
  return null;
}

// 指纹登录 token 缓存
let _accessToken = '';
let _tokenTime = 0;
const TOKEN_TTL = 30 * 60 * 1000; // 30分钟（服务端 accessTokenTtl=1860秒）

// CDN 列表缓存
let _cdnList = null;

// 生成随机指纹（md5(uuid)）
function genFingerprint() {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  // 简单 md5 实现（FNV 不行，需要 md5；用已有 fnv1a 扩展不够，这里用固定算法）
  // 为简化：直接用 32 位 hex 随机串作为 fingerPrint（实测服务端接受）
  return s;
}

// 指纹登录获取 accessToken
async function ensureAccessToken() {
  if (_accessToken && Date.now() - _tokenTime < TOKEN_TTL) return _accessToken;
  const fp = genFingerprint();
  const body = JSON.stringify({ channel: 'tz', fingerPrint: fp });
  for (const base of API_HOSTS) {
    try {
      const { text } = await httpPost(`${base}/api-user/v2/login/fingerprint`, body, {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Referer': HOST + '/',
      });
      if (!text) continue;
      const resp = JSON.parse(text);
      if (resp.code !== 200) continue;
      let data = resp.data;
      if (typeof data === 'string' && data) {
        try { data = xorDecrypt(data, resp.key || ''); } catch { continue; }
      }
      const tk = data && (data.accessToken || data.token);
      if (tk) {
        _accessToken = tk;
        _tokenTime = Date.now();
        return _accessToken;
      }
    } catch { continue; }
  }
  throw new Error('指纹登录失败');
}

// 获取视频 CDN 列表（站点渠道配置）
async function getCdnList() {
  if (_cdnList) return _cdnList;
  try {
    const data = await apiCall('/api/v2/home/public/aed/site/channel', { channel: 'tz' });
    if (data && Array.isArray(data.videoUrlCdns) && data.videoUrlCdns.length > 0) {
      _cdnList = data.videoUrlCdns;
      return _cdnList;
    }
  } catch { /* 降级 */ }
  // 降级：硬编码（2026-10-19 从配置实测）
  _cdnList = [
    'https://m338.xn--d9u11dw2l41at78afwi.xn--fiqs8s',
    'https://fqu.fquauf.com:51666',
    'https://vte.vteotx.com:51666',
    'https://i1t.i1tyqh.com:51666',
    'https://tmm.tmmr4x.com:51888',
  ];
  return _cdnList;
}

// 调用需要鉴权的 API
async function apiCallAuth(apiPath, params = {}) {
  const token = await ensureAccessToken();
  const query = new URLSearchParams(params).toString();
  for (const base of API_HOSTS) {
    const url = `${base}${apiPath}${query ? '?' + query : ''}`;
    try {
      const { text } = await httpGet(url, {
        'Referer': HOST + '/',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token,
      });
      if (!text) continue;
      const resp = JSON.parse(text);
      if (resp.code !== 200) {
        // token 可能过期，重试一次
        if (resp.code === 401) { _accessToken = ''; }
        continue;
      }
      if (resp.data == null) return null;
      if (typeof resp.data === 'string' && resp.data) {
        return xorDecrypt(resp.data, resp.key || '');
      }
      return resp.data;
    } catch { continue; }
  }
  return null;
}

// 分类缓存
let _categories = null;

async function getCategories() {
  if (_categories) return _categories;
  // 用户要求隐藏的分类（2026-10-19）：探花360、新闻357、VR346、其他269
  const HIDDEN = new Set(['360', '357', '346', '269']);
  try {
    const data = await apiCall('/api/v2/home/public/video/cate/list', { type: 'long' });
    if (data && data.list && data.list.length > 0) {
      _categories = data.list
        .map(c => ({
          type_id: String(c.id),
          type_name: c.title || c.name,
        }))
        .filter(c => !HIDDEN.has(c.type_id));
      return _categories;
    }
  } catch { /* 降级到硬编码 */ }
  // 降级：硬编码（2026-10-19 从 API 实测，已剔除隐藏的 4 个分类）
  _categories = [
    { type_id: '268', type_name: '热门' },
    { type_id: '262', type_name: '国产' },
    { type_id: '263', type_name: '日本AV' },
    { type_id: '343', type_name: 'AV无码' },
    { type_id: '344', type_name: 'AV中字' },
    { type_id: '264', type_name: '欧美' },
    { type_id: '267', type_name: '动漫' },
    { type_id: '341', type_name: '三级' },
    { type_id: '342', type_name: 'AI换脸' },
    { type_id: '358', type_name: '麻豆' },
    { type_id: '356', type_name: '擦边短剧' },
    { type_id: '347', type_name: '黑料' },
    { type_id: '266', type_name: '传媒' },
    { type_id: '345', type_name: '女主播' },
  ];
  return _categories;
}

function formatVideo(v) {
  // thumb 是 .enc 加密文件（如 ..._compress.jpg.enc），只在主站（需 PoW）
  // 有 Worker 时走 /uuimg 代理；无 Worker 时降级为去 .enc 后缀直连（可能不显示）
  let pic = '';
  if (v.thumb) {
    const encUrl = `${HOST}${v.thumb}`;
    pic = WORKER_HOST
      ? `${WORKER_HOST}/uuimg?url=${encodeURIComponent(encUrl)}`
      : `${HOST}${String(v.thumb).replace(/\.enc$/, '')}`;
  }
  return {
    vod_id: String(v.id),
    vod_name: v.title || '',
    vod_pic: pic,
    vod_remarks: v.classifyTitles || v.labelTitles || '',
  };
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cats = await getCategories();
  // 首页用第一个有内容的分类，优先用 国产262
  const firstCat = cats.find(c => c.type_id === '262') || cats[0];
  const data = await apiCall('/api/v2/home/public/video/list', {
    page: '1', limit: '20', type: 'cate', typeId: firstCat.type_id, videoType: 'long',
  });
  const list = data && data.list ? data.list.map(formatVideo) : [];
  return {
    class: cats.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    list,
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  // 兼容 MiraPlayer 传参：id 或 tid
  const tid = String(body.tid || body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cats = await getCategories();
  const cat = cats.find(c => c.type_id === tid) || cats[0];
  
  const data = await apiCall('/api/v2/home/public/video/list', {
    page: String(page), limit: '20', type: 'cate', typeId: cat.type_id, videoType: 'long',
  });
  const total = data?.total || 0;
  // 防御：请求的页超出总数时直接返回空（API 对超页会返回第1页重复内容，如热门分类）
  if (total > 0 && (page - 1) * 20 >= total) {
    return { page, pagecount: Math.ceil(total / 20) || 1, limit: 20, total, list: [] };
  }
  const list = data && data.list ? data.list.map(formatVideo) : [];
  return {
    page,
    pagecount: Math.ceil(total / 20) || 1,
    limit: 20,
    total,
    list,
  };
}

async function detail(reqIn) {
  // 兼容 id 数组或单个，兼容 tid
  const rawIds = reqIn?.body?.id ?? reqIn?.body?.tid;
  const ids = Array.isArray(rawIds) ? rawIds : [rawIds];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const vodId = String(raw).trim();
    const data = await apiCall('/api/v2/home/public/video/long/detail', { id: vodId });
    if (!data) continue;

    // 播放地址由 play() 通过播放地址 API 实时获取（指纹登录 → masterUrl + CDN 拼接）
    // 这里只传视频 id，play() 会处理
    let pic = '';
    if (data.thumb) {
      const encUrl = `${HOST}${data.thumb}`;
      pic = WORKER_HOST
        ? `${WORKER_HOST}/uuimg?url=${encodeURIComponent(encUrl)}`
        : `${HOST}${String(data.thumb).replace(/\.enc$/, '')}`;
    }

    list.push({
      vod_id: vodId,
      vod_name: data.title || '',
      vod_pic: pic,
      vod_content: (data.content || '').replace(/<[^>]+>/g, '').trim(),
      vod_play_from: 'Uu视频',
      vod_play_url: `正片$${vodId}`,
    });
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();

  // 如果已经是完整 URL，直接返回
  if (/^https?:\/\//i.test(id)) {
    return { parse: 0, url: id, header: { Referer: HOST + '/', 'User-Agent': UA } };
  }

  // 相对路径（如 /m3u8_video/go/...）走 Worker 代理或嗅探（兼容旧逻辑）
  if (id.startsWith('/')) {
    if (WORKER_HOST) {
      const workerUrl = `${WORKER_HOST}/uuvideo?url=${encodeURIComponent(id)}`;
      return { parse: 0, url: workerUrl, header: { Referer: HOST + '/', 'User-Agent': UA } };
    }
    const fullUrl = `${API_HOSTS[0]}${id}`;
    return { parse: 1, url: fullUrl, header: { Referer: HOST + '/', 'User-Agent': UA } };
  }

  // 数字 id：走播放地址 API（指纹登录 → /api/v2/home/user/video/play/url）
  // 返回 masterUrl(相对路径) + CDN 拼接 = 完整 m3u8 直链，parse:0
  try {
    const playData = await apiCallAuth('/api/v2/home/user/video/play/url', { id });
    if (playData) {
      const relUrl = playData.masterUrl || playData.p720Url || playData.p480Url || '';
      if (relUrl) {
        const cdns = await getCdnList();
        // cdnId 提示用哪个 CDN；默认用第一个
        let cdnIdx = 0;
        const cdnIdMatch = String(relUrl).match(/cdnId=(\d+)/);
        if (cdnIdMatch) {
          const cid = parseInt(cdnIdMatch[1], 10);
          if (cid >= 0 && cid < cdns.length) cdnIdx = cid;
        }
        const fullUrl = cdns[cdnIdx].replace(/\/$/, '') + relUrl;
        return { parse: 0, url: fullUrl, header: { Referer: HOST + '/', 'User-Agent': UA } };
      }
    }
  } catch (e) {
    // 降级：返回空，让前端提示
  }

  return { parse: 0, url: '' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: 1, limit: 20, total: 0, list: [] };
  
  const data = await apiCall('/api/v2/home/public/video/search', {
    page: String(page), limit: '20', keyword: wd, videoType: 'long',
  });
  const list = data && (data.list || data.data) ? (data.list || data.data).map(formatVideo) : [];
  return { page, pagecount: 1, limit: 20, total: list.length, list };
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
