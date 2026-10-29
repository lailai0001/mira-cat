import req from '../../util/req.js';

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

// 分类: 站点导航实测 (2026-10-23) — 四个 AI 分类走 /api/videos/category/<slug>, 排行榜走 HTML 页
const CLASSES = [
  { type_id: 'home', type_name: '首页' },
  { type_id: 'ai-duanju', type_name: 'AI成人短剧' },
  { type_id: 'ai-manju', type_name: 'AI成人漫剧' },
  { type_id: 'ai-huanlian', type_name: 'AI换脸' },
  { type_id: 'ai-mogai', type_name: 'AI魔改' },
  { type_id: 'ranks/hot', type_name: '排行榜' },
];

// 封面: pic.*.cn 上的图是 AES-128-CBC 加密存储 (与 bagua/51吃瓜同口径), 走用户已部署的
// bagua-img-proxy Worker 解密出图。旧版用的 huangguo.wulii.de5.net 已失效 (HTTP 500) 是没封面的根源;
// App 的图片加载拿不到蜘蛛本地 /proxy 地址 (avhub 第一轮教训), 故不用站内代理出图。
const IMG_PROXY = 'https://bagua-img-proxy.li768435813.workers.dev/img?url=';

function proxyCover(u) {
  const abs = absUrl(u);
  if (!abs) return '';
  if (/workers\.dev/i.test(abs)) return abs;
  if (/pic\.[a-z0-9]+\.cn/i.test(abs)) return IMG_PROXY + encodeURIComponent(abs);
  return abs;
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

function metaContent(html, name) {
  if (!html) return '';
  let m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'));
  if (m) return decodeEntities(m[1]).trim();
  m = html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']', 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

// 详情页/播放页的 videoInitialData JSON (标题/封面/简介/各集播放源都在里面)
function parseInitialData(html) {
  if (!html) return null;
  const m = html.match(/id="videoInitialData"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
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

// 单个剧卡解析 (首页/分类 HTML/搜索页共用)
function parseCardBlock(block) {
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
    vod_pic: proxyCover(imgM ? imgM[1] : ''),
    vod_remarks: remarks,
  };
}

// 剧卡网格列表解析(parseAll=true 解析全部网格, 否则只取第一格)
function parseCards(html, parseAll) {
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
        const card = parseCardBlock(seg.slice(cstarts[j], cEnd));
        if (!card || seen.has(card.vod_id)) continue;
        seen.add(card.vod_id);
        out.push(card);
      } catch (e) {}
    }
  }
  return out;
}

// 排行榜列表解析
function parseRankList(html) {
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
        vod_pic: proxyCover(imgM ? imgM[1] : ''),
        vod_remarks: tagsM ? stripTags(tagsM[1]) : '',
      });
    } catch (e) {}
  }
  return out;
}

// /api/videos/category JSON 条目解析
function parseApiItem(item) {
  if (!item || !item.id) return null;
  const parts = [];
  const epCount = parseInt(item.episode_count, 10) || parseInt(item.total_episodes, 10) || 0;
  if (epCount > 0) parts.push((item.is_finished ? '全' : '更新至') + epCount + '集');
  if (item.score) parts.push(String(item.score) + '分');
  if (Array.isArray(item.tags) && item.tags.length) parts.push(item.tags.join('·'));
  return {
    vod_id: String(item.id),
    vod_name: String(item.title || ''),
    vod_pic: proxyCover(item.cover || ''),
    vod_remarks: parts.join(' · '),
  };
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
    return { list: parseCards(html, true).slice(0, 24) };
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
      const list = parseCards(html, true);
      return { page: 1, pagecount: 1, limit: list.length || 30, total: list.length, list };
    }
    if (tid.indexOf('rank') !== -1) {
      const html = await getHtml(`${HOST}/${tid}/`);
      const list = parseRankList(html);
      return { page: 1, pagecount: 1, limit: list.length || 30, total: list.length, list };
    }
    // JSON 分类接口优先 (实测 items/pagination 齐全)
    const json = await getJson(`${HOST}/api/videos/category/${tid}?page=${page}`);
    if (json && json.data && Array.isArray(json.data.items)) {
      const list = json.data.items.map(d => parseApiItem(d)).filter(Boolean);
      const pages = parseInt(json.data.pagination && json.data.pagination.pages, 10);
      const pagecount = pages > 0 ? pages : (list.length ? page + 1 : page);
      return { page, pagecount, limit: list.length || 30, total: 99999, list };
    }
    // 兜底: 分类 HTML 页
    const url = `${HOST}/${tid}/${page > 1 ? page + '/' : ''}`;
    const html = await getHtml(url);
    const list = parseCards(html, false);
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
    const pageUrl = `${HOST}/video/${vid}/`;
    const html = await getHtml(pageUrl);
    const j = parseInitialData(html);

    let title = j && j.title ? String(j.title).trim() : '';
    if (!title) title = metaContent(html, 'og:title').replace(/\s*-\s*黄果短剧\s*$/, '');
    let pic = (j && (j.coverSrc || j.posterSrc)) || '';
    if (!pic) pic = metaContent(html, 'og:image');
    const content = (j && j.description) || metaContent(html, 'og:description');

    // 分集: 以详情页分集锚点为据 (class hg-web-play__ep, 带 data-ep-id 与 /ep-N/ 链接),
    // 再用 initialData 的集数信息补齐缺号 (集页 URL 规律: 第1集=/video/<id>/, 其余=/video/<id>/ep-<n>/)
    const epMap = new Map();
    const aRe = /<a\b[^>]*class="[^"]*\bhg-web-play__ep\b[^"]*"[^>]*>/g;
    let am;
    while ((am = aRe.exec(html)) !== null) {
      const tag = am[0];
      const hrefM = tag.match(/href="([^"]+)"/);
      const epM = tag.match(/data-ep-id="(\d+)"/);
      if (!hrefM || !epM) continue;
      epMap.set(parseInt(epM[1], 10), absUrl(hrefM[1]));
    }
    let maxEp = 0;
    for (const n of epMap.keys()) if (n > maxEp) maxEp = n;
    const srcKeys = j && j.epPlaySrcs ? Object.keys(j.epPlaySrcs) : [];
    for (const k of srcKeys) {
      const n = parseInt(k, 10);
      if (n > maxEp) maxEp = n;
    }
    const trackKeys = j && j.trackingEpisodes ? Object.keys(j.trackingEpisodes) : [];
    for (const k of trackKeys) {
      const n = parseInt(k, 10);
      if (n > maxEp) maxEp = n;
    }
    if (maxEp < 1) maxEp = 1;
    if (!epMap.has(1)) epMap.set(1, pageUrl);
    for (let n = 2; n <= maxEp; n++) {
      if (!epMap.has(n)) epMap.set(n, `${HOST}/video/${vid}/ep-${n}/`);
    }
    const eps = [...epMap.entries()].sort((a, b) => a[0] - b[0]);
    return {
      list: [{
        vod_id: vid,
        vod_name: title || `黄果短剧 ${vid}`,
        vod_pic: proxyCover(pic),
        vod_content: content,
        vod_play_from: NAME,
        vod_play_url: eps.map(([n, u]) => `第${n}集$${u}`).join('#'),
      }],
    };
  } catch (e) {
    return { list: [] };
  }
}

// 2026-10-29：HLS 中转。站方自带播放器在用户手机浏览器里也报“资源加载失败”，
// 91 还明说“留言您所在地区”——即放视频的 CDN（yd-hls / tp*.drleao.cn）对用户所在地区
// 不给资源，蜘蛛字段再对也播不了。播放时先向用户自建的 javsb-relay 服务（Railway）要一份
// 中转版 m3u8（服务在 Railway 抓流、字节原样转发、不解密），中转可用就走中转，
// 中转未部署或同样不可用时回落直连，行为不比原来差。
const RELAY = 'https://javsb-relay-production.up.railway.app/';
async function relayM3u8(m3u8Url) {
  if (!/\.m3u8/i.test(m3u8Url)) return '';
  try {
    const relayUrl = RELAY + 'hls?url=' + encodeURIComponent(m3u8Url);
    const res = await req.get(relayUrl, { headers: { 'User-Agent': UA }, timeout: 15000 });
    const d = res && res.data;
    const text = typeof d === 'string' ? d : (d == null ? '' : String(d));
    if (text.includes('#EXTM3U')) return relayUrl;
  } catch (e) {}
  return '';
}

async function play(reqIn) {
  // play id = 分集页 URL 本身 (详情 vod_play_url 里 $ 后即是)。旧版在 id 里塞 $$$集号 再拆,
  // 会被 App 按 $$$ 分隔线路时拆坏, 是不能播放的主因之一 —— 新版 id 不含任何分隔符。
  const pageUrl = absUrl(String(reqIn?.body?.id || '').trim());
  if (!pageUrl) return { parse: 0, url: '', header: {} };
  try {
    const html = await getHtml(pageUrl, HOST + '/');
    const j = parseInitialData(html);
    let url = '';
    if (j) {
      // 分集页的 videoSrc 即本集正片; epPlaySrcs[本集] 兜底; previewSrc 兜底;
      // 2026-10-29 加固：再补一级 videoSrcHevc（个别剧目主 videoSrc 为空时才用）
      url = j.videoSrc || (j.epPlaySrcs && j.ep ? j.epPlaySrcs[String(j.ep)] : '') || j.previewSrc || j.videoSrcHevc || '';
    }
    if (!url) {
      const m = html.match(/"videoSrc"\s*:\s*"([^"]+)"/);
      if (m) url = m[1];
    }
    url = String(url || '').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
    if (!/^https?:\/\//i.test(url)) return { parse: 0, url: '', header: {} };
    // 2026-10-29 加固：Referer 改为分集页 URL 本身（原 HOST 根路径在个别 CDN 校验下更弱）
    const relay = await relayM3u8(url);
    return { parse: 0, url: relay || url, header: { 'User-Agent': UA, 'Referer': pageUrl } };
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
    const list = parseCards(html, false);
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
    },
  };
}
