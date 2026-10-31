// ONE一个 - 由 REX 模块 user.one（作者 YG）移植
// 官方接口直连：POST {host}/v2.5/{path}，AES-128-CBC 加密请求体，游客 token 自动获取
// 关键：app-version 1.6.0 旧协议会在 video_download 下发完整 MP4（新协议只给 4 分钟预告）
// 加密全部用纯 JS 实现（无 Buffer/TextDecoder，猫源沙箱可跑）
// 诚实说明：ONE 单片只有一个 MP4，没有 1080p/720p 分档；详情给出的是多 CDN 线路可选
import req from '../../util/req.js';

const KEY = 'py_one';
const NAME = 'ONE一个';
const APP_KEY = 'l*bv%Ziq000Biaog';
const APP_IV = '8597506002939249';
const SIGN_SALT = 'm4n2hjPeYWkD6tFpqKF^3HO^h24P@idT';
const APP_VERSION = '1.6.0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SEED_HOSTS = [
  'https://api.2b37894.com', 'https://api.35a46dd.com', 'https://api.43b8477.com',
  'https://api.5ce3771.com', 'https://api.61c76a0.com', 'https://api.632d809.com',
  'https://api.3459381.com', 'https://api.em1oifd0.com', 'https://api.j7y675.com',
];
const PLAIN_HOSTS = ['https://imgpw807.s7n7ue8.com', 'https://imgpw807.2u7qzt7.com',
  'https://img807.hkq57tt.com', 'https://imgsu807.hkq57tt.com'];
const ENC_HOSTS = ['gdliren123.com', 'u3wwetf.com', 'm6qzbb4.com', 'bdsy56.com', 'gzjsqx.com', 'k8b3rsp.com'];
const BAD_HOSTS = ['imgsu807.hkq57tt.com'];
const IMG_PROXY = 'https://wsrv.nl/?url=';
const STREAM_TTL = 15 * 60 * 1000;

// ---------- UTF-8 / Base64 ----------
function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      i++;
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function utf8Decode(bytes) {
  let s = ''; let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    else if (b < 0xf0) s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    else {
      let cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return s;
}
const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64R = {};
for (let k = 0; k < B64C.length; k++) B64R[B64C.charAt(k)] = k;
function base64Encode(bytes) {
  let out = ''; let i;
  for (i = 0; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64C[(n >> 18) & 63] + B64C[(n >> 12) & 63] + B64C[(n >> 6) & 63] + B64C[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) { const n1 = bytes[i] << 16; out += B64C[(n1 >> 18) & 63] + B64C[(n1 >> 12) & 63] + '=='; }
  else if (rem === 2) { const n2 = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64C[(n2 >> 18) & 63] + B64C[(n2 >> 12) & 63] + B64C[(n2 >> 6) & 63] + '='; }
  return out;
}
function base64Decode(str) {
  const s = String(str || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = []; let i;
  for (i = 0; i + 3 < s.length; i += 4) {
    const n = (B64R[s.charAt(i)] << 18) | (B64R[s.charAt(i + 1)] << 12) | (B64R[s.charAt(i + 2)] << 6) | B64R[s.charAt(i + 3)];
    out.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const rest = s.length - i;
  if (rest === 3) { const m = (B64R[s.charAt(i)] << 18) | (B64R[s.charAt(i + 1)] << 12) | (B64R[s.charAt(i + 2)] << 6); out.push((m >> 16) & 255, (m >> 8) & 255); }
  else if (rest === 2) { const m2 = (B64R[s.charAt(i)] << 18) | (B64R[s.charAt(i + 1)] << 12); out.push((m2 >> 16) & 255); }
  return out;
}
// ---------- MD5 ----------
function md5Hex(str) {
  const msg = utf8Encode(str); const len = msg.length;
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
  const w = (x) => { let s = ''; for (let i = 0; i < 4; i++) { const b = (x >>> (i * 8)) & 255; s += ('0' + b.toString(16)).slice(-2); } return s; };
  return w(a0) + w(b0) + w(c0) + w(d0);
}
// ---------- AES-128-CBC ----------
const AES = (function () {
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
  function expandKey(key) {
    const w = [];
    for (let i = 0; i < 4; i++) w[i] = (key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3];
    let rcon = 1;
    for (let i = 4; i < 44; i++) {
      let tt = w[i - 1];
      if (i % 4 === 0) {
        tt = ((tt << 8) | (tt >>> 24)) >>> 0;
        tt = ((SBOX[(tt >>> 24) & 255] << 24) | (SBOX[(tt >>> 16) & 255] << 16) | (SBOX[(tt >>> 8) & 255] << 8) | SBOX[tt & 255]) >>> 0;
        tt = (tt ^ (rcon << 24)) >>> 0;
        rcon = xt(rcon);
      }
      w[i] = (w[i - 4] ^ tt) >>> 0;
    }
    return w;
  }
  function encBlock(w, s) {
    let st = [];
    for (let i = 0; i < 4; i++) st[i] = s[i] ^ w[i];
    for (let round = 1; round <= 10; round++) {
      const t = [];
      for (let c = 0; c < 4; c++) t[c] = (SBOX[(st[c] >>> 24) & 255] << 24) | (SBOX[(st[c] >>> 16) & 255] << 16) | (SBOX[(st[c] >>> 8) & 255] << 8) | SBOX[st[c] & 255];
      const cols = [];
      for (let c = 0; c < 4; c++) cols[c] = [(t[c] >>> 24) & 255, (t[c] >>> 16) & 255, (t[c] >>> 8) & 255, t[c] & 255];
      const rows = [[], [], [], []];
      for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) rows[row][col] = cols[col][row];
      for (let r = 0; r < 4; r++) { const tmp = rows[r].slice(); for (let c2 = 0; c2 < 4; c2++) rows[r][c2] = tmp[(c2 + r) % 4]; }
      for (let c3 = 0; c3 < 4; c3++) for (let r3 = 0; r3 < 4; r3++) cols[c3][r3] = rows[r3][c3];
      const mixed = [];
      for (let c3 = 0; c3 < 4; c3++) {
        const a0 = cols[c3][0]; const a1 = cols[c3][1]; const a2 = cols[c3][2]; const a3 = cols[c3][3];
        if (round !== 10) {
          mixed[c3] = ((mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3) << 24 | (a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3) << 16 | (a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3)) << 8 | (mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2))) >>> 0;
        } else mixed[c3] = ((a0 << 24) | (a1 << 16) | (a2 << 8) | a3) >>> 0;
      }
      for (let c4 = 0; c4 < 4; c4++) st[c4] = (mixed[c4] ^ w[round * 4 + c4]) >>> 0;
    }
    return st;
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
  function decBlock(w, s) {
    let st = [];
    for (let i = 0; i < 4; i++) st[i] = s[i] >>> 0;
    for (let round = 10; round >= 1; round--) {
      for (let k = 0; k < 4; k++) st[k] = (st[k] ^ w[round * 4 + k]) >>> 0;
      if (round !== 10) st = invMix(st);
      st = invShift(st);
      st = invSub(st);
    }
    for (let k2 = 0; k2 < 4; k2++) st[k2] = (st[k2] ^ w[k2]) >>> 0;
    return st;
  }
  function cbc(keyBytes, ivBytes, dataBytes, encrypt) {
    const w = expandKey(keyBytes);
    const iv = [];
    for (let i = 0; i < 4; i++) iv[i] = ((ivBytes[i * 4] << 24) | (ivBytes[i * 4 + 1] << 16) | (ivBytes[i * 4 + 2] << 8) | ivBytes[i * 4 + 3]) >>> 0;
    const out = []; let prev = iv;
    for (let off = 0; off < dataBytes.length; off += 16) {
      const blk = [];
      for (let j = 0; j < 4; j++) blk[j] = ((dataBytes[off + j * 4] << 24) | (dataBytes[off + j * 4 + 1] << 16) | (dataBytes[off + j * 4 + 2] << 8) | dataBytes[off + j * 4 + 3]) >>> 0;
      let res;
      if (encrypt) res = encBlock(w, [blk[0] ^ prev[0], blk[1] ^ prev[1], blk[2] ^ prev[2], blk[3] ^ prev[3]]);
      else {
        res = decBlock(w, blk);
        res = [(res[0] ^ prev[0]) >>> 0, (res[1] ^ prev[1]) >>> 0, (res[2] ^ prev[2]) >>> 0, (res[3] ^ prev[3]) >>> 0];
      }
      for (let j2 = 0; j2 < 4; j2++) out.push((res[j2] >>> 24) & 255, (res[j2] >>> 16) & 255, (res[j2] >>> 8) & 255, res[j2] & 255);
      if (encrypt) prev = res;
      else prev = blk;
    }
    return out;
  }
  return { cbc };
})();
function aesEncryptCbcBase64(keyStr, ivStr, plainStr) {
  const data = utf8Encode(plainStr);
  const pad = 16 - (data.length % 16);
  for (let i = 0; i < pad; i++) data.push(pad);
  return base64Encode(AES.cbc(utf8Encode(keyStr), utf8Encode(ivStr), data, true));
}
function aesDecryptCbc(keyStr, ivStr, b64) {
  const bytes = base64Decode(b64);
  if (!bytes.length || bytes.length % 16 !== 0) return '';
  const out = AES.cbc(utf8Encode(keyStr), utf8Encode(ivStr), bytes, false);
  const pad = out[out.length - 1];
  const cut = (pad >= 1 && pad <= 16) ? out.slice(0, out.length - pad) : out;
  return utf8Decode(cut);
}

// ---------- 通用 ----------
function t(v) { return String(v == null ? '' : v).trim(); }
function clean(s) {
  return t(s).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}
function pick(...args) {
  for (const v of args) if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  return '';
}
function encQuery(params) {
  if (!params) return '';
  const parts = [];
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.join('&');
}
function makeUuid() {
  const hex = [];
  for (let i = 0; i < 32; i++) hex.push('0123456789abcdef'.charAt(Math.floor(Math.random() * 16)));
  const s = hex.join('');
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20, 32);
}
function sizeLabel(v) {
  const s = t(v);
  return /^\d+(\.\d+)?\s*(KB|MB|GB|TB)$/i.test(s) ? s : '';
}
function durationSeconds(a) {
  if (!a) return 0;
  const vl = parseInt(a.video_length, 10) || 0;
  if (vl > 0) return vl;
  const len = t(a.length || a.duration);
  if (!len) return 0;
  const hms = len.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hms) return hms[3] ? (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]) : (+hms[1]) * 60 + (+hms[2]);
  const mins = len.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|min)/i);
  if (mins) return Math.round(parseFloat(mins[1]) * 60);
  const hrs = len.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
  if (hrs) return Math.round(parseFloat(hrs[1]) * 3600);
  const secs = len.match(/(\d+)\s*(?:秒|s)$/i);
  if (secs) return parseInt(secs[1], 10);
  return 0;
}
function secondsToText(sec) {
  const s = parseInt(sec, 10) || 0;
  if (s <= 0) return '';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60;
  const p = (n) => (n < 10 ? '0' : '') + n;
  return h > 0 ? h + ':' + p(m) + ':' + p(ss) : m + ':' + p(ss);
}

// ---------- 会话 / 请求 ----------
let S = null;
function loadSession() {
  if (!S) S = { uuid: makeUuid(), host: '', token: '', api: [], image: [], resource: [], fimg: [], video: [], video_hls: [], audio: [], vplay: [], vdl: [], audl: [], ts: 0 };
  return S;
}
function applyDomains(domain) {
  if (!domain) return;
  if (domain.api && domain.api.length) S.api = domain.api.slice();
  if (domain.image && domain.image.length) S.image = domain.image.slice();
  if (domain.resource && domain.resource.length) S.resource = domain.resource.slice();
  if (domain.flutter_img && domain.flutter_img.length) S.fimg = domain.flutter_img.slice();
  if (domain.video && domain.video.length) S.video = domain.video.slice();
  if (domain.video_hls && domain.video_hls.length) S.video_hls = domain.video_hls.slice();
  if (domain.audio && domain.audio.length) S.audio = domain.audio.slice();
  if (domain.flutter_video_play && domain.flutter_video_play.length) S.vplay = domain.flutter_video_play.slice();
  if (domain.flutter_video_download && domain.flutter_video_download.length) S.vdl = domain.flutter_video_download.slice();
  if (domain.audio_download && domain.audio_download.length) S.audl = domain.audio_download.slice();
}
function hostCandidates() {
  const list = [];
  if (S && S.host) list.push(S.host);
  if (S && S.api) for (const h of S.api) if (list.indexOf(h) < 0) list.push(h);
  for (const h of SEED_HOSTS) if (list.indexOf(h) < 0) list.push(h);
  return list;
}
function buildHeaders(token) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = md5Hex(md5Hex('0.0.0.0.3.' + ts + '..' + S.uuid) + SIGN_SALT);
  return {
    'platform': '3', 'uuid': S.uuid, 'timestamp': String(ts),
    'token': token === undefined ? (S.token || '') : token,
    'app-version': APP_VERSION, 'sign': sign, 'user-key': '', 'ip': '0.0.0.0',
    'User-Agent': UA, 'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded',
  };
}
function parsePayload(text) {
  if (text === null || text === undefined) return null;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  const s = str.trim();
  if (!s) return null;
  if (s.charAt(0) === '{') { try { return JSON.parse(s); } catch (e) { return null; } }
  let plain = '';
  try { plain = aesDecryptCbc(APP_KEY, APP_IV, s); } catch (e) { plain = ''; }
  if (!plain) return null;
  try { return JSON.parse(plain); } catch (e) { return null; }
}
async function postRaw(host, path, params, token) {
  const qs = encQuery(params);
  const body = qs ? aesEncryptCbcBase64(APP_KEY, APP_IV, qs) : '';
  const { data } = await req.post(host + '/v2.5/' + path, body, { headers: buildHeaders(token), timeout: 25000 });
  return parsePayload(data);
}
async function bootstrap(force) {
  loadSession();
  if (!force && S.token && S.host) return S;
  const hosts = hostCandidates();
  let lastErr = null;
  for (const h of hosts) {
    try {
      const json = await postRaw(h, 'bootstrap', null, '');
      if (json && json.code === 200 && json.data) {
        const user = json.data.user || {};
        S.host = h; S.token = user.token || '';
        applyDomains(json.data.domain);
        S.ts = Date.now();
        return S;
      }
      lastErr = new Error('bootstrap ' + (json && json.code));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('ONE 初始化失败');
}
async function call(path, params, opts) {
  opts = opts || {};
  loadSession();
  let retried = false;
  let bootstrapped = !!S.token;
  for (let attempt = 0; attempt < 3; attempt++) {
    const hosts = hostCandidates();
    let lastErr = null;
    for (const h of hosts) {
      try {
        const json = await postRaw(h, path, params, opts.tokenOverride);
        if (!json) { lastErr = new Error('empty response'); continue; }
        if (json.code === 200) {
          if (!opts.tokenOverride) S.host = h;
          return json.data;
        }
        if (json.code === 401) { lastErr = new Error('401 ' + (json.message || '')); break; }
        throw new Error('ONE ' + json.code + ' ' + (json.message || ''));
      } catch (e) { lastErr = e; }
    }
    if (!retried && (String(lastErr && lastErr.message || '').indexOf('401') >= 0 || !bootstrapped)) {
      retried = true;
      await bootstrap(true);
      bootstrapped = true;
      continue;
    }
    throw lastErr || new Error('ONE 请求失败');
  }
  throw new Error('ONE 请求失败');
}

// ---------- 封面 ----------
function hostIsBad(h) { for (const b of BAD_HOSTS) if (String(h).indexOf(b) >= 0) return true; return false; }
function imgHosts() {
  const list = [];
  const add = (arr) => {
    if (!arr) return;
    for (const raw of arr) {
      const h = String(raw || '').replace(/\/+$/, '');
      if (!h || list.indexOf(h) >= 0 || hostIsBad(h)) continue;
      list.push(h);
    }
  };
  if (S) { add(S.fimg); add(S.resource); }
  add(PLAIN_HOSTS);
  return list;
}
function pathOf(url) {
  const m = String(url || '').match(/^https?:\/\/[^\/]+(\/.*)$/);
  return m ? m[1] : String(url || '');
}
function pickImgHost(p) {
  const hosts = imgHosts();
  if (!hosts.length) return 'https://img807.hkq57tt.com';
  let h = 0;
  for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0;
  return hosts[h % hosts.length];
}
function absImage(path) {
  if (!path) return '';
  const p = String(path);
  if (/^https?:\/\//.test(p)) {
    for (const eh of ENC_HOSTS) if (p.indexOf(eh) >= 0) return pickImgHost(pathOf(p)) + pathOf(p);
    return p;
  }
  return pickImgHost(p) + (p.charAt(0) === '/' ? '' : '/') + p;
}
function gifToJpeg(url) {
  if (!/\.gif(\?|$)/i.test(String(url))) return url;
  return IMG_PROXY + encodeURIComponent(url) + '&output=jpg&w=520';
}
function bestImage(a) {
  if (!a) return '';
  const cands = [a.thumbnail, a.thumb, a.video_cover, a.cover, a.thumb_tiny];
  if (a.multi_pic_thumbnail && a.multi_pic_thumbnail.length) cands.push(...a.multi_pic_thumbnail);
  if (a.thumbnail_list && a.thumbnail_list.length) cands.push(...a.thumbnail_list);
  let gif = '';
  for (const c of cands) {
    const u = absImage(c);
    if (!u) continue;
    if (/\.gif(\?|$)/i.test(u)) { if (!gif) gif = u; continue; }
    return u;
  }
  return gif ? gifToJpeg(gif) : '';
}

// ---------- 分区分类 ----------
const VIDEO_MODELS = [6, 3];
const PARTITIONS = [
  { id: 'jp', tag: 2, title: '日本' },
  { id: 'cn', tag: 3, title: '国产' },
  { id: 'us', tag: 1, title: '欧美' },
  { id: 'live', tag: 4, title: 'ONE直播' },
];
function partitionById(pid) {
  const key = String(pid || '').toLowerCase();
  for (const p of PARTITIONS) if (p.id === key) return p;
  return null;
}
function partitionByTag(tag) {
  const t = parseInt(tag, 10);
  for (const p of PARTITIONS) if (p.tag === t) return p;
  return null;
}
function monthStart(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (parseInt(offset, 10) || 0));
  const m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m) + '-01';
}
function monthLabel(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (parseInt(offset, 10) || 0));
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
}
const TAG_US = /^(欧美|美国|英国|德国|法国|意大利|西班牙|荷兰|瑞典|瑞士|奥地利|波兰|捷克|匈牙利|罗马尼亚|保加利亚|俄罗斯|乌克兰|白俄罗斯|拉脱维亚|立陶宛|爱沙尼亚|巴西|墨西哥|阿根廷|哥伦比亚|秘鲁|智利|古巴|委内瑞拉|拉美|拉丁|加拿大|澳洲|澳大利亚|新西兰|印度|泰国|越南|菲律宾|印尼|马来西亚|阿拉伯|异域|土耳其|迪拜|以色列|伊朗|黑人|金发|白人|碧眼|西方|外国|欧美无码|欧美精品)$/;
const TAG_JP = /^(日本|日系|日韩|日本无码|日本精品)$/;
const TAG_CN = /^(国产|国语|华语|国产精品|国产无码|港台|台湾|香港|新加坡)$/;
function tagList(a) {
  const arr = (a && a.tags) || [];
  const out = [];
  for (const t of arr) {
    const v = typeof t === 'string' ? t : (t && (t.slug || t.name || t.title || t.tag_name)) || '';
    const vv = String(v).replace(/\s+/g, ' ').trim();
    if (vv) out.push(vv);
  }
  return out;
}
function regionByTags(a) {
  const tags = tagList(a);
  let us = 0; let jp = 0; let cn = 0;
  for (const s of tags) {
    if (TAG_US.test(s)) us++;
    else if (TAG_JP.test(s)) jp++;
    else if (TAG_CN.test(s)) cn++;
  }
  if (us && us >= jp && us >= cn) return 'us';
  if (jp && jp >= cn) return 'jp';
  if (cn) return 'cn';
  return '';
}
function classifyByText(a) {
  const title = String(pick(a.title, a.video_name, '') || '');
  const s = title + ' ' + String(a.author || '');
  const low = s.toLowerCase();
  if (/[\u3040-\u30ff]/.test(s)) return 'jp';
  if (/(p站|pornhub|onlyfans|fansly|faphouse|pjgirls|deeper|tushy|vixen|blacked|brazzers|realitykings|naught(y|iamerica)|bangbros|teamskeet|mylf|chaturbate|cb站|推特|x站|洋马|白人|金发|碧眼|欧美|美国|英国|德国|法国|俄罗斯|乌克兰|巴西|拉美|拉丁|大洋马|洋妞|老外|外国|bbc|bwc|尼哥|黑大炮|捷克|西班牙|意大利|加拿大|澳洲|印度|泰国|越南|菲律宾|印尼|马来西亚|阿拉伯|异域|土耳其|迪拜|以色列|韩国|韩系|波兰|匈牙利|罗马尼亚|latina|ebony|russian|blonde)/i.test(low)) return 'us';
  if (/\b[a-z]{2,5}[-_]\d{2,5}\b/.test(low)) return 'jp';
  if (/(无码|有码|人妻|女优|痴女|素人|日系|日本|和服|风俗|fc2|heyzo|jav|myfans|oppai|s1|sod|falen|moodyz|prestige|ideapocket|ipx|ssni|miaa|madonna|ダスッ|カリビアン|加勒比|一本道|天然むすめ|tokyo\s*hot|10musume|heydouga|无修正|中文字幕|熟女|女教师|痴汉|电车|东京|大阪|温泉)/i.test(s)) return 'jp';
  if (/(ai短剧|短剧|探花|门事件|绿播|福利姬|网红|主播|大秀|微密圈|抖音|快手|b站|私拍|旗袍|学生妹|御姐|大圈|传媒|天美|麻豆|星空|糖心|91|抖阴|杏吧|蜜桃|精东|国产|国语|华语|coser|cosplay|推特福利|私人订制|定制合集)/i.test(s)) return 'cn';
  const cjk = (s.match(/[\u3400-\u9fff]/g) || []).length;
  const lat = (s.match(/[a-z]/gi) || []).length;
  if (lat > cjk * 1.5 && lat > 6) return 'us';
  return 'cn';
}
const STRONG_US = /(p站|onlyfans|fansly|faphouse|pjgirls|deeper|tushy|vixen|blacked|brazzers|realitykings|bangbros|teamskeet|mylf|chaturbate|cb站|推特|fansone|manyvids)/i;
const STRONG_CN = /(ai短剧|短剧|探花|门事件|绿播|微密圈|抖音|快手|b站|91|抖阴|杏吧|麻豆|天美|糖心|精东|国语|华语|国产精品)/i;
function classifyPart(a) {
  const title = String(pick(a.title, a.video_name, '') || '');
  if (title.indexOf('[ONE直播') >= 0) return 'live';
  if (/直播回放/.test(title) && /one直播/i.test(title)) return 'live';
  if (STRONG_US.test(title)) return 'us';
  if (STRONG_CN.test(title)) return 'cn';
  if (/[\u3040-\u30ff]/.test(title)) return 'jp';
  if (/\b[a-z]{2,5}[-_]\d{2,5}\b/i.test(title)) return 'jp';
  const byTag = regionByTags(a);
  if (byTag) return byTag;
  return classifyByText(a);
}
function modelName(mid) {
  const m = parseInt(mid, 10);
  if (m === 1) return '图集';
  if (m === 2 || m === 3) return '视频';
  if (m === 4) return '图文';
  if (m === 5) return '音频';
  if (m === 6) return '长视频';
  return '内容';
}
function stripLiveTag(title) {
  const s = String(title || '');
  const m = s.match(/^\[(ONE\s*直播[^\]]*)\]\s*/i);
  if (!m) return { title: s, live: false };
  return { title: s.slice(m[0].length).trim(), live: true };
}
function isPreviewOnly(a) {
  if (!a) return true;
  if (String(a.video_download || '')) return false;
  const file = String(a.video_file || '');
  if (!file) {
    if (!String(a.preview_video || '')) return false;
    return true;
  }
  if (String(a.preview_video || '') === file) return true;
  if (/preview|sample|_pr\.mp4|-pr\.mp4/i.test(file)) return true;
  return false;
}
function articleItem(a, fallbackCover) {
  const id = a.id;
  const cover = bestImage(a) || (fallbackCover || '');
  const liveInfo = stripLiveTag(clean(pick(a.title, a.video_name, 'ONE #' + id)));
  const bits = [];
  bits.push(liveInfo.live ? '直播回放' : modelName(a.model_id));
  if (a.author) bits.push(clean(a.author));
  if (a.published_at) bits.push(String(a.published_at).slice(0, 10));
  if (a.views) bits.push('观看 ' + a.views);
  if (a.like_number) bits.push('赞 ' + a.like_number);
  if (sizeLabel(a.size)) bits.push(sizeLabel(a.size));
  const sec = durationSeconds(a);
  const item = {
    vod_id: 'one:' + id,
    vod_name: liveInfo.title,
    vod_pic: cover,
    vod_remarks: (isPreviewOnly(a) ? '预告 · ' : '') + bits.join(' · '),
  };
  if (sec > 0) item.vod_remarks += ' · ' + secondsToText(sec);
  return item;
}

// ---------- 月度流 / 分区 / 最新 / 热门 ----------
const MONTH_CACHE = {};
const PART_CACHE = {};
function monthTtl(offset) {
  return (parseInt(offset, 10) || 0) <= 1 ? 10 * 60 * 1000 : 12 * 60 * 60 * 1000;
}
async function fetchMonthPage(model, offset, page, size, sortMode) {
  try {
    const arr = await call('article/discovery', {
      model_id: model, published_at: monthStart(offset), page, size, sort: sortMode || 'published_at',
    });
    return arr || [];
  } catch (e) { return []; }
}
async function monthFeed(offset) {
  const key = 'm' + offset;
  const c = MONTH_CACHE[key];
  if (c && Date.now() - c.ts < monthTtl(offset)) return c.arr;
  const firsts = await Promise.all(VIDEO_MODELS.map((m) => fetchMonthPage(m, offset, 1, 100)));
  const chunks = [];
  const moreJobs = [];
  for (let mi = 0; mi < firsts.length; mi++) {
    const p1 = firsts[mi] || [];
    chunks.push(p1);
    if (p1.length >= 100) for (let pg = 2; pg <= 4; pg++) moreJobs.push(fetchMonthPage(VIDEO_MODELS[mi], offset, pg, 100));
  }
  if (moreJobs.length) {
    const mores = await Promise.all(moreJobs);
    for (const mo of mores) chunks.push(mo || []);
  }
  const arr = []; const seen = {};
  for (const chunk of chunks) {
    for (const it of (chunk || [])) {
      const id = String(it.id);
      if (seen[id]) continue;
      if (isPreviewOnly(it)) continue;
      seen[id] = 1;
      arr.push(it);
    }
  }
  arr.sort((x, y) => String(y.published_at || '').localeCompare(String(x.published_at || '')));
  MONTH_CACHE[key] = { ts: Date.now(), arr };
  return arr;
}
async function partitionFeed(part, offset) {
  const key = part.id + ':' + offset;
  const c = PART_CACHE[key];
  if (c && Date.now() - c.ts < monthTtl(offset)) return c.arr;
  const all = await monthFeed(offset);
  const out = [];
  for (const it of all) if (classifyPart(it) === part.id) out.push(it);
  out.sort((x, y) => String(y.published_at || '').localeCompare(String(x.published_at || '')));
  PART_CACHE[key] = { ts: Date.now(), arr: out };
  return out;
}
const NEWEST = { items: [], seen: {}, off: 0, emptyRun: 0, done: false };
async function newestItems(page, size) {
  const need = page * size;
  while (NEWEST.items.length < need && !NEWEST.done && NEWEST.off < 400) {
    const arr = await monthFeed(NEWEST.off);
    if (!arr.length) { NEWEST.emptyRun++; NEWEST.off++; if (NEWEST.emptyRun >= 8) NEWEST.done = true; continue; }
    NEWEST.emptyRun = 0;
    const label = monthLabel(NEWEST.off);
    for (const it of arr) {
      const key = String(it.id);
      if (NEWEST.seen[key]) continue;
      NEWEST.seen[key] = 1;
      const item = articleItem(it);
      item.vod_remarks = label + ' · ' + item.vod_remarks;
      NEWEST.items.push(item);
    }
    NEWEST.off++;
  }
  const start = (page - 1) * size;
  return { list: NEWEST.items.slice(start, start + size), more: !NEWEST.done };
}
const HOTMONTH = {};
async function hotMonth(offset) {
  const key = 'h' + offset;
  const c = HOTMONTH[key];
  if (c && Date.now() - c.ts < (offset <= 1 ? 10 * 60 * 1000 : 6 * 60 * 60 * 1000)) return c.arr;
  const parts = await Promise.all(VIDEO_MODELS.map((m) => fetchMonthPage(m, offset, 1, 100, 'like_number')));
  const arr = []; const seen = {};
  for (const chunk of parts) {
    for (const it of (chunk || [])) {
      const id = String(it.id);
      if (seen[id]) continue;
      if (isPreviewOnly(it)) continue;
      seen[id] = 1;
      arr.push(it);
    }
  }
  arr.sort((x, y) => (parseInt(y.like_number, 10) || 0) - (parseInt(x.like_number, 10) || 0));
  HOTMONTH[key] = { ts: Date.now(), arr };
  return arr;
}
const HOT = { items: [], seen: {}, off: 0, emptyRun: 0, done: false };
async function hotItems(page, size) {
  const need = page * size;
  while (HOT.items.length < need && !HOT.done && HOT.off < 400) {
    const arr = await hotMonth(HOT.off);
    if (!arr.length) { HOT.emptyRun++; HOT.off++; if (HOT.emptyRun >= 8) HOT.done = true; continue; }
    HOT.emptyRun = 0;
    const label = monthLabel(HOT.off);
    for (const it of arr) {
      const key = String(it.id);
      if (HOT.seen[key]) continue;
      HOT.seen[key] = 1;
      const item = articleItem(it);
      item.vod_remarks = label + ' 热门 · ' + item.vod_remarks;
      HOT.items.push(item);
    }
    HOT.off++;
  }
  const start = (page - 1) * size;
  return { list: HOT.items.slice(start, start + size), more: !HOT.done };
}
const PALL = {};
async function regionItems(part, page, size) {
  const need = page * size;
  let st = PALL[part.id];
  if (!st) { st = { items: [], seen: {}, off: 0, emptyRun: 0, done: false }; PALL[part.id] = st; }
  while (st.items.length < need && !st.done && st.off < 400) {
    const arr = await partitionFeed(part, st.off);
    if (!arr.length) { st.emptyRun++; st.off++; if (st.emptyRun >= 8) st.done = true; continue; }
    st.emptyRun = 0;
    const label = monthLabel(st.off);
    for (const it of arr) {
      const key = String(it.id);
      if (st.seen[key]) continue;
      st.seen[key] = 1;
      const item = articleItem(it);
      item.vod_remarks = label + ' · ' + item.vod_remarks;
      st.items.push(item);
    }
    st.off++;
  }
  const from = (page - 1) * size;
  return { list: st.items.slice(from, from + size), more: !st.done };
}
async function liveItems(part, page, size) {
  const arr = await call('article/search', { keyword: 'ONE直播', model_id: 0, series_category: 0, page, size });
  const out = [];
  for (const it of (arr || [])) {
    if (isPreviewOnly(it)) continue;
    out.push(articleItem(it));
  }
  return { list: out, more: out.length >= size };
}

// ---------- 详情 / 播放 ----------
const STREAM_CACHE = new Map();
// 用户真机确认：线路 1 的 host（46e9nz.mfpt8g.com）在他手机上所有片都播不了，
// 其余线路正常；VM 侧 5 个 host 都通（46e9nz 首字节最慢），不能坐实是 host 死了，
// 但删掉这条线只剩 4 条可用线，代价为零，故按用户令过滤该 host。
// 注意：不过滤下标、只过滤 host 身份——会话 host 顺序若轮换，坏 host 在哪都照样滤掉；
// 序号按用户 2026-10-31 令顺延重排：剩下的可用线依次叫线路 1-5（不叫 2-6）。
const BAD_VIDEO_HOSTS = ['46e9nz.mfpt8g.com'];
function isBadVideoHost(h) {
  for (const b of BAD_VIDEO_HOSTS) if (String(h).indexOf(b) >= 0) return true;
  return false;
}
function videoHosts() {
  const list = [];
  const add = (arr) => {
    if (!arr) return;
    for (const raw of arr) {
      const h = String(raw || '').replace(/\/+$/, '');
      if (!h || list.indexOf(h) >= 0 || hostIsBad(h)) continue;
      list.push(h);
    }
  };
  if (S) { add(S.video); add(S.vdl); add(S.vplay); add(S.audl); add(S.audio); }
  if (!list.length) list.push('https://f86xxm.upmf83.com');
  return list;
}
function absVideo(path, kind) {
  if (!path) return '';
  const p = String(path);
  if (/^https?:\/\//.test(p)) return p;
  const hosts = kind === 'hls' ? (S && S.video_hls) : kind === 'audio' ? (S && S.audio) : (S && S.video);
  const hs = (hosts && hosts.length) ? hosts : ['https://46e9nz.mfpt8g.com'];
  return hs[0] + (p.charAt(0) === '/' ? '' : '/') + p;
}
function videoLines(a) {
  const lines = [];
  const hosts = videoHosts();
  const pushMp4 = (path, label) => {
    if (!path) return;
    const p = String(path);
    // 坏 host 跳过，序号按保留下来的线顺延重排 1-5
    const cands = [];
    for (let i = 0; i < hosts.length; i++) {
      if (isBadVideoHost(hosts[i])) continue;
      cands.push(hosts[i]);
      if (cands.length >= 5) break;
    }
    for (let j = 0; j < cands.length; j++) {
      const url = /^https?:\/\//.test(p) ? p : cands[j] + (p.charAt(0) === '/' ? '' : '/') + p;
      lines.push({ name: label + '·线路' + (j + 1) + (/h265/i.test(p) ? '(H.265)' : ''), url });
    }
  };
  const previewOnly = isPreviewOnly(a);
  // pushMp4 内坏 host 跳过，序号按保留下来的线顺延重排 1-5（用户令）
  pushMp4(a.video_download, '完整版MP4');
  if (!previewOnly && a.video_file && String(a.video_file) !== String(a.video_download || '')) pushMp4(a.video_file, 'MP4');
  else if (previewOnly) pushMp4(a.video_file, '预告MP4');
  if (!lines.length || previewOnly) {
    if (a.video_hls) lines.push({ name: 'HLS备用', url: absVideo(a.video_hls, 'hls') });
    if (a.video_hls_h265) lines.push({ name: 'HLS H.265备用', url: absVideo(a.video_hls_h265, 'hls') });
  }
  if (a.audio_file) lines.push({ name: '音频', url: absVideo(a.audio_file, 'audio') });
  if (a.audio_hls) lines.push({ name: '音频HLS', url: absVideo(a.audio_hls, 'hls') });
  if (!lines.length && a.preview_video) lines.push({ name: '预览', url: absVideo(a.preview_video) });
  return lines;
}
async function fetchArticle(id) {
  await bootstrap(false);
  const a = await call('article/detail', { id });
  if (!a) throw new Error('ONE 未返回详情：' + id);
  return a;
}
async function resolveArticle(id) {
  const cached = STREAM_CACHE.get(id);
  if (cached && Date.now() - cached.ts < STREAM_TTL) return cached;
  const a = await fetchArticle(id);
  const lines = videoLines(a);
  const rec = { article: a, lines, ts: Date.now() };
  if (STREAM_CACHE.size > 100) STREAM_CACHE.delete(STREAM_CACHE.keys().next().value);
  STREAM_CACHE.set(id, rec);
  return rec;
}
function articleDesc(a) {
  const bits = [];
  bits.push(modelName(a.model_id));
  if (a.author) bits.push(clean(a.author));
  if (a.published_at) bits.push(String(a.published_at).slice(0, 10));
  if (a.views) bits.push('观看 ' + a.views);
  if (a.like_number) bits.push('赞 ' + a.like_number);
  if (a.collection_number) bits.push('收藏 ' + a.collection_number);
  if (a.is_limit_free) bits.push('限时免费');
  const dsec = durationSeconds(a);
  if (dsec > 0) bits.push(secondsToText(dsec));
  if (sizeLabel(a.size)) bits.push(sizeLabel(a.size));
  const head = bits.join(' · ');
  const body = clean(pick(a.description, a.video_name, ''));
  return body ? head + '\n' + body : head;
}

// ---------- 关键词分类 ----------
// 服务端没有标签筛选接口（discovery 只给 model/月份/排序），故与日本/国产/欧美分区
// 同机理：复用 monthFeed 月度流（已滤预告），按标题+标签+作者文本匹配；
// 命中是文本口径、非服务端标签，分类名即匹配词本身，不编造不存在的筛选。
const KW_CATS = [
  { id: 'kw_wuma', title: '无码流出', re: /无码|无修正|流出|泄露|破解/ },
  { id: 'kw_juru', title: '巨乳', re: /巨乳|爆乳|大奶|美乳|大胸|G杯|H杯|I杯|J杯/ },
  { id: 'kw_dapigu', title: '大屁股', re: /大屁股|巨臀|丰臀|美臀|翘臀|蜜桃臀|大臀|肥臀/ },
  { id: 'kw_renqi', title: '人妻', re: /人妻|熟女|少妇|已婚|主妇/ },
  { id: 'kw_zhifu', title: '制服', re: /制服|女教师|空姐|护士|女警|女仆|秘书|职业装/ },
  { id: 'kw_duanju', title: '短剧', re: /短剧/ },
];
function kwText(a) {
  return [pick(a.title, a.video_name, ''), tagList(a).join(' '), String(a.author || '')].join(' ');
}
const KWALL = {};
async function kwItems(cat, page, size) {
  const need = page * size;
  let st = KWALL[cat.id];
  if (!st) { st = { items: [], seen: {}, off: 0, emptyRun: 0, done: false }; KWALL[cat.id] = st; }
  while (st.items.length < need && !st.done && st.off < 400) {
    const arr = await monthFeed(st.off);
    if (!arr.length) { st.emptyRun++; st.off++; if (st.emptyRun >= 8) st.done = true; continue; }
    st.emptyRun = 0;
    const label = monthLabel(st.off);
    for (const it of arr) {
      if (!cat.re.test(kwText(it))) continue;
      const key = String(it.id);
      if (st.seen[key]) continue;
      st.seen[key] = 1;
      const item = articleItem(it);
      item.vod_remarks = label + ' · ' + item.vod_remarks;
      st.items.push(item);
    }
    st.off++;
  }
  const from = (page - 1) * size;
  return { list: st.items.slice(from, from + size), more: !st.done };
}

// ---------- 猫源路由 ----------
const CATS = [
  { type_id: 'newest', type_name: '最新视频' },
  { type_id: 'hot', type_name: '热门视频' },
  { type_id: 'jp', type_name: '日本' },
  { type_id: 'cn', type_name: '国产' },
  { type_id: 'us', type_name: '欧美' },
  { type_id: 'live', type_name: 'ONE直播' },
  { type_id: 'kw_wuma', type_name: '无码流出' },
  { type_id: 'kw_juru', type_name: '巨乳' },
  { type_id: 'kw_dapigu', type_name: '大屁股' },
  { type_id: 'kw_renqi', type_name: '人妻' },
  { type_id: 'kw_zhifu', type_name: '制服' },
  { type_id: 'kw_duanju', type_name: '短剧' },
];
const PAGE_SIZE = 24;

async function home() {
  let list = [];
  try {
    await bootstrap(false);
    const r = await newestItems(1, PAGE_SIZE);
    list = r.list;
  } catch (e) { list = []; }
  return { class: CATS, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(Array.isArray(body.id) ? body.id[0] : body.id || body.tid || 'newest');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let r = { list: [], more: false };
  try {
    await bootstrap(false);
    if (tid === 'newest') r = await newestItems(page, PAGE_SIZE);
    else if (tid === 'hot') r = await hotItems(page, PAGE_SIZE);
    else if (tid === 'live') r = await liveItems(partitionById('live'), page, PAGE_SIZE);
    else if (tid.indexOf('kw_') === 0) {
      const cat = KW_CATS.find((c) => c.id === tid);
      if (cat) r = await kwItems(cat, page, PAGE_SIZE);
    }
    else {
      const part = partitionById(tid);
      if (part) r = await regionItems(part, page, PAGE_SIZE);
    }
  } catch (e) { r = { list: [], more: false }; }
  return { page, pagecount: r.more || r.list.length >= PAGE_SIZE ? page + 1 : page, list: r.list };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  if (!kw) return { list: [] };
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  try {
    await bootstrap(false);
    const arr = await call('article/search', { keyword: kw, model_id: 0, series_category: 0, page, size: PAGE_SIZE });
    return { list: (arr || []).map((a) => articleItem(a)) };
  } catch (e) { return { list: [] }; }
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  id = id.replace(/^one:/, '');
  if (!id || !/^\d+$/.test(id)) return { list: [] };
  let rec;
  try { rec = await resolveArticle(id); } catch (e) { return { list: [] }; }
  const a = rec.article;
  const cover = bestImage(a);
  const liveInfo = stripLiveTag(clean(pick(a.title, a.video_name, 'ONE #' + id)));
  let playFrom = [];
  let playUrls = [];
  if (rec.lines.length) {
    playFrom.push('ONE');
    playUrls.push(rec.lines.map((l) => l.name + '$' + l.url).join('#'));
  }
  return {
    list: [{
      vod_id: 'one:' + id,
      vod_name: liveInfo.title,
      vod_pic: cover,
      vod_remarks: (isPreviewOnly(a) ? '预告 · ' : '') + modelName(a.model_id),
      vod_play_from: playFrom.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
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
  return { parse: 0, url, header: { 'User-Agent': UA } };
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
