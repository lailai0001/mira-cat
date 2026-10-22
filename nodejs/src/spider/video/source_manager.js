// 源管理 - 配置页面：排序所有源、启用/禁用开关
// 注意：排序和禁用需要重建 bundle 才能完全生效
// 本页面提供可视化管理，修改后需重新导入 .md5

const KEY = 'py_source_manager';
const NAME = '源管理';
const TYPE = 3;

// 源列表（与 router.js 中的顺序对应）
// 格式：[key, 显示名称]
const SOURCES = [
  ['py_51chigua', '51吃瓜'],
  ['py_818hl', '818黑料网'],
  ['py_acfan', 'AcFan'],
  ['py_av123', '123AV'],
  ['py_avdb', 'Avdb'],
  ['py_chigua57', '57吃瓜'],
  ['py_feiye', '绯夜'],
  ['py_getav', 'GetAV'],
  ['py_hanbj', '韩国BJ'],
  ['py_hanime', 'Hanime'],
  ['py_hanime_new', 'Hanime(新版)'],
  ['py_huadu', '花都影院'],
  ['py_huangdou', '黄豆短剧'],
  ['py_huangdou_rex', '黄豆短剧(REX)'],
  ['py_huangguo', '黄果短剧'],
  ['py_kanav', 'KanAV'],
  ['py_madou', '麻豆社'],
  ['py_missav', 'MissAV'],
  ['py_missav_xptv', 'MissAV'],
  ['py_pornhub', 'Pornhub'],
  ['py_ppp', 'PPPHub'],
  ['py_rou', '肉视频'],
  ['py_sanjipian', '蝴蝶影院'],
  ['py_soop', 'SOOP直播'],
  ['py_spankbang_new', 'Eporner'],
  ['py_superchatlive', 'SuperChat直播'],
  ['py_supjav', 'SupJav'],
  ['py_taiav', 'Taiav'],
  ['py_upload5', '蜜桃'],
  ['py_xvideos', 'XVideos'],
  ['py_xxxfollow', 'XXXFollow'],
  ['douban', '豆瓣榜单'],
  ['ffm3u8', '非凡采集'],
  ['live', 'IPTV直播'],
  ['myvideo', '我的影视'],
  ['push', '推送'],
  ['xgcartoon', '西瓜卡通'],
  ['t4', '站源'],
  ['cms', '采集站'],
  ['kkys', '快看影视'],
  ['kunyu77', '琨娱七七'],
  ['py_source_manager', '源管理'],
];

async function home() {
  // 返回源列表，每个源显示启用状态
  // 用户可以通过点击来切换
  const list = SOURCES.map(([key, name], idx) => ({
    vod_id: key,
    vod_name: `${idx + 1}. ${name}`,
    vod_pic: '',
    vod_remarks: '点击管理',
  }));
  return {
    class: [{ type_id: 'manage', type_name: '源管理' }],
    filters: {},
    list,
  };
}

async function category(reqIn) {
  return home();
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const key = String(body.id || '');
  const src = SOURCES.find(([k]) => k === key);
  const name = src ? src[1] : key;
  const idx = SOURCES.findIndex(([k]) => k === key);
  return {
    list: [{
      vod_id: key,
      vod_name: name,
      vod_pic: '',
      vod_remarks: `第 ${idx + 1} 个源 / 共 ${SOURCES.length} 个`,
      vod_play_from: '管理操作',
      vod_play_url: `上移$${key}:up#下移$${key}:down#启用/禁用$${key}:toggle`,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(body.id || '');
  // 格式：key:action
  const [key, action] = id.split(':');
  const src = SOURCES.find(([k]) => k === key);
  const name = src ? src[1] : key;
  const actionName = action === 'up' ? '上移' : action === 'down' ? '下移' : '切换启用状态';
  const msg = `已请求${actionName} [${name}]。\n排序和禁用需重建 bundle 生效，请在聊天中告诉我具体需求。`;
  return { parse: 0, url: '', msg };
}

export default function createSpider() {
  return {
    meta: { key: KEY, name: NAME, type: TYPE },
    api: async (fastify) => {
      fastify.post('/init', async (req, reply) => reply.send({ code: 1, msg: 'ok' }));
      fastify.post('/home', async (req, reply) => {
        try {
          const data = await home();
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/category', async (req, reply) => {
        try {
          const data = await category({ body: req.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/detail', async (req, reply) => {
        try {
          const data = await detail({ body: req.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
      fastify.post('/play', async (req, reply) => {
        try {
          const data = await play({ body: req.body || {} });
          return reply.send({ code: 1, msg: 'ok', ...data });
        } catch (e) {
          return reply.send({ code: 0, msg: String(e?.message || e) });
        }
      });
    },
  };
}
