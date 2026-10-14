import req from '../../util/req.js';
import CryptoJS from 'crypto-js';

const KEY = 'py_upload5';
const NAME = '蜜桃';
const HOST = 'https://honeypeach.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// ---------------- PoW: FNV-1a 32bit, 与服务端握手算法一致 ----------------
function hpHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hpPow(chal, nonce) {
  let h = hpHash(chal + ':' + nonce);
  for (let r = 0; r < 4; r++) {
    const hex = h.toString(16).padStart(8, '0').slice(-8);
    h = hpHash(hex + chal);
  }
  return h.toString(16).padStart(8, '0').slice(-8);
}

function hpSolve(chal, bits) {
  const want = '0'.repeat(bits >> 2);
  for (let n = 0; n < 20000000; n++) {
    const nx = n.toString(16);
    if (hpPow(chal, nx).startsWith(want)) return chal + '.' + nx;
  }
  return '';
}

function rnd(n) {
  n = n || 10;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars.charAt((Math.random() * chars.length) | 0);
  return s;
}
function newDev() {
  return rnd(12) + Date.now().toString(16);
}

// ---------------- 会话: 握手换 sid/skey, 缓存到过期前 60s ----------------
const sess = { sid: '', skey: '', exp: 0 };

async function fetchJson(url, extraHeaders) {
  try {
    const { data } = await req.get(url, {
      headers: Object.assign(
        {
          'User-Agent': UA,
          Accept: 'application/json',
        },
        extraHeaders || {}
      ),
      timeout: 20000,
    });
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch (e) { return {}; }
    }
    return data || {};
  } catch (e) {
    return {};
  }
}

async function ensureHandshake() {
  const now = Math.floor(Date.now() / 1000);
  if (sess.sid && sess.skey && now < sess.exp - 60) return true;
  // 服务端偶发拒收 PoW(返回新 challenge), 最多换 dev 重试 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    const dev = newDev();
    let d = await fetchJson(HOST + '/api/handshake?dev=' + encodeURIComponent(dev));
    if (d && d.need_chal) {
      const tok = hpSolve(String(d.need_chal), parseInt(d.bits || '16', 10));
      if (!tok) continue;
      d = await fetchJson(
        HOST + '/api/handshake?dev=' + encodeURIComponent(dev) + '&c=' + encodeURIComponent(tok)
      );
    }
    if (d && d.sid && d.skey) {
      sess.sid = String(d.sid);
      sess.skey = String(d.skey);
      sess.exp = parseInt(d.exp || '0', 10);
      return true;
    }
  }
  return false;
}

// ---------------- 带 HMAC 签名的请求 ----------------
async function signedGet(path, params) {
  if (!(await ensureHandshake())) return {};
  const qs = new URLSearchParams(params || {}).toString();
  const bodyHash = CryptoJS.SHA256('').toString(CryptoJS.enc.Hex);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = rnd(8) + Date.now().toString(16);
  const canon = ['GET', path, qs, bodyHash, ts, nonce, sess.sid].join('\n');
  const sig = CryptoJS.HmacSHA256(canon, CryptoJS.enc.Hex.parse(sess.skey)).toString(CryptoJS.enc.Hex);
  const url = HOST + path + (qs ? '?' + qs : '');
  const res = await fetchJson(url, {
    'X-Hp-Sid': sess.sid,
    'X-Hp-Ts': ts,
    'X-Hp-Nonce': nonce,
    'X-Hp-Sign': sig,
    Referer: HOST + '/',
  });
  if (res && res.code === 401) {
    sess.sid = '';
    sess.skey = '';
    if (await ensureHandshake()) return signedGet(path, params);
  }
  // 限流检测（对照 REX isRateLimited）：换设备号重握手再试一次
  const errMsg = String((res && (res.err || res.msg)) || '').toLowerCase();
  const limited = res && (res.code === 429 || errMsg.includes('rl_sid') || errMsg.includes('rl_dev') ||
    errMsg.includes('rl_ip') || errMsg.includes('rate') || errMsg.includes('limit') ||
    errMsg.includes('toomany') || errMsg.includes('busy'));
  if (limited) {
    sess.sid = '';
    sess.skey = '';
    sess.dev = '';  // 强制换设备号
    if (await ensureHandshake()) return signedGet(path, params);
  }
  return res;
}

function formatCover(mod, url) {
  if (!url) return '';
  const u = String(url);
  if (mod === 'live' || u.startsWith('/') || u.indexOf('://') === -1) {
    if (u.startsWith('/')) return HOST + u;
    return u;
  }
  return HOST + '/cover/' + mod + '?u=' + encodeURIComponent(u);
}

// ---------------- 分类（对照 REX forward.mitao.tut，除直播外全提取） ----------------
const CLASSES = [
  { type_id: 'video_new', type_name: '最近更新' },
  { type_id: 'video_release', type_name: '新作上市' },
  { type_id: 'video_chinese', type_name: '中文字幕' },
  { type_id: 'video_madou', type_name: '麻豆传媒' },
  { type_id: 'video_uncensored', type_name: '无码流出' },
  { type_id: 'video_hot', type_name: '热门视频' },
  { type_id: 'video_fc2', type_name: 'FC2' },
  { type_id: 'video_heyzo', type_name: 'HEYZO' },
  { type_id: 'video_tokyohot', type_name: '东京热' },
  { type_id: 'video_1pondo', type_name: '一本道' },
  { type_id: 'video_caribbean', type_name: '加勒比' },
  { type_id: 'video_todayhot', type_name: '今日热门' },
  { type_id: 'video_weeklyhot', type_name: '本周热门' },
  { type_id: 'duanju', type_name: '蜜桃短剧' },
  { type_id: 'duanju_chiguo', type_name: '赤果短剧' },
  { type_id: 'duanju_zhenren', type_name: '真人短剧' },
  { type_id: 'duanju_ai', type_name: 'AI成人短剧' },
  { type_id: 'duanju_rank', type_name: '短剧排行' },
  { type_id: 'caibian', type_name: '擦边短剧' },
  { type_id: 'shortv', type_name: '蜜桃动漫' },
  { type_id: 'heiliao', type_name: '黑料吃瓜' },
  { type_id: 'guochan', type_name: '国产精品' },
];

const FILTERS = {
  video: [
    {
      key: 'cat', name: '分类',
      value: [
        { n: '最近更新', v: 'new' }, { n: '新作上市', v: 'release' },
        { n: '中文字幕', v: 'chinese-subtitle' }, { n: '麻豆传媒', v: 'madou' },
        { n: '无码流出', v: 'uncensored-leak' }, { n: 'FC2', v: 'fc2' },
        { n: '热门', v: 'monthly-hot' }, { n: 'VR', v: 'genres/VR' },
        { n: 'HEYZO', v: 'heyzo' }, { n: '东京热', v: 'tokyohot' },
        { n: '一本道', v: '1pondo' }, { n: 'Caribbeancom', v: 'caribbeancom' },
        { n: 'Caribbeancompr', v: 'caribbeancompr' }, { n: 'SIRO', v: 'siro' },
        { n: 'LUXU', v: 'luxu' }, { n: 'TWAV', v: 'twav' },
        { n: 'Furuke', v: 'furuke' }, { n: '今日热门', v: 'today-hot' },
        { n: '本週热门', v: 'weekly-hot' },
      ],
    },
  ],
  duanju: [
    {
      key: 'cat', name: '板块',
      value: [
        { n: '精选', v: 'all' }, { n: '赤果短剧', v: 'chiguo' },
        { n: '魔改短剧', v: 'mod' }, { n: '黄豆原创', v: 'yuandou' },
        { n: '真人短剧', v: 'zhenren' }, { n: '动漫', v: 'erciyuan' },
        { n: '影院', v: 'aiman' }, { n: '推荐', v: 'tuijian' },
        { n: 'AI成人短剧', v: 'duanju' }, { n: 'AI成人漫剧', v: 'manju' },
        { n: 'AI换脸', v: 'huanlian' }, { n: 'AI魔改', v: 'mogai' },
        { n: '排行榜', v: 'rank' }, { n: '怦然心动', v: 'pengran' },
      ],
    },
  ],
  caibian: [
    { key: 'cat', name: '排序', value: [{ n: '最新', v: '0' }, { n: '推荐', v: '1' }, { n: '全部', v: '2' }] },
  ],
  shortv: [
    {
      key: 'cat', name: '源频道',
      value: [
        { n: '全部', v: 'all' }, { n: 'Hanime', v: 'Hanime' },
        { n: 'NaughtyMachinima', v: 'NaughtyMachinima' }, { n: 'HS日本4K动漫', v: 'HS日本4K动漫' },
      ],
    },
  ],
  heiliao: [
    { key: 'cat', name: '频道', value: [{ n: '最新', v: '0' }, { n: '推荐', v: '1' }] },
  ],
  live: [
    {
      key: 'cat', name: '分类与地区',
      value: [
        { n: '女主播', v: 'girls' }, { n: '情侣', v: 'couples' },
        { n: '男主播', v: 'men' }, { n: '跨性别', v: 'trans' },
        { n: '中国', v: 'cn' }, { n: '日本', v: 'jp' }, { n: '韩国', v: 'kr' },
        { n: '美国', v: 'us' }, { n: '泰国', v: 'th' }, { n: '越南', v: 'vn' },
        { n: '俄罗斯', v: 'ru' },
      ],
    },
  ],
};

const SRC_MAP = {
  video: 'missav', shortv: 'dongman', chiguo: 'chiguo', pengran: 'pengran',
  tuijian: 'huangguo', duanju: 'huangguo', manju: 'huangguo', huanlian: 'huangguo',
  mogai: 'huangguo', rank: 'huangguo',
};

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: FILTERS, list: [] };
}

// 各分类默认 cat（对照 REX forward.mitao.tut）
const DEFAULT_CAT = {
  video_new: 'new|missav|',
  video_release: 'release|missav|',
  video_chinese: 'chinese-subtitle|missav|',
  video_madou: 'madou|missav|',
  video_uncensored: 'uncensored-leak|missav|',
  video_hot: 'monthly-hot|missav|',
  video_fc2: 'fc2|missav|',
  video_heyzo: 'heyzo|missav|',
  video_tokyohot: 'tokyohot|missav|',
  video_1pondo: '1pondo|missav|',
  video_caribbean: 'caribbeancom|missav|',
  video_todayhot: 'today-hot|missav|',
  video_weeklyhot: 'weekly-hot|missav|',
  duanju: 'tuijian|huangguo|0',
  duanju_chiguo: 'chiguo|huangguo|0',
  duanju_zhenren: 'zhenren|huangguo|0',
  duanju_ai: 'duanju|huangguo|0',
  duanju_rank: 'rank|huangguo|0',
  caibian: '0|huangdou|0',
  shortv: 'all|dongman|0',
  heiliao: '0|huangdou|0',
  guochan: '||',
};

// cat 参数格式与 REX 版一致: code|src|sub,需拆成三个独立参数(对照 REX parseCatParam)
function parseCatTriple(raw, fallback) {
  const parts = String(raw || fallback || '').split('|');
  return { cat: parts[0] || '', src: parts[1] || '', sub: parts[2] || '' };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || 'video_new');
  const extend = body.filters || body.extend || {};
  const def = parseCatTriple(DEFAULT_CAT[tid]); // 本模块默认三元组
  let pc = parseCatTriple(extend.cat);
  if (!pc.cat) pc = def; // 未选筛选器 → 用默认三元组

  // 裸筛选值(如 video 的 'release')沿用旧 SRC_MAP 兜底,其余以三元组为准
  const src = pc.src || SRC_MAP[pc.cat] || def.src || '';
  const sub = pc.sub !== '' ? pc.sub : def.sub;

  // API key 映射：video_* 都用 key=video，duanju_* 都用 key=duanju（对照 REX loadModule）
  let apiKey = tid;
  if (tid.startsWith('video_')) apiKey = 'video';
  else if (tid.startsWith('duanju')) apiKey = 'duanju';
  // 参数顺序与 REX 完全一致: key,cat,page,src,sub;cat 恒带,src/sub 为空则省略
  const params = { key: apiKey, cat: pc.cat, page: String(page) };
  if (src) params.src = src;
  if (sub !== '') params.sub = sub;
  if (extend.nav) params.nav = String(extend.nav);

  const data = await signedGet('/api/module', params);
  const rawList = (data && data.list) || [];
  const hasMore = !!(data && data.has_more);
  const coverMod = tid === 'duanju' ? src : tid;
  const list = [];
  for (const item of rawList) {
    const itemId = String(item.id || item.code || '');
    if (!itemId) continue;
    const title = String(item.title || itemId).trim();
    const pic = formatCover(coverMod, item.cover_n || item.cover || '');
    const rawRemark = item.remark || item.desc || '';
    list.push({
      vod_id: (tid.startsWith('video_') ? src : tid.startsWith('duanju') ? 'duanju' : tid) + '@@' + itemId + '@@' + src + '@@' + (sub !== '' ? sub : ''),
      vod_name: title,
      vod_pic: pic,
      vod_remarks: rawRemark ? '蝴蝶影视 | ' + String(rawRemark).trim() : '蝴蝶影视',
    });
  }
  return {
    page,
    pagecount: hasMore ? page + 1 : page,
    limit: list.length,
    total: hasMore ? 9999 : page * list.length,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const rawId of (ids || []).filter(Boolean)) {
    const parts = String(rawId).split('@@');
    const mod = parts[0];
    const realId = parts[1] || String(rawId);
    const src = parts[2] || '';
    const sub = parts[3] || '';
    const params = {};
    if (src) params.src = src;
    if (sub) params.sub = sub;
    // 15秒超时保护，避免无限转圈
    let data = {};
    try {
      data = await Promise.race([
        signedGet('/api/detail/' + mod + '/' + encodeURIComponent(realId), params),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
    } catch (e) {
      data = {};
    }
    const vod = {
      vod_id: String(rawId),
      vod_name: realId,
      vod_pic: '',
      vod_area: '蜜桃',
      vod_remarks: '蝴蝶影视',
      vod_actor: '🦋 TG群: @tvshare23',
      vod_director: '🦋 蝴蝶影视',
      vod_content: '🦋 蝴蝶影视提醒：本影片仅供测试交流，请勿用于非法用途！',
      vod_play_from: '蜜桃专线',
      vod_play_url: '',
    };
    const playUrls = [];
    try {
      const det = (data && data.detail) || {};
      if (det && (det.title || det.episodes)) {
        if (det.title) vod.vod_name = String(det.title).trim();
        const coverMod = src && mod === 'duanju' ? src : mod;
        const picUrl = formatCover(coverMod, det.cover || '');
        vod.vod_pic = picUrl;
        if (det.date) vod.vod_year = String(det.date);
        if (det.desc) vod.vod_content = '🦋 蝴蝶影视官方交流群: @tvshare23\n\n' + det.desc;
        const episodes = det.episodes || [];
        if (episodes.length) {
          for (const epItem of episodes) {
            const epNo = String(epItem.ep || '1');
            let rawName = String(epItem.name || ('第' + epNo + '集'));
            if (/^\d+$/.test(rawName)) rawName = '第' + rawName + '集';
            const epDisplay = epItem.lock ? rawName + '[预告10s]' : rawName;
            playUrls.push(epDisplay + '$' + mod + '@@' + realId + '@@' + epNo + '@@' + src + '@@' + sub);
          }
        } else {
          playUrls.push('正片$' + mod + '@@' + realId + '@@1@@' + src + '@@' + sub);
        }
      } else {
        playUrls.push('正片$' + mod + '@@' + realId + '@@1@@' + src + '@@' + sub);
      }
    } catch (e) {
      playUrls.push('正片$' + mod + '@@' + realId + '@@1@@' + src + '@@' + sub);
    }
    vod.vod_play_url = playUrls.join('#');
    list.push(vod);
  }
  return { list };
}

async function play(reqIn) {
  const id = String(reqIn?.body?.id || '').trim();
  if (!id) return { parse: 0, url: '' };
  const parts = id.split('@@');
  const mod = parts[0];
  const realId = parts[1] || id;
  const ep = parts[2] || '1';
  const src = parts[3] || '';
  const sub = parts[4] || '';
  // missav 源：honeypeach 的 play 接口已坏，直接从 missav.fans 解析 m3u8
  if (mod === 'missav') {
    const missavId = String(realId).toLowerCase();
    const missavUrl = 'https://missav.fans/cn/' + encodeURIComponent(missavId);
    try {
      const { data } = await req.get(missavUrl, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://missav.fans/',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: 20000,
      });
      const html = typeof data === 'string' ? data : '';
      const uuidMatch = html.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
      if (uuidMatch) {
        const hostMatch = html.match(/https?:\/\/(surrit\.[^\/\\"\']+)/);
        const host = hostMatch ? hostMatch[1].replace(/\\/g, '') : 'surrit.mrstcdn.store';
        const base = `https://${host}/${uuidMatch[0]}`;
        // 返回多清晰度，默认 720p（1080p 可能是 AV1，iOS 播不了）
        const m3u8_720 = `${base}/720p/video.m3u8`;
        return {
          parse: 0,
          url: m3u8_720,
          header: { 'User-Agent': UA, Referer: 'https://missav.fans/' },
        };
      }
    } catch (e) { /* 掉下去用嗅探兜底 */ }
    // 解析失败则回退到嗅探
    return { parse: 1, url: missavUrl };
  }
  const params = {};
  if (src) params.src = src;
  if (sub) params.sub = sub;
  const data = await signedGet('/api/play/' + mod + '/' + encodeURIComponent(realId) + '/' + ep, params);
  let finalUrl = '';
  try {
    const pl = (data && data.play) || {};
    const rawSrc = String(pl.src || '');
    const rawProxy = String(pl.src_proxy || '');
    // 优先尝试 proxy 地址（可能是完整版），再试 src
    const candidates = [];
    if (rawProxy) candidates.push(rawProxy);
    if (rawSrc) candidates.push(rawSrc);
    // 去掉 preview 判断，两个都试
    for (const c of candidates) {
      if (c && c.indexOf('preview-r10') === -1) {
        finalUrl = c.startsWith('/') ? HOST + c : c;
        break;
      }
    }
    if (!finalUrl && candidates.length) {
      const c = candidates[0];
      finalUrl = c.startsWith('/') ? HOST + c : c;
    }
  } catch (e) { /* ignore */ }
  if (!finalUrl) return { parse: 0, url: '', message: '未获取到播放地址' };
  // 跟随一次跳转拿最终地址（API 可能返回短链）
  try {
    const headRes = await fetch(finalUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': UA, Referer: HOST + '/' },
      redirect: 'follow',
    });
    if (headRes.url && headRes.url !== finalUrl) {
      finalUrl = headRes.url;
    }
  } catch (e) { /* 忽略，用原地址 */ }
  const headers = { 'User-Agent': UA, Referer: HOST + '/' };
  if (finalUrl.indexOf('hembed.com') !== -1 || finalUrl.indexOf('hanime') !== -1) {
    headers.Referer = 'https://hanime1.me/';
  }
  return { parse: 0, url: finalUrl, header: headers };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  const searchMods = ['video', 'duanju', 'shortv', 'guochan', 'caibian'];
  const list = [];
  for (const mod of searchMods) {
    const data = await signedGet('/api/search', { key: mod, kw: wd, page: String(page) });
    const rawList = (data && data.list) || [];
    for (const item of rawList) {
      const itemId = String(item.id || item.code || '');
      if (!itemId) continue;
      const itemSrc = String(item.src || mod);
      const title = String(item.title || itemId).trim();
      const pic = formatCover(mod === 'duanju' ? itemSrc : mod, item.cover_n || item.cover || '');
      const rawRemark = item.remark || item.desc || '';
      list.push({
        vod_id: mod + '@@' + itemId + '@@' + itemSrc,
        vod_name: title,
        vod_pic: pic,
        vod_remarks: rawRemark ? '蝴蝶影视 | ' + String(rawRemark).trim() : '蝴蝶影视',
      });
    }
  }
  return {
    page,
    pagecount: list.length >= 10 ? page + 1 : page,
    limit: list.length,
    total: list.length,
    list,
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
