import req from '../../util/req.js';

// JavHD.Today (py_javhdtoday)
// 站点: https://javhd.today/cn/ (JAV 聚合站，无反爬)
// 注意: 与 mira-cat 已有的 JavHD (py_javhd, javhd.icu) 是不同站点，key/name 做了区分
// 列表: GET /cn/{sort}/[/{N}/]  sort: recent/popular/rated/discussed/downloaded/longest/watched
//       28 条/页；recent 有 13299 页。标签分类走 ?ajax=1 JSON 接口
// 卡片: li#video-{id} > .video > a.thumbnail[href="/cn/{id}/{slug}/",title] > .video-thumb > img[src] + span.video-title
// 详情: GET /cn/{id}/{slug}/  取 <iframe src="/cn/embed/{id}/">
// 播放 (2026-10-21 优化): embed 页各 server 页调 ?json=1 接口取源, 优先级:
//   embed_server3 (vidara m3u8 直链, 分片最快) > embed_server9 (streamtape MP4) > embed.php (站方代理 HLS)
//   > f4 系 (api/play 降级) > parse:1 嗅探
//   注意: vidara 分片带 Referer 会被限速, 返回的 header 只带 UA 不带 Referer

const KEY = 'py_javhdtoday';
const NAME = 'JavHD.Today';
const SITE = 'https://javhd.today';
const CN = SITE + '/cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = CN + '/';

// 6 个排序分类 (SSR，2026-10-20 实测，均为 200 且有 28 条/页)
// 注意: releaseday(发布日) 已按用户要求删除 (2026-10-21)
const SORT_CATS = [
  { type_id: 'recent', type_name: '最新上传' },
  { type_id: 'popular', type_name: '最受欢迎' },
  { type_id: 'rated', type_name: '高评分' },
  { type_id: 'discussed', type_name: '热议' },
  { type_id: 'downloaded', type_name: '下载最多' },
  { type_id: 'longest', type_name: '最长' },
  { type_id: 'watched', type_name: '观看最多' },
];

// 9 个标签分类 (站点分类页为 JS 骨架屏，走 ?ajax=1 接口取列表，28 条/页，2026-10-21 实测均有内容)
// 注意: amateur(素人) 已按用户要求删除；新增 reducing-mosaic(减少马赛克)、married-woman(已婚女人)、beautiful-girl(美少女)、mature-woman(成熟女性)
const TAG_CATS = [
  { type_id: 'tag:uncensored-jav', type_name: '无码流出', slug: 'uncensored-jav' },
  { type_id: 'tag:chinese-subtitle', type_name: '中文字幕', slug: 'chinese-subtitle' },
  { type_id: 'tag:jav-sub', type_name: '英文字幕', slug: 'jav-sub' },
  { type_id: 'tag:big-tits', type_name: '巨乳', slug: 'big-tits' },
  { type_id: 'tag:creampie', type_name: '中出', slug: 'creampie' },
  { type_id: 'tag:reducing-mosaic', type_name: '减少马赛克', slug: 'reducing-mosaic' },
  { type_id: 'tag:married-woman', type_name: '已婚女人', slug: 'married-woman' },
  { type_id: 'tag:beautiful-girl', type_name: '美少女', slug: 'beautiful-girl' },
  { type_id: 'tag:mature-woman', type_name: '成熟女性', slug: 'mature-woman' },
];

const CATS = [...SORT_CATS, ...TAG_CATS];
const LIMIT = 28;

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

function b64dec(s) {
  s = t(s);
  if (!s) return '';
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf-8');
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e) { return ''; }
}

async function getHtml(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': referer || REFERER,
  };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && typeof data === 'string' && data.length > 1000) return data;
    if (status === 200 && data) return typeof data === 'string' ? data : '';
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) {
      const txt = await r.text();
      if (txt.length > 1000) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

async function getJson(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Referer': referer || REFERER,
  };
  const doParse = (txt) => { try { return JSON.parse(txt); } catch (e) { return null; } };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 25000 });
    if (status === 200 && data) return typeof data === 'string' ? doParse(data) : data;
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await fetch(url, { headers });
    if (r.ok) return doParse(await r.text());
  } catch (e) { /* ignore */ }
  return null;
}

// 解析视频卡片: li#video-{id} > a.thumbnail[href,title] > .video-thumb > img[src] + span.video-title
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<li[^>]*id="video-(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vid = m[1];
    const card = m[2];
    const am = card.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*class="thumbnail"/)
      || card.match(/<a[^>]*class="thumbnail"[^>]*href="([^"]+)"[^>]*title="([^"]*)"/)
      || card.match(/<a[^>]*href="([^"]+)"[^>]*>/);
    if (!am) continue;
    const durl = fixUrl(am[1]);
    if (seen.has(durl)) continue;
    seen.add(durl);
    let title = am[2] ? clean(am[2]) : '';
    if (!title) {
      const tm = card.match(/<span class="video-title">([\s\S]*?)<\/span>/);
      if (tm) title = clean(tm[1]);
    }
    const im = card.match(/<img[^>]+src="([^"]+)"/);
    const rm = card.match(/<span class="video-overlay[^"]*"[^>]*>\s*HD\s*([\d:]+)/);
    out.push({
      vod_id: durl,
      vod_name: title || ('视频 ' + vid),
      vod_pic: im ? fixUrl(im[1]) : '',
      vod_remarks: rm ? rm[1].trim() : '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const pages = [...html.matchAll(/\/(\d+)\/"[^>]*>(?:\d+|<)/g)].map(x => parseInt(x[1], 10));
  // 翻页形如 /cn/recent/13298/
  const nums = [...html.matchAll(/\/cn\/[a-z]+\/(\d+)\//g)].map(x => parseInt(x[1], 10));
  const all = nums.filter(n => n > 0 && n < 1000000);
  return all.length ? Math.max(...all) : 1;
}

function catUrl(tid, page) {
  if (tid.startsWith('tag:')) {
    const cat = TAG_CATS.find(c => c.type_id === tid) || TAG_CATS[0];
    return `${CN}/${cat.slug}/?ajax=1&page=${page}`;
  }
  const sort = SORT_CATS.some(c => c.type_id === tid) ? tid : 'recent';
  let url = `${CN}/${sort}/`;
  if (page > 1) url += `${page}/`;
  return url;
}

function isTagCat(tid) {
  return String(tid).startsWith('tag:');
}

// 分类页取列表：排序分类为 SSR 直抓；标签分类走 ?ajax=1 JSON 接口
async function buildList(url, page, limit, isTag) {
  limit = limit || LIMIT;
  if (isTag) {
    const j = await getJson(url, REFERER);
    if (!j || !j.html) return { page, pagecount: page, limit, total: 0, list: [] };
    const list = parseCards(j.html);
    const total = parseInt(j.total, 10) || 0;
    const pc = total > 0 ? Math.ceil(total / limit) : Math.max(page, 1);
    return { page, pagecount: pc, limit, total, list };
  }
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(catUrl('recent', 1));
  const list = html ? parseCards(html).slice(0, 20) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'recent';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const url = catUrl(tid, page);
  return buildList(url, page, LIMIT, isTagCat(tid));
}

// 从详情页提取 embed 页地址
function extractEmbed(html) {
  const m = html.match(/<iframe[^>]+src="([^"]*\/cn\/embed\/\d+\/?)"/);
  return m ? fixUrl(m[1]) : '';
}

// 从 embed 页提取播放器地址：优先 f4scdn（可解出 m3u8），其次其他
function extractPlayers(embedHtml) {
  const out = [];
  const re = /<div class="server-option[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(embedHtml)) !== null) {
    // 取完整 div 标签（含 data 属性）
    const end = embedHtml.indexOf('>', m.index);
    const tag = embedHtml.slice(m.index, end + 1);
    const nameM = tag.match(/data-name="([^"]*)"/);
    const name = nameM ? nameM[1] : '';
    const embedsM = tag.match(/data-embeds="([^"]+)"/);
    const embedM = tag.match(/data-embed="([^"]+)"/);
    if (embedsM) {
      const dec = b64dec(embedsM[1]);
      try {
        const arr = JSON.parse(dec);
        if (Array.isArray(arr)) arr.forEach(u => out.push({ name, url: u }));
      } catch (e) { /* ignore */ }
    } else if (embedM) {
      const dec = b64dec(embedM[1]);
      if (/^https?:\/\//.test(dec)) out.push({ name, url: dec });
    }
  }
  return out;
}

// f4 系 embed 页 -> api/play -> m3u8
async function resolveF4(embedUrl, referer) {
  const html = await getHtml(embedUrl, referer);
  if (!html) return '';
  const vidM = html.match(/data-video-id="([a-f0-9-]+)"/);
  if (!vidM) return '';
  const vid = vidM[1];
  const apiM = html.match(/data-api="([^"]+)"/);
  let host = 'https://f4scdn.com';
  try { host = new URL(embedUrl).origin; } catch (e) { /* ignore */ }
  const playApi = apiM
    ? (apiM[1].startsWith('/') ? host + apiM[1] : apiM[1])
    : `${host}/api/play/${vid}`;
  const srcUrl = `${playApi}?ab=0&r=${encodeURIComponent(referer || REFERER)}`;
  const j = await getJson(srcUrl, embedUrl);
  if (j && j.src && /^https?:\/\//.test(j.src)) return { url: j.src, origin: host };
  if (j && j.url && /^https?:\/\//.test(j.url)) return { url: j.url, origin: host };
  return '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const tm = html.match(/<title>([^<]*)<\/title>/);
  if (tm) name = clean(tm[1]).split('|')[0].trim();

  let pic = '';
  const pm = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (pm) pic = fixUrl(pm[1]);
  if (!pic) {
    const vm = html.match(/<video[^>]+poster="([^"]+)"/);
    if (vm) pic = fixUrl(vm[1]);
  }

  const vod = {
    vod_id: durl,
    vod_name: name || durl,
    vod_pic: pic,
    vod_remarks: '',
    vod_content: name,
    vod_play_from: 'JavHD.Today',
    vod_play_url: `正片$${durl}`,
  };
  subRegister(id, vod);
  return { list: [vod] };
}

// 自有播放器 server 页 (embed.php / embed_server3.php 等) -> 同名 php 的 ?json=1 接口取源
// 返回 {kind:'hls', url, playerUrl} | {kind:'mp4', url, playerUrl} | ''
// 注意: 各 server 页返回的源类型不同:
//   embed_server3.php (Mangocloud) -> type vidara: master.m3u8 直链 (97bf1.com, 多码率 480/720/1080, 分片 200)
//   embed_server9.php (STserver)  -> type streamtape: /universal-stream/{hash} MP4 直链
//   embed.php (Myserver)          -> type streamhg: /universal-stream-hls/{hash}/playlist.m3u8 站方代理分片
async function resolveServerJson(playerUrl, referer) {
  const pM = String(playerUrl).match(/[?&]p=([^&]+)/);
  if (!pM) return '';
  let host = '';
  let page = 'embed.php';
  try {
    const u = new URL(playerUrl);
    host = u.origin;
    page = u.pathname.split('/').pop() || 'embed.php';
  } catch (e) { return ''; }
  const token = pM[1];
  const apiUrl = `${host}/${page}?json=1&next=0&p=${encodeURIComponent(token)}`;
  const j = await getJson(apiUrl, referer);
  if (!j || !j.success) return '';
  if (j.src && typeof j.src === 'string') {
    const src = j.src.startsWith('http') ? j.src : host + j.src;
    return { kind: 'hls', url: src, playerUrl };
  }
  if (j.media && typeof j.media === 'string') {
    const src = j.media.startsWith('http') ? j.media : host + j.media;
    return { kind: 'mp4', url: src, playerUrl };
  }
  return '';
}

// 自有播放器 (stream*.javhdz.today/embed.php) -> embed.php?json=1 -> proxied m3u8
// 分片经站方服务器代理，无 Origin/IP 绑定，手机端友好 (降级用)
async function resolveSelfPlayer(playerUrl, referer) {
  const r = await resolveServerJson(playerUrl, referer);
  return r && r.kind === 'hls' ? { url: r.url, playerUrl: r.playerUrl, host: new URL(playerUrl).origin } : '';
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  if (/\.m3u8(\?|$)/i.test(id)) {
    return subAttach({ parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
  }
  const durl = /^https?:\/\//.test(id) ? id : fixUrl(id);

  const html = await getHtml(durl);
  if (!html) return { parse: 0, url: '' };
  const embedUrl = extractEmbed(html);
  if (!embedUrl) return { parse: 0, url: '' };

  const embedHtml = await getHtml(embedUrl, durl);
  if (!embedHtml) return { parse: 0, url: '' };
  const players = extractPlayers(embedHtml);
  if (!players.length) return { parse: 0, url: '' };

  // 播放链路优先级 (2026-10-21 实测):
  // 1) embed_server3.php (vidara m3u8 直链, 不经站方代理, 分片最快; 但不是每个视频都有源)
  // 2) embed_server9.php (streamtape MP4 直链)
  // 3) embed.php (站方代理 HLS, 分片慢但基本必有源)
  // 4) f4 系 (降级)  5) 嗅探兜底
  // 注意: vidara 分片带 Referer 会被限速到近乎不可用, 故 1)/2) 只带 UA 不带 Referer
  const findServer = (pageRe) => players.find(p => /javhdz\.today\//i.test(p.url) && pageRe.test(p.url));
  const s3 = findServer(/embed_server3\.php/i);
  if (s3) {
    const r = await resolveServerJson(s3.url, embedUrl);
    if (r && r.kind === 'hls' && r.url) {
      return subAttach({ parse: 0, url: r.url, header: { 'User-Agent': UA } }, subsP);
    }
  }
  const s9 = findServer(/embed_server9\.php/i);
  if (s9) {
    const r = await resolveServerJson(s9.url, embedUrl);
    if (r && r.kind === 'mp4' && r.url) {
      return subAttach({ parse: 0, url: r.url, header: { 'User-Agent': UA } }, subsP);
    }
    if (r && r.kind === 'hls' && r.url) {
      return subAttach({ parse: 0, url: r.url, header: { 'User-Agent': UA } }, subsP);
    }
  }
  const mainSelf = findServer(/\/embed\.php(\?|$)/i);
  const selfPlayers = mainSelf ? [mainSelf] : players.filter(p => /javhdz\.today\/embed\.php/i.test(p.url));
  for (const sp of selfPlayers) {
    const r = await resolveSelfPlayer(sp.url, embedUrl);
    if (r && r.url) {
      return subAttach({
        parse: 0,
        url: r.url,
        header: { 'User-Agent': UA, 'Referer': r.playerUrl },
      }, subsP);
    }
  }

  // f4 系 (m3u8 token 疑似绑定请求 IP，仅作降级)
  const f4 = players.find(p => /f4\w*\.com|f4scdn/i.test(p.url));
  if (f4) {
    const r = await resolveF4(f4.url, durl);
    if (r && r.url) {
      return subAttach({
        parse: 0,
        url: r.url,
        header: { 'User-Agent': UA, 'Referer': f4.url, 'Origin': r.origin },
      }, subsP);
    }
  }
  // 3. 其他 embed 走嗅探
  const first = players[0];
  return subAttach({ parse: 1, url: first.url, header: { 'User-Agent': UA, 'Referer': durl } }, subsP);
}

async function search(reqIn) {
  // 搜索页为 JS 动态渲染，服务端拿不到结果
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 28, total: 0, list: [] };
  const url = `${CN}/search/video/?s=${encodeURIComponent(wd)}`;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit: 28, total: 0, list: [] };
  const list = parseCards(html);
  return { page, pagecount: page, limit: 28, total: list.length, list };
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

// ---------------- 字幕聚合 (Layer A 试点, 2026-10-22) ----------------
// 点播时按片名多源搜字幕, 候选以 TVBox 标准 subs 数组挂到 play
// 返回对象上 (播放器是否渲染由播放器决定, 蜘蛛只负责挂载)。
// 来源优先级 (用户钦定): 迅雷 > 迅雷看看 > SubtitleCat > SubHD
// > 射手。实探结论 (报告 castbank/REPORT_subtitle_pilot.md):
// 「迅雷」与「迅雷看看」是同一个 oracle 接口 (api-shoulei-ssl.
// xunlei.com, 按名搜、结果即 .srt 直链), 实现合并为一源占首档;
// SubHD 搜索与 prepare 通但 /down/ 被站方门控 (VM 出口实测 403
// 「下载页面已失效」)、射手 assrt.net 源站经 CF 522 不可达 —
// 两源本轮不接入 (不挂未验证链路)。全程 req 主栈 (subHttp),
// 每源独立超时、总预算 6s、与 resolveLines 并行, 失败全静默;
// 无结果时 play 返回对象不带 subs 键, 与未接入前逐字段一致。
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

function subKeys(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const keys = [];
  if (code) keys.push(code);
  if (title && title !== code) keys.push(title);
  if (code && title) {
    const tp = title.replace(new RegExp(code.replace(/-/g, '[- ]?'), 'i'), '').replace(/^[\s\-_:]+|[\s\-_:]+$/g, '').trim();
    if (tp && tp.length >= 3) keys.push(code + ' ' + tp);
  }
  return [...new Set(keys)].filter((k) => k.length >= 2).slice(0, 3);
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

// 迅雷看看 (兼「迅雷」位, 同一 oracle 接口): 按名搜, 结果即直链。
// 前 2 个键并行查, 每键返回即入 bag (不互相等候 — 慢键不能扣住
// 快键的结果), 最终由 subMerge 按档位/语言/番号命中/热度排序。
async function subFromXunlei(keys, code, bag) {
  await Promise.all(keys.slice(0, 2).map(async (key) => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 5000);
    if (r.status !== 200 || !r.body) return;
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return;
    for (const it of j.data) {
      if (!it) continue;
      const url = String(it.url || it.Url || '');
      if (!SUB_TEXT_RE.test(url)) continue; // 压缩包/非文本字幕剔除
      const nm = String(it.name || it.Name || '字幕');
      const langs = Array.isArray(it.languages) ? it.languages.join(',') : String(it.langs || it.Langs || '');
      const lang = subLangOf(nm, langs);
      const pop = (Number(it.down_count || it.DownCount || it.downloads || 0) || 0)
        + (Number(it.score || 0) || 0) + (Number(it.fingerprintf_score || it.fingerprint_score || 0) || 0);
      // 个别条目名是裸哈希 (不可读): 显示名换成番号字幕, 匹配/
      // 语言判定仍用原名
      const dispName = /^[0-9a-f]{24,}$/i.test(nm.trim()) ? (code ? code + ' 迅雷字幕' : '迅雷字幕') : nm;
      bag.push({
        src: '迅雷看看', tier: 0, name: dispName, url, lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop,
      });
    }
  }));
}

// SubtitleCat: 搜索页 -> 字幕页 -> 按语言分的 .srt 直链 (逐页入 bag)
async function subFromSubtitleCat(keys, code, bag) {
  const key = keys[0];
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
      const lang = subLangOf(nm, '');
      bag.push({
        src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop: 0,
      });
    }
  }));
}

// 合并排序: 来源档位 -> 语言 -> 番号命中 -> 热度; 按 url 与
// (语言|去扩展名文件名) 双键去重 (迅雷与 SubtitleCat 常有同源
// 同名文件、不同直链); 上限 10 条。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.codeHit - a.codeHit) || (b.pop - a.pop) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const seenName = new Set();
  const out = [];
  for (const it of sorted) {
    if (seenUrl.has(it.url)) continue;
    const nameKey = it.lang + '|' + it.name.toLowerCase().replace(/\.(srt|vtt|ass|ssa)$/i, '');
    if (seenName.has(nameKey)) continue;
    seenUrl.add(it.url);
    seenName.add(nameKey);
    const ext = (it.url.match(SUB_TEXT_RE) || [])[1].toLowerCase();
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: ext });
    if (out.length >= 10) break;
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const keys = subKeys(durl);
    let subs = [];
    if (keys.length) {
      const code = subExtractCode(subNameCache.get(durl) || '') || subExtractCode(String(durl || ''));
      const bag = [];
      const jobs = [
        subFromXunlei(keys, code, bag),
        subFromSubtitleCat(keys, code, bag),
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
