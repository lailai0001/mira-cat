import req from '../../util/req.js';
import crypto from 'crypto';
import vm from 'vm';

// JavOpen (py_javopen)
// 站点: https://javopen.co/ (WordPress JAV 站)
// 列表: GET /{slug}/[/page/N/]  slug: jav-censored/jav-uncensored/mgstage/amatuer-porn/asia-uncensored-hd/fc3ppv/usa-euro
// 搜索: GET /?s={kw}
// 详情: GET /video/{slug}/  提取 iframe (三种宿主, 见分类分布)
// 播放 (2026-10-20 实测三宿主):
//   vidaraa.cc/e/{filecode}: POST {host}/api/stream {filecode,device,codecs} -> streaming_url (m3u8, token 时效短, 实时获取)
//   streamdesi.com/e/{code}: gdplayer 加密流, 已破: 抓 embed 页的 AAEncode 配置脚本 -> api-config/sources 两步 AES 解密拿直链
//   morencius.com/embed/{code}: 解 jwplayer packer 拿 acek-cdn 的 m3u8 (部分文件站方已删)
// 实测: 详情页只有 1 个默认 embed, ?tape=1~4 参数对 embed 无任何影响 (旧 tape 扫描逻辑已移除, 徒增 4 次整页请求)

const KEY = 'py_javopen';
const NAME = 'JavOpen';
const SITE = 'https://javopen.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 7 个真实分类 (2026-10-20 从首页导航实测；另有2个为外部站已剔除)
const CATS = [
  { type_id: 'jav-censored', type_name: 'JAV有码' },
  { type_id: 'jav-uncensored', type_name: 'JAV无码' },
  { type_id: 'mgstage', type_name: 'MGSTAGE' },
  { type_id: 'amatuer-porn', type_name: '素人' },
  { type_id: 'asia-uncensored-hd', type_name: '亚洲无码' },
  { type_id: 'fc3ppv', type_name: 'OnlyFans' },
  { type_id: 'usa-euro', type_name: '欧美' },
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
  return u;
}

async function getHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
  };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

async function postJson(url, body, referer) {
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Referer': referer || REFERER,
  };
  const payload = JSON.stringify(body);
  try {
    const { data, status } = await req.post(url, payload, { headers, timeout: 25000 });
    if (status === 200 && data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { method: 'POST', headers, body: payload });
    if (r.ok) return await r.json();
  } catch (e) { /* ignore */ }
  return null;
}

// 解析视频卡片: a[href="/video/{slug}/"] > img[src|data-src,alt] + h3 > a 标题
// 注意: 站点用 perfmatters 懒加载，从第5张开始 src 是空白 SVG 占位图，真实地址在 data-src
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(https?:\/\/javopen\.co\/video\/[^"]+\/)"[^>]*>\s*<img([^>]+)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = m[1];
    if (seen.has(durl)) continue;
    seen.add(durl);
    const imgTag = m[2];
    // 优先 data-src（懒加载真实地址），其次 src（排除 data:image 占位图）
    let pic = '';
    const dsrcM = imgTag.match(/data-src="([^"]+)"/);
    if (dsrcM) pic = dsrcM[1];
    else {
      const srcM = imgTag.match(/src="([^"]+)"/);
      if (srcM && !srcM[1].startsWith('data:')) pic = srcM[1];
    }
    const altM = imgTag.match(/alt="([^"]*)"/);
    let title = clean(altM ? altM[1] : '');
    // 尝试从后面的 h3 取完整标题
    const win = html.slice(m.index, m.index + 3000);
    const h3M = win.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/);
    if (h3M && clean(h3M[1]).length > title.length) title = clean(h3M[1]);
    out.push({
      vod_id: durl,
      vod_name: title || durl.split('/video/')[1].replace(/\/$/, ''),
      vod_pic: fixUrl(pic),
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const pages = [...html.matchAll(/\/page\/(\d+)\//g)].map(x => parseInt(x[1], 10));
  const nums = pages.filter(n => n > 0 && n < 100000);
  return nums.length ? Math.max(...nums) : 1;
}

async function buildList(url, page, limit) {
  limit = limit || 20;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(SITE + '/jav-censored/');
  const list = html ? parseCards(html).slice(0, 20) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'jav-censored';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = `${SITE}/${encodeURIComponent(tid)}/`;
  if (page > 1) url += `page/${page}/`;
  return buildList(url, page, 20);
}

// 解析详情页的播放器: 提取 raw-payload 里的 iframe src (返回完整 embed 信息)
// 注意: 详情页只有一个默认 embed, 没有多服务器切换 (?tape= 参数无影响, 已实测)
function decodePayload(html) {
  const rawM = html.match(/<textarea[^>]*id="raw-payload"[^>]*>([^<]+)<\/textarea>/);
  if (!rawM) return '';
  try {
    let b64 = rawM[1].trim();
    let dec = '';
    if (typeof Buffer !== 'undefined') {
      dec = Buffer.from(b64, 'base64').toString('utf-8');
    } else {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dec = new TextDecoder().decode(bytes);
    }
    const srcM = dec.match(/src="([^"]+)"/i);
    if (srcM) return srcM[1];
  } catch (e) { /* ignore */ }
  return '';
}

function classifyEmbed(embedUrl) {
  if (!embedUrl) return null;
  const m = embedUrl.match(/https?:\/\/([^"/]+)\/(e|embed)\/([A-Za-z0-9\-_]+)/);
  if (m) {
    return {
      host: 'https://' + m[1],
      filecode: m[3],
      embedUrl,
      isVidaraa: /vidaraa/i.test(m[1]),
      isStreamdesi: /streamdesi/i.test(m[1]),
      isMorencius: /morencius/i.test(m[1]),
    };
  }
  return { host: '', filecode: '', embedUrl, isVidaraa: false, isStreamdesi: false, isMorencius: false };
}

function extractPlayer(html) {
  const src = decodePayload(html);
  if (src) return classifyEmbed(src);
  // 降级: 直接的 iframe 标签
  const m = html.match(/<iframe[^>]+src="(https?:\/\/[^"]+\/(?:e|embed)\/[A-Za-z0-9\-_]+)"/);
  if (m) return classifyEmbed(m[1]);
  return null;
}

// 通用文本抓取 (req 优先, fetch 兜底), 带超时; 失败返回 ''
async function httpText(url, opt) {
  opt = opt || {};
  const timeout = opt.timeout || 15000;
  const headers = Object.assign({ 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' }, opt.headers || {});
  try {
    const { data, status } = await req.get(url, { headers, timeout });
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 500) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// streamdesi (gdplayer) 的 AES 解密: base64 前16字节为 salt, 后为密文;
// key=PBKDF2(SHA256, password, salt, 10000, 48字节), 前32=key, 后16=iv, AES-256-CBC/Pkcs7
function dcxStreamDesi(payload, password) {
  const b = Buffer.from(String(payload).trim(), 'base64');
  const key = crypto.pbkdf2Sync(String(password), b.subarray(0, 16), 10000, 48, 'sha256');
  const d = crypto.createDecipheriv('aes-256-cbc', key.subarray(0, 32), key.subarray(32, 48));
  return Buffer.concat([d.update(b.subarray(16)), d.final()]).toString('utf-8');
}

// 在受限 vm 里运行站方内联 JS, 只取它设置的全局配置变量, 不给网络/进程访问
function runSiteScript(scriptCode, pageUrl) {
  const winT = { location: { href: pageUrl, pathname: new URL(pageUrl).pathname, origin: new URL(pageUrl).origin }, navigator: {} };
  const elStub = () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {}, submit() {}, remove() {} });
  const docStub = {
    createElement: elStub, querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, getElementsByTagName: () => [elStub()],
    body: elStub(), documentElement: {}, cookie: '', addEventListener() {},
  };
  const sb = {
    document: docStub, navigator: winT.navigator, location: winT.location,
    console: { log() {}, error() {}, warn() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  sb.window = winT; winT.window = winT; winT.self = winT; winT.top = winT; winT.parent = winT; winT.document = docStub;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(scriptCode, sb, { timeout: 8000 });
  return sb;
}

// streamdesi 直链解析: /e/{code} -> AAEncode 配置脚本 -> api-config + sources 两步解密 -> 直链
// 实测 4 个视频全部打通 (hls/mp4), 全链路约 2.7-3 秒
async function resolveStreamDesi(code) {
  const pageUrl = 'https://streamdesi.com/e/' + code;
  const html = await httpText(pageUrl, { headers: { Referer: REFERER } });
  if (!html) return '';
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  const aa = scripts.find(s => s.includes('┻━┻'));
  if (!aa) return '';
  const g = runSiteScript(aa, pageUrl);
  if (!g.apx || !g.qsx || !g.kaken || g.pd === undefined) return '';
  const ps = String(g.ps).replace(/,+$/, '');
  const apiConfig = Buffer.from(String(g.apx), 'base64').toString('utf-8');
  const cfgUrl = apiConfig + g.qsx + '?p=' + encodeURIComponent(ps);
  const srcUrl = apiConfig.replace('-config', '') + '?p=' + encodeURIComponent(ps);
  // 必须先 config 后 sources (与站方播放器顺序一致; 实测并行会让 sources 的 token 失效)
  const cfgResp = await httpText(cfgUrl, { headers: { Referer: pageUrl } });
  let srcResp = '';
  {
    const headers = { 'User-Agent': UA, 'Content-Type': 'text/plain', 'Referer': pageUrl };
    try {
      const { data, status } = await req.post(srcUrl, g.kaken, { headers, timeout: 15000 });
      if (status === 200 && data) srcResp = typeof data === 'string' ? data : '';
    } catch (e) { /* 换通道2 */ }
    if (!srcResp) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(srcUrl, { method: 'POST', headers, body: g.kaken, signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) srcResp = await r.text();
      } catch (e) { /* ignore */ }
    }
  }
  if (!cfgResp || !srcResp) return '';
  let sources = [];
  try {
    const sj = JSON.parse(dcxStreamDesi(srcResp, g.pd));
    sources = sj.sources || [];
  } catch (e) { return ''; }
  if (!sources.length) return '';
  const hls = sources.find(s => s && /hls|\.m3u8/i.test(String(s.type || '') + ' ' + String(s.file || '')));
  const pick = hls || sources[0];
  const file = t(pick.file);
  if (!/^https?:\/\//.test(file)) return '';
  // file 是 streamdesi 的跳转器地址, 其 gt token 校验在多节点间不一致 (实测同一地址时好时坏);
  // 服务端自己跟一次跳转, 直接返最终 CDN 地址 (实测 CDN 地址 5/5 稳定 200 + 分片可拉)
  for (let i = 0; i < 4; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(file, { headers: { 'User-Agent': UA, 'Referer': 'https://streamdesi.com/' }, redirect: 'manual', signal: ctrl.signal });
      clearTimeout(timer);
      if (r.status === 200) return file;
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) return loc;
    } catch (e) { /* 重试 */ }
    await new Promise(r => setTimeout(r, 600));
  }
  // 跳转拿不到也照返跳转器地址 (App 自己重试有机会命中好节点; 比老嗅探强)
  return file;
}

// morencius 直链解析: /embed/{code} 的 packer 里抓 jwplayer.setup 的 sources[0].file (acek-cdn 的 m3u8)
async function resolveMorencius(embedUrl) {
  const html = await httpText(embedUrl, { headers: { Referer: REFERER } });
  if (!html || /no longer available|expired or has been deleted/i.test(html)) return '';
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  const packed = scripts.find(s => s.includes("split('|')") && s.includes('function(p,a,c,k,e,d)'));
  if (!packed) return '';
  let setupArg = null;
  const jwStub = () => ({ setup: (cfg) => { setupArg = cfg; }, on() {}, once() {} });
  const jq = function () { return { on() {}, ready() {}, click() {} }; };
  jq.cookie = () => {};
  jq.ajaxSetup = () => {};
  const winT = { location: { href: embedUrl, pathname: new URL(embedUrl).pathname, origin: new URL(embedUrl).origin }, navigator: {} };
  const docStub = { createElement: () => ({ style: {}, setAttribute() {} }), querySelector: () => null, getElementById: () => null, getElementsByTagName: () => [], body: {}, cookie: '', addEventListener() {} };
  const sb = {
    document: docStub, navigator: winT.navigator, location: winT.location,
    console: { log() {}, error() {}, warn() {}, info() {} },
    jwplayer: jwStub, $: jq, jQuery: jq,
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null, setItem() {} },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  try {
    vm.createContext(sb);
    vm.runInContext(packed, sb, { timeout: 8000 });
  } catch (e) { return ''; }
  const files = (setupArg && setupArg.sources) || [];
  const hls = files.find(s => s && /hls|\.m3u8/i.test(String(s.type || '') + ' ' + String(s.file || '')));
  const pick = hls || files[0];
  const file = pick && t(pick.file);
  return file && /^https?:\/\//.test(file) ? file : '';
}

async function fetchStreamUrl(host, filecode, referer) {
  const apiUrl = host.replace(/\/$/, '') + '/api/stream';
  const resp = await postJson(apiUrl, { filecode, device: 'web', codecs: ['h264'] }, referer);
  if (resp && resp.streaming_url && /^https?:\/\//.test(resp.streaming_url)) {
    return resp.streaming_url;
  }
  return '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/^\/+/, ''));

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = titleM ? clean(titleM[1]) : durl.split('/video/')[1].replace(/\/$/, '');

  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (picM) pic = fixUrl(picM[1]);

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: name,
      vod_play_from: 'JavOpen',
      vod_play_url: `正片$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/^\/+/, ''));
  const baseUrl = durl.replace(/\?.*$/, '');

  // 只抓一次详情页拿默认 embed (实测 ?tape= 参数不改变 embed, 不再逐个扫 tape)
  const html = await getHtml(baseUrl);
  const p = html ? extractPlayer(html) : null;
  if (!p || !p.embedUrl) return { parse: 0, url: '' };

  // 1. vidaraa: api/stream 拿直链 (最可靠, 实测100%)
  if (p.isVidaraa && p.filecode) {
    const streamUrl = await fetchStreamUrl(p.host, p.filecode, baseUrl);
    if (streamUrl) {
      return {
        parse: 0,
        url: streamUrl,
        header: { 'User-Agent': UA, 'Referer': p.host + '/' },
      };
    }
  }

  // 2. streamdesi: gdplayer 加密流已破, 解密拿直链 (亚洲无码/OnlyFans/欧美三分类的唯一宿主)
  //    usa-euro 的少数视频直链是 mp4: 源站 CDN 当前 404 (站方问题), 直链照返, App 侧至少有机会直达
  if (p.isStreamdesi && p.filecode) {
    try {
      const file = await resolveStreamDesi(p.filecode);
      if (file) {
        return {
          parse: 0,
          url: file,
          header: { 'User-Agent': UA, 'Referer': 'https://streamdesi.com/' },
        };
      }
    } catch (e) { /* 失败落嗅探 */ }
  }

  // 3. morencius: packer 解包拿 m3u8 直链 (文件被站方删除的解不出, 落嗅探)
  if (p.isMorencius) {
    try {
      const file = await resolveMorencius(p.embedUrl);
      if (file) {
        return {
          parse: 0,
          url: file,
          header: { 'User-Agent': UA, 'Referer': 'https://morencius.com/' },
        };
      }
    } catch (e) { /* 失败落嗅探 */ }
  }

  // 4. 兜底: embed 页走嗅探
  return {
    parse: 1,
    url: p.embedUrl,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
  return buildList(url, page, 20);
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
