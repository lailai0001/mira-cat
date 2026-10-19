import req from '../../util/req.js';

// KissJAV (py_kissjav)
// 站点: https://kissjav.li/ (JAV/韩流/IPCAM 站，无反爬)
// 列表: GET /latest-updates/[/N/]  30 条/页
// 分类: GET /categories/{slug}/[/N/]  30 条/页
// 热门: GET /most-popular/?sort_by=video_viewed  (分页 ?page=N 形式，未实测)
// 搜索: GET /search/{kw}/[/N/]  20 条/页
// 详情: GET /video/{id}/{slug}/  解析 video_url Base64 -> mp4 直链
// 播放: get_file mp4 直链，parse:0，带 Referer

const KEY = 'py_kissjav';
const NAME = 'KissJAV';
const SITE = 'https://kissjav.li';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 12 个真实分类 (2026-10-19 从首页导航实测)
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'popular', type_name: '热门' },
  { type_id: 'vip', type_name: 'KVIP' },
  { type_id: 'jvip', type_name: 'JVIP' },
  { type_id: 'korean-porn', type_name: 'Korean Porn' },
  { type_id: 'korean-bj', type_name: 'Korean BJ' },
  { type_id: 'fc2ppv', type_name: 'FC2PPV' },
  { type_id: 'jav', type_name: 'Uncensored' },
  { type_id: 'myfans', type_name: 'MyFans' },
  { type_id: 'ipcam', type_name: 'IPCAM' },
  { type_id: 'toilet', type_name: 'Toilet' },
  { type_id: 'voyeur-jp', type_name: 'VoyeurJP' },
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

// 双通道: 先框架 req，失败再原生 fetch
async function getHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
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

// 解析列表卡片: div.thumb > a[href="/video/{id}/{slug}/" title] > div.img-holder > img[data-original]
// 注意: 详情页 URL 必须带 slug (无 slug 返回 404)，故 vod_id 存完整详情 URL
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(https?:\/\/kissjav\.li\/video\/\d+\/[^"]*\/)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = m[1];
    const idm = durl.match(/\/video\/(\d+)\//);
    const vid = idm ? idm[1] : durl;
    if (seen.has(vid)) continue;
    seen.add(vid);
    const win = html.slice(m.index, m.index + 1500);
    let titleM = m[0].match(/title="([^"]*)"/);
    if (!titleM) titleM = win.match(/title="([^"]*)"/);
    const imgM = win.match(/data-original="([^"]+)"/) || win.match(/<img[^>]+src="([^"]+)"/);
    out.push({
      vod_id: durl,
      vod_name: titleM ? clean(titleM[1]) : 'KissJAV ' + vid,
      vod_pic: imgM ? fixPic(imgM[1]) : '',
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const pages = [...html.matchAll(/\/(\d+)\/"[^>]*>(\d+)<\/a>/g)].map(x => parseInt(x[2], 10));
  const nums = pages.filter(n => n > 0 && n < 100000);
  return nums.length ? Math.max(...nums) : 1;
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

function catUrl(tid, page) {
  let base;
  if (tid === 'latest') base = SITE + '/latest-updates/';
  else if (tid === 'popular') base = SITE + '/most-popular/?sort_by=video_viewed';
  else base = SITE + '/categories/' + encodeURIComponent(tid) + '/';
  if (page > 1) {
    if (tid === 'popular') return base + '&page=' + page;
    return base + page + '/';
  }
  return base;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  return { class: cls, list: [] };
}

async function homeVod(reqIn) {
  const html = await getHtml(SITE + '/latest-updates/');
  return { list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  return buildList(catUrl(tid, page), page, 30);
}

// 从详情页提取 video_url Base64 并解码
function extractMp4(html) {
  const m = html.match(/video_url:\s*'([A-Za-z0-9+/=]+)'/);
  if (!m) return '';
  try {
    const dec = Buffer.from(m[1], 'base64').toString('utf-8');
    if (/^https?:\/\//.test(dec)) return dec;
  } catch (e) { /* ignore */ }
  return '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL (必须带 slug)
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/\D/g, '') + '/');
  const vidm = durl.match(/\/video\/(\d+)\//);
  const vid = vidm ? vidm[1] : id;

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = titleM ? clean(titleM[1]) : 'KissJAV ' + vid;

  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (picM) pic = fixPic(picM[1]);

  let remarks = '';
  const durM = html.match(/itemprop="duration"[^>]*content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
  if (durM) {
    const h = durM[1] ? parseInt(durM[1], 10) : 0;
    const mi = durM[2] ? parseInt(durM[2], 10) : 0;
    const se = durM[3] ? parseInt(durM[3], 10) : 0;
    remarks = h ? `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}` : `${mi}:${String(se).padStart(2, '0')}`;
  }

  const mp4 = extractMp4(html);
  const flags = mp4 ? ['MP4'] : ['KissJAV'];
  const urls = [`${remarks || '正片'}$${durl}`];

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_content: name,
      vod_play_from: flags.join('$$$'),
      vod_play_url: urls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "正片$https://..." 形式，取 $ 后面的完整 URL
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/\D/g, '') + '/');
  // 实时请求详情页解析 Base64 (token 可能变化，禁用缓存)
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const mp4 = extractMp4(html);
  if (!mp4) return { parse: 0, url: '' };
  return {
    parse: 0,
    url: mp4,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  let url = SITE + '/search/' + encodeURIComponent(wd) + '/';
  if (page > 1) url += page + '/';
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
