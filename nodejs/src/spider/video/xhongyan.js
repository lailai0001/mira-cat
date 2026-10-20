import req from '../../util/req.js';

// X红颜 (py_xhongyan)
// 站点: https://xhongyan.com (MacCMS 站，无 VIP)
// 2026-10-20 实测结构:
//   列表卡片: <a class="videoBox" href="/index.php/vod/play/id/{id}/sid/1/nid/1.html">
//             封面取卡片 img 的 data-src (主站 /upload/vod/... 直链，无需代理)，
//             标题取 img alt，时长 span.videoBox-time。
//             vod_id 直接用帖子 id (详情页 /index.php/vod/detail/id/{id}.html)。
//   分类: 最新更新 /index.php/label/new.html (分页 /index.php/label/new/page/{n}.html，41 页，28 条/页)
//         热门推荐 /index.php/label/hot.html (单页 28 条)
//         onlyfans type 1 (5 页) / 网黄 type 2 (24 页) / 品牌 type 3 (6 页) / 业余 type 4 (24 页)
//         type 分页 /index.php/vod/type/id/{tid}/page/{n}.html，20 条/页
//         总页数从 layui-laypage-count "1/N" 或尾页 data-page 解析。
//   搜索: /index.php/vod/search/wd/{wd}.html，分页 /index.php/vod/search/page/{n}/wd/{wd}.html。
//   详情: h1 标题 + .detail-pic img 封面；播放源 sid 列表从详情页 play 链接解析
//         (实测帖子有 sid 1/2 两条线路，均为同站自托管 mp4 的不同文件)。
//   播放: 播放页 var player_data={...}，实测 encrypt=0、trysee=0、points=0，
//         url 为站方自托管带 md5/expires 签名的 mp4 相对路径。请求主站该地址
//         先 302 跳 CDN 子域名 (形如 1.onlyfans18.vip，不写死，跟跳即可)，
//         随后 206 video/mp4。play() 服务端先跟一次跳转拿 CDN 直链再 parse:0
//         返回 (个别播放器不跟 302)。encrypt=1/2 分支按 MacCMS 标准附带作保险。

const KEY = 'py_xhongyan';
const NAME = 'X红颜';
const SITE = 'https://xhongyan.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

const CATS = [
  { type_id: 'new', type_name: '最新更新', kind: 'label', slug: 'new' },
  { type_id: 'hot', type_name: '热门推荐', kind: 'label', slug: 'hot' },
  { type_id: '1', type_name: 'onlyfans', kind: 'type' },
  { type_id: '2', type_name: '网黄', kind: 'type' },
  { type_id: '3', type_name: '品牌', kind: 'type' },
  { type_id: '4', type_name: '业余', kind: 'type' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
}

function fixUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return SITE + (u.startsWith('/') ? u : '/' + u);
}

// 带超时的原生 fetch 取文本 (req 兜底通道)
async function timedFetchText(url, headers, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// 取页面 HTML: 框架 req 优先，fetch 兜底
async function getHtml(url) {
  const headers = { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 15000 });
    if (status === 200 && typeof data === 'string' && data) return data;
  } catch (e) { /* 换 fetch */ }
  return timedFetchText(url, headers, 15000);
}

// 解析列表卡片 (首页/分类/搜索通用)
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(?:https?:\/\/xhongyan\.com)?\/index\.php\/vod\/play\/id\/(\d+)\/sid\/\d+\/nid\/1\.html"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const win = html.slice(m.index, m.index + 1800);
    let pic = '';
    const dsM = win.match(/data-src="([^"]+)"/);
    if (dsM) pic = fixUrl(dsM[1]);
    if (!pic) {
      const srcM = win.match(/<img[^>]+src="(\/upload\/[^"]+)"/);
      if (srcM) pic = fixUrl(srcM[1]);
    }
    let title = '';
    const altM = win.match(/<img[^>]+alt="([^"]*)"/);
    if (altM) title = clean(altM[1]);
    let remarks = '';
    const tm = win.match(/videoBox-time"[^>]*>([^<]+)</);
    if (tm) remarks = clean(tm[1]);
    out.push({
      vod_id: id,
      vod_name: title || id,
      vod_pic: pic,
      vod_remarks: remarks,
    });
  }
  return out;
}

function parsePagecount(html) {
  let pc = 1;
  const cm = html.match(/layui-laypage-count">\s*\d+\s*\/\s*(\d+)/);
  if (cm) pc = Math.max(pc, parseInt(cm[1], 10) || 1);
  const lm = html.match(/layui-laypage-last"\s+data-page="(\d+)"/);
  if (lm) pc = Math.max(pc, parseInt(lm[1], 10) || 1);
  return pc;
}

function catOf(tid) {
  return CATS.find(c => c.type_id === String(tid)) || CATS[0];
}

function catUrl(cat, page) {
  page = Math.max(1, page || 1);
  if (cat.kind === 'label') {
    return page > 1 ? `${SITE}/index.php/label/${cat.slug}/page/${page}.html` : `${SITE}/index.php/label/${cat.slug}.html`;
  }
  return page > 1 ? `${SITE}/index.php/vod/type/id/${cat.type_id}/page/${page}.html` : `${SITE}/index.php/vod/type/id/${cat.type_id}.html`;
}

async function buildList(url, page, limit) {
  limit = limit || 30;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

// 跟一次 302 拿到最终地址 (拿不到就返回原地址)
async function followOnce(url, referer) {
  const headers = { 'User-Agent': UA, 'Referer': referer || REFERER };
  try {
    const r = await req.get(url, { headers, timeout: 10000, maxRedirects: 0, validateStatus: () => true });
    const loc = r.headers && (r.headers.location || r.headers.Location);
    if (r.status >= 300 && r.status < 400 && loc) return fixUrl(loc);
    if (r.status === 200 || r.status === 206) return url;
  } catch (e) { /* 换 fetch */ }
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(url, { headers, redirect: 'manual', signal: ctl.signal });
    clearTimeout(to);
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) return new URL(loc, url).toString();
  } catch (e) { /* ignore */ }
  return url;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(SITE + '/');
  const list = html ? parseCards(html).slice(0, 30) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'new';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = catOf(tid);
  return buildList(catUrl(cat, page), page, 30);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // id 兼容完整详情 URL 或纯数字
  const idm = id.match(/id\/(\d+)/) || id.match(/^(\d+)$/);
  if (idm) id = idm[1];
  const durl = `${SITE}/index.php/vod/detail/id/${id}.html`;
  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  if (h1) name = clean(h1[1]);
  let pic = '';
  const pm = html.match(/detail-pic[^>]*>[\s\S]{0,200}?<img[^>]+src="([^"]+)"/);
  if (pm) pic = fixUrl(pm[1]);
  if (!pic) {
    const og = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (og) pic = fixUrl(og[1]);
  }
  // 播放源 sid 列表 (详情页 play 链接)
  const sids = [...new Set([...html.matchAll(new RegExp(`/vod/play/id/${id}/sid/(\\d+)/nid/1\\.html`, 'g'))].map(x => x[1]))].sort();
  const useSids = sids.length ? sids : ['1'];
  const from = useSids.map((s, i) => '线路' + (i + 1)).join('$$$');
  const purl = useSids.map(s => `正片$${SITE}/index.php/vod/play/id/${id}/sid/${s}/nid/1.html`).join('$$$');

  return {
    list: [{
      vod_id: id,
      vod_name: name || id,
      vod_pic: pic,
      vod_remarks: '',
      vod_content: name,
      vod_play_from: from,
      vod_play_url: purl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const purl = fixUrl(id);
  const html = await getHtml(purl);
  if (!html) return { parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  const dm = html.match(/var\s+player_data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/) || html.match(/var\s+player_data\s*=\s*(\{[^{}]*\})/);
  if (!dm) return { parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  let pd = null;
  try { pd = JSON.parse(dm[1]); } catch (e) { /* fallthrough */ }
  if (!pd || !pd.url) return { parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  let raw = String(pd.url);
  const enc = parseInt(pd.encrypt, 10) || 0;
  try {
    if (enc === 1) raw = unescape(raw);
    else if (enc === 2) raw = unescape(Buffer.from(raw, 'base64').toString('utf8'));
  } catch (e) { /* 用原始 url */ }
  const abs = fixUrl(raw);
  const final = await followOnce(abs, purl);
  return { parse: 0, url: final, header: { 'User-Agent': UA, 'Referer': purl } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  const enc = encodeURIComponent(wd);
  const url = page > 1 ? `${SITE}/index.php/vod/search/page/${page}/wd/${enc}.html` : `${SITE}/index.php/vod/search/wd/${enc}.html`;
  return buildList(url, page, 30);
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
