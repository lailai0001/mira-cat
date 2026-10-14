import req from '../../util/req.js';

// 转换自 XPTV: https://raw.githubusercontent.com/fangkuia/XPTV/main/js/taiav.js
const KEY = 'py_taiav';
const NAME = 'Taiav';
const HOST = 'https://taiav.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1.1 Mobile/15E148 Safari/604.1';

// 注意: XPTV 源的 tabs[].ext 里没有 id, 只有 tip('category'/'tag') 和 class(分类名);
// 这里把 {tip,class} JSON 编码后作为 type_id, category() 再解回来。
const TABS = [
  { name: '网红主播', tip: 'category', class: '网红主播' },
  { name: '国产AV', tip: 'category', class: '国产AV' },
  { name: '有码', tip: 'category', class: '有码' },
  { name: '无码', tip: 'category', class: '无码' },
  { name: 'Onlyfans', tip: 'tag', class: 'Onlyfans' },
  { name: 'Korean Bj', tip: 'tag', class: 'Korean Bj' },
  { name: '探花', tip: 'tag', class: '探花' },
];

const CLASSES = TABS.map((t) => ({
  type_id: JSON.stringify({ tip: t.tip, class: t.class }),
  type_name: t.name,
}));

const PAGE_SIZE = 12;

function headers() {
  return { 'User-Agent': UA };
}

async function getJson(url) {
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 15000 });
    if (typeof data === 'string') {
      const t = data.trim();
      if (!t) return null;
      try {
        return JSON.parse(t);
      } catch (e) {
        return null;
      }
    }
    return data;
  } catch (e) {
    return null;
  }
}

function parseCards(arr) {
  const list = [];
  if (!Array.isArray(arr)) return list;
  for (const e of arr) {
    if (!e || !e._id) continue;
    const vid = String(e._id);
    const name = String(e.originalname || '').trim();
    if (!name) continue;
    const posterUrl = e.poster2 && e.poster2.url ? String(e.poster2.url) : '';
    const pic = posterUrl ? (posterUrl.startsWith('http') ? posterUrl : HOST + posterUrl) : '';
    const duration = String(e.duration || '').trim();
    list.push({
      vod_id: vid,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: duration ? `HD·${duration}` : 'HD',
      vod_pubdate: String(e.createAt || ''),
    });
  }
  return list;
}

// XPTV getCards: ext={tip,class,page}, URL: /api/getcontents?page=&size=12&<tip>=<class>&type=movie,tv
async function getCards(ext) {
  const { tip, class: cls, page = 1 } = ext || {};
  const text = encodeURIComponent(String(cls || ''));
  const url = `${HOST}/api/getcontents?page=${page}&size=${PAGE_SIZE}&${tip}=${text}&type=movie,tv`;
  const data = await getJson(url);
  return parseCards(data);
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  return { list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let ext = {};
  try {
    ext = JSON.parse(String(body.id || '{}'));
  } catch (e) {
    ext = {};
  }
  if (!ext.tip || !ext.class) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  const list = await getCards({ tip: ext.tip, class: ext.class, page });
  const hasMore = list.length >= PAGE_SIZE;
  return {
    page,
    pagecount: hasMore ? 9999 : page,
    limit: list.length || PAGE_SIZE,
    total: hasMore ? 999999 : (page - 1) * PAGE_SIZE + list.length,
    list,
  };
}

// XPTV getTracks: ext.url=/api/getmovie?type=1280&id=<vod_id> -> {m3u8}
// detail 收到的 body.id 就是 vod_id(_id), 直接拼出 getmovie URL。
async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vid = String(ids[0] || '').trim();
  if (!vid) return { list: [] };
  const url = `${HOST}/api/getmovie?type=1280&id=${encodeURIComponent(vid)}`;
  const playlist = await getJson(url);
  const m3u8 = playlist && playlist.m3u8 ? String(playlist.m3u8) : '';
  if (!m3u8) return { list: [] };
  const playurl = m3u8.startsWith('http') ? m3u8 : HOST + m3u8;
  return {
    list: [
      {
        vod_id: vid,
        vod_name: vid,
        vod_pic: '',
        vod_remarks: 'HD',
        vod_content: '',
        vod_play_from: NAME,
        vod_play_url: `播放$${playurl}`,
      },
    ],
  };
}

// XPTV getPlayinfo: body.id 为 m3u8 播放地址, 直接返回直链
async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '');
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, Origin: HOST },
  };
}

// XPTV search: /api/getcontents?page=&size=48&q=<关键词>&type=movie,tv
async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  const size = 48;
  const url = `${HOST}/api/getcontents?page=${page}&size=${size}&q=${encodeURIComponent(wd)}&type=movie,tv`;
  const data = await getJson(url);
  const list = parseCards(data);
  const hasMore = list.length >= size;
  return {
    page,
    pagecount: hasMore ? 9999 : page,
    limit: list.length || size,
    total: hasMore ? 999999 : (page - 1) * size + list.length,
    list,
  };
}

export default function createSpider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
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
