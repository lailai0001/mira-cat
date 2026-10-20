import req from '../../util/req.js';

// 柚子短剧 (py_youzidj)
// 站点: https://youzidj.com (柚子短剧，AI 成人短剧，SSR 站)
// 2026-10-20 实测结构:
//   列表: article.drama-card 卡片 (24 条/页)，链接 /dramas/{slug}/season-1/，
//         封面 /catalogue-art/{uuid}-960.webp 同站直链 (无需代理)，
//         备注取 .home-card-episodes-long 如「更新至9集」。
//         分页统一 {base}/page/{n}/ (全部短剧 /dramas/、题材 /dramas/category/{slug}/、标签 /tags/{slug}/)。
//   详情: 剧集页内嵌 JSON-LD (TVSeason)，含剧名/简介/封面/episode 数组 (url+name+episodeNumber)。
//   搜索: /search/?q={wd} 服务端渲染，单页最多 24 条，站方无搜索分页。
//   播放: 集页面只有 data-video={videoId}/data-price，无裸流地址；
//         真链路 = 访客会话 + 播放授权，两步接口:
//         1) POST /api/account/bootstrap (需 Origin/Referer) -> 建访客账户，
//            Set-Cookie: eden_account (长效，模块内缓存复用)。
//         2) POST /api/playback/{videoId}?mode=native (带 eden_account Cookie)
//            -> JSON {url: /media/{vid}/{ver}/master.m3u8, expires_at}
//               + Set-Cookie: eden_play_{videoId} (限定 /media/{vid}/ 路径，约 36 分钟)。
//         3) 播放器直取 m3u8/分片时必须同带这两个 Cookie，否则 403「播放凭证已过期」。
//         play() 把 Cookie 写进返回 header (与 UA/Referer 一起)，实测全链 200:
//         master.m3u8 / init.mp4 / seg00000.m4s 均可达。
//   VIP: 站内有付费解锁机制 (播放器 JS 有 402->unlock 分支、/api/orders)，
//        但抽查 18 部剧 35 集 (修仙/都市/古装/家庭伦理/武侠等，含首集与末集)
//        data-price 全部为 0、data-free=true，playback 均正常发授权。
//        若日后某集 price>0，接口会回 402，play() 自动落 parse:1 嗅探集页面兜底。
// 2026-10-20 翻页修复 (真机反馈: 除全部短剧外所有分类无法加载更多):
//   服务端复测 (inject + 真实 HTTP) 29 分类 p1/p2 全部正确，问题出在分类 id
//   回传环节: 'genre:urban'/'tag:romance' 含冒号，与能正常翻页的 'all' 的唯一
//   差异就在冒号。改为无冒号 id ('g_'/'t_' 前缀)，category() 同时兼容旧冒号 id、
//   百分号编码、裸 slug、中文名与 pg 页码字段，任何回传形态都能正确定位分类。
//   附带修复: 卡片链接只认 season-1，导致已出到 season-2+ 的剧被整卡丢弃
//   (校园少 2 部、绿帽少 4 部等)，改认 season-<数字>；单页满 24 条时不再误报
//   第 2 页 (逆袭实为单页 24 条)。

const KEY = 'py_youzidj';
const NAME = '柚子短剧';
const SITE = 'https://youzidj.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

const GENRES = [
  { slug: 'cultivation', name: '修仙' },
  { slug: 'wealthy-family', name: '豪门' },
  { slug: 'urban', name: '都市' },
  { slug: 'costume', name: '古装' },
  { slug: 'family-ethics', name: '家庭伦理' },
  { slug: 'martial-arts', name: '武侠' },
  { slug: 'campus', name: '校园' },
];

const TAGS = [
  { slug: 'romance', name: '情感' },
  { slug: 'yu-jie', name: '御姐' },
  { slug: 'ni-xi', name: '逆袭' },
  { slug: 'tiao-jiao', name: '调教' },
  { slug: 'shu-nu', name: '熟女' },
  { slug: 'ren-qi', name: '人妻' },
  { slug: 'hou-gong', name: '后宫' },
  { slug: 'tou-qing', name: '偷情' },
  { slug: 'qi-huan', name: '奇幻' },
  { slug: 'xi-tong', name: '系统' },
  { slug: 'nu-pu', name: '女仆' },
  { slug: 'luo-li', name: '萝莉' },
  { slug: 'lu-mao', name: '绿帽' },
  { slug: 'xuan-yi', name: '悬疑' },
  { slug: 'mu-zi', name: '母子' },
  { slug: 'jiao-shi', name: '教师' },
  { slug: 'apocalypse', name: '末日' },
  { slug: 'chong-sheng', name: '重生' },
  { slug: 'chuan-yue', name: '穿越' },
  { slug: 'fu-nu', name: '父女' },
  { slug: 'jie-di', name: '姐弟' },
];

const CATS = [
  { type_id: 'all', type_name: '全部短剧' },
  ...GENRES.map(g => ({ type_id: 'g_' + g.slug, type_name: g.name })),
  ...TAGS.map(g => ({ type_id: 't_' + g.slug, type_name: g.name })),
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
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
    const { data, status } = await req.get(url, { headers, timeout: 12000 });
    if (status === 200 && typeof data === 'string' && data) return data;
  } catch (e) { /* 换 fetch */ }
  return timedFetchText(url, headers, 12000);
}

// POST JSON 接口 (bootstrap/playback 用): 返回 { status, data, setCookie[] }
// req 优先、fetch 兜底; 两条通道都带 Origin/Referer (接口校验来源)
async function postJson(url, referer, cookie) {
  const headers = {
    'User-Agent': UA,
    'Referer': referer || REFERER,
    'Origin': SITE,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (cookie) headers['Cookie'] = cookie;
  try {
    const r = await req.post(url, {}, { headers, timeout: 10000, validateStatus: () => true });
    const sc = (r.headers && r.headers['set-cookie']) || [];
    return { status: r.status, data: r.data, setCookie: Array.isArray(sc) ? sc : [sc] };
  } catch (e) { /* 换 fetch */ }
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(url, { method: 'POST', headers, body: '{}', signal: ctl.signal });
    clearTimeout(to);
    let data = null;
    try { data = await r.json(); } catch (e) { /* 非 JSON */ }
    let sc = [];
    if (typeof r.headers.getSetCookie === 'function') sc = r.headers.getSetCookie();
    else if (r.headers.get('set-cookie')) sc = [r.headers.get('set-cookie')];
    return { status: r.status, data, setCookie: sc };
  } catch (e) {
    return { status: 0, data: null, setCookie: [] };
  }
}

function pickCookie(setCookie, namePrefix) {
  for (const line of setCookie || []) {
    const m = String(line).match(new RegExp('^(' + namePrefix + '[^=]*)=([^;]+)'));
    if (m) return { name: m[1], value: m[2], pair: m[1] + '=' + m[2] };
  }
  return null;
}

// ---------- 访客会话 (eden_account) ----------
let accountPair = '';
let accountAt = 0;

async function ensureAccount(force) {
  // eden_account 服务端有效期很长，本地缓存 12 小时复用，避免每次 play 都建新访客
  if (!force && accountPair && Date.now() - accountAt < 12 * 3600 * 1000) return accountPair;
  const r = await postJson(SITE + '/api/account/bootstrap', REFERER, '');
  const c = pickCookie(r.setCookie, 'eden_account');
  if (r.status === 200 && c) {
    accountPair = c.pair;
    accountAt = Date.now();
    return accountPair;
  }
  return accountPair || '';
}

// ---------- 列表解析 ----------
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const parts = String(html).split('<article class="drama-card');
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].slice(0, 6000);
    const hm = block.match(/href="(https:\/\/youzidj\.com\/dramas\/[a-z0-9\-]+\/season-\d+\/)"/);
    if (!hm) continue;
    const url = hm[1];
    if (seen.has(url)) continue;
    seen.add(url);
    let title = '';
    const tm = block.match(/drama-card-title"[^>]*title="([^"]+)"/) || block.match(/drama-card-title"[^>]*>([^<]+)</);
    if (tm) title = clean(tm[1]);
    if (!title) {
      const am = block.match(/<img[^>]+alt="([^"]+?)海报"/);
      if (am) title = clean(am[1]);
    }
    let pic = '';
    const pm = block.match(/(\/catalogue-art\/[0-9a-f\-]+-960\.webp)/);
    if (pm) pic = SITE + pm[1];
    let remarks = '';
    const rm = block.match(/home-card-episodes-long">([^<]+)</);
    if (rm) remarks = clean(rm[1]);
    out.push({ vod_id: url, vod_name: title || url, vod_pic: pic, vod_remarks: remarks });
  }
  return out;
}

function parsePagecount(html, page, got) {
  let pc = page || 1;
  const nums = [...String(html).matchAll(/\/page\/(\d+)\//g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 10000);
  if (nums.length) pc = Math.max(pc, ...nums);
  // 满页时也只在页面里真有更大页码链接才预告下一页 (逆袭单页正好 24 条，别误报)
  if (got >= 24 && nums.some(n => n > (page || 1))) pc = Math.max(pc, (page || 1) + 1);
  return pc;
}

function catBase(tid) {
  // 分类 id 容错: 新 id 'g_'/'t_' 前缀、旧 'genre:'/'tag:' id、裸 slug、中文名、
  // 百分号编码形态全部认，任何回传变形都能定位到同一分类
  let id = String(tid == null ? '' : tid).trim();
  try { id = decodeURIComponent(id); } catch (e) { /* 保持原样 */ }
  if (!id || id === 'all') return SITE + '/dramas/';
  let m = id.match(/^(?:g_|genre:)(.+)$/);
  if (m) return SITE + '/dramas/category/' + m[1] + '/';
  m = id.match(/^(?:t_|tag:)(.+)$/);
  if (m) return SITE + '/tags/' + m[1] + '/';
  const g = GENRES.find(x => x.slug === id || x.name === id);
  if (g) return SITE + '/dramas/category/' + g.slug + '/';
  const tg = TAGS.find(x => x.slug === id || x.name === id);
  if (tg) return SITE + '/tags/' + tg.slug + '/';
  return SITE + '/dramas/';
}

async function buildList(url, page, limit) {
  limit = limit || 30;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html, page, list.length);
  return { page, pagecount: Math.max(pc, page), limit, total: list.length, list };
}

// ---------- 接口实现 ----------
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
  const tid = t(body.tid || body.id) || 'all';
  const page = Math.max(1, parseInt(body.page != null ? body.page : body.pg, 10) || 1);
  const base = catBase(tid);
  const url = page > 1 ? base + 'page/' + page + '/' : base;
  return buildList(url, page, 30);
}

function findSeason(ld) {
  if (!ld || typeof ld !== 'object') return null;
  if (Array.isArray(ld)) {
    for (const x of ld) { const s = findSeason(x); if (s) return s; }
    return null;
  }
  if (Array.isArray(ld.episode)) return ld;
  if (ld['@graph']) return findSeason(ld['@graph']);
  return null;
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//i.test(id) ? id : SITE + '/dramas/' + id.replace(/^\/+|\/+$/g, '') + '/season-1/';
  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  let desc = '';
  let pic = '';
  let episodes = [];
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of lds) {
    let obj = null;
    try { obj = JSON.parse(b[1]); } catch (e) { /* 下一块 */ }
    const season = findSeason(obj);
    if (!season) continue;
    name = clean((season.partOfSeries && season.partOfSeries.name) || season.name || '');
    desc = clean(season.description || '');
    pic = fixUrl(season.image || '');
    episodes = (season.episode || []).map(ep => ({
      n: parseInt(ep.episodeNumber, 10) || 0,
      label: clean(ep.name || ''),
      url: fixUrl(ep.url || ''),
    })).filter(ep => ep.url);
    if (episodes.length) break;
  }
  if (!episodes.length) {
    // JSON-LD 兜底: 直接扫集链接
    const re = /href="(https:\/\/youzidj\.com\/dramas\/[a-z0-9\-]+\/season-\d+-episode-(\d+)\/)"/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      episodes.push({ n: parseInt(m[2], 10) || episodes.length + 1, label: '', url: m[1] });
    }
  }
  if (!name) {
    const tm = html.match(/<title>([^<]+)<\/title>/);
    if (tm) name = clean(tm[1]).replace(/·.*$/, '').trim();
  }
  if (!pic) {
    const om = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (om) pic = fixUrl(om[1]);
  }
  if (!desc) {
    const dm = html.match(/<meta name="description" content="([^"]+)"/);
    if (dm) desc = clean(dm[1]);
  }
  episodes.sort((a, b) => a.n - b.n);
  const purl = episodes.map(ep => (ep.label || ('第' + ep.n + '集')) + '$' + ep.url).join('#');

  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_remarks: episodes.length ? '共' + episodes.length + '集' : '',
      vod_content: desc,
      vod_play_from: '柚子短剧',
      vod_play_url: purl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const epUrl = fixUrl(id);

  const html = await getHtml(epUrl);
  const vm = html && html.match(/data-video="([0-9a-f\-]{36})"/);
  if (!vm) {
    // 集页面拿不到 videoId (结构变更/付费墙): 嗅探兜底
    return { parse: 1, jx: 0, url: epUrl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const videoId = vm[1];
  const pm = html.match(/data-price="([^"]*)"/);
  const price = pm ? pm[1] : '0';

  let acct = await ensureAccount(false);
  let r = await postJson(SITE + '/api/playback/' + videoId + '?mode=native', epUrl, acct);
  if (r.status === 401 && acct) {
    // 会话失效: 强制重建访客账户再试一次
    acct = await ensureAccount(true);
    r = await postJson(SITE + '/api/playback/' + videoId + '?mode=native', epUrl, acct);
  }
  if (r.status === 402 || price !== '0') {
    // 付费集 (解锁制): 接口不发授权，交嗅探打开集页面走站方解锁流程
    return { parse: 1, jx: 0, url: epUrl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const data = r.data && typeof r.data === 'object' ? r.data : null;
  const playCookie = pickCookie(r.setCookie, 'eden_play_');
  if (r.status !== 200 || !data || !data.url || !playCookie) {
    return { parse: 1, jx: 0, url: epUrl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const cookie = [acct, playCookie.pair].filter(Boolean).join('; ');
  return {
    parse: 0,
    url: fixUrl(data.url),
    header: { 'User-Agent': UA, 'Referer': epUrl, 'Cookie': cookie },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page != null ? body.page : body.pg, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  if (page > 1) return { page, pagecount: 1, limit: 30, total: 0, list: [] }; // 站方搜索无分页
  const url = SITE + '/search/?q=' + encodeURIComponent(wd);
  const html = await getHtml(url);
  const list = html ? parseCards(html) : [];
  return { page: 1, pagecount: 1, limit: 30, total: list.length, list };
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
