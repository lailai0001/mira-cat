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
// 自家抓取中转（2026-10-30 深夜新增，用户部署 site-fetch Worker 后生效；
// 未部署/不通时自动回落 jina/直连。Worker 代码见 site-fetch-worker.js）
const WORKER = 'https://site-fetch.li768435813.workers.dev';
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

// 2026-10-30 晚重写（真机全空后的根因修复）：
//  ① 直连在 App 侧过不了 CF 墙（真浏览器才过得了，App 的 req 拿不到内容，
//     用户截图 4 分类全是“暂无数据”即为证），故改 jina 优先，不再先浪费 12 秒
//     等直连超时；直连只作 CF 墙松动时的后备。
//  ② jina 若不认 x-respond-with 头会返回 Markdown（非 HTML），旧解析只认
//     <a> 标签，拿到“成功”的 Markdown 也解析出 0 条——同样表现为全空。
//     故 getHtml 照单全收（含 Markdown），解析层双格式兼容。
async function getHtml(url) {
  // ① 自家 Worker 优先（App→自家域名最稳；Worker 内直连+jina 两腿）
  try {
    const { data } = await req.get(WORKER + '/?u=' + encodeURIComponent(url), {
      headers: { 'User-Agent': UA, 'Referer': HOST + '/cn' },
      timeout: 35000,
    });
    const t = String(data || '');
    if (t && t.indexOf('/cn/') >= 0) return t;
  } catch {}
  const jinaTry = async () => {
    try {
      const { data } = await req.get(JINA + url, {
        headers: { 'User-Agent': UA, 'x-respond-with': 'html', 'Referer': HOST + '/cn' },
        timeout: 25000,
      });
      const t = String(data || '');
      if (t && t.indexOf('/cn/') >= 0) return t;
    } catch {}
    return '';
  };
  const j = await jinaTry();
  if (j) return j;
  const direct = await getDirect(url);
  if (direct && direct.indexOf('Just a moment') < 0 && direct.indexOf('/cn/') >= 0) return direct;
  // jina 对突发请求会短暂 403，隔 3 秒再试一次
  await new Promise(r => setTimeout(r, 3000));
  const j2 = await jinaTry();
  if (j2) return j2;
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
  const push = (code, title, pic) => {
    code = String(code).toLowerCase();
    if (seen.has(code)) return;
    // 列表里混有栏目卡（如 /cn/actresses），番号必含数字，纯词跳过
    if (!/\d/.test(code)) return;
    seen.add(code);
    if (!pic) pic = 'https://fourhoi.com/' + code + '/cover-t.jpg';
    if (!title) title = code.toUpperCase();
    items.push({ vod_id: HOST + '/cn/' + code, vod_name: title, vod_pic: pic, vod_remarks: code.toUpperCase() });
  };
  // HTML 卡片
  const re = /<a[^>]*href="https:\/\/njavtv\.com\/cn\/([a-z0-9\-]+)"[^>]*>([\s\S]{0,2000}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = m[1];
    const inner = m[2];
    let pic = '';
    // 卡片里 preview.mp4 的 data-src 排在封面前面，只取图片后缀的
    const dms = [...inner.matchAll(/data-src="(https:\/\/fourhoi\.com\/[^"]+)"/gi)].map(x => x[1]);
    pic = dms.find(u => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) || '';
    let title = '';
    const am = inner.match(/alt="([^"]+)"/i);
    if (am && am[1] && am[1] !== code) title = stripTags(am[1]);
    if (!title) {
      const tm = inner.match(/<[^>]*class="[^"]*(title|name)[^"]*"[^>]*>([\s\S]{0,300}?)<\/[^>]+>/i);
      if (tm) title = stripTags(tm[2]);
    }
    push(code, title, pic);
    if (items.length >= 60) return items;
  }
  // Markdown 兜底（jina 不认 x-respond-with 时返回 Markdown 链接）：
  // [标题](https://njavtv.com/cn/{code})；封面无图时用 cover-t.jpg 规律地址
  if (items.length < 3) {
    const mre = /\[([^\]]{1,200})\]\(https:\/\/njavtv\.com\/cn\/([a-z0-9\-]+)\)/gi;
    while ((m = mre.exec(html)) !== null) {
      const txt = stripTags(m[1]);
      // 时长链接（1:57:52）在标题链接之前，跳过它，让标题链接占位
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(txt)) continue;
      push(m[2], txt, '');
      if (items.length >= 60) break;
    }
  }
  return items;
}

// 2026-10-30 晚新增 5 个：dm 编号均以当日站内导航实测为准（dm 代码稳定，
// 旧 4 个当日仍在），新段页各验出 63~75 条卡片链接。
const CATS = [
  { type_id: '/dm635/cn/release', type_name: '新作上市' },
  { type_id: '/dm539/cn/new', type_name: '最新' },
  { type_id: '/dm278/cn/chinese-subtitle', type_name: '中文字幕' },
  { type_id: '/dm117/cn/genres/%E4%B8%8D%E4%BC%A6', type_name: '不伦' },
  { type_id: '/dm301/cn/today-hot', type_name: '今日热门' },
  { type_id: '/dm170/cn/weekly-hot', type_name: '周热门' },
  { type_id: '/dm273/cn/monthly-hot', type_name: '月热门' },
  { type_id: '/dm817/cn/uncensored-leak', type_name: '无码流出' },
  { type_id: '/dm597/cn/fc2', type_name: 'FC2' },
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
  let tid = String(body.id || body.tid || '');
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
