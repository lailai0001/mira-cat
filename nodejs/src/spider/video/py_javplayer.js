// JavPlayer - mira-cat 蜘蛛初稿（2026-10-31 调研起草，未推送）
// 站点：https://javplayer.org/（与 javct 同模板 family；javct 蜘蛛已验证同款机制）
// 结构（jina 实测，VM 直连遭 WAF 403、App 侧 req 待真机验）：
//  - 列表：卡片 <a href="/v/{slug}" class="card__play">，标题 card__title，
//    封面懒加载：src 是 default-cover.jpg 占位，真实封面在 data-src
//    （cdn001/cdn002.imggle.net/poster/…）；番号在 card__category 锚文本。
//  - 分页：24 条/页。/new-releases 与 /search/<kw> 用干净分页 /pg-N；
//    /censored、/subtitle、/category/<slug> 用带 hash 分页 /<path>-<hash>/pg-N，
//    hash 取自当页 paginator 链接（每列表各异，如 censored-6pccbw9k、
//    big-tits-hipx7w77），页 1 现取现解析；hash 轮换时刷新一次重试。
//  - 详情：/v/{slug}；标题取 og:title（跳过 jina 混入的假 403 标题）；封面
//    og:image（cdna.sextb.net/thumb）或播放器封面（imggle thumb）；
//    服务器按钮 switch-source（F4/DD/US，VIP 按钮绝不碰），data-source=filmId，
//    data-id=episode；页内 filmId 与 window.__pt/__pk；
//    点击 → POST /ajax/player，body {episode, filmId, pt}，头
//    X-Requested-With: XMLHttpRequest；返回 player_enc（xor 解密，密钥 __pk）
//    或 player（iframe）；嵌页按 host 分流到已部署的 sextb-hls Worker
//    （f4scdn/f4jav → /f4，其余 → /v）。
//  - 清晰度：站方给的是服务器选择（F4/DD/US），不是分辨率档，不编造清晰度；
//    Worker /f4 回的是 f4 master 清单（实测预告片 master 仅 720p 一档；
//    正片 master 是否多档待真机验——若多档，播放器侧可自选）。
//  - 搜索：/search/<slug>（slug 化：小写、非字母数字转 -；中文/日文关键词
//    站方 404，故 slug 为空时直接返回空，不发请求）。
//  - 字幕：与猫源 27 源同款芯（迅雷/迅雷看看/SubtitleCat 三槽，见文末字幕节）；
//    番号只从片名取；详情串行预热（并行预热曾把 SubtitleCat 挤挂，ONE 实测教训）。
//  - WAF：VM 直连 403；蜘蛛先 GET 首页暖会话再抓详情/ajax；App 的 req
//    能否过墙、cookie 是否跨请求保持、/ajax/player 实况、DD/US 嵌页 host、
//    正片 master 档位，均待真机验（见 REPORT_javplayer.md）。
import req from '../../util/req.js';

const KEY = 'py_javplayer';
const NAME = 'JavPlayer';
const HOST = 'https://javplayer.org';
const WORKER = 'https://sextb-hls.li768435813.workers.dev';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || HOST + '/',
  };
}

async function getText(url, referer) {
  try {
    const { data } = await req.get(url, { headers: H(referer), timeout: 15000 });
    return String(data || '');
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function b64Decode(s) {
  let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  try { return Buffer.from(t, 'base64').toString('latin1'); } catch { return ''; }
}

function xorStr(raw, key) {
  if (!key) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

function latin1ToUtf8(s) {
  try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; }
}

// xorDecrypt：javct 同款（atob 不一定可用，base64 走 Buffer；密钥为空只解码）
function xorDecrypt(enc, key) {
  if (!enc) return '';
  const decoded = b64Decode(enc);
  if (!key) return latin1ToUtf8(decoded);
  return latin1ToUtf8(xorStr(decoded, key));
}

function isF4Host(host) { return /f4scdn\.com|f4jav\.xyz/i.test(host || ''); }
function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/]+)/i);
  return m ? m[1] : '';
}
function workerUrl(embed, durl) {
  const host = hostOf(embed);
  const path = isF4Host(host) ? '/f4' : '/v';
  return WORKER + path + '?u=' + encodeURIComponent(embed) + '&r=' + encodeURIComponent(durl);
}

// ---------- 列表解析（javct 同款：锚点扫描 + 锚点前 900 字内最后一个 img + 顺序对齐标题/番号） ----------
function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<a[^>]*href="(https:\/\/javplayer\.org\/v\/[a-z0-9\-]+|\/v\/[a-z0-9\-]+)"[^>]*class="[^"]*card__play[^"]*"[^>]*>([\s\S]{0,1500}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (!/^https?:\/\//i.test(href)) href = HOST + href;
    if (seen.has(href)) continue;
    seen.add(href);
    let pic = '';
    const before = html.slice(Math.max(0, m.index - 900), m.index);
    const imgs = [...before.matchAll(/<img[^>]*>/gi)];
    const im = imgs.length ? imgs[imgs.length - 1][0] : null;
    if (im) {
      const dm = im.match(/data-src="([^"]+)"/i);
      const sm = im.match(/src="([^"]+)"/i);
      const cand = (dm && dm[1]) || (sm && sm[1]) || '';
      if (cand && !/default-cover/i.test(cand) && !/data:image/i.test(cand)) {
        pic = /^https?:\/\//i.test(cand) ? cand : HOST + (cand.startsWith('/') ? cand : '/' + cand);
      }
    }
    items.push({ vod_id: href, vod_name: '', vod_pic: pic, vod_remarks: '' });
    if (items.length >= 60) break;
  }
  const titles = [...html.matchAll(/class="[^"]*card__title[^"]*"[^>]*>([\s\S]{0,500}?)<\/[^>]+>/gi)].map(x => stripTags(x[1]));
  const codes = [...html.matchAll(/<a[^>]*href="https:\/\/javplayer\.org\/v\/[a-z0-9\-]+"[^>]*>([A-Z0-9\-]{4,})<\/a>/gi)].map(x => x[1]);
  items.forEach((it, i) => {
    if (titles[i]) it.vod_name = titles[i];
    if (codes[i]) it.vod_remarks = codes[i];
    if (!it.vod_name) {
      const slug = (it.vod_id.match(/\/v\/([a-z0-9\-]+)/i) || [])[1] || '';
      it.vod_name = slug ? slug.toUpperCase() : NAME;
      if (!it.vod_remarks && slug) it.vod_remarks = slug.toUpperCase();
    }
  });
  return items.filter(it => it.vod_name && it.vod_name.length >= 2);
}

// ---------- 分类 ----------
const CATS = [
  { type_id: 'kw_wuma', type_name: '无码流出' },
  { type_id: '/category/big-tits', type_name: '巨乳' },
  { type_id: '/category/big-asses', type_name: '大屁股' },
  { type_id: '/category/married-woman', type_name: '人妻' },
  { type_id: 'kw_zhifu', type_name: '制服' },
  { type_id: '/category/creampie', type_name: '中出' },
  { type_id: '/amateur', type_name: '素人' },
  { type_id: '/uncensored', type_name: '无码' },
  { type_id: '/subtitle', type_name: '字幕' },
  { type_id: '/new-releases', type_name: '最新' },
  { type_id: '/censored', type_name: '有码' },
  { type_id: '/category/anal', type_name: '肛交' },
  { type_id: '/category/av-idol', type_name: 'AV偶像' },
  { type_id: '/category/beautiful-girl', type_name: '美少女' },
  { type_id: '/category/beautiful-pussy', type_name: '美穴' },
  { type_id: '/category/blowjob', type_name: '口交' },
  { type_id: '/category/bondage', type_name: '捆绑' },
  { type_id: '/category/bukkake', type_name: '多人颜射' },
  { type_id: '/category/cheating-wife', type_name: '出轨人妻' },
  { type_id: '/category/cosplay', type_name: '角色扮演' },
  { type_id: '/category/cumshot', type_name: '射精' },
  { type_id: '/category/deep-throat', type_name: '深喉' },
  { type_id: '/category/doggy-style', type_name: '后入' },
  { type_id: '/category/drama', type_name: '剧情' },
  { type_id: '/category/facials', type_name: '颜射' },
  { type_id: '/category/featured-actress', type_name: '明星女优' },
  { type_id: '/category/female-boss', type_name: '女上司' },
  { type_id: '/category/foot-fetish', type_name: '恋足' },
  { type_id: '/category/handjob', type_name: '手淫' },
  { type_id: '/category/huge-dick-large-dick', type_name: '巨根' },
  { type_id: '/category/huge-tits', type_name: '爆乳' },
  { type_id: '/category/idol--celebrity', type_name: '偶像明星' },
  { type_id: '/category/incest', type_name: '乱伦' },
  { type_id: '/category/jav-uncensored', type_name: '无修正' },
  { type_id: '/category/lesbian', type_name: '女同' },
  { type_id: '/category/lingerie', type_name: '内衣' },
  { type_id: '/category/massage', type_name: '按摩' },
  { type_id: '/category/mature-woman', type_name: '成熟女性' },
  { type_id: '/category/milf', type_name: '熟妇' },
  { type_id: '/category/nice-tits', type_name: '美乳' },
  { type_id: '/category/office-lady', type_name: 'OL' },
  { type_id: '/category/orgy', type_name: '群交' },
  { type_id: '/category/outdoor', type_name: '野外' },
  { type_id: '/category/prostitutes', type_name: '妓女' },
  { type_id: '/category/rape', type_name: '强奸' },
  { type_id: '/category/school-girls', type_name: '校园女生' },
  { type_id: '/category/sex-toys', type_name: '情趣用品' },
  { type_id: '/category/shame', type_name: '羞耻' },
  { type_id: '/category/shemale', type_name: '人妖' },
  { type_id: '/category/slender', type_name: '苗条' },
  { type_id: '/category/squirting', type_name: '潮吹' },
  { type_id: '/category/stepfamily', type_name: '继亲' },
  { type_id: '/category/stepmom', type_name: '继母' },
  { type_id: '/category/tall-girl', type_name: '高个女孩' },
  { type_id: '/category/threesome--foursome', type_name: '3P4P' },
  { type_id: '/category/various-worker', type_name: '各行各业' },
  { type_id: '/category/voyeur', type_name: '偷窥' },
  { type_id: '/category/urination', type_name: '排尿' },
  { type_id: '/category/abuse', type_name: '虐待' },
  { type_id: '/category/reducing-mosaic', type_name: '薄码' },
  { type_id: '/category/masturbation', type_name: '自慰' },
  { type_id: '/category/cuckold', type_name: '绿帽' },
  { type_id: '/category/slut', type_name: '痴女' },
  { type_id: '/category/english-subtitle', type_name: '英文字幕' },
];

// 干净分页（无 hash）：/new-releases、/search/<kw>
const CLEAN_PATHS = new Set(['/new-releases']);
function isCleanPath(path) {
  if (CLEAN_PATHS.has(path)) return true;
  if (path.indexOf('/search/') === 0) return true;
  return false;
}

const PGBASE = {}; // path -> hash 分页前缀（...-hash/pg-）
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function extractPgBase(html, path) {
  const re1 = new RegExp('href="(https://javplayer\\.org' + escRe(path) + '-[A-Za-z0-9]+)/pg-2"');
  const m1 = html.match(re1);
  if (m1) return m1[1] + '/pg-';
  const re2 = new RegExp('action="(' + escRe(path) + '-[A-Za-z0-9]+)/"');
  const m2 = html.match(re2);
  if (m2) return HOST + m2[1] + '/pg-';
  return '';
}

async function fetchList(path, page) {
  if (isCleanPath(path)) {
    const url = HOST + path + (page > 1 ? '/pg-' + page : '');
    const html = await getText(url, HOST + '/');
    const list = parseCards(html);
    return { list, more: list.length >= 24 };
  }
  let base = PGBASE[path];
  if (page === 1 || !base) {
    const html = await getText(HOST + path, HOST + '/');
    const list = parseCards(html);
    const nb = extractPgBase(html, path);
    if (nb) PGBASE[path] = nb;
    if (page === 1) return { list, more: list.length >= 24 };
    if (!nb) return { list: [], more: false };
    base = nb;
  }
  // 注意：extractPgBase 返回的前缀本身已以 '/pg-' 结尾，这里只补页码，
  // 绝不能再拼一次 'pg-'（否则会拼成 .../pg-pg-2，实测踩过的坑）。
  let html = await getText(base + page, HOST + '/');
  let list = parseCards(html);
  if (!list.length) {
    // hash 可能已轮换：刷新一次页 1 再重试
    const html1 = await getText(HOST + path, HOST + '/');
    const nb = extractPgBase(html1, path);
    if (nb && nb !== base) {
      PGBASE[path] = nb;
      html = await getText(nb + page, HOST + '/');
      list = parseCards(html);
    }
  }
  return { list, more: list.length >= 24 };
}

// ---------- 关键词分类（站方无原生对应时用标题+番号文本匹配；仿 py_one kw_* 机理） ----------
// 底源为 /new-releases（干净分页），逐页顺序扫、上限 8 页（防无底洞）；
// 三个关键词分类共用底页缓存；匹配只用列表卡片自带的标题+番号（卡片不带标签，
// 逐卡抓详情太贵，故不含标签——见报告）。
const KW = [
  { id: 'kw_wuma', re: /流出|泄露|leaked/i },
  { id: 'kw_zhifu', re: /制服|セーラー|女子校生|女子○生|女教師|ブレザー|学園/ },
];
const KWALL = {};
const NEWREL = {}; // 底页 -> 卡片
async function kwItems(kw, page, size) {
  let st = KWALL[kw.id];
  if (!st) { st = { items: [], seen: {}, page: 0, done: false }; KWALL[kw.id] = st; }
  const need = page * size;
  while (st.items.length < need && !st.done) {
    const bp = st.page + 1;
    if (bp > 8) { st.done = true; break; }
    let cards = NEWREL[bp];
    if (!cards) {
      const html = await getText(HOST + '/new-releases' + (bp > 1 ? '/pg-' + bp : ''), HOST + '/');
      cards = parseCards(html);
      NEWREL[bp] = cards;
    }
    st.page = bp;
    if (!cards.length) { st.done = true; break; }
    for (const it of cards) {
      if (st.seen[it.vod_id]) continue;
      const txt = (it.vod_name || '') + ' ' + (it.vod_remarks || '');
      if (!kw.re.test(txt)) continue;
      st.seen[it.vod_id] = 1;
      st.items.push(it);
    }
    if (cards.length < 24) st.done = true;
  }
  const from = (page - 1) * size;
  return { list: st.items.slice(from, from + size), more: !st.done || st.items.length > page * size };
}

let WARMED = false;
async function warmSession() {
  if (WARMED) return;
  WARMED = true;
  await getText(HOST + '/', HOST + '/');
}

async function init() { return {}; }

async function home() {
  await warmSession();
  const html = await getText(HOST + '/new-releases', HOST + '/');
  return { class: CATS, filters: {}, list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(Array.isArray(body.id) ? body.id[0] : body.id || body.tid || '/new-releases');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let r = { list: [], more: false };
  try {
    await warmSession();
    if (tid.indexOf('kw_') === 0) {
      const kw = KW.find((k) => k.id === tid);
      if (kw) r = await kwItems(kw, page, 24);
    } else {
      const path = tid.replace(/^\/+/, '');
      r = await fetchList('/' + path, page);
    }
  } catch (e) { r = { list: [], more: false }; }
  return { page, pagecount: r.more ? page + 1 : page, list: r.list };
}

function slugify(wd) {
  return String(wd || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const slug = slugify(wd);
  if (!slug) return { page, pagecount: page, list: [] };
  try {
    await warmSession();
    const r = await fetchList('/search/' + slug, page);
    return { page, pagecount: r.more ? page + 1 : page, list: r.list };
  } catch (e) {
    return { page, pagecount: page, list: [] };
  }
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const ids = Array.isArray(body.id) ? body.id : [body.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    let durl = String(raw).trim();
    if (!/^https?:\/\//i.test(durl)) durl = HOST + (durl.startsWith('/') ? durl : '/' + durl);
    await warmSession();
    const html = await getText(durl, HOST + '/');
    if (!html) continue;
    // 标题：og:title 优先，其次 section__title h1，再次任意 h1，跳过错误页标题
    // （jina 加工页会混入假 403 标题；真实页同样跳过错误标题是安全的）
    const cands = [];
    const ogt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogt) cands.push(ogt[1]);
    const sht = html.match(/<h1[^>]*class="[^"]*section__title[^"]*"[^>]*>([\s\S]{0,400}?)<\/h1>/i);
    if (sht) cands.push(sht[1]);
    const h1t = html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i);
    if (h1t) cands.push(h1t[1]);
    let title = 'JavPlayer';
    for (const c of cands) {
      const t = stripTags(c);
      if (t && !/^(403|404|500|Forbidden|Not Found)/i.test(t)) { title = t; break; }
    }
    let pic = '';
    const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogm) pic = ogm[1];
    if (!pic) {
      const cim = html.match(/<img[^>]*class="cover"[^>]*src="([^"]+)"/i);
      if (cim) pic = cim[1];
    }
    if (!pic) {
      const im = html.match(/https:\/\/cdn001\.imggle\.net\/[^"' \s<>]+/i);
      if (im) pic = im[0];
    }
    const filmM = html.match(/filmId\s*=\s*["']?(\d+)/i) || html.match(/data-source="(\d+)"/i);
    const filmId = filmM ? filmM[1] : '';
    const ptM = html.match(/window\.__pt\s*=\s*"([^"]+)"/i);
    const pkM = html.match(/window\.__pk\s*=\s*"([^"]+)"/i);
    const pt = ptM ? ptM[1] : '';
    const pk = pkM ? pkM[1] : '';
    const lines = [];
    const btnRe = /<button[^>]*class="[^"]*btn-player[^"]*"[^>]*>([\s\S]{0,80}?)<\/button>/gi;
    let bm;
    while ((bm = btnRe.exec(html)) !== null) {
      const tag = bm[0];
      if (/btn-player-vip/i.test(tag)) continue; // VIP 绝不碰
      const dm = tag.match(/data-id="(\d+)"/i);
      const sm = tag.match(/data-source="(\d+)"/i);
      const name = stripTags(bm[1]) || '播放';
      const episode = dm ? dm[1] : '';
      const fsrc = sm ? sm[1] : filmId;
      if (!episode || !fsrc) continue;
      lines.push(name + '$' + fsrc + '|' + episode + '|' + pt + '|' + pk + '|' + durl);
    }
    if (!lines.length) lines.push('网页播放$' + durl);
    // 元数据进简介
    const meta = [];
    const rt = html.match(/<span>Running time:<\/span>\s*([^<]*)/i);
    if (rt) meta.push('时长：' + stripTags(rt[1]));
    const rd = html.match(/<span>Release Date:<\/span>\s*([^<]*)/i);
    if (rd) meta.push('发行：' + stripTags(rd[1]));
    const st = html.match(/<span>Studio:<\/span>([\s\S]{0,300}?)<\/li>/i);
    if (st) meta.push('片商：' + stripTags(st[1]));
    const cats = [...html.matchAll(/<a[^>]*href="https:\/\/javplayer\.org\/category\/[^"]+"[^>]*>([^<]+)<\/a>/gi)].map(x => stripTags(x[1]));
    if (cats.length) meta.push('分类：' + cats.join('、'));
    const desc = html.match(/<div class="card__description">([\s\S]{0,2000}?)<\/div>/i);
    const content = (meta.join('\n') + (desc ? '\n' + stripTags(desc[1]) : '')).trim();
    list.push({
      vod_id: durl,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: meta.slice(0, 2).join(' · '),
      vod_content: content,
      vod_play_from: NAME,
      vod_play_url: lines.join('#'),
    });
    // 字幕预热：按每条播放 token 登记片名；后台逐条串行（不 await、不并行——
    // 并行预热曾把 SubtitleCat 挤挂，见 ONE 实测教训）
    const toks = lines.map((l) => l.split('$').slice(1).join('$')).filter((t) => t.indexOf('|') >= 0);
    for (const t of toks) subCacheName(t, title);
    (async () => {
      for (const t of toks) {
        try { await subSearchAll(t); } catch (e) {}
      }
    })().catch(() => {});
  }
  return { list };
}

async function ajaxPlayer(filmId, episode, pt, durl) {
  let ajaxUrl = '';
  try { ajaxUrl = new URL(durl).origin + '/ajax/player'; } catch { return null; }
  const body = 'episode=' + encodeURIComponent(episode) + '&filmId=' + encodeURIComponent(filmId) + '&pt=' + encodeURIComponent(pt);
  try {
    const { data, status } = await req.post(ajaxUrl, body, {
      headers: {
        'User-Agent': UA,
        'Referer': durl,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 15000,
    });
    if (status === 200 && data != null) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch (e) {}
  return null;
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.indexOf('$') >= 0) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id) || /\.mp4(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  // 服务器线：filmId|episode|pt|pk|durl
  const parts = id.split('|');
  if (parts.length < 5) {
    return { parse: 1, url: /^https?:\/\//i.test(id) ? id : HOST + '/', header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  const filmId = parts[0], episode = parts[1];
  let pt = parts[2];
  const pk = parts[3];
  const durl = parts.slice(4).join('|');
  // 字幕与 ajax 并行发起（不串行叠加延迟）
  const subsP = subSearchAll(id).catch(() => []);
  let json = await ajaxPlayer(filmId, episode, pt, durl);
  if (!json || json.error) {
    // pt 可能已轮换过期：重抓详情取新 pt/pk 与同服务器 episode，重试一次
    try {
      const html = await getText(durl, HOST + '/');
      const ptM = html.match(/window\.__pt\s*=\s*"([^"]+)"/i);
      const pkM = html.match(/window\.__pk\s*=\s*"([^"]+)"/i);
      const btnRe = /<button[^>]*class="[^"]*btn-player[^"]*"[^>]*>([\s\S]{0,80}?)<\/button>/gi;
      let bm, newEp = '', newFilm = '';
      while ((bm = btnRe.exec(html)) !== null) {
        if (/btn-player-vip/i.test(bm[0])) continue;
        const dm = bm[0].match(/data-id="(\d+)"/i);
        const sm = bm[0].match(/data-source="(\d+)"/i);
        if (dm && dm[1] === episode) { newEp = dm[1]; newFilm = sm ? sm[1] : filmId; break; }
      }
      if (ptM && newEp) {
        pt = ptM[1];
        json = await ajaxPlayer(newFilm, newEp, pt, durl);
        if (json && !json.error && pkM) {
          // 用新 pk 解密（见下）
          json.__freshPk = pkM[1];
        }
      }
    } catch (e) {}
  }
  if (!json || json.error) return { parse: 0, url: '' };
  let playerHtml = '';
  const usePk = (json.__freshPk || pk || '');
  if (json.player_enc) playerHtml = xorDecrypt(json.player_enc, usePk);
  else if (json.player) playerHtml = String(json.player);
  if (!playerHtml) return { parse: 0, url: '' };
  const em = playerHtml.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/i)
    || playerHtml.match(/<iframe[^>]+src="(\/\/[^"]+)"/i);
  const subs = await subsP;
  if (em) {
    let embed = em[1];
    if (embed.startsWith('//')) embed = 'https:' + embed;
    const result = { parse: 0, url: workerUrl(embed, durl), header: { 'User-Agent': UA, 'Referer': durl } };
    if (subs && subs.length) result.subs = subs;
    return result;
  }
  const mm = playerHtml.match(/https?:\/\/[^"' \s<>]+\.(?:m3u8|mp4)(?:\?[^"' \s<>]*)?/i);
  if (mm) {
    const result = { parse: 0, url: mm[0], header: { 'User-Agent': UA, 'Referer': durl } };
    if (subs && subs.length) result.subs = subs;
    return result;
  }
  return { parse: 0, url: '' };
}

// ---------- 字幕聚合（与猫源 27 源同款芯；番号只从片名取，不从播放地址取） ----------
// 三槽：迅雷（键序 [番号， 紧凑番号]）> 迅雷看看（完整键序）> SubtitleCat；
// 两迅雷槽同走同一 oracle 接口、合并按 URL 去重、同条归高档位；合并序 =
// 档位 -> 语言（简中>繁中>双语>英文>日文>其他）-> 分数；全局上限 10、
// 单槽软上限 8。严过滤（条目须含番号或片名全文，无回退，宁缺毋滥）；
// 全程 req 主栈、逐请求超时 3s、总预算 6s、失败全静默、无命中不带 subs 键。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();
const subResultCache = new Map();
function subCacheName(key, name) {
  if (!key || !name) return;
  subNameCache.set(key, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}
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
function subCtx(key) {
  const title = (subNameCache.get(key) || '').trim();
  const code = subExtractCode(title);
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
function subMatchOf(key, ctx) {
  const text = ((ctx.title || '') + ' ' + String(key || '')).trim().toLowerCase();
  const title = (ctx.title || '').toLowerCase();
  return { text, loose: text.replace(/[-_\s.]/g, ''), title, titleLoose: title.replace(/[-_\s.]/g, '') };
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
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match) });
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
const subInflight = new Map();
async function subSearchAll(key) {
  const hit = subResultCache.get(key);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(key)) return subInflight.get(key);
  const p = (async () => {
    const ctx = subCtx(key);
    let subs = [];
    if (ctx.code || ctx.title) {
      const match = subMatchOf(key, ctx);
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
        subResultCache.set(key, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(key, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(key, p);
  try { return await p; } finally { subInflight.delete(key); }
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
