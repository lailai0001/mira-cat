// JavXXX — javxxx.me（WordPress + spacex 主题）
// 播放链（2026-11-28 逆向 cast.js 坐实）：
//   详情页 #player-wrapper 的 data-ts-live 是 RC4 密文（base64）。
//   密钥 = reverse(btoa(data-ts-id + "_0x48107a"))；RC4 解密后是 base64，
//   再 atob 一次得到 sources token（两样本实测验证，见下方 fme）。
//   POST https://{domain}/api2/play/ {sources: token, ver: '2'}（form 编码），
//   响应 {"status": true, "data": "<密文>"}；data 再用后缀 "WMWQo"
//   同法 RC4 解密（第二解密）得到 //video.{domain} 的 iframe 地址，
//   取 iframe 页抽 m3u8 直链。
//   密钥/后缀由 cast.js 混淆字符串表解出（旋转量 r=98，原版解码器验证）。
// 注意：API 与 iframe 两步在 VM 侧被站方 CF 拦（403），无法在 VM 验证；
//   蜘蛛跑在用户手机（住宅 IP）上，站方不对住宅 IP 设限，链路按浏览器实测复现。
// 分类：v 号会变（Censored v30→v38），type_id 只用 slug，v 号每次从首页
//   动态解析（带缓存 + 失败重解析一次），硬编码默认值仅作回落。
// 子分类做筛选卡片（不平铺）：Censored 下英/中/印尼字幕，Uncensored 下
//   FC2 PPV / Decensored（LTX）/ Uncensored Leaked（LTX）。
// 详情给真 videoUrl（不懒解析）；有番号的片接字幕芯。
import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const KEY = 'py_javxxx';
const NAME = 'JavXXX';
const HOST = 'https://www.javxxx.me';
const JINA = 'https://r.jina.ai/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 顶级分类（type_id = slug，不含 v 号）
const CLASSES = [
  { type_id: 'censored', type_name: 'Censored' },
  { type_id: 'uncensored', type_name: 'Uncensored' },
  { type_id: 'amateur', type_name: 'Amateur' },
];

// 子分类筛选卡片（value = 子分类 slug；LTX：Decensored、Uncensored Leaked）
const FILTERS = {
  censored: [
    { key: 'sub', name: '子分类', value: [
      { n: 'English Subtitle', v: 'english-subtitle' },
      { n: 'Chinese Subtitle', v: 'chinese-subtitle' },
      { n: 'Subtitle Indonesia', v: 'subtitle-indonesia' },
    ] },
  ],
  uncensored: [
    { key: 'sub', name: '子分类', value: [
      { n: 'FC2 PPV', v: 'fc2-ppv' },
      { n: 'Decensored', v: 'decensored' },
      { n: 'Uncensored Leaked', v: 'uncensored-leaked' },
    ] },
  ],
};

// v 号默认值（首页解析失败时回落；2026-11-28 jina 首页实测）
const V_DEFAULT = {
  'censored': 'v38',
  'uncensored': 'v9',
  'amateur': 'v34',
  'english-subtitle': 'v18',
  'chinese-subtitle': 'v23',
  'subtitle-indonesia': 'v9',
  'fc2-ppv': 'v36',
  'decensored': 'v19',
  'uncensored-leaked': 'v12',
};

let vMapCache = null; // slug -> v 号

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function absUrl(u, base) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  const b = base || HOST;
  return b + (u.startsWith('/') ? u : '/' + u);
}

function isRealHtml(t) {
  if (!t || typeof t !== 'string') return false;
  if (t.includes('Just a moment...')) return false;
  if (t.includes('Attention Required')) return false;
  if (t.length < 1000) return false;
  return true;
}

function isCfBlock(t) {
  return /Just a moment|Attention Required|challenges\.cloudflare/i.test(t || '');
}

// 取页：直连优先，失败/被 CF 拦则走 jina 兜底（直连被拦时设备上 5G 移动 IP 也常被拦）。
// 直连回 HTML，jina 回 Markdown；列表解析两种都认，详情仍需直连 HTML 才有 data-ts-live。
async function getText(url, referer) {
  // ① 直连
  try {
    const r = await req.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer || HOST + '/',
      },
      timeout: 20000,
    });
    const t = typeof r.data === 'string' ? r.data : '';
    if (isRealHtml(t)) return t;
  } catch (e) { /* 落到 jina */ }
  // ② jina 兜底
  try {
    const r = await req.get(JINA + url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain' },
      timeout: 30000,
    });
    const t = typeof r.data === 'string' ? r.data : '';
    // jina 成功回 Markdown（含 'Markdown Content:'）；429 限流回 JSON，必须排除
    if (t && t.includes('Markdown Content:') && !isCfBlock(t)) return t;
  } catch (e) { /* 失败 */ }
  return '';
}

// ---------- base64 / RC4（cast.js _0xfme 的纯 JS 复现） ----------
// b64 解码：atob（猫源沙箱可用，见 7mmtv.js）；失败回落 Buffer。
function b64ToBytes(b64) {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return new Uint8Array(0);
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {}
  try {
    if (typeof Buffer !== 'undefined') {
      const b = Buffer.from(clean, 'base64');
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }
  } catch (e2) {}
  return new Uint8Array(0);
}
// b64 编码：Buffer（猫源沙箱有，见 javass.js）；无 Buffer 时纯 JS（ASCII 输入）。
function bytesToB64(bytes) {
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  } catch (e) {}
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alpha[b0 >> 2] + alpha[((b0 & 3) << 4) | (b1 >> 4)]
      + (i + 1 < bytes.length ? alpha[((b1 & 15) << 2) | (b2 >> 6)] : '=')
      + (i + 2 < bytes.length ? alpha[b2 & 63] : '=');
  }
  return out;
}
function strToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
function bytesToStr(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}
function rc4(keyBytes, dataBytes) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + keyBytes[i % keyBytes.length]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = new Uint8Array(dataBytes.length);
  let i = 0; j = 0;
  for (let n = 0; n < dataBytes.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[n] = dataBytes[n] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}
// _0xfme 复现：
//   isFirst=true（取 sources token）：后缀 '_0x48107a'；
//   isFirst=false（解响应 data 得 iframe 地址）：后缀 'WMWQo'。
// 密钥 = reverse(btoa(tsId + 后缀))；密文 = atob(输入)；
// RC4 解密后是 base64 串，再 atob 一次得明文。
function fme(tsId, encB64, isFirst) {
  const suffix = isFirst ? '_0x48107a' : 'WMWQo';
  const keyB64 = bytesToB64(strToBytes(String(tsId) + suffix));
  const keyStr = keyB64.split('').reverse().join('');
  const keyBytes = strToBytes(keyStr);
  const cipher = b64ToBytes(encB64);
  if (!cipher.length || !keyBytes.length) return '';
  const mid = rc4(keyBytes, cipher);
  const midStr = bytesToStr(mid);
  const plain = b64ToBytes(midStr);
  if (!plain.length) return '';
  return bytesToStr(plain);
}

// ---------- 分类 v 号动态解析 ----------
function parseVMap(html) {
  const m = {};
  if (!html) return m;
  const re = /\/((?:v\d+))\/category\/([a-z0-9\-]+)\//gi;
  let mm;
  while ((mm = re.exec(html)) !== null) {
    const v = mm[1], slug = mm[2].toLowerCase();
    if (!m[slug]) m[slug] = v;
  }
  return m;
}

async function getVMap(force) {
  if (vMapCache && !force) return vMapCache;
  const html = await getText(HOST + '/', HOST + '/');
  const m = parseVMap(html);
  vMapCache = m;
  return m;
}

function vFor(slug, vmap) {
  const s = String(slug || '').toLowerCase();
  if (vmap && vmap[s]) return vmap[s];
  return V_DEFAULT[s] || '';
}

// ---------- 列表解析 ----------
// 卡片：div.item.thumb-block > div.video-img > a[href="/video/{code}/"]
//   封面在 img 的 data-wpsrc（wp.com 代理）/ data-lazy-src / data-src，
//   src 是占位 svg；标题在 a[title] 或 h3 a 文本；时长在 .video-duration。
// jina Markdown 列表解析（直连被 CF 拦、走 jina 兜底时用）。
// jina 渲染不稳定，两种卡形都认：
// ① 图片链 [![Image N: 标题](封面)...](视频地址 "标题")——封面是真地址时用；
// ② ### [标题](视频地址 "标题")——图片链封面是 blob:（jina 渲染坏了）时用，
//    只有标题+地址、无封面，但至少能出列表、可点播。
// 实测一页 18~24 张（直连 HTML 更多，jina 只是兜底）。
function parseCardsMd(text, host) {
  const cards = [];
  if (!text) return cards;
  const seen = new Set();
  // ① 图片链（封面须是真 http 地址，blob: 的不要）
  const re = /\[!\[Image \d+: ([^\]]*)\]\((https?:\/\/[^)]+)\)[^\]]*\]\((https?:\/\/[^)\s]+\/video\/[^)\s]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const title = cleanText(m[1]);
    const cover = m[2];
    let href = m[3].split('"')[0].trim();
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    cards.push({ vod_id: absUrl(href, host), vod_name: title, vod_pic: absUrl(cover, host), vod_remarks: '' });
  }
  // ② ### 标题链（图片链没出卡时补）
  if (!cards.length) {
    const re2 = /### \[([^\]]+)\]\((https?:\/\/[^)\s]+\/video\/[^)\s]+)/g;
    while ((m = re2.exec(text)) !== null) {
      const title = cleanText(m[1]);
      let href = m[2].split('"')[0].trim();
      if (!href || !title || seen.has(href)) continue;
      seen.add(href);
      cards.push({ vod_id: absUrl(href, host), vod_name: title, vod_pic: '', vod_remarks: '' });
    }
  }
  return cards;
}

function parseCards(html, host) {
  const cards = [];
  if (!html || html.includes('Just a moment...')) return cards;
  // jina Markdown（直连被拦时 getText 回的是 Markdown，不是 HTML）
  if (!/<[a-z][\s\S]*>/i.test(html.slice(0, 2000)) || html.includes('Markdown Content:')) {
    return parseCardsMd(html, host);
  }
  const $ = cheerio.load(html);
  $('.item.thumb-block').each((_, e) => {
    const el = $(e);
    const a = el.find('.video-img a[href*="/video/"]').first();
    let href = a.attr('href') || '';
    if (!href) {
      const a2 = el.find('a[href*="/video/"]').first();
      href = a2.attr('href') || '';
    }
    if (!href || !/\/video\/[^/]+\//i.test(href)) return;
    const title = cleanText(a.attr('title')) || cleanText(el.find('h3 a').first().text()) || cleanText(el.find('a[href*="/video/"]').first().text());
    if (!title) return;
    const img = el.find('img').first();
    let cover = img.attr('data-wpsrc') || img.attr('data-lazy-src') || img.attr('data-src') || img.attr('src') || '';
    if (cover && cover.startsWith('data:')) cover = img.attr('data-wpsrc') || img.attr('data-lazy-src') || img.attr('data-src') || '';
    const dur = cleanText(el.find('.video-duration').text()) || cleanText(el.find('.video-foot').text());
    cards.push({
      vod_id: absUrl(href, host),
      vod_name: title,
      vod_pic: absUrl(cover, host),
      vod_remarks: dur,
    });
  });
  // 兜底：若主题结构变化，用通用 a[href*="/video/"] 掃一遍
  if (!cards.length) {
    const seen = new Set();
    $('a[href*="/video/"]').each((_, e) => {
      const el = $(e);
      const href = el.attr('href') || '';
      if (!/\/video\/[^/]+\//i.test(href)) return;
      const abs = absUrl(href, host);
      if (seen.has(abs)) return;
      seen.add(abs);
      const title = cleanText(el.attr('title')) || cleanText(el.text());
      if (!title) return;
      const img = el.find('img').first();
      let cover = img.attr('data-wpsrc') || img.attr('data-lazy-src') || img.attr('data-src') || img.attr('src') || '';
      if (cover && cover.startsWith('data:')) cover = '';
      cards.push({ vod_id: abs, vod_name: title, vod_pic: absUrl(cover, host), vod_remarks: '' });
    });
  }
  return cards;
}

function parsePagecount(html, curPage) {
  let max = curPage;
  if (html) {
    const re = /\/page\/(\d+)\//g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// ---------- 播放链 ----------
// 从 iframe 页抽 m3u8/mp4（通用：直链、source 标签、JS 变量里的地址）。
function extractMediaFromIframe(html, base) {
  const urls = [];
  const seen = new Set();
  if (!html) return urls;
  const push = (u) => {
    u = String(u || '').trim().replace(/\\+$/, '').replace(/["'<>]+$/, '');
    if (!u) return;
    if (!/^https?:\/\//i.test(u) && u.startsWith('//')) u = 'https:' + u;
    if (!/^https?:\/\//i.test(u)) u = absUrl(u, base);
    if (!/\.(m3u8|mp4)(\?[^"'<>\s]*)?$/i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };
  const re = /https?:\/\/[^"'<>\s\\]+\.(?:m3u8|mp4)(?:\?[^"'<>\s\\]*)?/gi;
  let m;
  while ((m = re.exec(html)) !== null) push(m[0]);
  const re2 = /\/\/(?:[^"'<>\s\\]+\.)?(?:[^"'<>\s\\]+\.(?:m3u8|mp4))(?:\?[^"'<>\s\\]*)?/gi;
  while ((m = re2.exec(html)) !== null) push(m[0]);
  return urls;
}

// 详情页 -> 真播放地址。返回 { url, referer }，失败返回 null。
// 链路：data-ts-live --RC4(后缀_0x48107a)--> sources token
//   --POST /api2/play/ {sources, ver:2}--> {"status":true,"data":"密文"}
//   --RC4(后缀WMWQo)--> //video.{domain}/... iframe 地址
//   --取 iframe 页--> m3u8/mp4 直链。
async function resolvePlay(detailUrl, detailHtml) {
  const $ = cheerio.load(detailHtml || '');
  const wrap = $('#player-wrapper');
  const tsId = wrap.attr('data-ts-id') || '';
  const tsLive = wrap.attr('data-ts-live') || '';
  if (!tsId || !tsLive) return null;
  const token = fme(tsId, tsLive, true);
  if (!token) return null;
  // POST /api2/play/（jQuery $.ajax 默认 form 编码）
  const apiUrl = HOST + '/api2/play/';
  const body = 'sources=' + encodeURIComponent(token) + '&ver=2';
  let respText = '';
  try {
    const r = await req.post(apiUrl, body, {
      headers: {
        'User-Agent': UA,
        'Referer': detailUrl,
        'Origin': HOST,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 20000,
    });
    respText = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
  } catch (e) { return null; }
  let resp = null;
  try { resp = JSON.parse(respText); } catch (e) { return null; }
  if (!resp || resp.status !== true || !resp.data) return null;
  const iframeUrl = fme(tsId, String(resp.data), false);
  if (!iframeUrl) return null;
  const iframeAbs = absUrl(iframeUrl, HOST);
  // iframe 地址本身就是 m3u8/mp4 时直接用
  if (/\.(m3u8|mp4)(\?[^"'<>\s]*)?$/i.test(iframeAbs)) {
    return { url: iframeAbs, referer: detailUrl };
  }
  // 否则取 iframe 页抽直链（iframe 页可能很小，不用 getText 的 1000 字符门槛）
  let iframeHtml = '';
  try {
    const r = await req.get(iframeAbs, {
      headers: { 'User-Agent': UA, 'Referer': detailUrl, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
      timeout: 20000,
    });
    const t = typeof r.data === 'string' ? r.data : '';
    if (t && !t.includes('Just a moment...') && !t.includes('Attention Required')) iframeHtml = t;
  } catch (e) {}
  const media = extractMediaFromIframe(iframeHtml, iframeAbs);
  if (media.length) {
    // 优先 m3u8，其次 mp4；多档时取第一条（详情只列一条正片）
    const m3u8 = media.filter((u) => /\.m3u8(\?|$)/i.test(u));
    const pick = m3u8.length ? m3u8[0] : media[0];
    return { url: pick, referer: detailUrl };
  }
  // iframe 页抽不到直链：把 iframe 地址本身当播放地址交播放器（站内播放器页）
  return { url: iframeAbs, referer: detailUrl };
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: FILTERS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let tid = String(body.id || 'censored').trim().toLowerCase();
  const extend = body.filters || body.extend || {};
  const sub = String(extend.sub || '').trim().toLowerCase();
  const slug = sub || tid;
  // 先用 V_DEFAULT（已验正确），不先取首页——取首页要多一次 jina 调用，
  // 与分类页连发会撞 jina 限流。若列表为空再重解析首页取新 v 号重试。
  let v = vFor(slug, null);
  let path = '/' + v + '/category/' + slug + '/';
  let url = HOST + path + (page > 1 ? 'page/' + page + '/' : '');
  let html = await getText(url, HOST + '/');
  let list = parseCards(html, HOST);
  // 空结果且 v 号可能过期：重解析首页取新 v 号再试一次
  if (!list.length && page === 1) {
    const vmap2 = await getVMap(true);
    const v2 = vFor(slug, vmap2);
    if (v2 && v2 !== v) {
      v = v2;
      path = '/' + v + '/category/' + slug + '/';
      url = HOST + path;
      html = await getText(url, HOST + '/');
      list = parseCards(html, HOST);
    }
  }
  const pagecount = list.length ? parsePagecount(html, page) : page;
  return { page, pagecount, limit: list.length || 12, total: pagecount * 12, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '').trim();
  if (!id) return { list: [] };
  const detailUrl = absUrl(id);
  const html = await getText(detailUrl, HOST + '/');
  const $ = cheerio.load(html || '');
  const name = cleanText($('meta[property="og:title"]').attr('content')) || cleanText($('h1').first().text()) || cleanText($('title').text());
  const cover = absUrl($('meta[property="og:image"]').attr('content'), HOST);
  const content = cleanText($('meta[property="og:description"]').attr('content'));
  const code = cleanText($('.movie-description').text().match(/Code:\s*([A-Za-z0-9\-]+)/)?.[1] || '');
  const eps = [];
  const resolved = await resolvePlay(detailUrl, html);
  if (resolved && resolved.url) {
    eps.push('正片$' + resolved.url);
  }
  const vod = {
    vod_id: detailUrl,
    vod_name: name,
    vod_pic: cover,
    vod_content: content,
    vod_play_from: NAME,
    vod_play_url: eps.join('#'),
  };
  // 字幕：只有含可抽番号才预热（不 await）
  const subUrls = eps.map((e) => e.split('$').pop()).filter(Boolean);
  for (const u of subUrls) subCacheName(u, name);
  if (subUrls.length && subExtractCode(name || code)) {
    (async () => {
      for (const u of subUrls) {
        try { await subSearchAll(u); } catch (e) {}
      }
    })().catch(() => {});
  }
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop();
  if (!id) return { parse: 0, url: '' };
  const url = id;
  const subs = subExtractCode(subNameCache.get(url) || '') ? await subSearchAll(url).catch(() => []) : [];
  const result = {
    parse: 0,
    url,
    header: {
      'User-Agent': UA,
      'Referer': HOST + '/',
      'Origin': HOST,
    },
  };
  if (subs && subs.length) result.subs = subs;
  return result;
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const url = HOST + '/?s=' + encodeURIComponent(wd) + (page > 1 ? '&paged=' + page : '');
  const html = await getText(url, HOST + '/');
  const list = parseCards(html, HOST);
  const pagecount = list.length ? parsePagecount(html, page) : page;
  return { page, pagecount, limit: list.length || 12, total: pagecount * 12, list };
}

// ---------- 共享字幕芯（与 av01/av123 等蜘蛛同款自包含块：
//   迅雷 > 迅雷看看 > SubtitleCat；只挂有番号条目；全局上限 10、单槽 8；
//   总预算 6s、失败静默；无结果不带 subs 键）----------
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

// ---------------- 字幕聚合 (与 32 个带芯猫源同一套 Layer A，2026-11-02 定版) ----------------
// 槽位：迅雷（键序 [番号, 紧凑番号]）> 迅雷看看（完整键序）> SubtitleCat；
// 键序逐个查、首中即停；命中后严过滤（须含番号或片名全文，无回退）；
// 合并序 = 档位 -> 语言（简中>繁中>双语>英文>日文>其他）-> 分数；
// 全局上限 10、单槽软上限 8；总预算 6s、失败全静默；无结果时 play 不带 subs 键。
// 时长后缀：oracle 给毫秒（>100000 除 1000），无时长不显示、不编造；
// 去重键 = 语言 + 小写名（去扩展名）+ 秒（无时长记 nodur），同名同时长才算重复。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();
const subResultCache = new Map();

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? clean(slug.replace(/[-_]+/g, ' ')) : '';
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
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match), dur: it.norm.duration });
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

function subDurSec(v) {
  let s = Number(v) || 0;
  if (s > 100000) s = Math.floor(s / 1000);
  return s > 0 ? s : 0;
}
function subDurStr(v) {
  let s = Number(v) || 0;
  if (s > 100000) s = Math.floor(s / 1000);
  if (s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const seenName = new Set();
  const perTier = {};
  const out = [];
  for (const it of sorted) {
    if (out.length >= 10) break;
    if (seenUrl.has(it.url)) continue;
    const nameKey = (it.lang || '') + '|' + it.name.toLowerCase().replace(/\.(srt|vtt|ass|ssa)$/i, '') + '|' + (subDurSec(it.dur) || 'nodur');
    if (seenName.has(nameKey)) continue;
    if ((perTier[it.tier] || 0) >= 8) continue;
    seenUrl.add(it.url);
    seenName.add(nameKey);
    perTier[it.tier] = (perTier[it.tier] || 0) + 1;
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    const dur = subDurStr(it.dur);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName + (dur ? '·' + dur : ''), url: it.url, format: it.fmt });
  }
  return out;
}

const subInflight = new Map();

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

function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
}

export default function spider() {
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
