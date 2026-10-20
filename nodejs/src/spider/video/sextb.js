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
// 播放 (v4): 逐个 embed 宿主在蜘蛛侧解析直链 (parse:0)，嗅探只做最后兜底。
//       三轮全嗅探真机仍全灭（本站 embed 页在 MiraPlayer 嗅探里起不了播）。
//       线路按宿主分流（优先级 SW > PM > F4 > FL > DD > US > ST > PP）:
//         SW (hglink.to, StreamHG 系): 同代码在 trailerhg.xyz 有 XFS 明文页,
//           纯字符串解包取 links: hls3（无 token 的 master.txt）优先、
//           hls2（带 asn= 网络绑定 token）其次；填了 SEXTB_WORKER 则整链
//           走 Worker /v（铸 token 与拉流同出口）。
//         PM (playmate 系): POST /api/s {c,d:'web'} → sx 直链（无头要求，
//           JavGG 线已真机验证同协议可播）；vidara 系 POST /api/stream。
//         F4 (f4scdn/f4jav): 列表与分片强制 Origin: https://f4scdn.com，
//           播放器不透传 header，端内直链无解 —— 只能走 SEXTB_WORKER 的
//           /f4 全链代理（Worker 内 api/play 取 src + 注入 Origin 改写）。
//           未部署 Worker 时 F4 线路跳过（试其他线路，全灭再嗅探兜底）。
//         FL/DD/其他 XFS 系: 通用解包提取 m3u8/mp4 + 探活通过才返回。
//       每条线路解析都带探活（列表须 #EXTM3U、mp4 须 200/206），
//       探活不过当没解出，继续下一条，避免返回死链堵住后面的机会。
// 播放 (v5, 2026-10-20 晚): v4 真机仍全灭后重排 play 顺序与探活策略。
//       复查证据: 已部署 Worker 的 /f4、/v 全链从 VM 逐跳实测均通（F4
//       3 样本、SW 2 样本直到分片 0x47），所以问题不在链路本身，而在
//       v4 play 的真机执行结构: (1) 默认线路不是最先试，占 70% 的默认
//       F4 排在 SW/PM 两条借线（各含 ajax+探活）之后；(2) Worker 路径
//       被蜘蛛侧探活门控，一次往返抖动/超时即误杀已验通的线路（JavGG
//       的已验证形态是从不探活、直返 Worker 地址，且同机同账号真机
//       可播）；(3) SW 有逐视频死链——只有 hls3/hls2 的视频其 CDN 拦
//       CF 出口（实测 sgkx-010 的 /v 回 502: hls3/hls2 均 403），v4
//       对此无后备。v5: 默认线最先（F4→/f4 直返不探活；SW→/v 快速
//       探活 4s、失败去借 F4）；借线最多 2 条、F4 直返不探活；借来的
//       SW 在 Worker 不通时留蜘蛛内 hls3 直链作最后手段（手机住宅
//       出口可能过 hls3 的 ASN 门禁，不探活、交播放器试）；详情页无
//       播放器标记时换镜像再抓一次（防 DDoS 拦截页毒死整条链）。
// 实测根因 (2026-10-20 VM 验证): f4 CDN 的 playlist、子列表、每个分片
//       请求都必须带 Origin: https://f4scdn.com 才能 200（UA-only 403、
//       Referer 403）。其官方 api/play?ab=0 能拿签名 src，但 src 的列表与
//       分片同样查 Origin —— 这就是 v1/v2/v3 三轮真机全灭的最后一关。
// 修复史: v1 本地代理透传分片（App 本地桥传二进制失败）、v2 只代理列表
//       靠 play header 补 Origin（播放器不透传）、v3 全线嗅探（本站
//       embed 页嗅探起不了播），三轮真机均无法播放。v4 改逐宿主解析。
const KEY = 'py_sextb';
const NAME = 'SexTB';
const HOSTS = ['https://sextb.cc', 'https://sextb.net'];
const SITE = HOSTS[0];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// SexTB 专用 HLS 代理 Worker 地址（sextb-hls-worker.js，用户手动部署到
// 自己的 Cloudflare 后填这里，如 https://sextb-hls.xxx.workers.dev）。
// 留空 = 未部署: F4 线路无法解析（站方 Origin 墙）、SW 走蜘蛛内解析。
const SEXTB_WORKER = 'https://sextb-hls.li768435813.workers.dev';

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


// ================= v4 播放解析层（逐宿主直解） =================

// 纯字符串 Dean Edwards packer 解包（XFS 系 embed 页通用，禁 vm/eval）
function jsUnescapeSingle(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}

function unpackDeanEdwards(html) {
  const m = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
  if (!m) return '';
  let p = jsUnescapeSingle(m[1]);
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = jsUnescapeSingle(m[4]).split('|');
  const enc = (n) => (n < a ? '' : enc(Math.floor(n / a))) + ((n % a) > 35 ? String.fromCharCode((n % a) + 29) : (n % a).toString(36));
  let i = c;
  while (i--) {
    if (k[i]) {
      const word = k[i];
      p = p.replace(new RegExp('\\b' + enc(i) + '\\b', 'g'), () => word);
    }
  }
  return p;
}

// 从解包文本提取 StreamHG links{hls2,hls3,hls4}
function extractHgLinks(text) {
  const links = {};
  for (const m of String(text || '').matchAll(/"hls(\d+)"\s*:\s*"([^"]+)"/g)) {
    links['hls' + m[1]] = m[2];
  }
  return links;
}

// 从解包文本/页面提取通用 file: m3u8 或 mp4（filemoon/streamwish/voe 等）
function extractGenericFile(text) {
  const s = String(text || '');
  let m = s.match(/"file"\s*:\s*"(https?:[^"]+?\.m3u8[^"]*)"/) || s.match(/file\s*:\s*"(https?:[^"]+?\.m3u8[^"]*)"/);
  if (m) return m[1];
  m = s.match(/(https?:\/\/[^\s"'\\]+\.m3u8(?:\?[^\s"'\\]*)?)/);
  if (m) return m[1];
  m = s.match(/"file"\s*:\s*"(https?:[^"]+?\.mp4[^"]*)"/);
  if (m) return m[1];
  return '';
}

// 带超时的二进制 GET 探活（只关心状态码与前几个字节）
async function timedFetchBytes(url, headers, timeoutMs, range) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 7000);
  try {
    const h = { ...(headers || {}) };
    if (range) h['Range'] = range;
    const r = await fetch(url, { headers: h, signal: ctl.signal });
    const buf = await r.arrayBuffer().catch(() => new ArrayBuffer(0));
    return { status: r.status, text: new TextDecoder().decode(buf.slice(0, 4096)), size: buf.byteLength };
  } catch (e) {
    return { status: 0, text: '', size: 0 };
  } finally {
    clearTimeout(to);
  }
}

// 探活: 是真播放列表才认（#EXTM3U 开头）
async function probePlaylist(url, headers, timeoutMs) {
  const r = await timedFetchBytes(url, headers, timeoutMs || 7000);
  return r.status === 200 && r.text.includes('#EXTM3U');
}

// 通用 GET 文本（embed 页解析用：req 通道 + fetch 通道，不做本站拦截页判定）
async function fetchEmbedText(url, referer, timeoutMs) {
  const headers = pageHeaders(referer || REFERER);
  const to = timeoutMs || 12000;
  try {
    const { data, status } = await req.get(url, { headers, timeout: to });
    if (status === 200 && typeof data === 'string' && data.length > 200) return data;
  } catch (e) { /* 换通道2 */ }
  const txt = await timedFetchText(url, headers, to);
  return txt && txt.length > 200 ? txt : '';
}

// JSON POST（playmate/vidara 的 api 用）: req 通道 + fetch 通道
async function postJsonBody(url, obj, headers, timeoutMs) {
  const to = timeoutMs || 10000;
  const h = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(headers || {}),
  };
  const payload = JSON.stringify(obj);
  try {
    const { data, status } = await req.post(url, payload, { headers: h, timeout: to });
    if (status === 200 && data) return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { /* 换通道2 */ }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), to);
  try {
    const r = await fetch(url, { method: 'POST', headers: h, body: payload, signal: ctl.signal });
    if (r.ok) return await r.json();
  } catch (e) { /* ignore */ } finally {
    clearTimeout(timer);
  }
  return null;
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
}

function codeOf(u) {
  try {
    const parts = new URL(u).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch (e) { return ''; }
}

// SW / StreamHG 系（hglink.to、streamhg、trailerhg、earnvid、vidhide 等）
// v5 实测结论（2026-10-20 晚，对已部署 Worker 跑真实链）:
//   - hls4 (/stream/): token 与抓 embed 页的网络身份绑定，铸/拉同出口才
//     200 → Worker 全链可通（实测样本全链到分片）；跨身份 403。
//   - hls3: CDN 按 ASN 拦机房/CF 出口（VM 直拉、jina、Worker /p 三方均
//     403 "Website Access Blocked"），只有住宅/移动出口（手机）有机会
//     → 蜘蛛内直解作最后手段时不探活门控（探活在机房出口必死、会误杀）。
//   - hls2: asn 绑定 token，CF/VM 出口实测均 403，不作主力。
// 因此 SW 主路径 = Worker /v（与 JavGG 已真机验证的形态一致: 直返地址）。
function workerVUrl(embedUrl, durl) {
  if (!SEXTB_WORKER) return '';
  return SEXTB_WORKER + '/v?u=' + encodeURIComponent(embedUrl) + '&r=' + encodeURIComponent(durl);
}

function workerF4Url(embedUrl, durl) {
  if (!SEXTB_WORKER) return '';
  return SEXTB_WORKER + '/f4?u=' + encodeURIComponent(embedUrl) + '&r=' + encodeURIComponent(durl);
}

function isF4HostName(host) { return /f4scdn\.com|f4jav\.xyz/.test(host || ''); }
function isSwHostName(host) { return /hglink\.to|streamhg|trailerhg|earnvid|vidhide/.test(host || ''); }

// SW 蜘蛛内解包: hglink 换 trailerhg 同代码 XFS 页 → 解包 links。
// 相对地址（hls4 的 /stream/...）按解包页（trailerhg）的域名补全。
// 只解包、不探活，返回原始链接表（可能为空对象）。
async function decodeStreamHgLinks(embedUrl, durl) {
  const host = hostOf(embedUrl);
  const code = codeOf(embedUrl);
  if (!code) return {};
  let pageUrl = embedUrl;
  if (/(^|\.)hglink\.to$/.test(host)) pageUrl = 'https://trailerhg.xyz/e/' + code;
  const html = await fetchEmbedText(pageUrl, durl, 12000);
  if (!html) return {};
  const unpacked = unpackDeanEdwards(html) || html;
  const links = extractHgLinks(unpacked);
  for (const k of Object.keys(links)) {
    if (links[k].startsWith('/')) {
      try { links[k] = new URL(links[k], pageUrl).href; } catch (e) { /* ignore */ }
    }
  }
  return links;
}

// SW 蜘蛛内直解: hls3（无 token）优先、hls4 次之、hls2 末选。
// withProbe=true 时逐个探活（无 Worker 时的主路径）；false 时拿到第一条
// 就返回（最后手段: 探活出口与播放器出口未必一致，不让探活误杀）。
async function resolveStreamHgInSpider(embedUrl, durl, withProbe) {
  const links = await decodeStreamHgLinks(embedUrl, durl);
  const heads = { 'User-Agent': UA };
  for (const key of ['hls3', 'hls4', 'hls2']) {
    const u = links[key];
    if (!u || !/^https?:\/\//.test(u)) continue;
    if (withProbe && !(await probePlaylist(u, heads, 5000))) continue;
    return { parse: 0, url: u, header: heads };
  }
  return null;
}

// PM / playmate 系（playmate.to /embed/{code}）:
// POST /api/s {c:code, d:'web'} → sx 直链，列表/分片无特殊头要求
async function resolvePlaymate(embedUrl) {
  try {
    const u = new URL(embedUrl);
    const code = codeOf(embedUrl);
    if (!code) return null;
    const resp = await postJsonBody(u.origin + '/api/s', { c: code, d: 'web' }, { 'Referer': embedUrl }, 10000);
    const src = resp && t(resp.sx || resp.src || resp.url);
    if (!src || !/^https?:\/\//.test(src)) return null;
    return { parse: 0, url: src, header: { 'User-Agent': UA, 'Referer': embedUrl } };
  } catch (e) {
    return null;
  }
}

// vidara 系（shadowbyte.site / dstyladsg.com / vidara*）:
// POST /api/stream {filecode, device:'ios', codecs:['h265']} → streaming_url
async function resolveVidara(embedUrl) {
  try {
    const u = new URL(embedUrl);
    const code = codeOf(embedUrl);
    if (!code) return null;
    const resp = await postJsonBody(u.origin + '/api/stream',
      { filecode: code, device: 'ios', codecs: ['h265'] },
      { 'Referer': embedUrl, 'Origin': u.origin }, 10000);
    const src = resp && t(resp.streaming_url || resp.src || resp.url);
    if (!src || !/^https?:\/\//.test(src)) return null;
    return { parse: 0, url: src, header: { 'User-Agent': UA, 'Referer': embedUrl } };
  } catch (e) {
    return null;
  }
}

// dood 系（doodstream 及克隆域名）: embed 页取 /pass_md5/ 路径 → GET 得
// CDN 前缀 → 拼 token 参数。构造后必须 Range 探活通过才返回（防假成功）。
async function resolveDood(embedUrl) {
  try {
    const u = new URL(embedUrl);
    const html = await fetchEmbedText(embedUrl, embedUrl, 12000);
    if (!html) return null;
    const pm = html.match(/(\/pass_md5\/[A-Za-z0-9_\-\/]+)/);
    if (!pm) return null;
    const passUrl = u.origin + pm[1];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let prefix = '';
    try {
      const r = await fetch(passUrl, { headers: { 'User-Agent': UA, 'Referer': embedUrl }, signal: ctl.signal });
      if (r.ok) prefix = t(await r.text());
    } catch (e) { /* ignore */ } finally {
      clearTimeout(timer);
    }
    if (!/^https?:\/\//.test(prefix)) return null;
    const tokM = html.match(/[?&]token=([A-Za-z0-9_\-]+)/) || html.match(/token\s*[:=]\s*["']([A-Za-z0-9_\-]+)["']/);
    const expM = html.match(/expiry\s*[:=]\s*["']?(\d{9,})/);
    let finalUrl = prefix;
    if (tokM) finalUrl += '?token=' + tokM[1] + (expM ? '&expiry=' + expM[1] : '');
    const probe = await timedFetchBytes(finalUrl, { 'User-Agent': UA, 'Referer': embedUrl }, 7000, 'bytes=0-0');
    if (probe.status === 200 || probe.status === 206) {
      return { parse: 0, url: finalUrl, header: { 'User-Agent': UA, 'Referer': embedUrl } };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 通用 XFS 系（filemoon / streamwish / voe / filelions 等）:
// 抓 embed 页 → 解包 → 提取 file: m3u8/mp4 → 探活通过才返回
async function resolveGeneric(embedUrl, durl) {
  const html = await fetchEmbedText(embedUrl, durl, 12000);
  if (!html) return null;
  const unpacked = unpackDeanEdwards(html);
  const file = extractGenericFile(unpacked) || extractGenericFile(html);
  if (!file || !/^https?:\/\//.test(file)) return null;
  const heads = { 'User-Agent': UA, 'Referer': embedUrl };
  if (/\.m3u8(\?|$)/i.test(file)) {
    if (await probePlaylist(file, heads)) return { parse: 0, url: file, header: heads };
    return null;
  }
  const probe = await timedFetchBytes(file, heads, 7000, 'bytes=0-0');
  if (probe.status === 200 || probe.status === 206) return { parse: 0, url: file, header: heads };
  return null;
}

// 按 embed 宿主分流解析；解不出返回 null（交给下一条线路）
async function resolveEmbed(embedUrl, durl) {
  const host = hostOf(embedUrl);
  if (!host) return null;
  if (isF4HostName(host)) {
    // F4 在 play() 里优先处理（Worker /f4 直返、不探活）；走到这里说明
    // play 的优先路径已放弃这条线，直接判负。
    return null;
  }
  if (isSwHostName(host)) {
    // SW 同样在 play() 里优先处理；这里只作兜底: 蜘蛛内解包 + 探活
    return resolveStreamHgInSpider(embedUrl, durl, true);
  }
  if (/playmate/.test(host)) return resolvePlaymate(embedUrl);
  if (/shadowbyte|dstyladsg|vidara/.test(host)) return resolveVidara(embedUrl);
  if (/dood|d000d|do7go|playmogo/.test(host)) return resolveDood(embedUrl);
  // 其余（filemoon/streamwish/voe/未知宿主）走通用解包提取
  return resolveGeneric(embedUrl, durl);
}

// POST /ajax/player 取某条线路的 embed URL
async function ajaxEmbed(durl, ep, filmId) {
  const resp = await postJsonFast(durl, { episode: ep.episode, filmId });
  if (!resp) return '';
  try {
    const json = JSON.parse(resp);
    const playerHtml = t(json.player);
    const em = playerHtml.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/) ||
               playerHtml.match(/<iframe[^>]+src="(\/\/[^"]+)"/);
    if (em) return fixUrl(em[1]);
  } catch (e) { /* ignore */ }
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
    return { parse: 0, url: id, header: { 'User-Agent': UA } };
  }
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  // 只抓 1 次详情页: 拿默认 embed + 服务器列表。
  // 若抓到的页面没有播放器标记（疑似 DDoS 拦截页被当成正常页返回——
  // isBlockedPage 不认 "DDOS Protection" 标题），换另一个镜像域名再抓
  // 一次，避免整条 play 链被一张拦截页毒死（返回空=点开必播不了）。
  let html = await getHtml(durl);
  const hasPlayer = (h) => !!h && (h.includes('sextb-player') || h.includes('btn-player'));
  if (html && !hasPlayer(html)) {
    const alt = durl.replace(/sextb\.(cc|net)/i, (m, g) => 'sextb.' + (g.toLowerCase() === 'cc' ? 'net' : 'cc'));
    if (alt !== durl) {
      const h2 = await getHtml(alt);
      if (hasPlayer(h2)) html = h2;
    }
  }
  if (!html) return { parse: 0, url: '' };
  const defEmbed = extractDefaultEmbed(html);
  const { filmId, episodes } = extractPlayerInfo(html);

  const deadline = Date.now() + 30000;
  const uaHead = { 'User-Agent': UA };
  let firstEmbed = defEmbed || '';
  let swLastResort = ''; // SW 蜘蛛内解出的 hls3 直链（借线全灭时的最后手段）

  // —— 第一步: 默认线路（embed 已在详情页 HTML 里，零额外请求）——
  // v4 的教训: 默认线排在借线之后试，每条借线都含 ajax+探活，占 70% 的
  // 默认 F4 反而最后才轮到，慢且险（探活/超时误杀）。v5 默认线最先。
  if (defEmbed) {
    const dhost = hostOf(defEmbed);
    if (isF4HostName(dhost)) {
      // F4 默认: Worker /f4 全链已在真实部署上逐跳验通（api/play 收 CF
      // 出口、列表/分片注入 Origin 后均 200）。学 JavGG 已真机验证的
      // 形态——直接返回 Worker 地址、不探活（探活是蜘蛛侧多余的一次
      // 往返，抖动/超时会误杀好线路，JavGG 从不探活且真机可播）。
      const w = workerF4Url(defEmbed, durl);
      if (w) return { parse: 0, url: w, header: uaHead };
    } else if (isSwHostName(dhost)) {
      const w = workerVUrl(defEmbed, durl);
      if (w) {
        // SW 的 Worker 链有逐视频死链（只有 hls3/hls2 的视频，其 CDN 拦
        // CF 出口，/v 必 502）→ 只对 SW 做一次快速探活（4s），过不了
        // 就落到第二步借 F4 线，不在这里判死。
        if (await probePlaylist(w, uaHead, 4000)) {
          return { parse: 0, url: w, header: uaHead };
        }
      } else {
        const r = await resolveStreamHgInSpider(defEmbed, durl, true);
        if (r) return r;
      }
    } else {
      try {
        const r = await resolveEmbed(defEmbed, durl);
        if (r && r.url) return r;
      } catch (e) { /* 落到借线 */ }
    }
  }

  // —— 第二步: 借线（POST /ajax/player），最多 2 条 ——
  // 优先级: F4 > SW > PM > FL > DD > US > ST > PP（F4 借线只需一次 ajax
  // 就能直返 Worker 地址，最快；PM 次之；SW 的 Worker 链需探活确认）
  const PREF = { F4: 0, SW: 1, PM: 2, FL: 3, DD: 4, US: 5, ST: 6, PP: 7 };
  const sorted = [...episodes].sort((a, b) => {
    const pa = PREF[t(a.name).toUpperCase()] ?? 90;
    const pb = PREF[t(b.name).toUpperCase()] ?? 90;
    return pa - pb;
  });
  const seenName = new Set();
  let borrowed = 0;
  for (const ep of sorted) {
    if (borrowed >= 2 || Date.now() > deadline) break;
    const nm = t(ep.name).toUpperCase();
    if (seenName.has(nm)) continue;
    seenName.add(nm);
    // 默认线路（episodes[0]）的 embed 已在第一步用过，同线跳过省一次 ajax
    if (defEmbed && episodes.length && ep.episode === episodes[0].episode) continue;
    if (!filmId) break;
    borrowed++;
    const embed = await ajaxEmbed(durl, ep, filmId);
    if (!embed) continue;
    if (!firstEmbed) firstEmbed = embed;
    const host = hostOf(embed);
    try {
      if (isF4HostName(host)) {
        const w = workerF4Url(embed, durl);
        if (w) return { parse: 0, url: w, header: uaHead };
        continue;
      }
      if (isSwHostName(host)) {
        const w = workerVUrl(embed, durl);
        if (w && await probePlaylist(w, uaHead, 4000)) {
          return { parse: 0, url: w, header: uaHead };
        }
        // Worker 链对此视频不通: 蜘蛛内解 hls3 记下作最后手段（手机是
        // 住宅/移动出口，hls3 的 ASN 门禁可能放行），先继续借其他线
        if (!swLastResort) {
          const links = await decodeStreamHgLinks(embed, durl);
          if (links.hls3) swLastResort = links.hls3;
        }
        continue;
      }
      const r = await resolveEmbed(embed, durl);
      if (r && r.url) return r;
    } catch (e) { /* 换下一条线路 */ }
  }

  // —— 第三步: SW 最后手段（蜘蛛内 hls3 直链，不探活、交播放器试）——
  if (!swLastResort && defEmbed && isSwHostName(hostOf(defEmbed))) {
    const links = await decodeStreamHgLinks(defEmbed, durl);
    if (links.hls3) swLastResort = links.hls3;
  }
  if (swLastResort) {
    return { parse: 0, url: swLastResort, header: uaHead };
  }

  // 全部线路解不出: 回到默认 embed 嗅探兜底（v3 行为）
  const sniff = defEmbed || firstEmbed;
  if (sniff && /^https?:\/\//.test(sniff)) {
    return { parse: 1, jx: 0, url: sniff, header: { 'User-Agent': UA, 'Referer': durl } };
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
