// 橙果短剧 - CatPawOpen 格式
// 转换自 REX forward.chengguo.tut，站点 https://chengguodj.com (Nuxt.js)
import req from '../../util/req.js';

const KEY = 'py_chengguo';
const NAME = '橙果短剧';
const SITE = 'https://chengguodj.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

const CATS = [
  { type_id: 'yuanchuang', type_name: '原创短剧' },
  { type_id: 'mogai', type_name: '魔改短剧' },
  { type_id: 'manju', type_name: '漫剧' },
  { type_id: 'zhenren', type_name: '真人短剧' },
  { type_id: 'aiduanju', type_name: 'AI短剧' },
  { type_id: 'browse', type_name: '片库索引' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function absUrl(u) {
  u = t(u).replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/\\/g, '');
  if (!u) return '';
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.indexOf('http') === 0) return u;
  if (u.charAt(0) === '/') return SITE + u;
  return SITE + '/' + u;
}

function b64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function proxyImg(raw) {
  raw = absUrl(raw);
  if (!raw) return '';
  if (raw.indexOf(SITE + '/_img/') === 0) return raw;
  try {
    return SITE + '/_img/' + b64UrlEncode(raw);
  } catch (e) {
    return raw;
  }
}

async function fetchHtml(url) {
  const { data } = await req.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': SITE + '/',
    },
    timeout: 20000,
  });
  return String(data || '');
}

function parseNuxtArr(html) {
  const m = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(t(m[1])); } catch (e) { return null; }
}

function nuxtVal(arr, idx) {
  if (typeof idx === 'number' && idx >= 0 && idx < arr.length) return arr[idx];
  return idx;
}

function extractList(html) {
  const arr = parseNuxtArr(html);
  if (!arr || !arr.length) return [];
  const items = [];
  const seen = {};
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    if (!('title' in item)) continue;
    if (!('slug' in item) && !('detail_route' in item)) continue;
    let title = nuxtVal(arr, item.title);
    if (!title || typeof title !== 'string') continue;
    title = t(title);
    if (!title) continue;
    let dramaPath = nuxtVal(arr, item.detail_route);
    if (!dramaPath || typeof dramaPath !== 'string') {
      const slug = nuxtVal(arr, item.slug);
      if (slug && typeof slug === 'string') dramaPath = '/drama/' + slug;
    }
    if (!dramaPath || typeof dramaPath !== 'string') continue;
    dramaPath = t(dramaPath);
    if (seen[dramaPath]) continue;
    seen[dramaPath] = 1;
    let pic = '';
    const coverObj = nuxtVal(arr, item.cover);
    if (coverObj && typeof coverObj === 'object') {
      const rawU = nuxtVal(arr, coverObj.url);
      if (rawU && typeof rawU === 'string') pic = rawU;
    }
    const eps = nuxtVal(arr, item.total_episode_count) || nuxtVal(arr, item.published_episode_count);
    const remarks = (typeof eps === 'number' && eps) ? '全' + eps + '集' : '';
    items.push({
      vod_id: 'cg:' + dramaPath,
      vod_name: title,
      vod_pic: proxyImg(pic),
      vod_remarks: remarks,
    });
  }
  return items;
}

function catUrl(tid, page) {
  page = parseInt(page, 10) || 1;
  if (page <= 1) return SITE + '/' + tid;
  return SITE + '/' + tid + '/page-' + page;
}

async function home() {
  return { class: CATS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || 'yuanchuang');
  const page = Math.max(1, parseInt(body.page) || 1);
  const html = await fetchHtml(catUrl(id, page));
  const list = extractList(html);
  return { page, pagecount: list.length ? page + 1 : page, list };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, parseInt(body.page) || 1);
  if (!kw) return { list: [] };
  const url = SITE + '/search?keyword=' + encodeURIComponent(kw) + (page > 1 ? '&page=' + page : '');
  const html = await fetchHtml(url);
  return { page, pagecount: page, list: extractList(html) };
}

async function resolvePlay(playPath) {
  const url = absUrl(playPath);
  const html = await fetchHtml(url);
  const arr = parseNuxtArr(html);
  if (arr) {
    for (const v of arr) {
      if (typeof v === 'string' && v.indexOf('.m3u8') >= 0 && v.indexOf('http') === 0) {
        return v.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
      }
    }
  }
  const m = html.match(/["'](https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)["']/i);
  if (m) return m[1].replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
  return '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  id = id.replace(/^cg:/, '');
  if (!id) return { list: [] };
  const detailUrl = absUrl(id);
  const html = await fetchHtml(detailUrl);
  let title = '';
  const tm = html.match(/<title>([^<]+)<\/title>/i);
  if (tm) title = t(tm[1].split('-')[0]).replace(/在线观看/g, '').trim();
  if (!title) title = id;
  const slug = id.replace(/\/+$/, '').split('/').pop();
  // 解析分集
  const episodes = [];
  const arr = parseNuxtArr(html);
  if (arr) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      if (!('total_episode_count' in item)) continue;
      const tot = nuxtVal(arr, item.total_episode_count);
      if (typeof tot === 'number' && tot > 0) {
        for (let ep = 1; ep <= tot; ep++) {
          episodes.push({ name: '第' + ep + '集', path: '/play/' + slug + '/' + ep });
        }
        break;
      }
    }
  }
  if (!episodes.length) {
    const links = html.match(/href=["'](\/play\/[^"']+)["']/gi) || [];
    const seen = {};
    for (const l of links) {
      const hm = l.match(/href=["'](\/play\/[^"']+)["']/i);
      if (!hm || seen[hm[1]]) continue;
      seen[hm[1]] = 1;
      const num = hm[1].split('/').pop();
      episodes.push({ name: /^\d+$/.test(num) ? '第' + num + '集' : num, path: hm[1] });
    }
  }
  const playFrom = [];
  const playUrls = [];
  if (episodes.length) {
    playFrom.push('橙果');
    playUrls.push(episodes.map(ep => ep.name + '$' + JSON.stringify({ path: ep.path })).join('#'));
  }
  return {
    list: [{
      vod_id: 'cg:' + id,
      vod_name: title,
      vod_pic: '',
      vod_play_from: playFrom.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  let payload = null;
  try { payload = JSON.parse(id); } catch (e) {}
  if (!payload || !payload.path) return { parse: 0, url: '' };
  const url = await resolvePlay(payload.path);
  if (!url) return { parse: 0, url: '' };
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': SITE + '/' },
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
