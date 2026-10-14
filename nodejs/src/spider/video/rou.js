import req from '../../util/req.js';
import * as cheerio from 'cheerio';

// 由 XPTV (https://raw.githubusercontent.com/fangkuia/XPTV/main/js/rou.js) 转换而来
// 站点: rou.video (已从 Next.js 迁到 TanStack Start, 2026-10 实测)
// 分类 5 个; 列表/搜索走 HTML 解析 (卡片 a.group[href^="/v/"])
// 详情从页面内嵌 TSR 流式脚本取加密 ev 解码得到 videoUrl (decodeEv 算法与 XPTV 一致)
// 播放: videoUrl 为 /api/hls/<id>, 即 m3u8 播放地址 (播放器以 application/x-mpegURL 加载)

const KEY = 'py_rou';
const NAME = '肉视频';
const HOST = 'https://rou.video';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

const CLASSES = [
  { type_id: 'https://rou.video/t/國產AV', type_name: '國產AV' },
  { type_id: 'https://rou.video/t/探花', type_name: '探花' },
  { type_id: 'https://rou.video/t/自拍流出', type_name: '自拍流出' },
  { type_id: 'https://rou.video/t/OnlyFans', type_name: 'OnlyFans' },
  { type_id: 'https://rou.video/t/日本', type_name: '日本' },
  { type_id: 'https://rou.video/t/韩国', type_name: '韩国' },
  { type_id: 'https://rou.video/t/欧美', type_name: '欧美' },
  { type_id: 'https://rou.video/t/网红', type_name: '网红' },
  { type_id: 'https://rou.video/t/动漫', type_name: '动漫' },
];

function headers() {
  return { 'User-Agent': UA, Referer: HOST + '/' };
}

function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

async function getHtml(url) {
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 15000 });
    return String(data || '');
  } catch (e) {
    return '';
  }
}

// 解析列表卡片 (对应 XPTV getCards / search; 2026-10 新版结构)
function parseCards(html) {
  const cards = [];
  if (!html) return cards;
  const $ = cheerio.load(html);
  $('a.group[href^="/v/"]').each((_, element) => {
    const el = $(element);
    const href = el.attr('href') || '';
    if (!href) return;
    const title = el.find('h3').first().text().trim() || el.find('img').last().attr('alt') || '';
    const cover = el.find('img').first().attr('src') || '';
    const badge = el.find('.relative span').first().text().trim(); // 如 720P
    const duration = el.find('.relative .ml-auto').first().text().trim(); // 如 2小时4分52秒
    const remarks = [badge, duration].filter(Boolean).join(' · ');
    cards.push({
      vod_id: href,
      vod_name: title,
      vod_pic: cover,
      vod_remarks: remarks,
    });
  });
  return cards;
}

// 对应 XPTV getTracks 中的 decodeEv: base64 解码 ev.d 后每字节减 ev.k, 再 JSON.parse
function decodeEv(ev) {
  const decoded = Buffer.from(ev.d, 'base64').toString('binary')
    .split('')
    .map((c) => String.fromCharCode(c.charCodeAt(0) - ev.k))
    .join('');
  return JSON.parse(decoded);
}

// 从详情页提取 ev (新版 TSR 流式脚本, 兼容旧版 #__NEXT_DATA__)
function extractEv(html) {
  let m = html.match(/ev:\$R\[\d+\]=\{d:"((?:[^"\\]|\\.)*)",k:(\d+)\}/);
  if (m) {
    const d = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return { d, k: parseInt(m[2], 10) };
  }
  const nm = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nm) {
    try {
      const ev = JSON.parse(nm[1]).props.pageProps.ev;
      if (ev && ev.d) return ev;
    } catch (e) {}
  }
  return null;
}

// 对应 XPTV getTracks: 从详情页解出 videoUrl
async function getPlayurl(detailUrl) {
  const html = await getHtml(detailUrl);
  if (!html) return '';
  try {
    const ev = extractEv(html);
    if (!ev) return '';
    return absUrl(decodeEv(ev).videoUrl || '');
  } catch (e) {
    return '';
  }
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  return { list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = String(body.id || CLASSES[0].type_id);
  if (page > 1) url += `?order=createdAt&page=${page}`;
  const html = await getHtml(url);
  const list = parseCards(html);
  return {
    page,
    pagecount: 9999,
    limit: list.length || 24,
    total: 999999,
    list,
  };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '');
  if (!id) return { list: [] };
  const url = absUrl(id);
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || '';
  const pic = $('meta[property="og:image"]').attr('content') || '';
  const playurl = await getPlayurl(url);
  if (!playurl) return { list: [] };
  return { list: [{
    vod_id: id,
    vod_name: title || id,
    vod_pic: pic,
    vod_content: '',
    vod_play_from: NAME,
    vod_play_url: `播放$${playurl}`,
  }]};
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let url = String(body.id || '');
  // body.id 可能为 "选集名$播放地址" 形式, 取 $ 后半部分
  const i = url.lastIndexOf('$');
  if (i >= 0) url = url.slice(i + 1);
  // XPTV getPlayinfo 原逻辑: .jpg 替换为 .m3u8 (旧版 videoUrl 是封面 jpg; 新版已为 /api/hls/<id>, 此处为兼容兜底)
  url = url.replace('.jpg', '.m3u8');
  url = absUrl(url);
  return {
    parse: 0,
    url,
    header: headers(),
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const text = encodeURIComponent(wd);
  const url = `${HOST}/search?q=${text}&t=&page=${page}`;
  const html = await getHtml(url);
  const list = parseCards(html);
  return {
    page,
    pagecount: 9999,
    limit: list.length || 24,
    total: list.length,
    list,
  };
}

export default function spider() {
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
