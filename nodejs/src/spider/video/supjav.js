import req from '../../util/req.js';

const KEY = 'py_supjav';
const NAME = 'SupJav';
const HOST = 'https://supjav.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 走代理过 Cloudflare
const PROXY_BASE = 'https://py.fzcrym.link:1314';
const FS_PAGE_API = PROXY_BASE + '/fs?u=';
const PAGE_API = PROXY_BASE + '/page?u=';

const CATS = [
  ['__home', '最新'],
  ['__popular', '热门'],
  ['__trending', '趋势'],
  ['censored-jav', '有码 Censored'],
  ['uncensored-jav', '无码 Uncensored'],
  ['amateur', '素人 Amateur'],
  ['chinese-subtitles', '中文字幕 Chn Sub'],
  ['reducing-mosaic', '破解 Reducing Mosaic'],
  ['english-subtitles', '英文字幕 Eng Sub'],
];

const SORTS = [
  { key: 'sort', name: '排序', value: [{ n: '最新', v: '' }, { n: '最多观看', v: 'views' }] },
];

async function getText(url, timeout = 60000) {
  try {
    const { data } = await req.get(url, {
      headers: { 'User-Agent': UA },
      timeout,
    });
    return String(data || '');
  } catch (e) {
    return '';
  }
}

async function fetchPage(url, retries = 2) {
  const api = FS_PAGE_API + encodeURIComponent(url);
  for (let i = 0; i < Math.max(1, retries); i++) {
    const html = await getText(api, 220000);
    if (html && !html.includes('Just a moment') && html.length > 3000) return html;
  }
  // 兜底 Playwright 通道
  const api2 = PAGE_API + encodeURIComponent(url);
  const html = await getText(api2, 90000);
  if (html && !html.includes('Just a moment') && html.length > 3000) return html;
  return '';
}

function parseCards(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split('<div class="post">').slice(1);
  for (const b of blocks) {
    const m = b.match(new RegExp(`href="${HOST.replace(/\./g, '\\.')}/(\\d+)\\.html"`));
    if (!m) continue;
    const vid = m[1];
    if (seen.has(vid)) continue;
    const t = b.match(/title="([^"]+)"/);
    let title = t ? t[1] : '';
    title = title.replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;/g, '-').trim();
    if (!title) continue;
    seen.add(vid);
    let pic = '';
    for (const pat of [/<img[^>]+data-original="([^"]+)"/, /<img[^>]+data-src="([^"]+)"/, /<img[^>]+src="(https?:\/\/[^"]+)"/]) {
      const pm = b.match(pat);
      if (pm) { pic = pm[1]; break; }
    }
    if (pic.startsWith('//')) pic = 'https:' + pic;
    let code = '';
    const cm = title.match(/\b([A-Z]{2,6}-?\d{2,6}|FC2PPV[\s-]?\d{5,8})\b/);
    if (cm) code = cm[1];
    out.push({
      vod_id: vid,
      vod_name: title.slice(0, 90),
      vod_pic: pic,
      vod_remarks: code,
    });
  }
  return out;
}

function pagecount(html, cur) {
  const nums = [...String(html || '').matchAll(/\/page\/(\d+)/g)].map(x => parseInt(x[1], 10));
  if (!nums.length) return cur;
  return Math.max(...nums, cur);
}

async function init() {
  return {};
}

async function home() {
  const classes = CATS.map(([id, name]) => ({ type_id: id, type_name: name }));
  const filters = {};
  for (const [cid] of CATS) {
    if (!cid.startsWith('__')) filters[cid] = SORTS;
  }
  return { class: classes, filters };
}

async function homeVod() {
  const html = await fetchPage(HOST + '/');
  return { list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || '__home').trim();
  const ext = body.filters || body.extend || {};
  const sort = String(ext.sort || '').trim();
  let url;
  if (tid === '__home') {
    url = page === 1 ? HOST + '/' : `${HOST}/page/${page}/`;
  } else if (tid === '__popular') {
    url = page === 1 ? HOST + '/popular/' : `${HOST}/popular/page/${page}/`;
  } else if (tid === '__trending') {
    url = page === 1 ? HOST + '/trending/' : `${HOST}/trending/page/${page}/`;
  } else {
    const base = HOST + '/category/' + tid;
    url = page === 1 ? base + '/' : `${base}/page/${page}/`;
    if (sort) url += '?sort=' + encodeURIComponent(sort);
  }
  let html = await fetchPage(url);
  let items = parseCards(html);
  if (!items.length) {
    for (let i = 0; i < 2 && !items.length; i++) {
      html = await fetchPage(url, 2);
      items = parseCards(html);
    }
  }
  return { page, pagecount: pagecount(html, page), limit: items.length || 24, total: items.length, list: items };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  let vid = String(ids[0] || '');
  vid = (vid.split('/').pop().replace('.html', '').replace(/\D/g, '')) || vid;
  const durl = `${HOST}/${vid}.html`;
  const html = await fetchPage(durl);

  let title = '';
  const tm = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
  if (tm) {
    title = tm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-').trim();
  }
  let pic = '';
  const pm = html.match(/background-image:\s*url\((https:\/\/img\.supjav\.com\/[^)]+)\)/);
  if (pm) pic = pm[1];
  if (!pic) {
    const im = html.match(/(https:\/\/img\.supjav\.com\/[^\s"'<>)]+\.(?:jpg|jpeg|png|webp)[^\s"'<>)]*)/i);
    if (im) pic = im[1];
  }
  if (pic.startsWith('//')) pic = 'https:' + pic;

  let views = '';
  const vm = html.match(/<span class="views">([^<]+)<\/span>/);
  if (vm) views = vm[1].trim();

  const tags = [];
  const tagRe = new RegExp(`href="${HOST.replace(/\./g, '\\.')}/(tag|actress)/([^"/]+)`, 'g');
  let tg;
  while ((tg = tagRe.exec(html)) !== null) {
    const s = tg[2].replace(/-/g, ' ').trim();
    if (s && !tags.includes(s)) tags.push(s);
  }
  let year = '';
  const ym = html.match(/\/images\/(\d{4})\//);
  if (ym) year = ym[1];

  // 线路 data-link
  const links = [...html.matchAll(/data-link="([0-9a-f]{40,})"/g)].map(x => x[1]);
  const names = [...html.matchAll(/data-link="[0-9a-f]{40,}"[^>]*>([^<]{1,12})</g)].map(x => x[1].trim());
  const pairs = [];
  for (let i = 0; i < links.length; i++) {
    const nm = names[i] || ('线路' + (i + 1));
    pairs.push([nm, `正片$${vid}|${links[i]}`]);
  }
  const LINE_ORDER = { VOE: 0, FST: 10, ST: 20, TV: 90 };
  pairs.sort((a, b) => (LINE_ORDER[a[0].toUpperCase()] ?? 50) - (LINE_ORDER[b[0].toUpperCase()] ?? 50));
  const froms = pairs.map(p => p[0]);
  const urls = pairs.map(p => p[1]);

  let content = title;
  if (tags.length) content += '\n标签: ' + tags.slice(0, 10).join(', ');

  return { list: [{
    vod_id: vid,
    vod_name: title || ('SupJav ' + vid),
    vod_pic: pic,
    vod_year: year,
    vod_remarks: views,
    vod_content: content.slice(0, 600),
    vod_play_from: froms.length ? froms.join('$$$') : 'SupJav',
    vod_play_url: urls.length ? urls.join('$$$') : ('正片$' + vid + '|'),
  }]};
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '');
  // id 格式: vid|hex_link
  const parts = id.split('|');
  const vid = parts[0] || '';
  const hex = parts[1] || '';
  if (!hex) {
    return { parse: 0, url: '', message: '无播放线路' };
  }
  const LK_BASE = 'https://lk1.supremejav.com/supjav.php';
  const headers = { 'User-Agent': UA, 'Referer': `${HOST}/${vid}.html` };
  // 链路1: 直接反转 hex 试 ?c=
  try {
    const reversed = hex.split('').reverse().join('');
    const cUrl = `${LK_BASE}?c=${reversed}`;
    const cResp = await req.get(cUrl, { headers, timeout: 15000 });
    const cText = String(cResp.data || '');
    // 从返回中提取 m3u8
    const m3u8Match = cText.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    if (m3u8Match) {
      return { parse: 0, url: m3u8Match[1], header: headers };
    }
    // 如果返回的是 JSON，尝试解析
    try {
      const j = JSON.parse(cText);
      const u = j.url || j.file || j.source || j.m3u8;
      if (u) return { parse: 0, url: u, header: headers };
    } catch {}
  } catch {}
  // 链路2: 走 ?l=hex 拿 OLID 再反转
  try {
    const lUrl = `${LK_BASE}?l=${hex}`;
    const lResp = await req.get(lUrl, { headers, timeout: 15000 });
    const lText = String(lResp.data || '');
    // 提取 OLID (可能是 40 位 hex 或其他格式)
    const olidMatch = lText.match(/["']([0-9a-fA-F]{32,})["']/) || lText.match(/([0-9a-fA-F]{40,})/);
    if (olidMatch) {
      const olid = olidMatch[1];
      const reversed = olid.split('').reverse().join('');
      const cUrl2 = `${LK_BASE}?c=${reversed}`;
      const cResp2 = await req.get(cUrl2, { headers, timeout: 15000 });
      const cText2 = String(cResp2.data || '');
      const m3u8Match2 = cText2.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (m3u8Match2) {
        return { parse: 0, url: m3u8Match2[1], header: headers };
      }
    }
  } catch {}
  // 兜底：返回第一步让客户端嗅探
  const step1 = `${LK_BASE}?l=${hex}`;
  return {
    parse: 1,
    url: step1,
    header: headers,
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const kw = encodeURIComponent(wd);
  const url = page === 1 ? `${HOST}/?s=${kw}` : `${HOST}/page/${page}/?s=${kw}`;
  let html = await fetchPage(url);
  let items = parseCards(html);
  if (!items.length) {
    for (let i = 0; i < 2 && !items.length; i++) {
      html = await fetchPage(url, 2);
      items = parseCards(html);
    }
  }
  return { page, pagecount: pagecount(html, page), limit: items.length || 24, total: items.length, list: items };
}

export default function createSpider() {
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
