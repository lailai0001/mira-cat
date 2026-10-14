// 57吃瓜 (https://57cg4.com) -> CatPawOpen spider
// 转换自 REX Forward Widget: forward.57cg.tut v1.1.0 (作者: 宝宝巴士)
// 列表 /events/{id}/ 结构, 详情页提取 m3u8 / mp4 直链
// 封面在 s.chigua.media CDN, 需 Referer -> 走服务器代理透传
import req from '../../util/req.js';

const KEY = 'py_chigua57';
const NAME = '57吃瓜';
const HOST = 'https://57cg4.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 分类: REX 原有 9 个 + 站点导航新增 society(社会事件) / star(明星八卦)
const CLASSES = [
  { type_id: 'hot', type_name: '热门' },
  { type_id: 'home', type_name: '首页最新' },
  { type_id: 'jrcg', type_name: '今日吃瓜' },
  { type_id: 'mrds', type_name: '每日大赛' },
  { type_id: 'wanghong', type_name: '网红黑料' },
  { type_id: 'video', type_name: '网黄合集' },
  { type_id: 'cheating', type_name: '出轨劈腿' },
  { type_id: 'live', type_name: '直播擦边' },
  { type_id: 'aichengduanju', type_name: '成人AI短剧' },
  { type_id: 'society', type_name: '社会事件' },
  { type_id: 'star', type_name: '明星八卦' },
];

function headers() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': HOST + '/',
  };
}

async function getHtml(url) {
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 20000 });
    return String(data || '');
  } catch (e) {
    return '';
  }
}

function t(v) {
  return String(v == null ? '' : v).trim();
}

function decodeHtml(s) {
  return t(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

/** 去掉标题前重复的分类/栏目前缀, 只保留正常片名 (同 REX cleanTitle) */
function cleanTitle(title) {
  const raw = decodeHtml(title);
  if (!raw) return '';
  const prefixes = [
    'AI成人短剧', '成人AI短剧', '每日大赛', '今日吃瓜', '网红黑料',
    '网黄合集', '出轨劈腿', '直播擦边', '社会事件', '明星八卦',
    '热门事件', '热门', '每日大',
  ];
  let out = raw, changed = true;
  while (changed) {
    changed = false;
    out = t(out);
    for (const p of prefixes) {
      if (out.indexOf(p) === 0) {
        out = out.slice(p.length).replace(/^[\s\-_|｜·:：]+/, '');
        changed = true;
        break;
      }
    }
  }
  out = t(out);
  return out || raw;
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return HOST + u;
  return HOST + '/' + u;
}

/** 封面代理地址: Cloudflare Worker 透传 (CDN 需 Referer, App 内无 headers 拼不出本地代理) */
const IMG_PROXY = 'https://57chigua.li768435813.workers.dev/img?url=';

/** 封面走代理 (CDN 无 Referer 会 403) */
function proxyImgUrl(request, imgUrl) {
  if (!imgUrl) return '';
  // 已是代理地址直接返回
  if (/workers\.dev/i.test(imgUrl)) return imgUrl;
  // 强制走 Cloudflare Worker（App 环境无 headers，本地代理不可用）
  return IMG_PROXY + encodeURIComponent(imgUrl);
}

function listUrl(cat, page) {
  page = Math.max(1, parseInt(page, 10) || 1);
  cat = t(cat) || 'hot';
  if (cat === 'home' || cat === '') {
    return page <= 1 ? HOST + '/' : HOST + '/page/' + page + '/';
  }
  const path = HOST + '/' + cat + '/';
  return page > 1 ? path + '?page=' + page : path;
}

function parseList(html, request) {
  const out = [];
  const seen = new Set();
  if (!html) return out;
  const re = /<a[^>]+href="\/events\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    const body = m[0];
    // 只保留带图的主卡片
    let im = body.match(/(?:src|data-src|data-original)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (!im) im = body.match(/(?:src|data-src)=["'](\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (!im) continue;
    seen.add(id);

    let title = '';
    let tm = body.match(/alt=["']([^"']{2,200})["']/i)
      || body.match(/title=["']([^"']{2,200})["']/i)
      || body.match(/<h[123][^>]*>([^<]{2,200})<\/h/i);
    if (tm) title = cleanTitle(tm[1]);
    if (!title) title = '事件 ' + id;

    const cover = absUrl(im[1]);
    out.push({
      vod_id: id,
      vod_name: title,
      vod_pic: proxyImgUrl(request, cover),
      vod_remarks: '',
    });
  }
  return out;
}

function extractPlay(html) {
  const sources = [];
  const seen = new Set();
  function add(url, name) {
    url = t(url);
    if (!url || seen.has(url)) return;
    if (!/^https?:\/\//i.test(url)) return;
    seen.add(url);
    sources.push({ name: name || '播放', url });
  }
  const m3 = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi) || [];
  m3.forEach(u => add(u, 'HLS'));
  const mp = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/gi) || [];
  mp.forEach(u => add(u, 'MP4'));
  const fields = html.match(/["'](?:url|play_url|playUrl|src|file|video)["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi) || [];
  fields.forEach(f => {
    const um = f.match(/https?:\/\/[^"']+/);
    if (um) {
      const u = um[0];
      if (/\.m3u8/i.test(u)) add(u, 'HLS');
      else if (/\.mp4/i.test(u)) add(u, 'MP4');
    }
  });
  return sources;
}

function extractTitle(html, fallback) {
  let m = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i)
    || html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (m) return cleanTitle(m[1]);
  m = html.match(/<h1[^>]*>([^<]{2,200})<\/h1>/i);
  if (m) return cleanTitle(m[1]);
  m = html.match(/<title>([^<]+)<\/title>/i);
  if (m) return cleanTitle(m[1].replace(/\s*[-|_｜].*57.*/, '').trim());
  return fallback || '';
}

function extractCover(html) {
  let m = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i)
    || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (m) return absUrl(m[1]);
  m = html.match(/(?:src|data-src)=["'](https?:\/\/s\.chigua\.media\/media\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
  if (m) return m[1];
  return '';
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const id = String(body.id || 'hot');
  const html = await getHtml(listUrl(id, page));
  const list = parseList(html, reqIn);
  return {
    page,
    pagecount: 999,
    limit: list.length || 20,
    total: 999 * 20,
    list,
  };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const raw = Array.isArray(body.id) ? body.id[0] : body.id;
  let vid = String(raw || '').match(/events\/(\d+)/)?.[1] || String(raw || '').replace(/[^0-9]/g, '');
  if (!vid) vid = String(raw || '');
  if (!vid) return { list: [] };

  const pageUrl = `${HOST}/events/${vid}/`;
  const html = await getHtml(pageUrl);
  if (!html) return { list: [] };

  const name = extractTitle(html, vid);
  let content = '';
  const dm = html.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i);
  if (dm) content = decodeHtml(dm[1]);

  const pic = extractCover(html);
  const sources = extractPlay(html);
  const seen = new Set();
  const eps = [];
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    const epName = String(s.name || '正片').replace(/[$#]/g, '_');
    eps.push(`${epName}$${s.url}`);
  }

  return {
    list: [{
      vod_id: vid,
      vod_name: name || vid,
      vod_pic: proxyImgUrl(reqIn, pic),
      vod_content: content,
      vod_play_from: NAME,
      vod_play_url: eps.join('#'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '');
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': HOST + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  let url = `${HOST}/search/?q=${encodeURIComponent(wd)}`;
  if (page > 1) url += `&page=${page}`;
  const html = await getHtml(url);
  const list = parseList(html, reqIn);
  return {
    page,
    pagecount: 999,
    limit: list.length || 20,
    total: 999 * 20,
    list,
  };
}

/** 封面代理: 透传 CDN 图片, 带上 Referer */
async function proxyImg(request, reply) {
  const imgUrl = String(request?.query?.url || '');
  if (!imgUrl) {
    reply.code(400).send('missing url');
    return;
  }
  try {
    const { data } = await req.get(imgUrl, {
      headers: headers(),
      timeout: 20000,
      responseType: 'arraybuffer',
    });
    const buf = Buffer.from(data);
    let ctype = 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) ctype = 'image/png';
    else if (buf[0] === 0x47 && buf[1] === 0x49) ctype = 'image/gif';
    else if (buf[0] === 0x52 && buf[1] === 0x49) ctype = 'image/webp';
    reply.header('Content-Type', ctype);
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.send(buf);
  } catch (e) {
    reply.code(500).send('proxy error');
  }
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', init);
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
      fastify.get('/proxy/img', proxyImg);
    },
  };
}
