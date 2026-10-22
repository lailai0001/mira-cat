import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const KEY = 'py_missav_xptv';
const NAME = 'MissAV';
// 源文件(XPTV)里的 site 是 https://missav.ai，但实测该域名不通(超时)，
// 用户此前已确认可用域名为 missav.fans，此处使用可用域名
const HOST = 'https://missav.fans';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

// 源文件 appConfig.tabs 映射 (31 个分类)
const CLASSES = [
  { type_id: 'dm265/cn/chinese-subtitle', type_name: '中文字幕' },
  { type_id: 'dm513/cn/new', type_name: '最近更新' },
  { type_id: 'dm509/cn/release', type_name: '新作上市' },
  { type_id: 'dm561/cn/uncensored-leak', type_name: '无码流出' },
  { type_id: 'dm2091/cn/genres/VR', type_name: 'VR' },
  { type_id: 'dm242/cn/today-hot', type_name: '今日热门' },
  { type_id: 'dm168/cn/weekly-hot', type_name: '本週热门' },
  { type_id: 'dm207/cn/monthly-hot', type_name: '本月热门' },
  { type_id: 'dm23/cn/siro', type_name: 'SIRO' },
  { type_id: 'dm20/cn/luxu', type_name: 'LUXU' },
  { type_id: 'dm17/cn/gana', type_name: 'GANA' },
  { type_id: 'dm14/cn/maan', type_name: 'PRESTIGE PREMIUM' },
  { type_id: 'dm23/cn/scute', type_name: 'S-CUTE' },
  { type_id: 'dm19/cn/ara', type_name: 'ARA' },
  { type_id: 'dm95/cn/fc2', type_name: 'FC2' },
  { type_id: 'dm628/cn/heyzo', type_name: 'HEYZO' },
  { type_id: 'dm29/cn/tokyohot', type_name: '东京热' },
  { type_id: 'dm58345/cn/1pondo', type_name: '一本道' },
  { type_id: 'dm124158/cn/caribbeancom', type_name: 'Caribbeancom' },
  { type_id: 'dm1442/cn/caribbeancompr', type_name: 'Caribbeancompr' },
  { type_id: 'dm58632/cn/10musume', type_name: '10musume' },
  { type_id: 'dm668/cn/pacopacomama', type_name: 'pacopacomama' },
  { type_id: 'dm135/cn/gachinco', type_name: 'Gachinco' },
  { type_id: 'dm26/cn/xxxav', type_name: 'XXX-AV' },
  { type_id: 'dm24/cn/marriedslash', type_name: '人妻斩' },
  { type_id: 'dm19/cn/naughty4610', type_name: '顽皮 4610' },
  { type_id: 'dm22/cn/naughty0930', type_name: '顽皮 0930' },
  { type_id: 'dm34/cn/madou', type_name: '麻豆传媒' },
  { type_id: 'dm17/cn/twav', type_name: 'TWAV AV' },
  { type_id: 'dm15/cn/furuke', type_name: 'Furuke AV' },
  { type_id: 'cn/censored', type_name: '有码' },
  { type_id: 'cn/uncensored', type_name: '无码' },
];

const M3U8_PREFIXES = [
  'https://surrit.mrstcdn.store/', // 当前实际使用的 surrit 域名(2026-10 实测)
  'https://surrit.com/',           // XPTV 源文件里的旧域名,保留兜底
];
const M3U8_SUFFIX = '/playlist.m3u8';

function headers(referer) {
  const h = { 'User-Agent': UA };
  if (referer) h['Referer'] = referer;
  return h;
}

async function getHtml(url, referer) {
  try {
    const { data } = await req.get(url, { headers: headers(referer), timeout: 20000 });
    return String(data || '');
  } catch (e) {
    return '';
  }
}

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

// 解析视频卡片列表 (.thumbnail),对应 XPTV getCards/search 的解析逻辑
function parseCards(html) {
  const cards = [];
  if (!html || html.includes('Just a moment...')) return cards;
  const $ = cheerio.load(html);
  $('.thumbnail').each((_, e) => {
    const el = $(e);
    const href = el.find('.text-secondary').attr('href') || '';
    const title = cleanText(el.find('.text-secondary').text());
    if (!href || !title) return;
    const cover = absUrl(el.find('.w-full').attr('data-src'));
    const remarks = cleanText(el.find('.left-1').text());
    const duration = cleanText(el.find('.right-1').text());
    cards.push({
      vod_id: absUrl(href),
      vod_name: title,
      vod_pic: cover,
      vod_remarks: [remarks, duration].filter(Boolean).join(' '),
    });
  });
  return cards;
}

// 从分页链接提取最大页码
function parsePagecount(html, curPage) {
  let max = 0;
  const re = /[?&]page=(\d+)/g;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max > 0 ? max : (curPage + 1);
}

function wrapPage(page, pagecount, list) {
  list = Array.isArray(list) ? list : [];
  const limit = list.length || 12;
  // 确保 pagecount 至少为当前页，避免播放器认为没有更多页
  pagecount = Math.max(pagecount || 0, page);
  return {
    page,
    pagecount,
    limit,
    total: pagecount * limit,
    list,
  };
}

// 对应 XPTV getCards: ext = JSON 字符串 {id, page, filters?}
async function getCards(ext) {
  ext = JSON.parse(ext || '{}');
  const { page = 1, id, filters = {} } = ext;
  if (!id) return { html: '', list: [] };
  let url = `${HOST}/${id}?page=${page}`;
  if (filters.filters) url += `&filters=${encodeURIComponent(filters.filters)}`;
  if (filters.sort) url += `&sort=${encodeURIComponent(filters.sort)}`;
  else url += '&sort=released_at';
  if (filters.keyword) url += `&keyword=${encodeURIComponent(filters.keyword)}`;
  if (filters.actress) url += `&actress=${encodeURIComponent(filters.actress)}`;
  if (filters.tag) url += `&tag=${encodeURIComponent(filters.tag)}`;
  const html = await getHtml(url);
  return { html, list: parseCards(html) };
}

// 对应 XPTV getTracks + 详情页信息解析
// 返回: { info: {vod_id, vod_name, vod_pic, vod_content, vod_remarks}, tracks: [{name, url}] }
async function getTracks(detailUrl) {
  const html = await getHtml(detailUrl);
  const info = { vod_id: detailUrl, vod_name: '', vod_pic: '', vod_content: '', vod_remarks: '' };
  if (!html) return { info, tracks: [] };
  const $ = cheerio.load(html);
  info.vod_name = cleanText($('meta[property="og:title"]').attr('content')) || cleanText($('title').text());
  info.vod_pic = absUrl($('meta[property="og:image"]').attr('content'));
  info.vod_content = cleanText($('meta[property="og:description"]').attr('content'));
  info.vod_remarks = cleanText($('meta[property="og:url"]').attr('content'));

  const tracks = [];
  // XPTV 正则 /surrit\.com\\\/(.+)\\\/seek\\\/_0\.jpg/
  // 实测站点已换成 surrit.mrstcdn.store,这里同时兼容新旧域名
  const match = html.match(/surrit(?:\.com|\.mrstcdn\.store)\\\/([^"\\]+)\\\/seek\\\/_0\.jpg/);
  if (match && match[1]) {
    const uuid = match[1];
    for (const prefix of M3U8_PREFIXES) {
      try {
        const { data } = await req.get(prefix + uuid + M3U8_SUFFIX, {
          headers: headers(detailUrl),
          timeout: 20000,
        });
        const lines = String(data || '').split('\n');
        // 每个清晰度一行,形如 720p/video.m3u8;名称取 720p 部分
        lines
          .filter((line) => line.includes('/video.m3u8'))
          .forEach((line) => {
            const name = line.replace('/video.m3u8', '').trim() || '正片';
            tracks.unshift({ name, url: `${prefix}${uuid}/${line.trim()}` });
          });
        tracks.push({ name: '自动', url: prefix + uuid + M3U8_SUFFIX });
        if (tracks.length) break;
      } catch (e) { /* 换下一个域名重试 */ }
    }
  }
  return { info, tracks };
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  // XPTV 源文件无首页推荐,用"最近更新"第一页做首页推荐
  const { list } = await getCards(JSON.stringify({ id: 'dm513/cn/new', page: 1 }));
  return { list: (list || []).slice(0, 20) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const id = String(body.id || CLASSES[0].type_id);
  const filters = body.filters || {};
  const { list } = await getCards(JSON.stringify({ id, page, filters }));
  // 用固定 pagecount 保证"加载更多"按钮一直出现（照原版 MissAV 的做法）
  return { page, pagecount: 999, limit: list.length || 12, total: 999 * 12, list: list || [] };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vid = String(ids[0] || '').trim();
  if (!vid) return { list: [] };
  const detailUrl = absUrl(vid);
  const { info, tracks } = await getTracks(detailUrl);
  if (!info.vod_name && !tracks.length) return { list: [] };
  return {
    list: [{
      vod_id: detailUrl,
      vod_name: info.vod_name || detailUrl,
      vod_pic: info.vod_pic,
      vod_remarks: info.vod_remarks,
      vod_content: info.vod_content,
      vod_play_from: NAME,
      vod_play_url: tracks.map((t) => `${t.name}$${t.url}`).join('#'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '').trim();
  // XPTV getPlayinfo 直接返回直链 + 请求头;此处返回给客户端
  return {
    parse: 0,
    url,
    header: {
      'User-Agent': UA,
      'Referer': HOST + '/',
    },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const text = encodeURIComponent(wd);
  const url = `${HOST}/cn/search/${text}?page=${page}`;
  const html = await getHtml(url);
  const list = parseCards(html);
  return { page, pagecount: 999, limit: list.length || 12, total: 999 * 12, list };
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
