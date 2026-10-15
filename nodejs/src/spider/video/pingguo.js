// 苹果视频 - MiraPlayer JS Spider
// 站点: https://618041.xyz (Python upload-14.py 转换)
// 标题为 XOR-128 加密, 特殊分区(13/14/40/9)列表直接带 m3u8
// 请求: 双通道 — 先框架 req(axios, MiraPlayer 内核可用),失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_pingguo';
const NAME = '苹果视频';
const HOST = 'https://618041.xyz';
const API_HOST = 'https://h5.xxoo168.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const CATEGORIES = [
  { type_id: '1', type_name: '全部视频' },
  { type_id: '13', type_name: '香蕉精品' },
  { type_id: '22', type_name: '制服诱惑' },
  { type_id: '6', type_name: '国产视频' },
  { type_id: '8', type_name: '清纯少女' },
  { type_id: '9', type_name: '辣妹大奶' },
  { type_id: '10', type_name: '女同专属' },
  { type_id: '11', type_name: '素人出演' },
  { type_id: '12', type_name: '角色扮演' },
  { type_id: '20', type_name: '人妻熟女' },
  { type_id: '23', type_name: '日韩剧情' },
  { type_id: '21', type_name: '经典伦理' },
  { type_id: '7', type_name: '成人动漫' },
  { type_id: '14', type_name: '精品二区' },
  { type_id: '53', type_name: '动漫中字' },
  { type_id: '52', type_name: '日本无码' },
  { type_id: '33', type_name: '中文字幕' },
  { type_id: '44', type_name: '国产传媒' },
  { type_id: '32', type_name: '国产自拍' },
];

// 特殊分区: 列表 href 直接带 v=直链m3u8
const SPECIAL_CATS = new Set(['13', '14', '40', '9']);

function decryptTitle(enc) {
  try {
    let out = '';
    const s = String(enc || '');
    for (let i = 0; i < s.length; i++) {
      out += String.fromCharCode(s.charCodeAt(i) ^ 128);
    }
    return out;
  } catch { return String(enc || ''); }
}

function absUrl(u) {
  u = String(u || '').trim().replace(/&amp;/g, '&');
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

function getQueryParam(url, key) {
  try {
    const q = String(url).split('?')[1] || '';
    const params = new URLSearchParams(q);
    return params.get(key) || '';
  } catch { return ''; }
}

async function getText(url, retries = 2) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': HOST + '/',
  };
  for (let i = 0; i < retries; i++) {
    // 通道1: 框架 req (axios) — MiraPlayer 内核可用
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const t = String(data || '');
      if (status === 200 && t.length > 1000) return t;
    } catch { /* 换通道2 */ }
    // 通道2: Node 原生 fetch
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.length > 1000) return t;
    } catch { /* retry */ }
  }
  return '';
}

async function getJson(url, retries = 2) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json,*/*',
    'Referer': HOST + '/',
    'Origin': HOST,
    'X-Requested-With': 'XMLHttpRequest',
  };
  for (let i = 0; i < retries; i++) {
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'json' });
      if (status === 200 && data) return data;
    } catch { /* 换通道2 */ }
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const data = await r.json();
      if (data) return data;
    } catch { /* retry */ }
  }
  return null;
}

function parseList(html, categoryId) {
  const videos = [];
  if (!html) return videos;
  const items = html.match(/<a class="vodbox"[\s\S]*?<\/a>/g) || [];
  const seen = new Set();
  for (const item of items) {
    const hm = item.match(/href="([^"]+)"/);
    if (!hm) continue;
    const href = hm[1].replace(/&amp;/g, '&');
    const fullHref = absUrl(href.split('?')[0]) + (href.includes('?') ? '?' + href.split('?').slice(1).join('?') : '');

    // 标题
    let titleEnc = '';
    let tm = item.match(/<p class="km-script">([\s\S]*?)<\/p>/);
    if (tm) titleEnc = tm[1].trim();
    if (!titleEnc) continue;
    const title = decryptTitle(titleEnc);
    if (!title || title.length < 2) continue;

    // 封面
    let pic = '';
    let pm = item.match(/data-original="([^"]+)"/);
    if (!pm) pm = item.match(/<img[^>]+src="([^"]+)"/);
    if (pm) pic = absUrl(pm[1]);

    const isSpecial = SPECIAL_CATS.has(String(categoryId));
    const vParam = getQueryParam(href, 'v');
    const mParam = getQueryParam(href, 'm');

    let vodId;
    if (isSpecial && vParam) {
      // 特殊分区: 直链已在 href 里
      vodId = 'pgs_' + encodeURIComponent(vParam);
    } else if (mParam) {
      vodId = 'pg_' + mParam;
    } else {
      // 兜底: 用 href hash
      let h = 0;
      for (let i = 0; i < href.length; i++) h = ((h << 5) - h + href.charCodeAt(i)) | 0;
      vodId = 'pg_' + Math.abs(h);
    }
    if (seen.has(vodId)) continue;
    seen.add(vodId);

    videos.push({
      vod_id: vodId,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: '',
      vod_year: '',
    });
  }
  return videos;
}

async function init() { return {}; }

async function home() {
  // 首页是跳转占位页, 直接用分类1的内容做推荐
  const html = await getText(`${HOST}/index.php/vod/type/id/1.html`);
  const list = parseList(html, '1');
  return {
    class: CATEGORIES.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    filters: {},
    list: list.slice(0, 20),
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || '1');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let url = `${HOST}/index.php/vod/type/id/${tid}.html`;
  if (page > 1) url = `${HOST}/index.php/vod/type/id/${tid}/page/${page}.html`;
  const html = await getText(url);
  const list = parseList(html, tid);
  return { page, pagecount: 999, limit: 20, total: 19980, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const vodId = String(raw).trim();
    if (vodId.startsWith('pgs_')) {
      // 特殊分区: 从 vod_id 还原直链
      let playUrl = '';
      try { playUrl = decodeURIComponent(vodId.slice(4)); } catch { playUrl = ''; }
      // 尝试从列表缓存拿标题封面, 拿不到就用占位
      list.push({
        vod_id: vodId,
        vod_name: '视频',
        vod_pic: '',
        vod_play_from: NAME,
        vod_play_url: `第1集$${playUrl}`,
      });
      continue;
    }
    // 常规: vod_id = pg_{video_id}, 走 API 拿直链
    const videoId = vodId.replace(/^pg_/, '');
    const apiData = await getJson(`${API_HOST}/api/v2/vod/reqplay/${videoId}`);
    let playUrl = '';
    if (apiData) {
      const d = apiData.data || {};
      playUrl = (apiData.retcode === 3 ? d.httpurl_preview : d.httpurl) || d.httpurl || '';
      playUrl = String(playUrl).replace('?300', '');
    }
    if (!playUrl) {
      // API 失败时回退到嗅探
      playUrl = `${HOST}/html/kkyd.html?m=${videoId}`;
      list.push({
        vod_id: vodId,
        vod_name: `视频${videoId}`,
        vod_pic: '',
        vod_play_from: NAME,
        vod_play_url: `第1集$${playUrl}`,
      });
      continue;
    }
    list.push({
      vod_id: vodId,
      vod_name: `视频${videoId}`,
      vod_pic: '',
      vod_play_from: NAME,
      vod_play_url: `第1集$${playUrl}`,
    });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  if (!id) return { parse: 0, url: '', header: {} };

  // 特殊分区直链
  if (id.startsWith('pgs_')) {
    let playUrl = '';
    try { playUrl = decodeURIComponent(id.slice(4)); } catch { playUrl = ''; }
    if (playUrl) {
      return { parse: 0, url: playUrl, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
    }
  }

  // 完整 URL 直接返回
  if (/^https?:\/\//i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }

  // 常规: pg_{video_id} 走 API
  const videoId = id.replace(/^pg_/, '');
  const apiData = await getJson(`${API_HOST}/api/v2/vod/reqplay/${videoId}`);
  if (apiData) {
    const d = apiData.data || {};
    let playUrl = (apiData.retcode === 3 ? d.httpurl_preview : d.httpurl) || d.httpurl || '';
    playUrl = String(playUrl).replace('?300', '');
    if (playUrl) {
      return { parse: 0, url: playUrl, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
    }
  }

  // 兜底: 嗅探
  return { parse: 1, url: `${HOST}/html/kkyd.html?m=${videoId}`, header: {} };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const key = String(body.wd || body.key || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!key) return { page: 1, pagecount: 0, limit: 20, total: 0, list: [] };
  const url = `${HOST}/index.php/vod/type/id/1/wd/${encodeURIComponent(key)}/page/${page}.html`;
  const html = await getText(url);
  const list = parseList(html, '1');
  return { page, pagecount: 5, limit: 20, total: 100, list };
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
