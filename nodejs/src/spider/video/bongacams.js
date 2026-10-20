import req from '../../util/req.js';

// BongaCams (py_bongacams) —— 名称用站方品牌「BongaCams」(页面 window["__#c"] 首项与站内标题均为此名)
// 站点: https://cn.bongacams.com (BongaCams 官方中文镜像, 与主站同构 SSR; 品牌名中英文站一致)。
// 只收录公开直播间: 列表页 (SSR) 呈现的房间全部带"直播中"徽标 (lst_bage __live), 抽查 3 页 216 张卡
// 无一例外; 进入私密秀的房间不出现在该列表里。私密秀/付费内容一律不碰, 不伪造任何凭证。
// 列表: SSR HTML, 卡片 <div class="ls_thumb">, 每页 72 条, 分页?page=N (实测 female/male/couples/
// trans/new-models 与标签页 p1/p2 均 72 条且不重复)。
// 卡片锚点自带全部播放要素: data-chathost (流名, 大小写原样)、data-esid (边缘服务器, 如
// live-edge25 / live-edge-us80)、data-vq (源画质, 如 1920x1080)、data-gender; 封面为卡内
// <img src="//i.bgicdn.com/live/.../xbig_lq/*.jpg"> (真实 https 直链, 无头 200, 不经任何代理)。
// 播放 (2026-10-20 VM 无头全链实测, 第二版用中转列表取到的房间复验仍通):
// https://{esid}.bcvcdn.com/hls/stream_{chathost}/playlist.m3u8 主列表 200, 含 240/480/720 +
// 源画质 (无后缀档, 可达 1920x1080) 共 4 档; 变体为相对路径 public-aac/stream_{user}[_720]/
// chunks.m3u8, 分片.ts 同目录相对引用; 全程不带任何自定义头实拉: 主列表 200 → 变体 200 →
// 首分片 200 (564KB, TS 同步字节 0x47)。令牌与请求方无绑定 (无签名参数), 播放器直连 CDN
// 即可, play() 0 上游请求、直接拼主列表地址返回 (parse:0, 全档主列表)。
// 注意: 边缘服务器不可互换 —— 用别的边缘拉同一流实测 404, data-esid 是播放地址的必需件。
//
//
// 第一版 VM 全通、真机分类能出但内容永远加载不出。根因不是解析, 是 cn 站的"空壳页": 那是一张
// 按请求方 IP 归属地弹出的**年龄核实拦截页** (实测文案先后出现乔治亚州、南卡罗来纳州版,
// 带 Yoti 验证按钮, 整页 0 卡片)。美国多州有成人站年龄法, 出口落在这些州就吃壳。批量对照
// 已证伪第一版的 Cookie 罐理论: 空壳与完整页下发的 Cookie 集合与关键值 (warning18) 完全
// 相同, 带罐组 10 次吃壳 4 次、无罐组 1 次 —— 决定因素是每次请求的出口地理位置, 与
// Cookie/UA/传输无关。真机症状严丝合缝: 分类是蜘蛛内置的 (照常显示), 内容抓取若用户
// 出口 (含其 VPN 出口) 落在年龄法地区, 就是 100% 空壳、永远 0 条。
// 且轮盘不止直连: r.jina.ai 的出口池同样轮盘, 复测中亲见它对同一 URL 先后吐出 Cloudflare
// "Just a moment..." 挑战页与南卡州年龄壳 —— 任何单层单次抓取都必然偶发全灭。
// 修法: **多层递进 + 内容校验 + 粘性层记忆 + 多轮重抽** (借鉴本仓 JAVSB 第四轮)。每次抓取
// 都是一次独立的"出口地理抽奖", 失败即换层、整轮失败就再抽一轮:
// L1 框架 req 直连 (用户出口未被门禁时最快最新鲜; 吃壳是秒回 200, 校验不过立刻换层,
// 代价只有一次往返) → L2 框架 req 经 r.jina.ai (x-return-format: html 取渲染后 DOM,
// 完整时 72 卡且解析结果与直连页逐项一致) → L3 原生 fetch 经 jina (换传输兜底, 两条
// 传输在限流/挑战时互救) → L4 原生 fetch 直连 → L5 allorigins 原始 HTML (第二轮重抽起
// 才启用; 又一个独立出口池, 慢且偶发故障, 只作机会层)。最多 3 轮、总预算 30s 封顶;
// 任一层真解析出卡片才算成功 (空壳/挑战页 = 失败); 成功层被记住, 后续先试它。
// 另加 60s 页面缓存: jina 有约 45s+ 的响应缓存 (实测 45s 内逐字节相同), 直连命中的页面
// 也顺带加速翻页返回; 直播列表可接受此量级。jina 免费层约 20 次/分钟/IP, 粘性 + 缓存
// 把正常浏览压到很低; 其卡片与同一时刻直连对比前 5 名顺序一致、72 中重合 50 (直播
// 进出房的正常漂移), 新鲜度够用。
// jina 还有一层坑: 它按目标 URL 缓存响应, 一次坏抽 (壳) 会被缓存并对同 URL 反复吐出
// (实测 /female 裸址连吐 39129B 壳, 同一时刻换 ?page=1 形态立刻完整 72 卡)。故重抽轮里
// jina 层换站方原生分页形态 (?page=1 与裸址同内容) 轮换缓存键, 等于换一次独立抽奖。
// 越界页 (小标签第 2 页) 站方返回的是完整站点页 (163KB) 只是列表区为空, 与拦截页有
// 标记差 (壳必含 yoti/js-agree/age_verification、挑战页必含 "Just a moment", 六样本全
// 可区分): 第一方层 (直连/jina) 给出这种"真空页"立即接受返回 0 条, 不白烧重抽轮次;
// allorigins 的缓存内容不可信, 不参与真空判定 (实测它回吐过假真空页)。
// 播放侧复查另发现: 列表快照过期会让 esid 失效 (新鲜列表测流 8/8 通, 老快照 2/4 404,
// 主播换节点/下播所致)。故 vod_id 第 4 段带来源页 URL, detail 时强制重拉该页刷新
// esid/pic, 找不到该房间或抓取失败静默沿用原 id。play 本身维持 0 请求直拼 (流无绑定
// 已被跨出口对照证明: VM 铸址、异地出口实拉分片 200)。
// markdown 类中转对本站不可用: 播放必须用 data-esid 拼地址, markdown 会剥掉全部 data
// 属性、只剩用户名。故本站只用 HTML 形态的中转。
// 分类: 6 个主类 (全部/女生/男生/情侣/跨性别/新人) + 45 个站内标签。标签取自 /tags 目录页的
// 真实锚点 (slug 与中文名逐字取回), 抽验 anal-play/russian/hd-plus/mobile-live/lovense 均
// 72 条/页、new-teens 约 30 条。注意: /tags 页内嵌 JSON 里另有一套 code (asian/bbw/anal/toys…)
// 带在线计数, 但它们不是 URL slug —— /tags/asian 返回的是"标签库索引页" (0 卡片), 顶层
// /asian 在 cn 站 302 跳首页, 故那套 code 一个都不收, 以免分类打开是空的。
// 搜索: 站方搜索是固定推荐块 (任何关键词返回同一批房间) 与前端 SPA 专用通道, /search?query=、
// /search/{q}、/members/search?query= 等公开 URL 形态实测均无真结果, 无可用公开搜索接口,
// search 返回空列表 (与 StripChat 同口径)。

const KEY = 'py_bongacams';
const NAME = 'BongaCams';
const HOST = 'https://cn.bongacams.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = HOST + '/';
const PAGE_SIZE = 72;
// 中转: 公开服务 r.jina.ai (html 模式返回浏览器渲染后 DOM) / allorigins (原始 HTML)
const JINA = 'https://r.jina.ai/';
const ALLORIGINS = 'https://api.allorigins.win/raw?url=';
// 分层抓取预算: 单页总时长封顶, 防止全层连败时用户久等
const BUDGET_MS = 30000;
const CAP_DIRECT = 4500;
const CAP_JINA = 7000;
const CAP_SLOW = 8000;
const CACHE_TTL = 60000;

const CATS = [
{ type_id: 'all', type_name: '全部'},
{ type_id: 'female', type_name: '女生'},
{ type_id: 'male', type_name: '男生'},
{ type_id: 'couples', type_name: '情侣'},
{ type_id: 'trans', type_name: '跨性别'},
{ type_id: 'new-models', type_name: '新人'},
{ type_id: 'tag:squirt', type_name: '标签·潮吹'},
{ type_id: 'tag:anal-play', type_name: '标签·肛交游戏'},
{ type_id: 'tag:ass-fucking', type_name: '标签·肛交'},
{ type_id: 'tag:blowjob', type_name: '标签·口交'},
{ type_id: 'tag:cock-sucking', type_name: '标签·吮吸鸡巴'},
{ type_id: 'tag:deepthroat', type_name: '标签·深喉'},
{ type_id: 'tag:fucking', type_name: '标签·性交'},
{ type_id: 'tag:fucking-hard', type_name: '标签·用力干'},
{ type_id: 'tag:couples-fucking', type_name: '标签·夫妻性爱'},
{ type_id: 'tag:masturbation', type_name: '标签·手淫'},
{ type_id: 'tag:handjob', type_name: '标签·手淫（handjob）'},
{ type_id: 'tag:jerking', type_name: '标签·打飞机'},
{ type_id: 'tag:fingering', type_name: '标签·指奸'},
{ type_id: 'tag:fisting', type_name: '标签·拳头'},
{ type_id: 'tag:dildo-play', type_name: '标签·假阳具'},
{ type_id: 'tag:dildofucking', type_name: '标签·吸假阳具'},
{ type_id: 'tag:dildoing', type_name: '标签·插假阳具'},
{ type_id: 'tag:pussyfucking', type_name: '标签·插阴部'},
{ type_id: 'tag:pussyrubbing', type_name: '标签·阴部摩擦'},
{ type_id: 'tag:rubbing', type_name: '标签·摩擦'},
{ type_id: 'tag:feet-fuck', type_name: '标签·脚趾性交'},
{ type_id: 'tag:foot-fetish', type_name: '标签·恋足'},
{ type_id: 'tag:cumming', type_name: '标签·射精'},
{ type_id: 'tag:ejaculation', type_name: '标签·射精（ejaculation）'},
{ type_id: 'tag:sucking', type_name: '标签·吮吸'},
{ type_id: 'tag:licking', type_name: '标签·舔'},
{ type_id: 'tag:kissing', type_name: '标签·亲吻'},
{ type_id: 'tag:teasing', type_name: '标签·调戏'},
{ type_id: 'tag:stripping', type_name: '标签·脱光'},
{ type_id: 'tag:flashing', type_name: '标签·闪光'},
{ type_id: 'tag:dancing', type_name: '标签·跳舞'},
{ type_id: 'tag:massage', type_name: '标签·按摩'},
{ type_id: 'tag:female-domination', type_name: '标签·女士主导'},
{ type_id: 'tag:chatting', type_name: '标签·聊天'},
{ type_id: 'tag:enjoying', type_name: '标签·享受'},
{ type_id: 'tag:dreaming', type_name: '标签·梦中的'},
{ type_id: 'tag:no-fucking', type_name: '标签·不做爱'},
{ type_id: 'tag:camshow', type_name: '标签·网络视频节目'},
{ type_id: 'tag:lovense', type_name: '标签·lovense'},
{ type_id: 'tag:mobile-live', type_name: '标签·移动直播'},
{ type_id: 'tag:recordable', type_name: '标签·可记录的'},
{ type_id: 'tag:hd-plus', type_name: '标签·HD+'},
{ type_id: 'tag:new-teens', type_name: '标签·新人18岁以上青年女孩'},
{ type_id: 'tag:russian', type_name: '标签·俄语'},
{ type_id: 'tag:ukrainian', type_name: '标签·乌克兰人'},
];

function t(v) { return String(v == null? '': v).trim();}

// ---------- 列表解析 (与第一版相同: 直连 DOM 与 jina 渲染 DOM 上均实测出满 72 卡) ----------

function getAttr(tag, name) {
const m = tag.match(new RegExp(name + '="([^"]*)"'));
return m? m[1]: '';
}

function parseCards(html, pageUrl) {
const out = [];
const seen = new Set();
const parts = String(html || '').split('<div class="ls_thumb');
for (let i = 1; i < parts.length; i++) {
const chunk = parts[i].slice(0, 2600);
if (!chunk.includes('__live')) continue; // 只收公开直播中
const am = chunk.match(/<a [^>]*class="lst_wrp[^>]*>/);
if (!am) continue;
const tag = am[0];
const chathost = getAttr(tag, 'data-chathost');
const esid = getAttr(tag, 'data-esid');
if (!chathost ||!/^live-edge[\w-]*$/.test(esid) || seen.has(chathost)) continue;
seen.add(chathost);
const name = getAttr(tag, 'data-name') || chathost;
const vq = getAttr(tag, 'data-vq');
let pic = '';
const im = chunk.match(/<img src="(\/\/i\.bgicdn\.com\/live\/[^"]+\.jpg)"/);
if (im) pic = 'https:' + im[1];
let viewers = '';
const vm = chunk.match(/lst_viewers">(\d+)</);
if (vm) viewers = vm[1];
const remarks = `${viewers? viewers + '人观看': '直播中'}${vq? ' · ' + vq: ''}`;
out.push({
vod_id: `${chathost}|${esid}|${pic}` + (pageUrl ? '|' + encodeURIComponent(pageUrl) : ''),
vod_name: name,
vod_pic: pic,
vod_remarks: remarks,
});
}
return out;
}

// 内容校验: 必须是真列表页 (年龄壳/CF 挑战页/空壳解析 0 卡, 一律算该层失败)
const hasCards = (html) =>!!html && html.includes('ls_thumb') && parseCards(html).length > 0;

// "真空页"快速判定: 越界页 (如小标签的第 2 页) 站方返回的是完整站点页 (实测 163KB、
// 标题/页脚齐全) 只是列表区为空 —— 与拦截页有明确标记差 (六个实测样本全可区分):
// 年龄壳必含 yoti/js-agree/age_verification, CF 挑战页必含 "Just a moment"。三者皆无、
// 体积够大且带站名, 即真空页, 立即接受返回 0 条, 不再白烧重抽轮次 (否则要等约 27s)。
const isTrueEmpty = (html) => !!html && html.length > 100000
  && !html.includes('yoti') && !html.includes('js-agree')
  && !html.includes('age_verification') && !html.includes('Just a moment')
  && html.includes('BongaCams');

// ---------- 会话 Cookie 罐 (直连层用; 站方下发什么存什么, 对直连无害) ----------
let cookieJar = '';
function storeCookies(headers) {
const sc = headers && headers['set-cookie'];
if (!sc) return;
const map = new Map();
if (cookieJar) {
for (const p of cookieJar.split('; ')) {
const i = p.indexOf('=');
if (i > 0) map.set(p.slice(0, i), p.slice(i + 1));
}
}
for (const c of Array.isArray(sc)? sc: [sc]) {
const kv = String(c).split(';')[0];
const i = kv.indexOf('=');
if (i > 0) map.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
}
if (map.size) cookieJar = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function siteHeaders() {
const h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': REFERER};
if (cookieJar) h['Cookie'] = cookieJar;
return h;
}

function jinaHeaders() {
// 两种格式头同发 (本仓 JAVSB 第四轮实测口径): 任一被识别都返回渲染后 DOM
return { 'User-Agent': UA, 'Accept': '*/*', 'x-return-format': 'html', 'x-respond-with': 'html'};
}

// ---------- 单层抓取 ----------
async function viaReq(url, headers, timeoutMs) {
const { data, status, headers: rh} = await req.get(url, { headers, timeout: timeoutMs});
if (rh) storeCookies(rh);
if (status && status!== 200) return '';
if (data == null || data === '') return '';
return typeof data === 'string'? data: JSON.stringify(data);
}

async function viaFetch(url, headers, timeoutMs) {
const ctl = new AbortController();
const tm = setTimeout(() => ctl.abort(), timeoutMs);
try {
const r = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow'});
try {
const sc = typeof r.headers.getSetCookie === 'function'? r.headers.getSetCookie(): r.headers.get('set-cookie');
if (sc) storeCookies({ 'set-cookie': sc});
} catch (e) { /* 忽略 */}
if (!r.ok) return '';
return await r.text();
} finally {
clearTimeout(tm);
}
}

// 五层: 0 直连 req / 1 jina req / 2 jina fetch / 3 直连 fetch / 4 allorigins (重抽轮才启用)
const LAYERS = [
{ cap: CAP_DIRECT, run: (url, ms) => viaReq(url, siteHeaders(), ms)},
{ cap: CAP_JINA, run: (url, ms) => viaReq(JINA + url, jinaHeaders(), ms)},
{ cap: CAP_JINA, run: (url, ms) => viaFetch(JINA + url, jinaHeaders(), ms)},
{ cap: CAP_DIRECT, run: (url, ms) => viaFetch(url, siteHeaders(), ms)},
{ cap: CAP_SLOW, run: (url, ms) => viaFetch(ALLORIGINS + encodeURIComponent(url), { 'User-Agent': UA, 'Accept': '*/*'}, ms)},
];
let goodLayer = -1; // 粘性层: 上次成功的层先试

// ---------- 页面缓存 ----------
const pageCache = new Map(); // url -> { t, s}
function cacheGet(url) {
const e = pageCache.get(url);
if (e && Date.now() - e.t < CACHE_TTL) return e.s;
return '';
}
function cacheSet(url, s) {
pageCache.set(url, { t: Date.now(), s});
if (pageCache.size > 40) pageCache.delete(pageCache.keys().next().value);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// jina 按目标 URL 缓存响应: 若它把某 URL 的一次坏抽 (年龄壳/挑战页) 缓存下来, 同 URL
// 反复请求只会反复吐同一张坏页 (实测 /female 裸址连吐壳, 换 ?page=1 形态立刻完整 72 卡)。
// 故重抽轮里 jina 层改用站方原生分页形态 (?page=1 与裸址同内容) 换一个缓存键 = 换一次独立抽奖。
function jinaTarget(url, round) {
if (round === 0 || url.includes('page=')) return url;
return url + (url.includes('?') ? '&' : '?') + 'page=1';
}

// 列表页抓取: 粘性层优先, 逐层内容校验, 整轮失败换一轮重抽, 总预算封顶
async function fetchListing(url, force) {
const cached = force ? null : cacheGet(url);
if (cached && hasCards(cached)) return cached;
const deadline = Date.now() + BUDGET_MS;
const base = [0, 1, 2, 3, 4];
const order = goodLayer >= 0? [goodLayer,...base.filter((i) => i!== goodLayer)]: base;
for (let round = 0; round < 3; round++) {
for (const i of order) {
if (round === 0 && i === 4) continue; // allorigins 只在重抽轮作机会层
const remain = deadline - Date.now();
if (remain < 1000) return '';
try {
const target = (i === 1 || i === 2) ? jinaTarget(url, round) : url;
const html = await LAYERS[i].run(target, Math.min(LAYERS[i].cap, remain));
if (hasCards(html)) {
goodLayer = i;
cacheSet(url, html);
return html;
}
if (i < 4 && isTrueEmpty(html)) { // 真空页 (越界翻页): 只认第一方层 (直连/jina) 的判定, allorigins 的缓存内容不可信
goodLayer = i;
return html;
}
} catch (e) { /* 该层失败, 换下一层 */}
}
if (deadline - Date.now() > 3000) await sleep(600); // 轮间稍顿, 让出口/会话轮换
}
return '';
}

// ---------- 接口 ----------

function catUrl(tid, page) {
let base;
if (!tid || tid === 'all') base = HOST + '/';
else if (tid.startsWith('tag:')) base = `${HOST}/tags/${tid.slice(4)}`;
else base = `${HOST}/${tid}`;
return page > 1? `${base}${base.includes('?')? '&': '?'}page=${page}`: base;
}

async function init() {
return {};
}

async function home() {
const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name}));
const html = await fetchListing(catUrl('all', 1));
return { class: cls, list: html ? parseCards(html, HOST + '/') : [] };
}

async function category(reqIn) {
const body = reqIn?.body || {};
const tid = t(body.tid || body.id) || 'all';
const page = Math.max(1, parseInt(body.page, 10) || 1);
const url = catUrl(tid, page);
const html = await fetchListing(url);
const list = html ? parseCards(html, url) : [];
// 直播列表无官方总页数: 本页满 72 条视为还有下一页
const pagecount = list.length >= PAGE_SIZE? page + 1: page;
return { page, pagecount, limit: PAGE_SIZE, total: list.length, list};
}

// ---------- 详情 / 播放 (与第一版相同: 载荷制, play 0 上游请求) ----------

function parsePayload(raw) {
let s = t(raw);
if (s.includes('$')) s = s.split('$').pop();
const [chathost = '', esid = '', pic = '', srcEnc = ''] = s.split('|');
if (!/^[\w-]+$/.test(chathost) ||!/^live-edge[\w-]*$/.test(esid)) return null;
let srcUrl = '';
try { const u = decodeURIComponent(srcEnc || ''); if (u.startsWith(HOST + '/')) srcUrl = u; } catch (e) {}
return { chathost, esid, pic, srcUrl };
}

async function detail(reqIn) {
const body = reqIn?.body || {};
let p = parsePayload(body.id);
if (!p) return { list: [] };
// 播放断点 (实测): 列表快照过期后主播可能已换边缘节点 (esid 失效 -> 流地址 404);
// 新鲜列表立刻测流 8/8 通, 老快照只剩一半。故点开详情时强制重拉来源页刷新 esid,
// 找不到该房间或抓取失败就静默沿用原 id (房间可能已翻页/下线, 不阻断)。
if (p.srcUrl) {
try {
const html = await fetchListing(p.srcUrl, true);
const fresh = parseCards(html, p.srcUrl).find((v) => v.vod_id.split('|')[0] === p.chathost);
if (fresh) {
const fp = parsePayload(fresh.vod_id);
if (fp) p = { ...p, esid: fp.esid, pic: fp.pic || p.pic };
}
} catch (e) { /* 刷新失败沿用原 id */ }
}
const payload = `${p.chathost}|${p.esid}|${p.pic}`;
return {
list: [{
vod_id: payload,
vod_name: p.chathost,
vod_pic: p.pic,
type_name: '直播',
vod_remarks: '直播中',
vod_content: `${p.chathost} 的 BongaCams 公开直播间`,
vod_play_from: NAME,
vod_play_url: '直播$' + payload,
}],
};
}

async function play(reqIn) {
const body = reqIn?.body || {};
const p = parsePayload(body.id);
if (!p) return { parse: 0, url: ''};
// 主列表直返 (全档, 含源画质): 无签名、无请求头绑定, 分片相对引用由播放器自行拼接
return {
parse: 0,
url: `https://${p.esid}.bcvcdn.com/hls/stream_${p.chathost}/playlist.m3u8`,
header: { 'User-Agent': UA, 'Referer': `${HOST}/${p.chathost}`},
};
}

async function search(reqIn) {
const body = reqIn?.body || {};
const page = Math.max(1, parseInt(body.page, 10) || 1);
// 无可用公开搜索接口 (见文件头), 返回空
return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: []};
}

export default function createSpider() {
return {
meta: { key: KEY, name: NAME, type: 3},
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
