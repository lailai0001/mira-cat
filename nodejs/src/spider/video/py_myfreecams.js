// MyFreeCams - CatPawOpen JS Spider（2026-10-30 新源）
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
//  - 播放：官方播放器（player chunk 8471 + 配置生成器）拼法：
//    stream = 'mfc_' + phase + '_' + user_id（phase 来自 session，如 'a_'
//    → 'mfc_a__41621209'，双下划线是对的）；edgevideo 分支：
//    https://edgevideo.myfreecams.com/llhls/NxServer/{serverNum}
//      /ngrp:{stream}.f4v_cmaf/playlist_sfm4s.m3u8?nc={随机}&v=0.4.0
//    （serverNum = server_name 的数字部分，如 video992 → 992）。
//    VM 实测：正确流名返回 403（Tomcat 拒访，流存在），错误流名返回 404，
//    故流名已坐实、403 是 VM 机房出口被 Wowza 拦（与 surrit/javct 同类
//    现象），真机（住宅/移动出口）待验。detail 里若能拉到 master 清单，
//    按 RESOLUTION 拆出清晰度线；拉不到则只给自动线。
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

async function lookupUser(idOrName) {
  const j = await getJson(API + '/usernameLookup/' + encodeURIComponent(String(idOrName)), WEB + '/' + encodeURIComponent(String(idOrName)));
  const u = j && j.result && j.result.user;
  return u || null;
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

function masterUrl(user, sess) {
  const sn = String(sess.server_name || '');
  const num = (sn.match(/(\d+)/) || [])[1] || '';
  const stream = streamName(user, sess);
  if (!num) return '';
  return 'https://edgevideo.myfreecams.com/llhls/NxServer/' + num
    + '/ngrp:' + stream + '.f4v_cmaf/playlist_sfm4s.m3u8'
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

async function itemsForIds(ids) {
  const list = [];
  for (const id of ids) {
    const u = await lookupUser(id);
    if (!u) continue;
    if (!sessionOf(u)) continue;
    list.push(toItem(u));
    if (list.length >= 24) break;
  }
  return list;
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
  const tid = String(body.id || 'trending');
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
    const master = masterUrl(user, sess);
    let playUrl = '自动$' + master;
    if (master) {
      const mt = await getText(master, roomUrl);
      if (mt && mt.indexOf('#EXTM3U') >= 0) {
        const vars = parseVariants(mt, master);
        if (vars.length) {
          playUrl = ['自动$' + master].concat(vars.map(v => v.h + 'p$' + v.u)).join('#');
        }
      }
    }
    list.push({
      vod_id: key,
      vod_name: String(user.username || user.id),
      vod_pic: String(user.avatar || ''),
      vod_play_from: NAME,
      vod_play_url: playUrl || ('直播$' + roomUrl),
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4|n4v9)/i.test(id);
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
    },
  };
}
