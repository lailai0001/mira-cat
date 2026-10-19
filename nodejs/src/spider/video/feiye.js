import req from '../../util/req.js';

// 绯夜 (py_feiye) — 全新重写版
// 站点: https://feiyechengren.pages.dev/ (AppleCMS JSON API)
// 三线路: /api/ /api2/ /api3/

const KEY = 'py_feiye';
const NAME = '绯夜';
const BASES = [
  'https://feiyechengren.pages.dev/api/',
  'https://feiyechengren.pages.dev/api2/',
  'https://feiyechengren.pages.dev/api3/',
];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';

// 站点真实分类 (2026-10-15 从 videolist 实测收集)
const CATS = [
  { type_id: '20', type_name: '精品推荐' },
  { type_id: '22', type_name: '主播秀色' },
  { type_id: '23', type_name: '日本有码' },
  { type_id: '24', type_name: '日本无码' },
  { type_id: '25', type_name: '中文字幕' },
  { type_id: '26', type_name: '童颜巨乳' },
  { type_id: '27', type_name: '性感人妻' },
  { type_id: '28', type_name: '强奸乱伦' },
  { type_id: '33', type_name: '丝袜OL' },
  { type_id: '35', type_name: '自拍偷拍' },
  { type_id: '36', type_name: '日本片商' },
  { type_id: '56', type_name: '网曝系列' },
  { type_id: '57', type_name: '麻豆传媒' },
  { type_id: '61', type_name: '国产乱伦' },
  { type_id: '62', type_name: '国产丝袜' },
  { type_id: '63', type_name: '国产SM' },
  { type_id: '65', type_name: '探花嫖娼' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

// 双通道请求: 先框架 req (MiraPlayer 内核可用), 失败再原生 fetch
async function getJson(params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Referer': 'https://feiyechengren.pages.dev/',
  };
  for (const base of BASES) {
    const url = base + '?' + qs;
    // 通道1: 框架 req
    try {
      const { data, status } = await req.get(url, { headers, timeout: 25000 });
      const d = typeof data === 'string' ? JSON.parse(data) : data;
      if (status === 200 && d && d.code === 1) return d;
    } catch { /* 换通道2 */ }
    // 通道2: 原生 fetch
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const d = await r.json();
      if (d && d.code === 1) return d;
    } catch { /* 换下一线路 */ }
  }
  return null;
}

function parseVod(v) {
  if (!v) return null;
  const id = t(v.vod_id);
  if (!id) return null;
  return {
    vod_id: id,
    vod_name: t(v.vod_name) || '未命名',
    vod_pic: t(v.vod_pic),
    vod_remarks: t(v.vod_remarks || v.vod_time || ''),
    type_name: t(v.type_name),
  };
}

function parseList(d) {
  const list = [];
  if (!d) return list;
  const arr = Array.isArray(d.list) ? d.list : [];
  for (const v of arr) {
    const item = parseVod(v);
    if (item) list.push(item);
  }
  return list;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = [{ type_id: '', type_name: '全部' }];
  for (const c of CATS) cls.push({ type_id: c.type_id, type_name: c.type_name });
  return { class: cls, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const params = { ac: 'videolist', pg: page };
  if (tid) params.t = tid;
  const d = await getJson(params);
  const list = parseList(d);
  const pagecount = d ? Math.max(1, parseInt(d.pagecount, 10) || 1) : 1;
  const total = d ? parseInt(d.total, 10) || 0 : 0;
  const limit = d ? parseInt(d.limit, 10) || 10 : 10;
  return { page, pagecount, limit, total, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  const d = await getJson({ ac: 'detail', ids: id });
  const list = [];
  if (d && Array.isArray(d.list)) {
    for (const v of d.list) {
      const item = parseVod(v);
      if (!item) continue;
      item.vod_content = t(v.vod_content || v.vod_blurb || '');
      item.vod_actor = t(v.vod_actor);
      item.vod_director = t(v.vod_director);
      item.vod_year = t(v.vod_year || (v.vod_time || '').slice(0, 4));
      item.vod_area = t(v.vod_area);
      const playUrl = t(v.vod_play_url);
      // AppleCMS 格式: 第1集$https://...m3u8#第2集$https://...
      item.vod_play_from = t(v.vod_play_from) || '绯夜';
      item.vod_play_url = playUrl;
      list.push(item);
    }
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "第1集$https://...m3u8" 形式, 取 $ 后面的直链
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/^https?:\/\//i.test(id)) {
    return {
      parse: 0,
      url: id,
      header: { Referer: 'https://feiyechengren.pages.dev/', 'User-Agent': UA },
    };
  }
  return { parse: 0, url: id };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 10, total: 0, list: [] };
  const d = await getJson({ ac: 'videolist', wd, pg: page });
  const list = parseList(d);
  const pagecount = d ? Math.max(1, parseInt(d.pagecount, 10) || 1) : 1;
  const total = d ? parseInt(d.total, 10) || 0 : 0;
  const limit = d ? parseInt(d.limit, 10) || 10 : 10;
  return { page, pagecount, limit, total, list };
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
