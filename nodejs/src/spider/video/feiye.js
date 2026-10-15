import req from '../../util/req.js';

const KEY = 'py_feiye';
const NAME = '绯夜';
const HOST = 'https://feiyechengren.pages.dev';
const APIS = ['/api/', '/api2/', '/api3/'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';

// 双通道：先框架 req，失败再原生 fetch（MiraPlayer 内无 fetch）
async function getText(url) {
  const headers = { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': HOST + '/' };
  try {
    const { data } = await req.get(url, { headers, timeout: 20000 });
    const t = String(data || '');
    if (t.length > 100) return t;
  } catch (e) { /* fallback */ }
  try {
    if (typeof fetch === 'undefined') return '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return '';
    const t = await r.text();
    return t.length > 100 ? t : '';
  } catch (e) { return ''; }
}

async function fetchJson(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  for (const base of APIS) {
    const t = await getText(HOST + base + '?' + q);
    if (t) {
      try {
        const j = JSON.parse(t);
        if (j && j.code === 1) return j;
      } catch (e) { /* try next line */ }
    }
  }
  return null;
}

function normItem(v) {
  if (!v) return null;
  const id = String(v.vod_id ?? v.id ?? '');
  if (!id) return null;
  return {
    vod_id: id,
    vod_name: v.vod_name || v.name || '',
    vod_pic: v.vod_pic || v.pic || '',
    vod_remarks: v.vod_remarks || v.vod_class || v.vod_time || '',
  };
}

function itemsOf(d) {
  const list = [];
  if (d && Array.isArray(d.list)) {
    for (const v of d.list) {
      const it = normItem(v);
      if (it) list.push(it);
    }
  }
  return list;
}

// 分类从 videolist 的 type_id/type_name 动态收集（站点没有单独的分类接口）
// 扫前 5 页，最多收集 14 个（与官网前端 hotCats 一致）
async function home() {
  const list = [{ type_id: '', type_name: '全部' }];
  const seen = new Set();
  for (let pg = 1; pg <= 5; pg++) {
    const d = await fetchJson({ ac: 'videolist', pg });
    if (!d || !Array.isArray(d.list) || !d.list.length) break;
    for (const v of d.list) {
      const tid = String(v.type_id || '');
      const tname = v.type_name || '';
      if (tid && tname && !seen.has(tid)) {
        seen.add(tid);
        list.push({ type_id: tid, type_name: tname });
      }
      if (list.length >= 15) break;
    }
    if (list.length >= 15) break;
  }
  return { class: list };
}

async function homeVod() {
  const d = await fetchJson({ ac: 'videolist', pg: 1 });
  return { list: itemsOf(d) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || '');
  const params = { ac: 'videolist', pg: page };
  if (tid) params.t = tid;
  const d = await fetchJson(params);
  const list = itemsOf(d);
  const pagecount = parseInt((d && d.pagecount) || page, 10) || page;
  return { page, pagecount, limit: 30, total: pagecount * 30, list };
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
      vod_remarks: v.vod_remarks || v.vod_class || '',
      vod_content: (v.vod_content || v.vod_blurb || '').replace(/<[^>]*>/g, ' ').trim(),
      vod_play_from: v.vod_play_from || NAME,
      vod_play_url: v.vod_play_url || '',
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '').trim();
  let url = id;
  const dollar = id.lastIndexOf('$');
  if (dollar >= 0) url = id.slice(dollar + 1).trim();
  if (!url) return { parse: 1, url: id, header: { 'User-Agent': UA } };
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': HOST + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  const d = await fetchJson({ ac: 'videolist', pg: page, wd });
  const list = itemsOf(d);
  const pagecount = parseInt((d && d.pagecount) || page, 10) || page;
  return { page, pagecount, limit: 30, total: pagecount * 30, list };
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
