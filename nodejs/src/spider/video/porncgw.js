// porn吃瓜网 (https://porncgw.com) -> CatPawOpen spider
// 列表为 SSR 卡片 (article.card + a.card-link + img data-src);
// 详情页 SSR JSON 内嵌已签名 videoSrc (yd-hls.hzjvlo.cn 的 m3u8, 分片/密钥均为带签名绝对地址), play 抓一次详情页直返;
// 短剧 /drama/{id}/ 为简介+分集列表, 分集页 /drama/{id}/{n}/ 同样内嵌 videoSrc;
// 封面 pic.drleao.cn 为 AES-128-CBC 加密图 (与 AvHub/818 同 key), 必须走 bagua-img-proxy Worker 解密出图。
import req from '../../util/req.js';

const KEY = 'py_porncgw';
const NAME = 'porn吃瓜网';
const HOST = 'https://porncgw.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const IMG_PROXY = 'https://bagua-img-proxy.li768435813.workers.dev/img?url=';
const TIMEOUT = 15000;

// 站内导航 21 个分类 (路径已逐个复核); /archives/ 为图文文章不收。
// 最新更新 = 首页: 站点根路径无服务端分页 (/2/、/page/2/、?page=2 均 404), 只出第一页。
const CATS = [
  { type_id: 'latest', type_name: '最新更新', path: '/' },
  { type_id: 'list', type_name: '短视频', path: '/list/' },
  { type_id: 'long-video', type_name: '长视频', path: '/long-video/' },
  { type_id: 'today', type_name: '今日吃瓜', path: '/today/' },
  { type_id: 'recommend', type_name: '推荐吃瓜', path: '/recommend/' },
  { type_id: 'hot-cgbd', type_name: '吃瓜榜单', path: '/hot/cgbd/' },
  { type_id: 'hot-whhl', type_name: '网红黑料', path: '/hot/whhl/' },
  { type_id: 'hot-snsf', type_name: '熟女少妇', path: '/hot/snsf/' },
  { type_id: 'hot-xsxy', type_name: '学生校园', path: '/hot/xsxy/' },
  { type_id: 'ent-cgtq', type_name: '出轨偷情', path: '/entertainment/cgtq/' },
  { type_id: 'ent-zplc', type_name: '自拍流出', path: '/entertainment/zplc/' },
  { type_id: 'door-jiudian', type_name: '酒店', path: '/door/jiudian/' },
  { type_id: 'door-chezhen', type_name: '车震', path: '/door/chezhen/' },
  { type_id: 'shrd-ylbg', type_name: '娱乐八卦', path: '/shrd/ylbg/' },
  { type_id: 'shrd-wybl', type_name: '网友爆料', path: '/shrd/wybl/' },
  { type_id: 'ntxl', type_name: '女同系列', path: '/ntxl/' },
  { type_id: 'omxl', type_name: '欧美系列', path: '/omxl/' },
  { type_id: 'jqyy', type_name: '剧情演绎', path: '/jqyy/' },
  { type_id: 'yzcm', type_name: '亚洲传媒', path: '/yzcm/' },
  { type_id: 'ai-aidj', type_name: 'AI短剧', path: '/ai/aidj/' },
  { type_id: 'ai-aimj', type_name: 'AI漫剧', path: '/ai/AImj/' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function decodeHtml(s) {
  return t(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function headers(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': referer || HOST + '/',
  };
}

// 取页面: 框架 req 优先, fetch 兜底; 返回 { html, finalUrl } (搜索 301 跳 tag 页要读最终地址)
async function fetchPage(url, referer) {
  try {
    const res = await req.get(url, { headers: headers(referer), timeout: TIMEOUT });
    const html = String(res?.data || '');
    if (html) {
      const finalUrl = res?.request?.res?.responseUrl || url;
      return { html, finalUrl };
    }
  } catch (e) { /* 换 fetch 兜底 */ }
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(url, { headers: headers(referer), signal: ctl.signal });
      if (r.ok) return { html: await r.text(), finalUrl: r.url || url };
    } finally {
      clearTimeout(to);
    }
  } catch (e) { /* ignore */ }
  return { html: '', finalUrl: url };
}

async function getHtml(url, referer) {
  const { html } = await fetchPage(url, referer);
  return html;
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return HOST + u;
  return HOST + '/' + u;
}

// 封面统一走 Worker 解密 (pic.drleao.cn 加密图, App 图片加载拼不出本地代理)
function proxyCover(imgUrl) {
  imgUrl = absUrl(decodeHtml(imgUrl));
  if (!imgUrl) return '';
  if (imgUrl.indexOf('bagua-img-proxy') >= 0) return imgUrl;
  return IMG_PROXY + encodeURIComponent(imgUrl);
}

// og:image 在 expose.eisees.com (返回 0 字节不可用): 同路径换到 pic.drleao.cn 再走 Worker
function fallbackCover(ogImage) {
  const u = absUrl(decodeHtml(ogImage));
  if (!u) return '';
  try {
    const parsed = new URL(u);
    if (/eisees\.com$/i.test(parsed.hostname)) {
      return proxyCover('https://pic.drleao.cn' + parsed.pathname);
    }
  } catch (e) { /* ignore */ }
  return proxyCover(u);
}

// 解析列表卡片: article.card 内含 data-title/data-views/data-time 与 a.card-link、img data-src
function parseCards(html) {
  const out = [];
  const seen = new Set();
  if (!html) return out;
  const re = /<article[^>]*class="card video-card"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const end = html.indexOf('</article>', m.index);
    const body = end > m.index ? html.slice(m.index, end) : html.slice(m.index, m.index + 3000);
    const hrefM = body.match(/<a[^>]*class="card-link"[^>]*href="([^"]+)"/i) || body.match(/href="(\/(?:video|drama)\/\d+\/)"/i);
    if (!hrefM) continue;
    const path = hrefM[1];
    if (seen.has(path)) continue;
    const imgM = body.match(/<img[^>]*data-src="([^"]+)"/i);
    if (!imgM) continue;
    seen.add(path);
    const titleM = tag.match(/data-title="([^"]*)"/);
    const timeM = tag.match(/data-time="([^"]*)"/);
    const viewsM = tag.match(/data-views="([^"]*)"/);
    let name = titleM ? decodeHtml(titleM[1]) : '';
    if (!name) {
      const altM = body.match(/<img[^>]*alt="([^"]+)"/i);
      if (altM) name = decodeHtml(altM[1]).replace(/视频封面$/, '');
    }
    const time = timeM ? t(timeM[1]) : '';
    const views = viewsM ? t(viewsM[1]) : '';
    out.push({
      vod_id: path,
      vod_name: name || path,
      vod_pic: proxyCover(imgM[1]),
      vod_remarks: time || (views && views !== '0' ? views + '播放' : ''),
    });
  }
  return out;
}

// 分页摘要: 共 <strong>814</strong> 条 · 第 <strong>2/41</strong> 页
function parsePager(html) {
  if (!html) return null;
  const m = html.match(/共\s*<strong>(\d+)<\/strong>\s*条[\s\S]{0,40}?第\s*<strong>\d+\/(\d+)<\/strong>\s*页/);
  if (!m) return null;
  return { total: parseInt(m[1], 10) || 0, pagecount: parseInt(m[2], 10) || 1 };
}

async function buildList(url, page, singlePage) {
  const { html } = await fetchPage(url);
  const list = parseCards(html);
  if (singlePage) {
    return { page, pagecount: 1, limit: list.length || 20, total: list.length, list };
  }
  const pager = parsePager(html);
  return {
    page,
    pagecount: pager ? pager.pagecount : (list.length >= 20 ? page + 1 : page),
    limit: list.length || 20,
    total: pager ? pager.total : list.length,
    list,
  };
}

function catOf(tid) {
  return CATS.find(c => c.type_id === tid) || CATS[0];
}

function catUrl(cat, page) {
  if (cat.type_id === 'latest' || page <= 1) return HOST + cat.path;
  return HOST + cat.path + page + '/';
}

// 取详情页 SSR JSON 里的字符串字段 (处理 \uXXXX 等转义)
function jsonStr(html, key) {
  const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
  if (!m) return '';
  return m[1]
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function ogContent(html, prop) {
  const m = html.match(new RegExp('property="' + prop + '"[^>]*content="([^"]*)"', 'i'))
    || html.match(new RegExp('content="([^"]*)"[^>]*property="' + prop + '"', 'i'));
  return m ? decodeHtml(m[1]) : '';
}

// 详情封面: 优先页面 JSON 的 posterSrc, 缺失时用 og:image 同路径换 pic.drleao.cn
function detailCover(html) {
  const poster = jsonStr(html, 'posterSrc');
  if (poster) return proxyCover(poster);
  const og = ogContent(html, 'og:image');
  if (og) return fallbackCover(og);
  return '';
}

function cleanName(raw, fallback) {
  const name = decodeHtml(raw || '').replace(/\s*-\s*porn吃瓜网\s*$/, '').trim();
  return name || fallback || '';
}

async function init() {
  return {};
}

async function home() {
  const { html } = await fetchPage(HOST + '/');
  return {
    class: CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    filters: {},
    list: parseCards(html),
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = catOf(t(body.id || body.tid) || 'latest');
  return buildList(catUrl(cat, page), page, cat.type_id === 'latest');
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const raw = Array.isArray(body.id) ? body.id[0] : body.id;
  let path = t(raw);
  const idm = path.match(/\/(video|drama)\/\d+(?:\/\d+)?\//);
  if (idm) path = idm[0];
  if (!/^\/(video|drama)\/\d+\/$/.test(path)) {
    // 短剧分集 id 归一到短剧主页
    const dm = path.match(/^\/drama\/(\d+)\/\d+\/$/);
    if (dm) path = '/drama/' + dm[1] + '/';
    else return { list: [] };
  }
  const pageUrl = HOST + path;
  const html = await getHtml(pageUrl);
  if (!html) return { list: [] };

  const name = cleanName(jsonStr(html, 'title') || ogContent(html, 'og:title'), path);
  const content = ogContent(html, 'og:description');
  const pic = detailCover(html);

  let playUrl;
  if (path.indexOf('/drama/') === 0) {
    const id = path.match(/\/drama\/(\d+)\//)[1];
    const nums = new Set();
    const re = new RegExp('href="/drama/' + id + '/(\\d+)/"', 'g');
    let m;
    while ((m = re.exec(html)) !== null) nums.add(parseInt(m[1], 10));
    const eps = [...nums].sort((a, b) => a - b);
    if (!eps.length) eps.push(1);
    playUrl = eps.map(n => `第${n}集$/drama/${id}/${n}/`).join('#');
  } else {
    playUrl = '正片$' + path;
  }

  return {
    list: [{
      vod_id: path,
      vod_name: name,
      vod_pic: pic,
      vod_content: content,
      vod_play_from: NAME,
      vod_play_url: playUrl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  const path = id.match(/\/(video|drama)\/\d+(?:\/\d+)?\//)?.[0] || id;
  if (!path || path.charAt(0) !== '/') return { parse: 0, url: '' };
  const pageUrl = HOST + path;
  const html = await getHtml(pageUrl, HOST + '/');
  const src = jsonStr(html, 'videoSrc') || jsonStr(html, 'videoSrcHevc');
  if (src && /^https?:\/\//i.test(src)) {
    return { parse: 0, url: src, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  // 兜底: 交嗅探打开页面本身
  return { parse: 1, url: pageUrl, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
}

// 搜索常 301 跳到 /tag/{slug}/ 页: 记住跳转目标, 翻页直接拼 tag 路径
const searchBaseCache = new Map();

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };

  const cached = searchBaseCache.get(wd);
  if (page > 1 && cached) {
    return buildList(HOST + cached + page + '/', page, false);
  }
  const { html, finalUrl } = await fetchPage(HOST + '/search/' + encodeURIComponent(wd) + '/');
  const list = parseCards(html);
  // 记录跳转后的 tag 路径 (含从分页链接反推)
  let base = '';
  try {
    const p = new URL(finalUrl).pathname;
    if (/^\/tag\/[^/]+\/$/.test(p)) base = p;
  } catch (e) { /* ignore */ }
  if (!base) {
    const pm = html.match(/href="(\/tag\/[^/]+\/)\d+\/"/);
    if (pm) base = pm[1];
  }
  if (base) searchBaseCache.set(wd, base);
  const pager = parsePager(html);
  if (page > 1 && base) {
    return buildList(HOST + base + page + '/', page, false);
  }
  return {
    page,
    pagecount: pager ? pager.pagecount : (list.length >= 20 ? page + 1 : page),
    limit: list.length || 20,
    total: pager ? pager.total : list.length,
    list,
  };
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
