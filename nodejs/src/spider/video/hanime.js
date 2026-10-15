import req from '../../util/req.js';
import * as cheerio from 'cheerio';

// XPTV 来源: https://raw.githubusercontent.com/fangkuia/XPTV/main/js/hanime.js（来自‘Y哥’）
// 站点: hanime1.me（里番动画站）

const KEY = 'py_hanime';
const NAME = 'Hanime';
const HOST = 'https://hanime1.me';
// 官方 App 指定的主备域名（ghostcoder42/hanime1）：hanimeone.me 为主，hanime1.me 为备
const HOSTS = ['https://hanime1.me', 'https://hanimeone.me'];
let ACTIVE_HOST = HOSTS[0];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1';

function headers() {
  return {
    'User-Agent': UA,
    Referer: ACTIVE_HOST + '/',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  };
}

function isChallenge(html) {
  return /Just a moment|cf-challenge|challenge-platform|Attention Required|cf_clearance/i.test(html);
}

// 单次请求：先框架 req（App 内走原生网络栈），失败再降级原生 fetch
// 移动端 + VPN 较慢，超时放宽到 30 秒，每个通道重试 1 次
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function reqOnce(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await req.get(url, { headers: headers(), timeout: 30000 });
      const t = String(data || '');
      if (t && t.length > 5000 && !isChallenge(t)) return t;
    } catch (e) { /* fallthrough to retry/fetch */ }
    if (typeof fetch !== 'undefined') {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 30000);
        const r = await fetch(url, { headers: headers(), signal: ctl.signal });
        clearTimeout(timer);
        const t = await r.text();
        if (t && t.length > 5000 && !isChallenge(t)) return t;
      } catch (e) { /* fallthrough */ }
    }
    if (attempt === 0) await sleep(1500);
  }
  return '';
}

function hostCandidates(url) {
  const out = [url];
  for (const h of HOSTS) {
    const swapped = String(url).replace(/^https?:\/\/[^/]+/, h);
    if (!out.includes(swapped)) out.push(swapped);
  }
  return out;
}

async function getHtml(url) {
  for (const u of hostCandidates(url)) {
    const t = await reqOnce(u);
    if (t) {
      const m = String(u).match(/^https?:\/\/[^/]+/);
      if (m) ACTIVE_HOST = m[0];
      return t;
    }
  }
  return '';
}

// 注意: 站点有 Cloudflare("Just a moment...") 检查，XPTV 原版通过 $utils.openSafari 处理，
// CatPawOpen 环境下无此能力；此处做挑战页识别 + 主备域名轮询，尽代码侧最大努力。

// ---------- getTabs（XPTV 原逻辑） ----------
async function getTabs() {
  const list = [];
  const ignore = ['新番預告', 'H漫畫', '無碼黃油'];
  const isIgnoreClassName = (className) => ignore.some((el) => className.includes(el));

  const html = await getHtml(HOST);
  if (!html) return list;
  const $ = cheerio.load(html);

  $('#main-nav-home > a.nav-item').each((i, e) => {
    const name = $(e).text().trim();
    const href = $(e).attr('href');
    if (!name || !href) return;
    if (isIgnoreClassName(name)) return;

    let ui = 1;
    if (name.includes('裏番') || name.includes('泡麵番')) {
      ui = 0;
    }
    // XPTV 原版 tab 的 ext 只有 url（无 id），此处直接以 url 作为 type_id；
    // 过滤掉指向站外的推广 tab（如 erodalabs 广告），分类请求只能走本站
    const abs = href.startsWith('http') ? href : `${ACTIVE_HOST}${href}`;
    if (!isInnerDomain(abs)) return;
    list.push({ name, ui, ext: { url: encodeURI(abs) } });
  });

  return list;
}

// ---------- getCards（XPTV 原逻辑） ----------
function absUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return `${ACTIVE_HOST}${u}`;
  return u;
}

function isInnerDomain(href) {
  if (href && href.includes('://')) {
    const m = href.match(/https?:\/\/([^/]+)/);
    if (m) {
      const domain = m[1].toLowerCase();
      const ok = ['hanime1.me', 'hanimeone.me'].some(
        (d) => domain === d || domain.endsWith('.' + d)
      );
      if (!ok) return false;
    }
  }
  return true;
}

function parseCards($, rootSel) {
  const cards = [];
  let videoContainers = $(rootSel).filter('.video-item-container');
  if (videoContainers.length === 0) {
    videoContainers = $('.home-rows-videos-wrapper > a, .content-padding-new > .row > .search-doujin-videos.col-xs-6');
  }

  videoContainers.each((_, element) => {
    const $el = $(element);
    let href, title, cover;

    if ($el.hasClass('video-item-container')) {
      const videoLink = $el.find('.video-link');
      href = videoLink.attr('href');
      title = $el.find('.title').text().trim();
      cover = $el.find('.main-thumb').attr('src');

      const stats = { likes: '', views: '', subtitle: '' };
      $el.find('.stat-item').each((i, statEl) => {
        const text = $(statEl).text().trim();
        if (i === 0) stats.likes = text.replace('thumb_up', '').trim();
        else if (i === 1) stats.views = text;
      });
      stats.subtitle = $el.find('.subtitle a').text().trim();
      const duration = $el.find('.duration').text().trim();

      const remarks = [];
      if (stats.likes) remarks.push(stats.likes);
      if (stats.views) remarks.push(stats.views);

      if (!isInnerDomain(href)) return;

      const finalHref = absUrl(href);

      cards.push({
        vod_id: finalHref,
        vod_name: title,
        vod_pic: cover || '',
        vod_remarks: remarks.join(' · '),
        vod_duration: duration,
        ext: { url: finalHref, duration, subtitle: stats.subtitle, stats },
      });
    } else {
      href = $el.attr('href') || $el.find('.overlay').attr('href');
      if (!isInnerDomain(href)) return;

      title = $el.find('.home-rows-videos-title').text() || $el.find('.card-mobile-title').text();
      cover = $el.find('img').attr('src');
      if (cover && cover.includes('background')) {
        cover = $el.find('img').eq(1).attr('src');
      }

      const finalHref = absUrl(href);

      cards.push({
        vod_id: finalHref,
        vod_name: title,
        vod_pic: cover || '',
        vod_remarks: '',
        ext: { url: finalHref },
      });
    }
  });

  return cards;
}

async function getCards(ext) {
  ext = typeof ext === 'string' ? JSON.parse(ext) : (ext || {});
  const { page = 1, url } = ext;
  let fetchUrl = String(url || '');
  if (page > 1) fetchUrl += `&page=${page}`;

  const html = await getHtml(fetchUrl);
  if (!html) return { list: [] };
  const $ = cheerio.load(html);
  return { list: parseCards($, '.video-item-container') };
}

// ---------- getTracks（XPTV 原逻辑） ----------
async function getTracks(ext) {
  ext = typeof ext === 'string' ? JSON.parse(ext) : (ext || {});
  const url = String(ext.url || '');
  const tracks = [];

  const html = await getHtml(url);
  if (!html) return { list: [], tracks };
  const $ = cheerio.load(html);

  const videoElement = $('video#player');
  const mainSrc = videoElement.attr('src');
  const sourceTags = videoElement.find('source');

  if (mainSrc) {
    tracks.push({ name: '默认播放', pan: '', ext: { url, quality: 'default' } });
  }

  sourceTags.each((index, element) => {
    const src = $(element).attr('src');
    const size = $(element).attr('size') || 'unknown';
    if (src) {
      tracks.push({ name: `${size}p`, pan: '', ext: { url, quality: size, sourceIndex: index } });
    }
  });

  return { list: [{ title: '清晰度选择', tracks }], tracks, $ };
}

// ---------- getPlayinfo（XPTV 原逻辑） ----------
async function getPlayinfo(ext) {
  ext = typeof ext === 'string' ? JSON.parse(ext) : (ext || {});
  const url = String(ext.url || '');
  const quality = ext.quality || 'default';

  const html = await getHtml(url);
  if (!html) return { urls: [], quality };
  const $ = cheerio.load(html);
  const videoElement = $('video#player');

  let playUrl = '';
  if (quality === 'default') {
    playUrl = videoElement.attr('src') || '';
  } else {
    const sourceElement = videoElement.find(`source[size="${quality}"]`);
    if (sourceElement.length > 0) {
      playUrl = sourceElement.attr('src') || '';
    } else {
      playUrl = videoElement.attr('src') || '';
    }
  }

  if (!playUrl) {
    const firstSource = videoElement.find('source').first();
    playUrl = firstSource.attr('src') || videoElement.attr('src') || '';
  }

  return { urls: [playUrl], quality };
}

// ---------- search（XPTV 原逻辑） ----------
async function searchCards(text, page = 1) {
  const kw = encodeURIComponent(text);
  const url = `${ACTIVE_HOST}/search?query=${kw}&broad=on&page=${page}`;
  const html = await getHtml(url);
  if (!html) return [];
  const $ = cheerio.load(html);

  const cards = [];
  $('.video-item-container').each((_, element) => {
    const $el = $(element);
    const videoLink = $el.find('.video-link');
    const href = videoLink.attr('href');
    if (!isInnerDomain(href)) return;

    const title = $el.find('.title').text().trim();
    const cover = $el.find('.main-thumb').attr('src');
    const subtitle = $el.find('.subtitle a').text().trim();
    const duration = $el.find('.duration').text().trim();

    const stats = { likes: '', views: '' };
    $el.find('.stat-item').each((i, statEl) => {
      const t = $(statEl).text().trim();
      if (i === 0) stats.likes = t.replace('thumb_up', '').trim();
      else if (i === 1) stats.views = t;
    });

    const finalHref = absUrl(href);

    const remarks = [];
    if (stats.likes) remarks.push(stats.likes);
    if (stats.views) remarks.push(stats.views);

    cards.push({
      vod_id: finalHref,
      vod_name: title,
      vod_pic: cover || '',
      vod_remarks: remarks.join(' · '),
      vod_duration: duration,
      ext: { url: finalHref, duration, subtitle, stats },
    });
  });

  return cards;
}

// ================= CatPawOpen 接口 =================

async function init() {
  return {};
}

async function home() {
  const tabs = await getTabs();
  const CLASSES = tabs.map((tab) => ({
    type_id: String(tab.ext.url),
    type_name: tab.name,
  }));
  return { class: CLASSES, filters: {} };
}

async function homeVod() {
  // XPTV 原版无首页推荐逻辑
  return { list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const id = String(body.id || '');
  const { list } = await getCards(JSON.stringify({ url: id, page }));
  return {
    page,
    pagecount: 9999,
    limit: list.length || 24,
    total: 999999,
    list: list.map((c) => ({
      vod_id: c.vod_id,
      vod_name: c.vod_name,
      vod_pic: c.vod_pic,
      vod_remarks: c.vod_remarks,
    })),
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const vid = String(ids[0] || '');
  if (!vid) return { list: [] };

  const { tracks, $ } = await getTracks(JSON.stringify({ url: vid }));

  // 详情页标题/简介/封面（XPTV getTracks 未取，此处从同一页面补充）
  let name = vid;
  let content = '';
  let pic = '';
  if ($) {
    name =
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      vid;
    content = $('meta[property="og:description"]').attr('content') || '';
    pic = $('meta[property="og:image"]').attr('content') || '';
  }

  // vod_play_url: 选集名$播放地址，播放地址为 getPlayinfo 所需的 ext JSON（含 quality）
  const playUrl = tracks
    .map((t) => `${t.name}$${JSON.stringify(t.ext)}`)
    .join('#');

  return {
    list: [
      {
        vod_id: vid,
        vod_name: name,
        vod_pic: pic,
        vod_remarks: '',
        vod_content: content,
        vod_play_from: NAME,
        vod_play_url: playUrl,
      },
    ],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const rawId = String(body.id || '');

  // 播放地址: detail 生成的 ext JSON（{url, quality}），或直接传入的直链
  let ext = null;
  try {
    const parsed = JSON.parse(rawId);
    if (parsed && typeof parsed === 'object' && parsed.url) ext = parsed;
  } catch (e) {
    // 非 JSON，视为直链
  }

  if (!ext) {
    return { parse: 0, url: rawId, header: headers() };
  }

  const { urls } = await getPlayinfo(JSON.stringify(ext));
  const url = (urls && urls[0]) || '';
  return {
    parse: 0,
    url,
    header: headers(),
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = await searchCards(wd, page);
  return {
    page,
    pagecount: 9999,
    limit: list.length || 24,
    total: list.length,
    list: list.map((c) => ({
      vod_id: c.vod_id,
      vod_name: c.vod_name,
      vod_pic: c.vod_pic,
      vod_remarks: c.vod_remarks,
    })),
  };
}

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', init);
      fastify.post('/home', home);
      fastify.post('/homeVod', homeVod);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
