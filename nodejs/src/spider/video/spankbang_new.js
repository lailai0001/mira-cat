import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const KEY = 'py_spankbang_new';
const NAME = 'Eporner';
const HOST = 'https://www.eporner.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function headers(referer) {
  return {
    'User-Agent': UA,
    'Referer': referer || HOST + '/',
    'Cookie': 'age_verified=1',
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

// 静态分类（从首页提取的热门分类，避免每次请求首页）
const CLASSES = [
  { type_id: '/cat/japanese/', type_name: '日本' },
  { type_id: '/cat/anal/', type_name: '肛交' },
  { type_id: '/cat/pov-porn/', type_name: 'POV' },
  { type_id: '/cat/indian/', type_name: '印度' },
  { type_id: '/cat/milf/', type_name: 'MILF' },
  { type_id: '/cat/hentai/', type_name: 'Hentai' },
  { type_id: '/cat/bbw/', type_name: 'BBW' },
  { type_id: '/cat/pinay/', type_name: '菲律宾' },
  { type_id: '/cat/amateur/', type_name: '业余' },
  { type_id: '/cat/asian/', type_name: '亚洲' },
  { type_id: '/cat/teen/', type_name: '少女' },
  { type_id: '/cat/big-tits/', type_name: '巨乳' },
  { type_id: '/cat/blowjob/', type_name: '口交' },
  { type_id: '/cat/creampie/', type_name: '内射' },
  { type_id: '/cat/threesome/', type_name: '3P' },
  { type_id: '/cat/lesbian/', type_name: '女同' },
];

function parseList(html) {
  const list = [];
  if (!html) return list;
  const $ = cheerio.load(html);
  $('div.mb.hdy').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('p.mbtit a').first();
    const href = $a.attr('href') || '';
    const title = $a.text().trim() || $el.find('div.mbimg img').attr('alt') || '';
    if (!href || !title) return;
    const pic = $el.find('div.mbimg img').attr('src') || '';
    const quality = $el.find('div.mvhdico span').text().trim() || '';
    const duration = $el.find('div.mvtime').text().trim() || '';
    list.push({
      vod_id: href,
      vod_name: title,
      vod_pic: pic.startsWith('http') ? pic : (pic ? 'https:' + pic : ''),
      vod_remarks: [quality, duration].filter(Boolean).join(' '),
    });
  });
  return list;
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  const html = await getHtml(HOST + '/');
  return { list: parseList(html).slice(0, 20) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let page = parseInt(body.page, 10) || 1;
  if (page < 1) page = 1;
  const tid = String(body.id || CLASSES[0].type_id);
  let url = HOST + tid;
  if (page > 1) url += page + '/';
  const html = await getHtml(url);
  const list = parseList(html);
  return { page, pagecount: 999, limit: list.length || 30, total: 999 * 30, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const vid = String(body.id || '').trim();
  if (!vid) return { list: [] };
  const url = vid.startsWith('http') ? vid : HOST + vid;
  let html = '';
  try {
    const { data } = await req.get(url, { headers: headers(HOST + '/'), timeout: 20000 });
    html = String(data || '');
  } catch (e) {
    return { list: [] };
  }
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
  const pic = $('meta[property="og:image"]').attr('content') || '';

  // 提取多清晰度 mp4 直链（只保留 720P 及以下，高清多为 AV1 编码 iOS 播不了）
  const quals = [];
  const seen = new Set();
  const re = /(\/dload\/[^"']+\.mp4)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const dl = m[1];
    if (seen.has(dl)) continue;
    seen.add(dl);
    // 从路径提取清晰度，如 /dload/xxx/1080/xxx-1080p.mp4
    const qm = dl.match(/\/(\d+)\/[^/]*-(\d+)p/);
    const qnum = qm ? parseInt(qm[2], 10) : 0;
    if (qnum > 720) continue; // 跳过 720P 以上的
    const q = qm ? qm[2] + 'P' : 'MP4';
    quals.push({ q: qnum, name: q, url: HOST + dl });
  }
  // 按清晰度降序
  quals.sort((a, b) => b.q - a.q);
  const playUrl = quals.map(x => `${x.name}$${x.url}`).join('#') || '';

  if (!title && !playUrl) return { list: [] };
  return {
    list: [{
      vod_id: vid,
      vod_name: title || vid,
      vod_pic: pic,
      vod_play_from: NAME,
      vod_play_url: playUrl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '').trim();
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': HOST + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  let page = parseInt(body.page, 10) || 1;
  if (page < 1) page = 1;
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  // /search/ 会 301 跳到 /tag/
  let url = `${HOST}/tag/${encodeURIComponent(wd)}/`;
  if (page > 1) url += page + '/';
  const html = await getHtml(url);
  const list = parseList(html);
  return { page, pagecount: 999, limit: list.length || 30, total: 999 * 30, list };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/homeVod', homeVod);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
