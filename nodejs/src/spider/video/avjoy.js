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

  return {
    list: [{
      vod_id: id,
      vod_name: name,
      vod_pic: pic,
      vod_year: year,
      vod_remarks: remarks,
      vod_tag: tags.join(','),
      vod_content: desc || name,
      vod_play_from: flags.join('$$$'),
      vod_play_url: urls.join('$$$'),
    }],
  };
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
  // token 每次请求都会变，必须实时重新请求详情页，禁用缓存
  const html = await getHtml(SITE + '/video/' + vid);
  if (!html) return { parse: 0, url: '' };
  const sources = parseSources(html);
  if (!sources.length) return { parse: 0, url: '' };
  // 优先 H264 (parseSources 已按 H264 优先排序)
  const best = sources[0];
  return {
    parse: 0,
    url: best.url,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
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
