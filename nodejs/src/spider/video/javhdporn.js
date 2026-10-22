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
  const ownPostTo = async (target) => {
    const w = OWN_FETCH + '/post?u=' + encodeURIComponent(target) + '&ref=' + encodeURIComponent(referer);
    return fetchRaw2(w, { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, 12000, 'POST', bodyStr);
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
  await runWave([['own', ownPost], ['fetch', fetchPost], ['req', reqPost], ['demo', demoPost]]);
  if (!winner && !outcomes.some((o) => o.sawJson)) {
    // own 重试: own 的上游 403 是站方 CF 对 Workers 出口的时段/
    // colo 间歇拒绝 (BJP 真机 16:07 403、16:10 同请求 200), 隔
    // 1.2s / 2.5s 再各打一发。前提是没有任何通道拿到站方 JSON
    // —— 拿到过 JSON=false 说明令牌本身被拒, 由上层换盐处理。
    const tryOwn = async (name, target) => {
      let res;
      try { res = await ownPostTo(target); } catch (e) { res = { status: 0, body: '' }; }
      judge(name, res);
    };
    await new Promise((r) => setTimeout(r, 1200));
    await tryOwn('own2', url);
    if (!winner) {
      await new Promise((r) => setTimeout(r, 2500));
      await tryOwn('own3', url);
    }
  }
  if (!winner) await runWave([['aoRaw', aoPost]]);
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
// 只走 req (App 运行时无全局 fetch); 仅 1 次, 6s 超时; 未命中/
// 超时/坏 JSON/空路径集一律 {hit:false}, 调用方无声落回原铸造。
async function castBankLookup(watchUrl) {
  try {
    const w = OWN_FETCH + '/cast?u=' + encodeURIComponent(watchUrl);
    const r = await reqRaw(w, { 'User-Agent': UA }, 6000);
    if (!r || r.status !== 200 || !r.body) return { hit: false };
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return { hit: false }; }
    const seen = new Set();
    const arr = (j && Array.isArray(j.paths))
      ? j.paths.filter((p) => {
          if (typeof p !== 'string' || !p.startsWith('//') || seen.has(p)) return false;
          seen.add(p);
          return true;
        })
      : [];
    if (!arr.length) return { hit: false };
    return { hit: true, paths: arr.map((p, i) => ({ lo: i === 0 ? 'main' : 'bak', path: p })) };
  } catch (e) {
    return { hit: false };
  }
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
async function fetchEmbedPage(url, referer) {
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
  if (!winner) await runWave([['own', chOwn, 10000], ['demo', eDemo, 10000]]);
  if (!winner) await runWave([['jina', chJina, 10000], ['aoGet', chAoGet, 10000], ['aoRaw', chAoRaw, 10000], ['codetabs', chCodetabs, 9000]]);
  if (winner) return { html: winner.html, win: winner.oc, outcomes };
  return { html: '', win: null, outcomes };
}

// embed 页 -> {sources, direct, viaName} (direct = 直连栈取回,
// 文件令牌绑设备 IP, 与播放器自洽)
async function resolveEmbed(embedUrl, referer) {
  const r = await fetchEmbedPage(embedUrl, referer);
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
async function resolveLines(durl) {
  const res = await fetchPage(durl, 'detail');
  const html = res.html;
  if (!html) return { html: '', res, lines: [], stage: 'page', via: '', pageDiag: pageDiagOf(res.outcomes) };
  const { postId, mpu, ver } = extractPlaySeed(html);
  if (!postId || !mpu) return { html, res, lines: [], stage: 'seed', via: '' };
  const { paths, stage, via, postDiag, bank } = await fetchEmbedPaths(postId, mpu, ver, durl);
  if (!paths.length) return { html, res, lines: [], stage, via, postDiag, bank };
  const lines = [];
  await Promise.all(paths.slice(0, 8).map(async (p, idx) => {
    const embedUrl = 'https:' + p.path;
    const r = await resolveEmbed(embedUrl, durl);
    if (!r) return;
    const expanded = await expandSources(r.sources, embedUrl);
    for (const e of expanded) {
      lines.push({ idx, v: e.v, lo: p.lo, embedUrl, file: e.file, parentFile: e.parent, type: e.type, host: displayHost(e.file, embedUrl), q: e.q, direct: !!r.direct });
    }
  }));
  // 排序骨架不变 (出口组优先), 组内先比清晰度 (高清在前), 再比
  // 宿主可靠性与原序 —— 修 (1): 1080p 线不再被 720p 线压在后面。
  lines.sort((a, b) => (lineGroup(a) - lineGroup(b)) || ((b.q || 0) - (a.q || 0)) || (hostRank(a.host) - hostRank(b.host)) || (a.idx - b.idx) || ((a.v || 0) - (b.v || 0)));
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
  let rl;
  try { rl = await resolveLines(durl); }
  catch (e) { rl = { html: '', lines: [], stage: 'error', via: '', pageDiag: '', postDiag: '' }; }
  const { html, lines, stage, via } = rl;
  if (!html) {
    // 取页全灭保底: 永不返回空 —— 名字从 URL slug 派生, 分集名带
    // 取页通道逐个结论, 点播落嗅探 (重开详情即整链重试)。
    const slug = (durl.match(/\/video\/([^/]+)\//) || [])[1] || '';
    const nm = slug ? clean(slug.replace(/[-_]+/g, ' ')) : NAME;
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
  let name = og(html, 'title').replace(/\s*-\s*JAV HD Porn\s*$/i, '');
  if (!name) {
    const tm = html.match(/<title>([^<]+)<\/title>/);
    name = tm ? clean(tm[1]).replace(/\s*-\s*JAV HD Porn\s*$/i, '') : durl;
  }
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
  // 现场重铸整链 (令牌时效 + IP 绑定的双重要求), 线路已按出口
  // 一致性排序: 用户点的线若与最优线同组则尊重其选择, 否则回
  // 最优线 —— 借线解出的绑定型令牌在设备上必 403, 点了也是白点。
  let lines = [];
  try { ({ lines } = await resolveLines(durl)); } catch (e) { lines = []; }
  if (!lines.length) return sniffResult(durl);
  const tapped = lines.find((l) => l.idx === wantIdx && (l.v || 0) === wantV) || lines.find((l) => l.idx === wantIdx);
  const best = lines[0];
  const pick = (tapped && lineGroup(tapped) <= lineGroup(best)) ? tapped : best;
  return { parse: 0, url: pick.file, header: { 'User-Agent': UA, 'Referer': pick.embedUrl } };
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
