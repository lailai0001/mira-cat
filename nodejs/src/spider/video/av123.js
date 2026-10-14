import req from '../../util/req.js';

const KEY = 'py_av123';
const NAME = '123AV';
const HOST = 'https://123av.com';
const LANG = 'cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const PAGE_SIZE = 20;

function t(v) {
  return String(v == null ? '' : v).trim();
}

function headers() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': HOST + '/' + LANG + '/',
  };
}

async function fetchHtml(path) {
  const url = path.startsWith('http') ? path : HOST + path;
  const { data } = await req.get(url, { headers: headers(), timeout: 20000 });
  return String(data || '');
}

function cfBlocked(html) {
  return html.indexOf('Just a moment') >= 0 || html.indexOf('cf-browser-verification') >= 0;
}

function hiResCover(url) {
  url = t(url);
  if (!url) return '';
  return url.replace(/\/s360\//, '/s1080/');
}

// 从 REX parseList 移植：card__link + 标题，往前找 card__img 封面，card__dur 时长
function parseList(html) {
  const items = [];
  const seen = {};
  const re = /<a class="card__link" href="(\/(?:cn|en)\/v\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const link = m[1];
    if (seen[link]) continue;
    seen[link] = 1;
    let title = t(m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' '));
    if (!title) title = link.split('/').pop();

    let pic = '';
    let dur = '';
    const windowStart = Math.max(0, m.index - 1200);
    const chunk = html.slice(windowStart, m.index + 20);
    const im = chunk.match(
      /class="card__img"[^>]+src="([^"]+)"|src="([^"]+)"[^>]+class="card__img"/
    );
    if (im) pic = im[1] || im[2] || '';
    if (!pic) {
      const im2 = chunk.match(
        /(?:src|data-src)="(https?:\/\/[^"]+\/(?:s360|s500|s1080)\/[^"]+)"/i
      );
      if (im2) pic = im2[1];
    }
    const dm = chunk.match(/class="card__dur"[^>]*>([^<]+)</);
    if (dm) dur = t(dm[1]);

    items.push({
      vod_id: 'javxx:' + link,
      vod_name: title,
      vod_pic: hiResCover(pic),
      vod_remarks: dur,
    });
  }

  // 兜底：只有封面链接
  if (!items.length) {
    const re2 = /href="(\/(?:cn|en)\/v\/[^"]+)"[\s\S]{0,400}?class="card__img"[^>]+src="([^"]+)"/gi;
    while ((m = re2.exec(html))) {
      if (seen[m[1]]) continue;
      seen[m[1]] = 1;
      items.push({
        vod_id: 'javxx:' + m[1],
        vod_name: m[1].split('/').pop(),
        vod_pic: hiResCover(m[2]),
        vod_remarks: '',
      });
    }
  }
  // 再兜底：card__cover href
  if (!items.length) {
    const re3 = /class="card__cover"[^>]*href="(\/(?:cn|en)\/v\/[^"]+)"[\s\S]{0,500}?class="card__img"[^>]+src="([^"]+)"/gi;
    while ((m = re3.exec(html))) {
      if (seen[m[1]]) continue;
      seen[m[1]] = 1;
      items.push({
        vod_id: 'javxx:' + m[1],
        vod_name: m[1].split('/').pop(),
        vod_pic: hiResCover(m[2]),
        vod_remarks: '',
      });
    }
  }
  return items;
}

function unescapeJsonish(s) {
  s = String(s || '');
  s = s.replace(/\\u0022/g, '"').replace(/\\u0027/g, "'");
  s = s.replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>');
  let prev;
  do {
    prev = s;
    s = s.replace(/\\\//g, '/');
  } while (s !== prev);
  return s;
}

function extractEmbeds(html) {
  const embeds = [];
  const m = html.match(/player\(\s*JSON\.parse\(\s*(['"])([\s\S]*?)\1\s*\)/);
  if (m) {
    const s = unescapeJsonish(m[2]);
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        arr.forEach((it) => {
          if (it && it.url) {
            const u = unescapeJsonish(String(it.url));
            let nm = t(it.name);
            if (!nm || /^\d+$/.test(nm)) nm = '线路' + (embeds.length + 1);
            embeds.push({ name: nm, url: u });
          }
        });
      }
    } catch (e) {}
  }
  if (!embeds.length) {
    const em2 = html.match(/https?:\/\/[^"'\\\s]+\/e\/[A-Za-z0-9]+/g) || [];
    em2.forEach((u, i) => {
      embeds.push({ name: '线路' + (i + 1), url: unescapeJsonish(u) });
    });
  }
  return embeds;
}

function playHeadersForEmbed(embedUrl) {
  embedUrl = t(embedUrl);
  let origin = 'https://jav-master-52.site';
  const m = embedUrl.match(/^(https?:\/\/[^/]+)/);
  if (m) origin = m[1];
  return {
    'User-Agent': UA,
    'Referer': origin + '/',
    'Origin': origin,
    'Accept': '*/*',
  };
}

async function resolveStream(embedUrl) {
  embedUrl = t(embedUrl);
  if (!embedUrl) return '';
  const idm = embedUrl.match(/\/e\/([A-Za-z0-9]+)/);
  if (!idm) return '';
  const eid = idm[1];
  const originM = embedUrl.match(/^(https?:\/\/[^/]+)/);
  const origin = originM ? originM[1] : '';
  const streamApi = origin + '/stream?id=' + encodeURIComponent(eid);
  try {
    const { data } = await req.get(streamApi, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': embedUrl,
        'Origin': origin,
      },
      timeout: 20000,
    });
    let body = data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return '';
      }
    }
    return t((body && body.media && body.media.stream) || (body && body.stream) || '');
  } catch (e) {
    return '';
  }
}

function parsePath(vodId) {
  let link = t(vodId);
  if (link.indexOf('javxx:') === 0) link = link.slice(6);
  if (link.indexOf('http') === 0) {
    const m = link.match(/https?:\/\/[^/]+(\/.*)/);
    if (m) link = m[1];
  }
  return link;
}

async function init() {
  return {};
}

async function home() {
  return {
    class: [
      { type_id: 'new', type_name: '新发布' },
      { type_id: 'hot', type_name: '热门' },
      { type_id: 'recent', type_name: '最近更新' },
      { type_id: 'censored', type_name: '有码' },
      { type_id: 'uncensored', type_name: '无码' },
      { type_id: 'uncensored-leaked', type_name: '无码泄露' },
      { type_id: 'genres', type_name: '类别' },
      { type_id: 'actresses', type_name: '女演员' },
      { type_id: 'makers', type_name: '制作商' },
      { type_id: 'series', type_name: '系列' },
    ],
    filters: {},
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'new');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const path = '/' + LANG + '/' + tid;
  const urlPath = page > 1 ? path.replace(/\/$/, '') + '?page=' + page : path;
  const html = await fetchHtml(urlPath);
  if (cfBlocked(html)) {
    return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [], msg: 'Cloudflare 拦截' };
  }
  const list = parseList(html);
  return {
    page,
    pagecount: 999,
    limit: list.length,
    total: 999 * PAGE_SIZE,
    list,
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [] };
  const path =
    '/' + LANG + '/search?keyword=' + encodeURIComponent(wd) + (page > 1 ? '&page=' + page : '');
  const html = await fetchHtml(path);
  if (cfBlocked(html)) {
    return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [], msg: 'Cloudflare 拦截' };
  }
  const list = parseList(html);
  return {
    page,
    pagecount: 999,
    limit: list.length,
    total: 999 * PAGE_SIZE,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const rawId of (ids || []).filter(Boolean)) {
    const path = parsePath(rawId);
    if (!path) continue;
    const html = await fetchHtml(path);
    if (cfBlocked(html)) continue;

    // 片名：h1 优先，不要用线路名
    let title = path.split('/').pop() || path;
    const hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (hm) title = t(hm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' '));
    if (!title || title === '1') {
      const og = html.match(/og:title["']\s+content=["']([^"']+)/i);
      if (og) title = t(og[1]);
    }

    let cover = '';
    const bm = html.match(
      /background-image:\s*url\(['"]?(https?:\/\/icdn\.123av\.me\/[^)'"\s]+)/i
    );
    if (bm) cover = bm[1];
    if (!cover) {
      const cm2 = html.match(
        /https?:\/\/icdn\.123av\.me\/img2\/s(?:500|1080)\/[^"'\s\)]+cover\.jpg[^"'\s\)]*/i
      );
      if (cm2) cover = cm2[0];
    }
    if (!cover) {
      const cm3 = html.match(
        /https?:\/\/icdn\.123av\.me\/img2\/s360\/[^"'\s\)]+cover\.jpg[^"'\s\)]*/i
      );
      if (cm3) cover = cm3[0].replace('/s360/', '/s500/');
    }
    cover = t(cover).replace(/[)'"]+$/, '');

    // REX 模式：detail 时直接 resolve 到 m3u8 真实地址（逐个线路尝试）
    const embeds = extractEmbeds(html);
    let streamUrl = '';
    let embedOrigin = '';
    for (const e of embeds) {
      try {
        const s = await resolveStream(e.url);
        if (s) {
          streamUrl = s;
          const om = String(e.url).match(/^(https?:\/\/[^/]+)/);
          embedOrigin = om ? om[1] : '';
          break;
        }
      } catch (err) {}
    }
    // vod_play_url 放 JSON{url, origin}：m3u8 有 Referer 检查，必须用 embed 源站的 Referer/Origin 才能 200
    const vodPlayUrl = streamUrl
      ? `播放$${JSON.stringify({ url: streamUrl, origin: embedOrigin })}`
      : embeds.map((e) => `${e.name}$${JSON.stringify({ url: e.url, embed: 1 })}`).join('#');

    list.push({
      vod_id: 'javxx:' + path,
      vod_name: title,
      vod_pic: cover,
      vod_play_from: NAME,
      vod_play_url: vodPlayUrl,
    });
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const raw = t(id);
  if (!raw) return { parse: 0, url: '' };

  // 解析 vod_play_url 的 JSON 负载
  let payload = null;
  if (raw.startsWith('{')) {
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      payload = null;
    }
  }

  // 情形1：detail 已 resolve 到 m3u8（带 origin）
  if (payload && payload.url && /\.m3u8(\?|$)/i.test(payload.url)) {
    const origin = t(payload.origin);
    const header = origin
      ? { 'User-Agent': UA, Referer: origin + '/', Origin: origin, Accept: '*/*' }
      : { 'User-Agent': UA, Referer: HOST + '/' + LANG + '/' };
    return { parse: 0, url: payload.url, header };
  }

  // 情形2：纯 m3u8 字符串（兼容旧格式）
  if (/\.m3u8(\?|$)/i.test(raw)) {
    return {
      parse: 0,
      url: raw,
      header: { 'User-Agent': UA, Referer: HOST + '/' + LANG + '/' },
    };
  }

  // 情形3：仍是 embed 地址则实时解析
  const embedUrl = payload && payload.url ? payload.url : raw;
  const stream = await resolveStream(embedUrl);
  if (!stream) return { parse: 0, url: '', message: '未获取到播放地址' };
  return {
    parse: 0,
    url: stream,
    header: playHeadersForEmbed(embedUrl),
  };
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
