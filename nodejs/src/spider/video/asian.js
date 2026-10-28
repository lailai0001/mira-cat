// AsianViralHub - CatPawOpen JS Spider (KVS 同构站)
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
  return makeSpider({ KEY: "py_asianviralhub", NAME: "AsianViralHub", HOST: "https://asianviralhub.com/", VIDEOPATH: "video/", CATEGORIES: [{ type_id: "leaked/", type_name: "Leaked" }, { type_id: "porn/", type_name: "Porn" }, { type_id: "sextape/", type_name: "Sextape" }, { type_id: "solo/", type_name: "Solo" }, { type_id: "av-idol/", type_name: "AV Idol" }, { type_id: "porn-actress/", type_name: "Porn Actress" }, { type_id: "ai-generated/", type_name: "AI Generated" }, { type_id: "fisting/", type_name: "Fisting" }, { type_id: "south-korean/", type_name: "South Korean" }, { type_id: "camgirl/", type_name: "Camgirl" }, { type_id: "housewife/", type_name: "Housewife" }, { type_id: "jav-uncensored/", type_name: "JAV Uncensored" }, { type_id: "xxx/", type_name: "XXX" }, { type_id: "xx/", type_name: "XX" }, { type_id: "blonde/", type_name: "Blonde" }, { type_id: "bigbooty/", type_name: "Bigbooty" }, { type_id: "hairy/", type_name: "Hairy" }, { type_id: "striptease/", type_name: "Striptease" }, { type_id: "twerking/", type_name: "Twerking" }, { type_id: "riding-dildo/", type_name: "Riding Dildo" }, { type_id: "ebony/", type_name: "Ebony" }, { type_id: "close-up/", type_name: "Close Up" }, { type_id: "fake-tits/", type_name: "Fake Tits" }, { type_id: "smoking/", type_name: "Smoking" }, { type_id: "roommate/", type_name: "Roommate" }, { type_id: "pajamas/", type_name: "Pajamas" }, { type_id: "music/", type_name: "Music" }, { type_id: "desires/", type_name: "Desires" }] });
}
