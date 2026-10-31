// ToJav - 由 https://tojav.net/ 移植（初稿，待用户定名）
// 站方结构：HTML 列表页（tray 卡片）+ JSON 接口（搜索 / 播放 / 分页）。
// 分页实测结论（2026-10-31）：无码列表与 genre 页没有可用深翻页
// （?page= 被忽略：第 2 页或回第 1 页、或回全局列表，故只取第 1 页）；
// 有码列表走 POST /api/v1/pageView {page}（实测 p1/p2/p3 均不同、
// 均为有码内容，可正常翻页）；关键词分类走搜索接口（见下）。
// 详情：/<slug>，取 og:title / og:image / filmId / epButton(data-id)。
// 播放链（点播时现取，不缓存）：首页 meta(_token/_socket) -> Basic 鉴权
// -> POST /api/v1/player {episode, filmId} -> iframe vid-snap-player.com/embed/<uuid>
// -> GET /api/playlist-token/<uuid> -> {t} -> HLS：https://vid-snap-player.com/v/<t>
// （302 跳到存储 playlist.sb；token 内含请求方 IP 与时间戳，须设备侧现取）。
// 清晰度：实测 3 部（有码/无码各一 + 1 部）主清单均只有 1920x1080 单档，
// 故只出一线 1080p，不编造 720p 等不存在的档位。
// 字幕：与猫源 27 源同款芯（迅雷/迅雷看看/SubtitleCat 三槽、严过滤、
// 全局上限 10、单槽软上限 8、详情串行预热、点播挂 subs、无命中不带键）。
// 番号只从片名取（FC2 另加 FPV/PPV 形），不从播放地址取。
import req from '../../util/req.js';

const KEY = 'py_tojav';
const NAME = 'ToJav';
const HOST = 'https://tojav.net';
const EMBED = 'https://vid-snap-player.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_SIZE = 30;

function t(v) { return String(v == null ? '' : v).trim(); }
function clean(s) {
  return t(s).replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
// 纯 JS base64（ASCII 输入；token/socket 本身就是 base64 文本）
const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64encode(str) {
  let out = ''; let i;
  for (i = 0; i + 2 < str.length; i += 3) {
    const n = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8) | str.charCodeAt(i + 2);
    out += B64C[(n >> 18) & 63] + B64C[(n >> 12) & 63] + B64C[(n >> 6) & 63] + B64C[n & 63];
  }
  const rem = str.length - i;
  if (rem === 1) { const n1 = str.charCodeAt(i) << 16; out += B64C[(n1 >> 18) & 63] + B64C[(n1 >> 12) & 63] + '=='; }
  else if (rem === 2) { const n2 = (str.charCodeAt(i) << 16) | (str.charCodeAt(i + 1) << 8); out += B64C[(n2 >> 18) & 63] + B64C[(n2 >> 12) & 63] + B64C[(n2 >> 6) & 63] + '='; }
  return out;
}

// ---------- HTTP（只走框架 req） ----------
async function reqGet(url, headers, timeoutMs) {
  try {
    const r = await req.get(url, { headers: headers || {}, timeout: timeoutMs || 15000, responseType: 'text', transformResponse: [(d) => d] });
    const text = typeof r.data === 'string' ? r.data : (r.data === null || r.data === undefined ? '' : JSON.stringify(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}
async function reqPostForm(url, data, headers) {
  const body = Object.keys(data).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(data[k])).join('&');
  try {
    const r = await req.post(url, body, { headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}), timeout: 15000 });
    if (typeof r.data === 'string') {
      try { return { status: r.status || 0, json: JSON.parse(r.data), text: r.data }; }
      catch (e) { return { status: r.status || 0, json: null, text: r.data }; }
    }
    return { status: r.status || 0, json: r.data, text: '' };
  } catch (e) {
    return { status: 0, json: null, text: '' };
  }
}

// ---------- 鉴权（首页 meta，30 分钟缓存） ----------
let AUTH_CACHE = null;
async function getAuth() {
  if (AUTH_CACHE && Date.now() - AUTH_CACHE.ts < 30 * 60 * 1000) return AUTH_CACHE.auth;
  const r = await reqGet(HOST + '/', { 'User-Agent': UA });
  if (r.status !== 200) throw new Error('auth page fail');
  const token = (r.body.match(/meta name="_token"[^>]*value="([^"]+)"/) || [])[1] || '';
  const socket = (r.body.match(/meta name="_socket"[^>]*value="([^"]+)"/) || [])[1] || '';
  if (!token || !socket) throw new Error('auth meta missing');
  const auth = 'Basic ' + b64encode(token + ':' + socket);
  AUTH_CACHE = { ts: Date.now(), auth };
  return auth;
}

// ---------- 列表解析 ----------
function absPoster(p) {
  if (!p) return '';
  if (/^https?:\/\//.test(p)) return p;
  return HOST + (p.charAt(0) === '/' ? '' : '/') + p;
}
function parseItems(html) {
  const out = [];
  const re = /<a href="\/([^"]+)">\s*<img class="tray-item-thumbnail" src="([^"]+)" alt="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) && out.length < 60) {
    out.push({ vod_id: m[1], vod_name: clean(m[3]), vod_pic: absPoster(m[2]), vod_remarks: '' });
  }
  return out;
}
async function listPage(path, page) {
  const url = HOST + path + (page > 1 ? '?page=' + page : '');
  const r = await reqGet(url, { 'User-Agent': UA });
  if (r.status !== 200) return { list: [], more: false };
  const list = parseItems(r.body);
  return { list, more: list.length >= PAGE_SIZE };
}

// ---------- 分类 ----------
const KW_CATS = [
  { id: 'kw_dapigu', name: '大屁股', term: '尻' },
];
const CATS = [
  { type_id: 'genre:uncensored-leaked', type_name: '无码流出' },
  { type_id: 'genre:big-tits', type_name: '巨乳' },
  { type_id: 'kw_dapigu', type_name: '大屁股' },
  { type_id: 'genre:married-woman', type_name: '人妻' },
  { type_id: 'genre:uniform', type_name: '制服' },
  { type_id: 'genre:4k', type_name: '4K' },
  { type_id: 'genre:reducing-mosaic', type_name: '减码' },
  { type_id: 'genre:nurse', type_name: '护士' },
  { type_id: 'genre:maid', type_name: '女仆' },
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'censored', type_name: '有码' },
  { type_id: 'genre:beautiful-girl', type_name: 'Beautiful Girl' },
  { type_id: 'genre:featured-actress', type_name: 'Featured Actress' },
  { type_id: 'genre:nymphomaniac', type_name: 'Nymphomaniac' },
  { type_id: 'genre:kiss-kiss', type_name: 'Kiss Kiss' },
  { type_id: 'genre:idol-celebrity', type_name: 'Idol & Celebrity' },
  { type_id: 'genre:squirting', type_name: 'Squirting' },
  { type_id: 'genre:digital-mosaic', type_name: 'Digital Mosaic' },
  { type_id: 'genre:hi-def', type_name: 'Hi-Def' },
  { type_id: 'genre:humiliation', type_name: 'Humiliation' },
  { type_id: 'genre:pov', type_name: 'POV' },
  { type_id: 'genre:slut', type_name: 'Slut' },
  { type_id: 'genre:glasses', type_name: 'Glasses' },
  { type_id: 'genre:urination', type_name: 'Urination' },
  { type_id: 'genre:schoolgirl', type_name: 'Schoolgirl' },
  { type_id: 'genre:reluctant', type_name: 'Reluctant' },
  { type_id: 'genre:drama', type_name: 'Drama' },
  { type_id: 'genre:threesome--foursome', type_name: 'Threesome / Foursome' },
  { type_id: 'genre:gang-bang', type_name: 'Gang Bang' },
  { type_id: 'genre:female-teacher', type_name: 'Female Teacher' },
  { type_id: 'genre:titty-fuck', type_name: 'Titty Fuck' },
  { type_id: 'genre:cheating-wife', type_name: 'Cheating Wife' },
  { type_id: 'genre:creampie', type_name: 'Creampie' },
  { type_id: 'genre:orgy', type_name: 'Orgy' },
  { type_id: 'genre:cowgirl', type_name: 'Cowgirl' },
  { type_id: 'genre:slender', type_name: 'Slender' },
  { type_id: 'genre:dirty-talk', type_name: 'Dirty Talk' },
  { type_id: 'genre:bukkake', type_name: 'BUKKAKE' },
];
// 关键词分类：走站方搜索接口（POST /api/v1/search {term}，
// 站方返回 30 条；标题盲扫 240 条曾 0 命中，搜索接口是唯一可靠途径）。
// 短剧：用户 2026-10-31 令四家统一去掉，本站不设（站内搜“短編”得 0 条）。
const KWCACHE = {};
async function kwSearch(cat, page) {
  if (page > 1) return { list: [], more: false };
  if (KWCACHE[cat.id]) return { list: KWCACHE[cat.id], more: false };
  const auth = await getAuth();
  const r = await reqPostForm(HOST + '/api/v1/search', { term: cat.term },
    { Authorization: auth, 'User-Agent': UA, Referer: HOST + '/', 'X-Requested-With': 'XMLHttpRequest' });
  if (r.status !== 200 || !Array.isArray(r.json)) return { list: [], more: false };
  const list = r.json.slice(0, PAGE_SIZE).map((it) => ({
    vod_id: it.slug, vod_name: clean(it.name), vod_pic: absPoster(it.poster), vod_remarks: '',
  }));
  KWCACHE[cat.id] = list;
  return { list, more: false };
}
// 有码分页：POST /api/v1/pageView {page}（type 参数站方忽略，实测恒回有码流）
async function censoredPage(page) {
  const auth = await getAuth();
  const r = await reqPostForm(HOST + '/api/v1/pageView', { page, type: 'censored' },
    { Authorization: auth, 'User-Agent': UA, Referer: HOST + '/jav/censored', 'X-Requested-With': 'XMLHttpRequest' });
  if (r.status !== 200 || !Array.isArray(r.json)) return { list: [], more: false };
  const list = r.json.slice(0, PAGE_SIZE).map((it) => ({
    vod_id: it.slug, vod_name: clean(it.name), vod_pic: absPoster(it.poster), vod_remarks: '',
  }));
  return { list, more: list.length >= PAGE_SIZE };
}

// ---------- 字幕聚合（与猫源 27 源同款芯一致；番号只从片名取） ----------
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();
const subResultCache = new Map();
function subCacheName(url, name) {
  if (!url || !name) return;
  subNameCache.set(url, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}
function subExtractCode(text) {
  const s = String(text || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');
  const pats = [
    /\bFC2[- ]?(?:PPV|FPV)[- ]?\d{5,8}\b/,
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
function subCtx(url) {
  const title = (subNameCache.get(url) || '').trim();
  const code = subExtractCode(title);
  const compact = code ? code.replace(/[-_ ]/g, '') : '';
  let titlePart = '';
  if (code && title) {
    titlePart = title
      .replace(new RegExp(code.replace(/[-_]/g, '[-_ ]?'), 'i'), ' ')
      .replace(/\b(UNCENSORED|LEAK|OTHER|COMPLETE|FULL|HDR|WEB|BLURAY|BDRIP|WEBDL|REMUX|X264|X265|10BIT|8BIT|HEVC|AVC|MOSAIC)\b/gi, ' ')
      .replace(/\b(?:EP|E|S|SEASON)\s*\d{1,3}\b/gi, ' ')
      .replace(/^[\s\-_:]+|[\s\-_:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (titlePart === code || titlePart === compact) titlePart = '';
  }
  return { title, code, compact, titlePart };
}
function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}
function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}
function subMatchOf(url, ctx) {
  const text = ((ctx.title || '') + ' ' + String(url || '')).trim().toLowerCase();
  const title = (ctx.title || '').toLowerCase();
  return { text, loose: text.replace(/[-_\s.]/g, ''), title, titleLoose: title.replace(/[-_\s.]/g, '') };
}
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
function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}
async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await reqGet('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
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
async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
  if (!key) return;
  const r = await reqGet('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': UA, Referer: 'https://subtitlecat.com/' }, 5000);
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
    const pr = await reqGet('https://subtitlecat.com/' + p, { 'User-Agent': UA, Referer: 'https://subtitlecat.com/' }, 4000);
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
const subInflight = new Map();
async function subSearchAll(url) {
  const hit = subResultCache.get(url);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(url)) return subInflight.get(url);
  const p = (async () => {
    const ctx = subCtx(url);
    let subs = [];
    if (ctx.code || ctx.title) {
      const match = subMatchOf(url, ctx);
      const bag = [];
      const ocache = new Map();
      const jobs = [
        subSlotOracle(subKeysX(ctx), '迅雷', 0, ctx, match, ocache, bag),
        subSlotOracle(subKeysXL(ctx), '迅雷看看', 1, ctx, match, ocache, bag),
        subFromSubtitleCat(ctx, match, bag),
      ].map((jp) => Promise.resolve(jp).catch(() => {}));
      const all = Promise.allSettled(jobs);
      await Promise.race([all, new Promise((r) => setTimeout(r, 6000))]);
      subs = subMerge(bag);
      if (subs.length) {
        subResultCache.set(url, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(url, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(url, p);
  try { return await p; } finally { subInflight.delete(url); }
}

// ---------- 接口 ----------
async function home() {
  try {
    const r = await listPage('/jav/uncensored', 1);
    return { class: CATS, list: r.list };
  } catch (e) {
    return { class: CATS, list: [] };
  }
}
async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(Array.isArray(body.id) ? body.id[0] : body.id || body.tid || 'latest');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let r = { list: [], more: false };
  try {
    if (tid === 'latest') {
      // 无码无可用深翻页，只第 1 页
      if (page === 1) r = await listPage('/jav/uncensored', 1);
      else r = { list: [], more: false };
    }
    else if (tid === 'censored') r = await censoredPage(page);
    else if (tid.indexOf('kw_') === 0) {
      const cat = KW_CATS.find((c) => c.id === tid);
      if (cat) r = await kwSearch(cat, page);
    } else if (tid.indexOf('genre:') === 0) {
      // 原生 genre 只第 1 页可靠（站方第 2 页起回全局列表，故不翻页）
      if (page === 1) r = await listPage('/genre/' + tid.slice(6), 1);
      else r = { list: [], more: false };
    }
  } catch (e) { r = { list: [], more: false }; }
  return { page, pagecount: r.more ? page + 1 : page, list: r.list };
}
async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!kw || page > 1) return { list: [] };
  try {
    const auth = await getAuth();
    const r = await reqPostForm(HOST + '/api/v1/search', { term: kw },
      { Authorization: auth, 'User-Agent': UA, Referer: HOST + '/', 'X-Requested-With': 'XMLHttpRequest' });
    if (r.status !== 200 || !Array.isArray(r.json)) return { list: [] };
    return {
      list: r.json.slice(0, PAGE_SIZE).map((it) => ({
        vod_id: it.slug, vod_name: clean(it.name), vod_pic: absPoster(it.poster), vod_remarks: '',
      })),
    };
  } catch (e) {
    return { list: [] };
  }
}
async function detail(reqIn) {
  const body = reqIn?.body || {};
  const slug = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  if (!slug || /^(https?|tojav:)/.test(slug)) return { list: [] };
  let html = '';
  try {
    const r = await reqGet(HOST + '/' + slug, { 'User-Agent': UA });
    if (r.status !== 200) return { list: [] };
    html = r.body;
  } catch (e) {
    return { list: [] };
  }
  const title = clean((html.match(/og:title" content="([^"]*)"/) || [])[1] || (html.match(/<title>([^<]*)<\/title>/) || [])[1] || slug);
  // FC2 等条目站方本身无封面（og:image 为空）：退回站方默认图，与列表一致
  const pic = absPoster((html.match(/og:image" content="([^"]*)"/) || [])[1] || '/default-cover.jpg');
  const filmId = (html.match(/filmId\s*=\s*'(\d+)'/) || [])[1] || '';
  const eps = [];
  const epRe = /epButton[^>]*data-id="(\d+)"/g;
  let em;
  while ((em = epRe.exec(html))) eps.push(em[1]);
  const lines = [];
  if (filmId && eps.length) {
    eps.forEach((ep, i) => {
      lines.push({ name: eps.length > 1 ? '线路' + (i + 1) : '正片', url: 'tojav:' + filmId + ':' + ep });
    });
  }
  // 字幕预热：后台逐条串行（不 await；并行预热曾挤挂 SubtitleCat，见 ONE 教训）
  if (lines.length) {
    for (const l of lines) subCacheName(l.url, title);
    (async () => {
      for (const l of lines) {
        try { await subSearchAll(l.url); } catch (e) {}
      }
    })().catch(() => {});
  }
  return {
    list: [{
      vod_id: slug,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: '',
      vod_play_from: lines.length ? 'ToJav' : '',
      vod_play_url: lines.map((l) => l.name + '$' + l.url).join('#'),
    }],
  };
}
async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const idx = id.indexOf('$');
  let url = idx >= 0 ? id.slice(idx + 1) : id;
  url = t(url);
  if (!url) return { parse: 0, url: '' };
  // 非 tojav: 编码直接放行（防御性，正常线均为 tojav:film:ep）
  if (!/^tojav:\d+:\d+$/.test(url)) return { parse: 0, url, header: { 'User-Agent': UA } };
  const subsP = subSearchAll(url).catch(() => []);
  const parts = url.split(':');
  const filmId = parts[1];
  const episode = parts[2];
  let embedUrl = '';
  try {
    const auth = await getAuth();
    const pr = await reqPostForm(HOST + '/api/v1/player', { episode, filmId },
      { Authorization: auth, 'User-Agent': UA, Referer: HOST + '/', 'X-Requested-With': 'XMLHttpRequest' });
    let playerHtml = '';
    if (pr.json && pr.json.player) playerHtml = pr.json.player;
    else if (pr.text) {
      try { playerHtml = JSON.parse(pr.text).player || ''; } catch (e) { /* 忽略 */ }
    }
    const m = playerHtml.match(/embed\/([0-9a-f-]{36})/);
    if (!m) {
      const subs = await subsP;
      const res = { parse: 0, url: '' };
      if (subs && subs.length) res.subs = subs;
      return res;
    }
    embedUrl = EMBED + '/embed/' + m[1];
    const tr = await reqGet(EMBED + '/api/playlist-token/' + m[1],
      { Accept: 'application/json', 'User-Agent': UA, Referer: embedUrl });
    let token = '';
    if (tr.status === 200) {
      try { token = JSON.parse(tr.body).t || ''; } catch (e) { /* 忽略 */ }
    }
    const subs = await subsP;
    if (token) {
      const res = { parse: 0, url: EMBED + '/v/' + token, header: { Referer: embedUrl, 'User-Agent': UA } };
      if (subs && subs.length) res.subs = subs;
      return res;
    }
    // token 失败时退回 embed 页嗅探（parse:1）
    const res = { parse: 1, url: embedUrl, header: { Referer: HOST + '/', 'User-Agent': UA } };
    if (subs && subs.length) res.subs = subs;
    return res;
  } catch (e) {
    const subs = await subsP.catch(() => []);
    const res = { parse: embedUrl ? 1 : 0, url: embedUrl || '' };
    if (subs && subs.length) res.subs = subs;
    return res;
  }
}

export default function createSpider() {
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
