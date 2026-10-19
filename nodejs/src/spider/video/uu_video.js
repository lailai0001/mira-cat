// Uu视频 - CatPawOpen JS Spider
// 站点: https://nfu.rftsln9.com (入口 https://utv2.cc)
// 注意: 站点有 JS 反爬验证，服务端 curl 无法获取真实内容
// 列表 URL 模式: {domain}/videos/more?blockId={id}&blockType={hot|cate}&blockTitle={URL编码}
// 分类 blockId 来源: 任务提供的实测值（部分）
// 请求: 双通道 — 先框架 req(axios, MiraPlayer 内核可用)，失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_uuvideo';
const NAME = 'Uu视频';
const HOST = 'https://nfu.rftsln9.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';

// 分类列表（blockId 实测值，未实测的用占位，待真机验证修正）
const CATEGORIES = [
  { type_id: '2', type_name: '热门', block_type: 'hot' },
  { type_id: '6', type_name: '黑料', block_type: 'cate' },
  { type_id: '7', type_name: '传媒', block_type: 'cate' },
  { type_id: '9', type_name: '日本AV', block_type: 'cate' },
  { type_id: '10', type_name: 'AV无码', block_type: 'cate' },
  { type_id: '11', type_name: '欧美', block_type: 'cate' },
  { type_id: '12', type_name: '动漫', block_type: 'cate' },
  { type_id: '13', type_name: '三级', block_type: 'cate' },
  { type_id: '14', type_name: 'ai短剧', block_type: 'cate' },
  { type_id: '15', type_name: '麻豆', block_type: 'cate' },
  { type_id: '16', type_name: '擦边短剧', block_type: 'cate' },
  { type_id: '17', type_name: 'AI换脸', block_type: 'cate' },
  { type_id: '18', type_name: '探花', block_type: 'cate' },
  { type_id: '19', type_name: '乱伦', block_type: 'cate' },
  { type_id: '20', type_name: '自拍', block_type: 'cate' },
  { type_id: '21', type_name: '强奸', block_type: 'cate' },
  { type_id: '22', type_name: '中文字幕', block_type: 'cate' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

async function getText(url, retries = 2) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': HOST + '/',
  };
  for (let i = 0; i < retries; i++) {
    // 通道1: 框架 req (axios) — MiraPlayer 内核可用
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const txt = String(data || '');
      if (status === 200 && txt.length > 500) return txt;
    } catch { /* 换通道2 */ }
    // 通道2: Node 原生 fetch
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const txt = await r.text();
      if (txt && txt.length > 500) return txt;
    } catch { /* retry */ }
  }
  return '';
}

function absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return HOST + u;
  return HOST + '/' + u;
}

// 解析视频列表（兼容多种卡片结构）
function parseList(html) {
  const videos = [];
  if (!html || html.includes('正在验证')) return videos;
  const seen = new Set();

  // 模式1: 标准卡片 <a href="/videos/xxx" ...><img src="...">
  const cardRe = /<a[^>]+href="(\/videos?\/[^"]+)"[^>]*>([\s\S]{0,800}?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2];
    // 提取 ID
    const idm = href.match(/(\d+)/);
    if (!idm) continue;
    const vodId = idm[1];
    if (seen.has(vodId)) continue;

    // 标题
    let name = '';
    const tm = inner.match(/title="([^"]+)"/) || inner.match(/alt="([^"]+)"/);
    if (tm) name = stripTags(tm[1]);
    if (!name) {
      const hm = inner.match(/<[^>]+class="[^"]*title[^"]*"[^>]*>([^<]{2,60})</i);
      if (hm) name = stripTags(hm[1]);
    }
    if (!name) continue;

    // 封面
    let pic = '';
    const pm = inner.match(/(?:data-original|data-src|src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    if (pm) pic = absUrl(pm[1]);

    // 时长
    let remarks = '';
    const dm = inner.match(/(\d{1,3}:\d{2}(?::\d{2})?)/);
    if (dm) remarks = dm[1];

    seen.add(vodId);
    videos.push({
      vod_id: vodId,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
    });
  }
  return videos;
}

function buildListUrl(cat, page) {
  const blockTitle = encodeURIComponent(cat.type_name);
  let url = `${HOST}/videos/more?blockId=${cat.type_id}&blockType=${cat.block_type}&blockTitle=${blockTitle}`;
  if (page > 1) url += `&page=${page}`;
  return url;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  // 首页返回热门分类的第一页作为推荐
  const cat = CATEGORIES[0];
  const url = buildListUrl(cat, 1);
  const html = await getText(url);
  const list = parseList(html);
  return {
    class: CATEGORIES.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    list,
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || '2');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATEGORIES.find(c => c.type_id === tid) || CATEGORIES[0];
  const url = buildListUrl(cat, page);
  const html = await getText(url);
  const list = parseList(html);
  return { page, pagecount: page + (list.length >= 20 ? 1 : 0), limit: 20, total: list.length, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const vodId = String(raw).trim();
    // 尝试多种详情页 URL 模式
    const urls = [
      `${HOST}/videos/${vodId}`,
      `${HOST}/video/${vodId}`,
      `${HOST}/play/${vodId}`,
    ];
    let html = '';
    for (const u of urls) {
      html = await getText(u);
      if (html && html.length > 1000 && !html.includes('正在验证')) break;
      html = '';
    }
    if (!html) continue;

    let name = '';
    let m = html.match(/<h1[^>]*>([^<]{2,100})</i) || html.match(/<title>([^<]{2,100})</i);
    if (m) name = stripTags(m[1]).replace(/\s*[-_|].*$/, '').trim();

    let pic = '';
    m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (m) pic = absUrl(m[1]);

    // 播放地址：找 m3u8 或 mp4
    const playUrls = [];
    const seen = new Set();
    const urlRe = /["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/gi;
    while ((m = urlRe.exec(html)) !== null) {
      const u = m[1];
      if (seen.has(u)) continue;
      seen.add(u);
      playUrls.push(u);
    }
    // 找 video 标签的 src
    const vsrc = html.match(/<video[^>]+src="([^"]+)"/i) || html.match(/<source[^>]+src="([^"]+)"/i);
    if (vsrc && !seen.has(vsrc[1])) {
      playUrls.push(vsrc[1]);
    }

    const vod_play_from = 'Uu视频';
    const vod_play_url = playUrls.map((u, i) => `第${i + 1}集$${u}`).join('#');

    list.push({
      vod_id: vodId,
      vod_name: name || `视频 ${vodId}`,
      vod_pic: pic,
      vod_play_from,
      vod_play_url,
    });
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "第1集$https://...m3u8" 形式
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/^https?:\/\//i.test(id)) {
    return {
      parse: 0,
      url: id,
      header: { Referer: HOST + '/', 'User-Agent': UA },
    };
  }
  // 如果是纯 ID，尝试重新获取详情页解析
  const d = await detail({ body: { id } });
  const item = d.list && d.list[0];
  if (item && item.vod_play_url) {
    const first = item.vod_play_url.split('#')[0];
    const url = first.includes('$') ? first.split('$').pop() : first;
    return { parse: 0, url, header: { Referer: HOST + '/', 'User-Agent': UA } };
  }
  return { parse: 0, url: id };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const url = `${HOST}/search?wd=${encodeURIComponent(wd)}&page=${page}`;
  const html = await getText(url);
  const list = parseList(html);
  return { page, pagecount: page, limit: 20, total: list.length, list };
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
