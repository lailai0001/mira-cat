// iWank TV - CatPawOpen JS Spider
// 站：https://iwank.tv/en/（视频聚合站，卡片外跳到源站）
// 已实测（2026-10-28）：
// - 首页为分类着陆页（Popular categories，120 个分类，本蜘蛛取前 30 个热门）；
// - 分类页：/en/{频道号}/{slug}/，分页 /en/{频道号}/{slug}/{n}/；
//   卡片：<a title="..." href="/go?vx={编码串}" target="_blank" data-sid> 内
//   <img src="//cdn.webclicks24.com/...jpg">，另有 <span class="dur"> 时长与源站名；
// - /go?vx= 实测 302 跳到源站视频页（如 3movs.com/videos/{id}/{slug}/，KVS 同构），
//   故详情：跟随重定向到源站页，再取其 flashvars video_url（get_file mp4），
//   取不到则回退 parse:1 用源站页嗅探；源站因视频而异，不保证每一家都通。
// - 搜索：/en/search/ 入口已见，格式待实测（见 search 实现，先按 /en/search/{kw}/ 试）。
import req from '../../util/req.js';

const KEY = 'py_iwank';
const NAME = 'iWank';
const HOST = 'https://iwank.tv/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': referer || HOST };
}
async function getText(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    return String(data || '');
  } catch { return ''; }
}
async function getWithUrl(url, referer) {
  try {
    const res = await req.get(url, { headers: H(referer), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    const finalUrl = (res && res.request && res.request.res && res.request.res.responseUrl)
      || (res && res.request && res.request.responseURL) || url;
    return { html: String(data || ''), finalUrl };
  } catch { return { html: '', finalUrl: url }; }
}
// 2026-10-29：带 cookie 罐的手动跟随抓取。诊断坐实：KVS 系 get_file 是 cookie 绑定的，
// 无 cookie 直接请求一律 403；蜘蛛原先跟随拿到 video_url 后就丢弃 cookie，play 时
// 只带 iwank 的 Referer、不带任何 cookie，走的正是那条 403 路径。
// axios 不自动存 cookie，故手动循环：maxRedirects:0，接 Location，沿途收集 Set-Cookie，
// 后续请求带上 Cookie 头。302 响应在 axios 里会抛错，正常响应与错误响应都要接。
function collectCookies(store, headers) {
  if (!headers) return;
  const sc = headers['set-cookie'] || headers['Set-Cookie'];
  if (!sc) return;
  const arr = Array.isArray(sc) ? sc : [sc];
  for (const c of arr) {
    const kv = String(c).split(';')[0].trim();
    if (!kv) continue;
    const k = kv.split('=')[0];
    store[k] = kv;
  }
}
function cookieHeader(store) {
  return Object.values(store).join('; ');
}
async function fetchWithCookies(startUrl, referer) {
  const store = {};
  let url = startUrl;
  let html = '';
  for (let i = 0; i < 10; i++) {
    const headers = H(referer);
    const ck = cookieHeader(store);
    if (ck) headers['Cookie'] = ck;
    let res = null;
    try {
      res = await req.get(url, { headers, timeout: 20000, maxRedirects: 0 });
    } catch (e) {
      res = e && e.response ? e.response : null;
      if (!res) return { html: '', finalUrl: url, cookies: store };
    }
    collectCookies(store, res.headers || {});
    const loc = res.headers && (res.headers.location || res.headers.Location);
    if (res.status >= 300 && res.status < 400 && loc) {
      try { url = new URL(loc, url).href; } catch { url = loc; }
      referer = url;
      continue;
    }
    const data = (res && res.data !== undefined) ? res.data : res;
    html = String(data || '');
    return { html, finalUrl: url, cookies: store };
  }
  return { html, finalUrl: url, cookies: store };
}
function decodeUrl(u) {
  return String(u || '').replace(/&amp;/g, '&').replace(/\\\//g, '/').replace(/\\u0026/g, '&').trim();
}
// 从源站页提取可播地址：KVS get_file、video_alt_url（低清）、<source> 直链；
// 并统一做 &amp; 解码（2026-10-29 坐实：hdsex/xxxvogue 系 <source> 里的 &amp; 原样带进
// 播放地址会 403，解码后才 200）。
function extractSourcePlay(html) {
  const m = html.match(/video_url['"]?\s*[:=]\s*['"]([^'"]+)/i)
    || html.match(/https?:\/\/[^\s"'<>]+\/get_file\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
  const out = [];
  if (m) out.push(decodeUrl(m[1]));
  const am = html.match(/video_alt_url['"]?\s*[:=]\s*['"]([^'"]+)/i);
  if (am) out.push(decodeUrl(am[1]));
  const sm = html.match(/<source[^>]*src="([^"]+\.(?:mp4|m3u8)[^"]*)"/i);
  if (sm) out.push(decodeUrl(sm[1]));
  return out.filter(Boolean);
}
function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function parseList(html) {
  const items = [];
  const seen = new Set();
  const chunks = String(html).split('<a title="');
  for (let i = 1; i < chunks.length; i++) {
    const blk = chunks[i].slice(0, 3000);
    const qm = blk.match(/^([^"]+)"[^>]*href="(\/go\?vx=[^"]+)"/i);
    if (!qm) continue;
    const title = stripTags(qm[1]);
    const url = HOST.replace(/\/$/, '') + qm[2];
    if (!title || title.length < 2 || seen.has(url)) continue;
    const pm = blk.match(/<img[^>]*src="(https?:[^"]+|[^"]*cdn\.webclicks24\.com[^"]*)"/i);
    let pic = pm ? pm[1] : '';
    if (pic && pic.startsWith('//')) pic = 'https:' + pic;
    const dm = blk.match(/<span class="dur">([^<]+)<\/span>/i);
    seen.add(url);
    items.push({ vod_id: url, vod_name: title, vod_pic: pic, vod_remarks: dm ? dm[1].trim() : '' });
    if (items.length >= 24) break;
  }
  return items;
}
const CATEGORIES = [
  { type_id: '25/mom/', type_name: 'Mom' }, { type_id: '272/interracial/', type_name: 'Interracial' },
  { type_id: '151/lesbian/', type_name: 'Lesbian' }, { type_id: '84/shemale/', type_name: 'Shemale' },
  { type_id: '4/pissing/', type_name: 'Pissing' }, { type_id: '136708/ebony_solo/', type_name: 'Ebony Solo' },
  { type_id: '237/granny/', type_name: 'Granny' }, { type_id: '521/cuckold/', type_name: 'Cuckold' },
  { type_id: '3234/wedding/', type_name: 'Wedding' }, { type_id: '1980/selfsuck/', type_name: 'Selfsuck' },
  { type_id: '817/stepmom/', type_name: 'Stepmom' }, { type_id: '14/mature/', type_name: 'Mature' },
  { type_id: '55/black/', type_name: 'Black' }, { type_id: '435/japanese/', type_name: 'Japanese' },
  { type_id: '42/homemade/', type_name: 'Homemade' }, { type_id: '301/wife/', type_name: 'Wife' },
  { type_id: '188/anal/', type_name: 'Anal' }, { type_id: '614/3d/', type_name: '3d' },
  { type_id: '83/teen/', type_name: 'Teen (18+)' }, { type_id: '13/ebony/', type_name: 'Ebony' },
  { type_id: '412/hairy/', type_name: 'Hairy' }, { type_id: '634/crossdresser/', type_name: 'Crossdresser' },
  { type_id: '1079/masturbation/', type_name: 'Masturbation' }, { type_id: '1559/old_and_young/', type_name: 'Old And Young (18+)' },
  { type_id: '6/handjob/', type_name: 'Handjob' }, { type_id: '131/creampie/', type_name: 'Creampie' },
  { type_id: '1345/vintage/', type_name: 'Vintage' }, { type_id: '448/bbw/', type_name: 'Bbw' },
  { type_id: '124406/japanese_uncensored/', type_name: 'Japanese Uncensored' }, { type_id: '8/casting/', type_name: 'Casting' },
];
async function init() { return {}; }
async function home() {
  const html = await getText(HOST + 'en/25/mom/', HOST);
  return { class: CATEGORIES, filters: {}, list: parseList(html) };
}
async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || '25/mom/');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const base = HOST + 'en/' + tid.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = page === 1 ? (base + '/') : (base + '/' + page + '/');
  const html = await getText(url, HOST);
  const list = parseList(html);
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}
async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const url = /^https?:\/\//i.test(raw) ? raw : HOST + String(raw).replace(/^\/+/, '');
    const { html, finalUrl } = await getWithUrl(url, HOST);
    const tm = html.match(/<title>([\s\S]{0,300}?)<\/title>/i);
    // 2026-10-29：详情不再直接出 get_file（无 cookie 的 get_file 播不了、还会过期）。
    // 改出源站页地址，真正的解析移到 play() 里现取现解（带 cookie、跟随到 CDN）。
    list.push({
      vod_id: raw,
      vod_name: tm ? stripTags(tm[1]) : 'iWank',
      vod_pic: '',
      vod_play_from: 'iWank',
      vod_play_url: '播放$' + finalUrl,
    });
  }
  return { list };
}
async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  id = decodeUrl(id);
  // 已是直链文件：直接播（兼容旧详情与 <source> 系）
  if (/\.(m3u8|mp4)(\?|#|$)/i.test(id)) {
    return { parse: 0, url: id, header: H(HOST) };
  }
  // 源站页：带 cookie 罐重抓，提取 get_file/<source>，再跟随一次 302 到 CDN 直链才播
  try {
    const { html, finalUrl, cookies } = await fetchWithCookies(id, HOST);
    const cands = extractSourcePlay(html);
    for (const cand of cands) {
      if (/get_file/i.test(cand)) {
        // get_file 本身只是中转：带 cookie 跟随 302，拿到 mjedge.net CDN 直链
        const ck = cookieHeader(cookies);
        const headers = H(finalUrl);
        if (ck) headers['Cookie'] = ck;
        try {
          const r = await req.get(cand, { headers, timeout: 20000, maxRedirects: 0 });
          const loc = r.headers && (r.headers.location || r.headers.Location);
          if (loc) {
            try { return { parse: 0, url: new URL(loc, cand).href, header: H(finalUrl) }; } catch { return { parse: 0, url: loc, header: H(finalUrl) }; }
          }
          if (r.status === 200) return { parse: 0, url: cand, header: H(finalUrl) };
        } catch (e) {
          const rr = e && e.response;
          const loc = rr && rr.headers && (rr.headers.location || rr.headers.Location);
          if (loc) {
            try { return { parse: 0, url: new URL(loc, cand).href, header: H(finalUrl) }; } catch { return { parse: 0, url: loc, header: H(finalUrl) }; }
          }
        }
        continue;
      }
      return { parse: 0, url: cand, header: H(finalUrl) };
    }
    // 实在提不出静态流：直接报错返回，不再把源站页交给 parse:1 无限嗅探
    return { parse: 0, url: '', header: {} };
  } catch {
    return { parse: 0, url: '', header: {} };
  }
}
async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  let url = HOST + 'en/search/' + encodeURIComponent(wd) + '/';
  if (page > 1) url += page + '/';
  const html = await getText(url, HOST);
  const list = parseList(html);
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
