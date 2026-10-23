// 野果短剧 - CatPawOpen 格式
// 转换自 REX forward.yeguodj.tut，API https://www.yeguodj.com/api.php (AES-CBC 加密响应)
import req from '../../util/req.js';
import crypto from 'crypto';

const KEY = 'py_yeguo';
const NAME = '野果短剧';
const API_BASE = 'https://www.yeguodj.com/api.php';
const SITE = 'https://yeguodj.com';
const IMG_WORKER = 'https://bagua-img-proxy.li768435813.workers.dev';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const API_KEY = '2acf7e91e9864673';
const API_IV = '1c29882d3ddfcfd6';

const CATS = [
  { type_id: 'home', type_name: '首页推荐' },
  { type_id: 'rank', type_name: '排行榜' },
  { type_id: 'yuanchuang', type_name: '野果原创' },
  { type_id: 'zhenren', type_name: '真人短剧' },
  { type_id: 'mogai', type_name: '魔改漫剧' },
  { type_id: 'manju', type_name: '漫剧' },
  { type_id: 'aiduanju', type_name: 'AI短剧' },
  { type_id: 'wanghong', type_name: '网红改编' },
  { type_id: 'jinji', type_name: '禁忌伦理' },
  { type_id: 'zhichang', type_name: '职场反差' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function aesDecrypt(b64) {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    Buffer.from(API_KEY, 'utf8'),
    Buffer.from(API_IV, 'utf8')
  );
  decipher.setAutoPadding(true);
  let plain = decipher.update(b64, 'base64', 'utf8');
  plain += decipher.final('utf8');
  return plain;
}

async function apiPost(path, body) {
  const url = API_BASE + path;
  const { data } = await req.post(url, body || {}, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Referer': SITE + '/',
      'Origin': SITE,
    },
    timeout: 20000,
  });
  let d = data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) {} }
  if (!d) throw new Error('空响应: ' + path);
  if (typeof d.data === 'string' && d.data.length > 20) {
    try {
      d.data = JSON.parse(aesDecrypt(d.data));
    } catch (e) {
      throw new Error('API 解密失败: ' + e.message);
    }
  }
  return d;
}

function unwrap(d) {
  if (!d) return {};
  const x = d.data != null ? d.data : d;
  if (x && x.data != null && typeof x.data === 'object') return x.data;
  return x;
}

function proxiedCover(url) {
  url = t(url);
  if (!url) return '';
  // pic.sugfew.cn（现行主力封面主机）与 pic.jtzatly.cn 的图是 AES-128-CBC 加密存储
  // （与 818/91 同手法）：直连拿到的是密文、App 解不出图，必须走解密 Worker 出图。
  if (/pic\.sugfew\.cn|pic\.jtzatly\.cn/i.test(url)) {
    return IMG_WORKER + '/img?url=' + encodeURIComponent(url);
  }
  // 其余主机（如 imgpublic.ycomesc.live）是明文图，直连即可；
  // 原 wulii 出图代理已失效（实测 500），不再走它。
  return url;
}

function toVod(it) {
  if (!it) return null;
  const id = t(it.video_id != null ? it.video_id : it.id);
  if (!id || !/^\d+$/.test(id)) return null;
  const title = t(it.title || it.video_title || it.name);
  if (!title) return null;
  const ep = it.episode_count || it.episodes || '';
  const remark = ep ? '更新至' + ep + '集' : t(it.update_status || '');
  return {
    vod_id: 'yeguo:' + id,
    vod_name: title,
    vod_pic: proxiedCover(t(it.cover || it.cover_img || it.pic || '')),
    vod_remarks: remark,
  };
}

function listFrom(data) {
  const inner = unwrap({ data });
  const arr = (inner && inner.list) || (inner && inner.top_list) || (Array.isArray(inner) ? inner : []);
  const out = [];
  const seen = {};
  for (const it of arr) {
    const v = toVod(it);
    if (!v || seen[v.vod_id]) continue;
    seen[v.vod_id] = 1;
    out.push(v);
  }
  return out;
}

async function home() {
  return { class: CATS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || 'home');
  const page = Math.max(1, parseInt(body.page) || 1);
  let d;
  if (id === 'home') {
    if (page > 1) {
      d = await apiPost('/api/theater/exploreList', { page: page - 1, limit: 24 });
    } else {
      d = await apiPost('/api/home/homePage', {});
      const inner = unwrap(d);
      let list = (inner && inner.top_list) || [];
      const mods = (inner && inner.modules && inner.modules.list) || [];
      for (const m of mods) {
        if (m && Array.isArray(m.list)) list = list.concat(m.list);
        else if (m && (m.video_id || m.id)) list.push(m);
      }
      return { page, pagecount: page + 1, list: listFrom({ list }) };
    }
  } else if (id === 'rank') {
    d = await apiPost('/api/theater/videoRank', { page, limit: 24 });
  } else if (id === 'yuanchuang') {
    d = await apiPost('/api/theater/exploreList', { page, limit: 24, theme: 7 });
  } else if (id === 'zhenren') {
    d = await apiPost('/api/theater/exploreList', { page, limit: 24, theme: 8 });
  } else if (id === 'mogai') {
    d = await apiPost('/api/theater/exploreList', { page, limit: 24, theme: 9 });
  } else if (id === 'wanghong') {
    d = await apiPost('/api/theater/exploreList', { page, limit: 24, theme: 10 });
  } else if (id === 'jinji') {
    d = await apiPost('/api/theater/exploreList', { page, limit: 24, setting: 23 });
  } else if (id === 'zhichang') {
    d = await apiPost('/api/theater/exploreList', { page, limit: 24, setting: 24 });
  } else {
    d = await apiPost('/api/theater/exploreList', { page, limit: 24 });
  }
  const list = listFrom(d.data);
  return { page, pagecount: list.length ? page + 1 : page, list };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, parseInt(body.page) || 1);
  if (!kw) return { list: [] };
  const d = await apiPost('/api/search/result', { keyword: kw, page, tab: 'video' });
  return { page, pagecount: page, list: listFrom(d.data) };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  id = id.replace(/^yeguo:/, '').split('||')[0].split(':')[0];
  if (!id || !/^\d+$/.test(id)) return { list: [] };
  const d = await apiPost('/api/playlet/detail', {
    video_id: Number(id), id: Number(id), episode_id: '0', related_limit: '0',
  });
  let info = unwrap(d);
  if (info.video_id == null && info.data) info = info.data;
  const title = t(info.title || id);
  const cover = proxiedCover(t(info.cover || info.cover_img || ''));
  const eps = Array.isArray(info.episodes) ? info.episodes : [];
  const playUrls = [];
  const seen = {};
  const epItems = [];
  for (const ep of eps) {
    if (!ep) continue;
    const eid = t(ep.id || ep.episode_id || '');
    const n = Number(ep.sort || ep.episode || 0) || 0;
    if (!eid || !/^\d+$/.test(eid) || n < 1 || seen[eid]) continue;
    seen[eid] = 1;
    epItems.push({ n, eid, title: t(ep.title || '第' + n + '集') });
  }
  epItems.sort((a, b) => a.n - b.n);
  if (epItems.length) {
    playUrls.push(epItems.map(e => e.title + '$' + JSON.stringify({ videoId: id, episodeId: e.eid, ep: String(e.n) })).join('#'));
  }
  return {
    list: [{
      vod_id: 'yeguo:' + id,
      vod_name: title,
      vod_pic: cover,
      vod_content: t(info.description || info.intro || ''),
      vod_play_from: epItems.length ? '野果' : '',
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  let payload = null;
  try { payload = JSON.parse(id); } catch (e) {}
  if (!payload || !payload.videoId) return { parse: 0, url: '' };
  const d = await apiPost('/api/playlet/play', {
    video_id: Number(payload.videoId) || payload.videoId,
    playlet_id: Number(payload.videoId) || payload.videoId,
    episode_id: Number(payload.episodeId) || payload.episodeId,
  });
  let info = unwrap(d);
  if (info.video_url == null && info.data) info = info.data;
  const url = t(info.video_url || info.video_url_h265 || '');
  if (!url) return { parse: 0, url: '' };
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': SITE + '/', 'Origin': SITE },
  };
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
