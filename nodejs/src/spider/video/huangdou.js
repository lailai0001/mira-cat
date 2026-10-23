import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'zlib';

const KEY = 'py_huangdou';
const NAME = '黄豆短剧';

// ===== 黄豆短剧上游协议 (2026-10-23 逆向官方 App 公开包并逐项实测打通) =====
// 旧版全空原因: 推上去的是缺失函数定义的压缩残片 (home 一调即 ReferenceError),
// 且其依赖的第三方代理 hd.wulii.de5.net 的上游登录也已失效 (login fail)。
// 现行版直连站方线路, 不依赖任何第三方代理 / Worker:
// - 线路: App 内置 china_1 线路 host 列表, 登录时逐个试, 用第一个通的 (失效自动切换)。
// - 请求: POST {host}/api<path>
//     body = IV(16B) || AES-256-CBC/PKCS7( gzip( JSON{token, deviceId, data} ) )
//     key  = HMAC-SHA256( key=utf8(平台密钥), msg=rid 的 UUID 原始 16 字节 )
//     headers: version=2.0.0, deviceType=web, time=<秒>, requestId=<rid>,
//              sessionId=<客户端生成的无横线 UUID>, X-Lang=zh-CN,
//              sign = md5("Dart|<sid>|<rid>|<time>|<host+path>") + "-" + <time>
// - 登录: /login/device 游客登录 (line_code=china_1), token = user_id + "_" + data.token。
// - 会话失效返回 errorCode 2002 → 重新登录重试一次。
// - 播放: /drama/play 返回带签名的 HLS (AES-128 加密分片, 密钥/分片均为 CDN 直链,
//   播放器原生可解); VIP 集站方只给试看 mp4 (与官方 App 游客口径一致), 集名已标注。
const PLATFORM_SECRET = '7961beb44246e3012ce228d6b5ced05a'; // web 平台密钥 (App 公开包内常量)
const LINE_HOSTS = [
  'https://sxqirtho.top',
  'https://qicuknlj.top',
  'https://ferncider.cc',
  'https://hvthtcpa.top',
  'https://onyxripple.cc',
  'https://vivifable.top',
  'https://kucvcxrv.cc',
  'https://larkgarden.top',
  'https://niniharbor.top',
  'https://larksummit.icu',
  'https://tideember.cc',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_SIZE = 18;

const CODES = [
  ['yuandou', '黄豆原创'],
  ['mod', '魔改短剧'],
  ['caibian', '擦边短剧'],
  ['zhenren', '真人短剧'],
  ['erciyuan', '动漫'],
  ['aiman', '影院'],
  ['zongyi', '贤者'],
  ['heiliao', '黑料'],
];

// 2026-10-23 实测的 /drama/navFilter 快照: 仅作实时拉取失败时的兜底分类表
const FALLBACK_FILTERS = {
  yuandou: [
    { name: '黄豆原创', filter: { cat_id: '246506', order: 'new:top' } },
    { name: 'UP原创', filter: { order: 'new:top', source: 'up' } },
  ],
  mod: [
    { name: '大神精选', filter: { cat_id: '246502', order: 'new:top' } },
    { name: '单体作品', filter: { cat_id: '246503', order: 'new:top' } },
    { name: '影视魔改', filter: { cat_id: '900011', order: 'new:top' } },
    { name: '国漫AI', filter: { cat_id: '5822103', order: 'new:top' } },
    { name: '魔改短剧', filter: { cat_id: '2345505' } },
  ],
  caibian: [
    { name: '最新', filter: { cat_id: '246505', order: 'new:top' } },
    { name: '推荐', filter: { cat_id: '246505', order: 'hot:top' } },
    { name: '全部', filter: { cat_id: '246505' } },
  ],
  zhenren: [
    { name: '都市', filter: { cat_id: '817202', order: 'new:top' } },
    { name: '古装', filter: { cat_id: '900006', order: 'new:top' } },
    { name: '民国', filter: { cat_id: '1050901', order: 'new:top' } },
    { name: '重生', filter: { cat_id: '900007', order: 'new:top' } },
    { name: '异能', filter: { cat_id: '900008', order: 'new:top' } },
  ],
  erciyuan: [
    { name: '里番', filter: { cat_id: '817201', order: 'new:top' } },
    { name: '国漫', filter: { cat_id: '4324502', order: 'hot:top' } },
    { name: '日漫', filter: { cat_id: '1050906', order: 'new:top' } },
    { name: '动画同人', filter: { cat_id: '481301', order: 'new:top' } },
    { name: '游戏同人', filter: { cat_id: '900002', order: 'new:top' } },
  ],
  aiman: [
    { name: '美剧', filter: { cat_id: '6655003', order: 'new:top' } },
    { name: '韩剧', filter: { cat_id: '6655009', order: 'new:top' } },
    { name: '漫剧', filter: { cat_id: '1050902', order: 'new:top' } },
  ],
  zongyi: [
    { name: '最新', filter: { cat_id: '1050905', order: 'new:top' } },
    { name: '推荐', filter: { cat_id: '1050905', order: 'hot:top' } },
  ],
  heiliao: [
    { name: '最新', filter: { cat_id: '900012', order: 'new:top' } },
    { name: '推荐', filter: { cat_id: '900012', order: 'hot:top' } },
  ],
};

const S = {
  host: '',
  token: '',
  sid: crypto.randomUUID().replace(/-/g, ''),
  did: crypto.randomUUID(),
  pending: null,
};
const FILTER_MAP = {}; // type_id -> /drama/list 过滤参数

function aesKey(rid) {
  return crypto
    .createHmac('sha256', Buffer.from(PLATFORM_SECRET, 'utf8'))
    .update(Buffer.from(String(rid).replace(/-/g, ''), 'hex'))
    .digest();
}

function encryptBody(obj, key) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([iv, c.update(gz), c.final()]);
}

function decryptBody(buf, key) {
  const d = crypto.createDecipheriv('aes-256-cbc', key, buf.subarray(0, 16));
  const plain = Buffer.concat([d.update(buf.subarray(16)), d.final()]);
  return JSON.parse(zlib.gunzipSync(plain).toString('utf8'));
}

async function rawApi(host, path, data, tokenStr) {
  const rid = crypto.randomUUID();
  const key = aesKey(rid);
  const time = Math.floor(Date.now() / 1000);
  const url = host + '/api' + path;
  const hostPath = url.replace(/^https?:\/\//, '');
  const sign =
    crypto.createHash('md5').update(`Dart|${S.sid}|${rid}|${time}|${hostPath}`, 'utf8').digest('hex') + '-' + time;
  const headers = {
    'User-Agent': UA,
    version: '2.0.0',
    deviceType: 'web',
    time: String(time),
    sign,
    requestId: rid,
    sessionId: S.sid,
    deviceBrand: '',
    deviceModel: '',
    systemName: '',
    systemVersion: '',
    'X-Lang': 'zh-CN',
  };
  const body = encryptBody({ token: tokenStr || '', deviceId: S.did, data: data || {} }, key);
  const res = await req.post(url, body, {
    headers,
    responseType: 'arraybuffer',
    timeout: 25000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });
  const buf = Buffer.from(res.data);
  try {
    return decryptBody(buf, key);
  } catch (e) {
    // 服务器在解密前就出错时回明文 JSON (如 errorCode 2001 请求数据错误)
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch (e2) {
      throw new Error('bad response http=' + res.status);
    }
  }
}

async function doLogin() {
  const data = {
    line_code: 'china_1',
    channel_code: '',
    share_code: '',
    clipboard_text: '',
    force_new: '',
    device_info: { browserName: 'Chrome', language: 'zh-CN', userAgent: UA, platform: 'Windows' },
  };
  for (const h of LINE_HOSTS) {
    try {
      const j = await rawApi(h, '/login/device', data, '');
      if (j && j.status === 'y' && j.data && j.data.token) {
        S.host = h;
        S.token = String(j.data.user_id) + '_' + String(j.data.token);
        return true;
      }
    } catch (e) {}
  }
  return false;
}

async function ensureLogin(force) {
  if (S.token && !force) return true;
  if (!S.pending) {
    S.pending = doLogin().finally(() => {
      S.pending = null;
    });
  }
  return S.pending;
}

async function api(path, data) {
  if (!(await ensureLogin(false))) throw new Error('login failed');
  let j;
  try {
    j = await rawApi(S.host, path, data, S.token);
  } catch (e) {
    // 当前线路传输层挂了: 重新登录 (会重新扫描线路) 后重试一次
    if (!(await ensureLogin(true))) throw e;
    j = await rawApi(S.host, path, data, S.token);
    return j;
  }
  if (j && j.errorCode === 2002) {
    if (!(await ensureLogin(true))) throw new Error('relogin failed');
    j = await rawApi(S.host, path, data, S.token);
  }
  return j;
}

// ---------- 数据整形 ----------

function card(it) {
  if (!it || typeof it !== 'object') return null;
  const id = it.id ? String(it.id) : String(it.drama_id || '').replace(/^(rp_|up_)/, '');
  if (!id) return null;
  return {
    vod_id: id,
    vod_name: String(it.name || '黄豆短剧'),
    vod_pic: it.img_y || it.img_x || it.img || it.cover || '',
    vod_remarks: String(
      it.update_label || it.corner || (it.episode_count ? '全' + it.episode_count + '集' : '')
    ),
  };
}

function cardsOf(list) {
  const out = [];
  const seen = new Set();
  for (const it of list || []) {
    const c = card(it);
    if (c && !seen.has(c.vod_id)) {
      seen.add(c.vod_id);
      out.push(c);
    }
  }
  return out;
}

async function filtersFor(code) {
  try {
    const j = await api('/drama/navFilter', { code });
    const list = j && j.data && Array.isArray(j.data.list) ? j.data.list : null;
    if (list && list.length) {
      return list.map((e) => ({ name: e.name || '', filter: e.filter || {} }));
    }
  } catch (e) {}
  return FALLBACK_FILTERS[code] || [];
}

async function filterOf(tid) {
  if (!tid || tid === 'all') return {};
  if (FILTER_MAP[tid]) return FILTER_MAP[tid];
  const m = /^f:([a-z]+):(\d+)$/.exec(tid);
  if (m) {
    const entries = await filtersFor(m[1]);
    entries.forEach((e, i) => {
      FILTER_MAP['f:' + m[1] + ':' + i] = e.filter || {};
    });
    if (FILTER_MAP[tid]) return FILTER_MAP[tid];
  }
  return {};
}

async function listItems(params) {
  const j = await api('/drama/list', params);
  return (j && j.data && j.data.list) || [];
}

function pageResult(pg, list) {
  return {
    page: pg,
    pagecount: list.length >= PAGE_SIZE ? pg + 1 : pg,
    limit: PAGE_SIZE,
    total: list.length,
    list,
  };
}

function pageOf(body) {
  const pg = parseInt(body && body.page, 10) || 1;
  return pg < 1 ? 1 : pg;
}

// ---------- 路由 ----------

async function init() {
  try {
    await ensureLogin(false);
  } catch (e) {}
  return {};
}

async function home() {
  const per = await Promise.all(CODES.map(async ([code]) => filtersFor(code)));
  const classes = [{ type_id: 'all', type_name: '全部' }];
  CODES.forEach(([code, codeName], ci) => {
    per[ci].forEach((e, i) => {
      const tid = 'f:' + code + ':' + i;
      FILTER_MAP[tid] = e.filter || {};
      const nm = e.name && e.name !== codeName ? codeName + '·' + e.name : e.name || codeName;
      classes.push({ type_id: tid, type_name: nm });
    });
  });
  return { class: classes };
}

async function homeVod() {
  try {
    const j = await api('/drama/navBlock', { code: 'yuandou', tab: 'recommend', page: '1' });
    const blocks = (j && j.data && j.data.list) || [];
    let items = [];
    for (const b of blocks) {
      if (b && Array.isArray(b.items)) items = items.concat(b.items);
    }
    const list = cardsOf(items).slice(0, 30);
    if (list.length) return { list };
  } catch (e) {}
  try {
    return { list: cardsOf(await listItems({ page: '1', page_size: String(PAGE_SIZE) })) };
  } catch (e) {
    return { list: [] };
  }
}

async function category(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const tid = String(body.id || 'all');
  const pg = pageOf(body);
  const filter = await filterOf(tid);
  const params = { page: String(pg), page_size: String(PAGE_SIZE) };
  for (const [k, v] of Object.entries(filter)) {
    if (v !== '' && v != null) params[k] = String(v);
  }
  let list = [];
  try {
    list = cardsOf(await listItems(params));
  } catch (e) {}
  return pageResult(pg, list);
}

async function detail(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  let id = body.id;
  if (Array.isArray(id)) id = id[0];
  const dramaId = String(id || '').replace(/^(rp_|up_)/, '');
  if (!dramaId) return { list: [] };
  let d = null;
  try {
    const j = await api('/drama/detail', { id: dramaId });
    d = j && j.data;
  } catch (e) {}
  if (!d) return { list: [] };
  const eps = Array.isArray(d.episodes) ? d.episodes.slice() : [];
  eps.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  let parts = eps.map((ep, i) => {
    const seq = ep.seq != null ? ep.seq : i + 1;
    let nm = String(ep.name || '第' + seq + '集');
    if (ep.type && ep.type !== 'free') nm += ' [VIP]';
    return nm + '$' + dramaId + '|' + seq;
  });
  if (!parts.length) {
    const n = parseInt(d.episode_count, 10) || 0;
    for (let i = 1; i <= n; i++) parts.push('第' + i + '集$' + dramaId + '|' + i);
  }
  return {
    list: [
      {
        vod_id: String(id),
        vod_name: String(d.name || '黄豆短剧'),
        vod_pic: d.img_y || d.img_x || d.img || '',
        vod_content: String(d.description || ''),
        vod_remarks: String(d.update_label || ''),
        type_name: String(d.category || ''),
        vod_play_from: NAME,
        vod_play_url: parts.join('#'),
      },
    ],
  };
}

async function play(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const raw = String(body.id || '');
  const cut = raw.indexOf('|');
  const did = cut >= 0 ? raw.slice(0, cut) : raw;
  const seq = cut >= 0 ? raw.slice(cut + 1) : '1';
  const dramaId = String(did || '').replace(/^(rp_|up_)/, '');
  if (!dramaId) return { parse: 0, url: '', header: {} };
  try {
    const j = await api('/drama/play', { id: dramaId, seq: String(seq || '1') });
    const d = j && j.data;
    let url = (d && d.m3u8) || '';
    if (!url && d && Array.isArray(d.lines) && d.lines.length) url = d.lines[0].url || '';
    return { parse: 0, url: url || '', header: { 'User-Agent': UA } };
  } catch (e) {
    return { parse: 0, url: '', header: {} };
  }
}

async function search(reqIn) {
  const body = (reqIn && reqIn.body) || {};
  const wd = String(body.wd || '').trim();
  const pg = pageOf(body);
  if (!wd) return { page: pg, pagecount: 1, limit: PAGE_SIZE, total: 0, list: [] };
  let list = [];
  try {
    list = cardsOf(await listItems({ page: String(pg), page_size: String(PAGE_SIZE), keywords: wd }));
  } catch (e) {}
  return pageResult(pg, list);
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
