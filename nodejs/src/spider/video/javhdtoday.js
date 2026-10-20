import req from '../../util/req.js';

// JavHD.Today (py_javhdtoday)
// 站点: https://javhd.today/cn/ (JAV 聚合站，无反爬)
// 注意: 与 mira-cat 已有的 JavHD (py_javhd, javhd.icu) 是不同站点，key/name 做了区分
// 列表: GET /cn/{sort}/[/{N}/]  sort: recent/popular/releaseday/rated/discussed/downloaded/longest/watched
//       28 条/页；recent 有 13298 页
// 卡片: li#video-{id} > .video > a.thumbnail[href="/cn/{id}/{slug}/",title] > .video-thumb > img[src] + span.video-title
// 详情: GET /cn/{id}/{slug}/  取 <iframe src="/cn/embed/{id}/">
// 播放: embed 页 .server-option[data-embed] Base64 解码 -> 找 f4scdn.com/e/{code}
//       -> data-video-id + data-api -> GET {host}/api/play/{vid}?ab=0 -> src (m3u8, 需 Origin)

const KEY = 'py_javhdtoday';
const NAME = 'JavHD.Today';
const SITE = 'https://javhd.today';
const CN = SITE + '/cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = CN + '/';

// 8 个真实排序分类 (SSR，2026-10-20 实测，均为 200 且有 28 条/页)
const SORT_CATS = [
  { type_id: 'recent', type_name: '最新上传' },
  { type_id: 'popular', type_name: '最受欢迎' },
  { type_id: 'releaseday', type_name: '发布日' },
  { type_id: 'rated', type_name: '高评分' },
  { type_id: 'discussed', type_name: '热议' },
  { type_id: 'downloaded', type_name: '下载最多' },
  { type_id: 'longest', type_name: '最长' },
  { type_id: 'watched', type_name: '观看最多' },
];

// 6 个标签分类 (站点分类页为 JS 骨架屏，走 ?ajax=1 接口取列表，28 条/页，2026-10-21 实测均有内容)
const TAG_CATS = [
  { type_id: 'tag:uncensored-jav', type_name: '无码流出', slug: 'uncensored-jav' },
  { type_id: 'tag:chinese-subtitle', type_name: '中文字幕', slug: 'chinese-subtitle' },
  { type_id: 'tag:jav-sub', type_name: '英文字幕', slug: 'jav-sub' },
  { type_id: 'tag:big-tits', type_name: '巨乳', slug: 'big-tits' },
  { type_id: 'tag:creampie', type_name: '中出', slug: 'creampie' },
  { type_id: 'tag:amateur', type_name: '素人', slug: 'amateur' },
];

const CATS = [...SORT_CATS, ...TAG_CATS];
const LIMIT = 28;

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

function b64dec(s) {
  s = t(s);
  if (!s) return '';
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf-8');
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e) { return ''; }
}

async function getHtml(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': referer || REFERER,
  };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

async function getJson(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Referer': referer || REFERER,
  };
  const doParse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && data) return typeof data === 'string' ? doParse(data) : data;
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) return doParse(await r.text());
  } catch (e) { /* ignore */ }
  return null;
}

// 解析视频卡片: li#video-{id} > a.thumbnail[href,title] > .video-thumb > img[src] + span.video-title
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<li[^>]*id="video-(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vid = m[1];
    const card = m[2];
    const am = card.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*class="thumbnail"/)
      || card.match(/<a[^>]*class="thumbnail"[^>]*href="([^"]+)"[^>]*title="([^"]*)"/)
      || card.match(/<a[^>]*href="([^"]+)"[^>]*>/);
    if (!am) continue;
    const durl = fixUrl(am[1]);
    if (seen.has(durl)) continue;
    seen.add(durl);
    let title = am[2] ? clean(am[2]) : '';
    if (!title) {
      const tm = card.match(/<span class="video-title">([\s\S]*?)<\/span>/);
      if (tm) title = clean(tm[1]);
    }
    const im = card.match(/<img[^>]+src="([^"]+)"/);
    const rm = card.match(/<span class="video-overlay[^"]*"[^>]*>\s*HD\s*([\d:]+)/);
    out.push({
      vod_id: durl,
      vod_name: title || ('视频 ' + vid),
      vod_pic: im ? fixUrl(im[1]) : '',
      vod_remarks: rm ? rm[1].trim() : '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const pages = [...html.matchAll(/\/(\d+)\/"[^>]*>(?:\d+|<)/g)].map(x => parseInt(x[1], 10));
  // 翻页形如 /cn/recent/13298/
  const nums = [...html.matchAll(/\/cn\/[a-z]+\/(\d+)\//g)].map(x => parseInt(x[1], 10));
  const all = nums.filter(n => n > 0 && n < 1000000);
  return all.length ? Math.max(...all) : 1;
}

function catUrl(tid, page) {
  if (tid.startsWith('tag:')) {
    const cat = TAG_CATS.find(c => c.type_id === tid) || TAG_CATS[0];
    return `${CN}/${cat.slug}/?ajax=1&page=${page}`;
  }
  const sort = SORT_CATS.some(c => c.type_id === tid) ? tid : 'recent';
  let url = `${CN}/${sort}/`;
  if (page > 1) url += `${page}/`;
  return url;
}

function isTagCat(tid) {
  return String(tid).startsWith('tag:');
}

// 分类页取列表：排序分类为 SSR 直抓；标签分类走 ?ajax=1 JSON 接口
async function buildList(url, page, limit, isTag) {
  limit = limit || LIMIT;
  if (isTag) {
    const j = await getJson(url, REFERER);
    if (!j || !j.html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(j.html);
    const total = parseInt(j.total, 10) || 0;
    const pc = total > 0 ? Math.ceil(total / limit) : Math.max(page, 1);
    return { page, pagecount: pc, limit, total, list };
  }
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
  const html = await getHtml(catUrl('recent', 1));
  const list = html ? parseCards(html).slice(0, 20) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'recent';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const url = catUrl(tid, page);
  return buildList(url, page, LIMIT, isTagCat(tid));
}

// 从详情页提取 embed 页地址
function extractEmbed(html) {
  const m = html.match(/<iframe[^>]+src="([^"]*\/cn\/embed\/\d+\/?)"/);
  return m ? fixUrl(m[1]) : '';
}

// 从 embed 页提取播放器地址：优先 f4scdn（可解出 m3u8），其次其他
function extractPlayers(embedHtml) {
  const out = [];
  const re = /<div class="server-option[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(embedHtml)) !== null) {
    // 取完整 div 标签（含 data 属性）
    const end = embedHtml.indexOf('>', m.index);
    const tag = embedHtml.slice(m.index, end + 1);
    const nameM = tag.match(/data-name="([^"]*)"/);
    const name = nameM ? nameM[1] : '';
    const embedsM = tag.match(/data-embeds="([^"]+)"/);
    const embedM = tag.match(/data-embed="([^"]+)"/);
    if (embedsM) {
      const dec = b64dec(embedsM[1]);
      try {
        const arr = JSON.parse(dec);
        if (Array.isArray(arr)) arr.forEach(u => out.push({ name, url: u }));
      } catch (e) { /* ignore */ }
    } else if (embedM) {
      const dec = b64dec(embedM[1]);
      if (/^https?:\/\//.test(dec)) out.push({ name, url: dec });
    }
  }
  return out;
}

// f4 系 embed 页 -> api/play -> m3u8
async function resolveF4(embedUrl, referer) {
  const html = await getHtml(embedUrl, referer);
  if (!html) return '';
  const vidM = html.match(/data-video-id="([a-f0-9-]+)"/);
  if (!vidM) return '';
  const vid = vidM[1];
  const apiM = html.match(/data-api="([^"]+)"/);
  let host = 'https://f4scdn.com';
  try { host = new URL(embedUrl).origin; } catch (e) { /* ignore */ }
  const playApi = apiM
    ? (apiM[1].startsWith('/') ? host + apiM[1] : apiM[1])
    : `${host}/api/play/${vid}`;
  const srcUrl = `${playApi}?ab=0&r=${encodeURIComponent(referer || REFERER)}`;
  const j = await getJson(srcUrl, embedUrl);
  if (j && j.src && /^https?:\/\//.test(j.src)) return { url: j.src, origin: host };
  if (j && j.url && /^https?:\/\//.test(j.url)) return { url: j.url, origin: host };
  return '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const tm = html.match(/<title>([^<]*)<\/title>/);
  if (tm) name = clean(tm[1]).split('|')[0].trim();

  let pic = '';
  const pm = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (pm) pic = fixUrl(pm[1]);
  if (!pic) {
    const vm = html.match(/<video[^>]+poster="([^"]+)"/);
    if (vm) pic = fixUrl(vm[1]);
  }

  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: name,
      vod_play_from: 'JavHD.Today',
      vod_play_url: `正片$${durl}`,
    }],
  };
}

// 自有播放器 (stream*.javhdz.today/embed.php) -> embed.php?json=1 -> proxied m3u8
// 分片经站方服务器代理，无 Origin/IP 绑定，手机端友好
async function resolveSelfPlayer(playerUrl, referer) {
  const pM = String(playerUrl).match(/[?&]p=([^&]+)/);
  if (!pM) return '';
  let host = '';
  try { host = new URL(playerUrl).origin; } catch (e) { return ''; }
  const token = pM[1];
  // 依次试 next=0..2（每页一个源）
  for (let n = 0; n <= 2; n++) {
    const apiUrl = `${host}/embed.php?json=1&next=${n}&p=${encodeURIComponent(token)}`;
    const j = await getJson(apiUrl, referer);
    if (j && j.success && j.src && typeof j.src === 'string') {
      const src = j.src.startsWith('http') ? j.src : host + j.src;
      return { url: src, playerUrl, host };
    }
  }
  return '';
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const embedUrl = extractEmbed(html);
  if (!embedUrl) return { parse: 0, url: '' };

  const embedHtml = await getHtml(embedUrl, durl);
  if (!embedHtml) return { parse: 0, url: '' };
  const players = extractPlayers(embedHtml);
  if (!players.length) return { parse: 0, url: '' };

  // 1. 优先站方自有播放器 (javhdz.today) -> proxied m3u8，无 Origin/IP 绑定
  const selfPlayers = players.filter(p => /javhdz\.today\/embed\.php/i.test(p.url));
  for (const sp of selfPlayers) {
    const r = await resolveSelfPlayer(sp.url, embedUrl);
    if (r && r.url) {
      return {
        parse: 0,
        url: r.url,
        header: { 'User-Agent': UA, 'Referer': r.playerUrl },
      };
    }
  }

  // 2. f4 系 (m3u8 token 疑似绑定请求 IP，仅作降级)
  const f4 = players.find(p => /f4\w*\.com|f4scdn/i.test(p.url));
  if (f4) {
    const r = await resolveF4(f4.url, durl);
    if (r && r.url) {
      return {
        parse: 0,
        url: r.url,
        header: { 'User-Agent': UA, 'Referer': f4.url, 'Origin': r.origin },
      };
    }
  }
  // 3. 其他 embed 走嗅探
  const first = players[0];
  return { parse: 1, url: first.url, header: { 'User-Agent': UA, 'Referer': durl } };
}

async function search(reqIn) {
  // 搜索页为 JS 动态渲染，服务端拿不到结果
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 28, total: 0, list: [] };
  const url = `${CN}/search/video/?s=${encodeURIComponent(wd)}`;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit: 28, total: 0, list: [] };
  const list = parseCards(html);
  return { page, pagecount: page, limit: 28, total: list.length, list };
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
