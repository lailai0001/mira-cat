// 51视频 - CatPawOpen JS Spider
// 用户给的 https://dcddazel.cc 只是线路落地页：首页只有线路按钮，
// 真内容在通配线路域与主站；蜘蛛直接走内容站，落地页不作 HOST。
// 内容站（同站同构，任一能出文章即可）：主站 51sptv.com、
// Cloudflare 线 ds0iykn0hitas.cloudfront.net、通配域 *.punwbiin.cc。
// 结构：Typecho Mirages，与黑料不打烊同构：
// 列表 <article> 块（链接 + h2 标题 + z-image-loader-url 封面）；
// 分类 /category/{slug}/，分页 /category/{slug}/{n}/；
// 详情 /archives/{id}/，视频在内联 data-config 的 video.url 里（m3u8 直链，
// 带 auth_key），一篇可含多段，按 data-config 顺序列为第1段、第2段……；
// 搜索 /search/{kw}/，分页 /search/{kw}/{n}/。
// 封面：pic.*.cn 图床为加密密文存储，直取不是合法图片，故走 51chigua
// 解密代理（与 51吃瓜、黑料不打烊四轮同法，已实测可解密多家 pic host）。
import req from '../../util/req.js';

const KEY = 'py_51shipin';
const NAME = '51视频';
const HOSTS = [
  'https://51sptv.com/',
  'https://ds0iykn0hitas.cloudfront.net/',
  'https://apple.punwbiin.cc/',
];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IMG_PROXY = 'https://51chigua.li768435813.workers.dev/img?url=';

function proxyCover(url) {
  url = String(url || '').trim();
  if (!url) return '';
  if (url.indexOf('51chigua.li768435813.workers.dev') >= 0) return url;
  if (/pic\.[a-z0-9]+\.cn/i.test(url)) return IMG_PROXY + encodeURIComponent(url);
  return url;
}

let ACTIVE_HOST = '';

function H(host) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': host,
  };
}

async function getText(url, host) {
  try {
    const { data } = await req.get(url, { headers: H(host), timeout: 15000 });
    return String(data || '');
  } catch { return ''; }
}

async function pickHost() {
  if (ACTIVE_HOST) return ACTIVE_HOST;
  for (const h of HOSTS) {
    const html = await getText(h, h);
    if (html && html.indexOf('/archives/') >= 0) { ACTIVE_HOST = h; return h; }
  }
  ACTIVE_HOST = HOSTS[0];
  return ACTIVE_HOST;
}

function absUrl(href, host) {
  href = String(href || '').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return host.replace(/\/$/, '') + href;
  return host.replace(/\/$/, '') + '/' + href;
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function imgOf(block) {
  const clean = block.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let m = clean.match(/z-image-loader-url\s*=\s*"([^"]+)"/i);
  if (m && /^https?:\/\//i.test(m[1])) return m[1];
  m = clean.match(/<img[^>]*>/gi);
  if (m) {
    for (const tag of m) {
      const sm = tag.match(/(?:data-src|data-original|src)\s*=\s*"([^"]+)"/i);
      if (sm && /^https?:\/\//i.test(sm[1]) && !/data:image/i.test(sm[1])) return sm[1];
    }
  }
  m = clean.match(/background-image\s*:\s*url\(\s*['"]?(https?:[^'")]+)['"]?\s*\)/i);
  if (m) return m[1];
  m = clean.match(/https?:\/\/[^"'\s)]+\.(?:jpg|png|jpeg|webp)/i);
  if (m) return m[0];
  return '';
}

function parseArticles(html, host) {
  const items = [];
  const seen = new Set();
  const push = (href, title, pic, remarks) => {
    if (!href || !title || seen.has(href)) return;
    seen.add(href);
    items.push({ vod_id: href, vod_name: title, vod_pic: pic || '', vod_remarks: remarks || '' });
  };
  const re = /<article[\s\S]{0,8000}?<\/article>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const blk = m[0];
    const links = [...blk.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/gi)].map(x => x[1]);
    const href = links.find(h => h.indexOf('/archives/') >= 0);
    if (!href) continue;
    const url = absUrl(href, host);
    const hm = blk.match(/<h2[^>]*>([\s\S]{0,300}?)<\/h2>/i);
    const title = hm ? stripTags(hm[1]) : '';
    if (!title || title.length < 2) continue;
    const dm = blk.match(/(\d{4}\/\d{1,2}\/\d{1,2}|\d{4} 年 \d{1,2} 月 \d{1,2} 日)/);
    push(url, title, proxyCover(imgOf(blk)), dm ? dm[1] : '');
    if (items.length >= 60) break;
  }
  if (!items.length) {
    const are = /<a[^>]*href="([^"]*\/archives\/[^"]+\/?)"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
    while ((m = are.exec(html)) !== null) {
      const url = absUrl(m[1], host);
      const title = stripTags(m[2]);
      if (!url || !title || title.length < 2) continue;
      push(url, title, '', '');
      if (items.length >= 60) break;
    }
  }
  return items;
}

function parseCategories(html) {
  const items = [];
  const seen = new Set();
  // 导航分类链接：slug 可含字母数字与连字符（如 western-videos）
  const re = /<a[^>]*href="(?:https?:\/\/[^"\/]+)?\/category\/([a-z0-9\-]+)\/"[^>]*>([^<]{2,20})<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1], name = m[2].trim();
    if (!name || seen.has(slug)) continue;
    seen.add(slug);
    items.push({ type_id: '/category/' + slug + '/', type_name: name });
  }
  // 兜底：2026-10-28 首页实测的 19 个分类
  if (items.length < 5) {
    const fallback = [
      { type_id: '/category/wpcz/', type_name: '今日推荐' },
      { type_id: '/category/lpjp/', type_name: '撸片精品' },
      { type_id: '/category/meiridasai/', type_name: '每日大赛' },
      { type_id: '/category/rdsj/', type_name: '吃瓜爆料' },
      { type_id: '/category/aisj/', type_name: 'AI短剧' },
      { type_id: '/category/pmv/', type_name: 'PMV混剪' },
      { type_id: '/category/51yc/', type_name: '51原创' },
      { type_id: '/category/tynd/', type_name: '体育男大' },
      { type_id: '/category/xsxy/', type_name: '学生校园' },
      { type_id: '/category/lljx/', type_name: '伦理精选' },
      { type_id: '/category/smtt/', type_name: '色漫天堂' },
      { type_id: '/category/whhl/', type_name: '网红黑料' },
      { type_id: '/category/ysyl/', type_name: '看片娱乐' },
      { type_id: '/category/cqdb/', type_name: '超前点播' },
      { type_id: '/category/qubk/', type_name: '奇趣百科' },
      { type_id: '/category/dyds/', type_name: '短剧影视' },
      { type_id: '/category/whhj/', type_name: '网黄合集' },
      { type_id: '/category/mxhl/', type_name: '明星黑料' },
      { type_id: '/category/jpav/', type_name: '精品AV' },
    ];
    for (const f of fallback) {
      if (!items.some(x => x.type_id === f.type_id)) items.push(f);
    }
  }
  return items;
}

// 详情：按 data-config 顺序取 video.url；广告位 m3u8 不在 data-config 里，不会混入。
function extractVideos(html) {
  const clean = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\\//g, '/');
  const urls = [];
  const seen = new Set();
  const re = /data-config='([^']+)'/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    try {
      const cfg = JSON.parse(m[1]);
      const vu = typeof cfg?.video === 'string' ? cfg.video : (cfg?.video?.url || '');
      if (vu && /^https?:\/\//i.test(vu) && !seen.has(vu)) { seen.add(vu); urls.push(vu); }
    } catch {}
  }
  if (!urls.length) {
    const all = [...clean.matchAll(/https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi)].map(x => x[0]);
    for (const u of all) {
      if (/\/m3m\//i.test(u)) continue; // 广告位
      if (!seen.has(u)) { seen.add(u); urls.push(u); }
    }
  }
  return urls;
}

async function init() { return {}; }

async function home() {
  const host = await pickHost();
  const html = await getText(host, host);
  return { class: parseCategories(html), filters: {}, list: parseArticles(html, host) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const host = await pickHost();
  let tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let base;
  if (/^https?:\/\//i.test(tid)) base = tid.replace(/\/+$/, '');
  else base = (host.replace(/\/$/, '') + '/' + tid.replace(/^\/+/, '')).replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/' + page + '/');
  const html = await getText(url, host);
  const videos = parseArticles(html, host);
  return {
    page, pagecount: 9999, limit: 90,
    total: videos.length ? 999999 : 0,
    list: videos,
  };
}

async function detail(reqIn) {
  const host = await pickHost();
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : host.replace(/\/$/, '') + (String(raw).startsWith('/') ? raw : '/' + raw);
    const html = await getText(url, host);
    const urls = extractVideos(html);
    const hm = html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i);
    const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    // 详情封面：og:image 常为站方默认图，优先取首个 data-config 的 poster
    let pic = ogm ? ogm[1] : '';
    const pm = html.match(/data-config='[^']*"poster":"([^"]+)"/i);
    if (pm) pic = pm[1].replace(/\\\//g, '/');
    list.push({
      vod_id: raw,
      vod_name: hm ? stripTags(hm[1]) : '51视频',
      vod_pic: proxyCover(pic),
      vod_play_from: '51视频',
      vod_play_url: urls.length
        ? urls.map((u, i) => `第${i + 1}段$${u}`).join('#')
        : ('未找到视频源$' + url),
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  return {
    parse: isVideo ? 0 : 1,
    url: id,
    header: H(ACTIVE_HOST || HOSTS[0]),
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const host = await pickHost();
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const base = host + 'search/' + encodeURIComponent(wd);
  const url = page === 1 ? (base + '/') : (base + '/' + page + '/');
  const html = await getText(url, host);
  const list = parseArticles(html, host);
  return { page, pagecount: 9999, limit: 90, total: list.length, list };
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
