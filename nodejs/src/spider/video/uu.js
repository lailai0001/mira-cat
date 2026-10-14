// UU直播破解 - CatPawOpen JS Spider
// Ported from UU.py (HOST=https://cmk.uuzbpj7.hair, 自定义CMS)
// 列表: div.video-item (封面 data-original 懒加载); 详情: /{id}.html -> const rawUrl / player_data.url 直出 m3u8
const KEY = 'py_uu';
const NAME = 'UU直播破解';
const HOST = 'https://cmk.uuzbpj7.hair';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATS = [
  ['20', '韩国美眉'], ['21', '骑兵有码'], ['22', '日韩主播'], ['23', '国产偷拍'],
  ['24', '欧美激情'], ['25', '步兵无码'], ['26', '金发幼齿'], ['27', '三级伦理'],
  ['28', '岛国中文'], ['29', '岛国无码'], ['30', '网红主播'], ['31', '自拍偷拍'],
];

const JUV = ['萝莉', '幼女', '未成年', 'teen', 'loli', 'schoolgirl', '小学生', '初中生'];
function isJuv(s) {
  const t = String(s || '').toLowerCase();
  return JUV.some((k) => t.includes(k.toLowerCase()));
}

function H() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': HOST + '/',
  };
}

async function getText(url) {
  // 注: 本站屏蔽 axios 的 TLS 指纹, 必须用 Node 原生 fetch
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { headers: H(), signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return '';
    return await r.text();
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

function absPic(p) {
  p = String(p || '').trim();
  if (!p) return '';
  if (p.startsWith('//')) return 'https:' + p;
  if (p.startsWith('/')) return HOST + p;
  if (!/^https?:\/\//i.test(p)) return HOST + '/' + p;
  return p;
}

function parseList(html) {
  const out = [];
  const items = String(html || '').match(/<div[^>]*class="video-item [^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="video-item |$)/gi) || [];
  for (const it of items) {
    let m = it.match(/href="\/(\d+)\.html"/i) || it.match(/data-href="\/(\d+)\.html"/i);
    if (!m) continue;
    const vid = m[1];
    let name = '';
    let tm = it.match(/class="[^"]*video-item-title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|a|p|h4)>/i);
    if (tm) name = stripTags(tm[1]);
    if (!name) {
      const at = it.match(/<a[^>]*title="([^"]+)"/i);
      if (at) name = at[1].trim();
    }
    if (!name) continue;
    if (isJuv(name)) continue;
    let pic = '';
    let pm = it.match(/data-original="([^"]+\.(?:jpg|jpeg|png))"/i)
      || it.match(/data-src="([^"]+\.(?:jpg|jpeg|png))"/i)
      || it.match(/<img[^>]*src="([^"]+\.(?:jpg|jpeg|png))"/i);
    if (pm) pic = absPic(pm[1]);
    out.push({ vod_id: vid, vod_name: name, vod_pic: pic, vod_remarks: '' });
    if (out.length >= 40) break;
  }
  return out;
}

function pagecountOf(html, pg) {
  const ms = String(html || '').match(/\/vodtype\/\d+-(\d+)\.html/gi) || [];
  let max = pg;
  for (const s of ms) {
    const n = parseInt(s.match(/(\d+)/)[1], 10);
    if (n > max) max = n;
  }
  return max;
}

async function init() { return {}; }

async function home() {
  const cls = CATS.map(([id, name]) => ({ type_id: id, type_name: name }));
  const filters = {};
  for (const [id] of CATS) filters[id] = {};
  return { class: cls, filters, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || body.tid || '20');
  const pg = Math.max(1, parseInt(body.page, 10) || 1);
  const url = pg > 1 ? `${HOST}/vodtype/${tid}-${pg}.html` : `${HOST}/vodtype/${tid}.html`;
  const html = await getText(url);
  const list = parseList(html);
  return { page: pg, pagecount: pagecountOf(html, pg), limit: 72, total: list.length, list };
}

async function detail(reqIn) {
  const rawIds = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vids = [];
  for (const r of (rawIds || [])) {
    const v = String(r || '').match(/(\d+)/)?.[1] || '';
    if (v && !vids.includes(v)) vids.push(v);
  }
  if (!vids.length) return { list: [] };
  const list = [];
  for (const vid of vids) {
    const html = await getText(`${HOST}/${vid}.html`);
    if (!html || html.length < 500) continue;
  let m3u8 = '';
  let m = html.match(/(?:const|let|var)\s+rawUrl\s*=\s*['"]([^'"]+)['"]/i);
  if (m) m3u8 = m[1];
  if (!m3u8) {
    m = html.match(/var\s+player_data\s*=\s*(\{.*?\})/s);
    if (m) {
      try { m3u8 = JSON.parse(m[1]).url || ''; } catch {
        const um = m[1].match(/"url"\s*:\s*"([^"]+)"/);
        if (um) m3u8 = um[1].replace(/\\\//g, '/');
      }
    }
  }
  if (!m3u8) {
    const ms = html.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/gi) || [];
    m3u8 = ms.find((u) => !/sharer|balecao/i.test(u)) || '';
  }
  if (!m3u8 || isJuv(m3u8)) continue;
  let name = '视频' + vid;
  const tm = html.match(/<title>(.*?)<\/title>/s);
  if (tm) {
    name = stripTags(tm[1])
      .replace(/[-_–—]\s*[^-_–—]*[-_–—]\s*UU直播破解.*$/, '')
      .replace(/[-_–—]\s*UU直播破解.*$/, '').trim() || name;
  }
  if (isJuv(name)) continue;
  const pm = html.match(/(?:data-original|data-src|src)="([^"]+\.(?:jpg|jpeg|png))"/i);
  list.push({
    vod_id: vid, vod_name: name, vod_pic: pm ? absPic(pm[1]) : '',
    vod_remarks: NAME, vod_play_from: NAME, vod_play_url: '第1集$' + m3u8,
  });
  }
  return { list };
}

async function play(reqIn) {
  // MiraPlayer 可能把 "第1集$https://..." 整个传过来, 先去掉 "xxx$" 前缀
  let id = String(reqIn?.body?.id || '').trim();
  if (/\$/.test(id)) id = id.split('$').pop().trim();
  if (!id) return { parse: 0, url: '', header: { 'User-Agent': UA } };
  return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
}

async function search() { return { list: [], page: 1, pagecount: 0 }; }

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
