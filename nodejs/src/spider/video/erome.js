// EroMe - CatPawOpen JS Spider
// 站：https://www.erome.com/，相册站，无传统分类体系，发现靠搜索与热门/最新。
// 已实测（2026-10-28 curl 直取）：
// - 列表页：/search?q={kw}，分页 /search?q={kw}&page={n}，每页 36 个相册；
//   热门为默认排序，最新加 &o=new；分页与 o=new 均实测出 36 个相册。
// - 相册卡：<div class="... album"> 块内 album-link href=/a/{id}、
//   album-thumbnail img src 为封面、album-title 为标题、album-user 为作者，
//   album-videos / album-images span 为视频/图片数。
// - 详情页：/a/{id}，og:title 为标题、og:image 为封面；每个
//   <div class="media-group"> 为一项，有 <source src="...mp4"> 的是视频项
//   （同一 mp4 在灯箱与播放器各出现一次，需去重），只有图片的组跳过；
//   实测 mp4 为 vXX.erome.com 直链，如 ..._720p.mp4。
// - 年龄提示只是页面内一个 div，直取 /search 与 /a/ 均不需登录、不需 cookie。
// - 注意：本站 /explore 在本机工具侧被拦截未验到，故蜘蛛不依赖 explore，
//   只用已实测的 search 路线；分类只给实测的热门/最新两个，不猜 slug。
import req from '../../util/req.js';

const KEY = 'py_erome';
const NAME = 'EroMe';
const HOST = 'https://www.erome.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': HOST,
  };
}

async function getText(url) {
  try {
    const { data } = await req.get(url, { headers: H(), timeout: 15000 });
    return String(data || '');
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#[0-9]+;/g, '').replace(/\s+/g, ' ').trim();
}

function absUrl(href) {
  href = String(href || '').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return HOST.replace(/\/$/, '') + href;
  return HOST + href;
}

function parseAlbums(html) {
  // 注意：不能按 <div class="... album"> 切块——album-thumbnail-container /
  // album-infos 等子 div 也含 album 字样，会把一张卡切成多段，封面丢掉。
  // 改为按相册 id 去重：缩略图链接块里含封面图与视频/图片数，标题链接里含标题。
  const items = [];
  const seen = new Set();
  const text = String(html || '');
  const idRe = /\/a\/([A-Za-z0-9]+)/g;
  let m;
  while ((m = idRe.exec(text)) !== null) {
    const id = m[1];
    const url = HOST + 'a/' + id;
    if (seen.has(url)) continue;
    seen.add(url);
    const tm = text.match(new RegExp('<a[^>]*class="album-title"[^>]*href="[^"]*/a/' + id + '"[^>]*>([\\s\\S]{0,300}?)</a>', 'i'));
    const title = tm ? stripTags(tm[1]) : '';
    if (!title || title.length < 2) continue;
    const linkRe = new RegExp('<a[^>]*class="album-link"[^>]*href="[^"]*/a/' + id + '"[^>]*>([\\s\\S]{0,2500}?)</a>', 'i');
    const lm = text.match(linkRe);
    let pic = '';
    let remarks = '';
    if (lm) {
      const pm = lm[1].match(/<img[^>]*src="([^"]+)"[^>]*>/i);
      if (pm) pic = pm[1];
      const vm = lm[1].match(/<span[^>]*class="album-videos"[^>]*>([\s\S]{0,80}?)<\/span>/i);
      const im = lm[1].match(/<span[^>]*class="album-images"[^>]*>([\s\S]{0,80}?)<\/span>/i);
      const vnum = vm ? stripTags(vm[1]) : '';
      const inum = im ? stripTags(im[1]) : '';
      if (vnum) remarks = '视频' + vnum;
      else if (inum) remarks = '图片' + inum;
    }
    if (!pic) {
      const pm2 = text.match(new RegExp('<img[^>]*src="([^"]*/' + id + '/thumbs/[^"]+)"[^>]*>', 'i'));
      if (pm2) pic = pm2[1];
    }
    items.push({ vod_id: url, vod_name: title, vod_pic: pic, vod_remarks: remarks });
    if (items.length >= 36) break;
  }
  return items;
}

function searchUrl(wd, order, page) {
  let url = HOST + 'search?q=' + encodeURIComponent(wd);
  if (order === 'new') url += '&o=new';
  if (page > 1) url += '&page=' + page;
  return url;
}

async function init() { return {}; }

async function home() {
  const html = await getText(searchUrl('a', 'hot', 1));
  return {
    class: [
      { type_id: 'hot', type_name: '热门' },
      { type_id: 'new', type_name: '最新' },
    ],
    filters: {},
    list: parseAlbums(html),
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'hot');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const order = tid === 'new' ? 'new' : 'hot';
  const html = await getText(searchUrl('a', order, page));
  const list = parseAlbums(html);
  return {
    page, pagecount: 9999, limit: 90,
    total: list.length ? 999999 : 0,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : absUrl(raw);
    const html = await getText(url);
    const hm = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const pm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const urls = [];
    const seen = new Set();
    const groups = String(html).split('<div class="media-group"');
    for (let i = 1; i < groups.length; i++) {
      const g = groups[i];
      const sm = g.match(/<source\s+src="([^"]+\.mp4[^"]*)"/i);
      if (sm && !seen.has(sm[1])) { seen.add(sm[1]); urls.push(sm[1]); }
    }
    list.push({
      vod_id: raw,
      vod_name: hm ? stripTags(hm[1]) : 'EroMe',
      vod_pic: pm ? pm[1] : '',
      vod_play_from: 'EroMe',
      vod_play_url: urls.length
        ? urls.map((u, i) => `第${i + 1}段$${u}`).join('#')
        : ('未找到视频源$' + url),
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.mp4/i.test(id);
  return {
    parse: isVideo ? 0 : 1,
    url: id,
    header: H(),
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const html = await getText(searchUrl(wd, 'hot', page));
  const list = parseAlbums(html);
  return { page, pagecount: 9999, limit: 90, total: list.length, list };
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
