// 茄子精品 - CatPawOpen JS Spider
// Ported from upload-7.py (HOST=https://oxh.qzjp4.beer, AppleCMS 标准结构)
// 列表: fed-list-item ; 详情: /vod/play/id/{id}/sid/1/nid/1.html -> player_data.url 直出 m3u8
const KEY = 'py_qiezi';
const NAME = '茄子精品';
const HOST = 'https://oxh.qzjp4.beer';
const BASE = '/cn/home/web/index.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATS = [
  ['20', '美女写真'], ['21', '国产精品'], ['22', '无码专区'], ['23', '中文字幕'],
  ['24', '强奸乱伦'], ['25', '人妻熟女'], ['26', '亚洲情色'], ['27', '制服丝袜'],
  ['28', 'SM捆绑'], ['29', '自淫系列'], ['30', '三级伦理'], ['31', '网红主播'],
  ['32', '探花约炮'], ['33', '传媒大片'], ['34', '动漫卡通'],
];

function H() {
  return { 'User-Agent': UA, 'Referer': HOST + '/', 'Accept': 'text/html,application/xhtml+xml' };
}

async function getText(url) {
  // 注: 本站屏蔽 axios 的 TLS 指纹, 必须用 Node 原生 fetch
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { headers: H(), signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return '';
    return await r.text();
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

function parseList(html) {
  const out = [];
  const seen = new Set();
  const items = String(html || '').match(/<li class="fed-list-item[^"]*">[\s\S]*?<\/li>/gi) || [];
  for (const it of items) {
    const im = it.match(/vod\/play\/id\/(\d+)/i);
    if (!im || seen.has(im[1])) continue;
    seen.add(im[1]);
    let name = '';
    let tm = it.match(/<a[^>]*class="fed-list-title[^"]*"[^>]*title="([^"]+)"/i);
    if (tm) name = tm[1].trim();
    if (!name) {
      tm = it.match(/<a[^>]*class="fed-list-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      if (tm) name = stripTags(tm[1]);
    }
    if (!name || name.length < 2) continue;
    let pic = '';
    let pm = it.match(/<a[^>]*class="fed-list-pics[^"]*"[^>]*data-original="([^"]+\.(?:jpg|jpeg|png))"/i);
    if (!pm) pm = it.match(/data-original="([^"]+\.(?:jpg|jpeg|png))"/i);
    if (pm) {
      pic = pm[1];
      if (pic.startsWith('/')) pic = HOST + pic;
      else if (pic.startsWith('//')) pic = 'https:' + pic;
    }
    out.push({ vod_id: im[1], vod_name: name, vod_pic: pic, vod_remarks: '' });
  }
  return out;
}

function pagecountOf(html, pg) {
  const ms = String(html || '').match(/\/vod\/type\/id\/\d+\/page\/(\d+)\.html/gi) || [];
  let max = pg;
  for (const s of ms) {
    const n = parseInt(s.match(/(\d+)/)[1], 10);
    if (n > max) max = n;
  }
  return max;
}

async function init() { return {}; }

async function home() {
  const cls = CATS.map(([id, name]) => ({ type_id: id, type_name: name }));
  const filters = {};
  for (const [id] of CATS) filters[id] = {};
  const html = await getText(HOST + '/');
  return { class: cls, filters, list: parseList(html) };
}

async function homeVod() {
  return { list: parseList(await getText(HOST + '/')) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || body.tid || '20');
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  let url = `${HOST}${BASE}/vod/type/id/${tid}.html`;
  if (pg > 1) url = `${HOST}${BASE}/vod/type/id/${tid}/page/${pg}.html`;
  const html = await getText(url);
  const list = parseList(html);
  return { page: pg, pagecount: pagecountOf(html, pg), limit: 24, total: list.length, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vid = String(ids[0] || '').match(/(\d+)/)?.[1] || '';
  if (!vid) return { list: [] };
  const html = await getText(`${HOST}${BASE}/vod/play/id/${vid}/sid/1/nid/1.html`);
  if (!html || html.length < 500) return { list: [] };
  let m3u8 = '';
  let pm = html.match(/var\s+player_data\s*=\s*(\{.*?\})/s);
  if (pm) {
    try { m3u8 = JSON.parse(pm[1]).url || ''; } catch {
      const um = pm[1].match(/"url"\s*:\s*"([^"]+)"/);
      if (um) m3u8 = um[1].replace(/\\\//g, '/');
    }
  }
  if (!m3u8) {
    const ms = html.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/gi) || [];
    m3u8 = ms.find((u) => !/sharer|balecao/i.test(u)) || '';
  }
  if (!m3u8) return { list: [] };
  let name = '视频' + vid;
  const tm = html.match(/<title>(.*?)<\/title>/s);
  if (tm) {
    name = stripTags(tm[1]).replace(/第\d+集.*$/, '').replace(/[-_–—].*?在线播放.*$/, '').trim() || name;
  }
  const picm = html.match(/(?:data-original|data-src|src)="([^"]+\.(?:jpg|jpeg|png))"/i);
  let pic = picm ? picm[1] : '';
  if (pic.startsWith('/')) pic = HOST + pic;
  else if (pic.startsWith('//')) pic = 'https:' + pic;
  return {
    list: [{
      vod_id: vid, vod_name: name, vod_pic: pic, vod_remarks: NAME,
      vod_play_from: NAME, vod_play_url: '第1集$' + m3u8,
    }],
  };
}

async function play(reqIn) {
  const id = String(reqIn?.body?.id || '').trim();
  return { parse: 0, url: id, header: { 'User-Agent': UA } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { list: [] };
  const url = `${HOST}${BASE}/index.php/vod/search/wd/${encodeURIComponent(wd)}.html`;
  const html = await getText(url);
  const list = parseList(html);
  return { page: pg, pagecount: pagecountOf(html, pg), limit: 24, total: list.length, list };
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
