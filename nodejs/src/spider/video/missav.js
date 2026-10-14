// MissAV - CatPawOpen JS Spider
// 参考 REX forward.missav.tut (宝宝巴士)，站点 missav.fans
// 列表: /{endpoint} ; 详情: /cn/{slug}
import req from '../../util/req.js';

const KEY = 'py_missav';
const NAME = 'MissAV';
const HOST = 'https://missav.fans';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const CLASSES = [
  { type_id: 'dm539/cn/new', type_name: '最近更新' },
  { type_id: 'dm278/cn/chinese-subtitle', type_name: '中文字幕' },
  { type_id: 'dm278/cn/new', type_name: '新片上市' },
  { type_id: 'dm278/cn/release', type_name: '已发布' },
  { type_id: 'dm278/cn/uncensored-leak', type_name: '无码流出' },
  { type_id: 'dm277/cn/siro', type_name: 'SIRO' },
  { type_id: 'dm277/cn/gana', type_name: 'GANA' },
];

async function fetchHtml(url) {
  try {
    const { data } = await req.get(url, {
      headers: {
        'User-Agent': UA,
        Referer: HOST + '/',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 20000,
    });
    return typeof data === 'string' ? data : '';
  } catch (e) {
    return '';
  }
}

function parseList(html) {
  const list = [];
  // 简化：直接找所有视频链接和对应的标题、封面
  const divRe = /<div[^>]*class="thumbnail group"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let dm;
  const seen = new Set();
  while ((dm = divRe.exec(html)) !== null) {
    const block = dm[1];
    const linkM = block.match(/<a href="(https?:\/\/missav\.fans\/cn\/[^"]+)"/);
    if (!linkM) continue;
    const link = linkM[1];
    if (seen.has(link)) continue;
    seen.add(link);
    const idMatch = link.match(/\/cn\/([^\/\?]+)/);
    const vid = idMatch ? idMatch[1] : link;
    // 封面：优先 data-src
    let pic = '';
    const imgM = block.match(/<img[^>]+data-src="([^"]+)"/) || block.match(/<img[^>]+src="(https?:\/\/[^"]+)"/);
    if (imgM) pic = imgM[1];
    // 标题
    let name = vid;
    const titleM = block.match(/class="[^"]*text-secondary group-hover:text-primary[^"]*"[^>]*>([^<]+)</);
    if (titleM) name = titleM[1].trim() || vid;
    list.push({
      vod_id: vid,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: '',
    });
    if (list.length >= 30) break;
  }
  return list;
}

async function home() {
  return { class: CLASSES, filters: {}, list: [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || 'dm278/cn/recent_update');
  let url = `${HOST}/${tid}`;
  if (page > 1) url += `?page=${page}`;
  const html = await fetchHtml(url);
  const list = parseList(html);
  return { page, pagecount: 100, limit: list.length, total: 100, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const vid = String(body.id || '');
  const url = `${HOST}/cn/${vid}`;
  const html = await fetchHtml(url);
  let title = vid;
  const tm = html.match(/<title>([^<]+)<\/title>/);
  if (tm) title = tm[1].split('|')[0].trim() || vid;
  let pic = '';
  const pm = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (pm) pic = pm[1];
  // 从 HTML 提取 UUID，构造播放地址（对照 REX）
  const uuidMatch = html.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
  let playFrom, playUrl;
  if (uuidMatch) {
    const hostMatch = html.match(/https?:\/\/(surrit\.[^\/\\"\']+)/);
    const host = hostMatch ? hostMatch[1].replace(/\\/g, '') : 'surrit.mrstcdn.store';
    const base = `https://${host}/${uuidMatch[0]}`;
    playFrom = ['自动', '1080P', '720P', '480P', '360P'];
    const urls = [
      `${base}/playlist.m3u8`,
      `${base}/1080p/video.m3u8`,
      `${base}/720p/video.m3u8`,
      `${base}/480p/video.m3u8`,
      `${base}/360p/video.m3u8`,
    ];
    // 尝试 javtrailers 备用源（老视频可能已从 surrit 下架）
    const codeMatch = vid.match(/^([a-zA-Z]+)-(\d+)$/);
    if (codeMatch) {
      const prefix = codeMatch[1].toLowerCase();
      const code = `${prefix}-${codeMatch[2]}`;
      const first = code[0];
      const folder = code.slice(0, 3);
      const jtUrl = `https://media.javtrailers.com/hlsvideo/freepv/${first}/${folder}/${code}/playlist.m3u8`;
      playFrom.push('备用源');
      urls.push(jtUrl);
    }
    playFrom = playFrom.join('$$$');
    playUrl = urls.map(u => `播放$${u}`).join('$$$');
  } else {
    playFrom = 'MissAV';
    playUrl = `播放$${url}`;
  }
  return {
    list: [{
      vod_id: vid,
      vod_name: title,
      vod_pic: pic,
      vod_play_from: playFrom,
      vod_play_url: playUrl,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const url = String(body.id || '');
  // 如果是 m3u8 直链，直接返回；否则嗅探
  if (url.includes('.m3u8')) {
    return { parse: 0, url };
  }
  return { parse: 1, url };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || body.keyword || '');
  if (!wd) return { list: [] };
  const url = `${HOST}/cn/search/${encodeURIComponent(wd)}`;
  const html = await fetchHtml(url);
  const list = parseList(html);
  return { list };
}

async function init(reqIn) { return {}; }

export default function createSpider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async (request, reply) => {
        try {
          const data = await init({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/home', async (request, reply) => {
        try {
          const data = await home();
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/category', async (request, reply) => {
        try {
          const data = await category({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/detail', async (request, reply) => {
        try {
          const body = request.body || {};
          const data = await detail({ body: { id: body.id || body.ids } });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/play', async (request, reply) => {
        try {
          const data = await play({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/search', async (request, reply) => {
        try {
          const data = await search({ body: request.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
    },
  };
}
