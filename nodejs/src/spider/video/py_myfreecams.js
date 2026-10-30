// MyFreeCams - CatPawOpen JS Spider（2026-10-30 新源；2026-10-30 晚播放修复）
// 站点：https://www.myfreecams.com/（直播间列表，非点播站）
// 结构（2026-10-30 VM 实测）：
//  - 列表：GET https://api-edge.myfreecams.com/trendingRooms?lookback=60
//    返回 result.data = {user_id: {diff, curr, prev, fiveago}}（按热度排序；
//    注意：JSON 对象数字键会被 JS 按数值重排，故以 text 方式取、按原文
//    顺序正则抽 user_id，保住热度顺序）；在线快照：
//    GET https://api-edge.myfreecams.com/video_avatars/online
//    → {count, user_ids: [...]}。
//  - 详情：GET https://api-edge.myfreecams.com/usernameLookup/{username|id}
//    （username 与数字 id 都接受）→ result.user = {id, username, avatar,
//    cam_score, profile, sessions: [{session_id, vstate, room_count,
//    vidserver_id, room_topic, server_name, phase, ...}]}；离线 sessions=[]。
//  - 播放：官方播放器拼法：stream = 'mfc_' + phase + '_' + user_id
//    （phase 来自 session，如 'a_' → 'mfc_a__41621209'，双下划线是对的）；
//    edgevideo 分支：
//    https://edgevideo.myfreecams.com/llhls/NxServer/{serverNum}
//      /ngrp:{stream}.f4v_cmaf/playlist_sfm4s.m3u8?nc={随机}&v=0.4.0
//    （serverNum = server_name 的数字部分，如 video992 → 992）。
//    VM 实测：正确流名返回 403（流存在），错误流名返回 404。
//  - 播放修复（2026-10-30 真机反馈“能看列表、不能播”后，对照
//    chaturbate 真机可播的写法改）：直返原始 LL-HLS 主列表会让播放器
//    在多档 + 独立音频组 + fMP4 分片上选档失败（chaturbate 同款病因，
//    其解法是本地一跳代理裁档）。故本蜘蛛同样走本地代理：
//    play/detail 只给代理地址 js2p://_WEB_/spider/py_myfreecams/3/
//    proxy/master?u={b64url 主列表}[&q={高度}]；代理在 App 内拉取主列表，
//    裁到一档（q 指定高度，否则最高档）+ 锁定该档的音频组，所有 URI
//    改写为绝对地址；拉取/裁剪失败时 302 回原始主列表（不劣于直返）。
//    媒体列表与分片仍走 edgevideo 直连（不经代理）。
//  - 只列公开房间（vstate 0 优先；无公开场时仍列出在线场并在备注标明）。
import req from '../../util/req.js';

const KEY = 'py_myfreecams';
const NAME = 'MyFreeCams';
const API = 'https://api-edge.myfreecams.com';
const WEB = 'https://www.myfreecams.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Referer': referer || WEB + '/',
  };
}

async function getText(url, referer) {
  try {
    const { data } = await req.get(url, { headers: H(referer), timeout: 15000, responseType: 'text' });
    return typeof data === 'string' ? data : JSON.stringify(data || '');
  } catch { return ''; }
}

async function getJson(url, referer) {
  const t = await getText(url, referer);
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

// trending 原文顺序抽 id（避开数字键重排）
async function trendingIds() {
  const t = await getText(API + '/trendingRooms?lookback=60', WEB + '/');
  const ids = [];
  const seen = new Set();
  const re = /"(\d{5,})"\s*:\s*\{\s*"diff"/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

// 主播查询缓存 120 秒：首页→分类→详情重复查同一主播时不再发请求
const userCache = new Map();
async function lookupUser(idOrName) {
  const key = String(idOrName);
  const hit = userCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.user;
  const j = await getJson(API + '/usernameLookup/' + encodeURIComponent(key), WEB + '/' + encodeURIComponent(key));
  const u = (j && j.result && j.result.user) || null;
  if (userCache.size > 200) userCache.delete(userCache.keys().next().value);
  userCache.set(key, { user: u, exp: Date.now() + 120000 });
  return u;
}

function sessionOf(user) {
  const ss = (user && user.sessions) || [];
  if (!ss.length) return null;
  return ss.find(s => s.vstate === 0) || ss[0];
}

function streamName(user, sess) {
  const phase = String(sess.phase || 'a_');
  return 'mfc_' + phase + '_' + String(user.id);
}

// 官方播放器格式表（mfc-player-chunk.js 实测）：
//  hls   = .f4v_mobile/playlist.m3u8（标准 HLS，兼容性最广）
//  llhls = .f4v_cmaf/playlist_sfm4s.m3u8（低延迟 CMAF fMP4）
// 2026-10-30 晚真机：llhls 经代理裁档仍播不出，改 hls 为主线、llhls 作后备线。
function masterUrl(user, sess, format) {
  const sn = String(sess.server_name || '');
  const num = (sn.match(/(\d+)/) || [])[1] || '';
  const stream = streamName(user, sess);
  if (!num) return '';
  const suffix = format === 'llhls'
    ? '.f4v_cmaf/playlist_sfm4s.m3u8'
    : '.f4v_mobile/playlist.m3u8';
  const app = format === 'llhls' ? 'llhls' : 'hls';
  return 'https://edgevideo.myfreecams.com/' + app + '/NxServer/' + num
    + '/ngrp:' + stream + suffix
    + '?nc=' + Math.random() + '&v=0.4.0';
}

function topicOf(sess) {
  return String((sess && sess.room_topic) || '').replace(/\s+/g, ' ').trim();
}

function toItem(user) {
  const sess = sessionOf(user);
  const topic = sess ? topicOf(sess) : '';
  const cnt = sess ? (sess.room_count || 0) : 0;
  return {
    vod_id: String(user.username || user.id),
    vod_name: String(user.username || user.id),
    vod_pic: String(user.avatar || ''),
    vod_remarks: sess ? (cnt ? cnt + '人·' + topic : topic).slice(0, 40) : '离线',
  };
}

// 2026-10-30 晚修复“首页慢”：旧写法 24 个主播逐个串行查（24 次往返，
// 实测首页要等十几秒）。改 8 并发分批、保序返回；调用方传入已切片的 id。
async function itemsForIds(ids) {
  const out = new Array(ids.length).fill(null);
  const CONC = 8;
  for (let s = 0; s < ids.length; s += CONC) {
    const chunk = ids.slice(s, s + CONC);
    const rs = await Promise.all(chunk.map(async (id) => {
      const u = await lookupUser(id);
      return (u && sessionOf(u)) ? toItem(u) : null;
    }));
    rs.forEach((r, i) => { out[s + i] = r; });
  }
  return out.filter(Boolean).slice(0, 24);
}

function parseVariants(masterText, masterUrlStr) {
  const lines = [];
  const seen = new Set();
  const re = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)[^\n]*\n([^\n]+)/g;
  let m;
  while ((m = re.exec(masterText)) !== null) {
    const h = parseInt(m[2], 10);
    let u = m[3].trim();
    if (!/^https?:\/\//i.test(u)) {
      try { u = new URL(u, masterUrlStr).toString(); } catch { continue; }
    }
    if (!u || seen.has(u)) continue;
    seen.add(u);
    lines.push({ h, u });
  }
  lines.sort((a, b) => b.h - a.h);
  return lines;
}

// ---------- 主列表裁档（本地一跳代理，同 chaturbate 写法） ----------

function b64url(s) {
  return Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// 本地代理地址（js2p://_WEB_ 为 App 动态地址 scheme，同 chaturbate/avhub 先例）
function proxyUrl(reqLike, path, targetUrl, q) {
  try {
    const server = reqLike?.server;
    const dynamic = server?.address?.()?.dynamic || 'js2p://_WEB_';
    const prefix = server?.prefix || ('/spider/' + KEY + '/3');
    let u = `${dynamic}${prefix}${path}?u=${b64url(targetUrl)}`;
    if (q) u += '&q=' + encodeURIComponent(q);
    return u;
  } catch (e) { return ''; }
}

function absUrl(u, base) {
  try { return new URL(u, base).toString(); } catch (e) { return u; }
}

// 把主列表裁到一档：q 指定高度则取该档，否则最高档（高度优先，其次码率），
// 并保留该档引用的音频组，所有 URI 改写为以主列表地址为基准的绝对地址。
function filterMaster(raw, baseUrl, q) {
  const lines = String(raw).split(/\r?\n/);
  const head = [];
  const mediaByGroup = new Map();
  const variants = [];
  let pendingInf = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const g = /GROUP-ID="([^"]+)"/.exec(line);
      if (g) {
        if (!mediaByGroup.has(g[1])) mediaByGroup.set(g[1], []);
        mediaByGroup.get(g[1]).push(line);
      }
      continue;
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) { pendingInf = line; continue; }
    if (line.startsWith('#')) {
      if (line === '#EXTM3U' || line.startsWith('#EXT-X-VERSION') || line.startsWith('#EXT-X-INDEPENDENT-SEGMENTS')) head.push(line);
      continue;
    }
    if (pendingInf) {
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(pendingInf);
      const bw = /BANDWIDTH=(\d+)/.exec(pendingInf);
      const audio = /AUDIO="([^"]+)"/.exec(pendingInf);
      variants.push({
        inf: pendingInf,
        uri: line,
        h: res ? parseInt(res[2], 10) : 0,
        bw: bw ? parseInt(bw[1], 10) : 0,
        audio: audio ? audio[1] : '',
      });
      pendingInf = null;
    }
  }
  if (!variants.length) return '';
  variants.sort((a, b) => (b.h - a.h) || (b.bw - a.bw));
  let top = variants[0];
  if (q) {
    const want = parseInt(q, 10);
    const hit = variants.find(v => v.h === want);
    if (hit) top = hit;
  }
  const out = ['#EXTM3U'];
  for (const h of head) { if (h !== '#EXTM3U') out.push(h); }
  if (top.audio && mediaByGroup.has(top.audio)) {
    for (const ml of mediaByGroup.get(top.audio)) {
      out.push(ml.replace(/URI="([^"]+)"/, (mm, u) => `URI="${absUrl(u, baseUrl)}"`));
    }
  }
  out.push(top.inf);
  out.push(absUrl(top.uri, baseUrl));
  return out.join('\n') + '\n';
}

async function fetchPlaylist(url, timeout = 8000) {
  try {
    const { data, status } = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': WEB + '/' },
      timeout,
    });
    if (status === 200 && data != null) return typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) { /* ignore */ }
  return '';
}

const masterCache = new Map(); // key -> { text, exp }
const MASTER_CACHE_TTL = 60000;

// GET /proxy/master?u={b64url 主列表地址}[&q={高度}] —— 返回裁到一档的主列表；
// 拉取/裁剪失败时 302 跳回原始主列表（不劣于直返）。
async function masterProxy(request, reply) {
  const q = request?.query || {};
  if (!q.u) { reply.code(400).send('missing u'); return; }
  let target = '';
  try { target = unb64url(q.u); } catch (e) { reply.code(400).send('bad u'); return; }
  let host = '';
  try { host = new URL(target).hostname; } catch (e) { /* ignore */ }
  if (!/^https:\/\//.test(target) || !/\.myfreecams\.com$/.test(host)) {
    reply.code(400).send('bad u'); return;
  }
  const nowMs = Date.now();
  const cacheKey = target + '|q=' + (q.q || '');
  const hit = masterCache.get(cacheKey);
  if (hit && hit.exp > nowMs) {
    reply.header('Content-Type', 'application/vnd.apple.mpegurl');
    reply.header('Cache-Control', 'no-cache');
    reply.send(hit.text);
    return;
  }
  const raw = await fetchPlaylist(target);
  const filtered = raw && raw.includes('#EXT-X-STREAM-INF') ? filterMaster(raw, target, q.q) : '';
  if (!filtered) { reply.redirect(target); return; }
  if (masterCache.size > 64) masterCache.delete(masterCache.keys().next().value);
  masterCache.set(cacheKey, { text: filtered, exp: nowMs + MASTER_CACHE_TTL });
  reply.header('Content-Type', 'application/vnd.apple.mpegurl');
  reply.header('Cache-Control', 'no-cache');
  reply.send(filtered);
}

async function init() { return {}; }

async function home() {
  const ids = await trendingIds();
  const list = await itemsForIds(ids.slice(0, 24));
  return {
    class: [
      { type_id: 'trending', type_name: '热门房间' },
      { type_id: 'online', type_name: '在线主播' },
    ],
    filters: {},
    list,
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || body.tid || 'trending');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let list = [];
  if (tid === 'online') {
    const j = await getJson(API + '/video_avatars/online', WEB + '/');
    const ids = (j && j.result && j.result.user_ids) || [];
    list = await itemsForIds(ids);
  } else {
    const ids = await trendingIds();
    const per = 24;
    list = await itemsForIds(ids.slice((page - 1) * per, page * per));
  }
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const key = String(raw).trim();
    const user = await lookupUser(key);
    if (!user) {
      list.push({ vod_id: key, vod_name: key, vod_pic: '', vod_play_from: NAME, vod_play_url: '未找到主播$' + WEB + '/' + encodeURIComponent(key) });
      continue;
    }
    const sess = sessionOf(user);
    const roomUrl = WEB + '/' + encodeURIComponent(String(user.username || user.id));
    if (!sess) {
      list.push({ vod_id: key, vod_name: String(user.username || user.id), vod_pic: String(user.avatar || ''), vod_play_from: NAME, vod_play_url: '主播已离线$' + roomUrl });
      continue;
    }
    // 主线改标准 HLS（f4v_mobile，兼容性最广），低延迟 llhls 作后备线，均走代理
    const master = masterUrl(user, sess, 'hls');
    const llMaster = masterUrl(user, sess, 'llhls');
    let playUrl = '';
    if (master) {
      // 自动线走代理裁最高档；能拉到主列表时再按高度拆清晰度线（同样走代理）
      playUrl = '自动$' + (proxyUrl(reqIn, '/proxy/master', master) || master);
      const mt = await getText(master, roomUrl);
      if (mt && mt.indexOf('#EXTM3U') >= 0) {
        const vars = parseVariants(mt, master);
        if (vars.length) {
          playUrl = ['自动$' + (proxyUrl(reqIn, '/proxy/master', master) || master)]
            .concat(vars.map(v => v.h + 'p$' + (proxyUrl(reqIn, '/proxy/master', master, v.h) || v.u)))
            .join('#');
        }
      }
      if (llMaster) playUrl += '#低延迟$' + (proxyUrl(reqIn, '/proxy/master', llMaster) || llMaster);
    }
    if (!playUrl) playUrl = '直播$' + roomUrl;
    list.push({
      vod_id: key,
      vod_name: String(user.username || user.id),
      vod_pic: String(user.avatar || ''),
      vod_play_from: NAME,
      vod_play_url: playUrl,
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  // 代理地址直接放行；原始 m3u8 则包一层代理（构造失败时直返）
  if (/\.m3u8(\?|$)/i.test(id) && id.indexOf('/proxy/master') < 0) {
    id = proxyUrl(reqIn, '/proxy/master', id) || id;
  }
  const isVideo = /\.(m3u8|mp4|n4v9)/i.test(id) || id.indexOf('/proxy/master') >= 0;
  return {
    parse: isVideo ? 0 : 1,
    url: id,
    header: { 'User-Agent': UA, 'Referer': WEB + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const u = await lookupUser(wd);
  const list = u ? [toItem(u)] : [];
  return { page, pagecount: page, limit: 90, total: list.length, list };
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
      fastify.get('/proxy/master', masterProxy);
    },
  };
}
