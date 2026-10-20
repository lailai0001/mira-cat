import req from '../../util/req.js';

// SexTB (py_sextb)
// 站点: https://sextb.cc / https://sextb.net (JAV 在线站)
// 重要: .net 在部分国家被封锁，站点官方指定备用域名 sextb.cc（首页横幅原话
//       "Some countries have blocked our website, please use a backup domain name: SEXTB.CC")。
//       spider 做双域名 failover: .cc 优先、.net 回退，再失败走 jina reader 兜底。
//       两站结构完全一致。另有 Cloudflare WAF 拦机房 IP（25 字节 "Your request was blocked"）。
// 列表: / (最新) / /genre/{slug}/[/pg-N/]  tray-item 卡片
// 卡片: div.tray-item > a[href="/{code}"] > img.tray-item-thumbnail (封面取 data-src，src 是 default-cover 占位图)
// 详情: GET /{code}  filmId + 服务器列表 (button.btn-player.episode[data-source][data-id]，如 F4/SW/PM/DD/FL/US)
// 播放 (v3): 全部走 parse:1 嗅探，不再解析直链、不再本地代理:
//       1) 详情页默认 iframe 非 F4 -> 直接嗅探该 embed 页；
//       2) 默认是 F4 (f4scdn.com/f4jav.xyz) -> 按按钮顺序跳过 F4，
//          最多借 2 条非 F4 线路 (POST /ajax/player 快速版)，嗅探借到的 embed；
//       3) 借不到 -> 嗅探 F4 自己的 embed 页兜底。
//       play 只做 1 次详情页 GET + 至多 2 次 ajax POST，秒级返回。
// 实测根因 (2026-10-20 VM 验证): f4 CDN 的 playlist.txt、子播放列表、每个分片
//       请求都必须带 Origin: {embed host} 才能 200，否则 403（仅 UA 无头 → 403；
//       无 UA → 404；Referer 也救不了）。iOS 播放器无法自行补 Origin（被禁止
//       自定义），所以 play 返回的 m3u8 直链在端内播不了。
// 修复史: v1 本地代理透传分片、v2 只代理播放列表 + 分片直链靠 play 的
//       header 补 Origin，两轮用户真机均无法播放——播放器不把 play 返回
//       的 header (尤其 Origin) 透传到分片请求，f4 直链路在端内无解。
// 修复 (v3, 2026-10-20): 删掉整个本地代理与 f4 直链解析，play 全面改走
//       嗅探。依据: (1) 抽样 28 个视频默认 embed 26 个是 F4，非 F4 默认
//       (hglink/streamhg 系，FC2 分类) 的 parse:1 嗅探真机已验证可播；
//       (2) F4 embed 页是纯 fetch 驱动 (player.js 用 fetch(api/play) +
//       fetch(playlist)，无自定义头)，网页上下文里浏览器自动带
//       Origin: https://f4scdn.com，嗅探链路自洽。

const KEY = 'py_sextb';
const NAME = 'SexTB';
const HOSTS = ['https://sextb.cc', 'https://sextb.net'];
const SITE = HOSTS[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 核心分类 + 精选题材 (2026-10-20 从 /genres 页实测存在，两域名通用)
const CATS = [
  { type_id: 'latest', type_name: '最新' },
  { type_id: 'censored', type_name: '有码', slug: 'censored' },
  { type_id: 'uncensored', type_name: '无码', slug: 'uncensored-dc02d84q' },
  { type_id: 'amateur', type_name: '素人', slug: 'amateur-9yvovjqr' },
  { type_id: 'subtitle', type_name: '中文字幕', slug: 'subtitle' },
  { type_id: 'uncensored-leaked', type_name: '无码流出', slug: 'uncensored-leaked-8iodxgmu' },
  { type_id: 'reducing-mosaic', type_name: '减码', slug: 'reducing-mosaic-o16ol1qy' },
  { type_id: 'english-subtitle', type_name: '英字幕', slug: 'english-subtitle-8rpwhwew' },
  { type_id: 'digital-mosaic', type_name: '数码有码', slug: 'digital-mosaic-merf7vyh' },
  { type_id: 'minimal-mosaic', type_name: '低马赛克', slug: 'minimal-mosaic-csskw5dg' },
  { type_id: 'big-tits', type_name: '巨乳', slug: 'big-tits-hipx7w77' },
  { type_id: 'creampie', type_name: '中出', slug: 'creampie-dkel1ugw' },
  { type_id: 'blowjob', type_name: '口交', slug: 'blowjob-6w43evzo' },
  { type_id: 'school-girl', type_name: '学生', slug: 'school-girl-aze0q30d' },
  { type_id: 'milf', type_name: '熟女', slug: 'milf-k01m582n' },
  { type_id: 'mature-woman', type_name: '成熟女性', slug: 'mature-woman-pj7rh291' },
  { type_id: 'lesbian', type_name: '蕾丝', slug: 'lesbian-9akyznh5' },
  { type_id: 'nurse', type_name: '护士', slug: 'nurse-kor7sr6n' },
  { type_id: 'office-lady', type_name: 'OL', slug: 'office-lady-pjv31x9c' },
  { type_id: 'threesome', type_name: '3P4P', slug: 'threesome--foursome-3r7836if' },
  { type_id: 'cosplay', type_name: 'Cosplay', slug: 'cosplay-d5rzeneh' },
  { type_id: 'voyeur', type_name: '偷拍', slug: 'voyeur-9thq5fr5' },
  { type_id: 'massage', type_name: '按摩', slug: 'massage-0ypm730h' },
  { type_id: 'bondage', type_name: '捆绑', slug: 'bondage-wywuaggb' },
  { type_id: 'squirting', type_name: '潮吹', slug: 'squirting-1t5r5wb9' },
  { type_id: 'maid', type_name: '女仆', slug: 'maid-vkrzm0oo' },
  { type_id: 'teen', type_name: '少女', slug: 'teen-gk3kz0pk' },
  { type_id: 'fc2', type_name: 'FC2', slug: 'fc2' },
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
  if (/^https?:\/\//.test(u)) return u;
  return SITE + '/' + u;
}

// 判断返回内容是否为拦截/验证页 (Cloudflare WAF 拦截、托管挑战等)
// 注意: 正常页面 head 里也含 challenges.cloudflare.com 的 CF 注入脚本，不能用它判定，
// 只认拦截页特有的文案与标题
function isBlockedPage(html) {
  if (!html || typeof html !== 'string') return true;
  if (html.length < 500) return true;
  const head = html.slice(0, 3000);
  if (/Your request was blocked/i.test(head)) return true;
  if (/<title>[^<]*(Just a moment|Attention Required)/i.test(head)) return true;
  if (/Performing security verification/i.test(head)) return true;
  if (/Sorry, you have been blocked/i.test(head)) return true;
  return false;
}

// 把任意本站 URL 拆成 path，候选域名按 [原域名, .cc, .net] 排序
function hostOrder(url) {
  const order = [];
  const m = t(url).match(/^https?:\/\/([^/]+)/i);
  if (m) {
    const h = 'https://' + m[1].toLowerCase();
    if (HOSTS.includes(h)) order.push(h);
  }
  for (const h of HOSTS) if (!order.includes(h)) order.push(h);
  return order;
}

function pathOf(url) {
  const u = t(url);
  const m = u.match(/^https?:\/\/[^/]+(\/.*)$/i);
  if (m) return m[1];
  return u.startsWith('/') ? u : '/' + u;
}

// 带超时的原生 fetch 取文本
async function timedFetchText(url, headers, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 25000);
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

// 带超时的原生 fetch POST 取文本
async function timedFetchPost(url, data, headers, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 8000);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: data, signal: ctl.signal });
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// 单次取页面 (req 通道 + fetch 通道)，命中拦截页视为失败
async function rawGet(url, headers, timeoutMs) {
  const to = timeoutMs || 25000;
  // 通道1: 框架 req
  try {
    const { data, status } = await req.get(url, { headers, timeout: to });
    if (status === 200 && typeof data === 'string' && !isBlockedPage(data)) return data;
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  const txt = await timedFetchText(url, headers, to);
  if (txt && !isBlockedPage(txt)) return txt;
  return '';
}

function pageHeaders(referer, extraHeaders) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Referer': referer || REFERER,
    ...(extraHeaders || {}),
  };
}

// 兜底通道: jina reader 取原始 HTML (直连全失败时使用)
async function fetchViaJina(host, path) {
  const jinaUrl = 'https://r.jina.ai/' + host + path;
  const headers = {
    'User-Agent': UA,
    'x-respond-with': 'html',
  };
  try {
    const { data, status } = await req.get(jinaUrl, { headers, timeout: 40000 });
    if (status === 200 && typeof data === 'string' && !isBlockedPage(data)) {
      if (data.includes('tray-item') || data.length > 5000) return data;
    }
  } catch (e) { /* 换 fetch */ }
  const txt = await timedFetchText(jinaUrl, headers, 40000);
  if (txt && !isBlockedPage(txt) && txt.length > 5000) return txt;
  return '';
}

// 多域名 failover 取页面: 逐个域名直连，全失败再逐个域名走 jina 兜底
// 注意: 非本站 URL (如 f4scdn embed 页) 不做域名替换，直接原 URL 请求
async function getHtml(url, extraHeaders) {
  const m = t(url).match(/^https?:\/\/([^/]+)/i);
  const host = m ? m[1].toLowerCase() : '';
  if (!/sextb\.(net|cc)$/.test(host)) {
    return rawGet(url, pageHeaders(m ? 'https://' + host + '/' : REFERER, extraHeaders));
  }
  const path = pathOf(url);
  const hosts = hostOrder(url);
  for (const h of hosts) {
    const html = await rawGet(h + path, pageHeaders(h + '/', extraHeaders));
    if (html) return html;
  }
  for (const h of hosts) {
    const html = await fetchViaJina(h, path);
    if (html) return html;
  }
  return '';
}

// play 专用快速 POST /ajax/player: 只打详情页同域名，8s 超时，
// req -> fetch 两通道各一次，失败立即放弃 (不做旧 postJson 的多域名多轮串行)
async function postJsonFast(durl, body) {
  let ajaxUrl = '';
  try {
    ajaxUrl = new URL(durl).origin + '/ajax/player';
  } catch (e) { return ''; }
  const data = new URLSearchParams(body).toString();
  const headers = {
    'User-Agent': UA,
    'Referer': durl,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
  };
  // 通道1: 框架 req
  try {
    const { data: res, status } = await req.post(ajaxUrl, data, { headers, timeout: 8000 });
    if (status === 200 && res != null) {
      const s = typeof res === 'string' ? res : JSON.stringify(res);
      if (s && !/Your request was blocked/i.test(s)) return s;
    }
  } catch (e) { /* 换通道2 */ }
  // 通道2: 原生 fetch
  const txt = await timedFetchPost(ajaxUrl, data, headers, 8000);
  if (txt && !/Your request was blocked/i.test(txt)) return txt;
  return '';
}

// 解析视频卡片: div.tray-item > a[href="/{code}"] > img.tray-item-thumbnail
// 注意: 1) 站点懒加载，真实封面在 data-src，src 是 default-cover.jpg 占位图；
//       2) 卡片 class 带修饰时 (如 "tray-item tray-item-uncensored") 也要匹配，
//          但 tray-item-trailer 预告片块与 tray-item-* 子元素要排除；
//       3) href 域名兼容 .net/.cc。
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<div class="tray-item(?:\s[^"]*)?">\s*<a\s[^>]*href="(?:https?:\/\/sextb\.(?:net|cc))?(\/[a-z0-9][a-z0-9\-]{3,40})"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const win = html.slice(m.index, m.index + 2500);
    // 标题: img alt 属性
    let title = '';
    const altM = win.match(/<img[^>]+alt="([^"]+)"/);
    if (altM) title = clean(altM[1]);
    // 封面: 优先 data-src (懒加载真实地址)
    let pic = '';
    const dsM = win.match(/data-src="(https?:\/\/[^"]+)"/) || win.match(/data-src="(\/\/[^"]+)"/);
    if (dsM && !dsM[1].includes('default-cover')) pic = fixUrl(dsM[1]);
    if (!pic) {
      const srcM = win.match(/<img[^>]+src="(https?:\/\/[^"]+)"/) || win.match(/<img[^>]+src="(\/\/[^"]+)"/);
      if (srcM && !srcM[1].includes('default-cover')) pic = fixUrl(srcM[1]);
    }
    // 番号: div.tray-item-code
    let code = '';
    const cdM = win.match(/tray-item-code">([^<]+)</);
    if (cdM) code = clean(cdM[1]);
    out.push({
      vod_id: fixUrl(path),
      vod_name: title || code || path.replace(/^\//, ''),
      vod_pic: pic,
      vod_remarks: code,
    });
  }
  return out;
}

function parsePagecount(html) {
  const nums = [...html.matchAll(/\/pg-(\d+)/g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
  return nums.length ? Math.max(...nums) : 1;
}

function catOf(tid) {
  return CATS.find(c => c.type_id === tid) || CATS[0];
}

function catUrl(cat, page) {
  if (cat.type_id === 'latest') {
    return page > 1 ? `${SITE}/pg-${page}` : SITE + '/';
  }
  const slug = cat.slug || cat.type_id;
  if (/^https?:\/\//.test(slug)) return slug;
  const base = slug.includes('/') ? `${SITE}/${slug}` : `${SITE}/genre/${slug}`;
  return page > 1 ? `${base}/pg-${page}` : base;
}

function buildList(url, page, limit) {
  limit = limit || 30;
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(html);
    const pc = parsePagecount(html);
    return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
  });
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
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = catOf(tid);
  return buildList(catUrl(cat, page), page, 30);
}

// 从详情页提取 filmId 和服务器 (episode) 列表
function extractPlayerInfo(html) {
  let filmId = '';
  const fm = html.match(/filmId\s*=\s*["']?(\d+)/);
  if (fm) filmId = fm[1];
  const episodes = [];
  const re = /<button[^>]*class="[^"]*btn-player episode[^"]*"[^>]*data-source="(\d+)"[^>]*data-id="(\d+)"[^>]*>(?:<i[^>]*><\/i>)?\s*([A-Z0-9]+)</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    episodes.push({ filmId: m[1], episode: m[2], name: m[3] });
  }
  return { filmId, episodes };
}

// 从详情页提取默认 player iframe
function extractDefaultEmbed(html) {
  const m = html.match(/id="sextb-player"[\s\S]{0,500}?<iframe[^>]+src="(https?:\/\/[^"]+)"/) ||
            html.match(/id="sextb-player"[\s\S]{0,500}?<iframe[^>]+src="(\/\/[^"]+)"/);
  return m ? fixUrl(m[1]) : '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  // 标题
  let name = '';
  const tm = html.match(/<title>([^<]*)<\/title>/);
  if (tm) name = clean(tm[1]).replace(/\s*-\s*SEXTB.*$/i, '').replace(/Free JAV.*$/i, '').trim();
  // 封面: 优先页面内的 webp poster (cdn001.imggle.net 公开 CDN，直读 200)，
  // 其次 video 标签 poster，再 og:image
  let pic = '';
  const wm = html.match(/data-src="(https?:\/\/cdn001\.imggle\.net\/webp\/poster[^"]+)"/);
  if (wm) pic = wm[1];
  if (!pic) {
    const vm = html.match(/<video[^>]+poster="(https?:\/\/[^"]+)"/);
    if (vm) pic = vm[1];
  }
  if (!pic) {
    const ogm = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogm) pic = ogm[1];
  }

  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: fixUrl(pic),
      vod_remarks: '',
      vod_content: name,
      vod_play_from: 'SexTB',
      vod_play_url: `正片$${durl}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "正片$https://..." 形式，取 $ 后面的完整 URL
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Origin': 'https://f4scdn.com' } };
  }
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  // 只抓 1 次详情页: 拿默认 embed + 服务器列表
  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const embedUrl = extractDefaultEmbed(html);
  const isF4 = (u) => /f4scdn\.com|f4jav\.xyz/i.test(u || '');

  // 默认 embed 非 F4: 直接嗅探它 (hglink/streamhg 系真机已验证可播)
  if (embedUrl && !isF4(embedUrl)) {
    return { parse: 1, jx: 0, url: embedUrl, header: { 'User-Agent': UA, 'Referer': durl } };
  }

  // 默认是 F4 (或无默认 embed): 按按钮顺序跳过 F4，最多借 2 条非 F4 线路，
  // POST /ajax/player 拿到 embed 后嗅探它
  const { filmId, episodes } = extractPlayerInfo(html);
  if (filmId && episodes.length) {
    let tried = 0;
    for (const ep of episodes) {
      if (tried >= 2) break;
      if (/^F4$/i.test(t(ep.name))) continue;
      tried++;
      const resp = await postJsonFast(durl, { episode: ep.episode, filmId });
      if (!resp) continue;
      let playerHtml = '';
      try {
        const json = JSON.parse(resp);
        playerHtml = t(json.player);
      } catch (e) { continue; }
      const em = playerHtml.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/) ||
                 playerHtml.match(/<iframe[^>]+src="(\/\/[^"]+)"/);
      if (!em) continue;
      const eu = fixUrl(em[1]);
      if (/^https?:\/\//.test(eu)) {
        return { parse: 1, jx: 0, url: eu, header: { 'User-Agent': UA, 'Referer': durl } };
      }
    }
  }

  // 借不到: 嗅探 F4 自己的 embed 页兜底 (网页上下文自动带 Origin，链路自洽)
  if (embedUrl && /^https?:\/\//.test(embedUrl)) {
    return { parse: 1, jx: 0, url: embedUrl, header: { 'User-Agent': UA, 'Referer': durl } };
  }
  return { parse: 0, url: '' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  let url = SITE + '/search/' + encodeURIComponent(wd);
  if (page > 1) url += '/pg-' + page;
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
