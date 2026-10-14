// 花都影院 (rb.huaduys.org) - REX forward.huadu.tut v1.3.0 转换而来
// 苹果CMS 站: 中文字幕/无字幕/国产/欧美/动漫
import req from '../../util/req.js';

const KEY = 'py_huadu';
const NAME = '花都影院';

const HOSTS = [
  'https://rb.huaduys.org',
  'https://hd3.huaduys.org',
  'https://a.huaduys.org',
  'https://huaduys.vip',
  'https://huaduys.com',
];
let HOST = HOSTS[0];
let _hostReady = false;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
let _cookie = '';

function t(v) {
  return String(v == null ? '' : v).trim();
}
function decodeHtml(s) {
  s = t(s);
  if (!s) return '';
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}
function absUrl(u) {
  u = t(u).replace(/&amp;/g, '&');
  if (!u) return '';
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('/') === 0) return HOST + u;
  return HOST + '/' + u;
}
// 封面直连：原图 CDN 无防盗链；ik.bug.qzz.io 代理不稳定(间歇 502)、weserv 拒收该域名，故弃用代理
function proxyPic(u) {
  return absUrl(u);
}
function headers(referer) {
  const h = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: referer || HOST + '/',
  };
  if (_cookie) h.Cookie = _cookie;
  return h;
}

async function fetchHtml(url, referer) {
  try {
    const res = await req.get(url, { headers: headers(referer || HOST + '/'), timeout: 15000 });
    const sc = res.headers['set-cookie'] || res.headers['Set-Cookie'] || [];
    const jar = [];
    for (const c of Array.isArray(sc) ? sc : [sc]) {
      const kv = t(String(c).split(';')[0]);
      if (kv) jar.push(kv);
    }
    if (jar.length) _cookie = jar.join('; ');
    const body = res.data != null ? res.data : '';
    return typeof body === 'string' ? body : String(body || '');
  } catch (e) {
    return '';
  }
}

async function ensureHost() {
  if (_hostReady) return;
  for (const h of HOSTS) {
    try {
      const html = await fetchHtml(h + '/', h + '/');
      if (html && html.length > 500 && /voddetail|stui-vodlist|花都/i.test(html)) {
        HOST = h;
        break;
      }
    } catch (e) {}
  }
  _hostReady = true;
}
async function ensureCookie() {
  await ensureHost();
  if (!_cookie) await fetchHtml(HOST + '/', HOST + '/');
}

// ---- REX parseList 逻辑 ----
function parseList(html) {
  const items = [];
  const seen = {};
  if (!html) return items;

  function push(href, name, pic, remark) {
    href = t(href);
    name = decodeHtml(name).replace(/\s+/g, ' ');
    if (!href || !name) return;
    if (seen[href]) return;
    if (/广告|点赞|VPN|发布页|首页|棋牌|澳门|开元|葡京|注册送|发财|约炮|看片|助你/.test(name)) return;
    if (/alicdn|fleamarket|cloudfront|amazonaws|channelCode|shareName/i.test(href + name + (pic || '')))
      return;
    if (href.indexOf('http') === 0 && href.indexOf('huaduys') < 0 && href.indexOf('3010.top') < 0)
      return;
    if (!/voddetail\/\d+/i.test(href)) return;
    if (name.length > 100) return;
    seen[href] = 1;
    const vodPic = proxyPic(pic || '');
    items.push({
      vod_id: href,
      vod_name: name,
      vod_pic: vodPic || proxyPic(''),
      vod_remarks: t(remark || ''),
    });
  }

  const blocks = html.split(/<li[^>]*>/i);
  for (let bi = 1; bi < blocks.length; bi++) {
    const blk = (blocks[bi].split(/<\/li>/i)[0] || '');
    if (blk.length < 30) continue;
    const hm =
      blk.match(/href="([^"]*voddetail[^"]*)"/i) ||
      blk.match(/class="[^"]*stui-vodlist__thumb[^"]*"[^>]*href="([^"]+)"/i) ||
      blk.match(/href="([^"]+)"[^>]*class="[^"]*stui-vodlist__thumb[^"]*"/i) ||
      blk.match(/href="(\/[^"]+\.html)"/i);
    if (!hm) continue;
    const href = hm[1];
    const nm =
      blk.match(/<h4[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
      blk.match(/title="([^"]+)"/i) ||
      blk.match(/alt="([^"]+)"/i);
    const name = nm ? nm[1] : '';
    const pm =
      blk.match(/data-original="([^"]+)"/i) ||
      blk.match(/data-src="([^"]+)"/i) ||
      blk.match(/<img[^>]+src="([^"]+)"/i);
    const pic = pm ? pm[1] : '';
    const rm = blk.match(/pic-text[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const remark = rm ? rm[1].replace(/<[^>]+>/g, '') : '';
    push(href, name, pic, remark);
  }

  if (!items.length) {
    const re = /href="((?:https?:\/\/[^"]+)?\/?voddetail\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const href2 = m[1];
      const inner = m[2] || '';
      let name2 = t(inner.replace(/<[^>]+>/g, ''));
      if (!name2 || name2.length > 60) {
        const near = html.slice(Math.max(0, m.index - 50), m.index + 400);
        const n3 =
          near.match(/<h4[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ||
          near.match(/title="([^"]+)"/i) ||
          near.match(/alt="([^"]+)"/i);
        name2 = n3 ? n3[1] : name2;
      }
      const near2 = html.slice(m.index, m.index + 500);
      const p2 = near2.match(/data-original="([^"]+)"/i) || near2.match(/data-src="([^"]+)"/i);
      push(href2, name2, p2 ? p2[1] : '', '');
    }
  }
  return items;
}

/** 苹果CMS 分页 */
function buildShow(cid, page) {
  page = parseInt(page, 10) || 1;
  if (page <= 1) return '/vodshow/' + cid + '-----------.html';
  return '/vodshow/' + cid + '--------' + page + '---.html';
}

async function loadCategoryList(cid, page) {
  await ensureCookie();
  const candidates = [
    buildShow(cid, page),
    '/vodtype/' + cid + (page > 1 ? '-' + page : '') + '.html',
    '/vodtype/' + cid + '.html',
    '/index.php/vod/show/id/' + cid + '/page/' + page + '.html',
    '/index.php/vod/type/id/' + cid + (page > 1 ? '/page/' + page : '') + '.html',
  ];
  for (const c of candidates) {
    const list = parseList(await fetchHtml(HOST + c, HOST + '/'));
    if (list.length) return list;
  }
  return [];
}

// ---- 播放页解析 (base64+urlencode -> m3u8/mp4) ----
function b64decode(str) {
  str = t(str).replace(/[\r\n\s]/g, '');
  if (!str) return '';
  try {
    const dec = Buffer.from(str.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8');
    return dec;
  } catch (e) {
    return '';
  }
}

async function resolvePlayPage(playUrl) {
  playUrl = absUrl(playUrl);
  if (!playUrl) return '';
  if (/\.(m3u8|mp4)(\?|$)/i.test(playUrl)) return playUrl;
  const html = await fetchHtml(playUrl, HOST + '/');
  if (!html) return '';

  const m =
    html.match(/["']url["']\s*:\s*["']([A-Za-z0-9+/=]{20,})["']/) ||
    html.match(/"","url":"([^"]+)"/) ||
    html.match(/var\s+player_[a-zA-Z0-9]+\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (m) {
    let raw = m[1];
    if (raw.charAt(0) === '{') {
      try {
        raw = JSON.parse(raw).url || '';
      } catch (e) {
        raw = '';
      }
    }
    if (raw) {
      if (/^https?:\/\//i.test(raw)) return raw.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      try {
        let dec = b64decode(raw);
        try {
          dec = decodeURIComponent(dec);
        } catch (e2) {}
        dec = t(dec).replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        if (/^https?:\/\//i.test(dec)) return dec;
      } catch (e3) {}
    }
  }
  const m3 = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m3) return m3[1].replace(/&amp;/g, '&');
  const m4 = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
  if (m4) return m4[1].replace(/&amp;/g, '&');
  return '';
}

function cleanTitle(s) {
  s = decodeHtml(s || '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.split('_')[0].split('|')[0];
  s = s.replace(/在线观看.*$/i, '').replace(/花都.*$/i, '');
  s = s.replace(/[-_\s]*正片$/i, '').trim();
  if (/^正片$|^播放$|^在线播放$/i.test(s)) return '';
  return s;
}

async function home() {
  await ensureCookie();
  return {
    class: [
      { type_id: 'home', type_name: '首页推荐' },
      { type_id: '1', type_name: '中文字幕' },
      { type_id: '2', type_name: '无字幕' },
      { type_id: '3', type_name: '国产' },
      { type_id: '4', type_name: '欧美' },
      { type_id: '5', type_name: '动漫' },
    ],
    filters: {},
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const id = String(body.id || '');
  let list = [];
  if (id === 'home') {
    await ensureCookie();
    if (page <= 1) {
      list = parseList(await fetchHtml(HOST + '/', HOST + '/'));
    } else {
      list = await loadCategoryList('1', page);
    }
  } else {
    list = await loadCategoryList(id || '1', page);
  }
  return { page, pagecount: 999, limit: list.length, total: 999 * 20, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  await ensureCookie();
  const pageUrl = absUrl(id);
  const html = await fetchHtml(pageUrl, HOST + '/');

  let title = '';
  if (html) {
    const tm =
      html.match(/property="og:title"\s+content="([^"]+)"/i) ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<title>([^<]+)</i);
    if (tm) title = cleanTitle(tm[1]) || '';
  }
  title = title || '未命名';

  let pic = '';
  if (html) {
    const pm =
      html.match(/property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/data-original="([^"]+)"/i) ||
      html.match(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*img-responsive/i);
    if (pm) pic = pm[1];
  }

  let desc = '';
  if (html) {
    const dm =
      html.match(/简介[：:]\s*<\/span>([\s\S]*?)<\//i) ||
      html.match(/class="[^"]*stui-content__desc[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (dm) desc = t(dm[1].replace(/<[^>]+>/g, '')).slice(0, 300);
  }

  const playLinks = [];
  if (html) {
    const btn = html.match(/class="btn btn-primary"[^>]*href="([^"]+)"/i);
    if (btn) playLinks.push({ name: '正片', href: btn[1] });
    const reEp = /href="(\/vodplay\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const seenP = {};
    let em;
    while ((em = reEp.exec(html))) {
      const h = t(em[1]);
      const n = t(em[2]);
      if (!h || seenP[h]) continue;
      if (/脚本|APP|下载/.test(n)) continue;
      seenP[h] = 1;
      playLinks.push({ name: n || '播放', href: h });
    }
  }
  if (!playLinks.length) playLinks.push({ name: '播放', href: id });

  const vod_play_url = playLinks
    .map((pl, i) => {
      const nm = playLinks.length === 1 ? title : `${title} 第${i + 1}集`;
      return `${nm}$${pl.href}`;
    })
    .join('#');

  return {
    list: [
      {
        vod_id: id,
        vod_name: title,
        vod_pic: proxyPic(pic),
        vod_content: desc,
        vod_play_from: NAME,
        vod_play_url,
      },
    ],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '');
  await ensureCookie();
  const direct = await resolvePlayPage(url);
  return { parse: 0, url: direct || absUrl(url), header: { 'User-Agent': UA, Referer: HOST + '/' } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let list = [];
  if (wd) {
    await ensureCookie();
    const url = HOST + '/vodsearch/-------------.html?wd=' + encodeURIComponent(wd);
    list = parseList(await fetchHtml(url, HOST + '/'));
    if (!list.length) {
      list = parseList(
        await fetchHtml(HOST + '/index.php/vod/search.html?wd=' + encodeURIComponent(wd), HOST + '/')
      );
    }
  }
  return { page, pagecount: 999, limit: list.length, total: 999 * 20, list };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
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
