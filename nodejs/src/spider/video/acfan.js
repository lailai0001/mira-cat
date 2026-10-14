import req from '../../util/req.js';

const KEY = 'py_acfan';
const NAME = 'AcFan';
const HOST = 'https://acf.f76typd0.work';
const UA = 'Mozilla/5.0 (Linux; Android 12; SM-G9750 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/89.0.4389.72 MQQBrowser/6.2 TBS/046279 Mobile Safari/537.36';

const CAT_PATH = {
  guochan: 'GC/2075051039321464834',
  rifan: '3/2072212947517390849',
  pao: 'ITEM_LI9_TWI_N6Y/2072654840359600130',
  motion: 'MOTION_ANIME/2072654931050029058',
  dcg: '2/2072212891277045761',
  twofived: '2_5D/2072655042194890753',
  twod: '2D/2072655119809298434',
  aigen: 'AI/2072655204107608066',
  mmd: 'MMD/2072655243595792385',
  cosplay: 'COSPLAY/2075576278568513538',
};

const CLASSES = [
  { type_id: 'guochan', type_name: '国产动漫' },
  { type_id: 'rifan', type_name: '里番' },
  { type_id: 'pao', type_name: '泡面番' },
  { type_id: 'motion', type_name: 'Motion Anime' },
  { type_id: 'dcg', type_name: '3DCG' },
  { type_id: 'twofived', type_name: '2.5D' },
  { type_id: 'twod', type_name: '2D动画' },
  { type_id: 'aigen', type_name: 'AI生成' },
  { type_id: 'mmd', type_name: 'MMD' },
  { type_id: 'cosplay', type_name: 'Cosplay' },
];

function headers() {
  return {
    'User-Agent': UA,
    'Referer': HOST + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
}

async function getHtml(url) {
  try {
    const { data } = await req.get(url, { headers: headers(), timeout: 15000 });
    return String(data || '');
  } catch (e) {
    return '';
  }
}

function clean(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseList(html) {
  const res = [];
  if (!html) return res;
  const seen = new Set();
  const re = /href="\/watch\/(CNT\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const vid = m[1];
    if (seen.has(vid)) continue;
    seen.add(vid);
    const block = html.substring(m.index, m.index + 6000);
    let name = '';
    const nm = block.match(/<img[^>]*alt="([^"]*)"/i);
    if (nm) name = nm[1];
    let duration = '';
    const dm = block.match(/>(\d{1,3}:\d{2}(?::\d{2})?)<\/span>/);
    if (dm) duration = dm[1];
    // 封面：找 coverUrl 附近的 URL
    let pic = '';
    const cm = block.match(/coverUrl[^h]*?(https?:\/\/[^\s"\\]+)/);
    if (cm) pic = cm[1];
    const sid = vid + '@@@' + '@@@' + encodeURIComponent(name) + '@@@' + encodeURIComponent(pic);
    res.push({
      vod_id: sid,
      vod_name: clean(name) || vid,
      vod_pic: pic,
      vod_remarks: clean(duration),
    });
  }
  return res;
}

async function init() {
  return {};
}

async function home() {
  let list = [];
  try {
    const html = await getHtml(HOST + '/');
    list = parseList(html);
  } catch (e) {}
  return { class: CLASSES, filters: {}, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const tid = String(body.id || 'guochan');
  const path = CAT_PATH[tid] || '';
  if (!path) return { page, pagecount: 1, limit: 24, total: 0, list: [] };
  const url = page > 1
    ? `${HOST}/category/${path}/page/${page}`
    : `${HOST}/category/${path}`;
  const html = await getHtml(url);
  const pages = [...html.matchAll(/\/category\/[^"']+\/page\/(\d+)/g)].map(x => parseInt(x[1], 10));
  const pc = pages.length ? Math.max(...pages) : 1;
  const list = parseList(html);
  return { page, pagecount: pc, limit: 24, total: pc * 24, list };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const sid = String(ids[0] || '');
  const ps = sid.split('@@@');
  const vid = ps[0] || sid;
  const play = ps[1] || '';
  const name = ps[2] ? decodeURIComponent(ps[2]) : vid;
  const pic = ps[3] ? decodeURIComponent(ps[3]) : '';
  if (play) {
    return { list: [{
      vod_id: sid, vod_name: name, vod_pic: pic,
      vod_content: name, vod_play_from: 'AcFan',
      vod_play_url: '播放$' + play,
    }]};
  }
  const html = await getHtml(`${HOST}/watch/${vid}`);
  let vod_name = name, vod_pic = pic, vod_content = '', m3u8 = '', cat_name = '';
  const jmRe = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
  let jm;
  while ((jm = jmRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(jm[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'VideoObject') {
          vod_name = item.name || vod_name;
          vod_content = item.description || '';
          vod_pic = item.thumbnailUrl || vod_pic;
          m3u8 = item.contentUrl || '';
        } else if (item['@type'] === 'BreadcrumbList') {
          const els = item.itemListElement || [];
          if (els.length >= 2) cat_name = els[1].name || '';
        }
      }
    } catch (e) {}
  }
  if (!vod_pic) {
    const og = html.match(/property="og:image"[^>]*content="([^"]*)"/);
    if (og) vod_pic = og[1];
  }
  if (vod_name === vid || !vod_name) {
    const tm = html.match(/<title>(.*?)<\/title>/);
    if (tm) vod_name = tm[1].replace(' - AcFan', '').trim();
  }
  const playUrl = m3u8 ? ('播放$' + m3u8) : '';
  return { list: [{
    vod_id: sid, vod_name, vod_pic,
    vod_content: (cat_name ? '分类: ' + cat_name + '\n' : '') + vod_content,
    vod_play_from: 'AcFan', vod_play_url: playUrl,
  }]};
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '');
  const ps = id.split('@@@');
  const url = ps[1] || id;
  if (/\.(m3u8|mp4|avi|flv|mkv|ts)(\?|$)/i.test(url) || /m3u8/i.test(url)) {
    return { parse: 0, url, header: headers() };
  }
  // 尝试从详情页提取
  const html = await getHtml(`${HOST}/watch/${ps[0]}`);
  const jmRe = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
  let jm, m3u8 = '';
  while ((jm = jmRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(jm[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'VideoObject' && item.contentUrl) {
          m3u8 = item.contentUrl;
          break;
        }
      }
    } catch (e) {}
    if (m3u8) break;
  }
  if (m3u8) return { parse: 0, url: m3u8, header: headers() };
  return { parse: 1, url, header: headers() };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const wd = String(body.wd || '').trim();
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const html = await getHtml(`${HOST}/search?q=${encodeURIComponent(wd)}&page=${page}`);
  const pages = [...html.matchAll(/\/search\?page=(\d+)/g)].map(x => parseInt(x[1], 10));
  const pc = pages.length ? Math.max(...pages) : 1;
  return { page, pagecount: pc, limit: 24, total: pc * 24, list: parseList(html) };
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
