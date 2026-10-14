// 123AV - XPTV csp 格式
// 转换自 CatPawOpen py_av123，站点 https://123av.com
const cheerio = createCheerio();

const appConfig = {
    ver: 1,
    title: '123AV',
    site: 'https://123av.com',
    tabs: [
        { name: '新发布', ext: { url: '/cn/new' } },
        { name: '热门', ext: { url: '/cn/hot' } },
        { name: '最近更新', ext: { url: '/cn/recent' } },
        { name: '有码', ext: { url: '/cn/censored' } },
        { name: '无码', ext: { url: '/cn/uncensored' } },
        { name: '无码泄露', ext: { url: '/cn/uncensored-leaked' } },
        { name: '类别', ext: { url: '/cn/genres' } },
        { name: '女演员', ext: { url: '/cn/actresses' } },
        { name: '制作商', ext: { url: '/cn/makers' } },
        { name: '系列', ext: { url: '/cn/series' } },
    ],
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function t(v) {
    return String(v == null ? '' : v).trim();
}

function headers() {
    return {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: appConfig.site + '/cn/',
    };
}

async function httpGet(url, extraHeaders) {
    try {
        const { data } = await $fetch.get(url, { headers: extraHeaders || headers() });
        return typeof data === 'string' ? data : String(data || '');
    } catch (e) {
        return '';
    }
}

function hiResCover(url) {
    url = t(url);
    if (!url) return '';
    return url.replace(/\/s360\//, '/s1080/');
}

function parseList(html) {
    const items = [];
    const seen = {};
    const re = /<a class="card__link" href="(\/(?:cn|en)\/v\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
        const link = m[1];
        if (seen[link]) continue;
        seen[link] = 1;
        let title = t(m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' '));
        if (!title) title = link.split('/').pop();

        let pic = '';
        let dur = '';
        const windowStart = Math.max(0, m.index - 1200);
        const chunk = html.slice(windowStart, m.index + 20);
        const im = chunk.match(/class="card__img"[^>]+src="([^"]+)"|src="([^"]+)"[^>]+class="card__img"/);
        if (im) pic = im[1] || im[2] || '';
        if (!pic) {
            const im2 = chunk.match(/(?:src|data-src)="(https?:\/\/[^"]+\/(?:s360|s500|s1080)\/[^"]+)"/i);
            if (im2) pic = im2[1];
        }
        const dm = chunk.match(/class="card__dur"[^>]*>([^<]+)</);
        if (dm) dur = t(dm[1]);

        items.push({
            vod_id: link,
            vod_name: title,
            vod_pic: hiResCover(pic),
            vod_remarks: dur,
            ext: { url: appConfig.site + link },
        });
    }
    return items;
}

function unescapeJsonish(s) {
    s = String(s || '');
    s = s.replace(/\\u0022/g, '"').replace(/\\u0027/g, "'");
    s = s.replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>');
    let prev;
    do {
        prev = s;
        s = s.replace(/\\\//g, '/');
    } while (s !== prev);
    return s;
}

function extractEmbeds(html) {
    const embeds = [];
    const m = html.match(/player\(\s*JSON\.parse\(\s*(['"])([\s\S]*?)\1\s*\)/);
    if (m) {
        const s = unescapeJsonish(m[2]);
        try {
            const arr = JSON.parse(s);
            if (Array.isArray(arr)) {
                arr.forEach((it) => {
                    if (it && it.url) {
                        const u = unescapeJsonish(String(it.url));
                        let nm = t(it.name);
                        if (!nm || /^\d+$/.test(nm)) nm = '线路' + (embeds.length + 1);
                        embeds.push({ name: nm, url: u });
                    }
                });
            }
        } catch (e) {}
    }
    if (!embeds.length) {
        const em2 = html.match(/https?:\/\/[^"'\\\s]+\/e\/[A-Za-z0-9]+/g) || [];
        em2.forEach((u, i) => {
            embeds.push({ name: '线路' + (i + 1), url: unescapeJsonish(u) });
        });
    }
    return embeds;
}

async function resolveStream(embedUrl) {
    embedUrl = t(embedUrl);
    if (!embedUrl) return { stream: '', origin: '' };
    const idm = embedUrl.match(/\/e\/([A-Za-z0-9]+)/);
    if (!idm) return { stream: '', origin: '' };
    const originM = embedUrl.match(/^(https?:\/\/[^/]+)/);
    const origin = originM ? originM[1] : '';
    const streamApi = origin + '/stream?id=' + encodeURIComponent(idm[1]);
    try {
        const { data } = await $fetch.get(streamApi, {
            headers: {
                'User-Agent': UA,
                Accept: 'application/json, text/plain, */*',
                Referer: embedUrl,
                Origin: origin,
            },
        });
        let body = data;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { return { stream: '', origin }; }
        }
        const stream = t((body && body.media && body.media.stream) || (body && body.stream) || '');
        return { stream, origin };
    } catch (e) {
        return { stream: '', origin };
    }
}

async function getConfig() {
    return jsonify(appConfig);
}

async function getCards(ext) {
    ext = argsify(ext);
    const page = ext.page || 1;
    const base = ext.url || '/cn/new';
    const url = page > 1 ? `${appConfig.site}${base}?page=${page}` : `${appConfig.site}${base}`;
    const html = await httpGet(url);
    const cards = parseList(html);
    return jsonify({ list: cards });
}

async function getTracks(ext) {
    ext = argsify(ext);
    const detailUrl = ext.url || '';
    const html = await httpGet(detailUrl);
    const tracks = [];
    if (html) {
        const embeds = extractEmbeds(html);
        for (const e of embeds) {
            const { stream, origin } = await resolveStream(e.url);
            if (stream) {
                tracks.push({ name: e.name, pan: '', ext: { url: stream, origin } });
            } else {
                tracks.push({ name: e.name, pan: '', ext: { embed: e.url } });
            }
        }
    }
    return jsonify({
        list: [{ title: '在线播放', tracks }],
    });
}

async function getPlayinfo(ext) {
    ext = argsify(ext);
    let url = ext.url || '';
    let origin = ext.origin || '';
    if (!url && ext.embed) {
        const r = await resolveStream(ext.embed);
        url = r.stream;
        origin = r.origin;
    }
    const header = origin
        ? { 'User-Agent': UA, Referer: origin + '/', Origin: origin, Accept: '*/*' }
        : { 'User-Agent': UA, Referer: appConfig.site + '/cn/' };
    return jsonify({
        urls: url ? [url] : [],
        headers: [header],
    });
}

async function search(ext) {
    ext = argsify(ext);
    const wd = String(ext.text || '').trim();
    const page = ext.page || 1;
    if (!wd) return jsonify({ list: [] });
    const url = `${appConfig.site}/cn/search?keyword=${encodeURIComponent(wd)}${page > 1 ? '&page=' + page : ''}`;
    const html = await httpGet(url);
    const cards = parseList(html);
    return jsonify({ list: cards });
}
