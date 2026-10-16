// 4K影院 - XPTV csp 格式
// 转换自 CatPawOpen 4K.py，站点 http://cms.lyyytv.cn（苹果CMS API）
// 41 个分类，支持搜索/详情/播放，ldmax 加密链接解密 + 解析接口
const cheerio = createCheerio();
const CryptoJS = createCryptoJS();

const HOST = 'http://cms.lyyytv.cn';
const CMSKEY = 'wP5bvxoc3yv7FoBQENFZuAF0EUYr4LTy';
const PARSE_API = 'http://61.184.23.217:6163/api/index?parsesId=4&appid=10001&videoUrl=';

const appConfig = {
    ver: 1,
    title: '4K影院',
    site: HOST,
    tabs: [
        { name: '最新电影', ext: { tid: '1' } },
        { name: '热播国剧', ext: { tid: '21' } },
        { name: '新外语片', ext: { tid: '3' } },
        { name: '欧美剧', ext: { tid: '25' } },
        { name: '韩剧', ext: { tid: '56' } },
        { name: '短剧', ext: { tid: '22' } },
        { name: '国漫', ext: { tid: '23' } },
        { name: '国综', ext: { tid: '24' } },
        { name: '少儿动画', ext: { tid: '29' } },
        { name: '热门电影①', ext: { tid: '20' } },
        { name: '热门电影②', ext: { tid: '53' } },
        { name: '热门电影③', ext: { tid: '57' } },
        { name: '国剧盛典①', ext: { tid: '26' } },
        { name: '国剧盛典②', ext: { tid: '27' } },
        { name: '国剧盛典③', ext: { tid: '52' } },
        { name: '港台剧', ext: { tid: '28' } },
        { name: '微短剧', ext: { tid: '58' } },
        { name: '好莱坞', ext: { tid: '30' } },
        { name: '好莱坞①', ext: { tid: '31' } },
        { name: '好莱坞②', ext: { tid: '32' } },
        { name: '好莱坞③', ext: { tid: '33' } },
        { name: '好莱坞④', ext: { tid: '34' } },
        { name: '好莱坞⑤', ext: { tid: '59' } },
        { name: '恐怖片', ext: { tid: '46' } },
        { name: '港台经典', ext: { tid: '36' } },
        { name: '港台经典①', ext: { tid: '37' } },
        { name: '港台经典②', ext: { tid: '38' } },
        { name: '港台经典③', ext: { tid: '39' } },
        { name: '邵氏武侠', ext: { tid: '35' } },
        { name: '明星专辑', ext: { tid: '45' } },
        { name: '经典国产', ext: { tid: '40' } },
        { name: '经典国产①', ext: { tid: '41' } },
        { name: '经典国产②', ext: { tid: '42' } },
        { name: '国产老片', ext: { tid: '43' } },
        { name: '国产老片①', ext: { tid: '44' } },
        { name: '记录片', ext: { tid: '55' } },
        { name: '无损音乐', ext: { tid: '54' } },
        { name: '电影', ext: { tid: '47' } },
        { name: '电视剧', ext: { tid: '48' } },
        { name: '动漫', ext: { tid: '49' } },
        { name: '综艺', ext: { tid: '50' } },
    ],
};

const UA_OKHTTP = 'okhttp/4.12.0';
const UA_PARSE = 'okhttp-okgo/jeasonlzy';

function t(v) {
    return String(v == null ? '' : v).trim();
}

function apiHeaders() {
    return { 'User-Agent': UA_OKHTTP };
}

async function httpGetJson(url, ua) {
    try {
        const { data } = await $fetch.get(url, { headers: { 'User-Agent': ua || UA_OKHTTP } });
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return null; }
        }
        return data;
    } catch (e) {
        return null;
    }
}

// ---- lvdou AES 解密（对应 Python lvdou） ----
function lvdouDecrypt(text) {
    const prefix = 'lvdou+';
    if (!text || text.indexOf(prefix) !== 0) return text;
    try {
        const key = CryptoJS.enc.Utf8.parse(CMSKEY.substring(0, 16));
        const iv = CryptoJS.enc.Utf8.parse(CMSKEY.substring(CMSKEY.length - 16));
        const ct = text.substring(prefix.length);
        const decrypted = CryptoJS.AES.decrypt(ct, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        const plain = decrypted.toString(CryptoJS.enc.Utf8);
        return plain || text;
    } catch (e) {
        return text;
    }
}

function isValidBase64(s) {
    s = String(s || '').replace(/\s+/g, '');
    if (!s || s.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}

// ---- ldmax 递归解密（对应 Python ldmax_decrypt） ----
function ldmaxDecrypt(encryptedBase64, depth) {
    depth = depth || 0;
    if (depth > 5) return null;
    const cleaned = String(encryptedBase64 || '').replace(/\s+/g, '');
    if (!isValidBase64(cleaned)) return encryptedBase64; // 非法 base64，原样返回
    let url;
    try {
        url = CryptoJS.enc.Base64.parse(cleaned).toString(CryptoJS.enc.Utf8).replace(/\s+/g, '');
    } catch (e) {
        return encryptedBase64;
    }
    if (url.indexOf('ldmax.cooom') === -1) return url;
    const path = url.replace(/^https?:\/\/ldmax\.cooom\//, '');
    if (path.length < 16) return null;
    const keyStr = path.substring(0, 16).split('').reverse().join('');
    const ctB64 = path.substring(16).replace(/\s+/g, '');
    try {
        const key = CryptoJS.enc.Utf8.parse(keyStr);
        const decrypted = CryptoJS.AES.decrypt(ctB64, key, { iv: key, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        const result = decrypted.toString(CryptoJS.enc.Utf8).trim();
        if (!result) return null;
        if (result.indexOf('ldmax.cooom') !== -1) {
            return ldmaxDecrypt(CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(result)), depth + 1);
        }
        return result;
    } catch (e) {
        return null;
    }
}

// ---- ldmax 解析流程（对应 Python ldmax_parse） ----
async function ldmaxParse(videoUrl) {
    const decrypted = ldmaxDecrypt(videoUrl);
    if (!decrypted || !/^https?:\/\//.test(decrypted)) return null;
    const resp = await httpGetJson(PARSE_API + encodeURIComponent(decrypted), UA_PARSE);
    if (!resp || resp.code !== 200 || !resp.url) return null;
    const finalUrl = ldmaxDecrypt(resp.url);
    if (finalUrl && /^https?:\/\//.test(finalUrl)) {
        return { url: finalUrl, type: resp.type || 'video' };
    }
    return null;
}

function isPlainDirectUrl(url) {
    return /^https?:\/\//.test(url || '');
}

function looksLikeMedia(url) {
    return /https?:\/\/.*(?:\.(?:mp4|m3u8|flv|avi|mkv|ts|mov|wmv|webm)|lyyytv\.cn\/)/i.test(url || '');
}

function toCard(v) {
    return {
        vod_id: String(v.vod_id || ''),
        vod_name: t(v.vod_name),
        vod_pic: t(v.vod_pic),
        vod_remarks: t(v.vod_remarks || v.vod_score || ''),
        ext: { id: String(v.vod_id || '') },
    };
}

async function getConfig() {
    return jsonify(appConfig);
}

async function getCards(ext) {
    ext = argsify(ext);
    const tid = ext.tid || '1';
    const page = ext.page || 1;
    const url = `${HOST}/api.php/app/video?tid=${encodeURIComponent(tid)}&pg=${page}&limit=18`;
    const data = await httpGetJson(url);
    const list = (data && Array.isArray(data.list) ? data.list : []).map(toCard);
    return jsonify({ list });
}

async function getTracks(ext) {
    ext = argsify(ext);
    const id = ext.id || '';
    const tracks = [];
    if (id) {
        const data = await httpGetJson(`${HOST}/api.php/app/video_detail?id=${encodeURIComponent(id)}`);
        const d = data && data.data ? data.data : null;
        const groups = d && Array.isArray(d.vod_url_with_player) ? d.vod_url_with_player : [];
        groups.forEach((g) => {
            const name = t(g.name) || '线路';
            const parts = String(g.url || '').split('#');
            parts.forEach((p) => {
                if (!p) return;
                const seg = p.split('$');
                const epName = t(seg[0]) || name;
                const rawUrl = seg.length > 1 ? seg.slice(1).join('$') : '';
                const playUrl = lvdouDecrypt(rawUrl);
                // 去掉 URL 中的百分号编码（对应 Python playerContent）
                const cleanUrl = playUrl.replace(/%[0-9A-Fa-f]{2}/g, '');
                tracks.push({ name: epName, pan: '', ext: { url: cleanUrl, line: name } });
            });
        });
    }
    return jsonify({
        list: [{ title: '在线播放', tracks }],
    });
}

async function getPlayinfo(ext) {
    ext = argsify(ext);
    let url = t(ext.url || '');
    if (!url) return jsonify({ urls: [], headers: [] });
    const plain = isPlainDirectUrl(url);
    // 需要内置解析：非明文 URL，或本站 lyyytv.cn 伪直链
    if (!plain || url.indexOf('lyyytv.cn') !== -1) {
        const parsed = await ldmaxParse(url);
        if (parsed && parsed.url) {
            return jsonify({
                urls: [parsed.url],
                headers: [{ 'User-Agent': UA_OKHTTP, Referer: HOST + '/' }],
            });
        }
    }
    if (looksLikeMedia(url)) {
        return jsonify({
            urls: [url],
            headers: [{ 'User-Agent': UA_OKHTTP, Referer: HOST + '/' }],
        });
    }
    // 其他情况：返回原 URL 让 XPTV 尝试嗅探
    return jsonify({
        urls: [url],
        headers: [{ 'User-Agent': UA_OKHTTP, Referer: HOST + '/' }],
    });
}

async function search(ext) {
    ext = argsify(ext);
    const wd = t(ext.text);
    const page = ext.page || 1;
    if (!wd) return jsonify({ list: [] });
    const url = `${HOST}/api.php/app/search?text=${encodeURIComponent(wd)}&pg=${page}`;
    const data = await httpGetJson(url);
    const list = (data && Array.isArray(data.list) ? data.list : []).map(toCard);
    return jsonify({ list });
}
