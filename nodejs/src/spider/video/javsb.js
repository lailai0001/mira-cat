// JAVSB (https://jav.sb) -> CatPawOpen spider
// MacCMS/Madou 模板站: 列表卡片 div.thumbnail, 详情 og 标签 + 官方播放器 iframe。
// 播放 (2026-10-20 第五轮重做): sign 算法已逆向坐实 —— 播放器页的
// parent.encrypt(ky) = base62( ky 各字节 XOR 0x7B 后按大端整数编码 ),
// ky = "{hash}@{unix秒}", 字母表 0-9a-zA-Z。证据: Wayback 归档的 40 组
// 真实 (file,ts,sign) 三元组全量反解一致 + VM 直连实测官方链 200 通过。
// save_m3u8_cache.php 另有 raw 形态: ?file&raw=1&sign 直接回播放列表
// 本体 (冷缓存视频实测), 故 play 一步到位: 现场算 sign 拼 raw 地址,
// 经抓取栈校验列表真实可取 (#EXTM3U) 后 parse:0 直返; 校验不过再走
// 经典两步 token -> save 取 m3u8_file; 全灭才落 parse:1 嗅探 (同前)。
// sign 时间窗实测 ±3600s 内可用, 播放器随后自取列表无压力。
//
// 播放 (2026-10-20 第六轮): 第五轮真机全灭 —— 路 A/B 返回的都是 jav.sb
// 本域地址, 播放器自取这一跳在设备网络上被 jav.sb 的 CF 拦死 (蜘蛛有
// 中转能过、播放器没有)。改走全链同出口 Worker (与 JavGG/SexTB/
// StripChat 真机已验同形态): play 首选 javsb-hls Worker (下方
// JAVSB_WORKER 常量, 用户部署后生效) —— Worker 内算签取 raw 列表、
// 分片行改写到 Worker /s, 播放器全程只连 workers.dev。蜘蛛先对
// Worker /v 做一次校验取数 (含 #EXTM3U 才算通), 不过再依次回退
// 第五轮路 A (算签直取)、路 B (token 两步)、parse:1 嗅探。
// 取证要点: CF Workers 出口直连 jav.sb 同样吃 403 (借已部署的
// javgg-vidhide Worker 实测), 故 Worker 内部取列表要绕公开中转;
// 18av.mov 分片域 (s103/s104) 对 Workers 出口开放 (实测逐字节
// 一致), 且用户真机浏览器实证从其设备亦可达 —— 故 Worker 有两种
// 列表形态: seg=direct (分片保持原始直链, 轻量) 与默认全链代理
// (分片改走 Worker /s)。蜘蛛先探 seg=direct 列表 + 首分片 (探针
// 在 App 内跑 = 设备出口实测), 通则用直链形态; 不通改探全链形态;
// 都不过才回退路 A/B/嗅探。
// play 总预算放宽到 55s: Worker 首播要等中转取列表 (实测可达 10~35s),
// 成品在 Worker 侧缓存 600s, 二次点播直接命中。
//
// 播放 (2026-10-22 第七轮, 只改蜘蛛): 第六轮真机仍报无法播放。复测坐实
// 瓶颈不在地址形态, 而在 Worker 取列表这一环本身: Worker 内部靠
// allorigins 等公开中转代取 raw 列表, 其健康度逐时波动 —— 2026-10-22
// 实测冷取 10 个在架视频仅 1 个成功 (allorigins 当日大面积 500/超时),
// 失败时 Worker 要 20~36s 才回 502; 而第六轮蜘蛛在 play 里只给
// Worker 两次机会 (direct/proxy 各一轮) 且被 47s 阶段上限截断, 第二轮
// 常跑不完就落到回退路, 回退路 A/B 返回的又是播放器直取必死的
// jav.sb 本域地址 —— 于是"列表全好、点播全灭"。同时复核排除的项:
// 官方链本身完好 (VM 直连 CUS-1811-EP6-K: raw/get_file 200、559 片、
// 分片首字节 0x47, token->save->get_file 与 raw 逐字节一致);
// save 附带的 source 索引 (18av.mov) 分片行无逐片 token、补 source
// token 亦 403, 不可用; 另有约 1/4 在架视频站方本身 404 (文件缺失,
// 如 SQTE-688/690, 浏览器同样播不了, 非蜘蛛问题)。
// 本轮改法 (全部在蜘蛛内, 不新增任何中转/代理):
//   1) 详情预热: detail 拿到 hash 即在后台 (不阻塞详情返回) 启动
//      Worker 取数, 最多 3 轮竞速、预算 110s —— 用户在详情页停留的
//      时间就是取数时间, 点播时大概率已取好 (状态进程内缓存 600s,
//      与 Worker 侧缓存同寿命);
//   2) play 先等预热结果 (最多等 ~20s), 没有再在 play 预算内补一轮;
//   3) 校验全失败时的兜底从"回退路 A/B (播放器必死地址)"改为直接
//      返回未校验的全链 Worker 地址: 播放器这次自取本身就是新一轮
//      取数竞速, 且用户重重点播还能再掷一轮 —— 严格优于回一个已知
//      必死的地址。官方链 A/B 仅保留在 JAVSB_WORKER 未配置时走旧链路。
//
// 播放 (2026-10-22 第八轮, 只改蜘蛛): 第七轮真机仍报无法播放 (样本:
// 无码破解 JUFE-608, hash 963f852b…c3e503, 浏览器同片可播)。本轮以
// 该片逐项复现 (报告 catfix_javsb_r8.md): 官方链 VM 直连 200/1679 片/
// 分片 0x47 双偏移 —— 文件活着; 蜘蛛 分类->详情->play 的 hash 提取
// 与用户发来的播放器 iframe 逐字一致 —— 解析无误; 但复现时段 Worker
// 处于深度坏窗口 (/v 双形态 6/6 + 对照片 2/2 全 502; 每拉一次 /v 是
// 一张独立彩票: 同一地址播放器式连拉两次, 先 502 苦等 35s、后 0.7s
// 命中 1679 片)。第七轮在此之上的自伤: detail->play 实测 52.6/53.0s
// 才返回 (重抓详情页 + 等预热 20s + 多轮串行取数), 疑超 App 请求
// 耐心 —— URL 还没递到播放器, 请求先被放弃; 且预热与 play 并发
// 取数互相干扰 (一轮取数已成功, play 仍耗满预算落未校验)。
// 本轮改法: 1) play 硬顶 18s: hash 走 detail 登记的进程内映射免
// 重抓详情页; 预热短等 <=6s; 前台只做一次有界尝试 (<=10s, 只查
// "是否已温", 冷竞速留给后台预热与播放器自取); 到点必回未校验
// 地址。2) detail 出双线 (全链/直链): 每条线一次点播 = 一次新的
// /v 竞速, 一条没掷中可换另一条再掷, 不必退回重进。3) 取 Worker
// 列表的 fetchWorkerPl 预算拆分硬封顶 (小预算时 fetch 占 65% +
// req 余量, 不再单次传输吃满 44s)。Worker 与官方链均未动, 不
// 新增任何中转。
//
// 播放 (2026-10-22 第十一轮, 诊断探针版, 备推未推): 第十轮 (Worker
// v4 KV) 上线后真机仍全灭, 而既有证据全在 VM/Worker 侧 —— "设备出口
// 用蜘蛛自身的 req/fetch 栈直取官方 raw 清单" 这一跳从未被单独测过
// (第五轮测的是播放器栈)。本版在 play 的 Worker 路里并行加一发直取
// 探针 (算签与官方链路 A 同法, 8s 封顶, 只记状态、不改出参地址),
// 结果编进 play 返回的线路名后缀: 探针200/<片数> / 探针<状态码> /
// 探针超时 / 探针未回。Worker 路出参由字符串 url 改为 [线路名, url]
// 一对 (播放器多源命名形态), url 本体与第八轮逐字一致, parse/
// header 不变; 非 Worker 路 (旧链路/嗅探) 逐字不动。判定口径与后续
// /put 回存评估见报告 catfix_javsb_r11.md。
//
// 详情 (2026-10-22 第十二轮): 第十一轮真机反馈 —— MiraPlayer 播放
// 界面根本不显示 play 返回的线路名, 探针结论读不出来。改把结论同时
// 放到详情页分集名上 (分集名在 App 里必显示): detail 对第一集的
// hash 跑同款直取探针 (与 play 共用 120s 结论缓存), 结论拼到第一集
// 名后 (正片·探针200/1679 等); 只短等 3s, 等不到标探针未回, 绝不
// 拖垮详情; 无 hash 时 detail 与第十一轮逐字一致。play 线路名后缀
// 保留不删。见报告 catfix_javsb_r13.md。
//
// 抓取通道 (2026-10-20 第六版): 真机双状态 (VPN 开/关) 直连全灭、第三轮的
// jina 单中转也全灭。复核结论: 第三轮实现无 URL/编码类低级错误, 但有三个结构
// 问题 —— (1) jina 只走了原生 fetch 一条传输, 而本仓已真机通过的 SexTB 是走
// 框架 req (axios) 打 jina 的; (2) 层序直连先行且每层超时叠加 (6+12+6=24s),
// 全灭时用户每页要等满三层才返回空; (3) r.jina.ai 域名大陆直连通常不可达,
// VPN 下也未通, 单中转没有第二条可达路径。本版改为:
//   中转先行 + 多中转并行竞速 (冷启动时 jina/markdown.new/allorigins 三路
//   同时发, 首个通过内容校验的胜出并记为粘性层, 后续请求直达该层);
//   单次页面抓取全局预算 20s 封顶, 每层另有自己的超时上限;
//   markdown.new: Cloudflare 托管的公开转读服务 (大陆直连通常可达), 输出与
//   jina 同格式的 markdown —— 列表解析器同时吃 HTML 与两种 markdown 方言
//   (jina 原生 / markdown.new), markdown 模式无封面 (站方懒加载图在转读时
//   已丢), 有标题+时长, 属降级可用;
//   allorigins: CF 前置的公开代理, 其实测冷抓取慢且偶发 52x, 只作机会层
//   (其缓存热时很快; token 接口因其缓存可能串话, 不走它);
//   jina 本身保留两条传输 (框架 req + 原生 fetch) 与 markdown 降级层
//   (App 若把自设格式头丢了, jina 返回 markdown 也能出列表);
//   直连 (req 桌面头 / fetch iOS 头) 降为最后兜底, 不再先行试探。
// 页面缓存保留: 列表/搜索 120s、详情 300s (降中转调用量, jina 免费层约
// 20 次/分钟/IP; 竞速只在无粘性层时发生, 稳态每页只打一层)。
// 校验口径不变: 解析出 0 卡片 (或详情无 og/播放器) 视为该层失败。
// 另带会话级 Cookie 罐: 任一层响应给了 Set-Cookie 就存下并回放 (仅直连层)。
import req from '../../util/req.js';

const KEY = 'py_javsb';
const NAME = 'JAVSB';
const HOST = 'https://jav.sb';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const REFERER = HOST + '/';
// 公开抓取中转 (目标 URL 直接拼在其后 / 或作参数)
const JINA = 'https://r.jina.ai/';
const MDNEW = 'https://markdown.new/';
const ALLORIGINS = 'https://api.allorigins.win/raw?url=';
// 全链代理 Worker (第六轮, 用户手动部署 javsb-hls 后生效; 留空则跳过此路)
const JAVSB_WORKER = 'https://javsb-hls.li768435813.workers.dev';
// 分片探针用的播放器 UA (近似 iOS 原生播放器, 与蜘蛛抓取 UA 区分)
const PLAYER_UA = 'AppleCoreMedia/1.0.0.20L563 (iPhone; U; CPU OS 17_5 like Mac OS X; zh_cn)';

// 分类: type_id 为 javtype 的 Type slug; new/rank_* 为 label 页 (见 catUrl)
const CATS = [
  { type_id: 'new', type_name: '最近更新' },
  { type_id: 'Censored', type_name: '日本有码' },
  { type_id: 'Uncensored', type_name: '日本无码' },
  { type_id: 'FC2-PPV', type_name: 'FC2-PPV' },
  { type_id: 'Mosaic_Removed', type_name: '无码破解' },
  { type_id: 'CHN_SUB', type_name: '中文字幕' },
  { type_id: 'MGS', type_name: 'MGS' },
  { type_id: 'Adult_IDOL', type_name: '写真' },
  { type_id: 'Asian_Amateur', type_name: '国产' },
  { type_id: 'Western_Porn', type_name: '欧美' },
  { type_id: 'rank_hits', type_name: '热门影片' },
  { type_id: 'rank_score', type_name: '评分最高' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ');
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

// ---------- 调试钩子 (仅 harness 设置 globalThis.__JAVSB_LOG__ 时生效) ----------
function noteLayer(name, ms, ok, url) {
  const g = globalThis.__JAVSB_LOG__;
  if (Array.isArray(g)) g.push({ layer: name, ms, ok: !!ok, url });
}

// ---------- 会话 Cookie 罐 (仅直连 jav.sb 时回放) ----------
const cookieJar = new Map(); // host -> "k=v; k2=v2"

function jarStore(host, setCookies) {
  if (!setCookies) return;
  const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
  const cur = new Map();
  const old = cookieJar.get(host);
  if (old) for (const p of old.split('; ')) { const i = p.indexOf('='); if (i > 0) cur.set(p.slice(0, i), p.slice(i + 1)); }
  for (const sc of arr) {
    const first = String(sc || '').split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) cur.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  if (cur.size) cookieJar.set(host, [...cur.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
}

function jarHeader(host) {
  return cookieJar.get(host) || '';
}

// ---------- 请求头档案 ----------
function desktopHeaders(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Referer': referer || REFERER,
  };
}

function safariHeaders(referer) {
  return {
    'User-Agent': UA_IOS,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Referer': referer || REFERER,
  };
}

// jina 取 HTML 的格式头: 两个文档头同时发 (VM 实测同发无冲突),
// 任一被中间层丢弃时另一个仍可能生效; 都被丢时返回 markdown, 列表层可降级吃。
function jinaHtmlHeaders() {
  return { 'User-Agent': UA, 'Accept': '*/*', 'x-return-format': 'html', 'x-respond-with': 'html' };
}

// ---------- 基础传输 ----------
async function viaReq(url, headers, timeoutMs) {
  const host = new URL(url).host;
  const h = { ...headers };
  const ck = jarHeader(host);
  if (ck) h['Cookie'] = ck;
  const { data, status, headers: rh } = await req.get(url, { headers: h, timeout: timeoutMs });
  if (rh) jarStore(host, rh['set-cookie']);
  if (status && status !== 200) return '';
  if (data == null || data === '') return '';
  return typeof data === 'string' ? data : JSON.stringify(data);
}

async function viaFetch(url, headers, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const host = new URL(url).host;
    const h = { ...headers };
    const ck = jarHeader(host);
    if (ck) h['Cookie'] = ck;
    const r = await fetch(url, { headers: h, signal: ctl.signal, redirect: 'follow' });
    try {
      const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : r.headers.get('set-cookie');
      jarStore(host, sc);
    } catch (e) { /* 忽略 */ }
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// ---------- 抓取层 (name -> {cap, run}) ----------
// run(targetUrl, timeoutMs) 返回页面文本 (失败为 '')。
const LAYERS = {
  // 中转 1: jina 经框架 req (与已真机通过的 SexTB 同传输同头家族)
  jinaHtmlReq: { cap: 8000, run: (u, ms) => viaReq(JINA + u, jinaHtmlHeaders(), ms) },
  // 中转 1b: jina 经原生 fetch (传输多样性兜底)
  jinaHtmlFetch: { cap: 8000, run: (u, ms) => viaFetch(JINA + u, jinaHtmlHeaders(), ms) },
  // 中转 2: markdown.new (CF 托管, 大陆直连可达性好; 输出 markdown)
  mdNew: { cap: 8000, run: (u, ms) => viaReq(MDNEW + u, { 'User-Agent': UA, 'Accept': '*/*' }, ms) },
  // 中转 3: allorigins (CF 前置; 冷抓取慢/偶发 52x, 机会层)
  allOrigins: { cap: 10000, run: (u, ms) => viaReq(ALLORIGINS + encodeURIComponent(u), { 'User-Agent': UA, 'Accept': '*/*' }, ms) },
  // 中转 1c: jina markdown (格式头全丢时的降级, 仅列表/搜索有意义)
  jinaMd: { cap: 8000, run: (u, ms) => viaReq(JINA + u, { 'User-Agent': UA, 'Accept': '*/*' }, ms) },
  // 直连兜底 (真机已证两出口全灭, 仅保留给网络环境变化的情况)
  directReq: { cap: 6000, run: (u, ms) => viaReq(u, desktopHeaders(), ms) },
  directFetch: { cap: 5000, run: (u, ms) => viaFetch(u, safariHeaders(), ms) },
};
// 列表/搜索: 全层 (含 markdown 降级)
const LIST_LAYERS = ['jinaHtmlReq', 'mdNew', 'allOrigins', 'jinaHtmlFetch', 'jinaMd', 'directReq', 'directFetch'];
// 详情: 必须 HTML (og/播放器), 无 markdown 层
const DETAIL_LAYERS = ['jinaHtmlReq', 'allOrigins', 'jinaHtmlFetch', 'directReq', 'directFetch'];
// token 接口: 小预算短链, 不用 allorigins (缓存可能串话) 与 markdown 层
const TOKEN_LAYERS = ['jinaHtmlReq', 'directReq', 'jinaHtmlFetch'];
// 冷启动竞速组 (中转三路)
const RACE_LAYERS = ['jinaHtmlReq', 'mdNew', 'allOrigins'];

// ---------- 页面缓存 ----------
const pageCache = new Map(); // url -> { t, s }
const TTL_LIST = 120000;   // 列表/首页/搜索: 120s
const TTL_DETAIL = 300000; // 详情: 300s (play 紧跟 detail, 命中即省一次中转)

function cacheGet(url, ttl) {
  const e = pageCache.get(url);
  if (e && Date.now() - e.t < ttl) return e.s;
  return '';
}

function cacheSet(url, s) {
  pageCache.set(url, { t: Date.now(), s });
  if (pageCache.size > 80) pageCache.delete(pageCache.keys().next().value);
}

// ---------- 多层抓取编排 ----------
// 粘性层: 按用途分开记 (页面组/ token 组互不污染), 上次胜出的层下次先试。
const goodLayers = { page: '', token: '' };

async function tryLayer(name, url, validate, sliceMs) {
  const L = LAYERS[name];
  if (!L || sliceMs < 800) return '';
  const t0 = Date.now();
  try {
    const txt = await L.run(url, sliceMs);
    const ok = !!txt && validate(txt);
    noteLayer(name, Date.now() - t0, ok, url);
    return ok ? txt : '';
  } catch (e) {
    noteLayer(name, Date.now() - t0, false, url);
    return '';
  }
}

// opts: { layers, budgetMs, caps(覆盖每层上限), cacheTtl }
// 全局预算封顶: 任何一页抓取总时长不超过 budgetMs (默认 20s)。
async function fetchVia(url, validate, opts) {
  const o = opts || {};
  const layerNames = (o.layers || LIST_LAYERS).filter(n => LAYERS[n]);
  const budget = o.budgetMs || 20000;
  const deadline = Date.now() + budget;
  const capOf = (n) => (o.caps && o.caps[n]) || LAYERS[n].cap;
  const remain = () => deadline - Date.now();
  const ok = typeof validate === 'function' ? validate : (s) => !!s;

  if (o.cacheTtl) {
    const cached = cacheGet(url, o.cacheTtl);
    if (cached && ok(cached)) return cached;
  }
  const tried = new Set();
  const stickyKey = o.stickyKey || 'page';
  const succeed = (name, txt) => {
    goodLayers[stickyKey] = name;
    if (o.cacheTtl) cacheSet(url, txt);
    return txt;
  };

  // 1) 粘性层先行
  const sticky = goodLayers[stickyKey];
  if (sticky && layerNames.includes(sticky) && remain() > 800) {
    tried.add(sticky);
    const txt = await tryLayer(sticky, url, ok, Math.min(capOf(sticky), remain()));
    if (txt) return succeed(sticky, txt);
  }

  // 2) 冷启动竞速: 中转组同时发, 首个通过校验的胜出。
  // 形态偏好: markdown 结果 (无封面) 先攒住, 给 HTML 结果 2.5s 宽限期,
  // 宽限内有 HTML 胜出则用 HTML (列表有封面), 否则用先到的 markdown。
  const racers = RACE_LAYERS.filter(n => layerNames.includes(n) && !tried.has(n));
  const mdCapable = layerNames.includes('jinaMd'); // 详情/token 组无 markdown 降级, 不走宽限
  if (racers.length > 1 && remain() > 1500) {
    racers.forEach(n => tried.add(n));
    const raced = await new Promise((resolve) => {
      let settled = 0;
      let done = false;
      let mdCand = null;
      let graceTimer = null;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        resolve(v);
      };
      const timer = setTimeout(() => finish(mdCand), remain());
      for (const n of racers) {
        tryLayer(n, url, ok, Math.min(capOf(n), remain())).then((txt) => {
          if (done) return;
          if (txt) {
            const cand = { name: n, txt };
            if (!mdCapable || txt.includes('<div class="thumbnail group">')) { finish(cand); return; }
            if (!mdCand) {
              mdCand = cand;
              graceTimer = setTimeout(() => finish(mdCand), 2500);
            }
            settled++;
          } else {
            settled++;
          }
          if (settled >= racers.length) finish(mdCand);
        });
      }
    });
    if (raced) return succeed(raced.name, raced.txt);
  }

  // 3) 其余层按序递进
  for (const n of layerNames) {
    if (tried.has(n) || remain() <= 800) continue;
    tried.add(n);
    const txt = await tryLayer(n, url, ok, Math.min(capOf(n), remain()));
    if (txt) return succeed(n, txt);
  }
  return '';
}

function getListPage(url, validate) {
  return fetchVia(url, validate || isListPage, { layers: LIST_LAYERS, budgetMs: 20000, cacheTtl: TTL_LIST });
}

function getDetailPage(url, budgetMs) {
  return fetchVia(url, isDetailPage, { layers: DETAIL_LAYERS, budgetMs: budgetMs || 20000, cacheTtl: TTL_DETAIL });
}

// ---------- 内容校验 ----------
// 校验口径: 能解析出卡片才算列表页 (拦截页/空壳/markdown 无卡均不算)
const isListPage = (s) => countCards(s) > 0;
// 详情页校验: og 标题或官方播放器任一出现 (仅 HTML 形态)
const isDetailPage = (s) => typeof s === 'string' && (s.includes('og:title') || s.includes('/static/player/'));
// 搜索页校验: 有卡片最好; 无结果的 HTML 页也是真页面 (足够长且含站内标记) 一并接受
const isSearchPage = (s) => countCards(s) > 0 || (typeof s === 'string' && s.length > 3000 && s.includes('javtype'));
// 转读 markdown 页面校验 (jina / markdown.new 的输出都带 Title: 前缀行)
const isMdPage = (s) => typeof s === 'string' && s.includes('Title: ') && s.includes('Markdown Content:');

// 从转读 markdown 里提取页面标题 (首行 "Title: xxx", 可能带站名后缀)
function mdTitle(md) {
  const m = String(md || '').match(/^Title:\s*(.+)$/m);
  if (!m) return '';
  return clean(m[1]).replace(/\s*[-|–—]\s*JAVSB\s*$/i, '').trim();
}

// ---------- JSON 宽松解析 (直连是裸 JSON, jina HTML 会包 <pre>, markdown 会带前后缀) ----------
function parseJsonLoose(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { /* 继续 */ }
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* 落空 */ } }
  return null;
}

// ---------- 列表解析 (HTML + markdown 双形态) ----------

function countCards(html) {
  return parseCards(html).length;
}

function parseCards(html) {
  const s = String(html || '');
  if (s.includes('<div class="thumbnail group">')) return parseCardsHtml(s);
  return parseCardsMd(s);
}

// HTML 卡片: <div class="thumbnail group"> ... <a href="/jav/{slug}-1-1.html">
//   <img data-src="/upload/vod/*.jpg" alt="片名"> ... <span ...>时长</span>
// 按卡片起始标签切块解析, 每块窗口给足 4000 字符, 保证最后一张卡不丢。
// jina HTML / allorigins 与直连 HTML 同构, 同一解析器通用。
function parseCardsHtml(html) {
  const out = [];
  const seen = new Set();
  const parts = String(html || '').split('<div class="thumbnail group">');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 4000);
    const hrefM = chunk.match(/href="(\/jav\/[^"]+\.html)"/);
    if (!hrefM) continue;
    const id = HOST + hrefM[1];
    if (seen.has(id)) continue;
    seen.add(id);
    let pic = '';
    const imgM = chunk.match(/<img[^>]+data-src="([^"]+)"/) || chunk.match(/<img[^>]+src="([^"]+)"/);
    if (imgM && !/loading\.png/i.test(imgM[1])) pic = absUrl(imgM[1]);
    let name = '';
    const altM = chunk.match(/<img[^>]+alt="([^"]*)"/);
    if (altM) name = clean(altM[1]);
    if (!name) {
      const tm = chunk.match(/class="text-secondary group-hover:text-primary"[^>]*>([^<]+)</);
      if (tm) name = clean(tm[1]);
    }
    let remarks = '';
    const dm = chunk.match(/bg-opacity-75">([^<]+)</);
    if (dm) remarks = clean(dm[1]);
    out.push({ vod_id: id, vod_name: name || hrefM[1], vod_pic: pic, vod_remarks: remarks });
  }
  return out;
}

// markdown 卡片 (jina 原生 markdown 与 markdown.new 两种方言通用):
//   jina:      [![Image N: 片名](loading.png)](详情URL)[时长](详情URL) + [片名](详情URL)
//   md.new:    [](详情URL) [时长](详情URL) + [片名](详情URL)
// 共同点: 都有独立的 [片名](详情URL) 文本链接, 且详情 URL 均为 /jav/*.html
// (导航/分类链接是 /javtype/*, 不会误入)。封面在转读时已丢 (懒加载占位图),
// vod_pic 留空 —— 降级可用: 有标题、时长, 点进去走详情层取真图与播放。
function parseCardsMd(text) {
  const s = String(text || '');
  const dur = new Map();
  for (const m of s.matchAll(/\[(\d+:\d{2}:\d{2})\]\((https:\/\/jav\.sb\/jav\/[^)\s]+\.html)\)/g)) {
    if (!dur.has(m[2])) dur.set(m[2], m[1]);
  }
  const out = [];
  const seen = new Set();
  const push = (url, title) => {
    const name = clean(title || '');
    if (!url || seen.has(url)) return;
    if (!name || /^\d+:\d{2}:\d{2}$/.test(name)) return;
    seen.add(url);
    out.push({ vod_id: url, vod_name: name, vod_pic: '', vod_remarks: dur.get(url) || '' });
  };
  // jina 方言的图片链接行 (alt 即片名)
  for (const m of s.matchAll(/!\[Image \d+: ([^\]]+)\]\([^)]*\)\]\((https:\/\/jav\.sb\/jav\/[^)\s]+\.html)\)/g)) {
    push(m[2], m[1]);
  }
  // 两方言共有的独立片名链接行
  for (const m of s.matchAll(/\[([^\]]+)\]\((https:\/\/jav\.sb\/jav\/[^)\s]+\.html)\)/g)) {
    push(m[2], m[1]);
  }
  return out;
}

// 从分页链接提取总页数 (HTML 与 markdown 里都是同样的 URL 字面, 通用)
function pagecountOf(html, re) {
  const nums = [...String(html || '').matchAll(re)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 1000000);
  return nums.length ? Math.max(...nums) : 1;
}

function catUrl(cat, page) {
  const id = cat.type_id;
  if (id === 'new') {
    return page > 1 ? `${HOST}/label/new/by/time/page/${page}.html` : `${HOST}/label/new/by/time.html`;
  }
  if (id === 'rank_hits' || id === 'rank_score') {
    const by = id === 'rank_hits' ? 'hits_week' : 'score';
    return page > 1 ? `${HOST}/label/rank/by/${by}/page/${page}.html` : `${HOST}/label/rank/by/${by}.html`;
  }
  return page > 1 ? `${HOST}/javtype/${id}-${page}.html` : `${HOST}/javtype/${id}.html`;
}

function catPagecount(html, cat) {
  if (cat.type_id === 'new' || cat.type_id.startsWith('rank_')) {
    return pagecountOf(html, /\/page\/(\d+)\.html/g);
  }
  return pagecountOf(html, /\/javtype\/[A-Za-z0-9_-]+-(\d+)\.html/g);
}

// ---------- 接口 ----------

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getListPage(HOST + '/');
  const list = html ? parseCards(html).slice(0, 30) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'new';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATS.find(c => c.type_id === tid) || CATS[0];
  const html = await getListPage(catUrl(cat, page));
  if (!html) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const list = parseCards(html);
  const pc = catPagecount(html, cat);
  return { page, pagecount: Math.max(pc, page), limit: 12, total: list.length, list };
}

function og(html, prop) {
  const m = String(html || '').match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`));
  return m ? clean(m[1]) : '';
}

// 从详情页提取官方播放器 iframe 地址与 file hash
function extractPlayer(html) {
  const m = String(html || '').match(/src="(\/static\/player\/videojs\.html\?[^"]+)"/) ||
            String(html || '').match(/src="(https?:\/\/jav\.sb\/static\/player\/videojs\.html\?[^"]+)"/);
  if (!m) return { playerUrl: '', hash: '' };
  const playerUrl = absUrl(m[1].replace(/&amp;/g, '&'));
  const hm = playerUrl.match(/[?&]src=([0-9a-zA-Z]+)/);
  return { playerUrl, hash: hm ? hm[1] : '' };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : absUrl(id);
  const html = await getDetailPage(durl);
  if (!html) {
    // HTML 全层失败时的降级: 用转读 markdown 合成详情条目 (只有标题,
    // 无封面/播放器信息) —— 至少能打开条目, play 会落 parse:1 嗅探详情页,
    // WebView 与蜘蛛抓取通道相互独立, 仍有播出机会, 强于返回空详情。
    const md = await fetchVia(durl, isMdPage, {
      layers: ['jinaHtmlFetch', 'jinaMd', 'mdNew'], budgetMs: 8000,
    });
    const name = md ? mdTitle(md) : '';
    if (!name) return { list: [] };
    const vodMd = {
        vod_id: durl,
        vod_name: name,
        vod_pic: '',
        vod_remarks: '',
        vod_content: '',
        vod_play_from: 'JAVSB',
        vod_play_url: `正片$${durl}`,
    };
    subRegister(durl, vodMd);
    return { list: [vodMd] };
  }
  const name = og(html, 'title');
  const pic = og(html, 'image');
  const desc = og(html, 'description');
  const ph = extractPlayer(html).hash;
  // 第七轮: 详情预热 —— 拿到 hash 立即在后台启动 Worker 取数 (不 await,
  // 不拖慢详情返回), 用户停留详情页的时间用于消化中转取列表的慢启动。
  if (JAVSB_WORKER && ph) {
    rememberDetailHash(durl, ph);
    try { warmWorker(ph); } catch (e) { /* 预热失败不影响详情 */ }
  }
  // 第十二轮: 探针结论上分集名 —— detail 对第一集 hash 跑一次直取
  // 探针 (复用第十一轮 play 探针, 结论同缓存), 只短等
  // DETAIL_PROBE_GRACE_MS, 等不到标探针未回; 探针慢/失败不拖垮详情,
  // 无 hash 时分集名与现行逐字一致 (下方仍是裸「正片」)。
  const epSuffix = ph ? await probeSuffixForDetail(ph) : '';
  const ep1Name = epSuffix ? `正片·${epSuffix}` : '正片';
  const vod = {
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: desc,
      // 第八轮双线: 全链 (分片走 Worker /s) 与直链 (分片 18av 原始
      // 直链) 两条线, id 尾部 @proxy/@direct 供 play 区分。每条线一
      // 次点播都是一次新的 /v 取数竞速, 一条没掷中可换另一条再掷。
      vod_play_from: '全链$$$直链',
      vod_play_url: `${ep1Name}$${durl}@proxy$$$正片$${durl}@direct`,
  };
  subRegister(durl, vod);
  return { list: [vod] };
}

// ---------- 官方取流 (第五轮: sign 算法已复现) ----------
// encrypt(ky): ky 各字节 XOR 0x7B -> 字节串按大端整数做 base62 编码,
// 字母表 0-9a-zA-Z。逐字节进位实现 (不用 BigInt, 任何 JS 引擎可跑),
// 与站方结果逐字一致 (归档 40 组真实三元组 + VM 直连实测双重校验)。
const SIGN_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function javsbSign(plain) {
  let digits = [0];
  for (let i = 0; i < plain.length; i++) {
    let carry = (plain.charCodeAt(i) ^ 123) & 0xff;
    for (let j = 0; j < digits.length; j++) {
      const v = digits[j] * 256 + carry;
      digits[j] = v % 62;
      carry = Math.floor(v / 62);
    }
    while (carry > 0) { digits.push(carry % 62); carry = Math.floor(carry / 62); }
  }
  while (digits.length > 1 && digits[digits.length - 1] === 0) digits.pop();
  let out = '';
  for (let j = digits.length - 1; j >= 0; j--) out += SIGN_ALPHABET[digits[j]];
  return out;
}

// 官方取流: 现场算 sign, 一步取 raw 播放列表地址; 失败再走经典两步链。
// 成功返回可播地址 (parse:0), 任何一步失败返回 '' (由 play 落嗅探)。
async function tryOfficialStream(hash, playerUrl, deadline) {
  const budget = (cap) => Math.max(300, Math.min(cap, deadline - Date.now()));
  if (Date.now() >= deadline) return '';
  const key = javsbSign(`${hash}@${Math.floor(Date.now() / 1000)}`);
  const isPl = (s) => typeof s === 'string' && s.includes('#EXTM3U');
  // 路 A (主): raw 形态 —— save 接口带 raw=1 直接回播放列表本体。
  // 经抓取栈校验只为证明 sign 与地址真实可用, 返回给播放器的是地址本身
  // (播放器自取列表; 列表内分片为源站 CDN 上的 .jpg 伪装 TS)。
  // 层序以直连 fetch 先行: 实测 jina 对该地址回 422 (拒非 HTML 内容),
  // 而原生 fetch 直连可取; 真机上直连层与播放器同网络, 通即代表可播。
  const rawUrl = `${HOST}/save_m3u8_cache.php?file=${encodeURIComponent(hash)}&raw=1&sign=${key}`;
  try {
    const txt = await fetchVia(rawUrl, isPl, {
      layers: ['directFetch', 'directReq', 'jinaHtmlFetch', 'jinaHtmlReq'],
      budgetMs: Math.max(600, Math.min(4500, deadline - Date.now())), stickyKey: 'token',
      caps: { directFetch: budget(2500), directReq: budget(2000), jinaHtmlFetch: budget(1500), jinaHtmlReq: budget(1500) },
    });
    if (txt) return rawUrl;
  } catch (e) { /* 落路 B */ }
  if (Date.now() >= deadline - 1200) return '';
  // 路 B (备): 经典两步 token -> save -> m3u8_file (官网播放器的最终地址形态)
  const PLAY_LAYERS = [...TOKEN_LAYERS, 'directFetch'];
  const hasToken = (s) => { const j = parseJsonLoose(s); return !!(j && j.token); };
  const hasFile = (s) => { const j = parseJsonLoose(s); return !!(j && j.m3u8_file); };
  let token = '', ts = '';
  try {
    const txt = await fetchVia(`${HOST}/token.php?file=${encodeURIComponent(hash)}`, hasToken, {
      layers: PLAY_LAYERS, budgetMs: Math.max(600, deadline - Date.now()), stickyKey: 'token',
      caps: { jinaHtmlReq: budget(2000), directReq: budget(1500), jinaHtmlFetch: budget(1200), directFetch: budget(1200) },
    });
    const j = parseJsonLoose(txt);
    token = t(j && j.token); ts = t(j && j.ts);
  } catch (e) { /* 落嗅探 */ }
  if (!token || Date.now() >= deadline) return '';
  try {
    const url = `${HOST}/save_m3u8_cache.php?file=${encodeURIComponent(hash)}&token=${encodeURIComponent(token)}&ts=${encodeURIComponent(ts)}&sign=${key}`;
    const txt = await fetchVia(url, hasFile, {
      layers: PLAY_LAYERS, budgetMs: Math.max(600, deadline - Date.now()), stickyKey: 'token',
      caps: { jinaHtmlReq: budget(2000), directReq: budget(1500), jinaHtmlFetch: budget(1200), directFetch: budget(1200) },
    });
    const j = parseJsonLoose(txt);
    const f = t(j && j.m3u8_file);
    if (f && /m3u8/i.test(f)) return absUrl(f) + (f.includes('sign=') ? '' : `&sign=${key}`);
  } catch (e) { /* 落嗅探 */ }
  return '';
}

// ---------- Worker 取流 (第七轮: 详情预热 + 多轮竞速 + 未校验兜底; 第八轮: play 快返 + 双线) ----------
// 探针就跑在 App 里, 等于设备出口实测:
//   形态一 (分片直链, 轻量): 取 Worker 的 seg=direct 列表 (分片保持
//     18av.mov 原始直链), 再探首分片 (Range 取首字节, 查 0x47 同步字)
//     —— 列表与分片都通才用它;
//   形态二 (全链代理): 分片改走 Worker /s, 播放器只连 workers.dev。
// 第七轮结构: 一次"取数轮" = direct 形态一轮 + (必要时) proxy 形态一轮
// (两形态在 Worker 内共用同一份 raw 取数与缓存, 谁先取到都算本轮成)。
// Worker 内部取数靠公开中转竞速, 单轮成败带随机性且失败要等 20~36s
// 才回 502, 故取数被拆成进程内状态机:
//   detail 阶段: warmWorker 后台预热 (最多 3 轮 / 110s, 不阻塞详情);
//   play 阶段: 先消费预热结果, 无果再在 play 预算内补一轮;
//   状态 (ok 的形态) 进程内记 600s, 与 Worker 侧缓存同寿命。
// 全部校验失败时 play 返回未校验的全链地址作兜底 (见 play 注释)。
const workerState = new Map(); // hash -> { st, form, t, promise }
const WORKER_STATE_TTL = 600000;
const workerFailAt = new Map(); // hash -> 失败时刻；60s 内连点直接回兜底，不重烧前台预算
const WORKER_FAIL_TTL = 60000;

// 第八轮: 详情URL -> hash 登记 (detail 解析时写入), play 命中即免去
// 开头重抓详情页的一跳 (第七轮每次 play 先重抓, 坏窗口白吃数秒)。
const hashByDetail = new Map();
function rememberDetailHash(durl, hash) {
  if (!durl || !hash) return;
  hashByDetail.set(durl, hash);
  if (hashByDetail.size > 60) hashByDetail.delete(hashByDetail.keys().next().value);
}

function workerUrlFor(hash, form) {
  const base = `${JAVSB_WORKER}/v?hash=${encodeURIComponent(hash)}`;
  return form === 'direct' ? base + '&seg=direct' : base;
}

async function probeSegment(segUrl, timeoutMs) {
  if (!segUrl || timeoutMs < 800) return false;
  try {
    const txt = await viaFetch(segUrl, { 'User-Agent': PLAYER_UA, 'Range': 'bytes=0-1023', 'Accept': '*/*' }, timeoutMs);
    return !!txt && txt.charCodeAt(0) === 0x47;
  } catch (e) { return false; }
}

const isPlaylist = (s) => typeof s === 'string' && s.includes('#EXTM3U');

// 取一次 Worker 列表 (先 fetch 传输, 失败换框架 req), 预算内返回正文或 ''
async function fetchWorkerPl(url, budgetMs) {
  const end = Date.now() + budgetMs;
  const left = () => end - Date.now();
  // 第八轮: 预算拆分硬封顶。大预算 (后台预热) 维持第七轮行为 (单
  // 传输给足, 等 Worker 内部竞速跑完); 小预算 (play 前台) 时 fetch
  // 只占 65%, 给 req 传输留余量, 两者总和不超预算 —— 第七轮单次
  // fetch 上限 44s 是 play 53s 的主要构成之一。
  const fetchCap = budgetMs > 15000
    ? Math.max(800, Math.min(44000, left()))
    : Math.max(800, Math.floor(left() * 0.65));
  try {
    const txt = await viaFetch(url, { 'User-Agent': UA, 'Accept': '*/*' }, fetchCap);
    if (txt && isPlaylist(txt)) return txt;
  } catch (e) { /* 换 req 传输再试 */ }
  if (left() < 800) return '';
  try {
    const txt = await viaReq(url, { 'User-Agent': UA, 'Accept': '*/*' }, Math.max(800, Math.min(12000, left())));
    if (txt && isPlaylist(txt)) return txt;
  } catch (e) { /* 落空 */ }
  return '';
}

// 一轮取数: 返回胜出形态 'direct' | 'proxy', 全灭返回 ''
async function workerRound(hash, budgetMs) {
  const end = Date.now() + budgetMs;
  const left = () => end - Date.now();
  const t0 = Date.now();
  const directUrl = workerUrlFor(hash, 'direct');
  const proxyUrl = workerUrlFor(hash, 'proxy');
  const pl = await fetchWorkerPl(directUrl, left());
  if (pl) {
    const seg = pl.split('\n').map(x => x.trim()).find(x => x && !x.startsWith('#'));
    const ok = seg ? await probeSegment(seg, Math.max(800, Math.min(5000, left()))) : false;
    noteLayer('worker-probe', Date.now() - t0, ok, seg || directUrl);
    if (ok) { noteLayer('worker-direct', Date.now() - t0, true, directUrl); return 'direct'; }
    // 直链分片探不过 → 全链形态 (raw 已在 Worker 侧缓存, 取数应很快)
    if (left() > 1500) {
      const pl2 = await fetchWorkerPl(proxyUrl, Math.min(15000, left()));
      if (pl2) { noteLayer('worker-proxy', Date.now() - t0, true, proxyUrl); return 'proxy'; }
    }
    return '';
  }
  noteLayer('worker-direct', Date.now() - t0, false, directUrl);
  // 直链形态列表都没拿到 → 全链形态再掷一轮 (Worker 内部是新的竞速)
  if (left() > 1500) {
    const pl2 = await fetchWorkerPl(proxyUrl, left());
    if (pl2) { noteLayer('worker-proxy', Date.now() - t0, true, proxyUrl); return 'proxy'; }
  }
  return '';
}

// 多轮取数: 轮间无间隔 (Worker 的 502 本身就是 20~36s 的节拍)
async function acquireWorker(hash, budgetMs, maxRounds) {
  const end = Date.now() + budgetMs;
  for (let r = 0; r < maxRounds && end - Date.now() > 1500; r++) {
    const form = await workerRound(hash, end - Date.now());
    if (form) return form;
  }
  return '';
}

// 第八轮: play 前台单次有界尝试 —— 只掷一轮, 总时长由 budgetMs
// 硬封顶 (与预热的多轮长竞速分工: 前台只查"是否已温", 冷竞速留给
// 后台预热与播放器自取)。想要哪条线就只取哪条; 未指定时先直链
// (取到列表再探首分片), 直链分片探不过改判全链 (列表已取到 =
// raw 已在 Worker 侧, 全链形态可播)。
async function playAcquireOnce(hash, want, budgetMs) {
  const end = Date.now() + budgetMs;
  const left = () => end - Date.now();
  const forms = want ? [want] : ['direct', 'proxy'];
  for (const f of forms) {
    if (left() < 2000) break;
    const pl = await fetchWorkerPl(workerUrlFor(hash, f), Math.max(800, left()));
    if (!pl) continue;
    if (f === 'proxy') { noteLayer('worker-proxy', 0, true, workerUrlFor(hash, 'proxy')); return 'proxy'; }
    const seg = pl.split('\n').map(x => x.trim()).find(x => x && !x.startsWith('#'));
    const ok = seg ? await probeSegment(seg, Math.max(800, Math.min(2500, left()))) : false;
    noteLayer('worker-probe', 0, ok, seg || '');
    if (ok) return 'direct';
    noteLayer('worker-proxy', 0, true, workerUrlFor(hash, 'proxy'));
    return 'proxy';
  }
  return '';
}

// 详情预热入口: 同一 hash 已有进行中/新鲜的成功状态则复用, 否则起后台取数。
// 返回状态条目 (调用方不 await 其 promise 即为纯预热)。
function warmWorker(hash) {
  let e = workerState.get(hash);
  const now = Date.now();
  if (e && e.st === 'ok' && now - e.t < WORKER_STATE_TTL) return e;
  if (e && e.st === 'pending') return e;
  e = { st: 'pending', form: '', t: now, promise: null };
  e.promise = (async () => {
    let form = '';
    try { form = await acquireWorker(hash, 110000, 3); } catch (err) { form = ''; }
    if (form) { e.st = 'ok'; e.form = form; } else { e.st = 'fail'; }
    e.t = Date.now();
    return form ? e : null;
  })();
  workerState.set(hash, e);
  if (workerState.size > 40) workerState.delete(workerState.keys().next().value);
  return e;
}

// 预热已判 ok 后, 出正式地址前对 direct 形态做一次轻复核 (列表从 Worker
// 缓存秒回 + 首分片探针): 复核不过改走全链形态 (raw 缓存同在, 可播)。
// proxy 形态无需复核 (播放器全程只连 Worker, 取数已证)。
async function verifiedWorkerUrl(hash, form, budgetMs) {
  if (form !== 'direct') return workerUrlFor(hash, 'proxy');
  const end = Date.now() + budgetMs;
  const pl = await fetchWorkerPl(workerUrlFor(hash, 'direct'), Math.max(800, end - Date.now()));
  if (pl) {
    const seg = pl.split('\n').map(x => x.trim()).find(x => x && !x.startsWith('#'));
    if (seg && (await probeSegment(seg, Math.max(800, Math.min(4000, end - Date.now()))))) {
      return workerUrlFor(hash, 'direct');
    }
  }
  return workerUrlFor(hash, 'proxy');
}

// ---------- 第十一轮: 设备直取探针 (仅诊断, 不参与出参地址决策) ----------
// 与主线并行: play 在 Worker 路一拿到 hash 就点火, 用蜘蛛自身两条
// 直连栈 (框架 req 桌面头 / 原生 fetch iOS 头, 与 LAYERS 的 directReq/
// directFetch 同传输同头家族) 直取官方 raw 清单。刻意不走 viaReq/
// viaFetch —— 那两个助手把非 200 吞成 '', 探针要的恰是状态码本身。
// 判定: 任一栈回 200 且正文含 #EXTM3U -> 探针200/<EXTINF 数>; 两栈
// 皆有应答但无一成功 -> 第一份确定状态码 (探针403 等); 8s 内无任何
// 确定应答 -> 探针超时。首份非 200 应答后只再给另一栈 1.5s 宽限
// (等它可能的 200), 不把 403 的快败拖成 8s。结论按 hash 缓存 120s:
// 用户连点另一条线时直接念得出上一发的结论, 同时后台刷新一发。
const PROBE_CAP_MS = 8000;
const PROBE_GRACE_MS = 1500;
const probeCache = new Map(); // hash -> { t, suffix }

function probeRawUrl(hash) {
  const key = javsbSign(`${hash}@${Math.floor(Date.now() / 1000)}`);
  return `${HOST}/save_m3u8_cache.php?file=${encodeURIComponent(hash)}&raw=1&sign=${key}`;
}

async function probeAttemptFetch(url, ms) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: safariHeaders(), signal: ctl.signal, redirect: 'follow' });
    const txt = await r.text().catch(() => '');
    return { status: r.status, text: typeof txt === 'string' ? txt : '' };
  } catch (e) { return null; } finally { clearTimeout(to); }
}

async function probeAttemptReq(url, ms) {
  try {
    const res = await req.get(url, { headers: desktopHeaders(), timeout: ms });
    if (res && typeof res.status === 'number') {
      const data = typeof res.data === 'string' ? res.data : (res.data == null ? '' : JSON.stringify(res.data));
      return { status: res.status, text: data };
    }
    return null;
  } catch (e) {
    const st = e && (typeof e.status === 'number' ? e.status : (e.response && typeof e.response.status === 'number' ? e.response.status : 0));
    return st ? { status: st, text: '' } : null;
  }
}

// 返回 Promise<string> (永不 reject): 线路名后缀。
function probeDirectRaw(hash) {
  const hit = probeCache.get(hash);
  if (hit && Date.now() - hit.t < 120000) {
    // 有新鲜结论: 立即回该结论, 同时后台再打一发刷新缓存 (不阻塞)
    probeDirectRawFresh(hash).catch(() => {});
    return Promise.resolve(hit.suffix);
  }
  return probeDirectRawFresh(hash);
}

function probeDirectRawFresh(hash) {
  const url = probeRawUrl(hash);
  const t0 = Date.now();
  const p = new Promise((resolve) => {
    let done = false;
    let answered = 0;
    let firstStatus = 0;
    let graceTimer = null;
    const finish = (suffix) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      probeCache.set(hash, { t: Date.now(), suffix });
      if (probeCache.size > 40) probeCache.delete(probeCache.keys().next().value);
      noteLayer('probe-direct', Date.now() - t0, suffix.startsWith('探针200'), url);
      resolve(suffix);
    };
    const timer = setTimeout(() => finish(firstStatus ? `探针${firstStatus}` : '探针超时'), PROBE_CAP_MS);
    const onRes = (r) => {
      if (done) return;
      if (r && r.status) {
        if (r.status === 200 && r.text.includes('#EXTM3U')) {
          finish(`探针200/${(r.text.match(/#EXTINF/g) || []).length}`);
          return;
        }
        if (!firstStatus) {
          firstStatus = r.status;
          graceTimer = setTimeout(() => finish(`探针${firstStatus}`), PROBE_GRACE_MS);
        }
      }
      if (++answered >= 2) finish(firstStatus ? `探针${firstStatus}` : '探针超时');
    };
    probeAttemptFetch(url, PROBE_CAP_MS).then(onRes, () => onRes(null));
    probeAttemptReq(url, PROBE_CAP_MS).then(onRes, () => onRes(null));
  });
  return p;
}

// detail 用探针后缀 (第十二轮): 与 withProbeName 同法 —— 结论 (或
// 120s 缓存里的上一发结论) 在 DETAIL_PROBE_GRACE_MS 内落点才用,
// 等不到回探针未回 (探针在后台走完会把结论入缓存, 重开详情即显示);
// 永不 reject, 绝不因探针拖垮或打挂 detail。
const DETAIL_PROBE_GRACE_MS = 3000;
async function probeSuffixForDetail(hash) {
  try {
    const p = probeDirectRaw(hash).catch(() => '探针超时');
    const got = await Promise.race([
      p.then((s) => ({ s })),
      new Promise((r) => setTimeout(() => r(null), DETAIL_PROBE_GRACE_MS)),
    ]).catch(() => null);
    return got && got.s ? got.s : '探针未回';
  } catch (e) { return '探针未回'; }
}

// 主线出参包装: 字符串 url -> [线路名·探针后缀, url]。主线先算完时
// 最多再短等 2s (且不越过 play 的 18s 硬顶) 等探针落点; 等不到记
// 探针未回, 绝不因探针拖过主线预算。url 本体/parse/header 不动。
async function withProbeName(res, probeP, deadline) {
  if (!res || typeof res.url !== 'string' || !res.url) return res;
  const base = res.url.includes('seg=direct') ? '直链' : '全链';
  let suffix = '探针未回';
  if (probeP) {
    const grace = Math.max(0, Math.min(2000, deadline - Date.now()));
    const got = await Promise.race([
      probeP.then((s) => ({ s })),
      new Promise((r) => setTimeout(() => r(null), grace)),
    ]).catch(() => null);
    if (got && got.s) suffix = got.s;
  }
  return { ...res, url: [`${base}·${suffix}`, res.url] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  // 第八轮: detail 双线在 id 尾部带 @proxy / @direct 线路标记 (老
  // 缓存的无标记 id 照旧走未指定形态流程)。
  let formWanted = '';
  const fm = id.match(/@(proxy|direct)$/);
  if (fm) { formWanted = fm[1]; id = id.slice(0, -fm[0].length); }
  if (/\.m3u8(\?|$)/i.test(id)) {
    return subAttach({ parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
  }
  const durl = /^https?:\/\//.test(id) ? id : absUrl(id);
  // 第八轮: play 硬顶 18s (第七轮坏窗口实测 52~53s 才返回, 疑超
  // App 请求耐心 —— 与 URL 对错无关的独立死因)。每一步按剩余预算
  // 封顶, 到点必回未校验地址, 绝不把用户晾在转圈上。取数主力是
  // detail 阶段的后台预热 (110s 长竞速), play 前台只做快查。
  const deadline = Date.now() + 18000;
  const remain = () => Math.max(0, deadline - Date.now());
  const offDeadline = Date.now() + 30000; // 仅 JAVSB_WORKER 未配置时的旧链路用
  // hash 快速通道: detail 已登记 详情URL->hash, 命中免重抓详情页。
  let playerUrl = '', hash = '';
  if (JAVSB_WORKER) hash = hashByDetail.get(durl) || '';
  if (!hash) {
    const html = await getDetailPage(durl, Math.max(800, Math.min(6000, remain())));
    if (html) {
      const ep = extractPlayer(html);
      playerUrl = ep.playerUrl; hash = ep.hash;
      if (hash) rememberDetailHash(durl, hash);
    }
  }
  if (hash && JAVSB_WORKER) {
    // 第八轮 Worker 路径: 已知结果秒回 -> 60s 内失败结论直接回兜底 ->
    // 预热短等 (<=6s) -> 两形态各一掷（各 <=5s） -> 未校验兜底；全程 <=18s。
    const wHead = { 'User-Agent': UA, 'Referer': REFERER };
    // 第十一轮探针: 拿到 hash 即与主线并行点火 (结论只进线路名)
    const probeP = probeDirectRaw(hash).catch(() => '探针超时');
    let e = workerState.get(hash);
    // 无状态/已判失败: 顺手 (重新) 点火后台预热, 惠及下一次点播
    if (!e || (e.st !== 'ok' && e.st !== 'pending')) {
      try { e = warmWorker(hash); } catch (err) { /* 预热点火失败不影响本次 */ }
    }
    const freshOk = () => {
      const s = workerState.get(hash);
      return (s && s.st === 'ok' && Date.now() - s.t < WORKER_STATE_TTL) ? s : null;
    };
    const fromOk = async (s) => {
      // 指定全链或已知全链: 秒回全链地址; 直链做 <=5s 轻复核
      // (verifiedWorkerUrl 复核不过时内部回退全链)。
      if (formWanted === 'proxy' || s.form === 'proxy') {
        noteLayer('worker-warm-hit', 0, true, workerUrlFor(hash, 'proxy'));
        return { parse: 0, url: workerUrlFor(hash, 'proxy'), header: wHead };
      }
      const u = await verifiedWorkerUrl(hash, 'direct', Math.min(5000, Math.max(800, remain())));
      noteLayer('worker-warm-hit', 0, true, u);
      return { parse: 0, url: u, header: wHead };
    };
    let okS = freshOk();
    if (okS && (!formWanted || formWanted === 'proxy' || formWanted === okS.form)) return subAttach(await withProbeName(await fromOk(okS), probeP, deadline), subsP);
    // 60s 内刚失败过：前台不再重烧等待与尝试，直接回兜底（后台预热仍在
    // 跑，暖好后下一次点播走 freshOk 秒回）。
    const failAt = workerFailAt.get(hash);
    if (failAt && Date.now() - failAt < WORKER_FAIL_TTL) {
      const fb0 = workerUrlFor(hash, formWanted || 'proxy');
      noteLayer('worker-unverified-cached', 0, false, fb0);
      return subAttach(await withProbeName({ parse: 0, url: fb0, header: wHead }, probeP, deadline), subsP);
    }
    // 预热进行中: 短等 <=6s (第七轮等 20s 是 53s 的主因之一)
    e = workerState.get(hash);
    if (e && e.st === 'pending' && e.promise && remain() > 4000) {
      const waitMs = Math.min(6000, remain() - 2500);
      if (waitMs > 0) await Promise.race([e.promise, new Promise(r => setTimeout(r, waitMs))]);
      okS = freshOk();
      if (okS && (!formWanted || formWanted === 'proxy' || formWanted === okS.form)) return subAttach(await withProbeName(await fromOk(okS), probeP, deadline), subsP);
    }
    // 两形态各一掷（各 <=5s）：单次 10s 调用会让直链形态吃光预算、全链
    // 形态没机会；分开掷保证两形态各有一次完整机会。
    if (remain() > 2500) {
      let got = '';
      for (const f of (formWanted ? [formWanted] : ['direct', 'proxy'])) {
        if (remain() <= 2500) break;
        got = await playAcquireOnce(hash, f, Math.min(5000, remain() - 1200));
        if (got) break;
      }
      if (got) {
        const en = workerState.get(hash) || { st: 'ok', form: got, t: Date.now(), promise: null };
        en.st = 'ok'; en.form = got; en.t = Date.now();
        workerState.set(hash, en);
        workerFailAt.delete(hash);
        noteLayer('worker-play-once', 0, true, workerUrlFor(hash, got));
        return subAttach(await withProbeName({ parse: 0, url: workerUrlFor(hash, got), header: wHead }, probeP, deadline), subsP);
      }
    }
    // 本次前台尝试失败：记 60s 结论（60s 内连点直接回兜底），并顺手清旧条目。
    workerFailAt.set(hash, Date.now());
    if (workerFailAt.size > 40) workerFailAt.delete(workerFailAt.keys().next().value);
    // 未校验兜底: 立即回想要形态的 Worker 地址 (播放器自取 = 新一
    // 轮竞速; 配合 detail 双线, 可换另一条线再掷一次)。
    const fb = workerUrlFor(hash, formWanted || 'proxy');
    noteLayer('worker-unverified', 0, false, fb);
    return subAttach(await withProbeName({ parse: 0, url: fb, header: wHead }, probeP, deadline), subsP);
  }
  if (hash && playerUrl) {
    // JAVSB_WORKER 未配置时才走旧链路: 官方链 A/B -> 嗅探播放器页
    const direct = await tryOfficialStream(hash, playerUrl, offDeadline);
    if (direct) {
      return subAttach({ parse: 0, url: direct, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
    }
    // 官方链失败: 立即嗅探官方播放器页 (页面内 JS 自己走完整取流)
    return subAttach({ parse: 1, jx: 0, url: playerUrl, header: { 'User-Agent': UA, 'Referer': durl } }, subsP);
  }
  if (playerUrl) {
    return subAttach({ parse: 1, jx: 0, url: playerUrl, header: { 'User-Agent': UA, 'Referer': durl } }, subsP);
  }
  // 详情页都没拿到/没播放器: 嗅探详情页兜底 (WebView 是浏览器引擎, 与蜘蛛抓取通道相互独立)
  return subAttach({ parse: 1, jx: 0, url: durl, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const kw = encodeURIComponent(wd);
  const url = page > 1 ? `${HOST}/vod/search/page/${page}/wd/${kw}.html` : `${HOST}/vod/search.html?wd=${kw}`;
  const html = await getListPage(url, isSearchPage);
  if (!html) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const list = parseCards(html);
  const pc = pagecountOf(html, /\/vod\/search\/page\/(\d+)\//g);
  return { page, pagecount: Math.max(pc, page), limit: 12, total: list.length, list };
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
