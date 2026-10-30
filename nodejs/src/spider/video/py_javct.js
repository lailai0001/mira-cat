// JavCT - CatPawOpen JS Spider（2026-10-30 新源）
// 站点：https://javct.net/（与 sextb 同模板 family，2026-10-30 用户提示 sextb
// 同款后经浏览器核实坐实）
// 结构（浏览器 + jina 实测）：
//  - 列表：卡片 <a href="/v/{slug}" class="card__play">，标题 card__title，
//    封面懒加载：src 是 default-cover.jpg 占位图，真实封面在 data-src
//    （https://cdn001.imggle.net/webp/poster/…，与 sextb 同款写法）。
//  - 分类（导航实测）：素人 /amateur，有码 /censored，无码 /uncensored，
//    字幕 /subtitle；各分类 Latest Update = 裸路径，New Releases =
//    ?sort=new-releases，Most Viewed = ?sort=most-viewed；
//    另有 /categories、/studios、/models 索引；LIVE SEX 是外链（chattb.net），不用。
//  - 详情：/v/{slug}；h1 = 番号 + 标题；元数据 Label / Studio / Model /
//    Categories / Running time / Release Date / Views；真实封面
//    cdn001.imggle.net/thumb/…jpg 与 /webp/poster/…webp。
//  - 播放（main.js 流程，浏览器实测）：服务器按钮
//    <button class="switch-source btn-player episode" data-source="{filmId}"
//    data-id="{episode}">F4</button>（默认激活 F4；另有 FL、US；
//    VIP 按钮 class 含 btn-player-vip，绝不碰）；页内全局
//    window.__pt / window.__pk（每页现值，play 时现取）；
//    点击 → POST /ajax/player，body {episode, filmId, pt}，头
//    X-Requested-With: XMLHttpRequest；返回 JSON，item.error 则失败，
//    嵌页 = item.player_enc ? xorDecrypt(item.player_enc, __pk)
//    : item.player；响应可能带 next_pt/next_pk（轮换链，蜘蛛只用首 POST）。
//  - 嵌页按 host 分流（与 sextb 同款，Worker 已部署且通用）：
//    F4（f4scdn/f4jav）→ sextb-hls Worker /f4?u={embed}&r={detail}；
//    其他 host → Worker /v?u={embed}&r={detail}。
//  - 本站给的是服务器选择（F4/FL/US），不是分辨率档，不编造清晰度。
//  - 站方有 WAF（VM 直连 403）：蜘蛛先 GET 首页暖会话再抓详情/ajax，
//    App 的 req 能否过墙、cookie 是否跨请求保持，均待真机验。
//  - xorDecrypt：main.js 原文已于 2026-10-30 经浏览器实测回传并逐字
//    对应：atob 解码后与 __pk 循环异或（密钥为空则只解码）；
//    猫源内 base64 走 Buffer（atob 不一定可用），其余逻辑与原文一致。
import req from '../../util/req.js';

const KEY = 'py_javct';
const NAME = 'JavCT';
const HOST = 'https://javct.net';
const WORKER = 'https://sextb-hls.li768435813.workers.dev';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || HOST + '/',
  };
}

async function getText(url, referer) {
  try {
    const { data } = await req.get(url, { headers: H(referer), timeout: 15000 });
    return String(data || '');
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function b64Decode(s) {
  let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  try { return Buffer.from(t, 'base64').toString('latin1'); } catch { return ''; }
}

function xorStr(raw, key) {
  if (!key) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

function latin1ToUtf8(s) {
  try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; }
}

// xorDecrypt：main.js 原文（2026-10-30 浏览器实测回传，逐字对应）：
// 先 atob 解码，密钥为空则直接返回解码串；否则逐字符与 key 循环异或。
// 猫源运行环境 atob 不一定可用，故 base64 一律走 Buffer（已确认可用），
// 其余逻辑与原文完全一致；解出串再转 utf8 供后续正则取 iframe。
function xorDecrypt(enc, key) {
  if (!enc) return '';
  const decoded = b64Decode(enc);
  if (!key) return latin1ToUtf8(decoded);
  return latin1ToUtf8(xorStr(decoded, key));
}

function isF4Host(host) { return /f4scdn\.com|f4jav\.xyz/i.test(host || ''); }
function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^\/]+)/i);
  return m ? m[1] : '';
}
function workerUrl(embed, durl) {
  const host = hostOf(embed);
  const path = isF4Host(host) ? '/f4' : '/v';
  return WORKER + path + '?u=' + encodeURIComponent(embed) + '&r=' + encodeURIComponent(durl);
}

function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<a[^>]*href="(https:\/\/javct\.net\/v\/[a-z0-9\-]+|\/v\/[a-z0-9\-]+)"[^>]*class="[^"]*card__play[^"]*"[^>]*>([\s\S]{0,1500}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (!/^https?:\/\//i.test(href)) href = HOST + href;
    if (seen.has(href)) continue;
    seen.add(href);
    const inner = m[2];
    let pic = '';
    const im = inner.match(/<img[^>]*>/i);
    if (im) {
      const dm = im[0].match(/data-src="([^"]+)"/i);
      const sm = im[0].match(/src="([^"]+)"/i);
      const cand = (dm && dm[1]) || (sm && sm[1]) || '';
      if (cand && !/default-cover/i.test(cand) && !/data:image/i.test(cand)) {
        pic = /^https?:\/\//i.test(cand) ? cand : HOST + (cand.startsWith('/') ? cand : '/' + cand);
      }
    }
    items.push({ vod_id: href, vod_name: '', vod_pic: pic, vod_remarks: '' });
    if (items.length >= 60) break;
  }
  // 标题与番号：card__title 块与卡片一一对应，按顺序补
  const titles = [...html.matchAll(/class="[^"]*card__title[^"]*"[^>]*>([\s\S]{0,500}?)<\/[^>]+>/gi)].map(x => stripTags(x[1]));
  const codes = [...html.matchAll(/<a[^>]*href="https:\/\/javct\.net\/v\/[a-z0-9\-]+"[^>]*>([A-Z0-9\-]{4,})<\/a>/gi)].map(x => x[1]);
  items.forEach((it, i) => {
    if (titles[i]) it.vod_name = titles[i];
    if (codes[i]) it.vod_remarks = codes[i];
    if (!it.vod_name) it.vod_name = it.vod_remarks || 'JavCT';
  });
  return items.filter(it => it.vod_name && it.vod_name.length >= 2);
}

const CATS = [
  { type_id: '/amateur', type_name: '素人' },
  { type_id: '/censored', type_name: '有码' },
  { type_id: '/uncensored', type_name: '无码' },
  { type_id: '/subtitle', type_name: '字幕' },
];

async function warmSession() {
  await getText(HOST + '/', HOST + '/');
}

async function init() { return {}; }

async function home() {
  await warmSession();
  const html = await getText(HOST + '/', HOST + '/');
  return { class: CATS, filters: {}, list: parseCards(html) };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  let tid = String(body.id || '');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!tid) tid = '/amateur';
  const base = (/^https?:\/\//i.test(tid) ? tid : HOST + '/' + tid.replace(/^\/+/, '')).replace(/\/+$/, '');
  const url = page === 1 ? base : base + (base.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page;
  await warmSession();
  const html = await getText(url, HOST + '/');
  const list = parseCards(html);
  return { page, pagecount: 9999, limit: 90, total: list.length ? 999999 : 0, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    let durl = String(raw).trim();
    if (!/^https?:\/\//i.test(durl)) durl = HOST + (durl.startsWith('/') ? durl : '/' + durl);
    await warmSession();
    const html = await getText(durl, HOST + '/');
    // jina 加工页会混入假 <h1>403 Forbidden</h1>，故 og:title 优先，
    // 其次 section__title，再次任意 h1，且跳过错误页标题
    const cands = [];
    const ogt = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogt) cands.push(ogt[1]);
    const sht = html.match(/<h1[^>]*class="[^"]*section__title[^"]*"[^>]*>([\s\S]{0,400}?)<\/h1>/i);
    if (sht) cands.push(sht[1]);
    const h1t = html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i);
    if (h1t) cands.push(h1t[1]);
    let title = 'JavCT';
    for (const c of cands) {
      const t = stripTags(c);
      if (t && !/^(403|404|500|Forbidden|Not Found)/i.test(t)) { title = t; break; }
    }
    let pic = '';
    const ogm = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogm) pic = ogm[1];
    if (!pic) {
      const im = html.match(/https:\/\/cdn001\.imggle\.net\/[^"'\s<>]+/i);
      if (im) pic = im[0];
    }
    const filmM = html.match(/filmId\s*=\s*["']?(\d+)/i)
      || html.match(/data-source="(\d+)"/i);
    const filmId = filmM ? filmM[1] : '';
    const ptM = html.match(/window\.__pt\s*=\s*"([^"]+)"/i);
    const pkM = html.match(/window\.__pk\s*=\s*"([^"]+)"/i);
    const pt = ptM ? ptM[1] : '';
    const pk = pkM ? pkM[1] : '';
    const lines = [];
    const btnRe = /<button[^>]*class="[^"]*btn-player[^"]*"[^>]*>([\s\S]{0,80}?)<\/button>/gi;
    let bm;
    while ((bm = btnRe.exec(html)) !== null) {
      const tag = bm[0];
      if (/btn-player-vip/i.test(tag)) continue; // VIP 绝不碰
      const dm = tag.match(/data-id="(\d+)"/i);
      const sm = tag.match(/data-source="(\d+)"/i);
      const name = stripTags(bm[1]) || '播放';
      const episode = dm ? dm[1] : '';
      const fsrc = sm ? sm[1] : filmId;
      if (!episode || !fsrc) continue;
      lines.push(name + '$' + fsrc + '|' + episode + '|' + pt + '|' + pk + '|' + durl);
    }
    if (!lines.length) lines.push('网页播放$' + durl);
    list.push({ vod_id: raw, vod_name: title, vod_pic: pic, vod_play_from: NAME, vod_play_url: lines.join('#') });
  }
  return { list };
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  if (/\.m3u8(\?|$)/i.test(id) || /\.mp4(\?|$)/i.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  // 服务器线：filmId|episode|pt|pk|durl
  const parts = id.split('|');
  if (parts.length < 5) {
    return { parse: 1, url: /^https?:\/\//i.test(id) ? id : HOST + '/', header: { 'User-Agent': UA, 'Referer': HOST + '/' } };
  }
  const filmId = parts[0], episode = parts[1], pt = parts[2], pk = parts[3];
  const durl = parts.slice(4).join('|');
  let ajaxUrl = '';
  try { ajaxUrl = new URL(durl).origin + '/ajax/player'; } catch { return { parse: 0, url: '' }; }
  const body = 'episode=' + encodeURIComponent(episode) + '&filmId=' + encodeURIComponent(filmId) + '&pt=' + encodeURIComponent(pt);
  let json = null;
  try {
    const { data, status } = await req.post(ajaxUrl, body, {
      headers: {
        'User-Agent': UA,
        'Referer': durl,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 15000,
    });
    if (status === 200 && data != null) {
      json = typeof data === 'string' ? JSON.parse(data) : data;
    }
  } catch {}
  if (!json || json.error) return { parse: 0, url: '' };
  let playerHtml = '';
  if (json.player_enc) playerHtml = xorDecrypt(json.player_enc, pk || '');
  else if (json.player) playerHtml = String(json.player);
  if (!playerHtml) return { parse: 0, url: '' };
  const em = playerHtml.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/i)
    || playerHtml.match(/<iframe[^>]+src="(\/\/[^"]+)"/i);
  if (em) {
    let embed = em[1];
    if (embed.startsWith('//')) embed = 'https:' + embed;
    return { parse: 0, url: workerUrl(embed, durl), header: { 'User-Agent': UA, 'Referer': durl } };
  }
  const mm = playerHtml.match(/https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/i);
  if (mm) return { parse: 0, url: mm[0], header: { 'User-Agent': UA, 'Referer': durl } };
  return { parse: 0, url: '' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 90, total: 0, list: [] };
  const base = HOST + '/search/' + encodeURIComponent(wd);
  const url = page === 1 ? base : base + '?page=' + page;
  await warmSession();
  const html = await getText(url, HOST + '/');
  const list = parseCards(html);
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
