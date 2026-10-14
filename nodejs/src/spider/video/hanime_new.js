// Hanime(新版) - CatPawOpen JS Spider
// 站点: https://hanimeone.me（hanime1.me 的可用镜像，无 Cloudflare 拦截）
// 列表: /search?genre=XXX&page=N ; 搜索: /search?query=XXX&broad=on&page=N ; 详情: /watch?v=ID
// 播放: 详情页 video#player 的 <source> 为 mp4 直链（带时效 secure 签名，约12小时有效；
//       play() 会重新抓详情页取最新签名地址，因此 detail 只传 {url, quality} 的 JSON）
import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const KEY = 'py_hanime_new';
const NAME = 'Hanime(新版)';
const HOST = 'https://hanimeone.me';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1';

// 导航忽略（站外推广；新番預告的 genre 页是真实视频分类，予以保留）
const IGNORE = ['H漫畫', 'H漫画', '無碼黃油', '无码黄油', '无码18禁游', '黃油', '黄油'];
// 静态兜底分类（home 抓导航失败时用）
const FALLBACK_GENRES = ['裏番', '泡麵番', 'Motion Anime', '3DCG', '2.5D', '2D動畫', 'AI生成', 'MMD', 'Cosplay'];

function headers() {
  return {
    'User-Agent': UA,
    Referer: HOST + '/',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  };
}

async function getHtml(url) {
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 20000 });
    return typeof data === 'string' ? data : '';
  } catch (e) {
    return '';
  }
}

function isInner(href) {
  if (!href) return false;
  if (/^https?:\/\//i.test(href)) return href.includes('hanime1.site');
  return href.startsWith('/');
}

function absUrl(href) {
  if (/^https?:\/\//i.test(href)) return href;
  return HOST + (href.startsWith('/') ? href : '/' + href);
}

// 通用卡片解析：首页(.video-item-container)、分类页(.home-rows-videos-div)、
// 搜索页(裸 a.video-link) 三种布局统一按 a[href*=watch?v=] 抓取
function parseCards(html) {
  const list = [];
  if (!html) return list;
  const $ = cheerio.load(html);
  const seen = new Set();
  $('a[href*="watch?v="]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (!isInner(href)) return; // 过滤站外广告
    const abs = absUrl(href);
    if (seen.has(abs)) return;
    seen.add(abs);

    let title =
      $a.find('.title').first().text().trim() ||
      $a.find('.home-rows-videos-title').first().text().trim() ||
      $a.closest('.video-item-container').attr('title') ||
      '';
    title = title.replace(/\s+/g, ' ').trim();

    let pic = '';
    const $img = $a.find('img.main-thumb').first().length
      ? $a.find('img.main-thumb').first()
      : $a.find('img').first();
    pic = $img.attr('src') || $img.attr('data-src') || '';
    if (pic && (pic.includes('erolabs') || pic.includes('/icon/'))) pic = '';

    const dur = $a.find('.duration').first().text().trim();
    const stats = [];
    $a.find('.stat-item').each((_, s) => {
      const t = $(s).text().replace('thumb_up', '').replace(/\s+/g, ' ').trim();
      if (t) stats.push(t);
    });
    const remarks = [dur, ...stats].filter(Boolean).join(' · ');

    list.push({
      vod_id: abs,
      vod_name: title || abs,
      vod_pic: pic,
      vod_remarks: remarks,
    });
  });
  return list;
}

async function init() {
  return {};
}

async function home() {
  const list = [];
  const html = await getHtml(HOST + '/');
  if (html) {
    const $ = cheerio.load(html);
    $('a.nav-item').each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href') || '';
      if (!name || !href) return;
      if (IGNORE.some((x) => name.includes(x))) return;
      if (!isInner(href)) return; // 过滤站外推广
      if (!href.includes('search?genre=')) return; // 只要 genre 分类
      const abs = absUrl(href);
      if (list.some((c) => c.type_id === abs)) return;
      list.push({ type_id: abs, type_name: name });
    });
  }
  if (list.length === 0) {
    for (const g of FALLBACK_GENRES) {
      list.push({ type_id: `${HOST}/search?genre=${encodeURIComponent(g)}`, type_name: g });
    }
  }
  return { class: list, filters: {} };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let id = String(body.id || '');
  // type_id 为完整分类 URL（home 动态解析）；兼容直接传 genre 名
  let url = id;
  if (!/^https?:\/\//i.test(id)) {
    url = `${HOST}/search?genre=${encodeURIComponent(id)}`;
  }
  // URL 中的中文需要编码，否则请求失败
  url = encodeURI(url);
  url += (url.includes('?') ? '&' : '?') + `page=${page}`;
  const html = await getHtml(url);
  const list = parseCards(html);
  return {
    page,
    pagecount: 999,
    limit: list.length || 20,
    total: 999 * 20,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vid = String(ids[0] || '');
  if (!vid) return { list: [] };

  const html = await getHtml(vid);
  let name = vid;
  let content = '';
  let pic = '';
  const tracks = [];
  if (html) {
    const $ = cheerio.load(html);
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    name = ogTitle.split(' - ')[0].trim() || vid;
    content = $('meta[property="og:description"]').attr('content') || '';
    pic = $('meta[property="og:image"]').attr('content') || '';
    $('video#player source').each((_, el) => {
      const src = $(el).attr('src') || '';
      const size = $(el).attr('size') || '';
      if (!src) return;
      tracks.push({
        name: size ? `${size}P` : '默认',
        ext: { url: vid, quality: size || 'default' },
      });
    });
  }

  // vod_play_url: 清晰度名${JSON({url, quality})}；play() 用它重新抓详情页拿最新签名直链
  const playUrl = tracks.map((t) => `${t.name}$${JSON.stringify(t.ext)}`).join('#');

  return {
    list: [
      {
        vod_id: vid,
        vod_name: name,
        vod_pic: pic,
        vod_content: content,
        vod_play_from: NAME,
        vod_play_url: playUrl,
      },
    ],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const raw = String(body.id || '');

  // detail 生成的 ext JSON（{url, quality}），或直接传入的直链
  let ext = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.url) ext = parsed;
  } catch (e) {
    // 非 JSON，视为直链
  }
  if (!ext) {
    return { parse: 0, url: raw, header: headers() };
  }

  // 重新抓详情页，取该清晰度的最新签名 mp4 直链
  const html = await getHtml(ext.url);
  let url = '';
  if (html) {
    const $ = cheerio.load(html);
    let $src = null;
    if (ext.quality && ext.quality !== 'default') {
      $src = $(`video#player source[size="${ext.quality}"]`).first();
    }
    if (!$src || !$src.length) $src = $('video#player source').first();
    url = $src.attr('src') || '';
  }
  return { parse: 0, url, header: headers() };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || body.keyword || '').trim();
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const url = `${HOST}/search?query=${encodeURIComponent(wd)}&broad=on&page=${page}`;
  const html = await getHtml(url);
  const list = parseCards(html);
  return {
    page,
    pagecount: 999,
    limit: list.length || 20,
    total: 999 * 20,
    list,
  };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async (request, reply) => {
        try {
          const data = await init({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/home', async (request, reply) => {
        try {
          const data = await home();
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/category', async (request, reply) => {
        try {
          const data = await category({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/detail', async (request, reply) => {
        try {
          const body = request.body || {};
          const data = await detail({ body: { id: body.id || body.ids } });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/play', async (request, reply) => {
        try {
          const data = await play({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/search', async (request, reply) => {
        try {
          const data = await search({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
    },
  };
}
