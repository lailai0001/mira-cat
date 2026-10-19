import req from '../../util/req.js';

// TubeTubeTube (py_tubetubetube)
// 站点: https://www.tubetubetube.com （JAV tube，移动版 mobile.htm，无反爬）
// 列表: GET /mobile.htm（最新，96 条/页）；翻页 /tube/{N}/
// 分类: GET /r18 /movie /porntube（翻页 /r18/{N}/ 形式，CDX 实测）
// 卡片: div.a3 > a[href="/tube/{cat}/{actress}/{vid}/{n}/"] > img[src="/tubes/.../{n}.jpg"] + p 标题
// 详情: <video src="https://cloud.tubetubetube.com/tubes/.../{n}.mp4"> 直链，parse:0
// 搜索: GET /search.php?model={kw}&type=MobileTubes
// 注意: 导航里的 pornpics/pornphoto 是图片站，已排除，只保留视频分类

const KEY = 'py_tubetubetube';
const NAME = 'TubeTubeTube';
const SITE = 'https://www.tubetubetube.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const REFERER = SITE + '/';

// 4 个真实分类（2026-10-20 从 mobile.htm 导航 div.a2 实测）
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'r18', type_name: 'r18' },
  { type_id: 'movie', type_name: 'japan XXX' },
  { type_id: 'porntube', type_name: 'porn tube' },
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
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return SITE + '/' + u;
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

// 解析列表卡片: div.a3 > a[href="/tube/.../"] > img + p标题
// 注意: 详情页 URL 含完整路径，vod_id 存完整详情 URL
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s+href="(https?:\/\/(?:www\.)?tubetubetube\.com\/tube\/[^"]+\/|\/tube\/[^"]+\/)"[^>]*>\s*<img\s+src="([^"]+)"[^>]*>\s*<p>(?:<i[^>]*><\/i>)?([^<]*)<\/p>\s*<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = fixUrl(m[1]);
    if (seen.has(durl)) continue;
    seen.add(durl);
    out.push({
      vod_id: durl,
      vod_name: clean(m[3]) || durl,
      vod_pic: fixUrl(m[2]),
      vod_remarks: '',
    });
  }
  return out;
}

// 翻页: div.a7 内 <a href="/tube/11/">11</a> 或 <a href="/r18/352">352</a> 取最大页码
function parsePagecount(html) {
  const a7 = html.match(/<div class="a7">([\s\S]*?)<\/div>/);
  const scope = a7 ? a7[1] : html;
  const pages = [...scope.matchAll(/<a[^>]+href="[^"]*\/(\d+)\/?"[^>]*>(\d+)<\/a>/g)]
    .map(x => parseInt(x[2], 10))
    .filter(n => n > 0 && n < 100000);
  return pages.length ? Math.max(...pages) : 1;
}

function buildList(url, page, limit) {
  limit = limit || 96;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    const pc = parsePagecount(html);
    return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
  });
}

function catUrl(tid, page) {
  if (tid === 'latest') {
    if (page > 1) return SITE + '/tube/' + page + '/';
    return SITE + '/mobile.htm';
  }
  // r18 / movie / porntube：翻页 {cat}/{N}/（CDX 实测 /r18/2 … /r18/352）
  const base = SITE + '/' + tid;
  if (page > 1) return base + '/' + page + '/';
  return base;
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
  return buildList(catUrl(tid, page), page, 96);
}

// 从详情页提取 <video src="...mp4"> 直链与标题
function extractVideo(html) {
  const m = html.match(/<video[^>]+src="([^"]+\.mp4[^"]*)"/i);
  return m ? m[1] : '';
}

function extractDetailTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return '';
  const full = clean(m[1]);
  // 标题形如 "Naho Hazuki 葉月奈穂 av エロ 無修正動画 ... tubetubetube ..." 取 " av エロ" 之前
  const cut = full.split(' av エロ')[0] || full.split(' tubetubetube')[0] || full;
  return cut.trim();
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL
  const durl = /^https?:\/\//i.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  const name = extractDetailTitle(html) || durl;
  let pic = '';
  const posterM = html.match(/<video[^>]+poster="([^"]+)"/i);
  if (posterM) pic = fixUrl(posterM[1]);

  const mp4 = extractVideo(html);
  const flags = mp4 ? ['MP4'] : ['TubeTubeTube'];
  const urls = [`正片$${durl}`];

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: '',
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
  const durl = /^https?:\/\//i.test(id) ? id : fixUrl(id);
  // 实时请求详情页解析 <video src>（直链可能变化，禁用缓存）
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const mp4 = extractVideo(html);
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
  if (!wd) return { page, pagecount: page, limit: 96, total: 0, list: [] };
  // 搜索表单: GET /search.php?model={kw}&type=MobileTubes（结果页结构未实测，复用卡片解析）
  let url = SITE + '/search.php?model=' + encodeURIComponent(wd) + '&type=MobileTubes';
  if (page > 1) url += '&page=' + page;
  return buildList(url, page, 96);
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
