// 禁果短剧 - CatPawOpen 格式
// 转换自 REX forward.jinguoduanju.tut，站点 https://jinguoduanju.app
import req from '../../util/req.js';

const KEY = 'py_jinguo';
const NAME = '禁果短剧';
const API_BASE = 'https://jinguoduanju.app';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

let _token = '';
let _deviceId = '';

function t(v) {
  return String(v == null ? '' : v).trim();
}

function randDevice() {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[(Math.random() * 16) | 0];
  return s;
}

async function ensureToken() {
  if (_token) return _token;
  if (!_deviceId) _deviceId = randDevice();
  const url = API_BASE + '/api/v1/auth/device';
  const { data } = await req.post(url, {
    deviceId: 'h5:' + _deviceId,
    channelCode: '',
    attributionToken: '',
  }, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Referer': API_BASE + '/',
      'Origin': API_BASE,
    },
    timeout: 20000,
  });
  let d = data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) {} }
  _token = t(d && d.token);
  if (!_token) throw new Error('设备登录失败');
  return _token;
}

async function apiGet(path, query) {
  await ensureToken();
  let url = API_BASE + '/api/v1' + path;
  const params = new URLSearchParams();
  for (const k of Object.keys(query || {})) {
    const v = query[k];
    if (v == null || v === '') continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  if (qs) url += '?' + qs;
  const { data } = await req.get(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': UA,
      'Referer': API_BASE + '/',
      'Origin': API_BASE,
      'Authorization': 'Bearer ' + _token,
    },
    timeout: 20000,
  });
  let d = data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) {} }
  if (d && d.status === 401) {
    _token = '';
    return apiGet(path, query);
  }
  return d;
}

const CATS = [
  { type_id: 'heat', type_name: '热度' },
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'landing', type_name: '首页推荐' },
  { type_id: 'nav_all', type_name: '全部' },
  { type_id: 'nav_original', type_name: '原创精品' },
  { type_id: 'nav_single', type_name: '单体作品' },
  { type_id: 'nav_anime', type_name: '动漫改编' },
  { type_id: 'nav_movie', type_name: '影视改编' },
  { type_id: 'len_multi', type_name: '多集' },
  { type_id: 'len_single', type_name: '单集' },
  { type_id: 'tag_mogai', type_name: '魔改' },
  { type_id: 'tag_dushi', type_name: '都市' },
  { type_id: 'tag_zhichang', type_name: '职场' },
  { type_id: 'tag_qihuan', type_name: '奇幻' },
  { type_id: 'tag_guzhuang', type_name: '古装' },
  { type_id: 'tag_dongman', type_name: '动漫' },
];

function toVod(it) {
  if (!it || !it.id) return null;
  const cover = it.coverUrl || it.cover || '';
  const ep = it.episodeCount || '';
  let remark = ep ? '全' + ep + '集' : '';
  const tags = Array.isArray(it.tags) ? it.tags.join(' · ') : '';
  if (tags) remark = remark ? remark + ' · ' + tags : tags;
  return {
    vod_id: 'jgdj:' + it.id,
    vod_name: t(it.title) || String(it.id),
    vod_pic: cover,
    vod_remarks: remark,
  };
}

async function loadDramas(query, page) {
  page = Math.max(1, parseInt(page) || 1);
  const q = Object.assign({ sort: 'latest' }, query || {});
  const tagFilter = q._tagFilter || '';
  delete q._tagFilter;
  let list = await apiGet('/dramas', q);
  if (!Array.isArray(list)) list = [];
  if (tagFilter) {
    list = list.filter(it => Array.isArray(it.tags) && it.tags.some(x => String(x) === tagFilter));
  }
  const PAGE_SIZE = 24;
  const start = (page - 1) * PAGE_SIZE;
  const sliced = list.slice(start, start + PAGE_SIZE);
  const items = sliced.map(toVod).filter(Boolean);
  return { page, pagecount: list.length > start + PAGE_SIZE ? page + 1 : page, list: items };
}

const CAT_QUERY = {
  heat: { sort: 'heat' },
  latest: { sort: 'latest' },
  landing: null, // special
  nav_all: { sort: 'latest', navigationId: 2 },
  nav_original: { sort: 'latest', navigationId: 7 },
  nav_single: { sort: 'latest', navigationId: 3 },
  nav_anime: { sort: 'latest', navigationId: 6 },
  nav_movie: { sort: 'latest', navigationId: 5 },
  len_multi: { sort: 'latest', length: 'multi' },
  len_single: { sort: 'latest', length: 'single' },
  tag_mogai: { sort: 'latest', _tagFilter: '魔改' },
  tag_dushi: { sort: 'latest', _tagFilter: '都市' },
  tag_zhichang: { sort: 'latest', _tagFilter: '职场' },
  tag_qihuan: { sort: 'latest', _tagFilter: '奇幻' },
  tag_guzhuang: { sort: 'latest', _tagFilter: '古装' },
  tag_dongman: { sort: 'latest', _tagFilter: '动漫' },
};

async function home() {
  return { class: CATS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || 'latest');
  const page = body.page || 1;
  if (id === 'landing') {
    const data = await apiGet('/landing', {});
    const list = (data && data.dramas) || [];
    const PAGE_SIZE = 24;
    const p = Math.max(1, parseInt(page) || 1);
    const sliced = list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    return { page: p, pagecount: p, list: sliced.map(toVod).filter(Boolean) };
  }
  const q = CAT_QUERY[id] || { sort: 'latest' };
  return loadDramas(q, page);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  id = id.replace(/^jgdj:/, '');
  if (!id) return { list: [] };
  const data = await apiGet('/dramas/' + encodeURIComponent(id), {});
  const drama = (data && data.drama) || {};
  const eps = (data && data.episodes) || [];
  const cover = drama.coverUrl || '';
  const tags = Array.isArray(drama.tags) ? drama.tags.join(' · ') : '';
  const playUrls = [];
  const playFrom = [];
  // 分集播放：每集一个播放源
  const epList = eps.map((ep, i) => {
    const n = ep.number || i + 1;
    const epId = ep.id || '';
    const title = t(ep.title || '第' + n + '集');
    // vod_play_url 格式：标题$地址，用 JSON 传递 episodeId
    const payload = JSON.stringify({ dramaId: id, episodeId: String(epId), epNum: String(n) });
    return title + '$' + payload;
  });
  if (epList.length) {
    playFrom.push('禁果');
    playUrls.push(epList.join('#'));
  } else {
    // 兜底单集
    const payload = JSON.stringify({ dramaId: id, episodeId: '', epNum: '1' });
    playFrom.push('禁果');
    playUrls.push('第1集$' + payload);
  }
  return {
    list: [{
      vod_id: 'jgdj:' + id,
      vod_name: t(drama.title) || id,
      vod_pic: cover,
      vod_content: tags,
      vod_play_from: playFrom.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  let payload = null;
  try { payload = JSON.parse(id); } catch (e) {}
  if (!payload || !payload.dramaId) return { parse: 0, url: '' };
  let episodeId = t(payload.episodeId);
  if (!episodeId) {
    // 通过 dramaId + epNum 解析 episodeId
    const data = await apiGet('/dramas/' + encodeURIComponent(payload.dramaId), {});
    const eps = (data && data.episodes) || [];
    for (const ep of eps) {
      if (String(ep.number) === String(payload.epNum) || String(ep.id) === String(payload.epNum)) {
        episodeId = t(ep.id);
        break;
      }
    }
    if (!episodeId && eps.length) episodeId = t(eps[0].id);
  }
  if (!episodeId) return { parse: 0, url: '' };
  const playData = await apiGet('/episodes/' + encodeURIComponent(episodeId) + '/play', {});
  const url = t(playData && playData.videoUrl);
  if (!url) return { parse: 0, url: '' };
  return {
    parse: 0,
    url,
    header: {
      'User-Agent': UA,
      'Referer': API_BASE + '/',
      'Origin': API_BASE,
    },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, parseInt(body.page) || 1);
  if (!kw) return { list: [] };
  let list = await apiGet('/dramas', { sort: 'latest', q: kw });
  if (!Array.isArray(list)) list = [];
  const PAGE_SIZE = 24;
  const sliced = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { page, pagecount: page, list: sliced.map(toVod).filter(Boolean) };
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
