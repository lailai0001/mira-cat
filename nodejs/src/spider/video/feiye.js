import req from '../../util/req.js';

const KEY = 'py_feiye';
const NAME = '绯夜';
const API = 'https://feiyechengren.pages.dev/api/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
const REFERER = 'https://feiyechengren.pages.dev/';

async function fetchJson(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = API + '?' + qs.toString();
  try {
    const { data } = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': REFERER },
      timeout: 20000,
    });
    const j = typeof data === 'string' ? JSON.parse(data) : data;
    return j || null;
  } catch (e) {
    return null;
  }
}

function normItem(v) {
  if (!v) return null;
  return {
    vod_id: String(v.vod_id ?? v.id ?? ''),
    vod_name: v.vod_name || v.name || '',
    vod_pic: v.vod_pic || v.pic || '',
    vod_remarks: v.vod_remarks || v.vod_time || '',
  };
}

async function home() {
  const d = await fetchJson({ ac: 'list' });
  const list = [];
  if (d && Array.isArray(d.class)) {
    // 只展示叶子分类（父分类自身挂 0 部片），与官网前端逻辑一致
    const pids = new Set(d.class.map((c) => String(c.type_pid)));
    const leaves = d.class.filter((c) => !pids.has(String(c.type_id)));
    (leaves.length ? leaves : d.class).forEach((c) => {
      list.push({ type_id: String(c.type_id), type_name: c.type_name || String(c.type_id) });
    });
  }
  return { class: list };
}

async function homeVod() {
  const d = await fetchJson({ ac: 'videolist', pg: 1, pagesize: 20 });
  const list = [];
  if (d && Array.isArray(d.list)) {
    d.list.forEach((v) => {
      const it = normItem(v);
      if (it && it.vod_id) list.push(it);
    });
  }
  return { list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || '');
  const params = { ac: 'videolist', pg: page, pagesize: 30 };
  if (tid) params.t = tid;
  const d = await fetchJson(params);
  const list = [];
  if (d && Array.isArray(d.list)) {
    d.list.forEach((v) => {
      const it = normItem(v);
      if (it && it.vod_id) list.push(it);
    });
  }
  return { page, pagecount: 999, limit: list.length || 30, total: 999 * 30, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const ids = Array.isArray(body.id) ? body.id : [body.id];
  const vid = String(ids[0] || '').trim();
  if (!vid) return { list: [] };
  const d = await fetchJson({ ac: 'detail', ids: vid });
  const items = (d && Array.isArray(d.list) ? d.list : []);
  const v = items[0];
  if (!v) return { list: [] };
  return {
    list: [{
      vod_id: String(v.vod_id ?? vid),
      vod_name: v.vod_name || vid,
      vod_pic: v.vod_pic || '',
      vod_remarks: v.vod_remarks || '',
      vod_content: (v.vod_content || v.vod_blurb || '').replace(/<[^>]*>/g, ' ').trim(),
      vod_play_from: v.vod_play_from || NAME,
      vod_play_url: v.vod_play_url || '',
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '').trim();
  // detail 返回的 vod_play_url 形如 "第1集$https://...m3u8"，play 收到的是完整地址
  // 兼容 "名称$地址" 格式
  let url = id;
  const dollar = id.lastIndexOf('$');
  if (dollar >= 0) url = id.slice(dollar + 1).trim();
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  const d = await fetchJson({ ac: 'videolist', pg: page, pagesize: 30, wd });
  const list = [];
  if (d && Array.isArray(d.list)) {
    d.list.forEach((v) => {
      const it = normItem(v);
      if (it && it.vod_id) list.push(it);
    });
  }
  return { page, pagecount: 999, limit: list.length || 30, total: 999 * 30, list };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/homeVod', homeVod);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
