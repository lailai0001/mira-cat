// JAV HD Porn (https://www.javhdporn.net) -> CatPawOpen spider
// 站点性质: WordPress 聚合站 (kingtube 系主题), 与 bestjavporn.com 同一
// 运营网络 (共用图片 CDN pics.pornfhd.com / 预览 CDN video.pornfhd.com)。
// 列表/详情/搜索均为服务端渲染, 无验证墙。
// 封面: 卡片 data-lazy-src 是 pics.pornfhd.com/s/ 小图, 去掉 /s/ 即大图;
// 详情用 og:image。
// 分类 URL 形态: /category/{slug}/ 会 301 到带版本前缀的 /v3/category/
// {slug}/ (2026-10-22 侦察复核: 当前前缀仍为 /v3; 蜘蛛用无前缀形态 +
// 跟随重定向, 不写死版本号)。每页 24 条; 分页 /page/{n}/;
// 搜索 /search/{kw}/ (实测可用; 站内无 results.php, /?s= 与之等价)。
//
// 播放链 (2026-10-22 第九轮反混淆破解, 机制与 bestjavporn 同构):
// 详情页 #video-player[data-mpu][data-ver] + #video-player-area
// [data-video-id] -> dex 铸造 sources 令牌 -> POST /api/play/
// (sources=token&ver=<data-ver>) -> 响应 data/reserve 再经 dex 解出
// //video{,1}.javhdporn.net / hugstream.xyz 的 embed 路径 -> GET
// embed 页取 data-config 解密得 JW sources [{file,type,label}]。
// dex(seed, data) = b64decode( RC4( reverse(b64(seed + salt)),
// b64decode(data) ) ); 盐按用途分 (cast.js 常量数组实测):
//   令牌: data-ver='2' -> 'SyntaxError'; '1' -> 'QxLUF1bgIAdeQX';
//         其他 -> '_0x58fe15' (主盐不对时按序换盐重试 POST);
//   响应 (data/reserve): '_0x58fe15'; reserve 解出为 JSON 数组
//         [{data, lo}], 每条再 dex 得一条 embed 路径。
// embed data-config 盐 '_0x59a0e4' (与 BJP 相同):
//   key = reverse( b64( b64(pathname+search).substr(4,20) + salt ) )。
// IP 绑定 (实测, 与 BJP 第八轮同结论): MaxStream 等 lk 家族文件
// 令牌绑 embed 查看者出口 —— 直连看页解出的链同出口取流 200,
// 经 Worker/jina 看页解出的一律 403。故 embed 取页直连三栈优先,
// 线路按出口分组排序 (直连 > hugstream 前置 > 借线绑定型), 全链
// 失败才落 parse:1 嗅探详情页兜底。
//
// 2026-10-22 第七轮 (删除重写, 与 bestjavporn 同步):
// 前四轮 (并行竞速/通道扩容/自有 Worker) 本地 harness 全过、真机
// 全灭, 且失败形态不可归因 (蜘蛛只回空列表, 无从知道死在哪层)。
// 本轮按 2026-10-22 当日实况重新侦察后重写:
//   ① 取数分层、逐通道归因: 每次取页记录每条通道的 状态码/字节/
//      解卡数/耗时, 胜出者与失败全表都可回溯;
//   ② 诊断卡: home 与每个分类的首行固定放一张诊断卡 (vod_id 为
//      __diag__), 卡名写本页命中通道与出卡数 (如「诊断 own 200 ·
//      36卡」), 全通道失败时卡名带回各通道状态; 点开诊断卡的详情
//      可见完整通道明细表 —— 真机一点开即可截图归因, 不再盲飞;
//   ③ 解析双层: 严格层 (原解析, 今日实况复核仍吻合) + 宽松层
//      (属性顺序无关、相对/绝对 href 通吃、标题多路兜底), 页面
//      变体导致严格层解 0 卡时宽松层接住, 诊断卡会标注;
//   ④ 分类/播放/源名/key 与旧版一致, 播放沿用 RELAY->嗅探设计。
//
// 2026-10-22 真机归因修复: 诊断卡回传坐实 App 蜘蛛运行时里没有
// 全局 fetch ("fetch is not a function"), 旧版全部 fetch 通道在
// 设备上 0ms 秒死, 只剩 req/https 两栈真发出请求 (且直连被 CF
// 403)。本地 harness 跑在有 fetch 的 Node 里, 四轮全被掩盖。本次
// 只换 HTTP 层: 全部通道底层改走框架 req (axios), 全局 fetch 仅
// 在 typeof 守卫成立时作 'fetch' 直连通道的附加实现, 缺失时该
// 通道自动退化为 req —— 任何通道不得再依赖 fetch 存在。
import req from '../../util/req.js';
import https from 'https';
import zlib from 'zlib';

const KEY = 'py_javhdporn';
const NAME = 'JAVHDPorn';
const HOST = 'https://www.javhdporn.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = HOST + '/';
// 自有取页跳板 pornfhd-fetch (用户自有 Cloudflare Worker, 第一通道)
const OWN_FETCH = 'https://pornfhd-fetch.li768435813.workers.dev';
const DIAG_ID = '__diag__';

// 分类: 2026-10-21 逐类实测站方计数, 2026-10-22 侦察复核 slug 未变
const CATS = [
  { type_id: 'censored', type_name: '有码' },                              // 72000
  { type_id: 'uncensored', type_name: '无码' },                            // 36944
  { type_id: 'decensored', type_name: '无码破解' },                        // 72000
  { type_id: 'uncensored/fc2-ppv', type_name: 'FC2 PPV' },                 // 34257
  { type_id: 'chinese-subtitle', type_name: '中文字幕' },                  // 57283
  { type_id: 'censored/english-subtitle', type_name: '英文字幕' },         // 32383
  { type_id: 'amateur', type_name: '素人' },                               // 56908
  { type_id: 'decensored/uncensored-leaked', type_name: '无码流出' },      // 9026
  { type_id: 'uncensored/tokyo-hot', type_name: 'Tokyo Hot' },              // 2677
  { type_id: 'subtitle-indonesia', type_name: '印尼字幕' },                 // 5567
  { type_id: 'censored/subthai', type_name: '泰文字幕' },                   // 893
];

function t(x) {
  return x === undefined || x === null ? '' : String(x).trim();
}

function clean(s) {
  return t(String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8230;/g, '…')
    .replace(/&#\d+;/g, ''));
}

// ---------------- 解析 (严格层 + 宽松层) ----------------
// 严格层: 沿用旧解析 (2026-10-22 当日页面复核: <article class=
// "thumb-block ..."> + <a class="archive-entry" href title> 形态未变)。
function parseCardsStrict(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split('<article');
  for (const b of blocks) {
    if (!b.includes('thumb-block')) continue;
    const hrefM = b.match(/href="(https:\/\/www\.javhdporn\.net\/video\/[^"]+\/)"/);
    if (!hrefM) continue;
    const url = hrefM[1];
    if (seen.has(url)) continue;
    seen.add(url);
    const titleM = b.match(/<a[^>]+class="archive-entry"[^>]+title="([^"]+)"/) ||
                   b.match(/title="([^"]{4,})"/);
    const name = titleM ? clean(titleM[1]) : url.split('/video/')[1].replace(/\//g, '');
    let pic = '';
    const lazyM = b.match(/data-lazy-src="(https:[^"]+)"/);
    if (lazyM) pic = lazyM[1].replace('pics.pornfhd.com/s/', 'pics.pornfhd.com/');
    const durM = b.match(/class="duration"[^>]*>(?:<[^>]+>)*\s*([0-9:]+)/);
    const badgeM = b.match(/class="hd-video"[^>]*>([^<]+)</);
    out.push({
      vod_id: url,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: durM ? durM[1] : (badgeM ? clean(badgeM[1]) : ''),
    });
  }
  return out;
}

// 宽松层: 不假设属性顺序与绝对地址 —— 任何指向 /video/... 的锚点
// 都收, 标题依次从 title 属性 / img alt / 锚内文本 / slug 兜底,
// 封面从锚后窗口内的 data-lazy-src / data-wpsrc / img src 取。
function parseCardsLoose(html) {
  const out = [];
  const seen = new Set();
  const h = String(html || '');
  const re = /<a\b[^>]*?href\s*=\s*["']((?:https?:\/\/(?:www\.)?javhdporn\.net)?\/video\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(h)) !== null) {
    let url = m[1];
    if (url.startsWith('/')) url = HOST + url;
    url = url.replace(/^http:\/\//, 'https://');
    if (seen.has(url)) continue;
    seen.add(url);
    const tag = m[0];
    const win = h.slice(m.index, m.index + 1800);
    let name = '';
    const tm = tag.match(/title\s*=\s*"([^"]+)"/) || tag.match(/title\s*=\s*'([^']+)'/);
    if (tm) name = clean(tm[1]);
    if (!name) {
      const altM = win.match(/<img[^>]+alt="([^"]{4,})"/);
      if (altM) name = clean(altM[1]);
    }
    if (!name) {
      const txtM = win.match(/<header class="entry-header">\s*<span>([^<]{4,})<\/span>/);
      if (txtM) name = clean(txtM[1]);
    }
    if (!name) name = url.split('/video/')[1].replace(/\//g, '');
    let pic = '';
    const lazyM = win.match(/data-lazy-src="(https:[^"]+)"/);
    if (lazyM) pic = lazyM[1].replace('pics.pornfhd.com/s/', 'pics.pornfhd.com/');
    if (!pic) {
      const wpM = win.match(/data-wpsrc="(https:[^"]+)"/);
      if (wpM) pic = wpM[1];
    }
    if (!pic) {
      const srcM = win.match(/<img[^>]+src="(https:[^"]+)"/);
      if (srcM && !srcM[1].startsWith('data:')) pic = srcM[1];
    }
    const durM = win.match(/class="duration"[^>]*>(?:<[^>]+>)*\s*([0-9:]+)/);
    const badgeM = win.match(/class="hd-video"[^>]*>([^<]+)</);
    out.push({
      vod_id: url,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: durM ? durM[1] : (badgeM ? clean(badgeM[1]) : ''),
    });
  }
  return out;
}

// 合并: 严格层优先 (同 URL 以严格层为准), 宽松层补严格层漏掉的卡。
function parseCardsEx(html) {
  const strict = parseCardsStrict(html);
  const byUrl = new Map(strict.map(c => [c.vod_id, c]));
  let looseOnly = 0;
  for (const c of parseCardsLoose(html)) {
    if (!byUrl.has(c.vod_id)) { byUrl.set(c.vod_id, c); looseOnly++; }
  }
  return { list: [...byUrl.values()], strict: strict.length, looseOnly };
}
function parseCards(html) {
  return parseCardsEx(html).list;
}

function pagecountOf(html) {
  let max = 1;
  const re = /\/page\/(\d+)\//g;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max && n < 100000) max = n;
  }
  return max;
}

function og(html, prop) {
  const h = String(html || '');
  let m = h.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]*)"`));
  if (!m) m = h.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="og:${prop}"`));
  return m ? clean(m[1]) : '';
}

// ---------------- 抓取层 (分层竞速 + 逐通道归因) ----------------
// 每条通道统一回 {status, body, upst?, note?}: status 为该通道实测
// HTTP 状态 (0 = 网络错误/超时); fetchPage 把每条通道的 状态/字节/
// 解卡数/耗时/判定 全部记进 outcomes, 胜出与失败都可归因。
const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
  'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

function isShellPage(s) {
  return /Attention Required|Just a moment|cf-challenge|Checking your browser/i.test(s || '');
}
function validListPage(html) {
  return !!html && !isShellPage(html) && parseCards(html).length > 0;
}
function validDetailPage(html) {
  return !!html && !isShellPage(html) && html.length > 4000 &&
    (/property="og:(title|image)"/.test(html) || html.includes('videojs.html') || html.includes('data-mpu'));
}
function validFor(kind, html) {
  return kind === 'detail' ? validDetailPage(html) : validListPage(html);
}

// ---- 传输层: 全部走框架 req (axios); fetch 仅守卫内附加 ----
// 设备运行时无全局 fetch (见文件头归因), 故所有通道的底层统一走
// req。HAS_FETCH 只决定 'fetch' 直连通道用不用原生 fetch 多一栈。
const HAS_FETCH = typeof fetch === 'function';

// reqRaw: 统一回 {status, body, rawBytes, headers, err}。状态码不
// 抛错 (validateStatus 全放行), body 仅 2xx 时给正文 (对齐 fetch
// 的 r.ok 口径); axios 默认跟随重定向 (maxRedirects 5, 对齐旧
// redirect:'follow'); 网络错误/超时回 status 0。transformResponse
// 设恒等: 防 axios 按 Content-Type 自动 JSON 解析污染正文
// (aoGet 等通道的正文由上层自行 JSON.parse)。
async function reqRaw(url, headers, timeoutMs, method, body) {
  try {
    const cfg = {
      method: method || 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    };
    if (body !== undefined && body !== null) cfg.data = body;
    const r = await req.request(cfg);
    const text = typeof r.data === 'string' ? r.data : (r.data === null || r.data === undefined ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '', rawBytes: text.length, headers: r.headers || {} };
  } catch (e) {
    const isTimeout = !!(e && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(String(e.message || ''))));
    return { status: 0, body: '', rawBytes: 0, headers: {}, err: isTimeout ? 'timeout' : String((e && e.message) || e) };
  }
}

// 全局 fetch 实现 (仅 HAS_FETCH 时被 chFetch 调用): 与 reqRaw 同
// 返回形态; headers 归一为空对象 (调用方不依赖)。
async function fetchViaGlobal(url, headers, timeoutMs, method, body) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 10000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow', method: method || 'GET', body });
    const text = await r.text();
    return { status: r.status, body: r.ok ? text : '', rawBytes: text.length, headers: {} };
  } catch (e) {
    return { status: 0, body: '', rawBytes: 0, headers: {}, err: (e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || e) };
  } finally { clearTimeout(to); }
}

// 通用取数原语 (全部通道经此; 底层 = reqRaw, 不再是全局 fetch)
async function fetchRaw2(url, headers, timeoutMs, method, body) {
  return reqRaw(url, headers, timeoutMs, method, body);
}

// 第一通道: 自有 Worker 跳板 pornfhd-fetch (蜘蛛 -> 用户 Worker -> 站点)
const OWN_HOST_RE = /(^|\.)(javhdporn\.net|bestjavporn\.com|pornfhd\.com)$/i;
async function chOwn(url, timeoutMs) {
  try {
    if (!OWN_HOST_RE.test(new URL(url).hostname)) return { status: 0, body: '', note: '白名单外跳过' };
  } catch (e) { return { status: 0, body: '', note: 'URL非法' }; }
  const w = OWN_FETCH + '/get?u=' + encodeURIComponent(url) + '&ref=' + encodeURIComponent(REFERER);
  const r = await reqRaw(w, { 'User-Agent': UA }, timeoutMs || 10000);
  return { ...r, upst: (r.headers && r.headers['x-pornfhd-upst']) || '' };
}

// 'fetch' 直连通道: 有全局 fetch 时用它多一栈; 设备上无 fetch 时
// 退化为 req 直连 (同为 BROWSER_HEADERS 全套头), 通道不许死。
async function chFetch(url, timeoutMs) {
  const headers = { ...BROWSER_HEADERS, Referer: REFERER };
  if (HAS_FETCH) return fetchViaGlobal(url, headers, timeoutMs);
  return reqRaw(url, headers, timeoutMs);
}

async function chReq(url, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, Referer: REFERER },
      timeout: timeoutMs || 10000,
    });
    const status = (r && typeof r.status === 'number') ? r.status : 200;
    const d = typeof r === 'string' ? r : (r && r.data !== undefined ? r.data : r);
    return { status, body: typeof d === 'string' ? d : '' };
  } catch (e) {
    const st = e && e.response && typeof e.response.status === 'number' ? e.response.status : 0;
    return { status: st, body: '', err: String((e && e.message) || e) };
  }
}

// 原生 https 栈 (独立代码路径; 手工重定向 + 解压)
function chHttps(url, timeoutMs, depth = 0) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const u = new URL(url);
      const rq = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: { ...BROWSER_HEADERS, Referer: REFERER, 'Accept-Encoding': 'gzip, deflate, br' },
        timeout: timeoutMs || 10000,
      }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          res.resume();
          fin(chHttps(new URL(loc, url).toString(), timeoutMs, depth + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); fin({ status: res.statusCode || 0, body: '' }); return; }
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '');
        try {
          if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
          else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
          else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        } catch (e) { /* 解压失败则按原文读 */ }
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => fin({ status: 200, body: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', () => fin({ status: 200, body: '', err: 'stream error' }));
      });
      rq.on('timeout', () => { rq.destroy(); fin({ status: 0, body: '', err: 'timeout' }); });
      rq.on('error', (e) => fin({ status: 0, body: '', err: String((e && e.message) || e) }));
      rq.end();
    } catch (e) { fin({ status: 0, body: '', err: String((e && e.message) || e) }); }
  });
}

// workers.dev 公共 demo 通道须喂规范 URL: /category|search 前的版本
// 前缀从成功页面学习 (默认 /v3, 站方改版自动跟随)。
let learnedPrefix = '/v3';
function notePrefix(html) {
  const m = String(html || '').match(/javhdporn\.net(\/v\d+)\/(?:category|search)\//);
  if (m) learnedPrefix = m[1];
}
function wdTarget(url) {
  try {
    const u = new URL(url);
    if (/^\/(category|search)\//.test(u.pathname)) u.pathname = learnedPrefix + u.pathname;
    return u.toString();
  } catch (e) { return url; }
}
async function chDemo(url, timeoutMs) {
  return fetchRaw2('https://test.cors.workers.dev/?' + wdTarget(url), {
    'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Origin: HOST,
  }, timeoutMs);
}

async function chJina(url, timeoutMs) {
  return fetchRaw2('https://r.jina.ai/' + url, {
    'User-Agent': UA,
    'x-respond-with': 'html',
  }, timeoutMs);
}

async function chAoGet(url, timeoutMs) {
  const r = await fetchRaw2('https://api.allorigins.win/get?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
  if (!r.body) return r;
  try {
    const j = JSON.parse(r.body);
    return { status: r.status, body: typeof j.contents === 'string' ? j.contents : '' };
  } catch (e) { return { status: r.status, body: '' }; }
}

async function chAoRaw(url, timeoutMs) {
  return fetchRaw2('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
}

async function chCodetabs(url, timeoutMs) {
  return fetchRaw2('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
}

// 分层竞速: 第一波 (自有 Worker 为首) -> 第二波 (慢中转兜底)。
// 第一个通过解析型校验的响应立即胜出; 全部通道的实测结果记入
// outcomes 供诊断卡归因。总截止 deadlineMs, 到点未齐按现有结果裁定。
async function fetchPage(url, kind, deadlineMs) {
  const t0 = Date.now();
  const budget = deadlineMs || 24000; // 全局总截止 (两波共享)
  const outcomes = [];
  let winner = null;
  let resolveWin;
  const winP = new Promise((r) => { resolveWin = r; });
  const judge = (name, res, ms) => {
    const body = (res && res.body) || '';
    const oc = {
      name,
      status: (res && res.status) || 0,
      upst: (res && res.upst) || '',
      bytes: body.length || (res && res.rawBytes) || 0,
      ms,
      ok: false,
      note: (res && res.note) || '',
      err: (res && res.err) || '',
    };
    if (kind !== 'detail') {
      oc.cards = body ? parseCards(body).length : 0;
    }
    oc.ok = validFor(kind, body);
    outcomes.push(oc);
    if (oc.ok && !winner) { winner = { html: body, oc }; resolveWin(winner); }
    return oc;
  };
  const runWave = async (wave) => {
    const jobs = wave.map(([name, fn, to]) => (async () => {
      const t0 = Date.now();
      let res;
      try { res = await fn(url, to); } catch (e) { res = { status: 0, body: '', err: String((e && e.message) || e) }; }
      return judge(name, res, Date.now() - t0);
    })());
    const all = Promise.allSettled(jobs);
    const remain = Math.max(3000, budget - (Date.now() - t0));
    const deadline = new Promise((r) => setTimeout(r, remain));
    await Promise.race([winP, all, deadline]);
  };
  const wave1 = [
    ['own', chOwn, 10000],
    ['fetch', chFetch, 10000],
    ['req', chReq, 10000],
    ['https', chHttps, 10000],
    ['demo', chDemo, 10000],
    ['jina', chJina, 12000],
    ['aoGet', chAoGet, 12000],
  ];
  await runWave(wave1);
  if (!winner) {
    const wave2 = [
      ['aoRaw', chAoRaw, 12000],
      ['codetabs', chCodetabs, 10000],
      ['jina2', chJina, 8000],
      ['demo2', chDemo, 8000],
    ];
    await runWave(wave2);
  }
  if (winner) {
    notePrefix(winner.html);
    const ex = kind !== 'detail' ? parseCardsEx(winner.html) : null;
    return { html: winner.html, win: winner.oc, outcomes, looseOnly: ex ? ex.looseOnly : 0 };
  }
  return { html: '', win: null, outcomes, looseOnly: 0 };
}

// 兼容旧签名: 只要正文 (详情/播放内部用)
async function getPage(url, kind) {
  const r = await fetchPage(url, kind || 'list');
  return r.html;
}

// ---------------- 诊断卡 ----------------
// home / 分类首行: 卡名 = 本页命中的通道 + 出卡数; 全灭时卡名带回
// 各通道状态码与解卡数 (如 own:200/0卡 = 通道活着但解析为 0,
// own:0 = 通道本身没通)。点开诊断卡 -> detail 给完整明细表。
function diagCardName(res, cardCount) {
  if (res && res.win) {
    let s = `诊断 ${res.win.name} ${res.win.status} · ${cardCount}卡`;
    if (res.win.upst) s += `·上游${res.win.upst}`;
    if (res.looseOnly) s += '·含宽松解析';
    return s;
  }
  const parts = (res ? res.outcomes : []).map((o) => {
    const st = o.status ? String(o.status) : (o.err ? 'ERR' : '0');
    return o.cards !== undefined ? `${o.name}:${st}/${o.cards}卡` : `${o.name}:${st}`;
  });
  return ('诊断 全通道失败 ' + parts.join(' ')).slice(0, 190);
}
function diagCard(res, cardCount) {
  return {
    vod_id: DIAG_ID,
    vod_name: diagCardName(res, cardCount),
    vod_pic: '',
    vod_remarks: '诊断卡·点开看通道明细',
  };
}
function diagText(url, res) {
  const lines = [];
  lines.push('取数通道明细');
  lines.push('目标: ' + url);
  lines.push('时间: ' + new Date().toISOString());
  if (res.win) lines.push(`胜出: ${res.win.name} 状态${res.win.status} ${res.win.ms}ms`);
  else lines.push('胜出: 无 (全通道失败)');
  for (const o of res.outcomes) {
    lines.push(`${o.name}: 状态${o.status || 'ERR'} ${o.bytes}B ${o.ms}ms` +
      (o.cards !== undefined ? ` 解卡${o.cards}` : '') +
      (o.upst ? ` 上游${o.upst}` : '') +
      (o.ok ? ' ✓合格' : '') +
      (o.note ? ' ' + o.note : '') +
      (o.err ? ' ' + o.err : ''));
  }
  const missing = ['own', 'fetch', 'req', 'https', 'demo', 'jina', 'aoGet', 'aoRaw', 'codetabs']
    .filter((n) => !res.outcomes.some((o) => o.name === n || o.name === n + '2'));
  if (missing.length) lines.push('未及返回 (竞速已胜出或总截止): ' + missing.join(' '));
  lines.push('判读: 200/0卡=通道通但解析为零; 403/5xx=通道被拒; ERR/timeout=通道不通; own=自有Worker, demo=公共cors演示, jina/ao/codetabs=公共中转, fetch/req/https=直连三栈(全走req, fetch仅运行时有时多一栈)。');
  return lines.join('\n');
}

// ---------------- URL 构造 ----------------
function catUrl(tid, page) {
  const base = `${HOST}/category/${tid}/`;
  return page > 1 ? `${base}page/${page}/` : base;
}
function searchUrl(kw, page) {
  const base = `${HOST}/search/${encodeURIComponent(kw)}/`;
  return page > 1 ? `${base}page/${page}/` : base;
}

// ---------------- 纯 JS 密码件 (cast.js 反混淆复刻, 2026-10-22 实测) ----------------
const B64CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64REV = (() => {
  const o = {};
  for (let i = 0; i < 64; i++) o[B64CH[i]] = i;
  o['-'] = 62; o['_'] = 63;
  return o;
})();

function b64ToBytes(s) {
  const str = String(s || '').replace(/[^A-Za-z0-9+/=_-]/g, '');
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of str) {
    if (ch === '=') break;
    const v = B64REV[ch];
    if (v == null) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64CH[a >> 2] + B64CH[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? B64CH[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? B64CH[c & 63] : '=');
  }
  return s;
}

function strToB64(str) { // 入参均为 ASCII
  return bytesToB64(new TextEncoder().encode(String(str || '')));
}

function bytesToLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return s;
}

function bytesToUtf8(bytes) {
  try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return bytesToLatin1(bytes); }
}

function rc4(keyStr, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  const kb = [];
  for (let i = 0; i < keyStr.length; i++) kb.push(keyStr.charCodeAt(i) & 0xff);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + kb[i % kb.length]) & 0xff;
    const tmp = S[i]; S[i] = S[j]; S[j] = tmp;
  }
  let a = 0; j = 0;
  const out = new Uint8Array(data.length);
  for (let n = 0; n < data.length; n++) {
    a = (a + 1) & 0xff;
    j = (j + S[a]) & 0xff;
    const tmp = S[a]; S[a] = S[j]; S[j] = tmp;
    out[n] = data[n] ^ S[(S[a] + S[j]) & 0xff];
  }
  return out;
}

// dex(salt, seed, data) = b64decode( RC4( reverse(b64(seed + salt)), b64decode(data) ) )
function dexSalt(salt, seed, data) {
  const key = strToB64(String(seed) + salt).split('').reverse().join('');
  const mid = bytesToLatin1(rc4(key, b64ToBytes(data)));
  return bytesToLatin1(b64ToBytes(mid));
}
function dexSaltUtf8(salt, seed, data) {
  const key = strToB64(String(seed) + salt).split('').reverse().join('');
  const mid = bytesToLatin1(rc4(key, b64ToBytes(data)));
  return bytesToUtf8(b64ToBytes(mid));
}

// 盐表 (cast.js _0xc21c 常量数组实测): 响应恒用主盐; 令牌按
// data-ver 分支选盐, fetchEmbedPaths 里按序兜底重试。
const SALT_MAIN = '_0x58fe15';
function tokenSalts(ver) {
  if (ver === '1') return ['QxLUF1bgIAdeQX', SALT_MAIN, 'SyntaxError'];
  if (ver === '2') return ['SyntaxError', SALT_MAIN, 'QxLUF1bgIAdeQX'];
  return [SALT_MAIN, 'SyntaxError', 'QxLUF1bgIAdeQX'];
}
function dexResp(seed, data) { return dexSalt(SALT_MAIN, seed, data); }
function dexRespUtf8(seed, data) { return dexSaltUtf8(SALT_MAIN, seed, data); }

// embed 页 data-config 解密: key = reverse( b64( b64(pathname+search).substr(4,20) + '_0x59a0e4' ) )
function decryptConfig(cfgB64, pathname, search) {
  const arg = strToB64(String(pathname) + String(search)).substring(4, 20);
  const key = strToB64(arg + '_0x59a0e4').split('').reverse().join('');
  const pt = bytesToLatin1(rc4(key, b64ToBytes(cfgB64)));
  const json = JSON.parse(bytesToUtf8(b64ToBytes(pt)));
  const sources = JSON.parse(bytesToUtf8(b64ToBytes(json.src || '')));
  return { json, sources };
}

// ---------------- POST /api/play/ (铸造, 带通道归因) ----------------
function validPlayResp(text) {
  // 必须 status === true 才算铸造成功 (公共中转转发 POST 可能丢
  // body, 站方回 {"status":false,...} 假成功, BJP 旧轮已坐实)。
  if (!text) return false;
  try {
    const j = JSON.parse(text);
    return !!j && typeof j === 'object' && j.status === true;
  } catch (e) { return false; }
}

// POST 通道逐个结论的短串 (进分集名, 真机截图可直接读)
function postDiagOf(outcomes) {
  if (!outcomes || !outcomes.length) return '';
  const st = (o) => (o.status ? String(o.status) : (o.err === 'timeout' ? '超时' : 'ERR'));
  const parts = [];
  const owns = outcomes.filter((o) => /^own\d*$/.test(o.name));
  if (owns.length) parts.push('own' + owns.map(st).join('>'));
  const dirs = outcomes.filter((o) => o.name === 'fetch' || o.name === 'req');
  if (dirs.length) parts.push('直连' + [...new Set(dirs.map(st))].join('/'));
  for (const o of outcomes) {
    if (/^own\d*$/.test(o.name) || o.name === 'fetch' || o.name === 'req') continue;
    parts.push(o.name + st(o));
  }
  return parts.join(' ');
}

// GET 通道逐个结论的短串 (取页全灭时进分集名/正文)
function pageDiagOf(outcomes) {
  if (!outcomes || !outcomes.length) return '';
  const st = (o) => (o.status ? String(o.status) : (o.err === 'timeout' ? '超时' : 'ERR'));
  return outcomes.map((o) => o.name + st(o)).join(' ');
}

const WD_HEADERS = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Origin: HOST };

async function httpPostForm(url, bodyStr, opts = {}) {
  const referer = opts.referer || REFERER;
  const formHeaders = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': referer,
    'Origin': HOST,
  };
  const t0 = Date.now();
  const budget = 30000; // POST 铸造全局总截止 (各波共享)
  const outcomes = [];
  let winner = null;
  let resolveWin;
  const winP = new Promise((r) => { resolveWin = r; });
  const judge = (name, res) => {
    const text = (res && res.body) || '';
    const oc = { name, status: (res && res.status) || 0, bytes: text.length, ok: validPlayResp(text), sawJson: false, err: (res && res.err) || '' };
    if (text) {
      try { const j = JSON.parse(text); if (j && typeof j === 'object' && 'status' in j) oc.sawJson = true; } catch (e) { /* 非 JSON */ }
    }
    outcomes.push(oc);
    if (oc.ok && !winner) { winner = { text, via: name }; resolveWin(winner); }
    return oc;
  };
  const runWave = async (wave) => {
    const jobs = wave.map(([name, fn]) => (async () => {
      let res;
      try { res = await fn(); } catch (e) { res = { status: 0, body: '' }; }
      return judge(name, res);
    })());
    const all = Promise.allSettled(jobs);
    const remain = Math.max(3000, budget - (Date.now() - t0));
    const deadline = new Promise((r) => setTimeout(r, remain));
    await Promise.race([winP, all, deadline]);
  };
  const ownPostTo = async (target, to) => {
    const w = OWN_FETCH + '/post?u=' + encodeURIComponent(target) + '&ref=' + encodeURIComponent(referer);
    return fetchRaw2(w, { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, to || 12000, 'POST', bodyStr);
  };
  const ownPost = async () => ownPostTo(url);
  // 'fetch' 铸造通道: 有全局 fetch 时用它; 设备无 fetch 时退化为
  // req POST (与 ownPost/reqPost 同栈多一发), 通道不许死。
  const fetchPost = async () => (HAS_FETCH
    ? fetchViaGlobal(url, formHeaders, 12000, 'POST', bodyStr)
    : fetchRaw2(url, formHeaders, 12000, 'POST', bodyStr));
  const reqPost = async () => {
    try {
      const r = await req.post(url, bodyStr, { headers: formHeaders, timeout: 12000 });
      const status = (r && typeof r.status === 'number') ? r.status : 200;
      const d = typeof r === 'string' ? r : (r && r.data !== undefined ? r.data : r);
      return { status, body: typeof d === 'string' ? d : JSON.stringify(d || '') };
    } catch (e) {
      const st = e && e.response && typeof e.response.status === 'number' ? e.response.status : 0;
      return { status: st, body: '' };
    }
  };
  const demoPost = async () => fetchRaw2('https://test.cors.workers.dev/?' + url, {
    ...WD_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded',
  }, 12000, 'POST', bodyStr);
  const aoPost = async () => fetchRaw2('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
    'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA,
  }, 10000, 'POST', bodyStr);
  // 2026-10-27 截图定位修复: 铸造 POST 全通道 403/429/超时时
  // 加 codetabs 代理通道 (通用转发代理, 转发 POST 方法与表单
  // 体; 不通则本通道自败, 不影响其余通道)。
  const codePost = async () => fetchRaw2('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), {
    'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA,
  }, 12000, 'POST', bodyStr);
  await runWave([['own', ownPost], ['fetch', fetchPost], ['req', reqPost], ['demo', demoPost], ['codetabs', codePost]]);
  if (!winner && !outcomes.some((o) => o.sawJson) && (Date.now() - t0) < 20000) {
    // own 单次短重试 (2026-10-27 详情巨慢修复): own 的上游 403
    // 是站方 CF 对 Workers 出口的时段/colo 间歇拒绝, 但实测自愈
    // 在分钟级 (16:07 403、16:10 200), 秒级连打两发基本无益,
    // 却各烧 12s 超时 —— 原 own2+own3 是详情超时的主因之一。
    // 只留一发 8s 短重试, 20s 后不再重试; aoRaw 也只在 25s
    // 内才打, 总 POST 封顶约 30s, 避免 App 详情超时直接报
    // 获取失败。前提不变: 任何通道拿到过 JSON=false 说明令
    // 牌本身被拒, 由上层换盐处理。
    const tryOwn = async (name, target) => {
      let res;
      try { res = await ownPostTo(target, 8000); } catch (e) { res = { status: 0, body: '' }; }
      judge(name, res);
    };
    await new Promise((r) => setTimeout(r, 1200));
    await tryOwn('own2', url);
  }
  if (!winner && (Date.now() - t0) < 25000) await runWave([['aoRaw', aoPost]]);
  if (winner) return { text: winner.text, via: winner.via, outcomes, diag: postDiagOf(outcomes) };
  const sawJson = outcomes.some((o) => o.sawJson);
  return { text: '', via: '', outcomes, stage: sawJson ? 'post-bad' : 'post-none', diag: postDiagOf(outcomes) };
}

// ---------------- 播放解析 ----------------
function extractPlaySeed(html) {
  const postId = (html.match(/id="video-player-area"[^>]*data-video-id="(\d+)"/) || html.match(/data-video-id="(\d+)"/) || [])[1] || '';
  const mpu = (html.match(/data-mpu="([^"]+)"/) || [])[1] || '';
  const ver = (html.match(/id="video-player"[^>]*data-ver="([^"]+)"/) || html.match(/data-ver="([^"]+)"/) || [])[1] || '2';
  return { postId, mpu, ver };
}

// ---------------- 铸造库 (cast-bank, 2026-10-22) ----------------
// 服务端预铸: VM 侧把当前目录的铸造结果 (embed 路径集) 预先算好
// 存入 pornfhd-fetch 的 KV; 蜘蛛在铸造 POST 竞速之前先查库, 命中
// 即以库内路径集走原下游 (resolveEmbed 等完全共用) —— 设备侧 own
// 出口被站方 CF 按 colo 信誉拉黑时活铸造全灭, 此路只用一次经自有
// Worker 的 GET, 不碰 POST。
// 契约: GET {OWN_FETCH}/cast?u=<watch 页完整 URL> -> 命中 200
// {"paths":[embed 路径数组],"ts":epoch}; 未命中 404。
// 只走 req (App 运行时无全局 fetch); 未命中/超时/坏 JSON/空路
// 径集一律落回原铸造。
// 形态别名 (2026-10-23 真机坐实): 站方列表/搜索发的 watch 链
// 接带 /v\d+/ 前缀且会漂移 (本站出现过 /v2//v4/), 入库键多为
// 去前缀 canonical 形 —— 精确一发未命中时, 明明在库的片也照
// 样全灭。候选序: 精确址 -> canonical 形 -> 其余前缀形, 全部
// 并行查 (查库不耗写入预算), 按序取首命中; 首发超时沿用 6s,
// 变体发 3s。2026-10-27 截图定位修复: 原 slice(0,3) 会截掉
// /v1 或 /v4 形入库键, 造成假性库未命中。
const CAST_ALIAS_PREFIXES = '/v2,/v4,/v1'.split(',');
function castBankCandidates(watchUrl) {
  const out = [watchUrl];
  const m = String(watchUrl).match(/^(https?:\/\/[^/]+)(?:\/v\d+)?(\/video\/\S*)$/);
  if (!m) return out;
  const canonical = m[1] + m[2];
  if (!out.includes(canonical)) out.push(canonical);
  for (const p of CAST_ALIAS_PREFIXES) {
    const u = m[1] + p + m[2];
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

async function castBankGet(watchUrl, timeoutMs) {
  try {
    const w = OWN_FETCH + '/cast?u=' + encodeURIComponent(watchUrl);
    const r = await reqRaw(w, { 'User-Agent': UA }, timeoutMs);
    if (!r || r.status !== 200 || !r.body) return null;
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return null; }
    const seen = new Set();
    const arr = (j && Array.isArray(j.paths))
      ? j.paths.filter((p) => {
          if (typeof p !== 'string' || !p.startsWith('//') || seen.has(p)) return false;
          seen.add(p);
          return true;
        })
      : [];
    if (!arr.length) return null;
    return { hit: true, paths: arr.map((p, i) => ({ lo: i === 0 ? 'main' : 'bak', path: p })) };
  } catch (e) {
    return null;
  }
}

async function castBankLookup(watchUrl) {
  const cands = castBankCandidates(watchUrl);
  const results = await Promise.all(cands.map((c, i) => castBankGet(c, i === 0 ? 6000 : 3000)));
  for (const hit of results) if (hit) return hit;
  return { hit: false };
}

// 调 /api/play/ 并解出全部线路的 embed 路径: {paths, stage, via, postDiag}
// 令牌盐按 data-ver 选; 站方回 status:false (post-bad) 时换下一盐重试。
async function fetchEmbedPaths(postId, mpu, ver, referer) {
  // 铸造库优先: 命中直接用库内路径集, 不打铸造 POST 竞速。
  const bank = await castBankLookup(referer);
  if (bank.hit) return { paths: bank.paths, stage: 'ok', via: 'cast-bank', postDiag: '', bank: 'hit' };
  let lastDiag = '';
  let lastStage = 'post-none';
  for (const salt of tokenSalts(ver)) {
    const token = dexSalt(salt, postId, mpu);
    const body = 'sources=' + encodeURIComponent(token) + '&ver=' + encodeURIComponent(ver || '2');
    const r = await httpPostForm(HOST + '/api/play/', body, { referer, timeout: 18000 });
    lastDiag = r.diag || '';
    if (!r.text) { lastStage = r.stage || 'post-none'; continue; }
    let resp;
    try { resp = JSON.parse(r.text); } catch (e) { return { paths: [], stage: 'post-bad', via: r.via, postDiag: lastDiag, bank: 'miss' }; }
    if (!resp || resp.status !== true || !resp.data) { lastStage = 'post-bad'; continue; }
    const paths = [];
    try { paths.push({ lo: t(resp.lo) || 'main', path: dexResp(postId, resp.data) }); } catch (e) { /* 主线解码失败 */ }
    if (resp.reserve) {
      try {
        const arr = JSON.parse(dexRespUtf8(postId, resp.reserve));
        for (const x of arr) {
          if (x && x.data) {
            try { paths.push({ lo: t(x.lo) || 'bak', path: dexResp(postId, x.data) }); } catch (e) { /* 跳过坏备线 */ }
          }
        }
      } catch (e) { /* reserve 整体解码失败: 只用主线 */ }
    }
    return { paths: paths.filter(p => p.path && p.path.startsWith('//')), stage: 'ok', via: r.via, postDiag: lastDiag, bank: 'miss' };
  }
  return { paths: [], stage: lastStage, via: '', postDiag: lastDiag, bank: 'miss' };
}

// 直连通道名 (设备自身出口; 与播放器同 IP)。其余通道 (own/demo/
// jina/ao*) 均为代理出口, 解出的绑定型令牌与播放器 IP 不符。
const DIRECT_CHANNELS = new Set(['fetch', 'req', 'https']);

// embed 取页: 直连三栈优先 (令牌绑查看者 IP), 代理只兜底。
// 回 {html, win:{name,status}} —— 有效 = 正文含 data-config。
async function fetchEmbedPage(url, referer, directOnly) {
  const t0 = Date.now();
  const budget = 20000;
  const outcomes = [];
  let winner = null;
  let resolveWin;
  const winP = new Promise((r) => { resolveWin = r; });
  const judge = (name, res, ms) => {
    const body = (res && res.body) || '';
    const oc = { name, status: (res && res.status) || 0, bytes: body.length, ms, ok: body.includes('data-config="'), err: (res && res.err) || '' };
    outcomes.push(oc);
    if (oc.ok && !winner) { winner = { html: body, oc }; resolveWin(winner); }
    return oc;
  };
  const runWave = async (wave) => {
    const jobs = wave.map(([name, fn, to]) => (async () => {
      const s = Date.now();
      let res;
      try { res = await fn(url, to); } catch (e) { res = { status: 0, body: '', err: String((e && e.message) || e) }; }
      return judge(name, res, Date.now() - s);
    })());
    const all = Promise.allSettled(jobs);
    const remain = Math.max(3000, budget - (Date.now() - t0));
    const deadline = new Promise((r) => setTimeout(r, remain));
    await Promise.race([winP, all, deadline]);
  };
  const hdrs = { ...BROWSER_HEADERS, Referer: referer || REFERER };
  const eFetch = async (u, to) => (HAS_FETCH ? fetchViaGlobal(u, hdrs, to) : reqRaw(u, hdrs, to));
  const eReq = async (u, to) => reqRaw(u, hdrs, to);
  const eDemo = async (u, to) => fetchRaw2('https://test.cors.workers.dev/?' + u, { ...WD_HEADERS }, to);
  await runWave([['fetch', eFetch, 9000], ['req', eReq, 9000], ['https', chHttps, 9000]]);
  if (!winner && !directOnly) await runWave([['own', chOwn, 10000], ['demo', eDemo, 10000]]);
  if (!winner && !directOnly) await runWave([['jina', chJina, 10000], ['aoGet', chAoGet, 10000], ['aoRaw', chAoRaw, 10000], ['codetabs', chCodetabs, 9000]]);
  if (winner) return { html: winner.html, win: winner.oc, outcomes };
  return { html: '', win: null, outcomes };
}

// embed 页 -> {sources, direct, viaName} (direct = 直连栈取回,
// 文件令牌绑设备 IP, 与播放器自洽)
async function resolveEmbed(embedUrl, referer, directOnly) {
  const r = await fetchEmbedPage(embedUrl, referer, directOnly);
  if (!r.html) return null;
  const cfg = (r.html.match(/data-config="([^"]+)"/) || [])[1];
  if (!cfg) return null;
  let u;
  try { u = new URL(embedUrl); } catch (e) { return null; }
  try {
    const { sources } = decryptConfig(cfg, u.pathname, u.search);
    if (Array.isArray(sources) && sources.length) {
      return { sources, direct: !!(r.win && DIRECT_CHANNELS.has(r.win.name)), viaName: r.win ? r.win.name : '' };
    }
  } catch (e) { /* 解密失败 */ }
  return null;
}

const HOST_PRETTY = [
  [/maxstream/i, 'MaxStream'],
  [/streamhls/i, 'StreamHLS'],
  [/hugstream/i, 'HugStream'],
  [/cloudatacdn|clouddata/i, 'CloudCDN'],
  [/streamtape|tapecontent/i, 'StreamTape'],
  [/pianopic/i, 'PianoPic'],
  [/turbovid|turbo/i, 'TurboVid'],
  [/filemoon|filemoonu/i, 'FileMoon'],
  [/vidhide|earnvid/i, 'VidHide'],
  [/voe/i, 'VOE'],
];
function prettyHost(fileUrl) {
  for (const [re, name] of HOST_PRETTY) if (re.test(fileUrl)) return name;
  try { return new URL(fileUrl).hostname.replace(/^www\./, ''); } catch (e) { return '线路'; }
}
function hostRank(name) {
  if (name === 'MaxStream') return 0;
  if (name === 'CloudCDN') return 1;
  if (name === 'StreamTape') return 2;
  if (name === 'StreamHLS' || name === 'PianoPic') return 9;
  return 5;
}
// 线路出口分组: 直连解出 (令牌绑设备 IP) > hugstream 前置
// (master.txt, 不绑 IP 只认 Referer) > 借线绑定型 (设备必 403)。
// 变体线的文件是变体清单本身, 分组按其父清单 (parentFile) 判。
function lineGroup(ln) {
  if (ln.direct) return 0;
  if (/master\.txt(\?|$)/i.test(ln.parentFile || ln.file || '')) return 1;
  return 2;
}

// ---------------- 详情线路缓存 (2026-10-25 能解析不能播修复, 同 bestjavporn) ----------------
// 真机症结: detail 时解出的线与 play 时现场重解的线常不是同一批 ——
// play 时直连 embed 偶发超时/抖动, 重解丢直连线、甚至全空落嗅探。
// 令牌 12h 有效、同机 IP 不变, 详情 10 分钟内的线直接复用最稳:
// play 先用缓存 (含所点的线才算命中), 过期或无所点的线才重解。
const LINE_CACHE_TTL = 10 * 60 * 1000;
const lineCache = new Map(); // durl -> {lines, ts}
function cacheLines(durl, lines) {
  if (!durl || !lines || !lines.length) return;
  lineCache.set(durl, { lines, ts: Date.now() });
  if (lineCache.size > 100) lineCache.delete(lineCache.keys().next().value);
}
function cachedLines(durl, wantIdx, wantV) {
  const hit = lineCache.get(durl);
  if (!hit || (Date.now() - hit.ts) > LINE_CACHE_TTL) return null;
  if (wantIdx >= 0 && !hit.lines.some((l) => l.idx === wantIdx && (l.v || 0) === (wantV || 0)) && !hit.lines.some((l) => l.idx === wantIdx)) return null;
  return hit.lines;
}
// MP4 判定: 非 HLS (type 非 hls 且文件非 m3u8/txt)。播放器不把 play
// header 转给 HLS 分片, 分片缺 Referer 会 302/403; MP4 单请求、
// header 直达, 同组内优先 MP4 最稳。
function isMp4Line(l) {
  if (!l) return false;
  if (/hls/i.test(l.type || '')) return false;
  if (/\.m3u8(\?|$)/i.test(l.file || '') || /\.txt(\?|$)/i.test(l.file || '')) return false;
  return true;
}
function pickPlayLine(lines, tapped) {
  const best = lines[0];
  const playable = lines.filter((l) => lineGroup(l) <= lineGroup(best));
  if (tapped && lineGroup(tapped) <= lineGroup(best) && isMp4Line(tapped)) return tapped;
  const mp4s = playable.filter(isMp4Line).sort((a, b) => ((b.q || 0) - (a.q || 0)) || (hostRank(a.host) - hostRank(b.host)) || (a.idx - b.idx) || ((a.v || 0) - (b.v || 0)));
  if (mp4s.length) return mp4s[0];
  return (tapped && lineGroup(tapped) <= lineGroup(best)) ? tapped : best;
}

// ---------------- 清晰度展开 (2026-10-22 高清修复) ----------------
// 普查坐实 (两站各 4 部样本, castbank/REPORT_hires.md): 每个 embed
// 的 data-config 只给 1 个 source, "低清"不在选源层 —— (1) 旧排序
// 同组内 MaxStream (主清单实测单档 720p) 压在 CloudCDN (1080p
// MP4) 前, 默认首线即 720p; (2) hugstream urlset 主清单含
// 480/720/1080 三档却被整张直出, 播放器从首档 480p 起播。故:
// HLS 主清单在 detail 时经直连栈取回展开变体, 多档逐档出线 (线
// 路名标清晰度, 组内按清晰度降序), 单档主清单照旧直出、只借其
// 标称清晰度参与排序/命名; MP4 按 label 标清晰度。
function labelRes(label) {
  const m = t(label).match(/(\d{3,4})\s*p/i);
  return m ? parseInt(m[1], 10) : 0;
}

// 主清单正文 -> 变体表 [{file, q, bw}] (q 降序, 同 q 码率降序);
// 变体 URI 相对主清单地址解析。无变体回 []。
function parseVariants(body, base) {
  const out = [];
  const lines = String(body || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#EXT-X-STREAM-INF:([^\r\n]*)/);
    if (!m) continue;
    const bw = parseInt((m[1].match(/BANDWIDTH=(\d+)/) || [])[1] || '0', 10);
    const rm = m[1].match(/RESOLUTION=(\d+)x(\d+)/);
    let q = rm ? parseInt(rm[2], 10) : 0;
    if (!q && bw) q = bw >= 2500000 ? 1080 : (bw >= 1100000 ? 720 : 480);
    let uri = '';
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const s = lines[j].trim();
      if (s && !s.startsWith('#')) { uri = s; break; }
    }
    if (!uri) continue;
    try { uri = new URL(uri, base).toString(); } catch (e) { continue; }
    out.push({ file: uri, q, bw });
  }
  out.sort((a, b) => (b.q - a.q) || (b.bw - a.bw));
  return out;
}

// 取清单并判形态: {master:true, variants} / {master:false} (本体
// 即媒体清单) / null (取不到/不是清单)。只走 reqRaw 直连栈 ——
// 与 embed 同为设备出口, 清单令牌自洽; 借线出口取回的变体令牌
// 与播放器 IP 不符, 不用代理通道。
async function fetchMasterVariants(file, referer) {
  try {
    const r = await reqRaw(file, { 'User-Agent': UA, Referer: referer, Accept: '*/*' }, 8000);
    if (!r || !r.body || !r.body.includes('#EXTM3U')) return null;
    const variants = parseVariants(r.body, file);
    if (variants.length) return { master: true, variants };
    if (r.body.includes('#EXTINF')) return { master: false, variants: [] };
    return null;
  } catch (e) { return null; }
}

// 一个 embed 的全部 sources -> 线路表 [{file, type, q, v, parent}]:
// MP4 单条 (q 取 label); HLS 多档主清单逐档一条 (q 降序); 单档
// 主清单/媒体清单/清单取不到时按原文件一条 (q 借变体或 label,
// 借不到为 0)。v = 该 embed 内的序号 (detail/play 对位用)。
async function expandSources(sources, embedUrl) {
  const out = [];
  for (const s of (sources || [])) {
    if (!s || !s.file) continue;
    const isHls = /hls|m3u8/i.test(s.type || '') || /\.m3u8(\?|$)/i.test(s.file) || /\.txt(\?|$)/i.test(s.file);
    if (!isHls) { out.push({ file: s.file, type: t(s.type), q: labelRes(s.label), parent: s.file }); continue; }
    const mv = await fetchMasterVariants(s.file, embedUrl);
    if (mv && mv.master && mv.variants.length > 1) {
      for (const v of mv.variants) out.push({ file: v.file, type: 'hls', q: v.q, parent: s.file });
    } else if (mv && mv.master && mv.variants.length === 1) {
      out.push({ file: s.file, type: t(s.type), q: mv.variants[0].q || labelRes(s.label), parent: s.file });
    } else {
      out.push({ file: s.file, type: t(s.type), q: labelRes(s.label), parent: s.file });
    }
  }
  out.forEach((e, i) => { e.v = i; });
  return out;
}

// 线路显示宿主: 文件宿主无家族命中 (urlset 轮换 CDN 域名) 时回
// 落 embed 家族名 (如 HugStream) —— 轮换域名不是用户能认的宿主。
function displayHost(file, embedUrl) {
  const h = prettyHost(file);
  try {
    if (new URL(file).hostname.replace(/^www\./, '') === h) {
      const eh = prettyHost(embedUrl);
      if (eh && eh !== h) return eh;
    }
  } catch (e) { /* 保持原名 */ }
  return h;
}

const STAGE_TEXT = {
  page: '详情未取到',
  seed: '无播放种子',
  'post-none': '铸造通道不通',
  'post-bad': '铸造被站方拒',
  embed: 'embed未解出',
};

// 全链解析: {html, res, lines, stage, via, postDiag, pageDiag, pathsN}
// 路径集 -> 线路表 (embed 解出 + 清晰度展开 + 全局排序), 供库直出
// 与常规流程共用。
async function linesFromPaths(paths, durl) {
  // 2026-10-27 截图定位修复: 首发 0 线时只用直连三栈再打一发
  // (直连失败多为间歇 403/抖动, 第二发常能成; 借线对绑定型
  // 宿主必 403, 重试不走代理波, 成功路径零额外耗时)。
  const run = async (directOnly) => {
    const out = [];
    await Promise.all(paths.slice(0, 8).map(async (p, idx) => {
      const embedUrl = 'https:' + p.path;
      const r = await resolveEmbed(embedUrl, durl, directOnly);
      if (!r) return;
      const expanded = await expandSources(r.sources, embedUrl);
      for (const e of expanded) {
        out.push({ idx, v: e.v, lo: p.lo, embedUrl, file: e.file, parentFile: e.parent, type: e.type, host: displayHost(e.file, embedUrl), q: e.q, direct: !!r.direct });
      }
    }));
    return out;
  };
  let lines = await run(false);
  if (!lines.length && paths.length) lines = await run(true);
  // 排序骨架不变 (出口组优先), 组内先比清晰度 (高清在前), 再比
  // 宿主可靠性与原序 —— 修 (1): 1080p 线不再被 720p 线压在后面。
  lines.sort((a, b) => (lineGroup(a) - lineGroup(b)) || ((b.q || 0) - (a.q || 0)) || (hostRank(a.host) - hostRank(b.host)) || (a.idx - b.idx) || ((a.v || 0) - (b.v || 0)));
  return lines;
}

async function resolveLines(durl) {
  // 库直出 (2026-10-25): 详情取页常被站方墙挡 (设备侧全通道 403),
  // 但库内路径只凭 watch URL 即可查 —— 先查库, 命中且 embed 解出
  // 线则直接用, 不必等详情页 (详情页只剩元数据作用, 线路不再被
  // 它卡死)。未命中或 embed 全灭才走原流程 (详情->种子->现铸)。
  // 注意: 库直出时 html 为空, detail() 会走 slug 派生片名分支。
  // 2026-10-27 详情巨慢修复: 查库与详情取页并行 (详情取页无
  // 共享副作用, 不会污染查库结果); 库命中且有线仍优先, 未命
  // 中时直接用已在跑的详情结果, 不再串行叠加两段耗时。
  const detailP = fetchPage(durl, 'detail');
  const bank0 = await castBankLookup(durl);
  if (bank0.hit) {
    const lines0 = await linesFromPaths(bank0.paths, durl);
    if (lines0.length) return { html: '', res: null, lines: lines0, stage: 'ok', via: 'cast-bank', postDiag: '', bank: 'hit' };
  }
  const res = await detailP;
  const html = res.html;
  if (!html) return { html: '', res, lines: [], stage: 'page', via: '', pageDiag: pageDiagOf(res.outcomes) };
  const { postId, mpu, ver } = extractPlaySeed(html);
  if (!postId || !mpu) return { html, res, lines: [], stage: 'seed', via: '' };
  const { paths, stage, via, postDiag, bank } = await fetchEmbedPaths(postId, mpu, ver, durl);
  if (!paths.length) return { html, res, lines: [], stage, via, postDiag, bank };
  const lines = await linesFromPaths(paths, durl);
  if (!lines.length) return { html, res, lines: [], stage: 'embed', via, postDiag, pathsN: paths.length, bank };
  return { html, res, lines, stage: 'ok', via, postDiag, bank };
}

function absUrl(u) {
  if (/^https?:\/\//.test(u)) return u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

// ---------------- 处理函数 ----------------
async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const url = HOST + '/';
  const res = await fetchPage(url, 'list');
  const list = res.html ? parseCards(res.html).slice(0, 30) : [];
  return { class: cls, list: [diagCard(res, list.length), ...list] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || CATS[0].type_id;
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const url = catUrl(tid, page);
  const res = await fetchPage(url, 'list');
  if (!res.html) {
    return { page, pagecount: page, limit: 24, total: 0, list: [diagCard(res, 0)] };
  }
  const list = parseCards(res.html);
  const pc = pagecountOf(res.html);
  return { page, pagecount: Math.max(pc, page), limit: 24, total: list.length, list: [diagCard(res, list.length), ...list] };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  if (id === DIAG_ID) {
    const url = HOST + '/';
    const res = await fetchPage(url, 'list');
    const cards = res.html ? parseCards(res.html).length : 0;
    return {
      list: [{
        vod_id: DIAG_ID,
        vod_name: diagCardName(res, cards),
        vod_pic: '',
        vod_remarks: '通道诊断',
        vod_content: diagText(url, res),
        vod_play_from: '诊断',
        vod_play_url: '状态$' + DIAG_ID,
      }],
    };
  }
  const durl = absUrl(id);
  subWarm(durl); // 字幕预热: 与下方铸造链并行, 不 await (见字幕聚合节)
  let rl;
  try { rl = await resolveLines(durl); }
  catch (e) { rl = { html: '', lines: [], stage: 'error', via: '', pageDiag: '', postDiag: '' }; }
  const { html, lines, stage, via } = rl;
  if (lines.length) cacheLines(durl, lines); // 供 play 复用 (见详情线路缓存节)
  if (!html && !lines.length) {
    // 取页全灭且无库直出线: 永不返回空 —— 名字从 URL slug 派生,
    // 分集名带取页通道逐个结论, 点播落嗅探 (重开详情即整链重试)。
    const slug = (durl.match(/\/video\/([^/]+)\//) || [])[1] || '';
    const nm = slug ? clean(slug.replace(/[-_]+/g, ' ')) : NAME;
    subCacheName(durl, nm);
    const diag = rl.pageDiag || '无记录';
    const epName = ('正片·取页全灭 ' + diag + '·仅嗅探').slice(0, 110);
    return {
      list: [{
        vod_id: durl,
        vod_name: nm,
        vod_pic: '',
        vod_remarks: '详情取不到·仅嗅探',
        vod_content: '诊断: 详情页取数全灭\n通道: ' + diag + '\n已附网页嗅探兜底一集; 通道恢复后重开详情即可整链重试。',
        vod_play_from: '网页嗅探·取页全灭',
        vod_play_url: epName + '$' + durl + '@@sniff',
      }],
    };
  }
  // 库直出 (详情页被墙、但库内有线): 片名从 slug 派生, 封面空缺,
  // 线路照常出 —— 有线可播远胜取页全灭仅嗅探。
  let name = '';
  if (!html) {
    const slug = (durl.match(/\/video\/([^/]+)\//) || [])[1] || '';
    name = slug ? clean(slug.replace(/[-_]+/g, ' ')) : durl;
  } else {
    name = og(html, 'title').replace(/\s*-\s*JAV HD Porn\s*$/i, '');
    if (!name) {
      const tm = html.match(/<title>([^<]+)<\/title>/);
      name = tm ? clean(tm[1]).replace(/\s*-\s*JAV HD Porn\s*$/i, '') : durl;
    }
  }
  if (name) subCacheName(durl, name); // 字幕搜索键优先用真片名 (见字幕聚合节)
  const pic = og(html, 'image');
  const desc = og(html, 'description');
  const secM = html.match(/"articleSection":\[([^\]]*)\]/);
  const remarks = secM ? secM[1].replace(/"/g, '').split(',').map(s => s.trim()).filter(Boolean).join(' / ') : '';
  const contentParts = [];
  if (desc) contentParts.push(desc);
  const fromNames = [];
  const playUrls = [];
  // 呈现 (清晰度自选): 按清晰度分组 tab —— tab 名即清晰度
  // (1080p/720p/480p…, 仅 5 字符, MiraPlayer tab 栏不会截断;
  // 本仓 missav.js 有质量 tab 先例), tab 按清晰度降序, 默认首
  // tab = 最高档, 网差时用户切低档 tab。tab 内每线一集, 集名 =
  // 宿主+lo+「·直」 (同名加 ·N 序号消歧), 集序沿用 lines 全局
  // 序在同档内的相对序 (出口组→宿主序→原序)。q 不明的线归
  // 「默认」tab 垫底; 嗅探兜底独立 tab 放最后 (下方 else 分支)。
  // 注: resolveLines 的全局排序不动 —— play() 靠它做"借线令牌
  // 在设备必 403 时替用户改走最优线"的守卫, 清晰度只落呈现层。
  const qGroups = new Map();
  lines.forEach((ln) => {
    const q = ln.q || 0;
    if (!qGroups.has(q)) qGroups.set(q, []);
    qGroups.get(q).push(ln);
  });
  const qOrder = [...qGroups.keys()].sort((a, b) => b - a);
  for (const q of qOrder) {
    fromNames.push(q ? q + 'p' : '默认');
    const seen = new Map();
    const eps = qGroups.get(q).map((ln) => {
      let nm = ln.lo && ln.lo !== 'main' ? `${ln.host}·${ln.lo}` : ln.host;
      if (ln.direct) nm += '·直';
      const n = (seen.get(nm) || 0) + 1;
      seen.set(nm, n);
      if (n > 1) nm += '·' + n;
      return nm + '$' + durl + '@@' + ln.idx + '.' + (ln.v || 0);
    });
    playUrls.push(eps.join('#'));
  }
  if (!lines.length) {
    // 铸造链没拿到线路: 给一条嗅探线, 分集名带失败阶段与铸造
    // 通道逐个结论 (MiraPlayer 显示分集名, 截图即可归因)。
    fromNames.push('网页嗅探·' + (STAGE_TEXT[stage] || '铸造失败'));
    let epName;
    const bankNote = rl.bank === 'hit' ? '库命中·' : '库未命中·';
    if (stage === 'post-none') epName = '正片·' + bankNote + '铸造全灭 ' + (rl.postDiag || '无记录') + '·仅嗅探';
    else if (stage === 'post-bad') epName = '正片·' + bankNote + '铸造被站方拒 ' + (rl.postDiag || '无记录') + '·仅嗅探';
    else if (stage === 'embed') epName = '正片·' + bankNote + 'embed未解出' + (rl.pathsN ? ' 铸出' + rl.pathsN + '路' : '') + '·仅嗅探';
    else if (stage === 'seed') epName = '正片·无播放种子·仅嗅探';
    else if (stage === 'page') epName = '正片·详情未取到·仅嗅探';
    else epName = '正片·' + (STAGE_TEXT[stage] || '铸造失败') + '·仅嗅探';
    playUrls.push(epName.slice(0, 110) + '$' + durl + '@@sniff');
    contentParts.push('铸造诊断: ' + (STAGE_TEXT[stage] || '铸造失败') + (rl.postDiag ? ' (' + rl.postDiag + ')' : ''));
  } else {
    if (via) contentParts.push('铸造通道: ' + via);
    const nDirect = lines.filter((l) => l.direct).length;
    contentParts.push(`线路出口: 直连${nDirect}/${lines.length} (直连线令牌绑本机IP, 优先点带「·直」的线; 已按清晰度分 tab, 首个 tab 为最高档, 网差时切 720p tab)`);
    // 直链仍播不了时的最后兜底: WebView 嗅探详情页
    fromNames.push('网页嗅探·兜底');
    playUrls.push('播放$' + durl + '@@sniff');
  }
  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_content: contentParts.join('\n'),
      vod_play_from: fromNames.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

function sniffResult(durl) {
  // 最后兜底: 交给 App 的 WebView 嗅探 (真实浏览器环境可跑站方链)
  return { parse: 1, jx: 0, url: durl, header: { 'User-Agent': UA, Referer: REFERER } };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (id.includes(DIAG_ID)) return { parse: 0, url: '' };
  // @@sniff 伪线: 点播时先再试一次完整铸造链 (通道有偶发性,
  // 第二次常能成), 实在不行才落嗅探。
  const sniffOnly = id.endsWith('@@sniff');
  if (sniffOnly) id = id.slice(0, -'@@sniff'.length);
  const mm = id.match(/^(https?:\/\/\S+?)@@(\d+)(?:\.(\d+))?$/);
  const durl = mm ? mm[1] : absUrl(id);
  const wantIdx = mm ? parseInt(mm[2], 10) : -1;
  const wantV = mm && mm[3] !== undefined ? parseInt(mm[3], 10) : 0;
  // 字幕搜索与铸造链并行发起 (不串行叠加延迟; 见字幕聚合节)
  const subsP = subSearchAll(durl).catch(() => []);
  // 详情缓存优先 (见详情线路缓存节): 10 分钟内且含所点的线, 直接
  // 用详情时那批线, 不重解; 否则现场重解, 有线则刷新缓存。选线:
  // 可播组内优先 MP4 (见 pickPlayLine), 否则沿用旧规则。
  let lines = cachedLines(durl, wantIdx, wantV);
  if (!lines) {
    try { ({ lines } = await resolveLines(durl)); } catch (e) { lines = []; }
    if (lines.length) cacheLines(durl, lines);
  }
  if (!lines.length) return sniffResult(durl);
  const tapped = lines.find((l) => l.idx === wantIdx && (l.v || 0) === wantV) || lines.find((l) => l.idx === wantIdx);
  const pick = pickPlayLine(lines, tapped);
  return subAttach({ parse: 0, url: pick.file, header: { 'User-Agent': UA, 'Referer': pick.embedUrl } }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd || body.keyword || body.key);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!kw) return { page, pagecount: 1, limit: 24, total: 0, list: [] };
  const res = await fetchPage(searchUrl(kw, page), 'list');
  if (!res.html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = parseCards(res.html);
  const pc = pagecountOf(res.html);
  return { page, pagecount: Math.max(pc, page), limit: 24, total: list.length, list };
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

// ---------------- 字幕聚合 (Layer A 重写, 2026-10-23) ----------------
// 按用户自有迅雷看看 REX 组件 (xunlei.subtitle) 的方法重写: 旧版把
// [番号, 全标题, 番号+标题] 多个键的召回合并成一池只排序不过滤,
// 全标题键的模糊召回灌进大量别片字幕 (实测 JUR-887 全标题键池
// 前排即 JUX-021 等别片), 且迅雷档位恒占满上限 10, SubtitleCat
// 永远挤不进来。新版三招 (与组件一致):
// (a) 键序逐个查、首个有结果的键即停 — 番号键命中的池小而准;
// (b) 命中后严过滤: 条目 name/langs/ext 须含番号 (宽松形亦可)
//     或片名全文, 不含的全扔, 无回退 (组件原法的回退宽松名单
//     在冷门番号上会把邻近番号的模糊池整池放行, 实测有害已删;
//     乱码单字键亦实测能召回无关字幕, 同样靠严过滤挡下);
// (c) 组件打分: cid_match 100000、含番号 +25000, 再加 oracle 自
//     带 score / fingerprintScore / 下载量, 按名+址去重取 top。
// 槽位 (用户钦定): 迅雷 (键序 [番号, 紧凑番号]) > 迅雷看看
// (组件完整键序 [番号, 紧凑番号, 番号+标题, 紧凑番号+标题,
// 全标题]) > SubtitleCat; 两迅雷槽同走同一 oracle 接口、不管
// 重不重复, 合并按 URL 去重、同条归高档位。合并序 = 档位 ->
// 语言 (简中>繁中>双语>英文>日文>其他, 沿用 subLangOf 口径)
// -> 分数; 全局上限 10、单槽软上限 8 (SubtitleCat 留位)。
// 全程 subHttp (框架 req 主栈), 迅雷系逐请求超时 3s、键序串行
// 首中即停; 总预算 6s、失败全静默; 无结果时 play 返回对象不带
// subs 键, 与未接入前逐字段一致。SubHD (下载被站方门控) 与
// 射手 (源站 522) 仍不接入。
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

// 搜索上下文: 片名、番号、紧凑番号、标题部分 (去番号与噪声词)
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

// 迅雷槽键序: 只番号两键 (锚定)
function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}

// 迅雷看看槽键序: 组件完整键序 (番号、紧凑番号、番号+标题、
// 紧凑番号+标题、全标题), 逐个查、首中即停。
function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}

// 严过滤的匹配文本 (组件口径: 片名 + 上下文, 全小写与去分隔符两形)
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

// 文本字幕格式判定: 文件名扩展名 > 条目 ext 字段 > url 后缀;
// 压缩包一律剔除 (与组件 getExt 口径一致, 只认 srt/vtt/ass/ssa)。
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

// 裸哈希名不可读: 显示名换成番号字幕 (匹配/过滤仍用原名)
function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}

// oracle 单键查询 (同趟搜索内按键缓存, 两槽共用, 不重复发请求)
async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
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

// oracle 条目归一 (组件 normalizeResult 的字段口径)
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

// 严过滤 (组件口径): 条目 name/langs/ext 须含番号 (原形或宽松
// 形) 或片名全文, 否则扔掉。片名分支必须守非空: 个别蜘蛛的
// 播放 id 与 detail 登记键对不上时片名缓存会落空 (title=''),
// 空串是任何字符串的子串, 不守就会全池放行 (bigbuttshub 实测
// 教训: 假番号 EMPTY-24 搜出的 Sherlock 剧集字幕整页漏入)。
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

// 组件打分 (scoreItem 的电影路径): cid_match 100000、含番号
// +25000、oracle 自带 score/fingerprintScore、下载量、时长/大小。
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

// 迅雷系槽位 (迅雷 tier 0 / 迅雷看看 tier 1): 键序逐个查、首个
// 有结果的键即停; 命中池只过严过滤、无任何回退 — 组件原法的
// 「过滤到空回退宽松名单」在冷门番号上实测有害 (oracle 对无精
// 确字幕的番号返回邻近番号的模糊池, 回退等于整池垃圾放行:
// MOGK-006 挂上 MOGK-004/002、FC2-PPV-4991508 挂上他人番号),
// 与「宁缺毋滥」冲突, 故删除 (与 REX 版相关性闸门口径一致)。
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

// SubtitleCat 槽 (tier 2): 沿用旧芯搜索/解析 (按番号键搜、逐页
// 取按语言分的直链), 同样过严过滤 (无回退)。
async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
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
      if (!subRelevant({ name: nm, langs: '', ext: '' }, ctx, match)) continue;
      const lang = subLangOf(nm, '');
      const fmt = (nm.match(/\.(srt|vtt|ass)$/i) || [])[1].toLowerCase();
      bag.push({ src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], fmt, lang: lang.tag, langRank: lang.rank, score: 0 });
    }
  }));
}

// 合并: 档位 -> 语言 -> 分数; 按 URL 去重 (同条归先到高档位);
// 全局上限 10、单槽软上限 8 (给 SubtitleCat 留位)。
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

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

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
    },
  };
}
