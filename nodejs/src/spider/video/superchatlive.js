// 注意：该站会按 TLS 指纹拦截 Node axios（req 工具） 的请求，直接 ECONNRESET；
// 经实测 undici 的全局 fetch 可以正常通过，故本源改用 fetch 请求 API。
// 其余蜘蛛仍用 req，本文件是例外。

const KEY = 'py_superchatlive';
const NAME = 'SuperChat直播';
const HOST = 'https://zt.superchat.live';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CLASSES = [
  { type_id: 'girls', type_name: '👩 女主播' },
  { type_id: 'couples', type_name: '💑 情侣' },
  { type_id: 'men', type_name: '👨 男主播' },
  { type_id: 'trans', type_name: '⚧ 变性人' },
];

// 语言筛选（原站 filterGroupTags 参数）
const LANG_FILTER = [
  {
    key: 'tag',
    name: '语言筛选',
    value: [
      { n: '全部', v: '' },
      { n: '🇨🇳 中文', v: 'tagLanguageChinese' },
      { n: '🇺🇸 英文', v: 'tagLanguageEnglish' },
      { n: '🇯🇵 日文', v: 'tagLanguageJapanese' },
      { n: '🇰🇷 韩文', v: 'tagLanguageKorean' },
    ],
  },
];

const FILTERS = {
  girls: LANG_FILTER,
  couples: LANG_FILTER,
  men: LANG_FILTER,
  trans: LANG_FILTER,
};

const LIMIT = 50;

function headers() {
  return { 'User-Agent': UA, 'Referer': HOST + '/' };
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('http ' + res.status);
  return await res.json();
}

function remarksOf(model) {
  let remarks = (model.viewersCount || 0) + '人观看';
  if (model.status === 'groupShow') {
    remarks = '🎫 付费秀 | ' + remarks;
  } else if (model.status === 'private') {
    remarks = '🔒 私密秀 | ' + remarks;
  }
  return remarks;
}

function mapModel(model) {
  const username = String(model.username || '');
  return {
    vod_id: HOST + '/' + username,
    vod_name: username,
    vod_pic: model.avatarUrl || '',
    vod_remarks: remarksOf(model),
  };
}

function liveList(data) {
  const models = data.models || [];
  const result = [];
  for (const model of models) {
    if (model.isLive && model.username) result.push(mapModel(model));
  }
  return result;
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: FILTERS };
}

async function homeVod() {
  try {
    const data = await getJson(`${HOST}/api/front/models?primaryTag=girls&limit=${LIMIT}`);
    return { list: liveList(data) };
  } catch (e) {
    return { list: [] };
  }
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || 'girls');
  const extend = body.filters || body.extend || {};
  const offset = LIMIT * (page - 1);

  let url = `${HOST}/api/front/models?primaryTag=${encodeURIComponent(tid)}&limit=${LIMIT}&offset=${offset}`;
  const tag = String(extend.tag || '').trim();
  if (tag) url += `&filterGroupTags=[["${encodeURIComponent(tag)}"]]`;

  try {
    const data = await getJson(url);
    const list = liveList(data);
    const total = data.filteredCount || 0;
    const pagecount = Math.ceil(total / LIMIT);
    return { page, pagecount, limit: LIMIT, total, list };
  } catch (e) {
    return { page, pagecount: page, limit: LIMIT, total: 0, list: [] };
  }
}

function usernameFromId(id) {
  let s = String(id || '');
  if (s.includes('$')) s = s.split('$').pop();
  s = s.replace(HOST + '/', '');
  return s.split('/').pop().split('?')[0].trim();
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const username = usernameFromId(ids[0]);
  const roomUrl = HOST + '/' + username;
  if (!username) return { list: [] };

  let model = null;
  try {
    const data = await getJson(
      `${HOST}/api/front/models?primaryTag=girls&username=${encodeURIComponent(username)}&limit=1`
    );
    model = (data.models && data.models[0]) || null;
  } catch (e) {}

  let remarks = '🔴 直播中';
  if (model) {
    if (model.status === 'groupShow') {
      remarks = '🎫 付费秀 - 需要代币';
    } else if (model.status === 'private') {
      remarks = '🔒 私密秀 - 需要邀请';
    } else {
      remarks = '🔴 直播中 - ' + (model.viewersCount || 0) + '人观看';
    }
  }

  return {
    list: [{
      vod_id: roomUrl,
      vod_name: username,
      vod_pic: (model && model.avatarUrl) || '',
      vod_content: '直播间地址：' + roomUrl,
      vod_actor: '主播',
      vod_remarks: remarks,
      vod_play_from: NAME,
      vod_play_url: '直播$' + roomUrl,
    }],
  };
}

// 播放地址直接从 API 返回的 hlsPlaylist 取，并按 presets 选最高清晰度
const QUALITY_ORDER = ['1080p', '720p', '480p', '240p'];

function bestPlaylist(model) {
  const base = String(model.hlsPlaylist || '');
  if (!base) return '';
  const presets = Array.isArray(model.presets) ? model.presets : [];
  for (const q of QUALITY_ORDER) {
    if (presets.includes(q)) {
      return base.replace(/_[^_/?]*\.m3u8($|\?)/, `_${q}.m3u8$1`);
    }
  }
  return base;
}

async function fetchModel(username) {
  if (!username) return null;
  const data = await getJson(
    `${HOST}/api/front/models?primaryTag=girls&username=${encodeURIComponent(username)}&limit=1`
  );
  return (data.models && data.models[0]) || null;
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const username = usernameFromId(body.id);
  const roomUrl = HOST + '/' + username;
  const hdr = { 'User-Agent': UA, 'Referer': HOST + '/' };

  try {
    const model = await fetchModel(username);
    const url = model ? bestPlaylist(model) : '';
    if (url) return { parse: 0, url, header: hdr };
  } catch (e) {}
  // 拿不到直链时降级：客户端用网页嗅探播放直播间页面
  return { parse: 1, url: roomUrl, header: hdr };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: LIMIT, total: 0, list: [] };

  const url =
    `${HOST}/api/front/v4/models/search/group/username?query=${encodeURIComponent(wd)}` +
    `&limit=${LIMIT}&primaryTag=girls`;
  try {
    const data = await getJson(url);
    const list = liveList(data);
    return { page, pagecount: page, limit: LIMIT, total: list.length, list };
  } catch (e) {
    return { page, pagecount: page, limit: LIMIT, total: 0, list: [] };
  }
}

export default function createSpider() {
  return {
    meta: { key: KEY, name: NAME, type: 4 },
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
