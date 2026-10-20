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

  return {
    list: [{
      vod_id: id,
      vod_name: name || id,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_actor: actor,
      vod_class: vodClass,
      vod_content: content || name,
      vod_play_from: fromArr.join('$$$'),
      vod_play_url: urlArr.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const purl = fixUrl(id);
  const html = await getHtml(purl, 12000);
  if (!html) return { parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  const dm = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/) || html.match(/var\s+player_aaaa\s*=\s*(\{[^{}]*\})/);
  if (!dm) return { parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  let pd = null;
  try { pd = JSON.parse(dm[1]); } catch (e) { /* fallthrough */ }
  if (!pd || !pd.url) return { parse: 1, jx: 0, url: purl, header: { 'User-Agent': UA, 'Referer': REFERER } };
  let raw = String(pd.url);
  const enc = parseInt(pd.encrypt, 10) || 0;
  try {
    if (enc === 1) raw = unescape(raw);
    else if (enc === 2) raw = unescape(Buffer.from(raw, 'base64').toString('utf8'));
  } catch (e) { /* 用原始 url */ }
  return { parse: 0, url: fixUrl(raw), header: { 'User-Agent': UA, 'Referer': purl } };
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
