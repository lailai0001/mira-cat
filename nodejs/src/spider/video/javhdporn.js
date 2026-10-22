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

// ---------------- 抓取 (多层兜底 + 内容校验; 第四轮改并行竞速, 见下方) ----------------
// 2026-10-21 第三轮修复 (与 bestjavporn 同病同方):
// 真机故障根因 (VM 实测坐实): 本站 (与 bestjavporn 同运营网络) 的
// Cloudflare 按 User-Agent 拉黑 HTTP 库特征 UA —— okhttp / Java /
// axios / node-fetch / python-requests 等一律 403, 只回 17B~5.5KB
// 空壳页; 浏览器 UA (含空 UA) 则 200 满页。App 运行时发出的请求
// 带的正是这类被拉黑的 UA (蜘蛛设置的 Chrome UA 未能生效到站方),
// 于是真机上 home/category/search/detail 全部只拿到 403 空壳 ->
// 解析 0 卡 -> "有分类、无内容、点不开"。其他源 (Brazz/javideo/
// 7mmtv) 的 CF 区没有这条规则, 故独这两站全灭。
// 对策: 抓取改为多层竞速兜底, 每层结果先过内容校验 (真页面:
// 长度 >12KB 且含 pornfhd.com 标记且无 CF 空壳特征) 才采纳:
//   直连 req -> 直连 fetch -> jina 读页 (x-respond-with:html 取
//   原始 HTML, 实测 1~2s 满页保真) -> allorigins -> codetabs。
// 记住胜出层 (sticky), 后续请求先试它, 避免每次全程试错。
// 总预算 70s; 真机典型路径: 直连两层快速吃 403 (~2s) -> jina ~2s。
function isRealPage(html) {
  if (!html || html.length < 12000) return false;
  if (!html.includes('pornfhd.com')) return false;
  if (/Attention Required|Just a moment|cf-challenge|Checking your browser/i.test(html)) return false;
  return true;
}

async function viaReq(url, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, Referer: REFERER },
      timeout: timeoutMs || 15000,
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
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 15000);
    const r = await fetch(url, { headers, redirect: 'follow', signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  }
}

async function viaFetch(url, timeoutMs) {
  return fetchText(url, { 'User-Agent': UA, Referer: REFERER }, timeoutMs);
}

async function viaJina(url) {
  // jina 匿名读页偶发 401 (出口 IP 信誉), 立即重试一次常能过
  for (let i = 0; i < 2; i++) {
    const html = await fetchText('https://r.jina.ai/' + url, {
      'User-Agent': UA,
      'x-respond-with': 'html',
    }, 15000);
    if (isRealPage(html)) return html;
    if (i === 0) await new Promise((res) => setTimeout(res, 1200));
  }
  return '';
}

async function viaAllorigins(url) {
  return fetchText('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, 20000);
}

async function viaCodetabs(url) {
  return fetchText('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, 15000);
}

// ---------------- 第四轮: 并行竞速 (首个真页面胜出) ----------------
// 第三轮的串行逐层试错在真机上仍被拖死 (2026-10-22 用户复报:
// 分类能出、分类下内容加载不出)。复盘 (VM 实测): 直连两层在
// App 运行时里带被站方拉黑的客户端特征, 注定先吃两记失败; 其后
// allorigins / codetabs 抽风时各回 522 且各烧 20~30s, 串行叠加
// 轻松超过 App 的等待耐心 —— 分类页永远等不到能用的通道胜出。
// 本轮改并行竞速: A 组 (直连 req / 直连 fetch / jina 读页) 同时
// 发车, 谁先回真页面谁赢, 总耗时 = 最快存活通道 (jina 实测
// 0.3~2s 全覆盖 home/分类/详情/搜索); A 组全灭才进 B 组
// (allorigins / codetabs 并行兜底, 各自封顶)。内容校验不变。
const PAGE_LAYERS_A = [
  (url, ms) => viaReq(url, ms),
  (url, ms) => viaFetch(url, ms),
  (url) => viaJina(url),
];
const PAGE_LAYERS_B = [
  (url) => viaAllorigins(url),
  (url) => viaCodetabs(url),
];
let goodLayer = ''; // 上次胜出通道 (仅记录, 不再决定顺序)

async function firstValid(fns, url, timeoutMs, track) {
  const jobs = fns.map((fn, i) => (async () => {
    let html = '';
    try { html = await fn(url, timeoutMs); } catch (e) { html = ''; }
    if (html && html.length > track.best.length) track.best = html;
    if (isRealPage(html)) return { i, html };
    throw new Error('invalid page');
  })());
  return Promise.any(jobs);
}

async function getPage(url, timeoutMs) {
  const track = { best: '' };
  try {
    const win = await firstValid(PAGE_LAYERS_A, url, timeoutMs, track);
    goodLayer = 'A' + win.i;
    return win.html;
  } catch (e) { /* A 组全灭, 进 B 组 */ }
  try {
    const win = await firstValid(PAGE_LAYERS_B, url, timeoutMs, track);
    goodLayer = 'B' + win.i;
    return win.html;
  } catch (e) { /* 全灭: 回最长的残页 (与旧版兜底口径一致) */ }
  return track.best;
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
  const html = await getPage(durl);
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
