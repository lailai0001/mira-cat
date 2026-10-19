import req from '../../util/req.js';

// PornSub (py_pornsub)
// 站点: https://pornsub.cc/ (亚洲字幕站，WordPress，无反爬)
// 列表: GET /?filter={latest|popular|most-viewed|longest|random}[/page/N/]
// 分类: GET /category/{slug}/[/page/N/]  (asian/vietnamese/others/vip-videos)
// 标签: GET /tag/{slug}/[/page/N/]
// 搜索: GET /?s={kw}[&paged=N]
// 详情: GET /{slug}/  提取 hotstream.top 的 mp4 直链
// 播放: mp4 直链 parse:0，带 Referer；VIP 视频只有预告片(标 VIP预告)

const KEY = 'py_pornsub';
const NAME = 'PornSub';
const SITE = 'https://pornsub.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 15 个真实分类 (2026-10-20 实测均有内容)
const CATS = [
  { type_id: 'filter:latest', type_name: '最新' },
  { type_id: 'filter:popular', type_name: '热门' },
  { type_id: 'filter:most-viewed', type_name: '最多观看' },
  { type_id: 'filter:longest', type_name: '最长' },
  { type_id: 'filter:random', type_name: '随机' },
  { type_id: 'category:asian', type_name: 'Asian' },
  { type_id: 'category:vietnamese', type_name: 'Vietnamese' },
  { type_id: 'category:others', type_name: '其他' },
  { type_id: 'category:vip-videos', type_name: 'VIP视频' },
  { type_id: 'tag:japanese', type_name: 'Japanese' },
  { type_id: 'tag:chinese', type_name: 'Chinese' },
  { type_id: 'tag:korean', type_name: 'Korean' },
  { type_id: 'tag:amateur', type_name: 'Amateur' },
  { type_id: 'tag:big-tits', type_name: 'Big Tits' },
  { type_id: 'tag:jav-subtitles', type_name: 'JAV字幕' },
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
    'Accept-Language': 'en-US,en;q=0.9',
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

// 解析列表卡片: article.thumb-block > a[href title] > img[src] + span.title + hd/vip 标记
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<article[^>]*class="[^"]*thumb-block[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const card = m[1];
    const aM = card.match(/<a\s[^>]*href="(https?:\/\/pornsub\.cc\/[^"]+\/)"[^>]*title="([^"]*)"/)
      || card.match(/<a\s[^>]*href="(https?:\/\/pornsub\.cc\/[^"]+\/)"[^>]*>/);
    if (!aM) continue;
    const durl = aM[1];
    if (seen.has(durl)) continue;
    seen.add(durl);
    const title = aM[2] ? clean(aM[2]) : '';
    const imgM = card.match(/<img[^>]+src="([^"]+)"/);
    const nameM = title || (card.match(/<span class="title">([\s\S]*?)<\/span>/) || [])[1] || '';
    const remarks = [];
    if (/class="hd-video"/.test(card)) remarks.push('HD');
    if (/class="vip-video"/.test(card) || /vip-member\.gif/.test(card)) remarks.push('VIP');
    const viewsM = card.match(/<span class="views">.*?([\d,.KM]+)\s*<\/span>/);
    out.push({
      vod_id: durl,
      vod_name: clean(nameM) || 'PornSub',
      vod_pic: imgM ? fixPic(imgM[1]) : '',
      vod_remarks: remarks.join(' ') + (viewsM ? ' ' + viewsM[1] : ''),
    });
  }
  return out;
}

function parsePagecount(html) {
  // 取分页中的最大页码
  const nums = [...html.matchAll(/\/page\/(\d+)\//g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
  if (nums.length) return Math.max(...nums);
  const nums2 = [...html.matchAll(/[?&]paged=(\d+)/g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
  if (nums2.length) return Math.max(...nums2);
  return 1;
}

function catUrl(tid, page) {
  const [kind, slug] = String(tid).split(':');
  page = Math.max(1, page);
  if (kind === 'filter') {
    // /?filter=latest  /page/2/?filter=latest
    return page > 1 ? `${SITE}/page/${page}/?filter=${encodeURIComponent(slug)}` : `${SITE}/?filter=${encodeURIComponent(slug)}`;
  }
  if (kind === 'category') {
    return page > 1 ? `${SITE}/category/${encodeURIComponent(slug)}/page/${page}/` : `${SITE}/category/${encodeURIComponent(slug)}/`;
  }
  if (kind === 'tag') {
    return page > 1 ? `${SITE}/tag/${encodeURIComponent(slug)}/page/${page}/` : `${SITE}/tag/${encodeURIComponent(slug)}/`;
  }
  return page > 1 ? `${SITE}/page/${page}/` : SITE + '/';
}

async function buildList(url, page, limit) {
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  // 首页返回最新列表的前几条
  const html = await getHtml(SITE + '/?filter=latest');
  const list = html ? parseCards(html).slice(0, 20) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'filter:latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  return buildList(catUrl(tid, page), page, 24);
}

// 从详情页提取 mp4 直链 (优先完整版，VIP 只有预告片)
function extractMp4(html) {
  const urls = [...new Set([...html.matchAll(/https?:\/\/[^"'\s]*\.mp4[^"'\s]*/g)].map(x => x[0]))];
  if (!urls.length) {
    // 兜底: 解码 player-x.php 的 q 参数
    const qm = html.match(/player-x\.php\?q=([A-Za-z0-9+/=%]+)/);
    if (qm) {
      try {
        let q = decodeURIComponent(qm[1]);
        const dec = Buffer.from(q, 'base64').toString('utf-8');
        const sm = dec.match(/https?:\/\/[^"'\s]*\.mp4[^"'\s]*/);
        if (sm) return { url: sm[0], vip: /trailer-promo/i.test(sm[0]) };
      } catch (e) { /* ignore */ }
    }
    return null;
  }
  // 优先非预告片的完整版
  const full = urls.find(u => !/trailer-promo/i.test(u));
  const pick = full || urls[0];
  return { url: pick, vip: !full };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // vod_id 为完整详情 URL
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+/, ''));

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = h1M ? clean(h1M[1]) : 'PornSub';

  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (picM) pic = fixPic(picM[1]);

  let remarks = '';
  const viewsM = html.match(/<span class="views">.*?([\d,.KM]+)\s*<\/span>/);
  if (viewsM) remarks = viewsM[1] + '观看';

  const mp4 = extractMp4(html);
  const playName = mp4 && mp4.vip ? 'VIP预告' : '正片';
  const urls = [`${playName}$${durl}`];

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_content: name,
      vod_play_from: 'PornSub',
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
  // 如果已经是 mp4 直链，直接返回
  if (/\.mp4(\?|$)/i.test(id) && /^https?:\/\//i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/' + id.replace(/^\/+/, ''));
  // 实时请求详情页解析 mp4 直链
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const mp4 = extractMp4(html);
  if (!mp4) return { parse: 0, url: '' };
  return {
    parse: 0,
    url: mp4.url,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
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
