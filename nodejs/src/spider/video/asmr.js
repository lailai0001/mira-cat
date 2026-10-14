import req from '../../util/req.js';

const KEY = 'py_asmr';
const NAME = 'ASMR听书';
const API = 'https://api.asmr.one';
const UA =
'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const PAGE_SIZE = 20;

const ORDERS = [
{ type_id: 'create_date', type_name: '最新'},
{ type_id: 'release', type_name: '新发'},
{ type_id: 'dl_count', type_name: '最热'},
{ type_id: 'rate_average_2dp', type_name: '高分'},
{ type_id: 'review_count', type_name: '热议'},
];

function t(v) {
return String(v == null? '': v).trim();
}

async function apiGet(path) {
try {
const { data} = await req.get(API + path, {
headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.asmr.one/'},
timeout: 20000,
});
if (typeof data === 'object') return data;
return JSON.parse(String(data || '{}'));
} catch (e) {
return {};
}
}

function cleanTitle(s) {
return t(s).replace(//g, ']').replace(/\$/g, '').replace(/#/g, '');
}

function remark(w) {
const parts = [];
if (w.dl_count!= null) parts.push(`${w.dl_count}DL`);
if (w.price!= null) parts.push(`¥${w.price}`);
if (w.duration) parts.push(String(w.duration));
return parts.join(' ');
}

function rowsToVods(rows) {
const out = [];
for (const w of rows || []) {
const wid = String(w.id || '');
if (!wid) continue;
out.push({
vod_id: wid,
vod_name: cleanTitle(w.title),
vod_pic: w.mainCoverUrl || w.samCoverUrl || '',
vod_remarks: remark(w),
});
}
return out;
}

function collectAudio(node, out) {
out = out || [];
if (!node) return out;
if (node.type === 'audio') out.push(node);
for (const c of node.children || []) collectAudio(c, out);
return out;
}

async function home() {
const d = await apiGet('/api/works?order=create_date&sort=desc&page=1&pageSize=20');
const rows = d && typeof d === 'object'? d.works: [];
return { class: ORDERS, list: rowsToVods(rows)};
}

async function category(reqIn) {
const body = reqIn?.body || {};
const orderIds = ORDERS.map((o) => o.type_id);
const order = orderIds.includes(body.id)? body.id: 'create_date';
const page = Math.max(1, parseInt(body.page, 10) || 1);
const d = await apiGet(`/api/works?order=${order}&sort=desc&page=${page}&pageSize=${PAGE_SIZE}`);
const rows = d && typeof d === 'object'? d.works: [];
return { list: rowsToVods(rows), page, pagecount: 9999, limit: PAGE_SIZE, total: 9999};
}

async function search(reqIn) {
const body = reqIn?.body || {};
const wd = t(body.wd);
const page = Math.max(1, parseInt(body.page, 10) || 1);
if (!wd) return { list: [], page, pagecount: page};
const d = await apiGet(
`/api/search/${encodeURIComponent(wd)}?order=create_date&sort=desc&page=${page}&pageSize=${PAGE_SIZE}`
);
const rows = d && typeof d === 'object'? d.works: [];
return { list: rowsToVods(rows), page, pagecount: 9999};
}

async function detail(reqIn) {
const ids = Array.isArray(reqIn?.body?.id)? reqIn.body.id: [reqIn?.body?.id];
const vid = t(ids[0]);
if (!vid) return { list: []};
const d = await apiGet('/api/work/' + vid);
if (!d ||!d.id) return { list: []};

let tags = '';
if (Array.isArray(d.tags)) {
tags = d.tags
.map((x) => (x && x.name? x.name: ''))
.filter(Boolean)
.slice(0, 12)
.join(' ');
}

// 构建播放地址：tracks 树 -> audio 节点
const td = await apiGet(`/api/tracks/${vid}?v=2`);
const audio = collectAudio({ children: Array.isArray(td)? td: []});
const parts = [];
audio.forEach((a, i) => {
const title = cleanTitle(a.title) || `音轨${i + 1}`;
const url = a.streamLowQualityUrl || a.mediaStreamUrl || '';
if (url) parts.push(`${String(i + 1).padStart(2, '0')} ${title}$${url}`);
});

return {
list: [
{
vod_id: vid,
vod_name: cleanTitle(d.title),
vod_pic: d.mainCoverUrl || d.samCoverUrl || '',
vod_content: `社团: ${d.name || ''} | 时长: ${d.duration || '?'} | 价格: ¥${d.price || '?'}\n发行: ${d.release || '?'}\n${tags}`,
vod_year: String(d.release || '').slice(0, 4),
vod_actor: d.name || '',
vod_play_from: 'ASMR',
vod_play_url: parts.join('#'),
},
],
};
}

async function play(reqIn) {
const body = reqIn?.body || {};
const id = t(body.id);
if (!id ||!id.startsWith('http')) return { parse: 0, url: ''};
return { parse: 0, url: id, header: { 'User-Agent': UA}};
}

export default function spider() {
return {
meta: { key: KEY, name: NAME, type: 3},
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
