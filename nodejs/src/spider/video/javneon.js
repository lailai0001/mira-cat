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

async function resolvePlay(detailUrl) {
  const html = await getText(detailUrl, HOST);
  const btns = [...html.matchAll(/class="btn-server"[^>]*data-link="([0-9a-f]+)"/gi)].map(x => x[1]);
  // 按按钮顺序逐个试，首个出 m3u8 即停（实测：首个 VAS 已通新 API 线）
  for (const hex of btns) {
    const rev = hex.split('').reverse().join('');
    // lk1 中转：?c=反转串，req 跟随重定向到嵌套播放页
    const { html: embedHtml, finalUrl } = await getWithUrl('https://lk1.supremejav.com/javneon.php?c=' + rev, detailUrl);
    if (!embedHtml) continue;
    // 路线 A：旧 evsishere 打包页 → 解包取 links.hls2
    const packed = extractM3u8(embedHtml);
    if (packed) return packed;
    // 路线 B：新 vidhide API 页（/e/{filecode}）→ POST /api/stream 取 streaming_url
    // 实测（2026-10-28，DLDSS-568）：POST {filecode, device:"web", codecs:[]}
    // 回 {"streaming_url":"https://m1-s1001604.97bf1.com/hls/.../master.m3u8"}，
    // 该 master 本机直取 200，含 480p/720p/1080p 三档；不带 cookie 也通，
    // codecs 传 ["h264"] 反而会超时/失败，故固定传 []。
    const fm = String(finalUrl).match(/\/e\/([A-Za-z0-9]+)/);
    if (fm) {
      let origin = '';
      try { origin = new URL(finalUrl).origin; } catch {}
      if (origin) {
        const j = await postJson(origin + '/api/stream', { filecode: fm[1], device: 'web', codecs: [] }, finalUrl);
        if (j && j.streaming_url) return j.streaming_url;
      }
    }
  }
  return '';
}

async function init() { return {}; }

async function home() {
  const html = await getText(HOST, HOST);
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
    list: parsePosts(html),
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'censored-jav/');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const base = HOST + tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/page/' + page + '/');
  const html = await getText(url, HOST);
  const list = parsePosts(html);
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
    const html = await getText(url, HOST);
    const hm = html.match(/<h2[^>]*>([\s\S]{0,400}?)<\/h2>/i);
    // 封面在 player-wrap 的 background-image 里（页内其它 background-image 多为语言旗标，勿取首个）
    const pm = html.match(/player-wrap[^>]*style="[^"]*background-image:\s*url\((https?:[^)]+)\)/i)
      || html.match(/player-wrap[^>]*style='[^']*background-image:\s*url\((https?:[^)]+)\)/i);
    const m3u8 = await resolvePlay(url);
    list.push({
      vod_id: raw,
      vod_name: hm ? stripTags(hm[1]) : 'JavNeon',
      vod_pic: pm ? pm[1] : '',
      vod_play_from: 'JavNeon',
      vod_play_url: m3u8 ? ('播放$' + m3u8) : ('未找到视频源$' + url),
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
  const html = await getText(url, HOST);
  const list = parsePosts(html);
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
