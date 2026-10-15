// 吉利猫 - CatPawOpen JS Spider (全新重写)
// 站点: https://jlm100.cc (原 jlm7.cc 已迁走)
// 结构: 苹果CMS, /index.php/vod/type/id/{id}/page/{pg}.html
// 注意: 本站屏蔽 axios, 使用 Node 原生 fetch

const KEY = 'py_jilimao';
const NAME = '吉利猫';
const HOST = 'https://jlm100.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 备用分类 (站点 /index.php/label/sort.html 动态抓取失败时用)
const FALLBACK_CATS = [
  { type_id: '46', type_name: '日韩自拍' },
  { type_id: '43', type_name: '色情主播' },
  { type_id: '44', type_name: '国产av' },
  { type_id: '59', type_name: '乱伦侵犯' },
  { type_id: '47', type_name: '日本无码' },
  { type_id: '50', type_name: '无码字幕' },
  { type_id: '49', type_name: '色情动漫' },
  { type_id: '48', type_name: '有码字幕' },
  { type_id: '51', type_name: '欧美av' },
  { type_id: '52', type_name: '18禁重口味' },
  { type_id: '53', type_name: '偷拍偷窥' },
  { type_id: '54', type_name: '网爆吃瓜' },
  { type_id: '55', type_name: '传媒a片' },
  { type_id: '56', type_name: '探花约炮' },
  { type_id: '57', type_name: '三级伦理' },
  { type_id: '58', type_name: 'av解说' },
];

function unesc(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

async function getText(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': HOST + '/',
        },
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.length > 1000) return t;
    } catch { /* retry */ }
  }
  return '';
}

function parseList(html) {
  const results = [];
  if (!html) return results;
  const blocks = html.match(/<li>\s*<div class="video-item">([\s\S]*?)<\/li>/g) || [];
  const seen = new Set();
  for (const b of blocks) {
    const m = b.match(/href="[^"]*?\/vod\/play\/id\/(\d+)\.html"/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const img = b.match(/<img[^>]*data-src="([^"]+)"[^>]*alt="([^"]*)"/);
    let title = img ? unesc(img[2]) : '';
    if (!title) {
      const t = b.match(/class="line-clamp-[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/);
      title = t ? unesc(t[1]) : '';
    }
    if (!title) continue;
    let pic = img ? absUrl(img[1]) : '';
    if (!pic) {
      const p2 = b.match(/og:image" content="([^"]+)"/);
      pic = p2 ? absUrl(p2[1]) : '';
    }
    const rem = b.match(/rounded-large text-white">([^<]+)<\/div>/);
    results.push({
      vod_id: m[1],
      vod_name: title.slice(0, 120),
      vod_pic: pic,
      vod_remarks: rem ? rem[1].trim() : '',
    });
  }
  return results;
}

async function getCategories() {
  const html = await getText(HOST + '/index.php/label/sort.html');
  const cats = [];
  if (html) {
    const parts = html.split(/<h2[^>]*>([^<]+)<\/h2>/);
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i].trim() !== '视频类别') continue;
      const subs = parts[i + 1].matchAll(/href="\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)</g);
      for (const s of subs) {
        cats.push({ type_id: s[1], type_name: unesc(s[2]) });
      }
      break;
    }
  }
  return cats.length >= 5 ? cats : FALLBACK_CATS;
}

async function init() { return {}; }

async function home() {
  const cats = await getCategories();
  return {
    class: cats.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    filters: {},
    list: [],
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || '46');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await getText(`${HOST}/index.php/vod/type/id/${tid}/page/${page}.html`);
  const list = parseList(html);
  let pagecount = page;
  if (html && /title="下一页"/.test(html)) pagecount = page + 1;
  return { page, pagecount, limit: 20, total: list.length, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    let vid = String(raw).trim();
    const vm = vid.match(/\/vod\/(?:play|detail)\/id\/(\d+)\.html/);
    if (vm) vid = vm[1];
    else { const dm = vid.match(/(\d+)/); vid = dm ? dm[1] : vid; }
    const html = await getText(`${HOST}/index.php/vod/play/id/${vid}.html`);
    if (!html) continue;

    let name = '';
    let m = html.match(/<h1 class="dx-title[^"]*"[^>]*>([^<]+)<\/h1>/);
    if (m) name = unesc(m[1]);
    if (!name) {
      m = html.match(/og:title" content="([^"]*)"/);
      if (m) name = unesc(m[1].split(' - ')[0]);
    }
    let pic = '';
    m = html.match(/og:image" content="([^"]+)"/);
    if (m) pic = absUrl(m[1]);

    // 播放页地址, play 阶段再解析出 m3u8
    const playPage = `${HOST}/index.php/vod/play/id/${vid}.html`;
    list.push({
      vod_id: vid,
      vod_name: name || `视频${vid}`,
      vod_pic: pic,
      vod_play_from: NAME,
      vod_play_url: `播放$${playPage}`,
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  let url = /^https?:\/\//i.test(id) ? id : absUrl(id);
  if (/\.m3u8|\.mp4/i.test(url)) {
    return { parse: 0, url, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  // 播放页里找 const source / m3u8
  const html = await getText(url);
  if (html) {
    let m = html.match(/const\s+source\s*=\s*['"]([^'"]+)['"]/);
    if (m) {
      const u = absUrl(m[1]);
      return { parse: 0, url: u, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
    }
    m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/);
    if (m) {
      return { parse: 0, url: m[1], header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
    }
    m = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/);
    if (m) {
      return { parse: 0, url: m[1], header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
    }
  }
  return { parse: 1, url, header: { 'User-Agent': UA } };
}

async function search() {
  return { page: 1, pagecount: 0, limit: 20, total: 0, list: [] };
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
