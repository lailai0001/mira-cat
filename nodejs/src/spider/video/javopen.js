import req from '../../util/req.js';
import crypto from 'crypto';

// JavOpen (py_javopen)
// 站点: https://javopen.co/ (WordPress JAV 站)
// 列表: GET /{slug}/[/page/N/]  slug: jav-censored/jav-uncensored/mgstage/amatuer-porn/asia-uncensored-hd/fc3ppv/usa-euro
// 搜索: GET /?s={kw}
// 详情: GET /video/{slug}/  提取 iframe (三种宿主, 见分类分布)
// 播放 (2026-10-20 二轮修复: 全程纯字符串解码, 不执行站点 JS——App 运行时没有 vm 模块,
//   上一轮靠 vm 执行 AAEncode/packer 脚本的写法在 App 里抛错, 是真机大部分播不了+慢的根源):
//   vidaraa.cc/e/{filecode}: POST {host}/api/stream {filecode,device,codecs} -> streaming_url (m3u8, token 时效短, 实时获取)
//   streamdesi.com/e/{code}: gdplayer 加密流: AAEncode 脚本纯解码 -> 内层 packer 纯解包
//     -> 正则提取 apx/qsx/kaken/pd/ps -> api-config/sources 两步 + AES 解密拿直链
//   morencius.com/embed/{code}: packer 纯解包 -> links.hls* 的 acek-cdn m3u8 (部分文件站方已删)
//   任一解析失败一律落 parse:1 嗅探兜底, 不返空
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

function fetchWithTimeout(url, opt, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || 10000);
  const o = Object.assign({}, opt || {}, { signal: ctrl.signal });
  return fetch(url, o).finally(() => clearTimeout(timer));
}

async function getHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
  };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 12000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetchWithTimeout(url, { headers }, 12000);
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
    const { data, status } = await req.post(url, payload, { headers, timeout: 12000 });
    if (status === 200 && data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetchWithTimeout(url, { method: 'POST', headers, body: payload }, 12000);
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

// 通用文本抓取 (req 优先, fetch 兜底), 带硬超时; 失败返回 ''
async function httpText(url, opt) {
  opt = opt || {};
  const timeout = opt.timeout || 10000;
  const headers = Object.assign({ 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' }, opt.headers || {});
  try {
    const { data, status } = await req.get(url, { headers, timeout });
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetchWithTimeout(url, { headers }, timeout);
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 200) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// ============ 纯字符串解码器 (不执行任何站点 JS, 无 vm/eval/Function) ============

// AAEncode 纯解码: 载荷是 +-连接的项, 每项或为 (ﾟДﾟ)[ﾟεﾟ]='\\'、(ﾟДﾟ)[ﾟoﾟ]='"',
// 或由四个原子 (ﾟΘﾟ)=1 (ﾟｰﾟ)=4 (o^_^o)=3 (c^_^o)=0 组成的 + - * ^ 算术表达式 (=八进制数字)。
// 拼接得到 "..." 字符串后按 JS 八进制转义解码, 即原始源码文本。
// 原子值由 AAEncode 标准前导代码决定 (全版本恒定), 已用真实样本逐项验证。
const AA_ATOMS = { '(ﾟΘﾟ)': 1, '(ﾟｰﾟ)': 4, '(o^_^o)': 3, '(c^_^o)': 0 };

function aaEvalTerm(term) {
  const s = term.replace(/\s+/g, '');
  if (s === '(ﾟДﾟ)[ﾟεﾟ]') return '\\';
  if (s === '(ﾟДﾟ)[ﾟoﾟ]') return '"';
  let pos = 0;
  const peek = () => s[pos] || '';
  function parseXor() { let v = parseAdd(); while (peek() === '^') { pos++; v = (v ^ parseAdd()) | 0; } return v; }
  function parseAdd() {
    let v = parseMul();
    while (peek() === '+' || peek() === '-') { const op = s[pos++]; const r = parseMul(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  function parseMul() { let v = parseUnary(); while (peek() === '*') { pos++; v = v * parseUnary(); } return v; }
  function parseUnary() {
    if (peek() === '-') { pos++; return -parseUnary(); }
    if (peek() === '(') {
      for (const a of Object.keys(AA_ATOMS)) {
        if (s.startsWith(a, pos)) { pos += a.length; return AA_ATOMS[a]; }
      }
      pos++;
      const v = parseXor();
      if (peek() !== ')') throw new Error('aa: missing )');
      pos++;
      return v;
    }
    throw new Error('aa: bad char');
  }
  const v = parseXor();
  if (pos !== s.length) throw new Error('aa: trailing');
  return String(v);
}

function aaDecode(script) {
  const src = String(script).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = src.match(/\(ﾟεﾟ\s*\+/);
  if (!m) return '';
  const start = m.index + m[0].length;
  let depth = 0, end = -1;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') { if (depth === 0) { end = j; break; } depth--; }
  }
  if (end < 0) return '';
  const payload = src.slice(start, end);
  const terms = [];
  let d = 0, cur = '';
  for (const ch of payload) {
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    if (ch === '+' && d === 0) { terms.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) terms.push(cur);
  let s = '';
  for (const term of terms) { if (term.trim()) s += aaEvalTerm(term); }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  let out = '', k = 0;
  while (k < s.length) {
    const ch = s[k];
    if (ch === '\\' && k + 1 < s.length && s[k + 1] >= '0' && s[k + 1] <= '7') {
      const maxd = s[k + 1] <= '3' ? 3 : 2;
      let digs = s[k + 1], n = k + 2;
      while (digs.length < maxd && n < s.length && s[n] >= '0' && s[n] <= '7') { digs += s[n]; n++; }
      out += String.fromCharCode(parseInt(digs, 8));
      k = n;
    } else if (ch === '\\' && k + 1 < s.length) {
      const e = s[k + 1];
      out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
      k += 2;
    } else { out += ch; k++; }
  }
  return out;
}

// Dean Edwards packer 纯解包: 解析 eval(function(p,a,c,k,e,d){...}('p',a,c,'k'.split('|')))
// 用标准 e(c) 词元函数逐词替换 (替换值走函数形式, 避免 $ 模式被 replace 误读)。
function jsUnescapeSq(str) {
  return str.replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
}

function packerToken(c, a) {
  const r = c % a;
  const tail = r > 35 ? String.fromCharCode(r + 29) : r.toString(36);
  return (c < a ? '' : packerToken(Math.floor(c / a), a)) + tail;
}

function unpackPacker(text) {
  const m = String(text).match(/function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
  if (!m) return '';
  let p = jsUnescapeSq(m[1]);
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = jsUnescapeSq(m[4]).split('|');
  for (let i = c - 1; i >= 0; i--) {
    if (k[i]) {
      const re = new RegExp('\\b' + packerToken(i, a) + '\\b', 'g');
      const val = k[i];
      p = p.replace(re, () => val);
    }
  }
  return p;
}

// 从解包后的文本里按名取字符串赋值 (双引号/单引号都认)
function pickAssign(text, name) {
  let m = text.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"'));
  if (m) return m[1];
  m = text.match(new RegExp("\\b" + name + "\\s*=\\s*'([^']*)'"));
  return m ? m[1] : '';
}

// ============ streamdesi (gdplayer) ============

// streamdesi 的 AES 解密: base64 前16字节为 salt, 后为密文;
// key=PBKDF2(SHA256, password, salt, 10000, 48字节), 前32=key, 后16=iv, AES-256-CBC/Pkcs7
// crypto 在 App 里由其他 spider 在用 (createDecipheriv); pbkdf2Sync 同模块, 失败抛错由外层落嗅探
function dcxStreamDesi(payload, password) {
  const b = Buffer.from(String(payload).trim(), 'base64');
  const key = crypto.pbkdf2Sync(String(password), b.subarray(0, 16), 10000, 48, 'sha256');
  const d = crypto.createDecipheriv('aes-256-cbc', key.subarray(0, 32), key.subarray(32, 48));
  return Buffer.concat([d.update(b.subarray(16)), d.final()]).toString('utf-8');
}

// 从 embed 页提取 gdplayer 配置: 遍历内联脚本, AA 脚本先纯解码再解包, 普通 packer 脚本直接解包,
// 拿到 apx/qsx/kaken/pd/ps 五个值才算成功
function extractDesiConfig(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  for (const sc of scripts) {
    const candidates = [];
    try {
      if (sc.includes('┻━┻')) {
        const dec = aaDecode(sc);
        if (dec) { candidates.push(unpackPacker(dec)); candidates.push(dec); }
      } else if (sc.includes("split('|')")) {
        candidates.push(unpackPacker(sc));
      }
    } catch (e) { /* 换下一个脚本 */ }
    for (const txt of candidates) {
      if (!txt) continue;
      const cfg = {
        apx: pickAssign(txt, 'apx'),
        qsx: pickAssign(txt, 'qsx'),
        kaken: pickAssign(txt, 'kaken'),
        pd: pickAssign(txt, 'pd'),
        ps: pickAssign(txt, 'ps'),
      };
      if (cfg.apx && cfg.qsx && cfg.kaken && cfg.pd !== '') return cfg;
    }
  }
  return null;
}

// streamdesi 直链解析: /e/{code} -> 纯解码取配置 -> api-config + sources 两步 -> AES 解密拿直链
async function resolveStreamDesi(code) {
  const pageUrl = 'https://streamdesi.com/e/' + code;
  const html = await httpText(pageUrl, { headers: { Referer: REFERER }, timeout: 8000 });
  if (!html) return '';
  const cfg = extractDesiConfig(html);
  if (!cfg) return '';
  const ps = cfg.ps.replace(/,+$/, '');
  let apiConfig = '';
  try { apiConfig = Buffer.from(cfg.apx, 'base64').toString('utf-8'); } catch (e) { /* ignore */ }
  if (!/^https?:\/\//.test(apiConfig)) return '';
  const cfgUrl = apiConfig + cfg.qsx + '?p=' + encodeURIComponent(ps);
  const srcUrl = apiConfig.replace('-config', '') + '?p=' + encodeURIComponent(ps);
  // 必须先 config 后 sources (与站方播放器顺序一致; 实测并行会让 sources 的 token 失效)
  const cfgResp = await httpText(cfgUrl, { headers: { Referer: pageUrl }, timeout: 8000 });
  if (!cfgResp) return '';
  let srcResp = '';
  {
    const headers = { 'User-Agent': UA, 'Content-Type': 'text/plain', 'Referer': pageUrl };
    try {
      const { data, status } = await req.post(srcUrl, cfg.kaken, { headers, timeout: 8000 });
      if (status === 200 && data) srcResp = typeof data === 'string' ? data : '';
    } catch (e) { /* 换通道2 */ }
    if (!srcResp) {
      try {
        const r = await fetchWithTimeout(srcUrl, { method: 'POST', headers, body: cfg.kaken }, 8000);
        if (r.ok) srcResp = await r.text();
      } catch (e) { /* ignore */ }
    }
  }
  if (!srcResp) return '';
  let sources = [];
  try {
    const sj = JSON.parse(dcxStreamDesi(srcResp, cfg.pd));
    sources = sj.sources || [];
  } catch (e) { return ''; }
  if (!sources.length) return '';
  const hls = sources.find(s => s && /hls|\.m3u8/i.test(String(s.type || '') + ' ' + String(s.file || '')));
  const pick = hls || sources[0];
  const file = t(pick.file);
  if (!/^https?:\/\//.test(file)) return '';
  // file 是 streamdesi 的跳转器地址, 其 gt token 校验在多节点间不一致 (实测同一地址时好时坏);
  // 服务端自己跟一次跳转拿最终 CDN 地址 (稳定 200 + 分片可拉)。最多 2 次、无睡眠、单次 6s 硬超时;
  // 跟不到也照返跳转器地址 (App 自己重试有机会命中好节点; 比嗅探强)
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetchWithTimeout(file, { headers: { 'User-Agent': UA, 'Referer': 'https://streamdesi.com/' }, redirect: 'manual' }, 6000);
      if (r.status === 200) return file;
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) return loc;
    } catch (e) { /* 再试一次或放弃 */ }
  }
  return file;
}

// ============ morencius ============

// morencius 直链解析: packer 纯解包 -> links.hls4/hls3/hls2 优先取 acek-cdn 的 m3u8
async function resolveMorencius(embedUrl) {
  const html = await httpText(embedUrl, { headers: { Referer: REFERER }, timeout: 8000 });
  if (!html || /no longer available|expired or has been deleted/i.test(html)) return '';
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  const packed = scripts.find(s => s.includes("split('|')") && s.includes('function(p,a,c,k,e,d)'));
  if (!packed) return '';
  let txt = '';
  try { txt = unpackPacker(packed); } catch (e) { return ''; }
  if (!txt) return '';
  // jwplayer setup 用的是 links.hls4||links.hls3||links.hls2, 按同序取
  const links = {};
  for (const m of txt.matchAll(/"(hls\d+)":"(https?:\/\/[^"]+)"/g)) links[m[1]] = m[2];
  for (const key of ['hls4', 'hls3', 'hls2', 'hls1']) {
    if (links[key]) return links[key];
  }
  const anyM = txt.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/);
  if (anyM) return anyM[0];
  const fileM = txt.match(/file\s*:\s*"(https?:\/\/[^"]+)"/);
  return fileM ? fileM[1] : '';
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
  if (!p || !p.embedUrl) {
    // 连 embed 都没拿到: 详情页本身交嗅探, 不返空
    return { parse: 1, url: baseUrl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }

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

  // 2. streamdesi: gdplayer 加密流, 纯解码 (AAEncode+packer) 拿直链 (亚洲无码/OnlyFans/欧美三分类的唯一宿主)
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

  // 3. morencius: packer 纯解包拿 m3u8 直链 (文件被站方删除的解不出, 落嗅探)
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
