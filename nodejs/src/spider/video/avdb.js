import req from '../../util/req.js';

const KEY = 'py_avdb';
const NAME = 'Avdb';
const API = 'https://avdbapi.com/api.php/provide/vod';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

async function fetchJson(url) {
  try {
    const { data } = await req.get(url, { headers: { 'User-Agent': UA }, timeout: 20000 });
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return null;
  }
}

async function home() {
  const s = await fetchJson(API);
  const list = [];
  if (s && s.class) {
    s.class.forEach(r => {
      list.push({ type_id: String(r.type_id), type_name: r.type_name });
    });
  }
  return { class: list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '');
  let page = parseInt(body.page, 10) || 1;
  if (page <= 0) page = 1;
  const url = `${API}?t=${encodeURIComponent(id)}&ac=detail&pg=${page}`;
  const n = await fetchJson(url);
  const list = [];
  if (n && n.list) {
    n.list.forEach(c => {
      list.push({
        vod_id: String(c.id),
        vod_name: c.name,
        vod_pic: c.poster_url || c.pic || '',
        vod_remarks: c.tag || '',
      });
    });
  }
  return {
    page,
    pagecount: list.length < 20 ? page : 999,
    limit: list.length,
    total: 999 * 20,
    list,
  };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '');
  const url = `${API}?ac=detail&ids=${encodeURIComponent(id)}`;
  const info = await fetchJson(url);
  if (!info || !info.list || !info.list[0]) return { list: [] };
  const item = info.list[0];
  let playUrl = '';
  try {
    if (item.episodes) {
      // 尝试从 episodes 里找 embed 链接
      const eps = typeof item.episodes === 'string' ? JSON.parse(item.episodes) : item.episodes;
      const serverData = eps.server_data || eps;
      for (const k of Object.keys(serverData)) {
        const v = serverData[k];
        const link = v.link_embed || v.link || '';
        if (!link) continue;
        const { data } = await req.get(link, {
          headers: { 'User-Agent': UA, 'Referer': 'https://avdbapi.com/' },
          timeout: 20000,
        });
        const html = String(data || '');
        // 新格式: window.PLAYER_CONFIG = {"m3u8":"https:\/\/helvid.com\/m\/..."}
        let m = html.match(/"m3u8"\s*:\s*"((?:https?:)?\\?\/\\?\/[^"]+?\.m3u8[^"]*)"/);
        if (m && m[1]) {
          playUrl = m[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
          if (playUrl.startsWith('//')) playUrl = 'https:' + playUrl;
          break;
        }
        // 旧格式兜底: m3u8:"/play/token_hash?hash=..."
        m = html.match(/m3u8\s*:\s*"((\/play\/token_hash\?hash=[^"]+))"/);
        if (m && m[1]) {
          try { playUrl = new URL(link).origin + m[1]; } catch (e) {}
          break;
        }
      }
    }
  } catch (e) {}
  return {
    list: [{
      vod_id: id,
      vod_name: item.name || id,
      vod_pic: item.poster_url || item.pic || '',
      vod_play_from: NAME,
      vod_play_url: `播放$${playUrl}`,
    }],
  };
}

// m3u8 净化代理: helvid 返回的 playlist 带 #U18-CANARY 非标标签，
// MiraPlayer 解析异常导致无法快进/后退。Worker 抓取后去掉该标签再返回。
// 用户在 Cloudflare 部署 avdb-m3u8-clean-worker.js 后，把实际地址填入下面;
// 为空时自动回退直连（保持原行为，不会断播）。
const M3U8_PROXY = 'https://avdb-m3u8.li768435813.workers.dev';

async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '');
  // 注意: helvid.com 的分片有 Referer 检查，用 helvid.com 做 Referer 会 403
  // 必须用 avdbapi.com 或 upload18.org，或不带 Referer
  let playUrl = url;
  let header = { 'User-Agent': UA, 'Referer': 'https://avdbapi.com/' };
  if (M3U8_PROXY && /helvid\.com\/m\//.test(url)) {
    playUrl = `${M3U8_PROXY}/playlist.m3u8?url=${encodeURIComponent(url)}`;
    // 走自家 Worker，不需要 Referer
    header = { 'User-Agent': UA };
  }
  return {
    parse: 0,
    url: playUrl,
    header,
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  let page = parseInt(body.page, 10) || 1;
  if (page <= 0) page = 1;
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: [] };
  const url = `${API}?ac=detail&wd=${encodeURIComponent(wd)}&pg=${page}`;
  const n = await fetchJson(url);
  const list = [];
  if (n && n.list) {
    n.list.forEach(c => {
      list.push({
        vod_id: String(c.id),
        vod_name: c.name,
        vod_pic: c.poster_url || c.pic || '',
        vod_remarks: c.tag || '',
      });
    });
  }
  return {
    page,
    pagecount: list.length < 20 ? page : 999,
    limit: list.length,
    total: 999 * 20,
    list,
  };
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
