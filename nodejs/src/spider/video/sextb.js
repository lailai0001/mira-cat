import req from '../../util/req.js';

// SexTB (py_sextb)
// 站点: https://sextb.cc / https://sextb.net (JAV 在线站)
// 重要: .net 在部分国家被封锁，站点官方指定备用域名 sextb.cc（首页横幅原话
//       "Some countries have blocked our website, please use a backup domain name: SEXTB.CC")。
//       spider 做双域名 failover: .cc 优先、.net 回退，再失败走 jina reader 兜底。
//       两站结构完全一致。另有 Cloudflare WAF 拦机房 IP（25 字节 "Your request was blocked"）。
// 列表: / (最新) / /genre/{slug}/[/pg-N/]  tray-item 卡片
// 卡片: div.tray-item > a[href="/{code}"] > img.tray-item-thumbnail (封面取 data-src，src 是 default-cover 占位图)
// 详情: GET /{code}  filmId + 服务器列表 (button.btn-player.episode[data-source][data-id]，如 F4/SW/PM/DD/FL/US)
// 播放: 1) 详情页默认 iframe 即 F4 服务器 (f4scdn.com/e/{id})；
//       2) f4 系 embed 页 data-api -> GET {host}/api/play/{vid}?ab=0 (带 Origin 头) -> src playlist.txt 主播放列表；
//       3) 其他服务器 POST /ajax/player {episode: episode_id, filmId} -> JSON.player HTML -> embed；
//       4) 解不出的 embed 走 parse:1 嗅探。play 实时在用户手机上解析，token 按用户 IP 签发。
// 实测根因 (2026-10-20 VM 验证): f4 CDN 的 playlist.txt、子播放列表、每个分片
//       请求都必须带 Origin: {embed host} 才能 200，否则 403（仅 UA 无头 → 403；
//       无 UA → 404；Referer 也救不了）。iOS 播放器无法自行补 Origin（被禁止
//       自定义），所以 play 返回的 m3u8 直链在端内播不了。
// 修复: play 返回本地代理地址 /proxy/m3u8，由代理请求源站时补齐
//       Origin/Referer，把改写后的播放列表返回给播放器；子播放列表继续走
//       /proxy/m3u8 递归改写，分片/密钥经 /proxy/res 二进制透传。
//       代理失败时 302 降级到原始地址（与之前直连行为一致）。
//       先例: avhub.js / javmobile.js 的同名代理路由。

const KEY = 'py_sextb';
const NAME = 'SexTB';
const HOSTS = ['https://sextb.cc', 'https://sextb.net'];
const SITE = HOSTS[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 核心分类 + 精选题材 (2026-10-20 从 /genres 页实测存在，两域名通用)
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'censored', type_name: '有码', slug: 'censored' },
  { type_id: 'uncensored', type_name: '无码', slug: 'uncensored-dc02d84q' },
  { type_id: 'amateur', type_name: '素人', slug: 'amateur-9yvovjqr' },
  { type_id: 'subtitle', type_name: '中文字幕', slug: 'subtitle' },
  { type_id: 'uncensored-leaked', type_name: '无码流出', slug: 'uncensored-leaked-8iodxgmu' },
  { type_id: 'reducing-mosaic', type_name: '减码', slug: 'reducing-mosaic-o16ol1qy' },
  { type_id: 'english-subtitle', type_name: '英字幕', slug: 'english-subtitle-8rpwhwew' },
  { type_id: 'digital-mosaic', type_name: '数码有码', slug: 'digital-mosaic-merf7vyh' },
  { type_id: 'minimal-mosaic', type_name: '低马赛克', slug: 'minimal-mosaic-csskw5dg' },
  { type_id: 'big-tits', type_name: '巨乳', slug: 'big-tits-hipx7w77' },
  { type_id: 'creampie', type_name: '中出', slug: 'creampie-dkel1ugw' },
  { type_id: 'blowjob', type_name: '口交', slug: 'blowjob-6w43evzo' },
  { type_id: 'school-girl', type_name: '学生', slug: 'school-girl-aze0q30d' },
  { type_id: 'milf', type_name: '熟女', slug: 'milf-k01m582n' },
  { type_id: 'mature-woman', type_name: '成熟女性', slug: 'mature-woman-pj7rh291' },
  { type_id: 'lesbian', type_name: '蕾丝', slug: 'lesbian-9akyznh5' },
  { type_id: 'nurse', type_name: '护士', slug: 'nurse-kor7sr6n' },
  { type_id: 'office-lady', type_name: 'OL', slug: 'office-lady-pjv31x9c' },
  { type_id: 'threesome', type_name: '3P4P', slug: 'threesome--foursome-3r7836if' },
  { type_id: 'cosplay', type_name: 'Cosplay', slug: 'cosplay-d5rzeneh' },
  { type_id: 'voyeur', type_name: '偷拍', slug: 'voyeur-9thq5fr5' },
  { type_id: 'massage', type_name: '按摩', slug: 'massage-0ypm730h' },
  { type_id: 'bondage', type_name: '捆绑', slug: 'bondage-wywuaggb' },
  { type_id: 'squirting', type_name: '潮吹', slug: 'squirting-1t5r5wb9' },
  { type_id: 'maid', type_name: '女仆', slug: 'maid-vkrzm0oo' },
  { type_id: 'teen', type_name: '少女', slug: 'teen-gk3kz0pk' },
  { type_id: 'fc2', type_name: 'FC2', slug: 'fc2' },
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function fixUrl(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  if (/^https?:\/\//.test(u)) return u;
  return SITE + '/' + u;
}

// 判断返回内容是否为拦截/验证页 (Cloudflare WAF 拦截、托管挑战等)
// 注意: 正常页面 head 里也含 challenges.cloudflare.com 的 CF 注入脚本，不能用它判定，
// 只认拦截页特有的文案与标题
function isBlockedPage(html) {
  if (!html || typeof html !== 'string') return true;
  if (html.length < 500) return true;
  const head = html.slice(0, 3000);
  if (/Your request was blocked/i.test(head)) return true;
  if (/<title>[^<]*(Just a moment|Attention Required)/i.test(head)) return true;
  if (/Performing security verification/i.test(head)) return true;
  if (/Sorry, you have been blocked/i.test(head)) return true;
  return false;
}

// 把任意本站 URL 拆成 path，候选域名按 [原域名, .cc, .net] 排序
function hostOrder(url) {
  const order = [];
  const m = t(url).match(/^https?:\/\/([^/]+)/i);
  if (m) {
    const h = 'https://' + m[1].toLowerCase();
    if (HOSTS.includes(h)) order.push(h);
  }
  for (const h of HOSTS) if (!order.includes(h)) order.push(h);
  return order;
}

function pathOf(url) {
  const u = t(url);
  const m = u.match(/^https?:\/\/[^/]+(\/.*)$/i);
  if (m) return m[1];
  return u.startsWith('/') ? u : '/' + u;
}

// 带超时的原生 fetch 取文本
async function timedFetchText(url, headers, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 25000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// 单次取页面 (req 通道 + fetch 通道)，命中拦截页视为失败
async function rawGet(url, headers, timeoutMs) {
  const to = timeoutMs || 25000;
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers, timeout: to });
    if (status === 200 && typeof data === 'string' && !isBlockedPage(data)) return data;
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  const txt = await timedFetchText(url, headers, to);
  if (txt && !isBlockedPage(txt)) return txt;
  return '';
}

function pageHeaders(referer, extraHeaders) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Referer': referer || REFERER,
    ...(extraHeaders || {}),
  };
}

// 兜底通道: jina reader 取原始 HTML (直连全失败时使用)
async function fetchViaJina(host, path) {
  const jinaUrl = 'https://r.jina.ai/' + host + path;
  const headers = {
    'User-Agent': UA,
    'x-respond-with': 'html',
  };
  try {
    const { data, status } = await req.get(jinaUrl, { headers, timeout: 40000 });
    if (status === 200 && typeof data === 'string' && !isBlockedPage(data)) {
      if (data.includes('tray-item') || data.length > 5000) return data;
    }
  } catch (e) { /* 换 fetch */ }
  const txt = await timedFetchText(jinaUrl, headers, 40000);
  if (txt && !isBlockedPage(txt) && txt.length > 5000) return txt;
  return '';
}

// 多域名 failover 取页面: 逐个域名直连，全失败再逐个域名走 jina 兜底
// 注意: 非本站 URL (如 f4scdn embed 页) 不做域名替换，直接原 URL 请求
async function getHtml(url, extraHeaders) {
  const m = t(url).match(/^https?:\/\/([^/]+)/i);
  const host = m ? m[1].toLowerCase() : '';
  if (!/sextb\.(net|cc)$/.test(host)) {
    return rawGet(url, pageHeaders(m ? 'https://' + host + '/' : REFERER, extraHeaders));
  }
  const path = pathOf(url);
  const hosts = hostOrder(url);
  for (const h of hosts) {
    const html = await rawGet(h + path, pageHeaders(h + '/', extraHeaders));
    if (html) return html;
  }
  for (const h of hosts) {
    const html = await fetchViaJina(h, path);
    if (html) return html;
  }
  return '';
}

async function postJson(url, body, extraHeaders) {
  const path = pathOf(url);
  const hosts = hostOrder(url);
  const data = new URLSearchParams(body).toString();
  for (const host of hosts) {
    const headers = {
      'User-Agent': UA,
      'Referer': host + '/',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      ...(extraHeaders || {}),
    };
    // 若调用方给了 Referer (详情页)，换成当前域名同路径
    if (headers.Referer && /sextb\.(net|cc)/i.test(headers.Referer) && !headers.Referer.startsWith(host)) {
      headers.Referer = host + pathOf(headers.Referer);
    }
    const full = host + path;
    // 通道1: 框架 req
    try {
      const { data: res, status } = await req.post(full, data, { headers, timeout: 25000 });
      if (status === 200 && res != null) {
        const s = typeof res === 'string' ? res : JSON.stringify(res);
        if (s && !isBlockedPage(s)) return s;
      }
    } catch (e) { /* 换通道2 */ }
    // 通道2: 原生 fetch (带超时)
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(full, { method: 'POST', headers, body: data, signal: ctl.signal });
      if (r.ok) {
        const txt = await r.text();
        if (txt && !isBlockedPage(txt)) return txt;
      }
    } catch (e) { /* ignore */ } finally { clearTimeout(to); }
  }
  return '';
}

// 解析视频卡片: div.tray-item > a[href="/{code}"] > img.tray-item-thumbnail
// 注意: 1) 站点懒加载，真实封面在 data-src，src 是 default-cover.jpg 占位图；
//       2) 卡片 class 带修饰时 (如 "tray-item tray-item-uncensored") 也要匹配，
//          但 tray-item-trailer 预告片块与 tray-item-* 子元素要排除；
//       3) href 域名兼容 .net/.cc。
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<div class="tray-item(?:\s[^"]*)?">\s*<a\s[^>]*href="(?:https?:\/\/sextb\.(?:net|cc))?(\/[a-z0-9][a-z0-9\-]{3,40})"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const win = html.slice(m.index, m.index + 2500);
    // 标题: img alt 属性
    let title = '';
    const altM = win.match(/<img[^>]+alt="([^"]+)"/);
    if (altM) title = clean(altM[1]);
    // 封面: 优先 data-src (懒加载真实地址)
    let pic = '';
    const dsM = win.match(/data-src="(https?:\/\/[^"]+)"/) || win.match(/data-src="(\/\/[^"]+)"/);
    if (dsM && !dsM[1].includes('default-cover')) pic = fixUrl(dsM[1]);
    if (!pic) {
      const srcM = win.match(/<img[^>]+src="(https?:\/\/[^"]+)"/) || win.match(/<img[^>]+src="(\/\/[^"]+)"/);
      if (srcM && !srcM[1].includes('default-cover')) pic = fixUrl(srcM[1]);
    }
    // 番号: div.tray-item-code
    let code = '';
    const cdM = win.match(/tray-item-code">([^<]+)</);
    if (cdM) code = clean(cdM[1]);
    out.push({
      vod_id: fixUrl(path),
      vod_name: title || code || path.replace(/^\//, ''),
      vod_pic: pic,
      vod_remarks: code,
    });
  }
  return out;
}

function parsePagecount(html) {
  const nums = [...html.matchAll(/\/pg-(\d+)/g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
  return nums.length ? Math.max(...nums) : 1;
}

function catOf(tid) {
  return CATS.find(c => c.type_id === tid) || CATS[0];
}

function catUrl(cat, page) {
  if (cat.type_id === 'latest') {
    return page > 1 ? `${SITE}/pg-${page}` : SITE + '/';
  }
  const slug = cat.slug || cat.type_id;
  if (/^https?:\/\//.test(slug)) return slug;
  const base = slug.includes('/') ? `${SITE}/${slug}` : `${SITE}/genre/${slug}`;
  return page > 1 ? `${base}/pg-${page}` : base;
}

function buildList(url, page, limit) {
  limit = limit || 30;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    const pc = parsePagecount(html);
    return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
  });
}

// ---------- 本地 HLS 代理 (f4 CDN 必须 Origin 才能 200, 播放器端无法补头) ----------

// base64url 编码/解码 (供代理 URL 的 query 参数)
function b64url(s) {
  try {
    return Buffer.from(String(s), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (e) { return ''; }
}

function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// 构造本地代理地址 (js2p://_WEB_ 为 App 动态地址 scheme, 同 avhub/javmobile/ffm3u8 先例)
function proxyUrl(reqIn, path, targetUrl, referer, origin) {
  try {
    const server = reqIn?.server;
    const dynamic = server?.address?.()?.dynamic || 'js2p://_WEB_';
    const prefix = server?.prefix || ('/spider/' + KEY + '/3');
    return `${dynamic}${prefix}${path}?u=${b64url(targetUrl)}&r=${b64url(referer || '')}&o=${b64url(origin || '')}`;
  } catch (e) { return ''; }
}

function absUrl(u, base) {
  try { return new URL(u, base).toString(); } catch (e) { return u; }
}

// 改写 m3u8: 子播放列表 (.txt/.m3u8) 继续走 /proxy/m3u8 递归改写,
// 分片与 URI="..." (密钥/初始化段) 走 /proxy/res 二进制透传
function rewriteM3u8(raw, m3u8Url, reqIn, referer, origin) {
  const lines = String(raw).split(/\r?\n/);
  const out = lines.map(line => {
    const s = line.trim();
    if (!s) return line;
    if (s.startsWith('#')) {
      if (s.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (all, uri) => {
          const abs = absUrl(uri.replace(/&amp;/g, '&'), m3u8Url);
          const p = proxyUrl(reqIn, '/proxy/res', abs, referer, origin);
          return p ? `URI="${p}"` : all;
        });
      }
      return line;
    }
    const abs = absUrl(s.replace(/&amp;/g, '&'), m3u8Url);
    const isPlaylist = /\.(m3u8|txt)(\?|$)/i.test(abs);
    const p = proxyUrl(reqIn, isPlaylist ? '/proxy/m3u8' : '/proxy/res', abs, referer, origin);
    return p || line;
  });
  return out.join('\n');
}

async function fetchText(url, headers) {
  try {
    const { data, status } = await req.get(url, { headers, timeout: 20000 });
    if (status === 200 && data) return typeof data === 'string' ? data : String(data);
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) return await r.text();
  } catch (e) { /* ignore */ }
  return '';
}

async function fetchBuffer(url, headers) {
  try {
    const { data, status } = await req.get(url, { headers, timeout: 30000, responseType: 'arraybuffer' });
    if (status === 200 && data) return Buffer.from(data);
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
  } catch (e) { /* ignore */ }
  return null;
}

// GET /proxy/m3u8?u={b64url 播放列表}&r={b64url referer}&o={b64url origin}
async function m3u8Proxy(request, reply) {
  const q = request?.query || {};
  if (!q.u) { reply.code(400).send('missing u'); return; }
  let target = '', referer = REFERER, origin = '';
  try {
    target = unb64url(q.u);
    if (q.r) referer = unb64url(q.r) || referer;
    if (q.o) origin = unb64url(q.o);
  } catch (e) { reply.code(400).send('bad u'); return; }
  if (!/^https?:\/\//.test(target)) { reply.code(400).send('bad u'); return; }
  // f4 CDN 全链路必须带 Origin: {embed host}，否则 403
  const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': referer };
  if (origin) headers['Origin'] = origin;
  const raw = await fetchText(target, headers);
  if (!raw || !raw.includes('#EXTM3U')) {
    // 降级: 302 重定向到原始地址 (与直连行为一致)
    reply.redirect(target);
    return;
  }
  reply.header('Content-Type', 'application/vnd.apple.mpegurl');
  reply.header('Cache-Control', 'no-cache');
  reply.send(rewriteM3u8(raw, target, request, referer, origin));
}

// GET /proxy/res?u={b64url 资源}&r={b64url referer}&o={b64url origin} —— 分片/密钥二进制透传
async function resProxy(request, reply) {
  const q = request?.query || {};
  if (!q.u) { reply.code(400).send('missing u'); return; }
  let target = '', referer = REFERER, origin = '';
  try {
    target = unb64url(q.u);
    if (q.r) referer = unb64url(q.r) || referer;
    if (q.o) origin = unb64url(q.o);
  } catch (e) { reply.code(400).send('bad u'); return; }
  if (!/^https?:\/\//.test(target)) { reply.code(400).send('bad u'); return; }
  const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': referer };
  if (origin) headers['Origin'] = origin;
  const buf = await fetchBuffer(target, headers);
  if (!buf) {
    reply.redirect(target);
    return;
  }
  // 按后缀给合理 Content-Type: f4 分片伪装成 .png/.jpg/.jpeg/.webp, 实为 TS 流，
  // iOS AVPlayer 系按 video/mp2t 更稳 (同 蜜桃 REX 分片强制 mp2t 先例)
  const ct = /\.(m3u8|txt)(\?|$)/i.test(target) ? 'application/vnd.apple.mpegurl'
    : /\.(ts|png|jpg|jpeg|webp|bin)(\?|$)/i.test(target) ? 'video/mp2t'
    : 'application/octet-stream';
  reply.header('Content-Type', ct);
  reply.header('Cache-Control', 'no-cache');
  reply.send(buf);
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(SITE + '/');
  const list = html ? parseCards(html).slice(0, 30) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = catOf(tid);
  return buildList(catUrl(cat, page), page, 30);
}

// 从详情页提取 filmId 和服务器 (episode) 列表
function extractPlayerInfo(html) {
  let filmId = '';
  const fm = html.match(/filmId\s*=\s*["']?(\d+)/);
  if (fm) filmId = fm[1];
  const episodes = [];
  const re = /<button[^>]*class="[^"]*btn-player episode[^"]*"[^>]*data-source="(\d+)"[^>]*data-id="(\d+)"[^>]*>(?:<i[^>]*><\/i>)?\s*([A-Z0-9]+)</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    episodes.push({ filmId: m[1], episode: m[2], name: m[3] });
  }
  return { filmId, episodes };
}

// 从详情页提取默认 player iframe
function extractDefaultEmbed(html) {
  const m = html.match(/id="sextb-player"[\s\S]{0,500}?<iframe[^>]+src="(https?:\/\/[^"]+)"/) ||
            html.match(/id="sextb-player"[\s\S]{0,500}?<iframe[^>]+src="(\/\/[^"]+)"/);
  return m ? fixUrl(m[1]) : '';
}

// 解析 f4 系 embed: embed 页 data-video-id -> {host}/api/play/{vid}?ab=0 -> src (m3u8)
async function resolveF4(embedUrl, durl) {
  const html = await getHtml(embedUrl, { 'Referer': durl });
  if (!html) return '';
  const vm = html.match(/data-video-id="([^"]+)"/);
  const am = html.match(/data-api="([^"]+)"/);
  if (!vm || !am) return '';
  const hostM = embedUrl.match(/^(https?:\/\/[^/]+)/);
  if (!hostM) return '';
  const apiUrl = hostM[1] + am[1] + (am[1].includes('?') ? '&' : '?') + 'ab=0';
  const host = hostM[1];
  let src = '';
  const headers = {
    'User-Agent': UA,
    'Referer': embedUrl,
    'Origin': host,
    'Accept': 'application/json, text/javascript, */*; q=0.01',
  };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(apiUrl, { headers, timeout: 25000 });
    if (status === 200 && data) {
      const json = typeof data === 'string' ? JSON.parse(data) : data;
      if (json && json.src) src = t(json.src);
    }
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  if (!src) {
    try {
      const r = await fetch(apiUrl, { headers });
      if (r.ok) {
        const json = await r.json();
        if (json && json.src) src = t(json.src);
      }
    } catch (e) { /* ignore */ }
  }
  if (!src) return '';
  if (!/^https?:\/\//.test(src)) src = host + (src.startsWith('/') ? src : '/' + src);
  return { url: src, origin: host, embed: embedUrl };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  // 标题
  let name = '';
  const tm = html.match(/<title>([^<]*)<\/title>/);
  if (tm) name = clean(tm[1]).replace(/\s*-\s*SEXTB.*$/i, '').replace(/Free JAV.*$/i, '').trim();
  // 封面: 优先页面内的 webp poster (cdn001.imggle.net 公开 CDN，直读 200)，
  // 其次 video 标签 poster，再 og:image
  let pic = '';
  const wm = html.match(/data-src="(https?:\/\/cdn001\.imggle\.net\/webp\/poster[^"]+)"/);
  if (wm) pic = wm[1];
  if (!pic) {
    const vm = html.match(/<video[^>]+poster="(https?:\/\/[^"]+)"/);
    if (vm) pic = vm[1];
  }
  if (!pic) {
    const ogm = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogm) pic = ogm[1];
  }

  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: fixUrl(pic),
      vod_remarks: '',
      vod_content: name,
      vod_play_from: 'SexTB',
      vod_play_url: `正片$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "正片$https://..." 形式，取 $ 后面的完整 URL
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Origin': 'https://f4scdn.com' } };
  }
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  // 第1步: 抓详情页，拿默认 embed iframe（通常是 F4/f4scdn）
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const embedUrl = extractDefaultEmbed(html);

  if (embedUrl) {
    // f4 系 (f4scdn.com / f4jav.xyz): 解析 api/play 拿 playlist 直链。
    // CDN 全链路要求 Origin (实测无头 403)，播放器端补不了头: 走本地代理，
    // 代理请求时补齐 Origin/Referer 并改写播放列表 (见 m3u8Proxy/resProxy)。
    if (/f4scdn\.com|f4jav\.xyz/i.test(embedUrl)) {
      const res = await resolveF4(embedUrl, durl);
      if (res && /\.m3u8|\.txt/i.test(res.url)) {
        const purl = proxyUrl(reqIn, '/proxy/m3u8', res.url, embedUrl, res.origin);
        return {
          parse: 0,
          url: purl || res.url,
          header: { 'User-Agent': UA, 'Referer': embedUrl, 'Origin': res.origin },
        };
      }
    }
  }

  // 第2步: 逐个服务器 POST /ajax/player 拿 player HTML，找可解的 embed
  const { filmId, episodes } = extractPlayerInfo(html);
  if (filmId && episodes.length) {
    for (const ep of episodes) {
      const resp = await postJson(SITE + '/ajax/player', { episode: ep.episode, filmId }, { 'Referer': durl });
      if (!resp) continue;
      let playerHtml = '';
      try {
        const json = JSON.parse(resp);
        playerHtml = t(json.player);
      } catch (e) { continue; }
      const em = playerHtml.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/) ||
                 playerHtml.match(/<iframe[^>]+src="(\/\/[^"]+)"/);
      if (!em) continue;
      const eu = fixUrl(em[1]);
      if (/f4scdn\.com|f4jav\.xyz/i.test(eu)) {
        const res = await resolveF4(eu, durl);
        if (res && /\.m3u8|\.txt/i.test(res.url)) {
          const purl = proxyUrl(reqIn, '/proxy/m3u8', res.url, eu, res.origin);
          return {
            parse: 0,
            url: purl || res.url,
            header: { 'User-Agent': UA, 'Referer': eu, 'Origin': res.origin },
          };
        }
      }
      // 其他 embed (SW/PM/DD/FL/US 等): 交给嗅探
      if (/^https?:\/\//.test(eu)) {
        return { parse: 1, jx: 0, url: eu, header: { 'User-Agent': UA, 'Referer': durl } };
      }
    }
  }

  // 第3步: 兜底，嗅探默认 embed 页
  if (embedUrl && /^https?:\/\//.test(embedUrl)) {
    return { parse: 1, jx: 0, url: embedUrl, header: { 'User-Agent': UA, 'Referer': durl } };
  }
  return { parse: 0, url: '' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  let url = SITE + '/search/' + encodeURIComponent(wd);
  if (page > 1) url += '/pg-' + page;
  return buildList(url, page, 30);
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
      // HLS 本地代理 (GET): f4 CDN 要求 Origin 播放器端无法设置, 代理补头透传
      fastify.get('/proxy/m3u8', m3u8Proxy);
      fastify.get('/proxy/res', resProxy);
    },
  };
}
