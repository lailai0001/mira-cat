import req from '../../util/req.js';
import * as cheerio from 'cheerio';

// HQPorner - MiraPlayer Spider
// 站点：https://m.hqporner.com（移动版）
// 播放链：详情页 -> mydaddy.cc 嵌页 -> bigcdn.cc 直链 mp4（360p/720p/1080p 三档）
// 详情直接给三档真地址（1080p 在前），点开即播；loadResource 只作回落。
// 注意：bigcdn.cc 直链在 VM 侧回 404（疑为机房 IP 被 nginx 挡），手机真机待验。

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const BASE = 'https://m.hqporner.com';
const DESK = 'https://hqporner.com';

function t(v) { return String(v == null ? '' : v).trim(); }
function clean(s) {
  return t(s).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function abs(u) {
  const s = t(u);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('/')) return BASE + s;
  return BASE + '/' + s;
}

async function getHtml(url, timeoutMs) {
  try {
    const r = await req.get(url, {
      headers: { 'User-Agent': UA, Referer: BASE + '/' },
      timeout: timeoutMs || 15000,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    const text = typeof r.data === 'string' ? r.data : '';
    if (r.status >= 200 && r.status < 300) return text;
    // 站方个别页回 404 但仍带内容（如首页 /2），有内容就认
    if (text && text.length > 5000) return text;
    return '';
  } catch (e) {
    return '';
  }
}

// 64 分类（2026-11-29 自 /categories 实测，顺序即站方顺序）
const CATS = [
  ['1080p-porn', '1080p Porn'], ['anal-sex-hd', 'Anal'], ['4k-porn', '4k Porn'],
  ['milf', 'Milf'], ['lesbian', 'Lesbian'], ['creampie', 'Creampie'],
  ['60fps-porn', '60fps'], ['big-tits', 'Big Tits'], ['teen-porn', 'Teen Porn'],
  ['pov', 'Pov'], ['threesome', 'Threesome'], ['asian', 'Asian'],
  ['old-and-young', 'Old And Young'], ['ebony', 'Ebony'], ['big-ass', 'Big Ass'],
  ['interracial', 'Interracial'], ['mature', 'Mature'], ['squirt', 'Squirt'],
  ['casting', 'Casting'], ['amateur', 'Amateur'], ['porn-massage', 'Sex Massage'],
  ['gangbang', 'Gangbang'], ['stockings', 'Stockings'], ['big-dick', 'Big Dick'],
  ['latina', 'Latina'], ['babe', 'Babe'], ['group-sex', 'Group Sex'],
  ['russian', 'Russian'], ['masturbation', 'Masturbation'], ['hairy-pussy', 'Hairy Pussy'],
  ['uniforms', 'Uniforms'], ['shemale', 'Shemale'], ['blonde', 'Blonde'],
  ['orgasm', 'Orgasm'], ['pickup', 'Pickup'], ['bdsm', 'Bdsm'],
  ['sex-parties', 'Sex Party'], ['public', 'Public'], ['japanese-girls-porn', 'Japanese'],
  ['redhead', 'Redhead'], ['orgy', 'Orgy'], ['fetish', 'Fetish'],
  ['blowjob', 'Blowjob'], ['small-tits', 'Small Tits'], ['brunette', 'Brunette'],
  ['undressing', 'Undressing'], ['cumshot', 'Cumshot'], ['outdoor', 'Outdoor'],
  ['deepthroat', 'Deepthroat'], ['bondage', 'Bondage'], ['shaved-pussy', 'Shaved Pussy'],
  ['bisexual', 'Bisexual'], ['hentai', 'Hentai'], ['handjob', 'Handjob'],
  ['pussy-licking', 'Pussy Licking'], ['fisting', 'Fisting'], ['moaning', 'Moaning'],
  ['vintage', 'Vintage'], ['tattooed', 'Tattooed'], ['beach-porn', 'Beach'],
  ['vibrator', 'Vibrator'], ['fingering', 'Fingering'], ['squeezing-tits', 'Squeezing Tits'],
  ['long-hair', 'Long Hair'],
];

const CATEGORIES = [
  { type_id: 'latest', type_name: '最新视频' },
  { type_id: 'top', type_name: '热门视频' },
  ...CATS.map(([slug, name]) => ({ type_id: 'cat:' + slug, type_name: name })),
];

function catPath(id, page) {
  if (id === 'latest') return page > 1 ? '/' + page : '/';
  if (id === 'top') return page > 1 ? '/top/' + page : '/top';
  if (id.startsWith('cat:')) {
    const slug = id.slice(4);
    return page > 1 ? '/category/' + slug + '/' + page : '/category/' + slug;
  }
  return '/';
}

function parseList(html) {
  const $ = cheerio.load(html || '');
  const list = [];
  const seen = new Set();
  // 卡片：<a href="/hdporn/..."><img src="..._main.jpg" alt="标题"/></a> + <h2>标题</h2> + 时长
  $('a[href^="/hdporn/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (!href || seen.has(href)) return;
    const $img = $a.find('img').first();
    const pic = abs($img.attr('src') || $img.attr('data-src') || '');
    let name = clean($img.attr('alt') || '');
    // 标题也可能在后面的 <h2> 里；先用 alt，缺失时找同卡片 h2
    if (!name) {
      const $card = $a.closest('div');
      name = clean($card.find('h2').first().text() || '');
    }
    if (!name) {
      const m = href.match(/\/hdporn\/\d+-(.+)\.html$/);
      if (m) name = clean(decodeURIComponent(m[1]).replace(/_/g, ' '));
    }
    // 时长：卡片附近的 meta_data（含 fa-clock-o）
    let dur = '';
    const $wrap = $a.closest('.img-container').parent();
    const meta = $wrap.find('.meta_data').first().text();
    const dm = (meta || '').match(/(\d+\s*m\s*\d+\s*s|\d{1,2}:\d{2}(?::\d{2})?)/);
    if (dm) dur = dm[1].replace(/\s+/g, ' ').trim();
    if (href && (name || pic)) {
      seen.add(href);
      list.push({ vod_id: href, vod_name: name, vod_pic: pic, vod_remarks: dur, vod_duration: dur });
    }
  });
  // 兜底：h2 标题补齐（alt 为空的卡片）
  if (list.length) {
    const byId = new Map(list.map((v) => [v.vod_id, v]));
    $('h2').each((_, el) => {
      const title = clean($(el).text());
      if (!title) return;
      // h2 前面的 img-container 里的 a 就是对应视频
      const $h2 = $(el);
      const $prev = $h2.closest('div').prevAll('.img-container').first().find('a[href^="/hdporn/"]');
      const href = $prev.attr('href') || '';
      const v = byId.get(href);
      if (v && !v.vod_name) v.vod_name = title;
    });
  }
  return list;
}

// 从 mydaddy 嵌页提取三档 mp4（360/720/1080），按清晰度降序
function extractQualities(embedHtml) {
  const found = new Map(); // q -> url
  const re = /\/\/[a-z0-9-]+\.bigcdn\.cc\/pubs\/[^"'\\\s]+\/(360|720|1080)\.mp4/gi;
  let m;
  while ((m = re.exec(embedHtml || '')) !== null) {
    const q = parseInt(m[1], 10);
    const url = 'https:' + m[0];
    if (!found.has(q)) found.set(q, url);
  }
  return [...found.entries()].sort((a, b) => b[0] - a[0]).map(([q, u]) => ({ q, url: u }));
}

async function resolvePlay(detailPath) {
  // 详情页 -> mydaddy 嵌页 -> 三档 mp4
  const html = await getHtml(abs(detailPath));
  if (!html) return { name: '', pic: '', eps: '', desc: '' };
  const $ = cheerio.load(html);
  const name = clean($('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text().replace(/ - HQporner\.com.*$/i, '') || '');
  const pic = abs($('meta[property="og:image"]').attr('content') || '');
  const desc = clean($('meta[name="description"]').attr('content') || '');
  const m = html.match(/mydaddy\.cc\/video\/([a-z0-9]+)\//i);
  if (!m) return { name, pic, eps: '', desc };
  const embedUrl = 'https://mydaddy.cc/video/' + m[1] + '/';
  const embed = await getHtml(embedUrl);
  if (!embed) return { name, pic, eps: '', desc };
  const quals = extractQualities(embed);
  if (!quals.length) return { name, pic, eps: '', desc };
  const eps = quals.map(({ q, url }) => q + 'p$' + url).join('#');
  return { name, pic, eps, desc };
}

async function home(e) {
  return { class: CATEGORIES };
}

async function category(e) {
  const id = String((e.body && e.body.id) || 'latest');
  let page = parseInt((e.body && e.body.page) || 1, 10) || 1;
  if (page < 1) page = 1;
  const html = await getHtml(BASE + catPath(id, page));
  const list = html ? parseList(html) : [];
  return { page, pagecount: list.length < 20 ? page : page + 1, list };
}

async function detail(e) {
  const id = String((e.body && e.body.id) || '');
  if (!id) return { list: [] };
  const path = id.replace(/^https?:\/\/[^\/]+/, '');
  const r = await resolvePlay(path.startsWith('/') ? path : '/' + path);
  if (!r.eps) return { list: [] };
  return {
    list: [{
      vod_id: id,
      vod_name: r.name,
      vod_pic: r.pic,
      vod_content: r.desc,
      vod_play_from: 'HQPorner',
      vod_play_url: r.eps,
    }],
  };
}

async function play(e) {
  const id = String((e.body && e.body.id) || '');
  let url = '';
  if (id.includes('$')) {
    url = (id.split('#')[0].split('$').pop() || '');
  } else if (/^https?:\/\//.test(id) && /\.mp4(\?|#|$)/i.test(id)) {
    url = id;
  }
  if (!url) {
    // 传了 vod_id（详情页地址）：现取详情拿最高清晰度
    const path = id.replace(/^https?:\/\/[^\/]+/, '');
    const r = await resolvePlay(path.startsWith('/') ? path : '/' + path);
    if (r.eps) url = (r.eps.split('#')[0].split('$').pop() || '');
  }
  return {
    parse: 0,
    url: url || '',
    header: { 'User-Agent': UA, Referer: 'https://mydaddy.cc/', origin: BASE },
  };
}

async function search(e) {
  const wd = String((e.body && e.body.wd) || '');
  let page = parseInt((e.body && e.body.page) || 1, 10) || 1;
  if (page < 1) page = 1;
  // 搜索走首页 ?q=；翻页沿用 /?q=...&page= 形态站方不认，搜索只做第 1 页
  const html = await getHtml(BASE + '/?q=' + encodeURIComponent(wd));
  const list = html ? parseList(html) : [];
  return { page: 1, pagecount: 1, list };
}

export default function spider() {
  return {
    meta: { key: 'py_hqporner', name: 'HQPorner', type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
