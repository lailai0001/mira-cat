// JAV HD Porn (https://www.javhdporn.net) -> CatPawOpen spider
// 站点性质: WordPress 聚合站 (kingtube 系主题), 与 bestjavporn.com 同一
// 运营网络 (共用图片 CDN pics.pornfhd.com / 预览 CDN video.pornfhd.com)。
// 列表/详情/搜索均为服务端渲染, VM 直连 200, 无验证墙。
// 封面: pics.pornfhd.com 直连 https, 实测无防盗链 (无 Referer 裸拉 200),
// 卡片 data-lazy-src 是 /s/ 小图, 去掉 /s/ 即大图; 详情用 og:image。
// 分类 URL 形态: /category/{slug}/ 会 301 到带版本前缀的 /v3/category/
// {slug}/ (前缀会变, 故蜘蛛用无前缀形态 + 跟随重定向, 不写死版本号)。
// 每页 24 条; 分页 /page/{n}/; 搜索 /search/{kw}/ (实测可用)。
//
// 播放链 (2026-10-21 侦察坐实, 全程 jsdom 跑站方原版 JS 取证):
// 详情页 .play-button 点击 -> cast.js 在客户端做加密变换 (纯 JS 密码学,
// 混淆代码内实现, WebCrypto 零调用) 把 data-mpu 密文换成 sources 令牌
// -> POST /api/play/ -> 响应密文在客户端解密 -> 得到 embed 地址
// video(1).javhdporn.net/p/{id}?t=&s= -> embed 页 main.js 解密
// #jwplayer 的 data-config -> JW sources。抽样 3 片的最终托管:
//   - FC2 片 -> streamtape mp4: get_video 令牌绑铸造方 IP (换出口
//     403), 但其 302 跳出的 tapecontent 直链不绑 IP —— 机房出口拉
//     本体 403, CF 出口实测 200 拉到真 mp4。中转负责铸造并解出
//     tapecontent 直链, 蜘蛛 parse:0 直返, 设备直连。
//   - 字幕/破解片 -> streamhls.click HLS master: 令牌每次铸造全新,
//     但 curl / Node fetch 实测全部 403 (embed 页内 fetch 探针两次
//     均未取得结果, 未证实) —— 非浏览器客户端拉不到, 中转也救不了,
//     只有真浏览器 (含 App WebView 嗅探) 能播。
// 蜘蛛运行时无 DOM、无 jsdom、禁用 vm, 铸造链无法在蜘蛛内复现。
// 故 play 设计:
//   1) 首选自建中转 (下方 RELAY 常量, 部署后由主代理回填域名):
//      中转跑站方 JS 铸造 sources, streamtape 线解出 tapecontent
//      直链回蜘蛛 parse:0 直返; streamhls 线中转如实回失败;
//   2) 中转未部署/失败 (含 streamhls 线) -> parse:1 嗅探详情页
//      (真机 WebView 是真实浏览器, 站方整条链在浏览器内原生可跑;
//      本仓嗅探多次实证不稳定, 仅作最后兜底, 不承诺)。
import req from '../../util/req.js';

const KEY = 'py_javhdporn';
const NAME = 'JAVHDPorn';
const HOST = 'https://www.javhdporn.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = HOST + '/';
// 播放中转 (javhdporn-relay, 用户部署后回填; 留空则 play 直接落嗅探)
const RELAY = '';

// 分类: 2026-10-21 逐类实测站方计数 (results 数见注释), 全部有真实内容
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
  { type_id: 'subtitle-indonesia', type_name: '印尼字幕' },                // 5567
  { type_id: 'censored/subthai', type_name: '泰文字幕' },                  // 893
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

// ---------------- 抓取 (第五轮: 解析型校验 + 扩容通道池竞速) ----------------
// 2026-10-22 第五轮 (与 bestjavporn 同步)。第四轮 (并行竞速) 真机仍
// 全灭, 本轮逐通道原始应答复测 (VM 出口, 与校验判定分开记录):
//   直连 fetch / jina(html 模式): 两站均 200 真页 (0.1~2s);
//   allorigins /raw、codetabs: 当日全程 522, 且各烧约 20s 才回;
//   allorigins /get (JSON 包装): 对 bestjavporn 可用 (2/2 真页),
//     对本站被其出口挡 (522/408) —— 两站 CF 区域规则并不一致;
//   新通道 test.cors.workers.dev (Cloudflare 官方 CORS demo, 须带
//     X-Requested-With 头): 对规范 URL 直出真页且极快 (0.1~1.5s);
//     但目标 URL 若会 301 (本站 /category/x/ -> /v3/category/x/),
//     它回自己的说明页 —— 该通道须喂规范 URL, 前缀从任何成功页的
//     canonical 链接学习 (默认 /v3, 页面变化时自动更新);
//   corsproxy.io 已改 API-Key 制 (401)、cors.lol 限流、cors.eu.org /
//     bridged / whateverorigin 等均已死或不可达, 不纳入。
//   框架 req (axios) 在 VM 沙箱被出口代理 ECONNRESET (连 httpbin
//     都挂), 属沙箱假象, 不代表用户服务端; 其线上 UA 经回显实测
//     确为蜘蛛所设 Chrome UA —— 前轮"蜘蛛 UA 不生效"的说法无直接
//     证据, 本轮按"多栈并存、不押单栈"设计。
// (推导, 非实测) 真机全灭的最合理解释仍是出口差异: 用户运行时
// 出口下直连各栈与 jina (大陆不可达) 同时失效时, 第四轮只剩当时
// 全 522 的 B 组, 竞速救不了全体通道死亡。本轮对策:
//   ① 通道池扩容: 新增 workers.dev 通道 (与用户已在用的自有
//     Worker 同域, 可达性谱系不同于 jina/公共中转) 与 allorigins
//     /get 形态、原生 https 栈, 全部并行竞速, 存活者最快胜出;
//   ② 校验改解析型: 列表页以"真能解出卡片"为准、详情页以播放器
//     /og 标记为准 —— 杜绝"通道拿到了页面却被长度/关键词校验
//     误杀", 也杜绝垃圾页 (中转说明页/限流页) 被误收;
//   ③ 慢中转只进第二波且封顶; 全灭回空, 不再回未校验残页。
import https from 'https';
import zlib from 'zlib';

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
// 解析型校验 (parseCards 为函数声明, 已提升, 此处可直接调用)
function validListPage(html) {
  return !!html && !isShellPage(html) && parseCards(html).length > 0;
}
function validDetailPage(html) {
  return !!html && !isShellPage(html) && html.length > 4000 &&
    (/property="og:(title|image)"/.test(html) || html.includes('videojs.html') || html.includes('data-mpu'));
}

async function viaReq(url, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, Referer: REFERER },
      timeout: timeoutMs || 12000,
    });
    const d = typeof r === 'string' ? r : (r && r.data !== undefined ? r.data : r);
    return typeof d === 'string' ? d : '';
  } catch (e) {
    return '';
  }
}

async function fetchText(url, headers, timeoutMs) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 12000);
    const r = await fetch(url, { headers, redirect: 'follow', signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  }
}

async function viaFetch(url, timeoutMs) {
  return fetchText(url, { ...BROWSER_HEADERS, Referer: REFERER }, timeoutMs);
}

// 原生 https 栈 (与 req/fetch 不同的代码路径; 手工重定向 + 解压)
function viaHttps(url, timeoutMs, depth = 0) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const u = new URL(url);
      const rq = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: { ...BROWSER_HEADERS, Referer: REFERER, 'Accept-Encoding': 'gzip, deflate, br' },
        timeout: timeoutMs || 12000,
      }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          res.resume();
          fin(viaHttps(new URL(loc, url).toString(), timeoutMs, depth + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); fin(''); return; }
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '');
        try {
          if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
          else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
          else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        } catch (e) { /* 解压失败则按原文读 */ }
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => fin(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', () => fin(''));
      });
      rq.on('timeout', () => { rq.destroy(); fin(''); });
      rq.on('error', () => fin(''));
      rq.end();
    } catch (e) { fin(''); }
  });
}

// workers.dev 通道须喂规范 URL: /category|search 前的版本前缀从
// 成功页面学习 (页面 canonical/og:url 均为规范形态); 默认 /v3。
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
async function viaWorkersDemo(url, timeoutMs) {
  return fetchText('https://test.cors.workers.dev/?' + wdTarget(url), {
    'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Origin: HOST,
  }, timeoutMs);
}

async function viaJina(url, timeoutMs) {
  return fetchText('https://r.jina.ai/' + url, {
    'User-Agent': UA,
    'x-respond-with': 'html',
  }, timeoutMs);
}

async function viaAlloriginsGet(url, timeoutMs) {
  const txt = await fetchText('https://api.allorigins.win/get?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
  if (!txt) return '';
  try {
    const j = JSON.parse(txt);
    return typeof j.contents === 'string' ? j.contents : '';
  } catch (e) { return ''; }
}

async function viaAlloriginsRaw(url, timeoutMs) {
  return fetchText('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
}

async function viaCodetabs(url, timeoutMs) {
  return fetchText('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
}

async function raceValid(fns, valid) {
  const jobs = fns.map((fn) => (async () => {
    let html = '';
    try { html = await fn(); } catch (e) { html = ''; }
    if (valid(html)) return html;
    throw new Error('invalid page');
  })());
  return Promise.any(jobs);
}

async function getPage(url, kind) {
  const valid = kind === 'detail' ? validDetailPage : validListPage;
  const wave1 = [
    () => viaFetch(url, 12000),
    () => viaReq(url, 12000),
    () => viaHttps(url, 12000),
    () => viaWorkersDemo(url, 12000),
    () => viaJina(url, 12000),
    () => viaAlloriginsGet(url, 15000),
  ];
  try {
    const html = await raceValid(wave1, valid);
    notePrefix(html);
    return html;
  } catch (e) { /* 第一波全灭, 进第二波 */ }
  const wave2 = [
    () => viaAlloriginsRaw(url, 15000),
    () => viaCodetabs(url, 12000),
    () => viaJina(url, 10000),
    () => viaWorkersDemo(url, 10000),
  ];
  try {
    const html = await raceValid(wave2, valid);
    notePrefix(html);
    return html;
  } catch (e) { /* 全灭: 回空, 不再回未校验残页 */ }
  return '';
}

// ---------------- 解析 ----------------
// 卡片: <article class="thumb-block ..."> 内 a.archive-entry(href,title)
// + img[data-lazy-src] + span.duration / span.views
function parseCards(html) {
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
  const html = await getPage(HOST + '/');
  const list = html ? parseCards(html).slice(0, 30) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || CATS[0].type_id;
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await getPage(catUrl(tid, page));
  if (!html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = parseCards(html);
  const pc = pagecountOf(html);
  return { page, pagecount: Math.max(pc, page), limit: 24, total: list.length, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
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
      vod_play_url: `正片$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  const durl = /^https?:\/\//.test(id) ? id.split('$').pop() : HOST + id;
  // 1) 自建中转 (部署后生效): 中转铸造 + 解出 tapecontent 直链
  if (RELAY) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 90000);
      const r = await fetch(`${RELAY}/play?url=${encodeURIComponent(durl)}`, { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json();
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
  const html = await getPage(searchUrl(kw, page));
  if (!html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = parseCards(html);
  const pc = pagecountOf(html);
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
