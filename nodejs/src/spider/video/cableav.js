import req from '../../util/req.js';

// CableAV (py_cableav)
// 站点: https://cableav.video/ (WordPress + VidoRev 主题，国产AV站，无反爬)
// 列表: GET /{slug}.html[/{slug}-{N}.html]  slug: latest/guochanxinpian/guochanav/tanhadashen/wanoujiejie/rihanwuma/rihanyouma/ribenwuma
// 卡片: a.blog-img[href="/info-{id}.html" title] > img.blog-picture (封面必须取 data-src，src 是 placeholder)
// 搜索: GET /search.html?k={kw}  翻页 /search-{kw}-{N}.html
// 详情: GET /info-{id}.html  播放器 iframe /index/data/dplayer.html?video={m3u8}
// 播放: m3u8 直链 parse:0 (VOD, MEDIA-SEQUENCE:0, 有 ENDLIST)，带 UA + Referer

const KEY = 'py_cableav';
const NAME = 'CableAV';
const SITE = 'https://cableav.video';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 8 个真实分类 (2026-10-20 从首页导航与站内链接实测，均为 200 且有内容)
const CATS = [
  { type_id: 'latest', type_name: '最新发布' },
  { type_id: 'guochanxinpian', type_name: '国产新片' },
  { type_id: 'guochanav', type_name: '国产AV' },
  { type_id: 'tanhadashen', type_name: '探花大神' },
  { type_id: 'wanoujiejie', type_name: '玩偶姐姐' },
  { type_id: 'rihanwuma', type_name: '日韩无码' },
  { type_id: 'rihanyouma', type_name: '日韩有码' },
  { type_id: 'ribenwuma', type_name: '日本无码' },
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

function fixUrl(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  if (/^https?:\/\//.test(u)) return u;
  return SITE + '/' + u;
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

// 解析视频卡片: a.blog-img[href="/info-{id}.html" title="标题"] > img.blog-picture
// 注意: 站点用 lazysizes 懒加载，真实封面在 data-src，src 是 placeholder.png，必须取 data-src
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(\/info-\d+\.html)"[^>]*title="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = fixUrl(m[1]);
    if (seen.has(durl)) continue;
    seen.add(durl);
    const win = html.slice(m.index, m.index + 2000);
    let pic = '';
    const dsrcM = win.match(/<img[^>]+data-src="([^"]+)"/);
    if (dsrcM) pic = dsrcM[1];
    else {
      const srcM = win.match(/<img[^>]+src="([^"]+)"/);
      if (srcM && !srcM[1].includes('placeholder')) pic = srcM[1];
    }
    out.push({
      vod_id: durl,
      vod_name: clean(m[2]) || durl,
      vod_pic: fixUrl(pic),
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  // wp-pagenavi: "Last »" 链接给出末页，如 latest-7741.html (» 可能是字面字符或 &raquo;)
  const lastM = html.match(/href="[^"]*-(\d+)\.html"[^>]*>\s*Last/);
  if (lastM) {
    const n = parseInt(lastM[1], 10);
    if (n > 0 && n < 100000) return n;
  }
  // 兜底: 只在翻页区块内找 {slug}-{N}.html (排除 /info-{id}.html 卡片链接)
  const navM = html.match(/<div class="wp-pagenavi[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (navM) {
    const nums = [...navM[1].matchAll(/-(\d+)\.html"/g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
    if (nums.length) return Math.max(...nums);
  }
  return 1;
}

function buildList(url, page, limit) {
  limit = limit || 12;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    const pc = parsePagecount(html);
    return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
  });
}

function catUrl(tid, page) {
  const cat = CATS.find(c => c.type_id === tid) || CATS[0];
  if (page > 1) return `${SITE}/${cat.type_id}-${page}.html`;
  return `${SITE}/${cat.type_id}.html`;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(SITE + '/latest.html');
  const list = html ? parseCards(html).slice(0, 20) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  return buildList(catUrl(tid, page), page, 12);
}

// 从详情页提取 dplayer iframe 的 video 参数 (m3u8 直链)
function extractM3u8(html) {
  const m = html.match(/<iframe[^>]+src="\/index\/data\/dplayer\.html\?video=([^"]+)"/);
  if (!m) return '';
  try {
    const url = decodeURIComponent(m[1]);
    if (/^https?:\/\/[^/]+\/.*\.m3u8/.test(url)) return url;
  } catch (e) { /* ignore */ }
  // 兜底: 直接找页面中的 m3u8 链接
  const m2 = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
  return m2 ? m2[1] : '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL: https://cableav.video/info-{id}.html
  const durl = /^https?:\/\//.test(id) ? id : fixUrl('/info-' + id.replace(/\D/g, '') + '.html');

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (tm) name = clean(tm[1]);
  if (!name) {
    const om = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (om) name = clean(om[1]);
  }
  const idm = durl.match(/\/info-(\d+)\.html/);
  if (!name) name = 'CableAV ' + (idm ? idm[1] : '');

  // 详情页无独立封面 (播放器直接嵌入)，封面由列表卡片提供
  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: '',
      vod_remarks: '',
      vod_content: name,
      vod_play_from: 'CableAV',
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
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const durl = /^https?:\/\//.test(id) ? id : fixUrl('/info-' + id.replace(/\D/g, '') + '.html');
  // 实时请求详情页解析 dplayer iframe 的 video 参数 (每次实时解析)
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const m3u8 = extractM3u8(html);
  if (!m3u8) return { parse: 0, url: '' };
  return {
    parse: 0,
    url: m3u8,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  // 搜索: /search.html?k={kw}  翻页 /search-{kw}-{N}.html (kw 不编码，与站点一致)
  let url = SITE + '/search.html?k=' + encodeURIComponent(wd);
  if (page > 1) url = SITE + '/search-' + wd + '-' + page + '.html';
  return buildList(url, page, 20);
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
