// 818黑料网 - CatPawOpen JS Spider
// Ported from 818___.py.py (HOST=https://cell.lacdfsq.cc/)
import req from '../../util/req.js';

const KEY = 'py_818hl';
const NAME = '818黑料网';
const HOST = 'https://818hlw1.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// 封面为 AES-128-CBC 加密存储（key f5d965df75336270 / iv 97b60394abc2fbe1），走解密代理出图
// 2026-10-28 四轮：cell 域每次 301 到随机 jvtshrap.cc 子域，设备端加载不出内容；
// 改走站方自报永久地址 818hlw1.com（实测直出 30 篇、无跳转）；分类仍取所有 /category/ 链接；
// 2026-10-29 封面根因：站方封面已全迁 pic.nihmcl.cn，原图仍为加密密文；旧代码全走 bagua 代理，
// 但 bagua 对 nihmcl 域回 400 Invalid URL，封面全灭。已改按域路由：pic.*.cn 走 51chigua（实测出图），其余走 bagua。
// /latest/ 与 /hot/ 已证实为站内 404 样式页，不再作 fallback；详情视频多路提取
// （data-config、内联 JS url、全文 m3u8/mp4、og:video），因播放器配置形式未在
// 原始 HTML 里验到。
// 封面代理按域路由（2026-10-29 实测，见下）：两站封面已全迁 pic.nihmcl.cn；
// bagua 代理对该域回 400 Invalid URL（png/jpeg/gif 全灭），51chigua 代理回 200 合法图片；
// 故 pic.*.cn 域固定走 51chigua，其余域沿用 bagua——两代理各擅长域不同，写死单一代理迟早再坏。
const IMG_PROXY_51 = 'https://51chigua.li768435813.workers.dev/img?url=';
const IMG_PROXY_BAGUA = 'https://bagua-img-proxy.li768435813.workers.dev/img?url=';

function proxyCover(url) {
  url = String(url || '').trim();
  if (!url) return '';
  if (url.indexOf('data:') === 0) return url;
  if (url.indexOf('51chigua.li768435813.workers.dev') >= 0 || url.indexOf('bagua-img-proxy') >= 0) return url;
  if (/^https?:\/\/pic\.[^\/]*\.cn\//i.test(url)) return IMG_PROXY_51 + encodeURIComponent(url);
  return IMG_PROXY_BAGUA + encodeURIComponent(url);
}

function H() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': HOST,
    'Origin': HOST.replace(/\/$/, ''),
  };
}

async function getText(url) {
  try {
    const { data } = await req.get(url, { headers: H(), timeout: 15000 });
    return String(data || '');
  } catch { return ''; }
}

function imgOf(html) {
  const clean = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  // 优先取文章封面（z-image-loader-url 或 blog-background 类的 img）
  let m = clean.match(/z-image-loader-url\s*=\s*"([^"]+)"/i);
  if (m && /^https?:\/\//i.test(m[1])) return m[1];
  m = clean.match(/<img[^>]*class="[^"]*blog-background[^"]*"[^>]*>/i);
  if (m) {
    const sm = m[0].match(/(?:z-image-loader-url|data-src|src)\s*=\s*"([^"]+)"/i);
    if (sm && /^https?:\/\//i.test(sm[1]) && !/data:image/i.test(sm[1])) return sm[1];
  }
  m = clean.match(/https?:\/\/[^"'\s)]+\.(?:jpg|png|jpeg|webp)/i);
  if (m) return m[0];
  m = clean.match(/url\s*\(\s*['"]?([^"'\)]+)['"]?\s*\)/i);
  if (m) {
    const u = m[1].trim();
    if (/^https?:\/\//i.test(u)) return u;
  }
  return '';
}

function parseArticles(html) {
  const items = [];
  const re = /<article[\s\S]{0,8000}?<\/article>/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const blk = m[0];
    const links = [...blk.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/gi)].map(x => x[1]);
    const found = links.find(h => h.indexOf('/archives/') >= 0) || links[0];
    if (!found) continue;
    const href = found.trim();
    if (!href || href === '#' || seen.has(href)) continue;
    seen.add(href);
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const hm = blk.match(/<h2[^>]*>([\s\S]{0,300}?)<\/h2>/i);
    let title = hm ? strip(hm[1]) : '';
    if (!title) {
      const at = blk.match(/<a[^>]*>([\s\S]{0,300}?)<\/a>/i);
      if (at) title = strip(at[1]);
    }
    if (!title || title.length < 2) continue;
    const tm = blk.match(/<time[^>]*>([^<]{2,40})<\/time>/i);
    items.push({
      vod_id: href,
      vod_name: title,
      vod_pic: proxyCover(imgOf(blk)),
      vod_remarks: tm ? tm[1].trim() : '',
    });
    if (items.length >= 60) break;
  }
  // 兜底：article 块未产出时，直接扫 /archives/ 链接 + 就近 h2 标题
  if (!items.length) {
    const are = /<a[^>]*href="([^"]*\/archives\/[^"]+)"[^>]*>/gi;
    while ((m = are.exec(html)) !== null) {
      const href = m[1].trim();
      if (!href || href === '#' || seen.has(href)) continue;
      const rest = html.slice(m.index, m.index + 3000);
      const hm2 = rest.match(/<h2[^>]*>([\s\S]{0,300}?)<\/h2>/i);
      const title = hm2 ? hm2[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
      if (!title || title.length < 2) continue;
      seen.add(href);
      items.push({ vod_id: href, vod_name: title, vod_pic: proxyCover(imgOf(rest)), vod_remarks: '' });
      if (items.length >= 60) break;
    }
  }
  return items;
}

function parseCategories(html) {
  const items = [];
  const seen = new Set();
  // 取所有 /category/ 链接：导航分类可能是裸 <a>，也可能被 <li> 包裹，两种都认
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const re = /<a[^>]*href="(?:https?:\/\/[^"\/]+)?(\/category\/[^"]+)"[^>]*>([\s\S]{0,80}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim(), name = strip(m[2]);
    if (!href || href === '#' || !name || name.length < 2 || name.length > 20 || seen.has(href)) continue;
    seen.add(href);
    items.push({ type_id: href, type_name: name });
  }
  return items;
}

function extractVideo(html) {
  const clean = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let m = clean.match(/<video[^>]+src=["']([^"']+)["']/i);
  if (m) return m[1];
  m = clean.match(/<source[^>]+src=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  if (m) return m[1];
  m = clean.match(/["']?url["']?\s*:\s*["'](https?:[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  if (m) return m[1];
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
  const html = await getText(HOST);
  let classes = parseCategories(html);
  if (!classes.length) {
    // /latest/ 与 /hot/ 已证实为站内 404 样式页，不可用；用实测导航分类兜底
    classes = [
      { type_id: '/category/jrcg/', type_name: '今日吃瓜' },
      { type_id: '/category/rmdg/', type_name: '热门大瓜' },
      { type_id: '/category/aidj/', type_name: 'AI短剧' },
      { type_id: '/category/mrds/', type_name: '每日大赛' },
    ];
  }
  return { class: classes, filters: {}, list: parseArticles(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  // @folder 分区：列表即子项
  if (tid.includes('@folder')) {
    const url = tid.replace('@folder', '').startsWith('http') ? tid.replace('@folder', '') : HOST.replace(/\/$/, '') + tid.replace('@folder', '');
    const html = await getText(url);
    const videos = [];
    const re = /<h2[^>]*>([^<]{2,120})<\/h2>[\s\S]{0,500}?<a[^>]*href="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      videos.push({ vod_id: m[2], vod_name: m[1].trim(), vod_pic: '', vod_remarks: '' });
      if (videos.length >= 60) break;
    }
    return { page: 1, pagecount: 1, limit: 90, total: videos.length, list: videos };
  }
  let base;
  if (/^https?:\/\//i.test(tid)) base = tid.replace(/\/+$/, '');
  else base = (HOST.replace(/\/$/, '') + '/' + tid.replace(/^\/+/, '')).replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/' + page + '/');
  const html = await getText(url);
  const videos = parseArticles(html);
  return {
    page, pagecount: 9999, limit: 90,
    total: videos.length ? 999999 : 0,
    list: videos,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : HOST.replace(/\/$/, '') + (String(raw).startsWith('/') ? raw : '/' + raw);
    const html = await getText(url);
    const plist = [];
    // 1) dplayer data-config
    const dre = /class="dplayer"[^>]*data-config='([^']+)'/gi;
    let m;
    let c = 0;
    while ((m = dre.exec(html)) !== null) {
      c++;
      try {
        const cfg = JSON.parse(m[1]);
        const vu = cfg?.video?.url || '';
        if (vu) plist.push('视频' + c + '$' + vu);
      } catch {}
    }
    // 2) 观看链接兜底
    if (!plist.length) {
      const lre = /<a[^>]*href="([^"]+)"[^>]*>([^<]*(?:点击观看|观看|播放|视频|第一弹|第二弹|第三弹)[^<]*)<\/a>/gi;
      let i = 0;
      while ((m = lre.exec(html)) !== null) {
        i++;
        let href = m[1].trim();
        let name = m[2].replace(/点击观看[：:]/, '').replace(/点击观看/, '').trim() || ('视频' + i);
        if (!/^https?:\/\//i.test(href)) {
          href = HOST.replace(/\/$/, '') + (href.startsWith('/') ? href : '/' + href);
        }
        plist.push(name + '$' + href);
      }
    }
    // 3) 通用直链兜底：播放器配置多为内联 JS，扫全文 m3u8/mp4 与 og:video
    if (!plist.length) {
      const vu = extractVideo(html);
      if (vu) plist.push('视频$' + vu);
    }
    const hm = html.match(/<h1[^>]*>([^<]{2,120})<\/h1>/i);
    list.push({
      vod_id: raw,
      vod_name: hm ? hm[1].trim() : '818黑料网',
      vod_play_from: '818黑料网',
      vod_play_url: plist.length ? plist.join('#') : ('未找到视频源$' + url),
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4|ts)/i.test(id);
  return {
    parse: isVideo ? 0 : 1,
    url: id,
    header: H(),
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const url = page === 1
    ? (HOST + 'search/' + encodeURIComponent(wd) + '/')
    : (HOST + 'search/' + encodeURIComponent(wd) + '/' + page + '/');
  const html = await getText(url);
  const list = parseArticles(html);
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
