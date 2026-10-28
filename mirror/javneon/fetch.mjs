// javneon 镜像抓取脚本 —— 由 GitHub Actions 定时运行（见 .github/workflows/javneon-mirror.yml）。
//
// 为什么需要镜像：javneon.tv 的 Cloudflare 机器人验证只放行真浏览器与部分 IP，
// MiraPlayer App 的请求、Cloudflare Worker 中转、Jina、AllOrigins、翻译代理
// 全部被挑战页拦下；站方自己的 wp-json / feed 也因插件故障 500，
// 只有 curl 这类常规客户端能正常抓到内容。于是改走“铸造库”同款思路：
// 由 Actions（跑在 GitHub runner 上，用 curl 抓取）定时把列表与详情按钮
// 预抓成静态 JSON 提交回仓库，App 端蜘蛛直接从 ghfast/raw 读镜像，
// 不再实时碰 javneon.tv。播放链本身（lk1 / vidhide）不在 javneon.tv 上，
// 仍由 App 端实时走（直连优先、中转兜底），不受镜像影响。
//
// 输出：mirror/javneon/<slug>.json（每分类含第 1、2 页去重后的条目，
// 每条含详情页按钮的 data-link 十六进制串，供蜘蛛直接跑播放链）
// 与 mirror/javneon/index.json（分类总览）。
// 失败策略：某分类抓到 0 条时不覆盖旧文件；全部失败时以非 0 码退出，
// 让 Actions 运行显式失败（下次定时再试）。
import { execFile } from 'node:child_process';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'https://javneon.tv/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CATS = [
  'censored-jav',
  'uncensored-jav',
  'amateur',
  'chinese-subtitles',
  'reducing-mosaic',
  'english-subtitles',
  'popular',
];
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)));

const DIAG = [];
function curl(url) {
  return new Promise((resolve) => {
    execFile(
      'curl',
      ['-sS', '--max-time', '30', '-A', UA,
       '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
       '-H', 'Accept-Language: en-US,en;q=0.9',
       '--compressed', '-w', '\n__CURLMETA__:%{http_code}:%{size_download}', url],
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => {
        const out = String(stdout || '');
        const m = out.match(/\n__CURLMETA__:(\d+):(\d+)\s*$/);
        const body = m ? out.slice(0, m.index) : out;
        resolve({ code: m ? m[1] : (err ? 'ERR' : '?'), bytes: m ? m[2] : String(body.length), body, err: err ? String(err.message).slice(0, 200) : '' });
      },
    );
  });
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
}

// 与蜘蛛 parsePosts 同款规则（列表卡 <div class="post"> 内 /video/ 链接 + h3 + data-original 封面）
function parsePosts(html) {
  const items = [];
  const seen = new Set();
  const re = /<div class="post">([\s\S]{0,4000}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const blk = m[1];
    const lm = blk.match(/<a[^>]*href="([^"]*\/video\/[^"]+)"[^>]*>/i);
    if (!lm) continue;
    let path = lm[1];
    if (path.startsWith('http')) {
      try { path = new URL(path).pathname; } catch { continue; }
    }
    if (seen.has(path)) continue;
    const hm = blk.match(/<h3[^>]*>([\s\S]{0,400}?)<\/h3>/i);
    const title = hm ? stripTags(hm[1]) : '';
    if (!title || title.length < 2) continue;
    const pm = blk.match(/data-original="([^"]+)"/i);
    let pic = pm ? pm[1] : '';
    if (pic) pic = pic.split('!')[0];
    const dm = blk.match(/<span class="date">([^<]+)<\/span>/i);
    seen.add(path);
    items.push({ path, title, pic, date: dm ? dm[1].trim() : '' });
  }
  return items;
}

// 详情页：标题（h2）、封面（player-wrap background-image）、播放按钮 data-link
function parseDetail(html, fallbackTitle, fallbackPic) {
  const hm = html.match(/<h2[^>]*>([\s\S]{0,400}?)<\/h2>/i);
  const pm = html.match(/player-wrap[^>]*style="[^"]*background-image:\s*url\((https?:[^)]+)\)/i)
    || html.match(/player-wrap[^>]*style='[^']*background-image:\s*url\((https?:[^)]+)\)/i);
  const btns = [...html.matchAll(/class="btn-server"[^>]*data-link="([0-9a-f]+)"/gi)].map(x => x[1]);
  return {
    title: hm ? stripTags(hm[1]) : fallbackTitle,
    pic: pm ? pm[1] : fallbackPic,
    buttons: [...new Set(btns)],
  };
}

async function pool(tasks, size) {
  const out = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { out[idx] = await tasks[idx](); } catch { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });
let okCats = 0;
const index = { updated: new Date().toISOString(), categories: [] };

for (const slug of CATS) {
  const pages = [HOST + slug + '/', HOST + slug + '/page/2/'];
  const byPath = new Map();
  for (const url of pages) {
    const r = await curl(url);
    const posts = parsePosts(r.body);
    DIAG.push({ url, code: r.code, bytes: r.bytes, posts: posts.length, err: r.err, head: r.body.slice(0, 200).replace(/\s+/g, ' ') });
    console.log(`list ${url} -> ${r.code} ${r.bytes}B ${posts.length} items`);
    for (const p of posts) if (!byPath.has(p.path)) byPath.set(p.path, p);
  }
  const items = [...byPath.values()];
  if (!items.length) {
    console.log(`WARN: category ${slug} got 0 items, keeping old file`);
    continue;
  }
  // 详情按钮：并发抓，每条失败时 buttons 留空（列表仍可用，详情回落实时抓）
  const details = await pool(items.map((it) => async () => {
    const r = await curl(HOST.replace(/\/$/, '') + it.path);
    if (!r.body) return null;
    return parseDetail(r.body, it.title, it.pic);
  }), 8);
  let withBtn = 0;
  const outItems = items.map((it, idx) => {
    const d = details[idx];
    if (d && d.buttons.length) withBtn++;
    return {
      path: it.path,
      title: d && d.title ? d.title : it.title,
      pic: d && d.pic ? d.pic : it.pic,
      date: it.date,
      buttons: d ? d.buttons : [],
    };
  });
  const tmp = join(OUT_DIR, slug + '.json.tmp');
  const fin = join(OUT_DIR, slug + '.json');
  writeFileSync(tmp, JSON.stringify({ updated: new Date().toISOString(), slug, items: outItems }, null, 0));
  renameSync(tmp, fin);
  console.log(`wrote ${slug}.json: ${outItems.length} items, ${withBtn} with buttons`);
  index.categories.push({ slug, count: outItems.length, withButtons: withBtn });
  okCats++;
}

writeFileSync(join(OUT_DIR, 'index.json.tmp'), JSON.stringify(index, null, 0));
renameSync(join(OUT_DIR, 'index.json.tmp'), join(OUT_DIR, 'index.json'));
// 诊断文件：即使全部失败也写出，供从仓库直接读取 runner 侧看到的状态码与页面头
const ctl = await curl('https://example.com/');
DIAG.unshift({ control: 'example.com', code: ctl.code, bytes: ctl.bytes, err: ctl.err });
writeFileSync(join(OUT_DIR, '_diag.json'), JSON.stringify({ updated: new Date().toISOString(), okCats, diag: DIAG }, null, 0));
console.log(`done: ${okCats}/${CATS.length} categories ok`);
if (!okCats) {
  console.error('FATAL: all categories failed');
  process.exit(1);
}
