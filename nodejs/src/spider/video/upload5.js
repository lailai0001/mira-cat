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
    subRegister(rawId, vod);
    list.push(vod);
  }
  return { list };
}

async function play(reqIn) {
  const id = String(reqIn?.body?.id || '').trim();
  if (!id) return { parse: 0, url: '' };
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
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
        return subAttach({
          parse: 0,
          url: m3u8_720,
          header: { 'User-Agent': UA, Referer: 'https://missav.fans/' },
        }, subsP);
      }
    } catch (e) { /* 掉下去用嗅探兜底 */ }
    // 解析失败则回退到嗅探
    return subAttach({ parse: 1, url: missavUrl }, subsP);
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
  return subAttach({ parse: 0, url: finalUrl, header: headers }, subsP);
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

// ---------------- 字幕聚合 (Layer A 铺开, 2026-10-23) ----------------
// 与 bestjavporn 试点同一实现 (提交 9c339419, 用户真机确认
// MiraPlayer 可加载并选择字幕): 点播时按片名/番号并行搜迅雷看看
// oracle (首档; 「迅雷」与「迅雷看看」实为同一接口) + SubtitleCat
// (第二档), 合并排序 = 来源档位 -> 语言 (简中>繁中>双语>英文>
// 其他) -> 番号命中 -> 热度, 只收 .srt/.vtt/.ass/.ssa 直链, 上限
// 10 条, 以 TVBox 标准 subs:[{name,url,format}] 挂到 play 结果。
// 总预算 6s、单请求 4~5s、全程框架 req (NOFETCH 安全)、结果缓存
// 10 分钟 (空结果不缓存); 无命中时不带 subs 键, play 返回与接入
// 前逐字段一致。SubHD (下载被站方门控) 与射手 (源站 522) 不接入。
const SUB_UA = (typeof UA !== 'undefined' && UA) ? UA : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

function subCleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// subHttp: 与试点 reqRaw 同语义 (状态码不抛错、仅 2xx 给正文、
// 文本恒等变换防自动 JSON 解析), 底层框架 req。
async function subHttp(url, headers, timeoutMs) {
  try {
    const r = await req.request({
      method: 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    });
    const text = typeof r.data === 'string' ? r.data : (r.data == null ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// play 入参归一: 个别 App 会把 "集名$播放id" 整段传回, 集名短且
// 不含 {/http 时剥掉前缀, 与 detail 登记的 episode id 对齐。
function subNormKey(k) {
  const s = String(k || '');
  const i = s.indexOf('$');
  if (i > 0) {
    const before = s.slice(0, i);
    if (before.length <= 30 && !/[{/]/.test(before) && !/http/i.test(before)) return s.slice(i + 1).trim();
  }
  return s.trim();
}

// detail 侧登记: 片名按 [detail 入参 id, vod_id, 每个 episode 的
// 播放 id] 多键写入 subNameCache, 并以首个 episode id 预热搜索。
function subRegister(detailIds, vod) {
  try {
    if (!vod || !vod.vod_name) return;
    const name = String(vod.vod_name);
    const keys = new Set();
    for (const i of (Array.isArray(detailIds) ? detailIds : [detailIds])) {
      if (i) keys.add(String(i));
    }
    if (vod.vod_id) keys.add(String(vod.vod_id));
    const eps = [];
    for (const grp of String(vod.vod_play_url || '').split('$$$')) {
      for (const seg of grp.split('#')) {
        const k = seg.indexOf('$');
        if (k >= 0) {
          const ep = seg.slice(k + 1);
          if (ep) { keys.add(ep); eps.push(ep); }
        }
      }
    }
    for (const k of keys) subCacheName(k, name);
    const warmKey = eps[0] || (vod.vod_id ? String(vod.vod_id) : '');
    if (warmKey) subWarm(warmKey);
  } catch (e) { /* 字幕登记失败不影响详情 */ }
}

// play 侧挂载: 仅当结果带非空 url 且字幕有命中时才加 subs 键。
async function subAttach(res, subsP) {
  try {
    const subs = await subsP;
    if (subs && subs.length && res && typeof res === 'object' && res.url) res.subs = subs;
  } catch (e) { /* 字幕挂载失败不影响播放结果 */ }
  return res;
}

// ---------------- 字幕聚合 (Layer A 重写, 2026-10-23) ----------------
// 按用户自有迅雷看看 REX 组件 (xunlei.subtitle) 的方法重写: 旧版把
// [番号, 全标题, 番号+标题] 多个键的召回合并成一池只排序不过滤,
// 全标题键的模糊召回灌进大量别片字幕 (实测 JUR-887 全标题键池
// 前排即 JUX-021 等别片), 且迅雷档位恒占满上限 10, SubtitleCat
// 永远挤不进来。新版三招 (与组件一致):
// (a) 键序逐个查、首个有结果的键即停 — 番号键命中的池小而准;
// (b) 命中后严过滤: 条目 name/langs/ext 须含番号 (宽松形亦可)
//     或片名全文, 不含的全扔, 无回退 (组件原法的回退宽松名单
//     在冷门番号上会把邻近番号的模糊池整池放行, 实测有害已删;
//     乱码单字键亦实测能召回无关字幕, 同样靠严过滤挡下);
// (c) 组件打分: cid_match 100000、含番号 +25000, 再加 oracle 自
//     带 score / fingerprintScore / 下载量, 按名+址去重取 top。
// 槽位 (用户钦定): 迅雷 (键序 [番号, 紧凑番号]) > 迅雷看看
// (组件完整键序 [番号, 紧凑番号, 番号+标题, 紧凑番号+标题,
// 全标题]) > SubtitleCat; 两迅雷槽同走同一 oracle 接口、不管
// 重不重复, 合并按 URL 去重、同条归高档位。合并序 = 档位 ->
// 语言 (简中>繁中>双语>英文>日文>其他, 沿用 subLangOf 口径)
// -> 分数; 全局上限 10、单槽软上限 8 (SubtitleCat 留位)。
// 全程 subHttp (框架 req 主栈), 迅雷系逐请求超时 3s、键序串行
// 首中即停; 总预算 6s、失败全静默; 无结果时 play 返回对象不带
// subs 键, 与未接入前逐字段一致。SubHD (下载被站方门控) 与
// 射手 (源站 522) 仍不接入。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();   // durl -> 片名 (detail 时 best-effort 写入)
const subResultCache = new Map(); // durl -> {ts, subs}

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? subCleanText(slug.replace(/[-_]+/g, ' ')) : '';
}

// 番号抽取 (移植自迅雷看看 REX 组件 extractSearchCode 的核心档)
function subExtractCode(text) {
  const s = String(text || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');
  const pats = [
    /\bFC2(?:[- ]?PPV)?[- ]?\d{5,8}\b/,
    /\bCARIB(?:PR)?[- ]?\d{6,8}\b/,
    /\b1PONDO[- ]?\d{6,8}\b/,
    /\bHEYZO[- ]?\d{3,6}\b/,
    /\b[A-Z]{2,10}[- ]\d{2,8}[A-Z]?\b/,
    /\b[A-Z]{2,10}\d{2,8}[A-Z]?\b/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[0].replace(/\s+/g, '-').replace(/-+/g, '-');
  }
  return '';
}

// 搜索上下文: 片名、番号、紧凑番号、标题部分 (去番号与噪声词)
function subCtx(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const compact = code ? code.replace(/[-_ ]/g, '') : '';
  let titlePart = '';
  if (code && title) {
    titlePart = title
      .replace(new RegExp(code.replace(/[-_]/g, '[-_ ]?'), 'i'), ' ')
      .replace(/\b(UNCENSORED|LEAK|OTHER|COMPLETE|FULL|HDR|WEB|BLURAY|BDRIP|WEBDL|REMUX|X264|X265|10BIT|8BIT|HEVC|AVC)\b/gi, ' ')
      .replace(/\b(?:EP|E|S|SEASON)\s*\d{1,3}\b/gi, ' ')
      .replace(/^[\s\-_:]+|[\s\-_:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (titlePart === code || titlePart === compact) titlePart = '';
  }
  return { title, code, compact, titlePart };
}

// 迅雷槽键序: 只番号两键 (锚定)
function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}

// 迅雷看看槽键序: 组件完整键序 (番号、紧凑番号、番号+标题、
// 紧凑番号+标题、全标题), 逐个查、首中即停。
function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}

// 严过滤的匹配文本 (组件口径: 片名 + 上下文, 全小写与去分隔符两形)
function subMatchOf(durl, ctx) {
  const text = ((ctx.title || '') + ' ' + String(durl || '')).trim().toLowerCase();
  const title = (ctx.title || '').toLowerCase();
  return {
    text,
    loose: text.replace(/[-_\s.]/g, ''),
    title,
    titleLoose: title.replace(/[-_\s.]/g, ''),
  };
}

// 语言判定: rank 越小越优先 (简中 > 繁中 > 双语 > 英文 > 其他)
function subLangOf(name, langs) {
  const s = (String(name || '') + ' ' + String(langs || '')).toLowerCase();
  if (/简体|简中|chs|zh[-_. ]?cn|zh[-_. ]?hans/.test(s)) return { tag: '简中', rank: 0 };
  if (/繁体|繁中|cht|zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?hant/.test(s)) return { tag: '繁中', rank: 1 };
  if (/双语|中英|中日|bilingual/.test(s)) return { tag: '双语', rank: 2 };
  if (/英文|english|eng|(^|[-_. ])en([-_. ]|$)/.test(s)) return { tag: '英文', rank: 3 };
  if (/日文|日语|japanese|jpn|(^|[-_. ])ja([-_. ]|$)/.test(s)) return { tag: '日文', rank: 4 };
  return { tag: '', rank: 5 };
}

const SUB_TEXT_RE = /\.(srt|vtt|ass|ssa)(\?|#|$)/i;

// 文本字幕格式判定: 文件名扩展名 > 条目 ext 字段 > url 后缀;
// 压缩包一律剔除 (与组件 getExt 口径一致, 只认 srt/vtt/ass/ssa)。
function subFmtOf(name, ext, url) {
  const hay = (String(name || '') + ' ' + String(url || '')).toLowerCase();
  if (/\.(zip|rar|7z)(\?|#|$)/.test(hay)) return '';
  const fromName = String(name || '').toLowerCase().match(/\.(srt|vtt|ass|ssa)$/);
  if (fromName) return fromName[1];
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (/^(srt|vtt|ass|ssa)$/.test(e)) return e;
  const fromUrl = String(url || '').match(SUB_TEXT_RE);
  if (fromUrl) return fromUrl[1].toLowerCase();
  return '';
}

// 裸哈希名不可读: 显示名换成番号字幕 (匹配/过滤仍用原名)
function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}

// oracle 单键查询 (同趟搜索内按键缓存, 两槽共用, 不重复发请求)
async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 3000);
    if (r.status !== 200 || !r.body) return [];
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return []; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return [];
    return j.data;
  })();
  ocache.set(key, p);
  return p;
}

// oracle 条目归一 (组件 normalizeResult 的字段口径)
function subNormItem(it) {
  const name = String(it.name || it.Name || it.title || it.Title || it.filename || it.FileName || '字幕');
  const langs = Array.isArray(it.languages) ? it.languages.join(',')
    : (Array.isArray(it.Languages) ? it.Languages.join(',') : String(it.langs || it.Langs || it.language || ''));
  return {
    name,
    langs,
    ext: String(it.ext || it.Ext || it.format || it.Format || ''),
    url: String(it.url || it.Url || ''),
    cid: Boolean(it.cid_match ?? it.CidMatch),
    down: Number(it.down_count || it.DownCount || it.downloads || it.Downloads || 0) || 0,
    score: Number(it.score || it.Score || 0) || 0,
    fp: Number(it.fingerprintf_score || it.fingerprint_score || it.FingerprintScore || it.fingerprintfScore || 0) || 0,
    duration: Number(it.duration || it.Duration || 0) || 0,
    size: Number(it.file_size || it.FileSize || it.size || it.Size || 0) || 0,
  };
}

// 严过滤 (组件口径): 条目 name/langs/ext 须含番号 (原形或宽松
// 形) 或片名全文, 否则扔掉。片名分支必须守非空: 个别蜘蛛的
// 播放 id 与 detail 登记键对不上时片名缓存会落空 (title=''),
// 空串是任何字符串的子串, 不守就会全池放行 (bigbuttshub 实测
// 教训: 假番号 EMPTY-24 搜出的 Sherlock 剧集字幕整页漏入)。
function subRelevant(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  if (ctx.code) {
    if (text.includes(ctx.code.toLowerCase())) return true;
    if (ctx.compact && loose.includes(ctx.compact.toLowerCase())) return true;
  }
  if (!match.text) return false;
  return text.includes(match.text) || loose.includes(match.loose)
    || (match.title ? (text.includes(match.title) || loose.includes(match.titleLoose)) : false)
    || match.text.includes(text);
}

// 组件打分 (scoreItem 的电影路径): cid_match 100000、含番号
// +25000、oracle 自带 score/fingerprintScore、下载量、时长/大小。
function subScoreItem(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  let s = (it.cid ? 100000 : 0) + it.down / 10000;
  if (ctx.code && (text.includes(ctx.code.toLowerCase()) || (ctx.compact && loose.includes(ctx.compact.toLowerCase())))) s += 25000;
  s += Math.max(0, it.score) + Math.max(0, it.fp);
  if (it.duration > 0) s += 50;
  if (it.size > 0) s += Math.min(it.size / 1024 / 1024, 20);
  if (match.title && (text.includes(match.title) || loose.includes(match.titleLoose))) s += 1000;
  if (ctx.code) s += 500;
  if (text.includes('sub') || text.includes('subtitle') || text.includes('字幕')) s += 300;
  return s;
}

// 迅雷系槽位 (迅雷 tier 0 / 迅雷看看 tier 1): 键序逐个查、首个
// 有结果的键即停; 命中池只过严过滤、无任何回退 — 组件原法的
// 「过滤到空回退宽松名单」在冷门番号上实测有害 (oracle 对无精
// 确字幕的番号返回邻近番号的模糊池, 回退等于整池垃圾放行:
// MOGK-006 挂上 MOGK-004/002、FC2-PPV-4991508 挂上他人番号),
// 与「宁缺毋滥」冲突, 故删除 (与 REX 版相关性闸门口径一致)。
async function subSlotOracle(keys, src, tier, ctx, match, ocache, bag) {
  let pool = null;
  for (const k of keys) {
    const list = await subOracle(k, ocache);
    if (list && list.length) { pool = list; break; }
  }
  if (!pool) return;
  const items = [];
  for (const raw of pool) {
    if (!raw) continue;
    const it = subNormItem(raw);
    if (!it.url) continue;
    const fmt = subFmtOf(it.name, it.ext, it.url);
    if (!fmt) continue;
    items.push({ name: it.name, langs: it.langs, ext: it.ext, url: it.url, fmt, norm: it });
  }
  if (!items.length) return;
  const finalItems = items.filter((it) => subRelevant(it, ctx, match));
  for (const it of finalItems) {
    const lang = subLangOf(it.name, it.langs);
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match) });
  }
}

// SubtitleCat 槽 (tier 2): 沿用旧芯搜索/解析 (按番号键搜、逐页
// 取按语言分的直链), 同样过严过滤 (无回退)。
async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
  if (!key) return;
  const r = await subHttp('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 5000);
  if (r.status !== 200 || !r.body) return;
  const pages = [];
  const seen = new Set();
  for (const m of r.body.matchAll(/href="(subs\/\d+\/[^"]+\.html)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    pages.push(m[1]);
    if (pages.length >= 3) break;
  }
  await Promise.all(pages.map(async (p) => {
    const pr = await subHttp('https://subtitlecat.com/' + p, { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 4000);
    if (pr.status !== 200 || !pr.body) return;
    for (const m of pr.body.matchAll(/href="(\/subs\/\d+\/[^"]+\.(?:srt|vtt|ass))"/gi)) {
      let nm = m[1].split('/').pop() || '字幕';
      try { nm = decodeURIComponent(nm); } catch (e) { /* 保持原样 */ }
      if (!subRelevant({ name: nm, langs: '', ext: '' }, ctx, match)) continue;
      const lang = subLangOf(nm, '');
      const fmt = (nm.match(/\.(srt|vtt|ass)$/i) || [])[1].toLowerCase();
      bag.push({ src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], fmt, lang: lang.tag, langRank: lang.rank, score: 0 });
    }
  }));
}

// 合并: 档位 -> 语言 -> 分数; 按 URL 去重 (同条归先到高档位);
// 全局上限 10、单槽软上限 8 (给 SubtitleCat 留位)。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const perTier = {};
  const out = [];
  for (const it of sorted) {
    if (out.length >= 10) break;
    if (seenUrl.has(it.url)) continue;
    if ((perTier[it.tier] || 0) >= 8) continue;
    seenUrl.add(it.url);
    perTier[it.tier] = (perTier[it.tier] || 0) + 1;
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: it.fmt });
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const ctx = subCtx(durl);
    let subs = [];
    if (ctx.code || ctx.title) {
      const match = subMatchOf(durl, ctx);
      const bag = [];
      const ocache = new Map();
      const jobs = [
        subSlotOracle(subKeysX(ctx), '迅雷', 0, ctx, match, ocache, bag),
        subSlotOracle(subKeysXL(ctx), '迅雷看看', 1, ctx, match, ocache, bag),
        subFromSubtitleCat(ctx, match, bag),
      ].map((jp) => Promise.resolve(jp).catch(() => {}));
      const all = Promise.allSettled(jobs);
      // 总预算 6s: 到点先用已入 bag 的部分合并返回; 后台源跑完
      // 后若凑出结果再迟填缓存 (慢出口下 detail 预热靠此命中)。
      // 空结果不缓存 (无字幕的片每次点播重查, 由在途去重兜底)。
      await Promise.race([all, new Promise((r) => setTimeout(r, 6000))]);
      subs = subMerge(bag);
      if (subs.length) {
        subResultCache.set(durl, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(durl, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(durl, p);
  try { return await p; } finally { subInflight.delete(durl); }
}

// detail 入口即预热 (不 await): 慢出口下单趟搜索可达数秒, 让它
// 与详情页的铸造链并行跑, 用户点播时 play 直接命中缓存/在途。
function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
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
