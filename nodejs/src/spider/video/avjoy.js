import req from '../../util/req.js';

// AVJOY (py_avjoy)
// 站点: https://avjoy.me/ (JAV 站)
// 列表: GET /videos?page=N&o={mr|mv|tr|tf|old}  16 条/页
// 分类: GET /videos/{slug}?page=N[&o=...]
// 标签: GET /search/videos/{tag}/1?page=N  (标签复用搜索端点)
// 搜索: GET /search/videos/{kw}/1?page=N
// 详情: GET /video/{id}  解析 <source> 取 mp4
// 播放: media-cdn3.avjoy.me  token 实时变化，必须点击播放时实时解析，带 Referer

const KEY = 'py_avjoy';
const NAME = 'AVJOY';
const SITE = 'https://avjoy.me';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 17 个真实分类 (2026-10-19 从 /categories 实测)
const CATS = [
  { type_id: 'jav', type_name: 'JAV・日本AV' },
  { type_id: 'china', type_name: 'China・中國' },
  { type_id: 'asian', type_name: 'Asian・アジア' },
  { type_id: 'japan', type_name: 'Japan・日本' },
  { type_id: 'uncensored', type_name: 'Uncensored・無修正' },
  { type_id: 'pornstar', type_name: 'Pornstar·AV女優' },
  { type_id: 'big-tits', type_name: 'Big Tits・巨乳' },
  { type_id: 'amateur', type_name: 'Amateur・素人' },
  { type_id: 'korea', type_name: 'Korea・韓国' },
  { type_id: 'anime', type_name: 'Anime・アニメ' },
  { type_id: 'schoolgirl', type_name: 'Schoolgirl・女子校生' },
  { type_id: 'teen', type_name: 'Teen・少女' },
  { type_id: 'mature', type_name: 'Mature・熟女' },
  { type_id: 'wife', type_name: 'Wife・人妻' },
  { type_id: 'cosplay', type_name: 'Cosplay・コスプレ' },
  { type_id: 'anal', type_name: 'Anal・肛交' },
  { type_id: 'sm', type_name: 'SM' },
];

// 热门标签 (2026-10-19 从 /tags 按热度取前 14)
const TAGS = [
  { type_id: 'tag_中文字幕', type_name: '中文字幕' },
  { type_id: 'tag_口交', type_name: '口交' },
  { type_id: 'tag_潮吹', type_name: '潮吹' },
  { type_id: 'tag_舔穴', type_name: '舔穴' },
  { type_id: 'tag_中出內射', type_name: '中出內射' },
  { type_id: 'tag_國產av', type_name: '國產av' },
  { type_id: 'tag_台灣', type_name: '台灣' },
  { type_id: 'tag_自拍', type_name: '自拍' },
  { type_id: 'tag_無碼破解', type_name: '無碼破解' },
  { type_id: 'tag_探花', type_name: '探花' },
  { type_id: 'tag_swag', type_name: 'swag' },
  { type_id: 'tag_無碼流出', type_name: '無碼流出' },
  { type_id: 'tag_巨乳', type_name: '巨乳' },
  { type_id: 'tag_制服', type_name: '制服' },
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
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

// 双通道: 先框架 req，失败再原生 fetch
async function getHtml(url, noCache) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,ja;q=0.8,en;q=0.7',
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

function mainArea(html) {
  let body = html;
  const i = body.indexOf('well-filters');
  if (i > 0) body = body.slice(i);
  const j = body.indexOf('content-right');
  if (j > 0) body = body.slice(0, j);
  return body;
}

function parseCards(html) {
  const body = mainArea(html);
  const out = [];
  const seen = new Set();
  const re = /<a href="\/video\/(\d+)\/[^"]*"/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const vid = m[1];
    if (seen.has(vid)) continue;
    seen.add(vid);
    const win = body.slice(m.index, m.index + 2600);
    const imgM = win.match(/<img[^>]+src="([^"]+)"/);
    let titleM = win.match(/class="content-title">([^<]+)</);
    if (!titleM) titleM = win.match(/<img[^>]+title="([^"]*)"/);
    const durM = win.match(/class="duration">([\s\S]*?)<\/div>/);
    const viewsM = win.match(/class="content-views">\s*([^<]*?)\s*<\/span>/);
    let remark = durM ? clean(durM[1]) : '';
    const vs = viewsM ? clean(viewsM[1]) : '';
    if (vs) remark = (remark ? remark + ' · ' : '') + vs;
    out.push({
      vod_id: vid,
      vod_name: titleM ? clean(titleM[1]) : 'AVJOY ' + vid,
      vod_pic: imgM ? imgM[1] : '',
      vod_remarks: remark,
    });
  }
  return out;
}

function parsePagecount(html, per) {
  per = per || 16;
  const tm = html.match(/中\s*<span class="text-highlighted">([\d,]+)<\/span>/);
  if (tm) {
    const total = parseInt(tm[1].replace(/,/g, ''), 10) || 0;
    if (total > 0) return Math.max(1, Math.min(Math.ceil(total / per), 9999));
  }
  const pages = [...html.matchAll(/[?&]page=(\d+)/g)].map(x => parseInt(x[1], 10));
  return pages.length ? Math.max(...pages) : 1;
}

function parseTotal(html) {
  const m = html.match(/中\s*<span class="text-highlighted">([\d,]+)<\/span>/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) || 0 : 0;
}

function buildList(url, page) {
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit: 16, total: 0, list: [] };
    const pc = parsePagecount(html);
    if (page > pc) return { page, pagecount: pc, limit: 16, total: parseTotal(html), list: [] };
    const list = parseCards(html);
    return { page, pagecount: pc, limit: 16, total: parseTotal(html) || list.length, list };
  });
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = [{ type_id: '', type_name: '全部' }];
  for (const c of CATS) cls.push({ type_id: c.type_id, type_name: c.type_name });
  for (const tg of TAGS) cls.push({ type_id: tg.type_id, type_name: '🏷 ' + tg.type_name });
  return { class: cls, list: [] };
}

async function homeVod(reqIn) {
  const html = await getHtml(SITE + '/videos');
  return { list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url;
  if (tid.startsWith('tag_')) {
    // 标签走搜索端点
    const kw = tid.slice(4);
    url = SITE + '/search/videos/' + encodeURIComponent(kw) + '/1';
    if (page > 1) url += '?page=' + page;
  } else if (tid) {
    url = SITE + '/videos/' + encodeURIComponent(tid);
    if (page > 1) url += '?page=' + page;
  } else {
    url = SITE + '/videos';
    if (page > 1) url += '?page=' + page;
  }
  return buildList(url, page);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  id = id.replace(/\D/g, '') || '0';
  const html = await getHtml(SITE + '/video/' + id);
  if (!html) return { list: [] };

  let titleM = html.match(/<div class="well-filters video-title"[^>]*>\s*<h1>([\s\S]*?)<\/h1>/);
  if (!titleM) titleM = html.match(/<h1>([\s\S]*?)<\/h1>/);
  const name = titleM ? clean(titleM[1]) : 'AVJOY ' + id;

  let pic = '';
  const picM = html.match(/itemprop="thumbnailUrl" content="([^"]+)"/) || html.match(/poster="([^"]+)"/);
  if (picM) pic = picM[1];

  let desc = '';
  const descM = html.match(/class="[^"]*video-description"[^>]*>\s*<p>([\s\S]*?)<\/p>/);
  if (descM) desc = clean(descM[1]);

  const tags = [];
  const tagsM = html.match(/class="[^"]*video-tags[^"]*"[\s\S]*?<\/section>/);
  if (tagsM) {
    const tagRe = /class="tag"[^>]*>([^<]+)</g;
    let tm;
    while ((tm = tagRe.exec(tagsM[0])) !== null) {
      const tagName = clean(tm[1]);
      if (tagName) tags.push(tagName);
    }
  }

  let remarks = '';
  const durM = html.match(/itemprop="duration" content="PT(?:(\d+)H)?(\d+)M(\d+)S"/);
  if (durM) {
    const h = durM[1], mi = durM[2], se = durM[3];
    remarks = h ? `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}` : `${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}`;
  }

  let year = '';
  const yearM = html.match(/itemprop="uploadDate"[^>]*datetime="(\d{4})/) || html.match(/datetime="(\d{4})-/);
  if (yearM) year = yearM[1];

  // 解析 <source> 取清晰度列表，H264 优先
  const sources = parseSources(html);
  const flags = [];
  const urls = [];
  for (const s of sources) {
    flags.push(s.label);
    urls.push(`${remarks || '正片'}$${id}`);
  }
  if (!flags.length) {
    flags.push('AVJOY');
    urls.push(`${remarks || '正片'}$${id}`);
  }

  const vod = {
    vod_id: id,
    vod_name: name,
    vod_pic: pic,
    vod_year: year,
    vod_remarks: remarks,
    vod_tag: tags.join(','),
    vod_content: desc || name,
    vod_play_from: flags.join('$$$'),
    vod_play_url: urls.join('$$$'),
  };
  subRegister(id, vod);
  return { list: [vod] };
}

function parseSources(html) {
  const items = [];
  const re = /<source\b[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const srcM = tag.match(/src=["']([^"']+)["']/);
    if (!srcM) continue;
    const u = srcM[1];
    const labM = tag.match(/label=["']([^"']*)["']/);
    const resM = tag.match(/res=["']([^"']*)["']/);
    const q = (labM && labM[1]) || (resM ? resM[1] + 'p' : '') || '默認';
    items.push({ codec: u.includes('/av1/') ? 'AV1' : 'H264', q, u });
  }
  const out = [];
  const seen = new Set();
  for (const codec of ['H264', 'AV1']) {
    for (const it of items) {
      if (it.codec !== codec) continue;
      const label = codec === 'H264' ? it.q : it.q + ' AV1';
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ label, url: it.u });
    }
  }
  return out;
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 可能是 "第1集$12345" 形式，取 $ 后面的
  if (id.includes('$')) id = id.split('$').pop().trim();
  const vid = id.replace(/\D/g, '') || id;
  const subsP = subSearchAll(subNormKey(vid)).catch(() => []);
  // token 每次请求都会变，必须实时重新请求详情页，禁用缓存
  const html = await getHtml(SITE + '/video/' + vid);
  if (!html) return { parse: 0, url: '' };
  const sources = parseSources(html);
  if (!sources.length) return { parse: 0, url: '' };
  // 优先 H264 (parseSources 已按 H264 优先排序)
  const best = sources[0];
  return subAttach({
    parse: 0,
    url: best.url,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 16, total: 0, list: [] };
  let url = SITE + '/search/videos/' + encodeURIComponent(wd) + '/1';
  if (page > 1) url += '?page=' + page;
  return buildList(url, page);
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
