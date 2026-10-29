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
// - 2026-10-29 镜像优先（v4）：javneon.tv 的 Cloudflare 挑战页拦 App、Worker、
//   Jina、AllOrigins、翻译代理，也拦 GitHub Actions runner（实测 403 Just a moment），
//   只有真浏览器与本机 curl 能过。故列表/详情/搜索优先读仓库里的静态镜像
//   （mirror/javneon/<slug>.json，每分类第 1、2 页、每条含详情按钮串，
//   由助理侧定时任务用本机 curl 刷新；不要再挂 Actions 定时）。
//   镜像缺失或查不到时才回落直连→中转实时抓。播放链（lk1/vidhide）不在
//   javneon.tv 上，仍实时走，不受镜像影响。镜像里的 vod_id 统一用站内 path
//   （/video/<slug>/），详情时按 path 查镜像，不再先抓详情页。
// - 2026-10-29 晚 v5：镜像扩到 13 分类×5 页（120 条/分类），解决翻两页就没更多；
//   详情/搜索先读 lookup.json（路径索引）再只取一个分类文件，不再全量拉取
//   （详情慢的主因之一）；播放链改为 VAS 优先、EVS 兜底：集齐两者即停，
//   ST/VOE/LUC 仅在两者全失败时才试（它们常超时，是解析慢的另一主因）；
//   VAS master（实测 480p/720p/1080p 三档）现取现拆为清晰度线；
//   EVS master 本机直取 403（与 Referer/Cookie 无关，原因未坐实），故 EVS
//   只留单线备份、不拆档位。
// - 2026-10-29 晚 v5.1：EVS 在 VAS 出线时也尽量拆档（拆不开回落单线）；新加
//   tag-huge-butt（大屁股，实测 5 页各 24 条不重复）→ 14 分类。
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

// ---- javneon.tv 深分页中转（Node 直连代理，非 CF）----
// javneon.tv 的验证拦 App 也拦 CF Worker（实测 403 Just a moment），只有
// Node fetch/curl 能过；故第 6 页起的深页与深页详情走本中转，不走 CF 中转。
// JN_RELAY 为 javsb-relay 服务上的 /jn 路由（Railway 部署，见 javsb-relay 仓库 server.js）。
const JN_RELAY = 'https://javsb-relay-production.up.railway.app/jn';
async function fetchJn(url, referer) {
  try {
    const res = await req.get(JN_RELAY + '?url=' + encodeURIComponent(url), { headers: H(referer), timeout: 25000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    const finalUrl = (res && res.headers && (res.headers['x-final-url'] || res.headers['X-Final-Url'])) || url;
    return { html: String(data || ''), finalUrl };
  } catch { return { html: '', finalUrl: url }; }
}
// 分页 UI（<div class="pagination"> 内 /page/N/ 链接 + 当前页 <span>）取最大页码，
// 即该分类总页数；取不到时回 0（调用方用镜像总页数或当前页兜底）。
// 注意：末页本身的当前页是 <span> 不是链接，只算链接会少一页（如 4959 而非 4960）。
function parseTotalPages(html) {
  let max = 0;
  const m = String(html || '').match(/<div class="pagination">[\s\S]{0,3000}/i);
  const src = m ? m[0] : '';
  for (const mm of src.matchAll(/\/page\/(\d+)\//g)) {
    const n = parseInt(mm[1], 10);
    if (n > max) max = n;
  }
  const am = src.match(/<li class="active"><span>(\d+)<\/span>/i);
  if (am && parseInt(am[1], 10) > max) max = parseInt(am[1], 10);
  return max;
}

// ---- 镜像读取（ghfast 优先，raw 兜底；任一拿到含 items 的 JSON 即算成功）----
const MIRROR_BASES = [
  'https://ghfast.top/https://raw.githubusercontent.com/lailai0001/mira-cat/refs/heads/main/mirror/javneon/',
  'https://raw.githubusercontent.com/lailai0001/mira-cat/refs/heads/main/mirror/javneon/',
];
const MIRROR_CATS = ['censored-jav', 'uncensored-jav', 'amateur', 'chinese-subtitles', 'reducing-mosaic', 'english-subtitles', 'popular', 'tag-big-tits', 'tag-creampie', 'tag-solowork', 'tag-married-woman', 'tag-beautiful-girl', 'maker-s1-no-1-style', 'tag-huge-butt'];
// 新分类在站内的真实路径（仅直连回落时用；镜像文件统一用 key 名）
const CAT_PATHS = {
  'tag-big-tits': 'tag/big-tits', 'tag-creampie': 'tag/creampie',
  'tag-solowork': 'tag/solowork', 'tag-married-woman': 'tag/married-woman',
  'tag-beautiful-girl': 'tag/beautiful-girl', 'maker-s1-no-1-style': 'maker/s1-no-1-style',
  'tag-huge-butt': 'tag/huge-butt',
};
// 2026-10-29 v5：路径索引 lookup.json（path -> {s: 分类 key, t: 标题, p: 封面}），
// 详情/搜索先查索引再只取一个分类文件，不再 13 个文件全拉（详情慢的主因之一）。
async function fetchMirrorLookup() {
  for (const base of MIRROR_BASES) {
    try {
      const res = await req.get(base + 'lookup.json', { headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' }, timeout: 20000, maxRedirects: 10 });
      const data = (res && res.data !== undefined) ? res.data : res;
      const j = (typeof data === 'string') ? JSON.parse(data) : data;
      if (j && j.items && typeof j.items === 'object' && !Array.isArray(j.items) && Object.keys(j.items).length) return j.items;
    } catch {}
  }
  return null;
}
async function fetchMirrorJson(slug) {
  for (const base of MIRROR_BASES) {
    try {
      const res = await req.get(base + slug + '.json', { headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' }, timeout: 20000, maxRedirects: 10 });
      const data = (res && res.data !== undefined) ? res.data : res;
      const j = (typeof data === 'string') ? JSON.parse(data) : data;
      if (j && Array.isArray(j.items) && j.items.length) return j;
    } catch {}
  }
  return null;
}
async function fetchAllMirror() {
  const out = [];
  for (const slug of MIRROR_CATS) {
    const j = await fetchMirrorJson(slug);
    if (j) out.push(...j.items.map(it => ({ ...it, _cat: slug })));
  }
  return out;
}
function mirrorToVod(it) {
  return { vod_id: it.path, vod_name: it.title || '', vod_pic: it.pic || '', vod_remarks: it.date || '' };
}
// vod_id（完整 URL / path / 旧收藏）统一归一化为站内 path（/video/<slug>/）
function toMirrorPath(raw) {
  let s = String(raw || '').trim();
  const m = s.match(/\/video\/[^?#\s]+/i);
  if (m) { s = m[0]; if (!s.endsWith('/')) s += '/'; return s; }
  if (s.startsWith('/')) { if (!s.endsWith('/')) s += '/'; return s; }
  return s;
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
// 注意：首个按钮是 class="btn-server active"，旧正则 class="btn-server" 后紧跟引号
// 会漏掉它（SSIS-105 实测：旧正则只抓到 4 个，漏了 EVS）。必须允许 active 后缀。
async function resolvePlayLines(detailUrl, presetHtml) {
  const html = presetHtml !== undefined ? presetHtml : await getText(detailUrl, HOST);
  const btns = [...html.matchAll(/class="btn-server[^"]*"[^>]*data-link="([0-9a-f]+)"/gi)].map(x => x[1]);
  return resolvePlayLinesFromButtons(btns, detailUrl);
}
// 单个按钮：lk1 → 嵌套页（Location 头优先，跟随重定向兜底，中转再兜底）
async function resolveButton(hex, detailUrl) {
  const rev = hex.split('').reverse().join('');
  const lk1 = 'https://lk1.supremejav.com/javneon.php?c=' + rev;
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
  if (!embedHtml) {
    const rr = await fetchViaRelay(lk1, detailUrl);
    embedHtml = rr.html;
    target = rr.finalUrl || target;
  }
  if (!embedHtml) return null;
  return { target, embedHtml };
}

// master 现取现拆：解析 #EXT-X-STREAM-INF 的 RESOLUTION，拆成清晰度线（高→低）。
// 拆不到（单档 master 或取失败）返回 []，调用方回落单线。
async function expandMaster(masterUrl, referer, prefix) {
  try {
    const r = await getWithUrl(masterUrl, referer);
    const text = r.html || '';
    if (!text.includes('#EXTM3U') || !text.includes('#EXT-X-STREAM-INF')) return [];
    const out = [];
    const re = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)[^\n]*\n([^\n#]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const h = parseInt(m[2], 10);
      const label = h >= 1080 ? '1080p' : h >= 720 ? '720p' : h >= 480 ? '480p' : h + 'p';
      let u = m[3].trim();
      try { u = new URL(u, masterUrl).href; } catch {}
      out.push({ name: prefix + '·' + label, url: u, h });
    }
    out.sort((a, b) => b.h - a.h);
    return out.map(x => ({ name: x.name, url: x.url }));
  } catch { return []; }
}

// 2026-10-29 v5：VAS 优先、EVS 兜底，解析提速。
// 旧逻辑把 5 个按钮全跑一遍（ST/VOE/LUC 常超时），是“点开解析慢”的主因之一。
// 新逻辑：按按钮顺序跑 lk1，集齐 VAS 与 EVS 各一个即停（SSIS-105 实测顺序为
// EVS、VAS、ST、VOE、LUC，通常 2 次即停）；VAS 出线后出 VAS 清晰度线 + EVS 尽量拆档
// （拆不开回落单线）；VAS 全失败时 EVS 同样拆档；两者全失败才逐个试其余按钮。
// 注意：vidhide API 固定传 codecs:[]（传 ["h264"] 会超时/失败，2026-10-28 实测）。
async function resolvePlayLinesFromButtons(btns, detailUrl) {
  const lines = [];
  const seen = new Set();
  const push = (name, u) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    lines.push({ name, url: u });
  };
  let vas = null, evs = null;
  const others = [];
  for (const hex of btns) {
    const b = await resolveButton(hex, detailUrl);
    if (!b) continue;
    let host = '';
    try { host = new URL(b.target).hostname; } catch {}
    if (/\/e\/[A-Za-z0-9]+/.test(b.target) || /vvaassjjav\.xyz$/i.test(host)) { if (!vas) vas = b; }
    else if (/evsishere\.xyz$/i.test(host)) { if (!evs) evs = b; }
    else others.push(b);
    if (vas && evs) break;
  }
  let vasOk = false;
  if (vas) {
    const fm = String(vas.target).match(/\/e\/([A-Za-z0-9]+)/);
    if (fm) {
      let origin = '';
      try { origin = new URL(vas.target).origin; } catch {}
      if (origin) {
        const j = await postJson(origin + '/api/stream', { filecode: fm[1], device: 'web', codecs: [] }, vas.target);
        if (j && j.streaming_url) {
          const expanded = await expandMaster(j.streaming_url, vas.target, 'VAS');
          if (expanded.length) expanded.forEach(l => push(l.name, l.url));
          else push('VAS', j.streaming_url);
          vasOk = true;
        }
      }
    }
    if (!vasOk) {
      const packed = extractM3u8(vas.embedHtml);
      if (packed) { push('VAS', packed); vasOk = true; }
    }
  }
  if (vasOk) {
    // VAS 已出线：EVS 也尽量拆档（与 VAS 失败分支同款）；拆不开（master 403 等）
    // 时回落单线备份，不影响 VAS 线。
    if (evs) {
      const packed = extractM3u8(evs.embedHtml);
      if (packed) {
        const expanded = await expandMaster(packed, evs.target, 'EVS');
        if (expanded.length) expanded.forEach(l => push(l.name, l.url));
        else push('EVS', packed);
      }
    }
    return lines;
  }
  if (evs) {
    const packed = extractM3u8(evs.embedHtml);
    if (packed) {
      const expanded = await expandMaster(packed, evs.target, 'EVS');
      if (expanded.length) expanded.forEach(l => push(l.name, l.url));
      else push('EVS', packed);
      return lines;
    }
  }
  for (const b of others) {
    const packed = extractM3u8(b.embedHtml);
    if (packed) { push('OTHER', packed); break; }
    const fm = String(b.target).match(/\/e\/([A-Za-z0-9]+)/);
    if (fm) {
      let origin = '';
      try { origin = new URL(b.target).origin; } catch {}
      if (origin) {
        const j = await postJson(origin + '/api/stream', { filecode: fm[1], device: 'web', codecs: [] }, b.target);
        if (j && j.streaming_url) { push('OTHER', j.streaming_url); break; }
      }
    }
  }
  return lines;
}

async function init() { return {}; }

// 直连解析为空时走中转再解析一次（中转未部署时返回空，与原来一致）
async function listSmart(url, referer) {
  const html = await getText(url, referer);
  let list = parsePosts(html);
  if (!list.length) {
    const rr = await fetchJn(url, referer);
    const list2 = parsePosts(rr.html);
    if (list2.length) { list = list2; return { list, html: rr.html }; }
  }
  return { list, html };
}

async function home() {
  const mj = await fetchMirrorJson('censored-jav');
  if (mj) {
    const list = mj.items.slice(0, 24).map(mirrorToVod);
    return {
      class: [
        { type_id: 'censored-jav/', type_name: '有修正' },
        { type_id: 'uncensored-jav/', type_name: '無修正' },
        { type_id: 'amateur/', type_name: '素人' },
        { type_id: 'chinese-subtitles/', type_name: '中文字幕' },
        { type_id: 'reducing-mosaic/', type_name: '破解马赛克' },
        { type_id: 'english-subtitles/', type_name: '英文字幕' },
        { type_id: 'popular/', type_name: '人气' },
        { type_id: 'tag-big-tits/', type_name: '巨乳' },
        { type_id: 'tag-creampie/', type_name: '中出' },
        { type_id: 'tag-solowork/', type_name: '单人作品' },
        { type_id: 'tag-married-woman/', type_name: '人妻' },
        { type_id: 'tag-beautiful-girl/', type_name: '美少女' },
        { type_id: 'maker-s1-no-1-style/', type_name: 'S1' },
        { type_id: 'tag-huge-butt/', type_name: '大屁股' },
      ],
      filters: {},
      list,
    };
  }
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
      { type_id: 'tag-big-tits/', type_name: '巨乳' },
      { type_id: 'tag-creampie/', type_name: '中出' },
      { type_id: 'tag-solowork/', type_name: '单人作品' },
      { type_id: 'tag-married-woman/', type_name: '人妻' },
      { type_id: 'tag-beautiful-girl/', type_name: '美少女' },
      { type_id: 'maker-s1-no-1-style/', type_name: 'S1' },
      { type_id: 'tag-huge-butt/', type_name: '大屁股' },
    ],
    filters: {},
    list,
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'censored-jav/');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const slug = tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const mj = await fetchMirrorJson(slug);
  if (mj) {
    const all = mj.items.map(mirrorToVod);
    // 总页数以镜像里的 totalPages 为准（站方真实页数，如无码破解 4960），
    // 没有该字段的旧文件回落为镜像条数折算（5 页）——App 据此才知道后面还有页。
    const totalPages = (mj.totalPages > 0) ? mj.totalPages : Math.max(1, Math.ceil(all.length / 24));
    const start = (page - 1) * 24;
    const list = all.slice(start, start + 24);
    if (list.length) {
      return { page, pagecount: totalPages, limit: 24, total: totalPages * 24, list };
    }
    // 镜像里没有这一页（深页）：走 Node 中转实时抓该页
    if (page > 1) {
      const deepSlug = CAT_PATHS[slug] || slug;
      const url = HOST + deepSlug + '/page/' + page + '/';
      const rr = await fetchJn(url, HOST);
      const deepList = parsePosts(rr.html);
      if (deepList.length) {
        const tp = parseTotalPages(rr.html) || totalPages;
        return { page, pagecount: tp, limit: 24, total: tp * 24, list: deepList };
      }
      // 中转也空：如实返回空页，但 pagecount 给真实总数（App 知道还有更多）
      return { page, pagecount: totalPages, limit: 24, total: totalPages * 24, list: [] };
    }
    return { page, pagecount: totalPages, limit: 24, total: totalPages * 24, list: [] };
  }
  const liveSlug = CAT_PATHS[slug] || slug;
  const base = HOST + liveSlug;
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
    // 镜像优先：先读 lookup.json 定位分类、只取一个分类文件（不再全量拉取）；
    // 索引缺失或查不到时回落全量镜像；命中则直接用镜像里的按钮跑播放链，不碰详情页
    const path = toMirrorPath(raw);
    let hit = null;
    const lookup = await fetchMirrorLookup();
    if (lookup && lookup[path]) {
      const mj = await fetchMirrorJson(lookup[path].s);
      if (mj) hit = mj.items.find(it => toMirrorPath(it.path) === path) || null;
    }
    if (!hit) {
      const allMirror = await fetchAllMirror();
      hit = allMirror.find(it => toMirrorPath(it.path) === path);
    }
    if (hit && Array.isArray(hit.buttons) && hit.buttons.length) {
      const lines = await resolvePlayLinesFromButtons(hit.buttons, HOST.replace(/\/$/, '') + path);
      const item = {
        vod_id: raw,
        vod_name: hit.title || 'JavNeon',
        vod_pic: hit.pic || '',
        vod_play_from: 'JavNeon',
        vod_play_url: lines.length ? lines.map(x => x.name + '$' + x.url).join('#') : ('未找到视频源$' + url),
      };
      list.push(item);
      if (item.vod_name && item.vod_play_url) subRegister([raw], item);
      continue;
    }
    let html = await getText(url, HOST);
    let btnCount = (html.match(/class="btn-server[^"]*"[^>]*data-link="/gi) || []).length;
    if (!btnCount) {
      const rr = await fetchJn(url, HOST);
      if ((rr.html.match(/class="btn-server[^"]*"[^>]*data-link="/gi) || []).length) html = rr.html;
    }
    const hm = html.match(/<h2[^>]*>([\s\S]{0,400}?)<\/h2>/i);
    // 封面在 player-wrap 的 background-image 里（页内其它 background-image 多为语言旗标，勿取首个）
    const pm = html.match(/player-wrap[^>]*style="[^"]*background-image:\s*url\((https?:[^)]+)\)/i)
      || html.match(/player-wrap[^>]*style='[^']*background-image:\s*url\((https?:[^)]+)\)/i);
    const lines = await resolvePlayLines(url, html);
    const item = {
      vod_id: raw,
      vod_name: hm ? stripTags(hm[1]) : 'JavNeon',
      vod_pic: pm ? pm[1] : '',
      vod_play_from: 'JavNeon',
      vod_play_url: lines.length ? lines.map(x => x.name + '$' + x.url).join('#') : ('未找到视频源$' + url),
    };
    list.push(item);
    if (item.vod_name && item.vod_play_url) subRegister([raw], item);
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  if (!isVideo) {
    return {
      parse: 1,
      url: id,
      header: H(HOST),
    };
  }
  // 字幕聚合：按播放 id 查缓存/在途（detail 已登记片名并预热），命中则挂 subs；
  // 无命中时不带 subs 键，与接入前逐字段一致。
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  return subAttach({
    parse: 0,
    url: id,
    header: H(HOST),
  }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  // 2026-10-29 v5：搜索先走 lookup.json（一次请求）；索引里搜不到时不再全量拉取，
  // 直接回落实时搜索（索引与全量镜像是同一批数据，全量也不可能搜到）
  const lookup = await fetchMirrorLookup();
  if (lookup) {
    const kw = wd.toLowerCase();
    const matched = [];
    for (const key of Object.keys(lookup)) {
      const ent = lookup[key];
      if ((String(ent.t || '').toLowerCase().includes(kw)) || key.toLowerCase().includes(kw)) {
        matched.push({ vod_id: key, vod_name: ent.t || '', vod_pic: ent.p || '', vod_remarks: '' });
      }
    }
    if (matched.length) {
      const start = (page - 1) * 90;
      return { page, pagecount: Math.max(1, Math.ceil(matched.length / 90)), limit: 90, total: matched.length, list: matched.slice(start, start + 90) };
    }
  }
  // 镜像内搜索：标题或 path 含关键词（番号/片名片段都可），去重后分页
  const allMirror = lookup ? [] : await fetchAllMirror();
  if (allMirror.length) {
    const kw = wd.toLowerCase();
    const seen = new Set();
    const matched = [];
    for (const it of allMirror) {
      const key = toMirrorPath(it.path);
      if (seen.has(key)) continue;
      if ((String(it.title || '').toLowerCase().includes(kw)) || key.toLowerCase().includes(kw)) {
        seen.add(key);
        matched.push(mirrorToVod(it));
      }
    }
    if (matched.length) {
      const start = (page - 1) * 90;
      return { page, pagecount: Math.max(1, Math.ceil(matched.length / 90)), limit: 90, total: matched.length, list: matched.slice(start, start + 90) };
    }
    // 镜像里一个都没搜到：可能是新片未入库，仍回落实时搜索，不直接报空
  }
  let url = HOST + '?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
  const { list } = await listSmart(url, HOST);
  return { page, pagecount: 9999, limit: 90, total: list.length, list };
}

// ---------------- 字幕聚合接入（2026-10-29，移植自 avdb 等 27 个源的同款模块）----------------
// play() 返回 TVBox 标准 subs:[{name,url,format}]，MiraPlayer 可加载并选择字幕；
// detail() 登记片名并预热，play() 命中缓存/在途；无命中时不带 subs 键，与接入前一致。
// ---------------- 字幕聚合 (Layer A 铺开, 2026-10-23) ----------------
// 与 bestjavporn 试点同一实现 (提交 9c339419, 用户真机确认
// MiraPlayer 可加载并选择字幕): 点播时按片名/番号并行搜迅雷看看
// oracle (首档; 「迅雷」与「迅雷看看」实为同一接口) + SubtitleCat
// (第二档), 合并排序 = 来源档位 -> 语言 (简中>繁中>双语>英文>
// 其他) -> 番号命中 -> 热度, 只收 .srt/.vtt/.ass/.ssa 直链, 上限
// 10 条, 以 TVBox 标准 subs:[{name,url,format}] 挂到 play 结果。
// 总预算 6s、单请求 4~5s、全程框架 req (NOFETCH 安全)、结果缓存
// 10 分钟 (空结果不缓存); 无命中时不带 subs 键, play 返回与接入
// 前逐字段一致。SubHD (下载被站方门控) 与射手 (源站 522) 不接入。
const SUB_UA = (typeof UA !== 'undefined' && UA) ? UA : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

function subCleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// subHttp: 与试点 reqRaw 同语义 (状态码不抛错、仅 2xx 给正文、
// 文本恒等变换防自动 JSON 解析), 底层框架 req。
async function subHttp(url, headers, timeoutMs) {
  try {
    const r = await req.request({
      method: 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    });
    const text = typeof r.data === 'string' ? r.data : (r.data == null ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// play 入参归一: 个别 App 会把 "集名$播放id" 整段传回, 集名短且
// 不含 {/http 时剥掉前缀, 与 detail 登记的 episode id 对齐。
function subNormKey(k) {
  const s = String(k || '');
  const i = s.indexOf('$');
  if (i > 0) {
    const before = s.slice(0, i);
    if (before.length <= 30 && !/[{/]/.test(before) && !/http/i.test(before)) return s.slice(i + 1).trim();
  }
  return s.trim();
}

// detail 侧登记: 片名按 [detail 入参 id, vod_id, 每个 episode 的
// 播放 id] 多键写入 subNameCache, 并以首个 episode id 预热搜索。
function subRegister(detailIds, vod) {
  try {
    if (!vod || !vod.vod_name) return;
    const name = String(vod.vod_name);
    const keys = new Set();
    for (const i of (Array.isArray(detailIds) ? detailIds : [detailIds])) {
      if (i) keys.add(String(i));
    }
    if (vod.vod_id) keys.add(String(vod.vod_id));
    const eps = [];
    for (const grp of String(vod.vod_play_url || '').split('$$$')) {
      for (const seg of grp.split('#')) {
        const k = seg.indexOf('$');
        if (k >= 0) {
          const ep = seg.slice(k + 1);
          if (ep) { keys.add(ep); eps.push(ep); }
        }
      }
    }
    for (const k of keys) subCacheName(k, name);
    const warmKey = eps[0] || (vod.vod_id ? String(vod.vod_id) : '');
    if (warmKey) subWarm(warmKey);
  } catch (e) { /* 字幕登记失败不影响详情 */ }
}

// play 侧挂载: 仅当结果带非空 url 且字幕有命中时才加 subs 键。
async function subAttach(res, subsP) {
  try {
    const subs = await subsP;
    if (subs && subs.length && res && typeof res === 'object' && res.url) res.subs = subs;
  } catch (e) { /* 字幕挂载失败不影响播放结果 */ }
  return res;
}

// ---------------- 字幕聚合 (Layer A 重写, 2026-10-23) ----------------
// 按用户自有迅雷看看 REX 组件 (xunlei.subtitle) 的方法重写: 旧版把
// [番号, 全标题, 番号+标题] 多个键的召回合并成一池只排序不过滤,
// 全标题键的模糊召回灌进大量别片字幕 (实测 JUR-887 全标题键池
// 前排即 JUX-021 等别片), 且迅雷档位恒占满上限 10, SubtitleCat
// 永远挤不进来。新版三招 (与组件一致):
// (a) 键序逐个查、首个有结果的键即停 — 番号键命中的池小而准;
// (b) 命中后严过滤: 条目 name/langs/ext 须含番号 (宽松形亦可)
//     或片名全文, 不含的全扔, 无回退 (组件原法的回退宽松名单
//     在冷门番号上会把邻近番号的模糊池整池放行, 实测有害已删;
//     乱码单字键亦实测能召回无关字幕, 同样靠严过滤挡下);
// (c) 组件打分: cid_match 100000、含番号 +25000, 再加 oracle 自
//     带 score / fingerprintScore / 下载量, 按名+址去重取 top。
// 槽位 (用户钦定): 迅雷 (键序 [番号, 紧凑番号]) > 迅雷看看
// (组件完整键序 [番号, 紧凑番号, 番号+标题, 紧凑番号+标题,
// 全标题]) > SubtitleCat; 两迅雷槽同走同一 oracle 接口、不管
// 重不重复, 合并按 URL 去重、同条归高档位。合并序 = 档位 ->
// 语言 (简中>繁中>双语>英文>日文>其他, 沿用 subLangOf 口径)
// -> 分数; 全局上限 10、单槽软上限 8 (SubtitleCat 留位)。
// 全程 subHttp (框架 req 主栈), 迅雷系逐请求超时 3s、键序串行
// 首中即停; 总预算 6s、失败全静默; 无结果时 play 返回对象不带
// subs 键, 与未接入前逐字段一致。SubHD (下载被站方门控) 与
// 射手 (源站 522) 仍不接入。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();   // durl -> 片名 (detail 时 best-effort 写入)
const subResultCache = new Map(); // durl -> {ts, subs}

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? subCleanText(slug.replace(/[-_]+/g, ' ')) : '';
}

// 番号抽取 (移植自迅雷看看 REX 组件 extractSearchCode 的核心档)
function subExtractCode(text) {
  const s = String(text || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');
  const pats = [
    /\bFC2(?:[- ]?PPV)?[- ]?\d{5,8}\b/,
    /\bCARIB(?:PR)?[- ]?\d{6,8}\b/,
    /\b1PONDO[- ]?\d{6,8}\b/,
    /\bHEYZO[- ]?\d{3,6}\b/,
    /\b[A-Z]{2,10}[- ]\d{2,8}[A-Z]?\b/,
    /\b[A-Z]{2,10}\d{2,8}[A-Z]?\b/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[0].replace(/\s+/g, '-').replace(/-+/g, '-');
  }
  return '';
}

// 搜索上下文: 片名、番号、紧凑番号、标题部分 (去番号与噪声词)
function subCtx(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const compact = code ? code.replace(/[-_ ]/g, '') : '';
  let titlePart = '';
  if (code && title) {
    titlePart = title
      .replace(new RegExp(code.replace(/[-_]/g, '[-_ ]?'), 'i'), ' ')
      .replace(/\b(UNCENSORED|LEAK|OTHER|COMPLETE|FULL|HDR|WEB|BLURAY|BDRIP|WEBDL|REMUX|X264|X265|10BIT|8BIT|HEVC|AVC)\b/gi, ' ')
      .replace(/\b(?:EP|E|S|SEASON)\s*\d{1,3}\b/gi, ' ')
      .replace(/^[\s\-_:]+|[\s\-_:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (titlePart === code || titlePart === compact) titlePart = '';
  }
  return { title, code, compact, titlePart };
}

// 迅雷槽键序: 只番号两键 (锚定)
function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}

// 迅雷看看槽键序: 组件完整键序 (番号、紧凑番号、番号+标题、
// 紧凑番号+标题、全标题), 逐个查、首中即停。
function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}

// 严过滤的匹配文本 (组件口径: 片名 + 上下文, 全小写与去分隔符两形)
function subMatchOf(durl, ctx) {
  const text = ((ctx.title || '') + ' ' + String(durl || '')).trim().toLowerCase();
  const title = (ctx.title || '').toLowerCase();
  return {
    text,
    loose: text.replace(/[-_\s.]/g, ''),
    title,
    titleLoose: title.replace(/[-_\s.]/g, ''),
  };
}

// 语言判定: rank 越小越优先 (简中 > 繁中 > 双语 > 英文 > 其他)
function subLangOf(name, langs) {
  const s = (String(name || '') + ' ' + String(langs || '')).toLowerCase();
  if (/简体|简中|chs|zh[-_. ]?cn|zh[-_. ]?hans/.test(s)) return { tag: '简中', rank: 0 };
  if (/繁体|繁中|cht|zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?hant/.test(s)) return { tag: '繁中', rank: 1 };
  if (/双语|中英|中日|bilingual/.test(s)) return { tag: '双语', rank: 2 };
  if (/英文|english|eng|(^|[-_. ])en([-_. ]|$)/.test(s)) return { tag: '英文', rank: 3 };
  if (/日文|日语|japanese|jpn|(^|[-_. ])ja([-_. ]|$)/.test(s)) return { tag: '日文', rank: 4 };
  return { tag: '', rank: 5 };
}

const SUB_TEXT_RE = /\.(srt|vtt|ass|ssa)(\?|#|$)/i;

// 文本字幕格式判定: 文件名扩展名 > 条目 ext 字段 > url 后缀;
// 压缩包一律剔除 (与组件 getExt 口径一致, 只认 srt/vtt/ass/ssa)。
function subFmtOf(name, ext, url) {
  const hay = (String(name || '') + ' ' + String(url || '')).toLowerCase();
  if (/\.(zip|rar|7z)(\?|#|$)/.test(hay)) return '';
  const fromName = String(name || '').toLowerCase().match(/\.(srt|vtt|ass|ssa)$/);
  if (fromName) return fromName[1];
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (/^(srt|vtt|ass|ssa)$/.test(e)) return e;
  const fromUrl = String(url || '').match(SUB_TEXT_RE);
  if (fromUrl) return fromUrl[1].toLowerCase();
  return '';
}

// 裸哈希名不可读: 显示名换成番号字幕 (匹配/过滤仍用原名)
function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}

// oracle 单键查询 (同趟搜索内按键缓存, 两槽共用, 不重复发请求)
async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 3000);
    if (r.status !== 200 || !r.body) return [];
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return []; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return [];
    return j.data;
  })();
  ocache.set(key, p);
  return p;
}

// oracle 条目归一 (组件 normalizeResult 的字段口径)
function subNormItem(it) {
  const name = String(it.name || it.Name || it.title || it.Title || it.filename || it.FileName || '字幕');
  const langs = Array.isArray(it.languages) ? it.languages.join(',')
    : (Array.isArray(it.Languages) ? it.Languages.join(',') : String(it.langs || it.Langs || it.language || ''));
  return {
    name,
    langs,
    ext: String(it.ext || it.Ext || it.format || it.Format || ''),
    url: String(it.url || it.Url || ''),
    cid: Boolean(it.cid_match ?? it.CidMatch),
    down: Number(it.down_count || it.DownCount || it.downloads || it.Downloads || 0) || 0,
    score: Number(it.score || it.Score || 0) || 0,
    fp: Number(it.fingerprintf_score || it.fingerprint_score || it.FingerprintScore || it.fingerprintfScore || 0) || 0,
    duration: Number(it.duration || it.Duration || 0) || 0,
    size: Number(it.file_size || it.FileSize || it.size || it.Size || 0) || 0,
  };
}

// 严过滤 (组件口径): 条目 name/langs/ext 须含番号 (原形或宽松
// 形) 或片名全文, 否则扔掉。片名分支必须守非空: 个别蜘蛛的
// 播放 id 与 detail 登记键对不上时片名缓存会落空 (title=''),
// 空串是任何字符串的子串, 不守就会全池放行 (bigbuttshub 实测
// 教训: 假番号 EMPTY-24 搜出的 Sherlock 剧集字幕整页漏入)。
function subRelevant(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  if (ctx.code) {
    if (text.includes(ctx.code.toLowerCase())) return true;
    if (ctx.compact && loose.includes(ctx.compact.toLowerCase())) return true;
  }
  if (!match.text) return false;
  return text.includes(match.text) || loose.includes(match.loose)
    || (match.title ? (text.includes(match.title) || loose.includes(match.titleLoose)) : false)
    || match.text.includes(text);
}

// 组件打分 (scoreItem 的电影路径): cid_match 100000、含番号
// +25000、oracle 自带 score/fingerprintScore、下载量、时长/大小。
function subScoreItem(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  let s = (it.cid ? 100000 : 0) + it.down / 10000;
  if (ctx.code && (text.includes(ctx.code.toLowerCase()) || (ctx.compact && loose.includes(ctx.compact.toLowerCase())))) s += 25000;
  s += Math.max(0, it.score) + Math.max(0, it.fp);
  if (it.duration > 0) s += 50;
  if (it.size > 0) s += Math.min(it.size / 1024 / 1024, 20);
  if (match.title && (text.includes(match.title) || loose.includes(match.titleLoose))) s += 1000;
  if (ctx.code) s += 500;
  if (text.includes('sub') || text.includes('subtitle') || text.includes('字幕')) s += 300;
  return s;
}

// 迅雷系槽位 (迅雷 tier 0 / 迅雷看看 tier 1): 键序逐个查、首个
// 有结果的键即停; 命中池只过严过滤、无任何回退 — 组件原法的
// 「过滤到空回退宽松名单」在冷门番号上实测有害 (oracle 对无精
// 确字幕的番号返回邻近番号的模糊池, 回退等于整池垃圾放行:
// MOGK-006 挂上 MOGK-004/002、FC2-PPV-4991508 挂上他人番号),
// 与「宁缺毋滥」冲突, 故删除 (与 REX 版相关性闸门口径一致)。
async function subSlotOracle(keys, src, tier, ctx, match, ocache, bag) {
  let pool = null;
  for (const k of keys) {
    const list = await subOracle(k, ocache);
    if (list && list.length) { pool = list; break; }
  }
  if (!pool) return;
  const items = [];
  for (const raw of pool) {
    if (!raw) continue;
    const it = subNormItem(raw);
    if (!it.url) continue;
    const fmt = subFmtOf(it.name, it.ext, it.url);
    if (!fmt) continue;
    items.push({ name: it.name, langs: it.langs, ext: it.ext, url: it.url, fmt, norm: it });
  }
  if (!items.length) return;
  const finalItems = items.filter((it) => subRelevant(it, ctx, match));
  for (const it of finalItems) {
    const lang = subLangOf(it.name, it.langs);
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match) });
  }
}

// SubtitleCat 槽 (tier 2): 沿用旧芯搜索/解析 (按番号键搜、逐页
// 取按语言分的直链), 同样过严过滤 (无回退)。
async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
  if (!key) return;
  const r = await subHttp('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 5000);
  if (r.status !== 200 || !r.body) return;
  const pages = [];
  const seen = new Set();
  for (const m of r.body.matchAll(/href="(subs\/\d+\/[^"]+\.html)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    pages.push(m[1]);
    if (pages.length >= 3) break;
  }
  await Promise.all(pages.map(async (p) => {
    const pr = await subHttp('https://subtitlecat.com/' + p, { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 4000);
    if (pr.status !== 200 || !pr.body) return;
    for (const m of pr.body.matchAll(/href="(\/subs\/\d+\/[^"]+\.(?:srt|vtt|ass))"/gi)) {
      let nm = m[1].split('/').pop() || '字幕';
      try { nm = decodeURIComponent(nm); } catch (e) { /* 保持原样 */ }
      if (!subRelevant({ name: nm, langs: '', ext: '' }, ctx, match)) continue;
      const lang = subLangOf(nm, '');
      const fmt = (nm.match(/\.(srt|vtt|ass)$/i) || [])[1].toLowerCase();
      bag.push({ src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], fmt, lang: lang.tag, langRank: lang.rank, score: 0 });
    }
  }));
}

// 合并: 档位 -> 语言 -> 分数; 按 URL 去重 (同条归先到高档位);
// 全局上限 10、单槽软上限 8 (给 SubtitleCat 留位)。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const perTier = {};
  const out = [];
  for (const it of sorted) {
    if (out.length >= 10) break;
    if (seenUrl.has(it.url)) continue;
    if ((perTier[it.tier] || 0) >= 8) continue;
    seenUrl.add(it.url);
    perTier[it.tier] = (perTier[it.tier] || 0) + 1;
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: it.fmt });
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const ctx = subCtx(durl);
    let subs = [];
    if (ctx.code || ctx.title) {
      const match = subMatchOf(durl, ctx);
      const bag = [];
      const ocache = new Map();
      const jobs = [
        subSlotOracle(subKeysX(ctx), '迅雷', 0, ctx, match, ocache, bag),
        subSlotOracle(subKeysXL(ctx), '迅雷看看', 1, ctx, match, ocache, bag),
        subFromSubtitleCat(ctx, match, bag),
      ].map((jp) => Promise.resolve(jp).catch(() => {}));
      const all = Promise.allSettled(jobs);
      // 总预算 6s: 到点先用已入 bag 的部分合并返回; 后台源跑完
      // 后若凑出结果再迟填缓存 (慢出口下 detail 预热靠此命中)。
      // 空结果不缓存 (无字幕的片每次点播重查, 由在途去重兜底)。
      await Promise.race([all, new Promise((r) => setTimeout(r, 6000))]);
      subs = subMerge(bag);
      if (subs.length) {
        subResultCache.set(durl, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(durl, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(durl, p);
  try { return await p; } finally { subInflight.delete(durl); }
}

// detail 入口即预热 (不 await): 慢出口下单趟搜索可达数秒, 让它
// 与详情页的铸造链并行跑, 用户点播时 play 直接命中缓存/在途。
function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
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
