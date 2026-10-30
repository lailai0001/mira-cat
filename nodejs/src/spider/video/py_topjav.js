// TopJAV - CatPawOpen JS Spider（2026-10-30 新源）
// 站点：https://topjav.tv/cn（另有 /en /kr /tw；详情规范 /video/{id}）
// 结构（2026-10-30 VM 实测）：
//  - 列表：<article class="movie-item">，链接 /cn/video/{id}，
//    封面 https://topjav.tv/storage/images/{id}/thumbnail.jpg，
//    标题 <h3 class="movie-link">；分页 ?page=N（popular 页实测到 4621 页）。
//  - 分类（/cn 导航实测）：最新 /cn，热门 /cn/popular，
//    有码 /cn/categories/censored，无码 /cn/categories/uncensored，
//    减码 /cn/categories/reducing_mosaic。
//  - 播放（2026-10-30 破解，字节级验过）：详情页内联混淆脚本 5 的
//    jwplayer 配置 file: f("<约 220 字符>")；f 的真身是
//    atob(reverse(encoded.slice(16, -16))) →
//    https://topjav.tv/m3u8/{id}.m3u8?time={epoch}&sig={sha256hex}&sig2={短串}。
//    sig 有时效，detail 只给“播放$详情页”线，play() 现取现解现播，
//    绝不把解出的签名 URL 存成静态线。本站未见分辨率档，单线（master）。
//  - 搜索：站内表单 action=/cn/search，字段名 s → /cn/search?s={wd}。
import req from '../../util/req.js';

const KEY = 'py_topjav';
const NAME = 'TopJAV';
const HOST = 'https://topjav.tv';
const LANG = '/cn';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': referer || HOST + LANG,
  };
}

async function getText(url, referer) {
  try {
    const { data } = await req.get(url, { headers: H(referer), timeout: 15000 });
    return String(data || '');
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<article[^>]*class="[^"]*movie-item[^"]*"[^>]*>([\s\S]{0,6000}?)<\/article>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const blk = m[1];
    const lm = blk.match(/<a[^>]*href="([^"]*\/video\/\d+[^"]*)"[^>]*>/i);
    if (!lm) continue;
    let href = lm[1];
    if (!/^https?:\/\//i.test(href)) href = HOST + (href.startsWith('/') ? href : '/' + href);
    if (seen.has(href)) continue;
    seen.add(href);
    const clean = blk.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    let pic = '';
    const ims = clean.match(/<img[^>]*>/gi) || [];
    for (const tag of ims) {
      const sm = tag.match(/(?:data-src|data-original|src)\s*=\s*"([^"]+)"/i);
      if (sm && sm[1] && !/data:image/i.test(sm[1])) {
        pic = /^https?:\/\//i.test(sm[1]) ? sm[1] : HOST + (sm[1].startsWith('/') ? sm[1] : '/' + sm[1]);
        break;
      }
    }
    let title = '';
    const tm = clean.match(/<h3[^>]*>([\s\S]{0,400}?)<\/h3>/i);
    if (tm) title = stripTags(tm[1]);
    if (!title) {
      const am = clean.match(/title="([^"]+)"/i);
      if (am) title = stripTags(am[1]);
    }
    if (!title || title.length < 2) continue;
    let remarks = '';
    const vm = clean.match(/([\d,]+)\s*(?:views|次|观看)/i);
    if (vm) remarks = vm[1];
    items.push({ vod_id: href, vod_name: title, vod_pic: pic, vod_remarks: remarks });
    if (items.length >= 60) break;
  }
  return items;
}

const CATS = [
  { type_id: '/cn', type_name: '最新' },
  { type_id: '/cn/popular', type_name: '热门' },
  { type_id: '/cn/categories/censored', type_name: '有码' },
  { type_id: '/cn/categories/uncensored', type_name: '无码' },
  { type_id: '/cn/categories/reducing_mosaic', type_name: '减码' },
];

// 签名 URL 现解：slice(16, -16) → 反转 → base64 解码
function decodeSigned(html) {
  const fm = String(html || '').match(/file\s*:\s*f\("([^"]{100,})"\)/i)
    || String(html || '').match(/f\("([^"]{150,})"\)/);
  if (!fm) return '';
  const enc = fm[1];
  try {
    const sliced = enc.slice(16, -16);
    const rev = sliced.split('').reverse().join('');
    const out = Buffer.from(rev, 'base64').toString('utf8');
    if (/^https:\/\/topjav\.tv\/(cn\/)?m3u8\//i.test(out)) return out;
  } catch {}
  return '';
}

async function init() { return {}; }

async function home() {
  const html = await getText(HOST + LANG, HOST + LANG);
  return { class: CATS, filters: {}, list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!tid) tid = LANG;
  const base = (/^https?:\/\//i.test(tid) ? tid : HOST + '/' + tid.replace(/^\/+/, '')).replace(/\/+$/, '');
  const url = page === 1 ? base : base + '?page=' + page;
  const html = await getText(url, HOST + LANG);
  const list = parseCards(html);
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    let durl = String(raw).trim();
    if (!/^https?:\/\//i.test(durl)) {
      durl = HOST + (durl.startsWith('/') ? durl : '/' + durl);
    }
    const html = await getText(durl, HOST + LANG);
    const hm = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i);
    const title = hm ? stripTags(hm[1]) : 'TopJAV';
    const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    let pic = ogm ? ogm[1] : '';
    if (!pic) {
      const idm = durl.match(/\/video\/(\d+)/);
      if (idm) pic = HOST + '/storage/images/' + idm[1] + '/thumbnail.jpg';
    }
    list.push({ vod_id: raw, vod_name: title, vod_pic: pic, vod_play_from: NAME, vod_play_url: '播放$' + durl });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': HOST + LANG } };
  }
  // 详情页：现取现解（签名有时效）
  const durl = /^https?:\/\//i.test(id) ? id : HOST + (id.startsWith('/') ? id : '/' + id);
  const html = await getText(durl, HOST + LANG);
  const signed = decodeSigned(html);
  if (signed) {
    return { parse: 0, url: signed, header: { 'User-Agent': UA, 'Referer': durl } };
  }
  return { parse: 1, url: durl, header: { 'User-Agent': UA, 'Referer': HOST + LANG } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const url = HOST + LANG + '/search?s=' + encodeURIComponent(wd) + (page > 1 ? '&page=' + page : '');
  const html = await getText(url, HOST + LANG);
  const list = parseCards(html);
  return { page, pagecount: 9999, limit: 90, total: list.length, list };
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
