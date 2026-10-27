// 51吃瓜 (https://51cg1.com) -> CatPawOpen spider
// 重写版：干净实现，封面走 Cloudflare Worker 解密代理
// 2026-10-23 修复：站点 bus 线路域名轮换（bus.qkvsednb.cc 整站 301 跳 bus.yueshrxet.cc，
// 设备端取不到旧域内容导致全分类空白）。改为多主机自愈：依次探测下列主机，
// 某个主机取不到内容时自动切换到下一个（品牌域 51cg1.com 与旧 bus 域作后备）。
// 2026-10-25 修复：bus 域再次轮换——分类页在旧域上 301（空体）跳新域
// bus.egyjtzsa.cc，设备端 req 不跟随 301 导致全分类空白（首页仍 200，故
// 首页有内容、分类全空）。新域置顶直连；另加 301 Location 跟随（若运行
// 时暴露响应头），下次轮换可自愈，不再全空。
// 2026-10-25 彻底化：同站多 bus 域并存直连（egyjtzsa、51cg1.com、
// okzdnjeu 均直连 200；qkvsednb 现 301 到 okzdnjeu）。直连域置顶，
// 301 域垫底——设备不跟随 301 时仍有 3 个直连镜域可命中，不再因
// 单域轮换全灭；解析已兼容新旧两种卡片 id 写法。
// 2026-10-27 修复：bus 域再次轮换至 bus.hszhzwngt.cc（旧 bus 域一律 301 到新域；
// okzdnjeu 301 到 2h3uq.hszhzwngt.cc 同域变体）。品牌域 51cg1.com 置顶直连（不 301、
// 不随 bus 轮换），新域次之，旧 bus 域全部作后备——设备不跟随 301 时仍有直连域可命中；
// 51cg1.com 与新域实测分类/详情/播放标记齐全，解析与播放逻辑不动。
// 2026-10-28 封面修复：站点废弃 loadBannerDirect，封面改走 img 标签的
// z-image-loader-url 属性（仍为 pic.*.cn 图床，走原 Worker 代理；代理已实测对
// pic.gyezbp.cn 明文 .jpeg 可正常出图）。列表与详情均加该提取，旧写法保留作后备。
// 2026-10-28 二轮：用户真机截图示列表标题日期正常、仅封面空白，列表解析无问题；
// 封面再加 srcset、CSS 背景图（background-image / data-background）、noscript 三路提取。
import req from '../../util/req.js';

const KEY = 'py_51chigua';
const NAME = '51吃瓜';
const HOSTS = [
  'https://51cg1.com',
  'https://bus.hszhzwngt.cc',
  'https://bus.egyjtzsa.cc',
  'https://bus.okzdnjeu.cc',
  'https://bus.yueshrxet.cc',
  'https://bus.qkvsednb.cc',
];
let ACTIVE_HOST = HOSTS[0];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 真实分类（2026-10-14 从站点导航抓取）
const CLASSES = [
  { type_id: 'wpcz', type_name: '今日吃瓜' },
  { type_id: 'rdsj', type_name: '热门大瓜' },
  { type_id: 'bkdg', type_name: '必看大瓜' },
  { type_id: 'mrdg', type_name: '吃瓜榜单' },
  { type_id: '51djc', type_name: '51剧场' },
  { type_id: '51hd', type_name: '往期活动' },
  { type_id: 'cbdj', type_name: 'AI成人短剧' },
  { type_id: 'ysyl', type_name: '成人视频' },
  { type_id: 'gcjq', type_name: '国产视频' },
  { type_id: 'thjx', type_name: '探花精选' },
  { type_id: 'whhj', type_name: '网黄合集' },
  { type_id: 'whhl', type_name: '网红黑料' },
  { type_id: 'whmx', type_name: '明星爆料' },
  { type_id: 'xsxy', type_name: '学生校园' },
  { type_id: 'hwcg', type_name: '海外吃瓜' },
  { type_id: 'rrcg', type_name: '人人吃瓜' },
  { type_id: 'ldcg', type_name: '领导干部' },
  { type_id: 'lldd', type_name: '伦理道德' },
  { type_id: 'snsn', type_name: '骚男骚女' },
  { type_id: 'jpll', type_name: '软萌甜妹' },
  { type_id: 'sjb', type_name: '竞技吃瓜' },
  { type_id: 'qubk', type_name: '吃瓜看戏' },
  { type_id: 'dcbq', type_name: '擦边撩骚' },
  { type_id: 'zzs', type_name: '性爱技巧' },
  { type_id: 'mrds', type_name: '每日大赛' },
  { type_id: 'yczq', type_name: '原创博主' },
  { type_id: 'cgxw', type_name: '吃瓜新闻' },
  { type_id: 'qghj', type_name: '瓜友点播' },
];

// 封面解密 Worker（用户已部署）
const IMG_PROXY = 'https://51chigua.li768435813.workers.dev/img?url=';

/** 所有站点 CDN 图片（pic.*.cn）走 Worker 解密代理 */
function proxyImgUrl(imgUrl) {
  if (!imgUrl) return '';
  if (/workers\.dev/i.test(imgUrl)) return imgUrl;
  // 站点图片 CDN 域名会轮换（pic.ndhixj.cn / pic.gyezbp.cn 等），统一走 Worker
  if (/pic\.[a-z0-9]+\.cn/i.test(imgUrl)) {
    return IMG_PROXY + encodeURIComponent(imgUrl);
  }
  return imgUrl;
}

function headers() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': ACTIVE_HOST + '/',
  };
}

async function fetchFrom(base, path) {
  let url = base + path;
  for (let hop = 0; hop < 4; hop++) {
    try {
      const r = await req.get(url, { headers: headers(), timeout: 20000 });
      const html = String((r && r.data) || '');
      if (html) return html;
      // 空体 + 301 Location：跟随到最终域并记住它（下次直连，不再绕 301）；
      // 运行时不暴露响应头时 loc 为空，走外层多主机兜底。
      const loc = r && r.headers && (r.headers.location || r.headers.Location);
      if (!loc) return '';
      try {
        const next = /^https?:\/\//i.test(loc) ? loc : new URL(loc, url).href;
        try { ACTIVE_HOST = new URL(next).origin; } catch (e) { /* 忽略 */ }
        url = next;
      } catch (e) {
        return '';
      }
    } catch (e) {
      return '';
    }
  }
  return '';
}

/** 按路径取页面：先用当前主机，取不到内容时依次切换后备主机并记住可用主机 */
async function getHtml(path) {
  let html = await fetchFrom(ACTIVE_HOST, path);
  if (html) return html;
  for (const h of HOSTS) {
    if (h === ACTIVE_HOST) continue;
    html = await fetchFrom(h, path);
    if (html) {
      ACTIVE_HOST = h;
      return html;
    }
  }
  return '';
}

function t(v) {
  return String(v == null ? '' : v).trim();
}

function decodeHtml(s) {
  return t(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return ACTIVE_HOST + u;
  return ACTIVE_HOST + '/' + u;
}

function listPath(cat, page) {
  page = Math.max(1, parseInt(page, 10) || 1);
  cat = t(cat) || 'wpcz';
  const base = `/category/${cat}/`;
  return page > 1 ? `${base}${page}/` : base;
}

/** 解析文章列表：post-card 结构，封面在 loadBannerDirect('URL',...) */
function parseList(html) {
  const out = [];
  const seen = new Set();
  if (!html) return out;
  // 按 post-card 切分
  const blocks = html.split('<div class="post-card"');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    // 文章 ID：只从当前块取，避免与标题错位。新版卡片把 id 放在 div
    // 自身（id="post-card-280128"），卡内已无 /archives/ 链接（旧版才有）；
    // 两者都取，取不到跳过——否则新版全块被跳过、分类全空。
    const im = b.match(/id="post-card-(\d+)"/);
    const am = b.match(/\/archives\/(\d+)\//);
    let vid = im ? im[1] : (am ? am[1] : '');
    if (!vid || seen.has(vid)) continue;

    // 标题
    let title = '';
    const tm = b.match(/class="post-card-title"[^>]*>([\s\S]*?)<\/h2>/);
    if (tm) title = decodeHtml(tm[1].replace(/<[^>]+>/g, '')).trim();
    if (!title) continue;
    seen.add(vid);

    // 封面：loadBannerDirect('URL', ...)
    let pic = '';
    const pm = b.match(/loadBannerDirect\('([^']+)'/);
    if (pm) pic = pm[1];
    // 新版封面：z-image-loader-url 属性（2026-10-28 起 loadBannerDirect 已废弃）
    if (!pic) {
      const zm = b.match(/z-image-loader-url=["']([^"']+)["']/);
      if (zm) pic = absUrl(zm[1]);
    }
    if (!pic) {
      const im = b.match(/<img[^>]+src="([^"]+)"/);
      if (im) pic = absUrl(im[1]);
    }
    if (!pic) {
      // 懒加载 srcset 首个地址
      const ss = b.match(/(?:data-srcset|srcset)\s*=\s*"([^"]+)"/);
      if (ss) {
        const first = ss[1].split(',')[0].trim().split(/\s+/)[0];
        if (/^https?:\/\//i.test(first)) pic = absUrl(first);
      }
    }
    if (!pic) {
      // CSS 背景图 / data-background（占位块式封面）
      const bg = b.match(/background-image\s*:\s*url\(\s*['"]?(https?:[^'")]+)['"]?\s*\)/i)
        || b.match(/data-background\s*=\s*"([^"]+)"/i);
      if (bg) pic = absUrl(bg[1]);
    }
    if (!pic) {
      const u = b.match(/url\(\s*['"]?(https?:[^'")]+)['"]?\s*\)/i);
      if (u) pic = absUrl(u[1]);
    }
    if (!pic) {
      const ns = b.match(/<noscript>[\s\S]{0,500}?<img[^>]+src="([^"]+)"/i);
      if (ns) pic = absUrl(ns[1]);
    }

    // 时间
    let remarks = '';
    const dm = b.match(/datePublished"[^>]*content="([^"]+)"/) || b.match(/(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
    if (dm) remarks = dm[1].slice(0, 10);

    out.push({
      vod_id: vid,
      vod_name: title.slice(0, 80),
      vod_pic: proxyImgUrl(pic),
      vod_remarks: remarks,
    });
  }
  return out;
}

/** 从详情页提取播放地址 */
function extractPlay(html) {
  const sources = [];
  const seen = new Set();
  function add(url, name) {
    url = t(url).replace(/\\\//g, '/');
    if (!url || seen.has(url)) return;
    if (!/^https?:\/\//i.test(url)) return;
    seen.add(url);
    sources.push({ name: name || '播放', url });
  }
  // m3u8 / mp4 直链（含转义 https:\/\/）
  (html.match(/https?:(?:\\?\/\\?\/)[^"'\s<>]+\.m3u8[^"'\s<>]*/gi) || []).forEach(u => add(u, 'HLS'));
  (html.match(/https?:(?:\\?\/\\?\/)[^"'\s<>]+\.mp4[^"'\s<>]*/gi) || []).forEach(u => add(u, 'MP4'));
  // JSON 字段中的 url（含转义）
  const fields = html.match(/["'](?:url|play_url|playUrl|src|file|videoUrl)["']\s*:\s*["'](https?:(?:\\?\/\\?\/)[^"']+)["']/gi) || [];
  fields.forEach(f => {
    const um = f.match(/https?:(?:\\?\/\\?\/)[^"']+/);
    if (um) {
      const u = um[0];
      if (/\.m3u8/i.test(u)) add(u, 'HLS');
      else if (/\.mp4/i.test(u)) add(u, 'MP4');
    }
  });
  // dplayer / video 标签
  (html.match(/<source[^>]+src="([^"]+)"/gi) || []).forEach(s => {
    const um = s.match(/src="([^"]+)"/);
    if (um) add(absUrl(um[1]), '视频');
  });
  return sources;
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  const html = await getHtml('/');
  return { list: parseList(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const id = String(body.id || 'wpcz').replace(/^\/category\//, '').replace(/\/$/, '');
  const html = await getHtml(listPath(id, page));
  const list = parseList(html);
  return {
    page,
    pagecount: 999,
    limit: list.length || 20,
    total: 999 * 20,
    list,
  };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const raw = Array.isArray(body.id) ? body.id[0] : body.id;
  const m = String(raw || '').match(/(\d+)/);
  const vid = m ? m[1] : String(raw || '').trim();
  if (!vid) return { list: [] };

  const html = await getHtml(`/archives/${vid}/`);
  if (!html) return { list: [] };

  // 标题
  let name = '';
  const hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (hm) name = decodeHtml(hm[1].replace(/<[^>]+>/g, '')).trim();
  if (!name) {
    const tm = html.match(/<title>([^<]+)<\/title>/);
    if (tm) name = decodeHtml(tm[1]).split(/[-_|]/)[0].trim();
  }

  // 封面：og:image 或首图
  let pic = '';
  const om = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i);
  if (om) pic = om[1];
  if (!pic) {
    const bm = html.match(/loadBannerDirect\('([^']+)'/);
    if (bm) pic = bm[1];
  }
  // 新版封面：z-image-loader-url 属性
  if (!pic) {
    const zm = html.match(/z-image-loader-url=["']([^"']+)["']/);
    if (zm) pic = zm[1];
  }
  if (!pic) {
    const ss = html.match(/(?:data-srcset|srcset)\s*=\s*"([^"]+)"/);
    if (ss) {
      const first = ss[1].split(',')[0].trim().split(/\s+/)[0];
      if (/^https?:\/\//i.test(first)) pic = first;
    }
  }
  if (!pic) {
    const bg = html.match(/background-image\s*:\s*url\(\s*['"]?(https?:[^'")]+)['"]?\s*\)/i)
      || html.match(/data-background\s*=\s*"([^"]+)"/i);
    if (bg && /^https?:\/\//i.test(bg[1])) pic = bg[1];
  }
  if (!pic) {
    const ns = html.match(/<noscript>[\s\S]{0,500}?<img[^>]+src="([^"]+)"/i);
    if (ns && /^https?:\/\//i.test(ns[1])) pic = ns[1];
  }

  // 简介
  let content = '';
  const dm = html.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i);
  if (dm) content = decodeHtml(dm[1]).slice(0, 600);

  // 播放地址
  const sources = extractPlay(html);
  const eps = [];
  const seen = new Set();
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    eps.push(`${String(s.name || '正片').replace(/[$#]/g, '_')}$${s.url}`);
  }

  return {
    list: [{
      vod_id: vid,
      vod_name: name || ('51吃瓜 ' + vid),
      vod_pic: proxyImgUrl(pic),
      vod_content: content,
      vod_play_from: eps.length ? NAME : '',
      vod_play_url: eps.length ? eps.join('#') : '',
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '');
  return {
    parse: 0,
    url,
    header: { 'User-Agent': UA, 'Referer': ACTIVE_HOST + '/' },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  const path = `/search/${encodeURIComponent(wd)}/${page > 1 ? `page/${page}/` : ''}`;
  const html = await getHtml(path);
  const list = parseList(html);
  return {
    page,
    pagecount: 999,
    limit: list.length || 20,
    total: 999 * 20,
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
