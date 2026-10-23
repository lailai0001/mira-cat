import req from '../../util/req.js';

// JavMost (py_javmost)
// 站点: https://www.javmost.ws/ (JAV 在线站，无反爬，列表/详情直抓)
// 列表: / (最新, 25条/页, 翻页 /category/all/page/N/)
// 注意: / (最新) 与 /category/all/ (全部) 是站点本身设计的同一页面，内容完全一致，非 spider bug
// 分类: /category/{all|censor|uncensor}/[/page/N/] (25条/页)
// 题材: /category/{Genre Slug}/[/page/N/] (巨乳/中出/人妻等，站点 /allcategory 实测)
// 热门: /topview|/topdaily|/topweek|/topmonth (25条/页, 翻页 /{slug}/all/page/N/)
// 系列: /code/{CODE}/[/page/N/] (25条/页)
// 标签: /tag/{TAG}/ (仅第1页可用，翻页 410，站点限制)
// 无码流出: /tag/REDUCING/ 翻页 410 不可用; 改走 /search/REDUCING/[/page/N/]
//           (实测与 tag 页第1页内容完全一致，搜索支持翻页)
// 搜索: /search/{kw}/[/page/N/]
// 详情: /{CODE}/ 标题+封面从 JSON-LD 取
// 播放: 三步走。1) 服务端 POST /ri3123o235r/ (必须带 X-Requested-With: XMLHttpRequest 头，
//       否则被 tar-pit) 拿 embed 播放器地址 (dooplayer.com/mostplayer.com 等)；
//       2) embed 页带 Sec-Fetch-Dest: iframe 头访问 (否则 204)，解析 meta 的
//          x-embed-token/et/sig/api，POST {api}{token} 拿到直链 (mp4/m3u8)，parse:0；
//       3) 解不出直链时降级把 embed 页交给 MiraPlayer parse:1 嗅探，再降级嗅探详情页。
//       注意: 部分 CDN (wowstream2.cloud 等) 对机房 IP 有 CF 拦截，服务端验证 403，
//       但用户手机家庭网络一般可直连。

const KEY = 'py_javmost';
const NAME = 'JavMost';
const SITE = 'https://www.javmost.ws';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 33 个真实分类 (2026-10-20 从站点导航、/allcategory、/allcode 实测)
// 注意: latest(最新) 与 all(全部) 是站点本身的同一页面，内容一致
// 无码流出: search:REDUCING 走搜索路径 (与 /tag/REDUCING/ 第1页内容一致，支持翻页;
//   tag 页翻页 410 不可用)。genre 为 /allcategory 的题材分类，code 为 /allcode 的系列
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'all', type_name: '全部' },
  { type_id: 'censor', type_name: '有码' },
  { type_id: 'uncensor', type_name: '无码' },
  { type_id: 'search:REDUCING', type_name: '无码流出' },
  { type_id: 'topview', type_name: '小时热门' },
  { type_id: 'topdaily', type_name: '日热门' },
  { type_id: 'topweek', type_name: '周热门' },
  { type_id: 'topmonth', type_name: '月热门' },
  { type_id: 'genre:Big Tits', type_name: '巨乳' },
  { type_id: 'genre:Creampie', type_name: '中出' },
  { type_id: 'genre:Married Woman', type_name: '人妻' },
  { type_id: 'genre:School Girls', type_name: '学生' },
  { type_id: 'genre:Slender', type_name: '苗条' },
  { type_id: 'genre:Solowork', type_name: '独角戏' },
  { type_id: 'genre:Squirting', type_name: '潮吹' },
  { type_id: 'genre:Amateur', type_name: '素人' },
  { type_id: 'genre:Drama', type_name: '剧情' },
  { type_id: 'genre:Cowgirl', type_name: '女上位' },
  { type_id: 'code:SNIS', type_name: 'SNIS系列' },
  { type_id: 'code:IPZ', type_name: 'IPZ系列' },
  { type_id: 'code:JUX', type_name: 'JUX系列' },
  { type_id: 'code:ABP', type_name: 'ABP系列' },
  { type_id: 'code:SSNI', type_name: 'SSNI系列' },
  { type_id: 'code:MIDE', type_name: 'MIDE系列' },
  { type_id: 'code:WANZ', type_name: 'WANZ系列' },
  { type_id: 'code:STAR', type_name: 'STAR系列' },
  { type_id: 'code:HEYZO', type_name: 'HEYZO系列' },
  { type_id: 'code:JUC', type_name: 'JUC系列' },
  { type_id: 'code:JUFD', type_name: 'JUFD系列' },
  { type_id: 'code:LUXU', type_name: 'LUXU系列' },
  { type_id: 'code:EBOD', type_name: 'EBOD系列' },
  { type_id: 'code:RBD', type_name: 'RBD系列' },
];

// 非视频的单段路径，解析卡片时跳过
const SKIP_SLUGS = new Set([
  'allcategory', 'allcode', 'alldirector', 'allmaker',
  'topview', 'topdaily', 'topweek', 'topweeknew', 'topmonth',
  'pornstar', 'toppornstar', 'votepornstar', 'newpornstar',
  'category', 'tag', 'code', 'search', 'page', '404',
]);

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function fixPic(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return u;
}

// 双通道: 先框架 req，失败再原生 fetch
async function getHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Referer': REFERER,
  };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

async function init(reqIn) {
  return {};
}

// 解析视频卡片: <a href="https://www.javmost.ws/{CODE}/" ... alt="标题"> ... data-src="封面"
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(https?:\/\/www\.javmost\.ws\/([A-Za-z0-9\-_]+)\/)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = m[1];
    const slug = m[2];
    if (SKIP_SLUGS.has(slug.toLowerCase())) continue;
    if (seen.has(durl)) continue;
    seen.add(durl);
    const win = html.slice(m.index, m.index + 2500);
    // 标题: a 标签 alt 属性，或卡片内 h1.card-title
    let tm = m[0].match(/alt="([^"]+)"/) || win.match(/<h1[^>]*class="card-title[^"]*"[^>]*>([^<]+)</);
    const title = tm ? clean(tm[1]) : slug;
    // 封面: data-src (懒加载真实地址)
    const im = win.match(/data-src="(https?:\/\/[^"]+)"/) || win.match(/data-src="(\/\/[^"]+)"/);
    out.push({
      vod_id: durl,
      vod_name: title,
      vod_pic: im ? fixPic(im[1]) : '',
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const pages = [...html.matchAll(/\/page\/(\d+)\//g)].map(x => parseInt(x[1], 10));
  const nums = pages.filter(n => n > 0 && n < 100000);
  return nums.length ? Math.max(...nums) : 1;
}

function buildList(url, page, limit) {
  limit = limit || 25;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    const pc = parsePagecount(html);
    return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
  });
}

function catUrl(tid, page) {
  page = Math.max(1, page);
  // 标签分类: tag:X -> /tag/X/ (仅第1页，翻页 410)
  if (tid.startsWith('tag:')) {
    const tag = tid.slice(4);
    return `${SITE}/tag/${encodeURIComponent(tag)}/`;
  }
  // 搜索型分类: search:REDUCING -> /search/REDUCING/[/page/N/] (支持翻页)
  if (tid.startsWith('search:')) {
    const kw = tid.slice(7);
    if (page <= 1) return `${SITE}/search/${encodeURIComponent(kw)}/`;
    return `${SITE}/search/${encodeURIComponent(kw)}/page/${page}/`;
  }
  // 题材分类: genre:Big Tits -> /category/Big%20Tits/[/page/N/]
  if (tid.startsWith('genre:')) {
    const slug = tid.slice(6);
    if (page <= 1) return `${SITE}/category/${encodeURIComponent(slug)}/`;
    return `${SITE}/category/${encodeURIComponent(slug)}/page/${page}/`;
  }
  // 系列分类: code:SNIS -> /code/SNIS/
  if (tid.startsWith('code:')) {
    const code = tid.slice(5);
    if (page <= 1) return `${SITE}/code/${encodeURIComponent(code)}/`;
    return `${SITE}/code/${encodeURIComponent(code)}/page/${page}/`;
  }
  if (page <= 1) {
    switch (tid) {
      case 'all': return SITE + '/category/all/';
      case 'censor': return SITE + '/category/censor/';
      case 'uncensor': return SITE + '/category/uncensor/';
      case 'topview': return SITE + '/topview/';
      case 'topdaily': return SITE + '/topdaily/';
      case 'topweek': return SITE + '/topweek/';
      case 'topmonth': return SITE + '/topmonth/';
      case 'latest':
      default: return SITE + '/';
    }
  }
  // 翻页
  switch (tid) {
    case 'latest': return `${SITE}/category/all/page/${page}/`;
    case 'all':
    case 'censor':
    case 'uncensor': return `${SITE}/category/${tid}/page/${page}/`;
    case 'topview':
    case 'topdaily':
    case 'topweek':
    case 'topmonth': return `${SITE}/${tid}/all/page/${page}/`;
    default: return `${SITE}/category/all/page/${page}/`;
  }
}

// 从详情页提取 YWRz 加密参数
function extractYwrz(html) {
  const defs = {};
  const re = /(YWRz\w+)\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    defs[m[1]] = m[2];
  }
  return defs;
}

// POST /ri3123o235r/ 获取 embed 播放器地址
// 关键: 必须带 X-Requested-With: XMLHttpRequest 头，否则被 tar-pit
async function fetchEmbedUrl(durl, html) {
  const defs = extractYwrz(html);
  if (!defs.YWRzNA || !defs.YWRzMQo) return '';
  const params = new URLSearchParams({
    group: defs.YWRzMg || '62',
    part: '1',
    code: defs.YWRzNA,
    code2: defs.YWRzNQ || '',
    code3: defs.YWRzNg || '',
    value: defs.YWRzMQo,
    sound: 'av',
  });
  const apiUrl = SITE + '/ri3123o235r/';
  const headers = {
    'User-Agent': UA,
    'Referer': durl,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
  };
  const body = params.toString();
  // 通道1: 框架 req
  try {
    const { data, status } = await req.post(apiUrl, body, { headers, timeout: 30000 });
    if (status === 200 && data) {
      const json = typeof data === 'string' ? JSON.parse(data) : data;
      if (json && json.status === 'success' && json.data && json.data[0]) {
        return t(json.data[0]).replace(/\\\//g, '/');
      }
    }
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(apiUrl, { method: 'POST', headers, body });
    if (r.ok) {
      const json = await r.json();
      if (json && json.status === 'success' && json.data && json.data[0]) {
        return t(json.data[0]).replace(/\\\//g, '/');
      }
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 从 embed 页 (dooplayer.com/mostplayer.com 系) 解析直链
// embed 页必须带 Sec-Fetch-Dest: iframe 头，否则返回 204
// 页内 meta: x-embed-token / x-embed-api / x-embed-et / x-embed-sig
// 调 API: POST {api}stream/{token}，头 X-Embed-Auth:1 + X-Embed-ET + X-Embed-SIG，body {"ref": "..."}
async function resolveEmbedDirect(embedUrl, referer) {
  if (!/dooplayer\.com|mostplayer\.com/i.test(embedUrl)) return '';
  const headers = {
    'User-Agent': UA,
    'Referer': referer || REFERER,
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  let html = '';
  try {
    const { data, status } = await req.get(embedUrl, { headers, timeout: 25000 });
    if (status === 200 && data) html = typeof data === 'string' ? data : String(data);
  } catch (e) { /* ignore */ }
  if (!html) {
    try {
      const r = await fetch(embedUrl, { headers });
      if (r.ok) html = await r.text();
    } catch (e) { /* ignore */ }
  }
  if (!html || html.length < 200) return '';
  const meta = (n) => {
    const m = html.match(new RegExp(`<meta[^>]+name=["']?${n}["']?[^>]*content=["']?([^"'>\\s]+)`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']?([^"'>\\s]+)["']?[^>]*name=["']?${n}["']?`, 'i'));
    return m ? m[1] : '';
  };
  const token = meta('x-embed-token');
  const api = meta('x-embed-api');
  const et = meta('x-embed-et');
  const sig = meta('x-embed-sig');
  if (!token || !api || !et || !sig) return '';
  const apiUrl = api.replace(/\/?$/, '') + '/' + token;
  const apiHeaders = {
    'User-Agent': UA,
    'Referer': embedUrl,
    'Content-Type': 'application/json',
    'X-Embed-Auth': '1',
    'X-Embed-ET': et,
    'X-Embed-SIG': sig,
  };
  const apiBody = JSON.stringify({ ref: new URL(embedUrl).origin });
  let json = null;
  try {
    const { data, status } = await req.post(apiUrl, apiBody, { headers: apiHeaders, timeout: 25000 });
    if (status === 200 && data) json = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { /* ignore */ }
  if (!json) {
    try {
      const r = await fetch(apiUrl, { method: 'POST', headers: apiHeaders, body: apiBody });
      if (r.ok) json = await r.json();
    } catch (e) { /* ignore */ }
  }
  if (json && json.ok && json.url && /^https?:\/\//.test(json.url)) {
    return json.url;
  }
  return '';
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  return { class: cls, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const res = await buildList(catUrl(tid, page), page, 25);
  // 标签页翻页 410，只保留第1页
  if (tid.startsWith('tag:')) res.pagecount = 1;
  return res;
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+|\/+$/g, '') + '/');

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  // 标题: JSON-LD name，降级用 <title>
  let name = '';
  const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldM) {
    try {
      const ld = JSON.parse(ldM[1]);
      name = t(ld.name);
    } catch (e) { /* ignore */ }
  }
  if (!name) {
    const tm = html.match(/<title>([^<]*)<\/title>/);
    if (tm) name = clean(tm[1]).replace(/\s*[-–|]\s*Watch JAV Online.*$/i, '').trim();
  }
  const slugM = durl.match(/\/([A-Za-z0-9\-_]+)\/$/);
  if (!name) name = slugM ? slugM[1] : 'JavMost';

  // 封面: JSON-LD thumbnailUrl，降级 og:image
  let pic = '';
  if (ldM) {
    try { pic = t(JSON.parse(ldM[1]).thumbnailUrl); } catch (e) { /* ignore */ }
  }
  if (!pic) {
    const pm = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (pm) pic = pm[1];
  }

  const vod = {
    vod_id: durl,
    vod_name: name,
    vod_pic: fixPic(pic),
    vod_remarks: slugM ? slugM[1] : '',
    vod_content: name,
    vod_play_from: 'JavMost',
    vod_play_url: `正片$${durl}`,
  };
  subRegister(id, vod);
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "正片$https://..." 形式，取 $ 后面的完整 URL
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+|\/+$/g, '') + '/');
  const subsP = subSearchAll(subNormKey(durl)).catch(() => []);
  // 第1步: 服务端 POST /ri3123o235r/ 拿 embed 播放器地址 (需 X-Requested-With 头)
  const html = await getHtml(durl);
  let embedUrl = '';
  if (html) {
    embedUrl = await fetchEmbedUrl(durl, html);
  }
  if (embedUrl && /^https?:\/\//.test(embedUrl)) {
    // 第2步: dooplayer/mostplayer 系 embed 页直接解析出直链 (parse:0)
    const direct = await resolveEmbedDirect(embedUrl, durl);
    if (direct) {
      const embedOrigin = new URL(embedUrl).origin;
      return subAttach({
        parse: 0,
        url: direct,
        header: {
          'User-Agent': UA,
          'Referer': embedUrl,
          'Origin': embedOrigin,
        },
      }, subsP);
    }
    // 第3步: 其他 embed 页交给 MiraPlayer 嗅探
    return subAttach({
      parse: 1,
      jx: 0,
      url: embedUrl,
      header: { 'User-Agent': UA, 'Referer': durl },
    }, subsP);
  }
  // 拿不到 embed 则降级嗅探详情页
  return subAttach({
    parse: 1,
    jx: 0,
    url: durl,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 25, total: 0, list: [] };
  let url = SITE + '/search/' + encodeURIComponent(wd) + '/';
  if (page > 1) url += 'page/' + page + '/';
  return buildList(url, page, 25);
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
