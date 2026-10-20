// JAVSB (https://jav.sb) -> CatPawOpen spider
// MacCMS/Madou 模板站: 列表卡片 div.thumbnail, 详情 og 标签 + 官方播放器 iframe。
// 播放: 官方链 token.php -> save_m3u8_cache.php 的 sign 由父页面 encrypt() 生成,
// 该函数不在任何可抓到的客户端资源里, 明文 sign 实测被源站回 "erro time";
// 故 play 先按官方链实试 (硬超时, 总耗时 <8s), 失败立即 parse:1 嗅探官方播放器页。
//
// 抓取通道 (2026-10-20 第五版): 真机上 App 内两种栈 (框架 req 桌面头 / 原生 fetch
// iOS 头) 抓本站页面全灭, 同机抓其他 CF 站正常、VM 内同代码全通 —— 拦截在
// "真机请求特征 x 本站 CF 区域规则"层, 且两栈在 App 内共用同一底层网络栈,
// 换头换栈都绕不过去。自有 Worker 中转也已实测判死 (本站 CF 专拦 Workers 出口,
// 回 Attention Required 页)。本版改为三层递进 + 粘性记忆 + 页面缓存:
//   L1 框架 req + 桌面头直连 (原通道; 在能直连的网络下是不限量的首选)
//   L2 r.jina.ai 公开抓取中转 (带 x-return-format: html 时返回原始 DOM,
//      与直连页面同构, 现有解析器可直接吃; 2026-10-20 实测分类/详情/搜索/
//      榜单/token 接口全部 200 且内容新鲜)
//   L3 原生 fetch + iOS Safari 头 (最后兜底)
// 粘性记忆: 记住上一层成功的是哪层, 下次先试它 (真机上首个页面付一次
// 全链试探成本, 之后直达 jina, 不再每页先撞 L1)。
// 页面缓存: 列表/搜索 120s、详情 300s —— jina 免费层约 20 次/分钟/IP,
// 缓存 + 粘性把正常浏览的 jina 调用压到很低, 也顺带加速翻页返回。
// 校验口径不变: 列表页必须含卡片标记, 拦截页/空壳 (解析 0 卡) 也算失败。
// 另带会话级 Cookie 罐: 任一层响应给了 Set-Cookie 就存下并回放 (仅直连层)。
import req from '../../util/req.js';

const KEY = 'py_javsb';
const NAME = 'JAVSB';
const HOST = 'https://jav.sb';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const REFERER = HOST + '/';
// L2 抓取中转: 公开服务 r.jina.ai, 目标 URL 直接拼在其后
const JINA = 'https://r.jina.ai/';

// 分类: type_id 为 javtype 的 Type slug; new/rank_* 为 label 页 (见 catUrl)
const CATS = [
  { type_id: 'new', type_name: '最近更新' },
  { type_id: 'Censored', type_name: '日本有码' },
  { type_id: 'Uncensored', type_name: '日本无码' },
  { type_id: 'FC2-PPV', type_name: 'FC2-PPV' },
  { type_id: 'Mosaic_Removed', type_name: '无码破解' },
  { type_id: 'CHN_SUB', type_name: '中文字幕' },
  { type_id: 'MGS', type_name: 'MGS' },
  { type_id: 'Adult_IDOL', type_name: '写真' },
  { type_id: 'Asian_Amateur', type_name: '国产' },
  { type_id: 'Western_Porn', type_name: '欧美' },
  { type_id: 'rank_hits', type_name: '热门影片' },
  { type_id: 'rank_score', type_name: '评分最高' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

// ---------- 会话 Cookie 罐 (仅直连 jav.sb 时回放) ----------
const cookieJar = new Map(); // host -> "k=v; k2=v2"

function jarStore(host, setCookies) {
  if (!setCookies) return;
  const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
  const cur = new Map();
  const old = cookieJar.get(host);
  if (old) for (const p of old.split('; ')) { const i = p.indexOf('='); if (i > 0) cur.set(p.slice(0, i), p.slice(i + 1)); }
  for (const sc of arr) {
    const first = String(sc || '').split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) cur.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  if (cur.size) cookieJar.set(host, [...cur.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
}

function jarHeader(host) {
  return cookieJar.get(host) || '';
}

// ---------- 请求头档案 ----------
function desktopHeaders(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Referer': referer || REFERER,
  };
}

function safariHeaders(referer) {
  return {
    'User-Agent': UA_IOS,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Referer': referer || REFERER,
  };
}

// ---------- 单次抓取 (三层) ----------
async function viaReq(url, headers, timeoutMs) {
  const host = new URL(url).host;
  const h = { ...headers };
  const ck = jarHeader(host);
  if (ck) h['Cookie'] = ck;
  const { data, status, headers: rh } = await req.get(url, { headers: h, timeout: timeoutMs });
  if (rh) jarStore(host, rh['set-cookie']);
  if (status && status !== 200) return '';
  if (data == null || data === '') return '';
  return typeof data === 'string' ? data : JSON.stringify(data);
}

async function viaFetch(url, headers, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const host = new URL(url).host;
    const h = { ...headers };
    const ck = jarHeader(host);
    if (ck) h['Cookie'] = ck;
    const r = await fetch(url, { headers: h, signal: ctl.signal, redirect: 'follow' });
    try {
      const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : r.headers.get('set-cookie');
      jarStore(host, sc);
    } catch (e) { /* 忽略 */ }
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// L2: r.jina.ai 中转。x-return-format: html 返回目标页原始 DOM (text/plain 承载),
// 与直连 HTML 同构; JSON 接口会被包进 <pre> 里, 由 parseJsonLoose 剥出。
async function viaJina(url, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(JINA + url, {
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'x-return-format': 'html' },
      signal: ctl.signal,
      redirect: 'follow',
    });
    if (!r.ok) return ''; // 含 429 限流: 本层失败, 由外层落其他层/空结果
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// ---------- 页面缓存 ----------
const pageCache = new Map(); // url -> { t, s }
const TTL_LIST = 120000;   // 列表/首页/搜索: 120s
const TTL_DETAIL = 300000; // 详情: 300s (play 紧跟 detail, 命中即省一次中转)

function cacheGet(url, ttl) {
  const e = pageCache.get(url);
  if (e && Date.now() - e.t < ttl) return e.s;
  return '';
}

function cacheSet(url, s) {
  pageCache.set(url, { t: Date.now(), s });
  if (pageCache.size > 80) pageCache.delete(pageCache.keys().next().value);
}

// ---------- 三层递进抓取 (粘性层记忆) ----------
// validate(txt) 通过才算拿到真内容; 全部层失败返回 ''。
// slices: 每层超时上限 (ms), 依次 [L1 req 直连, L2 jina 中转, L3 fetch]
// ttl: >0 时先查页面缓存、成功后写入缓存。
let goodLayer = -1;

async function getText(url, validate, slices, ttl) {
  const ok = typeof validate === 'function' ? validate : (s) => !!s;
  if (ttl) {
    const cached = cacheGet(url, ttl);
    if (cached && ok(cached)) return cached;
  }
  const [s1, s2, s3] = slices || [6000, 12000, 6000];
  const layers = [
    () => viaReq(url, desktopHeaders(), s1),
    () => viaJina(url, s2),
    () => viaFetch(url, safariHeaders(), s3),
  ];
  const order = goodLayer >= 0
    ? [goodLayer, ...[0, 1, 2].filter(i => i !== goodLayer)]
    : [0, 1, 2];
  for (const i of order) {
    try {
      const txt = await layers[i]();
      if (txt && ok(txt)) {
        goodLayer = i;
        if (ttl) cacheSet(url, txt);
        return txt;
      }
    } catch (e) { /* 下一层 */ }
  }
  return '';
}

// 列表页校验: 必须含真实卡片标记 (拦截页/空壳不含)
const isListPage = (s) => s.includes('<div class="thumbnail group">');
// 详情页校验: og 标题或官方播放器任一出现
const isDetailPage = (s) => s.includes('og:title') || s.includes('/static/player/');
// 搜索页校验: 有卡片最好; 无结果页也是真页面 (足够长且含站内标记) 一并接受, 避免空结果白等三层
const isSearchPage = (s) => isListPage(s) || (s.length > 3000 && s.includes('javtype'));

function getHtml(url, validate, ttl) {
  return getText(url, validate || isListPage, undefined, ttl == null ? TTL_LIST : ttl);
}

// ---------- JSON 宽松解析 (直连是裸 JSON, jina 会包 <pre>) ----------
function parseJsonLoose(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { /* 继续 */ }
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* 落空 */ } }
  return null;
}

// ---------- 列表解析 ----------

// 卡片: <div class="thumbnail group"> ... <a href="/jav/{slug}-1-1.html">
//   <img data-src="/upload/vod/*.jpg" alt="片名"> ... <span ...>时长</span>
// 按卡片起始标签切块解析, 每块窗口给足 4000 字符, 保证最后一张卡不丢。
// jina HTML 与直连 HTML 同构 (实测卡片字段逐一对齐), 同一解析器通用。
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const parts = String(html || '').split('<div class="thumbnail group">');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 4000);
    const hrefM = chunk.match(/href="(\/jav\/[^"]+\.html)"/);
    if (!hrefM) continue;
    const id = HOST + hrefM[1];
    if (seen.has(id)) continue;
    seen.add(id);
    let pic = '';
    const imgM = chunk.match(/<img[^>]+data-src="([^"]+)"/) || chunk.match(/<img[^>]+src="([^"]+)"/);
    if (imgM && !/loading\.png/i.test(imgM[1])) pic = absUrl(imgM[1]);
    let name = '';
    const altM = chunk.match(/<img[^>]+alt="([^"]*)"/);
    if (altM) name = clean(altM[1]);
    if (!name) {
      const tm = chunk.match(/class="text-secondary group-hover:text-primary"[^>]*>([^<]+)</);
      if (tm) name = clean(tm[1]);
    }
    let remarks = '';
    const dm = chunk.match(/bg-opacity-75">([^<]+)</);
    if (dm) remarks = clean(dm[1]);
    out.push({ vod_id: id, vod_name: name || hrefM[1], vod_pic: pic, vod_remarks: remarks });
  }
  return out;
}

// 从分页链接提取总页数
function pagecountOf(html, re) {
  const nums = [...String(html || '').matchAll(re)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 1000000);
  return nums.length ? Math.max(...nums) : 1;
}

function catUrl(cat, page) {
  const id = cat.type_id;
  if (id === 'new') {
    return page > 1 ? `${HOST}/label/new/by/time/page/${page}.html` : `${HOST}/label/new/by/time.html`;
  }
  if (id === 'rank_hits' || id === 'rank_score') {
    const by = id === 'rank_hits' ? 'hits_week' : 'score';
    return page > 1 ? `${HOST}/label/rank/by/${by}/page/${page}.html` : `${HOST}/label/rank/by/${by}.html`;
  }
  return page > 1 ? `${HOST}/javtype/${id}-${page}.html` : `${HOST}/javtype/${id}.html`;
}

function catPagecount(html, cat) {
  if (cat.type_id === 'new' || cat.type_id.startsWith('rank_')) {
    return pagecountOf(html, /\/page\/(\d+)\.html/g);
  }
  return pagecountOf(html, /\/javtype\/[A-Za-z0-9_-]+-(\d+)\.html/g);
}

// ---------- 接口 ----------

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(HOST + '/');
  const list = html ? parseCards(html).slice(0, 30) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'new';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATS.find(c => c.type_id === tid) || CATS[0];
  const html = await getHtml(catUrl(cat, page));
  if (!html) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const list = parseCards(html);
  const pc = catPagecount(html, cat);
  return { page, pagecount: Math.max(pc, page), limit: 12, total: list.length, list };
}

function og(html, prop) {
  const m = String(html || '').match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`));
  return m ? clean(m[1]) : '';
}

// 从详情页提取官方播放器 iframe 地址与 file hash
function extractPlayer(html) {
  const m = String(html || '').match(/src="(\/static\/player\/videojs\.html\?[^"]+)"/) ||
            String(html || '').match(/src="(https?:\/\/jav\.sb\/static\/player\/videojs\.html\?[^"]+)"/);
  if (!m) return { playerUrl: '', hash: '' };
  const playerUrl = absUrl(m[1].replace(/&amp;/g, '&'));
  const hm = playerUrl.match(/[?&]src=([0-9a-zA-Z]+)/);
  return { playerUrl, hash: hm ? hm[1] : '' };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : absUrl(id);
  const html = await getHtml(durl, isDetailPage, TTL_DETAIL);
  if (!html) return { list: [] };
  const name = og(html, 'title');
  const pic = og(html, 'image');
  const desc = og(html, 'description');
  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: desc,
      vod_play_from: 'JAVSB',
      vod_play_url: `正片$${durl}`,
    }],
  };
}

// 官方取流链: token.php -> save_m3u8_cache.php (sign 明文实试, 站方 encrypt 生成的 sign 拿不到)
// 成功返回最终 m3u8 地址, 任何一步失败返回 '' (由 play 落嗅探)
async function tryOfficialStream(hash, playerUrl, deadline) {
  const budget = (cap) => Math.max(300, Math.min(cap, deadline - Date.now()));
  if (Date.now() >= deadline) return '';
  const hasToken = (s) => { const j = parseJsonLoose(s); return !!(j && j.token); };
  const hasFile = (s) => { const j = parseJsonLoose(s); return !!(j && j.m3u8_file); };
  // 第1步: 换 token (三层通道, 总预算内; slices 依次 [req, jina, fetch])
  let token = '', ts = '';
  try {
    const txt = await getText(`${HOST}/token.php?file=${encodeURIComponent(hash)}`, hasToken,
      [budget(2000), budget(3500), budget(1500)]);
    const j = parseJsonLoose(txt);
    token = t(j && j.token); ts = t(j && j.ts);
  } catch (e) { /* 落嗅探 */ }
  if (!token) return '';
  if (Date.now() >= deadline) return '';
  // 第2步: 换 m3u8, sign 按播放器页同式拼 {hash}@{unix秒}
  const key = `${hash}@${Math.floor(Date.now() / 1000)}`;
  try {
    const url = `${HOST}/save_m3u8_cache.php?file=${encodeURIComponent(hash)}&token=${encodeURIComponent(token)}&ts=${encodeURIComponent(ts)}&sign=${encodeURIComponent(key)}`;
    const txt = await getText(url, hasFile, [budget(2000), budget(3000), budget(1500)]);
    const j = parseJsonLoose(txt);
    const f = t(j && j.m3u8_file);
    if (f && /m3u8/i.test(f)) return f + (f.includes('sign=') ? '' : `&sign=${key}`);
  } catch (e) { /* 落嗅探 */ }
  return '';
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const durl = /^https?:\/\//.test(id) ? id : absUrl(id);
  const deadline = Date.now() + 7500; // play 总耗时 <8s 有界
  const remain = () => Math.max(300, deadline - Date.now());
  const html = await getText(durl, isDetailPage,
    [Math.min(2500, remain()), Math.min(6000, remain()), Math.min(2000, remain())], TTL_DETAIL);
  const { playerUrl, hash } = html ? extractPlayer(html) : { playerUrl: '', hash: '' };
  if (hash && playerUrl) {
    const direct = await tryOfficialStream(hash, playerUrl, deadline);
    if (direct) {
      return { parse: 0, url: direct, header: { 'User-Agent': UA, 'Referer': REFERER } };
    }
    // 官方链失败: 立即嗅探官方播放器页 (页面内 JS 自己走完整取流)
    return { parse: 1, jx: 0, url: playerUrl, header: { 'User-Agent': UA, 'Referer': durl } };
  }
  if (playerUrl) {
    return { parse: 1, jx: 0, url: playerUrl, header: { 'User-Agent': UA, 'Referer': durl } };
  }
  // 详情页都没拿到/没播放器: 嗅探详情页兜底 (WebView 是浏览器引擎, 与蜘蛛抓取通道相互独立)
  return { parse: 1, jx: 0, url: durl, header: { 'User-Agent': UA, 'Referer': REFERER } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const kw = encodeURIComponent(wd);
  const url = page > 1 ? `${HOST}/vod/search/page/${page}/wd/${kw}.html` : `${HOST}/vod/search.html?wd=${kw}`;
  const html = await getHtml(url, isSearchPage);
  if (!html) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const list = parseCards(html);
  const pc = pagecountOf(html, /\/vod\/search\/page\/(\d+)\//g);
  return { page, pagecount: Math.max(pc, page), limit: 12, total: list.length, list };
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
