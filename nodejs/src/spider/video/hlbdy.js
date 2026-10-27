// 黑料不打烊 - CatPawOpen JS Spider
// 入口 hlbdy1.com 本身只是跳转落地页，文章站走镜像域（线路一至四），
// 蜘蛛按顺序取首个能出文章的镜像域并缓存；镜像若轮换，改 HOSTS 即可。
// 分类：导航栏 /category/{slug}/ 链接（裸 <a>，不用 <li> 包裹也能抓）。
// 列表：<article> 块（链接 + h2 标题）；封面多路提取（z-image-loader-url、
// img data-src/src、CSS background-image、块内首个图片地址），因卡片封面
// 可能不是普通 <img> 标签。详情：/archives/{id}.html，视频在内联 JS 播放器
// 配置里（DPlayer 风格 data-config 或直链），多路提取；配置具体形式待真机验收。
import req from '../../util/req.js';

const KEY = 'py_hlbdy';
const NAME = '黑料不打烊';
const HOSTS = [
  'https://attend.oqzbuzeo.cc/',
  'https://assault.oqzbuzeo.cc/',
  'https://carrier.oqzbuzeo.cc/',
  'https://di59h5e63i08h.cloudfront.net/',
];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

// 首个能出文章的镜像域即为当前域；会话内缓存，失败则回落线路一。
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
  m = clean.match(/url\(\s*['"]?(https?:[^'")]+)['"]?\s*\)/i);
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
  // 主路：<article> 块
  const re = /<article[\s\S]{0,8000}?<\/article>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const blk = m[0];
    const links = [...blk.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/gi)].map(x => x[1]);
    const href = links.find(h => h.indexOf('/archives/') >= 0);
    if (!href) continue;
    const url = absUrl(href, host);
    if (!url || (!url.startsWith(host.replace(/\/$/, '')) && url.indexOf('/archives/') < 0)) continue;
    const hm = blk.match(/<h2[^>]*>([\s\S]{0,300}?)<\/h2>/i);
    const title = hm ? stripTags(hm[1]) : '';
    if (!title || title.length < 2) continue;
    const dm = blk.match(/(\d{4}\/\d{1,2}\/\d{1,2}|\d{4} 年 \d{1,2} 月 \d{1,2} 日)/);
    push(url, title, imgOf(blk), dm ? dm[1] : '');
    if (items.length >= 60) break;
  }
  // 兜底：无 article 块时直接扫 /archives/*.html 链接
  if (!items.length) {
    const are = /<a[^>]*href="([^"]*\/archives\/[^"]+\.html)"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
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
  const re = /<a[^>]*href="(?:https?:\/\/[^"\/]+)?\/category\/([a-z0-9]+)\/"[^>]*>([^<]{2,20})<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1], name = m[2].trim();
    if (!name || seen.has(slug)) continue;
    seen.add(slug);
    items.push({ type_id: '/category/' + slug + '/', type_name: name });
  }
  // 兜底：导航解析不足时补已确认的 5 个分类
  if (items.length < 5) {
    const fallback = [
      { type_id: '/category/24hcg/', type_name: '今日看料' },
      { type_id: '/category/mrds/', type_name: '每日大赛' },
      { type_id: '/category/rgtj/', type_name: '热门吃瓜' },
      { type_id: '/category/whhl/', type_name: '网红吃瓜' },
      { type_id: '/category/mxbg/', type_name: '明星吃瓜' },
    ];
    for (const f of fallback) {
      if (!items.some(x => x.type_id === f.type_id)) items.push(f);
    }
  }
  return items;
}

function extractVideo(html) {
  const clean = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let m = clean.match(/<video[^>]+src=["']([^"']+)["']/i);
  if (m) return m[1];
  m = clean.match(/<source[^>]+src=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  if (m) return m[1];
  // DPlayer 风格 data-config（单引号属性内为 JSON）
  m = clean.match(/data-config='([^']+)'/i) || clean.match(/data-config="([^"]+)"/i);
  if (m) {
    try {
      const cfg = JSON.parse(m[1]);
      const vu = typeof cfg?.video === 'string' ? cfg.video : (cfg?.video?.url || '');
      if (vu) return vu;
    } catch {}
  }
  // 内联 JS 配置里的 url 字段
  m = clean.match(/["']?url["']?\s*:\s*["'](https?:[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  if (m) return m[1];
  // 全文直链：优先 m3u8，其次 mp4
  const urls = [...clean.matchAll(/https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi)].map(x => x[0]);
  const m3 = urls.find(u => /\.m3u8/i.test(u));
  if (m3) return m3;
  if (urls.length) return urls[0];
  m = clean.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i);
  if (m) return m[1];
  return '';
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
    const vu = extractVideo(html);
    const hm = html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i);
    const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    list.push({
      vod_id: raw,
      vod_name: hm ? stripTags(hm[1]) : '黑料不打烊',
      vod_pic: ogm ? ogm[1] : '',
      vod_play_from: '黑料不打烊',
      vod_play_url: vu ? ('视频$' + vu) : ('未找到视频源$' + url),
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
