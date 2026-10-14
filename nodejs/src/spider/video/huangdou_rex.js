// 黄豆短剧 - CatPawOpen 格式(由 REX forward.huangdou.tut v2.0.2 转换)
// 站点经 Cloudflare Worker 反代: https://hd.wulii.de5.net
// 列表/搜索/详情/播放全部实测通过(2026-10-14)
import req from '../../util/req.js';

const KEY = 'py_huangdou_rex';
const NAME = '黄豆短剧';
const PROXY = 'https://hd.wulii.de5.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PLAY_REFERER = 'https://tideember.cc/home';

const JSON_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json',
};

// 分类: 源自 REX loadCategory 的枚举
const CLASSES = [
  { type_id: 'all', type_name: '全部' },
  { type_id: 'yuandou', type_name: '黄豆原创' },
  { type_id: 'mod', type_name: '魔改短剧' },
  { type_id: 'caibian', type_name: '擦边短剧' },
  { type_id: 'zhenren', type_name: '真人短剧' },
  { type_id: 'erciyuan', type_name: '动漫' },
  { type_id: 'aiman', type_name: '影院' },
  { type_id: 'zongyi', type_name: '贤者' },
  { type_id: 'heiliao', type_name: '黑料' },
];

const PAGE_SIZE = 18;

function t(v) {
  return String(v == null ? '' : v).trim();
}

// REX toItem: 去掉 rp_/up_ 前缀取裸 id, 封面取 img_y/img_x/img/cover/pic
function cleanId(it) {
  it = it || {};
  let rawId = t(it.id).replace(/^rp_/, '').replace(/^up_/, '');
  if (!rawId) rawId = t(it.drama_id).replace(/^up_/, '').replace(/^rp_/, '');
  return rawId;
}

function cleanPic(it) {
  return t(it.img_y || it.img_x || it.img || it.cover || it.pic);
}

function toVod(it) {
  const id = cleanId(it);
  if (!id) return null;
  const title = t(it.name || it.title || it.t) || id;
  const remarks = t(it.update_label || it.corner || (it.episode_count ? '全' + it.episode_count + '集' : ''));
  return {
    vod_id: id,
    vod_name: title,
    vod_pic: cleanPic(it),
    vod_remarks: remarks,
  };
}

function pickList(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  const d = obj.data != null ? obj.data : obj;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.items)) return d.items;
  }
  if (Array.isArray(obj.list)) return obj.list;
  return [];
}

async function getJson(path, tries = 3) {
  let lastErr = null;
  for (let s = 0; s < tries; s++) {
    try {
      const res = await req.get(PROXY + path, { headers: JSON_HEADERS, timeout: 20000 });
      let d = res && res.data;
      if (d == null) return null;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch (e) { return null; }
      }
      if (d && d.status === 'n') throw new Error(d.error || '接口返回失败');
      return d;
    } catch (e) {
      lastErr = e;
      const st = e && e.response && e.response.status;
      // 4xx(除429)不重试, 其余错误退避重试
      if (st && st >= 400 && st < 500 && st !== 429) throw e;
      if (s < tries - 1) await new Promise(r => setTimeout(r, 800 * (s + 1)));
    }
  }
  throw lastErr;
}

async function init() {
  return {};
}

async function home() {
  return { class: CLASSES, filters: {} };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const code = String(body.id || 'all');
  try {
    // 黄豆原创: navBlock 特殊接口(区块 items 展平)
    if (code === 'yuandou') {
      const nb = await getJson(`/navBlock?code=yuandou&tab=recommend&page=${page}`);
      const blocks = pickList(nb);
      let items = [];
      for (const b of blocks) {
        if (b && Array.isArray(b.items)) items = items.concat(b.items);
        else if (b && (b.id || b.drama_id)) items.push(b);
      }
      const list = items.map(toVod).filter(Boolean);
      return { page, pagecount: 999, limit: list.length, total: 999 * PAGE_SIZE, list };
    }
    let q = `/list?page=${page}&page_size=${PAGE_SIZE}`;
    if (code && code !== 'all') {
      try {
        const nf = await getJson(`/navFilter?code=${encodeURIComponent(code)}`);
        const tabs = pickList(nf);
        const flt = tabs && tabs[0] && tabs[0].filter;
        if (flt && flt.cat_id) q += `&cat_id=${encodeURIComponent(flt.cat_id)}`;
      } catch (e) { /* 无 tab 信息就退化成普通列表 */ }
    }
    const obj = await getJson(q);
    const list = pickList(obj).map(toVod).filter(Boolean);
    return { page, pagecount: 999, limit: list.length, total: 999 * PAGE_SIZE, list };
  } catch (e) {
    return { page, pagecount: 1, limit: 30, total: 0, list: [] };
  }
}

async function detail(reqIn) {
  let id = reqIn?.body?.id;
  if (Array.isArray(id)) id = id[0];
  id = t(id).replace(/^hd:\/\//, '').replace(/^rp_/, '').replace(/^up_/, '').split('|')[0];
  if (!id) return { list: [] };
  try {
    const obj = await getJson(`/detail?id=${encodeURIComponent(id)}`);
    const d = (obj && obj.data && typeof obj.data === 'object') ? obj.data : {};
    const title = t(d.name || d.title) || id;
    const pic = t(d.img_y || d.img_x || d.img || d.cover);
    const desc = t(d.description || d.summary);
    const remarks = t(d.update_label || (d.episode_count ? '全' + d.episode_count + '集' : ''));
    const eps = Array.isArray(d.episodes) ? d.episodes : [];
    const count = Number(d.episode_count || eps.length || 1) || 1;
    const epList = [];
    if (eps.length) {
      for (const ep of eps) {
        const seq = String(t(ep.seq || ep.episode || ep.ep) || (epList.length + 1));
        let epTitle = t(ep.name || ep.title) || seq;
        if (/^\d+$/.test(epTitle)) epTitle = '第' + epTitle + '集';
        epList.push({ name: epTitle, seq });
      }
    } else {
      for (let n = 1; n <= count; n++) epList.push({ name: '第' + n + '集', seq: String(n) });
    }
    if (!epList.length) return { list: [] };
    return {
      list: [{
        vod_id: id,
        vod_name: title,
        vod_pic: pic,
        vod_content: desc,
        vod_remarks: remarks,
        vod_play_from: NAME,
        vod_play_url: epList.map(e => `${e.name}$hd://${id}|${e.seq}`).join('#'),
      }],
    };
  } catch (e) {
    return { list: [] };
  }
}

// /play?id=&seq= 返回 data.lines[{name,url}] 或 data.m3u8, 取第一条直链
async function play(reqIn) {
  const raw = t(reqIn?.body?.id);
  const m = raw.match(/^hd:\/\/([^|]+)\|?(\d*)$/);
  const id = m ? m[1] : '';
  const seq = (m && m[2]) || '1';
  if (!id) return { parse: 0, url: '', header: {} };
  try {
    const obj = await getJson(`/play?id=${encodeURIComponent(id)}&seq=${encodeURIComponent(seq)}`);
    const pd = (obj && obj.data && typeof obj.data === 'object') ? obj.data : {};
    let url = '';
    if (Array.isArray(pd.lines)) {
      for (const ln of pd.lines) {
        if (ln && t(ln.url)) { url = t(ln.url); break; }
      }
    }
    if (!url) url = t(pd.m3u8 || pd.url);
    if (!url) return { parse: 0, url: '', header: {} };
    return {
      parse: 0,
      url,
      header: {
        'User-Agent': UA,
        'Referer': PLAY_REFERER,
        'Origin': 'https://tideember.cc',
      },
    };
  } catch (e) {
    return { parse: 0, url: '', header: {} };
  }
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = t(body.wd);
  if (!wd) return { page, pagecount: 1, limit: 30, total: 0, list: [] };
  try {
    const obj = await getJson(`/search?keyword=${encodeURIComponent(wd)}&page=${page}`);
    const list = pickList(obj).map(toVod).filter(Boolean);
    return { page, pagecount: 999, limit: list.length, total: 999 * PAGE_SIZE, list };
  } catch (e) {
    return { page, pagecount: 1, limit: 30, total: 0, list: [] };
  }
}

export default function spider() {
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
