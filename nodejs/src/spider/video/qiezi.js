// 茄子精品 - CatPawOpen JS Spider (全新重写)
// 站点: https://oxh.qzjp4.beer (苹果CMS)
// 注意: 根路径 / 被劫持为导航页, 必须走 /cn/home/web/index.php 子路径
// 本站屏蔽 axios, 使用 Node 原生 fetch

const KEY = 'py_qiezi';
const NAME = '茄子精品';
const HOST = 'https://oxh.qzjp4.beer';
const BASE = '/cn/home/web/index.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATEGORIES = [
  { type_id: '20', type_name: '美女写真' },
  { type_id: '21', type_name: '国产精品' },
  { type_id: '22', type_name: '无码专区' },
  { type_id: '23', type_name: '中文字幕' },
  { type_id: '24', type_name: '强奸乱伦' },
  { type_id: '25', type_name: '人妻熟女' },
  { type_id: '26', type_name: '亚洲情色' },
  { type_id: '27', type_name: '制服丝袜' },
  { type_id: '28', type_name: 'SM捆绑' },
  { type_id: '29', type_name: '自淫系列' },
  { type_id: '30', type_name: '三级伦理' },
  { type_id: '31', type_name: '网红主播' },
  { type_id: '32', type_name: '探花约炮' },
  { type_id: '33', type_name: '传媒大片' },
  { type_id: '34', type_name: '动漫卡通' },
];

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

async function getText(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': HOST + BASE,
        },
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.length > 1000) return t;
    } catch { /* retry */ }
  }
  return '';
}

function parseList(html) {
  const videos = [];
  if (!html) return videos;
  const items = html.match(/<li class="fed-list-item[^"]*">([\s\S]*?)<\/li>/g) || [];
  const seen = new Set();
  for (const item of items) {
    const im = item.match(/vod\/play\/id\/(\d+)/);
    if (!im) continue;
    const vodId = im[1];
    if (seen.has(vodId)) continue;
    seen.add(vodId);

    let name = '';
    let tm = item.match(/<a[^>]*class="fed-list-title[^"]*"[^>]*title="([^"]+)"/);
    if (tm) name = tm[1].trim();
    if (!name) {
      tm = item.match(/<a[^>]*class="fed-list-title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      if (tm) name = stripTags(tm[1]);
    }
    if (!name || name.length < 3) continue;

    let pic = '';
    const pm = item.match(/data-original="([^"]+\.(?:jpg|jpeg|png))"/i);
    if (pm) pic = absUrl(pm[1]);

    const rm = item.match(/fed-list-remarks[^>]*>([^<]*)</);
    videos.push({
      vod_id: vodId,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: rm ? rm[1].trim() : '',
    });
  }
  return videos;
}

async function init() { return {}; }

async function home() {
  // 必须走 BASE 子路径, 根路径 / 是导航劫持页
  const html = await getText(HOST + BASE);
  const list = parseList(html);
  return {
    class: CATEGORIES.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    filters: {},
    list,
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || '20');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = `${HOST}${BASE}/vod/type/id/${tid}.html`;
  if (page > 1) url = `${HOST}${BASE}/vod/type/id/${tid}/page/${page}.html`;
  const html = await getText(url);
  const list = parseList(html);
  let pagecount = page;
  const pages = html.match(/\/vod\/type\/id\/\d+\/page\/(\d+)\.html/g) || [];
  for (const p of pages) {
    const n = parseInt(p.match(/page\/(\d+)\.html/)[1], 10);
    if (n > pagecount) pagecount = n;
  }
  return { page, pagecount, limit: 24, total: list.length, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const vodId = String(raw).trim();
    const html = await getText(`${HOST}${BASE}/vod/play/id/${vodId}/sid/1/nid/1.html`);
    if (!html || html.length < 1000) continue;

    let m3u8 = '';
    let m = html.match(/var\s+player_data\s*=\s*(\{.*?\})/s);
    if (m) {
      const um = m[1].match(/"url"\s*:\s*"([^"]+)"/);
      if (um) m3u8 = um[1].replace(/\\\//g, '/');
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
      name = stripTags(m[1]).replace(/第\d+集.*$/, '').replace(/[-_–—].*?在线播放.*$/, '').trim() || name;
    }
    m = html.match(/(?:data-original|data-src|src)="([^"]+\.(?:jpg|jpeg|png))"/i);
    const pic = m ? absUrl(m[1]) : '';

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
    header: { 'User-Agent': UA, 'Referer': HOST + BASE },
  };
}

async function search() {
  return { page: 1, pagecount: 0, limit: 24, total: 0, list: [] };
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
