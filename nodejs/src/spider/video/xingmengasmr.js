import req from '../../util/req.js';

const KEY = 'py_xingmengasmr';
const NAME = '星梦ASMR';
const BASE_URL = 'https://www.asmrzy.top';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CATEGORIES = [
  { type_id: 'cn', type_name: '中国' },
  { type_id: 'kr', type_name: '韩国' },
  { type_id: 'jp', type_name: '日本' },
  { type_id: 'other', type_name: '其他' },
  { type_id: 'listen', type_name: '音频' },
];

function t(v) { return String(v == null ? '' : v).trim(); }

async function httpGet(url, headers) {
  const h = Object.assign({ 'User-Agent': UA }, headers || {});
  try {
    const res = await req.get(url, { headers: h, timeout: 20000 });
    const d = res.data;
    return typeof d === 'string' ? d : String(d == null ? '' : d);
  } catch (e) {
    try {
      const res = await fetch(url, { headers: h });
      return await res.text();
    } catch (e2) { return ''; }
  }
}

function parsePostItem(itemHtml) {
  const titleM = itemHtml.match(/<a[^>]+class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/);
  if (!titleM) return null;
  const title = t(titleM[1]);

  let linkM = itemHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*thumbnail[^"]*"/);
  if (!linkM) linkM = itemHtml.match(/<a[^>]+href="([^"]+)"[^>]*>.*?<img/);
  if (!linkM) return null;
  let link = linkM[1];
  if (!/^https?:\/\//i.test(link)) {
    link = link.startsWith('/') ? BASE_URL + link : BASE_URL + '/' + link;
  }
  const vidM = link.match(/\/(\d+)\.html/);
  const vid = vidM ? vidM[1] : link;

  let pic = '';
  const imgM = itemHtml.match(/<img[^>]+data-src="([^"]+)"/) || itemHtml.match(/<img[^>]+src="([^"]+)"/);
  if (imgM) pic = imgM[1];

  let remarks = '';
  const dateM = itemHtml.match(/<time[^>]*>([^<]+)<\/time>/) || itemHtml.match(/<li>(\d{4}年\d{2}月\d{2}日)<\/li>/);
  if (dateM) remarks = t(dateM[1]);

  return { vod_id: vid, vod_name: title, vod_pic: pic, vod_remarks: remarks };
}

function parseList(html) {
  const videos = [];
  const items = html.match(/<li[^>]*class="[^"]*joe_list__item[^"]*"[^>]*>([\s\S]*?)<\/li>/g) || [];
  for (const li of items) {
    const post = parsePostItem(li);
    if (post) videos.push(post);
  }
  return videos;
}

function parsePagecount(html, pg) {
  let pagecount = pg;
  const pagM = html.match(/<ul[^>]*class="[^"]*joe_pagination[^"]*"[^>]*>([\s\S]*?)<\/ul>/);
  if (pagM) {
    const pages = pagM[1].match(/<a[^>]*>(\d+)<\/a>/g) || [];
    for (const p of pages) {
      const n = parseInt(p.replace(/<[^>]+>/g, ''), 10);
      if (n > pagecount) pagecount = n;
    }
  }
  return pagecount;
}

function extractVideoUrl(html) {
  if (!html) return null;
  // 1. iframe (bilibili etc)
  const iframes = html.match(/<iframe[^>]+src="([^"]+)"/gi) || [];
  for (const tag of iframes) {
    const m = tag.match(/src="([^"]+)"/i);
    if (!m) continue;
    let src = t(m[1]);
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) src = BASE_URL + src;
    if (/google|trustpilot|tree-nation/i.test(src)) continue;
    return src;
  }
  // 2. direct mp4/m3u8/webm
  const direct = html.match(/https?:\/\/[^\s"']+\.(?:mp4|m3u8|webm|flv)/i);
  if (direct) return direct[0];
  // 3. smartideo
  const sm = html.match(/<div[^>]*class="[^"]*smartideo[^"]*"[^>]*data-(?:src|url)="([^"]+)"/i);
  if (sm) return sm[1];
  // 4. video/source tags
  const vs = html.match(/<(?:video|source)[^>]+src="([^"]+)"/i);
  if (vs) return vs[1];
  return null;
}

function parsePlatform(url) {
  if (!url) return null;
  let m = url.match(/(?:bilibili\.com\/video\/|player\.bilibili\.com\/player\.html\?[^"]*bvid=)([a-zA-Z0-9]+)/i);
  if (m) return 'bilibili://' + m[1];
  m = url.match(/player\.bilibili\.com\/player\.html\?[^"]*aid=(\d+)/i);
  if (m) return 'bilibili_aid://' + m[1];
  m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (m) return 'youtube://' + m[1];
  return url;
}

async function home() {
  return { class: CATEGORIES, filters: {}, list: [] };
}

async function category(inReq) {
  const tid = t(inReq.body?.id) || 'cn';
  let pg = parseInt(inReq.body?.page, 10) || 1;
  if (pg < 1) pg = 1;
  const url = pg > 1 ? `${BASE_URL}/category/${tid}/${pg}/` : `${BASE_URL}/category/${tid}/`;
  const html = await httpGet(url);
  if (!html) return { page: pg, pagecount: pg, list: [] };
  const list = parseList(html);
  return { page: pg, pagecount: parsePagecount(html, pg), limit: list.length, total: 0, list };
}

async function detail(inReq) {
  const rawId = inReq.body?.id;
  const id = Array.isArray(rawId) ? rawId[0] : t(rawId);
  if (!id) return { list: [] };
  const html = await httpGet(`${BASE_URL}/${id}.html`);
  if (!html) return { list: [] };

  const titleM = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleM ? t(titleM[1]) : '未知';
  let pic = '';
  const picM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)
    || html.match(/<img[^>]+src="([^"]+)"/);
  if (picM) pic = picM[1];
  const descM = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/);
  const desc = descM ? t(descM[1]) : '';

  const videoUrl = extractVideoUrl(html);
  let playFrom = '', playUrl = '';
  if (videoUrl) {
    const parsed = parsePlatform(videoUrl);
    playFrom = '视频';
    playUrl = `播放$${parsed}`;
  }

  return {
    list: [{
      vod_id: id, vod_name: title, vod_pic: pic, vod_content: desc || '未提取到视频地址。',
      vod_play_from: playFrom, vod_play_url: playUrl,
    }],
  };
}

async function play(inReq) {
  let videoId = t(inReq.body?.id);
  if (videoId.startsWith('bilibili://')) {
    const bvid = videoId.split('://')[1];
    // try bilibili direct playurl API for best quality
    try {
      const viewRes = await req.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
        headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com' }, timeout: 15000,
      });
      const viewData = typeof viewRes.data === 'object' ? viewRes.data : JSON.parse(String(viewRes.data || '{}'));
      if (viewData.code === 0) {
        const cid = viewData.data.cid;
        const playRes = await req.get(
          `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=16`,
          { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com' }, timeout: 15000 }
        );
        const playData = typeof playRes.data === 'object' ? playRes.data : JSON.parse(String(playRes.data || '{}'));
        if (playData.code === 0 && playData.data.durl && playData.data.durl.length) {
          return { parse: 0, url: playData.data.durl[0].url, header: { Referer: 'https://www.bilibili.com' } };
        }
      }
    } catch (e) { /* fall through to embed */ }
    return { parse: 0, url: `https://player.bilibili.com/player.html?bvid=${bvid}`, header: {} };
  }
  if (videoId.startsWith('bilibili_aid://')) {
    const aid = videoId.split('://')[1];
    return { parse: 0, url: `https://player.bilibili.com/player.html?aid=${aid}`, header: {} };
  }
  if (videoId.startsWith('youtube://')) {
    const yid = videoId.split('://')[1];
    return { parse: 0, url: `https://www.youtube.com/embed/${yid}?autoplay=1`, header: {} };
  }
  if (/^https?:\/\//i.test(videoId)) {
    const header = videoId.includes('asmrzy.top') ? { Referer: BASE_URL + '/' } : {};
    return { parse: 0, url: videoId, header };
  }
  return { parse: 0, url: '', header: {} };
}

async function search(inReq) {
  const key = t(inReq.body?.wd ?? inReq.body?.key);
  let pg = parseInt(inReq.body?.page, 10) || 1;
  if (pg < 1) pg = 1;
  if (!key) return { page: pg, pagecount: pg, list: [] };
  let url = `${BASE_URL}/?s=${encodeURIComponent(key)}`;
  if (pg > 1) url += `&page=${pg}`;
  const html = await httpGet(url);
  if (!html) return { page: pg, pagecount: pg, list: [] };
  const list = parseList(html);
  return { page: pg, pagecount: parsePagecount(html, pg), list };
}

export default {
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
