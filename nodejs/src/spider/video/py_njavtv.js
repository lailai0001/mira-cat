// nJAV - CatPawOpen JS Spider（2026-10-30 新源）
// 站点：https://njavtv.com/dm247/cn?localized=1（用户给的中文落地页）
// 结构（2026-10-30 VM + 浏览器实测）：
//  - 站方有 Cloudflare 墙：VM 直连 403 "Just a moment"，但 jina 阅读器
//    （r.jina.ai，x-respond-with: html）能拿到完整 HTML，且打包块、
//    链接、封面均完好；故蜘蛛直连优先、jina 兜底（与 sextb 的 jina
//    兜底同款做法；直连在真机住宅/移动出口是否过墙，待真机验）。
//  - 列表：卡片 <a href="https://njavtv.com/cn/{code}" alt="{code}">，
//    封面 lozad 懒加载 data-src="https://fourhoi.com/{code}/cover-t.jpg"
//    （src 只是 1px 占位图，必须用 data-src）；分页 ?page=N。
//  - 分类（浏览器 + jina 实测的 dm 段地址）：新作上市 /dm635/cn/release，
//    最新 /dm539/cn/new，中文字幕 /dm278/cn/chinese-subtitle，
//    类型示例 不伦 /dm117/cn/genres/%E4%B8%8D%E4%BC%A6
//    （类型路由 /dm117/cn/genres/{urlencoded}，详情页元数据里有更多）。
//  - 详情：/cn/{code-lowercase}；播放器 Plyr + hls.js；流配置藏在
//    Dean Edwards 打包块里，解包得：source（自动 master，
//    https://surrit.com/{uuid}/playlist.m3u8）、source842（720p，
//    …/720p/video.m3u8）、source1280（1080p，…/1080p/video.m3u8）。
//    480p/360p 只在站内播放器菜单出现、块里没有，不编造。
//  - 封面：详情 data-poster = https://fourhoi.com/{code}/cover-n.jpg；
//    列表 cover-t.jpg 同源。
//  - 搜索：按番号直查 /cn/{code-lowercase}（站内搜索接口未摸到，
//    不编造搜索 URL；番号直查是实测可行的）。
//  - 注意：surrit 播放列表 VM 403（机房出口拦）、浏览器可播到 01:15，
//    故播放链真机待验；内容水印 SUPJAV.COM 与 URL 无关。
import req from '../../util/req.js';

const KEY = 'py_njavtv';
const NAME = 'nJAV';
const HOST = 'https://njavtv.com';
const JINA = 'https://r.jina.ai/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': referer || HOST + '/cn',
  };
}

async function getDirect(url) {
  try {
    const { data } = await req.get(url, { headers: H(url), timeout: 12000 });
    return String(data || '');
  } catch { return ''; }
}

// 直连优先；CF 墙（Just a moment / 403 / 空）时走 jina 兜底
async function getHtml(url) {
  const direct = await getDirect(url);
  if (direct && direct.indexOf('Just a moment') < 0 && direct.indexOf('/cn/') >= 0) return direct;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await req.get(JINA + url, {
        headers: { 'User-Agent': UA, 'x-respond-with': 'html', 'Referer': HOST + '/cn' },
        timeout: 20000,
      });
      const t = String(data || '');
      if (t && t.indexOf('/cn/') >= 0) return t;
    } catch {}
    // jina 对突发请求会短暂 403，隔 2 秒重试一次
    if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
  }
  return direct || '';
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function jsUnescapeSingle(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}

function unpackDeanEdwards(html) {
  const m = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
  if (!m) return '';
  let p = jsUnescapeSingle(m[1]);
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = jsUnescapeSingle(m[4]).split('|');
  const enc = (n) => (n < a ? '' : enc(Math.floor(n / a))) + ((n % a) > 35 ? String.fromCharCode((n % a) + 29) : (n % a).toString(36));
  let i = c;
  while (i--) {
    if (k[i]) {
      const word = k[i];
      p = p.replace(new RegExp('\\b' + enc(i) + '\\b', 'g'), () => word);
    }
  }
  return p;
}

function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<a[^>]*href="https:\/\/njavtv\.com\/cn\/([a-z0-9\-]+)"[^>]*>([\s\S]{0,2000}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = m[1].toLowerCase();
    if (seen.has(code)) continue;
    // 列表里混有栏目卡（如 /cn/actresses），番号必含数字，纯词跳过
    if (!/\d/.test(code)) continue;
    seen.add(code);
    const inner = m[2];
    let pic = '';
    // 卡片里 preview.mp4 的 data-src 排在封面前面，只取图片后缀的
    const dms = [...inner.matchAll(/data-src="(https:\/\/fourhoi\.com\/[^"]+)"/gi)].map(x => x[1]);
    pic = dms.find(u => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) || '';
    if (!pic) pic = 'https://fourhoi.com/' + code + '/cover-t.jpg';
    let title = '';
    const am = inner.match(/alt="([^"]+)"/i);
    if (am && am[1] && am[1] !== code) title = stripTags(am[1]);
    if (!title) {
      const tm = inner.match(/<[^>]*class="[^"]*(title|name)[^"]*"[^>]*>([\s\S]{0,300}?)<\/[^>]+>/i);
      if (tm) title = stripTags(tm[2]);
    }
    if (!title) title = code.toUpperCase();
    items.push({ vod_id: HOST + '/cn/' + code, vod_name: title, vod_pic: pic, vod_remarks: code.toUpperCase() });
    if (items.length >= 60) break;
  }
  return items;
}

const CATS = [
  { type_id: '/dm635/cn/release', type_name: '新作上市' },
  { type_id: '/dm539/cn/new', type_name: '最新' },
  { type_id: '/dm278/cn/chinese-subtitle', type_name: '中文字幕' },
  { type_id: '/dm117/cn/genres/%E4%B8%8D%E4%BC%A6', type_name: '不伦' },
];

async function init() { return {}; }

async function home() {
  let html = await getHtml(HOST + '/dm247/cn?localized=1');
  let list = parseCards(html);
  if (!list.length) {
    html = await getHtml(HOST + '/dm635/cn/release');
    list = parseCards(html);
  }
  return { class: CATS, filters: {}, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!tid) tid = '/dm635/cn/release';
  const base = (/^https?:\/\//i.test(tid) ? tid : HOST + '/' + tid.replace(/^\/+/, '')).replace(/\/+$/, '');
  const url = page === 1 ? base : base + '?page=' + page;
  const html = await getHtml(url);
  const list = parseCards(html);
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    let durl = String(raw).trim();
    if (!/^https?:\/\//i.test(durl)) {
      const code = durl.replace(/^\/+/, '').replace(/^cn\//i, '').toLowerCase();
      durl = HOST + '/cn/' + code;
    }
    const html = await getHtml(durl);
    const hm = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i);
    const title = hm ? stripTags(hm[1]) : 'nJAV';
    let pic = '';
    const pm = html.match(/data-poster="(https:\/\/fourhoi\.com\/[^"]+)"/i);
    if (pm) pic = pm[1];
    if (!pic) {
      const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      if (ogm) pic = ogm[1];
    }
    const unpacked = unpackDeanEdwards(html);
    const lines = [];
    if (unpacked) {
      const master = (unpacked.match(/source\s*=\s*'([^']+playlist\.m3u8[^']*)'/i) || [])[1];
      const p720 = (unpacked.match(/source842\s*=\s*'([^']+)'/i) || [])[1];
      const p1080 = (unpacked.match(/source1280\s*=\s*'([^']+)'/i) || [])[1];
      if (master) lines.push('自动$' + master);
      if (p1080) lines.push('1080p$' + p1080);
      if (p720) lines.push('720p$' + p720);
    }
    if (!lines.length) lines.push('网页播放$' + durl);
    list.push({ vod_id: raw, vod_name: title, vod_pic: pic, vod_play_from: NAME, vod_play_url: lines.join('#') });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  return {
    parse: isVideo ? 0 : 1,
    url: id,
    header: { 'User-Agent': UA, 'Referer': HOST + '/cn' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  // 番号直查：/cn/{code-lowercase}；非番号格式不编造搜索 URL
  if (!/^[a-zA-Z0-9\-]+$/.test(wd)) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const durl = HOST + '/cn/' + wd.toLowerCase();
  const html = await getHtml(durl);
  const unpacked = unpackDeanEdwards(html);
  if (!unpacked) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const hm = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const pm = html.match(/data-poster="(https:\/\/fourhoi\.com\/[^"]+)"/i);
  const list = [{
    vod_id: durl,
    vod_name: hm ? stripTags(hm[1]) : wd.toUpperCase(),
    vod_pic: pm ? pm[1] : 'https://fourhoi.com/' + wd.toLowerCase() + '/cover-t.jpg',
    vod_remarks: wd.toUpperCase(),
  }];
  return { page, pagecount: page, limit: 90, total: 1, list };
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
