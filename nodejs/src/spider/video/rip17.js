import req from '../../util/req.js';

// 17RIP (py_rip17) —— 暂用站方品牌名，用户可改
// 站点: https://17rip.com (MacCMS 站，dsn2 模板，SEO 伪静态)
// 2026-10-20 实测结构:
//   分类: 共 33 个有内容的 type (vodshow)。URL 形如
//         /vodshow/{id}-----------.html ，翻页 /vodshow/{id}--------{page}---.html
//         每页 48 条，页脚有 "共X条数据,当前p/N页" 可解析总页数。
//         (id 17/31/38/39 等为空壳分类，实测 0 条，不收。)
//   卡片: div.public-list-box，a.public-list-exp[href=/voddetail/{id}.html][title]
//         封面 img data-src (img.uyjthen.com 直链，实测 200 image/jpeg，无需代理)
//         备注取 span.public-list-prb (如"高清")，缺失时取 span.public-prt (分类名)。
//   搜索: /vodsearch/{wd}-------------.html，翻页 /vodsearch/{wd}----------{page}---.html
//         搜索页是 detail 式横排卡片 (vod-detail.search-list)，10 条/页，单独解析。
//   详情: /voddetail/{id}.html，标题 h3.slide-info-title，封面 .detail-pic img data-src
//         线路在 .anthology-tab (标签名) + .anthology-list-box (每组一个 sid)，
//         集链接 ul.anthology-list-play a.this-link = /vodplay/{id}-{sid}-{nid}.html。
//         实测抽查的视频均为单线路 (player from=hsckm3u8)。
//   播放: 播放页 SSR 内嵌 var player_aaaa={...}，实测 encrypt=0、trysee=0、points=0
//         (无 VIP)，url 即 CDN master m3u8 (hsm3.hwzcfz.com)，只需 1 次请求。
//         master 只有一路 2000kb/720p variant；AES-128 加密，密钥与真实分片
//         实测零自定义请求头均可 200 (开头几片是全站共用的广告片头)。
//         encrypt=1/2 分支按 MacCMS 标准附带作保险。

const KEY = 'py_rip17';
const NAME = '17RIP';
const SITE = 'https://17rip.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

const CATS = [
  { type_id: '1', type_name: '日韩' },
  { type_id: '2', type_name: '国产' },
  { type_id: '3', type_name: '欧美' },
  { type_id: '4', type_name: '动漫' },
  { type_id: '5', type_name: '网曝门' },
  { type_id: '33', type_name: 'OnlyFans' },
  { type_id: '6', type_name: '人妻熟女' },
  { type_id: '7', type_name: '日本无码' },
  { type_id: '8', type_name: '美乳巨乳' },
  { type_id: '9', type_name: '强制侵犯' },
  { type_id: '10', type_name: '制服诱惑' },
  { type_id: '11', type_name: '绝色佳人' },
  { type_id: '12', type_name: '风俗泡泡浴' },
  { type_id: '20', type_name: '家庭乱伦' },
  { type_id: '21', type_name: '少女萝莉' },
  { type_id: '22', type_name: 'SM调教' },
  { type_id: '23', type_name: '绝顶潮吹' },
  { type_id: '24', type_name: '魔镜系列' },
  { type_id: '25', type_name: '时间停止' },
  { type_id: '26', type_name: '催眠洗脑' },
  { type_id: '27', type_name: '漫改系列' },
  { type_id: '28', type_name: '电车痴汉' },
  { type_id: '29', type_name: '淫欲痴女' },
  { type_id: '34', type_name: 'AV解说' },
  { type_id: '37', type_name: 'AI换脸' },
  { type_id: '13', type_name: '网红主播' },
  { type_id: '14', type_name: '国产传媒' },
  { type_id: '15', type_name: '探花系列' },
  { type_id: '16', type_name: '国产自拍' },
  { type_id: '35', type_name: '其他' },
  { type_id: '30', type_name: '欧美精品' },
  { type_id: '32', type_name: '3D动漫' },
  { type_id: '36', type_name: '三级电影' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

function stripTags(s) {
  return clean(String(s || '').replace(/<[^>]+>/g, ' '));
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
async function getHtml(url, timeoutMs) {
  const headers = { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  try {
    const { data, status } = await req.get(url, { headers, timeout: timeoutMs || 15000 });
    if (status === 200 && typeof data === 'string' && data) return data;
  } catch (e) { /* 换 fetch */ }
  return timedFetchText(url, headers, timeoutMs || 15000);
}

// 解析网格卡片 (首页/分类通用: public-list-box)
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split('public-list-box');
  for (let i = 1; i < blocks.length; i++) {
    const win = blocks[i].slice(0, 2500);
    const dm = win.match(/href="\/voddetail\/(\d+)\.html"/);
    if (!dm) continue;
    const id = dm[1];
    if (seen.has(id)) continue;
    seen.add(id);
    let title = '';
    const tm = win.match(/public-list-exp"[^>]*title="([^"]*)"/) || win.match(/<img[^>]+alt="([^"]*)"/);
    if (tm) title = clean(tm[1]);
    let pic = '';
    const pm = win.match(/data-src="([^"]+)"/);
    if (pm) pic = fixUrl(pm[1]);
    let remarks = '';
    const rm = win.match(/public-list-prb[^>]*>([\s\S]{0,80}?)<\/span>/);
    if (rm) remarks = stripTags(rm[1]);
    if (!remarks) {
      const rp = win.match(/public-prt[^>]*>([^<]*)</);
      if (rp) remarks = clean(rp[1]);
    }
    out.push({ vod_id: id, vod_name: title || id, vod_pic: pic, vod_remarks: remarks });
  }
  return out;
}

// 解析搜索页卡片 (detail 式横排: vod-detail ... search-list)
function parseSearchCards(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split('search-list');
  for (let i = 1; i < blocks.length; i++) {
    const win = blocks[i].slice(0, 3500);
    const dm = win.match(/href="\/voddetail\/(\d+)\.html"/);
    if (!dm) continue;
    const id = dm[1];
    if (seen.has(id)) continue;
    seen.add(id);
    let title = '';
    const tm = win.match(/slide-info-title[^>]*>([^<]*)</);
    if (tm) title = clean(tm[1]);
    if (!title) {
      const am = win.match(/<img[^>]+alt="([^"]*)"/);
      if (am) title = clean(am[1]);
    }
    let pic = '';
    const pm = win.match(/data-src="([^"]+)"/);
    if (pm) pic = fixUrl(pm[1]);
    let remarks = '';
    const rm = win.match(/slide-info-remarks[^>]*>([^<]*)</);
    if (rm) remarks = clean(rm[1]);
    out.push({ vod_id: id, vod_name: title || id, vod_pic: pic, vod_remarks: remarks });
  }
  return out;
}

function parsePagecount(html) {
  const m = String(html || '').match(/当前\s*\d+\s*\/\s*(\d+)\s*页/);
  if (m) return Math.max(1, parseInt(m[1], 10) || 1);
  return 1;
}

function catUrl(tid, page) {
  page = Math.max(1, page || 1);
  return page > 1 ? `${SITE}/vodshow/${tid}--------${page}---.html` : `${SITE}/vodshow/${tid}-----------.html`;
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
  const tid = t(body.tid || body.id) || '1';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await getHtml(catUrl(tid, page));
  if (!html) return { page, pagecount: page, limit: 48, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit: 48, total: list.length, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  const idm = id.match(/voddetail\/(\d+)\.html/) || id.match(/^(\d+)$/);
  if (idm) id = idm[1];
  const durl = `${SITE}/voddetail/${id}.html`;
  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const nm = html.match(/slide-info-title[^>]*>([^<]*)</);
  if (nm) name = clean(nm[1]);
  let pic = '';
  const pm = html.match(/detail-pic[^>]*>[\s\S]{0,300}?data-src="([^"]+)"/);
  if (pm) pic = fixUrl(pm[1]);
  if (!pic) {
    const og = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (og) pic = fixUrl(og[1]);
  }
  let remarks = '';
  const rm = html.match(/slide-info-remarks[^>]*>([^<]*)</);
  if (rm) remarks = clean(rm[1]);
  let actor = '';
  const am = html.match(/演员\s*:\s*<\/strong>([\s\S]{0,600}?)<\/div>/);
  if (am) actor = stripTags(am[1]).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let vodClass = '';
  const cm = html.match(/类型\s*:\s*<\/strong>([\s\S]{0,600}?)<\/div>/);
  if (cm) vodClass = stripTags(cm[1]).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let content = '';
  const dm = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
  if (dm) content = clean(dm[1]);

  // 线路: anthology-tab 标签与 anthology-list-box 一一对应 (顺序即 sid 顺序)
  const tabNames = [...html.matchAll(/anthology-tab[\s\S]*?<\/div>\s*<\/div>/g)].length
    ? [...html.matchAll(/<a class="swiper-slide"[^>]*>([\s\S]*?)<\/a>/g)].map(x => stripTags(x[1]).replace(/资源\s*$/, '').trim())
    : [];
  const boxes = [...html.matchAll(/anthology-list-box[^"]*"[^>]*>([\s\S]*?)(?=anthology-list-box|<\/div>\s*<\/div>\s*<script>\$\("\.anthology-tab|$)/g)].map(x => x[1]);
  const fromArr = [];
  const urlArr = [];
  boxes.forEach((box, bi) => {
    const eps = [...box.matchAll(/<a[^>]+href="(\/vodplay\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    if (!eps.length) return;
    const parts = eps.map(e => `${stripTags(e[2]) || '正片'}$${fixUrl(e[1])}`);
    fromArr.push(tabNames[bi] || ('线路' + (fromArr.length + 1)));
    urlArr.push(parts.join('#'));
  });
  if (!fromArr.length) {
    // 兜底: 直接抓全部 play 链接按 sid 分组
    const all = [...html.matchAll(new RegExp(`/vodplay/${id}-(\\d+)-(\\d+)\\.html`, 'g'))];
    if (all.length) {
      const sids = [...new Set(all.map(x => x[1]))].sort();
      sids.forEach((s, i) => {
        fromArr.push('线路' + (i + 1));
        urlArr.push(`正片$${SITE}/vodplay/${id}-${s}-1.html`);
      });
    }
  }

  const vod = {
      vod_id: id,
      vod_name: name || id,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_actor: actor,
      vod_class: vodClass,
      vod_content: content || name,
      vod_play_from: fromArr.join('$$$'),
      vod_play_url: urlArr.join('$$$'),
  };
  if (vod.vod_name && vod.vod_play_url) subRegister(body.id, vod);
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  const purl = fixUrl(id);
  const html = await getHtml(purl, 12000);
  if (!html) return subAttach({ parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
  const dm = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/) || html.match(/var\s+player_aaaa\s*=\s*(\{[^{}]*\})/);
  if (!dm) return subAttach({ parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
  let pd = null;
  try { pd = JSON.parse(dm[1]); } catch (e) { /* fallthrough */ }
  if (!pd || !pd.url) return subAttach({ parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
  let raw = String(pd.url);
  const enc = parseInt(pd.encrypt, 10) || 0;
  try {
    if (enc === 1) raw = unescape(raw);
    else if (enc === 2) raw = unescape(Buffer.from(raw, 'base64').toString('utf8'));
  } catch (e) { /* 用原始 url */ }
  return subAttach({ parse: 0, url: fixUrl(raw), header: { 'User-Agent': UA, 'Referer': purl } }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 10, total: 0, list: [] };
  const enc = encodeURIComponent(wd);
  const url = page > 1 ? `${SITE}/vodsearch/${enc}----------${page}---.html` : `${SITE}/vodsearch/${enc}-------------.html`;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit: 10, total: 0, list: [] };
  const list = parseSearchCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit: 10, total: list.length, list };
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
