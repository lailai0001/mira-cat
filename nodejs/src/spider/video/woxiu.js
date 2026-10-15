// 我秀直播 - CatPawOpen JS Spider
// 转换自 upload-15.py，站点 https://www.woxiu.com
// 注意: m.woxiu.com 在部分网络不可达，本源只用 www.woxiu.com 的 PC 端接口
// 请求: 双通道 — 先框架 req(axios, MiraPlayer 内核可用)，失败再试 Node 原生 fetch
import req from '../../util/req.js';

const KEY = 'py_woxiu';
const NAME = '我秀直播';
const PC_HOST = 'https://www.woxiu.com';
const PC_API = PC_HOST + '/index.php?action=Index/Main&do=';
const LIVE_API = PC_HOST + '/index.php?action=M/Live&do=LiveInfo&room_id=';
const SEARCH_URL = PC_HOST + '/index.php?action=Search&q=';
const UA = 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const FLV_HOST = 'https://bplay.xiuimg.com';
const HLS_RE = /\/vshow\/([^/]+)\/playlist\.m3u8/i;

const CATS = [
  { type_id: 'grade_all', type_name: '全部主播' },
  { type_id: 'grade_4', type_name: '巨星' },
  { type_id: 'grade_3', type_name: '明星' },
  { type_id: 'grade_2', type_name: '钻石' },
  { type_id: 'grade_1', type_name: '红心' },
  { type_id: 'game', type_name: '游戏主播' },
];

const PC_DO = {
  grade_all: 'ApiZhuboGradeNew',
  grade_4: 'ApiZhuboGradeNew&gtype=4',
  grade_3: 'ApiZhuboGradeNew&gtype=3',
  grade_2: 'ApiZhuboGradeNew&gtype=2',
  grade_1: 'ApiZhuboGradeNew&gtype=1',
  game: 'ApiGameRoom',
};

function t(v) {
  return String(v == null ? '' : v).trim();
}

function toInt(v, d) {
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) ? (d || 0) : n;
}

function fixPic(url) {
  url = t(url).replace(/\\\//g, '/');
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  return url;
}

// 双通道 JSON 请求: 先框架 req, 失败再 fetch
async function getJson(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': referer || (PC_HOST + '/'),
  };
  for (let i = 0; i < 2; i++) {
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000 });
      if (status === 200 && data) {
        if (typeof data === 'object') return data;
        try { return JSON.parse(String(data)); } catch (e) { /* try fetch */ }
      }
    } catch (e) { /* 换通道2 */ }
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const txt = await r.text();
      try { return JSON.parse(txt); } catch (e) { continue; }
    } catch (e) { /* retry */ }
  }
  return {};
}

// 双通道 HTML 请求: 先框架 req, 失败再 fetch
async function getText(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': referer || (PC_HOST + '/'),
  };
  for (let i = 0; i < 2; i++) {
    try {
      const { data, status } = await req.get(url, { headers, timeout: 20000, responseType: 'text' });
      const s = String(data || '');
      if (status === 200 && s.length > 500) return s;
    } catch (e) { /* 换通道2 */ }
    try {
      if (typeof fetch === 'undefined') continue;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (!r.ok) continue;
      const s = await r.text();
      if (s && s.length > 500) return s;
    } catch (e) { /* retry */ }
  }
  return '';
}

function cardPc(j) {
  const rid = t(j.room_id);
  if (!rid) return null;
  const online = toInt(j.online) === 1;
  const count = toInt(j.count);
  const remark = online ? ('👥 ' + (count > 0 ? count : '直播中')) : '未开播';
  return {
    vod_id: 'woxiu:' + rid,
    vod_name: t(j.name) || ('房间' + rid),
    vod_pic: fixPic(j.room_img || j.index_img),
    vod_remarks: remark,
  };
}

async function home() {
  return { class: CATS };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = t(Array.isArray(body.id) ? body.id[0] : body.id) || 'grade_all';
  const page = Math.max(1, toInt(body.page, 1));
  const d = PC_DO[id];
  if (!d) return { list: [], page, pagecount: 1 };
  const payload = await getJson(PC_API + d + '&page=' + page, PC_HOST + '/');
  const rows = (payload && payload.data) || [];
  const cards = [];
  for (const j of rows) {
    const c = cardPc(j);
    if (c) cards.push(c);
  }
  const total = toInt(payload.count, cards.length);
  const per = rows.length || 20;
  const pagecount = total > 0 ? Math.max(1, Math.ceil(total / per)) : 1;
  return { list: cards, page, pagecount, limit: per, total };
}

async function liveInfo(rid) {
  return getJson(LIVE_API + encodeURIComponent(rid));
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(Array.isArray(body.id) ? body.id[0] : body.id);
  id = id.replace(/^woxiu:/, '');
  if (!id) return { list: [] };
  const info = await liveInfo(id);
  if (!info || !t(info.zb_nickname || info.room_id)) {
    return {
      list: [{
        vod_id: 'woxiu:' + id,
        vod_name: '房间' + id,
        vod_remarks: '加载失败',
        vod_content: '直播间信息加载失败，请重试。',
      }],
    };
  }
  const online = toInt(info.online) === 1;
  const stream = t(info.live_stream);
  const nickname = t(info.zb_nickname) || ('房间' + id);
  const count = toInt(info.viewer_count);
  const pic = fixPic(info.room_img || info.zb_photo);
  const content = ['房号：' + id, '主播：' + nickname,
    '人气：' + (count > 0 ? count : '—'), '平台：我秀直播（woxiu.com）'].join('\n');
  let playFrom = '', playUrl = '';
  if (online && stream) {
    playFrom = '高清$$$原画';
    playUrl = '直播$' + id + '$hls#直播$' + id + '$flv';
  }
  return {
    list: [{
      vod_id: 'woxiu:' + id,
      vod_name: nickname,
      vod_pic: pic,
      vod_remarks: online ? ('👥 ' + (count > 0 ? count : '直播中')) : '未开播',
      vod_actor: nickname,
      vod_content: content,
      vod_play_from: playFrom,
      vod_play_url: playUrl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(Array.isArray(body.id) ? body.id[0] : body.id);
  const header = { 'User-Agent': UA, 'Referer': PC_HOST + '/' };
  if (/^https?:\/\//i.test(id)) return { parse: 0, url: id, header };
  const parts = id.split('$').filter(Boolean);
  let rid = '', line = 'hls';
  if (parts.length >= 3) { rid = parts[parts.length - 2]; line = parts[parts.length - 1]; }
  else if (parts.length === 2) { rid = parts[0].replace(/^woxiu:/, ''); line = parts[1]; }
  else { rid = parts[0].replace(/^woxiu:/, ''); }
  if (!rid) return { parse: 0, url: '', header };
  const info = await liveInfo(rid);
  const stream = t(info && info.live_stream);
  if (!stream) return { parse: 0, url: '', header };
  let url = stream;
  if (line === 'flv') {
    const m = HLS_RE.exec(stream);
    url = m ? (FLV_HOST + '/vshow/' + m[1] + '.flv') : stream;
  }
  return { parse: 0, url, header };
}

function parseSearchCards(html) {
  const cards = [];
  if (!html) return cards;
  const blocks = html.match(/<li>([\s\S]*?)<\/li>/g) || [];
  const seen = new Set();
  for (const b of blocks) {
    const m = b.match(/href="https?:\/\/(?:www|m)\.woxiu\.com\/(\d+)"/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const rid = m[1];
    let name = '';
    const am = b.match(/alt="([^"]*)"/) || b.match(/<i>([^<]*)<\/i>/);
    if (am) name = am[1].trim();
    const im = b.match(/<img[^>]+src="([^"]+)"/);
    const online = b.indexOf('online_icon') >= 0;
    const hm = b.match(/人气：\s*(\d+)/);
    const remark = online ? ('👥 ' + (hm ? hm[1] : '直播中')) : '未开播';
    cards.push({
      vod_id: 'woxiu:' + rid,
      vod_name: name || ('房间' + rid),
      vod_pic: fixPic(im ? im[1] : ''),
      vod_remarks: remark,
    });
  }
  return cards;
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const kw = t(body.wd);
  const page = Math.max(1, toInt(body.page, 1));
  if (!kw) return { list: [], page, pagecount: 1 };
  const stype = /^\d+$/.test(kw) ? 'roomid' : 'nickname';
  let url = SEARCH_URL + encodeURIComponent(kw) + '&search_type=' + stype;
  if (page > 1) url += '&page=' + page;
  let html = await getText(url, PC_HOST + '/');
  let cards = parseSearchCards(html);
  if (!cards.length && stype === 'roomid') {
    let url2 = SEARCH_URL + encodeURIComponent(kw) + '&search_type=nickname';
    if (page > 1) url2 += '&page=' + page;
    cards = parseSearchCards(await getText(url2, PC_HOST + '/'));
  }
  return { list: cards, page, pagecount: cards.length ? page + 1 : 1 };
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
