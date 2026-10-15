// 蝴蝶影视 - CatPawOpen JS Spider
// 转换自 Twitter.py，站点 https://pektino.com
// 请求: 双通道 — 先框架 req(axios, MiraPlayer 内核可用)，失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_pektino';
const NAME = '蝴蝶影视';
const HOST = 'https://pektino.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CATS = [
  { type_id: 'daily', type_name: '每日精选' },
  { type_id: 'weekly', type_name: '每周热门' },
  { type_id: 'monthly', type_name: '每月排行' },
  { type_id: 'all', type_name: '历史最佳' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

// 双通道 HTML 请求: 先框架 req, 失败再 fetch
async function getText(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': referer || (HOST + '/zh-CN'),
  };
  for (let i = 0; i < 2; i++) {
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const s = String(data || '');
      if (status === 200 && s.length > 500) return s;
    } catch (e) { /* 换通道2 */ }
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const s = await r.text();
      if (s && s.length > 500) return s;
    } catch (e) { /* retry */ }
  }
  return '';
}

function convertPic(pic) {
  pic = t(pic);
  if (!pic) return '';
  if (pic.startsWith('//')) pic = 'https:' + pic;
  if (pic.indexOf('twimg.com') >= 0) {
    return 'https://wsrv.nl/?url=' + encodeURIComponent(pic);
  }
  return pic;
}

function parseCards(html) {
  const items = [];
  if (!html) return items;
  const anchorRe = /(<a[^>]+href="[^"]*(?:\/zh-CN)?\/movie\/[^"]+"[^>]*>.*?<\/a>)/gis;
  const seen = new Set();
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const block = m[1];
    const hrefM = /href="([^"]*(?:\/zh-CN)?\/movie\/([^"/]+)\/?)"/i.exec(block);
    if (!hrefM) continue;
    const vid = hrefM[2];
    if (seen.has(vid)) continue;
    seen.add(vid);
    const imgM = /(?:src|data-src|poster)="([^"]+)"/i.exec(block);
    const pic = imgM ? convertPic(imgM[1]) : '';
    const durM = /(\d+:\d+(?::\d+)?)/.exec(block);
    const dur = durM ? durM[1] : '';
    const altM = /alt="([^"]+)"/i.exec(block);
    let rawTitle = altM ? altM[1].trim() : vid;
    rawTitle = rawTitle.replace('X (Twitter) adult video ', '').trim();
    const title = rawTitle === vid ? ('精选影片 ' + vid) : rawTitle;
    const remarks = dur ? ('蝴蝶影视 | ' + dur) : '蝴蝶影视';
    items.push({
      vod_id: 'pektino:' + vid,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: remarks,
    });
  }
  return items;
}

async function home() {
  return { class: CATS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(Array.isArray(body.id) ? body.id[0] : body.id).replace(/^pektino:/, '').replace(/\//g, '') || 'daily';
  const p = Math.max(1, parseInt(body.page) || 1);
  let target = tid === 'daily' ? (HOST + '/zh-CN') : (HOST + '/zh-CN/' + tid);
  if (p > 1) target += '?page=' + p;
  const html = await getText(target);
  const items = parseCards(html);
  return { list: items, page: p, pagecount: 999, limit: 50, total: 9999 };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let vid = t(Array.isArray(body.id) ? body.id[0] : body.id).replace(/^pektino:/, '');
  if (!vid) return { list: [] };
  const target = /^https?:\/\//i.test(vid) ? vid : (HOST + '/zh-CN/movie/' + vid);
  const html = await getText(target);
  let title = vid;
  const tm = /<title>([^<]+)<\/title>/i.exec(html);
  if (tm) title = tm[1].split(' - ')[0].trim();
  let pic = '';
  const pm = /property="og:image"\s+content="([^"]+)"/i.exec(html);
  if (pm) pic = convertPic(pm[1]);
  let desc = '';
  const dm = /name="description"\s+content="([^"]+)"/i.exec(html);
  if (dm) desc = dm[1].trim();
  const clean = html.replace(/\\\//g, '/');
  const mp4s = [];
  const re = /(https?:\/\/video\.twimg\.com\/[^"'<>\s\\]+\.mp4(?:\?[^"'<>\s\\]*)?)/gi;
  let um;
  while ((um = re.exec(clean)) !== null) {
    const u = um[1].replace(/\\/g, '').trim();
    if (u.indexOf('http') === 0 && mp4s.indexOf(u) < 0) mp4s.push(u);
  }
  let stream = '';
  for (const u of mp4s) { if (u.indexOf(vid) >= 0) { stream = u; break; } }
  if (!stream && mp4s.length) stream = mp4s[0];
  const playUrl = stream ? ('超清直链$' + stream) : ('网页解析$' + target);
  return {
    list: [{
      vod_id: 'pektino:' + vid,
      vod_name: title,
      vod_pic: pic,
      vod_actor: '🦋 TG群: @tvshare23',
      vod_director: '🦋 蝴蝶影视',
      vod_content: '🦋 蝴蝶影视 独家呈现\n官方交流群: @tvshare23\n原名: ' + title + '\n' + desc,
      vod_remarks: '蝴蝶影视',
      vod_play_from: '蝴蝶影视',
      vod_play_url: playUrl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(Array.isArray(body.id) ? body.id[0] : body.id);
  // playUrl 格式: 名称$url, 取 $ 后部分
  const idx = id.lastIndexOf('$');
  if (idx >= 0) id = id.slice(idx + 1);
  return {
    parse: 0,
    url: id,
    header: { 'User-Agent': UA, 'Referer': 'https://twitter.com/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const p = Math.max(1, parseInt(body.page) || 1);
  if (!kw) return { list: [], page: p, pagecount: 1 };
  let url = HOST + '/zh-CN/search?tag=' + encodeURIComponent(kw);
  if (p > 1) url += '&page=' + p;
  const html = await getText(url);
  return { list: parseCards(html), page: p, pagecount: 999, limit: 24, total: 9999 };
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
