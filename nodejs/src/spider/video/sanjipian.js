import req from '../../util/req.js';

const KEY = 'py_sanjipian';
const NAME = '蝴蝶影院';
const DEFAULT_HOST = 'https://ptt01.com';
const NAV_URLS = ['https://x99dh.cc', 'https://x99dh.one'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const BRAND = '蝴蝶影视';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const TG_GROUP = 'https://t.me/tvshare23';

let siteUrl = DEFAULT_HOST;

const CLASSES = [
{ type_id: '/p/1', type_name: '🎬 电影'},
{ type_id: '/p/3', type_name: '📺 电视剧'},
{ type_id: '/p/4', type_name: '🌸 动漫'},
{ type_id: '/p/2', type_name: '🎤 综艺'},
{ type_id: '/p/66', type_name: '⚡ 短剧'},
{ type_id: '/p/53', type_name: '⚽ 体育'},
];

const AREAS = [
{ n: '全部', v: ''},
{ n: '大陆', v: '2'},
{ n: '香港', v: '5'},
{ n: '台湾', v: '4'},
{ n: '韩国', v: '17'},
{ n: '日本', v: '18'},
{ n: '欧美', v: '6'},
{ n: '泰国', v: '10'},
];

const MOVIE_TYPES = [
{ n: '全部', v: ''},
{ n: '伦理', v: '/c/33'},
{ n: '动作', v: '/c/5'},
{ n: '喜剧', v: '/c/6'},
{ n: '爱情', v: '/c/7'},
{ n: '科幻', v: '/c/8'},
{ n: '恐怖', v: '/c/9'},
{ n: '犯罪', v: '/c/10'},
{ n: '战争', v: '/c/11'},
{ n: '动漫', v: '/c/12'},
{ n: '剧情', v: '/c/13'},
{ n: '纪录', v: '/c/14'},
{ n: '悬疑', v: '/c/15'},
{ n: '动画', v: '/c/16'},
{ n: '解说', v: '/c/35'},
];

const YEARS = [{ n: '全部', v: ''}];
for (let y = 2026; y > 2015; y--) YEARS.push({ n: String(y), v: String(y)});

const FILTER_MOVIE = [
{ key: 'class_id', name: '类型', value: MOVIE_TYPES},
{ key: 'area_id', name: '地区', value: AREAS},
{ key: 'year', name: '年份', value: YEARS},
];
const FILTER_COMMON = [
{ key: 'area_id', name: '地区', value: AREAS},
{ key: 'year', name: '年份', value: YEARS},
];
const FILTERS = {
'/p/1': FILTER_MOVIE,
'/p/3': FILTER_COMMON,
'/p/4': FILTER_COMMON,
'/p/2': FILTER_COMMON,
'/p/66': FILTER_COMMON,
'/p/53': FILTER_COMMON,
};

function headers(referer) {
return {
'User-Agent': UA,
'Referer': referer || (siteUrl + '/'),
'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
'Accept-Encoding': 'gzip, deflate',
};
}

function formatRemarks(brand, meta) {
let m = String(meta || '').trim().replace(/[\r\n\t]+/g, ' ').trim();
return m? `${brand} | ${m}`: brand;
}

function absUrl(u) {
u = String(u || '').trim();
if (!u) return '';
if (/^https?:\/\//i.test(u)) return u;
if (u.startsWith('//')) return 'https:' + u;
if (u.startsWith('/')) return siteUrl + u;
return u;
}

function htmlUnescape(s) {
return String(s || '')
.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function fetchText(targetUrl, referer = '', checkHost = true, timeout = 5000) {
if (!targetUrl) return { code: 0, text: ''};
if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
else if (targetUrl.startsWith('/')) targetUrl = siteUrl + targetUrl;
try {
const { data} = await req.get(targetUrl, { headers: headers(referer), timeout});
return { code: 200, text: String(data || '')};
} catch (e) {
const code = e?.response?.status || -1;
if ([404, 451, 502, 503].includes(code) && checkHost) {
if (await refreshSiteUrl()) {
return fetchText(targetUrl, referer, false, timeout);
}
}
return { code, text: ''};
}
}

// 动态自愈: 从导航站解码最新可用域名
async function refreshSiteUrl() {
for (const nav of NAV_URLS) {
let text = '';
try {
const { data} = await req.get(nav, { headers: headers(), timeout: 4000});
text = String(data || '');
} catch (e) {
continue;
}
if (!text) continue;
const blocks = [...text.matchAll(/["']([A-Za-z0-9+/=]{100,})["']/g)];
for (const bm of blocks) {
try {
const decoded = Buffer.from(bm[1], 'base64').toString('utf8');
let unquoted;
try {
unquoted = decodeURIComponent(decoded);
} catch (e) {
unquoted = decoded;
}
if (!unquoted.includes('[')) continue;
if (!unquoted.includes(NAME) &&!unquoted.includes('稀缺资源')) continue;
const siteList = JSON.parse(unquoted);
for (const item of siteList) {
const name = String(item.name || '').trim();
if (name!== NAME && name!== '稀缺资源') continue;
const cands = [];
if (item.url) cands.push(item.url);
for (const uo of item.urls || []) {
const u = uo.url || '';
if (u &&!cands.includes(u)) cands.push(u);
}
for (const cUrl of cands) {
try {
const u = new URL(cUrl);
const base = u.protocol + '//' + u.host;
await req.get(base + '/p/1', { headers: headers(), timeout: 3000});
siteUrl = base;
return true;
} catch (e) {}
}
}
} catch (e) {}
}
}
return false;
}

function parseCardList(htmlText) {
const cards = [];
const seen = new Set();
if (!htmlText) return cards;

let itemBlocks = [...htmlText.matchAll(/(<div[^>]+class=["'][^"']*item[^"']*["'][\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/gi)].map(m => m[1]);
if (!itemBlocks.length) {
itemBlocks = [...htmlText.matchAll(/(<a[^>]+href=["']\/\d+["'][\s\S]*?<\/a>)/gi)].map(m => m[1]);
}

for (const block of itemBlocks) {
const mHref = block.match(/href=["'](\/(\d+))["']/);
if (!mHref) continue;
const path = mHref[1];
if (seen.has(path)) continue;

let title = '';
const mTitle = block.match(/title=["']([^"']+)["']/);
if (mTitle) title = mTitle[1].trim();
if (!title) {
const mTxt = block.match(/>([^<]{1,30})<\/a>/);
if (mTxt) {
const cleanTxt = mTxt[1].trim();
if (cleanTxt &&!cleanTxt.startsWith('fa-')) title = cleanTxt;
}
}
if (!title) title = '视频 ' + mHref[2];

let imgSrc = '';
const mImg = block.match(/(?:src|data-original|data-src)=["']([^"']+)["']/i);
if (mImg) {
const cand = mImg[1].trim();
if (!/(logo|avatar|icon|\.svg)/i.test(cand)) imgSrc = absUrl(cand);
}

const mRem = block.match(/class=["'][^"']*(?:badge|label|text-muted|remarks)[^"']*["'][^>]*>([^<]+)</i);
const rawRemarks = mRem? mRem[1].trim(): 'HD';

seen.add(path);
cards.push({
vod_id: path,
vod_name: htmlUnescape(title),
vod_pic: imgSrc,
vod_remarks: formatRemarks(BRAND, rawRemarks),
style: { type: 'rect', ratio: 0.75},
});
}
return cards;
}

async function init() {
return {};
}

async function home() {
return { class: CLASSES, filters: FILTERS};
}

async function homeVod() {
return { list: []};
}

async function category(reqIn) {
const body = reqIn?.body || {};
const page = Math.max(1, parseInt(body.page, 10) || 1);
const basePath = String(body.id || '/p/1').trim();
const extend = body.filters || body.extend || {};

let reqPath = basePath;
const classId = String(extend.class_id || '');
if (classId) reqPath += classId;

const queryParts = [];
if (extend.area_id) queryParts.push('area_id=' + encodeURIComponent(extend.area_id));
if (extend.year) queryParts.push('year=' + encodeURIComponent(extend.year));
if (page > 1) queryParts.push('page=' + page);
if (queryParts.length) reqPath += (reqPath.includes('?')? '&': '?') + queryParts.join('&');

const res = await fetchText(reqPath, '', true, 4000);
const list = parseCardList(res.text);
return {
page,
pagecount: list.length? 999: page,
limit: list.length || 12,
total: 99999,
list,
};
}

async function detail(reqIn) {
const ids = Array.isArray(reqIn?.body?.id)? reqIn.body.id: [reqIn?.body?.id];
const targetPath = String(ids[0] || '').trim();
if (!targetPath) return { list: []};

const res = await fetchText(targetPath, '', true, 4000);
const htmlText = res.text || '';

const titleM = htmlText.match(/<title>(.*?)<\/title>/i);
const vodName = titleM? titleM[1].split('-')[0].trim(): 'PTT01正片';

let vodPic = '';
const mOgPic = htmlText.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
if (mOgPic) vodPic = absUrl(mOgPic[1].trim());

let desc = 'PTT01 官方直连专线';
const mDesc = htmlText.match(/class=["'][^"']*(?:detail|intro|summary|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
if (mDesc) {
const cleanDesc = mDesc[1].replace(/<[^>]+>/g, '').trim();
if (cleanDesc) desc = cleanDesc.slice(0, 250);
}

const directStreams = [...htmlText.matchAll(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/g)].map(m => m[0]);

const playItems = [];
if (directStreams.length) {
playItems.push('正片$' + directStreams[0].replace(/\\\//g, '/'));
} else {
const rawPlayLinks = [...htmlText.matchAll(/<a[^>]+href=["'](\/v\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
const seenEps = new Set();
for (const m of rawPlayLinks) {
const href = m[1];
const epTitle = m[2].replace(/<[^>]+>/g, '').trim();
if (!epTitle || /快捷键|XVIDEOS|广告/.test(epTitle)) continue;
if (seenEps.has(href)) continue;
seenEps.add(href);
playItems.push(epTitle + '$' + href);
}
}

const fullDesc = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${desc}`;

return { list: [{
vod_id: targetPath,
vod_name: vodName,
vod_pic: vodPic,
vod_actor: BRAND_ACTOR,
vod_director: BRAND_DIRECTOR,
vod_remarks: formatRemarks(BRAND, 'HD原画'),
vod_content: fullDesc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
vod_play_from: 'PTT01专线',
vod_play_url: playItems.join('#'),
}]};
}

async function play(reqIn) {
const body = reqIn?.body || {};
let playUrl = String(body.id || '').trim();

if (playUrl &&!/^https?:\/\//i.test(playUrl) && (playUrl.startsWith('/v/') || playUrl.startsWith('/'))) {
const res = await fetchText(playUrl, '', true, 4000);
const mHls = (res.text || '').match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/);
if (mHls) playUrl = mHls[0].replace(/\\\//g, '/');
}

return {
parse: 0,
url: playUrl,
header: {
'User-Agent': UA,
'Referer': siteUrl + '/',
'Origin': siteUrl,
},
};
}

async function search(reqIn) {
const body = reqIn?.body || {};
const page = Math.max(1, parseInt(body.page, 10) || 1);
const wd = String(body.wd || '').trim();
if (!wd) return { page, pagecount: page, limit: 0, total: 0, list: []};

let searchUrl = '/search?q=' + encodeURIComponent(wd);
if (page > 1) searchUrl += '&page=' + page;

const res = await fetchText(searchUrl, '', true, 4000);
const list = parseCardList(res.text);
return {
page,
pagecount: list.length? 999: page,
limit: list.length || 12,
total: 99999,
list,
};
}

export default function spider() {
return {
meta: { key: KEY, name: NAME, type: 3},
api: async (fastify) => {
fastify.post('/init', init);
fastify.post('/home', home);
fastify.post('/homeVod', homeVod);
fastify.post('/category', category);
fastify.post('/detail', detail);
fastify.post('/play', play);
fastify.post('/search', search);
},
};
}
