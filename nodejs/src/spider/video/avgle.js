import req from '../../util/req.js';

// Avgle (py_avgle)
// 站点: https://www.avgle.net (avgle.pro 被 Cloudflare 拦截无法直连，avgle.net 为同版可用镜像)
// 列表: /index.php?page=N | /popular.php?t=1d&page=N | /episodes.php?page=N (30 条/页)
// 分类: /category.php?slug={slug}&lang=zh-CN&sort=views[&page=N]
// 标签: /tag.php?slug={slug}&lang=zh-CN&sort=views[&page=N]
// 搜索: /search.php?q={kw}&lang=zh-CN[&page=N]
// 详情: /video.php?slug={slug}[&fid={fid}&ep={n}]  剧集型含多分集链接
// 播放: 详情页内联脚本提取 /video_source.php?v=&fid=&exp=&token= -> JSON {ok,url} 得 mp4 直链 (parse:0)

const KEY = 'py_avgle';
const NAME = 'Avgle';
const SITE = 'https://www.avgle.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';
const LANG = 'zh-CN';

// 真实分类 (2026-10-20 从站点实测): 3 个聚合页 + 10 个频道分类 + 15 个热门标签
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'popular', type_name: '热门' },
  { type_id: 'episodes', type_name: '剧集' },
  { type_id: 'fc2', type_name: 'FC2' },
  { type_id: 'pcolle', type_name: 'Pcolle' },
  { type_id: 'palpis', type_name: 'PALPIS' },
  { type_id: 'gcolle', type_name: 'Gcolle' },
  { type_id: 'voyvid', type_name: 'Voyvid' },
  { type_id: 'peepspot', type_name: 'Peepspot' },
  { type_id: 'adl-d', type_name: 'ADL-D' },
  { type_id: 'x-market', type_name: 'X-Market' },
  { type_id: 'uncategorized', type_name: '其他' },
  { type_id: '10genkyo', type_name: '10genkyo' },
  { type_id: 'tag:素人', type_name: '素人' },
  { type_id: 'tag:自撮り', type_name: '自拍' },
  { type_id: 'tag:オナニー', type_name: '自慰' },
  { type_id: 'tag:ハメ撮り', type_name: '情侣自拍' },
  { type_id: 'tag:流出', type_name: '流出' },
  { type_id: 'tag:個人撮影', type_name: '个人拍摄' },
  { type_id: 'tag:無修正', type_name: '无修正' },
  { type_id: 'tag:中出し', type_name: '中出' },
  { type_id: 'tag:巨乳', type_name: '巨乳' },
  { type_id: 'tag:美女', type_name: '美女' },
  { type_id: 'tag:人妻', type_name: '人妻' },
  { type_id: 'tag:制服', type_name: '制服' },
  { type_id: 'tag:女子大生', type_name: '女大学生' },
  { type_id: 'tag:アイドル', type_name: '偶像' },
  { type_id: 'tag:ライブチャット', type_name: '直播' },
];

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

function fixUrl(u) {
  u = clean(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return SITE + u;
  return SITE + '/' + u;
}

// 双通道: 先框架 req，失败再原生 fetch
async function getHtml(url, headers) {
  const h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Referer': REFERER,
    ...(headers || {}),
  };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { headers: h });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 播放源接口 (JSON)
async function getSourceJson(url, referer) {
  const h = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': referer || REFERER,
  };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: 25000 });
    if (status === 200 && data) {
      const j = typeof data === 'string' ? JSON.parse(data) : data;
      if (j && j.url) return j;
    }
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { headers: h });
    if (r.ok) {
      const j = await r.json();
      if (j && j.url) return j;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// 解析列表卡片: a.card[href="/video.php?slug=..."] > img[src] + h3 + span.duration
// 注意: 详情页 URL 必须带 slug，故 vod_id 存完整详情 URL
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*class="card"[^>]*href="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = fixUrl(m[1]);
    if (!durl || seen.has(durl)) continue;
    seen.add(durl);
    const win = html.slice(m.index, m.index + 1500);
    const imgM = win.match(/<img[^>]+src="([^"]+)"/);
    const h3M = win.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const durM = win.match(/<span class="duration">([^<]*)<\/span>/);
    const altM = win.match(/<img[^>]+alt="([^"]*)"/);
    const name = h3M ? clean(h3M[1]) : (altM ? clean(altM[1]) : 'Avgle');
    out.push({
      vod_id: durl,
      vod_name: name,
      vod_pic: imgM ? fixPic(imgM[1]) : '',
      vod_remarks: durM ? clean(durM[1]) : '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const nums = [...html.matchAll(/[?&]page=(\d+)/g)].map(x => parseInt(x[1], 10)).filter(n => n > 1 && n < 100000);
  return nums.length ? Math.max(...nums) : 1;
}

function catUrl(tid, page) {
  page = Math.max(1, page);
  const pg = page > 1 ? `&page=${page}` : '';
  if (tid === 'latest') return `${SITE}/index.php?page=${page}&lang=${LANG}`;
  if (tid === 'popular') return `${SITE}/popular.php?t=1d${pg}&lang=${LANG}`;
  if (tid === 'episodes') return `${SITE}/episodes.php?${page > 1 ? `page=${page}&` : ''}lang=${LANG}`;
  if (tid.startsWith('tag:')) {
    const slug = encodeURIComponent(tid.slice(4));
    return `${SITE}/tag.php?slug=${slug}&lang=${LANG}&sort=views${pg}`;
  }
  // 频道分类
  return `${SITE}/category.php?slug=${encodeURIComponent(tid)}&lang=${LANG}&sort=views${pg}`;
}

function buildList(url, page, limit) {
  limit = limit || 30;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    const pc = parsePagecount(html);
    return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
  });
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(catUrl('latest', 1));
  const list = parseCards(html).slice(0, 20);
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const known = CATS.some(c => c.type_id === tid);
  return buildList(catUrl(known ? tid : 'latest', page), page, 30);
}

// 从详情页提取 video_source.php 端点
function extractSourceEndpoint(html) {
  const m = html.match(/video_source\.php\?[^"'\s<>]+/);
  if (!m) return '';
  let ep = clean(m[0]);
  const q = ep.indexOf('?');
  if (q < 0) return '';
  return SITE + '/video_source.php?' + ep.slice(q + 1);
}

// 提取剧集分集链接: a[href*="ep="]文本
function extractEpisodes(html) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]*href="([^"]*ep=\d+[^"]*)"[^>]*>([^<>]*)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null && out.length < 500) {
    const u = fixUrl(m[1]);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const label = clean(m[2]) || `分集${out.length + 1}`;
    out.push(`${label}$${u}`);
  }
  return out;
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL (必须带 slug)
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//i.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  // 标题/简介/封面 (优先 JSON-LD)
  let name = '';
  let content = '';
  let pic = '';
  const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldM) {
    try {
      const ld = JSON.parse(ldM[1]);
      name = t(ld.name);
      content = t(ld.description);
      pic = fixPic(ld.thumbnailUrl);
    } catch (e) { /* ignore */ }
  }
  if (!name) {
    const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    name = h1M ? clean(h1M[1]) : 'Avgle';
  }
  if (!pic) {
    const ogM = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogM) pic = fixPic(ogM[1]);
  }

  // 剧集型详情页 -> 多分集；普通视频 -> 单集
  const eps = extractEpisodes(html);
  const playUrl = eps.length > 0 ? eps.join('$$$') : `正片$${durl}`;

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: content || name,
      vod_play_from: 'Avgle',
      vod_play_url: playUrl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "名称$https://..." 形式，取 $ 后面的完整 URL
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//i.test(id) ? id : fixUrl(id);

  // 实时请求详情页拿 video_source 端点 (exp/token 时效性强，禁用缓存)
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const ep = extractSourceEndpoint(html);
  if (!ep) return { parse: 0, url: '' };

  const js = await getSourceJson(ep, durl);
  if (!js || !js.url) return { parse: 0, url: '' };
  return {
    parse: 0,
    url: js.url,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  let url = `${SITE}/search.php?q=${encodeURIComponent(wd)}&lang=${LANG}`;
  if (page > 1) url += `&page=${page}`;
  return buildList(url, page, 30);
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
