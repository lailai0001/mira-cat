import req from '../../util/req.js';

// 注意：账号由用户授权内置，可通过 extend 覆盖 {"loginName":"...","password":"..."}
const KEY = 'py_march';
const NAME = 'March视频';
const API = 'https://api.march24168.online';
const CDN = 'https://cdn.uameta.ai/file/bucket-media';
const UA = 'Dart/3.11 (dart:io)';
// 账号已做混淆存储（用户授权放入公开仓库）
const _LN = Buffer.from('Mjg1ODg2NzUxQHFxLmNvbQ==', 'base64').toString();
const _PW = Buffer.from('cXdlcjQzMjE=', 'base64').toString();

const VIDEO_CATS = [
  ['FC2', 'FC2'],
  ['MOODYZ', "MOODYZ(Moody's)"],
  ['S1', 'S1 No. 1 Style'],
  ['加勒比', '加勒比'],
  ['一本道', '一本道'],
  ['麻豆传媒', '麻豆传媒'],
];
const COMIC_CATS = [
  ['全彩', '全彩'],
  ['剧情', '剧情'],
  ['巨乳大奶', '巨乳大奶'],
  ['内射中出', '内射中出'],
  ['不伦', '不伦'],
  ['单女', '单女'],
  ['单男', '单男'],
];
const AUDIO_CATS = [
  ['有声小说', '有声小说'],
  ['淫词艳曲', '淫词艳曲'],
  ['激情骚麦', '激情骚麦'],
  ['寸止训练', '寸止训练'],
  ['ASMR', 'ASMR'],
];
const NOVEL_CATS = [
  ['校园', '校园'],
  ['都市', '都市'],
  ['古代', '古代'],
  ['NP', 'NP'],
  ['剧情', '剧情'],
  ['甜文', '甜文'],
  ['百合', '百合'],
  ['纯爱', '纯爱'],
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

// 每个请求独立 session 风格：用模块级 token 缓存
let _token = '';
let _loginName = '';
let _password = '';

function initAuth(extend) {
  let cfg = {};
  try {
    cfg = extend ? JSON.parse(extend) : {};
  } catch (e) {}
  _loginName = cfg.loginName || _LN;
  _password = cfg.password || _PW;
}

async function login() {
  if (_token) return true;
  if (!_loginName || !_password) return false;
  try {
    const { data } = await req.post(
      `${API}/console/app/login?loginName=${encodeURIComponent(_loginName)}&password=${encodeURIComponent(_password)}&platform=app`,
      {},
      { headers: { 'user-agent': UA, 'accept-encoding': 'gzip' }, timeout: 25000 }
    );
    const obj = typeof data === 'object' ? data : JSON.parse(String(data || '{}'));
    const model = obj.model || {};
    _token = obj.code === 0 ? model.token || '' : '';
    return !!_token;
  } catch (e) {
    return false;
  }
}

async function apiGet(path, params) {
  if (!(await login())) return null;
  try {
    const qs = new URLSearchParams(params || {}).toString();
    const { data } = await req.get(`${API}${path}${qs ? '?' + qs : ''}`, {
      headers: { 'user-agent': UA, 'accept-encoding': 'gzip', token: _token },
      timeout: 25000,
    });
    const obj = typeof data === 'object' ? data : JSON.parse(String(data || '{}'));
    if (obj.code === 0) return obj.model || {};
    return null;
  } catch (e) {
    return null;
  }
}

function cover(item) {
  const c = item.coverUrl || item.cover || '';
  if (c.startsWith('http')) return c;
  return c.startsWith('/') ? CDN + c : '';
}

function videoItem(item) {
  return {
    vod_id: 'video:' + item.id,
    vod_name: item.title || item.number || '未命名视频',
    vod_pic: cover(item),
    vod_remarks: item.categories || item.tags || '',
  };
}
function comicItem(item) {
  return {
    vod_id: 'comic:' + item.id,
    vod_name: item.title || item.number || '未命名漫画',
    vod_pic: cover(item),
    vod_remarks: item.categories || item.tag || '',
  };
}
function audioItem(item) {
  return {
    vod_id: 'audio:' + item.id,
    vod_name: item.title || '未命名音频',
    vod_pic: cover(item),
    vod_remarks: item.categories || '',
  };
}
function novelItem(item) {
  return {
    vod_id: 'novel:' + item.id,
    vod_name: item.title || '未命名小说',
    vod_pic: cover(item),
    vod_remarks: item.categories || item.tags || '',
  };
}

function filterValue(cats) {
  return [{ n: '全部', v: '' }].concat(cats.map(([v, n]) => ({ n, v })));
}

async function home(reqIn) {
  const body = reqIn?.body || {};
  initAuth(body.extend);
  return {
    class: [
      { type_id: 'video', type_name: '视频' },
      { type_id: 'audio', type_name: '有声' },
      { type_id: 'comic', type_name: '漫画' },
      { type_id: 'novel', type_name: '小说' },
    ],
    filters: {
      video: [{ key: 'sub', name: '分类', value: filterValue(VIDEO_CATS) }],
      audio: [{ key: 'sub', name: '分类', value: filterValue(AUDIO_CATS) }],
      comic: [{ key: 'sub', name: '分类', value: filterValue(COMIC_CATS) }],
      novel: [{ key: 'sub', name: '分类', value: filterValue(NOVEL_CATS) }],
    },
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  initAuth(body.extend);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || 'video');
  const extend = body.extend && typeof body.extend === 'object' ? body.extend : {};
  const sub = extend.sub || '';

  if (tid === 'video') {
    const params = { orderType: 2, page, size: 50 };
    if (sub) {
      params.searchType = 2;
      params.author = sub;
    }
    const model = await apiGet('/video/app/video/search', params);
    if (!model) return { list: [], page, pagecount: 1, limit: 50, total: 0 };
    const data = model.data || [];
    return {
      list: data.map(videoItem),
      page: model.currentPage || page,
      pagecount: model.totalPage || 1,
      limit: model.pageSize || 50,
      total: model.totalCount || 0,
    };
  }
  if (tid === 'comic') {
    const params = { orderType: 2, page, size: 50 };
    if (sub) params.tag = sub;
    const model = await apiGet('/comic/app/comic/search', params);
    if (!model) return { list: [], page, pagecount: 1, limit: 50, total: 0 };
    const data = model.data || [];
    return {
      list: data.map(comicItem),
      page: model.currentPage || page,
      pagecount: model.totalPage || 1,
      limit: model.pageSize || 50,
      total: model.totalCount || 0,
    };
  }
  if (tid === 'audio') {
    const params = { orderType: 1, page, searchType: 1, size: 42 };
    if (sub) params.category = sub;
    const model = await apiGet('/audio/app/audio/search', params);
    if (!model) return { list: [], page, pagecount: 1, limit: 42, total: 0 };
    const data = model.data || [];
    return {
      list: data.map(audioItem),
      page: model.currentPage || page,
      pagecount: model.totalPage || 9999,
      limit: model.pageSize || 42,
      total: model.totalCount || 0,
    };
  }
  if (tid === 'novel') {
    const params = { orderType: 2, page, size: 50 };
    if (sub) params.tag = sub;
    const model = await apiGet('/novel/app/novel/search', params);
    if (!model) return { list: [], page, pagecount: 1, limit: 50, total: 0 };
    const data = model.data || [];
    return {
      list: data.map(novelItem),
      page: model.currentPage || page,
      pagecount: model.totalPage || 1,
      limit: model.pageSize || 50,
      total: model.totalCount || 0,
    };
  }
  return { list: [], page, pagecount: 1, limit: 50, total: 0 };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  initAuth(body.extend);
  const ids = Array.isArray(body.id) ? body.id : [body.id];
  const rawId = t(ids[0]);
  if (!rawId) return { list: [] };

  // 有声：独立详情接口
  if (rawId.startsWith('audio:')) {
    const audioId = rawId.slice(6);
    const model = await apiGet('/audio/app/audio/intro', { id: audioId });
    if (!model) return { list: [] };
    const playList = [];
    for (const ch of model.chapters || []) {
      const chModel = await apiGet('/audio/app/audio/chapter', { id: ch.id });
      const url = chModel ? chModel.chapterUrl || '' : '';
      if (url) playList.push(`${ch.title || '第' + (ch.order || 1) + '集'}$${url}`);
    }
    if (!playList.length && model.latestReadChapterUrl) {
      playList.push(`第1集$${model.latestReadChapterUrl}`);
    }
    return {
      list: [
        {
          vod_id: rawId,
          vod_name: model.title || '未命名音频',
          vod_pic: cover(model),
          vod_content: model.intro || model.brief || '',
          vod_actor: model.author || '',
          vod_play_from: 'UAA',
          vod_play_url: playList.join('#'),
        },
      ],
    };
  }

  // 小说：独立详情接口（章节走 po18 网页）
  if (rawId.startsWith('novel:')) {
    const novelId = rawId.slice(6);
    const model = await apiGet('/novel/app/novel/intro', { id: novelId });
    if (!model) return { list: [] };
    const vod = novelItem(model);
    vod.vod_content = model.brief || model.description || '';
    vod.vod_actor = model.authors || '';
    vod.vod_play_from = '小说';
    vod.vod_play_url = '';
    return { list: [vod] };
  }

  // 漫画：独立详情接口
  if (rawId.startsWith('comic:')) {
    const comicId = rawId.slice(6);
    const model = await apiGet('/comic/app/comic/intro', { id: comicId });
    if (!model) return { list: [] };
    const vod = comicItem(model);
    vod.vod_content = model.brief || model.description || '';
    vod.vod_actor = model.authors || '';
    vod.vod_play_from = '图文';
    vod.vod_play_url = '';
    return { list: [vod] };
  }

  // 视频：需要先从列表缓存拿（简化：直接用 id 查详情）
  if (rawId.startsWith('video:')) {
    const videoId = rawId.slice(6);
    const model = await apiGet('/video/app/video/intro', { id: videoId });
    if (!model) return { list: [] };
    const vod = videoItem(model);
    vod.vod_content = model.brief || model.description || '';
    vod.vod_actor = model.actress || model.authors || '';
    vod.vod_play_from = '官方线路';
    const url = model.url || '';
    vod.vod_play_url = url ? `播放$${url}` : '';
    return { list: [vod] };
  }

  return { list: [] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { url: '' };
  return { url: id, header: JSON.stringify({ 'user-agent': UA }) };
}

async function search() {
  return { list: [] };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
