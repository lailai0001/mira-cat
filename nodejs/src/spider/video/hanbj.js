// 韩国BJ - CatPawOpen JS Spider
// Ported from BJ.py (HOST=https://kbj.im)
import req from '../../util/req.js';

const KEY = 'py_hanbj';
const NAME = '韩国BJ';
const HOST = 'https://kbj.im';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36';

function absUrl(u, base = HOST) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  try { return new URL(raw, base).toString(); } catch { return raw; }
}

async function getText(url) {
  try {
    const { data } = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': HOST + '/' },
      timeout: 15000,
    });
    return String(data || '');
  } catch { return ''; }
}

function parseCards(html) {
  const items = [];
  const blocks = html.split(/<div[^>]*class="[^"]*grid[^"]*"[^>]*>/i);
  // 退化：按 posts 链接切块
  const cardRe = /<div[^>]*>\s*<a[^>]*href="([^"]*\/posts\/([a-zA-Z0-9_-]+))"[^>]*>([\s\S]{0,3000}?)<\/a>/g;
  let m;
  const seen = new Set();
  while ((m = cardRe.exec(html)) !== null) {
    const href = m[1], tid = m[2];
    if (seen.has(tid)) continue;
    seen.add(tid);
    const inner = m[3];
    const t = inner.match(/<h2[^>]*>([^<]{2,200})<\/h2>/i) || inner.match(/title="([^"]{2,200})"/i);
    const im = inner.match(/<img[^>]*src="([^"]+)"/i);
    const tm = html.match(/<time[^>]*datetime="([^"]+)"[^>]*>/i);
    const name = t ? t[1].trim() : '';
    if (!name) continue;
    items.push({
      vod_id: tid,
      vod_name: name,
      vod_pic: im ? absUrl(im[1]) : '',
      vod_remarks: tm ? tm[1].slice(0, 10) : '',
    });
    if (items.length >= 30) break;
  }
  return items;
}

function pagecountOf(html, cur) {
  let max = cur;
  const re = /[?&]page=(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

async function init() { return {}; }

async function home() {
  return {
    class: [{ type_id: 'latest', type_name: '最新视频' }],
    filters: {},
    list: [],
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'latest');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = HOST + '/';
  if (page > 1) url = HOST + '/?page=' + page;
  const html = await getText(url);
  const list = parseCards(html);
  return {
    page,
    pagecount: pagecountOf(html, page),
    limit: 24,
    total: list.length ? list.length * pagecountOf(html, page) : 0,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const tid = String(raw).trim();
    const url = HOST + '/posts/' + tid;
    const html = await getText(url);
    if (!html) { list.push({ vod_id: tid, vod_name: tid }); continue; }
    const tm = html.match(/<h1[^>]*>([^<]{2,200})<\/h1>/i);
    const om = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
    // 播放地址：filemoon /e/xxx 或 iframe
    let playUrl = '';
    const fm = html.match(/filemoon\.[a-z]+\/(?:e|embed)\/([a-zA-Z0-9]+)/i);
    if (fm) playUrl = fm[0].startsWith('http') ? fm[0] : 'https://' + fm[0];
    if (!playUrl) {
      const im = html.match(/<iframe[^>]+src="([^"]+)"/i);
      if (im) playUrl = absUrl(im[1], url);
    }
    list.push({
      vod_id: tid,
      vod_name: tm ? tm[1].trim() : tid,
      vod_pic: om ? om[1] : '',
      vod_play_from: 'KBJ视频',
      vod_play_url: playUrl ? ('第1集$' + playUrl) : ('第1集$' + url),
    });
  }
  return { list };
}

// Filemoon 官方 API: POST {domain}/api/source/{file_id}
async function filemoonApi(filemoonUrl) {
  try {
    const u = new URL(filemoonUrl);
    const fileId = u.pathname.split('/').filter(Boolean).pop();
    if (!fileId || !/^[a-zA-Z0-9]+$/.test(fileId)) return [];
    const domain = u.origin;
    const api = domain + '/api/source/' + fileId;
    const { data } = await req.post(api, {}, {
      headers: {
        'User-Agent': UA, 'Referer': filemoonUrl, 'Origin': domain,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 10000,
    });
    const j = typeof data === 'string' ? JSON.parse(data) : (data || {});
    let arr = j.data || j.result || [];
    if (!Array.isArray(arr)) arr = [arr];
    const out = [];
    for (const it of arr) {
      if (it && it.file && /\.m3u8/.test(it.file)) out.push(it.file);
    }
    return out;
  } catch { return []; }
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  const flag = String(reqIn?.body?.flag || '');
  if (/\$/.test(id)) id = id.split('$').pop().trim();

  // 1) filemoon 直接走 API
  if (/filemoon/i.test(id)) {
    const urls = await filemoonApi(id);
    if (urls.length) {
      return {
        parse: 0, url: urls[0],
        header: { 'User-Agent': UA, 'Referer': 'https://filemoon.to/' },
      };
    }
  }
  // 2) 页面里找 filemoon 再走 API
  if (/^https?:\/\//i.test(id) && !/\.m3u8/i.test(id)) {
    const html = await getText(id);
    const fm = html.match(/https?:\/\/[^"'\s<>]*filemoon[^"'\s<>]*\/(?:e|embed)\/[a-zA-Z0-9]+/i);
    if (fm) {
      const urls = await filemoonApi(fm[0]);
      if (urls.length) {
        return {
          parse: 0, url: urls[0],
          header: { 'User-Agent': UA, 'Referer': 'https://filemoon.to/' },
        };
      }
    }
    // 3) 页面直搜 m3u8
    const mu = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
    if (mu) {
      return { parse: 0, url: mu[0], header: { 'User-Agent': UA, 'Referer': id } };
    }
  }
  // 4) 已是直链
  if (/\.m3u8|\.mp4/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA } };
  }
  // 5) 嗅探
  return { parse: 1, url: id, header: { 'User-Agent': UA } };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  let url = HOST + '/?kw=' + encodeURIComponent(wd);
  if (page > 1) url += '&page=' + page;
  const html = await getText(url);
  const list = parseCards(html);
  return { page, pagecount: pagecountOf(html, page), limit: 24, total: list.length, list };
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
