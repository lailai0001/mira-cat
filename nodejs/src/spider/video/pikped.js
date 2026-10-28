// PikPedCams - CatPawOpen JS Spider（未验证实验版）
// 站：https://zh.pikpedcams.com/（直播站，非录播视频站）
// 用户 2026-10-28 明确选定“试一个未验证版，手机上看能不能播”后编写。
// 已实测（浏览器实测，2026-10-28；本机 curl 一律 406 被拦，故服务端结构未经本机验证）：
// - 顶部导航：女主播 /、情侣 /couples、男主播 /men、跨性別 /trans；
//   侧边栏分类形如 /girls/chinese（中文）、/girls/halloween、/girls/new、
//   /girls/teens、/girls/asian、/girls/big-tits；分类页无分页（无限滚动），故 pagecount 为 1。
// - 直播卡片：<a href="/{主播用户名}">，缩略图 https://img.doppiocdn.net/snapshot/{id}/{id}，
//   alt 为“主播名 + 网络视讯表演”；点开为公共直播间，浏览器实测未登录未付费即可播放，
//   但页面 DOM 里搜不到 m3u8 与播放器 API 端点，流地址格式未证实。
// - 因此本蜘蛛不做直链提取：详情直接返回主播页，play 用 parse:1 由播放器嗅探页面流；
//   能不能播、列表能不能拉到，全由用户手机实测说了算，播不了即撤掉。
// v2（2026-10-28 晚，用户选“先放宽解析再试一次”后改）：
// - 浏览器 21:05 复查证实首页渲染 DOM 里确实有 /用户名 链接 + 用户名 plain text，
//   但缩略图地址未能证实；v1 要求卡片内必须有 img.doppiocdn.net/snapshot 图片才算一条，
//   若设备端抓到的原始 HTML 里没有那张图，parseList 会误判为空。
// - 故 v2 放宽：只认 /用户名 链接 + 用户名文本，图片改为可选（有则用、无则空图只列名）；
//   若设备端仍 406/空体/被 18+ 确认页挡住，列表仍空，届时按约定撤掉。
// - 搜索：站内搜索栏格式未经浏览器核实，本版 search 暂返回空列表，不猜 URL。
import req from '../../util/req.js';

const KEY = 'py_pikped';
const NAME = 'PikPedCams';
const HOST = 'https://zh.pikpedcams.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'Referer': referer || HOST };
}
async function getText(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return String(data || '');
  } catch { return ''; }
}
function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function parseList(html) {
  const items = [];
  const seen = new Set();
  const chunks = String(html).split('<a ');
  for (let i = 1; i < chunks.length; i++) {
    const blk = chunks[i].slice(0, 3000);
    const am = blk.match(/^href="\/([A-Za-z0-9_\-\.]+)"[^>]*>/i);
    if (!am) continue;
    const username = am[1];
    // 排除导航与分类链接：couples、men、trans、girls 等非主播路径
    // （分类链接如 /girls/chinese 因含第二段斜杠，已被上面单段正则排除）
    if (['couples', 'men', 'trans', 'girls'].includes(username.toLowerCase())) continue;
    const url = HOST + username;
    if (seen.has(url)) continue;
    // v2 放宽：不再要求卡片内有 doppio 缩略图；用户名文本即标题来源
    const alm = blk.match(/alt="([^"]+)"/i);
    let title = alm ? stripTags(alm[1]) : '';
    if (!title) {
      const afterTag = blk.replace(/^href="[^"]*"[^>]*>/i, '');
      const tm = afterTag.match(/^[^<]+/);
      title = tm ? stripTags(tm[0]) : '';
    }
    title = title.replace(/\s*网络视讯表演\s*$/, '').trim() || username;
    // 图片可选：有 doppio 图用它，否则用块内任意首图，否则空图只列名
    const pm = blk.match(/<img[^>]*src="(https?:\/\/img\.doppiocdn\.net\/snapshot\/[^"]+)"/i)
      || blk.match(/<img[^>]*src="(https?:\/\/[^"]+)"/i);
    seen.add(url);
    items.push({ vod_id: url, vod_name: title, vod_pic: pm ? pm[1] : '' });
    if (items.length >= 24) break;
  }
  return items;
}
async function init() { return {}; }
async function home() {
  const html = await getText(HOST, HOST);
  return {
    class: [
      { type_id: '', type_name: '女主播' },
      { type_id: 'couples', type_name: '情侣' },
      { type_id: 'men', type_name: '男主播' },
      { type_id: 'trans', type_name: '跨性別' },
      { type_id: 'girls/chinese', type_name: '中文' },
      { type_id: 'girls/asian', type_name: '亚洲人' },
      { type_id: 'girls/teens', type_name: '少女 18+' },
      { type_id: 'girls/big-tits', type_name: '巨乳' },
      { type_id: 'girls/new', type_name: '新主播' },
      { type_id: 'girls/halloween', type_name: '万圣节' },
    ],
    filters: {},
    list: parseList(html),
  };
}
async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || '');
  const url = tid ? (HOST + tid.replace(/^\/+/, '').replace(/\/+$/, '') + '/') : HOST;
  const html = await getText(url, HOST);
  const list = parseList(html);
  return { page: 1, pagecount: 1, limit: 90, total: list.length, list };
}
async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : HOST + String(raw).replace(/^\/+/, '');
    const username = url.replace(/\/+$/, '').split('/').pop() || 'PikPedCams';
    list.push({ vod_id: raw, vod_name: username, vod_pic: '', vod_play_from: 'PikPedCams', vod_play_url: '直播$' + url });
  }
  return { list };
}
async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  // 实验版：不做直链提取，由播放器嗅探主播页的直播流
  return { parse: 1, url: id, header: H(HOST) };
}
async function search(reqIn) {
  // 搜索格式未经核实，暂返回空，不猜 URL
  return { page: 1, pagecount: 1, limit: 90, total: 0, list: [] };
}
export default function createSpider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', init);
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
