import req from '../../util/req.js';

// JavHD (py_javhd)
// 站点: https://javhd.icu/ (WordPress JAV 站，无反爬)
// 列表: GET /[/page/N/] 或 /categories/{slug}/[/page/N/]  18 条/页
// 搜索: GET /?s={kw}[/page/N/?s={kw}]  18 条/页
// 详情: GET /video/{slug}/  提取 iframe (vidara.to/dstyladsg.com) 的 filecode
// 播放: POST https://{host}/api/stream {filecode,device,codecs} -> streaming_url (m3u8 720p, token 时效短, 实时获取)

const KEY = 'py_javhd';
const NAME = 'JavHD';
const SITE = 'https://javhd.icu';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 5 个真实分类 (2026-10-20 从首页导航实测)
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'censored', type_name: '有码' },
  { type_id: 'jav-hd-uncen', type_name: '无码' },
  { type_id: 'jav-hd-engsub', type_name: '英字' },
  { type_id: 'jav-hd-uncensored-leaked', type_name: '无码流出' },
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
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
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

async function postJson(url, body, referer) {
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Referer': referer || REFERER,
    'Origin': SITE,
  };
  const payload = JSON.stringify(body);
  // 通道1: 框架 req
  try {
    const { data, status } = await req.post(url, payload, { headers, timeout: 25000 });
    if (status === 200 && data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { method: 'POST', headers, body: payload });
    if (r.ok) return await r.json();
  } catch (e) { /* ignore */ }
  return null;
}

// 解析列表卡片: div.item-img > a[href="/video/{slug}/"] > img[src,alt]
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<div class="item-img">\s*<a href="(https?:\/\/javhd\.icu\/video\/[^"]+\/)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = m[1];
    if (seen.has(durl)) continue;
    seen.add(durl);
    const win = html.slice(m.index, m.index + 2000);
    const imgTag = win.match(/<img[^>]+>/)?.[0] || '';
    const srcM = imgTag.match(/\ssrc="([^"]+)"/);
    const altM = imgTag.match(/\salt="([^"]*)"/);
    const pic = srcM ? srcM[1] : '';
    let title = altM ? altM[1] : '';
    if (!title) {
      const h3M = win.match(/class="post-title[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);
      if (h3M) title = h3M[1];
    }
    out.push({
      vod_id: durl,
      vod_name: clean(title) || durl.split('/video/')[1].replace(/\/$/, ''),
      vod_pic: fixUrl(pic),
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const pages = [...html.matchAll(/\/page\/(\d+)\//g)].map(x => parseInt(x[1], 10));
  const nums = pages.filter(n => n > 0 && n < 100000);
  return nums.length ? Math.max(...nums) : 1;
}

async function buildList(url, page, limit) {
  limit = limit || 18;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

function catUrl(tid, page) {
  let base;
  if (tid === 'latest') base = SITE + '/';
  else base = SITE + '/categories/' + encodeURIComponent(tid) + '/';
  if (page > 1) return base + 'page/' + page + '/';
  return base;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(SITE + '/');
  const list = html ? parseCards(html) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  return buildList(catUrl(tid, page), page, 18);
}

// 从详情页提取播放器 iframe 的 host + filecode
function extractPlayer(html) {
  const m = html.match(/<iframe[^>]+src="(https?:\/\/[^"/]+)\/e\/([A-Za-z0-9]+)"[^>]*>/);
  if (m) return { host: m[1], filecode: m[2] };
  const m2 = html.match(/(https?:\/\/[^"/\s]+)\/e\/([A-Za-z0-9]{6,})/);
  if (m2) return { host: m2[1], filecode: m2[2] };
  return null;
}

// 调播放 API 获取 m3u8 (token 时效短，必须实时调用)
async function fetchStreamUrl(host, filecode, referer) {
  const apiUrl = host.replace(/\/$/, '') + '/api/stream';
  const resp = await postJson(apiUrl, {
    filecode,
    device: 'web',
    codecs: ['h264'],
  }, referer);
  if (resp && resp.streaming_url && /^https?:\/\//.test(resp.streaming_url)) {
    return resp.streaming_url;
  }
  return '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/^\//, ''));

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = titleM ? clean(titleM[1]) : durl.split('/video/')[1].replace(/\/$/, '');

  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (picM) pic = fixUrl(picM[1]);

  let remarks = '';
  const durM = html.match(/(\d+)\s*min/i);
  if (durM) remarks = durM[1] + '分钟';

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_content: name,
      vod_play_from: 'JavHD',
      vod_play_url: `${remarks || '正片'}$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/^\//, ''));
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const player = extractPlayer(html);
  if (!player) return { parse: 0, url: '' };
  const streamUrl = await fetchStreamUrl(player.host, player.filecode, durl);
  if (!streamUrl) return { parse: 0, url: '' };
  return {
    parse: 0,
    url: streamUrl,
    header: { 'User-Agent': UA, 'Referer': player.host + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 18, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url = SITE + '/page/' + page + '/?s=' + encodeURIComponent(wd);
  return buildList(url, page, 18);
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
