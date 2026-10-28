// NoodleMagazine - CatPawOpen JS Spider
// 站：https://noodlemagazine.com/（视频搜索聚合站）
// 已实测（2026-10-28）：
// - 首页列表：<div class="item" data-video-title-base="..."> 内
//   <a href="/watch/{owner}_{id}">，封面 <img data-src="...preview_320.jpg">；
//   首页导航只有范围切换：/home（最新）、/home?range=week（本周）、/home?range=month（本月），
//   无传统分类，故分类只给这三档，不猜标签分类。
// - 搜索：/video/{kw}（实测出 24 条 /watch/ 链接）。
// - 详情：/watch/{owner}_{id} 页含 <title data-video-title-base>、og:image（preview_800.jpg）
//   与 /videofile/{owner}_{id}.mp4（301 跳到 CDN vid_360p.mp4，带时效 token，
//   详情时现取现用，播放器跟随重定向即可）；另有 720p/480p/240p 变体但页内只给
//   videofile 入口，故只返回 videofile 一条线。
import req from '../../util/req.js';

const KEY = 'py_noodle';
const NAME = 'NoodleMagazine';
const HOST = 'https://noodlemagazine.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': referer || HOST };
}
async function getText(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return String(data || '');
  } catch { return ''; }
}
// 2026-10-29：与 javneon 同因——浏览器与本机都能抓、唯独 App 内列表为空，
// 疑为站方按客户端指纹拦 App 请求；中转 Worker（用户 CF 自建，
// 部署后地址 https://html-relay.li768435813.workers.dev/，代码见 fix15/html-relay-worker.js）
// 在 CF 边缘替 App 抓一次。策略：直连优先、解析为空才走中转；中转未部署时行为与原来一致。
const RELAY = 'https://html-relay.li768435813.workers.dev/';
async function fetchViaRelay(url, referer) {
  try {
    const res = await req.get(RELAY + '?url=' + encodeURIComponent(url), { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return String(data || '');
  } catch { return ''; }
}
async function listSmart(url, referer) {
  const html = await getText(url, referer);
  let list = parseList(html);
  if (!list.length) {
    const rh = await fetchViaRelay(url, referer);
    const list2 = parseList(rh);
    if (list2.length) return { list: list2, html: rh };
  }
  return { list, html };
}
function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function parseList(html) {
  const items = [];
  const seen = new Set();
  const chunks = String(html).split('<div class="item"');
  for (let i = 1; i < chunks.length; i++) {
    const blk = chunks[i].slice(0, 4000);
    const am = blk.match(/<a href="(\/watch\/[^"]+)"[^>]*>/i);
    if (!am) continue;
    const url = HOST.replace(/\/$/, '') + am[1];
    if (seen.has(url)) continue;
    const tm = blk.match(/data-video-title-base="([^"]+)"/i);
    const title = tm ? stripTags(tm[1]) : '';
    if (!title || title.length < 2) continue;
    const pm = blk.match(/data-src="(https?:[^"]+preview_320\.jpg[^"]*)"/i) || blk.match(/data-src="(https?:[^"]+)"/i);
    seen.add(url);
    items.push({ vod_id: url, vod_name: title, vod_pic: pm ? pm[1] : '' });
    if (items.length >= 24) break;
  }
  return items;
}
async function init() { return {}; }
// 2026-10-29：分类实测——range=month 与 home 返回完全相同的 24 条（站方忽略 month），
// 故删掉“本月热门”这个重复分类；其余 6 档（day/week/recent/explore/now/热门趋势）
// 逐个验过、各 24 条（explore 首屏 48 条）且互不重复。
// 翻页实测——站方“加载更多”不是 GET 翻页：GET 带 ?page= 参数永远返回第 1 页，
// 真机制是 POST 到当前页（站方自己的 popular_index.js）：body 带原查询参数 +
// p=页码（从 0 起）+ csrfmiddlewaretoken（取自首页隐藏 input）。
// 之前 category 固定 pagecount=1，App 根本不请求第 2 页——这就是“无法加载更多”的原因。
function parseCsrf(html) {
  const m = html.match(/name="csrfmiddlewaretoken"[^>]*value="([^"]+)"/i)
    || html.match(/value="([^"]+)"[^>]*name="csrfmiddlewaretoken"/i);
  return m ? m[1] : '';
}
function pageForm(tid, page, token) {
  const q = (tid.split('?')[1] || '');
  const parts = q.split('&').filter(s => s && !/^p=/i.test(s) && !/^csrfmiddlewaretoken=/i.test(s));
  parts.push('p=' + (page - 1));
  if (token) parts.push('csrfmiddlewaretoken=' + encodeURIComponent(token));
  return parts.join('&');
}
// 2026-10-29 翻页根因补记：站方是 Django，POST 翻页必须带 GET 时种下的
// csrftoken cookie，否则 nginx 直接 403（本机实测：无 cookie 403、有 cookie 200
// 且三类分类——range=week、now、popular/trending——全部返回第 2 页新内容）。
// 旧代码 POST 不带任何 cookie，故永远 403、永远空——这就是“无法加载更多”的真因，
// 与 pagecount 无关。token 与 cookie 必须取自同一次 GET；中转路径下 Worker 会把
// 源站 Set-Cookie 透传回 x-set-cookie（见 html-relay-worker.js 职能三），
// 蜘蛛读 x-set-cookie 与 set-cookie 两路，再以 Cookie / X-Cookie 双头带回。
function parseSetCookie(headers) {
  if (!headers) return '';
  const raw = headers['set-cookie'] || headers['Set-Cookie'] || headers['x-set-cookie'] || headers['X-Set-Cookie'];
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const pairs = [];
  for (const c of arr) {
    for (const part of String(c).split(';;')) {
      const nv = part.split(';')[0].trim();
      if (nv && nv.includes('=')) pairs.push(nv);
    }
  }
  return [...new Set(pairs)].join('; ');
}
async function getWithCookies(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return { html: String(data || ''), cookie: parseSetCookie(res && res.headers) };
  } catch { return { html: '', cookie: '' }; }
}
async function relayGetFull(url, referer) {
  try {
    const res = await req.get(RELAY + '?url=' + encodeURIComponent(url), { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return { html: String(data || ''), cookie: parseSetCookie(res && res.headers) };
  } catch { return { html: '', cookie: '' }; }
}
async function postWithCookie(url, form, cookie, referer) {
  try {
    const headers = { ...H(referer), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    if (cookie) headers['Cookie'] = cookie;
    const res = await req.post(url, form, { headers, timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return String(data || '');
  } catch { return ''; }
}
async function relayPostFull(url, form, cookie, referer) {
  try {
    const headers = { ...H(referer), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    if (cookie) { headers['Cookie'] = cookie; headers['X-Cookie'] = cookie; }
    const res = await req.post(RELAY + '?url=' + encodeURIComponent(url), form, { headers, timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return String(data || '');
  } catch { return ''; }
}
async function home() {
  const { list } = await listSmart(HOST + 'home', HOST);
  return {
    class: [
      { type_id: 'home', type_name: '最新' },
      { type_id: 'home?range=day', type_name: '今日热门' },
      { type_id: 'home?range=week', type_name: '本周热门' },
      { type_id: 'home?range=recent', type_name: '新收录' },
      { type_id: 'home?range=explore', type_name: '探索' },
      { type_id: 'now', type_name: '实时' },
      { type_id: 'popular/trending', type_name: '趋势榜' },
    ],
    filters: {},
    list,
  };
}
async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'home');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const url = HOST + tid;
  if (page <= 1) {
    const { list } = await listSmart(url, HOST);
    // total 必须给一个“远大于已加载”的数：旧代码 total=list.length（24）会让
    // App 认为已加载全部、不再请求第 2 页；limit 改为真实页大小 24。
    return { page: 1, pagecount: 9999, limit: 24, total: list.length ? 999999 : 0, list };
  }
  // 第 2 页起：先 GET 一次同取 csrf token 与 cookie，再带 cookie POST 翻页；
  // 直连 POST 解析为空时走中转 POST（同样带 cookie）
  let base = await getWithCookies(url, HOST);
  if (!parseList(base.html).length) {
    const rb = await relayGetFull(url, HOST);
    if (parseList(rb.html).length) base = rb;
  }
  const token = parseCsrf(base.html);
  const form = pageForm(tid, page, token);
  let html = await postWithCookie(url, form, base.cookie, HOST);
  let list = parseList(html);
  if (!list.length) {
    const rh = await relayPostFull(url, form, base.cookie, HOST);
    list = parseList(rh);
  }
  return { page, pagecount: 9999, limit: 24, total: list.length ? 999999 : 0, list };
}
// 详情播放地址提取：window.playlist 四档优先，空时回退 videofile 单线
function detailPlayUrl(html, raw) {
  const pl = [];
  const seenPl = new Set();
  const plRe = /"file"\s*:\s*"([^"]+)"\s*,\s*"label"\s*:\s*"([^"]+)"/gi;
  let pm;
  while ((pm = plRe.exec(html)) !== null) {
    const f = pm[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
    const lab = pm[2].trim();
    if (!/^https?:\/\//i.test(f) || seenPl.has(f)) continue;
    seenPl.add(f);
    pl.push({ label: lab, file: f });
  }
  pl.sort((a, b) => (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0));
  if (pl.length) return pl.map(x => x.label + '$' + x.file).join('#');
  const vm = html.match(/\/videofile\/[^"'\s<>]+\.mp4/i);
  return vm ? ('播放$' + HOST.replace(/\/$/, '') + vm[0]) : ('未找到视频源$' + raw);
}
async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : HOST + String(raw).replace(/^\/+/, '');
    let html = await getText(url, HOST);
    let playUrl = detailPlayUrl(html, raw);
    if (playUrl.startsWith('未找到视频源')) {
      const rh = await fetchViaRelay(url, HOST);
      const playUrl2 = detailPlayUrl(rh, raw);
      if (!playUrl2.startsWith('未找到视频源')) { html = rh; playUrl = playUrl2; }
    }
    const tm = html.match(/data-video-title-base="([^"]+)"/i);
    const title = tm ? stripTags(tm[1]) : 'NoodleMagazine';
    const om = html.match(/og:image[^>]*content="([^"]+)"/i);
    list.push({ vod_id: raw, vod_name: title, vod_pic: om ? om[1] : '', vod_play_from: 'NoodleMagazine', vod_play_url: playUrl });
  }
  return { list };
}
async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  return { parse: isVideo ? 0 : 1, url: id, header: H(HOST) };
}
async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  if (!wd) return { page: 1, pagecount: 1, limit: 90, total: 0, list: [] };
  const { list } = await listSmart(HOST + 'video/' + encodeURIComponent(wd), HOST);
  return { page: 1, pagecount: 1, limit: 90, total: list.length, list };
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
