// UltraThots - CatPawOpen JS Spider (KVS 同构站)
import req from '../../util/req.js';
// KVS tube 通用模板（camhub / ultrathots / asianviralhub 三站同构，仅配置不同）
// 已实测（2026-10-28）：
// - 列表卡：<a href="{HOST}{VIDEOPATH}{id}/{slug}/" title="..."> 内
//   <img data-original=".../336x189/1.jpg">（camhub/asian）或
//   <img src=".../506x285/6.jpg">（ultra）；
// - 详情：flashvars 里 video_url 即 get_file mp4 直链（带 v-acctoken 时效参数，
//   详情时现取），preview_url 为封面；
// - 分类：/categories/{slug}/，分页 /categories/{slug}/{n}/（camhub/ultra 实测第 2 页通；
//   asian 以 leaked/porn/sextape/solo 第 2 页 25 条验证，个别小分类不足一页会 404 属正常）；
// - 搜索：/search/{kw}/（三站均实测出结果）。


function makeSpider({ KEY, NAME, HOST, VIDEOPATH, CATEGORIES }) {
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
  function stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  }
  function parseList(html) {
    const items = [];
    const seen = new Set();
    const escHost = HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('<a[^>]*href="(' + escHost + VIDEOPATH + '\\d+/[^"]+)"[^>]*title="([^"]*)"', 'gi');
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = m[1];
      if (seen.has(url)) continue;
      const seg = html.slice(m.index, m.index + 3000);
      const im = seg.match(/data-original="(https?:[^"]+)"/i) || seg.match(/<img[^>]*src="(https?:[^"]+)"/i);
      const title = stripTags(m[2]);
      if (!title || title.length < 2) continue;
      seen.add(url);
      items.push({ vod_id: url, vod_name: title, vod_pic: im ? im[1] : '' });
      if (items.length >= 24) break;
    }
    return items;
  }
  async function init() { return {}; }
  async function home() {
    const html = await getText(HOST, HOST);
    return { class: CATEGORIES, filters: {}, list: parseList(html) };
  }
  async function category(reqIn) {
    const body = reqIn?.body || {};
    const tid = String(body.id || CATEGORIES[0].type_id);
    const page = Math.max(1, parseInt(body.page, 10) || 1);
    const base = HOST + 'categories/' + tid.replace(/^\/+/, '').replace(/\/+$/, '');
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
      const html = await getText(url, HOST);
      const tm = html.match(/<title>([\s\S]{0,300}?)<\/title>/i);
      const vm = html.match(/video_url['"]?\s*[:=]\s*['"]([^'"]+)/i) || html.match(/https?:\/\/[^\s"'<>]+\/get_file\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
      const pm = html.match(/preview_url['"]?\s*[:=]\s*['"]([^'"]+)/i);
      const videoUrl = vm ? vm[1] : '';
      list.push({
        vod_id: raw,
        vod_name: tm ? stripTags(tm[1]) : NAME,
        vod_pic: pm ? pm[1] : '',
        vod_play_from: NAME,
        vod_play_url: videoUrl ? ('播放$' + videoUrl) : ('未找到视频源$' + raw),
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
    let url = HOST + 'search/' + encodeURIComponent(wd) + '/';
    if (page > 1) url += page + '/';
    const html = await getText(url, HOST);
    const list = parseList(html);
    return { page, pagecount: 9999, limit: 90, total: list.length, list };
  }
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

export default function createSpider() {
  return makeSpider({ KEY: "py_ultrathots", NAME: "UltraThots", HOST: "https://ultrathots.com/", VIDEOPATH: "videos/", CATEGORIES: [{ type_id: "australian/", type_name: "Australian" }, { type_id: "british/", type_name: "British" }, { type_id: "canadian/", type_name: "Canadian" }, { type_id: "italian/", type_name: "Italian" }, { type_id: "onlyfans/", type_name: "Onlyfans" }, { type_id: "amateur/", type_name: "Amateur" }, { type_id: "big-tits/", type_name: "Big Tits" }, { type_id: "babe/", type_name: "Babe" }, { type_id: "big-ass/", type_name: "Big Ass" }, { type_id: "masturbation/", type_name: "Masturbation" }, { type_id: "blowjob/", type_name: "Blowjob" }, { type_id: "sextapes/", type_name: "Sextapes" }, { type_id: "solo-female/", type_name: "Solo Female" }, { type_id: "blonde/", type_name: "Blonde" }, { type_id: "hardcore/", type_name: "Hardcore" }, { type_id: "toys/", type_name: "Toys" }, { type_id: "pov/", type_name: "Pov" }, { type_id: "cumshot/", type_name: "Cumshot" }, { type_id: "anal/", type_name: "Anal" }, { type_id: "big-dick/", type_name: "Big Dick" }, { type_id: "tattooed-women/", type_name: "Tattooed Women" }, { type_id: "brunette/", type_name: "Brunette" }, { type_id: "milf/", type_name: "Milf" }, { type_id: "striptease/", type_name: "Striptease" }, { type_id: "lesbian/", type_name: "Lesbian" }, { type_id: "asian/", type_name: "Asian" }, { type_id: "threesome/", type_name: "Threesome" }, { type_id: "public/", type_name: "Public" }, { type_id: "bbc/", type_name: "Bbc" }, { type_id: "ppv/", type_name: "Ppv" }, { type_id: "creampie/", type_name: "Creampie" }, { type_id: "joi/", type_name: "Joi" }, { type_id: "german/", type_name: "German" }] });
}
