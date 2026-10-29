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
async function postJsonFast(durl, body, extra) {
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
    ...(extra || {}),
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
async function ajaxEmbed(durl, ep, filmId, extra) {
  const resp = await postJsonFast(durl, { episode: ep.episode, filmId }, extra);
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


// 线路多集：详情页按钮已含 F4/SW/DD/FL/US 等线路名，按优先级出集
// （F4 > SW > PM > FL > DD > US > ST > PP，其余最后）；无按钮时回落正片。
// 集 id 形如 F4$<durl>@F4，play 剥离 @ 后缀作优先线路提示。
function lineEpisodes(html, durl) {
  const { episodes } = extractPlayerInfo(html);
  const ORDER = { F4: 0, SW: 1, PM: 2, FL: 3, DD: 4, US: 5, ST: 6, PP: 7 };
  const seen = new Set();
  const names = [];
  for (const ep of episodes) {
    const nm = t(ep.name).toUpperCase();
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    names.push(nm);
  }
  names.sort((a, b) => (ORDER[a] ?? 90) - (ORDER[b] ?? 90));
  if (!names.length) return `正片$${durl}`;
  return names.map(nm => `${nm}$${durl}@${nm}`).join('#');
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

  const vod = {
    vod_id: durl,
    vod_name: name || durl,
    vod_pic: fixUrl(pic),
    vod_remarks: '',
    vod_content: name,
    vod_play_from: 'SexTB',
    vod_play_url: lineEpisodes(html, durl),
  };
  subRegister(id, vod);
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "正片$https://..." 形式，取 $ 后面的完整 URL
  if (id.includes('$')) id = id.split('$').pop().trim();
  // 线路多集的 @F4/@SW 后缀：先剥离作优先线路提示，再算 durl
  let hint = '';
  const hm = id.match(/@([A-Za-z0-9]+)$/);
  if (hm) { hint = hm[1].toUpperCase(); id = id.slice(0, -hm[0].length); }
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  if (/\.m3u8(\?|$)/i.test(id)) {
    return subAttach({ parse: 0, url: id, header: { 'User-Agent': UA } }, subsP);
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
      if (w) return subAttach({ parse: 0, url: w, header: uaHead }, subsP);
    } else if (isSwHostName(dhost)) {
      const w = workerVUrl(defEmbed, durl);
      if (w) {
        // SW 的 Worker 链有逐视频死链（只有 hls3/hls2 的视频，其 CDN 拦
        // CF 出口，/v 必 502）→ 只对 SW 做一次快速探活（4s），过不了
        // 就落到第二步借 F4 线，不在这里判死。
        if (await probePlaylist(w, uaHead, 4000)) {
          return subAttach({ parse: 0, url: w, header: uaHead }, subsP);
        }
      } else {
        const r = await resolveStreamHgInSpider(defEmbed, durl, true);
        if (r) return subAttach(r, subsP);
      }
    } else {
      try {
        const r = await resolveEmbed(defEmbed, durl);
        if (r && r.url) return subAttach(r, subsP);
      } catch (e) { /* 落到借线 */ }
    }
  }

  // 会话态补强（best-effort）：直连详情页取 Set-Cookie 回带到 ajax POST，
  // 并补浏览器 XHR 本来就会带的 Origin；拿不到则与今天一致，绝不因此失败。
  let sessionHeaders = {};
  try { sessionHeaders.Origin = new URL(durl).origin; } catch (e) {}
  try {
    const ck = await req.get(durl, { headers: { 'User-Agent': UA }, timeout: 6000 });
    const sc = ck && ck.headers && (ck.headers['set-cookie'] || ck.headers['Set-Cookie']);
    if (sc) {
      const arr = Array.isArray(sc) ? sc : [sc];
      const cookie = arr.map(s => String(s).split(';')[0].trim()).filter(Boolean).join('; ');
      if (cookie) sessionHeaders.Cookie = cookie;
    }
  } catch (e) { /* 无会话态也继续 */ }

  // —— 第二步: 借线（POST /ajax/player），全部线路按优先级试 ——
  // 优先级: F4 > SW > PM > FL > DD > US > ST > PP（F4 借线只需一次 ajax
  // 就能直返 Worker 地址，最快；PM 次之；SW 的 Worker 链需探活确认）
  const PREF = { F4: 0, SW: 1, PM: 2, FL: 3, DD: 4, US: 5, ST: 6, PP: 7 };
  const sorted = [...episodes].sort((a, b) => {
    const pa = PREF[t(a.name).toUpperCase()] ?? 90;
    const pb = PREF[t(b.name).toUpperCase()] ?? 90;
    return pa - pb;
  });
  // 用户点了指定线路集：该线路排最先（ajax 可能走通页面 embed 走不通的路）
  if (hint) {
    const hi = sorted.findIndex(e => t(e.name).toUpperCase() === hint);
    if (hi > 0) { const [h] = sorted.splice(hi, 1); sorted.unshift(h); }
  }
  const seenName = new Set();
  let borrowed = 0;
  for (const ep of sorted) {
    if (Date.now() > deadline) break;
    const nm = t(ep.name).toUpperCase();
    if (seenName.has(nm)) continue;
    seenName.add(nm);
    // 默认线路（episodes[0]）的 embed 已在第一步用过，同线跳过省一次 ajax；
    // 但用户指定点的线路除外（ajax 可能走通页面 embed 走不通的路）
    if (defEmbed && episodes.length && ep.episode === episodes[0].episode && nm !== hint) continue;
    if (!filmId) break;
    borrowed++;
    const embed = await ajaxEmbed(durl, ep, filmId, sessionHeaders);
    if (!embed) continue;
    if (!firstEmbed) firstEmbed = embed;
    const host = hostOf(embed);
    try {
      if (isF4HostName(host)) {
        const w = workerF4Url(embed, durl);
        if (w) return subAttach({ parse: 0, url: w, header: uaHead }, subsP);
        continue;
      }
      if (isSwHostName(host)) {
        const w = workerVUrl(embed, durl);
        if (w && await probePlaylist(w, uaHead, 4000)) {
          return subAttach({ parse: 0, url: w, header: uaHead }, subsP);
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
      if (r && r.url) return subAttach(r, subsP);
    } catch (e) { /* 换下一条线路 */ }
  }

  // —— 第三步: SW 最后手段（蜘蛛内 hls3 直链，不探活、交播放器试）——
  if (!swLastResort && defEmbed && isSwHostName(hostOf(defEmbed))) {
    const links = await decodeStreamHgLinks(defEmbed, durl);
    if (links.hls3) swLastResort = links.hls3;
  }
  if (swLastResort) {
    return subAttach({ parse: 0, url: swLastResort, header: uaHead }, subsP);
  }

  // 全部线路解不出: 回到默认 embed 嗅探兜底（v3 行为）
  const sniff = defEmbed || firstEmbed;
  if (sniff && /^https?:\/\//.test(sniff)) {
    return subAttach({ parse: 1, jx: 0, url: sniff, header: { 'User-Agent': UA, 'Referer': durl } }, subsP);
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

// ---------------- 字幕聚合 (Layer A 铺开, 2026-10-23) ----------------
// 与 bestjavporn 试点同一实现 (提交 9c339419, 用户真机确认
// MiraPlayer 可加载并选择字幕): 点播时按片名/番号并行搜迅雷看看
// oracle (首档; 「迅雷」与「迅雷看看」实为同一接口) + SubtitleCat
// (第二档), 合并排序 = 来源档位 -> 语言 (简中>繁中>双语>英文>
// 其他) -> 番号命中 -> 热度, 只收 .srt/.vtt/.ass/.ssa 直链, 上限
// 10 条, 以 TVBox 标准 subs:[{name,url,format}] 挂到 play 结果。
// 总预算 6s、单请求 4~5s、全程框架 req (NOFETCH 安全)、结果缓存
// 10 分钟 (空结果不缓存); 无命中时不带 subs 键, play 返回与接入
// 前逐字段一致。SubHD (下载被站方门控) 与射手 (源站 522) 不接入。
const SUB_UA = (typeof UA !== 'undefined' && UA) ? UA : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

function subCleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// subHttp: 与试点 reqRaw 同语义 (状态码不抛错、仅 2xx 给正文、
// 文本恒等变换防自动 JSON 解析), 底层框架 req。
async function subHttp(url, headers, timeoutMs) {
  try {
    const r = await req.request({
      method: 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    });
    const text = typeof r.data === 'string' ? r.data : (r.data == null ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// play 入参归一: 个别 App 会把 "集名$播放id" 整段传回, 集名短且
// 不含 {/http 时剥掉前缀, 与 detail 登记的 episode id 对齐。
function subNormKey(k) {
  const s = String(k || '');
  const i = s.indexOf('$');
  if (i > 0) {
    const before = s.slice(0, i);
    if (before.length <= 30 && !/[{/]/.test(before) && !/http/i.test(before)) return s.slice(i + 1).trim();
  }
  return s.trim();
}

// detail 侧登记: 片名按 [detail 入参 id, vod_id, 每个 episode 的
// 播放 id] 多键写入 subNameCache, 并以首个 episode id 预热搜索。
function subRegister(detailIds, vod) {
  try {
    if (!vod || !vod.vod_name) return;
    const name = String(vod.vod_name);
    const keys = new Set();
    for (const i of (Array.isArray(detailIds) ? detailIds : [detailIds])) {
      if (i) keys.add(String(i));
    }
    if (vod.vod_id) keys.add(String(vod.vod_id));
    const eps = [];
    for (const grp of String(vod.vod_play_url || '').split('$$$')) {
      for (const seg of grp.split('#')) {
        const k = seg.indexOf('$');
        if (k >= 0) {
          const ep = seg.slice(k + 1);
          if (ep) { keys.add(ep); eps.push(ep); }
        }
      }
    }
    for (const k of keys) subCacheName(k, name);
    const warmKey = eps[0] || (vod.vod_id ? String(vod.vod_id) : '');
    if (warmKey) subWarm(warmKey);
  } catch (e) { /* 字幕登记失败不影响详情 */ }
}

// play 侧挂载: 仅当结果带非空 url 且字幕有命中时才加 subs 键。
async function subAttach(res, subsP) {
  try {
    const subs = await subsP;
    if (subs && subs.length && res && typeof res === 'object' && res.url) res.subs = subs;
  } catch (e) { /* 字幕挂载失败不影响播放结果 */ }
  return res;
}

// ---------------- 字幕聚合 (Layer A 重写, 2026-10-23) ----------------
// 按用户自有迅雷看看 REX 组件 (xunlei.subtitle) 的方法重写: 旧版把
// [番号, 全标题, 番号+标题] 多个键的召回合并成一池只排序不过滤,
// 全标题键的模糊召回灌进大量别片字幕 (实测 JUR-887 全标题键池
// 前排即 JUX-021 等别片), 且迅雷档位恒占满上限 10, SubtitleCat
// 永远挤不进来。新版三招 (与组件一致):
// (a) 键序逐个查、首个有结果的键即停 — 番号键命中的池小而准;
// (b) 命中后严过滤: 条目 name/langs/ext 须含番号 (宽松形亦可)
//     或片名全文, 不含的全扔, 无回退 (组件原法的回退宽松名单
//     在冷门番号上会把邻近番号的模糊池整池放行, 实测有害已删;
//     乱码单字键亦实测能召回无关字幕, 同样靠严过滤挡下);
// (c) 组件打分: cid_match 100000、含番号 +25000, 再加 oracle 自
//     带 score / fingerprintScore / 下载量, 按名+址去重取 top。
// 槽位 (用户钦定): 迅雷 (键序 [番号, 紧凑番号]) > 迅雷看看
// (组件完整键序 [番号, 紧凑番号, 番号+标题, 紧凑番号+标题,
// 全标题]) > SubtitleCat; 两迅雷槽同走同一 oracle 接口、不管
// 重不重复, 合并按 URL 去重、同条归高档位。合并序 = 档位 ->
// 语言 (简中>繁中>双语>英文>日文>其他, 沿用 subLangOf 口径)
// -> 分数; 全局上限 10、单槽软上限 8 (SubtitleCat 留位)。
// 全程 subHttp (框架 req 主栈), 迅雷系逐请求超时 3s、键序串行
// 首中即停; 总预算 6s、失败全静默; 无结果时 play 返回对象不带
// subs 键, 与未接入前逐字段一致。SubHD (下载被站方门控) 与
// 射手 (源站 522) 仍不接入。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();   // durl -> 片名 (detail 时 best-effort 写入)
const subResultCache = new Map(); // durl -> {ts, subs}

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? subCleanText(slug.replace(/[-_]+/g, ' ')) : '';
}

// 番号抽取 (移植自迅雷看看 REX 组件 extractSearchCode 的核心档)
function subExtractCode(text) {
  const s = String(text || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');
  const pats = [
    /\bFC2(?:[- ]?PPV)?[- ]?\d{5,8}\b/,
    /\bCARIB(?:PR)?[- ]?\d{6,8}\b/,
    /\b1PONDO[- ]?\d{6,8}\b/,
    /\bHEYZO[- ]?\d{3,6}\b/,
    /\b[A-Z]{2,10}[- ]\d{2,8}[A-Z]?\b/,
    /\b[A-Z]{2,10}\d{2,8}[A-Z]?\b/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[0].replace(/\s+/g, '-').replace(/-+/g, '-');
  }
  return '';
}

// 搜索上下文: 片名、番号、紧凑番号、标题部分 (去番号与噪声词)
function subCtx(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const compact = code ? code.replace(/[-_ ]/g, '') : '';
  let titlePart = '';
  if (code && title) {
    titlePart = title
      .replace(new RegExp(code.replace(/[-_]/g, '[-_ ]?'), 'i'), ' ')
      .replace(/\b(UNCENSORED|LEAK|OTHER|COMPLETE|FULL|HDR|WEB|BLURAY|BDRIP|WEBDL|REMUX|X264|X265|10BIT|8BIT|HEVC|AVC)\b/gi, ' ')
      .replace(/\b(?:EP|E|S|SEASON)\s*\d{1,3}\b/gi, ' ')
      .replace(/^[\s\-_:]+|[\s\-_:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (titlePart === code || titlePart === compact) titlePart = '';
  }
  return { title, code, compact, titlePart };
}

// 迅雷槽键序: 只番号两键 (锚定)
function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}

// 迅雷看看槽键序: 组件完整键序 (番号、紧凑番号、番号+标题、
// 紧凑番号+标题、全标题), 逐个查、首中即停。
function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}

// 严过滤的匹配文本 (组件口径: 片名 + 上下文, 全小写与去分隔符两形)
function subMatchOf(durl, ctx) {
  const text = ((ctx.title || '') + ' ' + String(durl || '')).trim().toLowerCase();
  const title = (ctx.title || '').toLowerCase();
  return {
    text,
    loose: text.replace(/[-_\s.]/g, ''),
    title,
    titleLoose: title.replace(/[-_\s.]/g, ''),
  };
}

// 语言判定: rank 越小越优先 (简中 > 繁中 > 双语 > 英文 > 其他)
function subLangOf(name, langs) {
  const s = (String(name || '') + ' ' + String(langs || '')).toLowerCase();
  if (/简体|简中|chs|zh[-_. ]?cn|zh[-_. ]?hans/.test(s)) return { tag: '简中', rank: 0 };
  if (/繁体|繁中|cht|zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?hant/.test(s)) return { tag: '繁中', rank: 1 };
  if (/双语|中英|中日|bilingual/.test(s)) return { tag: '双语', rank: 2 };
  if (/英文|english|eng|(^|[-_. ])en([-_. ]|$)/.test(s)) return { tag: '英文', rank: 3 };
  if (/日文|日语|japanese|jpn|(^|[-_. ])ja([-_. ]|$)/.test(s)) return { tag: '日文', rank: 4 };
  return { tag: '', rank: 5 };
}

const SUB_TEXT_RE = /\.(srt|vtt|ass|ssa)(\?|#|$)/i;

// 文本字幕格式判定: 文件名扩展名 > 条目 ext 字段 > url 后缀;
// 压缩包一律剔除 (与组件 getExt 口径一致, 只认 srt/vtt/ass/ssa)。
function subFmtOf(name, ext, url) {
  const hay = (String(name || '') + ' ' + String(url || '')).toLowerCase();
  if (/\.(zip|rar|7z)(\?|#|$)/.test(hay)) return '';
  const fromName = String(name || '').toLowerCase().match(/\.(srt|vtt|ass|ssa)$/);
  if (fromName) return fromName[1];
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (/^(srt|vtt|ass|ssa)$/.test(e)) return e;
  const fromUrl = String(url || '').match(SUB_TEXT_RE);
  if (fromUrl) return fromUrl[1].toLowerCase();
  return '';
}

// 裸哈希名不可读: 显示名换成番号字幕 (匹配/过滤仍用原名)
function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}

// oracle 单键查询 (同趟搜索内按键缓存, 两槽共用, 不重复发请求)
async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 3000);
    if (r.status !== 200 || !r.body) return [];
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return []; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return [];
    return j.data;
  })();
  ocache.set(key, p);
  return p;
}

// oracle 条目归一 (组件 normalizeResult 的字段口径)
function subNormItem(it) {
  const name = String(it.name || it.Name || it.title || it.Title || it.filename || it.FileName || '字幕');
  const langs = Array.isArray(it.languages) ? it.languages.join(',')
    : (Array.isArray(it.Languages) ? it.Languages.join(',') : String(it.langs || it.Langs || it.language || ''));
  return {
    name,
    langs,
    ext: String(it.ext || it.Ext || it.format || it.Format || ''),
    url: String(it.url || it.Url || ''),
    cid: Boolean(it.cid_match ?? it.CidMatch),
    down: Number(it.down_count || it.DownCount || it.downloads || it.Downloads || 0) || 0,
    score: Number(it.score || it.Score || 0) || 0,
    fp: Number(it.fingerprintf_score || it.fingerprint_score || it.FingerprintScore || it.fingerprintfScore || 0) || 0,
    duration: Number(it.duration || it.Duration || 0) || 0,
    size: Number(it.file_size || it.FileSize || it.size || it.Size || 0) || 0,
  };
}

// 严过滤 (组件口径): 条目 name/langs/ext 须含番号 (原形或宽松
// 形) 或片名全文, 否则扔掉。片名分支必须守非空: 个别蜘蛛的
// 播放 id 与 detail 登记键对不上时片名缓存会落空 (title=''),
// 空串是任何字符串的子串, 不守就会全池放行 (bigbuttshub 实测
// 教训: 假番号 EMPTY-24 搜出的 Sherlock 剧集字幕整页漏入)。
function subRelevant(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  if (ctx.code) {
    if (text.includes(ctx.code.toLowerCase())) return true;
    if (ctx.compact && loose.includes(ctx.compact.toLowerCase())) return true;
  }
  if (!match.text) return false;
  return text.includes(match.text) || loose.includes(match.loose)
    || (match.title ? (text.includes(match.title) || loose.includes(match.titleLoose)) : false)
    || match.text.includes(text);
}

// 组件打分 (scoreItem 的电影路径): cid_match 100000、含番号
// +25000、oracle 自带 score/fingerprintScore、下载量、时长/大小。
function subScoreItem(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  let s = (it.cid ? 100000 : 0) + it.down / 10000;
  if (ctx.code && (text.includes(ctx.code.toLowerCase()) || (ctx.compact && loose.includes(ctx.compact.toLowerCase())))) s += 25000;
  s += Math.max(0, it.score) + Math.max(0, it.fp);
  if (it.duration > 0) s += 50;
  if (it.size > 0) s += Math.min(it.size / 1024 / 1024, 20);
  if (match.title && (text.includes(match.title) || loose.includes(match.titleLoose))) s += 1000;
  if (ctx.code) s += 500;
  if (text.includes('sub') || text.includes('subtitle') || text.includes('字幕')) s += 300;
  return s;
}

// 迅雷系槽位 (迅雷 tier 0 / 迅雷看看 tier 1): 键序逐个查、首个
// 有结果的键即停; 命中池只过严过滤、无任何回退 — 组件原法的
// 「过滤到空回退宽松名单」在冷门番号上实测有害 (oracle 对无精
// 确字幕的番号返回邻近番号的模糊池, 回退等于整池垃圾放行:
// MOGK-006 挂上 MOGK-004/002、FC2-PPV-4991508 挂上他人番号),
// 与「宁缺毋滥」冲突, 故删除 (与 REX 版相关性闸门口径一致)。
async function subSlotOracle(keys, src, tier, ctx, match, ocache, bag) {
  let pool = null;
  for (const k of keys) {
    const list = await subOracle(k, ocache);
    if (list && list.length) { pool = list; break; }
  }
  if (!pool) return;
  const items = [];
  for (const raw of pool) {
    if (!raw) continue;
    const it = subNormItem(raw);
    if (!it.url) continue;
    const fmt = subFmtOf(it.name, it.ext, it.url);
    if (!fmt) continue;
    items.push({ name: it.name, langs: it.langs, ext: it.ext, url: it.url, fmt, norm: it });
  }
  if (!items.length) return;
  const finalItems = items.filter((it) => subRelevant(it, ctx, match));
  for (const it of finalItems) {
    const lang = subLangOf(it.name, it.langs);
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match) });
  }
}

// SubtitleCat 槽 (tier 2): 沿用旧芯搜索/解析 (按番号键搜、逐页
// 取按语言分的直链), 同样过严过滤 (无回退)。
async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
  if (!key) return;
  const r = await subHttp('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 5000);
  if (r.status !== 200 || !r.body) return;
  const pages = [];
  const seen = new Set();
  for (const m of r.body.matchAll(/href="(subs\/\d+\/[^"]+\.html)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    pages.push(m[1]);
    if (pages.length >= 3) break;
  }
  await Promise.all(pages.map(async (p) => {
    const pr = await subHttp('https://subtitlecat.com/' + p, { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 4000);
    if (pr.status !== 200 || !pr.body) return;
    for (const m of pr.body.matchAll(/href="(\/subs\/\d+\/[^"]+\.(?:srt|vtt|ass))"/gi)) {
      let nm = m[1].split('/').pop() || '字幕';
      try { nm = decodeURIComponent(nm); } catch (e) { /* 保持原样 */ }
      if (!subRelevant({ name: nm, langs: '', ext: '' }, ctx, match)) continue;
      const lang = subLangOf(nm, '');
      const fmt = (nm.match(/\.(srt|vtt|ass)$/i) || [])[1].toLowerCase();
      bag.push({ src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], fmt, lang: lang.tag, langRank: lang.rank, score: 0 });
    }
  }));
}

// 合并: 档位 -> 语言 -> 分数; 按 URL 去重 (同条归先到高档位);
// 全局上限 10、单槽软上限 8 (给 SubtitleCat 留位)。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const perTier = {};
  const out = [];
  for (const it of sorted) {
    if (out.length >= 10) break;
    if (seenUrl.has(it.url)) continue;
    if ((perTier[it.tier] || 0) >= 8) continue;
    seenUrl.add(it.url);
    perTier[it.tier] = (perTier[it.tier] || 0) + 1;
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: it.fmt });
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const ctx = subCtx(durl);
    let subs = [];
    if (ctx.code || ctx.title) {
      const match = subMatchOf(durl, ctx);
      const bag = [];
      const ocache = new Map();
      const jobs = [
        subSlotOracle(subKeysX(ctx), '迅雷', 0, ctx, match, ocache, bag),
        subSlotOracle(subKeysXL(ctx), '迅雷看看', 1, ctx, match, ocache, bag),
        subFromSubtitleCat(ctx, match, bag),
      ].map((jp) => Promise.resolve(jp).catch(() => {}));
      const all = Promise.allSettled(jobs);
      // 总预算 6s: 到点先用已入 bag 的部分合并返回; 后台源跑完
      // 后若凑出结果再迟填缓存 (慢出口下 detail 预热靠此命中)。
      // 空结果不缓存 (无字幕的片每次点播重查, 由在途去重兜底)。
      await Promise.race([all, new Promise((r) => setTimeout(r, 6000))]);
      subs = subMerge(bag);
      if (subs.length) {
        subResultCache.set(durl, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(durl, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(durl, p);
  try { return await p; } finally { subInflight.delete(durl); }
}

// detail 入口即预热 (不 await): 慢出口下单趟搜索可达数秒, 让它
// 与详情页的铸造链并行跑, 用户点播时 play 直接命中缓存/在途。
function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
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
