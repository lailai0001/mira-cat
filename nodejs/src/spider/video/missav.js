// MissAV — 重写（2026-11-28 用户令：旧版删了，按 missav.fans 从头写）。
// 以 missav.fans 为主站（VM 直连 200，站方现站结构与 live 一致）。
// 封面：走 missav-cover Worker 代理（2026-11-28 真机：d.surrit 直链全灭，
// 手机到不了 d.surrit；Worker 侧 d.surrit 也 525，http 回落救不了；
// 只有 fourhoi 能通，故封面先统一回 fourhoi、再包 Worker 代理。
// 老片封面 fourhoi 有 → 能出；新片封面 fourhoi 缺 → 仍不出，待找新源）。
// 取页：fans 直连 → fans 经 missav-fetch Worker → live 直连（fans 删片的回落）。
// 播放：详情 packed JS 解出分档 m3u8，统一走 missav-hls 中转（BBTU-123 真机已验）。
// 源站：https://missav.fans 为主、https://missav.live 回落（中文 /cn/）。
import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const KEY = 'py_missav';
const NAME = 'MissAV';
const HOST_LIVE = 'https://missav.live';
const HOST = 'https://missav.fans';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MISSAV_FETCH = 'https://missav-fetch.li768435813.workers.dev';
const MISSAV_HLS = 'https://missav-hls.li768435813.workers.dev';

// 分类（与站方一致，2026-11-26 实测）
const CLASSES = [
  { type_id: 'dm509/cn/release', type_name: '新作上市' },
  { type_id: 'dm561/cn/uncensored-leak', type_name: '无码流出' },
  { type_id: 'dm265/cn/chinese-subtitle', type_name: '中文字幕' },
  { type_id: 'cn/genres/%E5%B7%A8%E4%B9%B3', type_name: '巨乳' },
  { type_id: 'cn/genres/%E5%A4%A7%E5%B1%81%E8%82%A1', type_name: '大屁股' },
  { type_id: 'dm2091/cn/genres/VR', type_name: 'VR' },
  { type_id: 'dm242/cn/today-hot', type_name: '今日热门' },
  { type_id: 'dm168/cn/weekly-hot', type_name: '本週热门' },
  { type_id: 'dm207/cn/monthly-hot', type_name: '本月热门' },
  { type_id: 'dm23/cn/siro', type_name: 'SIRO' },
  { type_id: 'dm20/cn/luxu', type_name: 'LUXU' },
  { type_id: 'dm17/cn/gana', type_name: 'GANA' },
  { type_id: 'dm14/cn/maan', type_name: 'PRESTIGE PREMIUM' },
  { type_id: 'dm23/cn/scute', type_name: 'S-CUTE' },
  { type_id: 'dm19/cn/ara', type_name: 'ARA' },
  { type_id: 'dm95/cn/fc2', type_name: 'FC2' },
  { type_id: 'dm628/cn/heyzo', type_name: 'HEYZO' },
  { type_id: 'dm29/cn/tokyohot', type_name: '东京热' },
  { type_id: 'dm58345/cn/1pondo', type_name: '一本道' },
  { type_id: 'dm124158/cn/caribbeancom', type_name: 'Caribbeancom' },
  { type_id: 'dm1442/cn/caribbeancompr', type_name: 'Caribbeancompr' },
  { type_id: 'dm58632/cn/10musume', type_name: '10musume' },
  { type_id: 'dm668/cn/pacopacomama', type_name: 'pacopacomama' },
  { type_id: 'dm135/cn/gachinco', type_name: 'Gachinco' },
  { type_id: 'dm26/cn/xxxav', type_name: 'XXX-AV' },
  { type_id: 'dm24/cn/marriedslash', type_name: '人妻斩' },
  { type_id: 'dm179/cn/madonna', type_name: 'Madonna' },
  { type_id: 'dm18/cn/secret', type_name: 'Secret' },
  { type_id: 'dm22/cn/sweet', type_name: 'SWEET' },
  { type_id: 'dm21/cn/moodyz', type_name: 'MOODYZ' },
  { type_id: 'dm25/cn/s1', type_name: 'S1' },
];

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function absUrl(u, base) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  const b = base || HOST;
  return b + (u.startsWith('/') ? u : '/' + u);
}

// 封面：统一回站方原地址 d.surrit。
// 实测：站方有的列表页（/cn/new）封面就是 d.surrit，有的列表页
// （/dm509/cn/release）封面是 fourhoi；fourhoi 是残缺镜像，
// 新封面全 404，“有的出、有的不出”的根因。所以 fourhoi 一律改回 d.surrit，
// 已是 d.surrit 的不动。
const COVER_PROXY = 'https://missav-cover.li768435813.workers.dev/?u=';
// 封面：统一走 missav-cover Worker 代理（2026-11-28 用户真机：改回 d.surrit 后
// 所有封面全灭——手机到不了 d.surrit；Worker 侧 d.surrit 也 525（证书握手失败，
// http 回落也救不了），只有 fourhoi 能通（Worker 取 200）。
// 所以先把 d.surrit 改回 fourhoi、再包一层 Worker 代理：
// 老片封面 fourhoi 有 → 代理 200 能出；新片封面 fourhoi 403/503 → 仍缺，
// 待找新封面源（d.surrit 全线不通是死结，不靠它）。
function fixCover(u) {
  u = String(u || '').trim();
  if (!u) return '';
  // 先统一 host 到 fourhoi（Worker 唯一能取到的封面 host）
  u = u.replace(/^https:\/\/d\.surrit\.mrstcdn\.store\//i, 'https://fourhoi.mrstcdn.store/');
  u = u.replace(/^https:\/\/surrit\.mrstcdn\.store\//i, 'https://fourhoi.mrstcdn.store/');
  u = u.replace(/^https:\/\/c\.surrit\.mrstcdn\.store\//i, 'https://fourhoi.mrstcdn.store/');
  // 只代理 mrstcdn 封面，其他 host 原样
  if (!/^https:\/\/fourhoi\.mrstcdn\.store\//i.test(u)) return u;
  return COVER_PROXY + encodeURIComponent(u);
}

// 取页：以 missav.fans 为主（先直连、再走 missav-fetch Worker），
// fans 取不到再回落 missav.live 直连（fans 删片、live 还在的回落，
// 如 SNOS-524）。只认真 HTML；CF 验证页与空串都算失败、继续下一腿。
// 返回 { html, host }，host 是实际出页的那个站，供详情/播放定 Referer。
function isRealHtml(t) {
  if (!t || typeof t !== 'string') return false;
  if (t.includes('Just a moment...')) return false;
  if (t.includes('Attention Required')) return false;
  if (t.length < 1000) return false;
  return true;
}

async function fetchPage(path) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' };
  const p = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '');
  // ① fans 直连
  try {
    const r = await req.get(HOST + p, { headers, timeout: 20000 });
    const t = typeof r.data === 'string' ? r.data : '';
    if (isRealHtml(t)) return { html: t, host: HOST };
  } catch (e) {}
  // ② fans 经 missav-fetch Worker
  try {
    const r = await req.get(MISSAV_FETCH + '/?u=' + encodeURIComponent(HOST + p), { headers, timeout: 20000 });
    const t = typeof r.data === 'string' ? r.data : '';
    if (isRealHtml(t)) return { html: t, host: HOST };
  } catch (e) {}
  // ③ live 直连（回落）
  try {
    const r = await req.get(HOST_LIVE + p, { headers, timeout: 20000 });
    const t = typeof r.data === 'string' ? r.data : '';
    if (isRealHtml(t)) return { html: t, host: HOST_LIVE };
  } catch (e) {}
  return { html: '', host: '' };
}

// 列表解析：.thumbnail 卡片。封面只取 img.w-full 的 data-src（.jpg），
// 卡片里另有 <video data-src=preview.mp4>，绝不能当封面。
// host 是实际出页的站（live 或 fans），相对链接按它补全。
function parseCards(html, host) {
  const cards = [];
  if (!html || html.includes('Just a moment...')) return cards;
  const $ = cheerio.load(html);
  $('.thumbnail').each((_, e) => {
    const el = $(e);
    const href = el.find('a').first().attr('href') || el.find('.text-secondary').attr('href') || '';
    const title = cleanText(el.find('.text-secondary').text());
    if (!href || !title) return;
    const cover = fixCover(absUrl(el.find('img.w-full').attr('data-src') || el.find('img').attr('data-src'), host));
    const remarks = cleanText(el.find('.left-1').text());
    const duration = cleanText(el.find('.right-1').text());
    cards.push({
      vod_id: absUrl(href, host),
      vod_name: title,
      vod_pic: cover,
      vod_remarks: [remarks, duration].filter(Boolean).join(' '),
    });
  });
  return cards;
}

function parsePagecount(html, curPage) {
  let max = curPage;
  if (html) {
    const re = /[?&]page=(\d+)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// Dean Edwards packer 解包（详情页 packed JS 用）。
function unpackPacked(src) {
  const m = src.match(/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)[\s\S]+?\}\s*\(\s*'([\s\S]+?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]+?)'[\s\S]+?\)/);
  if (!m) return '';
  let p = m[1];
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = m[4].split('|');
  const enc = (n) => (n < a ? '' : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
  for (let i = c - 1; i >= 0; i--) {
    const key = enc(i);
    if (k[i] !== undefined && k[i] !== '') {
      p = p.split(new RegExp('\\b' + key + '\\b', 'g')).join(k[i]);
    }
  }
  return p;
}

// 从详情页 packed JS 解出 m3u8 地址（只取分档 video.m3u8，不取 master playlist）。
function extractTracks(html) {
  const up = unpackPacked(html || '');
  if (!up) return [];
  const urls = up.match(/https?:\/\/[^\s'"<>]+\.m3u8/g) || [];
  const seen = {};
  const out = [];
  for (const u of urls) {
    const m = u.match(/\/(1080p|720p|480p|360p|2160p)\/video\.m3u8$/);
    if (!m) continue;
    const res = m[1];
    if (seen[res]) continue;
    seen[res] = true;
    out.push({ res, url: u });
  }
  // 档位从高到低
  const order = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4 };
  out.sort((a, b) => (order[a.res] ?? 9) - (order[b.res] ?? 9));
  return out;
}

// 基域 surrit -> c.surrit 子域直链（设备可达）。现已不用（合线后只留中转），保留备用。
function toDirect(url) {
  return String(url || '').replace(/^https:\/\/surrit\.mrstcdn\.store\//i, 'https://c.surrit.mrstcdn.store/');
}

// 基域 surrit -> missav-hls Worker 中转。
function toWorker(url) {
  return MISSAV_HLS + '/m3u8?u=' + encodeURIComponent(url);
}

// 播放地址：统一走 missav-hls 中转（用户 2026-11-26 08:13 令：
// “live 的你也还是走中转吧，我手机开着 vpn 测的，fans 也是开着 vpn
// 测的！直连大概率不行”——用户在手机浏览器上测 live/fans 都是开着
// VPN 的，直连大概率不行，所以 live 的片也走中转，不走直链）。
// 注意：missav-hls 白名单只认 surrit，live 的视频 host 须先加进白名单
// 才能走通（见 Worker 源码）；未加之前 live 线会回 403。
function playUrlFor(url) {
  return toWorker(String(url || ''));
}

// 从详情页地址反推其站 host（供播放 Referer/Origin 用）。
function hostOfDetailUrl(durl) {
  const d = String(durl || '');
  if (d.indexOf(HOST_LIVE) === 0) return HOST_LIVE;
  return HOST;
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!id) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const path = '/' + id.replace(/^\/+/, '') + (page > 1 ? '?page=' + page : '');
  const { html, host } = await fetchPage(path);
  const list = parseCards(html, host || HOST);
  const pagecount = list.length ? parsePagecount(html, page) : page;
  return { page, pagecount, limit: list.length || 12, total: pagecount * 12, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '').trim();
  if (!id) return { list: [] };
  const detailUrl = absUrl(id);
  // 从详情地址取 path，fetchPage 先试 live、再回落 fans。
  let path = detailUrl;
  const hp = detailUrl.indexOf('://');
  if (hp >= 0) {
    const slash = detailUrl.indexOf('/', hp + 3);
    path = slash >= 0 ? detailUrl.slice(slash) : '/';
  }
  const { html, host } = await fetchPage(path);
  const pageHost = host || hostOfDetailUrl(detailUrl);
  const $ = cheerio.load(html || '');
  const name = cleanText($('meta[property="og:title"]').attr('content')) || cleanText($('title').text());
  const cover = fixCover(absUrl($('meta[property="og:image"]').attr('content'), pageHost));
  const content = cleanText($('meta[property="og:description"]').attr('content'));
  const tracks = extractTracks(html);
  const eps = [];
  for (const t of tracks) {
    const label = t.res.replace('p', 'P');
    // 用户 2026-11-26 令：直连几乎全部不能播，合成一条、和以前一样。
    // 每档位只留一条：surrit（fans）走 missav-hls 中转；
    // 非 surrit（live）走直链（手机能直达 live 的视频 host）。
    // 档位名不带“·中转”。
    eps.push(label + '$' + detailUrl + '@@' + playUrlFor(t.url));
  }
  const vod = {
    vod_id: detailUrl,
    vod_name: name,
    vod_pic: cover,
    vod_content: content,
    vod_play_from: NAME,
    vod_play_url: eps.join('#'),
  };
  // 字幕：按每条播放地址登记“中文名 + 番号”，后台串行预热（不 await）。
  // 只有片名含可抽番号才预热，避免无番号片误挂无关字幕。
  const subTitle = name;
  const subUrls = eps.map((e) => e.split('$').pop()).filter(Boolean);
  for (const u of subUrls) subCacheName(u, subTitle);
  if (subUrls.length && subExtractCode(subTitle)) {
    (async () => {
      for (const u of subUrls) {
        try { await subSearchAll(u); } catch (e) {}
      }
    })().catch(() => {});
  }
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  // App 传进来的 body.id 是 vod_play_url 里的“线路名$详情地址@@播放地址”全串，
  // 必须先剥掉“$”前的线路名与“@@”前的详情地址再返回。
  let id = String(Array.isArray(body.id) ? body.id[0] : body.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop();
  if (!id) return { parse: 0, url: '' };
  let durl = '';
  let url = id;
  const at = id.indexOf('@@');
  if (at >= 0) {
    durl = id.slice(0, at);
    url = id.slice(at + 2);
  }
  if (!url) return { parse: 0, url: '' };
  // 字幕：detail 预热过则命中缓存/在途；无命中不带 subs 键。
  // 只有登记片名含可抽番号才查字幕。
  const regTitle = subNameCache.get(url) || '';
  const subs = subExtractCode(regTitle) ? await subSearchAll(url).catch(() => []) : [];
  // Referer/Origin 按详情页的站（live 或 fans）定，视频 host 与之对应。
  const refHost = hostOfDetailUrl(durl);
  const result = {
    parse: 0,
    url,
    header: {
      'User-Agent': UA,
      'Referer': durl || refHost + '/',
      'Origin': refHost,
    },
  };
  if (subs && subs.length) result.subs = subs;
  return result;
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 12, total: 0, list: [] };
  const path = '/cn/search/' + encodeURIComponent(wd) + (page > 1 ? '?page=' + page : '');
  const { html, host } = await fetchPage(path);
  const list = parseCards(html, host || HOST);
  const pagecount = list.length ? parsePagecount(html, page) : page;
  return { page, pagecount, limit: list.length || 12, total: pagecount * 12, list };
}



// ---------- 共享字幕芯（与 av01/av123 等蜘蛛同款自包含块：
//   迅雷 > 迅雷看看 > SubtitleCat；只挂有番号条目；全局上限 10、单槽 8；
//   总预算 6s、失败静默；无结果不带 subs 键）----------
async function reqRaw(url, headers, timeoutMs) {
  try {
    const r = await req.get(url, { headers: headers || {}, timeout: timeoutMs || 10000, responseType: 'text', transformResponse: [(d) => d] });
    const text = typeof r.data === 'string' ? r.data : (r.data === null || r.data === undefined ? '' : JSON.stringify(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// ---------------- 字幕聚合 (与 32 个带芯猫源同一套 Layer A，2026-11-02 定版) ----------------
// 槽位：迅雷（键序 [番号, 紧凑番号]）> 迅雷看看（完整键序）> SubtitleCat；
// 键序逐个查、首中即停；命中后严过滤（须含番号或片名全文，无回退）；
// 合并序 = 档位 -> 语言（简中>繁中>双语>英文>日文>其他）-> 分数；
// 全局上限 10、单槽软上限 8；总预算 6s、失败全静默；无结果时 play 不带 subs 键。
// 时长后缀：oracle 给毫秒（>100000 除 1000），无时长不显示、不编造；
// 去重键 = 语言 + 小写名（去扩展名）+ 秒（无时长记 nodur），同名同时长才算重复。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();
const subResultCache = new Map();

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? clean(slug.replace(/[-_]+/g, ' ')) : '';
}

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

function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}

function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}

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

function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}

async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await reqRaw('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
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
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match), dur: it.norm.duration });
  }
}

async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
  if (!key) return;
  const r = await reqRaw('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': UA, Referer: 'https://subtitlecat.com/' }, 5000);
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
    const pr = await reqRaw('https://subtitlecat.com/' + p, { 'User-Agent': UA, Referer: 'https://subtitlecat.com/' }, 4000);
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

function subDurSec(v) {
  let s = Number(v) || 0;
  if (s > 100000) s = Math.floor(s / 1000);
  return s > 0 ? s : 0;
}
function subDurStr(v) {
  let s = Number(v) || 0;
  if (s > 100000) s = Math.floor(s / 1000);
  if (s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const seenName = new Set();
  const perTier = {};
  const out = [];
  for (const it of sorted) {
    if (out.length >= 10) break;
    if (seenUrl.has(it.url)) continue;
    const nameKey = (it.lang || '') + '|' + it.name.toLowerCase().replace(/\.(srt|vtt|ass|ssa)$/i, '') + '|' + (subDurSec(it.dur) || 'nodur');
    if (seenName.has(nameKey)) continue;
    if ((perTier[it.tier] || 0) >= 8) continue;
    seenUrl.add(it.url);
    seenName.add(nameKey);
    perTier[it.tier] = (perTier[it.tier] || 0) + 1;
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    const dur = subDurStr(it.dur);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName + (dur ? '·' + dur : ''), url: it.url, format: it.fmt });
  }
  return out;
}

const subInflight = new Map();

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

function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
}

export default function spider() {
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
