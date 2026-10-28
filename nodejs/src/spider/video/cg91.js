// 91吃瓜 - CatPawOpen JS Spider
// 站：https://www.91cg1.com/（Typecho Mirages 主题，91吃瓜网；注意与已删的 91视频
// yitxxlii/91shipin 不是同一站，本站由用户 2026-10-28 明确新点名）
// 已实测（2026-10-28）：
// - 列表卡：<a href="/archives/{id}/"> 后跟 post-card 块，封面在
//   loadBannerDirect('https://pic.hdhwqx.cn/upload_01/...jpeg', ...) 里，
//   标题在 <h2 class="post-card-title"> 里（含内嵌 wrap 标签需先剔除）；
//   分类分页 /category/{slug}/{n}/，搜索 /search/{kw}/（分页 /search/{kw}/{n}/，
//   站内 JS 也把 ?s= 转写成 /search/{kw}/）。
// - 封面注意：pic.hdhwqx.cn 直取返回的是加密密文（与 dycg66 同一图床家族），
//   必须走 51chigua 解密代理（51chigua.li768435813.workers.dev/img?url=）。
// - 详情：<h1> 为标题；播放器为 <div class="dplayer" data-config='...'>（单引号属性，
//   JSON 内 \/ 转义），video.url 即 m3u8 直链（带 auth_key 时效 token，详情时现取），
//   多段按段列出；data-hevc / hevc-cid 为 H.265 侧信道，本站 data-config 已有直链故不用。
import req from '../../util/req.js';

const KEY = 'py_91cg';
const NAME = '91吃瓜';
const HOST = 'https://www.91cg1.com/';
const PROXY = 'https://51chigua.li768435813.workers.dev/img?url=';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': referer || HOST,
  };
}

async function getText(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return String(data || '');
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '')
    .replace(/<div class="wrap">[\s\S]*?<\/div>/gi, '')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function proxyPic(pic) {
  if (!pic) return '';
  if (pic.startsWith('http')) return PROXY + encodeURIComponent(pic);
  return pic;
}

function parseList(html) {
  const items = [];
  const seen = new Set();
  // 注意：首页/分类第 1 页用相对链接 /archives/，分类翻页与搜索页用绝对链接
  // https://www.91cg1.com/archives/，先统一归一化再切块
  const chunks = String(html).replace(/https:\/\/www\.91cg1\.com\/archives\//g, '/archives/').split('<a href="/archives/');
  for (let i = 1; i < chunks.length; i++) {
    const blk = chunks[i].slice(0, 8000);
    const idm = blk.match(/^(\d+)\//);
    if (!idm) continue;
    const url = HOST + 'archives/' + idm[1] + '/';
    if (seen.has(url)) continue;
    const hm = blk.match(/<h2 class="post-card-title"[^>]*>([\s\S]{0,800}?)<\/h2>/i);
    const title = hm ? stripTags(hm[1]) : '';
    if (!title || title.length < 2) continue;
    const pm = blk.match(/loadBannerDirect\('([^']+)'/i);
    seen.add(url);
    items.push({ vod_id: url, vod_name: title, vod_pic: proxyPic(pm ? pm[1] : '') });
    if (items.length >= 24) break;
  }
  return items;
}

function parseDetail(html, rawId) {
  const hm = html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i);
  const title = hm ? stripTags(hm[1]) : '91吃瓜';
  const eps = [];
  const divs = [...html.matchAll(/<div class="dplayer"([^>]*)>/gi)];
  for (const d of divs) {
    const attrs = d[1];
    const cm = attrs.match(/data-config='([^']*)'/i) || attrs.match(/data-config="([^"]*)"/i);
    let url = '';
    if (cm) {
      const cfgText = cm[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      try {
        const cfg = JSON.parse(cfgText);
        if (cfg && cfg.video && cfg.video.url) url = cfg.video.url;
      } catch {}
      if (!url) {
        const um = cfgText.match(/"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
        if (um) url = um[1].replace(/\\\//g, '/');
      }
    }
    if (!url) continue;
    url = url.replace(/\\\//g, '/').replace(/\\u0026/g, '&');
    const tm = attrs.match(/data-video_title="([^"]*)"/i);
    eps.push({ name: tm ? stripTags(tm[1]) : '', url });
  }
  let pic = '';
  // 详情封面在 <meta itemprop="image" content="https://pic.hdhwqx.cn/...">（与列表卡封面同一张）
  const pm = html.match(/<meta itemprop="image" content="([^"]+)"/i)
    || html.match(/loadBannerDirect\('([^']+)'/i);
  if (pm) pic = proxyPic(pm[1]);
  let playUrl = '';
  if (eps.length === 1) playUrl = '播放$' + eps[0].url;
  else if (eps.length > 1) playUrl = eps.map((e, i) => (e.name || ('第' + (i + 1) + '集')) + '$' + e.url).join('#');
  else playUrl = '未找到视频源$' + rawId;
  return { vod_id: rawId, vod_name: title, vod_pic: pic, vod_play_from: '91吃瓜', vod_play_url: playUrl };
}

async function init() { return {}; }

async function home() {
  const html = await getText(HOST, HOST);
  return {
    class: [
      { type_id: 'zxcghl/', type_name: '今日吃瓜' },
      { type_id: 'dydj/', type_name: 'AI短剧' },
      { type_id: 'mrds/', type_name: '每日大赛' },
      { type_id: 'sstp/', type_name: '实时偷拍' },
      { type_id: 'rsdg/', type_name: '最高点击' },
      { type_id: 'lpsd/', type_name: '深夜撸片' },
      { type_id: 'hjll/', type_name: '海角乱伦' },
      { type_id: '91th/', type_name: '91探花' },
      { type_id: 'crdm/', type_name: '成人动漫' },
      { type_id: 'zdtop/', type_name: '91周榜' },
      { type_id: 'ydtop/', type_name: '91月榜' },
      { type_id: 'bcdg/', type_name: '必吃大瓜' },
      { type_id: 'whhl/', type_name: '网红黑料' },
      { type_id: 'mxhl/', type_name: '明星黑料' },
      { type_id: 'qwys/', type_name: '社会奇闻' },
      { type_id: 'xsjlb/', type_name: '师生专栏' },
      { type_id: 'fclv/', type_name: '反差靓女' },
      { type_id: 'gcwh/', type_name: '网黄合集' },
      { type_id: 'aikj/', type_name: '明星AI' },
      { type_id: 'zptp/', type_name: '自拍偷拍' },
      { type_id: 'lqzk/', type_name: '猎奇重口' },
    ],
    filters: {},
    list: parseList(html),
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'zxcghl/');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const base = HOST + 'category/' + tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/' + page + '/');
  const html = await getText(url, HOST);
  const list = parseList(html);
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : HOST + String(raw).replace(/^\/+/, '');
    const html = await getText(url, HOST);
    list.push(parseDetail(html, raw));
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
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  let url = HOST + 'search/' + encodeURIComponent(wd) + '/';
  if (page > 1) url += page + '/';
  const html = await getText(url, HOST);
  const list = parseList(html);
  return { page, pagecount: 9999, limit: 90, total: list.length, list };
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
