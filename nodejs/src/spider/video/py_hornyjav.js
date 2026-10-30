// HornyJav - CatPawOpen JS Spider（2026-10-30 新源）
// 站点：https://hornyjav.com/（WordPress retrotube 1.5.8；wp-json 401，解析 HTML）
// 结构（2026-10-30 VM 实测）：
//  - 列表：<article class="loop-video thumb-block" data-post-id>，链接 /{slug}/，
//    封面 <img data-src="https://image.hornyjav.com/image/{slug}.jpg">，
//    时长 + 播放量 span；分页 /page/N/，分类 /category/{slug}/page/N/。
//  - 分类（导航实测，仅 3 个视频分类）：Censored /category/censored/，
//    English Subtitle /category/english-subtitle/，Reducing Mosaic
//    /category/reducing-mosaic/（/actors/、/studios/ 是人物索引，不作分类）。
//  - 播放（2026-10-30 破解）：详情 <div class="box-server"
//    data-server-urls="[&quot;token&quot;,…]">（每帖 4 个 token）；
//    token 解码：反转字符串 → base64url 转 base64 补 '=' → 解码 →
//    按字节与密钥 "KmzWa8awaallakclnu" 循环异或 → videplay 嵌页 URL
//    （如 https://x.videplay.us/v/… 或 /x/…）；解出非 https:// 开头的
//    视为密钥已换，该条作废。嵌页是 jwplayer8 页，内含 Dean Edwards
//    打包块，解包后取 https://api.videplay.us/o/v-master.m3u8/{token}
//    —— 即直链 master 清单。本站给的是服务器选择（4 条 videplay 线），
//    不是分辨率档（master 内多码率由播放器自动选），故线名是服务器。
import req from '../../util/req.js';

const KEY = 'py_hornyjav';
const NAME = 'HornyJav';
const HOST = 'https://hornyjav.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const XOR_KEY = 'KmzWa8awaallakclnu';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || HOST + '/',
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

function b64Decode(b64url) {
  let s = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try { return Buffer.from(s, 'base64').toString('latin1'); } catch { return ''; }
}

function decodeToken(tok) {
  try {
    const rev = String(tok || '').split('').reverse().join('');
    const raw = b64Decode(rev);
    if (!raw) return '';
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
    }
    return out;
  } catch { return ''; }
}

function jsUnescapeSingle(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}

// Dean Edwards 打包解包（纯字符串操作，与 njavtv/videplay 同款）
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
  const re = /<article[^>]*class="[^"]*loop-video[^"]*"[^>]*>([\s\S]{0,6000}?)<\/article>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const blk = m[1];
    const lm = blk.match(/<a[^>]*href="(https:\/\/hornyjav\.com\/[^"]+\/)"[^>]*>/i);
    if (!lm) continue;
    const href = lm[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const clean = blk.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    let pic = '';
    const im = clean.match(/<img[^>]*>/i);
    if (im) {
      const sm = im[0].match(/(?:data-src|data-original|src)\s*=\s*"([^"]+)"/i);
      if (sm && /^https?:\/\//i.test(sm[1]) && !/data:image/i.test(sm[1])) pic = sm[1];
    }
    let title = '';
    const tm = clean.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]{0,300}?)<\/a>/i)
      || clean.match(/title="([^"]+)"/i);
    if (tm) title = stripTags(tm[1]);
    if (!title) {
      const hm = clean.match(/<h[23][^>]*>([\s\S]{0,300}?)<\/h[23]>/i);
      if (hm) title = stripTags(hm[1]);
    }
    if (!title || title.length < 2) continue;
    let remarks = '';
    const dm = clean.match(/(\d+:\d+(?::\d+)?)/);
    if (dm) remarks = dm[1];
    items.push({ vod_id: href, vod_name: title, vod_pic: pic, vod_remarks: remarks });
    if (items.length >= 60) break;
  }
  return items;
}

// 2026-10-30 晚：站内导航只有 3 个视频分类；其余用 WP 标签页（/tag/{slug}/，
// 首页卡片 tag-* 类实测 55 个，标签页与翻页 /page/N/ 均已验出内容）。
// 标签分类沿用 category() 的通用路径拼接，无需改逻辑。
const CATS = [
  { type_id: '/category/censored/', type_name: '有码' },
  { type_id: '/category/english-subtitle/', type_name: '英字' },
  { type_id: '/category/reducing-mosaic/', type_name: '减码' },
  { type_id: '/tag/big-tits/', type_name: '巨乳' },
  { type_id: '/tag/huge-butt/', type_name: '巨臀' },
  { type_id: '/tag/beautiful-butt/', type_name: '美臀' },
  { type_id: '/tag/amateur/', type_name: '素人' },
  { type_id: '/tag/beautiful-girl/', type_name: '美少女' },
  { type_id: '/tag/married-woman/', type_name: '人妻' },
  { type_id: '/tag/mature-woman/', type_name: '熟女' },
  { type_id: '/tag/milf/', type_name: '熟妇' },
  { type_id: '/tag/school-girls/', type_name: '校园' },
  { type_id: '/tag/cheating-wife/', type_name: '出轨妻' },
  { type_id: '/tag/young-wife/', type_name: '年轻妻' },
  { type_id: '/tag/creampie/', type_name: '中出' },
  { type_id: '/tag/blowjob/', type_name: '口交' },
  { type_id: '/tag/drama/', type_name: '剧情' },
  { type_id: '/tag/lesbian/', type_name: '女同' },
  { type_id: '/tag/hardcore/', type_name: '硬核' },
  { type_id: '/tag/pov/', type_name: '第一视角' },
  { type_id: '/tag/squirting/', type_name: '潮吹' },
  { type_id: '/tag/threesome-foursome/', type_name: '多人' },
  { type_id: '/tag/slender/', type_name: '苗条' },
];

async function init() { return {}; }

async function home() {
  const html = await getText(HOST + '/', HOST + '/');
  return { class: CATS, filters: {}, list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!tid) tid = '/category/censored/';
  const base = (HOST + '/' + tid.replace(/^\/+/, '')).replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/page/' + page + '/');
  const html = await getText(url, HOST + '/');
  const list = parseCards(html);
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}

async function resolveVideplay(embedUrl, durl) {
  const html = await getText(embedUrl, durl);
  if (!html) return '';
  const unpacked = unpackDeanEdwards(html);
  const hay = unpacked || html;
  const m = hay.match(/https:\/\/api\.videplay\.us\/o\/v-master\.m3u8\/[A-Za-z0-9_\-\.]+/i);
  if (m) return m[0];
  const m2 = hay.match(/https?:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?/i);
  return m2 ? m2[0] : '';
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const durl = /^https?:\/\//i.test(raw) ? raw : HOST + '/' + String(raw).replace(/^\/+/, '');
    const html = await getText(durl, HOST + '/');
    const hm = html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i)
      || html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const title = hm ? stripTags(hm[1]) : 'HornyJav';
    const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const pic = ogm ? ogm[1] : '';
    const lines = [];
    const bm = html.replace(/&quot;/g, '"').match(/data-server-urls="\[([^\]]*)\]"/i);
    if (bm) {
      let tokens = [];
      try { tokens = JSON.parse('[' + bm[1] + ']'); } catch { tokens = []; }
      let idx = 0;
      for (const tok of tokens) {
        idx++;
        const embed = decodeToken(tok);
        if (!embed || !/^https:\/\//i.test(embed)) continue;
        const master = await resolveVideplay(embed, durl);
        if (master) lines.push('服务器' + idx + '$' + master);
      }
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
    header: { 'User-Agent': UA, 'Referer': HOST + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const url = HOST + '/?s=' + encodeURIComponent(wd) + (page > 1 ? '&paged=' + page : '');
  const html = await getText(url, HOST + '/');
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
