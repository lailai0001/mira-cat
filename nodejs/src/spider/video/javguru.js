import req from '../../util/req.js';

// JavGuru (py_javguru)
// 站点: https://jav.guru/ (WordPress, 无反爬)
// 首页: GET /
// 分类: GET /category/{amateur|idol|4k}/[page/N/]
// 搜索: GET /?s={kw}[&paged=N]  (WP 标准搜索; 分页 /page/N/)
// 列表卡片: div.inside-article > div.imgg > a[href=https://jav.guru/{id}/{slug}/] > img[src=cdn.javmiku.com, alt=标题]
// 详情页播放: wp-btn-iframe 插件, a#wp-btn-iframe[data-localize="{key}"] 5 个流 (STREAM SB/VO/LU/DD/JK)
//   script 中 var {key} = {...,"iframe_url":"{base64}"...}; 解码得 https://jav.guru/searcho/?{x}d=... 网关页
//   网关页用 JS 加载第三方 iframe, 故 play 用 parse:1 嗅探模式

const KEY = 'py_javguru';
const NAME = 'JavGuru';
const SITE = 'https://jav.guru';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

// 4 个分类 (2026-10-19 从首页/分类页实测确认)
const CATS = [
  { type_id: '', type_name: '最新' },
  { type_id: 'amateur', type_name: 'AMATEUR' },
  { type_id: 'idol', type_name: 'IV' },
  { type_id: '4k', type_name: '4K' },
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
    .replace(/&#0?39;/g, "'")
    .replace(/&#0?96;/g, "'")
    .replace(/&#8216;|&#8217;|&#8242;/g, "'")
    .replace(/&#8220;|&#8221;|&#8243;/g, '"')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&#8230;/g, '...')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return ''; } })
    .replace(/\s+/g, ' ');
}

// 双通道: 先框架 req，失败再原生 fetch
async function getHtml(url) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
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

function parseCards(html) {
  const out = [];
  const seen = new Set();
  // 卡片: <div class="imgg"> <a href="https://jav.guru/{id}/{slug}/"> <img src="..." alt="标题">
  const re = /<div class="imgg">\s*<a href="(https:\/\/jav\.guru\/(\d+)\/[^"]+\/)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const vid = m[2];
    if (seen.has(vid)) continue;
    seen.add(vid);
    const win = html.slice(m.index, m.index + 1500);
    const imgM = win.match(/<img[^>]+src="([^"]+)"/);
    const altM = win.match(/<img[^>]+alt="([^"]*)"/);
    out.push({
      vod_id: url,
      vod_name: altM ? clean(altM[1]) : 'JavGuru ' + vid,
      vod_pic: imgM ? imgM[1] : '',
      vod_remarks: '',
    });
  }
  return out;
}

function parsePagecount(html) {
  const pages = [...html.matchAll(/\/page\/(\d+)\/?["']/g)].map(x => parseInt(x[1], 10));
  return pages.length ? Math.max(...pages) : 1;
}

function buildList(url, page) {
  return getHtml(url).then(html => {
    if (!html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
    const pc = parsePagecount(html);
    if (page > pc) return { page, pagecount: pc, limit: 24, total: 0, list: [] };
    const list = parseCards(html);
    return { page, pagecount: pc, limit: 24, total: list.length, list };
  });
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  return { class: cls, list: [] };
}

async function homeVod(reqIn) {
  const html = await getHtml(SITE + '/');
  return { list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url;
  if (tid) {
    url = SITE + '/category/' + encodeURIComponent(tid) + '/';
    if (page > 1) url += 'page/' + page + '/';
  } else {
    url = SITE + '/';
    if (page > 1) url += 'page/' + page + '/';
  }
  return buildList(url, page);
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  // 详情 URL 直接作为 vod_id 传递
  let url = id;
  if (!/^https?:\/\//i.test(url)) {
    url = SITE + '/' + url.replace(/^\//, '');
  }

  const html = await getHtml(url);
  if (!html) return { list: [] };

  let titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const name = titleM ? clean(titleM[1]) : 'JavGuru';

  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/) || html.match(/<div class="large-screenshot"[\s\S]{0,600}?<img[^>]+src="([^"]+)"/);
  if (picM) pic = picM[1];

  // 提取 5 个流: a[data-localize="{key}"] 的文本为流名
  const streams = [];
  const aRe = /<a[^>]+data-localize="([a-z]+)"[^>]*>([^<]+)<\/a>/g;
  let am;
  while ((am = aRe.exec(html)) !== null) {
    streams.push({ key: am[1], label: clean(am[2]) });
  }

  const flags = [];
  const urls = [];
  for (const s of streams) {
    flags.push(s.label || s.key);
    urls.push(`正片$${url}@@${s.key}`);
  }
  if (!flags.length) {
    flags.push('JavGuru');
    urls.push(`正片$${url}`);
  }

  return {
    list: [{
      vod_id: url,
      vod_name: name,
      vod_pic: pic,
      vod_content: name,
      vod_play_from: flags.join('$$$'),
      vod_play_url: urls.join('$$$'),
    }],
  };
}

// 从详情页提取指定 key 的 iframe_url (Base64) 并解码
function extractGateway(html, key) {
  if (key) {
    const re = new RegExp('var\\s+' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*\\{[^}]*?"iframe_url"\\s*:\\s*"([^"]+)"');
    const m = html.match(re);
    if (m) {
      try {
        return Buffer.from(m[1], 'base64').toString('utf-8');
      } catch (e) { /* fallthrough */ }
    }
  }
  // 兜底: 取第一个 iframe_url
  const m2 = html.match(/"iframe_url"\s*:\s*"([^"]+)"/);
  if (m2) {
    try {
      return Buffer.from(m2[1], 'base64').toString('utf-8');
    } catch (e) { /* ignore */ }
  }
  return '';
}

// 从网关1页面计算网关2 URL
// 网关1: <div id="{cid}" class="stream-box" data-x="p1" data-y="p2" data-z="p3">
//         window.cfg = {cid, base, rtype, keys:[data-x, data-y, data-z]}
// 网关2 = base + '?' + rtype + 'r=' + reverse(p1+p2+p3)
function computeGateway2(html) {
  const cidM = html.match(/cid:\s*'([^']+)'/);
  const baseM = html.match(/base:\s*'([^']+)'/);
  const rtypeM = html.match(/rtype:\s*'([^']+)'/);
  const keysM = html.match(/keys:\s*\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/);
  if (!cidM || !baseM || !rtypeM || !keysM) return '';
  const divM = html.match(new RegExp('<div[^>]+id="' + cidM[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>'));
  if (!divM) return '';
  const divTag = divM[0];
  const p1 = (divTag.match(new RegExp(keysM[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]+)"')) || [])[1];
  const p2 = (divTag.match(new RegExp(keysM[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]+)"')) || [])[1];
  const p3 = (divTag.match(new RegExp(keysM[3].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]+)"')) || [])[1];
  if (!p1 || !p2 || !p3) return '';
  const rev = (p1 + p2 + p3).split('').reverse().join('');
  return baseM[1] + '?' + rtypeM[1] + 'r=' + rev;
}

// Dean Edwards packer 解包
function unpackDeanEdwards(html) {
  const idx = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (idx < 0) return '';
  const seg = html.slice(idx, idx + 25000);
  const m = seg.match(/',(\d+),(\d+),'/);
  if (!m) return '';
  const radix = parseInt(m[1], 10);
  const count = parseInt(m[2], 10);
  const payloadStart = seg.indexOf("}('") + 3;
  const payload = seg.slice(payloadStart, payloadStart + m.index);
  const ksStart = seg.indexOf(",'", m.index) + 2;
  const ksEnd = seg.indexOf("'.split", ksStart);
  if (ksEnd < 0) return '';
  const keys = seg.slice(ksStart, ksEnd).split('|');
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  function toRadix(n) {
    if (n === 0) return '0';
    let s = '';
    while (n > 0) { s = digits[n % radix] + s; n = Math.floor(n / radix); }
    return s;
  }
  let p = payload;
  for (let c = count - 1; c >= 0; c--) {
    const word = toRadix(c);
    if (c < keys.length && keys[c]) {
      p = p.replace(new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), keys[c]);
    }
  }
  return p;
}

// 从网关2页面提取 m3u8 地址列表 (按优先级: hls2 > hls4 > hls3)
// 返回 [{quality, url}]，url 已补全为绝对地址
function extractM3u8List(gw2html, gw2url) {
  const unpacked = unpackDeanEdwards(gw2html);
  const src = unpacked || gw2html;
  // hls4 相对地址的 host 藏在解包后 JS 里 (premilkyway CDN)
  let cdnHost = '';
  const hostM = src.match(/(https?:\/\/[a-z0-9.-]*premilkyway[a-z0-9.-]*)/i);
  if (hostM) cdnHost = hostM[1].replace(/\/$/, '');
  const out = [];
  const lm = src.match(/var\s+links\s*=\s*(\{[^;]*?\});/);
  if (lm) {
    for (const k of ['hls2', 'hls4', 'hls3']) {
      const mm = lm[1].match(new RegExp('"' + k + '"\\s*:\\s*"([^"]+)"'));
      if (mm) {
        let url = mm[1];
        if (url.startsWith('/') && cdnHost) url = cdnHost + url;
        else if (url.startsWith('/')) {
          try { url = new URL(gw2url).origin + url; } catch (e) { /* ignore */ }
        }
        if (/^https?:\/\//i.test(url)) out.push({ quality: k, url });
      }
    }
  }
  // 兜底: 直接找 m3u8 URL
  if (!out.length) {
    const all = [...src.matchAll(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/g)].map(x => x[0]);
    for (const u of all) out.push({ quality: 'auto', url: u });
  }
  return out;
}

// 兼容旧名
function extractM3u8(gw2html, gw2url) {
  const list = extractM3u8List(gw2html, gw2url);
  return list.length ? list[0].url : '';
}

// 验证 m3u8 是否可达 (只读头部, 10秒超时)
async function checkM3u8(url, referer) {
  const headers = { 'User-Agent': UA, 'Referer': referer || REFERER, 'Accept': '*/*', 'Range': 'bytes=0-2047' };
  try {
    const { data, status } = await req.get(url, { headers, timeout: 10000 });
    if (status === 200 || status === 206) {
      const txt = typeof data === 'string' ? data : '';
      if (txt.includes('#EXTM3U')) return true;
    }
  } catch (e) { /* 换 fetch */ }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(url, { headers, signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const txt = await r.text();
      if (txt.includes('#EXTM3U')) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

// 解析单个流 key -> m3u8 候选列表 (内部用)
async function resolveStream(detailHtml, streamKey) {
  const gateway1 = extractGateway(detailHtml, streamKey);
  if (!gateway1) return { gateway1: '', list: [] };
  const gw1html = await getHtml(gateway1);
  if (!gw1html) return { gateway1, list: [] };
  const gateway2 = computeGateway2(gw1html);
  if (!gateway2) return { gateway1, list: [] };
  const gw2html = await getHtml(gateway2);
  if (!gw2html) return { gateway1, list: [] };
  const list = extractM3u8List(gw2html, gateway2);
  return { gateway1, gateway2, list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  // id 形式: "正片${detailUrl}@@${streamKey}" 或 "正片${detailUrl}"
  if (id.includes('$')) id = id.split('$').pop().trim();
  let detailUrl = id;
  let streamKey = '';
  if (id.includes('@@')) {
    const parts = id.split('@@');
    detailUrl = parts[0];
    streamKey = parts[1];
  }

  const html = await getHtml(detailUrl);
  if (!html) return { parse: 0, url: '' };

  // 收集所有流 key: 先用户选的, 再其余
  const allKeys = [];
  const aRe = /<a[^>]+data-localize="([a-z]+)"[^>]*>/g;
  let am;
  while ((am = aRe.exec(html)) !== null) {
    if (!allKeys.includes(am[1])) allKeys.push(am[1]);
  }
  const ordered = [];
  if (streamKey) ordered.push(streamKey);
  for (const k of allKeys) if (!ordered.includes(k)) ordered.push(k);

  let firstGateway1 = '';
  const resolved = [];
  // 逐流解析 (每流: 详情->网关1->网关2->解包)
  for (const key of ordered) {
    const r = await resolveStream(html, key);
    if (!firstGateway1 && r.gateway1) firstGateway1 = r.gateway1;
    if (r.list.length) resolved.push(r);
  }
  // 每流只验证首选 m3u8 (hls2), 取第一个可用的 (避免过多请求导致超时)
  for (const r of resolved) {
    const item = r.list[0];
    if (await checkM3u8(item.url, r.gateway2 || r.gateway1)) {
      return {
        parse: 0,
        url: item.url,
        header: { 'User-Agent': UA, 'Referer': r.gateway2 || r.gateway1 || REFERER },
      };
    }
  }
  // 首选都不可达: 返回第一个候选让播放器尝试 (不再验证以节省时间)
  if (resolved.length && resolved[0].list.length) {
    const r = resolved[0];
    return {
      parse: 0,
      url: r.list[0].url,
      header: { 'User-Agent': UA, 'Referer': r.gateway2 || r.gateway1 || REFERER },
    };
  }

  // 都不可达: 降级嗅探网关1
  return {
    parse: 1,
    url: firstGateway1,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
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
