import req from '../../util/req.js';

// AvHub (py_avhub)
// 站点: https://avhub360.com/ (国产/JAV 站，无反爬，服务端渲染)
// 列表: /new[/{page}] (21条/页, 深翻页) / /popular/today[/{page}] (21条/页)
// 单页分类: /popular (热门) /theme/detail/{id} (主题) /tags/{id} (标签) 均为单页
// 卡片: <a href="/videos/{code}" data-mv-id> > img (封面在 data-src 或 z-image-loader-url, 懒加载)
// 详情: /videos/{code} (标题 og:title, 封面 og:image)
// 播放: GET /media/{code} (带 Referer) -> 302 跳转到 jw-hls.wgmyvq.cn 的 m3u8 直链 (带时效 auth_key, 需实时解析)
//       m3u8 为标准 AES-128 HLS (EXT-X-KEY 指向 .ts 密钥文件), 播放器原生解密; 分片/密钥无 Referer 亦可下载
// 搜索: /search/{kw}[/{page}] (24条/页)

const KEY = 'py_avhub';
const NAME = 'AvHub';
const SITE = 'https://avhub360.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 29 个真实分类 (2026-10-20 从首页导航/主题页/标签页实测)
// kind: 'paged' 支持 /{base}/{page} 翻页; 'single' 单页
const CATS = [
  { type_id: 'new', type_name: '最新发布', kind: 'paged', base: '/new', pc: 500 },
  { type_id: 'today', type_name: '今日热门', kind: 'paged', base: '/popular/today', pc: 100 },
  { type_id: 'popular', type_name: '热门', kind: 'single', base: '/popular', pc: 1 },
  { type_id: 'theme:3', type_name: '中文字幕', kind: 'single', base: '/theme/detail/3', pc: 1 },
  { type_id: 'theme:11', type_name: '高清无码', kind: 'single', base: '/theme/detail/11/hot', pc: 1 },
  { type_id: 'theme:58', type_name: 'AI短剧', kind: 'single', base: '/theme/detail/58', pc: 1 },
  { type_id: 'tag:171', type_name: '少女', kind: 'single', base: '/tags/171', pc: 1 },
  { type_id: 'tag:182', type_name: '中出', kind: 'single', base: '/tags/182', pc: 1 },
  { type_id: 'tag:170', type_name: '巨乳', kind: 'single', base: '/tags/170', pc: 1 },
  { type_id: 'tag:172', type_name: '颜射', kind: 'single', base: '/tags/172', pc: 1 },
  { type_id: 'tag:231', type_name: '人妻', kind: 'single', base: '/tags/231', pc: 1 },
  { type_id: 'tag:167', type_name: '短发', kind: 'single', base: '/tags/167', pc: 1 },
  { type_id: 'tag:146', type_name: '丝袜', kind: 'single', base: '/tags/146', pc: 1 },
  { type_id: 'tag:179', type_name: '口爆', kind: 'single', base: '/tags/179', pc: 1 },
  { type_id: 'tag:212', type_name: '出轨', kind: 'single', base: '/tags/212', pc: 1 },
  { type_id: 'tag:201', type_name: '3P', kind: 'single', base: '/tags/201', pc: 1 },
  { type_id: 'tag:181', type_name: '乳交', kind: 'single', base: '/tags/181', pc: 1 },
  { type_id: 'tag:164', type_name: '美腿', kind: 'single', base: '/tags/164', pc: 1 },
  { type_id: 'tag:169', type_name: '熟女', kind: 'single', base: '/tags/169', pc: 1 },
  { type_id: 'tag:189', type_name: '痴女', kind: 'single', base: '/tags/189', pc: 1 },
  { type_id: 'tag:151', type_name: '校服', kind: 'single', base: '/tags/151', pc: 1 },
  { type_id: 'tag:176', type_name: '潮吹', kind: 'single', base: '/tags/176', pc: 1 },
  { type_id: 'tag:185', type_name: '调教', kind: 'single', base: '/tags/185', pc: 1 },
  { type_id: 'tag:180', type_name: '口交', kind: 'single', base: '/tags/180', pc: 1 },
  { type_id: 'tag:197', type_name: '多P', kind: 'single', base: '/tags/197', pc: 1 },
  { type_id: 'tag:199', type_name: '凌辱', kind: 'single', base: '/tags/199', pc: 1 },
  { type_id: 'tag:178', type_name: '接吻', kind: 'single', base: '/tags/178', pc: 1 },
  { type_id: 'tag:217', type_name: 'NTR', kind: 'single', base: '/tags/217', pc: 1 },
  { type_id: 'tag:149', type_name: '渔网', kind: 'single', base: '/tags/149', pc: 1 },
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
  return u;
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

// 解析视频卡片: <a href="/videos/{code}" ... data-mv-id="N" ...> <img ... alt="标题">
// 封面懒加载: 优先 data-src, 其次 z-image-loader-url, 再 src (避开占位图/gif)
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(\/videos\/[A-Za-z0-9\-_]+)"[^>]*data-mv-id[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = m[1].replace('/videos/', '');
    if (seen.has(code)) continue;
    seen.add(code);
    const win = html.slice(m.index, m.index + 2500);
    const imgM = win.match(/<img[^>]+>/);
    let pic = '';
    let title = '';
    if (imgM) {
      const tag = imgM[0];
      const ds = tag.match(/data-src="([^"]+)"/);
      const zl = tag.match(/z-image-loader-url="([^"]+)"/);
      const sc = tag.match(/\ssrc="([^"]+)"/);
      pic = (ds && ds[1]) || (zl && zl[1]) || (sc && sc[1]) || '';
      const altM = tag.match(/alt="([^"]*)"/);
      if (altM) title = clean(altM[1]).replace(/\s*\?>+\s*$/, '').trim();
    }
    if (!title) title = code.toUpperCase();
    out.push({
      vod_id: SITE + '/videos/' + code,
      vod_name: title,
      vod_pic: fixUrl(pic),
      vod_remarks: '',
    });
  }
  return out;
}

function catOf(tid) {
  return CATS.find(c => c.type_id === tid) || CATS[0];
}

function catUrl(cat, page) {
  if (cat.kind === 'paged' && page > 1) return SITE + cat.base + '/' + page;
  return SITE + cat.base;
}

function buildList(url, page, pagecount, limit) {
  limit = limit || 21;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    return { page, pagecount: Math.max(pagecount, page), limit, total: list.length, list };
  });
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(SITE + '/new');
  const list = html ? parseCards(html).slice(0, 21) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'new';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = catOf(tid);
  if (cat.kind === 'single' && page > 1) {
    return { page, pagecount: 1, limit: 21, total: 0, list: [] };
  }
  return buildList(catUrl(cat, page), page, cat.pc, 21);
}

function codeFromId(id) {
  id = t(id);
  if (!id) return '';
  if (id.includes('$')) id = id.split('$').pop().trim();
  const m = id.match(/\/videos\/([A-Za-z0-9\-_]+)/);
  if (m) return m[1];
  if (/\/media\/([A-Za-z0-9\-_]+)/.test(id)) return id.match(/\/media\/([A-Za-z0-9\-_]+)/)[1];
  return id.replace(/^\/+|\/+$/g, '');
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const code = codeFromId(body.id);
  if (!code) return { list: [] };
  const durl = SITE + '/videos/' + code;
  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const og = html.match(/<meta property="og:title" content="([^"]+)"/);
  if (og) name = clean(og[1]).replace(/\s*-\s*番号AV.*$/, '').replace(/\s*-\s*AVHub\s*$/, '').trim();
  if (!name) {
    const tm = html.match(/<title>([^<]*)<\/title>/);
    if (tm) name = clean(tm[1]).replace(/\s*-\s*番号AV.*$/, '').trim();
  }
  if (!name) name = code.toUpperCase();

  let pic = '';
  const ogi = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (ogi) pic = ogi[1];

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: fixUrl(pic),
      vod_remarks: code.toUpperCase(),
      vod_content: name,
      vod_play_from: 'AvHub',
      vod_play_url: '正片$' + SITE + '/media/' + code,
    }],
  };
}

// /media/{code} -> 302 -> 带 auth_key 的 m3u8 直链 (auth_key 时效, 必须实时解析)
async function resolveMedia(code) {
  const mediaUrl = SITE + '/media/' + code;
  const headers = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Referer': SITE + '/videos/' + code,
  };
  // 通道1: 框架 req (禁止跟随重定向, 读 location)
  try {
    const resp = await req.get(mediaUrl, {
      headers, timeout: 20000, maxRedirects: 0,
      validateStatus: s => s >= 200 && s < 400,
    });
    const loc = (resp.headers && (resp.headers.location || resp.headers.Location)) || '';
    if (loc && /\.m3u8/i.test(loc)) return loc;
    // 若框架跟随了重定向且直接返回 m3u8 内容, data 即为播放列表文本
    if (typeof resp.data === 'string' && resp.data.includes('#EXTM3U')) return mediaUrl;
  } catch (e) {
    // axios 在 maxRedirects:0 时可能把 302 当错误抛出, e.response 里有 headers
    const loc = e && e.response && e.response.headers && (e.response.headers.location || e.response.headers.Location);
    if (loc && /\.m3u8/i.test(loc)) return loc;
  }
  // 通道2: 原生 fetch 手动重定向
  try {
    const r = await fetch(mediaUrl, { headers, redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    if (loc && /\.m3u8/i.test(loc)) return loc;
  } catch (e) { /* ignore */ }
  return '';
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const code = codeFromId(body.id);
  if (!code) return { parse: 0, url: '' };
  const m3u8 = await resolveMedia(code);
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
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  let url = SITE + '/search/' + encodeURIComponent(wd);
  if (page > 1) url += '/' + page;
  return buildList(url, page, page + (page >= 1 ? 5 : 0), 24);
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
