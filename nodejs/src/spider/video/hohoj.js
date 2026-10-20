import req from '../../util/req.js';

// HoHoJ (py_hohoj) — 暂名，取站方品牌 HoHoJ（好好J）
// 站点: https://hohoj.tv (自建站，非 MacCMS)，姊妹 CDN 为 ggjav.com。
// 2026-10-20 实测结构:
//   列表卡片 (全站统一 24 条/页):
//     <div class="video-item ..."><a href="/video?id={id}">
//       <img src="https://cdn-1.ggjav.com/media/video/small_{文件号}.jpg">
//       <div class="video-item-title">{标题}</div>
//       <div class="video-item-rating"> 眼睛图标 <span class="me-2">{播放量}</span> ...
//     分页统一为查询参数 p={n}；总页数取页面里 changePage(N) 的最大值。
//     URL 里的 name 参数只是装饰，不带也能打开 (已实测)。
//   分类 (全部实测真实存在):
//     固定区: /search?type={all,censored,uncensored,chinese,europe}&order={latest,popular,views,likes}
//     主分类: /main_ctg?id=1..12
//     子标签: /ctg?id={tag} (从详情页收割 54 个真标签，抽验均 24 条/页)
//     女優:   /model?id={} (首页精选 12 位)
//   搜索: /search?text={关键词}&p={n}
//   详情: /video?id={} — h5 为标题，播放器区有 large_ 大封面，
//         女優 /model 链接、日期、播放量齐全；无简介文本，内容用标题代。
//   播放 (一步直取): 详情页 iframe 为 /embed?id={}，embed 页 <video src> 与
//         var videoSrc 直接写明 m3u8 (https://video-{n}.ggjav.com/video_1/{文件}.mp4/index.m3u8)。
//         play() 只请求这一个 embed 页即可拿到直链 parse:0 返回。
//         实测播放列表与分片在不带任何自定义头时均 200（分片 TS 魔数 47）；
//         个别文件名带空格（多为 FC2），返回前把空格编码为 %20。
//   VIP: 全站无登录、无付费标记，抽查有码/无码/中字幕/欧美/FC2 均匿名取流成功，无 VIP 锁定。
//   封面: cdn-1.ggjav.com 直链 (站方自有 CDN)。注: 本机 VM 出口直连该 CDN 被重置，
//         已借第三方出口验证图片真实存在并可正常下发；真机若封面不出，
//         可把 ggjav.com 加进 bagua-img-proxy Worker 白名单再改走代理。

const KEY = 'py_hohoj';
const NAME = 'HoHoJ';
const SITE = 'https://hohoj.tv';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

const SECTIONS = [
  { type_id: 's_latest', type_name: '最新', type: 'all', order: 'latest' },
  { type_id: 's_popular', type_name: '熱門', type: 'all', order: 'popular' },
  { type_id: 's_censored', type_name: '有碼', type: 'censored', order: 'latest' },
  { type_id: 's_uncensored', type_name: '無碼', type: 'uncensored', order: 'latest' },
  { type_id: 's_chinese', type_name: '中文字幕', type: 'chinese', order: 'latest' },
  { type_id: 's_europe', type_name: '歐美', type: 'europe', order: 'latest' },
];

const MAIN_CTG = [
  [1, '絲襪美腿'], [2, '強姦凌辱'], [3, '主奴調教'], [4, '制服誘惑'],
  [5, '多P群交'], [6, '角色劇情'], [7, '出軌'], [8, '亂倫'],
  [9, '巨乳美乳'], [10, '潮吹放尿'], [11, '走後門'], [12, '內射受孕'],
];

// 详情页收割的真标签 (id, 名称)，抽验 /ctg 页均有 24 条/页
const TAGS = [
  [1, 'DMM獨家'], [2, '中出'], [4, '單體作品'], [5, '戲劇'], [6, '數位馬賽克'],
  [8, '高畫質'], [10, '口交'], [11, '巨乳'], [13, '乳交'], [18, '人妻'],
  [19, '成熟的女人'], [21, '已婚婦女'], [26, '白人'], [28, '凌辱'], [31, '自慰'],
  [34, '苗條'], [39, 'OL'], [40, '通姦'], [46, '打手槍'], [47, '深喉'],
  [54, '婆婆'], [61, '連褲襪'], [64, '業餘'], [65, '痴女'], [69, '女教師'],
  [73, '淫語'], [75, '乳房'], [91, '按摩棒'], [93, '處女'], [100, '無毛'],
  [103, '混血'], [108, '1080p'], [111, '吞精'], [116, '角色扮演'], [119, '69'],
  [120, '舔陰'], [123, '手淫'], [126, '口內射精'], [129, '美腿'], [136, '美人'],
  [138, '60fps'], [139, 'AV女優'], [141, '美臀'], [163, '肛交'], [181, '4K'],
  [193, '野外'], [197, '按摩'], [223, '黑髮'], [224, '教師'], [249, '國外進口'],
  [270, '女職員'], [281, '無套'], [286, '束縛'], [330, '浴衣和服'],
];

// 首页精选女優 (id, 名称)
const MODELS = [
  [404, '素人'], [41, '三上悠亞'], [43, '波多野結衣'], [93, '北野未奈'],
  [990, '凪光'], [44, '篠田優'], [342, 'JULIA'], [586, '河北彩花'],
  [19, '楓可憐'], [1002, '森澤佳奈'], [63, '深田詠美'], [47, '飯岡加奈子'],
];

const CATS = [
  ...SECTIONS.map(s => ({ ...s, kind: 'search' })),
  ...MAIN_CTG.map(([id, name]) => ({ type_id: 'c_' + id, type_name: name, kind: 'main', cid: id })),
  ...TAGS.map(([id, name]) => ({ type_id: 't_' + id, type_name: name, kind: 'tag', cid: id })),
  ...MODELS.map(([id, name]) => ({ type_id: 'm_' + id, type_name: name, kind: 'model', cid: id })),
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
async function getHtml(url, timeoutMs) {
  const headers = { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  const limit = timeoutMs || 15000;
  try {
    const { data, status } = await req.get(url, { headers, timeout: limit });
    if (status === 200 && typeof data === 'string' && data) return data;
  } catch (e) { /* 换 fetch */ }
  return timedFetchText(url, headers, limit);
}

// 解析列表卡片 (列表页/搜索通用)
function parseCards(html) {
  const out = [];
  const seen = new Set();
  // 注意: 必须带尾随空格切分，video-item-title / video-item-rating 是同卡内的子 div，不能误切
  const blocks = html.split('<div class="video-item ');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const idM = b.match(/href="\/video\?id=(\d+)"/);
    if (!idM) continue;
    const id = idM[1];
    if (seen.has(id)) continue;
    seen.add(id);
    let pic = '';
    const picM = b.match(/<img[^>]+src="(https?:\/\/[^"]+\/media\/video\/[^"]+)"/);
    if (picM) pic = picM[1];
    let title = '';
    const tM = b.match(/video-item-title[^>]*>([^<]+)</);
    if (tM) title = clean(tM[1]);
    if (!title) {
      const altM = b.match(/<img[^>]+alt="([^"]*)"/);
      if (altM) title = clean(altM[1]);
    }
    let remarks = '';
    const vM = b.match(/fa-eye"[^>]*><\/i>\s*<span[^>]*>([^<]+)<\/span>/);
    if (vM) remarks = clean(vM[1]) + ' 播放';
    out.push({ vod_id: id, vod_name: title || id, vod_pic: pic, vod_remarks: remarks });
  }
  return out;
}

function parsePagecount(html) {
  let pc = 1;
  for (const m of html.matchAll(/changePage\((\d+)\)/g)) {
    const n = parseInt(m[1], 10);
    if (n > pc) pc = n;
  }
  return pc;
}

function catOf(tid) {
  return CATS.find(c => c.type_id === String(tid)) || CATS[0];
}

function catUrl(cat, page) {
  page = Math.max(1, page || 1);
  if (cat.kind === 'search') return `${SITE}/search?type=${cat.type}&order=${cat.order}&p=${page}`;
  if (cat.kind === 'main') return `${SITE}/main_ctg?id=${cat.cid}&p=${page}`;
  if (cat.kind === 'tag') return `${SITE}/ctg?id=${cat.cid}&p=${page}`;
  return `${SITE}/model?id=${cat.cid}&p=${page}`;
}

async function buildList(url, page) {
  const html = await getHtml(url);
  if (!html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = parseCards(html);
  const pc = parsePagecount(html);
  return { page, pagecount: Math.max(pc, page), limit: 24, total: list.length, list };
}

async function init() {
  return {};
}

async function home() {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(`${SITE}/search?type=all&order=latest&p=1`);
  const list = html ? parseCards(html) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 's_latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = catOf(tid);
  return buildList(catUrl(cat, page), page);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  const idm = id.match(/id=(\d+)/) || id.match(/^(\d+)$/);
  if (idm) id = idm[1];
  if (!id) return { list: [] };
  const durl = `${SITE}/video?id=${id}`;
  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const h5 = html.match(/<h5[^>]*>([^<]+)<\/h5>/);
  if (h5) name = clean(h5[1]);
  if (!name) {
    const og = html.match(/property="og:title"\s+content="([^"]+)"/);
    if (og) name = clean(og[1]);
  }
  let pic = '';
  const pm = html.match(/(https?:\/\/[^"]+\/media\/video\/large_[^"]+)/);
  if (pm) pic = pm[1];
  const actors = [...new Set([...html.matchAll(/\/model\?id=\d+&name=([^"&]+)/g)].map(x => clean(decodeURIComponent(x[1]))))];
  let date = '';
  const dm = html.match(/<span>(\d{4}-\d{2}-\d{2})<\/span>/);
  if (dm) date = dm[1];

  return {
    list: [{
      vod_id: id,
      vod_name: name || id,
      vod_pic: pic,
      vod_remarks: date,
      vod_actor: actors.join(','),
      vod_content: name,
      vod_play_from: '正片',
      vod_play_url: `正片$${id}`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (id.includes('$')) id = id.split('$').pop().trim();
  const idm = id.match(/id=(\d+)/) || id.match(/^(\d+)$/) || id.match(/(\d+)/);
  if (!idm) return { parse: 0, url: '' };
  const vid = idm[1];
  const eurl = `${SITE}/embed?id=${vid}`;
  const html = await getHtml(eurl, 10000);
  if (html) {
    const m = html.match(/videoSrc\s*=\s*"(https?:\/\/[^"]+?\.m3u8)"/) || html.match(/<video[^>]+src="(https?:\/\/[^"]+?\.m3u8)"/);
    if (m) {
      // 个别文件名带空格，编码掉再返回 (实测 %20 后播放列表/分片均 200)
      const url = m[1].replace(/ /g, '%20');
      return { parse: 0, url, header: { 'User-Agent': UA, 'Referer': eurl } };
    }
  }
  // 兜底: 嗅探 embed 页
  return { parse: 1, jx: 0, url: eurl, header: { 'User-Agent': UA, 'Referer': REFERER } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const url = `${SITE}/search?text=${encodeURIComponent(wd)}&p=${page}`;
  return buildList(url, page);
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
