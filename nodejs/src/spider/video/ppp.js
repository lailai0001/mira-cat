// PPPHub - 由 XPTV 格式 spider (https://raw.githubusercontent.com/fangkuia/XPTV/main/js/ppp.js) 转换而来
// 站点: https://ppp.porn (亚洲素人成人影片)
// 注意: 原 XPTV 的 tabs[].ext 只有 {href}，没有数字 id；这里直接用分类 href 作为 type_id（唯一标识），
//       category() 收到 body.id 后直接用它拼接异步列表接口，不编造任何 URL。
import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const KEY = 'py_ppp';
const NAME = 'PPPHub';
const HOST = 'https://ppp.porn/pp1';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1.1 Mobile/15E148 Safari/604.1';

// 静态回退分类（站点 /categories/ 抓取失败时使用；当前为空，分类以运行时动态抓取为准）
const CLASSES = [];

function headers(referer) {
  return {
    'User-Agent': UA,
    'Referer': referer || HOST + '/',
  };
}

function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

// 对应 XPTV getTabs(): 从 /categories/ 解析分类卡片
async function fetchTabs() {
  const classUrl = `${HOST}/categories/`;
  const { data } = await req.get(classUrl, {
    headers: headers('https://ppp.porn/pp1/'),
    timeout: 15000,
  });
  const $ = cheerio.load(String(data || ''));
  const list = [];
  $('section.padding-bottom-xl .card-cat-v2').each((_, e) => {
    const title = $(e).find('.card-cat-v2__title').text().trim();
    const count = $(e).find('.card-cat-v2__count').text().trim();
    const name = count ? `${title}(${count})` : title;
    const href = $(e).find('a').attr('href') || '';
    if (!href || !name) return;
    list.push({
      type_id: href, // 源文件 ext 只有 href，无 id，直接用 href 做唯一标识
      type_name: name,
    });
  });
  return list;
}

// 对应 XPTV getCards() 的条目解析（分类列表与搜索结果结构相同）
function parseItems($, selector) {
  const cards = [];
  $(`${selector} .item`).each((_, element) => {
    const title = $(element).find('h4 a').text().trim();
    const cover = $(element).find('img').attr('data-src') || '';
    const href = $(element).find('h4 a').attr('href') || '';
    const duration = $(element).find('.card-video__duration').text().trim();
    if (!title || !href) return;
    cards.push({
      vod_id: href, // XPTV 里 vod_id 即详情页 href（相对或绝对路径）
      vod_name: title,
      vod_pic: cover,
      vod_remarks: duration,
    });
  });
  return cards;
}

// 对应 XPTV getTracks(): 从详情页 <script> 中提取 m3u8 地址
function extractM3u8($) {
  let m3u8Url = null;
  $('script').each((_, script) => {
    if (m3u8Url) return;
    const content = $(script).html() || '';
    if (!content.includes('.m3u8')) return;
    // 原版正则 /https?:\/\/[\w./-]+\.m3u8/ 会截断带 ?token= 的查询串导致播不了，
    // 这里优先用宽松模式保留完整 URL（含查询串），取不到再回退原版正则；仍只取页面上真实出现的 URL，不编造
    let m = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (!m) m = content.match(/https?:\/\/[\w./-]+\.m3u8/);
    if (m && m[0]) m3u8Url = m[0];
  });
  return m3u8Url;
}

async function init() {
  return {};
}

async function home() {
  // XPTV 原版 getConfig() 每次都动态抓取 tabs，这里同样运行时拉取，失败回退静态 CLASSES
  try {
    const tabs = await fetchTabs();
    if (tabs.length) return { class: tabs, filters: {} };
  } catch (e) {}
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  // 源文件没有首页推荐逻辑
  return { list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const href = String(body.id || '');
  // 对应 XPTV getCards(ext): ext={href, page}
  const url = `${absUrl(href)}?mode=async&function=get_block&block_id=list_videos_common_videos_list&sort_by=post_date&from=${page}`;
  let list = [];
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 15000 });
    const $ = cheerio.load(String(data || ''));
    list = parseItems($, '#list_videos_common_videos_list_items');
  } catch (e) {}
  // 异步块接口不返回总页数：有数据视为还有更多页（与 chigua51 的 9999 兜底一致），无数据则视为末页
  return {
    page,
    pagecount: list.length ? 9999 : page,
    limit: list.length || 24,
    total: 999999,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vid = String(ids[0] || '');
  const url = absUrl(vid);
  if (!url) return { list: [] };
  let html = '';
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 15000 });
    html = String(data || '');
  } catch (e) {}
  if (!html) return { list: [] };
  const $ = cheerio.load(html);
  const m3u8Url = extractM3u8($);
  const name = $('meta[property="og:title"]').attr('content')
    || $('h1').first().text().trim()
    || vid;
  const pic = $('meta[property="og:image"]').attr('content') || '';
  const content = $('meta[property="og:description"]').attr('content') || '';
  const eps = [];
  if (m3u8Url) eps.push(`播放$${m3u8Url}`);
  return { list: [{
    vod_id: vid,
    vod_name: String(name).trim(),
    vod_pic: pic,
    vod_remarks: '',
    vod_content: String(content).trim(),
    vod_play_from: NAME,
    vod_play_url: eps.join('#'),
  }]};
}

async function play(reqIn) {
  // 对应 XPTV getPlayinfo(ext): ext={url}，直接返回直链，parse:0
  // body.id 可能是纯播放地址，也可能是含 ext/url 信息的 JSON 字符串，兼容解析
  const raw = String(reqIn?.body?.id || '');
  let url = raw;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      url = obj.url || obj?.ext?.url || raw;
    } catch (e) {}
  }
  return { parse: 0, url };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  // 对应 XPTV search(ext): ext={text, page}
  const text = encodeURIComponent(wd);
  const url = `${HOST}/search/${text}/?mode=async&function=get_block&block_id=list_videos_videos_list_search_result&q=${text}&category_ids=&sort_by=&from_videos=${page}&from_albums=${page}`;
  let list = [];
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 15000 });
    const $ = cheerio.load(String(data || ''));
    list = parseItems($, '#list_videos_videos_list_search_result_items');
  } catch (e) {}
  return {
    page,
    pagecount: list.length ? 9999 : page,
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
