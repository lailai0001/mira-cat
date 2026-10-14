// 818黑料网 - CatPawOpen JS Spider
// Ported from 818___.py.py (HOST=https://cell.lacdfsq.cc/)
import req from '../../util/req.js';

const KEY = 'py_818hl';
const NAME = '818黑料网';
const HOST = 'https://cell.lacdfsq.cc/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
  let m = clean.match(/https?:\/\/[^"'\s)]+\.(?:jpg|png|jpeg|webp)/i);
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
  const re = /<article[\s\S]{0,3000}?<\/article>/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const blk = m[0];
    const a = blk.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!a) continue;
    const href = a[1].trim();
    if (!href || href === '#' || seen.has(href)) continue;
    seen.add(href);
    const t = blk.match(/<h2[^>]*>([^<]{2,120})<\/h2>/i)
      || blk.match(/class="entry-title"[^>]*>([^<]{2,120})/i)
      || blk.match(/class="post-title"[^>]*>([^<]{2,120})/i);
    const title = t ? t[1].trim() : '';
    if (!title) continue;
    const tm = blk.match(/<time[^>]*>([^<]{2,40})<\/time>/i);
    items.push({
      vod_id: href,
      vod_name: title,
      vod_pic: imgOf(blk),
      vod_remarks: tm ? tm[1].trim() : '',
    });
    if (items.length >= 30) break;
  }
  return items;
}

function parseCategories(html) {
  const items = [];
  const sels = [
    /<li[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]{2,20})<\/a>\s*<\/li>/gi,
  ];
  const seen = new Set();
  for (const re of sels) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const href = m[1].trim(), name = m[2].trim();
      if (!href || href === '#' || !name || seen.has(href)) continue;
      seen.add(href);
      items.push({ type_id: href, type_name: name });
    }
    if (items.length) break;
  }
  return items;
}

async function init() { return {}; }

async function home() {
  const html = await getText(HOST);
  let classes = parseCategories(html);
  if (!classes.length) {
    classes = [
      { type_id: '/latest/', type_name: '最新' },
      { type_id: '/hot/', type_name: '热门' },
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
