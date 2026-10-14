import req from '../../util/req.js';

const KEY = 'py_91duanju';
const NAME = '91成人短剧';
const HOST = 'https://91crdj.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_SIZE = 20;

function t(v) {
  return String(v == null ? '' : v).trim();
}

function headers(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': referer || HOST + '/',
  };
}

async function fetchHtml(url, referer) {
  try {
    const { data } = await req.get(url, { headers: headers(referer), timeout: 20000 });
    return String(data || '');
  } catch (e) {
    return '';
  }
}

function isVideoFormat(url) {
  const low = String(url || '').toLowerCase();
  return ['.m3u8', '.mp4', '.flv', '.ts'].some((k) => low.includes(k));
}

// 匹配 class 含 card 的 <a> 卡片
function parseList(html) {
  const items = [];
  if (!html) return items;
  const seen = {};
  const cardRe = /<a[^>]*\bclass\s*=\s*["'][^"']*\bcard\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html))) {
    const tag = m[0];
    const block = m[1];
    const hm = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hm) continue;
    const href = t(hm[1]);
    let p = href;
    try {
      const u = new URL(href, HOST);
      p = u.pathname;
    } catch (e) {}
    const seg = p.split('/').filter(Boolean);
    if (seg.length < 2) continue;
    const channel = seg[0];
    const vid = seg[1];
    if (seen[vid]) continue;

    let title = '';
    for (const attr of ['data-track-item-name', 'alt', 'title']) {
      const tm = (tag + block).match(new RegExp(attr + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
      if (tm && t(tm[1])) {
        title = t(tm[1]);
        break;
      }
    }
    if (!title) {
      const tm = block.match(/<span[^>]*class="[^"]*p-title[^"]*"[^>]*>([\s\S]*?)<\/span>/);
      if (tm) title = t(tm[1].replace(/<[^>]+>/g, ''));
    }
    if (!title) title = vid;

    let cover = '';
    for (const attr of ['data-original', 'data-src', 'data-echo', 'data-url']) {
      const im = block.match(new RegExp(attr + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
      if (im) {
        cover = t(im[1]);
        break;
      }
    }
    if (!cover) {
      const im = block.match(/<img[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
      if (im) cover = t(im[1]);
    }
    const low = cover.toLowerCase();
    if (['data:', 'load.gif', 'loading.gif', 'placeholder'].some((b) => low.includes(b))) cover = '';
    if (cover.startsWith('//')) cover = 'https:' + cover;
    else if (cover.startsWith('/')) cover = HOST + cover;

    let remarks = '';
    const rm = block.match(/<span[^>]*class="[^"]*(?:badge|eps-flag)[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    if (rm) remarks = t(rm[1].replace(/<[^>]+>/g, ''));

    seen[vid] = 1;
    items.push({
      vod_id: channel + '|' + p,
      vod_name: title,
      vod_pic: cover,
      vod_remarks: remarks,
    });
  }
  return items;
}

async function home() {
  return {
    class: [
      { type_id: 'duanju', type_name: '成人短剧' },
      { type_id: 'manju', type_name: '成人漫剧' },
      { type_id: 'zhenrenju', type_name: '真人剧' },
      { type_id: 'shipin', type_name: '成人视频' },
      { type_id: 'manhua', type_name: '成人漫画' },
      { type_id: 'xiaoshuo', type_name: '成人小说' },
    ],
    filters: {},
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'duanju');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const url = page > 1 ? `${HOST}/${tid}/page/${page}/` : `${HOST}/${tid}/`;
  const html = await fetchHtml(url, HOST + '/');
  const list = parseList(html);
  let pagecount = page + (list.length ? 1 : 0);
  let mx = 1;
  const re = /\/page\/(\d+)\//g;
  let mm;
  while ((mm = re.exec(html))) {
    const v = parseInt(mm[1], 10);
    if (v > mx) mx = v;
  }
  if (mx > 1) pagecount = mx;
  return { list, page, pagecount, limit: PAGE_SIZE, total: 999 };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { list: [], page, pagecount: page, limit: PAGE_SIZE, total: 0 };
  let url = `${HOST}/search/?q=${encodeURIComponent(wd)}`;
  if (page > 1) url += `&page=${page}`;
  const html = await fetchHtml(url);
  const list = parseList(html);
  return { list, page, pagecount: page + (list.length ? 1 : 0), limit: PAGE_SIZE, total: list.length };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of (ids || []).filter(Boolean)) {
    const rawStr = t(raw);
    let channel = '';
    let path = rawStr;
    if (rawStr.includes('|')) {
      const parts = rawStr.split('|');
      channel = parts[0];
      path = parts.slice(1).join('|');
    }
    const url = path.startsWith('http') ? path : HOST + path;
    const html = await fetchHtml(url, HOST + '/');
    if (!html) continue;

    let title = '';
    let tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (tm) title = t(tm[1].replace(/<[^>]+>/g, ''));
    if (!title) {
      tm = html.match(/<title>([\s\S]*?)<\/title>/);
      if (tm) title = t(tm[1].split(/[-_|]/)[0]);
    }

    let pic = '';
    for (const attr of ['data-original', 'data-src', 'data-echo', 'data-url']) {
      const pm = html.match(new RegExp(attr + '\\s*=\\s*["\']([^"\']+\\.(?:jpg|jpeg|png|webp)[^"\']*)["\']', 'i'));
      if (pm) {
        pic = t(pm[1]);
        break;
      }
    }
    if (!pic) {
      const pm = html.match(/<meta[^>]+og:image[^>]+content=["']([^"']+)["']/i);
      if (pm) pic = t(pm[1]);
    }
    if (pic.startsWith('//')) pic = 'https:' + pic;
    else if (pic.startsWith('/')) pic = HOST + pic;

    let intro = '';
    for (const pat of [
      /<meta[^>]+og:description[^>]+content=["']([^"']*)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    ]) {
      const im = html.match(pat);
      if (im && t(im[1])) {
        intro = t(im[1]);
        break;
      }
    }

    // 播放列表：集数链接
    const playUrls = [];
    const seen = {};
    const basePath = path.replace(/\/$/, '');
    const epRe = /href=["']([^"']+)["'][^>]*>\s*(\d+)\s*</g;
    let em;
    while ((em = epRe.exec(html))) {
      let href = t(em[1]);
      const epNo = t(em[2]);
      if (basePath && href.includes(basePath)) {
        if (href.startsWith('/')) href = HOST + href;
        if (seen[href]) continue;
        seen[href] = 1;
        playUrls.push(`第${epNo}集$${href}`);
      }
    }
    if (!playUrls.length) {
      const pmRe = /href=["']([^"']*(?:\/play\/|-\d+-\d+\.html)[^"']*)["']/g;
      while ((em = pmRe.exec(html))) {
        let href = t(em[1]);
        if (href.startsWith('/')) href = HOST + href;
        else if (!href.startsWith('http')) continue;
        if (seen[href]) continue;
        seen[href] = 1;
        playUrls.push(`播放$${href}`);
      }
    }

    list.push({
      vod_id: rawStr,
      vod_name: title,
      vod_pic: pic,
      vod_content: intro,
      vod_remarks: playUrls.length ? `共${playUrls.length}集` : '',
      vod_play_from: playUrls.length ? NAME : '',
      vod_play_url: playUrls.join('#'),
    });
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const raw = t(body.id);
  if (!raw) return { parse: 1, url: raw };
  if (isVideoFormat(raw)) {
    return { parse: 0, url: raw, header: { 'User-Agent': UA, Referer: HOST + '/' } };
  }
  const html = await fetchHtml(raw, HOST + '/');
  if (!html) return { parse: 1, url: raw };

  let m3u8Url = '';
  let m = html.match(/"current"\s*:\s*\{[^{}]*"src"\s*:\s*"([^"]+)"/);
  if (m) m3u8Url = m[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  if (!m3u8Url) {
    for (const v of ['player_aaaa', 'player_data']) {
      const vm = html.match(new RegExp(v + '\\s*=\\s*(\\{[^;]*\\})'));
      if (vm) {
        try {
          const data = JSON.parse(vm[1]);
          m3u8Url = data.url || data.link || '';
          if (m3u8Url) break;
        } catch (e) {}
      }
    }
  }
  if (!m3u8Url) {
    const um = html.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/);
    if (um) m3u8Url = um[1];
  }
  if (m3u8Url) {
    if (m3u8Url.startsWith('//')) m3u8Url = 'https:' + m3u8Url;
    else if (m3u8Url.startsWith('/')) m3u8Url = HOST + m3u8Url;
    return { parse: 0, url: m3u8Url, header: { 'User-Agent': UA, Referer: raw } };
  }
  return { parse: 1, url: raw, header: { 'User-Agent': UA, Referer: HOST + '/' } };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
