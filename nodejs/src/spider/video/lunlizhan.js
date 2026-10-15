// 伦理站 - MiraPlayer JS Spider
// 由 upload-18.py (STUI急救版) 转换
// 站点: 伦理站 (STUI 模板)
// 列表: /list/{tid}.html, 翻页 /list/{tid}-{pg}.html
// 搜索: /search/{关键词}----------{pg}---.html
// 详情: content 页, 播放地址 var mac_url = unescape('...')
// 请求: 双通道 — 先框架 req(axios), 失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_lunlizhan';
const NAME = '伦理站';
const HOST = 'https://xn---lunlizhancom-9x6wp54cjk3f481e0ksb.www-lunlizhan.com';
const HOME_URL = HOST + '/?fulione';
const UA = 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36';

// 分类(与原 Python 版一致; 站点从沙箱不可达, 未验证更多分类, 不编造)
const CATS = [
  { type_id: '585', type_name: '韩国伦理' },
];

let cookieStr = '';
let warmed = false;

function t(v) { return String(v == null ? '' : v).trim(); }

function clean(s) {
  return t(s).replace(/<.*?>/gs, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

function isImg(u) {
  if (!u) return false;
  const u2 = u.toLowerCase().split('?')[0];
  return u2.endsWith('.jpg') || u2.endsWith('.jpeg') || u2.endsWith('.png') ||
         u2.endsWith('.webp') || u2.endsWith('.gif') || u2.endsWith('.avif');
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + '/' + u.replace(/^\/+/, '');
}

// 修正被拼接坏的详情/播放 URL: https://host/xxx/content/123.html -> https://host/content/123.html
function fixBadUrl(u) {
  u = t(u);
  let m = u.match(/^(https?:\/\/[^\/]+).*?\/(content\/\d+\.html)/i);
  if (m) return m[1] + '/' + m[2];
  m = u.match(/^(https?:\/\/[^\/]+).*?\/(play\/[^?#"']+)/i);
  if (m) return m[1] + '/' + m[2];
  return u;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return String(s || ''); }
}

function b64decode(s) {
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(String(s), 'base64').toString('utf-8');
    return atob(String(s));
  } catch (e) { return ''; }
}

function mergeCookies(headers) {
  if (!headers) return;
  let raw = [];
  try {
    if (typeof headers.getSetCookie === 'function') {
      raw = headers.getSetCookie();
    } else if (headers['set-cookie']) {
      raw = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']];
    }
  } catch (e) { return; }
  if (!raw.length) return;
  const jar = {};
  cookieStr.split(';').forEach(p => {
    const kv = p.trim().split('=');
    if (kv[0]) jar[kv[0]] = kv.slice(1).join('=');
  });
  raw.forEach(c => {
    const kv = String(c).split(';')[0].trim().split('=');
    if (kv[0]) jar[kv[0]] = kv.slice(1).join('=');
  });
  cookieStr = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
}

async function getText(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': referer || HOME_URL,
  };
  if (cookieStr) headers['Cookie'] = cookieStr;
  for (let i = 0; i < 2; i++) {
    // 通道1: 框架 req (axios) — MiraPlayer App 内优先
    try {
      const r = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const s = t(r && r.data);
      if (r && r.status === 200 && s.length > 500) { mergeCookies(r.headers); return s; }
    } catch (e) { /* 换通道2 */ }
    // 通道2: Node 原生 fetch
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers, redirect: 'follow' });
      clearTimeout(timer);
      if (!r.ok) continue;
      mergeCookies(r.headers);
      const s = t(await r.text());
      if (s.length > 500) return s;
    } catch (e) { /* retry */ }
  }
  return '';
}

async function warmup() {
  if (warmed) return;
  warmed = true;
  try { await getText(HOME_URL); } catch (e) {}
}

// 解析 STUI 模板视频列表: <a class="stui-vodlist__thumb" href title data-original>
function parseStuiList(html) {
  const out = [];
  if (!html) return out;
  const re = /<a[^>]*class="[^"]*stui-vodlist__thumb[^"]*"[^>]*>/gis;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const h = tag.match(/href="([^"]+)"/i);
    const tn = tag.match(/title="([^"]+)"/i);
    const p = tag.match(/data-original="([^"]+)"/i) ||
              tag.match(/data-src="([^"]+)"/i) ||
              tag.match(/src="([^"]+)"/i);
    if (!h || !tn || !p) continue;
    const pic = t(p[1]);
    if (!isImg(pic)) continue;
    const seg = html.slice(m.index, m.index + 600);
    const d = seg.match(/<span[^>]*class="[^"]*vodtime[^"]*"[^>]*>(.*?)<\/span>/is);
    out.push({
      vod_id: absUrl(h[1]),
      vod_name: clean(tn[1]),
      vod_pic: absUrl(pic),
      vod_remarks: d ? clean(d[1]) : '',
    });
  }
  return out;
}

async function init() { await warmup(); return {}; }

async function home() {
  await warmup();
  const html = await getText(HOME_URL);
  const list = parseStuiList(html);
  return { class: CATS, filters: {}, list };
}

async function category(reqIn) {
  await warmup();
  const body = (reqIn && reqIn.body) || {};
  const tid = t(body.type || body.tid || body.id) || '585';
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  const urls = [];
  if (pg === 1) urls.push(`${HOST}/list/${tid}.html`);
  urls.push(`${HOST}/list/${tid}-${pg}.html`);
  urls.push(`${HOST}/list/${tid}.html?page=${pg}`);
  let html = '';
  for (const u of urls) {
    const s = await getText(u);
    if (s && s.indexOf('stui-vodlist__thumb') !== -1) { html = s; break; }
    if (s && !html) html = s;
  }
  const list = parseStuiList(html);
  return { page: pg, pagecount: list.length ? pg + 1 : pg, limit: 20, total: 9999, list };
}

async function detail(reqIn) {
  await warmup();
  const body = (reqIn && reqIn.body) || {};
  let ids = body.id || body.ids || '';
  if (!Array.isArray(ids)) ids = [ids];
  const out = [];
  for (const raw of ids) {
    const vodId = fixBadUrl(t(raw));
    if (!vodId) { out.push({ vod_name: '视频ID为空' }); continue; }
    const html = await getText(vodId);
    if (!html) { out.push({ vod_id: vodId, vod_name: '视频详情解析失败' }); continue; }
    const nm = html.match(/<h4[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)<\/h4>/is) ||
               html.match(/<h1[^>]*>(.*?)<\/h1>/is) ||
               html.match(/<title>(.*?)<\/title>/is);
    const vodName = nm ? clean(nm[1]) : '未知名称';
    let pic = '';
    const p1 = html.match(/var\s+postimg\s*=\s*"([^"]+)"/i);
    const p2 = html.match(/var\s+posterImg\s*=\s*"([^"]+)"/i);
    if (p1 && isImg(p1[1])) pic = absUrl(p1[1]);
    else if (p2 && isImg(p2[1])) pic = absUrl(p2[1]);
    let playUrl = '';
    const mu = html.match(/var\s+mac_url\s*=\s*unescape\(['"]([^'"]+)['"]\)\s*;/is);
    if (mu) {
      const dec = safeDecode(mu[1]);
      playUrl = dec.indexOf('$') !== -1 ? dec : '正片$' + dec;
    } else {
      const dm = html.match(/(https?:\/\/[^\s'"]+\.(?:m3u8|mp4|flv|mp3)[^\s'"]*)/i);
      if (dm) playUrl = '正片$' + dm[1];
    }
    out.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: pic,
      vod_remarks: '',
      type_name: '',
      vod_content: '',
      vod_play_from: '主线路',
      vod_play_url: playUrl,
    });
  }
  return { list: out };
}

async function search(reqIn) {
  await warmup();
  const body = (reqIn && reqIn.body) || {};
  const wd = t(body.wd);
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page: pg, pagecount: pg, limit: 20, total: 0, list: [] };
  const q = encodeURIComponent(wd);
  const urls = [
    `${HOST}/search/${q}----------${pg}---.html`,
    `${HOST}/search.php?wd=${q}&page=${pg}`,
  ];
  let html = '';
  for (const u of urls) {
    const s = await getText(u);
    if (s && s.indexOf('stui-vodlist__thumb') !== -1) { html = s; break; }
    if (s && !html) html = s;
  }
  const list = parseStuiList(html);
  return { page: pg, pagecount: list.length ? pg + 1 : pg, limit: 20, total: list.length, list };
}

async function play(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  let id = t(body.id);
  let playUrl = fixBadUrl(id.indexOf('$') !== -1 ? id.split('$').pop().trim() : id);
  const header = { 'User-Agent': UA, 'Referer': HOST + '/' };
  if (!playUrl) return { parse: 1, jx: 0, url: '', header };
  if (playUrl.startsWith('/')) playUrl = HOST + playUrl;
  else if (playUrl.startsWith('//')) playUrl = 'https:' + playUrl;
  const low = playUrl.toLowerCase();
  if (low.indexOf('.m3u8') !== -1 || low.indexOf('.mp4') !== -1 ||
      low.indexOf('.flv') !== -1 || low.indexOf('.mp3') !== -1) {
    return { parse: 0, jx: 0, url: playUrl, header };
  }
  await warmup();
  const html = await getText(playUrl);
  if (html) {
    // 核心: mac_url=unescape('...')
    const mu = html.match(/var\s+mac_url\s*=\s*unescape\(['"]([^'"]+)['"]\)\s*;/is);
    if (mu) {
      const dec = safeDecode(mu[1]);
      let real = dec.indexOf('$') !== -1 ? dec.split('$').pop().trim() : dec.trim();
      if (real.startsWith('//')) real = 'https:' + real;
      if (/^https?:\/\//i.test(real)) return { parse: 0, jx: 0, url: real, header };
    }
    // 兼容 player_aaaa
    const pm = html.match(/player_aaaa\s*=\s*(\{.*?\})\s*;/s);
    if (pm) {
      try {
        const data = JSON.parse(pm[1]);
        let u = t(data.url);
        const enc = t(data.encrypt || '0');
        if (enc === '1') u = safeDecode(u);
        else if (enc === '2') u = safeDecode(b64decode(u));
        if (u.startsWith('//')) u = 'https:' + u;
        if (/^https?:\/\//i.test(u)) {
          const ul = u.toLowerCase();
          const direct = ul.indexOf('.m3u8') !== -1 || ul.indexOf('.mp4') !== -1 ||
                         ul.indexOf('.flv') !== -1 || ul.indexOf('.mp3') !== -1;
          return { parse: direct ? 0 : 1, jx: 0, url: u, header };
        }
      } catch (e) {}
    }
    const dm = html.match(/(https?:\/\/[^\s'"]+\.(?:m3u8|mp4|flv|mp3)[^\s'"]*)/i);
    if (dm) return { parse: 0, jx: 0, url: dm[1], header };
  }
  return { parse: 1, jx: 0, url: playUrl, header };
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
