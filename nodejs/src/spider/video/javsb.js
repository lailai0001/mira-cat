// JAVSB (https://jav.sb) -> CatPawOpen spider
// MacCMS/Madou 模板站: 列表卡片 div.thumbnail, 详情 og 标签 + 官方播放器 iframe。
// 播放: 官方链 token.php -> save_m3u8_cache.php 的 sign 由父页面 encrypt() 生成,
// 该函数不在任何可抓到的客户端资源里, 明文 sign 实测被源站回 "erro time";
// 故 play 先按官方链实试 (硬超时, 总耗时 <8s), 失败立即 parse:1 嗅探官方播放器页。
//
// 抓取通道 (2026-10-20 第四版): 真机上单通道 (框架 req) 抓本站页面全灭,
// 但同机其他 CF 站正常、VM 内同代码全通 —— 拦截在"真机请求特征 x 本站 CF 规则"层。
// 改为三层递进, 任一层拿到"能通过校验的真页面"即停:
//   L1 框架 req + 桌面浏览器头 (原通道)
//   L2 原生 fetch + iOS Safari 头 (与真机系统 TLS 栈特征一致的档案)
//   L3 经自有 Worker 中转抓取 (WORKER_FETCH, 需在 Cloudflare 部署同名 Worker;
//      未部署时该层 DNS/连接快速失败并自动跳过, 不影响 L1/L2)
// 校验口径: 列表页必须含卡片标记, 抓到拦截页/空壳 (解析 0 卡) 也算失败、继续下一层。
// 另带会话级 Cookie 罐: 任一层响应给了 Set-Cookie 就存下并回放。
import req from '../../util/req.js';

const KEY = 'py_javsb';
const NAME = 'JAVSB';
const HOST = 'https://jav.sb';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const REFERER = HOST + '/';
// L3 中转 Worker (暂定名 javsb-fetch; 部署后把抓取改走 https://javsb-fetch.li768435813.workers.dev/?url=<目标URL>)
const WORKER_FETCH = 'https://javsb-fetch.li768435813.workers.dev/?url=';

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

// ---------- 会话 Cookie 罐 ----------
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

// ---------- 单次抓取 (两种栈) ----------
async function viaReq(url, headers, timeoutMs) {
  const host = new URL(url).host;
  const h = { ...headers };
  const ck = jarHeader(host);
  if (ck && !/javsb-fetch\./.test(host)) h['Cookie'] = ck;
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
    if (ck && !/javsb-fetch\./.test(host)) h['Cookie'] = ck;
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

// ---------- 三层递进抓取 ----------
// validate(txt) 通过才算拿到真内容; 全部层失败返回 ''。
// slices: 每层超时上限 (ms), 依次 [L1 req, L2 fetch, L3 Worker 中转 fetch]
async function getText(url, validate, slices) {
  const ok = typeof validate === 'function' ? validate : (s) => !!s;
  const [s1, s2, s3] = slices || [9000, 6000, 5000];
  try {
    const txt = await viaReq(url, desktopHeaders(), s1);
    if (txt && ok(txt)) return txt;
  } catch (e) { /* 下一层 */ }
  const txt2 = await viaFetch(url, safariHeaders(), s2);
  if (txt2 && ok(txt2)) return txt2;
  try {
    const wurl = WORKER_FETCH + encodeURIComponent(url);
    const txt3 = await viaFetch(wurl, { 'User-Agent': UA, 'Accept': '*/*' }, s3);
    if (txt3 && ok(txt3)) return txt3;
  } catch (e) { /* 未部署/失败: 跳过 */ }
  return '';
}

// 列表页校验: 必须含真实卡片标记 (拦截页/空壳不含)
const isListPage = (s) => s.includes('<div class="thumbnail group">');
// 详情页校验: og 标题或官方播放器任一出现
const isDetailPage = (s) => s.includes('og:title') || s.includes('/static/player/');
// 搜索页校验: 有卡片最好; 无结果页也是真页面 (足够长且含站内标记) 一并接受, 避免空结果白等三层
const isSearchPage = (s) => isListPage(s) || (s.length > 3000 && s.includes('javtype'));

function getHtml(url, validate) {
  return getText(url, validate || isListPage);
}

// ---------- 列表解析 ----------

// 卡片: <div class="thumbnail group"> ... <a href="/jav/{slug}-1-1.html">
//   <img data-src="/upload/vod/*.jpg" alt="片名"> ... <span ...>时长</span>
// 按卡片起始标签切块解析, 每块窗口给足 4000 字符, 保证最后一张卡不丢。
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
  const html = await getHtml(durl, isDetailPage);
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
  const asJson = (s) => { try { return !!JSON.parse(s); } catch (e) { return false; } };
  // 第1步: 换 token (三层通道, 总预算内)
  let token = '', ts = '';
  try {
    const txt = await getText(`${HOST}/token.php?file=${encodeURIComponent(hash)}`, asJson,
      [budget(3000), budget(2000), budget(1500)]);
    const j = JSON.parse(txt);
    token = t(j.token); ts = t(j.ts);
  } catch (e) { /* 落嗅探 */ }
  if (!token) return '';
  if (Date.now() >= deadline) return '';
  // 第2步: 换 m3u8, sign 按播放器页同式拼 {hash}@{unix秒}
  const key = `${hash}@${Math.floor(Date.now() / 1000)}`;
  try {
    const url = `${HOST}/save_m3u8_cache.php?file=${encodeURIComponent(hash)}&token=${encodeURIComponent(token)}&ts=${encodeURIComponent(ts)}&sign=${encodeURIComponent(key)}`;
    const txt = await getText(url, asJson, [budget(2500), budget(2000), budget(1500)]);
    const j = JSON.parse(txt);
    const f = t(j.m3u8_file);
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
  const html = await getText(durl, isDetailPage, [Math.min(3000, remain()), Math.min(2500, remain()), Math.min(2000, remain())]);
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
