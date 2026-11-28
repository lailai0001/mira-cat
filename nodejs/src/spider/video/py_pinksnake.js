import req from '../../util/req.js';

// PinkSnake 粉蛇短视频 - MiraPlayer Spider
// 站点：https://pinksnake.cc（中文成人短视频，JSON API 站）
// API：GET /api/videos?page&random&shuffle&category&q&start -> {items, categories, page, hasMore, shuffle}
// 年龄门只拦 HTML 页，API 不需要 cookie，可直接调。
// 播放：HLS m3u8 直链（单清晰度 720p，AES-128 加密、密钥公开可取）；
//   多集短剧走 episodes 数组（第1集/第2集…），详情直接给全部集的真地址，点开即播。
// random=0 为按时间倒序（最新，src 日期证实 20261128->20261126）；
// random=1 为随机推荐（站方默认 discover 流），翻页须带上页返回的 shuffle，否则 409。

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const BASE = 'https://pinksnake.cc';
const API = BASE + '/api/videos';

function t(v) { return String(v == null ? '' : v).trim(); }
function clean(s) {
  return t(s).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function abs(u) {
  const s = t(u);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('/')) return BASE + s;
  return BASE + '/' + s;
}

async function getApi(params) {
  const qs = Object.keys(params).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  try {
    const r = await req.get(API + '?' + qs, {
      headers: { 'User-Agent': UA, Referer: BASE + '/watch.html', Accept: 'application/json' },
      timeout: 15000,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    if (r.status < 200 || r.status >= 300) return null;
    const d = r.data;
    if (d && typeof d === 'object') return d; // 已是对象（harness 桩按 JSON 解析时）
    const raw = typeof d === 'string' ? d : '';
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  } catch (e) {
    return null;
  }
}

// 18 分类（2026-11-29 自 /api/videos 实测，顺序即站方顺序；
// 注意：AI短剧 有两个不同 id（不同片库），内容不同，两个都留）
const CATS = [
  ['20e0194a-ecf3-4a17-9511-4c2e7495047a:134', 'AI短剧'],
  ['20e0194a-ecf3-4a17-9511-4c2e7495047a:133', 'AI漫剧'],
  ['77aed18c-7c2f-42aa-aaf9-323bf41e6fb2:57', 'AI短剧'],
  ['1ae66c5e-fdc6-42ff-b7b3-22c485849b46:44', 'AI剧情'],
  ['1ae66c5e-fdc6-42ff-b7b3-22c485849b46:33', '主播直播'],
  ['1ae66c5e-fdc6-42ff-b7b3-22c485849b46:39', '传媒剧情'],
  ['1ae66c5e-fdc6-42ff-b7b3-22c485849b46:17', 'AV解说'],
  ['1ae66c5e-fdc6-42ff-b7b3-22c485849b46:25', '韩国主播'],
  ['20123ef2-1fb1-486d-a11a-32f3e744c5b3:15', '福利姬'],
  ['20123ef2-1fb1-486d-a11a-32f3e744c5b3:9', '网友自拍'],
  ['3f02f990-cd93-4078-8fac-d7c89c4686aa:31', '网红主播'],
  ['77aed18c-7c2f-42aa-aaf9-323bf41e6fb2:20', '国产自拍'],
  ['ead582c7-1c47-4739-b0e9-87541cce6bcb:92', 'SM调教'],
  ['ead582c7-1c47-4739-b0e9-87541cce6bcb:81', '酒店探花'],
  ['ead582c7-1c47-4739-b0e9-87541cce6bcb:96', '撸管必看'],
  ['bb787a7a-0cd2-4f2f-8e30-fd3b2693c1cc:12', '小众调教'],
  ['ead582c7-1c47-4739-b0e9-87541cce6bcb:55', '国产主播'],
  ['ead582c7-1c47-4739-b0e9-87541cce6bcb:82', '直播裸聊'],
];

const CATEGORIES = [
  { type_id: 'latest', type_name: '最新视频' },
  { type_id: 'hot', type_name: '热门视频' },
  ...CATS.map(([id, name]) => ({ type_id: 'cat:' + id, type_name: name })),
];

function parseItems(json) {
  const list = [];
  const items = (json && Array.isArray(json.items)) ? json.items : [];
  for (const it of items) {
    if (!it || !it.id) continue;
    const name = clean(it.title || '');
    if (!name) continue;
    list.push({
      vod_id: String(it.id),
      vod_name: name,
      vod_pic: abs(it.poster || ''),
      vod_remarks: clean(it.category || ''),
      vod_duration: '',
    });
  }
  return list;
}

// 随机推荐翻页：p1 直接取；p>1 须先取 p1 拿 shuffle 再取目标页（否则 409）
async function fetchHotPage(page) {
  if (page <= 1) {
    return getApi({ page: '1', random: '1', shuffle: '', category: '', q: '', start: '' });
  }
  const first = await getApi({ page: '1', random: '1', shuffle: '', category: '', q: '', start: '' });
  const shuf = first && first.shuffle ? String(first.shuffle) : '';
  if (!shuf) return null;
  return getApi({ page: String(page), random: '1', shuffle: shuf, category: '', q: '', start: '' });
}

async function fetchDetailItem(vodId) {
  const json = await getApi({ page: '1', random: '0', shuffle: '', category: '', q: '', start: vodId });
  if (!json || !Array.isArray(json.items) || !json.items.length) return null;
  for (const it of json.items) {
    if (String(it.id) === String(vodId)) return it;
  }
  return json.items[0];
}

function episodesOf(item) {
  const eps = [];
  const arr = (item && Array.isArray(item.episodes)) ? item.episodes : [];
  for (const ep of arr) {
    const src = t(ep && ep.src);
    if (!/^https?:\/\//i.test(src)) continue;
    const title = clean((ep && ep.title) || '') || 'HD';
    eps.push(title + '$' + src);
  }
  if (!eps.length && item && /^https?:\/\//i.test(t(item.src))) {
    eps.push('HD$' + t(item.src));
  }
  return eps.join('#');
}

async function home(e) {
  return { class: CATEGORIES };
}

async function category(e) {
  const id = String((e.body && e.body.id) || 'latest');
  let page = parseInt((e.body && e.body.page) || 1, 10) || 1;
  if (page < 1) page = 1;
  let json = null;
  if (id === 'latest') {
    json = await getApi({ page: String(page), random: '0', shuffle: '', category: '', q: '', start: '' });
  } else if (id === 'hot') {
    json = await fetchHotPage(page);
  } else if (id.startsWith('cat:')) {
    json = await getApi({ page: String(page), random: '0', shuffle: '', category: id.slice(4), q: '', start: '' });
  } else {
    json = await getApi({ page: String(page), random: '0', shuffle: '', category: '', q: '', start: '' });
  }
  const list = json ? parseItems(json) : [];
  const hasMore = json ? !!json.hasMore : false;
  return { page, pagecount: hasMore ? page + 1 : page, list };
}

async function detail(e) {
  const id = String((e.body && e.body.id) || '');
  if (!id) return { list: [] };
  const item = await fetchDetailItem(id);
  if (!item) return { list: [] };
  const eps = episodesOf(item);
  if (!eps) return { list: [] };
  return {
    list: [{
      vod_id: String(item.id),
      vod_name: clean(item.title || ''),
      vod_pic: abs(item.poster || ''),
      vod_content: clean(item.description || ''),
      vod_play_from: 'PinkSnake',
      vod_play_url: eps,
    }],
  };
}

async function play(e) {
  const id = String((e.body && e.body.id) || '');
  let url = '';
  if (id.includes('$')) {
    url = (id.split('#')[0].split('$').pop() || '');
  } else if (/^https?:\/\//i.test(id) && /\.m3u8(\?|#|$)/i.test(id)) {
    url = id;
  }
  if (!url && id) {
    const item = await fetchDetailItem(id);
    if (item) {
      const eps = episodesOf(item);
      if (eps) url = (eps.split('#')[0].split('$').pop() || '');
    }
  }
  return {
    parse: 0,
    url: url || '',
    header: { 'User-Agent': UA, Referer: BASE + '/watch.html', origin: BASE },
  };
}

async function search(e) {
  const wd = String((e.body && e.body.wd) || '');
  let page = parseInt((e.body && e.body.page) || 1, 10) || 1;
  if (page < 1) page = 1;
  const json = await getApi({ page: String(page), random: '0', shuffle: '', category: '', q: wd, start: '' });
  const list = json ? parseItems(json) : [];
  const hasMore = json ? !!json.hasMore : false;
  return { page, pagecount: hasMore ? page + 1 : page, list };
}

export default function spider() {
  return {
    meta: { key: 'py_pinksnake', name: 'PinkSnake', type: 3 },
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
