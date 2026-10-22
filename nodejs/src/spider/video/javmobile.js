import req from '../../util/req.js';

// JavMobile (py_javmobile)
// 站点: https://javmobile.net/ (WordPress JAV 站，无反爬)
// 列表: GET /{cat}/[/page/N/]  30 条/页
// 搜索: GET /?s={kw}[/page/N/]  30 条/页
// 详情: GET /{slug}/  内联 JS var SOURCES = [upload18, audinifer]
// 播放: Server1 upload18.org -> window.PLAYER_CONFIG.m3u8 (helvid.com 直链, parse:0)
//       兜底 Server2 audinifer.com -> 解 pack 混淆 JS 取 m3u8

const KEY = 'py_javmobile';
const NAME = 'JavMobile';
const SITE = 'https://javmobile.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// 手机 UA：helvid 的 token 按设备签发 (d=apple/d=chromium)，用手机 UA 取 token
// 才能保证用户手机端（MiraPlayer 原生 UA）请求分片不 404
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const REFERER = SITE + '/';

// 8 个真实分类 (2026-10-20 从首页导航实测)
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'censored', type_name: '有码' },
  { type_id: 'uncensored', type_name: '无码' },
  { type_id: 'uncensored-leaked', type_name: '破解无码' },
  { type_id: 'chinese-av', type_name: '国产' },
  { type_id: 'amateur', type_name: '素人' },
  { type_id: 'english-subtitle', type_name: '英字' },
  { type_id: 'actresses', type_name: '女优' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function fixUrl(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return u;
}

// 双通道: 先框架 req，失败再原生 fetch
// ua: 覆盖默认 UA（取 helvid token 时必须用手机 UA，否则签出的 d=chromium token 在手机端分片 404）
async function getHtml(url, referer, ua) {
  const headers = {
    'User-Agent': ua || UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
    'Referer': referer || REFERER,
  };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 解析列表卡片: article.loop-post > a[href] > h2.entry-title + img[src]
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<article\s[^>]*class="[^"]*loop-post[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const card = m[1];
    const am = card.match(/<a\s[^>]*href="(https?:\/\/javmobile\.net\/[^"]+\/)"/);
    if (!am) continue;
    const durl = am[1];
    if (seen.has(durl)) continue;
    seen.add(durl);
    let title = '';
    const tm = card.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/);
    if (tm) title = clean(tm[1]);
    let pic = '';
    const im = card.match(/<img[^>]+src="([^"]+)"/);
    if (im) pic = fixUrl(im[1]);
    out.push({
      vod_id: durl,
      vod_name: title || durl.split('/').filter(Boolean).pop(),
      vod_pic: pic,
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  // 取最大的 /page/N/ 数字
  let max = 1;
  const re = /\/page\/(\d+)\//g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max && n < 1000000) max = n;
  }
  return max;
}

async function buildList(url, page, limit, tid) {
  limit = limit || 30;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  let pc = parsePagecount(html);
  // 最新：首页无翻页链接，且各页 HTML 里解析出的 pagecount 会随当前页码波动
  // （如第2页只能看到 /page/2/，pagecount 就变成 2），导致 App 误判已到最后一页。
  // 实测 /page/100/ 仍有 30 条，固定给 100。
  if (tid === 'latest' && list.length > 0) pc = 100;
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

function catUrl(tid, page) {
  let base;
  if (tid === 'latest' || !tid) base = SITE + '/';
  else base = SITE + '/' + tid + '/';
  if (page > 1) base += 'page/' + page + '/';
  return base;
}

// 从详情页提取 SOURCES 数组
function extractSources(html) {
  const m = html.match(/var\s+SOURCES\s*=\s*\[(.*?)\];/s);
  if (!m) return [];
  const urls = [];
  const re = /"(https?:\\?\/\\?\/[^"]+)"/g;
  let x;
  while ((x = re.exec(m[1])) !== null) {
    urls.push(x[1].replace(/\\\//g, '/'));
  }
  return urls;
}

// Server1: upload18 播放页 -> window.PLAYER_CONFIG.m3u8 (带1次重试, 站方偶发 chunked 截断)
// 注意: 必须用手机 UA 请求，helvid 按 UA 签发 token (d=apple)；用桌面 UA 签出的
// d=chromium token 在手机端请求分片会 404，导致播不全/无法快进
async function resolveUpload18(embedUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const html = await getHtml(embedUrl, REFERER, MOBILE_UA);
    if (!html || !html.includes('window.PLAYER_CONFIG')) continue;
    const m = html.match(/window\.PLAYER_CONFIG\s*=\s*(\{.*?\});/s);
    if (!m) continue;
    try {
      const cfg = JSON.parse(m[1]);
      const url = t(cfg.m3u8).replace(/\\\//g, '/');
      // 注意: helvid 的 m3u8 路径是 base64, 字面量无 .m3u8, 用域名+路径特征判断
      if (/^https?:\/\/[^/]*helvid\.com\/m\//.test(url)) return url;
      if (/^https?:\/\//.test(url) && url.includes('.m3u8')) return url;
    } catch (e) { /* ignore */ }
  }
  return '';
}

// Server2: audinifer embed 页 -> 解 pack 混淆 JS 取 m3u8
// 注意: 站方 packer 用单引号包裹 payload: }('PAYLOAD',36,497,'SYMTAB'.split('|')))
function unpackAudinifer(html) {
  const m = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)\)/);
  if (!m) return '';
  let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = m[4].split('|');
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const tok = (n) => {
    let s = '';
    while (n > 0) { s = chars[n % a] + s; n = Math.floor(n / a); }
    return s || '0';
  };
  for (let i = c - 1; i >= 0; i--) {
    if (k[i]) {
      const re = new RegExp('\\b' + tok(i) + '\\b', 'g');
      p = p.replace(re, k[i]);
    }
  }
  const um = p.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
  return um ? um[0] : '';
}

// m3u8 代理改写: helvid 原始 m3u8 有三个兼容性问题，可能导致 MiraPlayer
// (iOS AVPlayer 系) 播放不从头、无法快进后退:
//   1) #EXT-X-MEDIA-SEQUENCE:1 (VOD 标准应从 0 开始, AVPlayer 计算 seekable
//      范围/起始位置时会因此偏移, 表现为跳过开头、无法 seek 回开头)
//   2) #U18-CANARY:... 非标准行 (金丝雀检测行, 部分播放器解析受影响)
//   3) #EXT-X-ALLOW-CACHE:YES 非标准标签
// 播放时经本地 spider 代理下载原始 m3u8 并改写后再返回给播放器,
// 分片 URL 本身是带签名的绝对地址, 保持原样由播放器直连 helvid。
function fixM3u8(txt) {
  let out = String(txt || '');
  out = out.replace(/^#U18-CANARY:.*$/gm, '');
  out = out.replace(/^#EXT-X-ALLOW-CACHE:.*$/gm, '');
  out = out.replace(/^#EXT-X-MEDIA-SEQUENCE:\s*\d+\s*$/gm, '#EXT-X-MEDIA-SEQUENCE:0');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

async function m3u8Proxy(request, reply) {
  const q = request?.query || {};
  const u = String(q.u || '');
  const r = String(q.r || '');
  if (!u) { reply.code(400).send('missing u'); return; }
  let m3u8Url = '';
  let referer = REFERER;
  try {
    m3u8Url = Buffer.from(u.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    if (r) referer = Buffer.from(r.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) { reply.code(400).send('bad u'); return; }
  if (!/^https?:\/\//.test(m3u8Url)) { reply.code(400).send('bad u'); return; }
  const headers = {
    'User-Agent': MOBILE_UA,
    'Accept': '*/*',
    'Referer': referer,
  };
  let raw = '';
  try {
    const { data, status } = await req.get(m3u8Url, { headers, timeout: 20000 });
    if (status === 200 && data) raw = typeof data === 'string' ? data : String(data);
  } catch (e) { /* 换通道2 */ }
  if (!raw) {
    try {
      const resp = await fetch(m3u8Url, { headers });
      if (resp.ok) raw = await resp.text();
    } catch (e) { /* ignore */ }
  }
  if (!raw || !raw.includes('#EXTM3U')) {
    // 降级：302 重定向到原始 m3u8（和之前直连行为一致）
    reply.redirect(m3u8Url);
    return;
  }
  reply.header('Content-Type', 'application/vnd.apple.mpegurl');
  reply.header('Cache-Control', 'no-cache');
  reply.send(fixM3u8(raw));
}

// base64url 编码 (供代理 URL 的 query 参数)
function b64url(s) {
  try {
    return Buffer.from(String(s), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (e) { return ''; }
}

// 构造本地 m3u8 代理地址 (js2p://_WEB_ 为 App 动态地址 scheme, 同 ffm3u8 先例)
function proxyM3u8Url(reqIn, m3u8Url, referer) {
  try {
    const server = reqIn?.server;
    const dynamic = server?.address?.()?.dynamic || 'js2p://_WEB_';
    const prefix = server?.prefix || ('/spider/' + KEY + '/3');
    return `${dynamic}${prefix}/proxy/m3u8?u=${b64url(m3u8Url)}&r=${b64url(referer || '')}`;
  } catch (e) { return ''; }
}

async function resolveAudinifer(embedUrl) {
  const html = await getHtml(embedUrl, REFERER);
  if (!html) return '';
  return unpackAudinifer(html);
}

// 解析播放地址 (实时解析, token 时效约 30 分钟)
// 返回 { url, parse, referer }: referer 必须与取源站点一致,
// helvid.com 会 403 掉 Referer 为 javmobile.net 的请求, 必须用 upload18.org
async function resolvePlay(durl) {
  const html = await getHtml(durl);
  if (!html) return { url: '', parse: 0, referer: '' };
  const sources = extractSources(html);
  // 优先 Server1 (upload18, 直链 m3u8)
  for (const s of sources) {
    if (/upload18\.org/i.test(s)) {
      const m3u8 = await resolveUpload18(s);
      if (m3u8) return { url: m3u8, parse: 0, referer: s };
    }
  }
  // 兜底 Server2 (audinifer, 解混淆)
  for (const s of sources) {
    if (/audinifer\.com/i.test(s)) {
      const m3u8 = await resolveAudinifer(s);
      if (m3u8) return { url: m3u8, parse: 0, referer: s };
      // 解不出来就返回 embed 页走嗅探
      return { url: s, parse: 1, referer: s };
    }
  }
  // 都没有则返回第一个源走嗅探
  if (sources.length) return { url: sources[0], parse: 1, referer: sources[0] };
  return { url: '', parse: 0, referer: '' };
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  return { class: cls, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  return buildList(catUrl(tid, page), page, 30, tid);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+|\/+$/g, '') + '/');

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const tm = html.match(/<h1 class="title">([\s\S]*?)<\/h1>/);
  if (tm) name = clean(tm[1]);
  if (!name) {
    const om = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (om) name = clean(om[1]);
  }
  if (!name) name = durl.split('/').filter(Boolean).pop();

  let pic = '';
  const pm = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (pm) pic = fixUrl(pm[1]);
  // 兜底: 海报 URL 可由 slug 推导 (upload18.cc/v/{大写SLUG}/poster.jpg, 与列表卡片一致)
  if (!pic || pic.includes('cropped-javmobile')) {
    const slug = durl.split('/').filter(Boolean).pop() || '';
    if (slug) pic = `https://upload18.cc/v/${slug.toUpperCase()}/poster.jpg`;
    else pic = '';
  }

  let desc = '';
  const dm = html.match(/<meta name="description" content="([^"]+)"/);
  if (dm) desc = clean(dm[1]);

  const vod = {
    vod_id: durl,
    vod_name: name,
    vod_pic: pic,
    vod_remarks: '',
    vod_content: desc || name,
    vod_play_from: 'JavMobile',
    vod_play_url: `正片$${durl}`,
  };
  subRegister(id, vod);
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+|\/+$/g, '') + '/');
  const subsP = subSearchAll(subNormKey(durl)).catch(() => []);

  const r = await resolvePlay(durl);
  if (!r.url) return { parse: 0, url: '' };
  // Referer 必须与视频源站点一致 (helvid 只认 upload18.org, 否则 403)
  // UA 必须用手机 UA：token 按设备签发 (d=apple)，与取 token 时的 UA 保持一致
  const referer = r.referer || REFERER;
  let url = r.url;
  // helvid 直链 m3u8 走本地代理改写 (修正 MEDIA-SEQUENCE 等兼容性问题,
  // 解决 iOS 端播放不从头、无法快进后退)。其他源保持直连。
  if (r.parse === 0 && /helvid\.com/.test(r.url)) {
    const purl = proxyM3u8Url(reqIn, r.url, referer);
    if (purl) url = purl;
  }
  return subAttach({
    parse: r.parse,
    url,
    header: { 'User-Agent': MOBILE_UA, 'Referer': referer },
  }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url = SITE + '/page/' + page + '/?s=' + encodeURIComponent(wd);
  return buildList(url, page, 30);
}

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

// ---------------- 字幕聚合 (Layer A 试点, 2026-10-22) ----------------
// 点播时按片名多源搜字幕, 候选以 TVBox 标准 subs 数组挂到 play
// 返回对象上 (播放器是否渲染由播放器决定, 蜘蛛只负责挂载)。
// 来源优先级 (用户钦定): 迅雷 > 迅雷看看 > SubtitleCat > SubHD
// > 射手。实探结论 (报告 castbank/REPORT_subtitle_pilot.md):
// 「迅雷」与「迅雷看看」是同一个 oracle 接口 (api-shoulei-ssl.
// xunlei.com, 按名搜、结果即 .srt 直链), 实现合并为一源占首档;
// SubHD 搜索与 prepare 通但 /down/ 被站方门控 (VM 出口实测 403
// 「下载页面已失效」)、射手 assrt.net 源站经 CF 522 不可达 —
// 两源本轮不接入 (不挂未验证链路)。全程 req 主栈 (subHttp),
// 每源独立超时、总预算 6s、与 resolveLines 并行, 失败全静默;
// 无结果时 play 返回对象不带 subs 键, 与未接入前逐字段一致。
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

function subKeys(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const keys = [];
  if (code) keys.push(code);
  if (title && title !== code) keys.push(title);
  if (code && title) {
    const tp = title.replace(new RegExp(code.replace(/-/g, '[- ]?'), 'i'), '').replace(/^[\s\-_:]+|[\s\-_:]+$/g, '').trim();
    if (tp && tp.length >= 3) keys.push(code + ' ' + tp);
  }
  return [...new Set(keys)].filter((k) => k.length >= 2).slice(0, 3);
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

// 迅雷看看 (兼「迅雷」位, 同一 oracle 接口): 按名搜, 结果即直链。
// 前 2 个键并行查, 每键返回即入 bag (不互相等候 — 慢键不能扣住
// 快键的结果), 最终由 subMerge 按档位/语言/番号命中/热度排序。
async function subFromXunlei(keys, code, bag) {
  await Promise.all(keys.slice(0, 2).map(async (key) => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 5000);
    if (r.status !== 200 || !r.body) return;
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return;
    for (const it of j.data) {
      if (!it) continue;
      const url = String(it.url || it.Url || '');
      if (!SUB_TEXT_RE.test(url)) continue; // 压缩包/非文本字幕剔除
      const nm = String(it.name || it.Name || '字幕');
      const langs = Array.isArray(it.languages) ? it.languages.join(',') : String(it.langs || it.Langs || '');
      const lang = subLangOf(nm, langs);
      const pop = (Number(it.down_count || it.DownCount || it.downloads || 0) || 0)
        + (Number(it.score || 0) || 0) + (Number(it.fingerprintf_score || it.fingerprint_score || 0) || 0);
      // 个别条目名是裸哈希 (不可读): 显示名换成番号字幕, 匹配/
      // 语言判定仍用原名
      const dispName = /^[0-9a-f]{24,}$/i.test(nm.trim()) ? (code ? code + ' 迅雷字幕' : '迅雷字幕') : nm;
      bag.push({
        src: '迅雷看看', tier: 0, name: dispName, url, lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop,
      });
    }
  }));
}

// SubtitleCat: 搜索页 -> 字幕页 -> 按语言分的 .srt 直链 (逐页入 bag)
async function subFromSubtitleCat(keys, code, bag) {
  const key = keys[0];
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
      const lang = subLangOf(nm, '');
      bag.push({
        src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop: 0,
      });
    }
  }));
}

// 合并排序: 来源档位 -> 语言 -> 番号命中 -> 热度; 按 url 与
// (语言|去扩展名文件名) 双键去重 (迅雷与 SubtitleCat 常有同源
// 同名文件、不同直链); 上限 10 条。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.codeHit - a.codeHit) || (b.pop - a.pop) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const seenName = new Set();
  const out = [];
  for (const it of sorted) {
    if (seenUrl.has(it.url)) continue;
    const nameKey = it.lang + '|' + it.name.toLowerCase().replace(/\.(srt|vtt|ass|ssa)$/i, '');
    if (seenName.has(nameKey)) continue;
    seenUrl.add(it.url);
    seenName.add(nameKey);
    const ext = (it.url.match(SUB_TEXT_RE) || [])[1].toLowerCase();
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: ext });
    if (out.length >= 10) break;
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const keys = subKeys(durl);
    let subs = [];
    if (keys.length) {
      const code = subExtractCode(subNameCache.get(durl) || '') || subExtractCode(String(durl || ''));
      const bag = [];
      const jobs = [
        subFromXunlei(keys, code, bag),
        subFromSubtitleCat(keys, code, bag),
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
      // m3u8 改写代理 (GET, 参考 ffm3u8 的 /proxy/hls 先例)
      fastify.get('/proxy/m3u8', m3u8Proxy);
    },
  };
}
