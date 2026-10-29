// Uu视频 - MiraPlayer Spider (API版)
// 站点: https://nfu.rftsln9.com (入口 https://utv2.cc)
// 原理: 逆向 JS PoW 验证 (FNV-1a) → 获取 vv_challenge cookie → 调用 JSON API
// API: https://aa3.aa36jn.com:52000/api/v2/home/public/video/...
// 响应解密: XOR (key 来自响应)
// 封面: 官方签名接口 POST /api/v2/home/user/cdn/sign（需指纹登录）→ https://pps.aiide.online/...enc.js（内容为真实 JPEG）
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

// Cloudflare Worker 代理（视频 CDN 代理；封面已改走官方签名直链，不再需要 /uuimg）
// 部署后填入 Worker 域名，如 'https://uu-proxy.xxx.workers.dev'
// 为空时降级为直连
const WORKER_HOST = 'https://uu-proxy.li768435813.workers.dev';

// 图片 CDN 配置缓存（从站点 API 获取：picUrl + bucket）
let _imgCdn = null;
async function getImgCdn() {
  if (_imgCdn) return _imgCdn;
  try {
    const data = await apiCall('/api/v2/home/public/cdn/image/index', { channel: 'tz' });
    if (data && Array.isArray(data.list) && data.list.length > 0) {
      const line = data.list.find(l => l.picVideoUrl || l.picUrl) || data.list[0];
      const pic = String(line.picVideoUrl || line.picUrl || '').replace(/\/+$/, '');
      const bucket = String(line.bucket || '').replace(/^\/+|\/+$/g, '');
      if (pic && bucket) {
        let origin = pic;
        try { origin = new URL(pic).origin; } catch { /* 用原值 */ }
        _imgCdn = { origin, bucket };
        return _imgCdn;
      }
    }
  } catch { /* 降级 */ }
  _imgCdn = { origin: 'https://pps.aiide.online', bucket: 'encryption-ts' };
  return _imgCdn;
}

// 批量签名封面图（POST /api/v2/home/user/cdn/sign，需 accessToken）
// thumbs: ['/uploads/file/20261019/xxx_compress.jpg.enc', ...]
// 返回 Map: thumb -> 完整可访问的签名 URL
async function signImages(thumbs) {
  const result = new Map();
  const uniq = [...new Set((thumbs || []).map(t).filter(Boolean))];
  if (uniq.length === 0) return result;
  const cdn = await getImgCdn();
  // 构造签名 path：与前端逻辑一致 → `{bucket}/{thumb去前导斜杠}.js`
  const pathMap = new Map(); // signPath -> thumb
  const signPaths = [];
  for (const th of uniq) {
    // thumb 可能是相对路径或完整 URL，只取路径部分
    let clean = th;
    try {
      if (/^https?:\/\//i.test(th)) clean = new URL(th).pathname;
    } catch { /* 保持原值 */ }
    clean = String(clean).replace(/^\/+/, '');
    // 去掉可能已有的 bucket 前缀，避免重复
    if (clean.startsWith(cdn.bucket + '/')) clean = clean.slice(cdn.bucket.length + 1);
    const sp = clean.endsWith('.js') ? `${cdn.bucket}/${clean}` : `${cdn.bucket}/${clean}.js`;
    pathMap.set(sp, th);
    signPaths.push(sp);
  }
  let token = '';
  try { token = await ensureAccessToken(); } catch { return result; }
  for (const base of API_HOSTS) {
    try {
      const { text } = await httpPost(`${base}/api/v2/home/user/cdn/sign`,
        JSON.stringify({ paths: signPaths }),
        {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Referer': HOST + '/',
          'Authorization': 'Bearer ' + token,
        });
      if (!text) continue;
      const resp = JSON.parse(text);
      if (resp.code !== 200) {
        if (resp.code === 401) { _accessToken = ''; token = await ensureAccessToken().catch(() => ''); }
        continue;
      }
      if (resp.data == null) continue;
      let data = resp.data;
      if (typeof data === 'string' && data) {
        try { data = xorDecrypt(data, resp.key || ''); } catch { continue; }
      }
      if (data && Array.isArray(data.list)) {
        for (const item of data.list) {
          const th = pathMap.get(item.path);
          if (th && item.url) {
            result.set(th, `${cdn.origin}/${String(item.url).replace(/^\/+/, '')}`);
          }
        }
        return result;
      }
    } catch { continue; }
  }
  return result;
}

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
  let token = await ensureAccessToken();
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
        // token 过期：清缓存、重新登录、用新 token 重试该 host 一次（旧写法 continue 后仍用旧 token 试剩下 host，必然全败）
        if (resp.code === 401) {
          _accessToken = '';
          token = await ensureAccessToken().catch(() => '');
          if (token) {
            try {
              const retry = await httpGet(url, {
                'Referer': HOST + '/',
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + token,
              });
              if (retry.text) {
                const resp2 = JSON.parse(retry.text);
                if (resp2.code === 200 && resp2.data != null) {
                  if (typeof resp2.data === 'string' && resp2.data) return xorDecrypt(resp2.data, resp2.key || '');
                  return resp2.data;
                }
              }
            } catch (e2) { /* 重试失败则继续下一 host */ }
          }
        }
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
  // thumb 是 .enc 加密图，封面地址由 fillPics() 批量签名后填入
  return {
    vod_id: String(v.id),
    vod_name: v.title || '',
    vod_pic: '',
    vod_remarks: v.classifyTitles || v.labelTitles || '',
    _thumb: t(v.thumb),
  };
}

// 批量签名并填入封面（列表页调用一次，20 张图一次签名请求）
async function fillPics(list) {
  const thumbs = list.map(v => v._thumb).filter(Boolean);
  const signed = await signImages(thumbs);
  for (const v of list) {
    if (v._thumb) v.vod_pic = signed.get(v._thumb) || '';
    delete v._thumb;
  }
  return list;
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
  const list = data && data.list ? await fillPics(data.list.map(formatVideo)) : [];
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

  // 热门(268) 用 type=hot 接口（851条，可翻页）；用 type=cate+typeId=268 只能拿到20条
  // 站点前端 type 参数可选值：cate/label/collect/last/hot/good（从前端 JS 逆向）
  let params;
  if (cat.type_id === '268') {
    params = { page: String(page), limit: '20', type: 'hot', videoType: 'long' };
  } else {
    params = { page: String(page), limit: '20', type: 'cate', typeId: cat.type_id, videoType: 'long' };
  }

  const data = await apiCall('/api/v2/home/public/video/list', params);
  const total = data?.total || 0;
  // 防御：请求的页超出总数时直接返回空（API 对超页会返回第1页重复内容）
  if (total > 0 && (page - 1) * 20 >= total) {
    return { page, pagecount: Math.ceil(total / 20) || 1, limit: 20, total, list: [] };
  }
  const list = data && data.list ? await fillPics(data.list.map(formatVideo)) : [];
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
    // 封面走官方签名接口批量签名
    const thumbs = data.thumb ? [t(data.thumb)] : [];
    const signed = await signImages(thumbs);

    const vod = {
      vod_id: vodId,
      vod_name: data.title || '',
      vod_pic: data.thumb ? (signed.get(t(data.thumb)) || '') : '',
      vod_content: (data.content || '').replace(/<[^>]+>/g, '').trim(),
      vod_play_from: 'Uu视频',
      vod_play_url: `自动$${vodId}#720p$${vodId}@720p#480p$${vodId}@480p`,
    };
    subRegister(vodId, vod);
    list.push(vod);
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  // 档位后缀（detail 三集用 @ 编码）：播放地址 API 只认纯数字 id，须先剥离；字幕键也用干净 id
  let quality = '';
  const qm = id.match(/@(720p|480p)$/);
  if (qm) { quality = qm[1]; id = id.slice(0, -qm[0].length); }
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);

  // 如果已经是完整 URL，直接返回
  if (/^https?:\/\//i.test(id)) {
    return subAttach({ parse: 0, url: id, header: { Referer: HOST + '/', 'User-Agent': UA } }, subsP);
  }

  // 相对路径（如 /m3u8_video/go/...）走 Worker 代理或嗅探（兼容旧逻辑）
  if (id.startsWith('/')) {
    if (WORKER_HOST) {
      const workerUrl = `${WORKER_HOST}/uuvideo?url=${encodeURIComponent(id)}`;
      return subAttach({ parse: 0, url: workerUrl, header: { Referer: HOST + '/', 'User-Agent': UA } }, subsP);
    }
    const fullUrl = `${API_HOSTS[0]}${id}`;
    return subAttach({ parse: 1, url: fullUrl, header: { Referer: HOST + '/', 'User-Agent': UA } }, subsP);
  }

  // 数字 id：走播放地址 API（指纹登录 → /api/v2/home/user/video/play/url）
  // 返回 masterUrl(相对路径) + CDN 拼接 = 完整 m3u8 直链，parse:0
  try {
    const playData = await apiCallAuth('/api/v2/home/user/video/play/url', { id });
    if (playData) {
      let relUrl = '';
      if (quality === '720p') relUrl = playData.p720Url || playData.masterUrl || playData.p480Url || '';
      else if (quality === '480p') relUrl = playData.p480Url || playData.masterUrl || playData.p720Url || '';
      else relUrl = playData.masterUrl || playData.p720Url || playData.p480Url || '';
      if (relUrl) {
        const cdns = await getCdnList();
        // cdnId 提示用哪个 CDN；默认用第一个
        let cdnIdx = 0;
        const cdnIdMatch = String(relUrl).match(/cdnId=(\d+)/);
        if (cdnIdMatch) {
          const cid = parseInt(cdnIdMatch[1], 10);
          if (cid >= 0 && cid < cdns.length) cdnIdx = cid;
        }
        let fullUrl = cdns[cdnIdx].replace(/\/$/, '') + relUrl;
        // cdnId=2 的分片实测比 cdnId=0 快（单视频 n=2，弱证据；真机无改善则 revert）
        if (fullUrl.includes('cdnId=0')) fullUrl = fullUrl.replace('cdnId=0', 'cdnId=2');
        return subAttach({ parse: 0, url: fullUrl, header: { Referer: HOST + '/', 'User-Agent': UA } }, subsP);
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
  const rawList = data && (data.list || data.data) ? (data.list || data.data) : [];
  const list = await fillPics(rawList.map(formatVideo));
  return { page, pagecount: 1, limit: 20, total: list.length, list };
}

// ---------------- 字幕聚合 (Layer A 铺开, 2026-10-23) ----------------
// 与 bestjavporn 试点同一实现 (提交 9c339419, 用户真机确认
// MiraPlayer 可加载并选择字幕): 点播时按片名/番号并行搜迅雷看看
// oracle (首档; 「迅雷」与「迅雷看看」实为同一接口) + SubtitleCat
// (第二档), 合并排序 = 来源档位 -> 语言 (简中>繁中>双语>英文>
// 其他) -> 番号命中 -> 热度, 只收 .srt/.vtt/.ass/.ssa 直链, 上限
// 10 条, 以 TVBox 标准 subs:[{name,url,format}] 挂到 play 结果。
// 总预算 6s、单请求 4~5s、全程框架 req (NOFETCH 安全)、结果缓存
// 10 分钟 (空结果不缓存); 无命中时不带 subs 键, play 返回与接入
// 前逐字段一致。SubHD (下载被站方门控) 与射手 (源站 522) 不接入。
const SUB_UA = (typeof UA !== 'undefined' && UA) ? UA : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

function subCleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// subHttp: 与试点 reqRaw 同语义 (状态码不抛错、仅 2xx 给正文、
// 文本恒等变换防自动 JSON 解析), 底层框架 req。
async function subHttp(url, headers, timeoutMs) {
  try {
    const r = await req.request({
      method: 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    });
    const text = typeof r.data === 'string' ? r.data : (r.data == null ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// play 入参归一: 个别 App 会把 "集名$播放id" 整段传回, 集名短且
// 不含 {/http 时剥掉前缀, 与 detail 登记的 episode id 对齐。
function subNormKey(k) {
  const s = String(k || '');
  const i = s.indexOf('$');
  if (i > 0) {
    const before = s.slice(0, i);
    if (before.length <= 30 && !/[{/]/.test(before) && !/http/i.test(before)) return s.slice(i + 1).trim();
  }
  return s.trim();
}

// detail 侧登记: 片名按 [detail 入参 id, vod_id, 每个 episode 的
// 播放 id] 多键写入 subNameCache, 并以首个 episode id 预热搜索。
function subRegister(detailIds, vod) {
  try {
    if (!vod || !vod.vod_name) return;
    const name = String(vod.vod_name);
    const keys = new Set();
    for (const i of (Array.isArray(detailIds) ? detailIds : [detailIds])) {
      if (i) keys.add(String(i));
    }
    if (vod.vod_id) keys.add(String(vod.vod_id));
    const eps = [];
    for (const grp of String(vod.vod_play_url || '').split('$$$')) {
      for (const seg of grp.split('#')) {
        const k = seg.indexOf('$');
        if (k >= 0) {
          const ep = seg.slice(k + 1);
          if (ep) { keys.add(ep); eps.push(ep); }
        }
      }
    }
    for (const k of keys) subCacheName(k, name);
    const warmKey = eps[0] || (vod.vod_id ? String(vod.vod_id) : '');
    if (warmKey) subWarm(warmKey);
  } catch (e) { /* 字幕登记失败不影响详情 */ }
}

// play 侧挂载: 仅当结果带非空 url 且字幕有命中时才加 subs 键。
async function subAttach(res, subsP) {
  try {
    const subs = await Promise.race([subsP, new Promise((r) => setTimeout(() => r([]), 800))]);
    if (subs && subs.length && res && typeof res === 'object' && res.url) res.subs = subs;
  } catch (e) { /* 字幕挂载失败不影响播放结果 */ }
  return res;
}

// ---------------- 字幕聚合 (Layer A 重写, 2026-10-23) ----------------
// 按用户自有迅雷看看 REX 组件 (xunlei.subtitle) 的方法重写: 旧版把
// [番号, 全标题, 番号+标题] 多个键的召回合并成一池只排序不过滤,
// 全标题键的模糊召回灌进大量别片字幕 (实测 JUR-887 全标题键池
// 前排即 JUX-021 等别片), 且迅雷档位恒占满上限 10, SubtitleCat
// 永远挤不进来。新版三招 (与组件一致):
// (a) 键序逐个查、首个有结果的键即停 — 番号键命中的池小而准;
// (b) 命中后严过滤: 条目 name/langs/ext 须含番号 (宽松形亦可)
//     或片名全文, 不含的全扔, 无回退 (组件原法的回退宽松名单
//     在冷门番号上会把邻近番号的模糊池整池放行, 实测有害已删;
//     乱码单字键亦实测能召回无关字幕, 同样靠严过滤挡下);
// (c) 组件打分: cid_match 100000、含番号 +25000, 再加 oracle 自
//     带 score / fingerprintScore / 下载量, 按名+址去重取 top。
// 槽位 (用户钦定): 迅雷 (键序 [番号, 紧凑番号]) > 迅雷看看
// (组件完整键序 [番号, 紧凑番号, 番号+标题, 紧凑番号+标题,
// 全标题]) > SubtitleCat; 两迅雷槽同走同一 oracle 接口、不管
// 重不重复, 合并按 URL 去重、同条归高档位。合并序 = 档位 ->
// 语言 (简中>繁中>双语>英文>日文>其他, 沿用 subLangOf 口径)
// -> 分数; 全局上限 10、单槽软上限 8 (SubtitleCat 留位)。
// 全程 subHttp (框架 req 主栈), 迅雷系逐请求超时 3s、键序串行
// 首中即停; 总预算 6s、失败全静默; 无结果时 play 返回对象不带
// subs 键, 与未接入前逐字段一致。SubHD (下载被站方门控) 与
// 射手 (源站 522) 仍不接入。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();   // durl -> 片名 (detail 时 best-effort 写入)
const subResultCache = new Map(); // durl -> {ts, subs}

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? subCleanText(slug.replace(/[-_]+/g, ' ')) : '';
}

// 番号抽取 (移植自迅雷看看 REX 组件 extractSearchCode 的核心档)
function subExtractCode(text) {
  const s = String(text || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');
  const pats = [
    /\bFC2(?:[- ]?PPV)?[- ]?\d{5,8}\b/,
    /\bCARIB(?:PR)?[- ]?\d{6,8}\b/,
    /\b1PONDO[- ]?\d{6,8}\b/,
    /\bHEYZO[- ]?\d{3,6}\b/,
    /\b[A-Z]{2,10}[- ]\d{2,8}[A-Z]?\b/,
    /\b[A-Z]{2,10}\d{2,8}[A-Z]?\b/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[0].replace(/\s+/g, '-').replace(/-+/g, '-');
  }
  return '';
}

// 搜索上下文: 片名、番号、紧凑番号、标题部分 (去番号与噪声词)
function subCtx(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const compact = code ? code.replace(/[-_ ]/g, '') : '';
  let titlePart = '';
  if (code && title) {
    titlePart = title
      .replace(new RegExp(code.replace(/[-_]/g, '[-_ ]?'), 'i'), ' ')
      .replace(/\b(UNCENSORED|LEAK|OTHER|COMPLETE|FULL|HDR|WEB|BLURAY|BDRIP|WEBDL|REMUX|X264|X265|10BIT|8BIT|HEVC|AVC)\b/gi, ' ')
      .replace(/\b(?:EP|E|S|SEASON)\s*\d{1,3}\b/gi, ' ')
      .replace(/^[\s\-_:]+|[\s\-_:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (titlePart === code || titlePart === compact) titlePart = '';
  }
  return { title, code, compact, titlePart };
}

// 迅雷槽键序: 只番号两键 (锚定)
function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}

// 迅雷看看槽键序: 组件完整键序 (番号、紧凑番号、番号+标题、
// 紧凑番号+标题、全标题), 逐个查、首中即停。
function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}

// 严过滤的匹配文本 (组件口径: 片名 + 上下文, 全小写与去分隔符两形)
function subMatchOf(durl, ctx) {
  const text = ((ctx.title || '') + ' ' + String(durl || '')).trim().toLowerCase();
  const title = (ctx.title || '').toLowerCase();
  return {
    text,
    loose: text.replace(/[-_\s.]/g, ''),
    title,
    titleLoose: title.replace(/[-_\s.]/g, ''),
  };
}

// 语言判定: rank 越小越优先 (简中 > 繁中 > 双语 > 英文 > 其他)
function subLangOf(name, langs) {
  const s = (String(name || '') + ' ' + String(langs || '')).toLowerCase();
  if (/简体|简中|chs|zh[-_. ]?cn|zh[-_. ]?hans/.test(s)) return { tag: '简中', rank: 0 };
  if (/繁体|繁中|cht|zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?hant/.test(s)) return { tag: '繁中', rank: 1 };
  if (/双语|中英|中日|bilingual/.test(s)) return { tag: '双语', rank: 2 };
  if (/英文|english|eng|(^|[-_. ])en([-_. ]|$)/.test(s)) return { tag: '英文', rank: 3 };
  if (/日文|日语|japanese|jpn|(^|[-_. ])ja([-_. ]|$)/.test(s)) return { tag: '日文', rank: 4 };
  return { tag: '', rank: 5 };
}

const SUB_TEXT_RE = /\.(srt|vtt|ass|ssa)(\?|#|$)/i;

// 文本字幕格式判定: 文件名扩展名 > 条目 ext 字段 > url 后缀;
// 压缩包一律剔除 (与组件 getExt 口径一致, 只认 srt/vtt/ass/ssa)。
function subFmtOf(name, ext, url) {
  const hay = (String(name || '') + ' ' + String(url || '')).toLowerCase();
  if (/\.(zip|rar|7z)(\?|#|$)/.test(hay)) return '';
  const fromName = String(name || '').toLowerCase().match(/\.(srt|vtt|ass|ssa)$/);
  if (fromName) return fromName[1];
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (/^(srt|vtt|ass|ssa)$/.test(e)) return e;
  const fromUrl = String(url || '').match(SUB_TEXT_RE);
  if (fromUrl) return fromUrl[1].toLowerCase();
  return '';
}

// 裸哈希名不可读: 显示名换成番号字幕 (匹配/过滤仍用原名)
function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}

// oracle 单键查询 (同趟搜索内按键缓存, 两槽共用, 不重复发请求)
async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 3000);
    if (r.status !== 200 || !r.body) return [];
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return []; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return [];
    return j.data;
  })();
  ocache.set(key, p);
  return p;
}

// oracle 条目归一 (组件 normalizeResult 的字段口径)
function subNormItem(it) {
  const name = String(it.name || it.Name || it.title || it.Title || it.filename || it.FileName || '字幕');
  const langs = Array.isArray(it.languages) ? it.languages.join(',')
    : (Array.isArray(it.Languages) ? it.Languages.join(',') : String(it.langs || it.Langs || it.language || ''));
  return {
    name,
    langs,
    ext: String(it.ext || it.Ext || it.format || it.Format || ''),
    url: String(it.url || it.Url || ''),
    cid: Boolean(it.cid_match ?? it.CidMatch),
    down: Number(it.down_count || it.DownCount || it.downloads || it.Downloads || 0) || 0,
    score: Number(it.score || it.Score || 0) || 0,
    fp: Number(it.fingerprintf_score || it.fingerprint_score || it.FingerprintScore || it.fingerprintfScore || 0) || 0,
    duration: Number(it.duration || it.Duration || 0) || 0,
    size: Number(it.file_size || it.FileSize || it.size || it.Size || 0) || 0,
  };
}

// 严过滤 (组件口径): 条目 name/langs/ext 须含番号 (原形或宽松
// 形) 或片名全文, 否则扔掉。片名分支必须守非空: 个别蜘蛛的
// 播放 id 与 detail 登记键对不上时片名缓存会落空 (title=''),
// 空串是任何字符串的子串, 不守就会全池放行 (bigbuttshub 实测
// 教训: 假番号 EMPTY-24 搜出的 Sherlock 剧集字幕整页漏入)。
function subRelevant(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  if (ctx.code) {
    if (text.includes(ctx.code.toLowerCase())) return true;
    if (ctx.compact && loose.includes(ctx.compact.toLowerCase())) return true;
  }
  if (!match.text) return false;
  return text.includes(match.text) || loose.includes(match.loose)
    || (match.title ? (text.includes(match.title) || loose.includes(match.titleLoose)) : false)
    || match.text.includes(text);
}

// 组件打分 (scoreItem 的电影路径): cid_match 100000、含番号
// +25000、oracle 自带 score/fingerprintScore、下载量、时长/大小。
function subScoreItem(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  let s = (it.cid ? 100000 : 0) + it.down / 10000;
  if (ctx.code && (text.includes(ctx.code.toLowerCase()) || (ctx.compact && loose.includes(ctx.compact.toLowerCase())))) s += 25000;
  s += Math.max(0, it.score) + Math.max(0, it.fp);
  if (it.duration > 0) s += 50;
  if (it.size > 0) s += Math.min(it.size / 1024 / 1024, 20);
  if (match.title && (text.includes(match.title) || loose.includes(match.titleLoose))) s += 1000;
  if (ctx.code) s += 500;
  if (text.includes('sub') || text.includes('subtitle') || text.includes('字幕')) s += 300;
  return s;
}

// 迅雷系槽位 (迅雷 tier 0 / 迅雷看看 tier 1): 键序逐个查、首个
// 有结果的键即停; 命中池只过严过滤、无任何回退 — 组件原法的
// 「过滤到空回退宽松名单」在冷门番号上实测有害 (oracle 对无精
// 确字幕的番号返回邻近番号的模糊池, 回退等于整池垃圾放行:
// MOGK-006 挂上 MOGK-004/002、FC2-PPV-4991508 挂上他人番号),
// 与「宁缺毋滥」冲突, 故删除 (与 REX 版相关性闸门口径一致)。
async function subSlotOracle(keys, src, tier, ctx, match, ocache, bag) {
  let pool = null;
  for (const k of keys) {
    const list = await subOracle(k, ocache);
    if (list && list.length) { pool = list; break; }
  }
  if (!pool) return;
  const items = [];
  for (const raw of pool) {
    if (!raw) continue;
    const it = subNormItem(raw);
    if (!it.url) continue;
    const fmt = subFmtOf(it.name, it.ext, it.url);
    if (!fmt) continue;
    items.push({ name: it.name, langs: it.langs, ext: it.ext, url: it.url, fmt, norm: it });
  }
  if (!items.length) return;
  const finalItems = items.filter((it) => subRelevant(it, ctx, match));
  for (const it of finalItems) {
    const lang = subLangOf(it.name, it.langs);
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match) });
  }
}

// SubtitleCat 槽 (tier 2): 沿用旧芯搜索/解析 (按番号键搜、逐页
// 取按语言分的直链), 同样过严过滤 (无回退)。
async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
  if (!key) return;
  const r = await subHttp('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 5000);
  if (r.status !== 200 || !r.body) return;
  const pages = [];
  const seen = new Set();
  for (const m of r.body.matchAll(/href="(subs\/\d+\/[^"]+\.html)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    pages.push(m[1]);
    if (pages.length >= 3) break;
  }
  await Promise.all(pages.map(async (p) => {
    const pr = await subHttp('https://subtitlecat.com/' + p, { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 4000);
    if (pr.status !== 200 || !pr.body) return;
    for (const m of pr.body.matchAll(/href="(\/subs\/\d+\/[^"]+\.(?:srt|vtt|ass))"/gi)) {
      let nm = m[1].split('/').pop() || '字幕';
      try { nm = decodeURIComponent(nm); } catch (e) { /* 保持原样 */ }
      if (!subRelevant({ name: nm, langs: '', ext: '' }, ctx, match)) continue;
      const lang = subLangOf(nm, '');
      const fmt = (nm.match(/\.(srt|vtt|ass)$/i) || [])[1].toLowerCase();
      bag.push({ src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], fmt, lang: lang.tag, langRank: lang.rank, score: 0 });
    }
  }));
}

// 合并: 档位 -> 语言 -> 分数; 按 URL 去重 (同条归先到高档位);
// 全局上限 10、单槽软上限 8 (给 SubtitleCat 留位)。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const perTier = {};
  const out = [];
  for (const it of sorted) {
    if (out.length >= 10) break;
    if (seenUrl.has(it.url)) continue;
    if ((perTier[it.tier] || 0) >= 8) continue;
    seenUrl.add(it.url);
    perTier[it.tier] = (perTier[it.tier] || 0) + 1;
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: it.fmt });
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const ctx = subCtx(durl);
    let subs = [];
    if (ctx.code || ctx.title) {
      const match = subMatchOf(durl, ctx);
      const bag = [];
      const ocache = new Map();
      const jobs = [
        subSlotOracle(subKeysX(ctx), '迅雷', 0, ctx, match, ocache, bag),
        subSlotOracle(subKeysXL(ctx), '迅雷看看', 1, ctx, match, ocache, bag),
        subFromSubtitleCat(ctx, match, bag),
      ].map((jp) => Promise.resolve(jp).catch(() => {}));
      const all = Promise.allSettled(jobs);
      // 总预算 6s: 到点先用已入 bag 的部分合并返回; 后台源跑完
      // 后若凑出结果再迟填缓存 (慢出口下 detail 预热靠此命中)。
      // 空结果不缓存 (无字幕的片每次点播重查, 由在途去重兜底)。
      await Promise.race([all, new Promise((r) => setTimeout(r, 6000))]);
      subs = subMerge(bag);
      if (subs.length) {
        subResultCache.set(durl, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(durl, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(durl, p);
  try { return await p; } finally { subInflight.delete(durl); }
}

// detail 入口即预热 (不 await): 慢出口下单趟搜索可达数秒, 让它
// 与详情页的铸造链并行跑, 用户点播时 play 直接命中缓存/在途。
function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
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
