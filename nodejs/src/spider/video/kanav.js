// KanAV (https://kanav.info) - AppleCMS 站, XPTV kanav.js 转换而来
import req from '../../util/req.js';
import * as cheerio from 'cheerio';
import CryptoJS from 'crypto-js';

const KEY = 'py_kanav';
const NAME = 'KanAV';
const HOST = 'https://kanav.ad';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2_1 like Mac OS X)AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';

const CLASSES = [
  { type_id: '1', type_name: '中文字幕' },
  { type_id: '2', type_name: '日韩有码' },
  { type_id: '3', type_name: '日韩无码' },
  { type_id: '4', type_name: '国产AV' },
  { type_id: '30', type_name: '自拍泄密' },
  { type_id: '31', type_name: '探花约炮' },
  { type_id: '32', type_name: '主播录制' },
  { type_id: '20', type_name: '动漫番剧' },
];

function headers() {
  return { 'User-Agent': UA };
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

// XPTV getCards / search 共用的列表解析逻辑
function parseCards(html) {
  const cards = [];
  if (!html) return cards;
  const $ = cheerio.load(html);
  $('.post-list .col-md-3').each((_, element) => {
    const videoItem = $(element).find('.video-item');
    const entryTitle = $(element).find('.entry-title');
    const vodUrl = entryTitle.find('a').attr('href') || '';
    const vodName = entryTitle.find('a').text().trim();
    if (!vodUrl || !vodName) return;
    const vodPic = absUrl(videoItem.find('.featured-content-image a img').attr('data-original') || '');
    const remark = videoItem.find('span.model-view-left').text().trim();
    const duration = videoItem.find('span.model-view').text().trim();
    cards.push({
      vod_id: vodUrl, // 相对路径的播放页 URL, detail 时会拼成绝对地址
      vod_name: vodName,
      vod_pic: vodPic,
      vod_remarks: remark || duration,
    });
  });
  return cards;
}

// XPTV getTracks 的解密逻辑: player_aaaa -> URL转义的base64 -> decodeURIComponent
function decryptPlayUrl(html) {
  const $ = cheerio.load(html);
  let player = $('script:contains(player_aaaa)').text().replace('var player_aaaa=', '').trim();
  player = player.replace(/;\s*$/, '');
  const obj = JSON.parse(player);
  const encodedUrl = obj.url || '';
  return decodeURIComponent(CryptoJS.enc.Base64.parse(encodedUrl).toString(CryptoJS.enc.Utf8));
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  const html = await getHtml(HOST + '/');
  return { list: parseCards(html).slice(0, 20) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || '1');
  const url = `${HOST}/index.php/vod/type/id/${tid}/page/${page}.html`;
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
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vid = String(ids[0] || '');
  if (!vid) return { list: [] };
  const url = absUrl(vid);
  const html = await getHtml(url);
  if (!html) return { list: [] };

  // 标题形如 "在线播放 - 片名 - KanAV-免费高清中文AV"
  let name = '';
  const tm = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (tm) {
    name = tm[1]
      .replace(/^在线播放\s*-\s*/i, '')
      .replace(/\s*-\s*KanAV[\s\S]*$/i, '')
      .trim();
  }

  let pic = '';
  const pm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (pm) pic = absUrl(pm[1]);

  const eps = [];
  try {
    const playUrl = decryptPlayUrl(html);
    if (playUrl) eps.push(`播放$${playUrl}`);
  } catch (e) {}

  if (!eps.length) return { list: [] };

  return {
    list: [{
      vod_id: vid,
      vod_name: name || vid,
      vod_pic: pic,
      vod_play_from: NAME,
      vod_play_url: eps.join('#'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(body.id || '').trim();
  // body.id 可能为: 直链 / "选集名$播放地址" / JSON 字符串 {url}
  let url = id;
  try {
    const o = JSON.parse(id);
    if (o && o.url) url = String(o.url);
  } catch (e) {
    if (id.includes('$')) url = id.split('$').pop().trim();
  }
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'referer': 'https://kanav.ad/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const text = encodeURIComponent(wd);
  const url = `${HOST}/index.php/vod/search/by/time_add/page/${page}/wd/${text}.html`;
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
