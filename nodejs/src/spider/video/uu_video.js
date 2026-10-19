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
  const { token, returnPath } = challengeData[0];

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

  // 6. POST 验证（form-urlencoded 到 returnPath）
  const body = '__viewChallenge=' + encodeURIComponent(JSON.stringify(powResult));
  const postUrl = `${HOST}${returnPath}`;
  const { headers: rh } = await httpPost(postUrl, body, {
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

// 调用 API（自动处理验证和解密）
async function apiCall(apiPath, params = {}) {
  const cookie = await ensureCookie();
  const query = new URLSearchParams(params).toString();
  
  for (const base of API_HOSTS) {
    const url = `${base}${apiPath}${query ? '?' + query : ''}`;
    try {
      const { text } = await httpGet(url, {
        'Cookie': cookie,
        'Referer': HOST + '/',
        'Accept': 'application/json',
      });
      if (!text) continue;
      const resp = JSON.parse(text);
      if (resp.code !== 200) continue;
      if (!resp.data) return null;
      // 解密
      const decrypted = xorDecrypt(resp.data, resp.key || '');
      return decrypted;
    } catch {
      continue;
    }
  }
  return null;
}

// 分类缓存
let _categories = null;

async function getCategories() {
  if (_categories) return _categories;
  const data = await apiCall('/api/v2/home/public/video/cate/list', { type: 'long' });
  if (data && data.list) {
    _categories = data.list.map(c => ({
      type_id: String(c.id),
      type_name: c.title || c.name,
    }));
    return _categories;
  }
  // 降级：硬编码
  return [
    { type_id: '262', type_name: '国产' },
    { type_id: '263', type_name: '日本AV' },
    { type_id: '343', type_name: 'AV无码' },
    { type_id: '344', type_name: 'AV中字' },
    { type_id: '264', type_name: '欧美' },
    { type_id: '267', type_name: '动漫' },
    { type_id: '341', type_name: '三级' },
    { type_id: '342', type_name: 'AI换脸' },
    { type_id: '360', type_name: '探花' },
    { type_id: '358', type_name: '麻豆' },
    { type_id: '356', type_name: '擦边短剧' },
    { type_id: '347', type_name: '黑料' },
    { type_id: '266', type_name: '传媒' },
    { type_id: '345', type_name: '女主播' },
    { type_id: '346', type_name: 'VR' },
  ];
}

function formatVideo(v) {
  // thumb 是 .enc 加密，暂时直接用（可能显示不出）
  // href 是 m3u8 相对路径，需要 CDN 前缀
  return {
    vod_id: String(v.id),
    vod_name: v.title || '',
    vod_pic: v.thumb ? `https://aa3.aa36jn.com:52000${v.thumb}` : '',
    vod_remarks: v.classifyTitles || '',
  };
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cats = await getCategories();
  // 首页用第一个分类的列表
  const firstCat = cats[0];
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
  const tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cats = await getCategories();
  const cat = cats.find(c => c.type_id === tid) || cats[0];
  
  const data = await apiCall('/api/v2/home/public/video/list', {
    page: String(page), limit: '20', type: 'cate', typeId: cat.type_id, videoType: 'long',
  });
  const list = data && data.list ? data.list.map(formatVideo) : [];
  const total = data?.total || 0;
  return {
    page,
    pagecount: Math.ceil(total / 20) || 1,
    limit: 20,
    total,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const vodId = String(raw).trim();
    const data = await apiCall('/api/v2/home/public/video/long/detail', { id: vodId });
    if (!data) continue;
    
    // 播放地址：href 是相对路径，需要 CDN
    // 暂时尝试用 API host，实际 CDN 待确认
    let playUrl = '';
    if (data.href) {
      // href 如 /m3u8_video/go/20261018/44365/play.m3u8
      // 需要找到视频 CDN，暂时用占位
      playUrl = data.href;
    }
    
    list.push({
      vod_id: vodId,
      vod_name: data.title || '',
      vod_pic: data.thumb || '',
      vod_content: (data.content || '').replace(/<[^>]+>/g, '').trim(),
      vod_play_from: 'Uu视频',
      vod_play_url: playUrl ? `正片$${playUrl}` : '',
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
  
  // 如果是相对路径，尝试补全 CDN
  // 注意：视频 CDN 待确认，这里先返回相对路径让 MiraPlayer 尝试
  if (id.startsWith('/')) {
    // 尝试用 API host（可能不行，需要真实 CDN）
    return { parse: 0, url: id, header: { Referer: HOST + '/', 'User-Agent': UA } };
  }
  
  return { parse: 0, url: id };
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
