import req from '../../util/req.js';

// JavMost (py_javmost)
// 站点: https://www.javmost.ws/ (JAV 在线站，无反爬，列表/详情直抓)
// 列表: / (最新, 25条/页, 翻页 /category/all/page/N/)
// 注意: / (最新) 与 /category/all/ (全部) 是站点本身设计的同一页面，内容完全一致，非 spider bug
// 分类: /category/{all|censor|uncensor}/[/page/N/] (25条/页)
// 热门: /topview|/topdaily|/topweek|/topmonth (25条/页, 翻页 /{slug}/all/page/N/)
// 系列: /code/{CODE}/[/page/N/] (25条/页)
// 标签: /tag/{TAG}/ (仅第1页可用，翻页 410，站点限制)
// 搜索: /search/{kw}/[/page/N/]
// 详情: /{CODE}/ 标题+封面从 JSON-LD 取
// 播放: 详情页播放器经混淆 JS 调 POST /ri3123o235r/ 动态加载，播放器地址为 AES 加密 token；
//       该接口对机房 IP tar-pit (65秒零字节)，GET 返回空，AES 密钥不在页面中，服务端无法直接取流。
//       play 走 parse:1 由 MiraPlayer 内置 WebView 在手机端执行页面 JS 后嗅探真实视频流。

const KEY = 'py_javmost';
const NAME = 'JavMost';
const SITE = 'https://www.javmost.ws';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 17 个真实分类 (2026-10-20 从站点导航与番号索引实测)
// 注意: latest(最新) 与 all(全部) 是站点本身的同一页面，内容一致
// tag:REDUCING 为"减少马赛克/无码流出"标签页 (与 tag:MOSAIC 内容完全相同，只收录其一)
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'all', type_name: '全部' },
  { type_id: 'censor', type_name: '有码' },
  { type_id: 'uncensor', type_name: '无码' },
  { type_id: 'tag:REDUCING', type_name: '无码流出' },
  { type_id: 'topview', type_name: '小时热门' },
  { type_id: 'topdaily', type_name: '日热门' },
  { type_id: 'topweek', type_name: '周热门' },
  { type_id: 'topmonth', type_name: '月热门' },
  { type_id: 'code:SNIS', type_name: 'SNIS系列' },
  { type_id: 'code:IPZ', type_name: 'IPZ系列' },
  { type_id: 'code:JUX', type_name: 'JUX系列' },
  { type_id: 'code:ABP', type_name: 'ABP系列' },
  { type_id: 'code:SSNI', type_name: 'SSNI系列' },
  { type_id: 'code:MIDE', type_name: 'MIDE系列' },
  { type_id: 'code:WANZ', type_name: 'WANZ系列' },
  { type_id: 'code:STAR', type_name: 'STAR系列' },
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
  // 标签分类: tag:REDUCING -> /tag/REDUCING/ (仅第1页，翻页 410)
  if (tid.startsWith('tag:')) {
    const tag = tid.slice(4);
    return `${SITE}/tag/${encodeURIComponent(tag)}/`;
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

async function init(reqIn) {
  return {};
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

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: fixPic(pic),
      vod_remarks: slugM ? slugM[1] : '',
      vod_content: name,
      vod_play_from: 'JavMost',
      vod_play_url: `正片$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "正片$https://..." 形式，取 $ 后面的完整 URL
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+|\/+$/g, '') + '/');
  // 站点视频源经 JS ajax 动态加载(机房 IP 被 tar-pit)，由 MiraPlayer 内置嗅探在手机端执行页面 JS 后捕获真实流
  return {
    parse: 1,
    jx: 0,
    url: durl,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
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
