import req from '../../util/req.js';

const KEY = 'py_getav';
const NAME = 'GetAV';
const HOST = 'https://getav.me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function t(v) {
  return String(v == null ? '' : v).trim();
}

function decodeHtml(s) {
  s = t(s);
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

async function fetchHtml(path) {
  const url = path.startsWith('http') ? path : HOST + path;
  const headers = {
    'User-Agent': UA,
    'Referer': HOST + '/zh',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  // 双通道: 通道1 框架 req (axios, MiraPlayer 内核可用); 通道2 Node 原生 fetch (站点屏蔽 axios 指纹时用)
  for (let i = 0; i < 2; i++) {
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const t = typeof data === 'string' ? data : String(data || '');
      if (status === 200 && t.length > 500) return t;
    } catch { /* 换通道2 */ }
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.length > 500) return t;
    } catch { /* retry */ }
  }
  return '';
}

// Parse video cards from server-rendered HTML
// Card structure: <div class="group ..."><a href="/zh/videos/{slug}"><img src="POSTER"/></a><a href="/zh/videos/{slug}"><h3 title="TITLE">
function parseCards(html) {
  const list = [];
  const seen = {};
  if (!html) return list;
  // Match the card container to get both poster and title
  const cardRe = /<div class="group cursor-pointer[\s\S]*?<a[^>]*href="(\/zh\/videos\/[\w\-]+)"[^>]*>([\s\S]*?)<\/a>\s*<a[^>]*href="\/zh\/videos\/[\w\-]+"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html))) {
    const href = m[1];
    const imgBlock = m[2];
    const titleBlock = m[3];
    if (seen[href]) continue;
    const tm = titleBlock.match(/title="([^"]+)"/i);
    const title = tm ? decodeHtml(tm[1]) : '';
    if (!title) continue;
    seen[href] = 1;
    // poster from img src in the first <a> (static.worldstatic.com)
    let pic = '';
    const im = imgBlock.match(/<img[^>]*src="([^"]+)"/i);
    if (im) {
      pic = im[1].replace(/&amp;/g, '&');
      if (pic.startsWith('//')) pic = 'https:' + pic;
    }
    list.push({
      vod_id: href,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: '',
    });
  }
  // Fallback: old pattern for search pages or different layouts
  if (!list.length) {
    const re = /<a href="(\/zh\/videos\/[\w\-]+)">([\s\S]*?)<\/a>/gi;
    while ((m = re.exec(html))) {
      const href = m[1];
      const inner = m[2];
      if (seen[href]) continue;
      const tm = inner.match(/title="([^"]+)"/i);
      const title = tm ? decodeHtml(tm[1]) : '';
      if (!title) continue;
      seen[href] = 1;
      let pic = '';
      const im = inner.match(/<img[^>]*src="([^"]+)"/i);
      if (im) pic = im[1].replace(/&amp;/g, '&');
      list.push({ vod_id: href, vod_name: title, vod_pic: pic, vod_remarks: '' });
    }
  }
  return list;
}

const CATS = {
  'new': { path: '/zh/new-releases', name: '最新' },
  'hot': { path: '/zh/hot', name: '热门' },
  'uncensored': { path: '/zh/uncensored', name: '无码' },
  'censored': { path: '/zh/censored', name: '有码' },
  'subtitle': { path: '/zh/subtitle', name: '字幕' },
  'series': { path: '/zh/series', name: '系列' },
  'studios': { path: '/zh/studios', name: '片商' },
};

// videoSources is embedded as escaped JSON in the detail HTML:
// \"videoSources\":[{\"type\":\"raw_1080p\",\"url\":\"https://static.worldstatic.com/...index.txt?t=...\"},...]
// The index.txt is an AES-128 m3u8 playlist (Content-Type: application/vnd.apple.mpegurl)
const QUALITY_ORDER = ['raw_1080p', 'raw_720p', 'raw_480p', 'raw_240p'];
const QUALITY_NAME = { raw_1080p: '1080P', raw_720p: '720P', raw_480p: '480P', raw_240p: '240P' };

function parseVideoSources(html) {
  const tracks = [];
  if (!html) return tracks;
  const m = html.match(/\\"videoSources\\":\[(.*?)\],\\"/s);
  if (!m) return tracks;
  const seen = {};
  const re = /\\"type\\":\\"([^"\\]+)\\",\\"url\\":\\"([^"\\]+)/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) {
    const type = mm[1];
    if (seen[type]) continue;
    seen[type] = 1;
    tracks.push({ type, url: mm[2].replace(/\\u0026/g, '&') });
  }
  // highest quality first
  tracks.sort((a, b) => {
    const ia = QUALITY_ORDER.indexOf(a.type);
    const ib = QUALITY_ORDER.indexOf(b.type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return tracks;
}

async function init() {
  return {};
}

async function home() {
  const classes = Object.keys(CATS).map((k) => ({ type_id: k, type_name: CATS[k].name }));
  return { class: classes, filters: {}, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'new');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATS[tid] || CATS['new'];
  const html = await fetchHtml(`${cat.path}?page=${page}`);
  const list = parseCards(html);
  return {
    page,
    pagecount: list.length >= 20 ? page + 1 : page,
    limit: 24,
    total: list.length,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const id of (ids || []).filter(Boolean)) {
    const html = await fetchHtml(id);
    if (!html) continue;
    // title from <title> or JSON-LD
    let name = '';
    const tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm) name = decodeHtml(tm[1]).split('|')[0].trim();
    // poster from JSON-LD thumbnailUrl
    let pic = '';
    const pm = html.match(/"thumbnailUrl":"([^"]+)"/);
    if (pm) pic = pm[1].replace(/\\u0026/g, '&');
    // description from JSON-LD
    let desc = '';
    const dm = html.match(/"description":"([^"]{0,500})"/);
    if (dm) desc = decodeHtml(dm[1]);
    // play: multi-quality direct m3u8 from videoSources (1080P first);
    // fallback to page-URL sniffing if not found
    const tracks = parseVideoSources(html);
    let playUrl;
    if (tracks.length) {
      playUrl = tracks.map((tr) => `${QUALITY_NAME[tr.type] || tr.type}$${tr.url}`).join('#');
    } else {
      playUrl = `播放$${id}`;
    }
    if (!name) continue;
    const vod = {
      vod_id: id,
      vod_name: name,
      vod_pic: pic,
      vod_content: desc,
      vod_play_from: 'GetAV',
      vod_play_url: playUrl,
    };
    subRegister(id, vod);
    list.push(vod);
  }
  return { list };
}

async function play(reqIn) {
  let id = t(reqIn?.body?.id);
  if (!id) return { parse: 0, url: '' };
  // id may be "1080P$https://..." full track string; keep only the URL part
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  // direct worldstatic m3u8 -> play directly
  if (/^https?:\/\//i.test(id) && /worldstatic\.com/i.test(id)) {
    return subAttach({
      parse: 0,
      url: id,
      header: { Referer: HOST + '/zh', 'User-Agent': UA },
    }, subsP);
  }
  // fallback: sniff on the video page
  const pageUrl = id.startsWith('http') ? id : HOST + id;
  return subAttach({
    parse: 1,
    url: pageUrl,
    header: { Referer: HOST + '/zh', 'User-Agent': UA },
  }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const html = await fetchHtml(`/zh/search?q=${encodeURIComponent(wd)}&page=${page}`);
  let list = parseCards(html);
  if (!list.length) {
    // fallback: try alternate search path
    const html2 = await fetchHtml(`/zh/search/${encodeURIComponent(wd)}?page=${page}`);
    list = parseCards(html2);
  }
  return { page, pagecount: page, limit: 24, total: list.length, list };
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
