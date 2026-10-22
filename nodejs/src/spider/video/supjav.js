import req from '../../util/req.js';

const KEY = 'py_supjav';
const NAME = 'SupJav';
const HOST = 'https://supjav.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 走代理过 Cloudflare
const PROXY_BASE = 'https://py.fzcrym.link:1314';
const FS_PAGE_API = PROXY_BASE + '/fs?u=';
const PAGE_API = PROXY_BASE + '/page?u=';

// supjav-fetch Worker（取页机会通道之一；播放解析里另作 lk1 的备用出口——
// v1 在岗时对 lk1 回 "host not allowed" 自动判败，v2 在岗时可手工跟跳转
// 并提供 /wrap 包装页。部署状态不影响其余通道）
const FETCH_WORKER = 'https://supjav-fetch.li768435813.workers.dev';
const LK_BASE = 'https://lk1.supremejav.com/supjav.php';

const CATS = [
  ['__home', '最新'],
  ['__popular', '热门'],
  ['__trending', '趋势'],
  ['censored-jav', '有码 Censored'],
  ['uncensored-jav', '无码 Uncensored'],
  ['amateur', '素人 Amateur'],
  ['chinese-subtitles', '中文字幕 Chn Sub'],
  ['reducing-mosaic', '破解 Reducing Mosaic'],
  ['english-subtitles', '英文字幕 Eng Sub'],
];

const SORTS = [
  { key: 'sort', name: '排序', value: [{ n: '最新', v: '' }, { n: '最多观看', v: 'views' }] },
];

async function getText(url, timeout = 60000) {
  try {
    const { data } = await req.get(url, {
      headers: { 'User-Agent': UA },
      timeout,
    });
    return String(data || '');
  } catch (e) {
    return '';
  }
}

// ---------------- 取页通道（2026-10-22 晚重构） ----------------
// 旧版只有 fzcrym 一条路（/fs 220s×2 → /page 90s），2026-10-22 晚实测
// py.fzcrym.link 主机级死亡（根路径亦无响应、请求挂到超时 0 字节），
// 每个列表/详情请求要烧最长 530 秒、分类/搜索再整轮重试 2 次（最长
// ~26 分钟）才回空——即用户所报「特别特别慢、加载不出来」。
// 改法：多通道机会集 + 单通道熔断 + 总预算封顶。任一通道拿到真页面
// 即返回；失败通道 5 分钟内跳过（蜘蛛进程常驻，模块级状态跨请求有效），
// 通道复活后由后续请求自动探活恢复。校验沿用旧口径（非拦截页且
// >3000B），并补挡 "Attention Required" 硬封页（4.8KB 会漏过旧校验）。
const PAGE_CHANNELS = [
  { name: 'direct', timeout: 20000, build: (u) => u },
  { name: 'jina', timeout: 20000, build: (u) => 'https://r.jina.ai/' + u },
  { name: 'worker', timeout: 25000, build: (u) => FETCH_WORKER + '/?u=' + encodeURIComponent(u) },
  { name: 'fs', timeout: 30000, build: (u) => FS_PAGE_API + encodeURIComponent(u) },
  { name: 'page', timeout: 45000, build: (u) => PAGE_API + encodeURIComponent(u) },
];
const PAGE_BUDGET_MS = 75000;
const CHAN_COOLDOWN_MS = 5 * 60 * 1000;
const chanDeadUntil = {};

function goodPage(html) {
  return !!html && html.length > 3000 &&
    !html.includes('Just a moment') && !html.includes('Attention Required');
}

async function fetchPage(url) {
  const t0 = Date.now();
  for (const ch of PAGE_CHANNELS) {
    if (Date.now() - t0 > PAGE_BUDGET_MS) break;
    if ((chanDeadUntil[ch.name] || 0) > Date.now()) continue;
    const html = await getText(ch.build(url), ch.timeout);
    if (goodPage(html)) {
      delete chanDeadUntil[ch.name];
      return html;
    }
    chanDeadUntil[ch.name] = Date.now() + CHAN_COOLDOWN_MS;
  }
  return '';
}

function parseCards(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split('<div class="post">').slice(1);
  for (const b of blocks) {
    const m = b.match(new RegExp(`href="${HOST.replace(/\./g, '\\.')}/(\\d+)\\.html"`));
    if (!m) continue;
    const vid = m[1];
    if (seen.has(vid)) continue;
    const t = b.match(/title="([^"]+)"/);
    let title = t ? t[1] : '';
    title = title.replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;/g, '-').trim();
    if (!title) continue;
    seen.add(vid);
    let pic = '';
    for (const pat of [/<img[^>]+data-original="([^"]+)"/, /<img[^>]+data-src="([^"]+)"/, /<img[^>]+src="(https?:\/\/[^"]+)"/]) {
      const pm = b.match(pat);
      if (pm) { pic = pm[1]; break; }
    }
    if (pic.startsWith('//')) pic = 'https:' + pic;
    let code = '';
    const cm = title.match(/\b([A-Z]{2,6}-?\d{2,6}|FC2PPV[\s-]?\d{5,8})\b/);
    if (cm) code = cm[1];
    out.push({
      vod_id: vid,
      vod_name: title.slice(0, 90),
      vod_pic: pic,
      vod_remarks: code,
    });
  }
  return out;
}

function pagecount(html, cur) {
  const nums = [...String(html || '').matchAll(/\/page\/(\d+)/g)].map(x => parseInt(x[1], 10));
  if (!nums.length) return cur;
  return Math.max(...nums, cur);
}

async function init() {
  return {};
}

async function home() {
  const classes = CATS.map(([id, name]) => ({ type_id: id, type_name: name }));
  const filters = {};
  for (const [cid] of CATS) {
    if (!cid.startsWith('__')) filters[cid] = SORTS;
  }
  return { class: classes, filters };
}

async function homeVod() {
  const html = await fetchPage(HOST + '/');
  return { list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || '__home').trim();
  const ext = body.filters || body.extend || {};
  const sort = String(ext.sort || '').trim();
  let url;
  if (tid === '__home') {
    url = page === 1 ? HOST + '/' : `${HOST}/page/${page}/`;
  } else if (tid === '__popular') {
    url = page === 1 ? HOST + '/popular/' : `${HOST}/popular/page/${page}/`;
  } else if (tid === '__trending') {
    url = page === 1 ? HOST + '/trending/' : `${HOST}/trending/page/${page}/`;
  } else {
    const base = HOST + '/category/' + tid;
    url = page === 1 ? base + '/' : `${base}/page/${page}/`;
    if (sort) url += '?sort=' + encodeURIComponent(sort);
  }
  let html = await fetchPage(url);
  let items = parseCards(html);
  if (!items.length) {
    // 空结果整轮重试最多 1 次（旧版 2 次×530 秒级联是慢的主因之一）
    html = await fetchPage(url);
    items = parseCards(html);
  }
  return { page, pagecount: pagecount(html, page), limit: items.length || 24, total: items.length, list: items };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  let vid = String(ids[0] || '');
  vid = (vid.split('/').pop().replace('.html', '').replace(/\D/g, '')) || vid;
  const durl = `${HOST}/${vid}.html`;
  const html = await fetchPage(durl);

  let title = '';
  const tm = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
  if (tm) {
    title = tm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-').trim();
  }
  let pic = '';
  const pm = html.match(/background-image:\s*url\((https:\/\/img\.supjav\.com\/[^)]+)\)/);
  if (pm) pic = pm[1];
  if (!pic) {
    const im = html.match(/(https:\/\/img\.supjav\.com\/[^\s"'<>)]+\.(?:jpg|jpeg|png|webp)[^\s"'<>)]*)/i);
    if (im) pic = im[1];
  }
  if (pic.startsWith('//')) pic = 'https:' + pic;

  let views = '';
  const vm = html.match(/<span class="views">([^<]+)<\/span>/);
  if (vm) views = vm[1].trim();

  const tags = [];
  const tagRe = new RegExp(`href="${HOST.replace(/\./g, '\\.')}/(tag|actress)/([^"/]+)`, 'g');
  let tg;
  while ((tg = tagRe.exec(html)) !== null) {
    const s = tg[2].replace(/-/g, ' ').trim();
    if (s && !tags.includes(s)) tags.push(s);
  }
  let year = '';
  const ym = html.match(/\/images\/(\d{4})\//);
  if (ym) year = ym[1];

  // 线路 data-link（详情页常有两组重复的线路块，按 hex 去重）
  const links = [...html.matchAll(/data-link="([0-9a-f]{40,})"/g)].map(x => x[1]);
  const names = [...html.matchAll(/data-link="[0-9a-f]{40,}"[^>]*>([^<]{1,12})</g)].map(x => x[1].trim());
  const pairs = [];
  const seenHex = new Set();
  for (let i = 0; i < links.length; i++) {
    if (seenHex.has(links[i])) continue;
    seenHex.add(links[i]);
    const nm = names[i] || ('线路' + (pairs.length + 1));
    pairs.push([nm, `正片$${vid}|${links[i]}`]);
  }
  const LINE_ORDER = { VOE: 0, EVS: 10, LUC: 20, VAS: 30, FST: 35, ST: 40, TV: 90 };
  pairs.sort((a, b) => (LINE_ORDER[a[0].toUpperCase()] ?? 50) - (LINE_ORDER[b[0].toUpperCase()] ?? 50));
  const froms = pairs.map(p => p[0]);
  const urls = pairs.map(p => p[1]);

  let content = title;
  if (tags.length) content += '\n标签: ' + tags.slice(0, 10).join(', ');

  const vod = {
    vod_id: vid,
    vod_name: title || ('SupJav ' + vid),
    vod_pic: pic,
    vod_year: year,
    vod_remarks: views,
    vod_content: content.slice(0, 600),
    vod_play_from: froms.length ? froms.join('$$$') : 'SupJav',
    vod_play_url: urls.length ? urls.join('$$$') : ('正片$' + vid + '|'),
  };
  subRegister(ids, vod);
  return { list: [vod] };
}

// ================= 播放解析（2026-10-22 重构） =================
// 旧版死因（实测）: lk1 的 ?c= 回 302 跳到真嵌入页 (voe/streamtape/
// evsishere/...), 嵌入页正文里根本没有明文 m3u8——VOE 系是混淆 JSON
// 配置、EVS/LUC 是 packer 打包的 links、ST 靠 JS 拼 get_video——旧版只
// 用正则在 ?c= 正文里找明文 .m3u8, 必然全灭; 最后 parse:1 把 lk1 门页
// (?l=) 交给客户端嗅探, 而门页有顶层自毁逻辑 (top==location 就清空
// 页面), 嗅探也抓不到东西。本版改为服务端全程解算:
//   lk1 手工读跳转 → 嵌入页按签名分派解包 → 直链 parse:0;
//   ST 直链是 IP 绑定令牌, 服务端试活不过时改 parse:1 嗅探嵌入页本身
//   (播放器在自己的网络会话里打开嵌入页, 令牌自洽);
//   全灭的最后兜底也只给嵌入页/包装页, 不再给会自毁的门页。

function reverseStr(s) {
  return String(s || '').split('').reverse().join('');
}

// 带状态码/响应头的 GET（不自动抛错, 跳转由调用方决定跟不跟）
async function httpRaw(url, { headers = {}, timeout = 20000, maxRedirects = 5, responseType = 'text' } = {}) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, ...headers },
      timeout,
      maxRedirects,
      responseType,
      validateStatus: () => true,
    });
    let data = r.data;
    if (responseType === 'text' && data != null && typeof data !== 'string') {
      data = typeof data === 'object' ? JSON.stringify(data) : String(data);
    }
    return { status: r.status || 0, headers: r.headers || {}, data };
  } catch (e) {
    return { status: 0, headers: {}, data: responseType === 'arraybuffer' ? null : '' };
  }
}

function locOf(resp) {
  const loc = resp.headers?.location || resp.headers?.Location || '';
  return typeof loc === 'string' ? loc.trim() : '';
}

// lk1 取嵌入地址: ?c= 手工读 Location; 空跳转/失败时经门页 OLID 重试,
// 再失败试 supjav-fetch Worker 备用出口 (v2 才支持, v1 自动判败)。
// 返回 { embedUrl } 或 { embedBody, embedUrl } 或 null。
async function lkResolveEmbed(hex, detailUrl) {
  const gateUrl = `${LK_BASE}?l=${hex}`;
  const navHeaders = {
    'Referer': gateUrl,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
  };
  const tryC = async (h) => {
    const cUrl = `${LK_BASE}?c=${reverseStr(h)}`;
    const r = await httpRaw(cUrl, { headers: navHeaders, timeout: 15000, maxRedirects: 0 });
    const loc = locOf(r);
    if (loc) {
      try {
        const u = new URL(loc, cUrl);
        u.hash = '';
        return { embedUrl: u.toString() };
      } catch {}
    }
    const body = String(r.data || '');
    // 个别出口下 ?c= 直接回嵌入页正文（无跳转）
    if (body.length > 800 && !/OLID|start_player/.test(body)) return { embedBody: body, embedUrl: cUrl };
    return null;
  };
  // 直试两次 (lk1 本身抖)
  for (let i = 0; i < 2; i++) {
    const got = await tryC(hex);
    if (got) return got;
  }
  // 门页拿 OLID 再试 (OLID 实测与 data-link hex 相同, 但形态以站方为准)
  const gate = await httpRaw(gateUrl, { headers: { Referer: detailUrl, ...navHeaders }, timeout: 15000, maxRedirects: 0 });
  const gateBody = String(gate.data || '');
  const olidM = gateBody.match(/OLID\s*=\s*['"]([0-9a-fA-F]{32,})['"]/) || gateBody.match(/["']([0-9a-fA-F]{32,})["']/);
  if (olidM && olidM[1] && olidM[1] !== hex) {
    const got = await tryC(olidM[1]);
    if (got) return got;
  }
  // 备用出口: supjav-fetch Worker (v2 手工跟跳转回 x-final-url; v1 回
  // "host not allowed" 判败)。只在直连全灭时才走, 不拖慢正常路径。
  try {
    const w = await httpRaw(FETCH_WORKER + '/?u=' + encodeURIComponent(`${LK_BASE}?c=${reverseStr(hex)}`), { timeout: 30000, maxRedirects: 0 });
    const finalUrl = w.headers?.['x-final-url'] || '';
    const wbody = String(w.data || '');
    if (finalUrl && !/supjav\.php/.test(finalUrl) && wbody.length > 300) {
      return { embedBody: wbody, embedUrl: finalUrl };
    }
    if (wbody.length > 800 && !/host not allowed|bad url|upstream blocked/.test(wbody) && !/OLID|start_player/.test(wbody)) {
      return { embedBody: wbody, embedUrl: `${LK_BASE}?c=${reverseStr(hex)}` };
    }
  } catch {}
  return null;
}

// ---------- 通用提取 ----------
function extractStream(text) {
  const s = String(text || '');
  const m = s.match(/(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i);
  if (m && !/test-videos/i.test(m[1])) return m[1];
  const trimmed = s.trim();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      const u = j.url || j.file || j.source || j.m3u8 || '';
      if (/^https?:\/\//i.test(u)) return u;
    } catch {}
  }
  const mm = s.match(/(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/i);
  if (mm) return mm[1];
  return '';
}

// 主清单多档时挑最高档（RESOLUTION 优先，其次 BANDWIDTH）
async function pickTopVariant(url, headers) {
  if (!/\.m3u8(\?|$)/i.test(url)) return url;
  try {
    const r = await httpRaw(url, { headers, timeout: 20000 });
    const text = String(r.data || '');
    if (!text.includes('#EXT-X-STREAM-INF')) return url;
    const lines = text.split(/\r?\n/);
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
      let uri = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) { uri = lines[j].trim(); break; }
      }
      if (!uri) continue;
      const rm = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      const bm = line.match(/BANDWIDTH=(\d+)/i);
      const cand = { uri, h: rm ? parseInt(rm[2], 10) : 0, bw: bm ? parseInt(bm[1], 10) : 0 };
      if (!best || cand.h > best.h || (cand.h === best.h && cand.bw > best.bw)) best = cand;
    }
    if (!best) return url;
    if (/^https?:\/\//i.test(best.uri)) return best.uri;
    return url.slice(0, url.lastIndexOf('/') + 1) + best.uri.replace(/^\.\//, '');
  } catch (e) {
    return url;
  }
}

function playHeadersFor(videoUrl, embedUrl, detailUrl) {
  let ref = detailUrl || HOST + '/';
  // VOE 系 CDN 防盗链口径与 hanbj 蜘蛛在真机验通的一致
  if (/cloudwindow-route|ugc-cdn/i.test(videoUrl)) ref = 'https://jeremyparticipantanything.com/';
  else if (embedUrl) ref = embedUrl;
  return { 'User-Agent': UA, 'Referer': ref };
}

// ---------- VOE 家族解包（与 hanbj 蜘蛛同一算法） ----------
function rot13(s) {
  return String(s).replace(/[a-zA-Z]/g, (c) => {
    const b = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
  });
}
function b64d(x) {
  try {
    return Buffer.from(String(x).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) {
    return '';
  }
}
function voeDecode(html) {
  try {
    const m = String(html || '').match(/<script[^>]*type=["']application\/json["'][^>]*>(.*?)<\/script>/s);
    if (!m) return {};
    let raw = m[1].trim();
    try {
      const j = JSON.parse(raw);
      raw = (Array.isArray(j) && j.length) ? String(j[0]) : raw;
    } catch (e) {}
    let s = String(raw);
    for (const k of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) s = s.split(k).join('_');
    s = s.split('_').join('');
    let tt = b64d(rot13(s));
    let shifted = '';
    for (let i = 0; i < tt.length; i++) shifted += String.fromCharCode(tt.charCodeAt(i) - 3);
    tt = b64d(shifted.split('').reverse().join(''));
    const cfg = JSON.parse(tt);
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (e) {
    return {};
  }
}

// ---------- Dean-Edwards packer 解包（EVS/LUC 等 VidHide 系嵌入页） ----------
function unpackPacker(html) {
  const m = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)\)\)/);
  if (!m) return '';
  let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const radix = parseInt(m[2], 10);
  const count = parseInt(m[3], 10);
  const keys = m[4].split('|');
  for (let c = count - 1; c >= 0; c--) {
    if (keys[c]) {
      const tok = c.toString(radix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      p = p.replace(new RegExp('\\b' + tok + '\\b', 'g'), () => keys[c]);
    }
  }
  return p;
}

function hlsFromUnpacked(text) {
  const s = String(text || '');
  const found = [];
  const lm = s.match(/links\s*=\s*(\{[\s\S]*?\});/);
  const scope = lm ? lm[1] : s;
  const re = /["']?(hls\d+)["']?\s*:\s*["'](https?:\/\/[^"']+)["']/g;
  let mm;
  while ((mm = re.exec(scope)) !== null) {
    found.push({ key: mm[1], url: mm[2].replace(/\\\//g, '/') });
  }
  if (!found.length) {
    const any = [...s.matchAll(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|txt)[^\s"'<>\\]*/g)].map(x => x[0]);
    for (const u of any) found.push({ key: 'hls', url: u });
  }
  // 优先真 .m3u8（hls4 > hls2 > 其他），.txt 伪装清单最后
  const rank = (f) => {
    const isTxt = /\.txt(\?|$)/i.test(f.url);
    const n = parseInt((f.key.match(/\d+/) || ['0'])[0], 10);
    return (isTxt ? 100 : 0) - n;
  };
  found.sort((a, b) => rank(a) - rank(b));
  return found.map(f => f.url);
}

// 验一份清单地址真能出 #EXTM3U
async function verifyPlaylist(url, headers) {
  const r = await httpRaw(url, { headers, timeout: 20000 });
  const text = String(r.data || '');
  return r.status === 200 && text.includes('#EXTM3U') ? text : '';
}

// ---------- Streamtape: 求值 innerHTML 拼接表达式提 get_video 候选 ----------
function evalConcatExpr(expr) {
  const s = String(expr || '');
  let pos = 0;
  const skipWs = () => { while (pos < s.length && /\s/.test(s.charAt(pos))) pos++; };
  const parseStr = () => {
    const q = s.charAt(pos);
    if (q !== '"' && q !== "'") return null;
    pos++;
    let out = '';
    while (pos < s.length) {
      const c = s.charAt(pos);
      if (c === '\\' && pos + 1 < s.length) {
        const n = s.charAt(pos + 1);
        out += (n === 'n' ? '\n' : n === 't' ? '\t' : n);
        pos += 2;
        continue;
      }
      if (c === q) { pos++; return out; }
      out += c;
      pos++;
    }
    return null;
  };
  const parseNum = () => {
    const m = s.slice(pos).match(/^-?\d+/);
    if (!m) return null;
    pos += m[0].length;
    return parseInt(m[0], 10);
  };
  const parsePrimary = () => {
    skipWs();
    const c = s.charAt(pos);
    if (c === '(') {
      pos++;
      const v = parseExpr();
      skipWs();
      if (s.charAt(pos) === ')') pos++;
      return v;
    }
    if (c === '"' || c === "'") return parseStr();
    return null;
  };
  const parseTerm = () => {
    let v = parsePrimary();
    if (v === null) return null;
    for (;;) {
      skipWs();
      const mm = s.slice(pos).match(/^\.(substring|slice)\s*\(/);
      if (!mm) break;
      pos += mm[0].length;
      skipWs();
      const a = parseNum();
      skipWs();
      let b = null;
      if (s.charAt(pos) === ',') { pos++; skipWs(); b = parseNum(); skipWs(); }
      if (s.charAt(pos) === ')') pos++;
      if (a === null) return null;
      v = (mm[1] === 'substring') ? (b === null ? v.substring(a) : v.substring(a, b)) : (b === null ? v.slice(a) : v.slice(a, b));
    }
    return v;
  };
  const parseExpr = () => {
    let v = parseTerm();
    if (v === null) return null;
    for (;;) {
      skipWs();
      if (s.charAt(pos) !== '+') break;
      pos++;
      const rhs = parseTerm();
      if (rhs === null) return null;
      v = v + rhs;
    }
    return v;
  };
  try {
    const out = parseExpr();
    skipWs();
    if (pos < s.length && s.charAt(pos) !== ';') return null;
    return out;
  } catch (e) {
    return null;
  }
}

function stCandidates(html) {
  const s = String(html || '');
  const evaled = [];
  const re = /innerHTML\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const v = evalConcatExpr(m[1]);
    if (v && v.includes('get_video')) evaled.push(v);
  }
  const seen = new Set();
  const out = [];
  const add = (u) => {
    if (!u) return;
    u = String(u).trim();
    if (u.startsWith('//')) u = 'https:' + u;
    else if (!/^https?:\/\//i.test(u)) {
      if (/^[\w.-]+\.[a-z]{2,}\//i.test(u)) u = 'https://' + u;
      else return;
    }
    u = u.replace(/&amp;/g, '&');
    if (!u.includes('get_video') || seen.has(u)) return;
    // 诱饵域名（streamtape.cob 之类仿冒后缀）剔除：只认 streamtape 系真域
    try {
      const h = new URL(u).hostname;
      if (!/(^|\.)streamtape\.com$|(^|\.)amtape\.com$/.test(h)) return;
    } catch { return; }
    seen.add(u);
    out.push(u);
  };
  // 页面 JS 的最后一次有效赋值才是真地址，前面的多为诱饵
  for (let i = evaled.length - 1; i >= 0; i--) add(evaled[i]);
  for (const u of s.match(/https?:\/\/[^\s"'<>]+get_video\?[^\s"'<>]+/g) || []) add(u);
  for (const u of s.match(/\/\/[\w.-]+get_video\?[^\s"'<>]+/g) || []) add(u);
  return out;
}

// ST 的错误响应是 HTTP 200/403 + JSON {"status":...}，据此判活
async function probeStFile(url, referer) {
  const r = await httpRaw(url, {
    headers: { Referer: referer, Range: 'bytes=0-1023' },
    timeout: 20000,
  });
  if (!r.status) return false;
  const head = String(r.data || '').slice(0, 120);
  if (head.startsWith('{') && /"status"\s*:/.test(head)) return false;
  return r.status === 200 || r.status === 206;
}

// ---------- VAS 系（vvaassjjav 等）: /api/stream 换 streaming_url ----------
// 页面 JS: POST {origin}/api/stream {filecode, device, codecs} →
// {streaming_url, fallback_url}。该 API 在机房出口实测 47~84 秒才回
// (且时有超时)，只给 30 秒，超时即回退到嵌入页嗅探（播放器在手机会话
// 里跑页面原生流程，API 响应速度以真机环境为准）。
async function resolveVasApi(embedUrl, embedHtml) {
  try {
    const u = new URL(embedUrl);
    const codeM = u.pathname.match(/\/e\/([A-Za-z0-9]+)/);
    if (!codeM) return null;
    const code = codeM[1];
    // 先取嵌入页的 cookie（站方会话）
    let cookie = '';
    if (!embedHtml) {
      const g = await httpRaw(embedUrl, { headers: { Referer: HOST + '/' }, timeout: 15000 });
      const sc = g.headers?.['set-cookie'];
      if (Array.isArray(sc)) cookie = sc.map(x => String(x).split(';')[0]).join('; ');
    }
    const r = await req.post(u.origin + '/api/stream', {
      filecode: code, device: 'web', codecs: [],
    }, {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Origin': u.origin,
        'Referer': embedUrl,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    const j = typeof r.data === 'object' && r.data ? r.data : JSON.parse(String(r.data || '{}'));
    const su = j.streaming_url || j.fallback_url || '';
    if (/^https?:\/\//i.test(su)) return su;
  } catch (e) {}
  return null;
}

// ---------- 嵌入页解析分派 ----------
// 成功回 { url, header }（直链）；ST 令牌服务端试活不过时回
// { sniff: embedUrl }（让播放器在自身会话里打开嵌入页）；全败回 null。
async function resolveEmbed(embedUrl, embedBody, detailUrl) {
  let html = embedBody || '';
  let finalUrl = embedUrl;
  if (!html) {
    const r = await httpRaw(embedUrl, { headers: { Referer: detailUrl }, timeout: 25000 });
    html = String(r.data || '');
  }
  if (!html) return null;
  // VOE 系落地页先给一跳 JS 跳转到镜像域真嵌入页
  const jsJump = html.match(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/) ||
    html.match(/window\.location\.href\s*=\s*"(https?:\/\/[^"]+)"/);
  if (jsJump && html.length < 3000 && !/jwplayer|application\/json|get_video/.test(html)) {
    const r2 = await httpRaw(jsJump[1], { headers: { Referer: embedUrl }, timeout: 25000 });
    if (r2.data) { html = String(r2.data); finalUrl = jsJump[1]; }
  }

  const direct0 = extractStream(html);
  // 1) Streamtape 签名
  if (html.includes('get_video')) {
    const cands = stCandidates(html);
    for (const c of cands) {
      if (await probeStFile(c, finalUrl)) {
        return { url: c, header: playHeadersFor(c, finalUrl, detailUrl) };
      }
    }
    // 令牌与铸造出口 IP 绑定：服务端试活不过不代表播放器不行，
    // 交回嵌入页让播放器在自己的会话里铸造
    if (cands.length) return { sniff: finalUrl };
  }
  // 2) VAS 系 API 型
  if (/\/api\/stream/.test(html) && /filecode/i.test(html)) {
    const su = await resolveVasApi(finalUrl, html);
    if (su) {
      const top = /\.m3u8/i.test(su) ? await pickTopVariant(su, playHeadersFor(su, finalUrl, detailUrl)) : su;
      return { url: top, header: playHeadersFor(top, finalUrl, detailUrl) };
    }
    return { sniff: finalUrl };
  }
  // 3) VOE 家族混淆 JSON
  const cfg = voeDecode(html);
  const src = String(cfg.source || '');
  if (/\.m3u8/i.test(src)) {
    const hdr = playHeadersFor(src, finalUrl, detailUrl);
    return { url: await pickTopVariant(src, hdr), header: hdr };
  }
  const dau = String(cfg.direct_access_url || '');
  if (/^https?:\/\//i.test(dau)) return { url: dau, header: playHeadersFor(dau, finalUrl, detailUrl) };
  if (/^https?:\/\//i.test(src)) return { url: src, header: playHeadersFor(src, finalUrl, detailUrl) };
  // 4) packer 打包（EVS/LUC 等）
  if (/eval\(function\(p,a,c,k/.test(html)) {
    const unpacked = unpackPacker(html);
    const urls = hlsFromUnpacked(unpacked);
    for (const u of urls.slice(0, 3)) {
      const hdr = playHeadersFor(u, finalUrl, detailUrl);
      const pl = await verifyPlaylist(u, hdr);
      if (pl) {
        const top = await pickTopVariant(u, hdr);
        return { url: top, header: hdr };
      }
    }
  }
  // 5) 明文/jwplayer 兜底
  if (direct0) {
    const hdr = playHeadersFor(direct0, finalUrl, detailUrl);
    const top = /\.m3u8/i.test(direct0) ? await pickTopVariant(direct0, hdr) : direct0;
    return { url: top, header: hdr };
  }
  const jw = html.match(/jwplayer\([^)]*\)\.setup\(\{\s*file:\s*"([^"]+)"/i);
  if (jw) {
    const f = jw[1].replace(/\\\//g, '/');
    if (/^https?:\/\//i.test(f)) {
      const hdr = playHeadersFor(f, finalUrl, detailUrl);
      const top = /\.m3u8/i.test(f) ? await pickTopVariant(f, hdr) : f;
      return { url: top, header: hdr };
    }
  }
  return null;
}

// supjav-fetch v2 的 /wrap 探活（包装页把门页嵌进 iframe, 绕门页顶层自毁）
async function probeWrap(gateUrl) {
  try {
    const r = await httpRaw(FETCH_WORKER + '/wrap?u=' + encodeURIComponent(gateUrl), { timeout: 10000 });
    return String(r.data || '').includes('<iframe');
  } catch (e) {
    return false;
  }
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '');
  // id 格式: vid|hex_link
  const parts = id.split('|');
  const vid = parts[0] || '';
  const hex = parts[1] || '';
  if (!hex) {
    return { parse: 0, url: '', message: '无播放线路' };
  }
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  const detailUrl = `${HOST}/${vid}.html`;
  const gateUrl = `${LK_BASE}?l=${hex}`;
  const headers = { 'User-Agent': UA, 'Referer': detailUrl };
  try {
    const lk = await lkResolveEmbed(hex, detailUrl);
    if (lk && (lk.embedUrl || lk.embedBody)) {
      const got = await resolveEmbed(lk.embedUrl || '', lk.embedBody || '', detailUrl);
      if (got && got.url) {
        return subAttach({ parse: 0, url: got.url, header: got.header || headers }, subsP);
      }
      if (got && got.sniff) {
        return subAttach({ parse: 1, jx: 0, url: got.sniff, header: headers }, subsP);
      }
      // 嵌入页拿到了但没解出：嗅探嵌入页本身（不再回会自毁的门页）
      if (lk.embedUrl && !/supjav\.php/.test(lk.embedUrl)) {
        return subAttach({ parse: 1, jx: 0, url: lk.embedUrl, header: headers }, subsP);
      }
    }
  } catch (e) {}
  // 全灭兜底：Worker v2 在线时经 /wrap 包装页嗅探；否则维持旧行为给门页
  if (await probeWrap(gateUrl)) {
    return subAttach({ parse: 1, jx: 0, url: FETCH_WORKER + '/wrap?u=' + encodeURIComponent(gateUrl), header: headers }, subsP);
  }
  return subAttach({ parse: 1, url: gateUrl, header: headers }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const kw = encodeURIComponent(wd);
  const url = page === 1 ? `${HOST}/?s=${kw}` : `${HOST}/page/${page}/?s=${kw}`;
  let html = await fetchPage(url);
  let items = parseCards(html);
  if (!items.length) {
    html = await fetchPage(url);
    items = parseCards(html);
  }
  return { page, pagecount: pagecount(html, page), limit: items.length || 24, total: items.length, list: items };
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
      fastify.post('/homeVod', homeVod);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
