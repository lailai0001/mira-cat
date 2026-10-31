// Ero（ero.to）- mira-cat 猫源蜘蛛初稿（2026-10-31 调研起草，未推送）
// 站点：WordPress + manyse CDN。详情页脚本给出 videoLink/pndvd/versionSuffix，
// 播放地址 = https://test.manyse.com/<videoLink>/<CODE>/play.m3u8（FHD 线）
// 及 <CODE>-M/play.m3u8（去码线，仅去码片有，须验活才出线）。
// 关键：分片是 TS 内容却用 .jpeg 后缀 + image/jpeg 类型下发（实测首字节
// 0x47），严格 HLS 内核会拒分片、建不起时间轴——故播放地址走本地
// /proxy/m3u8 代理（同 missav_xptv 先例）：代理实时拉清单，把分片行改写
// 成 CDN 绝对地址 + ?x=.ts 后缀，分片仍直连 CDN、不经代理；代理拉取失败
// 时 302 回源清单，不比旧行为更差。
// 清晰度诚实说明：站方没有 1080p/720p 数字分档；只有 FHD 线与去码线两档，
// 绝不编造数字清晰度。分类：前列为用户钦定中文名（原生类型页支撑，
// 短剧已按用户 2026-10-31 令去掉），其后为原生类型按量排序。
import req from '../../util/req.js';

const KEY = 'py_ero';
const NAME = 'Ero';
const HOST = 'https://ero.to';
const IMG = 'https://img.manyse.com/img/';
const PLAY = 'https://test.manyse.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_SIZE = 24;

function t(v) { return String(v == null ? '' : v).trim(); }
function clean(s) {
  return t(s).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

// 统一取数：框架 req 主栈，不用全局 fetch；状态码不抛错（validateStatus
// 全放行），body 仅 2xx 时给正文；网络错误/超时回 status 0。
async function getHtml(url, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA },
      timeout: timeoutMs || 20000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
    });
    const text = typeof r.data === 'string' ? r.data : (r.data === null || r.data === undefined ? '' : JSON.stringify(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// ---------- 分类 ----------
// type_id 约定：newest=最新（/vod/），fc2=FC2 PPV（/fc2/），g:<slug>=原生类型页。
// 前列 9 个为用户钦定中文名（均有原生支撑，见 REPORT_ero.md 对照表；短剧已去掉）；
// 其后 20 个为原生类型按站内数量排序（中文显示名，原名见报告）。
const CATS = [
  { type_id: 'g:%e3%83%a2%e3%82%b6%e3%82%a4%e3%82%af%e9%99%a4%e5%8e%bb', type_name: '无码流出' },
  { type_id: 'g:%e5%b7%a8%e4%b9%b3', type_name: '巨乳' },
  { type_id: 'g:%e5%b7%a8%e5%b0%bb', type_name: '大屁股' },
  { type_id: 'g:%e4%ba%ba%e5%a6%bb%e3%83%bb%e4%b8%bb%e5%a9%a6', type_name: '人妻' },
  { type_id: 'g:%e5%88%b6%e6%9c%8d', type_name: '制服' },
  { type_id: 'fc2', type_name: 'FC2 PPV' },
  { type_id: 'g:4k', type_name: '4K' },
  { type_id: 'g:%e4%b8%ad%e5%87%ba%e3%81%97', type_name: '中出し' },
  { type_id: 'g:%e7%b4%a0%e4%ba%ba', type_name: '素人' },
  { type_id: 'newest', type_name: '最新' },
  { type_id: 'g:%e5%8d%98%e4%bd%93%e4%bd%9c%e5%93%81', type_name: '单体作品' },
  { type_id: 'g:%e3%83%8f%e3%82%a4%e3%83%93%e3%82%b8%e3%83%a7%e3%83%b3', type_name: '高清' },
  { type_id: 'g:%e7%8b%ac%e5%8d%a0%e9%85%8d%e4%bf%a1', type_name: '独占配信' },
  { type_id: 'g:%e9%ab%98%e3%83%93%e3%83%83%e3%83%88%e3%83%ac%e3%83%bc%e3%83%88', type_name: '高码率' },
  { type_id: 'g:%e7%be%8e%e5%b0%91%e5%a5%b3', type_name: '美少女' },
  { type_id: 'g:%e3%83%95%e3%82%a7%e3%83%a9', type_name: '口交' },
  { type_id: 'g:%e3%82%b9%e3%83%ac%e3%83%b3%e3%83%80%e3%83%bc', type_name: '苗条' },
  { type_id: 'g:%e3%82%b5%e3%83%b3%e3%83%97%e3%83%ab%e5%8b%95%e7%94%bb', type_name: '样品视频' },
  { type_id: 'g:%e9%85%8d%e4%bf%a1%e5%b0%82%e7%94%a8', type_name: '配信专用' },
  { type_id: 'g:%e7%97%b4%e5%a5%b3', type_name: '痴女' },
  { type_id: 'g:%e7%86%9f%e5%a5%b3', type_name: '熟女' },
  { type_id: 'g:%e3%83%8f%e3%83%a1%e3%82%92%e3%82%8a', type_name: '自拍' },
  { type_id: 'g:3p%e3%83%bb4p', type_name: '3P・4P' },
  { type_id: 'g:%e3%83%95%e3%83%ab%e3%83%8f%e3%82%a4%e3%83%93%e3%82%b8%e3%83%a7%e3%83%b3fhd', type_name: '全高清' },
  { type_id: 'g:%e6%bd%ae%e5%90%b9%e3%81%8d', type_name: '潮吹' },
  { type_id: 'g:%e5%af%9d%e5%8f%96%e3%82%8a%e3%83%bb%e5%af%9d%e5%8f%96%e3%82%89%e3%82%8c%e3%83%bbntr', type_name: 'NTR' },
  { type_id: 'g:%e7%be%8e%e4%b9%b3', type_name: '美乳' },
  { type_id: 'g:%e6%b7%ab%e4%b9%b1%e3%83%bb%e3%83%8f%e3%83%bc%e3%83%89%e7%b3%bb', type_name: '淫乱重口' },
  { type_id: 'g:%e3%82%a2%e3%82%af%e3%83%a1%e3%83%bb%e3%82%aa%e3%83%bc%e3%82%ac%e3%82%ba%e3%83%a0', type_name: '高潮' },
  { type_id: 'g:%e9%a8%8e%e4%b9%97%e4%bd%8d', type_name: '骑乘位' },
];

// ---------- 列表解析 ----------
// 卡片：<a href="/vod|fc2/<id>/"><img src="...jpg"></a> + badge + 标题 clamp div。
function parseCards(html) {
  const out = [];
  if (!html || html.includes('Just a moment...')) return out;
  const re = /<a href="https:\/\/ero\.to\/(vod|fc2)\/(\d+)\/"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*>[\s\S]{0,1200}?-webkit-line-clamp: 2;[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[0];
    const badge = (block.match(/<span class="badge bg-danger">([^<]+)<\/span>/) || [])[1] || '';
    out.push({
      vod_id: m[1] + ':' + m[2],
      vod_name: clean(m[4]),
      vod_pic: m[3],
      vod_remarks: badge ? clean(badge) : '',
    });
    if (out.length >= 100) break;
  }
  return out;
}

function listUrlFor(tid, page) {
  const p = page > 1 ? 'page/' + page + '/' : '';
  if (tid === 'newest') return HOST + '/vod/' + p;
  if (tid === 'fc2') return HOST + '/fc2/' + p;
  if (tid.indexOf('g:') === 0) return HOST + '/vod_genre/' + tid.slice(2) + '/' + p;
  return HOST + '/vod/' + p;
}

async function home() {
  let list = [];
  try {
    const r = await getHtml(HOST + '/vod/');
    list = parseCards(r.body);
  } catch (e) { list = []; }
  return { class: CATS, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(Array.isArray(body.id) ? body.id[0] : body.id || body.tid || 'newest');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let list = [];
  try {
    const r = await getHtml(listUrlFor(tid, page));
    list = parseCards(r.body);
  } catch (e) { list = []; }
  return { page, pagecount: list.length >= PAGE_SIZE ? page + 1 : page, list };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  if (!kw) return { list: [] };
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let list = [];
  try {
    const url = HOST + '/?s=' + encodeURIComponent(kw) + '&post_type%5B%5D=vod&post_type%5B%5D=fc2' + (page > 1 ? '&paged=' + page : '');
    const r = await getHtml(url);
    list = parseCards(r.body);
  } catch (e) { list = []; }
  return { list };
}

// ---------- 详情 / 播放 ----------
// 详情页脚本：vod 页为 videoLink/pndvd/versionSuffix 构造式；fc2 页为
// playUrls JSON 数组。去码线（-M）只在去码片上活着，须验活才出线：
// FHD 除明确 404 外一律出线（网络错误时 fail-open）；-M 须 GET 200 才出线，
// 网络错误时仅当页标签含モザイク除去才出线（fail-open + 标签佐证）。
async function checkM3u8(url) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA },
      timeout: 15000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
    });
    const text = typeof r.data === 'string' ? r.data : '';
    return { status: r.status || 0, isM3u8: text.includes('#EXTM3U') };
  } catch (e) {
    return { status: 0, isM3u8: false };
  }
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  id = id.replace(/^ero:/, '');
  const mm = id.match(/^(vod|fc2):(\d+)$/);
  if (!mm) return { list: [] };
  const type = mm[1];
  const pageUrl = HOST + '/' + type + '/' + mm[2] + '/';
  let html = '';
  try {
    const r = await getHtml(pageUrl);
    html = r.body;
  } catch (e) { return { list: [] }; }
  if (!html || html.includes('Just a moment...')) return { list: [] };
  const ogTitle = (html.match(/<meta property="og:title" content="([^"]+)"[^>]*>/) || [])[1] || '';
  const titleTag = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
  let title = clean(ogTitle || titleTag.split(' – ')[0] || '');
  if (!title) title = 'Ero #' + mm[2];
  const poster = (html.match(/poster="([^"]+)"/) || [])[1] || '';
  const tags = [];
  const tagRe = /rel="tag">([^<]+)</g;
  let tm;
  while ((tm = tagRe.exec(html)) !== null && tags.length < 8) {
    const tg = clean(tm[1]);
    if (tg && !tags.includes(tg)) tags.push(tg);
  }
  const hasMosaicTag = tags.includes('モザイク除去');
  // 播放候选
  const cands = []; // {name, url}
  if (type === 'fc2') {
    const urlRe = /"label":"([^"]+)","url":"([^"]+)"/g;
    let um;
    while ((um = urlRe.exec(html)) !== null) {
      const u = um[2].replace(/\\\//g, '/');
      if (/^https?:\/\//.test(u)) cands.push({ name: clean(um[1]) || 'FHD', url: u, kind: 'fhd' });
    }
  } else {
    const videoLink = (html.match(/videoLink = "([^"]+)"/) || [])[1] || '2610';
    let code = (html.match(/pndvd = "([^"]+)"/) || [])[1] || '';
    if (!code) code = subExtractCode(title);
    const suffix = (html.match(/versionSuffix = "([^"]*)"/) || [])[1] || '';
    if (code) {
      cands.push({ name: 'FHD', url: PLAY + videoLink + '/' + code + '/play.m3u8' + suffix, kind: 'fhd' });
      cands.push({ name: '去码版', url: PLAY + videoLink + '/' + code + '-M/play.m3u8' + suffix, kind: 'm' });
    }
  }
  if (!cands.length) return { list: [] };
  // 并行验活（仅 1 轮往返）
  const checks = await Promise.all(cands.map((c) => checkM3u8(c.url)));
  const lines = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const ck = checks[i];
    let live = false;
    if (c.kind === 'fhd') live = ck.status !== 404;
    else live = ck.status === 200 || (ck.status === 0 && hasMosaicTag);
    if (!live) continue;
    const proxy = proxyUrl(reqIn, '/proxy/m3u8', c.url, pageUrl);
    lines.push({ name: c.name, url: proxy || c.url });
  }
  if (!lines.length) return { list: [] };
  const cover = poster;
  // 字幕预热：按每条播放地址登记片名；后台逐条串行找字幕（不 await，
  // 不一拥而上——并行预热会把 SubtitleCat 搜索挤挂，见 py_one 实测教训）
  for (const l of lines) subCacheName(l.url, title);
  (async () => {
    for (const l of lines) {
      try { await subSearchAll(l.url); } catch (e) {}
    }
  })().catch(() => {});
  return {
    list: [{
      vod_id: type + ':' + mm[2],
      vod_name: title,
      vod_pic: cover,
      vod_remarks: tags.join(' / '),
      vod_play_from: 'Ero',
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

// ---------- m3u8 本地代理（同 missav_xptv 先例） ----------
// detail 的播放地址为本地代理地址；代理实时拉清单并改写——媒体清单的分片行
// 改成 CDN 绝对地址 + ?x=.ts 后缀（分片仍直连 CDN、不经代理）；主清单的
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

// ---------- 字幕聚合（与猫源 27 源同款芯一致，仿 py_one.js 字幕聚合节） ----------
// 三槽：迅雷（键序 [番号， 紧凑番号]）> 迅雷看看（完整键序）> SubtitleCat；
// 两迅雷槽同走同一 oracle 接口、合并按 URL 去重、同条归高档位；合并序 =
// 档位 -> 语言（简中>繁中>双语>英文>日文>其他）-> 分数；全局上限 10、
// 单槽软上限 8。严过滤（条目须含番号或片名全文，无回退，宁缺毋滥）；
// 全程 req 主栈、逐请求超时 3s、总预算 6s、失败全静默、无命中不带 subs 键。
// 番号只从片名取，不从播放地址取（代理地址含 b64 串、CDN 域名都不可信）。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();
const subResultCache = new Map();
function subCacheName(url, name) {
  if (!url || !name) return;
  subNameCache.set(url, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}
async function reqRaw(url, headers, timeoutMs) {
  try {
    const r = await req.get(url, { headers: headers || {}, timeout: timeoutMs || 10000, responseType: 'text', transformResponse: [(d) => d] });
    const text = typeof r.data === 'string' ? r.data : (r.data === null || r.data === undefined ? '' : JSON.stringify(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}
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
function subCtx(url) {
  const title = (subNameCache.get(url) || '').trim();
  const code = subExtractCode(title);
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
    const r = await reqRaw('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
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
  const r = await reqRaw('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
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
    const pr = await reqRaw('https://subtitlecat.com/' + p, { 'User-Agent': UA, Referer: 'https://subtitlecat.com/' }, 4000);
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
