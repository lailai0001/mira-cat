// JavCC - javcc.me 移植（WordPress retrotube 站）
// 列表/分类/搜索走站方 HTML（article 卡片）；播放走 videplay 嵌页：
// 详情页 base64 播放脚本解出 defaultUrl（xx.videplay.us/v/<id>）→ 嵌页
// Dean Edwards 打包解包 → 模板 A：api.videplay.us/o/v-master.m3u8/<token>；
// 模板 B：解包文本只有无 token 的 /x/v-master.m3u8 模板，真实地址须经嵌页
// 的 let pox / let dp 做 CryptoJS 式 AES-256 解密（纯 JS 实现，见下）→
// /x/v-master.m3u8/<token>；再按 RESOLUTION 分档出线（单档只出一线，
// 多档各出一线，绝不编造清晰度；解不出时回落嵌页 parse:1，绝不输出
// 无 token 的模板地址）。
// 字幕聚合：与猫源 27 源同款芯（迅雷/迅雷看看/SubtitleCat 三槽、严过滤、
// 全局上限 10、单槽软上限 8、详情串行预热、play 挂 subs、无命中不带键）。
// 注意：全程只用框架 req（猫源 App 无全局 fetch）；短剧在本站无对应内容，
// 故不设短剧分类（不编造）；无码流出用原生 uncensored-leaked 标签页。
import req from '../../util/req.js';

const KEY = 'py_javcc';
const NAME = 'JavCC';
const HOST = 'https://javcc.me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function getText(url, referer, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, Referer: referer || HOST + '/' },
      timeout: timeoutMs || 15000,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    if (r.status !== 200) return '';
    return typeof r.data === 'string' ? r.data : '';
  } catch (e) { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function b64Decode(s) {
  const clean = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  try { return Buffer.from(clean, 'base64').toString('utf-8'); } catch (e) { return ''; }
}

function jsUnescapeSingle(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}

// Dean Edwards 打包解包（与 hornyjav/videplay 同款纯字符串算法）
function unpackDeanEdwards(html) {
  const m = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
  if (!m) return '';
  let p = jsUnescapeSingle(m[1]);
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = jsUnescapeSingle(m[4]).split('|');
  const enc = (n) => (n < a ? '' : enc(Math.floor(n / a))) + ((n % a) > 35 ? String.fromCharCode((n % a) + 29) : (n % a).toString(36));
  let i = c;
  while (i--) {
    if (k[i]) {
      const word = k[i];
      p = p.replace(new RegExp('\\b' + enc(i) + '\\b', 'g'), () => word);
    }
  }
  return p;
}

// 首页/分类/标签/搜索卡片：<article> 块（标题在 a 的 title 属性，封面在 img data-src）
function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const blk = m[1];
    const lm = blk.match(/<a[^>]+href="https:\/\/javcc\.me\/([^"\/\?#]+)\/?"[^>]*title="([^"]*)"/i)
      || blk.match(/<a[^>]+href="https:\/\/javcc\.me\/([^"\/\?#]+)\/?"[^>]*>/i);
    if (!lm) continue;
    const slug = lm[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    let title = lm[2] ? stripTags(lm[2]) : '';
    if (!title) {
      const hm = blk.match(/<header[^>]*>([\s\S]{0,400}?)<\/header>/i);
      if (hm) title = stripTags(hm[1]);
    }
    if (!title || title.length < 2) continue;
    let pic = '';
    const im = blk.match(/<img[^>]+>/i);
    if (im) {
      const sm = im[0].match(/(?:data-src|data-original|src)\s*=\s*"([^"]+)"/i);
      if (sm && /^https?:\/\//i.test(sm[1]) && !/data:image/i.test(sm[1])) pic = sm[1];
    }
    let remarks = '';
    const dm = blk.match(/duration">[\s\S]{0,120}?(\d+:\d+(?::\d+)?)/i);
    if (dm) remarks = dm[1];
    items.push({ vod_id: slug, vod_name: title, vod_pic: pic, vod_remarks: remarks });
    if (items.length >= 60) break;
  }
  return items;
}

// 分类：前列为用户钦定的关键词类（全部对应站方原生标签页，真实可验证）；
// 短剧在本站无对应内容，不设。末尾为站方原生 3 分类 + 最新。
const CATS = [
  { type_id: 'tag/uncensored-leaked', type_name: '无码流出' },
  { type_id: 'tag/big-tits', type_name: '巨乳' },
  { type_id: 'tag/huge-butt', type_name: '大屁股' },
  { type_id: 'tag/married-woman', type_name: '人妻' },
  { type_id: 'tag/school-uniform', type_name: '制服' },
  { type_id: 'tag/uncensored', type_name: '无码' },
  { type_id: 'tag/creampie', type_name: '中出' },
  { type_id: 'tag/amateur', type_name: '素人' },
  { type_id: 'tag/beautiful-girl', type_name: '美少女' },
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'category/censored', type_name: '有码' },
  { type_id: 'category/reducing-mosaic', type_name: '减码' },
  { type_id: 'category/english-subtitle', type_name: '英字' },
];

async function home() {
  const html = await getText(HOST + '/', HOST + '/');
  return { class: CATS, filters: {}, list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(Array.isArray(body.id) ? body.id[0] : body.id || body.tid || 'latest');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const base = tid === 'latest' ? HOST : HOST + '/' + tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/page/' + page + '/');
  let html = await getText(url, HOST + '/');
  let list = parseCards(html);
  // 翻页兜底（2026-10-31：VM 侧 /page/N/ 本是通的，但设备侧有用户报翻页无内容，
  // 原因未坐实，可能是个别网络/缓存导致主地址空回；主地址空回时换 ?paged=N 再取一次）
  if (page > 1 && !list.length) {
    const alt = tid === 'latest' ? HOST + '/?paged=' + page : base + '/?paged=' + page;
    html = await getText(alt, HOST + '/', 20000);
    list = parseCards(html);
  }
  return { page, pagecount: list.length ? page + 1 : page, list };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  if (!wd) return { list: [] };
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const url = page === 1
    ? HOST + '/?s=' + encodeURIComponent(wd)
    : HOST + '/page/' + page + '/?s=' + encodeURIComponent(wd);
  const html = await getText(url, HOST + '/');
  return { list: parseCards(html) };
}

// ---------- 详情 / 播放 ----------
const embedCache = new Map(); // variantUrl -> embedUrl（play 时作 Referer）

// 详情页播放脚本：Rocket Lazy Load 包的 base64 内联脚本，解出 defaultUrl
function extractEmbedUrl(html) {
  const bm = String(html || '').match(/data-rocketlazyloadscript='data:text\/javascript;base64,([^']+)'/);
  if (bm) {
    const js = b64Decode(bm[1]);
    const um = js.match(/defaultUrl\s*=\s*"([^"]+)"/);
    if (um && /^https?:\/\//i.test(um[1])) return um[1];
  }
  const vm = String(html || '').match(/https:\/\/[a-z0-9.\-]*videplay\.us\/v\/[A-Za-z0-9]+/i);
  if (vm) return vm[0];
  const fm = String(html || '').match(/<iframe[^>]+src="([^"]+)"/i);
  if (fm && /^https?:\/\//i.test(fm[1])) return fm[1];
  return '';
}

// master 清单按 RESOLUTION 分档；单档只出一线，多档各出一线（绝不编造）
function parseMasterVariants(text) {
  const out = [];
  const seen = new Set();
  const re = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)[^\n]*\n([^\n#][^\n]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const h = parseInt(m[2], 10);
    const url = m[3].trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const q = h >= 1080 ? '1080p' : h >= 720 ? '720p' : h >= 480 ? '480p' : h >= 360 ? '360p' : (h + 'p');
    out.push({ name: q, url });
  }
  out.sort((a, b) => parseInt(b.name, 10) - parseInt(a.name, 10));
  return out;
}

// ---------- videplay 模板 B：pox/dp AES 解密（纯 JS，无 CryptoJS/node:crypto） ----------
// 嵌页 setup 用 file:ply(pox,dp) 运行时组装地址；ply 等价逻辑（2026-10-31
// 对 jur-887 嵌页实测坐实）：
//   pass = pox.split('+')[1].slice(1)（取中间 '+' 段并去掉首字符）
//   dp 经 base64 解码得 JSON {ct(base64), iv(hex), s(hex 盐)}
//   EVP_BytesToKey(MD5, pass, salt, 48 字节) -> key=前 32(AES-256) + iv=后 16
//   AES-256-CBC 解密 ct、去 PKCS7 填充 -> 真实 master 清单地址（如 /x/v-master.m3u8/<token>）
// 注意：JSON 里的 iv 与 EVP 派生 iv 一致，解密时以 EVP 为准；md5Bytes 与
// AES-256 均由 py_one.js 的 MD5/AES-128 改编（MD5 改走字节数组输入，
// AES 扩展 Nk=8/Nr=14，轮函数与 S 盒算法不变）。
function md5Bytes(input) {
  const msg = Array.from(input || []);
  const len = msg.length;
  const bitLen = len * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  const lo = bitLen >>> 0; const hi = Math.floor(bitLen / 4294967296) >>> 0;
  msg.push(lo & 255, (lo >>> 8) & 255, (lo >>> 16) & 255, (lo >>> 24) & 255);
  msg.push(hi & 255, (hi >>> 8) & 255, (hi >>> 16) & 255, (hi >>> 24) & 255);
  let a0 = 0x67452301; let b0 = 0xefcdab89; let c0 = 0x98badcfe; let d0 = 0x10325476;
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  for (let off = 0; off < msg.length; off += 64) {
    const M = [];
    for (let j = 0; j < 16; j++) M[j] = msg[off + j * 4] | (msg[off + j * 4 + 1] << 8) | (msg[off + j * 4 + 2] << 16) | (msg[off + j * 4 + 3] << 24);
    let A = a0; let B = b0; let C = c0; let D = d0;
    for (let r = 0; r < 64; r++) {
      let F; let g;
      if (r < 16) { F = (B & C) | (~B & D); g = r; }
      else if (r < 32) { F = (D & B) | (~D & C); g = (5 * r + 1) % 16; }
      else if (r < 48) { F = B ^ C ^ D; g = (3 * r + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * r) % 16; }
      const tmp = D; D = C; C = B;
      const sum = (A + F + K[r] + M[g]) | 0;
      B = (B + ((sum << S[r]) | (sum >>> (32 - S[r])))) | 0;
      A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = [];
  for (const x of [a0, b0, c0, d0]) for (let i = 0; i < 4; i++) out.push((x >>> (i * 8)) & 255);
  return out;
}

const AES256 = (function () {
  function xt(a) { return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff; }
  function mul(a, b) { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r & 0xff; }
  const SBOX = []; const INV = [];
  for (let a = 0; a < 256; a++) {
    let inv = 0;
    if (a) { for (let b = 1; b < 256; b++) { if (mul(a, b) === 1) { inv = b; break; } } }
    const x = inv;
    const s = x ^ ((x << 1 | x >> 7) & 255) ^ ((x << 2 | x >> 6) & 255) ^ ((x << 3 | x >> 5) & 255) ^ ((x << 4 | x >> 4) & 255) ^ 0x63;
    SBOX[a] = s & 0xff;
  }
  for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
  function expandKey256(key) {
    const Nk = 8; const Nr = 14;
    const w = [];
    for (let i = 0; i < Nk; i++) w[i] = (key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3];
    let rcon = 1;
    for (let i = Nk; i < 4 * (Nr + 1); i++) {
      let tt = w[i - 1];
      if (i % Nk === 0) {
        tt = ((tt << 8) | (tt >>> 24)) >>> 0;
        tt = ((SBOX[(tt >>> 24) & 255] << 24) | (SBOX[(tt >>> 16) & 255] << 16) | (SBOX[(tt >>> 8) & 255] << 8) | SBOX[tt & 255]) >>> 0;
        tt = (tt ^ (rcon << 24)) >>> 0;
        rcon = xt(rcon);
      } else if (i % Nk === 4) {
        tt = ((SBOX[(tt >>> 24) & 255] << 24) | (SBOX[(tt >>> 16) & 255] << 16) | (SBOX[(tt >>> 8) & 255] << 8) | SBOX[tt & 255]) >>> 0;
      }
      w[i] = (w[i - Nk] ^ tt) >>> 0;
    }
    return w;
  }
  function invShift(st) {
    const cols = [];
    for (let c = 0; c < 4; c++) cols[c] = [(st[c] >>> 24) & 255, (st[c] >>> 16) & 255, (st[c] >>> 8) & 255, st[c] & 255];
    const rows = [[], [], [], []];
    for (let cc = 0; cc < 4; cc++) for (let rr = 0; rr < 4; rr++) rows[rr][cc] = cols[cc][rr];
    for (let r2 = 0; r2 < 4; r2++) { const t2 = rows[r2].slice(); for (let c2 = 0; c2 < 4; c2++) rows[r2][(c2 + r2) % 4] = t2[c2]; }
    for (let c3 = 0; c3 < 4; c3++) for (let r3 = 0; r3 < 4; r3++) cols[c3][r3] = rows[r3][c3];
    const out = [];
    for (let c4 = 0; c4 < 4; c4++) out[c4] = ((cols[c4][0] << 24) | (cols[c4][1] << 16) | (cols[c4][2] << 8) | cols[c4][3]) >>> 0;
    return out;
  }
  function invSub(st) {
    const out = [];
    for (let c = 0; c < 4; c++) out[c] = ((INV[(st[c] >>> 24) & 255] << 24) | (INV[(st[c] >>> 16) & 255] << 16) | (INV[(st[c] >>> 8) & 255] << 8) | INV[st[c] & 255]) >>> 0;
    return out;
  }
  function invMix(st) {
    const out = [];
    for (let c = 0; c < 4; c++) {
      const b0 = (st[c] >>> 24) & 255; const b1 = (st[c] >>> 16) & 255; const b2 = (st[c] >>> 8) & 255; const b3 = st[c] & 255;
      out[c] = ((mul(b0, 14) ^ mul(b1, 11) ^ mul(b2, 13) ^ mul(b3, 9)) << 24 |
        (mul(b0, 9) ^ mul(b1, 14) ^ mul(b2, 11) ^ mul(b3, 13)) << 16 |
        (mul(b0, 13) ^ mul(b1, 9) ^ mul(b2, 14) ^ mul(b3, 11)) << 8 |
        (mul(b0, 11) ^ mul(b1, 13) ^ mul(b2, 9) ^ mul(b3, 14))) >>> 0;
    }
    return out;
  }
  function decBlock(w, s, Nr) {
    let st = [];
    for (let i = 0; i < 4; i++) st[i] = s[i] >>> 0;
    for (let round = Nr; round >= 1; round--) {
      for (let k = 0; k < 4; k++) st[k] = (st[k] ^ w[round * 4 + k]) >>> 0;
      if (round !== Nr) st = invMix(st);
      st = invShift(st);
      st = invSub(st);
    }
    for (let k2 = 0; k2 < 4; k2++) st[k2] = (st[k2] ^ w[k2]) >>> 0;
    return st;
  }
  function cbcDecrypt(keyBytes, ivBytes, dataBytes) {
    const w = expandKey256(keyBytes);
    const iv = [];
    for (let i = 0; i < 4; i++) iv[i] = ((ivBytes[i * 4] << 24) | (ivBytes[i * 4 + 1] << 16) | (ivBytes[i * 4 + 2] << 8) | ivBytes[i * 4 + 3]) >>> 0;
    const out = []; let prev = iv;
    for (let off = 0; off < dataBytes.length; off += 16) {
      const blk = [];
      for (let j = 0; j < 4; j++) blk[j] = ((dataBytes[off + j * 4] << 24) | (dataBytes[off + j * 4 + 1] << 16) | (dataBytes[off + j * 4 + 2] << 8) | dataBytes[off + j * 4 + 3]) >>> 0;
      let res = decBlock(w, blk, 14);
      res = [(res[0] ^ prev[0]) >>> 0, (res[1] ^ prev[1]) >>> 0, (res[2] ^ prev[2]) >>> 0, (res[3] ^ prev[3]) >>> 0];
      for (let j2 = 0; j2 < 4; j2++) out.push((res[j2] >>> 24) & 255, (res[j2] >>> 16) & 255, (res[j2] >>> 8) & 255, res[j2] & 255);
      prev = blk;
    }
    return out;
  }
  return { cbcDecrypt };
})();

function evpBytesToKey(password, salt, total) {
  const pw = Array.from(Buffer.from(String(password || ''), 'utf-8'));
  const sl = Array.from(salt || []);
  let out = []; let prev = [];
  while (out.length < total) {
    prev = md5Bytes(prev.concat(pw, sl));
    out = out.concat(prev);
  }
  return out.slice(0, total);
}

// ply 等价：pox/dp -> 真实 master 清单地址；失败返回 ''（绝不输出半截地址）
function decryptVideplayDp(pox, dp) {
  try {
    const parts = String(pox || '').split('+');
    if (parts.length < 3) return '';
    const pass = parts[1].slice(1);
    if (!pass) return '';
    const json = JSON.parse(Buffer.from(String(dp || ''), 'base64').toString('utf-8'));
    if (!json || !json.ct || !json.s) return '';
    const ct = Array.from(Buffer.from(json.ct, 'base64'));
    const salt = Array.from(Buffer.from(json.s, 'hex'));
    if (!ct.length || ct.length % 16 !== 0 || salt.length !== 8) return '';
    const dk = evpBytesToKey(pass, salt, 48);
    const plain = AES256.cbcDecrypt(dk.slice(0, 32), dk.slice(32, 48), ct);
    const pad = plain[plain.length - 1];
    const cut = (pad >= 1 && pad <= 16) ? plain.slice(0, plain.length - pad) : plain;
    const text = Buffer.from(cut).toString('utf-8');
    // 明文本身是 JSON 带引号字符串（"https:\/\/..."），先按 JSON 解析还原；
    // 非引号开头时只做 \/ -> / 还原。
    let url = text;
    if (text.startsWith('"')) {
      try { url = JSON.parse(text); } catch (e) { url = text.replace(/^"|"$/g, '').replace(/\\\//g, '/'); }
    } else url = text.replace(/\\\//g, '/');
    if (!/^https?:\/\/[^"'\\\s<>]+\/v-master\.m3u8\/[A-Za-z0-9_\-\.%=]+/i.test(url)) return '';
    return url;
  } catch (e) { return ''; }
}
// ---------- /videplay 模板 B ----------

async function resolveLines(embedUrl, durl) {
  const embedHtml = await getText(embedUrl, durl);
  if (!embedHtml) return [{ name: '正片', url: embedUrl }];
  const unpacked = unpackDeanEdwards(embedHtml);
  const hay = unpacked || embedHtml;
  let master = '';
  const mm = hay.match(/https:\/\/api\.videplay\.us\/o\/v-master\.m3u8\/[A-Za-z0-9_\-\.%]+/i);
  if (mm) master = mm[0];
  if (!master) {
    // 模板 B：解包文本只有无 token 的 /x/v-master.m3u8 模板地址，真实地址
    // 须经 pox/dp 解密；解不出则回落嵌页，绝不输出无 token 的模板地址。
    const px = embedHtml.match(/let\s+pox\s*=\s*'([^']+)'/);
    const dp = embedHtml.match(/let\s+dp\s*=\s*'([^']+)'/);
    if (px && dp) master = decryptVideplayDp(px[1], dp[1]);
  }
  if (!master) return [{ name: '正片', url: embedUrl }];
  const masterText = await getText(master, embedUrl);
  const variants = masterText ? parseMasterVariants(masterText) : [];
  if (variants.length) {
    for (const v of variants) {
      embedCache.set(v.url, embedUrl);
      if (embedCache.size > 200) embedCache.delete(embedCache.keys().next().value);
    }
    return variants;
  }
  return [{ name: '正片', url: master }];
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  if (!id) return { list: [] };
  const durl = /^https?:\/\//i.test(id) ? id : HOST + '/' + id.replace(/^\/+/, '');
  const slug = durl.replace(/^https:\/\/javcc\.me\//, '').replace(/\/+$/, '');
  const html = await getText(durl, HOST + '/');
  if (!html) return { list: [] };
  let title = '';
  const ogt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogt) title = stripTags(ogt[1]);
  if (!title) {
    const tm = html.match(/<title>([\s\S]{0,400}?)<\/title>/i);
    if (tm) title = stripTags(tm[1]).replace(/\s*-\s*JAVCC\.ME\s*$/i, '');
  }
  if (!title) title = slug;
  let pic = '';
  const ogi = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogi) pic = ogi[1];
  let remarks = '';
  const rm = html.match(/Runtime:\s*([\d:]+)/i);
  if (rm) remarks = rm[1];
  const embedUrl = extractEmbedUrl(html);
  let lines = [];
  if (embedUrl) {
    try { lines = await resolveLines(embedUrl, durl); } catch (e) { lines = []; }
    if (!lines.length) lines = [{ name: '正片', url: embedUrl }];
  }
  if (lines.length) {
    // 字幕预热：后台逐条串行（不 await；并行预热曾把 SubtitleCat 搜索挤挂）
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
      vod_remarks: remarks,
      vod_play_from: lines.length ? 'JavCC' : '',
      vod_play_url: lines.map((l) => l.name + '$' + l.url).join('#'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const idx = id.indexOf('$');
  let url = (idx >= 0 ? id.slice(idx + 1) : id).trim();
  if (!url) return { parse: 0, url: '' };
  // 直解失败才落到嵌页（play 嗅探兜底）：嵌页地址本身无法直播
  if (/videplay\.us\/v\//i.test(url)) return { parse: 1, url };
  const subs = await subSearchAll(url).catch(() => []);
  const result = {
    parse: 0,
    url,
    header: { 'User-Agent': UA, Referer: embedCache.get(url) || HOST + '/' },
  };
  if (subs && subs.length) result.subs = subs;
  return result;
}

// ---------- 字幕聚合（与猫源 27 源同款芯一致，番号只从片名取） ----------
// 三槽：迅雷（键序 [番号， 紧凑番号]）> 迅雷看看（完整键序）> SubtitleCat；
// 两迅雷槽同走同一 oracle 接口、合并按 URL 去重、同条归高档位；合并序 =
// 档位 -> 语言（简中>繁中>双语>英文>日文>其他）-> 分数；全局上限 10、
// 单槽软上限 8。严过滤（条目须含番号或片名全文，无回退，宁缺毋滥）；
// 全程 req 主栈、逐请求超时 3s、总预算 6s、失败全静默、无命中不带 subs 键。
// 接线：detail 时按每条播放地址登记片名并后台预热（不 await）；play 时
// 命中缓存/在途、一般不增加点播延迟；未经过 detail 的直接点播（如续播）
// 无片名缓存时返回无字幕（与接入前一致）。
// 注意：番号只从片名取，不从播放地址取（CDN 域名如 upmf83 会被误认番号）。
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
    },
  };
}
