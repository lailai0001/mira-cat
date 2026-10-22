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
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
