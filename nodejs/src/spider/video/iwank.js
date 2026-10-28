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
    const vm = html.match(/video_url['"]?\s*[:=]\s*['"]([^'"]+)/i)
      || html.match(/https?:\/\/[^\s"'<>]+\/get_file\/[^\s"'<>]+\.mp4[^\s"'<>]*/i)
      || html.match(/<source[^>]*src="([^"]+\.(?:mp4|m3u8)[^"]*)"/i);
    const videoUrl = vm ? vm[1] : '';
    list.push({
      vod_id: raw,
      vod_name: tm ? stripTags(tm[1]) : 'iWank',
      vod_pic: '',
      vod_play_from: 'iWank',
      vod_play_url: videoUrl ? ('播放$' + videoUrl) : ('播放$' + finalUrl),
    });
  }
  return { list };
}
async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  return { parse: isVideo ? 0 : 1, url: id, header: H(HOST) };
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
