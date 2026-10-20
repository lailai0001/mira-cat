import req from '../../util/req.js';

// Chaturbate (py_chaturbate) —— 名称暂用站方品牌「Chaturbate」, 用户可改
// 站点: https://chaturbate.com (成人直播平台)。只收录游客可看的公开直播间:
//       站内列表接口本身就是游客视图 (默认只回 current_show='public' 且无密码房的房间),
//       本源再做一层同样的过滤兜底; 私密秀/隐藏票秀/密码房不收, 不伪造任何凭证。
// 列表: GET /api/ts/roomlist/room-list/?limit=90&offset={(页-1)*90} (站方前端自己的接口, 无需登录/签名)
//       筛选参数 (取自站方 roomlist 前端代码 + 逐个实测): genders=f|m|c|t (t 返回 gender='s' 的跨性别房),
//       regions=NA|SA|AS|ER|O, hashtags={标签} (逗号分隔), from_age/to_age (站方年龄段映射:
//       18-21→18/22, 20-30→20/31, 30-50→30/51, 成熟→50/100), new_cams=1, gaming=1, exhib=1,
//       keywords={关键词} (搜索用, 匹配用户名/标题)。48 个分类于 2026-10-21 逐个实测有在线房:
//       标签类逐个查过 total_count (68~1446, 实时浮动), 其余大类均数百至数千。
// 封面: 列表自带 img = https://thumb.live.mmcdn.com/riw/{username}.jpg?{时间戳} (房间快照, 无头直取 200
//       image/jpeg 已实测), 真实 https 直链, 不经本地代理 (App 图片加载走不了 js2p 本地地址, 既有教训)。
// 详情: GET https://chaturbate.com/{username}/ 页面内嵌 window.initialRoomDossier (JS 字符串里的 JSON),
//       含 room_status/room_title/num_viewers/hls_source; 房间已下线时页面 404、无 dossier, 优雅降级。
// 播放: 点播时现抓房间页取 dossier.hls_source (带短时效 token 的 LL-HLS 主列表, 最高 1080p 多档):
//       room_status 必须为 'public' 且 hls_source 非空才返 (实测 hidden 房 hls_source 为空字符串);
//       主列表→变体 chunklist→init 段 (ftyp) /媒体分片 (moof) 2026-10-21 VM 无头全链实测 200。
//       流是 LL-HLS + fMP4 (与 StripChat 的 fMP4 形态同类, 该形态已在本 App 真机通过; LL-HLS 的
//       EXT-X-PART 低延迟分片个别播放器兼容性只能真机定)。列表/分片域 (live.mmcdn.com) 对机房出口
//       无拦截实测, 主列表正文里全是站方 https 地址, 无需 Worker 代办 (与 StripChat 需 Mouflon
//       解密的情形不同, 本站分片是明文 fMP4)。
// 抓取兜底: req → fetch → r.jina.ai 中转 三层 (列表是 JSON 接口、播放才抓 HTML, 年龄/地区门若只拦
//       HTML 也不影响列表; VM 出口实测全程无年龄门/地区门 200 直达)。
// 搜索: 站方 roomlist 的 keywords 参数即站内搜索 (实测部分匹配用户名, total 上限 500), 直接复用。

const KEY = 'py_chaturbate';
const NAME = 'Chaturbate';
const HOST = 'https://chaturbate.com';
const API = HOST + '/api/ts/roomlist/room-list/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const REFERER = HOST + '/';
const PAGE_SIZE = 90;
const TIMEOUT = 12000;

// 分类: type_id 编码 —— all | g:{gender} | r:{region} | gr:{gender}:{region} |
//       new | gaming | exhib | age:{from}:{to} | tag:{hashtag}
// 标签计数为 2026-10-21 实测 total_count (见文件头)
const CATS = [
  { type_id: 'all', type_name: '推荐' },
  { type_id: 'g:f', type_name: '女生' },
  { type_id: 'g:m', type_name: '男生' },
  { type_id: 'g:c', type_name: '情侣' },
  { type_id: 'g:t', type_name: '跨性别' },
  { type_id: 'r:AS', type_name: '亚洲' },
  { type_id: 'r:NA', type_name: '北美' },
  { type_id: 'r:SA', type_name: '南美' },
  { type_id: 'r:ER', type_name: '欧洲·俄罗斯' },
  { type_id: 'r:O', type_name: '其他地区' },
  { type_id: 'gr:f:AS', type_name: '亚洲女生' },
  { type_id: 'new', type_name: '新人' },
  { type_id: 'gaming', type_name: '游戏' },
  { type_id: 'exhib', type_name: '展示' },
  { type_id: 'age:18:22', type_name: '18-21岁' },
  { type_id: 'age:20:31', type_name: '20-30岁' },
  { type_id: 'age:30:51', type_name: '30-50岁' },
  { type_id: 'age:50:100', type_name: '成熟50+' },
  { type_id: 'tag:lovense', type_name: '标签·互动玩具' }, // 1446
  { type_id: 'tag:bigboobs', type_name: '标签·巨乳' }, // 1219
  { type_id: 'tag:squirt', type_name: '标签·潮吹' }, // 1407
  { type_id: 'tag:asian', type_name: '标签·亚洲' }, // 597
  { type_id: 'tag:anal', type_name: '标签·肛交' }, // 1290
  { type_id: 'tag:bigass', type_name: '标签·大屁股' }, // 1406
  { type_id: 'tag:skinny', type_name: '标签·瘦' }, // 715
  { type_id: 'tag:natural', type_name: '标签·天然' }, // 583
  { type_id: 'tag:feet', type_name: '标签·恋足' }, // 712
  { type_id: 'tag:latina', type_name: '标签·拉丁' }, // 1219
  { type_id: 'tag:milf', type_name: '标签·熟女' }, // 534
  { type_id: 'tag:smalltits', type_name: '标签·小胸' }, // 543
  { type_id: 'tag:blonde', type_name: '标签·金发' }, // 287
  { type_id: 'tag:cum', type_name: '标签·射精' }, // 713
  { type_id: 'tag:bigcock', type_name: '标签·大屌' }, // 619
  { type_id: 'tag:hairy', type_name: '标签·多毛' }, // 436
  { type_id: 'tag:deepthroat', type_name: '标签·深喉' }, // 382
  { type_id: 'tag:petite', type_name: '标签·娇小' }, // 301
  { type_id: 'tag:bigtits', type_name: '标签·大胸' }, // 219
  { type_id: 'tag:fuckmachine', type_name: '标签·炮机' }, // 377
  { type_id: 'tag:brunette', type_name: '标签·棕发' }, // 104
  { type_id: 'tag:ebony', type_name: '标签·黑珍珠' }, // 595
  { type_id: 'tag:redhead', type_name: '标签·红发' }, // 149
  { type_id: 'tag:mature', type_name: '标签·熟龄' }, // 368
  { type_id: 'tag:muscle', type_name: '标签·肌肉' }, // 237
  { type_id: 'tag:goth', type_name: '标签·哥特' }, // 104
  { type_id: 'tag:cosplay', type_name: '标签·角色扮演' }, // 68
  { type_id: 'tag:bdsm', type_name: '标签·BDSM' }, // 123
  { type_id: 'tag:twink', type_name: '标签·小鲜肉' }, // 115
  { type_id: 'tag:blowjob', type_name: '标签·口交' }, // 202
];

function t(v) { return String(v == null ? '' : v).trim(); }

async function fetchText(url, timeout = TIMEOUT) {
  try {
    const { data, status } = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': REFERER },
      timeout,
    });
    if (status === 200 && data != null) return typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) { /* 换通道2 */ }
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': REFERER }, signal: ctl.signal });
    clearTimeout(tm);
    if (r.ok) return await r.text();
  } catch (e) { /* 换通道3 */ }
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch('https://r.jina.ai/' + url, { signal: ctl.signal });
    clearTimeout(tm);
    if (r.ok) return await r.text();
  } catch (e) { /* ignore */ }
  return '';
}

async function fetchJson(url) {
  try {
    const { data, status } = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': REFERER },
      timeout: TIMEOUT,
    });
    if (status === 200 && data) return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { /* 换通道2 */ }
  const raw = await fetchText(url);
  if (raw) { try { return JSON.parse(raw); } catch (e) { /* ignore */ } }
  return null;
}

// ---------- 列表 ----------

function roomToVod(r) {
  const marks = [];
  if (r.is_new) marks.push('新人');
  if (r.is_gaming) marks.push('游戏');
  const remarks = `${r.num_users || 0}人观看${marks.length ? ' · ' + marks.join(' · ') : ''}`;
  return {
    vod_id: t(r.username),
    vod_name: t(r.username),
    vod_pic: t(r.img),
    vod_remarks: remarks,
  };
}

// params: 已解码的筛选键值 (genders/regions/hashtags/from_age/to_age/new_cams/gaming/exhib/keywords)
async function getRoomsPage(params, page) {
  const offset = (page - 1) * PAGE_SIZE;
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== '' && v != null) qs.set(k, String(v));
  }
  const d = await fetchJson(`${API}?${qs.toString()}`);
  if (!d || !Array.isArray(d.rooms)) return { list: [], total: 0 };
  const list = d.rooms
    .filter(r => r && r.username && r.current_show === 'public' && !r.has_password)
    .map(roomToVod);
  return { list, total: d.total_count || 0 };
}

function parseTid(tid) {
  const s = t(tid) || 'all';
  const p = s.split(':');
  switch (p[0]) {
    case 'g': return { genders: p[1] || 'f' };
    case 'r': return { regions: p[1] || 'AS' };
    case 'gr': return { genders: p[1] || 'f', regions: p[2] || 'AS' };
    case 'age': return { from_age: p[1] || '18', to_age: p[2] || '100' };
    case 'tag': return { hashtags: p.slice(1).join(':') };
    case 'new': return { new_cams: '1' };
    case 'gaming': return { gaming: '1' };
    case 'exhib': return { exhib: '1' };
    default: return {};
  }
}

async function init() {
  return {};
}

async function home() {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const { list } = await getRoomsPage({}, 1);
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const params = parseTid(body.tid || body.id);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const { list, total } = await getRoomsPage(params, page);
  const pagecount = Math.max(1, Math.ceil((total || list.length) / PAGE_SIZE));
  return { page, pagecount, limit: PAGE_SIZE, total, list };
}

// ---------- 详情 / 播放 ----------

// 抓房间页, 解出 initialRoomDossier; 房间下线/不存在时返回 null
async function getDossier(username) {
  const html = await fetchText(`${HOST}/${encodeURIComponent(username)}/`, 15000);
  if (!html) return null;
  const m = html.match(/initialRoomDossier\s*=\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(JSON.parse('"' + m[1] + '"'));
  } catch (e) { return null; }
}

function cleanId(raw) {
  const s = t(raw);
  return s.includes('$') ? s.split('$').pop() : s;
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const username = cleanId(body.id);
  const d = await getDossier(username);
  let title = username, remarks = '', content = `${username} 的 Chaturbate 公开直播间`;
  if (d) {
    title = t(d.room_title) || username;
    const live = d.room_status === 'public';
    remarks = live ? `直播中 · ${d.num_viewers || 0}人观看` : `当前状态: ${t(d.room_status) || '未知'}`;
    if (t(d.room_title)) content = t(d.room_title);
  } else {
    remarks = '房间已下线或不存在';
  }
  const vod = {
    vod_id: username,
    vod_name: username,
    vod_pic: `https://thumb.live.mmcdn.com/riw/${encodeURIComponent(username)}.jpg`,
    type_name: '直播',
    vod_remarks: remarks,
    vod_content: content,
    vod_play_from: NAME,
    vod_play_url: '直播$' + username,
  };
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const username = cleanId(body.id);
  if (!username) return { parse: 0, url: '' };
  const d = await getDossier(username);
  // 只有公开房才有游客流; hidden/private/away 等状态 hls_source 为空, 如实空返
  if (!d || d.room_status !== 'public' || !t(d.hls_source)) return { parse: 0, url: '' };
  return {
    parse: 0,
    url: t(d.hls_source),
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [] };
  const { list, total } = await getRoomsPage({ keywords: wd }, page);
  const pagecount = Math.max(1, Math.ceil((total || list.length) / PAGE_SIZE));
  return { page, pagecount, limit: PAGE_SIZE, total, list };
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
