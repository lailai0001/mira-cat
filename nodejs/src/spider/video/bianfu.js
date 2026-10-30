// 蝙蝠视频 - CatPawOpen 格式
// 转换自 REX forward.bianfu.tut，站点 https://257915.xyz（页面混淆：反转 base64）
import req from '../../util/req.js';

const KEY = 'py_bianfu';
const NAME = '蝙蝠视频';
const SITE = 'https://257915.xyz';
// 自家抓取中转（2026-10-30 深夜新增，用户部署 site-fetch Worker 后生效；
// 未部署/不通时自动回落直连。Worker 代码见 site-fetch-worker.js）
const WORKER = 'https://site-fetch.li768435813.workers.dev';
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-S9080) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const CATS = [
  { type_id: 'home', type_name: '首页推荐' },
  { type_id: '64360061', type_name: '中文字幕' },
  { type_id: '64370061', type_name: '网红主播' },
  { type_id: '64380061', type_name: '成人动漫' },
  { type_id: '64390061', type_name: '欧美情色' },
  { type_id: '64400061', type_name: '国模私拍' },
  { type_id: '64430061', type_name: '韩国伦理' },
  { type_id: '64170061', type_name: '国产情色' },
  { type_id: '64180061', type_name: '日本无码' },
  { type_id: '64170041', type_name: '日韩无码' },
  { type_id: '64190041', type_name: '欧美精品' },
  { type_id: '64200041', type_name: '国产精品' },
  { type_id: '64360041', type_name: '动漫精品' },
  { type_id: '64390041', type_name: '日韩精品' },
  { type_id: '64430041', type_name: '自拍偷拍' },
  { type_id: '64580041', type_name: '大秀视频' },
  { type_id: '64360111', type_name: '精品推荐' },
  { type_id: '64380111', type_name: '国产色情' },
  { type_id: '64630111', type_name: '91探花' },
  { type_id: '64750111', type_name: '传媒出品' },
  { type_id: '64170031', type_name: '国产自拍' },
  { type_id: '64180031', type_name: '欧美极品' },
  { type_id: '64380031', type_name: '极骚萝莉' },
  { type_id: '64169922', type_name: '国产专区(磁力)' },
  { type_id: '64179922', type_name: '日本有码(磁力)' },
  { type_id: '64189922', type_name: '日本无码(磁力)' },
  { type_id: '64199922', type_name: '欧美色情(磁力)' },
  { type_id: '64209922', type_name: '传媒作品(磁力)' },
  { type_id: '64180121', type_name: '麻豆传媒' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.indexOf('http') === 0) return u;
  if (u.charAt(0) === '/') return SITE + u;
  return SITE + '/' + u;
}

function b64decode(str) {
  str = t(str).replace(/[\r\n\s]/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (!str) return '';
  return Buffer.from(str, 'base64').toString('utf8');
}

function reverseStr(s) {
  return s.split('').reverse().join('');
}

function cleanText(s) {
  return t(s).replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

// 2026-10-30 深夜修复“有分类无内容”：站方本身活着（VM 直连 200、
// 首页 65 条/分类页 20 条均能解出），但设备侧直连拿不到内容（手机网络侧
// 对该域名的拦截/过滤，VM 通不代表设备通）。故抓取改走自家 Worker 优先，
// Worker 内直连（边缘出口干净）+ 不通时自动回落设备直连；两腿都空才返回空。
async function fetchRaw(url) {
  try {
    const { data } = await req.get(WORKER + '/?u=' + encodeURIComponent(url), {
      headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
      timeout: 35000,
    });
    const t = String(data || '');
    if (t && t.length > 1000) return t;
  } catch (e) { /* 回落直连 */ }
  try {
    const { data } = await req.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': SITE + '/',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 20000,
    });
    return String(data || '');
  } catch (e) { return ''; }
}

async function fetchPage(url) {
  let html = await fetchRaw(url);
  if (!html) return '';
  const m = html.match(/\w+\('([A-Za-z0-9+/=]{1000,})/);
  let page = html;
  if (m) {
    try {
      const raw = b64decode(reverseStr(m[1]));
      const idx = raw.indexOf('<!DOCTYPE') >= 0 ? raw.indexOf('<!DOCTYPE') : raw.indexOf('<html');
      page = idx >= 0 ? raw.slice(idx) : raw;
    } catch (e) { page = html; }
  }
  page = page.replace(/document\.write\(d\('([^']+)'\)\);/g, (_, b64) => {
    try { return b64decode(b64); } catch (e) { return ''; }
  });
  page = page.replace(/<span[^>]*?display\s*:\s*none[^>]*?>[\s\S]*?<\/span>/gi, '');
  return page;
}

function parseList(html) {
  const items = [];
  const seen = {};
  if (!html) return items;
  const blocks = html.split(/<dl>/i);
  for (let i = 1; i < blocks.length; i++) {
    const dl = (blocks[i].split(/<\/dl>/i)[0]) || '';
    const am = dl.match(/href="((?:\/video\.php|\/torrent\.php)\?id=\d+)"/i);
    if (!am) continue;
    const path = am[1];
    if (seen[path]) continue;
    seen[path] = 1;
    const im = dl.match(/<img[^>]+src="([^"]+)"/i);
    const pic = im ? im[1] : '';
    const tm = dl.match(/<h3>([\s\S]*?)<\/h3>/i);
    const name = cleanText(tm ? tm[1] : '');
    if (!name || name.length > 120) continue;
    items.push({
      vod_id: 'bf:' + path,
      vod_name: name,
      vod_pic: absUrl(pic),
      vod_remarks: path.indexOf('torrent') >= 0 ? '磁力' : '',
    });
  }
  return items;
}

// 旧 home 只返分类不返列表，首页内容区恒空；现补首页推荐列表
async function home() {
  let list = [];
  try {
    const html = await fetchPage(SITE + '/');
    list = parseList(html);
  } catch (e) { list = []; }
  return { class: CATS, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(Array.isArray(body.id) ? body.id[0] : body.id || body.tid || 'home');
  const page = Math.max(1, parseInt(body.page) || 1);
  let html;
  if (!tid || tid === 'home') {
    if (page > 1) {
      html = await fetchPage(SITE + '/list.php?id=64360061&page=' + page);
    } else {
      html = await fetchPage(SITE + '/');
    }
  } else {
    html = await fetchPage(SITE + '/list.php?id=' + encodeURIComponent(tid) + '&page=' + page);
  }
  const list = parseList(html);
  return { page, pagecount: list.length ? page + 1 : page, list };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  if (!kw) return { list: [] };
  const out = [];
  const seen = {};
  for (let ti = 0; ti < 2; ti++) {
    const url = SITE + '/search.php?content=' + encodeURIComponent(kw) + '&type=' + (ti + 1);
    try {
      const html = await fetchPage(url);
      for (const it of parseList(html)) {
        if (!seen[it.vod_id]) { seen[it.vod_id] = 1; out.push(it); }
      }
    } catch (e) {}
  }
  return { list: out };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const path = id.replace(/^bf:/, '');
  if (!path) return { list: [] };
  const html = await fetchPage(absUrl(path));
  let title = '';
  const hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (hm) title = cleanText(hm[1]);
  title = title || path;
  let pic = '';
  const pm = html.match(/<img[^>]+src="([^"]+)"/i);
  if (pm) pic = absUrl(pm[1]);
  const playFrom = [];
  const playUrls = [];
  if (path.indexOf('torrent') >= 0) {
    const mm = html.match(/magnet:\?[^\s"'<>]+/i);
    if (mm) {
      playFrom.push('磁力');
      playUrls.push('磁力$' + mm[0]);
    }
  } else {
    const m2 = html.match(/playFilteredHLS\s*\(\s*['"]video['"]\s*,\s*['"]([^'"]+)['"]/i);
    if (m2) {
      playFrom.push('在线');
      playUrls.push('在线$' + t(m2[1]));
    }
  }
  return {
    list: [{
      vod_id: 'bf:' + path,
      vod_name: title,
      vod_pic: pic,
      vod_play_from: playFrom.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  // 格式：名称$地址
  const idx = id.indexOf('$');
  let url = idx >= 0 ? id.slice(idx + 1) : id;
  url = t(url);
  if (!url) return { parse: 0, url: '' };
  if (url.indexOf('magnet:') === 0) {
    return { parse: 0, url };
  }
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': SITE + '/' },
  };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
