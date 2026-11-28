// POPJAV — https://popjav.in/
// WordPress 站：详情页内联 Dean Edwards packer 解出嵌页
// （vsembed / minochinos / streamtape），蜘蛛在详情时把嵌页解析成真地址。
// 2026-11-28 VM 实测：首页 200；详情 cawb075 解包出
// vsembed.com/rc7iw、minochinos.com/v/70xwh0lvdnof、streamtape.com/e/0Wk3Y9jwK4UDxP；
// minochinos 嵌页 301 跳 callistanise.com（VidHide 系域名轮换），解包出
// hls2（带 asn 令牌）/ hls3（无令牌）；vsembed 是 SPA（JS bundle 动态取流），
// 静态解析不到，跳过。
// 720p 实测结论（2026-11-28，三部片）：hls2 master.m3u8 只含一个档位
// 1920x1080（cawb075、fc2ppv-5014920 均 200 取回、单条 STREAM-INF；
// adn808 一次 502 一次超时，属 CDN 抖动），站方嵌页里根本没有 720p，
// 蜘蛛按 master 有几档出几档，不编造 720p。
// streamtape 线（2026-11-28 用户令回到修前，加回来）：三部抽查片的 /v/ 页
// 曾 404，但用户实测修前能播，以用户真机为准。嵌页含 get_video 直链 mp4。
// 分类：censored / uncensored / amature / fc2ppv / vr / popularity / trend
// + studios（制作商筛选卡片，12 家实测均 200 且 36 卡）+ tags 标签（筛选卡片，
// 含 モザイク除去/無修正流出/javplayer-モザイク破壊 三个 LTX 相关标签）；
// models / series 是几千条的字母索引页、不是视频列表，不做分类；
// playlist 是用户自建收藏页，无公共片单，不做分类。
// popularity / trend 是固定 TOP100 榜单：/page/2/、/page/50/、/page/99999/
// 回的都是同一 100 条（p1 与 p50 交集 100/100），无分页链接，
// pagecount=1 是对的，不要“修”成大页数。
// 搜索 /?s=。封面 pics.dmm.co.jp 直链。
// 播放：详情时解析嵌页出真地址（minochinos 按 master 档位出 m3u8）；
// 有几档出几档，解析失败的线路直接省略、不留空集。
// 字幕：片名含番号（cawb075/adn808 等）才接字幕芯，无番号不接。
import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const KEY = 'py_popjav';
const NAME = 'POPJAV';
const HOST = 'https://popjav.in';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 顶级分类：四个主分区 + VR + 人气/趋势 + 制作商 + 标签
// （制作商、标签走筛选卡片，不平铺；vr/popularity/trend 均实测为视频列表页）
const CLASSES = [
  { type_id: 'censored', type_name: '有碼' },
  { type_id: 'uncensored', type_name: '無碼' },
  { type_id: 'amature', type_name: '素人' },
  { type_id: 'fc2ppv', type_name: 'FC2' },
  { type_id: 'vr', type_name: 'VR' },
  { type_id: 'popularity', type_name: '人气' },
  { type_id: 'trend', type_name: '趋势' },
  { type_id: 'studios', type_name: '制作商' },
  { type_id: 'tags', type_name: '标签' },
];

// 标签筛选卡片（/tags/ 页按热度排序取前 30 + LTX 标签；v 为相对路径）
const TAG_FILTER = [
  { n: '单体作品', v: 'tags/%e5%8d%98%e4%bd%93%e4%bd%9c%e5%93%81' },
  { n: '中出', v: 'tags/%e4%b8%ad%e5%87%ba%e3%81%97' },
  { n: '去码', v: 'tags/%e3%83%a2%e3%82%b6%e3%82%a4%e3%82%af%e9%99%a4%e5%8e%bb' },
  { n: '巨乳', v: 'tags/%e5%b7%a8%e4%b9%b3' },
  { n: '人妻', v: 'tags/%e4%ba%ba%e5%a6%bb%e3%83%bb%e4%b8%bb%e5%a9%a6' },
  { n: '素人', v: 'tags/%e7%b4%a0%e4%ba%ba' },
  { n: '美少女', v: 'tags/%e7%be%8e%e5%b0%91%e5%a5%b3' },
  { n: '熟女', v: 'tags/%e7%86%9f%e5%a5%b3' },
  { n: '素人视频', v: 'tags/%e7%b4%a0%e4%ba%ba%e5%8b%95%e7%94%bb' },
  { n: '痴女', v: 'tags/%e7%97%b4%e5%a5%b3' },
  { n: '口交', v: 'tags/%e3%83%95%e3%82%a7%e3%83%a9' },
  { n: '苗条', v: 'tags/%e3%82%b9%e3%83%ac%e3%83%b3%e3%83%80%e3%83%bc' },
  { n: '美乳', v: 'tags/%e7%be%8e%e4%b9%b3' },
  { n: '3P/4P', v: 'tags/3p%e3%83%bb4p' },
  { n: '偷拍', v: 'tags/%e3%83%8f%e3%83%a1%e6%92%ae%e3%82%8a' },
  { n: '潮吹', v: 'tags/%e6%bd%ae%e5%90%b9%e3%81%8d' },
  { n: '数码', v: 'tags/%e3%83%87%e3%82%b8%e3%83%a2' },
  { n: 'NTR', v: 'tags/%e5%af%9d%e5%8f%96%e3%82%8a%e3%83%bb%e5%af%9d%e5%8f%96%e3%82%89%e3%82%8c%e3%83%bbntr' },
  { n: '女上位', v: 'tags/%e9%a8%8e%e4%b9%97%e4%bd%8d' },
  { n: '乳交', v: 'tags/%e3%83%91%e3%82%a4%e3%82%ba%e3%83%aa' },
  { n: '淫乱', v: 'tags/%e6%b7%ab%e4%b9%b1%e3%83%bb%e3%83%8f%e3%83%bc%e3%83%89%e7%b3%bb' },
  { n: '4小时以上', v: 'tags/4%e6%99%82%e9%96%93%e4%bb%a5%e4%b8%8a%e4%bd%9c%e5%93%81' },
  { n: '女校生', v: 'tags/%e5%a5%b3%e5%ad%90%e6%a0%a1%e7%94%9f' },
  { n: '剧情', v: 'tags/%e3%83%89%e3%83%a9%e3%83%9e' },
  { n: '破解马赛克', v: 'tags/javplayer-%e3%83%a2%e3%82%b6%e3%82%a4%e3%82%af%e7%a0%b4%e5%a3%8a' },
  { n: '颜射', v: 'tags/%e9%a1%94%e5%b0%84' },
  { n: '白虎', v: 'tags/%e3%83%91%e3%82%a4%e3%83%91%e3%83%b3' },
  { n: '妄想族', v: 'tags/%e5%a6%84%e6%83%b3%e6%97%8f' },
  { n: '巨臀', v: 'tags/%e5%b7%a8%e5%b0%bb' },
  { n: '姐姐', v: 'tags/%e3%81%8a%e5%a7%89%e3%81%95%e3%82%93' },
  { n: '无码流出', v: 'tags/%e7%84%a1%e4%bf%ae%e6%ad%a3%e6%b5%81%e5%87%ba' },
];
const TAG_DEFAULT = 'tags/%e3%83%a2%e3%82%b6%e3%82%a4%e3%82%af%e9%99%a4%e5%8e%bb';

// 制作商筛选卡片（/studios/ 索引页取的知名厂牌，2026-11-28 逐个实测：
// 子页均 200 且 36 卡，翻页 /studios/<slug>/page/2/ 同样 200；v 为相对路径）
const STUDIO_FILTER = [
  { n: 'S1', v: 'studios/s1-no-1-style' },
  { n: 'MOODYZ', v: 'studios/%e3%83%a0%e3%83%bc%e3%83%87%e3%82%a3%e3%83%bc%e3%82%ba' },
  { n: 'Madonna', v: 'studios/%e3%83%9e%e3%83%89%e3%83%b3%e3%83%8a' },
  { n: 'SOD', v: 'studios/sod%e3%82%af%e3%83%aa%e3%82%a8%e3%82%a4%e3%83%88' },
  { n: 'PRESTIGE', v: 'studios/%e3%83%97%e3%83%ac%e3%82%b9%e3%83%86%e3%83%bc%e3%82%b8' },
  { n: 'IdeaPocket', v: 'studios/%e3%82%a2%e3%82%a4%e3%83%87%e3%82%a2%e3%83%9d%e3%82%b1%e3%83%83%e3%83%88' },
  { n: 'Attackers', v: 'studios/%e3%82%a2%e3%82%bf%e3%83%83%e3%82%ab%e3%83%bc%e3%82%ba' },
  { n: 'kawaii', v: 'studios/kawaii' },
  { n: 'FALENO', v: 'studios/faleno' },
  { n: 'OPPAI', v: 'studios/oppai' },
  { n: '本中', v: 'studios/%e6%9c%ac%e4%b8%ad' },
  { n: 'Fitch', v: 'studios/fitch' },
];
const STUDIO_DEFAULT = 'studios/s1-no-1-style';

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

async function fetchHtml(url, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Referer: HOST + '/' },
      timeout: timeoutMs || 20000,
    });
    const t = typeof r.data === 'string' ? r.data : '';
    if (!t || t.length < 1000) return '';
    return t;
  } catch (e) {
    return '';
  }
}

async function fetchText(url, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, Accept: '*/*', Referer: HOST + '/' },
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return typeof r.data === 'string' ? r.data : '';
  } catch (e) {
    return '';
  }
}

// 列表解析：<a href="/<分区>/pp-<code>/"> 包着 .post-list-image，
// 封面 pics.dmm.co.jp，标题在 <span>，时长 .post-list-duration。
function parseCards(html) {
  const list = [];
  if (!html) return list;
  const $ = cheerio.load(html);
  $('a[href*="/pp-"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    if (!/\/pp-[^/]+\/?$/.test(href)) return;
    const title = cleanText($a.find('span').first().text()) || cleanText($a.find('img').attr('alt'));
    if (!title) return;
    const cover = absUrl($a.find('img').attr('src'));
    const dur = cleanText($a.find('.post-list-duration').text());
    const date = cleanText($a.find('.post-list-time').text());
    list.push({
      vod_id: absUrl(href),
      vod_name: title,
      vod_pic: cover,
      vod_remarks: [dur, date].filter(Boolean).join(' '),
    });
  });
  const seen = new Set();
  return list.filter((it) => {
    if (seen.has(it.vod_id)) return false;
    seen.add(it.vod_id);
    return true;
  });
}

function parsePagecount(html, curPage) {
  let max = curPage;
  if (html) {
    const re = /\/page\/(\d+)\/?/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// Dean Edwards packer 解包（与 missav 同款纯字符串实现）。
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

// 从详情页解出嵌页地址：解包后取全部 iframe src（e1s1/e1s2/e1s3）。
function extractEmbeds(html) {
  const out = [];
  if (!html) return out;
  const up = unpackPacked(html);
  const src = up || html;
  const seen = new Set();
  for (const m of src.matchAll(/<iframe[^>]+src="(https?:\/\/[^"]+)"/g)) {
    const u = m[1];
    if (/whitetrafsa|ad-nex|googletagmanager/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// streamtape 嵌页 -> 直链 mp4：嵌页含 get_video?id=&expires=&ip=&token=<redacted>
// （2026-11-28 用户令线路回到修前：修后只剩 minochinos、好多播不了，
// 修前 streamtape + minochinos 1080p 都能播，故把 streamtape 线加回来。
// 注：三部抽查片的 /v/ 页曾 404，但用户实测修前能播，以用户真机为准。）
async function resolveStreamtape(embedUrl) {
  const html = await fetchHtml(embedUrl, 12000);
  if (!html) return '';
  const m = html.match(/get_video\?id=[^"'&\s]+&expires=\d+&ip=[^"'&\s]+&token=[^"'&\s]+/);
  if (!m) return '';
  return 'https://streamtape.com/' + m[0];
}

// minochinos（VidHide 系）嵌页 -> m3u8：解包取 links.hls2（真 m3u8，
// asn 令牌绑取页 IP——蜘蛛在设备上取页，与播放器同 IP）优先，hls3 兜底。
async function resolveMinochinos(embedUrl) {
  const html = await fetchHtml(embedUrl, 12000);
  if (!html) return '';
  const up = unpackPacked(html) || html;
  const hls2 = (up.match(/"hls2"\s*:\s*"([^"]+)"/) || [])[1] || '';
  const hls3 = (up.match(/"hls3"\s*:\s*"([^"]+)"/) || [])[1] || '';
  return hls2 || hls3 || '';
}

// master.m3u8 解析档位（与 podjav 同款）。
function parseMasterVariants(masterText, masterUrl) {
  const out = [];
  if (!masterText || !masterText.includes('#EXTM3U')) return out;
  const lines = masterText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const resM = line.match(/RESOLUTION=(\d+)x(\d+)/);
    const res = resM ? resM[2] + 'p' : '';
    let uri = '';
    for (let j = i + 1; j < lines.length; j++) {
      const u = lines[j].trim();
      if (!u) continue;
      if (u.startsWith('#')) continue;
      uri = u;
      break;
    }
    if (!uri) continue;
    let abs = uri;
    try { abs = new URL(uri, masterUrl).href; } catch (e) { /* 保持原样 */ }
    if (res && !out.some((o) => o.res === res)) out.push({ res, url: abs });
  }
  const order = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4 };
  out.sort((a, b) => (order[a.res] ?? 9) - (order[b.res] ?? 9));
  return out;
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
}

// 把一个嵌页解析成真地址（返回 {label, urls[]}，urls 为可播地址；
// 解析失败返回空数组，该线路直接省略）。
async function resolveEmbed(embedUrl) {
  const host = hostOf(embedUrl);
  // streamtape 线（用户令回到修前，加回来）。
  if (/streamtape\.com/i.test(host)) {
    const u = await resolveStreamtape(embedUrl);
    return u ? [{ label: 'Streamtape', url: u }] : [];
  }
  if (/minochinos\.com/i.test(host)) {
    const u = await resolveMinochinos(embedUrl);
    if (!u) return [];
    // hls2 是 master：取一次播单按档位出；取不到则直接回 m3u8 本身。
    if (/\.m3u8/i.test(u)) {
      const text = await fetchText(u, 10000);
      const variants = parseMasterVariants(text, u);
      if (variants.length) {
        return variants.map((v) => ({ label: 'Minochinos ' + v.res.replace('p', 'P'), url: v.url }));
      }
    }
    return [{ label: 'Minochinos', url: u }];
  }
  // vsembed 是 SPA，静态解析不到真地址，跳过。
  return [];
}

async function init() {
  return {};
}

async function home() {
  return {
    class: CLASSES,
    filters: {
      studios: [{ key: 'studio', name: '制作商', value: STUDIO_FILTER }],
      tags: [{ key: 'tag', name: '标签', value: TAG_FILTER }],
    },
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let tid = String(body.id || 'censored').trim();
  const extend = body.filters || body.extend || {};
  // 标签维：选中卡片取卡片地址，未选默认 TAG_DEFAULT。
  if (tid === 'tags') {
    const tag = String(extend.tag || '');
    tid = (tag && tag.startsWith('tags/')) ? tag : TAG_DEFAULT;
  }
  // 制作商维：选中卡片取卡片地址，未选默认 STUDIO_DEFAULT。
  if (tid === 'studios') {
    const st = String(extend.studio || '');
    tid = (st && st.startsWith('studios/')) ? st : STUDIO_DEFAULT;
  }
  const path = '/' + tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = page > 1 ? HOST + path + '/page/' + page + '/' : HOST + path + '/';
  const html = await fetchHtml(url);
  const list = parseCards(html);
  const pagecount = list.length ? parsePagecount(html, page) : page;
  return { page, pagecount, limit: list.length || 36, total: pagecount * 36, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '').trim();
  if (!id) return { list: [] };
  const detailUrl = absUrl(id);
  const html = await fetchHtml(detailUrl);
  if (!html) return { list: [] };
  const $ = cheerio.load(html);
  const name = cleanText($('h1').first().text()) || cleanText($('title').text());
  const cover = absUrl($('meta[property="og:image"]').attr('content'));
  const content = cleanText($('#post-content').text());
  // 播放：解出嵌页，逐个解析成真地址；解析失败的线路直接省略。
  const embeds = extractEmbeds(html);
  const eps = [];
  for (const em of embeds) {
    try {
      const resolved = await resolveEmbed(em);
      for (const r of resolved) {
        if (r.url) eps.push(r.label + '$' + detailUrl + '@@' + r.url);
      }
    } catch (e) { /* 该线路跳过 */ }
  }
  const vod = {
    vod_id: detailUrl,
    vod_name: name || detailUrl,
    vod_pic: cover,
    vod_content: content,
    vod_play_from: NAME,
    vod_play_url: eps.join('#'),
  };
  // 字幕：只有片名含可抽番号才预热（无番号不接）。
  const subUrls = eps.map((e) => e.split('@@').pop()).filter(Boolean);
  for (const u of subUrls) subCacheName(u, name);
  if (subUrls.length && subExtractCode(name)) {
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
  const regTitle = subNameCache.get(url) || '';
  const subs = subExtractCode(regTitle) ? await subSearchAll(url).catch(() => []) : [];
  const result = {
    parse: 0,
    url,
    header: { 'User-Agent': UA, Referer: durl || HOST + '/', Origin: HOST },
  };
  if (subs && subs.length) result.subs = subs;
  return result;
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 36, total: 0, list: [] };
  // 搜索走 /search/<词>（VM 实测：/?s= 会撞 Cloudflare 403，/search/ 回 200 且同卡片结构）
  const url = page > 1
    ? HOST + '/search/' + encodeURIComponent(wd) + '/page/' + page
    : HOST + '/search/' + encodeURIComponent(wd);
  const html = await fetchHtml(url);
  const list = parseCards(html);
  const pagecount = list.length ? parsePagecount(html, page) : page;
  return { page, pagecount, limit: list.length || 36, total: pagecount * 36, list };
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
  // 尾码优先 (2026-11-07)：SubtitleCat 文件形如 "<标题>-<语码>.srt"，尾码才是文件实际语言；标题里的"简体中文"是原字幕名，不能覆盖尾码。
  const tail = String(name || '').match(/[-_.]([a-z]{2,3})\.(?:srt|vtt|ass|ssa)$/i);
  if (tail) {
    const c = tail[1].toLowerCase();
    if (c === 'zh' || c === 'chs' || c === 'cn' || c === 'hans') return { tag: '简中', rank: 0 };
    if (c === 'cht' || c === 'tw' || c === 'hant') return { tag: '繁中', rank: 1 };
    if (c === 'en' || c === 'eng') return { tag: '英文', rank: 3 };
    if (c === 'ja' || c === 'jpn' || c === 'jp') return { tag: '日文', rank: 4 };
    if (/^(fr|fre|de|ger|es|spa|it|ita|pt|por|ru|rus|nl|dut|sv|swe|da|dan|fi|fin|no|nor|pl|pol|cs|cze|sk|slo|hu|hun|ro|rum|bg|bul|uk|ukr|el|gre|tr|tur|ar|ara|he|heb|hi|hin|id|ind|ms|may|vi|vie|th|tha|km|khm|ko|kor|ak|af|afr|sq|alb|eu|baq|ca|cat|gl|glg|cy|wel|ga|gle|gd|gla|br|bre|co|cos|eo|epo|et|est|lv|lav|lt|lit|mt|mlt|sl|slv|mk|mac|sr|srp|hr|hrv|bs|bos|am|amh|so|som|sw|swa|yo|yor|ig|ibo|ha|hau|zu|zul|xh|xho|st|sot|sn|sna|ka|geo|hy|arm|az|aze|kk|kaz|uz|uzb|mn|mon|ky|kir|tg|tgk|tk|tuk|ti|tir|fa|per|ur|urd|bn|ben|ta|tam|te|tel|ml|mal|mr|mar|pa|pan|gu|guj|kn|kan|as|asm|or|ori|sa|san|ne|nep|si|sin|my|bur|lo|lao)$/.test(c)) return { tag: '', rank: 5 };
  }
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
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match), dur: it.norm.duration });
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
// 时长后缀（2026-11-02）：oracle 给毫秒（>100000 视为毫秒除 1000），
// 秒级原值直接用；无时长不显示、不编造。
// 去重键用秒（2026-11-02 名字+时长口径）：毫秒值 >100000 除 1000；
// 无时长记 nodur（沿用名字去重）；同名同时长才算重复。
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
