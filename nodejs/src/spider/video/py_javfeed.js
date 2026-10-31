// JavFeed（javfeed.site）- mira-cat 猫源蜘蛛
// 站点：Next.js 站，VM 直连可达。列表页含 JSON-LD ItemList（VideoObject：
// url/name/thumbnailUrl），详情页 og:video 给主清单，4 档清晰度。
// 关键：分清单的分片是 TS 内容却用 videoN.jpeg 后缀下发（同 MissAV 先例，
// 播放器建不起时间轴、不能拖进度）——故每条清晰度线路都走本地
// /proxy/m3u8 代理（同 ero 蜘蛛先例）：代理实时拉清单，把分片行改写
// 成绝对地址 + ?x=.ts 后缀，分片仍直连源站、不经代理；代理拉取失败
// 时 302 回源清单，不比旧行为更差。
// 清晰度诚实说明：只出站方主清单里实际有的档位（360p/480p/720p/1080p），
// 绝不编造。分类：只收录实测 200 且有内容的原生分类/标签（见 CATS 注释）。
import req from '../../util/req.js';

const KEY = 'py_javfeed';
const NAME = 'JavFeed';
const HOST = 'https://javfeed.site';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_SIZE = 24;

function t(v) { return String(v == null ? '' : v).trim(); }
function clean(s) {
  return t(s).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return m; } })
    .replace(/\s+/g, ' ').trim();
}
function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
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

// ---------- 分类 ----------
// type_id 约定：latest=最新（/），c:<slug>=原生分类（/category/<slug>），
// t:<slug>=标签（/tag/<slug>）。全部 2026-10-31 VM 实测 200 且有内容：
// latest 24 条；uncensored-leak 24 条；big-breasts 24 条；big-ass 24 条
// （big-butt 只有 7 条，故大屁股改用 big-ass）；mature-woman 24 条；
// beautiful-breasts 24 条；4k 24 条；wife 24 条；hd 24 条；creampie 24 条；
// slut 24 条；vr 24 条；individual 24 条；squirting 24 条。
// 删掉的候选：tag/leak 只有 1 条，不列入。
// 名称注意：mature-woman 标 熟女，不标人妻；人妻另有 wife 分类支撑。
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 't:uncensored-leak', type_name: '无码流出' },
  { type_id: 'c:big-breasts', type_name: '巨乳' },
  { type_id: 't:big-ass', type_name: '大屁股' },
  { type_id: 'c:mature-woman', type_name: '熟女' },
  { type_id: 'c:beautiful-breasts', type_name: '美乳' },
  { type_id: 't:4k', type_name: '4K' },
  { type_id: 'c:wife', type_name: '人妻' },
  { type_id: 'c:hd', type_name: '高清' },
  { type_id: 'c:creampie', type_name: '中出' },
  { type_id: 'c:slut', type_name: '淫女' },
  { type_id: 'c:vr', type_name: 'VR' },
  { type_id: 'c:individual', type_name: '个人拍摄' },
  { type_id: 'c:squirting', type_name: '潮吹' },
];

// ---------- 列表解析 ----------
// 优先 JSON-LD（VideoObject：name/thumbnailUrl/contentUrl），兜底用
// /video/ 链接 + fourhoi 封面按顺序对齐。
function parseList(html) {
  const out = [];
  if (!html) return out;
  const re = /"@type":"VideoObject","name":"((?:\\.|[^"\\])*?)","description":"(?:\\.|[^"\\])*?","thumbnailUrl":"([^"]+)","uploadDate":"[^"]*","contentUrl":"(https:\/\/javfeed\.site\/video\/([a-z0-9\-]+))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let name = m[1] || '';
    try { name = JSON.parse('"' + name + '"'); } catch (e) { /* 保持原样 */ }
    out.push({ vod_id: m[4], vod_name: clean(name), vod_pic: m[2], vod_remarks: '' });
    if (out.length >= 100) break;
  }
  if (out.length) return out;
  const slugs = [];
  const seen = new Set();
  for (const sm of html.matchAll(/href="\/video\/([a-z0-9\-]+)"/g)) {
    if (!seen.has(sm[1])) { seen.add(sm[1]); slugs.push(sm[1]); }
  }
  const pics = [...html.matchAll(/<img[^>]+src="(https:\/\/fourhoi\.com\/[^"]+)"/g)].map((x) => x[1]);
  slugs.forEach((slug, i) => {
    out.push({ vod_id: slug, vod_name: slug.toUpperCase(), vod_pic: pics[i] || '', vod_remarks: '' });
  });
  return out;
}

function listUrlFor(tid, page) {
  const p = page > 1 ? '/page/' + page : '';
  if (tid === 'latest') return HOST + '/' + (page > 1 ? 'page/' + page : '');
  if (tid.indexOf('c:') === 0) return HOST + '/category/' + tid.slice(2) + p;
  if (tid.indexOf('t:') === 0) return HOST + '/tag/' + tid.slice(2) + p;
  return HOST + '/' + (page > 1 ? 'page/' + page : '');
}

async function listPage(url) {
  const r = await reqGet(url, { 'User-Agent': UA });
  if (r.status !== 200 || !r.body) return { list: [], more: false };
  const list = parseList(r.body);
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

// ---------- m3u8 本地代理（同 ero 蜘蛛先例） ----------
// detail 的播放地址为本地代理地址；代理实时拉清单并改写——媒体清单的分片行
// 改成源站绝对地址 + ?x=.ts 后缀（分片仍直连源站、不经代理）；主清单的
// variant 行改指回代理。代理拉取失败时 302 回源清单，不比旧行为更差。
function b64url(s) {
  try {
    return Buffer.from(String(s), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (e) { return ''; }
}
function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
// 构造本地代理地址（js2p://_WEB_ 为 App 动态地址 scheme，同 missav 先例）
function proxyUrl(reqIn, path, targetUrl, referer) {
  try {
    const server = reqIn?.server;
    const dynamic = server?.address?.()?.dynamic || 'js2p://_WEB_';
    const prefix = server?.prefix || ('/spider/' + KEY + '/3');
    return `${dynamic}${prefix}${path}?u=${b64url(targetUrl)}&r=${b64url(referer || '')}`;
  } catch (e) { return ''; }
}
async function fetchPlaylistText(url, referer) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, 'Referer': referer || HOST + '/' },
      timeout: 20000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
    });
    const text = typeof r.data === 'string' ? r.data : '';
    if (r.status >= 200 && r.status < 300 && text) return text;
  } catch (e) { /* 落空走 302 降级 */ }
  return '';
}
function rewriteM3u8(raw, playlistUrl, selfBase, referer) {
  const isMaster = raw.includes('#EXT-X-STREAM-INF');
  const lines = String(raw).split(/\r?\n/);
  const out = lines.map((line) => {
    const s = line.trim();
    if (!s) return line;
    if (s.startsWith('#')) {
      if (s.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (all, uri) => {
          try { return `URI="${new URL(uri, playlistUrl).toString()}"`; } catch (e) { return all; }
        });
      }
      return line;
    }
    let abs;
    try { abs = new URL(s, playlistUrl).toString(); } catch (e) { return line; }
    if (isMaster) {
      return `${selfBase}/proxy/m3u8?u=${b64url(abs)}&r=${b64url(referer || '')}`;
    }
    return abs + (abs.includes('?') ? '&' : '?') + 'x=.ts';
  });
  return out.join('\n');
}
// GET /proxy/m3u8?u={b64url 清单地址}&r={b64url referer}
async function m3u8Proxy(request, reply) {
  const q = request?.query || {};
  if (!q.u) { reply.code(400).send('missing u'); return; }
  let target = '';
  let referer = HOST + '/';
  try {
    target = unb64url(q.u);
    if (q.r) referer = unb64url(q.r) || referer;
  } catch (e) { reply.code(400).send('bad u'); return; }
  if (!/^https?:\/\//.test(target)) { reply.code(400).send('bad u'); return; }
  const raw = await fetchPlaylistText(target, referer);
  if (!raw || !raw.includes('#EXTM3U')) { reply.redirect(target); return; }
  const host = request.headers && request.headers.host;
  const selfBase = host
    ? `http://${host}/spider/${KEY}/3`
    : (proxyUrl(request, '', '', '').replace(/\?.*$/, '') || `/spider/${KEY}/3`);
  reply.header('Content-Type', 'application/vnd.apple.mpegurl');
  reply.header('Cache-Control', 'no-cache');
  reply.send(rewriteM3u8(raw, target, selfBase, referer));
}

// ---------- 接口 ----------
async function home() {
  try {
    const r = await listPage(HOST + '/');
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
    r = await listPage(listUrlFor(tid, page));
  } catch (e) { r = { list: [], more: false }; }
  return { page, pagecount: r.more ? page + 1 : page, list: r.list };
}
async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  // 搜索翻页未坐实（/?s=<kw>&page=N 实测回 0 条），故只回 p1
  if (!kw || page > 1) return { page, pagecount: page, list: [] };
  try {
    const r = await listPage(HOST + '/?s=' + encodeURIComponent(kw));
    return { page: 1, pagecount: 1, list: r.list };
  } catch (e) {
    return { page: 1, pagecount: 1, list: [] };
  }
}
async function detail(reqIn) {
  const body = reqIn?.body || {};
  let slug = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  slug = slug.replace(/^https?:\/\/javfeed\.site\/video\//i, '').replace(/^\/video\//i, '').replace(/\/$/, '');
  if (!slug || /^https?:\/\//i.test(slug)) return { list: [] };
  const durl = HOST + '/video/' + slug;
  const r = await reqGet(durl, { 'User-Agent': UA });
  if (r.status !== 200 || !r.body) return { list: [] };
  const html = r.body;
  const title = clean((html.match(/property="og:title" content="([^"]*)"/) || [])[1] || (html.match(/<title>([^<]*)<\/title>/) || [])[1] || slug);
  const pic = absUrl((html.match(/property="og:image" content="([^"]*)"/) || [])[1] || '');
  const ogVideo = (html.match(/property="og:video" content="([^"]*)"/) || [])[1] || '';
  if (!ogVideo) return { list: [] };
  const masterUrl = absUrl(ogVideo);
  // 取主清单，解析各档（只出站方实际有的档位）
  const mr = await reqGet(masterUrl, { 'User-Agent': UA, Referer: durl });
  const lines = [];
  if (mr.status === 200 && mr.body && mr.body.includes('#EXTM3U')) {
    const mlines = String(mr.body).split(/\r?\n/);
    const quals = [];
    for (let i = 0; i < mlines.length; i++) {
      const s = mlines[i].trim();
      const res = s.match(/RESOLUTION=\d+x(\d+)/);
      if (s.startsWith('#EXT-X-STREAM-INF') && res) {
        const uri = (mlines[i + 1] || '').trim();
        if (uri && !uri.startsWith('#')) {
          let abs;
          try { abs = new URL(uri, masterUrl).toString(); } catch (e) { abs = ''; }
          if (abs) quals.push({ h: parseInt(res[1], 10), url: abs });
        }
      }
    }
    quals.sort((a, b) => b.h - a.h);
    for (const q of quals) {
      const proxy = proxyUrl(reqIn, '/proxy/m3u8', q.url, durl);
      lines.push({ name: q.h + 'p', url: proxy || q.url });
    }
  }
  if (!lines.length) {
    // 主清单取不到时退回自适应线（仍走代理，主清单 variant 行由代理改写）
    const proxy = proxyUrl(reqIn, '/proxy/m3u8', masterUrl, durl);
    lines.push({ name: '自适应', url: proxy || masterUrl });
  }
  // 字幕预热：按每条线路登记片名；后台逐条串行找字幕（不 await，
  // 不一拥而上——并行预热曾挤挂 SubtitleCat）
  for (const l of lines) subCacheName(l.url, title);
  (async () => {
    for (const l of lines) {
      try { await subSearchAll(l.url); } catch (e) {}
    }
  })().catch(() => {});
  return {
    list: [{
      vod_id: slug,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: '',
      vod_play_from: NAME,
      vod_play_url: lines.map((l) => l.name + '$' + l.url).join('#'),
    }],
  };
}
async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const idx = id.indexOf('$');
  let url = idx >= 0 ? id.slice(idx + 1) : id;
  url = t(url);
  if (!url) return { parse: 0, url: '' };
  // 字幕：detail 预热过则命中缓存/在途，一般不增加点播延迟；无命中不带 subs 键
  const subs = await subSearchAll(url).catch(() => []);
  const result = { parse: 0, url, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  if (subs && subs.length) result.subs = subs;
  return result;
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
      fastify.get('/proxy/m3u8', m3u8Proxy);
    },
  };
}
