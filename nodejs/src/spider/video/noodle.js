// NoodleMagazine - CatPawOpen JS Spider
// 站：https://noodlemagazine.com/（视频搜索聚合站）
// 已实测（2026-10-28）：
// - 首页列表：<div class="item" data-video-title-base="..."> 内
//   <a href="/watch/{owner}_{id}">，封面 <img data-src="...preview_320.jpg">；
//   首页导航只有范围切换：/home（最新）、/home?range=week（本周）、/home?range=month（本月），
//   无传统分类，故分类只给这三档，不猜标签分类。
// - 搜索：/video/{kw}（实测出 24 条 /watch/ 链接）。
// - 详情：/watch/{owner}_{id} 页含 <title data-video-title-base>、og:image（preview_800.jpg）
//   与 /videofile/{owner}_{id}.mp4（301 跳到 CDN vid_360p.mp4，带时效 token，
//   详情时现取现用，播放器跟随重定向即可）；另有 720p/480p/240p 变体但页内只给
//   videofile 入口，故只返回 videofile 一条线。
import req from '../../util/req.js';

const KEY = 'py_noodle';
const NAME = 'NoodleMagazine';
const HOST = 'https://noodlemagazine.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': referer || HOST };
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
  const chunks = String(html).split('<div class="item"');
  for (let i = 1; i < chunks.length; i++) {
    const blk = chunks[i].slice(0, 4000);
    const am = blk.match(/<a href="(\/watch\/[^"]+)"[^>]*>/i);
    if (!am) continue;
    const url = HOST.replace(/\/$/, '') + am[1];
    if (seen.has(url)) continue;
    const tm = blk.match(/data-video-title-base="([^"]+)"/i);
    const title = tm ? stripTags(tm[1]) : '';
    if (!title || title.length < 2) continue;
    const pm = blk.match(/data-src="(https?:[^"]+preview_320\.jpg[^"]*)"/i) || blk.match(/data-src="(https?:[^"]+)"/i);
    seen.add(url);
    items.push({ vod_id: url, vod_name: title, vod_pic: pm ? pm[1] : '' });
    if (items.length >= 24) break;
  }
  return items;
}
async function init() { return {}; }
async function home() {
  const html = await getText(HOST + 'home', HOST);
  return {
    class: [
      { type_id: 'home', type_name: '最新' },
      { type_id: 'home?range=week', type_name: '本周热门' },
      { type_id: 'home?range=month', type_name: '本月热门' },
    ],
    filters: {},
    list: parseList(html),
  };
}
async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'home');
  const html = await getText(HOST + tid, HOST);
  const list = parseList(html);
  return { page: 1, pagecount: 1, limit: 90, total: list.length, list };
}
async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : HOST + String(raw).replace(/^\/+/, '');
    const html = await getText(url, HOST);
    const tm = html.match(/data-video-title-base="([^"]+)"/i);
    const title = tm ? stripTags(tm[1]) : 'NoodleMagazine';
    const om = html.match(/og:image[^>]*content="([^"]+)"/i);
    // 2026-10-29：详情页 window.playlist 里有 720/480/360/240 四档直链（原只取 videofile
    // 单线 360p 且多一次 301）；优先按清晰度降序出多线路，playlist 为空时回退 videofile。
    let playUrl = '';
    const pl = [];
    const seenPl = new Set();
    const plRe = /"file"\s*:\s*"([^"]+)"\s*,\s*"label"\s*:\s*"([^"]+)"/gi;
    let pm;
    while ((pm = plRe.exec(html)) !== null) {
      const f = pm[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
      const lab = pm[2].trim();
      if (!/^https?:\/\//i.test(f) || seenPl.has(f)) continue;
      seenPl.add(f);
      pl.push({ label: lab, file: f });
    }
    pl.sort((a, b) => (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0));
    if (pl.length) playUrl = pl.map(x => x.label + '$' + x.file).join('#');
    else {
      const vm = html.match(/\/videofile\/[^"'\s<>]+\.mp4/i);
      playUrl = vm ? ('播放$' + HOST.replace(/\/$/, '') + vm[0]) : ('未找到视频源$' + raw);
    }
    list.push({ vod_id: raw, vod_name: title, vod_pic: om ? om[1] : '', vod_play_from: 'NoodleMagazine', vod_play_url: playUrl });
  }
  return { list };
}
async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  return { parse: isVideo ? 0 : 1, url: id, header: H(HOST) };
}
async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  if (!wd) return { page: 1, pagecount: 1, limit: 90, total: 0, list: [] };
  const html = await getText(HOST + 'video/' + encodeURIComponent(wd), HOST);
  const list = parseList(html);
  return { page: 1, pagecount: 1, limit: 90, total: list.length, list };
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
