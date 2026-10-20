import req from '../../util/req.js';

// BigButtsHub (py_bigbuttshub) — 品牌名取自站内标题 "Big Butts Hub"
// 站点: https://bigbuttshub.com/ (WordPress 成人聚合站, SSR 直出, 无 CF 拦截,
//   VM 直连 curl 全 200; 封面自托管 wp-content/uploads 的 webp, 无头实拉 200)
// 列表: 分类 /category/{slug}/[/page/N/] (slug 可含子级 a/b)、标签
//   /tag/{slug}/、演员 /pornstar/{slug}/, 均 /page/N/ 翻页 (每页 20 条);
//   搜索 /?s={kw}[&paged=N]。注意: 首页的 ?filter= 筛选是 JS 装饰, SSR 下
//   返回与首页完全相同的内容、/page/N/ 也只是重渲染首页, 故不收筛选分类。
//   卡片: article.loop-video 内 a[href] + data-main-thumb / img[data-src] + .duration。
// 详情: og:title/og:image/og:description + itemprop duration + pornstar/tag 链接;
//   播放器是多标签页 (tab0..tabN), 每个视频挂 4-7 个第三方 embed, 宿主轮换。
//   逐宿主实测结论 (2026-10-20, 采样 5 个视频):
//   - bigbuttshub.top /e/{id}: 5/5 都有。vidhide 系 (JW + Dean Edwards packer,
//     links hls4/hls3/hls2, 最高 1080p)。流媒体层按铸造 token 时的网络身份
//     放行 (hls2 连接层切断、hls3 回 403 Website Access Blocked、hls4 仅
//     "抓 embed 与拉流同一出口"才 200) —— 与 JavGG/SexTB 实证一致:
//     App 内解码直返必死, 走全链代理 Worker (见下方 BBH_WORKER)。
//   - streamcash.to /embed/{id}: 3/5。embed 页内 __PCr 是 base64 的 JSON,
//     src = cdn.streamcash.to/videos/{id}/index.m3u8 (单档媒体列表),
//     播放列表/分片全部无头实拉 200 (分片 0x47 真 TS) → 蜘蛛直解作保底线。
//   - playmogo.com (DoodStream 马甲): 点播前有 Cloudflare Turnstile 人机
//     验证, 蜘蛛解不了, 不收。
//   - bigbuttshub2.top (Byse SPA)、bigbuttshubvideos.com (#hash 播放器)、
//     flyf.lat、nowplay.to、porntoday.ws: 均为 JS 驱动/多跳, 本轮未解,
//     不收 (详情里出现也不生成线路)。
// 线路: 高清 = bigbuttshub.top 经 Worker (部署前自动回退: 蜘蛛内解包取
//   hls4 直返 → 再不行 parse:1 嗅探 embed 页); 直连 = streamcash 直解。
//   两条线互不依赖, Worker 没部署时直连线照常能播。

const KEY = 'py_bigbuttshub';
const NAME = 'BigButtsHub';
const SITE = 'https://bigbuttshub.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = SITE + '/';
// vidhide 全链代理 Worker 基址 (需用户把 newsrc3/bigbuttshub-vidhide-worker.js
// 部署为同名 Worker 后生效; 名字暂定 bigbuttshub-vidhide, 用户可改, 改名后同步此行)。
// 留空则高清线回退蜘蛛内解包/嗅探; 直连线 (streamcash) 不依赖此常量。
const BBH_WORKER = 'https://bigbuttshub-vidhide.li768435813.workers.dev';

// 分类 (2026-10-20 实测收割: 站内分类 62 + 标签 66 (站内计数>=10) + 演员 59
// (演员索引前 3 页); tid 前缀 c_/t_/a_, 子级 slug 的 / 编码为 ~)
const CATS = [
  { type_id: 'c_adult-time', type_name: "Adult Time" },
  { type_id: 'c_all-anal', type_name: "All Anal" },
  { type_id: 'c_amateur', type_name: "Amateur" },
  { type_id: 'c_anal-mom', type_name: "Anal Mom" },
  { type_id: 'c_anal-only', type_name: "Anal Only" },
  { type_id: 'c_analized', type_name: "Analized" },
  { type_id: 'c_analtherapyxxx', type_name: "AnalTherapyXXX" },
  { type_id: 'c_asshole-fever', type_name: "Asshole Fever" },
  { type_id: 'c_babes', type_name: "Babes" },
  { type_id: 'c_baddies-pov', type_name: "Baddies POV" },
  { type_id: 'c_bang', type_name: "Bang" },
  { type_id: 'c_bangbros', type_name: "BangBros" },
  { type_id: 'c_bangbros~assparade', type_name: "AssParade" },
  { type_id: 'c_bangbros~bang-bus', type_name: "Bang Bus" },
  { type_id: 'c_bangbros~bangbros18', type_name: "BangBros18" },
  { type_id: 'c_bangbros~bangbrosclips', type_name: "BangbrosClips" },
  { type_id: 'c_bangbros~bangpov', type_name: "BangPOV" },
  { type_id: 'c_bangbros~bigtitcreampie', type_name: "BigTitCreampie" },
  { type_id: 'c_bangbros~bigtitsroundasses', type_name: "BigTitsRoundAsses" },
  { type_id: 'c_brazzers', type_name: "Brazzers" },
  { type_id: 'c_brazzers~bigwettbutts', type_name: "BigWettButts" },
  { type_id: 'c_brazzers~brazzersexxtra', type_name: "BrazzersExxtra" },
  { type_id: 'c_brazzers~daywithapornstar', type_name: "DayWithAPornstar" },
  { type_id: 'c_brazzers~dirtymasseur', type_name: "DirtyMasseur" },
  { type_id: 'c_brazzers~realwifestories', type_name: "RealWifeStories" },
  { type_id: 'c_castingcouchhd', type_name: "CastingCouchHD" },
  { type_id: 'c_deeper', type_name: "Deeper" },
  { type_id: 'c_dick-drainers', type_name: "Dick Drainers" },
  { type_id: 'c_familytherapy', type_name: "FamilyTherapy" },
  { type_id: 'c_filthy-kings', type_name: "Filthy Kings" },
  { type_id: 'c_filthy-kings~filthy-massage', type_name: "Filthy Massage" },
  { type_id: 'c_got-filled', type_name: "Got Filled" },
  { type_id: 'c_hardx', type_name: "HardX" },
  { type_id: 'c_her-limit', type_name: "Her Limit" },
  { type_id: 'c_holed', type_name: "Holed" },
  { type_id: 'c_hotwifexxx', type_name: "HotwifeXXX" },
  { type_id: 'c_houseofrye', type_name: "HouseOFrye" },
  { type_id: 'c_jules-jordan', type_name: "Jules Jordan" },
  { type_id: 'c_mylf', type_name: "Mylf" },
  { type_id: 'c_mylf~milfty', type_name: "Milfty" },
  { type_id: 'c_mylf~mylf-labs', type_name: "Mylf Labs" },
  { type_id: 'c_mylf~mylfofthemonth', type_name: "MylfOfTheMonth" },
  { type_id: 'c_mylf~mylfxmisslexa', type_name: "MylfxMissLexa" },
  { type_id: 'c_naughty-america', type_name: "Naughty America" },
  { type_id: 'c_naughty-america~assmasterpiece', type_name: "AssMasterpiece" },
  { type_id: 'c_naughty-america~my-wifes-hot-friend', type_name: "My Wife's Hot Friend" },
  { type_id: 'c_naughty-america~myfriendshotmom', type_name: "MyFriendsHotMom" },
  { type_id: 'c_naughty-america~mysistershotfriend', type_name: "MySistersHotfriend" },
  { type_id: 'c_naughty-america~naughtyathletics', type_name: "NaughtyAthletics" },
  { type_id: 'c_naughty-america~naughtyoffice', type_name: "NaughtyOffice" },
  { type_id: 'c_naughty-america~neighboraffair', type_name: "NeighborAffair" },
  { type_id: 'c_naughty-america~perfect-fucking-strangers', type_name: "Perfect Fucking Strangers" },
  { type_id: 'c_naughty-america~tonights-girlfriend', type_name: "Tonight's Girlfriend" },
  { type_id: 'c_onlyfans', type_name: "OnlyFans" },
  { type_id: 'c_pawged', type_name: "PAWGed" },
  { type_id: 'c_perv-mom', type_name: "Perv Mom" },
  { type_id: 'c_sex-mex', type_name: "Sex Mex" },
  { type_id: 'c_shedoesanal', type_name: "SheDoesAnal" },
  { type_id: 'c_team-skeet', type_name: "Team Skeet" },
  { type_id: 'c_team-skeet~badmilfs', type_name: "BadMilfs" },
  { type_id: 'c_team-skeet~teenpies', type_name: "TeenPies" },
  { type_id: 'c_true-anal', type_name: "True Anal" },
  { type_id: 't_big-tits', type_name: "Big Tits" },
  { type_id: 't_pawg', type_name: "PAWG" },
  { type_id: 't_thick', type_name: "Thick" },
  { type_id: 't_milf', type_name: "MILF" },
  { type_id: 't_rough-sex', type_name: "Rough Sex" },
  { type_id: 't_phat-ass', type_name: "Phat Ass" },
  { type_id: 't_brunette', type_name: "Brunette" },
  { type_id: 't_fit-ass', type_name: "Fit Ass" },
  { type_id: 't_teen', type_name: "Teen" },
  { type_id: 't_blonde', type_name: "Blonde" },
  { type_id: 't_oil', type_name: "Oil" },
  { type_id: 't_big-booty-onlyfans', type_name: "Big Booty OnlyFans" },
  { type_id: 't_facial', type_name: "Facial" },
  { type_id: 't_pov', type_name: "POV" },
  { type_id: 't_interracial', type_name: "Interracial" },
  { type_id: 't_latina', type_name: "Latina" },
  { type_id: 't_anal', type_name: "Anal" },
  { type_id: 't_blowjob', type_name: "Blowjob" },
  { type_id: 't_doggystyle', type_name: "Doggystyle" },
  { type_id: 't_rim-job', type_name: "Rim Job" },
  { type_id: 't_booty-jiggle', type_name: "Booty Jiggle" },
  { type_id: 't_cheating', type_name: "Cheating" },
  { type_id: 't_missionary', type_name: "Missionary" },
  { type_id: 't_cowgirl', type_name: "Cowgirl" },
  { type_id: 't_reverse-cowgirl', type_name: "Reverse-Cowgirl" },
  { type_id: 't_threesome', type_name: "Threesome" },
  { type_id: 't_tattoo', type_name: "Tattoo" },
  { type_id: 't_ass-worship', type_name: "Ass Worship" },
  { type_id: 't_huge-booty', type_name: "Huge Booty" },
  { type_id: 't_sneaky-sex', type_name: "Sneaky Sex" },
  { type_id: 't_creampie', type_name: "Creampie" },
  { type_id: 't_hardcore', type_name: "Hardcore" },
  { type_id: 't_fishnets', type_name: "Fishnets" },
  { type_id: 't_yoga-pants', type_name: "Yoga Pants" },
  { type_id: 't_deepthroat', type_name: "Deepthroat" },
  { type_id: 't_workout', type_name: "Workout" },
  { type_id: 't_stepmom', type_name: "Stepmom" },
  { type_id: 't_wife', type_name: "Wife" },
  { type_id: 't_public', type_name: "Public" },
  { type_id: 't_bbw', type_name: "BBW" },
  { type_id: 't_massage', type_name: "Massage" },
  { type_id: 't_gape', type_name: "Gape" },
  { type_id: 't_red-head', type_name: "Red Head" },
  { type_id: 't_stepsister', type_name: "Stepsister" },
  { type_id: 't_round-butt', type_name: "Round Butt" },
  { type_id: 't_butt-plug', type_name: "Butt Plug" },
  { type_id: 't_bbc', type_name: "BBC" },
  { type_id: 't_ffm-threesome', type_name: "FFM Threesome" },
  { type_id: 't_twerking', type_name: "Twerking" },
  { type_id: 't_anal-creampie', type_name: "Anal Creampie" },
  { type_id: 't_maid', type_name: "Maid" },
  { type_id: 't_big-booty-lissa-aires', type_name: "Big Booty Lissa Aires" },
  { type_id: 't_ebony', type_name: "Ebony" },
  { type_id: 't_squirt', type_name: "Squirt" },
  { type_id: 't_big-booty-jenna-starr', type_name: "Big Booty Jenna Starr" },
  { type_id: 't_big-booty-the-official-egypt', type_name: "Big Booty The Official Egypt" },
  { type_id: 't_outdoor', type_name: "Outdoor" },
  { type_id: 't_big-booty-brandylicious', type_name: "Big Booty Brandylicious" },
  { type_id: 't_double-blowjob', type_name: "Double Blowjob" },
  { type_id: 't_stepdaughter', type_name: "Stepdaughter" },
  { type_id: 't_freeuse', type_name: "Freeuse" },
  { type_id: 't_office-sex', type_name: "Office Sex" },
  { type_id: 't_pawg-auhneesh-nicole', type_name: "PAWG Auhneesh Nicole" },
  { type_id: 't_sideways-fucking', type_name: "Sideways Fucking" },
  { type_id: 't_face-fucking', type_name: "Face Fucking" },
  { type_id: 't_lesbian', type_name: "Lesbian" },
  { type_id: 'a_6ft-phenomenon', type_name: "6ft Phenomenon" },
  { type_id: 'a_abby-rose', type_name: "Abby Rose" },
  { type_id: 'a_abella-danger', type_name: "Abella Danger" },
  { type_id: 'a_abigaiil-morris', type_name: "Abigaiil Morris" },
  { type_id: 'a_abigail', type_name: "Abigail" },
  { type_id: 'a_adriana-chechik', type_name: "Adriana Chechik" },
  { type_id: 'a_advoree', type_name: "Advoree" },
  { type_id: 'a_alana-luv', type_name: "Alana Luv" },
  { type_id: 'a_alanna-pow', type_name: "Alanna Pow" },
  { type_id: 'a_aletta-ocean', type_name: "Aletta Ocean" },
  { type_id: 'a_alexa-payne', type_name: "Alexa Payne" },
  { type_id: 'a_alexas-morgan', type_name: "Alexas Morgan" },
  { type_id: 'a_alexis-andrews', type_name: "Alexis Andrews" },
  { type_id: 'a_alexis-fawx', type_name: "Alexis Fawx" },
  { type_id: 'a_alexis-texas', type_name: "Alexis Texas" },
  { type_id: 'a_alice-fantasy', type_name: "Alice Fantasy" },
  { type_id: 'a_alice-thunder', type_name: "Alice Thunder" },
  { type_id: 'a_alisha-grey', type_name: "Alisha Grey" },
  { type_id: 'a_allie-adams', type_name: "Allie Adams" },
  { type_id: 'a_alura-jenson', type_name: "Alura Jenson" },
  { type_id: 'a_alyx-star', type_name: "Alyx Star" },
  { type_id: 'a_anais-amore', type_name: "Anais Amore" },
  { type_id: 'a_analeasex', type_name: "Analeasex" },
  { type_id: 'a_andie-anderson', type_name: "Andie Anderson" },
  { type_id: 'a_angel-wicky', type_name: "Angel Wicky" },
  { type_id: 'a_angel-youngs', type_name: "Angel Youngs" },
  { type_id: 'a_angela-white', type_name: "Angela White" },
  { type_id: 'a_anikka-albrite', type_name: "Anikka Albrite" },
  { type_id: 'a_anissa-miller', type_name: "Anissa Miller" },
  { type_id: 'a_anna-bell-peaks', type_name: "Anna Bell Peaks" },
  { type_id: 'a_anna-chambers', type_name: "Anna Chambers" },
  { type_id: 'a_anna-claire-clouds', type_name: "Anna Claire Clouds" },
  { type_id: 'a_annabel-redd', type_name: "Annabel Redd" },
  { type_id: 'a_april-eighteen', type_name: "April Eighteen" },
  { type_id: 'a_april-olsen', type_name: "April Olsen" },
  { type_id: 'a_arabelle-raphael', type_name: "Arabelle Raphael" },
  { type_id: 'a_ariana-starr', type_name: "Ariana Starr" },
  { type_id: 'a_arietta-adams', type_name: "Arietta Adams" },
  { type_id: 'a_ashley-barbie', type_name: "Ashley Barbie" },
  { type_id: 'a_ashlyn-peaks', type_name: "Ashlyn Peaks" },
  { type_id: 'a_atlanta-moreno', type_name: "Atlanta Moreno" },
  { type_id: 'a_aubree-valentine', type_name: "Aubree Valentine" },
  { type_id: 'a_august-skye', type_name: "August Skye" },
  { type_id: 'a_auhneesh-nicole', type_name: "Auhneesh Nicole" },
  { type_id: 'a_autumn-falls', type_name: "Autumn Falls" },
  { type_id: 'a_ava-addams', type_name: "Ava Addams" },
  { type_id: 'a_ava-nicks', type_name: "Ava Nicks" },
  { type_id: 'a_avery-jane', type_name: "Avery Jane" },
  { type_id: 'a_bailey-brooke', type_name: "Bailey Brooke" },
  { type_id: 'a_behindthemaskk', type_name: "BehindTheMaskk" },
  { type_id: 'a_bella-blu', type_name: "Bella Blu" },
  { type_id: 'a_bella-jane', type_name: "Bella Jane" },
  { type_id: 'a_bella-rolland', type_name: "Bella Rolland" },
  { type_id: 'a_blake-blossom', type_name: "Blake Blossom" },
  { type_id: 'a_blondie-bombshell', type_name: "Blondie Bombshell" },
  { type_id: 'a_blondie-fesser', type_name: "Blondie Fesser" },
  { type_id: 'a_bootyfrutti', type_name: "BootyFrutti" },
  { type_id: 'a_brandi-love', type_name: "Brandi Love" },
  { type_id: 'a_brandy-renee', type_name: "Brandy Renee" },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function fixUrl(u) {
  u = t(u);
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return u;
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// 双通道抓文本: 先框架 req, 失败再原生 fetch
async function getText(url, headers, minLen, timeoutMs) {
  const to = timeoutMs || 12000;
  const h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const need = minLen || 200;
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: to, responseType: 'text' });
    if (status === 200 && data) {
      const txt = typeof data === 'string' ? data : String(data);
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await withTimeout(fetch(url, { headers: h }), to);
    if (r.ok) {
      const txt = await r.text();
      if (txt.length >= need) return txt;
    }
  } catch (e) { /* ignore */ }
  return '';
}

// ---------- 列表 ----------
// 页面结构 (WP-Script 系模板): 正文列表恒在最前, 其后跟一串全站恒定的
// widget 块 (Most Viewed / Latest Videos / Random Videos / Popular Videos,
// 每块 6-12 条, 卡片同为 article.loop-video), 分布在正文区与 <aside> 里,
// 不截断会污染列表并造成翻页"重叠"。截断规则: 从第一张卡之后开始找,
// 在最早出现的 widget 标记处切掉 (演员/子分类页的自有列表可能只有 1-2 条,
// 是站方给该分类目实际打标的帖数, 不是解析丢失)。
function parseCards(html) {
  const out = [];
  const seen = new Set();
  let src = String(html || '');
  const firstArt = src.indexOf('<article');
  const scanFrom = firstArt >= 0 ? firstArt + 1 : 0;
  let cut = src.length;
  for (const marker of ['<aside', '<h2 class="widget-title">', 'widget_videos_block']) {
    const i = src.indexOf(marker, scanFrom);
    if (i > 0 && i < cut) cut = i;
  }
  src = src.slice(0, cut);
  const parts = src.split('<article');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 4500);
    if (!chunk.includes('loop-video')) continue;
    const linkM = chunk.match(/<a href="(https:\/\/bigbuttshub\.com\/[^"]+\/)"/);
    if (!linkM) continue;
    const durl = linkM[1];
    if (seen.has(durl)) continue;
    // 排除分类/演员/标签等非视频链接 (视频贴在站根下且 slug 不含这些前缀)
    if (/\/(category|tag|pornstar|actors|categories|tags|blog|page)\//.test(durl)) continue;
    seen.add(durl);
    let pic = '';
    const thumbM = chunk.match(/data-main-thumb="([^"]+)"/);
    if (thumbM) pic = thumbM[1];
    if (!pic) {
      const imgM = chunk.match(/<img[^>]+data-src="([^"]+)"/) || chunk.match(/<img[^>]+src="(https:[^"]+)"/);
      if (imgM && !/data:image/.test(imgM[1])) pic = imgM[1];
    }
    let name = '';
    const titleM = chunk.match(/<a href="[^"]+" title="([^"]+)"/);
    if (titleM) name = clean(titleM[1]);
    if (!name) {
      const altM = chunk.match(/<img[^>]+alt="([^"]+)"/);
      if (altM) name = clean(altM[1]);
    }
    if (!name) {
      const headM = chunk.match(/<header class="entry-header">\s*<span>([\s\S]*?)<\/span>/);
      if (headM) name = clean(headM[1]);
    }
    let remarks = '';
    const durM = chunk.match(/<span class="duration">[\s\S]*?(\d{1,2}:\d{2}(?::\d{2})?)\s*<\/span>/);
    if (durM) remarks = durM[1];
    out.push({ vod_id: durl, vod_name: name || durl, vod_pic: fixUrl(pic), vod_remarks: remarks });
  }
  return out;
}

function parsePagecount(html, page) {
  const nums = [...String(html || '').matchAll(/\/page\/(\d+)\//g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
  const max = nums.length ? Math.max(...nums) : 0;
  return Math.max(max, page, 1);
}

function catUrl(tid, page) {
  const cat = CATS.find(c => c.type_id === tid) || CATS[0];
  const id = cat.type_id;
  const pg = page > 1 ? 'page/' + page + '/' : '';
  if (id.startsWith('c_')) return SITE + '/category/' + id.slice(2).replace(/~/g, '/') + '/' + pg;
  if (id.startsWith('t_')) return SITE + '/tag/' + id.slice(2) + '/' + pg;
  if (id.startsWith('a_')) return SITE + '/pornstar/' + id.slice(2) + '/' + pg;
  return SITE + '/';
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getText(SITE + '/');
  const list = html ? parseCards(html) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'c_amateur';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await getText(catUrl(tid, page));
  if (!html) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const list = parseCards(html);
  return { page, pagecount: parsePagecount(html, page), limit: 20, total: list.length, list };
}

// ---------- 详情 ----------
function isoDurationToClock(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = parseInt(m[1] || '0', 10), mi = parseInt(m[2] || '0', 10), s = parseInt(m[3] || '0', 10);
  const mm = h > 0 ? String(mi).padStart(2, '0') : String(mi);
  return (h > 0 ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

// 从详情页提取播放器各标签页的 embed, 按宿主归类 (保持站内顺序)
function extractEmbeds(html) {
  const out = { vidhide: '', streamcash: '', other: '' };
  const start = html.indexOf('video-player');
  const region = start >= 0 ? html.slice(start, start + 30000) : html;
  const seen = new Set();
  const re = /<iframe[^>]+src="(https?:\/\/[^"]+)"/g;
  let m;
  while ((m = re.exec(region)) !== null) {
    const u = m[1].replace(/&amp;/g, '&');
    if (seen.has(u)) continue;
    seen.add(u);
    let host = '';
    try { host = new URL(u).hostname; } catch (e) { continue; }
    if (host === 'bigbuttshub.top') { if (!out.vidhide) out.vidhide = u; }
    else if (host === 'streamcash.to') { if (!out.streamcash) out.streamcash = u; }
    else if (/bigbuttshub2\.top|bigbuttshubvideos\.com|flyf\.lat|nowplay\.to|porntoday\.ws|playmogo\.com/.test(host)) {
      // 已知未解/被锁宿主: 不生成线路 (嗅探兜底也不用它们, 见 detail 的 other 规则)
    }
    else if (!out.other) out.other = u;
  }
  return out;
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : SITE + '/' + id.replace(/^\//, '');
  const html = await getText(durl);
  if (!html) return { list: [] };

  let name = '';
  const ogM = html.match(/<meta property="og:title" content="([^"]+)"/);
  if (ogM) name = clean(ogM[1]).replace(/\s*<[^>]*Big Butts Hub\s*$/, '').trim();
  if (!name) {
    const titleM = html.match(/<title>([^<]+)<\/title>/);
    if (titleM) name = clean(titleM[1]).replace(/\s*<.*$/, '').trim();
  }
  let pic = '';
  const picM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (picM) pic = fixUrl(picM[1]);
  let content = '';
  const descM = html.match(/<meta property="og:description" content="([^"]+)"/);
  if (descM) content = clean(descM[1]);
  let remarks = '';
  const durM = html.match(/<meta itemprop="duration" content="([^"]+)"/);
  if (durM) remarks = isoDurationToClock(durM[1]);
  const actors = [];
  for (const m of html.matchAll(/href="https:\/\/bigbuttshub\.com\/pornstar\/[^"]+\/" title="([^"]+)"/g)) {
    if (!actors.includes(m[1])) actors.push(clean(m[1]));
  }

  const emb = extractEmbeds(html);
  const fromNames = [];
  const playEntries = [];
  if (emb.vidhide) { fromNames.push('高清'); playEntries.push('正片$w:' + emb.vidhide); }
  if (emb.streamcash) { fromNames.push('直连'); playEntries.push('正片$s:' + emb.streamcash); }
  if (!playEntries.length && emb.other) { fromNames.push('播放'); playEntries.push('正片$x:' + emb.other); }
  if (!playEntries.length) { fromNames.push('播放'); playEntries.push('正片$x:' + durl); }

  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_actor: actors.join(','),
      vod_content: content,
      vod_play_from: fromNames.join('$$$'),
      vod_play_url: playEntries.join('$$$'),
    }],
  };
}

// ---------- 播放 ----------
// vidhide packer 纯字符串解包 (与 Worker 同算法; 仅 Worker 未部署时回退用)
function jsUnescapeSingle(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}
function unpackDeanEdwards(html) {
  const m = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
  if (!m) return '';
  let p = jsUnescapeSingle(m[1]);
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const k = jsUnescapeSingle(m[4]).split('|');
  const enc = (n) => (n < a ? '' : enc(Math.floor(n / a))) + ((n % a) > 35 ? String.fromCharCode((n % a) + 29) : (n % a).toString(36));
  let i = c;
  while (i--) {
    if (k[i]) {
      const word = k[i];
      p = p.replace(new RegExp('\\b' + enc(i) + '\\b', 'g'), () => word);
    }
  }
  return p;
}

// Worker 未部署时的高清线回退: 蜘蛛内解包取 hls4 (相对地址按 embed 域名补全);
// 真机上 token 按蜘蛛出口签发、播放器未必同出口, 不保证能播 —— 部署 Worker 才是正解。
async function resolveVidhideDirect(embedUrl) {
  const html = await getText(embedUrl, { 'Referer': REFERER }, 1000, 10000);
  if (!html) return '';
  const unpacked = unpackDeanEdwards(html);
  const text = unpacked || html;
  const links = {};
  for (const m of text.matchAll(/"hls(\d+)"\s*:\s*"([^"]+)"/g)) links['hls' + m[1]] = m[2];
  for (const key of ['hls4', 'hls3', 'hls2']) {
    const raw = links[key];
    if (!raw) continue;
    try { return new URL(raw, embedUrl).href; } catch (e) { /* 下一个 */ }
  }
  return '';
}

// streamcash 直解: embed 页 __PCr = base64(JSON) → src 即 m3u8
async function resolveStreamcash(embedUrl) {
  const html = await getText(embedUrl, { 'Referer': REFERER }, 500, 10000);
  if (!html) return '';
  const m = html.match(/__PCr\s*=\s*'([A-Za-z0-9+/=]+)'/) || html.match(/__PC\s*=\s*'([A-Za-z0-9+/=]+)'/);
  if (!m) return '';
  try {
    const j = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    const src = t(j && j.src);
    if (src && /\.m3u8(\?|$)/i.test(src)) return src;
  } catch (e) { /* ignore */ }
  return '';
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.startsWith('正片$')) id = id.slice(3);
  if (/\.m3u8(\?|$)/i.test(id) && /^https?:\/\//.test(id)) {
    return { parse: 0, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  const kind = id.slice(0, 2);
  const embed = id.slice(2);
  if (kind === 'w:' && /^https?:\/\//.test(embed)) {
    if (BBH_WORKER) {
      return {
        parse: 0,
        url: BBH_WORKER + '/v?u=' + encodeURIComponent(embed) + '&r=' + encodeURIComponent(REFERER),
        header: { 'User-Agent': UA, 'Referer': REFERER },
      };
    }
    const direct = await resolveVidhideDirect(embed);
    if (direct) return { parse: 0, url: direct, header: { 'User-Agent': UA, 'Referer': embed } };
    return { parse: 1, url: embed, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  if (kind === 's:' && /^https?:\/\//.test(embed)) {
    const src = await resolveStreamcash(embed);
    if (src) return { parse: 0, url: src, header: { 'User-Agent': UA, 'Referer': embed } };
    return { parse: 1, url: embed, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  if (kind === 'x:' && /^https?:\/\//.test(embed)) {
    return { parse: 1, url: embed, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  // 兼容: 直接传了详情页地址 → 现场解析取第一条可用线
  if (/^https?:\/\/bigbuttshub\.com\//.test(id)) {
    const html = await getText(id);
    if (html) {
      const emb = extractEmbeds(html);
      if (emb.vidhide) return play({ body: { id: 'w:' + emb.vidhide } });
      if (emb.streamcash) return play({ body: { id: 's:' + emb.streamcash } });
      if (emb.other) return { parse: 1, url: emb.other, header: { 'User-Agent': UA, 'Referer': REFERER } };
    }
    return { parse: 1, url: id, header: { 'User-Agent': UA, 'Referer': REFERER } };
  }
  return { parse: 0, url: '' };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  let url = SITE + '/?s=' + encodeURIComponent(wd);
  if (page > 1) url += '&paged=' + page;
  const html = await getText(url);
  if (!html) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const list = parseCards(html);
  const nums = [...html.matchAll(/[?&]paged=(\d+)/g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 100000);
  const pc = Math.max(nums.length ? Math.max(...nums) : 0, parsePagecount(html, page), page);
  return { page, pagecount: pc, limit: 20, total: list.length, list };
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
