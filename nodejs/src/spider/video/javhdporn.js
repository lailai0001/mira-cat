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
// 播放链 (2026-10-21 侦察坐实, 沿用至今未变):
// 详情页 .play-button 点击 -> cast.js 在客户端把 data-mpu 密文换成
// sources 令牌 -> POST /api/play/ -> embed 页解密得 JW sources。
// 蜘蛛运行时无 DOM、禁用 vm, 铸造链无法在蜘蛛内复现。故 play 设计:
//   1) 自建中转 RELAY (留空, 部署后回填): 中转铸造 + 解直链;
//   2) 中转未部署/失败 -> parse:1 嗅探详情页 (真机 WebView 是真实
//      浏览器, 站方整条链可在页内原生跑)。详情里该线标注家族「嗅探」。
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
// 播放中转 (javhdporn-relay, 用户部署后回填; 留空则 play 直接落嗅探)
const RELAY = '';
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
  const durl = /^https?:\/\//.test(id) ? id : HOST + (id.startsWith('/') ? id : '/' + id);
  const html = await getPage(durl, 'detail');
  if (!html) return { list: [] };
  let name = og(html, 'title').replace(/\s*-\s*JAV HD Porn\s*$/i, '');
  if (!name) {
    const tm = html.match(/<title>([^<]+)<\/title>/);
    name = tm ? clean(tm[1]).replace(/\s*-\s*JAV HD Porn\s*$/i, '') : durl;
  }
  const pic = og(html, 'image');
  const desc = og(html, 'description');
  const secM = html.match(/"articleSection":\[([^\]]*)\]/);
  const remarks = secM ? secM[1].replace(/"/g, '').split(',').map(s => s.trim()).filter(Boolean).join(' / ') : '';
  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_content: desc,
      vod_play_from: 'JAVHDPorn',
      // 线路家族标注: 本站铸造链依赖客户端 JS, 蜘蛛内不可复现,
      // 唯一线路为 WebView 嗅探详情页 (家族: 嗅探)。
      vod_play_url: `正片·嗅探$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes(DIAG_ID)) return { parse: 0, url: '' };
  const durl = /^https?:\/\//.test(id) ? id.split('$').pop() : HOST + id;
  // 1) 自建中转 (部署后生效): 中转铸造 + 解出直链 (走 req, 不用 fetch)
  if (RELAY) {
    try {
      const r = await reqRaw(`${RELAY}/play?url=${encodeURIComponent(durl)}`, { 'User-Agent': UA }, 90000);
      if (r.status === 200 && r.body) {
        const j = JSON.parse(r.body);
        if (j && j.ok && j.url) {
          return { parse: 0, url: j.url, header: { 'User-Agent': UA, Referer: REFERER } };
        }
      }
    } catch (e) { /* 落兜底 */ }
  }
  // 2) 最后兜底: 嗅探详情页 (真机 WebView 为真实浏览器, 站方链可原生跑)
  return { parse: 1, jx: 0, url: durl, header: { 'User-Agent': UA, Referer: REFERER } };
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
