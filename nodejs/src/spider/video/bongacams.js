import req from '../../util/req.js';

// BongaCams (py_bongacams) —— 名称用站方品牌「BongaCams」(页面 window["__#c"] 首项与站内标题均为此名)
// 站点: https://cn.bongacams.com (BongaCams 官方中文镜像, 与主站同构 SSR; 品牌名中英文站一致)。
// 只收录公开直播间: 列表页 (SSR) 呈现的房间全部带"直播中"徽标 (lst_bage __live), 抽查 3 页 216 张卡
//   无一例外; 进入私密秀的房间不出现在该列表里。私密秀/付费内容一律不碰, 不伪造任何凭证。
// 列表: SSR HTML, 卡片 <div class="ls_thumb">, 每页 72 条, 分页 ?page=N (实测 female/male/couples/
//   trans/new-models 与标签页 p1/p2 均 72 条且不重复)。
//   卡片锚点自带全部播放要素: data-chathost (流名, 大小写原样)、data-esid (边缘服务器, 如
//   live-edge25 / live-edge-us80)、data-vq (源画质, 如 1920x1080)、data-gender; 封面为卡内
//   <img src="//i.bgicdn.com/live/.../xbig_lq/*.jpg"> (真实 https 直链, 无头 200, 不经任何代理)。
// 播放 (2026-10-20 VM 无头全链实测): https://{esid}.bcvcdn.com/hls/stream_{chathost}/playlist.m3u8
//   主列表 200, 含 240/480/720 + 源画质 (无后缀档, 可达 1920x1080) 共 4 档; 变体为相对路径
//   public-aac/stream_{user}[_720]/chunks.m3u8, 分片 .ts 同目录相对引用; 全程不带任何自定义头
//   实拉: 主列表 200 → 变体 200 → 首分片 200 (1,066,148B)。令牌与请求方无绑定 (无签名参数),
//   播放器直连 CDN 即可, play() 0 上游请求、直接拼主列表地址返回 (parse:0, 全档主列表)。
// 抓取通道要点: cn 站对无 Cookie 的新访客约四成概率返回 38KB 空壳页 (0 卡片, 年龄提示壳);
//   站点自身会在响应里下发 Cookie, 带上 Cookie 后续请求稳定返回完整页 (实测带罐 3/3 完整、
//   无罐 3/5 完整)。故内置会话级 Cookie 罐 + 首访预热 + "解析到 0 卡自动重试 (最多 3 次)"。
// 分类: 6 个主类 (全部/女生/男生/情侣/跨性别/新人) + 45 个站内标签。标签取自 /tags 目录页的
//   真实锚点 (slug 与中文名逐字取回), 抽验 anal-play/russian/hd-plus/mobile-live/lovense 均
//   72 条/页、new-teens 33 条。注意: /tags 页内嵌 JSON 里另有一套 code (asian/bbw/anal/toys…)
//   带在线计数, 但它们不是 URL slug —— /tags/asian 返回的是"标签库索引页" (0 卡片), 顶层
//   /asian 在 cn 站 302 跳首页, 故那套 code 一个都不收, 以免分类打开是空的。
// 搜索: 站内搜索为前端 SPA 专用通道, /search?query=、/search/{q} 等公开 URL 形态实测均无结果
//   (72B 空桩/空响应), 无可用公开搜索接口, search 返回空列表 (与 StripChat 同口径)。

const KEY = 'py_bongacams';
const NAME = 'BongaCams';
const HOST = 'https://cn.bongacams.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = HOST + '/';
const PAGE_SIZE = 72;
const TIMEOUT = 12000;

// 分类: type_id = all/female/male/couples/trans/new-models 或 tag:{slug} (slug 与中文名均取自站内 /tags 目录页锚点)
const CATS = [
  { type_id: 'all', type_name: '全部' },
  { type_id: 'female', type_name: '女生' },
  { type_id: 'male', type_name: '男生' },
  { type_id: 'couples', type_name: '情侣' },
  { type_id: 'trans', type_name: '跨性别' },
  { type_id: 'new-models', type_name: '新人' },
  { type_id: 'tag:squirt', type_name: '标签·潮吹' },
  { type_id: 'tag:anal-play', type_name: '标签·肛交游戏' },
  { type_id: 'tag:ass-fucking', type_name: '标签·肛交' },
  { type_id: 'tag:blowjob', type_name: '标签·口交' },
  { type_id: 'tag:cock-sucking', type_name: '标签·吮吸鸡巴' },
  { type_id: 'tag:deepthroat', type_name: '标签·深喉' },
  { type_id: 'tag:fucking', type_name: '标签·性交' },
  { type_id: 'tag:fucking-hard', type_name: '标签·用力干' },
  { type_id: 'tag:couples-fucking', type_name: '标签·夫妻性爱' },
  { type_id: 'tag:masturbation', type_name: '标签·手淫' },
  { type_id: 'tag:handjob', type_name: '标签·手淫（handjob）' },
  { type_id: 'tag:jerking', type_name: '标签·打飞机' },
  { type_id: 'tag:fingering', type_name: '标签·指奸' },
  { type_id: 'tag:fisting', type_name: '标签·拳头' },
  { type_id: 'tag:dildo-play', type_name: '标签·假阳具' },
  { type_id: 'tag:dildofucking', type_name: '标签·吸假阳具' },
  { type_id: 'tag:dildoing', type_name: '标签·插假阳具' },
  { type_id: 'tag:pussyfucking', type_name: '标签·插阴部' },
  { type_id: 'tag:pussyrubbing', type_name: '标签·阴部摩擦' },
  { type_id: 'tag:rubbing', type_name: '标签·摩擦' },
  { type_id: 'tag:feet-fuck', type_name: '标签·脚趾性交' },
  { type_id: 'tag:foot-fetish', type_name: '标签·恋足' },
  { type_id: 'tag:cumming', type_name: '标签·射精' },
  { type_id: 'tag:ejaculation', type_name: '标签·射精（ejaculation）' },
  { type_id: 'tag:sucking', type_name: '标签·吮吸' },
  { type_id: 'tag:licking', type_name: '标签·舔' },
  { type_id: 'tag:kissing', type_name: '标签·亲吻' },
  { type_id: 'tag:teasing', type_name: '标签·调戏' },
  { type_id: 'tag:stripping', type_name: '标签·脱光' },
  { type_id: 'tag:flashing', type_name: '标签·闪光' },
  { type_id: 'tag:dancing', type_name: '标签·跳舞' },
  { type_id: 'tag:massage', type_name: '标签·按摩' },
  { type_id: 'tag:female-domination', type_name: '标签·女士主导' },
  { type_id: 'tag:chatting', type_name: '标签·聊天' },
  { type_id: 'tag:enjoying', type_name: '标签·享受' },
  { type_id: 'tag:dreaming', type_name: '标签·梦中的' },
  { type_id: 'tag:no-fucking', type_name: '标签·不做爱' },
  { type_id: 'tag:camshow', type_name: '标签·网络视频节目' },
  { type_id: 'tag:lovense', type_name: '标签·lovense' },
  { type_id: 'tag:mobile-live', type_name: '标签·移动直播' },
  { type_id: 'tag:recordable', type_name: '标签·可记录的' },
  { type_id: 'tag:hd-plus', type_name: '标签·HD+' },
  { type_id: 'tag:new-teens', type_name: '标签·新人18岁以上青年女孩' },
  { type_id: 'tag:russian', type_name: '标签·俄语' },
  { type_id: 'tag:ukrainian', type_name: '标签·乌克兰人' },
];

function t(v) { return String(v == null ? '' : v).trim(); }

// ---------- 会话 Cookie 罐 (站点自身下发, 仅用于让 SSR 返回完整页) ----------
let cookieJar = '';
function storeCookies(headers) {
  const sc = headers && headers['set-cookie'];
  if (!sc) return;
  const map = new Map();
  if (cookieJar) {
    for (const p of cookieJar.split('; ')) {
      const i = p.indexOf('=');
      if (i > 0) map.set(p.slice(0, i), p.slice(i + 1));
    }
  }
  for (const c of Array.isArray(sc) ? sc : [sc]) {
    const kv = String(c).split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) map.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
  if (map.size) cookieJar = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function reqHeaders(extra) {
  const h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': REFERER };
  if (cookieJar) h['Cookie'] = cookieJar;
  return Object.assign(h, extra || {});
}

async function fetchHtml(url, timeout = TIMEOUT) {
  try {
    const { data, status, headers } = await req.get(url, { headers: reqHeaders(), timeout });
    storeCookies(headers);
    if (status === 200 && data != null) return typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) { /* 换通道2 */ }
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch(url, { headers: reqHeaders(), signal: ctl.signal, redirect: 'follow' });
    clearTimeout(tm);
    try {
      const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : r.headers.get('set-cookie');
      if (sc) storeCookies({ 'set-cookie': sc });
    } catch (e) { /* 忽略 */ }
    if (r.ok) return await r.text();
  } catch (e) { /* ignore */ }
  return '';
}

// 列表页专用: 空壳页 (无 ls_thumb) 自动重试, 含一次首页预热补 Cookie
async function fetchListing(url) {
  for (let i = 0; i < 3; i++) {
    const html = await fetchHtml(url);
    if (html && html.includes('ls_thumb')) return html;
    if (i === 0) await fetchHtml(HOST + '/'); // 预热: 空壳响应也会下发 Cookie, 顺带补罐
  }
  return '';
}

// ---------- 列表解析 ----------

function getAttr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
}

function parseCards(html) {
  const out = [];
  const seen = new Set();
  const parts = String(html || '').split('<div class="ls_thumb');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 2600);
    if (!chunk.includes('__live')) continue; // 只收公开直播中
    const am = chunk.match(/<a [^>]*class="lst_wrp[^>]*>/);
    if (!am) continue;
    const tag = am[0];
    const chathost = getAttr(tag, 'data-chathost');
    const esid = getAttr(tag, 'data-esid');
    if (!chathost || !/^live-edge[\w-]*$/.test(esid) || seen.has(chathost)) continue;
    seen.add(chathost);
    const name = getAttr(tag, 'data-name') || chathost;
    const vq = getAttr(tag, 'data-vq');
    let pic = '';
    const im = chunk.match(/<img src="(\/\/i\.bgicdn\.com\/live\/[^"]+\.jpg)"/);
    if (im) pic = 'https:' + im[1];
    let viewers = '';
    const vm = chunk.match(/lst_viewers">(\d+)</);
    if (vm) viewers = vm[1];
    const remarks = `${viewers ? viewers + '人观看' : '直播中'}${vq ? ' · ' + vq : ''}`;
    out.push({
      vod_id: `${chathost}|${esid}|${pic}`,
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
    });
  }
  return out;
}

function catUrl(tid, page) {
  let base;
  if (!tid || tid === 'all') base = HOST + '/';
  else if (tid.startsWith('tag:')) base = `${HOST}/tags/${tid.slice(4)}`;
  else base = `${HOST}/${tid}`;
  return page > 1 ? `${base}${base.includes('?') ? '&' : '?'}page=${page}` : base;
}

async function init() {
  return {};
}

async function home() {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await fetchListing(catUrl('all', 1));
  return { class: cls, list: html ? parseCards(html) : [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'all';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await fetchListing(catUrl(tid, page));
  const list = html ? parseCards(html) : [];
  // 直播列表无官方总页数: 本页满 72 条视为还有下一页
  const pagecount = list.length >= PAGE_SIZE ? page + 1 : page;
  return { page, pagecount, limit: PAGE_SIZE, total: list.length, list };
}

// ---------- 详情 / 播放 ----------

function parsePayload(raw) {
  let s = t(raw);
  if (s.includes('$')) s = s.split('$').pop();
  const [chathost = '', esid = '', pic = ''] = s.split('|');
  if (!/^[\w-]+$/.test(chathost) || !/^live-edge[\w-]*$/.test(esid)) return null;
  return { chathost, esid, pic };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const p = parsePayload(body.id);
  if (!p) return { list: [] };
  const payload = `${p.chathost}|${p.esid}|${p.pic}`;
  return {
    list: [{
      vod_id: payload,
      vod_name: p.chathost,
      vod_pic: p.pic,
      type_name: '直播',
      vod_remarks: '直播中',
      vod_content: `${p.chathost} 的 BongaCams 公开直播间`,
      vod_play_from: NAME,
      vod_play_url: '直播$' + payload,
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const p = parsePayload(body.id);
  if (!p) return { parse: 0, url: '' };
  // 主列表直返 (全档, 含源画质): 无签名、无请求头绑定, 分片相对引用由播放器自行拼接
  return {
    parse: 0,
    url: `https://${p.esid}.bcvcdn.com/hls/stream_${p.chathost}/playlist.m3u8`,
    header: { 'User-Agent': UA, 'Referer': `${HOST}/${p.chathost}` },
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  // 无可用公开搜索接口 (见文件头), 返回空
  return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [] };
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
