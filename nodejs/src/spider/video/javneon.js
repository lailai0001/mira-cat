// JavNeon - CatPawOpen JS Spider
// 站：https://javneon.tv/（supjav3 主题，日系 AV 站）
// 已实测（2026-10-28）：
// - 列表卡：<div class="post"> 内 <a href="/video/{slug}/" class="img">，
//   <img data-original="https://img.supjav.com/images/xxx.jpg!320x216.jpg"> 为封面
//   （去 ! 后缀取原图），<h3> 为标题，meta 内为观看数与日期。
// - 分类（导航实测 slug）：censored-jav 有修正、uncensored-jav 無修正、
//   amateur 素人、chinese-subtitles 中文字幕、reducing-mosaic 破解马赛克、
//   english-subtitles 英文字幕、popular 人气；分页 /{slug}/page/{n}/。
// - 搜索：/?s={kw}（WordPress 搜索，实测出结果）。
// - 播放链（实测打通到嵌套播放页，见下）：详情页 .btn-server data-link
//   （十六进制串，首个为 EVS）→ JumpChain：
//   https://lk1.supremejav.com/javneon.php?l={hex}&bg=undefined
//   → 该页 JS 把 hex 反转成 ?c={反转串} → 跳到 evsishere.xyz/embed/{id}
//   （vidhide 式 JWPlayer 页）→ 页内有一段 Dean Edwards 打包脚本
//   eval(function(p,a,c,k,e,d){...}('...',36,N,'...'.split('|')))，
//   解包后 links.hls2 为 master.m3u8 直链（带 token 参数），
//   links.hls3 为 master.txt 兜底。蜘蛛在 JS 内实现解包器，不依赖外部库。
// - 注意：本机直取 master.m3u8 曾回 403（机房 IP / CDN 校验可能），
//   设备端（用户开 VPN）实测才是最终 verdict，推包前不得宣称已播通。
import req from '../../util/req.js';

const KEY = 'py_javneon';
const NAME = 'JavNeon';
const HOST = 'https://javneon.tv/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || HOST,
  };
}

async function getText(url, referer) {
  const r = await getWithUrl(url, referer);
  return r.html;
}

// 2026-10-29：App 内请求被站方 WAF 拦时的中转。直连在浏览器与本机都通、
// 唯独 App 内列表为空，说明站方按客户端指纹拦 App 请求；
// 中转 Worker（用户 CF 账号自建，见 ~/workspace/fix15/html-relay-worker.js，
// 部署后地址 https://html-relay.li768435813.workers.dev/）在 CF 边缘替 App 抓一次。
// 策略永远是“直连优先、中转兜底”：直连解析出内容就不走中转；直连解析为空才走中转，
// 中转没部署或同样为空时行为与原来一致，不回归、不报错。
const RELAY = 'https://html-relay.li768435813.workers.dev/';
async function fetchViaRelay(url, referer) {
  try {
    const res = await req.get(RELAY + '?url=' + encodeURIComponent(url), { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    const finalUrl = (res && res.headers && (res.headers['x-final-url'] || res.headers['X-Final-Url'])) || url;
    return { html: String(data || ''), finalUrl };
  } catch { return { html: '', finalUrl: url }; }
}

// 跟随重定向并返回最终 URL（axios 在 Node 下把最终地址放在
// res.request.res.responseUrl；拿不到时回落为请求地址）
async function getWithUrl(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    const finalUrl = (res && res.request && res.request.res && res.request.res.responseUrl)
      || (res && res.request && res.request.responseURL)
      || url;
    return { html: String(data || ''), finalUrl };
  } catch { return { html: '', finalUrl: url }; }
}

// 2026-10-29 加固：lk1 中转是干净的 HTTP 302。App 内 req 未必暴露 responseUrl，
// 故单独以 maxRedirects:0 请求一次，直接读 Location 头拿到嵌套页地址；
// axios 在 maxRedirects:0 时会把 302 抛成错误，Location 在 error.response 里，两种都要接。
async function getLk1Target(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 15000, maxRedirects: 0 });
    const loc = res && res.headers && (res.headers.location || res.headers.Location);
    return loc ? String(loc) : '';
  } catch (e) {
    const r = e && e.response;
    const loc = r && r.headers && (r.headers.location || r.headers.Location);
    return loc ? String(loc) : '';
  }
}

async function postJson(url, obj, referer) {
  try {
    const res = await req.post(url, obj, {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Accept': 'application/json,*/*',
        'Referer': referer || HOST,
        'Origin': (() => { try { return new URL(referer || HOST).origin; } catch { return HOST; } })(),
      },
      timeout: 20000,
    });
    const data = (res && res.data !== undefined) ? res.data : res;
    return (typeof data === 'string') ? JSON.parse(data) : data;
  } catch { return null; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#[0-9]+;/g, '').replace(/\s+/g, ' ').trim();
}

function parsePosts(html) {
  const items = [];
  const seen = new Set();
  const re = /<div class="post">([\s\S]{0,4000}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const blk = m[1];
    const lm = blk.match(/<a[^>]*href="([^"]*\/video\/[^"]+)"[^>]*>/i);
    if (!lm) continue;
    const url = lm[1].startsWith('http') ? lm[1] : HOST.replace(/\/$/, '') + lm[1];
    if (seen.has(url)) continue;
    const hm = blk.match(/<h3[^>]*>([\s\S]{0,400}?)<\/h3>/i);
    const title = hm ? stripTags(hm[1]) : '';
    if (!title || title.length < 2) continue;
    const pm = blk.match(/data-original="([^"]+)"/i);
    let pic = pm ? pm[1] : '';
    if (pic) pic = pic.split('!')[0];
    const dm = blk.match(/<span class="date">([^<]+)<\/span>/i);
    seen.add(url);
    items.push({ vod_id: url, vod_name: title, vod_pic: pic, vod_remarks: dm ? dm[1].trim() : '' });
    if (items.length >= 24) break;
  }
  return items;
}

// Dean Edwards 打包脚本解包：与页内 eval(function(p,a,c,k,e,d){...}) 等价
function unpackPacked(html) {
  const m = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)\)\)/);
  if (!m) return '';
  let p = m[1];
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = m[4].split('|');
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const toBase = (n) => {
    if (n === 0) return '0';
    let r = '';
    while (n > 0) { r = chars[n % a] + r; n = Math.floor(n / a); }
    return r;
  };
  // 原打包器从 c-1 倒序替换 \b token \b
  for (let i = c - 1; i >= 0; i--) {
    if (i < k.length && k[i]) {
      const tok = toBase(i);
      p = p.replace(new RegExp('\\b' + tok + '\\b', 'g'), k[i]);
    }
  }
  return p;
}

function extractM3u8(embedHtml) {
  const unpacked = unpackPacked(embedHtml);
  if (!unpacked) return '';
  // 优先 hls2（master.m3u8），其次 hls4，再次 hls3（master.txt）
  const lm = unpacked.match(/"hls2"\s*:\s*"([^"]+)"/) || unpacked.match(/hls2["']?\s*:\s*["']([^"']+)["']/);
  if (lm) return lm[1];
  const l4 = unpacked.match(/"hls4"\s*:\s*"([^"]+)"/);
  if (l4) return l4[1];
  const l3 = unpacked.match(/"hls3"\s*:\s*"([^"]+)"/);
  if (l3) return l3[1];
  const any = unpacked.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
  return any ? any[0] : '';
}

// 2026-10-29 重构：返回多条线路（不再首条即停），并修两个 App 侧脆弱点：
// ① lk1 目标优先读 Location 头（不依赖 responseUrl）；
// ② 只有嵌套地址形如 /e/{filecode} 时才 POST /api/stream——ST/VOE/LUC 等站
//    根本没有该接口，原代码会对它们各空等一次超时，App 侧表现为一直加载不出。
// ③ 详情改出多线路：VAS 新 API 线在前、EVS 打包线在后，任一可用即可播。
// presetHtml：详情页 HTML 已由调用方取好时直接用（中转兜底时传入中转抓到的 HTML）。
async function resolvePlayLines(detailUrl, presetHtml) {
  const html = presetHtml !== undefined ? presetHtml : await getText(detailUrl, HOST);
  const btns = [...html.matchAll(/class="btn-server"[^>]*data-link="([0-9a-f]+)"/gi)].map(x => x[1]);
  const lines = [];
  const seen = new Set();
  const push = (name, u) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    lines.push({ name, url: u });
  };
  for (const hex of btns) {
    const rev = hex.split('').reverse().join('');
    const lk1 = 'https://lk1.supremejav.com/javneon.php?c=' + rev;
    // 先读 Location 头拿嵌套地址；拿不到再回落跟随重定向
    let target = await getLk1Target(lk1, detailUrl);
    let embedHtml = '';
    if (target) {
      if (!/^https?:\/\//i.test(target)) {
        try { target = new URL(target, 'https://lk1.supremejav.com/').href; } catch {}
      }
      const r = await getWithUrl(target, detailUrl);
      embedHtml = r.html;
      target = r.finalUrl || target;
    } else {
      const r = await getWithUrl(lk1, detailUrl);
      embedHtml = r.html;
      target = r.finalUrl;
    }
    // lk1 直连拿不到嵌套页时（App 被 WAF 拦），走中转再试一次
    if (!embedHtml) {
      const rr = await fetchViaRelay(lk1, detailUrl);
      embedHtml = rr.html;
      target = rr.finalUrl || target;
    }
    if (!embedHtml) continue;
    // 路线 A：旧 evsishere 打包页 → 解包取 links.hls2（作第二线路）
    const packed = extractM3u8(embedHtml);
    if (packed) push('EVS', packed);
    // 路线 B：新 vidhide API 页（/e/{filecode}）→ POST /api/stream 取 streaming_url
    // 实测（2026-10-28，DLDSS-568）：POST {filecode, device:"web", codecs:[]}
    // 回 {"streaming_url":"https://m1-s1001604.97bf1.com/hls/.../master.m3u8"}，
    // 该 master 本机直取 200，含 480p/720p/1080p 三档；不带 cookie 也通，
    // codecs 传 ["h264"] 反而会超时/失败，故固定传 []。
    const fm = String(target).match(/\/e\/([A-Za-z0-9]+)/);
    if (fm) {
      let origin = '';
      try { origin = new URL(target).origin; } catch {}
      if (origin) {
        const j = await postJson(origin + '/api/stream', { filecode: fm[1], device: 'web', codecs: [] }, target);
        if (j && j.streaming_url) push('VAS', j.streaming_url);
      }
    }
  }
  // VAS 在前、EVS 在后
  lines.sort((a, b) => (a.name === 'VAS' ? 0 : 1) - (b.name === 'VAS' ? 0 : 1));
  return lines;
}

async function init() { return {}; }

// 直连解析为空时走中转再解析一次（中转未部署时返回空，与原来一致）
async function listSmart(url, referer) {
  const html = await getText(url, referer);
  let list = parsePosts(html);
  if (!list.length) {
    const rr = await fetchViaRelay(url, referer);
    const list2 = parsePosts(rr.html);
    if (list2.length) { list = list2; return { list, html: rr.html }; }
  }
  return { list, html };
}

async function home() {
  const { list } = await listSmart(HOST, HOST);
  return {
    class: [
      { type_id: 'censored-jav/', type_name: '有修正' },
      { type_id: 'uncensored-jav/', type_name: '無修正' },
      { type_id: 'amateur/', type_name: '素人' },
      { type_id: 'chinese-subtitles/', type_name: '中文字幕' },
      { type_id: 'reducing-mosaic/', type_name: '破解马赛克' },
      { type_id: 'english-subtitles/', type_name: '英文字幕' },
      { type_id: 'popular/', type_name: '人气' },
    ],
    filters: {},
    list,
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'censored-jav/');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const base = HOST + tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/page/' + page + '/');
  const { list } = await listSmart(url, HOST);
  return {
    page, pagecount: 9999, limit: 90,
    total: list.length ? 999999 : 0,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : HOST + String(raw).replace(/^\/+/, '');
    let html = await getText(url, HOST);
    let btnCount = (html.match(/class="btn-server"[^>]*data-link="/gi) || []).length;
    if (!btnCount) {
      const rr = await fetchViaRelay(url, HOST);
      if ((rr.html.match(/class="btn-server"[^>]*data-link="/gi) || []).length) html = rr.html;
    }
    const hm = html.match(/<h2[^>]*>([\s\S]{0,400}?)<\/h2>/i);
    // 封面在 player-wrap 的 background-image 里（页内其它 background-image 多为语言旗标，勿取首个）
    const pm = html.match(/player-wrap[^>]*style="[^"]*background-image:\s*url\((https?:[^)]+)\)/i)
      || html.match(/player-wrap[^>]*style='[^']*background-image:\s*url\((https?:[^)]+)\)/i);
    const lines = await resolvePlayLines(url, html);
    list.push({
      vod_id: raw,
      vod_name: hm ? stripTags(hm[1]) : 'JavNeon',
      vod_pic: pm ? pm[1] : '',
      vod_play_from: 'JavNeon',
      vod_play_url: lines.length ? lines.map(x => x.name + '$' + x.url).join('#') : ('未找到视频源$' + url),
    });
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
    header: H(HOST),
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  let url = HOST + '?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
  const { list } = await listSmart(url, HOST);
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
