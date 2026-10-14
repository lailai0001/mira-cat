import req from '../../util/req.js';

const KEY = 'py_getav';
const NAME = 'GetAV';
const HOST = 'https://getav.me';
const STATIC_HOST = 'https://static.worldstatic.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function formatPoster(raw) {
  if (!raw) return '';
  let pic = String(raw).trim();
  if (pic.startsWith('//')) pic = 'https:' + pic;
  else if (pic.startsWith('/')) pic = STATIC_HOST + pic;
  return pic;
}

async function fetchApi(path) {
  const url = path.startsWith('http') ? path : HOST + path;
  try {
    const { data } = await req.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://getav.me/zh',
        'Origin': 'https://getav.me',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    });
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return {};
  }
}

function parseVodList(items) {
  const list = [];
  for (const it of (items || [])) {
    const vodId = String(it.id || it.vod_id || '');
    const vodName = String(it.title || it.vod_name || it.name || '').trim();
    if (!vodId || !vodName) continue;
    list.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: formatPoster(it.poster || it.vod_pic || it.img || it.localImg),
      vod_remarks: String(it.duration || it.vod_remarks || ''),
    });
  }
  return list;
}

async function init() {
  return {};
}

async function home() {
  const classes = [
    { type_id: 'new', type_name: '最新' },
    { type_id: 'hot', type_name: '热门' },
    { type_id: 'uncensored', type_name: '无码' },
    { type_id: 'censored', type_name: '有码' },
  ];
  return { class: classes, filters: {}, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'new');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  
  let apiPath = `/api/videos?page=${page}&limit=24`;
  if (tid === 'hot') apiPath += '&sort=hot';
  else if (tid === 'uncensored') apiPath += '&type=uncensored';
  else if (tid === 'censored') apiPath += '&type=censored';
  
  const res = await fetchApi(apiPath);
  const data = res.data || res;
  const items = data.list || data.videos || data.items || [];
  const list = parseVodList(items);
  
  return {
    page,
    pagecount: list.length >= 24 ? page + 1 : page,
    limit: 24,
    total: list.length,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const id of (ids || []).filter(Boolean)) {
    const res = await fetchApi(`/api/video/${id}`);
    const data = res.data || res;
    if (!data || !data.id) continue;
    list.push({
      vod_id: String(data.id),
      vod_name: String(data.title || ''),
      vod_pic: formatPoster(data.poster || data.localImg),
      vod_content: String(data.description || '').trim(),
      vod_play_from: 'GetAV',
      vod_play_url: `播放$${data.id}`,
    });
  }
  return { list };
}

async function play(reqIn) {
  const id = String(reqIn?.body?.id || '').trim();
  if (!id) return { parse: 0, url: '' };
  const res = await fetchApi(`/api/video/${id}/play`);
  const data = res.data || res;
  const url = String(data.url || data.playUrl || data.stream || '');
  if (url) {
    return {
      parse: 0,
      url,
      header: { Referer: 'https://getav.me/', 'User-Agent': UA },
    };
  }
  return { parse: 0, url: '', message: '未获取到播放地址' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  
  const res = await fetchApi(`/api/search?keyword=${encodeURIComponent(wd)}&page=${page}&limit=24`);
  const data = res.data || res;
  const items = data.list || data.videos || [];
  const list = parseVodList(items);
  
  return { page, pagecount: page, limit: 24, total: list.length, list };
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
