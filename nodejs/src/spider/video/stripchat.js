import req from '../../util/req.js';
import crypto from 'crypto';

// StripChat (py_stripchat) —— 名称暂用站方品牌「StripChat」, 用户可改
// 站点: https://zh.stripchat.com (成人直播平台中文站)。只收录匿名可看的公开直播:
//       列表里混有 groupShow(门票群秀, 付费) 与 private 状态, 本源只保留 status==='public' 且 isLive 的条目;
//       私密秀/门票秀不碰, 不伪造任何凭证。
// 列表: GET /api/front/models?primaryTag={girls|men|couples|trans}&limit=60&offset={(页-1)*60}
//       标签分类加 &filterGroupTags=[["{tagId}"]] (URL 编码后的 JSON 嵌套数组, 这是站方前端的真实过滤参数);
//       tagId 与站内标签页 SSR 状态里的 modelFilter.tag.id 一一对应 (逐个抓页核对, 含站方自己的反直觉映射,
//       如 brunettes→hairColorBlack、black-hair→hairColorBrown, 与站内页面保持一致)。
//       99 个分类 (4 大类 + 95 标签) 全部于 2026-10-20 逐个实测: SSR 有 tagId 且接口 filteredCount>=5。
// 封面: https://img.doppiocdn.net/thumbs/{snapshotTimestamp}/{id} (站内 og:image 同款, 无头直取 200 image/webp,
//       比列表自带 previewUrlThumbSmall 更大), 缺 snapshotTimestamp 时退回 previewUrlThumbSmall。
//       封面一律真实 https 直链, 不经本地代理 (App 图片加载走不了 js2p 本地地址, 既有教训)。
// 详情: GET /api/front/models/{id} → username/status/avatarUrl, 一次请求; 失败也拼得出可播条目。
// 播放 (Mouflon 机制, 2026-10-20 VM 全链实测打通: 主列表 200 → 媒体列表 200 → init 段 200 → 解密分片 200/1.5MB):
//   主列表 https://edge-hls.doppiocdn.com/hls/{id}/master/{id}.m3u8 内含多行 #EXT-X-MOUFLON:PSCH:v2:{pschId};
//   媒体列表必须带 &psch=v2&pkey={pschId} 请求, 否则 media-hls 会 302 到广告列表 (cpa/v2/stream.m3u8);
//   媒体列表里真实分片地址藏在 #EXT-X-MOUFLON:URI: 行, 文件名一段被加密:
//     enc = 文件名里 _([^_]+)_(\d+).mp4 的第一组; 解密 = reverse(enc) → 补 = 后 base64 解码 →
//     与 SHA256(pdkey) 的 32 字节循环 XOR → 得明文字串替换回原 URL。
//   pdkey 按 pschId 查 PSCH_KEYS 表 (公开社区资料给出的映射对, 其中 Ook7quaiNgiyuhai 一对已本次实测验证)。
// 第二轮 (2026-10-20 真机反馈第一轮播不了后逐跳定位): 上游与解密均复测健康 (今日真实主列表 pschId 仍在表中、
//   媒体列表带参 200、解密分片/init 段无头 200), 本地普通 fastify 里整条链也全通; 断点在 App 内特有的一环 ——
//   第一轮改写出的主列表里, 变体地址是又一个 js2p 本地代理地址 (播放列表正文里嵌 js2p 地址), 这是本仓库唯一
//   没在真机通过过的形态 (真机通过的 avhub/JavGG-Worker 方案, 播放列表正文里全是 https 地址)。
//   修法: play() 改返用户自有 Worker (stripchat-hls) 的 /master/{id} —— Worker 一次代办 主列表→选 pkey→拉
//   媒体列表→解密, 返回的媒体列表正文全是 CDN 的 https 地址, 分片/init 直连; 与 JavGG vidhide Worker 同
//   形态 (真机已播通)。Worker 代码见同目录 stripchat-hls-worker.js, 需用户在 Cloudflare 部署后生效。
//   本地代理 /proxy/hls 保留为回退 (STRIPCHAT_WORKER 留空时用), 且已改造成"一跳版": 代理内部自己解析主
//   列表的变体并直接返回媒体列表, 返回正文同样全是 https, 不再嵌套 js2p 地址; 仅一跳解析失败时才退回旧嵌套改写。
// 搜索: 站内搜索 (magic-search) 走前端专用服务; /api/front/models 的 username/searchQuery/tag 等参数实测均被忽略
//       (返回未过滤的默认列表), 没有可用的公开搜索接口, search 返回空列表。

const KEY = 'py_stripchat';
const NAME = 'StripChat';
const API = 'https://zh.stripchat.com/api/front';
const EDGE = 'https://edge-hls.doppiocdn.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const REFERER = 'https://zh.stripchat.com/';
const PAGE_SIZE = 60;
const TIMEOUT = 10000;

// 播放列表代办 Worker (用户自有 Cloudflare Worker, 部署名 stripchat-hls; 见同目录 stripchat-hls-worker.js)。
// 非空: play() 走 Worker; 留空: 回退本地代理 /proxy/hls (一跳版)。
const STRIPCHAT_WORKER = 'https://stripchat-hls.li768435813.workers.dev';

// Mouflon: pschId -> pdkey (公开已知映射对; 站方会不定期轮换, 轮换后需更新此表)
const PSCH_KEYS = {
  Ook7quaiNgiyuhai: 'EQueeGh2kaewa3ch',
  Zokee2OhPh9kugh4: 'Quean4cai9boJa5a',
};

// 分类: type_id = 大类 或 大类:tagId (tagId 经站内标签页 SSR 逐个核对, 见文件头)
const CATS = [
  { type_id: 'girls', type_name: '女生' },
  { type_id: 'men', type_name: '男生' },
  { type_id: 'couples', type_name: '情侣' },
  { type_id: 'trans', type_name: '跨性别' },
  { type_id: 'girls:doAnal', type_name: '女·肛交' }, // anal
  { type_id: 'girls:ethnicityMiddleEastern', type_name: '女·阿拉伯人' }, // arab
  { type_id: 'girls:ethnicityAsian', type_name: '女·亚洲人' }, // asian
  { type_id: 'girls:bodyTypeAthletic', type_name: '女·运动型' }, // athletic
  { type_id: 'girls:bodyTypeBBW', type_name: '女·大号美女' }, // bbw
  { type_id: 'girls:subcultureBdsm', type_name: '女·BDSM' }, // bdsm
  { type_id: 'girls:specificsBigAss', type_name: '女·大屁股' }, // big-ass
  { type_id: 'girls:specificsBigTits', type_name: '女·巨乳' }, // big-tits
  { type_id: 'girls:hairColorBrown', type_name: '女·黑发' }, // black-hair
  { type_id: 'girls:hairColorBlonde', type_name: '女·金发' }, // blondes
  { type_id: 'girls:doBlowjob', type_name: '女·口交' }, // blowjob
  { type_id: 'girls:hairColorBlack', type_name: '女·棕发小妞' }, // brunettes
  { type_id: 'girls:autoTagP2P', type_name: '女·视频通话' }, // cam2cam
  { type_id: 'girls:tagLanguageChinese', type_name: '女·中国' }, // chinese
  { type_id: 'girls:hairColorColorful', type_name: '女·彩发' }, // colorful
  { type_id: 'girls:bodyTypeCurvy', type_name: '女·丰满' }, // curvy
  { type_id: 'girls:doDeepThroat', type_name: '女·深喉' }, // deepthroat
  { type_id: 'girls:ethnicityEbony', type_name: '女·黑珍珠' }, // ebony
  { type_id: 'girls:doFisting', type_name: '女·拳交' }, // fisting
  { type_id: 'girls:doFootFetish', type_name: '女·恋足' }, // foot-fetish
  { type_id: 'girls:fuckMachine', type_name: '女·炮机' }, // fuck-machine
  { type_id: 'girls:ageOld', type_name: '女·老奶奶' }, // grannies
  { type_id: 'girls:tagGroupSex', type_name: '女·群交' }, // group-sex
  { type_id: 'girls:specificsHairy', type_name: '女·阴部多毛' }, // hairy
  { type_id: 'girls:doHardcore', type_name: '女·粗暴' }, // hardcore
  { type_id: 'girls:ethnicityIndian', type_name: '女·印度人' }, // indian
  { type_id: 'girls:autoTagInteractiveToy', type_name: '女·互动玩具' }, // interactive-toys
  { type_id: 'girls:ethnicityLatino', type_name: '女·拉丁人' }, // latin
  { type_id: 'girls:doMasturbation', type_name: '女·自慰' }, // masturbation
  { type_id: 'girls:ageMature', type_name: '女·成熟' }, // mature
  { type_id: 'girls:bodyTypeMedium', type_name: '女·中等身材' }, // medium
  { type_id: 'girls:ageMilf', type_name: '女·熟女' }, // milfs
  { type_id: 'girls:ethnicityMultiracial', type_name: '女·混血' }, // mixed
  { type_id: 'girls:mobile', type_name: '女·手机直播' }, // mobile
  { type_id: 'girls:autoTagNew', type_name: '女·新人' }, // new
  { type_id: 'girls:doOffice', type_name: '女·办公室' }, // office
  { type_id: 'girls:doPublicPlace', type_name: '女·户外' }, // outdoor
  { type_id: 'girls:bodyTypePetite', type_name: '女·瘦' }, // petite
  { type_id: 'girls:specificPregnant', type_name: '女·孕妇' }, // pregnant
  { type_id: 'girls:hairColorRed', type_name: '女·红发' }, // redheads
  { type_id: 'girls:specificShaven', type_name: '女·剃光' }, // shaven
  { type_id: 'girls:specificSmallTits', type_name: '女·小胸部' }, // small-tits
  { type_id: 'girls:autoTagSpy', type_name: '女·偷窥' }, // spy
  { type_id: 'girls:doSquirt', type_name: '女·潮吹' }, // squirt
  { type_id: 'girls:ageTeen', type_name: '女·少女18+' }, // teens
  { type_id: 'girls:tagLanguageUkrainian', type_name: '女·乌克兰人' }, // ukrainian
  { type_id: 'girls:autoTagVr', type_name: '女·VR' }, // vr
  { type_id: 'girls:ethnicityWhite', type_name: '女·白人' }, // white
  { type_id: 'girls:ageYoung', type_name: '女·鲜嫩青年' }, // young
  { type_id: 'men:doAnal', type_name: '男·肛交' }, // anal
  { type_id: 'men:ethnicityAsian', type_name: '男·亚洲人' }, // asian
  { type_id: 'men:doBlowjob', type_name: '男·口交' }, // blowjob
  { type_id: 'men:autoTagP2P', type_name: '男·视频通话' }, // cam2cam
  { type_id: 'men:tagLanguageChinese', type_name: '男·中国' }, // chinese
  { type_id: 'men:ageDaddies', type_name: '男·老爹' }, // daddies
  { type_id: 'men:ethnicityEbony', type_name: '男·黑珍珠' }, // ebony
  { type_id: 'men:orientationGay', type_name: '男·同性恋' }, // gays
  { type_id: 'men:tagGroupSex', type_name: '男·群交' }, // group-sex
  { type_id: 'men:doHardcore', type_name: '男·粗暴' }, // hardcore
  { type_id: 'men:ethnicityLatino', type_name: '男·拉丁人' }, // latin
  { type_id: 'men:bodyTypeMuscular', type_name: '男·肌肉' }, // muscular
  { type_id: 'men:autoTagNew', type_name: '男·新人' }, // new
  { type_id: 'men:bodyTypeSkinny', type_name: '男·瘦' }, // skinny
  { type_id: 'men:tagMenTwinks', type_name: '男·小鲜肉' }, // twinks
  { type_id: 'couples:do69Position', type_name: '情侣·69姿势' }, // 69-position
  { type_id: 'couples:doAnal', type_name: '情侣·肛交' }, // anal
  { type_id: 'couples:doBlowjob', type_name: '情侣·口交' }, // blowjob
  { type_id: 'couples:tagLanguageChinese', type_name: '情侣·中国' }, // chinese
  { type_id: 'couples:doDeepThroat', type_name: '情侣·深喉' }, // deepthroat
  { type_id: 'couples:doFootFetish', type_name: '情侣·恋足' }, // foot-fetish
  { type_id: 'couples:fuckMachine', type_name: '情侣·炮机' }, // fuck-machine
  { type_id: 'couples:subcultureGoth', type_name: '情侣·哥特' }, // goth
  { type_id: 'couples:tagGroupSex', type_name: '情侣·群交' }, // group-sex
  { type_id: 'couples:doHardcore', type_name: '情侣·粗暴' }, // hardcore
  { type_id: 'couples:autoTagNew', type_name: '情侣·新人' }, // new
  { type_id: 'couples:doOffice', type_name: '情侣·办公室' }, // office
  { type_id: 'couples:autoTagOldYoung', type_name: '情侣·老少配' }, // old-young
  { type_id: 'couples:doPublicPlace', type_name: '情侣·户外' }, // outdoor
  { type_id: 'couples:doSquirt', type_name: '情侣·潮吹' }, // squirt
  { type_id: 'trans:doAnal', type_name: '跨·肛交' }, // anal
  { type_id: 'trans:ethnicityAsian', type_name: '跨·亚洲人' }, // asian
  { type_id: 'trans:specificsBigAss', type_name: '跨·大屁股' }, // big-ass
  { type_id: 'trans:specificsBigTits', type_name: '跨·巨乳' }, // big-tits
  { type_id: 'trans:doBlowjob', type_name: '跨·口交' }, // blowjob
  { type_id: 'trans:ethnicityEbony', type_name: '跨·黑珍珠' }, // ebony
  { type_id: 'trans:tagGroupSex', type_name: '跨·群交' }, // group-sex
  { type_id: 'trans:doHardcore', type_name: '跨·粗暴' }, // hardcore
  { type_id: 'trans:ethnicityLatino', type_name: '跨·拉丁人' }, // latin
  { type_id: 'trans:doMasturbation', type_name: '跨·自慰' }, // masturbation
  { type_id: 'trans:ageMilf', type_name: '跨·熟女' }, // milfs
  { type_id: 'trans:autoTagNew', type_name: '跨·新人' }, // new
  { type_id: 'trans:specificSmallTits', type_name: '跨·小胸部' }, // small-tits
  { type_id: 'trans:doSquirt', type_name: '跨·潮吹' }, // squirt
  { type_id: 'trans:ageTeen', type_name: '跨·少年18+' }, // teens
  { type_id: 'trans:ageYoung', type_name: '跨·鲜嫩青年' }, // young
];

function t(v) { return String(v == null ? '' : v).trim(); }

function b64url(s) {
  return Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// 本地代理地址 (js2p://_WEB_ 为 App 动态地址 scheme, 同 avhub/ffm3u8 先例)
function proxyUrl(reqLike, path, targetUrl, pkey) {
  try {
    const server = reqLike?.server;
    const dynamic = server?.address?.()?.dynamic || 'js2p://_WEB_';
    const prefix = server?.prefix || ('/spider/' + KEY + '/3');
    return `${dynamic}${prefix}${path}?u=${b64url(targetUrl)}${pkey ? '&k=' + encodeURIComponent(pkey) : ''}`;
  } catch (e) { return ''; }
}

function absUrl(u, base) {
  try { return new URL(u, base).toString(); } catch (e) { return u; }
}

async function fetchText(url, timeout = TIMEOUT) {
  try {
    const { data, status } = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': REFERER },
      timeout,
    });
    if (status === 200 && data != null) return typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) { /* 换通道2 */ }
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': REFERER }, signal: ctl.signal });
    clearTimeout(tm);
    if (r.ok) return await r.text();
  } catch (e) { /* ignore */ }
  return '';
}

async function fetchJson(url) {
  try {
    const { data, status } = await req.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': REFERER },
      timeout: TIMEOUT,
    });
    if (status === 200 && data) return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) { /* 换通道2 */ }
  const raw = await fetchText(url);
  if (raw) { try { return JSON.parse(raw); } catch (e) { /* ignore */ } }
  return null;
}

// ---------- 列表 ----------

function modelToVod(m) {
  const id = String(m.id || '');
  let pic = '';
  if (m.snapshotTimestamp && id) pic = `https://img.doppiocdn.net/thumbs/${m.snapshotTimestamp}/${id}`;
  if (!pic) pic = t(m.previewUrlThumbSmall) || t(m.avatarUrl);
  const marks = [];
  if (m.isHd) marks.push('HD');
  if (m.isNew) marks.push('新人');
  const remarks = `${m.viewersCount || 0}人观看${marks.length ? ' · ' + marks.join(' · ') : ''}`;
  return { vod_id: id, vod_name: t(m.username), vod_pic: pic, vod_remarks: remarks };
}

async function getModelsPage(primaryTag, tagId, page) {
  const offset = (page - 1) * PAGE_SIZE;
  let url = `${API}/models?primaryTag=${encodeURIComponent(primaryTag)}&limit=${PAGE_SIZE}&offset=${offset}`;
  if (tagId) url += `&filterGroupTags=${encodeURIComponent(JSON.stringify([[tagId]]))}`;
  const d = await fetchJson(url);
  if (!d || !Array.isArray(d.models)) return { list: [], total: 0 };
  const list = d.models
    .filter(m => m && m.status === 'public' && m.isLive && m.id && m.username)
    .map(modelToVod);
  return { list, total: d.filteredCount || 0 };
}

function parseTid(tid) {
  const s = t(tid) || 'girls';
  const i = s.indexOf(':');
  if (i < 0) return { primaryTag: s, tagId: '' };
  return { primaryTag: s.slice(0, i), tagId: s.slice(i + 1) };
}

async function init() {
  return {};
}

async function home() {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const { list } = await getModelsPage('girls', '', 1);
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const { primaryTag, tagId } = parseTid(body.tid || body.id);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const { list, total } = await getModelsPage(primaryTag, tagId, page);
  const pagecount = Math.max(1, Math.ceil((total || list.length) / PAGE_SIZE));
  return { page, pagecount, limit: PAGE_SIZE, total, list };
}

// ---------- 详情 / 播放 ----------

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const raw = t(body.id);
  const id = raw.includes('$') ? raw.split('$').pop() : raw;
  let name = id, pic = '', live = false;
  const d = await fetchJson(`${API}/models/${encodeURIComponent(id)}`);
  if (d) {
    name = t(d.username) || name;
    pic = t(d.avatarUrl);
    live = d.status === 'public' && !!d.isLive;
  }
  const vod = {
    vod_id: id,
    vod_name: name,
    vod_pic: pic,
    type_name: '直播',
    vod_remarks: live ? '直播中' : '',
    vod_content: `${name} 的 StripChat 公开直播间`,
    vod_play_from: NAME,
    vod_play_url: '直播$' + id,
  };
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const raw = t(body.id);
  const id = raw.includes('$') ? raw.split('$').pop() : raw;
  if (!/^\d+$/.test(id)) return { parse: 0, url: '' };
  // 首选 Worker 代办 (返回正文全 https 的媒体列表); play 本身 0 上游请求
  if (STRIPCHAT_WORKER) {
    return {
      parse: 0,
      url: `${STRIPCHAT_WORKER}/master/${id}`,
      header: { 'User-Agent': UA, 'Referer': REFERER },
    };
  }
  // 回退: 本地代理一跳版
  const master = `${EDGE}/hls/${id}/master/${id}.m3u8`;
  const url = proxyUrl(reqIn, '/proxy/hls', master, '');
  return {
    parse: 0,
    url: url || master,
    header: { 'User-Agent': UA, 'Referer': REFERER },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  // 无可用公开搜索接口 (见文件头), 返回空
  return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [] };
}

// ---------- Mouflon 播放列表代理 ----------

function mouflonDecryptUrl(url, pdkey) {
  const m = String(url).match(/_([^_]+)_(\d+(?:_part\d+)?)\.mp4/);
  if (!m) return url;
  try {
    let s = m[1].split('').reverse().join('');
    while (s.length % 4) s += '=';
    const raw = Buffer.from(s, 'base64');
    const key = crypto.createHash('sha256').update(pdkey, 'utf8').digest();
    const out = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ key[i % 32];
    const plain = out.toString('utf8');
    const gi = url.indexOf(m[1]);
    if (gi < 0 || !plain) return url;
    return url.slice(0, gi) + plain + url.slice(gi + m[1].length);
  } catch (e) { return url; }
}

function pickPkey(masterText) {
  const ids = [...String(masterText).matchAll(/#EXT-X-MOUFLON:PSCH:v2:([A-Za-z0-9]+)/g)].map(x => x[1]);
  for (const id of ids) if (PSCH_KEYS[id]) return id;
  return '';
}

// 媒体列表改写: 解密 MOUFLON:URI 分片地址替换占位行, URI="" 转绝对地址, 删 MOUFLON 行;
// 分片/init 段保持 CDN 绝对地址直连, 返回正文全是 https
function rewriteMedia(rawText, base, pdkey) {
  const out = [];
  let pending = '';
  for (const line of String(rawText).split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith('#EXT-X-MOUFLON:URI:')) {
      const u = s.slice('#EXT-X-MOUFLON:URI:'.length);
      pending = pdkey ? mouflonDecryptUrl(u, pdkey) : u;
      continue;
    }
    if (s.startsWith('#EXT-X-MOUFLON')) continue;
    if (s.startsWith('#')) {
      if (s.includes('URI="')) {
        out.push(line.replace(/URI="([^"]+)"/g, (all, uri) => `URI="${absUrl(uri.replace(/&amp;/g, '&'), base)}"`));
      } else out.push(line);
      continue;
    }
    out.push(pending || absUrl(s.replace(/&amp;/g, '&'), base));
    pending = '';
  }
  return out.join('\n') + '\n';
}

// GET /proxy/hls?u={b64url 播放列表地址}&k={pschId, 媒体列表用} —— 本地回退通道 (STRIPCHAT_WORKER 留空时用)
// 主列表: 一跳版 —— 代理内部选 pkey、取第一个变体、带参拉媒体列表, 直接返回改写后的媒体列表
//         (返回正文全是 https, 不再把本地代理地址嵌进播放列表 —— 第一轮嵌套形态真机播不了);
//         仅一跳解析失败时才退回旧嵌套改写。媒体列表: 直接 rewriteMedia。
async function hlsProxy(request, reply) {
  const q = request?.query || {};
  if (!q.u) { reply.code(400).send('missing u'); return; }
  let target = '';
  try { target = unb64url(q.u); } catch (e) { reply.code(400).send('bad u'); return; }
  if (!/^https?:\/\//.test(target)) { reply.code(400).send('bad u'); return; }
  const pkey = t(q.k);
  let fetchUrl = target;
  if (pkey) fetchUrl += (target.includes('?') ? '&' : '?') + 'psch=v2&pkey=' + encodeURIComponent(pkey);
  const raw = await fetchText(fetchUrl, 8000);
  if (!raw || !raw.includes('#EXTM3U')) { reply.code(502).send('upstream fail'); return; }
  reply.header('Content-Type', 'application/vnd.apple.mpegurl');
  reply.header('Cache-Control', 'no-cache');

  if (raw.includes('#EXT-X-STREAM-INF')) {
    const chosen = pickPkey(raw) || pkey;
    const pdkey = chosen ? PSCH_KEYS[chosen] : null;
    if (chosen && pdkey) {
      let variant = '';
      for (const line of raw.split(/\r?\n/)) {
        const s = line.trim();
        if (s && !s.startsWith('#')) { variant = absUrl(s.replace(/&amp;/g, '&'), target); break; }
      }
      if (variant) {
        const mediaUrl = variant + (variant.includes('?') ? '&' : '?') + 'psch=v2&pkey=' + encodeURIComponent(chosen);
        const mediaRaw = await fetchText(mediaUrl, 8000);
        if (mediaRaw && mediaRaw.includes('#EXTM3U') && !mediaRaw.includes('#EXT-X-STREAM-INF')) {
          reply.send(rewriteMedia(mediaRaw, variant, pdkey));
          return;
        }
      }
    }
    // 一跳失败的最后兜底: 旧嵌套改写 (变体改指本代理)
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      if (s.startsWith('#EXT-X-MOUFLON')) continue;
      if (s.startsWith('#')) { out.push(line); continue; }
      const abs = absUrl(s.replace(/&amp;/g, '&'), target);
      out.push(proxyUrl(request, '/proxy/hls', abs, chosen) || abs);
    }
    reply.send(out.join('\n') + '\n');
    return;
  }

  reply.send(rewriteMedia(raw, target, pkey ? PSCH_KEYS[pkey] : null));
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
      // Mouflon 播放列表改写代理 (GET): 只处理 m3u8 文本, 分片保持 CDN 直连
      fastify.get('/proxy/hls', hlsProxy);
    },
  };
}
