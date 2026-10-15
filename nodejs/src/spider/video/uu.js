// UU直播破解 - CatPawOpen JS Spider (全新重写)
// 站点: https://cmk.uuzbpj7.hair
// 结构: 自定义CMS, video-item 列表, 详情页 /{id}.html, const rawUrl 直出 m3u8
// 请求: 双通道 — 先框架 req(axios, MiraPlayer 内核可用)，失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_uu';
const NAME = 'UU直播破解';
const HOST = 'https://cmk.uuzbpj7.hair';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATEGORIES = [
  { type_id: '20', type_name: '韩国美眉' },
  { type_id: '21', type_name: '骑兵有码' },
  { type_id: '22', type_name: '日韩主播' },
  { type_id: '23', type_name: '国产偷拍' },
  { type_id: '24', type_name: '欧美激情' },
  { type_id: '25', type_name: '步兵无码' },
  { type_id: '26', type_name: '金发幼齿' },
  { type_id: '27', type_name: '三级伦理' },
  { type_id: '28', type_name: '岛国中文' },
  { type_id: '29', type_name: '岛国无码' },
  { type_id: '30', type_name: '网红主播' },
  { type_id: '31', type_name: '自拍偷拍' },
];

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

async function getText(url, retries = 2) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': HOST + '/',
  };
  for (let i = 0; i < retries; i++) {
    // 通道1: 框架 req (axios) — MiraPlayer 内核可用
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const t = String(data || '');
      if (status === 200 && t.length > 500) return t;
    } catch { /* 换通道2 */ }
    // 通道2: Node 原生 fetch (部分站点屏蔽 axios 指纹时用)
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.length > 500) return t;
    } catch { /* retry */ }
  }
  return '';
}

function parseList(html) {
  const videos = [];
  if (!html) return videos;
  const items = html.match(/<div[^>]*class="video-item [^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="video-item |$)/g) || [];
  const seen = new Set();
  for (const item of items) {
    let m = item.match(/href="\/(\d+)\.html"/) || item.match(/data-href="\/(\d+)\.html"/);
    if (!m) continue;
    const vodId = m[1];
    if (seen.has(vodId)) continue;
    seen.add(vodId);

    let name = '';
    const tm = item.match(/class="[^"]*video-item-title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|a|p|h4)>/);
    if (tm) name = stripTags(tm[1]);
    if (!name) {
      const at = item.match(/<a[^>]*title="([^"]+)"/);
      if (at) name = at[1].trim();
    }
    if (!name) continue;

    let pic = '';
    const pm = item.match(/data-original="([^"]+\.(?:jpg|jpeg|png))"/i)
      || item.match(/data-src="([^"]+\.(?:jpg|jpeg|png))"/i)
      || item.match(/<img[^>]*src="([^"]+\.(?:jpg|jpeg|png))"/i);
    if (pm) pic = pm[1];

    videos.push({ vod_id: vodId, vod_name: name, vod_pic: pic, vod_remarks: '' });
  }
  return videos;
}

async function init() { return {}; }

async function home() {
  return {
    class: CATEGORIES.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    filters: {},
    list: [],
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || '20');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = `${HOST}/vodtype/${tid}.html`;
  if (page > 1) url = `${HOST}/vodtype/${tid}-${page}.html`;
  const html = await getText(url);
  const list = parseList(html);
  let pagecount = page;
  const pages = html.match(/\/vodtype\/\d+-(\d+)\.html/g) || [];
  for (const p of pages) {
    const n = parseInt(p.match(/-(\d+)\.html/)[1], 10);
    if (n > pagecount) pagecount = n;
  }
  return { page, pagecount, limit: 72, total: list.length, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const vodId = String(raw).trim();
    const html = await getText(`${HOST}/${vodId}.html`);
    if (!html || html.length < 1000) continue;

    let m3u8 = '';
    let m = html.match(/(?:const|let|var)\s+rawUrl\s*=\s*['"]([^'"]+)['"]/i);
    if (m) m3u8 = m[1];
    if (!m3u8) {
      m = html.match(/var\s+player_data\s*=\s*(\{.*?\})/s);
      if (m) {
        const um = m[1].match(/"url"\s*:\s*"([^"]+)"/);
        if (um) m3u8 = um[1].replace(/\\\//g, '/');
      }
    }
    if (!m3u8) {
      const all = html.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || [];
      for (const u of all) {
        if (!/sharer|balecao/i.test(u)) { m3u8 = u; break; }
      }
    }
    if (!m3u8) continue;

    let name = `视频${vodId}`;
    m = html.match(/<title>([\s\S]*?)<\/title>/);
    if (m) {
      name = stripTags(m[1]).replace(/[-_–—]\s*[^-_–—]*[-_–—]\s*UU直播破解.*$/, '').replace(/[-_–—]\s*UU直播破解.*$/, '').trim() || name;
    }
    m = html.match(/(?:data-original|data-src|src)="([^"]+\.(?:jpg|jpeg|png))"/i);
    const pic = m ? m[1] : '';

    list.push({
      vod_id: vodId,
      vod_name: name,
      vod_pic: pic,
      vod_play_from: NAME,
      vod_play_url: `第1集$${m3u8}`,
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  if (!id) return { parse: 0, url: '', header: {} };
  return {
    parse: 0,
    url: id,
    header: { 'User-Agent': UA, 'Referer': HOST + '/' },
  };
}

async function search() {
  return { page: 1, pagecount: 0, limit: 72, total: 0, list: [] };
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
