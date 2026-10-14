import req from '../../util/req.js';

const KEY = 'py_pandalive';
const NAME = 'PandaLive';
const HOST = 'https://5721004.xyz';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Referer': 'https://www.pandalive.co.kr/',
  'Origin': 'https://www.pandalive.co.kr',
};
const PAGE_SIZE = 30;

function t(v) {
  return String(v == null ? '' : v).trim();
}

async function fetchJsonData() {
  try {
    const { data } = await req.get(`${HOST}/player/list.json`, { headers: HEADERS, timeout: 15000 });
    const obj = typeof data === 'object' ? data : JSON.parse(String(data || '{}'));
    const rawList = obj.list || [];
    return rawList.map((item) => {
      const userId = item.userId || '';
      const nick = item.userNick || '未知主播';
      const title = item.title || '无标题';
      const isAdult = !!item.isAdult;
      const isPw = !!item.isPw;
      const vType = item.type || '';
      return {
        vod_id: `live_${userId}`,
        vod_name: `📺 ${nick}`,
        vod_pic: item.thumbUrl || 'https://tupian.li/images/2024/03/30/660769b1ba623.png',
        vod_remarks: `👤 ${item.user || 0} ${isAdult ? '🔞' : ''}`,
        vod_content: title,
        vod_actor: userId,
        _isAdult: isAdult,
        _isPw: isPw,
        _type: vType,
        _user_count: item.user || 0,
        _score: item.totalScoreCnt || 0,
        _bookmark: item.bookmarkCnt || 0,
      };
    });
  } catch (e) {
    return [];
  }
}

async function home() {
  const list = await fetchJsonData();
  return {
    class: [{ type_id: 'pandalive', type_name: '🐼 PandaTV' }],
    list: list.slice(0, 30),
    filters: {
      pandalive: [
        {
          key: 'type',
          name: '类型',
          value: [
            { n: '全部', v: 'all' },
            { n: '🔞 19+', v: 'adult' },
            { n: '🔐 密码房', v: 'pw' },
            { n: '💎 粉丝房', v: 'fan' },
          ],
        },
        {
          key: 'sort',
          name: '排序',
          value: [
            { n: '观众量 ↓', v: 'user-desc' },
            { n: '实时热度 ↓', v: 'totalScoreCnt-desc' },
            { n: '关注量 ↓', v: 'bookmarkCnt-desc' },
          ],
        },
      ],
    },
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const extend = body.extend || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  let filtered = await fetchJsonData();

  const fType = extend.type || 'all';
  if (fType === 'adult') filtered = filtered.filter((v) => v._isAdult);
  else if (fType === 'pw') filtered = filtered.filter((v) => v._isPw);
  else if (fType === 'fan') filtered = filtered.filter((v) => v._type === 'fan');

  const sortType = extend.sort || 'user-desc';
  if (sortType === 'user-desc') filtered.sort((a, b) => b._user_count - a._user_count);
  else if (sortType === 'totalScoreCnt-desc') filtered.sort((a, b) => b._score - a._score);
  else if (sortType === 'bookmarkCnt-desc') filtered.sort((a, b) => b._bookmark - a._bookmark);

  const start = (page - 1) * PAGE_SIZE;
  const pageList = start < filtered.length ? filtered.slice(start, start + PAGE_SIZE) : [];
  // 去掉内部字段
  const clean = pageList.map((v) => {
    const { _isAdult, _isPw, _type, _user_count, _score, _bookmark, ...rest } = v;
    return rest;
  });
  return {
    list: clean,
    page,
    pagecount: filtered.length ? Math.ceil(filtered.length / PAGE_SIZE) : 1,
    limit: PAGE_SIZE,
    total: filtered.length,
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd).toLowerCase();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { list: [], page };
  const all = await fetchJsonData();
  const res = all
    .filter((v) => v.vod_name.toLowerCase().includes(wd) || v.vod_actor.toLowerCase().includes(wd))
    .slice(0, 50)
    .map((v) => {
      const { _isAdult, _isPw, _type, _user_count, _score, _bookmark, ...rest } = v;
      return rest;
    });
  return { list: res, page };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const firstId = t(ids[0]);
  const userId = firstId.replace(/^live_/, '');
  if (!userId) return { list: [] };

  let streamUrl = '';
  try {
    const { data } = await req.get(`${HOST}/player/list.m3u`, { headers: HEADERS, timeout: 15000 });
    const text = String(data || '');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`,${userId},`) && i + 1 < lines.length) {
        streamUrl = t(lines[i + 1]);
        break;
      }
    }
    if (!streamUrl) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(userId) && i + 1 < lines.length) {
          streamUrl = t(lines[i + 1]);
          break;
        }
      }
    }
  } catch (e) {}

  const proxies = [
    'https://hubu.515355.xyz/proxy/?',
    'https://flank.515355.xyz/proxy/',
    'https://uae2.515355.xyz/proxy/',
    'https://pol.515355.xyz/proxy/',
    'https://f00.515355.xyz/proxy/',
    'https://ce2.515355.xyz/proxy/?',
  ];
  const playLinks = [`直连$${streamUrl}`];
  proxies.forEach((p, i) => playLinks.push(`代理${i + 1}$${p}${streamUrl}`));

  return {
    list: [
      {
        vod_id: firstId,
        vod_name: `PandaTV - ${userId}`,
        vod_pic: 'https://tupian.li/images/2024/03/30/660769b1ba623.png',
        vod_content: `主播: ${userId}`,
        vod_play_from: 'PandaLive',
        vod_play_url: playLinks.join('#'),
      },
    ],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  return { parse: 0, url: t(body.id), header: HEADERS };
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
