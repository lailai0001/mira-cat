// SOOP直播 - CatPawOpen JS Spider
// Ported from SOOP.py
// 列表: live.sooplive.co.kr/api/main_broad_list_api.php
// 播放: player_live_api.php -> AID + broad_stream_assign -> m3u8
import req from '../../util/req.js';

const KEY = 'py_soop';
const NAME = 'SOOP直播';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const PLAY_HOST = 'https://play.sooplive.com';

const CHANNELS = [
  ['all', '全部直播', ''],
  ['0004', '游戏', '0004'],
  ['0002', '生活', '0002'],
  ['0008', '音乐', '0008'],
  ['0010', '体育', '0010'],
  ['0006', '美食', '0006'],
  ['0012', 'Talk', '0012'],
];

const LIST_HOSTS = ['https://live.sooplive.co.kr', 'https://live.sooplive.com'];
const LIVE_API_HOSTS = [
  'https://live.sooplive.com/afreeca/player_live_api.php',
  'https://live.sooplive.co.kr/afreeca/player_live_api.php',
];
const SEARCH_HOSTS = ['https://sch.sooplive.co.kr', 'https://sch.sooplive.com'];

function headers(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Referer': referer || PLAY_HOST + '/',
    'Origin': 'https://play.sooplive.com',
  };
}

async function getJson(url, params, referer) {
  try {
    const { data } = await req.get(url, {
      params: params || {},
      headers: headers(referer),
      timeout: 12000,
    });
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch {
        const m = data.match(/\{[\s\S]+\}/);
        if (m) { try { return JSON.parse(m[0]); } catch {} }
        return {};
      }
    }
    return data || {};
  } catch { return {}; }
}

async function postForm(url, form, referer) {
  try {
    const qs = new URLSearchParams(form).toString();
    const { data } = await req.post(url, qs, {
      headers: { ...headers(referer), 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 12000,
    });
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return {}; }
    }
    return data || {};
  } catch { return {}; }
}

function picOf(uid) {
  if (!uid) return '';
  const pre = (uid.length >= 2 ? uid.slice(0, 2) : uid).toLowerCase();
  return 'https://stimg.sooplive.com/LOGO/' + pre + '/' + uid + '/m/' + uid + '.webp';
}

function mapItem(it) {
  if (!it || typeof it !== 'object') return null;
  const uid = String(it.user_id || it.bj_id || it.userId || it.bid || '');
  if (!uid) return null;
  const bno = String(it.broad_no || it.bno || it.broadNo || '');
  const title = String(it.broad_title || it.title || it.broadTitle || uid).slice(0, 80);
  const nick = String(it.user_nick || it.bj_nick || it.userNick || uid);
  const viewers = it.total_view_cnt || it.view_cnt || it.pc_view_cnt || '';
  const cate = it.broad_cate_name || it.category || '';
  let pic = it.broad_thumb || it.thumb || picOf(uid);
  if (pic && String(pic).startsWith('//')) pic = 'https:' + pic;
  return {
    vod_id: bno ? (uid + '|' + bno) : uid,
    vod_name: title,
    vod_pic: pic,
    vod_remarks: viewers ? (viewers + '人') : (cate || nick),
    vod_actor: nick,
  };
}

function pickList(js) {
  if (Array.isArray(js)) return js;
  if (!js || typeof js !== 'object') return [];
  const d = (js.data && typeof js.data === 'object') ? js.data : js;
  if (Array.isArray(d)) return d;
  for (const k of ['broad', 'list', 'broad_list', 'lives', 'result', 'CHANNEL']) {
    const v = d[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.broad)) return v.broad;
  }
  if (Array.isArray(js.broad)) return js.broad;
  return [];
}

async function liveList(page, cate) {
  page = Math.max(1, parseInt(page, 10) || 1);
  cate = String(cate || '');
  const paramSets = [
    { page: String(page), order_type: 'view_cnt', selectType: 'action', selectValue: cate || 'all' },
    { m: 'liveListHash', pageNo: String(page), pageSize: '30', order_type: 'view_cnt', cate_no: cate },
    { m: 'liveList', page: String(page), orderBy: 'view_cnt' },
  ];
  const paths = ['/api/main_broad_list_api.php', '/api.php'];
  for (const host of LIST_HOSTS) {
    for (const path of paths) {
      for (const params of paramSets) {
        const js = await getJson(host + path, params);
        const videos = pickList(js).map(mapItem).filter(Boolean);
        if (videos.length) return videos;
      }
    }
  }
  return [];
}

async function init() { return {}; }

async function home() {
  return {
    class: CHANNELS.map(([tid, name]) => ({ type_id: tid, type_name: name })),
    filters: {},
    list: [],
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'all');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let cate = '';
  for (const [t, , c] of CHANNELS) { if (t === tid) { cate = c; break; } }
  const list = await liveList(page, cate);
  return {
    page,
    pagecount: list.length >= 20 ? page + 1 : page,
    limit: 30,
    total: list.length ? 9999 : 0,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const parts = String(raw).split('|');
    const uid = parts[0];
    const bno = parts[1] || '';
    const playId = bno ? (uid + '|' + bno) : uid;
    list.push({
      vod_id: playId,
      vod_name: uid,
      vod_pic: picOf(uid),
      vod_remarks: '🔴 LIVE',
      vod_content: uid + ' 正在直播',
      vod_play_from: 'SOOP',
      vod_play_url: '直播$' + playId,
    });
  }
  return { list };
}

async function liveChannel(uid, bno) {
  const referer = PLAY_HOST + '/' + uid;
  const form = {
    from_api: '0', mode: 'landing', player_type: 'html5', stream_type: 'common',
    type: 'live', bid: uid, bno: bno || '', pwd: '',
  };
  for (const api of LIVE_API_HOSTS) {
    const js = await postForm(api, form, referer);
    const ch = js.CHANNEL;
    if (ch && (ch.BNO || ch.RESULT)) return ch;
  }
  return null;
}

async function resolvePlay(uid, bno) {
  const ch = await liveChannel(uid, bno);
  if (!ch) return '';
  bno = String(ch.BNO || bno || '');
  const rmd = String(ch.RMD || '').replace(/\/+$/, '');
  const cdn = String(ch.CDN || 'gs_cdn_pc_web');
  if (!bno || !rmd) return '';
  const referer = PLAY_HOST + '/' + uid;
  // AID
  let aid = '';
  const aidForm = {
    from_api: '0', mode: 'landing', player_type: 'html5', stream_type: 'common',
    type: 'aid', bid: uid, bno, pwd: '', quality: 'hd',
  };
  for (const api of LIVE_API_HOSTS) {
    const js = await postForm(api, aidForm, referer);
    aid = (js.CHANNEL && js.CHANNEL.AID) || '';
    if (aid) break;
  }
  const cdnType = /lg_cdn/.test(cdn) ? 'lg_cdn_pc_web' : 'gs_cdn_pc_web';
  for (const quality of ['original', 'hd', 'sd']) {
    const info = await getJson(rmd + '/broad_stream_assign.html', {
      return_type: cdnType,
      broad_key: bno + '-common-' + quality + '-hls',
    }, referer);
    const viewUrl = String(info.view_url || '');
    if (viewUrl) {
      return aid ? (viewUrl + (viewUrl.includes('?') ? '&' : '?') + 'aid=' + encodeURIComponent(aid)) : viewUrl;
    }
  }
  return '';
}

async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const h = {
    'User-Agent': UA, 'Referer': PLAY_HOST + '/',
    'Origin': 'https://play.sooplive.com', 'Accept': '*/*',
  };
  if (/^https?:\/\//i.test(id) && /\.(m3u8|mp4|flv)/i.test(id)) {
    return { parse: 0, url: id, header: h };
  }
  const parts = id.split('|');
  const uid = parts[0];
  const bno = parts[1] || '';
  try {
    const url = await resolvePlay(uid, bno);
    if (url) return { parse: 0, url, header: h };
  } catch {}
  return { parse: 1, url: PLAY_HOST + '/' + uid + (bno ? '/' + bno : ''), header: h };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const paramSets = [
    { m: 'searchLiveList', v: '1.0', szKeyword: wd, nPageNo: String(page), nListCnt: '20' },
    { m: 'broadSearch', szKeyword: wd, nPageNo: String(page) },
  ];
  const videos = [];
  for (const host of SEARCH_HOSTS) {
    for (const params of paramSets) {
      const js = await getJson(host + '/api.php', params);
      for (const it of pickList(js)) {
        const v = mapItem(it);
        if (v) videos.push(v);
      }
      if (videos.length) break;
    }
    if (videos.length) break;
  }
  return {
    page,
    pagecount: videos.length >= 15 ? page + 1 : page,
    limit: 20,
    total: videos.length,
    list: videos,
  };
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
