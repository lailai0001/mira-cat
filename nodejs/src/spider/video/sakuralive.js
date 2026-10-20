import req from '../../util/req.js';

// SakuraLive (py_sakuralive) —— 名称暂用站方品牌「SakuraLive」, 用户可改
// 站点: https://www.sakuralive.com (DTI 系日本直播站, 英文站; 另有 /jp /cn 语言版, 数据同源)。
// 性质: 纯直播站, 无点播。游客 (guest) 能看到的真实边界 (2026-10-20 逐项实测):
//   - 在线列表/资料/属性全部免登录公开; 主播分四种状态:
//       session_type 110 = 待机中 —— 只有这种状态, 游客能看「免费预览」直播流;
//       115/120 = 已开播 (含免费聊天场次), 125/130 = 私密中 —— 游客一律只有静态图+提示,
//       进房要会员登录 (login_redirected.php), 本源不碰、不伪造凭证; 这类主播照常列出
//       (与站方首页一致), 备注标注状态, play 时如实返回空 (站方接口对非 110 直接回错误码)。
//   - 免费预览不是 RTMP/HLS 公开地址, 是站方 RTC 预览体系: socket.io (rtcproxy-free.dxlive.com)
//     emit get_stream_url{performerName, type:'free'} → 回 {channelID, sessionKey, freeServerURLarray}
//     → emit start_viewer_preview{room:channelID, pf_socket_id:sessionKey} 后, Wowza 边缘才发布
//     https://{freeServer}/free-preview/{channelID}_source/playlist.m3u8 (720p, 带声音;
//     无后缀版是无声视频轨, 故用 _source)。实测: 全程不带任何自定义头可拉 (master/变体/分片),
//     socket 保持连接时预览流持续存活 (162s 内 10/10 次轮询 200); socket 断开后流会被回收,
//     所以 play() 必须把 socket 会话留在模块内保活 (见 liveSessions), 不能拿完地址就断。
// 列表: GET https://chat.sakuralive.com/jsonSL/listing/?guest=slen
//   正文是 JS: var online_performers = [ {...}, ... ]; —— 纯字符串截取 + JSON.parse, 不执行站点 JS。
//   站方 ?freechat/?started 等筛选参数服务端并不认 (实测返回同一全量列表), 站内是前端本地过滤,
//   本源照做: 全量拉回 (缓存 45s) 本地过滤/排序/分页 (24 条/页)。
// 封面: https://imageup.sakuralive.com/WebArchive/{user_name}/flash/LinkedImage.jpg
//   (站内列表同款; 无头直取 200 image/jpeg 已验)。不用 live/ 快照图 (糊) 与本地代理。
// 属性分类: GET /jsonSL/pfattributesSL/ (约 330KB, 全站注册主播的属性表, 与站内高级搜索同源),
//   正则解析 变量名=new Pf('用户名') 与 变量名.a(属性,值) 两类语句建 用户名→属性集 映射 (缓存 6h);
//   覆盖约 2084 名注册主播 (在线主播里有属性的占一部分), 故属性分类条数天然比状态分类少, 属实。
//   属性表: 16 年龄 (1:18-24 2:25-29 3:30-34 4:35+), 3508 玩具=1, 522 新注册=1。
// 详情: GET /json/profile/{user_name}?guest=slen (var profile = {...}) + 列表行合并。
// 搜索: 站内搜索即按用户名过滤, 本源对在线列表做不分大小写子串匹配。
// WebSocket: 优先用运行时全局 WebSocket (Node 24 实测免头可连通整条协议); 不存在时尝试
//   动态 import('ws'); 两者皆无则 play 返回空。App 运行时是否提供 WebSocket 只能真机定 (主要风险)。
// 播放结果不带 header (分片无头可拉已验), 播放列表正文是 Wowza 原生 https 地址, 无 js2p 嵌套。

const KEY = 'py_sakuralive';
const NAME = 'SakuraLive';
const CHAT = 'https://chat.sakuralive.com';
const IMG = 'https://imageup.sakuralive.com';
const WS_URL = 'wss://rtcproxy-free.dxlive.com/socket.io/?EIO=4&transport=websocket';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_SIZE = 24;
const LIST_TTL = 45000;
const ATTRS_TTL = 6 * 3600 * 1000;
const SESSION_IDLE = 15 * 60 * 1000;
const MAX_SESSIONS = 4;

// ---------- HTTP (框架 req 优先, fetch 兜底) ----------
async function getText(url, timeoutMs = 12000) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA },
      timeout: timeoutMs,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    if (r.status === 200 && r.data) return String(r.data);
  } catch (e) { /* 落 fetch */ }
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
    clearTimeout(to);
    if (r.ok) return await r.text();
  } catch (e) { /* 落空 */ }
  return '';
}

function t(v) { return String(v == null ? '' : v).trim(); }

// ---------- 在线列表 ----------
let listCache = { at: 0, rows: [] };

async function getListing() {
  if (Date.now() - listCache.at < LIST_TTL && listCache.rows.length) return listCache.rows;
  const txt = await getText(`${CHAT}/jsonSL/listing/?guest=slen`);
  const m = txt.match(/online_performers\s*=\s*(\[[\s\S]*?\]);/);
  if (m) {
    try {
      const rows = JSON.parse(m[1]);
      if (Array.isArray(rows) && rows.length) {
        listCache = { at: Date.now(), rows };
        return rows;
      }
    } catch (e) { /* 解析失败落旧缓存 */ }
  }
  return listCache.rows;
}

// ---------- 属性表 (用户名小写 -> Set<"att:val">) ----------
let attrsCache = { at: 0, map: null };

async function getAttrs() {
  if (attrsCache.map && Date.now() - attrsCache.at < ATTRS_TTL) return attrsCache.map;
  const txt = await getText(`${CHAT}/jsonSL/pfattributesSL/`, 20000);
  if (!txt || txt.length < 10000) return attrsCache.map || new Map();
  const varToName = new Map();
  for (const m of txt.matchAll(/([A-Za-z0-9_]+)\s*=\s*new Pf\('([^']+)'/g)) {
    varToName.set(m[1], m[2].toLowerCase());
  }
  const map = new Map();
  for (const m of txt.matchAll(/([A-Za-z0-9_]+)\.a\((\d+),\s*(\d+)\)/g)) {
    const uname = varToName.get(m[1]);
    if (!uname) continue;
    if (!map.has(uname)) map.set(uname, new Set());
    map.get(uname).add(m[2] + ':' + m[3]);
  }
  if (map.size) attrsCache = { at: Date.now(), map };
  return attrsCache.map || map;
}

// ---------- 分类 ----------
function statusText(p) {
  const s = t(p.session_type);
  if (s === '110') return '待机可看';
  if (s === '115' || s === '120') return p.freechat_mode === '1' ? '免费聊天中' : '已开播';
  if (s === '125' || s === '130') return '私密中';
  return '在线';
}

const CATS = [
  { type_id: 'all', type_name: '全部在线' },
  { type_id: 'waiting', type_name: '待机可看' },
  { type_id: 'freechat', type_name: '免费聊天' },
  { type_id: 'started', type_name: '已开播' },
  { type_id: 'private', type_name: '私密中' },
  { type_id: 'new', type_name: '新人' },
  { type_id: 'viewers', type_name: '观看最多' },
  { type_id: 'toy', type_name: '有玩具' },
  { type_id: 'age1824', type_name: '18-24岁' },
  { type_id: 'age2529', type_name: '25-29岁' },
  { type_id: 'age30p', type_name: '30岁以上' },
  { type_id: 'newmodel', type_name: '最新注册' },
];

async function filterRows(tid) {
  const rows = await getListing();
  const by = (fn) => rows.filter(fn);
  switch (tid) {
    case 'waiting': return by((p) => t(p.session_type) === '110');
    case 'freechat': return by((p) => p.freechat_mode === '1');
    case 'started': return by((p) => ['115', '120'].includes(t(p.session_type)));
    case 'private': return by((p) => ['125', '130'].includes(t(p.session_type)));
    case 'new': return by((p) => (parseInt(p.active_days, 10) || 9999) < 61 || (parseInt(p.days_logged_in, 10) || 9999) < 6);
    case 'viewers': return [...rows].sort((a, b) => (parseInt(b.num_viewers, 10) || 0) - (parseInt(a.num_viewers, 10) || 0));
    case 'toy': case 'age1824': case 'age2529': case 'age30p': case 'newmodel': {
      const attrs = await getAttrs();
      const has = (p, key) => attrs.get(t(p.user_name).toLowerCase())?.has(key);
      if (tid === 'toy') return by((p) => has(p, '3508:1'));
      if (tid === 'age1824') return by((p) => has(p, '16:1'));
      if (tid === 'age2529') return by((p) => has(p, '16:2'));
      if (tid === 'age30p') return by((p) => has(p, '16:3') || has(p, '16:4'));
      return by((p) => has(p, '522:1'));
    }
    default: return rows;
  }
}

function toCard(p) {
  const name = t(p.user_name);
  const parts = [statusText(p)];
  if (p.age && t(p.age) !== '99') parts.push(t(p.age) + '岁');
  const nv = parseInt(p.num_viewers, 10) || 0;
  if (nv > 0) parts.push(nv + '人观看');
  return {
    vod_id: name,
    vod_name: name,
    vod_pic: `${IMG}/WebArchive/${encodeURIComponent(name)}/flash/LinkedImage.jpg`,
    vod_remarks: parts.join(' · '),
  };
}

function paged(rows, page) {
  const total = rows.length;
  const pagecount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = Math.min(Math.max(1, page), pagecount);
  const list = rows.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE).map(toCard);
  return { page: pg, pagecount, limit: PAGE_SIZE, total, list };
}

// ---------- WebSocket (socket.io 客户端, 纯字符串协议) ----------
let wsImplPromise = null;
function loadWsImpl() {
  if (!wsImplPromise) {
    wsImplPromise = (async () => {
      if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
      try {
        const m = await import('ws');
        return m.default || m.WebSocket || null;
      } catch (e) { return null; }
    })();
  }
  return wsImplPromise;
}

// 打开一条 socket.io 连接并完成 get_stream_url 握手; 成功返回 { ws, info }
function requestStreamUrl(name, timeoutMs = 15000) {
  return (async () => {
    const WS = await loadWsImpl();
    if (!WS) return null;
    return await new Promise((resolve) => {
      let done = false;
      let ws;
      const finish = (v) => { if (!done) { done = true; clearTimeout(to); resolve(v); } };
      const to = setTimeout(() => { try { ws && ws.close(); } catch (e) {} finish(null); }, timeoutMs);
      try {
        ws = new WS(WS_URL);
      } catch (e) { finish(null); return; }
      const onMsg = (raw) => {
        const data = String(raw && raw.data !== undefined ? raw.data : raw);
        if (data.startsWith('0')) { try { ws.send('40'); } catch (e) {} return; }
        if (data === '2') { try { ws.send('3'); } catch (e) {} return; }
        if (data.startsWith('40')) {
          try { ws.send('42["get_stream_url",{"performerName":' + JSON.stringify(name) + ',"type":"free"}]'); } catch (e) {}
          return;
        }
        if (data.startsWith('42')) {
          try {
            const [evt, payload] = JSON.parse(data.slice(2));
            if (evt === 'get_stream_url') finish({ ws, info: payload && payload.result ? payload.result : payload });
          } catch (e) { /* 其他事件忽略 */ }
        }
      };
      if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('message', onMsg);
        ws.addEventListener('error', () => finish(null));
      } else {
        ws.on('message', onMsg);
        ws.on('error', () => finish(null));
      }
    });
  })();
}

function wsSend(ws, str) {
  try { ws.send(str); return true; } catch (e) { return false; }
}

// ---------- 预览会话保活池 ----------
// socket 一断, 站方就回收免费预览流; play 成功后会话留在这里保活:
// 每 25s 轻拉一次 master 列表 (与站方网页播放器的轮询行为一致), 空闲 15 分钟自动停。
const liveSessions = new Map(); // name -> { ws, channelID, sessionKey, url, lastUse, timer }

function dropSession(name) {
  const s = liveSessions.get(name);
  if (!s) return;
  liveSessions.delete(name);
  if (s.timer) clearInterval(s.timer);
  if (s.ws && s.channelID) {
    wsSend(s.ws, '42["stop_viewer_preview",{"room":' + JSON.stringify(s.channelID) + ',"pf_socket_id":' + JSON.stringify(s.sessionKey) + '}]');
  }
  try { s.ws && s.ws.close(); } catch (e) { /* 忽略 */ }
}

function keepSession(name, sess) {
  // 淘汰最旧会话, 控制并发
  while (liveSessions.size >= MAX_SESSIONS && !liveSessions.has(name)) {
    const oldest = [...liveSessions.entries()].sort((a, b) => a[1].lastUse - b[1].lastUse)[0];
    if (oldest) dropSession(oldest[0]); else break;
  }
  dropSession(name);
  sess.lastUse = Date.now();
  sess.timer = setInterval(async () => {
    if (Date.now() - sess.lastUse > SESSION_IDLE) { dropSession(name); return; }
    try {
      const txt = await getText(sess.url, 8000);
      if (!txt.includes('#EXTM3U')) dropSession(name);
    } catch (e) { /* 单次失败不拆会话 */ }
  }, 25000);
  if (sess.timer.unref) sess.timer.unref();
  liveSessions.set(name, sess);
}

async function startPreview(name) {
  const got = await requestStreamUrl(name);
  if (!got) return '';
  const { ws, info } = got;
  const hosts = (info && info.freeServerURLarray) || [];
  if (!info || String(info.sessionType) !== '110' || !info.channelID || !hosts.length) {
    try { ws.close(); } catch (e) { /* 忽略 */ }
    return '';
  }
  const url = `https://${hosts[0]}/free-preview/${info.channelID}_source/playlist.m3u8`;
  wsSend(ws, '42["start_viewer_preview",{"room":' + JSON.stringify(info.channelID) + ',"pf_socket_id":' + JSON.stringify(info.sessionKey) + '}]');
  // 等 Wowza 发布完成: 轮询 master 直到 200
  let ok = false;
  for (let i = 0; i < 8 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const txt = await getText(url, 6000);
    ok = txt.includes('#EXTM3U');
  }
  if (!ok) {
    wsSend(ws, '42["stop_viewer_preview",{"room":' + JSON.stringify(info.channelID) + ',"pf_socket_id":' + JSON.stringify(info.sessionKey) + '}]');
    try { ws.close(); } catch (e) { /* 忽略 */ }
    return '';
  }
  keepSession(name, { ws, channelID: info.channelID, sessionKey: info.sessionKey, url });
  return url;
}

// ---------- 接口 ----------
async function init() { return {}; }

async function home() {
  const rows = await getListing();
  return {
    class: CATS.map((c) => ({ type_id: c.type_id, type_name: c.type_name })),
    list: rows.slice(0, PAGE_SIZE).map(toCard),
  };
}

async function category(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const tid = t(body.tid || body.id) || 'all';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const rows = await filterRows(tid);
  return paged(rows, page);
}

async function detail(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const name = t(body.id);
  if (!name) return { list: [] };
  const rows = await getListing();
  const row = rows.find((p) => t(p.user_name) === name);
  let profile = {};
  const txt = await getText(`${CHAT}/json/profile/${encodeURIComponent(name)}?guest=slen`);
  const pStart = txt.indexOf('var profile');
  if (pStart >= 0) {
    const braceAt = txt.indexOf('{', pStart);
    if (braceAt >= 0) {
      // 花括号配平截取对象字面量 (对象后还有 writeProfile 等语句, 不能锚定文末)
      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = braceAt; i < txt.length; i++) {
        const c = txt[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end > braceAt) {
        const rawObj = txt.slice(braceAt, end);
        try { profile = JSON.parse(rawObj); } catch (e) {
          // 站方生成器会写出非法的 \' 转义, 清洗后再试一次
          try { profile = JSON.parse(rawObj.replace(/\\'/g, "'")); } catch (e2) { /* 忽略 */ }
        }
      }
    }
  }
  const strip = (s) => t(String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '));
  const status = row ? statusText(row) : '离线或不在列表';
  const intro = strip(profile.introduction);
  const meta = [
    profile.age && strip(profile.age) !== 'Secret' ? strip(profile.age) + '岁' : (row && row.age && t(row.age) !== '99' ? t(row.age) + '岁' : ''),
    profile.language ? '语言:' + strip(profile.language) : '',
    profile.living_area && strip(profile.living_area) !== 'Secret' ? strip(profile.living_area) : '',
    profile.occupation && strip(profile.occupation) !== 'Secret' ? strip(profile.occupation) : '',
  ].filter(Boolean).join(' · ');
  return {
    list: [{
      vod_id: name,
      vod_name: name,
      vod_pic: `${IMG}/WebArchive/${encodeURIComponent(name)}/flash/LinkedImage.jpg`,
      vod_remarks: status,
      vod_content: (meta ? meta + '\n' : '') + (intro || 'SakuraLive 主播 ' + name + '（' + status + '）'),
      vod_play_from: 'SakuraLive',
      vod_play_url: `免费预览$${name}`,
    }],
  };
}

async function play(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  let id = t(body.id);
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (!id) return { parse: 0, url: '' };
  const sess = liveSessions.get(id);
  if (sess) {
    sess.lastUse = Date.now();
    const txt = await getText(sess.url, 6000);
    if (txt.includes('#EXTM3U')) return { parse: 0, url: sess.url };
    dropSession(id);
  }
  const url = await startPreview(id);
  return { parse: 0, url: url || '' };
}

async function search(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const wd = t(body.wd).toLowerCase();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return paged([], page);
  const rows = await getListing();
  return paged(rows.filter((p) => t(p.user_name).toLowerCase().includes(wd)), page);
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
