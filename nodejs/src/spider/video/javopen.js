import req from '../../util/req.js';

// JavOpen (py_javopen)
// 站点: https://javopen.co/ (WordPress JAV 站)
// 列表: GET /{slug}/[/page/N/]  slug: jav-censored/jav-uncensored/mgstage/amatuer-porn/asia-uncensored-hd/fc3ppv/usa-euro
// 搜索: GET /?s={kw}
// 详情: GET /video/{slug}/  提取 iframe (vidaraa.cc/e/{filecode})
// 播放: POST https://vidaraa.cc/api/stream {filecode,device,codecs} -> streaming_url (m3u8, token 时效短, 实时获取)

const KEY = 'py_javopen';
const NAME = 'JavOpen';
const SITE = 'https://javopen.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 7 个真实分类 (2026-10-20 从首页导航实测；另有2个为外部站已剔除)
const CATS = [
  { type_id: 'jav-censored', type_name: 'JAV有码' },
  { type_id: 'jav-uncensored', type_name: 'JAV无码' },
  { type_id: 'mgstage', type_name: 'MGSTAGE' },
  { type_id: 'amatuer-porn', type_name: '素人' },
  { type_id: 'asia-uncensored-hd', type_name: '亚洲无码' },
  { type_id: 'fc3ppv', type_name: 'OnlyFans' },
  { type_id: 'usa-euro', type_name: '欧美' },
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

async function getHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
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

async function postJson(url, body, referer) {
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Referer': referer || REFERER,
  };
  const payload = JSON.stringify(body);
  try {
    const { data, status } = await req.post(url, payload, { headers, timeout: 25000 });
    if (status === 200 && data) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { method: 'POST', headers, body: payload });
    if (r.ok) return await r.json();
  } catch (e) { /* ignore */ }
  return null;
}

// 解析视频卡片: a[href="/video/{slug}/"] > img[src|data-src,alt] + h3 > a 标题
// 注意: 站点用 perfmatters 懒加载，从第5张开始 src 是空白 SVG 占位图，真实地址在 data-src
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(https?:\/\/javopen\.co\/video\/[^"]+\/)"[^>]*>\s*<img([^>]+)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const durl = m[1];
    if (seen.has(durl)) continue;
    seen.add(durl);
    const imgTag = m[2];
    // 优先 data-src（懒加载真实地址），其次 src（排除 data:image 占位图）
    let pic = '';
    const dsrcM = imgTag.match(/data-src="([^"]+)"/);
    if (dsrcM) pic = dsrcM[1];
    else {
      const srcM = imgTag.match(/src="([^"]+)"/);
      if (srcM && !srcM[1].startsWith('data:')) pic = srcM[1];
    }
    const altM = imgTag.match(/alt="([^"]*)"/);
    let title = clean(altM ? altM[1] : '');
    // 尝试从后面的 h3 取完整标题
    const win = html.slice(m.index, m.index + 3000);
    const h3M = win.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/);
    if (h3M && clean(h3M[1]).length > title.length) title = clean(h3M[1]);
    out.push({
      vod_id: durl,
      vod_name: title || durl.split('/video/')[1].replace(/\/$/, ''),
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
  limit = limit || 20;
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
  const html = await getHtml(SITE + '/jav-censored/');
  const list = html ? parseCards(html).slice(0, 20) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'jav-censored';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = `${SITE}/${encodeURIComponent(tid)}/`;
  if (page > 1) url += `page/${page}/`;
  return buildList(url, page, 20);
}

function extractPlayer(html) {
  // 方式1: <textarea id="raw-payload"> Base64 编码的 iframe（2026-10-20 实测，tape=1~4 各不同）
  const rawM = html.match(/<textarea[^>]*id="raw-payload"[^>]*>([^<]+)<\/textarea>/);
  if (rawM) {
    try {
      let b64 = rawM[1].trim();
      // Node 和浏览器兼容的 base64 解码
      let dec = '';
      if (typeof Buffer !== 'undefined') {
        dec = Buffer.from(b64, 'base64').toString('utf-8');
      } else {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dec = new TextDecoder().decode(bytes);
      }
      const srcM = dec.match(/src="([^"]+)"/i);
      if (srcM) {
        const url = srcM[1];
        // vidaraa.cc/e/{filecode} 或 bysewihe.com/e/{filecode} 走 api/stream
        const vm = url.match(/https?:\/\/([^"/]+)\/e\/([A-Za-z0-9]+)/);
        if (vm) return { host: 'https://' + vm[1], filecode: vm[2], embedUrl: url };
        // 其他 embed 直接返回，由 MiraPlayer 嗅探
        return { host: '', filecode: '', embedUrl: url };
      }
    } catch (e) { /* 继续方式2 */ }
  }
  // 方式2: 直接的 iframe 标签
  const m = html.match(/<iframe[^>]+src="(https?:\/\/[^"/]+)\/e\/([A-Za-z0-9]+)"/);
  if (m) return { host: m[1], filecode: m[2], embedUrl: m[0] };
  const m2 = html.match(/(https?:\/\/[^"/\s]+)\/e\/([A-Za-z0-9]{6,})/);
  if (m2) return { host: m2[1], filecode: m2[2], embedUrl: '' };
  return null;
}

async function fetchStreamUrl(host, filecode, referer) {
  const apiUrl = host.replace(/\/$/, '') + '/api/stream';
  const resp = await postJson(apiUrl, { filecode, device: 'web', codecs: ['h264'] }, referer);
  if (resp && resp.streaming_url && /^https?:\/\//.test(resp.streaming_url)) {
    return resp.streaming_url;
  }
  return '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/^\/+/, ''));

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = titleM ? clean(titleM[1]) : durl.split('/video/')[1].replace(/\/$/, '');

  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (picM) pic = fixUrl(picM[1]);

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: name,
      vod_play_from: 'JavOpen',
      vod_play_url: `正片$${durl}`,
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
  const durl = /^https?:\/\//.test(id) ? id : (SITE + '/video/' + id.replace(/^\/+/, ''));
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const player = extractPlayer(html);
  if (!player) return { parse: 0, url: '' };
  // vidaraa/bysewihe 系：调 api/stream 拿 m3u8 直链
  if (player.host && player.filecode) {
    const streamUrl = await fetchStreamUrl(player.host, player.filecode, durl);
    if (streamUrl) {
      return {
        parse: 0,
        url: streamUrl,
        header: { 'User-Agent': UA, 'Referer': player.host + '/' },
      };
    }
  }
  // 其他 embed（如 morencius/loadvid）：走嗅探
  if (player.embedUrl) {
    return { parse: 1, url: player.embedUrl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  return { parse: 0, url: '' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
  return buildList(url, page, 20);
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
