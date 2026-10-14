// 每日大赛 - CatPawOpen 格式
// 转换自 REX rex.mrds，站点 https://www.mrds66.com (WordPress)
import req from '../../util/req.js';

const KEY = 'py_mrds';
const NAME = '每日大赛';
const BASE = 'https://www.mrds66.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IMG_PROXY = 'https://bagua-img-proxy.li768435813.workers.dev/img?url=';

const CATS = [
  { type_id: 'latest', type_name: '最新更新' },
  { type_id: 'mrds', type_name: '每日大赛' },
  { type_id: 'ztds', type_name: '主题大赛' },
  { type_id: 'rstt', type_name: '热搜吃瓜' },
  { type_id: 'xazd', type_name: '校园学生' },
  { type_id: 'blyp', type_name: '必撸大赛' },
  { type_id: 'fctg', type_name: '反差泄密' },
  { type_id: 'mhds', type_name: '网红黑料' },
  { type_id: 'lqdp', type_name: '猎奇重口' },
  { type_id: 'jdsj', type_name: 'AV看片' },
  { type_id: 'mxwh', type_name: '明星大赛' },
  { type_id: 'smdh', type_name: '动漫之家' },
  { type_id: 'dypd', type_name: '影视国漫' },
  { type_id: 'mtds', type_name: 'cos写真' },
  { type_id: 'ysds', type_name: '声控ASMR' },
  { type_id: 'czds', type_name: '寸止挑战' },
  { type_id: 'hjds', type_name: '混剪PMV' },
  { type_id: 'tgds', type_name: '原创投稿' },
  { type_id: 'omjp', type_name: '欧美精品' },
  { type_id: 'qwcs', type_name: '全网参赛' },
  { type_id: 'aijc', type_name: 'AI剧场' },
];

function t(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
}

async function fetchHtml(url) {
  const { data } = await req.get(url, {
    headers: { 'User-Agent': UA, 'Referer': BASE + '/' },
    timeout: 20000,
  });
  return String(data || '');
}

function parseArticles(html) {
  const items = [];
  const seen = {};
  const re = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    const lm = /<a[^>]*href="(\/archives\/\d+\/?)"[^>]*>/.exec(block);
    if (!lm) continue;
    const link = BASE + lm[1];
    if (seen[link]) continue;
    seen[link] = 1;
    let title = '';
    const hm = /<h2 class="post-card-title"[^>]*>([\s\S]*?)<\/h2>/i.exec(block);
    if (hm) {
      const raw = hm[1];
      const cut = raw.search(/<div/i);
      title = t((cut >= 0 ? raw.slice(0, cut) : raw).replace(/<[^>]*>/g, ' '));
    }
    if (!title) continue;
    let cover = '';
    const cm = /loadBannerDirect\('([^']+)'/.exec(block);
    if (cm) cover = IMG_PROXY + encodeURIComponent(cm[1].replace(/([^:])\/{2,}/g, '$1/'));
    items.push({
      vod_id: link,
      vod_name: title,
      vod_pic: cover,
      vod_remarks: '',
    });
  }
  return items;
}

async function home() {
  return { class: CATS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || 'latest');
  const page = Math.max(1, parseInt(body.page) || 1);
  let url;
  if (id === 'latest') {
    url = page <= 1 ? BASE + '/' : BASE + '/page/' + page + '/';
  } else {
    url = page <= 1 ? BASE + '/category/' + id + '/' : BASE + '/category/' + id + '/' + page + '/';
  }
  try {
    const html = await fetchHtml(url);
    const list = parseArticles(html);
    return { page, pagecount: list.length ? page + 1 : page, list };
  } catch (e) {
    return { page, pagecount: page, list: [] };
  }
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, parseInt(body.page) || 1);
  if (!kw) return { list: [] };
  const url = page <= 1
    ? BASE + '/search/' + encodeURIComponent(kw) + '/'
    : BASE + '/search/' + encodeURIComponent(kw) + '/' + page + '/';
  try {
    const html = await fetchHtml(url);
    return { page, pagecount: page, list: parseArticles(html) };
  } catch (e) {
    return { list: [] };
  }
}

function extractVideo(html) {
  const m = /data-config=(["'])([\s\S]*?)\1/.exec(html);
  if (!m) return null;
  try {
    const cfg = JSON.parse(m[2]);
    const out = {};
    if (cfg.video && cfg.video.url) out.url = cfg.video.url;
    if (cfg.video_h265 && cfg.video_h265.url) out.h265 = cfg.video_h265.url;
    return out.url ? out : null;
  } catch (e) { return null; }
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const url = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  if (!/^https?:\/\//i.test(url)) return { list: [] };
  const html = await fetchHtml(url);
  let title = '';
  const tm = new RegExp('<meta[^>]*property="og:title"[^>]*content="([^"]*)"', 'i').exec(html);
  if (tm) title = t(tm[1]);
  const video = extractVideo(html);
  const playUrls = [];
  const playFrom = [];
  if (video && video.url) {
    playFrom.push('每日大赛');
    let urls = '原画$' + video.url;
    if (video.h265) urls += '#H265$' + video.h265;
    playUrls.push(urls);
  }
  return {
    list: [{
      vod_id: url,
      vod_name: title || '每日大赛',
      vod_pic: '',
      vod_play_from: playFrom.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  // id 可能是 "原画$http..." 或直接 URL
  const m = id.match(/\$?(https?:\/\/[^\s$#]+)/);
  const url = m ? m[1] : (/^https?:\/\//i.test(id) ? id : '');
  if (!url) return { parse: 0, url: '' };
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': BASE + '/' },
  };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
