import req from '../../util/req.js';

// AvHub (py_avhub)
// 站点: https://avhub360.com/ (国产/JAV 站，无反爬，服务端渲染)
// 列表翻页 (2026-10-20 两轮实测, 29 个分类第 1/2 页全部通过):
//   /new[/{page}]  /popular/today[/{page}]
//   标签: /tags/{id} 第1页, /tags/{id}/latest/{page} 第2页起 (pagecount 从翻页区"最后»"解析, 如 tag171 有 1049 页)
//   主题: /theme/detail/{id} 第1页, /theme/detail/{id}/update/{page} 第2页起 (theme3 有 649 页, theme58 有 12 页)
//         /theme/detail/11/hot[/{page}] (60 页)
//   /popular (热门) 本身是 /popular/week 的别名, 翻页走 /popular/week/{page} (共 40 页);
//         第一轮误判为单页 (tpl=null) 导致 App 里"热门"加载不出更多内容, 本轮修正。
// 卡片: <a href="/videos/{code}" data-mv-id> > img (封面在 data-src 或 z-image-loader-url, 懒加载)
// 封面: image.cpckgr.cn 上的图是 AES-128-CBC 加密的 (key f5d965df75336270, iv 97b60394abc2fbe1,
//       CryptoJS 默认 PKCS7 填充, 解密后即 JPEG)。
//       第一轮用本地 /proxy/img 解密出图, 但 App 的图片加载走 js2p 本地地址拿不到图 (chigua57 的
//       既有教训: 图片必须走真实 https 地址)。本轮改走用户自建 Worker (同 hl818/bagua 的方案):
//       该 Worker 有域名白名单 (pic.jtzatly.cn / pic.drleao.cn 已放行, image.cpckgr.cn 未放行会 400),
//       而 cpckgr 与 jtzatly 是同路径镜像 —— 把封面域名换成 pic.jtzatly.cn 再拼 Worker 地址。
//       VM 实测 4 张 AvHub 封面经此路径返回的字节与本地解密逐字节一致 (200, image/jpeg, ffd8 魔数)。
// 详情: /videos/{code} (标题 og:title, 封面 og:image 为 /seo/default/ 统一占位图, 不可用; 真封面取页面 JSON 的 videoCover)
// 播放: GET /media/{code} (带 Referer) 的行为按视频托管类型分三种 (VM 实测):
//       (a) cloud_01/m3m/videos5 型: 302 跳 jw-hls.wgmyvq.cn 的 m3u8 直链, 可直拉, 但 Content-Type
//           是 text/plain, iOS AVPlayer 会拒绝 —— 需本地代理只改 Content-Type (分片/密钥公开直连)。
//       (b) fangzhou 型 (fz 开头 code, 标签分类里占多数): /media 像抽奖 —— 约一半概率直接 200 返回
//           真 m3u8 (分片在 fangz-pic*.bedfpk.cn, 无加密, 公开直拉), 另一半 302 跳到
//           jw-hls 的 /fangzhou/manifests/playback/ 网关, 该网关拉取必 502 (死链)。
//           第一轮代码拿第一个 302 就走, 抽到死链即全灭 —— 这是"多数分类无法播放"的根因。
//       修复: play 只返回本地代理 /proxy/m3u8 (u=/media 地址), 由代理在播放时解析:
//           循环请求 /media (最多 5 次), 拿到 200 真 m3u8 或可拉取的 302 目标即返回 (改 CT + 相对地址转绝对);
//           抽到死网关就换一次 /media 重抽 (每次 auth_key 都是新的)。全部失败才 302 降级到最后的目标地址。
// 搜索: /search/{kw}[/{page}] (24条/页)

const KEY = 'py_avhub';
const NAME = 'AvHub';
const SITE = 'https://avhub360.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 分类: first = 第1页路径; tpl = 第2页起的路径模板 ({p} 为页码), null 表示真单页
// pc = pagecount 兜底值; 运行时优先从页面翻页区解析真实总页数
const CATS = [
  { type_id: 'new', type_name: '最新发布', first: '/new', tpl: '/new/{p}', pc: 500 },
  { type_id: 'today', type_name: '今日热门', first: '/popular/today', tpl: '/popular/today/{p}', pc: 100 },
  { type_id: 'popular', type_name: '热门', first: '/popular', tpl: '/popular/week/{p}', pc: 40 },
  { type_id: 'theme:3', type_name: '中文字幕', first: '/theme/detail/3', tpl: '/theme/detail/3/update/{p}', pc: 649 },
  { type_id: 'theme:11', type_name: '高清无码', first: '/theme/detail/11/hot', tpl: '/theme/detail/11/hot/{p}', pc: 60 },
  { type_id: 'theme:58', type_name: 'AI短剧', first: '/theme/detail/58', tpl: '/theme/detail/58/update/{p}', pc: 12 },
  { type_id: 'tag:171', type_name: '少女', first: '/tags/171', tpl: '/tags/171/latest/{p}', pc: 1049 },
  { type_id: 'tag:182', type_name: '中出', first: '/tags/182', tpl: '/tags/182/latest/{p}', pc: 100 },
  { type_id: 'tag:170', type_name: '巨乳', first: '/tags/170', tpl: '/tags/170/latest/{p}', pc: 100 },
  { type_id: 'tag:172', type_name: '颜射', first: '/tags/172', tpl: '/tags/172/latest/{p}', pc: 100 },
  { type_id: 'tag:231', type_name: '人妻', first: '/tags/231', tpl: '/tags/231/latest/{p}', pc: 100 },
  { type_id: 'tag:167', type_name: '短发', first: '/tags/167', tpl: '/tags/167/latest/{p}', pc: 100 },
  { type_id: 'tag:146', type_name: '丝袜', first: '/tags/146', tpl: '/tags/146/latest/{p}', pc: 100 },
  { type_id: 'tag:179', type_name: '口爆', first: '/tags/179', tpl: '/tags/179/latest/{p}', pc: 100 },
  { type_id: 'tag:212', type_name: '出轨', first: '/tags/212', tpl: '/tags/212/latest/{p}', pc: 100 },
  { type_id: 'tag:201', type_name: '3P', first: '/tags/201', tpl: '/tags/201/latest/{p}', pc: 100 },
  { type_id: 'tag:181', type_name: '乳交', first: '/tags/181', tpl: '/tags/181/latest/{p}', pc: 100 },
  { type_id: 'tag:164', type_name: '美腿', first: '/tags/164', tpl: '/tags/164/latest/{p}', pc: 100 },
  { type_id: 'tag:169', type_name: '熟女', first: '/tags/169', tpl: '/tags/169/latest/{p}', pc: 100 },
  { type_id: 'tag:189', type_name: '痴女', first: '/tags/189', tpl: '/tags/189/latest/{p}', pc: 100 },
  { type_id: 'tag:151', type_name: '校服', first: '/tags/151', tpl: '/tags/151/latest/{p}', pc: 100 },
  { type_id: 'tag:176', type_name: '潮吹', first: '/tags/176', tpl: '/tags/176/latest/{p}', pc: 100 },
  { type_id: 'tag:185', type_name: '调教', first: '/tags/185', tpl: '/tags/185/latest/{p}', pc: 100 },
  { type_id: 'tag:180', type_name: '口交', first: '/tags/180', tpl: '/tags/180/latest/{p}', pc: 100 },
  { type_id: 'tag:197', type_name: '多P', first: '/tags/197', tpl: '/tags/197/latest/{p}', pc: 100 },
  { type_id: 'tag:199', type_name: '凌辱', first: '/tags/199', tpl: '/tags/199/latest/{p}', pc: 100 },
  { type_id: 'tag:178', type_name: '接吻', first: '/tags/178', tpl: '/tags/178/latest/{p}', pc: 100 },
  { type_id: 'tag:217', type_name: 'NTR', first: '/tags/217', tpl: '/tags/217/latest/{p}', pc: 100 },
  { type_id: 'tag:149', type_name: '渔网', first: '/tags/149', tpl: '/tags/149/latest/{p}', pc: 100 },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function fixUrl(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return u;
}

// 双通道: 先框架 req，失败再原生 fetch
async function getHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Referer': REFERER,
  };
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 解析视频卡片: <a href="/videos/{code}" ... data-mv-id="N" ...> <img ... alt="标题">
// 封面懒加载: 优先 data-src, 其次 z-image-loader-url, 再 src
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(\/videos\/[A-Za-z0-9\-_]+)"[^>]*data-mv-id[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = m[1].replace('/videos/', '');
    if (seen.has(code)) continue;
    seen.add(code);
    const win = html.slice(m.index, m.index + 2500);
    const imgM = win.match(/<img[^>]+>/);
    let pic = '';
    let title = '';
    if (imgM) {
      const tag = imgM[0];
      const ds = tag.match(/data-src="([^"]+)"/);
      const zl = tag.match(/z-image-loader-url="([^"]+)"/);
      const sc = tag.match(/\ssrc="([^"]+)"/);
      pic = (ds && ds[1]) || (zl && zl[1]) || (sc && sc[1]) || '';
      const altM = tag.match(/alt="([^"]*)"/);
      if (altM) title = clean(altM[1]).replace(/\s*\?>+\s*$/, '').trim();
    }
    if (!title) title = code.toUpperCase();
    out.push({
      vod_id: SITE + '/videos/' + code,
      vod_name: title,
      vod_pic: fixUrl(pic),
      vod_remarks: '',
    });
  }
  return out;
}

// 从翻页区解析真实总页数: 找 tpl 模式 (如 /tags/171/latest/1049) 或 first/数字 的最大页码
function parsePagecount(html, cat, fallback) {
  if (!cat || !cat.tpl) return 1;
  try {
    const stem = cat.tpl.replace('/{p}', '/'); // 如 /tags/171/latest/
    const re = new RegExp('href="' + stem.replace(/\//g, '\\/') + '(\\d+)"', 'g');
    let m;
    let max = 0;
    while ((m = re.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > max && n < 100000) max = n;
    }
    if (max > 0) return max;
  } catch (e) { /* ignore */ }
  return fallback || 1;
}

function catOf(tid) {
  return CATS.find(c => c.type_id === tid) || CATS[0];
}

function catUrl(cat, page) {
  if (page > 1 && cat.tpl) return SITE + cat.tpl.replace('{p}', String(page));
  return SITE + cat.first;
}

function buildList(url, page, cat, limit, reqIn) {
  limit = limit || 21;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    if (reqIn) list.forEach(v => { v.vod_pic = picProxy(v.vod_pic, reqIn); });
    const pc = cat ? parsePagecount(html, cat, cat.pc) : page;
    return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
  });
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(SITE + '/new');
  const list = html ? parseCards(html).slice(0, 21) : [];
  list.forEach(v => { v.vod_pic = picProxy(v.vod_pic, reqIn); });
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'new';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = catOf(tid);
  return buildList(catUrl(cat, page), page, cat, 21, reqIn);
}

function codeFromId(id) {
  id = t(id);
  if (!id) return '';
  if (id.includes('$')) id = id.split('$').pop().trim();
  const m = id.match(/\/videos\/([A-Za-z0-9\-_]+)/);
  if (m) return m[1];
  if (/\/media\/([A-Za-z0-9\-_]+)/.test(id)) return id.match(/\/media\/([A-Za-z0-9\-_]+)/)[1];
  return id.replace(/^\/+|\/+$/g, '');
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const code = codeFromId(body.id);
  if (!code) return { list: [] };
  const durl = SITE + '/videos/' + code;
  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const og = html.match(/<meta property="og:title" content="([^"]+)"/);
  if (og) name = clean(og[1]).replace(/\s*-\s*番号AV.*$/, '').replace(/\s*-\s*AVHub\s*$/, '').trim();
  if (!name) {
    const tm = html.match(/<title>([^<]*)<\/title>/);
    if (tm) name = clean(tm[1]).replace(/\s*-\s*番号AV.*$/, '').trim();
  }
  if (!name) name = code.toUpperCase();

  // 真封面在页面 JSON 的 videoCover 字段 (og:image 是 /seo/default/ 占位图, 不可用)
  let pic = '';
  const vc = html.match(/"videoCover":"((?:\\.|[^"\\])*)"/);
  if (vc) pic = vc[1].replace(/\\\//g, '/').replace(/\\"/g, '"');
  if (!pic) {
    const ogi = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogi) pic = ogi[1];
  }

  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: picProxy(fixUrl(pic), reqIn),
      vod_remarks: code.toUpperCase(),
      vod_content: name,
      vod_play_from: 'AvHub',
      vod_play_url: '正片$' + SITE + '/media/' + code,
    }],
  };
}

// ---------- m3u8 代理 (修正 CDN 的 text/plain Content-Type, 分片/密钥透传) ----------

// base64url 编码 (供代理 URL 的 query 参数)
function b64url(s) {
  try {
    return Buffer.from(String(s), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (e) { return ''; }
}

function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// 构造本地代理地址 (js2p://_WEB_ 为 App 动态地址 scheme, 同 ffm3u8/javmobile 先例)
function proxyUrl(reqIn, path, targetUrl, referer) {
  try {
    const server = reqIn?.server;
    const dynamic = server?.address?.()?.dynamic || 'js2p://_WEB_';
    const prefix = server?.prefix || ('/spider/' + KEY + '/3');
    return `${dynamic}${prefix}${path}?u=${b64url(targetUrl)}&r=${b64url(referer || '')}`;
  } catch (e) { return ''; }
}

function absUrl(u, base) {
  try { return new URL(u, base).toString(); } catch (e) { return u; }
}

// 封面解密出图: 走用户自建 Worker (真实 https 地址; App 图片加载走不了本地 js2p 代理)。
// Worker 有域名白名单, image.cpckgr.cn 未放行 (实测 400 Invalid URL); cpckgr 与 pic.jtzatly.cn
// 是同路径镜像 (jtzatly 已放行), 先换域名再拼 Worker 地址 (与 hl818/bagua 的 IMG_PROXY 拼法一致)。
const IMG_PROXY = 'https://bagua-img-proxy.li768435813.workers.dev/img?url=';
function picProxy(pic, reqIn) {
  pic = t(pic);
  if (!pic) return pic;
  if (/workers\.dev/i.test(pic)) return pic;
  if (!/cpckgr\.cn/i.test(pic)) return pic;
  const swapped = pic.replace(/^[a-z]+:\/\/[^/]*cpckgr\.cn/i, 'https://pic.jtzatly.cn');
  return IMG_PROXY + encodeURIComponent(swapped);
}

// m3u8 仅修正相对地址 -> 绝对地址; 分片/密钥本就是公开绝对地址, 保持直连不经代理
function rewriteM3u8(raw, m3u8Url) {
  const lines = String(raw).split(/\r?\n/);
  const out = lines.map(line => {
    const s = line.trim();
    if (!s) return line;
    if (s.startsWith('#')) {
      if (s.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (all, uri) => {
          const clean = uri.replace(/&amp;/g, '&');
          if (/^https?:\/\//i.test(clean)) return all;
          return `URI="${absUrl(clean, m3u8Url)}"`;
        });
      }
      return line;
    }
    const clean = s.replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(clean)) return line;
    return absUrl(clean, m3u8Url);
  });
  return out.join('\n');
}

async function fetchText(url, headers) {
  try {
    const { data, status } = await req.get(url, { headers, timeout: 20000 });
    if (status === 200 && data) return typeof data === 'string' ? data : String(data);
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) return await r.text();
  } catch (e) { /* ignore */ }
  return '';
}

// 手动重定向版文本请求: 返回 { status, location, body } (req 优先, fetch 兜底)
async function fetchManual(url, headers) {
  try {
    const resp = await req.get(url, {
      headers, timeout: 20000, maxRedirects: 0,
      validateStatus: s => s >= 200 && s < 400,
    });
    const loc = (resp.headers && (resp.headers.location || resp.headers.Location)) || '';
    const body = typeof resp.data === 'string' ? resp.data : (resp.data ? String(resp.data) : '');
    return { status: resp.status, location: loc, body };
  } catch (e) {
    const r2 = e && e.response;
    if (r2 && r2.status >= 300 && r2.status < 400) {
      const loc = (r2.headers && (r2.headers.location || r2.headers.Location)) || '';
      return { status: r2.status, location: loc, body: '' };
    }
  }
  try {
    const r = await fetch(url, { headers, redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    const body = r.status === 200 ? await r.text() : '';
    return { status: r.status, location: loc, body };
  } catch (e) { /* ignore */ }
  return { status: 0, location: '', body: '' };
}

// GET /proxy/m3u8?u={b64url 目标}&r={b64url referer}
// 目标是 /media/{code} 时: 循环解析 (fangzhou 型 /media 是抽奖: 200 真 m3u8 或 302 死网关, 抽到死链重抽);
// 目标是直链 m3u8 时: 拉取后只改 Content-Type 返回。分片/密钥一律保持公开直连, 不经代理。
async function m3u8Proxy(request, reply) {
  const q = request?.query || {};
  if (!q.u) { reply.code(400).send('missing u'); return; }
  let target = '';
  let referer = REFERER;
  try {
    target = unb64url(q.u);
    if (q.r) referer = unb64url(q.r) || referer;
  } catch (e) { reply.code(400).send('bad u'); return; }
  if (!/^https?:\/\//.test(target)) { reply.code(400).send('bad u'); return; }
  const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': referer };
  const sendList = (raw, base) => {
    reply.header('Content-Type', 'application/vnd.apple.mpegurl');
    reply.header('Cache-Control', 'no-cache');
    reply.send(rewriteM3u8(raw, base));
  };

  const mediaM = target.match(/\/media\/([A-Za-z0-9\-_]+)/);
  if (!mediaM) {
    const raw = await fetchText(target, headers);
    if (raw && raw.includes('#EXTM3U')) { sendList(raw, target); return; }
    reply.redirect(target);
    return;
  }

  let lastLoc = '';
  for (let i = 0; i < 5; i++) {
    const res = await fetchManual(target, headers);
    if (res.status === 200 && res.body && res.body.includes('#EXTM3U')) {
      sendList(res.body, target);
      return;
    }
    const loc = res.location ? absUrl(res.location, target) : '';
    if (loc) {
      lastLoc = loc;
      const raw = await fetchText(loc, headers);
      if (raw && raw.includes('#EXTM3U')) { sendList(raw, loc); return; }
      // 目标拉不到 (fangzhou 死网关 502 等): 换一次 /media 重抽
    }
    // status 异常/无跳转: 也重抽 (每次 /media 都是新 auth_key/新后端节点)
  }
  // 全部尝试失败: 降级 302 到最后一次的跳转目标 (与旧行为一致, 不比现状更差)
  reply.redirect(lastLoc || target);
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const code = codeFromId(body.id);
  if (!code) return { parse: 0, url: '' };
  const mediaUrl = SITE + '/media/' + code;
  const referer = SITE + '/videos/' + code;
  // 只返回本地代理地址, 由 /proxy/m3u8 在播放时实时解析 /media (含 fangzhou 抽奖重抽逻辑)。
  // play 本身不再发上游请求, 返回更快; 代理地址构造失败才降级直连 /media。
  const purl = proxyUrl(reqIn, '/proxy/m3u8', mediaUrl, referer);
  return {
    parse: 0,
    url: purl || mediaUrl,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  let url = SITE + '/search/' + encodeURIComponent(wd);
  if (page > 1) url += '/' + page;
  const fakeCat = { tpl: '/search/' + encodeURIComponent(wd) + '/{p}', pc: page + 5 };
  return buildList(url, page, page === 1 ? fakeCat : fakeCat, 24, reqIn);
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
      // m3u8 代理 (GET): 播放时实时解析 /media + 只修正 Content-Type, 分片/密钥保持直连
      fastify.get('/proxy/m3u8', m3u8Proxy);
    },
  };
}
