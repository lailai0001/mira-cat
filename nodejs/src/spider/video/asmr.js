import req from '../../util/req.js';

const KEY = 'py_asmr';
const NAME = 'ASMR';
const API = 'https://api.asmr.one';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const PAGE_SIZE = 20;

const ORDERS = [
  { type_id: 'create_date', type_name: '最新' },
  { type_id: 'release', type_name: '新发' },
  { type_id: 'dl_count', type_name: '最热' },
  { type_id: 'rate_average_2dp', type_name: '高分' },
  { type_id: 'review_count', type_name: '热议' },
];

function t(v) { return String(v == null ? '' : v).trim(); }

async function apiGet(path) {
  try {
    const res = await req.get(API + path, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.asmr.one/' },
      timeout: 20000,
    });
    const data = res.data;
    if (typeof data === 'object') return data;
    return JSON.parse(String(data || '{}'));
  } catch (e) { return {}; }
}

function cleanTitle(s) {
  return t(s).replace(/\u3010/g, '[').replace(/\u3011/g, ']').replace(/\$/g, '').replace(/#/g, '');
}

function rowsToVods(rows) {
  const out = [];
  for (const w of rows || []) {
    const wid = String(w.id || '');
    if (!wid) continue;
    out.push({
      vod_id: wid,
      vod_name: cleanTitle(w.title),
      vod_pic: w.mainCoverUrl || w.samCoverUrl || '',
      vod_remarks: String(w.dl_count || ''),
    });
  }
  return out;
}

function collectAudio(node, out) {
  out = out || [];
  if (!node) return out;
  if (node.type === 'audio') out.push(node);
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) collectAudio(children[i], out);
  return out;
}

async function home() {
  const d = await apiGet('/api/works?order=create_date&sort=desc&page=1&pageSize=20');
  const rows = d && typeof d === 'object' ? d.works : [];
  return { class: ORDERS, list: rowsToVods(rows) };
}

async function category(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const orderIds = ORDERS.map(function(o) { return o.type_id; });
  const order = orderIds.indexOf(body.id) >= 0 ? body.id : 'create_date';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const d = await apiGet('/api/works?order=' + order + '&sort=desc&page=' + page + '&pageSize=' + PAGE_SIZE);
  const rows = d && typeof d === 'object' ? d.works : [];
  return { list: rowsToVods(rows), page: page, pagecount: 9999, limit: PAGE_SIZE, total: 9999 };
}

async function search(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { list: [], page: page, pagecount: page };
  const d = await apiGet('/api/search/' + encodeURIComponent(wd) + '?order=create_date&sort=desc&page=' + page + '&pageSize=' + PAGE_SIZE);
  const rows = d && typeof d === 'object' ? d.works : [];
  return { list: rowsToVods(rows), page: page, pagecount: 9999 };
}

async function detail(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const ids = Array.isArray(body.id) ? body.id : [body.id];
  const vid = t(ids[0]);
  if (!vid) return { list: [] };
  const d = await apiGet('/api/work/' + vid);
  if (!d || !d.id) return { list: [] };
  const td = await apiGet('/api/tracks/' + vid + '?v=2');
  const audio = collectAudio({ children: Array.isArray(td) ? td : [] });
  const parts = [];
  for (let i = 0; i < audio.length; i++) {
    const a = audio[i];
    const title = cleanTitle(a.title) || ('音轨' + (i + 1));
    const url = a.streamLowQualityUrl || a.mediaStreamUrl || '';
    if (url) parts.push(('0' + (i + 1)).slice(-2) + ' ' + title + '$' + url);
  }
  return {
    list: [{
      vod_id: vid,
      vod_name: cleanTitle(d.title),
      vod_pic: d.mainCoverUrl || d.samCoverUrl || '',
      vod_content: '社团: ' + (d.name || ''),
      vod_play_from: 'ASMR',
      vod_play_url: parts.join('#'),
    }],
  };
}

async function play(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const id = t(body.id);
  if (!id || id.indexOf('http') !== 0) return { parse: 0, url: '' };
  return { parse: 0, url: id, header: { 'User-Agent': UA } };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async function(fastify) {
      fastify.post('/init', async function() { return {}; });
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
