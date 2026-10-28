// 91大赛 - CatPawOpen JS Spider
// 站：https://www.dycg66.com/（Typecho Xc 主题，吃瓜/大赛类视频站）
// 已实测（2026-10-28）：
// - 列表卡：<li class="Xc_home_article-si"> 内 <a href="/archives/{id}/" title="...">，
//   <img data-src="https://pic.hdhwqx.cn/upload_01/...jpeg"> 为封面，<h2 class="title"> 为标题；
//   每页 20 条，分类分页 /category/{slug}/{n}/。
// - 封面注意：pic.hdhwqx.cn 直取返回的是加密密文（非 jpeg），必须走 51chigua
//   解密代理（51chigua.li768435813.workers.dev/img?url=），代理后实测为正常 jpeg。
// - 详情：<h1> 为标题；播放器为 <div class="dplayer" data-config="{...}">，
//   data-config（&quot; 转义后 JSON）里 video.url 即 m3u8 直链
//   （如 https://op.udhhzr.cn/videos5/.../....m3u8?auth_key=...，带时效 token，
//   详情时现取现用）；多段时按段列出。
// - 搜索：/search/{kw}/，分页 /search/{kw}/{n}/（?s= 不通）。
import req from '../../util/req.js';

const KEY = 'py_dycg66';
const NAME = '91大赛';
const HOST = 'https://www.dycg66.com/';
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
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function proxyPic(pic) {
  if (!pic) return '';
  if (pic.startsWith('http')) return PROXY + encodeURIComponent(pic);
  return pic;
}

function parseList(html) {
  const items = [];
  const seen = new Set();
  const chunks = String(html).split('<li class="Xc_home_article-si');
  for (let i = 1; i < chunks.length; i++) {
    const blk = chunks[i];
    const am = blk.match(/<a href="([^"]*\/archives\/\d+\/)"[^>]*title="([^"]*)"/i)
      || blk.match(/<a href="([^"]*\/archives\/\d+\/)"/i);
    if (!am) continue;
    const href = am[1];
    const url = href.startsWith('http') ? href : HOST.replace(/\/$/, '') + href;
    if (seen.has(url)) continue;
    const hm = blk.match(/<h2 class="title">([^<]+)<\/h2>/i);
    const title = stripTags(hm ? hm[1] : (am[2] || ''));
    if (!title || title.length < 2) continue;
    const pm = blk.match(/data-src="(https?:[^"]+)"/i);
    seen.add(url);
    items.push({ vod_id: url, vod_name: title, vod_pic: proxyPic(pm ? pm[1] : '') });
    if (items.length >= 20) break;
  }
  return items;
}

function parseDetail(html, rawId) {
  const hm = html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i);
  const title = hm ? stripTags(hm[1]) : '91大赛';
  const eps = [];
  const divs = [...html.matchAll(/<div class="dplayer"([^>]*)>/gi)];
  for (const d of divs) {
    const attrs = d[1];
    const cm = attrs.match(/data-config="([^"]*)"/i);
    let url = '';
    if (cm) {
      const cfgText = cm[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      try {
        const cfg = JSON.parse(cfgText);
        if (cfg && cfg.video && cfg.video.url) url = cfg.video.url;
      } catch {}
      if (!url) {
        const um = cfgText.match(/"url"\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/i);
        if (um) url = um[1];
      }
    }
    if (!url) continue;
    url = url.replace(/\\u0026/g, '&');
    const tm = attrs.match(/data-video_title="([^"]*)"/i);
    eps.push({ name: tm ? stripTags(tm[1]) : '', url });
  }
  let pic = '';
  const dm = html.match(/<div class="dplayer"[^>]*data-config="([^"]*)"/i);
  if (dm) {
    try {
      const cfg = JSON.parse(dm[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      if (cfg && cfg.video && cfg.video.pic) {
        const p = cfg.video.pic;
        pic = proxyPic(p.startsWith('http') ? p : 'https://pic.hdhwqx.cn' + p);
      }
    } catch {}
  }
  let playUrl = '';
  if (eps.length === 1) playUrl = '播放$' + eps[0].url;
  else if (eps.length > 1) playUrl = eps.map((e, i) => (e.name || ('第' + (i + 1) + '集')) + '$' + e.url).join('#');
  else playUrl = '未找到视频源$' + rawId;
  return { vod_id: rawId, vod_name: title, vod_pic: pic, vod_play_from: '91大赛', vod_play_url: playUrl };
}

async function init() { return {}; }

async function home() {
  const html = await getText(HOST, HOST);
  return {
    class: [
      { type_id: 'jrds/', type_name: '今日大赛' },
      { type_id: 'rsds/', type_name: '热搜大赛' },
      { type_id: 'mrds/', type_name: '每日大赛' },
      { type_id: 'aidj/', type_name: 'AI短剧' },
      { type_id: 'nsds/', type_name: '女神大赛' },
      { type_id: 'llds/', type_name: '乱伦大赛' },
      { type_id: 'xyds/', type_name: '学院大赛' },
      { type_id: 'whds/', type_name: '网红大赛' },
      { type_id: 'lyds/', type_name: '撸友看片' },
      { type_id: 'sjbzq/', type_name: '优选投放区' },
      { type_id: 'qwds/', type_name: '奇闻大赛' },
      { type_id: 'mxds/', type_name: '明星吃瓜' },
      { type_id: 'ntds/', type_name: '女同大赛' },
      { type_id: 'wmds/', type_name: '污漫大赛' },
    ],
    filters: {},
    list: parseList(html),
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'mrds/');
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
