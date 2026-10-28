// PikPedCams - CatPawOpen JS Spider（v3：走公开接口，不再解析静态 HTML）
// 站：https://zh.pikpedcams.com/（直播站，非录播视频站）
// 历程：v1 要求卡片内有 doppio 缩略图、v2 只认 /用户名 链接，均设备端列表为空。
// 2026-10-29 诊断坐实根因：卡片是 JS 渲染的，静态 HTML 里根本没有主播卡片，
// parseList(html) 在哪一版都不可能命中；但站方确有公开接口（从前端包实证）：
//   GET /api/front/models?primaryTag=girls&limit=20 → 200，models 20 条、totalCount 12542；
//   单条含 username、id（即 streamName）、status、previewUrlThumbSmall（可直接作封面）、
//   viewersCount，以及 hlsPlaylist（如 https://edge-hls.doppiocdn.media/hls/{id}/master/{id}_240p.m3u8）。
// v3 路线（套用同仓库 chaturbate.js 的“公开 JSON 接口 + 直链 m3u8”路子）：
//   列表走 /api/front/models?primaryTag={tag}&limit=90 解析 JSON；
//   列表项本身就带 hlsPlaylist（如 .../master/{id}_240p.m3u8），去掉 _240p 后缀后
//   即主列表 m3u8（接口给的 _240p 变体直接播会低清，故播主列表）；不再 parse:1 嗅探主播页。
// v3.1（2026-10-29 修复“未找到直播源”）：实测 /api/front/models/{id}/streamSpecifics
//   按 id 查回 403 {"error":"User is unauthorized"}、按用户名查回 404，
//   故 v3 的 detail() 永远拿不到流 —— 根因在此。
//   改为列表时就把主列表地址编进 vod_id（id|主列表地址），detail 直接拆出来用；
//   兜底：若 vod_id 里没有地址（如旧收藏），重拉 4 个 tag 的列表按 id 找回 hlsPlaylist。
// v3.2（2026-10-29 修复“全是 20 秒广告”）：上面那条接口流根本不是正片——
//   实测：任一直播中的主播，其接口 hlsPlaylist 指向的媒体流跟随跳转后都是
//   /cpa/v2/stream.m3u8（CPA 广告），4 秒×5 + 0.6 秒、共约 20.6 秒、带 ENDLIST，
//   换 Referer、换 Cookie 照样跳广告；也就是说未登录的接口流只能拿到广告，正片
//   在房间页播放器里（带站方会话）。所以 detail 不再出接口流，改出房间页地址、
//   由播放器 parse:1 嗅探房间页拿到真正的直播流（站方播放器自适应清晰度，
//   接口档位地址同样会跳广告，列出来就是假的，故不做分辨率分档）。
//   vod_id 改为 id|用户名（详情拼房间页用；'|' 直通 App 已有 91duanju 的先例）。
// 未证实、不要猜：侧边标签筛选（/girls/chinese 等）在接口里的参数名与取值未定位，
// 故本版分类只给已验证的 4 个 primaryTag（girls/couples/men/trans）；搜索接口同样未证实，
// search 暂返回空。18+ 确认与 406 问题随接口路线自然消失（接口不需年龄确认 cookie，
// 但发 API 请求务必带 Accept: application/json）。
import req from '../../util/req.js';

const KEY = 'py_pikped';
const NAME = 'PikPedCams';
const HOST = 'https://zh.pikpedcams.com/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function H(referer) {
  return { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'Referer': referer || HOST };
}
async function getJson(url) {
  try {
    const res = await req.get(url, { headers: H(HOST), timeout: 20000, maxRedirects: 10 });
    const data = (res && res.data !== undefined) ? res.data : res;
    if (typeof data === 'string') { try { return JSON.parse(data); } catch { return null; } }
    return data || null;
  } catch { return null; }
}
// hlsPlaylist 是 _240p 变体 → 去掉清晰度后缀，播主列表 m3u8
function toMaster(hls) {
  let u = String(hls || '').trim();
  if (!u) return '';
  u = u.replace(/_\d+p\.m3u8(\?.*)?$/i, '.m3u8$1');
  return u;
}
function parseModels(j) {
  const items = [];
  if (!j) return items;
  const arr = Array.isArray(j.models) ? j.models : (Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []));
  const seen = new Set();
  for (const m of arr) {
    if (!m) continue;
    const status = String(m.status || '').toLowerCase();
    // 只列可看的直播：public 与 groupShow；在播之外的不列
    if (status && status !== 'public' && status !== 'groupshow') continue;
    const username = m.username || m.name || '';
    const id = m.id != null ? String(m.id) : '';
    if (!username || !id || seen.has(id)) continue;
    seen.add(id);
    const viewers = m.viewersCount != null ? (m.viewersCount + '人') : '';
    const remarks = [status, viewers].filter(Boolean).join(' · ');
    // vod_id 编进用户名，detail 拼房间页地址走嗅探（接口流是广告，见文件头 v3.2）
    items.push({ vod_id: id + '|' + username, vod_name: username, vod_pic: m.previewUrlThumbSmall || m.previewUrl || m.snapshotUrl || '', vod_remarks: remarks });
    if (items.length >= 90) break;
  }
  return items;
}
async function fetchModels(tag) {
  const j = await getJson(HOST + 'api/front/models?primaryTag=' + encodeURIComponent(tag) + '&limit=90');
  return parseModels(j);
}
async function init() { return {}; }
async function home() {
  const list = await fetchModels('girls');
  return {
    class: [
      { type_id: 'girls', type_name: '女主播' },
      { type_id: 'couples', type_name: '情侣' },
      { type_id: 'men', type_name: '男主播' },
      { type_id: 'trans', type_name: '跨性別' },
    ],
    filters: {},
    list,
  };
}
async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'girls');
  const list = await fetchModels(tid);
  return { page: 1, pagecount: 1, limit: 90, total: list.length, list };
}
async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const raw of ids.filter(Boolean)) {
    const rawStr = String(raw).trim();
    const parts = rawStr.split('|');
    const id = parts[0];
    let username = '';
    let legacyMaster = '';
    if (parts.length > 1) {
      const second = parts.slice(1).join('|');
      if (/^https?:\/\//i.test(second)) legacyMaster = second; // v3.1 旧收藏：id|主列表地址
      else username = second; // v3.2：id|用户名
    }
    if (!username) {
      // 旧收藏（只有 id，或 id|旧地址）：重拉 4 个 tag 的列表按 id 找回用户名
      for (const tag of ['girls', 'couples', 'men', 'trans']) {
        const j = await getJson(HOST + 'api/front/models?primaryTag=' + tag + '&limit=90');
        const arr = j && Array.isArray(j.models) ? j.models : [];
        const hit = arr.find(x => x && String(x.id) === id);
        if (hit && hit.username) { username = hit.username; break; }
      }
    }
    // 房间页 + 嗅探才是正片；实在找不到用户名时才回落旧接口流（会是广告，仅作兜底）
    const playUrl = username
      ? ('直播$' + HOST + username)
      : (legacyMaster ? ('直播$' + legacyMaster) : ('未找到直播源$' + HOST));
    list.push({
      vod_id: raw,
      vod_name: username || 'PikPedCams',
      vod_pic: '',
      vod_play_from: 'PikPedCams',
      vod_play_url: playUrl,
    });
  }
  return { list };
}
async function play(reqIn) {
  let id = String(reqIn?.body?.id || '').trim();
  if (id.includes('$')) id = id.split('$').pop().trim();
  const isVideo = /\.(m3u8|mp4)/i.test(id);
  return { parse: isVideo ? 0 : 1, url: id, header: { 'User-Agent': UA, 'Referer': HOST } };
}
async function search(reqIn) {
  // 搜索接口未证实，暂返回空，不猜 URL
  return { page: 1, pagecount: 1, limit: 90, total: 0, list: [] };
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
