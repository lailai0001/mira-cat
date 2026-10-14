import req from '../../util/req.js';
import crypto from 'crypto';

const KEY = 'py_huangguo';
const NAME = '黄果短剧';
const HOST = 'https://huangguoai.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HTML_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': HOST + '/',
};

// 分类: 源自 XPTV huangguo.js 的 appConfig.tabs
const CLASSES = [
  { type_id: 'home', type_name: '首页' },
  { type_id: 'ai-duanju', type_name: 'AI成人短剧' },
  { type_id: 'ai-manju', type_name: 'AI成人漫剧' },
  { type_id: 'ai-huanlian', type_name: 'AI换脸' },
  { type_id: 'ai-mogai', type_name: 'AI魔改' },
  { type_id: 'ranks/hot', type_name: '排行榜' },
];

// 封面为 AES-128-CBC 加密(与 bagua/51吃瓜同密钥), 代理解密出图
const IMG_KEY = Buffer.from('f5d965df75336270', 'utf8');
const IMG_IV = Buffer.from('97b60394abc2fbe1', 'utf8');

function tryDecryptImage(buf) {
  if (!buf || !buf.length || buf.length % 16 !== 0) return buf;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', IMG_KEY, IMG_IV);
    decipher.setAutoPadding(false);
    let t = Buffer.concat([decipher.update(buf), decipher.final()]);
    const isJpeg = t.length >= 2 && t[0] === 0xff && t[1] === 0xd8;
    const isPng = t.length >= 8 && t[0] === 0x89 && t[1] === 0x50 && t[2] === 0x4e && t[3] === 0x47
      && t[4] === 0x0d && t[5] === 0x0a && t[6] === 0x1a && t[7] === 0x0a;
    const isWebp = t.length >= 12 && t[0] === 0x52 && t[1] === 0x49 && t[2] === 0x46 && t[3] === 0x46
      && t[8] === 0x57 && t[9] === 0x45 && t[10] === 0x42 && t[11] === 0x50;
    const isGif = t.length >= 6 && t[0] === 0x47 && t[1] === 0x49 && t[2] === 0x46 && t[3] === 0x38;
    if (!(isJpeg || isPng || isWebp || isGif)) return buf;
    const s = t[t.length - 1];
    if (s > 0 && s <= 16) {
      let ok = true;
      for (let n = t.length - s; n < t.length; n++) {
        if (t[n] !== s) { ok = false; break; }
      }
      if (ok) t = t.slice(0, t.length - s);
    }
    const eoi = t.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (eoi !== -1) {
      t = t.slice(0, eoi + 2);
    } else {
      const iend = t.lastIndexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
      if (iend !== -1) t = t.slice(0, iend + 8);
    }
    return t;
  } catch (e) {
    return buf;
  }
}

function proxyImgUrl(request, imgUrl) {
  if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) return imgUrl;
  const proto = String(request?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  let host = String(request?.headers?.['x-forwarded-host'] || request?.headers?.host || '').split(',')[0].trim();
  if (!host) host = 'localhost';
  const prefix = request?.server?.prefix || `/spider/${KEY}/3`;
  return `${proto}://${host}${prefix}/proxy/img?url=${encodeURIComponent(imgUrl)}`;
}

async function proxyImg(request, reply) {
  const imgUrl = String(request?.query?.url || '');
  if (!imgUrl) {
    reply.code(400).send('missing url');
    return;
  }
  try {
    const { data } = await req.get(imgUrl, {
      headers: HTML_HEADERS,
      timeout: 15000,
      responseType: 'arraybuffer',
    });
    const buf = tryDecryptImage(Buffer.from(data));
    let ctype = 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) ctype = 'image/png';
    else if (buf[0] === 0x47 && buf[1] === 0x49) ctype = 'image/gif';
    else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) ctype = 'image/webp';
    reply.header('Content-Type', ctype);
    reply.send(buf);
  } catch (e) {
    reply.code(500).send('proxy error');
  }
}

// 带重试的请求: 4xx(除429)不重试, 其余最多3次
async function fetchRetry(url, opts, tries = 3) {
  let lastErr = null;
  for (let s = 0; s < tries; s++) {
    try {
      return await req.get(url, opts);
    } catch (e) {
      lastErr = e;
      const st = e && e.response && e.response.status;
      if (st && st >= 400 && st < 500 && st !== 429) throw e;
      if (s < tries - 1) await new Promise(r => setTimeout(r, 400 * (s + 1)));
    }
  }
  throw lastErr;
}

async function getHtml(url, referer) {
  const headers = referer ? { ...HTML_HEADERS, Referer: referer } : HTML_HEADERS;
  const res = await fetchRetry(url, { headers, timeout: 20000 });
  const d = res && res.data;
  if (typeof d === 'string') return d;
  if (d == null) return '';
  return Buffer.isBuffer(d) ? d.toString('utf8') : String(d);
}

async function getJson(url) {
  const headers = { ...HTML_HEADERS, Accept: 'application/json, text/plain, */*' };
  const res = await fetchRetry(url, { headers, timeout: 20000 });
  const d = res && res.data;
  if (d == null) return null;
  if (typeof d === 'object') return d;
  try {
    return JSON.parse(String(d));
  } catch (e) {
    return null;
  }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return HOST + u;
  return u;
}

// 封面URL清洗: 补全域名 + 去掉 query 参数
// 封面解密走外部代理（参考 REX 版：https://huangguo.wulii.de5.net）
const COVER_PROXY = 'https://huangguo.wulii.de5.net';

function proxyCoverUrl(imgUrl) {
  if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) return imgUrl;
  return `${COVER_PROXY}/?url=${encodeURIComponent(imgUrl)}`;
}

function cleanPicUrl(u) {
  // 注意：封面 URL 带时效 auth_key 参数，必须保留，否则 403
  return absUrl(u);
}

function metaContent(html, name) {
  if (!html) return '';
  let m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'));
  if (m) return decodeEntities(m[1]).trim();
  m = html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + name + '["\']', 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

function extractTrackId(block) {
  let m = block.match(/data-track-id="(\d+)"/);
  if (m) return m[1];
  m = block.match(/href="[^"]*\/(?:video|detail)\/(\d+)\/?"/);
  return m ? m[1] : '';
}

function cleanTitle(s) {
  return stripTags(String(s || '').replace(/<span\b[^>]*\bsr-only\b[^>]*>[\s\S]*?<\/span>/gi, ''));
}

function extractCardTitle(block) {
  let m = block.match(/data-track-title="([^"]*)"/);
  if (m) return decodeEntities(m[1]).trim();
  m = block.match(/hg-(?:drama-card|rank-item)__title[^>]*>([\s\S]*?)<\/(?:a|h2)>/);
  if (m) {
    const t = cleanTitle(m[1]);
    if (t) return t;
  }
  m = block.match(/<a[^>]+href="[^"]*\/(?:video|detail)\/\d+\/?"[^>]*>([\s\S]*?)<\/a>/);
  return m ? cleanTitle(m[1]) : '';
}

// 单个剧卡解析
function parseCardBlock(block, request) {
  const id = extractTrackId(block);
  if (!id) return null;
  const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
  const title = extractCardTitle(block);
  if (!title) return null;
  const epBaseM = block.match(/data-ep-base="([^"]*)"/);
  const epSpanM = block.match(/hg-drama-card__episode[^>]*>([\s\S]*?)<\/span>/);
  const scoreSpanM = block.match(/hg-drama-card__score[^>]*>([\s\S]*?)<\/span>/);
  const epBase = epBaseM ? decodeEntities(epBaseM[1]).trim() : (epSpanM ? stripTags(epSpanM[1]) : '');
  const score = scoreSpanM ? stripTags(scoreSpanM[1]) : '';
  const remarks = epBase && score ? epBase + ' · ' + score : (epBase || score);
  return {
    vod_id: id,
    vod_name: title,
    vod_pic: proxyCoverUrl(cleanPicUrl(imgM ? imgM[1] : '')),
    vod_remarks: remarks,
  };
}

// 剧卡网格列表解析(parseAll=true 解析全部网格, 否则只取第一格)
function parseCards(html, parseAll, request) {
  const out = [];
  const seen = new Set();
  if (!html) return out;
  const gridRe = /<div\s+class="[^"]*\bhg-card-grid\b[^"]*"[^>]*>/g;
  const starts = [];
  let m;
  while ((m = gridRe.exec(html)) !== null) starts.push(m.index + m[0].length);
  if (!starts.length) return out;
  const n = parseAll ? starts.length : Math.min(1, starts.length);
  for (let i = 0; i < n; i++) {
    const segEnd = i + 1 < starts.length ? starts[i + 1] : html.length;
    const seg = html.slice(starts[i], segEnd);
    const cardRe = /<div\s+class="[^"]*\bhg-drama-card\b[^"]*"[^>]*>/g;
    const cstarts = [];
    let cm;
    while ((cm = cardRe.exec(seg)) !== null) cstarts.push(cm.index);
    for (let j = 0; j < cstarts.length; j++) {
      const cEnd = j + 1 < cstarts.length ? cstarts[j + 1] : seg.length;
      try {
        const card = parseCardBlock(seg.slice(cstarts[j], cEnd), request);
        if (!card || seen.has(card.vod_id)) continue;
        seen.add(card.vod_id);
        out.push(card);
      } catch (e) {}
    }
  }
  return out;
}

// 排行榜列表解析
function parseRankList(html, request) {
  const out = [];
  const seen = new Set();
  if (!html) return out;
  const listM = html.match(/<div\s+class="[^"]*\bhg-rank-list\b[^"]*"[^>]*>/);
  const body = html.slice(listM ? listM.index + listM[0].length : 0);
  const itemRe = /<div\s+class="[^"]*\bhg-rank-item\b[^"]*"[^>]*>/g;
  const starts = [];
  let m;
  while ((m = itemRe.exec(body)) !== null) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const seg = body.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : body.length);
    try {
      const id = extractTrackId(seg);
      if (!id || seen.has(id)) continue;
      const imgM = seg.match(/data-src="([^"]+)"/) || seg.match(/src="([^"]+)"/);
      const title = extractCardTitle(seg);
      if (!title) continue;
      seen.add(id);
      const tagsM = seg.match(/hg-rank-item__tags[^>]*>([\s\S]*?)<\/div>/);
      out.push({
        vod_id: id,
        vod_name: title,
        vod_pic: proxyCoverUrl(cleanPicUrl(imgM ? imgM[1] : '')),
        vod_remarks: tagsM ? stripTags(tagsM[1]) : '',
      });
    } catch (e) {}
  }
  return out;
}

// /api/videos/category JSON 条目解析
function parseApiItem(item, request) {
  if (!item || !item.id) return null;
  const parts = [];
  const epCount = parseInt(item.episode_count, 10) || 0;
  if (epCount > 0) parts.push((item.is_finished ? '全' : '更新至') + epCount + '集');
  if (item.score) parts.push(String(item.score) + '分');
  if (Array.isArray(item.tags) && item.tags.length) parts.push(item.tags.join('·'));
  return {
    vod_id: String(item.id),
    vod_name: String(item.title || ''),
    vod_pic: proxyCoverUrl(cleanPicUrl(item.cover || '')),
    vod_remarks: parts.join(' · '),
  };
}

// 详情页头部: 标题/封面/简介
function parseDetailHead(html) {
  let title = metaContent(html, 'og:title');
  if (title) title = title.replace(/\s*-\s*黄果短剧\s*$/, '');
  if (!title) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (m) title = stripTags(decodeEntities(m[1]));
  }
  let pic = '';
  const posterDiv = html.match(/<div\s+class="[^"]*\bhg-web-play__poster\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (posterDiv) {
    const m = posterDiv[1].match(/data-src="([^"]+)"/) || posterDiv[1].match(/src="([^"]+)"/);
    if (m && m[1].indexOf('data:image') !== 0) pic = m[1];
  }
  if (!pic) {
    const m = html.match(/id="videoInitialData"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const j = JSON.parse(m[1]);
        pic = (j && (j.posterSrc || j.coverSrc)) || '';
      } catch (e) {}
    }
  }
  if (!pic) {
    const m = html.match(/<img\b[^>]*\bdata-src="([^"]+)"[^>]*\bfetchpriority="high"[^>]*>/i)
      || html.match(/<img\b[^>]*\bfetchpriority="high"[^>]*\bdata-src="([^"]+)"[^>]*>/i)
      || html.match(/<img\b[^>]*\bdata-src="(https?:\/\/[^"]+?\.(?:jpe?g|png|webp|gif)(?:\?[^"]*)?)"[^>]*>/i);
    if (m) pic = m[1];
  }
  if (!pic) pic = metaContent(html, 'og:image');
  const content = metaContent(html, 'og:description');
  return { title, pic, content };
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  try {
    const html = await getHtml(HOST + '/');
    return { list: parseCards(html, true, null).slice(0, 20) };
  } catch (e) {
    return { list: [] };
  }
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'home').replace(/^\//, '');
  let page = parseInt(body.page, 10) || 1;
  if (page <= 0) page = 1;
  try {
    if (tid === 'home') {
      const html = await getHtml(HOST + '/');
      const list = parseCards(html, true, reqIn);
      // 首页用固定 pagecount 保证"加载更多"可点（实际只有一页数据，点更多返回空）
      return { page, pagecount: 999, limit: 30, total: 99999, list };
    }
    if (tid.indexOf('rank') !== -1) {
      const html = await getHtml(`${HOST}/${tid}/`);
      return { page, pagecount: 1, limit: 30, total: 99999, list: parseRankList(html, reqIn) };
    }
    // JSON 分类接口优先
    const json = await getJson(`${HOST}/api/videos/category/${tid}?page=${page}`);
    if (json && json.data && Array.isArray(json.data.items)) {
      const list = json.data.items.map(d => parseApiItem(d, reqIn)).filter(Boolean);
      const pages = parseInt(json.data.pagination && json.data.pagination.pages, 10);
      const pagecount = pages > 0 ? pages : (list.length ? page + 1 : 1);
      return { page, pagecount, limit: list.length || 30, total: 99999, list };
    }
    // 兜底: 分类 HTML 页
    const url = `${HOST}/${tid}/${page > 1 ? page + '/' : ''}`;
    const html = await getHtml(url);
    const list = parseCards(html, false, reqIn);
    return {
      page,
      pagecount: list.length < 30 ? page : page + 1,
      limit: list.length || 30,
      total: 99999,
      list,
    };
  } catch (e) {
    return { page, pagecount: 1, limit: 30, total: 0, list: [] };
  }
}

async function detail(reqIn) {
  let vid = reqIn?.body?.id;
  if (Array.isArray(vid)) vid = vid[0];
  vid = String(vid || '').trim();
  if (!vid) return { list: [] };
  try {
    const html = await getHtml(`${HOST}/video/${vid}/`);
    const { title, pic, content } = parseDetailHead(html);
    const eps = [];
    const gridM = html.match(/<div\s+class="[^"]*\bhg-(?:web-play|web-detail)__ep-grid\b[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (gridM) {
      const aRe = /<a\b[^>]*>[\s\S]*?<\/a>/g;
      let am;
      while ((am = aRe.exec(gridM[1])) !== null) {
        const hrefM = am[0].match(/href="([^"]+)"/);
        if (!hrefM) continue;
        const epIdM = am[0].match(/data-ep-id="([^"]*)"/);
        const ep = epIdM ? epIdM[1] : '';
        eps.push({ name: ep ? `第${ep}集` : stripTags(am[0]), url: absUrl(hrefM[1]), ep });
      }
    }
    if (!eps.length) {
      const pm = html.match(/<a\b[^>]*class="[^"]*\bhg-web-detail__play\b[^"]*"[^>]*href="([^"]+)"/);
      if (pm) eps.push({ name: '第1集', url: absUrl(pm[1]), ep: '' });
    }
    if (!eps.length) return { list: [] };
    return {
      list: [{
        vod_id: vid,
        vod_name: title || `黄果短剧 ${vid}`,
        vod_pic: proxyCoverUrl(cleanPicUrl(pic)),
        vod_content: content,
        vod_play_from: NAME,
        vod_play_url: eps.map(e => `${e.name}$${e.url}$$$${e.ep}`).join('#'),
      }],
    };
  } catch (e) {
    return { list: [] };
  }
}

async function play(reqIn) {
  const raw = String(reqIn?.body?.id || '');
  const sep = raw.indexOf('$$');
  const pageUrl = sep !== -1 ? raw.slice(0, sep) : raw;
  const ep = sep !== -1 ? raw.slice(sep + 2) : '';
  if (!pageUrl) return { parse: 0, url: '', header: {} };
  try {
    const html = await getHtml(pageUrl, HOST + '/');
    let url = '';
    const m = html.match(/id="videoInitialData"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const j = JSON.parse(m[1]);
        url = ((j && j.epPlaySrcs) || {})[ep] || (j && j.videoSrc) || '';
      } catch (e) {}
    }
    if (url) {
      url = String(url).replace(/\\u0026/g, '&');
      if (!/^https?:\/\//i.test(url)) {
        const um = url.match(/(https?:\/\/[^\s"']+)/);
        url = um ? um[1] : '';
      }
    }
    if (!url) return { parse: 0, url: '', header: {} };
    return { parse: 0, url, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  } catch (e) {
    return { parse: 0, url: '', header: {} };
  }
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = 1;
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: 1, limit: 30, total: 0, list: [] };
  try {
    const html = await getHtml(`${HOST}/search/video/${encodeURIComponent(wd)}/`);
    const list = parseCards(html, false, reqIn);
    return {
      page,
      pagecount: list.length < 30 ? page : page + 1,
      limit: list.length || 30,
      total: list.length,
      list,
    };
  } catch (e) {
    return { page, pagecount: 1, limit: 30, total: 0, list: [] };
  }
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', init);
      fastify.post('/home', home);
      fastify.post('/homeVod', homeVod);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
      fastify.get('/proxy/img', proxyImg);
    },
  };
}
