import req from '../../util/req.js';

// BigButtsHub (py_bigbuttshub) — 品牌名取自站内标题 "Big Butts Hub"
// 站点: https://bigbuttshub.com/ (WordPress 成人聚合站, SSR 直出, 无 CF 拦截)
//
// ===== 2026-10-21 第三轮重构 (针对真机反馈"绝大部分不能播放") =====
// 普查证据 (60 帖全量登记 + 30 帖现行蜘蛛基线 + 逐线实拉):
// 1) 线路提取三宗罪 (已修): 详情页有两种播放器版式——多标签页版式与
//    单播放器版式 (.responsive-player); 单播放器版式的 iframe 多为大写
//    <IFRAME SRC=> 或协议相对 //host 写法, 旧正则 (小写 + 必须 https?://)
//    完全漏检 → 13/60 帖一条线都提不出, 只能嗅探详情页本身; 另有帖子
//    把广告 iframe 误当 "other" 线。现行版基线: 30 帖仅 17 帖有可播线。
// 2) vidhide (.top) 宿主实况: 采样 14 个 embed 经已部署 Worker 实测
//    10 个全链通 (71%); 失败构成: 文件已被宿主删除 (回 426B "File is no
//    longer available" 页) 与只有 hls2/hls3 无 hls4 (两种出口实测均 403,
//    无解)。→ detail 时先抓 embed 页验尸: 已删的线直接不生成; 无 hls4
//    的线降序到末位; 正常线仍走 Worker (bigbuttshub-vidhide, 含分片
//    PNG 伪装头剥离, 第二轮已部署验证, 本轮 Worker 无需改动)。
// 3) bigbuttshub3.top 是同一 vidhide 系统的另一前端 (/embed/{code},
//    页内 packer 同构), Worker 原样可解 → 与 .top 同等对待 (旧版漏收)。
// 4) 新线 Byse (bigbuttshub2.top / bysetayico.com, 覆盖 58/60 帖):
//    SPA 空壳页背后的公开 API GET {origin}/api/videos/{code} 返回视频
//    记录, 内含 AES-256-GCM 加密的 playback 载荷; 密钥由 key_parts 按
//    version 选两段拼成 (v 与 31-v, 1-based), 纯 JS 解密已用真实抓包
//    向量 + WebCrypto 随机对照 44/44 验过。解出的 sources 是带令牌的
//    HLS 直链 (最高 1080p)。注意: 该 API 对机房/代理出口回 403
//    "proxy access is not allowed", 且流令牌绑定铸造方 ASN —— 因此
//    必须由设备侧在 play 时现场铸造 (蜘蛛直调 API + 设备直拉流, 同一
//    出口自洽); VM/Worker 出口均被拒, 此线只能真机定, 失败自动落
//    parse:1 嗅探其 SPA 页 (真浏览器可原生跑)。
// 5) streamcash 改版: embed 页改薄壳 + __PCr base64 配置内含 CDN 直链,
//    新解法已实拉验通; 旧 /pass 铸造保留兜底。占比约 15%。filemoon.art
//    已被域名停放 (跳 parklogic) —— 死线, 不收; playmogo 是 Turnstile,
//    不收; 其余未知宿主 (bigbuttshubvideos.com 等 SPA) 留一条 parse:1
//    备用嗅探线。
// 6) 列表层改走 WP REST (根治"翻不出更多"): HTML 归档分页是坏的——
//    分类 20/页正常, 但标签/演员归档第 1 页 20 条、第 2 页起跳过
//    21-30 号帖 (offset 按 30 算)、真末页之后回 404 填充页或重复末页,
//    分页链接数字也不可信。REST /wp-json/wp/v2/posts 按 taxonomy +
//    term id 分页与站方归档同序 (逐帖比对过), X-WP-TotalPages 权威。
//    封面用 _embedded 特征图的 wpst_thumb_large (640x360); REST 无
//    时长字段, 卡片 vod_remarks 留空 (详情仍有)。REST 不可用时回退
//    HTML 第一页解析 (仅第 1 页, 降级保命)。
// 7) 分类全量重收: wp-json 三个 taxonomy (category/post_tag/actors)
//    count>0 共 915 个逐个实测有帖 (含加回 Adult Time 2 帖 / All Anal
//    3 帖; shedoesanal count=0 已剔除)。n 字段为站方 term id。

const KEY = 'py_bigbuttshub';
const NAME = 'BigButtsHub';
const SITE = 'https://bigbuttshub.com';
const API = SITE + '/wp-json/wp/v2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = SITE + '/';
const PER_PAGE = 24;
// vidhide 全链代理 Worker (第二轮已部署并活体验通; 本轮无需改动)
const BBH_WORKER = 'https://bigbuttshub-vidhide.li768435813.workers.dev';

const CATS = [
  // categories: 226 个 (wp-json count>0, 按帖数降序)
  { type_id: "c_onlyfans", type_name: "OnlyFans", n: 30 }, // 455
  { type_id: "c_bangbros", type_name: "BangBros", n: 17 }, // 227
  { type_id: "c_brazzers", type_name: "Brazzers", n: 95 }, // 221
  { type_id: "c_brazzers~brazzersexxtra", type_name: "BrazzersExxtra", n: 108 }, // 175
  { type_id: "c_bangbros~assparade", type_name: "AssParade", n: 18 }, // 124
  { type_id: "c_amateur", type_name: "Amateur", n: 38 }, // 88
  { type_id: "c_jules-jordan", type_name: "Jules Jordan", n: 126 }, // 49
  { type_id: "c_naughty-america", type_name: "Naughty America", n: 84 }, // 44
  { type_id: "c_reality-kings", type_name: "Reality Kings", n: 177 }, // 33
  { type_id: "c_mylf", type_name: "Mylf", n: 117 }, // 28
  { type_id: "c_team-skeet", type_name: "Team Skeet", n: 103 }, // 25
  { type_id: "c_thepovgod", type_name: "ThePOVGod", n: 660 }, // 25
  { type_id: "c_reality-kings~rkprime", type_name: "RKPrime", n: 178 }, // 23
  { type_id: "c_bangbros~bigtitsroundasses", type_name: "BigTitsRoundAsses", n: 90 }, // 20
  { type_id: "c_pawged", type_name: "PAWGed", n: 66 }, // 20
  { type_id: "c_brazzers~bigwettbutts", type_name: "BigWettButts", n: 165 }, // 17
  { type_id: "c_pervmom", type_name: "PervMom", n: 259 }, // 17
  { type_id: "c_evil-angel", type_name: "Evil Angel", n: 137 }, // 15
  { type_id: "c_mr-lucky-pov", type_name: "Mr Lucky POV", n: 409 }, // 15
  { type_id: "c_bangbros~mydirtymaid", type_name: "MyDirtyMaid", n: 212 }, // 15
  { type_id: "c_nympho", type_name: "Nympho", n: 286 }, // 14
  { type_id: "c_bangbros~public-bang", type_name: "Public Bang", n: 187 }, // 13
  { type_id: "c_freakmobmedia", type_name: "FreakMobMedia", n: 504 }, // 12
  { type_id: "c_hardx", type_name: "HardX", n: 288 }, // 12
  { type_id: "c_bangbros~momishorny", type_name: "MomIsHorny", n: 148 }, // 12
  { type_id: "c_aletta-ocean-live", type_name: "Aletta Ocean LIVE", n: 194 }, // 11
  { type_id: "c_my-pervy-family", type_name: "My Pervy Family", n: 204 }, // 11
  { type_id: "c_bang", type_name: "Bang", n: 336 }, // 10
  { type_id: "c_filthy-kings", type_name: "Filthy Kings", n: 374 }, // 10
  { type_id: "c_bangbros~bangbrosclips", type_name: "BangbrosClips", n: 248 }, // 9
  { type_id: "c_bangbros~bigtitcreampie", type_name: "BigTitCreampie", n: 224 }, // 9
  { type_id: "c_miss-lexa", type_name: "Miss Lexa", n: 42 }, // 9
  { type_id: "c_naughty-america~myfriendshotmom", type_name: "MyFriendsHotMom", n: 155 }, // 9
  { type_id: "c_yinyleon", type_name: "YinyLeon", n: 28 }, // 9
  { type_id: "c_anal-only", type_name: "Anal Only", n: 140 }, // 8
  { type_id: "c_bangbros~bangpov", type_name: "BangPOV", n: 276 }, // 8
  { type_id: "c_brazzers~bigbuttslikeitbig", type_name: "BigButtsLikeItBig", n: 207 }, // 8
  { type_id: "c_mylf~milfbody", type_name: "MILFBody", n: 236 }, // 8
  { type_id: "c_team-skeet~teen-curves", type_name: "Teen Curves", n: 190 }, // 8
  { type_id: "c_naughty-america~tonights-girlfriend", type_name: "Tonight's Girlfriend", n: 85 }, // 8
  { type_id: "c_deeper", type_name: "Deeper", n: 52 }, // 7
  { type_id: "c_true-anal", type_name: "True Anal", n: 63 }, // 7
  { type_id: "c_tushy", type_name: "Tushy", n: 238 }, // 7
  { type_id: "c_bratty-milf", type_name: "Bratty MILF", n: 438 }, // 6
  { type_id: "c_manyvids", type_name: "ManyVids", n: 511 }, // 6
  { type_id: "c_mofos", type_name: "Mofos", n: 290 }, // 6
  { type_id: "c_penthouse-gold", type_name: "Penthouse Gold", n: 264 }, // 6
  { type_id: "c_brazzers~pornstarslikeitbig", type_name: "PornstarsLikeItBig", n: 220 }, // 6
  { type_id: "c_sexmex", type_name: "Sexmex", n: 124 }, // 6
  { type_id: "c_anal-mom", type_name: "Anal Mom", n: 3 }, // 5
  { type_id: "c_angela-white", type_name: "Angela White", n: 157 }, // 5
  { type_id: "c_blacked-raw", type_name: "Blacked Raw", n: 129 }, // 5
  { type_id: "c_deep-lush", type_name: "Deep Lush", n: 370 }, // 5
  { type_id: "c_brazzers~dirtymasseur", type_name: "DirtyMasseur", n: 257 }, // 5
  { type_id: "c_freeuse-milf", type_name: "Freeuse MILF", n: 335 }, // 5
  { type_id: "c_bangbros~sexselector", type_name: "SexSelector", n: 522 }, // 5
  { type_id: "c_familytherapy", type_name: "FamilyTherapy", n: 39 }, // 4
  { type_id: "c_fill-up-my-mom", type_name: "Fill Up My Mom", n: 542 }, // 4
  { type_id: "c_filthy-pov", type_name: "Filthy POV", n: 233 }, // 4
  { type_id: "c_mylf~got-mylf", type_name: "Got Mylf", n: 520 }, // 4
  { type_id: "c_her-limit", type_name: "Her Limit", n: 576 }, // 4
  { type_id: "c_hot-girls-raw", type_name: "Hot Girls Raw", n: 636 }, // 4
  { type_id: "c_mia-malkova", type_name: "Mia Malkova", n: 62 }, // 4
  { type_id: "c_naughty-america~mysistershotfriend", type_name: "MySistersHotfriend", n: 377 }, // 4
  { type_id: "c_rickys-room", type_name: "Rickys Room", n: 574 }, // 4
  { type_id: "c_tushy-raw", type_name: "Tushy Raw", n: 153 }, // 4
  { type_id: "c_all-anal", type_name: "All Anal", n: 173 }, // 3
  { type_id: "c_bangbros~bangbros18", type_name: "BangBros18", n: 533 }, // 3
  { type_id: "c_blakced", type_name: "Blacked", n: 329 }, // 3
  { type_id: "c_blondie-fesser", type_name: "Blondie Fesser", n: 91 }, // 3
  { type_id: "c_dad-crush", type_name: "Dad Crush", n: 381 }, // 3
  { type_id: "c_brazzers~daywithapornstar", type_name: "DayWithAPornstar", n: 461 }, // 3
  { type_id: "c_naughty-america~dirtywivesclub", type_name: "DirtyWivesClub", n: 361 }, // 3
  { type_id: "c_hotwifexxx", type_name: "HotwifeXXX", n: 284 }, // 3
  { type_id: "c_houseofrye", type_name: "HouseOFrye", n: 170 }, // 3
  { type_id: "c_mofos~letspostit", type_name: "LetsPostIt", n: 518 }, // 3
  { type_id: "c_mylf~milfty", type_name: "Milfty", n: 356 }, // 3
  { type_id: "c_naughty-america~my-wifes-hot-friend", type_name: "My Wife's Hot Friend", n: 296 }, // 3
  { type_id: "c_mylf~mylfofthemonth", type_name: "MylfOfTheMonth", n: 549 }, // 3
  { type_id: "c_mylf~mylfxmisslexa", type_name: "MylfxMissLexa", n: 118 }, // 3
  { type_id: "c_mylifeinmiami", type_name: "MyLifeInMiami", n: 292 }, // 3
  { type_id: "c_bangbros~pawg", type_name: "PAWG", n: 403 }, // 3
  { type_id: "c_brazzers~realwifestories", type_name: "RealWifeStories", n: 96 }, // 3
  { type_id: "c_vixen", type_name: "Vixen", n: 426 }, // 3
  { type_id: "c_adult-time", type_name: "Adult Time", n: 855 }, // 2
  { type_id: "c_angel-wicky", type_name: "Angel Wicky", n: 134 }, // 2
  { type_id: "c_bratty-sis", type_name: "Bratty Sis", n: 339 }, // 2
  { type_id: "c_crystal-lust", type_name: "Crystal Lust", n: 241 }, // 2
  { type_id: "c_reality-kings~cum-fiesta", type_name: "Cum Fiesta", n: 799 }, // 2
  { type_id: "c_devils-film", type_name: "Devils Film", n: 161 }, // 2
  { type_id: "c_digital-playground", type_name: "Digital Playground", n: 309 }, // 2
  { type_id: "c_elegant-angel", type_name: "Elegant Angel", n: 372 }, // 2
  { type_id: "c_family-strokes", type_name: "Family Strokes", n: 353 }, // 2
  { type_id: "c_familyxxx", type_name: "FamilyXXX", n: 291 }, // 2
  { type_id: "c_filthy-kings~filthy-massage", type_name: "Filthy Massage", n: 375 }, // 2
  { type_id: "c_ddf-network~handsonhardcore", type_name: "HandsOnHardcore", n: 279 }, // 2
  { type_id: "c_naughty-america~ihaveawife", type_name: "IHaveAWife", n: 392 }, // 2
  { type_id: "c_jada-stevens", type_name: "Jada Stevens", n: 11 }, // 2
  { type_id: "c_kelsi-monroe", type_name: "Kelsi Monroe", n: 34 }, // 2
  { type_id: "c_lauren-phillips", type_name: "Lauren Phillips", n: 2 }, // 2
  { type_id: "c_lena-paul", type_name: "Lena Paul", n: 51 }, // 2
  { type_id: "c_life-selector", type_name: "Life Selector", n: 271 }, // 2
  { type_id: "c_luna-star", type_name: "Luna Star", n: 115 }, // 2
  { type_id: "c_team-skeet~messyjessy", type_name: "MessyJessy", n: 473 }, // 2
  { type_id: "c_milfy", type_name: "MILFY", n: 635 }, // 2
  { type_id: "c_mom-comes-first", type_name: "Mom Comes First", n: 439 }, // 2
  { type_id: "c_moms-teach-sex", type_name: "Moms Teach Sex", n: 384 }, // 2
  { type_id: "c_team-skeet~mybabysittersclub", type_name: "MyBabysittersClub", n: 227 }, // 2
  { type_id: "c_naughty-america~mygirlfriendsbustyfriend", type_name: "MyGirlfriendsBustyFriend", n: 616 }, // 2
  { type_id: "c_naughty-america~naughtyoffice", type_name: "NaughtyOffice", n: 214 }, // 2
  { type_id: "c_naughty-america~perfect-fucking-strangers", type_name: "Perfect Fucking Strangers", n: 474 }, // 2
  { type_id: "c_perv-city", type_name: "Perv City", n: 460 }, // 2
  { type_id: "c_povd", type_name: "POVD", n: 349 }, // 2
  { type_id: "c_property-sex", type_name: "Property Sex", n: 347 }, // 2
  { type_id: "c_ryan-conner", type_name: "Ryan Conner", n: 14 }, // 2
  { type_id: "c_sex-mex", type_name: "Sex Mex", n: 87 }, // 2
  { type_id: "c_spizoo", type_name: "Spizoo", n: 380 }, // 2
  { type_id: "c_team-skeet~teenpies", type_name: "TeenPies", n: 104 }, // 2
  { type_id: "c_team-skeet~therealworkout", type_name: "TheRealWorkout", n: 578 }, // 2
  { type_id: "c_touch-my-wife", type_name: "Touch My Wife", n: 654 }, // 2
  { type_id: "c_victoria-june", type_name: "Victoria June", n: 121 }, // 2
  { type_id: "c_violet-myers", type_name: "Violet Myers", n: 182 }, // 2
  { type_id: "c_vivian-taylor", type_name: "Vivian Taylor", n: 16 }, // 2
  { type_id: "c_abella-danger", type_name: "Abella Danger", n: 10 }, // 1
  { type_id: "c_aletta-ocean", type_name: "Aletta Ocean", n: 100 }, // 1
  { type_id: "c_alura-jenson", type_name: "Alura Jenson", n: 162 }, // 1
  { type_id: "c_analized", type_name: "Analized", n: 107 }, // 1
  { type_id: "c_analtherapyxxx", type_name: "AnalTherapyXXX", n: 608 }, // 1
  { type_id: "c_asshole-fever", type_name: "Asshole Fever", n: 250 }, // 1
  { type_id: "c_naughty-america~assmasterpiece", type_name: "AssMasterpiece", n: 612 }, // 1
  { type_id: "c_babes", type_name: "Babes", n: 316 }, // 1
  { type_id: "c_baddies-pov", type_name: "Baddies POV", n: 973 }, // 1
  { type_id: "c_team-skeet~badmilfs", type_name: "BadMilfs", n: 455 }, // 1
  { type_id: "c_bangbros~bang-bus", type_name: "Bang Bus", n: 584 }, // 1
  { type_id: "c_bang~bang-roadside", type_name: "Bang Roadside", n: 337 }, // 1
  { type_id: "c_bbc-pie", type_name: "BBC Pie", n: 577 }, // 1
  { type_id: "c_bffs", type_name: "BFFS", n: 274 }, // 1
  { type_id: "c_brandi-love", type_name: "Brandi Love", n: 127 }, // 1
  { type_id: "c_team-skeet~breeding-material", type_name: "Breeding Material", n: 630 }, // 1
  { type_id: "c_bridgette-b", type_name: "Bridgette B.", n: 138 }, // 1
  { type_id: "c_brooklyn-gray", type_name: "Brooklyn Gray", n: 174 }, // 1
  { type_id: "c_castingcouchhd", type_name: "CastingCouchHD", n: 50 }, // 1
  { type_id: "c_cherry-pimps", type_name: "Cherry Pimps", n: 205 }, // 1
  { type_id: "c_reality-kings~crazy-college-gfs", type_name: "Crazy College GFs", n: 733 }, // 1
  { type_id: "c_cum-4k", type_name: "Cum 4K", n: 333 }, // 1
  { type_id: "c_bangbros~dads-love-porn", type_name: "Dad's Love Porn", n: 652 }, // 1
  { type_id: "c_dani-daniels", type_name: "Dani Daniels", n: 60 }, // 1
  { type_id: "c_darkx", type_name: "DarkX", n: 650 }, // 1
  { type_id: "c_ddf-network", type_name: "DDF Network", n: 278 }, // 1
  { type_id: "c_dick-drainers", type_name: "Dick Drainers", n: 93 }, // 1
  { type_id: "c_dirty-auditions", type_name: "Dirty Auditions", n: 865 }, // 1
  { type_id: "c_elegant-raw", type_name: "Elegant Raw", n: 225 }, // 1
  { type_id: "c_emily-addison", type_name: "Emily Addison", n: 113 }, // 1
  { type_id: "c_erotic-spice", type_name: "Erotic Spice", n: 365 }, // 1
  { type_id: "c_team-skeet~exxxtrasmall", type_name: "ExxxtraSmall", n: 338 }, // 1
  { type_id: "c_got-filled", type_name: "Got Filled", n: 445 }, // 1
  { type_id: "c_mofos~hes-got-rizz", type_name: "He's Got Rizz", n: 968 }, // 1
  { type_id: "c_mylf~hijab-mylfs", type_name: "Hijab Mylfs", n: 647 }, // 1
  { type_id: "c_holed", type_name: "Holed", n: 302 }, // 1
  { type_id: "c_brazzers~hotandmean", type_name: "HotAndMean", n: 305 }, // 1
  { type_id: "c_mofos~i-know-that-girl", type_name: "I Know That Girl", n: 575 }, // 1
  { type_id: "c_team-skeet~imadeporn", type_name: "IMadePorn", n: 240 }, // 1
  { type_id: "c_joslyn-james", type_name: "Joslyn James", n: 4 }, // 1
  { type_id: "c_julie-cash", type_name: "Julie Cash", n: 109 }, // 1
  { type_id: "c_kelsi-monroe-xxx", type_name: "Kelsi Monroe XXX", n: 401 }, // 1
  { type_id: "c_kyra-hot", type_name: "Kyra Hot", n: 53 }, // 1
  { type_id: "c_lethal-hardcore", type_name: "Lethal Hardcore", n: 223 }, // 1
  { type_id: "c_lilly-hall", type_name: "Lilly Hall", n: 40 }, // 1
  { type_id: "c_lily-lane", type_name: "Lily Lane", n: 80 }, // 1
  { type_id: "c_reality-kings~look-at-her-now", type_name: "Look At Her Now", n: 804 }, // 1
  { type_id: "c_reality-kings~milf-hunter", type_name: "MILF Hunter", n: 581 }, // 1
  { type_id: "c_milf-overload", type_name: "MILF Overload", n: 646 }, // 1
  { type_id: "c_brazzers~milfslikeitbig", type_name: "MilfsLikeItBig", n: 307 }, // 1
  { type_id: "c_mylf~mom-drips", type_name: "Mom Drips", n: 600 }, // 1
  { type_id: "c_moms-tight", type_name: "Moms Tight", n: 617 }, // 1
  { type_id: "c_mona-azar", type_name: "Mona Azar", n: 130 }, // 1
  { type_id: "c_reality-kings~monster-curves", type_name: "Monster Curves", n: 420 }, // 1
  { type_id: "c_bangbros~monstersofcock", type_name: "MonstersOfCock", n: 643 }, // 1
  { type_id: "c_mr-lucky-raw", type_name: "Mr Lucky Raw", n: 563 }, // 1
  { type_id: "c_bangbros~mranal", type_name: "MrAnal", n: 396 }, // 1
  { type_id: "c_naughty-america~my-naughty-massage", type_name: "My Naughty Massage", n: 785 }, // 1
  { type_id: "c_naughty-america~mydadshotgirlfriend", type_name: "MyDadsHotGirlfriend", n: 622 }, // 1
  { type_id: "c_naughty-america~mydaughtershotfriend", type_name: "MyDaughtersHotFriend", n: 640 }, // 1
  { type_id: "c_mylf~mylf-labs", type_name: "Mylf Labs", n: 300 }, // 1
  { type_id: "c_naughty-america~naughtyathletics", type_name: "NaughtyAthletics", n: 537 }, // 1
  { type_id: "c_naughty-america~neighboraffair", type_name: "NeighborAffair", n: 546 }, // 1
  { type_id: "c_new-sensations", type_name: "New Sensations", n: 283 }, // 1
  { type_id: "c_oops-family", type_name: "Oops Family", n: 954 }, // 1
  { type_id: "c_pamela-rios", type_name: "Pamela Rios", n: 88 }, // 1
  { type_id: "c_payton-preslee", type_name: "Payton Preslee", n: 83 }, // 1
  { type_id: "c_perv-mom", type_name: "Perv Mom", n: 112 }, // 1
  { type_id: "c_perv-principal", type_name: "Perv Principal", n: 596 }, // 1
  { type_id: "c_phoenix-marie", type_name: "Phoenix Marie", n: 97 }, // 1
  { type_id: "c_porn-dude-casting", type_name: "Porn Dude Casting", n: 230 }, // 1
  { type_id: "c_porn-force", type_name: "Porn Force", n: 331 }, // 1
  { type_id: "c_bangbros~pornstar-spa", type_name: "PornStar Spa", n: 477 }, // 1
  { type_id: "c_pov-masters", type_name: "POV Masters", n: 953 }, // 1
  { type_id: "c_team-skeet~povlife", type_name: "POVLife", n: 601 }, // 1
  { type_id: "c_private", type_name: "Private", n: 495 }, // 1
  { type_id: "c_pure-mature", type_name: "Pure Mature", n: 344 }, // 1
  { type_id: "c_rachel-starr", type_name: "Rachel Starr", n: 168 }, // 1
  { type_id: "c_rose-monroe", type_name: "Rose Monroe", n: 35 }, // 1
  { type_id: "c_naughty-america~seducedbyacougar", type_name: "SeducedByACougar", n: 256 }, // 1
  { type_id: "c_shoplyfter-mylf", type_name: "Shoplyfter MYLF", n: 216 }, // 1
  { type_id: "c_simplyanal", type_name: "SimplyAnal", n: 567 }, // 1
  { type_id: "c_siri-dahl", type_name: "Siri Dahl", n: 132 }, // 1
  { type_id: "c_reality-kings~sneakysex", type_name: "SneakySex", n: 541 }, // 1
  { type_id: "c_spank-monster", type_name: "Spank Monster", n: 243 }, // 1
  { type_id: "c_mylf~stay-home-milf", type_name: "Stay Home MILF", n: 391 }, // 1
  { type_id: "c_stuck-4k", type_name: "Stuck 4K", n: 294 }, // 1
  { type_id: "c_susy-gala", type_name: "Susy Gala", n: 142 }, // 1
  { type_id: "c_sybil-stallone", type_name: "Sybil Stallone", n: 149 }, // 1
  { type_id: "c_taboo-heat", type_name: "Taboo Heat", n: 313 }, // 1
  { type_id: "c_team-skeet~teamskeet-labs", type_name: "TeamSkeet Labs", n: 681 }, // 1
  { type_id: "c_teen-fidelity", type_name: "Teen Fidelity", n: 368 }, // 1
  { type_id: "c_team-skeet~teens-do-porn", type_name: "Teens Do Porn", n: 385 }, // 1
  { type_id: "c_reality-kings~teens-love-huge-cocks", type_name: "Teens Love Huge Cocks", n: 627 }, // 1
  { type_id: "c_brazzers~teenslikeitbig", type_name: "TeensLikeItBig", n: 280 }, // 1
  { type_id: "c_the-white-boxxx", type_name: "The White Boxxx", n: 425 }, // 1
  { type_id: "c_team-skeet~theloft", type_name: "TheLoft", n: 521 }, // 1
  { type_id: "c_naughty-america~thundercock", type_name: "Thundercock", n: 927 }, // 1
  { type_id: "c_tough-love-x", type_name: "Tough Love X", n: 231 }, // 1
  { type_id: "c_mylf~usepov", type_name: "UsePOV", n: 482 }, // 1
  { type_id: "c_reality-kings~work-me-harder", type_name: "Work Me Harder", n: 534 }, // 1
  { type_id: "c_reality-kings~workmeharder", type_name: "WorkMeHarder", n: 589 }, // 1
  { type_id: "c_brazzers~zz-series", type_name: "ZZ Series", n: 857 }, // 1
  // tags: 260 个 (wp-json count>0, 按帖数降序)
  { type_id: "t_curvy", type_name: "Curvy", n: 8 }, // 1219
  { type_id: "t_bubble-butt", type_name: "Bubble Butt", n: 65 }, // 1110
  { type_id: "t_big-tits", type_name: "Big Tits", n: 7 }, // 999
  { type_id: "t_pawg", type_name: "PAWG", n: 22 }, // 994
  { type_id: "t_thick", type_name: "Thick", n: 20 }, // 973
  { type_id: "t_milf", type_name: "MILF", n: 6 }, // 908
  { type_id: "t_rough-sex", type_name: "Rough Sex", n: 46 }, // 904
  { type_id: "t_phat-ass", type_name: "Phat Ass", n: 206 }, // 869
  { type_id: "t_brunette", type_name: "Brunette", n: 188 }, // 726
  { type_id: "t_fit-ass", type_name: "Fit Ass", n: 469 }, // 637
  { type_id: "t_teen", type_name: "Teen", n: 57 }, // 584
  { type_id: "t_blonde", type_name: "Blonde", n: 54 }, // 577
  { type_id: "t_oil", type_name: "Oil", n: 19 }, // 481
  { type_id: "t_big-booty-onlyfans", type_name: "Big Booty OnlyFans", n: 746 }, // 444
  { type_id: "t_facial", type_name: "Facial", n: 21 }, // 436
  { type_id: "t_pov", type_name: "POV", n: 26 }, // 422
  { type_id: "t_interracial", type_name: "Interracial", n: 15 }, // 404
  { type_id: "t_latina", type_name: "Latina", n: 144 }, // 396
  { type_id: "t_anal", type_name: "Anal", n: 12 }, // 320
  { type_id: "t_blowjob", type_name: "Blowjob", n: 151 }, // 233
  { type_id: "t_doggystyle", type_name: "Doggystyle", n: 797 }, // 220
  { type_id: "t_rim-job", type_name: "Rim Job", n: 175 }, // 212
  { type_id: "t_booty-jiggle", type_name: "Booty Jiggle", n: 823 }, // 198
  { type_id: "t_cheating", type_name: "Cheating", n: 209 }, // 193
  { type_id: "t_missionary", type_name: "Missionary", n: 796 }, // 191
  { type_id: "t_cowgirl", type_name: "Cowgirl", n: 795 }, // 184
  { type_id: "t_reverse-cowgirl", type_name: "Reverse-Cowgirl", n: 819 }, // 182
  { type_id: "t_threesome", type_name: "Threesome", n: 33 }, // 173
  { type_id: "t_tattoo", type_name: "Tattoo", n: 359 }, // 158
  { type_id: "t_ass-worship", type_name: "Ass Worship", n: 810 }, // 155
  { type_id: "t_huge-booty", type_name: "Huge Booty", n: 729 }, // 143
  { type_id: "t_sneaky-sex", type_name: "Sneaky Sex", n: 222 }, // 140
  { type_id: "t_creampie", type_name: "Creampie", n: 105 }, // 129
  { type_id: "t_hardcore", type_name: "Hardcore", n: 848 }, // 127
  { type_id: "t_fishnets", type_name: "Fishnets", n: 13 }, // 118
  { type_id: "t_yoga-pants", type_name: "Yoga Pants", n: 318 }, // 113
  { type_id: "t_deepthroat", type_name: "Deepthroat", n: 805 }, // 107
  { type_id: "t_workout", type_name: "Workout", n: 9 }, // 101
  { type_id: "t_stepmom", type_name: "Stepmom", n: 81 }, // 94
  { type_id: "t_wife", type_name: "Wife", n: 98 }, // 82
  { type_id: "t_public", type_name: "Public", n: 76 }, // 77
  { type_id: "t_bbw", type_name: "BBW", n: 110 }, // 73
  { type_id: "t_massage", type_name: "Massage", n: 258 }, // 59
  { type_id: "t_gape", type_name: "Gape", n: 354 }, // 53
  { type_id: "t_red-head", type_name: "Red Head", n: 152 }, // 35
  { type_id: "t_stepsister", type_name: "Stepsister", n: 102 }, // 35
  { type_id: "t_round-butt", type_name: "Round Butt", n: 842 }, // 33
  { type_id: "t_butt-plug", type_name: "Butt Plug", n: 327 }, // 30
  { type_id: "t_bbc", type_name: "BBC", n: 841 }, // 28
  { type_id: "t_ffm-threesome", type_name: "FFM Threesome", n: 825 }, // 25
  { type_id: "t_twerking", type_name: "Twerking", n: 789 }, // 24
  { type_id: "t_anal-creampie", type_name: "Anal Creampie", n: 320 }, // 22
  { type_id: "t_maid", type_name: "Maid", n: 211 }, // 22
  { type_id: "t_big-booty-lissa-aires", type_name: "Big Booty Lissa Aires", n: 679 }, // 20
  { type_id: "t_ebony", type_name: "Ebony", n: 166 }, // 20
  { type_id: "t_squirt", type_name: "Squirt", n: 135 }, // 20
  { type_id: "t_big-booty-jenna-starr", type_name: "Big Booty Jenna Starr", n: 736 }, // 17
  { type_id: "t_big-booty-the-official-egypt", type_name: "Big Booty The Official Egypt", n: 698 }, // 16
  { type_id: "t_outdoor", type_name: "Outdoor", n: 311 }, // 16
  { type_id: "t_big-booty-brandylicious", type_name: "Big Booty Brandylicious", n: 689 }, // 15
  { type_id: "t_double-blowjob", type_name: "Double Blowjob", n: 832 }, // 13
  { type_id: "t_stepdaughter", type_name: "Stepdaughter", n: 324 }, // 13
  { type_id: "t_freeuse", type_name: "Freeuse", n: 67 }, // 12
  { type_id: "t_office-sex", type_name: "Office Sex", n: 215 }, // 11
  { type_id: "t_pawg-auhneesh-nicole", type_name: "PAWG Auhneesh Nicole", n: 687 }, // 11
  { type_id: "t_sideways-fucking", type_name: "Sideways Fucking", n: 846 }, // 11
  { type_id: "t_face-fucking", type_name: "Face Fucking", n: 817 }, // 10
  { type_id: "t_lesbian", type_name: "Lesbian", n: 158 }, // 10
  { type_id: "t_big-booty-kaden-kole", type_name: "Big Booty Kaden Kole", n: 728 }, // 9
  { type_id: "t_big-booty-karmen-karma", type_name: "Big Booty Karmen Karma", n: 759 }, // 9
  { type_id: "t_big-booty-luna-star", type_name: "Big Booty Luna Star", n: 688 }, // 9
  { type_id: "t_big-booty-maria-gjieli", type_name: "Big Booty Maria Gjieli", n: 769 }, // 9
  { type_id: "t_big-booty-abigaiil-morris", type_name: "Big Booty Abigaiil Morris", n: 755 }, // 8
  { type_id: "t_big-booty-sara-retali", type_name: "Big Booty Sara Retali", n: 721 }, // 8
  { type_id: "t_spanking-ass", type_name: "Spanking Ass", n: 828 }, // 8
  { type_id: "t_big-booty-graciebon", type_name: "Big Booty GracieBon", n: 696 }, // 7
  { type_id: "t_big-booty-raven-thick", type_name: "Big Booty Raven Thick", n: 811 }, // 7
  { type_id: "t_big-booty-violet-myers", type_name: "Big Booty Violet Myers", n: 737 }, // 7
  { type_id: "t_cum-on-ass", type_name: "Cum on Ass", n: 821 }, // 7
  { type_id: "t_cumshot", type_name: "Cumshot", n: 816 }, // 7
  { type_id: "t_cunnilingus", type_name: "Cunnilingus", n: 844 }, // 7
  { type_id: "t_big-booty-brandy-salazar", type_name: "Big Booty Brandy Salazar", n: 839 }, // 6
  { type_id: "t_big-booty-gracie-bon", type_name: "Big Booty Gracie Bon", n: 836 }, // 6
  { type_id: "t_big-booty-katalina-kyle", type_name: "Big Booty Katalina Kyle", n: 726 }, // 6
  { type_id: "t_big-booty-madison-moores", type_name: "Big Booty Madison Moores", n: 776 }, // 6
  { type_id: "t_big-booty-mandy-muse", type_name: "Big Booty Mandy Muse", n: 673 }, // 6
  { type_id: "t_big-booty-vivian-taylor", type_name: "Big Booty Vivian Taylor", n: 831 }, // 6
  { type_id: "t_prone-bone", type_name: "Prone Bone", n: 820 }, // 6
  { type_id: "t_backshots", type_name: "Backshots", n: 867 }, // 5
  { type_id: "t_big-booty-andie-anderson", type_name: "Big Booty Andie Anderson", n: 672 }, // 5
  { type_id: "t_big-booty-kali-roses", type_name: "Big Booty Kali Roses", n: 760 }, // 5
  { type_id: "t_big-booty-kayley-gunner", type_name: "Big Booty Kayley Gunner", n: 784 }, // 5
  { type_id: "t_big-booty-lacey-jayne", type_name: "Big Booty Lacey Jayne", n: 727 }, // 5
  { type_id: "t_big-booty-lila-hayes", type_name: "Big Booty Lila Hayes", n: 751 }, // 5
  { type_id: "t_big-booty-mz-dani", type_name: "Big Booty Mz Dani", n: 774 }, // 5
  { type_id: "t_big-booty-slimthick-vic", type_name: "Big Booty Slimthick Vic", n: 777 }, // 5
  { type_id: "t_big-booty-vanessa-bohorquez", type_name: "Big Booty Vanessa Bohorquez", n: 722 }, // 5
  { type_id: "t_big-booty-vitoria-beatriz", type_name: "Big Booty Vitoria Beatriz", n: 670 }, // 5
  { type_id: "t_big-booty-willow-ryder", type_name: "Big Booty Willow Ryder", n: 758 }, // 5
  { type_id: "t_nurse", type_name: "Nurse", n: 261 }, // 5
  { type_id: "t_perfect-ass", type_name: "perfect ass", n: 79 }, // 5
  { type_id: "t_standing-sex", type_name: "Standing Sex", n: 875 }, // 5
  { type_id: "t_anal-play", type_name: "Anal Play", n: 853 }, // 4
  { type_id: "t_big-booty-angela-white", type_name: "Big Booty Angela White", n: 847 }, // 4
  { type_id: "t_big-booty-anissa-miller", type_name: "Big Booty Anissa Miller", n: 900 }, // 4
  { type_id: "t_big-booty-cassie-lenoir", type_name: "Big Booty Cassie Lenoir", n: 809 }, // 4
  { type_id: "t_big-booty-isabelle-eleanore", type_name: "Big Booty Isabelle Eleanore", n: 750 }, // 4
  { type_id: "t_big-booty-richelle-ryan", type_name: "Big Booty Richelle Ryan", n: 761 }, // 4
  { type_id: "t_spanking", type_name: "Spanking", n: 806 }, // 4
  { type_id: "t_tit-job", type_name: "Tit-Job", n: 882 }, // 4
  { type_id: "t_big-booty-alanna-pow", type_name: "Big Booty Alanna Pow", n: 938 }, // 3
  { type_id: "t_big-booty-anais-amore", type_name: "Big Booty Anais Amore", n: 753 }, // 3
  { type_id: "t_big-booty-candy-love", type_name: "Big Booty Candy Love", n: 818 }, // 3
  { type_id: "t_big-booty-hayley-davies", type_name: "Big Booty Hayley Davies", n: 730 }, // 3
  { type_id: "t_big-booty-juanita-belle", type_name: "Big Booty Juanita Belle", n: 786 }, // 3
  { type_id: "t_big-booty-ms-sethi", type_name: "Big Booty Ms Sethi", n: 962 }, // 3
  { type_id: "t_big-booty-nia-bleu", type_name: "Big Booty Nia Bleu", n: 920 }, // 3
  { type_id: "t_big-booty-payton-preslee", type_name: "Big Booty Payton Preslee", n: 669 }, // 3
  { type_id: "t_big-booty-raissa-bellini", type_name: "Big Booty Raissa Bellini", n: 930 }, // 3
  { type_id: "t_big-booty-roxanne-roselle", type_name: "Big Booty Roxanne Roselle", n: 889 }, // 3
  { type_id: "t_big-booty-tommy-king", type_name: "Big Booty Tommy King", n: 739 }, // 3
  { type_id: "t_domination", type_name: "Domination", n: 782 }, // 3
  { type_id: "t_double-penetration", type_name: "Double Penetration", n: 314 }, // 3
  { type_id: "t_hotwife", type_name: "Hotwife", n: 655 }, // 3
  { type_id: "t_step-family", type_name: "Step Family", n: 364 }, // 3
  { type_id: "t_stockings", type_name: "Stockings", n: 801 }, // 3
  { type_id: "t_teacher", type_name: "Teacher", n: 266 }, // 3
  { type_id: "t_throatpie", type_name: "Throatpie", n: 937 }, // 3
  { type_id: "t_asian", type_name: "Asian", n: 340 }, // 2
  { type_id: "t_auhneesh-nicole", type_name: "Auhneesh Nicole", n: 667 }, // 2
  { type_id: "t_bdsm", type_name: "BDSM", n: 757 }, // 2
  { type_id: "t_big-booty-chloe-rannoch", type_name: "Big Booty Chloe Rannoch", n: 903 }, // 2
  { type_id: "t_big-booty-comatozze", type_name: "Big Booty Comatozze", n: 914 }, // 2
  { type_id: "t_big-booty-gigi-lysette", type_name: "Big Booty Gigi Lysette", n: 955 }, // 2
  { type_id: "t_big-booty-giuliana-cabrazia", type_name: "Big Booty Giuliana Cabrazia", n: 866 }, // 2
  { type_id: "t_big-booty-jakara-mitchell", type_name: "Big Booty Jakara Mitchell", n: 778 }, // 2
  { type_id: "t_big-booty-karol-rosado", type_name: "Big Booty Karol Rosado", n: 724 }, // 2
  { type_id: "t_big-booty-katty-soarez", type_name: "Big Booty Katty Soarez", n: 793 }, // 2
  { type_id: "t_big-booty-kelsey-kane", type_name: "Big Booty Kelsey Kane", n: 682 }, // 2
  { type_id: "t_big-booty-kristy-black", type_name: "Big Booty Kristy Black", n: 843 }, // 2
  { type_id: "t_big-booty-la-paisita-oficial", type_name: "Big Booty La Paisita Oficial", n: 858 }, // 2
  { type_id: "t_big-booty-lexis-star", type_name: "Big Booty Lexis Star", n: 942 }, // 2
  { type_id: "t_big-booty-lily-phillips", type_name: "Big Booty Lily Phillips", n: 874 }, // 2
  { type_id: "t_big-booty-madison-morgan", type_name: "Big Booty Madison Morgan", n: 808 }, // 2
  { type_id: "t_big-booty-mellanie-monroe", type_name: "Big Booty Mellanie Monroe", n: 911 }, // 2
  { type_id: "t_big-booty-mia-malkova", type_name: "Big Booty Mia Malkova", n: 744 }, // 2
  { type_id: "t_big-booty-miss-boddy", type_name: "Big Booty Miss Boddy", n: 791 }, // 2
  { type_id: "t_big-booty-miss-korinne", type_name: "Big Booty Miss Korinne", n: 690 }, // 2
  { type_id: "t_big-booty-okichloeo", type_name: "Big Booty Okichloeo", n: 902 }, // 2
  { type_id: "t_big-booty-ryan-conner", type_name: "Big Booty Ryan Conner", n: 924 }, // 2
  { type_id: "t_big-booty-savannah-bond", type_name: "Big Booty Savannah Bond", n: 671 }, // 2
  { type_id: "t_big-booty-sinatra-monroe", type_name: "Big Booty Sinatra Monroe", n: 731 }, // 2
  { type_id: "t_big-booty-summer-brookes", type_name: "Big Booty Summer Brookes", n: 770 }, // 2
  { type_id: "t_big-booty-toochi-kash", type_name: "Big Booty Toochi Kash", n: 781 }, // 2
  { type_id: "t_big-booty-vanna-rose", type_name: "Big Booty Vanna Rose", n: 946 }, // 2
  { type_id: "t_big-booty-zoey-uso", type_name: "Big Booty Zoey Uso", n: 944 }, // 2
  { type_id: "t_bikini", type_name: "Bikini", n: 845 }, // 2
  { type_id: "t_breeding", type_name: "Breeding", n: 850 }, // 2
  { type_id: "t_car-sex", type_name: "Car Sex", n: 880 }, // 2
  { type_id: "t_cosplay", type_name: "Cosplay", n: 676 }, // 2
  { type_id: "t_cuckold", type_name: "Cuckold", n: 362 }, // 2
  { type_id: "t_cum-swallow", type_name: "Cum Swallow", n: 878 }, // 2
  { type_id: "t_cum-swap", type_name: "Cum Swap", n: 838 }, // 2
  { type_id: "t_doctor", type_name: "Doctor", n: 517 }, // 2
  { type_id: "t_face-sitting", type_name: "Face Sitting", n: 856 }, // 2
  { type_id: "t_ffm", type_name: "FFM", n: 826 }, // 2
  { type_id: "t_foursome", type_name: "Foursome", n: 675 }, // 2
  { type_id: "t_gracie-bon", type_name: "Gracie Bon", n: 668 }, // 2
  { type_id: "t_indian", type_name: "Indian", n: 963 }, // 2
  { type_id: "t_onlyfans", type_name: "OnlyFans", n: 697 }, // 2
  { type_id: "t_poolside-sex", type_name: "Poolside Sex", n: 837 }, // 2
  { type_id: "t_sex-at-work", type_name: "Sex At Work", n: 807 }, // 2
  { type_id: "t_anal-fingering", type_name: "Anal Fingering", n: 887 }, // 1
  { type_id: "t_ass-to-mouth", type_name: "Ass To Mouth", n: 840 }, // 1
  { type_id: "t_big-ass", type_name: "Big Ass", n: 5 }, // 1
  { type_id: "t_big-booty-6ft-phenomenon", type_name: "Big Booty 6ft Phenomenon", n: 974 }, // 1
  { type_id: "t_big-booty-abby-rose", type_name: "Big Booty Abby Rose", n: 779 }, // 1
  { type_id: "t_big-booty-aletta-ocean", type_name: "Big Booty Aletta Ocean", n: 935 }, // 1
  { type_id: "t_big-booty-alexa-payne", type_name: "Big Booty Alexa Payne", n: 895 }, // 1
  { type_id: "t_big-booty-alice-thunder", type_name: "Big Booty Alice Thunder", n: 772 }, // 1
  { type_id: "t_big-booty-ashley-barbie", type_name: "Big Booty Ashley Barbie", n: 869 }, // 1
  { type_id: "t_big-booty-atlanta-moreno", type_name: "Big Booty Atlanta Moreno", n: 928 }, // 1
  { type_id: "t_big-booty-ava-nicks", type_name: "Big Booty Ava Nicks", n: 958 }, // 1
  { type_id: "t_big-booty-bella-rolland", type_name: "Big Booty Bella Rolland", n: 771 }, // 1
  { type_id: "t_big-booty-caryn-beaumont", type_name: "Big Booty Caryn Beaumont", n: 756 }, // 1
  { type_id: "t_big-booty-cassie-lenior", type_name: "Big Booty Cassie Lenior", n: 742 }, // 1
  { type_id: "t_big-booty-cassie-solis", type_name: "Big Booty Cassie Solis", n: 925 }, // 1
  { type_id: "t_big-booty-connie-perignon", type_name: "Big Booty Connie Perignon", n: 686 }, // 1
  { type_id: "t_big-booty-crystal-lust", type_name: "Big Booty Crystal Lust", n: 815 }, // 1
  { type_id: "t_big-booty-elana-bunnz", type_name: "Big Booty Elana Bunnz", n: 933 }, // 1
  { type_id: "t_big-booty-emily-rinaudo", type_name: "Big Booty Emily Rinaudo", n: 885 }, // 1
  { type_id: "t_big-booty-emma-magnolia", type_name: "Big Booty Emma Magnolia", n: 803 }, // 1
  { type_id: "t_big-booty-gem-jewels", type_name: "Big Booty Gem Jewels", n: 957 }, // 1
  { type_id: "t_big-booty-hailey-rose", type_name: "Big Booty Hailey Rose", n: 931 }, // 1
  { type_id: "t_big-booty-holly-brougham", type_name: "Big Booty Holly Brougham", n: 748 }, // 1
  { type_id: "t_big-booty-indianara-jung", type_name: "Big Booty Indianara Jung", n: 852 }, // 1
  { type_id: "t_big-booty-jacqueline-valentine", type_name: "Big Booty Jacqueline Valentine", n: 788 }, // 1
  { type_id: "t_big-booty-jada-stevens", type_name: "Big Booty Jada Stevens", n: 921 }, // 1
  { type_id: "t_big-booty-jessie-rogers", type_name: "Big Booty Jessie Rogers", n: 909 }, // 1
  { type_id: "t_big-booty-jocessita", type_name: "Big Booty Jocessita", n: 683 }, // 1
  { type_id: "t_big-booty-krystal-kakes", type_name: "Big Booty Krystal Kakes", n: 940 }, // 1
  { type_id: "t_big-booty-lorena-lorado", type_name: "Big Booty Lorena Lorado", n: 813 }, // 1
  { type_id: "t_big-booty-lucky-kay", type_name: "Big Booty Lucky Kay", n: 969 }, // 1
  { type_id: "t_big-booty-lucy-lotus", type_name: "Big Booty Lucy Lotus", n: 830 }, // 1
  { type_id: "t_big-booty-luna-angel", type_name: "Big Booty Luna Angel", n: 922 }, // 1
  { type_id: "t_big-booty-madison-ivy", type_name: "Big Booty Madison Ivy", n: 912 }, // 1
  { type_id: "t_big-booty-maevaa-sinaloa", type_name: "Big Booty Maevaa Sinaloa", n: 976 }, // 1
  { type_id: "t_big-booty-maria-bolona", type_name: "Big Booty Maria Bolona", n: 948 }, // 1
  { type_id: "t_big-booty-martina-smeraldi", type_name: "Big Booty Martina Smeraldi", n: 936 }, // 1
  { type_id: "t_big-booty-martinpaola", type_name: "Big Booty MartinPaola", n: 910 }, // 1
  { type_id: "t_big-booty-melissa-stratton", type_name: "Big Booty Melissa Stratton", n: 775 }, // 1
  { type_id: "t_big-booty-melztube", type_name: "Big Booty Melztube", n: 734 }, // 1
  { type_id: "t_big-booty-mia-monroe", type_name: "Big Booty Mia Monroe", n: 916 }, // 1
  { type_id: "t_big-booty-mona-azar", type_name: "Big Booty Mona Azar", n: 870 }, // 1
  { type_id: "t_big-booty-morea-black", type_name: "Big Booty Morea Black", n: 754 }, // 1
  { type_id: "t_big-booty-naomi-soraya", type_name: "Big Booty Naomi Soraya", n: 747 }, // 1
  { type_id: "t_big-booty-natalia-starr", type_name: "Big Booty Natalia Starr", n: 800 }, // 1
  { type_id: "t_big-booty-nataly-fabiola", type_name: "Big Booty Nataly Fabiola", n: 833 }, // 1
  { type_id: "t_big-booty-nataly-ordonez", type_name: "Big Booty Nataly Ordonez", n: 835 }, // 1
  { type_id: "t_big-booty-persias-paradise", type_name: "Big Booty Persia's Paradise", n: 960 }, // 1
  { type_id: "t_big-booty-robbin-banx", type_name: "Big Booty Robbin Banx", n: 894 }, // 1
  { type_id: "t_big-booty-rose-monroe", type_name: "Big Booty Rose Monroe", n: 798 }, // 1
  { type_id: "t_big-booty-ryan-keely", type_name: "Big Booty Ryan Keely", n: 849 }, // 1
  { type_id: "t_big-booty-sapphire-astrea", type_name: "Big Booty Sapphire Astrea", n: 859 }, // 1
  { type_id: "t_big-booty-savanah-storm", type_name: "Big Booty Savanah Storm", n: 899 }, // 1
  { type_id: "t_big-booty-sicilian-billions", type_name: "Big Booty Sicilian Billions", n: 971 }, // 1
  { type_id: "t_big-booty-siri-dahl", type_name: "Big Booty Siri Dahl", n: 934 }, // 1
  { type_id: "t_big-booty-skylar-snow", type_name: "Big Booty Skylar Snow", n: 965 }, // 1
  { type_id: "t_big-booty-sophie-reade", type_name: "Big Booty Sophie Reade", n: 725 }, // 1
  { type_id: "t_big-booty-trixi-brooks", type_name: "Big Booty Trixi Brooks", n: 906 }, // 1
  { type_id: "t_big-booty-tru-kait", type_name: "Big Booty Tru Kait", n: 745 }, // 1
  { type_id: "t_big-booty-uptown-jenny", type_name: "Big Booty Uptown Jenny", n: 908 }, // 1
  { type_id: "t_big-booty-valentine-vixen", type_name: "Big Booty Valentine Vixen", n: 929 }, // 1
  { type_id: "t_big-booty-violet-starr", type_name: "Big Booty Violet Starr", n: 877 }, // 1
  { type_id: "t_big-booty-yae-triple-x", type_name: "Big Booty Yae Triple X", n: 872 }, // 1
  { type_id: "t_big-booty-yinyleon", type_name: "Big Booty YinyLeon", n: 892 }, // 1
  { type_id: "t_big-booty-zoey-foxx", type_name: "Big Booty Zoey Foxx", n: 896 }, // 1
  { type_id: "t_boob-job", type_name: "Boob Job", n: 871 }, // 1
  { type_id: "t_cum-shot", type_name: "Cum Shot", n: 824 }, // 1
  { type_id: "t_full-nelson", type_name: "Full-Nelson", n: 951 }, // 1
  { type_id: "t_gangbang", type_name: "Gangbang", n: 879 }, // 1
  { type_id: "t_homemade-sextape", type_name: "Homemade Sextape", n: 851 }, // 1
  { type_id: "t_huge-booty-nickiibaby", type_name: "Huge Booty Nickiibaby", n: 966 }, // 1
  { type_id: "t_huge-tits", type_name: "Huge Tits", n: 950 }, // 1
  { type_id: "t_jenna-starr-leaks", type_name: "Jenna Starr Leaks", n: 738 }, // 1
  { type_id: "t_latex", type_name: "Latex", n: 720 }, // 1
  { type_id: "t_masturbation", type_name: "Masturbation", n: 860 }, // 1
  { type_id: "t_oe", type_name: "œ", n: 529 }, // 1
  { type_id: "t_passionate-sex", type_name: "Passionate Sex", n: 822 }, // 1
  { type_id: "t_pawg-bootyfrutti", type_name: "PAWG BootyFrutti", n: 883 }, // 1
  { type_id: "t_podcast-sex", type_name: "Podcast Sex", n: 829 }, // 1
  { type_id: "t_raissa-bellini", type_name: "Raissa Bellini", n: 918 }, // 1
  { type_id: "t_reverse-gangbang", type_name: "Reverse Gangbang", n: 897 }, // 1
  { type_id: "t_schoolgirl-roleplay", type_name: "Schoolgirl Roleplay", n: 888 }, // 1
  { type_id: "t_sixty-nine", type_name: "Sixty-Nine", n: 881 }, // 1
  { type_id: "t_solo", type_name: "Solo", n: 77 }, // 1
  { type_id: "t_stand-and-carry", type_name: "Stand and Carry", n: 952 }, // 1
  { type_id: "t_stepaunt", type_name: "StepAunt", n: 363 }, // 1
  { type_id: "t_submissive-big-booty", type_name: "Submissive Big Booty", n: 783 }, // 1
  { type_id: "t_voluptuous", type_name: "Voluptuous", n: 827 }, // 1
  // actors: 429 个 (wp-json count>0, 按帖数降序)
  { type_id: "a_angela-white", type_name: "Angela White", n: 154 }, // 59
  { type_id: "a_savannah-bond", type_name: "Savannah Bond", n: 267 }, // 37
  { type_id: "a_jenna-starr", type_name: "Jenna Starr", n: 322 }, // 36
  { type_id: "a_violet-myers", type_name: "Violet Myers", n: 183 }, // 36
  { type_id: "a_slimthick-vic", type_name: "Slimthick Vic", n: 393 }, // 35
  { type_id: "a_hayley-davies", type_name: "Hayley Davies", n: 566 }, // 33
  { type_id: "a_the-official-egypt", type_name: "The Official Egypt", n: 621 }, // 30
  { type_id: "a_kayley-gunner", type_name: "Kayley Gunner", n: 171 }, // 26
  { type_id: "a_luna-star", type_name: "Luna Star", n: 116 }, // 25
  { type_id: "a_abigaiil-morris", type_name: "Abigaiil Morris", n: 443 }, // 23
  { type_id: "a_kelsey-kane", type_name: "Kelsey Kane", n: 573 }, // 22
  { type_id: "a_payton-preslee", type_name: "Payton Preslee", n: 86 }, // 22
  { type_id: "a_jessie-rogers", type_name: "Jessie Rogers", n: 428 }, // 21
  { type_id: "a_emma-magnolia", type_name: "Emma Magnolia", n: 424 }, // 20
  { type_id: "a_lissa-aires", type_name: "Lissa Aires", n: 680 }, // 20
  { type_id: "a_willow-ryder", type_name: "Willow Ryder", n: 454 }, // 20
  { type_id: "a_auhneesh-nicole", type_name: "Auhneesh Nicole", n: 645 }, // 19
  { type_id: "a_mini-diva", type_name: "Mini Diva", n: 68 }, // 19
  { type_id: "a_tommy-king", type_name: "Tommy King", n: 430 }, // 19
  { type_id: "a_brandy-salazar", type_name: "Brandy Salazar", n: 749 }, // 18
  { type_id: "a_kelsi-monroe", type_name: "Kelsi Monroe", n: 37 }, // 18
  { type_id: "a_brandylicious", type_name: "Brandylicious", n: 661 }, // 17
  { type_id: "a_katalina-kyle", type_name: "Katalina Kyle", n: 400 }, // 17
  { type_id: "a_madison-moores", type_name: "Madison Moores", n: 544 }, // 17
  { type_id: "a_madisonmoores", type_name: "Madisonmoores", n: 528 }, // 17
  { type_id: "a_mona-azar", type_name: "Mona Azar", n: 131 }, // 17
  { type_id: "a_mandy-muse", type_name: "Mandy Muse", n: 321 }, // 16
  { type_id: "a_angel-youngs", type_name: "Angel Youngs", n: 467 }, // 15
  { type_id: "a_brandy-renee", type_name: "Brandy Renee", n: 450 }, // 15
  { type_id: "a_gracie-bon", type_name: "Gracie Bon", n: 593 }, // 15
  { type_id: "a_kaden-kole", type_name: "Kaden Kole", n: 56 }, // 15
  { type_id: "a_richelle-ryan", type_name: "Richelle Ryan", n: 186 }, // 15
  { type_id: "a_kali-roses", type_name: "Kali Roses", n: 201 }, // 14
  { type_id: "a_lasirena69", type_name: "Lasirena69", n: 410 }, // 14
  { type_id: "a_mia-malkova", type_name: "Mia Malkova", n: 64 }, // 13
  { type_id: "a_victoria-june", type_name: "Victoria June", n: 122 }, // 13
  { type_id: "a_aletta-ocean", type_name: "Aletta Ocean", n: 101 }, // 12
  { type_id: "a_anais-amore", type_name: "Anais Amore", n: 488 }, // 12
  { type_id: "a_sara-retali", type_name: "Sara Retali", n: 414 }, // 12
  { type_id: "a_connie-perignon", type_name: "Connie Perignon", n: 446 }, // 11
  { type_id: "a_giuliana-cabrazia", type_name: "Giuliana Cabrazia", n: 463 }, // 11
  { type_id: "a_jada-stevens", type_name: "Jada Stevens", n: 199 }, // 11
  { type_id: "a_lacey-jayne", type_name: "Lacey Jayne", n: 564 }, // 11
  { type_id: "a_lily-lou", type_name: "Lily Lou", n: 457 }, // 11
  { type_id: "a_miss-lexa", type_name: "Miss Lexa", n: 43 }, // 11
  { type_id: "a_thedandangler", type_name: "TheDanDangler", n: 548 }, // 11
  { type_id: "a_xwife-karen", type_name: "Xwife Karen", n: 501 }, // 11
  { type_id: "a_andie-anderson", type_name: "Andie Anderson", n: 619 }, // 10
  { type_id: "a_graciebon", type_name: "GracieBon", n: 694 }, // 10
  { type_id: "a_karmen-karma", type_name: "Karmen Karma", n: 476 }, // 10
  { type_id: "a_lolly-dames", type_name: "Lolly Dames", n: 301 }, // 10
  { type_id: "a_tru-kait", type_name: "Tru Kait", n: 221 }, // 10
  { type_id: "a_yinyleon", type_name: "YinyLeon", n: 27 }, // 10
  { type_id: "a_blake-blossom", type_name: "Blake Blossom", n: 191 }, // 9
  { type_id: "a_madison-morgan", type_name: "Madison Morgan", n: 298 }, // 9
  { type_id: "a_maria-gjieli", type_name: "Maria Gjieli", n: 509 }, // 9
  { type_id: "a_mz-dani", type_name: "Mz Dani", n: 388 }, // 9
  { type_id: "a_naomi-soraya", type_name: "Naomi Soraya", n: 471 }, // 9
  { type_id: "a_aubree-valentine", type_name: "Aubree Valentine", n: 342 }, // 8
  { type_id: "a_jennifer-white", type_name: "Jennifer White", n: 237 }, // 8
  { type_id: "a_alexis-texas", type_name: "Alexis Texas", n: 429 }, // 7
  { type_id: "a_blondie-fesser", type_name: "Blondie Fesser", n: 92 }, // 7
  { type_id: "a_carmela-clutch", type_name: "Carmela Clutch", n: 218 }, // 7
  { type_id: "a_cassie-lenoir", type_name: "Cassie Lenoir", n: 585 }, // 7
  { type_id: "a_laney-grey", type_name: "Laney Grey", n: 228 }, // 7
  { type_id: "a_raven-thick", type_name: "Raven Thick", n: 812 }, // 7
  { type_id: "a_sophie-reade", type_name: "Sophie Reade", n: 555 }, // 7
  { type_id: "a_vitoria-beatriz", type_name: "Vitoria Beatriz", n: 648 }, // 7
  { type_id: "a_vivian-taylor", type_name: "Vivian Taylor", n: 106 }, // 7
  { type_id: "a_callie-brooks", type_name: "Callie Brooks", n: 447 }, // 6
  { type_id: "a_ella-reese", type_name: "Ella Reese", n: 538 }, // 6
  { type_id: "a_isabelle-eleanore", type_name: "Isabelle Eleanore", n: 606 }, // 6
  { type_id: "a_nia-bleu", type_name: "Nia Bleu", n: 545 }, // 6
  { type_id: "a_sara-diamante", type_name: "Sara Diamante", n: 453 }, // 6
  { type_id: "a_alexis-fawx", type_name: "Alexis Fawx", n: 197 }, // 5
  { type_id: "a_autumn-falls", type_name: "Autumn Falls", n: 500 }, // 5
  { type_id: "a_elana-bunnz", type_name: "Elana Bunnz", n: 486 }, // 5
  { type_id: "a_gia-derza", type_name: "Gia Derza", n: 179 }, // 5
  { type_id: "a_holly-day", type_name: "Holly Day", n: 493 }, // 5
  { type_id: "a_indica-monroe", type_name: "Indica Monroe", n: 195 }, // 5
  { type_id: "a_kendra-sunderland", type_name: "Kendra Sunderland", n: 507 }, // 5
  { type_id: "a_lila-hayes", type_name: "Lila Hayes", n: 752 }, // 5
  { type_id: "a_mellanie-monroe", type_name: "Mellanie Monroe", n: 451 }, // 5
  { type_id: "a_natasha-nice", type_name: "Natasha Nice", n: 208 }, // 5
  { type_id: "a_nina-kayy", type_name: "Nina Kayy", n: 423 }, // 5
  { type_id: "a_richh-des", type_name: "Richh Des", n: 449 }, // 5
  { type_id: "a_scarlet-chase", type_name: "Scarlet Chase", n: 200 }, // 5
  { type_id: "a_vanessa-bohorquez", type_name: "Vanessa Bohorquez", n: 723 }, // 5
  { type_id: "a_anikka-albrite", type_name: "Anikka Albrite", n: 417 }, // 4
  { type_id: "a_anissa-miller", type_name: "Anissa Miller", n: 901 }, // 4
  { type_id: "a_bella-rolland", type_name: "Bella Rolland", n: 310 }, // 4
  { type_id: "a_candy-love", type_name: "Candy Love", n: 253 }, // 4
  { type_id: "a_caryn-beaumont", type_name: "Caryn Beaumont", n: 580 }, // 4
  { type_id: "a_gia-paige", type_name: "Gia Paige", n: 312 }, // 4
  { type_id: "a_harley-king", type_name: "Harley King", n: 123 }, // 4
  { type_id: "a_julie-cash", type_name: "Julie Cash", n: 111 }, // 4
  { type_id: "a_karol-rosado", type_name: "Karol Rosado", n: 540 }, // 4
  { type_id: "a_katrina-moreno", type_name: "Katrina Moreno", n: 263 }, // 4
  { type_id: "a_kenzie-anne", type_name: "Kenzie Anne", n: 376 }, // 4
  { type_id: "a_kenzie-taylor", type_name: "Kenzie Taylor", n: 239 }, // 4
  { type_id: "a_lauren-phillips", type_name: "Lauren Phillips", n: 31 }, // 4
  { type_id: "a_lena-paul", type_name: "Lena Paul", n: 48 }, // 4
  { type_id: "a_martina-smeraldi", type_name: "Martina Smeraldi", n: 268 }, // 4
  { type_id: "a_melissa-stratton", type_name: "Melissa Stratton", n: 591 }, // 4
  { type_id: "a_mila-monet", type_name: "Mila Monet", n: 281 }, // 4
  { type_id: "a_miss-raquel", type_name: "Miss Raquel", n: 572 }, // 4
  { type_id: "a_morea-black", type_name: "Morea Black", n: 562 }, // 4
  { type_id: "a_nicole-aria", type_name: "Nicole Aria", n: 355 }, // 4
  { type_id: "a_nicole-doshi", type_name: "Nicole Doshi", n: 484 }, // 4
  { type_id: "a_penelope-woods", type_name: "Penelope Woods", n: 371 }, // 4
  { type_id: "a_phoenix-marie", type_name: "Phoenix Marie", n: 99 }, // 4
  { type_id: "a_rachel-starr", type_name: "Rachel Starr", n: 169 }, // 4
  { type_id: "a_raissa-bellini", type_name: "Raissa Bellini", n: 919 }, // 4
  { type_id: "a_robbin-banx", type_name: "Robbin Banx", n: 193 }, // 4
  { type_id: "a_roxanne-roselle", type_name: "Roxanne Roselle", n: 890 }, // 4
  { type_id: "a_ryan-conner", type_name: "Ryan Conner", n: 32 }, // 4
  { type_id: "a_ryan-reid", type_name: "Ryan Reid", n: 402 }, // 4
  { type_id: "a_sheena-ryder", type_name: "Sheena Ryder", n: 285 }, // 4
  { type_id: "a_siri-dahl", type_name: "Siri Dahl", n: 133 }, // 4
  { type_id: "a_summer-brookes", type_name: "Summer Brookes", n: 582 }, // 4
  { type_id: "a_taylor-blake", type_name: "Taylor Blake", n: 198 }, // 4
  { type_id: "a_toochi-kash", type_name: "Toochi Kash", n: 625 }, // 4
  { type_id: "a_alanna-pow", type_name: "Alanna Pow", n: 939 }, // 3
  { type_id: "a_alexa-payne", type_name: "Alexa Payne", n: 559 }, // 3
  { type_id: "a_alexas-morgan", type_name: "Alexas Morgan", n: 489 }, // 3
  { type_id: "a_anna-claire-clouds", type_name: "Anna Claire Clouds", n: 550 }, // 3
  { type_id: "a_ashlyn-peaks", type_name: "Ashlyn Peaks", n: 465 }, // 3
  { type_id: "a_carrylight", type_name: "CarryLight", n: 203 }, // 3
  { type_id: "a_cherie-deville", type_name: "Cherie DeVille", n: 468 }, // 3
  { type_id: "a_comatozze", type_name: "Comatozze", n: 915 }, // 3
  { type_id: "a_crystal-lust", type_name: "Crystal Lust", n: 242 }, // 3
  { type_id: "a_dee-williams", type_name: "Dee Williams", n: 156 }, // 3
  { type_id: "a_emily-norman", type_name: "Emily Norman", n: 633 }, // 3
  { type_id: "a_esperanza-gomez", type_name: "Esperanza Gomez", n: 505 }, // 3
  { type_id: "a_essie-gotback", type_name: "Essie Gotback", n: 642 }, // 3
  { type_id: "a_gem-jewels", type_name: "Gem Jewels", n: 570 }, // 3
  { type_id: "a_holly-brougham", type_name: "Holly Brougham", n: 595 }, // 3
  { type_id: "a_jakara-mitchell", type_name: "Jakara Mitchell", n: 583 }, // 3
  { type_id: "a_jewelz-blu", type_name: "Jewelz Blu", n: 605 }, // 3
  { type_id: "a_juanita-belle", type_name: "Juanita Belle", n: 787 }, // 3
  { type_id: "a_kissa-sins", type_name: "Kissa Sins", n: 192 }, // 3
  { type_id: "a_kourtney-love", type_name: "Kourtney Love", n: 299 }, // 3
  { type_id: "a_kristy-black", type_name: "Kristy Black", n: 649 }, // 3
  { type_id: "a_la-paisita-oficial", type_name: "La Paisita Oficial", n: 861 }, // 3
  { type_id: "a_lena-the-plug", type_name: "Lena the Plug", n: 553 }, // 3
  { type_id: "a_leolulu", type_name: "LeoLulu", n: 69 }, // 3
  { type_id: "a_lilly-hall", type_name: "Lilly Hall", n: 41 }, // 3
  { type_id: "a_martinpaola", type_name: "MartinPaola", n: 407 }, // 3
  { type_id: "a_maru-karv", type_name: "Maru Karv", n: 146 }, // 3
  { type_id: "a_ms-sethi", type_name: "Ms Sethi", n: 964 }, // 3
  { type_id: "a_nataly-ordonez", type_name: "Nataly Ordonez", n: 653 }, // 3
  { type_id: "a_nika-venom", type_name: "Nika Venom", n: 491 }, // 3
  { type_id: "a_nikki-benz", type_name: "Nikki Benz", n: 475 }, // 3
  { type_id: "a_rachael-cavalli", type_name: "Rachael Cavalli", n: 219 }, // 3
  { type_id: "a_riley-reign", type_name: "Riley Reign", n: 434 }, // 3
  { type_id: "a_romi-rain", type_name: "Romi Rain", n: 452 }, // 3
  { type_id: "a_rose-monroe", type_name: "Rose Monroe", n: 36 }, // 3
  { type_id: "a_sapphire-astrea", type_name: "Sapphire Astrea", n: 607 }, // 3
  { type_id: "a_savanah-storm", type_name: "Savanah Storm", n: 638 }, // 3
  { type_id: "a_sisi-rose", type_name: "Sisi Rose", n: 558 }, // 3
  { type_id: "a_skylar-snow", type_name: "Skylar Snow", n: 480 }, // 3
  { type_id: "a_suki-sin", type_name: "Suki Sin", n: 523 }, // 3
  { type_id: "a_uptown-jenny", type_name: "Uptown Jenny", n: 472 }, // 3
  { type_id: "a_valentina-jewels", type_name: "Valentina Jewels", n: 251 }, // 3
  { type_id: "a_vanillaandcaramel", type_name: "VanillaAndCaramel", n: 395 }, // 3
  { type_id: "a_violet-starr", type_name: "Violet Starr", n: 497 }, // 3
  { type_id: "a_abella-danger", type_name: "Abella Danger", n: 406 }, // 2
  { type_id: "a_advoree", type_name: "Advoree", n: 246 }, // 2
  { type_id: "a_alexis-andrews", type_name: "Alexis Andrews", n: 94 }, // 2
  { type_id: "a_alura-jenson", type_name: "Alura Jenson", n: 163 }, // 2
  { type_id: "a_alyx-star", type_name: "Alyx Star", n: 478 }, // 2
  { type_id: "a_angel-wicky", type_name: "Angel Wicky", n: 136 }, // 2
  { type_id: "a_atlanta-moreno", type_name: "Atlanta Moreno", n: 492 }, // 2
  { type_id: "a_avery-jane", type_name: "Avery Jane", n: 308 }, // 2
  { type_id: "a_bailey-brooke", type_name: "Bailey Brooke", n: 412 }, // 2
  { type_id: "a_behindthemaskk", type_name: "BehindTheMaskk", n: 306 }, // 2
  { type_id: "a_brandi-love", type_name: "Brandi Love", n: 128 }, // 2
  { type_id: "a_briana-banderas", type_name: "Briana Banderas", n: 448 }, // 2
  { type_id: "a_brookie-blair", type_name: "Brookie Blair", n: 479 }, // 2
  { type_id: "a_brooklyn-chase", type_name: "Brooklyn Chase", n: 397 }, // 2
  { type_id: "a_brooklyn-gray", type_name: "Brooklyn Gray", n: 176 }, // 2
  { type_id: "a_bunny-madison", type_name: "Bunny Madison", n: 431 }, // 2
  { type_id: "a_candice-dare", type_name: "Candice Dare", n: 213 }, // 2
  { type_id: "a_canela-skin", type_name: "Canela Skin", n: 568 }, // 2
  { type_id: "a_carlita-ray", type_name: "Carlita Ray", n: 481 }, // 2
  { type_id: "a_carmen-caliente", type_name: "Carmen Caliente", n: 483 }, // 2
  { type_id: "a_casca-akashova", type_name: "Casca Akashova", n: 265 }, // 2
  { type_id: "a_chloe-rannoch", type_name: "Chloe Rannoch", n: 905 }, // 2
  { type_id: "a_coralia-baby", type_name: "Coralia Baby", n: 440 }, // 2
  { type_id: "a_danae-mari", type_name: "Danae Mari", n: 677 }, // 2
  { type_id: "a_dani-daniels", type_name: "Dani Daniels", n: 61 }, // 2
  { type_id: "a_ebony-mystique", type_name: "Ebony Mystique", n: 232 }, // 2
  { type_id: "a_emily-addison", type_name: "Emily Addison", n: 114 }, // 2
  { type_id: "a_gigi-lysette", type_name: "Gigi Lysette", n: 956 }, // 2
  { type_id: "a_halle-hayes", type_name: "Halle Hayes", n: 399 }, // 2
  { type_id: "a_jackie-ohh", type_name: "Jackie Ohh", n: 160 }, // 2
  { type_id: "a_jasmine-jae", type_name: "Jasmine Jae", n: 226 }, // 2
  { type_id: "a_jazlyn-ray", type_name: "Jazlyn Ray", n: 323 }, // 2
  { type_id: "a_jazz-jizzes", type_name: "Jazz Jizzes", n: 587 }, // 2
  { type_id: "a_jazz-jizziz", type_name: "Jazz Jizziz", n: 557 }, // 2
  { type_id: "a_joslyn-james", type_name: "Joslyn James", n: 58 }, // 2
  { type_id: "a_julianna-vega", type_name: "Julianna Vega", n: 441 }, // 2
  { type_id: "a_karma-rx", type_name: "Karma Rx", n: 334 }, // 2
  { type_id: "a_kate-dee", type_name: "Kate Dee", n: 462 }, // 2
  { type_id: "a_katie-kush", type_name: "Katie Kush", n: 273 }, // 2
  { type_id: "a_katty-soarez", type_name: "Katty Soarez", n: 794 }, // 2
  { type_id: "a_keisha-grey", type_name: "Keisha Grey", n: 485 }, // 2
  { type_id: "a_kendra-lust", type_name: "Kendra Lust", n: 345 }, // 2
  { type_id: "a_kylie-page", type_name: "Kylie Page", n: 571 }, // 2
  { type_id: "a_lana-rhoades", type_name: "Lana Rhoades", n: 159 }, // 2
  { type_id: "a_lauren-pixie", type_name: "Lauren Pixie", n: 343 }, // 2
  { type_id: "a_leah-winters", type_name: "Leah Winters", n: 164 }, // 2
  { type_id: "a_lela-black", type_name: "Lela Black", n: 172 }, // 2
  { type_id: "a_lexis-star", type_name: "Lexis Star", n: 943 }, // 2
  { type_id: "a_lily-phillips", type_name: "Lily Phillips", n: 876 }, // 2
  { type_id: "a_lisey-sweet", type_name: "Lisey Sweet", n: 373 }, // 2
  { type_id: "a_london-river", type_name: "London River", n: 346 }, // 2
  { type_id: "a_lucy-lotus", type_name: "Lucy Lotus", n: 695 }, // 2
  { type_id: "a_luna-baby", type_name: "Luna Baby", n: 628 }, // 2
  { type_id: "a_marica-chanelle", type_name: "Marica Chanelle", n: 383 }, // 2
  { type_id: "a_mila-solana", type_name: "Mila Solana", n: 641 }, // 2
  { type_id: "a_miss-anat", type_name: "Miss Anat", n: 289 }, // 2
  { type_id: "a_miss-boddy", type_name: "Miss Boddy", n: 792 }, // 2
  { type_id: "a_miss-korinne", type_name: "Miss Korinne", n: 691 }, // 2
  { type_id: "a_nikki-mars", type_name: "Nikki Mars", n: 516 }, // 2
  { type_id: "a_okichloeo", type_name: "Okichloeo", n: 904 }, // 2
  { type_id: "a_rory-knox", type_name: "Rory Knox", n: 141 }, // 2
  { type_id: "a_ryan-keely", type_name: "Ryan Keely", n: 614 }, // 2
  { type_id: "a_sandy-love", type_name: "Sandy Love", n: 515 }, // 2
  { type_id: "a_sapphire-lapiedra", type_name: "Sapphire LaPiedra", n: 189 }, // 2
  { type_id: "a_sharon-white", type_name: "Sharon White", n: 295 }, // 2
  { type_id: "a_sinatra-monroe", type_name: "Sinatra Monroe", n: 732 }, // 2
  { type_id: "a_skylar-vox", type_name: "Skylar Vox", n: 196 }, // 2
  { type_id: "a_summer-col", type_name: "Summer Col", n: 419 }, // 2
  { type_id: "a_susy-gala", type_name: "Susy Gala", n: 143 }, // 2
  { type_id: "a_sybil-stallone", type_name: "Sybil Stallone", n: 150 }, // 2
  { type_id: "a_the-thai-godess", type_name: "The Thai Godess", n: 592 }, // 2
  { type_id: "a_tokyo-lynn", type_name: "Tokyo Lynn", n: 442 }, // 2
  { type_id: "a_valentine-vixen", type_name: "Valentine Vixen", n: 666 }, // 2
  { type_id: "a_valerie-kay", type_name: "Valerie Kay", n: 398 }, // 2
  { type_id: "a_vanessa-cage", type_name: "Vanessa Cage", n: 416 }, // 2
  { type_id: "a_vanna-rose", type_name: "Vanna Rose", n: 947 }, // 2
  { type_id: "a_victoria-lobov", type_name: "Victoria Lobov", n: 252 }, // 2
  { type_id: "a_zoey-uso", type_name: "Zoey Uso", n: 945 }, // 2
  { type_id: "a_6ft-phenomenon", type_name: "6ft Phenomenon", n: 975 }, // 1
  { type_id: "a_abby-rose", type_name: "Abby Rose", n: 780 }, // 1
  { type_id: "a_abigail", type_name: "Abigail", n: 514 }, // 1
  { type_id: "a_adriana-chechik", type_name: "Adriana Chechik", n: 631 }, // 1
  { type_id: "a_alana-luv", type_name: "Alana Luv", n: 234 }, // 1
  { type_id: "a_alice-fantasy", type_name: "Alice Fantasy", n: 466 }, // 1
  { type_id: "a_alice-thunder", type_name: "Alice Thunder", n: 773 }, // 1
  { type_id: "a_alisha-grey", type_name: "Alisha Grey", n: 539 }, // 1
  { type_id: "a_allie-adams", type_name: "Allie Adams", n: 503 }, // 1
  { type_id: "a_analeasex", type_name: "Analeasex", n: 408 }, // 1
  { type_id: "a_anna-bell-peaks", type_name: "Anna Bell Peaks", n: 303 }, // 1
  { type_id: "a_anna-chambers", type_name: "Anna Chambers", n: 360 }, // 1
  { type_id: "a_annabel-redd", type_name: "Annabel Redd", n: 330 }, // 1
  { type_id: "a_april-eighteen", type_name: "April Eighteen", n: 147 }, // 1
  { type_id: "a_april-olsen", type_name: "April Olsen", n: 382 }, // 1
  { type_id: "a_arabelle-raphael", type_name: "Arabelle Raphael", n: 588 }, // 1
  { type_id: "a_ariana-starr", type_name: "Ariana Starr", n: 624 }, // 1
  { type_id: "a_arietta-adams", type_name: "Arietta Adams", n: 499 }, // 1
  { type_id: "a_ashley-barbie", type_name: "Ashley Barbie", n: 868 }, // 1
  { type_id: "a_august-skye", type_name: "August Skye", n: 611 }, // 1
  { type_id: "a_ava-addams", type_name: "Ava Addams", n: 282 }, // 1
  { type_id: "a_ava-nicks", type_name: "Ava Nicks", n: 959 }, // 1
  { type_id: "a_bella-blu", type_name: "Bella Blu", n: 590 }, // 1
  { type_id: "a_bella-jane", type_name: "Bella Jane", n: 386 }, // 1
  { type_id: "a_blondie-bombshell", type_name: "Blondie Bombshell", n: 433 }, // 1
  { type_id: "a_booty_ass", type_name: "Booty_Ass", n: 277 }, // 1
  { type_id: "a_bootyfrutti", type_name: "BootyFrutti", n: 884 }, // 1
  { type_id: "a_brenna-mckenna", type_name: "Brenna McKenna", n: 235 }, // 1
  { type_id: "a_brianna-bourbon", type_name: "Brianna Bourbon", n: 610 }, // 1
  { type_id: "a_bridgette-b", type_name: "Bridgette B.", n: 139 }, // 1
  { type_id: "a_brittany-andrews", type_name: "Brittany Andrews", n: 432 }, // 1
  { type_id: "a_brooke-beretta", type_name: "Brooke Beretta", n: 244 }, // 1
  { type_id: "a_cali-carter", type_name: "Cali Carter", n: 358 }, // 1
  { type_id: "a_callie-black", type_name: "Callie Black", n: 502 }, // 1
  { type_id: "a_camila-cortez", type_name: "Camila Cortez", n: 287 }, // 1
  { type_id: "a_carmen-de-luz", type_name: "Carmen De Luz", n: 411 }, // 1
  { type_id: "a_carolina-cortez", type_name: "Carolina Cortez", n: 270 }, // 1
  { type_id: "a_casey-saron", type_name: "Casey Saron", n: 594 }, // 1
  { type_id: "a_cassie-del-isla", type_name: "Cassie Del Isla", n: 599 }, // 1
  { type_id: "a_cassie-lenior", type_name: "Cassie Lenior", n: 743 }, // 1
  { type_id: "a_cassie-solis", type_name: "Cassie Solis", n: 926 }, // 1
  { type_id: "a_catalina-ossa", type_name: "Catalina Ossa", n: 262 }, // 1
  { type_id: "a_chanell-heart", type_name: "Chanell Heart", n: 390 }, // 1
  { type_id: "a_chantal-danielle", type_name: "Chantal Danielle", n: 554 }, // 1
  { type_id: "a_chloe-chevallier", type_name: "Chloe Chevallier", n: 512 }, // 1
  { type_id: "a_chloe-cooper", type_name: "Chloe Cooper", n: 494 }, // 1
  { type_id: "a_chloe-lapiedra", type_name: "Chloe Lapiedra", n: 637 }, // 1
  { type_id: "a_claudia-bavel", type_name: "Claudia Bavel", n: 535 }, // 1
  { type_id: "a_coralia", type_name: "Coralia", n: 437 }, // 1
  { type_id: "a_cory-chase", type_name: "Cory Chase", n: 315 }, // 1
  { type_id: "a_cubbi-thompson", type_name: "Cubbi Thompson", n: 692 }, // 1
  { type_id: "a_curlyrican", type_name: "CurlyRican", n: 693 }, // 1
  { type_id: "a_daisy-fuentes", type_name: "Daisy Fuentes", n: 651 }, // 1
  { type_id: "a_daisy-marie", type_name: "Daisy Marie", n: 508 }, // 1
  { type_id: "a_daisy-stone", type_name: "Daisy Stone", n: 210 }, // 1
  { type_id: "a_dan-dangler", type_name: "Dan Dangler", n: 626 }, // 1
  { type_id: "a_davina-winter", type_name: "Davina Winter", n: 181 }, // 1
  { type_id: "a_dirtydanii-69", type_name: "Dirtydanii 69", n: 634 }, // 1
  { type_id: "a_eliza-eves", type_name: "Eliza Eves", n: 254 }, // 1
  { type_id: "a_ellie-nova", type_name: "Ellie Nova", n: 609 }, // 1
  { type_id: "a_elly-clutch", type_name: "Elly Clutch", n: 891 }, // 1
  { type_id: "a_ely-la-bella", type_name: "Ely La Bella", n: 662 }, // 1
  { type_id: "a_emily-rinaudo", type_name: "Emily Rinaudo", n: 886 }, // 1
  { type_id: "a_emma-leigh", type_name: "Emma Leigh", n: 387 }, // 1
  { type_id: "a_evandmikee", type_name: "EvandMikee", n: 405 }, // 1
  { type_id: "a_franceska-jaimes", type_name: "Franceska Jaimes", n: 456 }, // 1
  { type_id: "a_gabriela-lopez", type_name: "Gabriela Lopez", n: 389 }, // 1
  { type_id: "a_gia-dibella", type_name: "Gia DiBella", n: 379 }, // 1
  { type_id: "a_gia-oh-my", type_name: "Gia Oh My", n: 602 }, // 1
  { type_id: "a_gianna-grey", type_name: "Gianna Grey", n: 275 }, // 1
  { type_id: "a_gypsy-rose", type_name: "Gypsy Rose", n: 656 }, // 1
  { type_id: "a_hailey-rose", type_name: "Hailey Rose", n: 932 }, // 1
  { type_id: "a_hija-de-venu", type_name: "Hija de Venu", n: 678 }, // 1
  { type_id: "a_iluvmysis", type_name: "ILuvMySis", n: 418 }, // 1
  { type_id: "a_indianara-jung", type_name: "Indianara Jung", n: 854 }, // 1
  { type_id: "a_isabel-moon", type_name: "Isabel Moon", n: 394 }, // 1
  { type_id: "a_jacqueline-valentine", type_name: "Jacqueline Valentine", n: 790 }, // 1
  { type_id: "a_jade-jantzen", type_name: "Jade Jantzen", n: 145 }, // 1
  { type_id: "a_jennifer-mendez", type_name: "Jennifer Mendez", n: 326 }, // 1
  { type_id: "a_jessa-rhodes", type_name: "Jessa Rhodes", n: 459 }, // 1
  { type_id: "a_jessica-sodi", type_name: "Jessica Sodi", n: 556 }, // 1
  { type_id: "a_joanna-angel", type_name: "Joanna Angel", n: 632 }, // 1
  { type_id: "a_jocessita", type_name: "Jocessita", n: 684 }, // 1
  { type_id: "a_josephine-jackson", type_name: "Josephine Jackson", n: 328 }, // 1
  { type_id: "a_josie-tucker", type_name: "Josie Tucker", n: 470 }, // 1
  { type_id: "a_joslyn-jane", type_name: "Joslyn Jane", n: 260 }, // 1
  { type_id: "a_judy-jolie", type_name: "Judy Jolie", n: 185 }, // 1
  { type_id: "a_julia-de-lucia", type_name: "Julia De Lucia", n: 565 }, // 1
  { type_id: "a_julz-gotti", type_name: "Julz Gotti", n: 436 }, // 1
  { type_id: "a_jynx-maze", type_name: "Jynx Maze", n: 404 }, // 1
  { type_id: "a_kagney-linn-karter", type_name: "Kagney Linn Karter", n: 532 }, // 1
  { type_id: "a_katrina-colt", type_name: "Katrina Colt", n: 435 }, // 1
  { type_id: "a_kayla-east", type_name: "Kayla East", n: 615 }, // 1
  { type_id: "a_kaylynn-keys", type_name: "Kaylynn Keys", n: 217 }, // 1
  { type_id: "a_kazumi", type_name: "Kazumi", n: 560 }, // 1
  { type_id: "a_kelly-oliveira", type_name: "Kelly Oliveira", n: 369 }, // 1
  { type_id: "a_kenzie-love", type_name: "Kenzie Love", n: 444 }, // 1
  { type_id: "a_kenzie-madison", type_name: "Kenzie Madison", n: 348 }, // 1
  { type_id: "a_kianna-dior", type_name: "Kianna Dior", n: 657 }, // 1
  { type_id: "a_kiara-lord", type_name: "Kiara Lord", n: 317 }, // 1
  { type_id: "a_kiara-mia", type_name: "Kiara Mia", n: 530 }, // 1
  { type_id: "a_kira-perez", type_name: "Kira Perez", n: 245 }, // 1
  { type_id: "a_kitten-latenight", type_name: "Kitten Latenight", n: 325 }, // 1
  { type_id: "a_kittina-clairette", type_name: "Kittina Clairette", n: 332 }, // 1
  { type_id: "a_kona-jade", type_name: "Kona Jade", n: 569 }, // 1
  { type_id: "a_krystal-kakes", type_name: "Krystal Kakes", n: 941 }, // 1
  { type_id: "a_kyra-hot", type_name: "Kyra Hot", n: 47 }, // 1
  { type_id: "a_lana-roy", type_name: "Lana Roy", n: 249 }, // 1
  { type_id: "a_lana-sharapova", type_name: "Lana Sharapova", n: 319 }, // 1
  { type_id: "a_lena-coxx", type_name: "Lena Coxx", n: 543 }, // 1
  { type_id: "a_lexi-luna", type_name: "Lexi Luna", n: 297 }, // 1
  { type_id: "a_lily-lane", type_name: "Lily Lane", n: 82 }, // 1
  { type_id: "a_linda-gonzalez", type_name: "Linda Gonzalez", n: 350 }, // 1
  { type_id: "a_lorena-lorado", type_name: "Lorena Lorado", n: 814 }, // 1
  { type_id: "a_lucky-kay", type_name: "Lucky Kay", n: 970 }, // 1
  { type_id: "a_luna-angel", type_name: "Luna Angel", n: 923 }, // 1
  { type_id: "a_luna-luxe", type_name: "Luna Luxe", n: 586 }, // 1
  { type_id: "a_luna-mills", type_name: "Luna Mills", n: 378 }, // 1
  { type_id: "a_macey-jade", type_name: "Macey Jade", n: 293 }, // 1
  { type_id: "a_maddy-may", type_name: "Maddy May", n: 513 }, // 1
  { type_id: "a_maddy-oreilly", type_name: "Maddy O'Reilly", n: 59 }, // 1
  { type_id: "a_madelyn-monroe", type_name: "Madelyn Monroe", n: 202 }, // 1
  { type_id: "a_madison-ivy", type_name: "Madison Ivy", n: 913 }, // 1
  { type_id: "a_madison-wilde", type_name: "Madison Wilde", n: 658 }, // 1
  { type_id: "a_maevaa-sinaloa", type_name: "Maevaa Sinaloa", n: 977 }, // 1
  { type_id: "a_maria-bolona", type_name: "Maria Bolona", n: 949 }, // 1
  { type_id: "a_melztube", type_name: "Melztube", n: 735 }, // 1
  { type_id: "a_mia-james", type_name: "Mia James", n: 659 }, // 1
  { type_id: "a_mia-monroe", type_name: "Mia Monroe", n: 917 }, // 1
  { type_id: "a_mia-queen", type_name: "Mia Queen", n: 229 }, // 1
  { type_id: "a_michelle-anderson", type_name: "Michelle Anderson", n: 341 }, // 1
  { type_id: "a_mila-milkshake", type_name: "Mila Milkshake", n: 551 }, // 1
  { type_id: "a_mimi-boliviana", type_name: "Mimi Boliviana", n: 604 }, // 1
  { type_id: "a_misha-maver", type_name: "Misha Maver", n: 496 }, // 1
  { type_id: "a_moderngomorrah", type_name: "ModernGomorrah", n: 639 }, // 1
  { type_id: "a_morgan-lee", type_name: "Morgan Lee", n: 269 }, // 1
  { type_id: "a_my-cookie-jar", type_name: "My Cookie Jar", n: 665 }, // 1
  { type_id: "a_mynewprofession", type_name: "MyNewProfession", n: 413 }, // 1
  { type_id: "a_nadia-white", type_name: "Nadia White", n: 272 }, // 1
  { type_id: "a_nara-ford", type_name: "Nara Ford", n: 536 }, // 1
  { type_id: "a_natalia-starr", type_name: "Natalia Starr", n: 802 }, // 1
  { type_id: "a_natalie-brooke", type_name: "Natalie Brooke", n: 552 }, // 1
  { type_id: "a_nataly-fabiola", type_name: "Nataly Fabiola", n: 834 }, // 1
  { type_id: "a_nickey-huntsman", type_name: "Nickey Huntsman", n: 247 }, // 1
  { type_id: "a_nickiibaby", type_name: "Nickiibaby", n: 967 }, // 1
  { type_id: "a_nikky-thorne", type_name: "Nikky Thorne", n: 357 }, // 1
  { type_id: "a_niky-bimbodoll", type_name: "Niky Bimbodoll", n: 685 }, // 1
  { type_id: "a_nini_divine", type_name: "Nini_Divine", n: 49 }, // 1
  { type_id: "a_pamela-rios", type_name: "Pamela Rios", n: 89 }, // 1
  { type_id: "a_paola-hard", type_name: "Paola Hard", n: 531 }, // 1
  { type_id: "a_payton-presle", type_name: "Payton Presle", n: 623 }, // 1
  { type_id: "a_persias-paradise", type_name: "Persia's Paradise", n: 961 }, // 1
  { type_id: "a_porsha-carrera", type_name: "Porsha Carrera", n: 167 }, // 1
  { type_id: "a_queen-rogue", type_name: "Queen Rogue", n: 644 }, // 1
  { type_id: "a_reagan-foxx", type_name: "Reagan Foxx", n: 351 }, // 1
  { type_id: "a_roxie-sinner", type_name: "Roxie Sinner", n: 464 }, // 1
  { type_id: "a_ruth-lee", type_name: "Ruth Lee", n: 579 }, // 1
  { type_id: "a_sadie-summers", type_name: "Sadie Summers", n: 629 }, // 1
  { type_id: "a_salome-gil", type_name: "Salome Gil", n: 367 }, // 1
  { type_id: "a_samantha-cruuz", type_name: "Samantha Cruuz", n: 620 }, // 1
  { type_id: "a_secret", type_name: "secret", n: 415 }, // 1
  { type_id: "a_selena-ivy", type_name: "Selena Ivy", n: 506 }, // 1
  { type_id: "a_serena-santos", type_name: "Serena Santos", n: 352 }, // 1
  { type_id: "a_sheila-ortega", type_name: "Sheila Ortega", n: 366 }, // 1
  { type_id: "a_sheinsh", type_name: "SheInsh", n: 184 }, // 1
  { type_id: "a_sicilian-billions", type_name: "Sicilian Billions", n: 972 }, // 1
  { type_id: "a_sophia-leone", type_name: "Sophia Leone", n: 613 }, // 1
  { type_id: "a_steffy-moreno", type_name: "Steffy Moreno", n: 674 }, // 1
  { type_id: "a_stella-andrews", type_name: "Stella Andrews", n: 510 }, // 1
  { type_id: "a_sydney-summers", type_name: "Sydney Summers", n: 498 }, // 1
  { type_id: "a_taylee-wood", type_name: "Taylee Wood", n: 255 }, // 1
  { type_id: "a_thick-ass-daphne", type_name: "Thick Ass Daphne", n: 519 }, // 1
  { type_id: "a_tiffani-madison", type_name: "Tiffani Madison", n: 597 }, // 1
  { type_id: "a_tokyo-leigh", type_name: "Tokyo Leigh", n: 663 }, // 1
  { type_id: "a_trixi-brooks", type_name: "Trixi Brooks", n: 907 }, // 1
  { type_id: "a_vanessa-vega", type_name: "Vanessa Vega", n: 603 }, // 1
  { type_id: "a_vegas-vixen", type_name: "Vegas Vixen", n: 524 }, // 1
  { type_id: "a_vera-jarw", type_name: "Vera Jarw", n: 547 }, // 1
  { type_id: "a_vika-borja", type_name: "Vika Borja", n: 125 }, // 1
  { type_id: "a_whitney-oc", type_name: "Whitney OC", n: 598 }, // 1
  { type_id: "a_yae-triple-x", type_name: "Yae Triple X", n: 873 }, // 1
  { type_id: "a_yiny-leon", type_name: "Yiny Leon", n: 893 }, // 1
  { type_id: "a_yorgelis-carrillo", type_name: "Yorgelis Carrillo", n: 490 }, // 1
  { type_id: "a_yvonna-carlo", type_name: "Yvonna Carlo", n: 458 }, // 1
  { type_id: "a_zoey-foxx", type_name: "Zoey Foxx", n: 898 }, // 1
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
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
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

function stdHeaders(extra) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': REFERER,
    ...(extra || {}),
  };
}

// 双通道抓文本: 先框架 req, 失败再原生 fetch (minLen 默认 200)
async function getText(url, headers, minLen, timeoutMs) {
  const to = timeoutMs || 12000;
  const h = stdHeaders(headers);
  const need = minLen == null ? 200 : minLen;
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

// 原始抓取 (不设最小长度, 验 embed 存活状态用): 返回 {status, text}
async function getRaw(url, headers, timeoutMs) {
  const to = timeoutMs || 9000;
  const h = stdHeaders(headers);
  try {
    const res = await req.get(url, { headers: h, timeout: to, responseType: 'text' });
    return { status: res.status || 0, text: typeof res.data === 'string' ? res.data : String(res.data || '') };
  } catch (e) {
    if (e && e.response) return { status: e.response.status || 0, text: typeof e.response.data === 'string' ? e.response.data : '' };
  }
  try {
    const r = await withTimeout(fetch(url, { headers: h }), to);
    return { status: r.status, text: await r.text() };
  } catch (e) { return { status: 0, text: '' }; }
}

// JSON 抓取 (REST 与 Byse API 共用): 返回 {status, data, totalPages}
async function getJson(url, timeoutMs) {
  const to = timeoutMs || 12000;
  const h = stdHeaders({ 'Accept': 'application/json' });
  try {
    const res = await req.get(url, { headers: h, timeout: to });
    const tp = parseInt(res.headers && res.headers['x-wp-totalpages'], 10) || 0;
    if (res.status === 200 && res.data) return { status: 200, data: res.data, totalPages: tp };
    return { status: res.status || 0, data: null, totalPages: tp };
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await withTimeout(fetch(url, { headers: h }), to);
    const tp = parseInt(r.headers.get('x-wp-totalpages'), 10) || 0;
    if (r.ok) return { status: r.status, data: await r.json(), totalPages: tp };
    return { status: r.status, data: null, totalPages: tp };
  } catch (e) { return { status: 0, data: null, totalPages: 0 }; }
}

// ===== 纯 JS AES-256-GCM 解密 (Byse playback 载荷用) =====
// 无 WebCrypto / node:crypto 依赖; 已用真实抓包向量 + 随机对照验过。
const AES_SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);
const AES_RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d];
function xtime(x) { return ((x << 1) ^ ((x & 0x80) ? 0x1b : 0x00)) & 0xff; }
function aesExpandKey(key) {
  const Nk = key.length / 4;
  const Nr = Nk + 6;
  const w = new Uint8Array(16 * (Nr + 1));
  w.set(key);
  const tmp = new Uint8Array(4);
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    tmp.set(w.subarray(4 * (i - 1), 4 * i));
    if (i % Nk === 0) {
      const tt = tmp[0];
      tmp[0] = AES_SBOX[tmp[1]] ^ AES_RCON[i / Nk - 1];
      tmp[1] = AES_SBOX[tmp[2]];
      tmp[2] = AES_SBOX[tmp[3]];
      tmp[3] = AES_SBOX[tt];
    } else if (Nk > 6 && i % Nk === 4) {
      for (let j = 0; j < 4; j++) tmp[j] = AES_SBOX[tmp[j]];
    }
    for (let j = 0; j < 4; j++) w[4 * i + j] = w[4 * (i - Nk) + j] ^ tmp[j];
  }
  return { w, Nr };
}
function aesEncryptBlock(w, Nr, input) {
  const s = new Uint8Array(input);
  const addKey = (r) => { for (let i = 0; i < 16; i++) s[i] ^= w[16 * r + i]; };
  addKey(0);
  for (let r = 1; r <= Nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
    const cp = new Uint8Array(s);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) s[row + 4 * col] = cp[row + 4 * ((col + row) % 4)];
    }
    if (r < Nr) {
      for (let col = 0; col < 4; col++) {
        const i = 4 * col;
        const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
        const x0 = xtime(a0), x1 = xtime(a1), x2 = xtime(a2), x3 = xtime(a3);
        s[i] = x0 ^ (x1 ^ a1) ^ a2 ^ a3;
        s[i + 1] = a0 ^ x1 ^ (x2 ^ a2) ^ a3;
        s[i + 2] = a0 ^ a1 ^ x2 ^ (x3 ^ a3);
        s[i + 3] = (x0 ^ a0) ^ a1 ^ a2 ^ x3;
      }
    }
    addKey(r);
  }
  return s;
}
function gfMul(x, y) {
  let z = new Uint8Array(16);
  const v = new Uint8Array(y);
  for (let i = 0; i < 16; i++) {
    for (let j = 7; j >= 0; j--) {
      if ((x[i] >>> j) & 1) { for (let k = 0; k < 16; k++) z[k] ^= v[k]; }
      const lsb = v[15] & 1;
      for (let k = 15; k > 0; k--) v[k] = (v[k] >>> 1) | ((v[k - 1] & 1) << 7);
      v[0] >>>= 1;
      if (lsb) v[0] ^= 0xe1;
    }
  }
  return z;
}
function ghash(h, data) {
  let y = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    for (let i = 0; i < 16; i++) y[i] ^= data[off + i] || 0;
    y = gfMul(y, h);
  }
  return y;
}
function inc32(ctr) {
  const c = new Uint8Array(ctr);
  let n = ((c[12] << 24) | (c[13] << 16) | (c[14] << 8) | c[15]) >>> 0;
  n = (n + 1) >>> 0;
  c[12] = (n >>> 24) & 0xff; c[13] = (n >>> 16) & 0xff; c[14] = (n >>> 8) & 0xff; c[15] = n & 0xff;
  return c;
}
function aesGcmDecryptBytes(key, iv, dataWithTag) {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) return null;
  if (iv.length !== 12 || dataWithTag.length < 16) return null;
  const { w, Nr } = aesExpandKey(key);
  const H = aesEncryptBlock(w, Nr, new Uint8Array(16));
  const J0 = new Uint8Array(16);
  J0.set(iv); J0[15] = 1;
  const ctLen = dataWithTag.length - 16;
  const ct = dataWithTag.subarray(0, ctLen);
  const tagGiven = dataWithTag.subarray(ctLen);
  // 先验 tag (CTR 模式下密文未认证前不输出)
  const lenBlock = new Uint8Array(16);
  const dv = new DataView(lenBlock.buffer);
  dv.setUint32(8, 0); dv.setUint32(12, (ctLen * 8) >>> 0);
  dv.setUint32(0, 0); dv.setUint32(4, Math.floor(ctLen / 0x20000000));
  const gInput = new Uint8Array(ct.length + (16 - (ct.length % 16)) % 16 + 16);
  gInput.set(ct); gInput.set(lenBlock, gInput.length - 16);
  const S = ghash(H, gInput);
  const EJ0 = aesEncryptBlock(w, Nr, J0);
  for (let i = 0; i < 16; i++) { if ((S[i] ^ EJ0[i]) !== tagGiven[i]) return null; }
  const pt = new Uint8Array(ctLen);
  let ctr = J0;
  for (let off = 0; off < ctLen; off += 16) {
    ctr = inc32(ctr);
    const ks = aesEncryptBlock(w, Nr, ctr);
    const n = Math.min(16, ctLen - off);
    for (let i = 0; i < n; i++) pt[off + i] = ct[off + i] ^ ks[i];
  }
  return pt;
}

// base64 / base64url 手工解码 (不依赖 Buffer / atob)
function b64Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const rev = {};
  for (let i = 0; i < alpha.length; i++) rev[alpha[i]] = i;
  rev['-'] = 62; rev['_'] = 63;
  const str = String(s || '').replace(/=+$/, '');
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of str) {
    const v = rev[ch];
    if (v === undefined) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >>> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

// UTF-8 字节 → 字符串 (不依赖 TextDecoder)
function utf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
    else if ((b & 0xe0) === 0xc0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
    else if ((b & 0xf0) === 0xe0) { out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3; }
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      i += 4;
    }
  }
  return out;
}

// ===== Byse 线 (bigbuttshub2.top / bysetayico.com) =====
// 密钥拼法镜像其前端 ws(): version n (1-20) → 取 key_parts 的第 n 与第
// 31-n 段 (1-based); 取不到则全部拼接 (前端校验段数 2..30)。
function byseDecryptPlayback(pb) {
  try {
    const parts = Array.isArray(pb && pb.key_parts) ? pb.key_parts : [];
    if (!parts.length || !pb.iv || !pb.payload) return null;
    const v = parseInt(pb.version, 10);
    let chosen = null;
    if (Number.isInteger(v) && v >= 1 && v <= 20) {
      const a = v, b = 31 - v;
      if (parts[a - 1] && parts[b - 1]) chosen = [parts[a - 1], parts[b - 1]];
    }
    if (!chosen) chosen = parts;
    const chunks = chosen.map(b64Decode);
    let keyLen = 0;
    for (const c of chunks) keyLen += c.length;
    const key = new Uint8Array(keyLen);
    let off = 0;
    for (const c of chunks) { key.set(c, off); off += c.length; }
    const pt = aesGcmDecryptBytes(key, b64Decode(pb.iv), b64Decode(pb.payload));
    if (!pt) return null;
    return JSON.parse(utf8Decode(pt));
  } catch (e) { return null; }
}

// 设备侧现场铸造: 调 embed 所在域 API 拿记录 → 解密 → 取最高画质直链。
// API 对机房/代理出口 403, 设备出口同铸同播自洽; 任一步失败返回 ''。
async function resolveByse(embedUrl) {
  let origin = '';
  let code = '';
  try {
    const u = new URL(embedUrl);
    origin = u.origin;
    code = (u.pathname.match(/\/e\/([^/?#]+)/) || [])[1] || '';
  } catch (e) { return ''; }
  if (!code) return '';
  const origins = [];
  for (const o of [origin, 'https://bigbuttshub2.top', 'https://bysetayico.com']) {
    if (o && !origins.includes(o)) origins.push(o);
  }
  for (const o of origins) {
    const { status, data } = await getJson(o + '/api/videos/' + encodeURIComponent(code), 10000);
    if (status !== 200 || !data || !data.playback) continue;
    const plain = byseDecryptPlayback(data.playback);
    const sources = plain && Array.isArray(plain.sources) ? plain.sources.filter(s => s && s.url) : [];
    if (sources.length) {
      sources.sort((a, b) => (b.height || 0) - (a.height || 0));
      return sources[0].url;
    }
  }
  return '';
}

// ===== vidhide 解包 (Worker 镜像算法, detail 验线用) =====
function unpackDeanEdwards(html) {
  const m = String(html || '').match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return '';
  const p = m[1];
  const a = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const kw = m[4].split('|');
  const dict = {};
  const tok = (i) => {
    const ch = (n) => (n > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    let s = '';
    let n = i;
    if (n >= a) { s += tok(Math.floor(n / a)); }
    s += ch(n % a);
    return s;
  };
  for (let i = 0; i < c; i++) dict[tok(i)] = kw[i] || tok(i);
  return p.replace(/\b\w+\b/g, (w) => dict[w] || w);
}

// 验一条 vidhide embed 的存活状态: strong=有 hls4 / weak=有 links 无 hls4 /
// dead=宿主已删 (426B 删除页) / unknown=取证失败 (按 strong 对待)
async function vetVidhide(embedUrl) {
  const { text } = await getRaw(embedUrl, { Referer: REFERER }, 9000);
  if (!text) return 'unknown';
  if (/no longer available|has been deleted/i.test(text)) return 'dead';
  const src = unpackDeanEdwards(text) || text;
  if (/"hls4"\s*:/.test(src)) return 'strong';
  if (/"hls\d+"\s*:|"file"\s*:/.test(src)) return 'weak';
  return 'unknown';
}

// ===== StreamCash 直连解析 (与第二轮相同, 实拉验通) =====
// files = "MD5(user IP)" -> /pass/{file} 是 IP 绑定一次性直链,
// 必须由设备侧在 play 时现场铸造, 故 s: 延到 play 才解。
async function sha256hex(str) {
  // FIPS 180-4 纯 JS 实现 (无 crypto 依赖)
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) { bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); }
    else { bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)); }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  for (let block = 0; block < bytes.length; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[block + i * 4] << 24) | (bytes[block + i * 4 + 1] << 16) | (bytes[block + i * 4 + 2] << 8) | bytes[block + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + hh) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(h => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

function md5hex(input) {
  // RSA Data Security MD5 (compact public-domain style implementation)
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function add(x, y) { const l = (x & 0xffff) + (y & 0xffff); const m = (x >> 16) + (y >> 16) + (l >> 16); return (m << 16) | (l & 0xffff); }
  function F(x, y, z) { return (x & y) | (~x & z); }
  function G(x, y, z) { return (x & z) | (y & ~z); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | ~z); }
  function ff(a, b, c, d, x, s, ac) { a = add(a, add(add(F(b, c, d), x), ac)); return add(rl(a, s), b); }
  function gg(a, b, c, d, x, s, ac) { a = add(a, add(add(G(b, c, d), x), ac)); return add(rl(a, s), b); }
  function hh(a, b, c, d, x, s, ac) { a = add(a, add(add(H(b, c, d), x), ac)); return add(rl(a, s), b); }
  function ii(a, b, c, d, x, s, ac) { a = add(a, add(add(I(b, c, d), x), ac)); return add(rl(a, s), b); }
  const str = unescape(encodeURIComponent(String(input)));
  const nblk = ((str.length + 8) >> 6) + 1;
  const blks = new Array(nblk * 16).fill(0);
  for (let i = 0; i < str.length; i++) blks[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
  blks[str.length >> 2] |= 0x80 << ((str.length % 4) * 8);
  blks[nblk * 16 - 2] = str.length * 8;
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < blks.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, blks[i + 0], 7, 0xd76aa478); d = ff(d, a, b, c, blks[i + 1], 12, 0xe8c7b756);
    c = ff(c, d, a, b, blks[i + 2], 17, 0x242070db); b = ff(b, c, d, a, blks[i + 3], 22, 0xc1bdceee);
    a = ff(a, b, c, d, blks[i + 4], 7, 0xf57c0faf); d = ff(d, a, b, c, blks[i + 5], 12, 0x4787c62a);
    c = ff(c, d, a, b, blks[i + 6], 17, 0xa8304613); b = ff(b, c, d, a, blks[i + 7], 22, 0xfd469501);
    a = ff(a, b, c, d, blks[i + 8], 7, 0x698098d8); d = ff(d, a, b, c, blks[i + 9], 12, 0x8b44f7af);
    c = ff(c, d, a, b, blks[i + 10], 17, 0xffff5bb1); b = ff(b, c, d, a, blks[i + 11], 22, 0x895cd7be);
    a = ff(a, b, c, d, blks[i + 12], 7, 0x6b901122); d = ff(d, a, b, c, blks[i + 13], 12, 0xfd987193);
    c = ff(c, d, a, b, blks[i + 14], 17, 0xa679438e); b = ff(b, c, d, a, blks[i + 15], 22, 0x49b40821);
    a = gg(a, b, c, d, blks[i + 1], 5, 0xf61e2562); d = gg(d, a, b, c, blks[i + 6], 9, 0xc040b340);
    c = gg(c, d, a, b, blks[i + 11], 14, 0x265e5a51); b = gg(b, c, d, a, blks[i + 0], 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, blks[i + 5], 5, 0xd62f105d); d = gg(d, a, b, c, blks[i + 10], 9, 0x02441453);
    c = gg(c, d, a, b, blks[i + 15], 14, 0xd8a1e681); b = gg(b, c, d, a, blks[i + 4], 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, blks[i + 9], 5, 0x21e1cde6); d = gg(d, a, b, c, blks[i + 14], 9, 0xc33707d6);
    c = gg(c, d, a, b, blks[i + 3], 14, 0xf4d50d87); b = gg(b, c, d, a, blks[i + 8], 20, 0x455a14ed);
    a = gg(a, b, c, d, blks[i + 13], 5, 0xa9e3e905); d = gg(d, a, b, c, blks[i + 2], 9, 0xfcefa3f8);
    c = gg(c, d, a, b, blks[i + 7], 14, 0x676f02d9); b = gg(b, c, d, a, blks[i + 12], 20, 0x8d2a4c8a);
    a = hh(a, b, c, d, blks[i + 5], 5, 0xfffa3942); d = hh(d, a, b, c, blks[i + 8], 11, 0x8771f681);
    c = hh(c, d, a, b, blks[i + 11], 16, 0x6d9d6122); b = hh(b, c, d, a, blks[i + 14], 23, 0xfde5380c);
    a = hh(a, b, c, d, blks[i + 1], 5, 0xa4beea44); d = hh(d, a, b, c, blks[i + 4], 11, 0x4bdecfa9);
    c = hh(c, d, a, b, blks[i + 7], 16, 0xf6bb4b60); b = hh(b, c, d, a, blks[i + 10], 23, 0xbebfbc70);
    a = hh(a, b, c, d, blks[i + 13], 5, 0x289b7ec6); d = hh(d, a, b, c, blks[i + 2], 11, 0xeaa127fa);
    c = hh(c, d, a, b, blks[i + 5], 16, 0xd4ef3085); b = hh(b, c, d, a, blks[i + 8], 23, 0x04881d05);
    a = hh(a, b, c, d, blks[i + 11], 5, 0xd9d4d039); d = hh(d, a, b, c, blks[i + 14], 11, 0xe6db99e5);
    c = hh(c, d, a, b, blks[i + 3], 16, 0x1fa27cf8); b = hh(b, c, d, a, blks[i + 6], 23, 0xc4ac5665);
    a = ii(a, b, c, d, blks[i + 0], 6, 0xf4292244); d = ii(d, a, b, c, blks[i + 7], 10, 0x432aff97);
    c = ii(c, d, a, b, blks[i + 10], 15, 0xab9423a7); b = ii(b, c, d, a, blks[i + 5], 21, 0xfc93a039);
    a = ii(a, b, c, d, blks[i + 12], 6, 0x655b59c3); d = ii(d, a, b, c, blks[i + 3], 10, 0x8f0ccc92);
    c = ii(c, d, a, b, blks[i + 6], 15, 0xffeff47d); b = ii(b, c, d, a, blks[i + 1], 21, 0x85845dd1);
    a = ii(a, b, c, d, blks[i + 8], 6, 0x6fa87e4f); d = ii(d, a, b, c, blks[i + 15], 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, blks[i + 14], 15, 0xa3014314); b = ii(b, c, d, a, blks[i + 11], 21, 0x4e0811a1);
    a = ii(a, b, c, d, blks[i + 9], 6, 0xf7537e82); d = ii(d, a, b, c, blks[i + 4], 10, 0xbd3af235);
    c = ii(c, d, a, b, blks[i + 2], 15, 0x2ad7d2bb); b = ii(b, c, d, a, blks[i + 13], 21, 0xeb86d391);
    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const hex = (n) => {
    let s = '';
    for (let i = 0; i < 4; i++) s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return s;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

// GET streamcash embed -> 直链。站方已改版 (第三轮实测): embed 页内
// __PCr = base64(JSON), 解开即含 src (cdn.streamcash.to/videos/{id}/
// index.m3u8), 列表与分片均已实拉验通 (0x47/mod188=0, 无需 Referer)。
// 旧版 files{user_ip} + /pass 铸造逻辑保留作兜底 (个别旧 embed 仍可能在)。
async function resolveStreamcash(embedUrl) {
  try {
    const html = await getText(embedUrl, { Referer: REFERER }, 500, 15000);
    if (!html) return '';
    const pcr = html.match(/__PCr\s*=\s*'([^']+)'/) || html.match(/__PCr\s*=\s*"([^"]+)"/);
    if (pcr) {
      try {
        const cfg = JSON.parse(utf8Decode(b64Decode(pcr[1])));
        if (cfg && cfg.src && /^https?:\/\//.test(cfg.src)) return cfg.src;
      } catch (e) { /* 落旧算法 */ }
    }
    const fm = html.match(/files\s*=\s*\{([\s\S]*?)\}/);
    if (!fm) return '';
    const body = fm[1];
    const g = (k) => {
      const m = body.match(new RegExp(k + '\\s*:\\s*"([^"]*)"'));
      return m ? m[1] : '';
    };
    const ip = g('user_ip');
    const stream = g('stream_name') || g('streamName') || g('file');
    const unauth = g('unauth_ip') || ip;
    const ipHash = ip ? md5hex(ip) : '';
    const sm = html.match(/sources\s*=\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/);
    let src = sm ? sm[1] : '';
    if (!src) return '';
    src = src.replace(/&amp;/g, '&').replace(/&hash=([0-9a-f]{64})/, (mm, s256) => '&hash=' + s256);
    if (ipHash) {
      src = src.replace('/pass/', '/' + ipHash + '/').replace('xxx.xxx.xxx.xxx', ip);
    }
    if (unauth && ip && ip !== unauth) src = src.replace(unauth, ip);
    return src;
  } catch (e) { return ''; }
}

// ===== REST 列表层 (分页权威) =====
async function fetchPostCards(query, page) {
  const qs = (query ? query + '&' : '') + 'per_page=' + PER_PAGE + '&page=' + page + '&_fields=id,link,title,date,featured_media';
  const { status, data, totalPages } = await getJson(API + '/posts?' + qs, 15000);
  if (status !== 200 || !Array.isArray(data)) return { list: [], pagecount: 0 };
  const ids = [...new Set(data.map(p => p && p.featured_media).filter(Boolean))];
  const media = {};
  if (ids.length) {
    const m = await getJson(API + '/media?include=' + ids.join(',') + '&per_page=100&_fields=id,source_url,media_details', 15000);
    if (m.status === 200 && Array.isArray(m.data)) {
      for (const it of m.data) {
        const sizes = (it.media_details && it.media_details.sizes) || {};
        media[it.id] = (sizes.wpst_thumb_large && sizes.wpst_thumb_large.source_url) || it.source_url || '';
      }
    }
  }
  const list = data.filter(p => p && p.link).map(p => ({
    vod_id: p.link,
    vod_name: clean(p.title && p.title.rendered) || p.link,
    vod_pic: fixUrl(media[p.featured_media] || ''),
    vod_remarks: '',
  }));
  return { list, pagecount: totalPages || 0 };
}

function listResult(r, page) {
  let pc = r.pagecount || 0;
  if (!pc) pc = r.list.length >= PER_PAGE ? page + 1 : page;
  return { page, pagecount: Math.max(pc, page), limit: PER_PAGE, total: r.list.length, list: r.list };
}

// ===== HTML 归档兜底解析 (仅 REST 不可用时第 1 页保命) =====
function parseCards(html) {
  const out = [];
  let src = String(html || '');
  const firstArt = src.indexOf('<article');
  const scanFrom = firstArt >= 0 ? firstArt + 1 : 0;
  let cut = src.length;
  for (const marker of ['<aside', '<h2 class="widget-title">', 'widget_videos_block']) {
    const i = src.indexOf(marker, scanFrom);
    if (i > 0 && i < cut) cut = i;
  }
  src = src.slice(0, cut);
  const seen = new Set();
  for (const part of src.split('<article').slice(1)) {
    const chunk = part.slice(0, 4500);
    if (!chunk.includes('loop-video')) continue;
    const urlM = chunk.match(/<a href="(https:\/\/bigbuttshub\.com\/[^"]+\/)"/);
    if (!urlM) continue;
    const url = urlM[1];
    if (/\/(category|tag|pornstar|actors|categories|tags|blog|page)\//.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const imgM = chunk.match(/data-main-thumb="([^"]+)"/) || chunk.match(/<img[^>]+src="([^"]+)"/);
    const titleM = imgM ? (chunk.match(/alt="([^"]*)"/) || chunk.match(/data-main-thumb="[^"]+"[^>]*alt="([^"]*)"/)) : chunk.match(/<a[^>]+title="([^"]*)"/);
    const durM = chunk.match(/class="duration"[\s\S]{0,80}?(\d{1,2}:\d{2}(?::\d{2})?)/);
    out.push({
      vod_id: url,
      vod_name: clean(titleM ? titleM[1] : '') || url,
      vod_pic: fixUrl(imgM ? imgM[1] : ''),
      vod_remarks: durM ? durM[1] : '',
    });
  }
  return out;
}

function catHtmlUrl(cat) {
  const prefix = cat.type_id.charAt(0);
  const path = cat.type_id.slice(2).split('~');
  if (prefix === 'c') return SITE + '/category/' + path.join('/') + '/';
  if (prefix === 't') return SITE + '/tag/' + path[0] + '/';
  if (prefix === 'a') return SITE + '/pornstar/' + path[0] + '/';
  return '';
}

// ===== 详情页线路提取 (第三轮重写) =====
// 大小写不敏感 + 协议相对; 扫描播放器区 (video-player 后 60KB, 掐掉
// happy-under-player 广告块); 按宿主分线, 广告与死/锁宿主直接丢弃。
function extractEmbeds(html) {
  const out = { vidhide: [], streamcash: [], byse: [], sniff: [] };
  let region = String(html || '');
  const start = region.indexOf('video-player');
  if (start >= 0) region = region.slice(start, start + 60000);
  const cut = region.indexOf('happy-under-player');
  if (cut > 0) region = region.slice(0, cut);
  const seen = new Set();
  const re = /<iframe[^>]*?src\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(region))) {
    const url = fixUrl(m[1]);
    if (!url || seen.has(url)) continue;
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { continue; }
    if (/realsrv|cbxyz|exoclick|trafficjunky|juicyads/.test(host)) continue;
    if (host === 'playmogo.com' || host === 'filemoon.art') continue; // 锁 / 已停放
    seen.add(url);
    if (host === 'bigbuttshub.top' || host === 'bigbuttshub3.top') out.vidhide.push(url);
    else if (host === 'streamcash.to') out.streamcash.push(url);
    else if (host === 'bigbuttshub2.top' || host === 'bysetayico.com') out.byse.push(url);
    else out.sniff.push(url);
  }
  return out;
}

function meta(html, prop) {
  const re1 = new RegExp('<meta[^>]+property=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)["\']', 'i');
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']' + prop + '["\']', 'i');
  const re3 = new RegExp('<meta[^>]+itemprop=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re1) || html.match(re2) || html.match(re3);
  return m ? clean(m[1]) : '';
}

function extractDetailMeta(html) {
  const title = meta(html, 'og:title');
  const pic = fixUrl(meta(html, 'og:image'));
  const desc = meta(html, 'og:description');
  const upM = html.match(/itemprop="uploadDate" content="([0-9]{4})/) || html.match(/datetime="([0-9]{4})-[0-9]{2}-[0-9]{2}/);
  const durM = html.match(/itemprop="duration" content="(?:PT)?([0-9HMS]+)"/) || html.match(/class="duration"[\s\S]{0,80}?(\d{1,2}:\d{2}(?::\d{2})?)/);
  return { title, pic, desc, year: upM ? upM[1] : '', dur: durM ? durM[1] : '' };
}

// ===== Spider =====
// mira-cat 框架外壳 (meta + fastify 路由, 与仓库其他蜘蛛同方言);
// 上方业务函数与下方 handler 方法体均由第三轮原稿平移, 逻辑未改。
// TVBox 式 homeVod 在本框架无对应路由, 其内容 (首页第一页列表)
// 已包含在 home 的返回中, 故未保留。

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const classes = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const r = await fetchPostCards('', 1);
  if (r.list.length) {
    return { class: classes, list: r.list };
  }
  // REST 不可用时 HTML 首页保命
  const html = await getText(SITE + '/', {}, 5000);
  return { class: classes, list: html ? parseCards(html) : [] };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id);
  const pg = body.page;
  const page = parseInt(pg, 10) || 1;
  const cat = CATS.find(c => c.type_id === tid) || CATS[0];
  const taxParam = cat.type_id.charAt(0) === 'c' ? 'categories' : cat.type_id.charAt(0) === 't' ? 'tags' : 'actors';
  const r = await fetchPostCards(taxParam + '=' + cat.n, page);
  if (r.list.length || page > 1) return listResult(r, page);
  // 第 1 页 REST 失败 → HTML 归档保命 (仅此时用, 分页不保证)
  const html = await getText(catHtmlUrl(cat), {}, 5000);
  const list = html ? parseCards(html) : [];
  return { page: 1, pagecount: 1, limit: PER_PAGE, total: list.length, list };
}

async function detail(reqIn) {
  const ids = (reqIn?.body || {}).id;
  const durl = Array.isArray(ids) ? ids[0] : ids;
  const html = await getText(durl, { Referer: REFERER }, 5000);
  if (!html) {
    return {
      list: [{
        vod_id: durl,
        vod_name: durl,
        vod_pic: '',
        vod_play_from: '备用',
        vod_play_url: '正片$x:' + durl,
      }],
    };
  }
  const info = extractDetailMeta(html);
  const emb = extractEmbeds(html);

  // 逐条验 vidhide embed: 已删的直接跳过 (最多验 3 条防拖慢)
  let vid = '';
  let vidState = 'unknown';
  const vidCandidates = emb.vidhide.slice(0, 3);
  for (const e of vidCandidates) {
    const st = await vetVidhide(e);
    if (st !== 'dead') { vid = e; vidState = st; break; }
  }
  let vidScore = 0;
  if (vid) vidScore = vidState === 'weak' ? 25 : 100;

  const cands = [];
  if (emb.streamcash.length) cands.push({ score: 80, name: '直连', entry: '正片$s:' + emb.streamcash[0] });
  if (vid) cands.push({ score: vidScore, name: '高清', entry: '正片$w:' + vid });
  if (emb.byse.length) cands.push({ score: 60, name: '高清B', entry: '正片$b:' + emb.byse[0] });
  // 备用嗅探: 优先未分类宿主; Byse 帖不再重复嗅探同一 SPA
  // (b: 失败时自身就会回退嗅探该页)
  if (emb.sniff.length) cands.push({ score: 20, name: '备用', entry: '正片$x:' + emb.sniff[0] });
  else cands.push({ score: 10, name: '备用', entry: '正片$x:' + durl });
  cands.sort((a, b) => b.score - a.score);

  return {
    list: [{
      vod_id: durl,
      vod_name: info.title || durl,
      vod_pic: info.pic,
      vod_year: info.year,
      vod_remarks: info.dur,
      vod_content: info.desc,
      vod_play_from: cands.map(c => c.name).join('$$$'),
      vod_play_url: cands.map(c => c.entry).join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const reqBody = reqIn?.body || {};
  let id = t(reqBody.id);
  if (id.startsWith('正片$')) id = id.slice(3);
  const body = t(id);
  const kind = body.slice(0, 2);
  const target = body.slice(2);
  const headers = { 'User-Agent': UA, 'Referer': REFERER };
  // vidhide 线: 全链走 Worker 代理
  if (kind === 'w:' && /^https?:\/\//.test(target)) {
    return {
      parse: 0,
      url: BBH_WORKER + '/v?u=' + encodeURIComponent(target),
      header: { 'User-Agent': UA, 'Referer': BBH_WORKER + '/' },
    };
  }
  // streamcash 线: 设备侧现场铸造 /pass 直链
  if (kind === 's:' && /^https?:\/\//.test(target)) {
    const direct = await resolveStreamcash(target);
    if (direct) {
      return { parse: 0, url: direct, header: { 'User-Agent': UA, 'Referer': 'https://streamcash.to/' } };
    }
    return { parse: 1, url: target, header: headers };
  }
  // Byse 线: 设备侧现场铸造 API 直链; 失败回退嗅探其 SPA 页
  if (kind === 'b:' && /^https?:\/\//.test(target)) {
    const direct = await resolveByse(target);
    if (direct) {
      return { parse: 0, url: direct, header: { 'User-Agent': UA, 'Referer': target } };
    }
    return { parse: 1, url: target, header: headers };
  }
  // 默认: 交播放器嗅探 (x: 目标恒为完整 URL: embed 或详情页)
  return { parse: 1, url: target || body, header: headers };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const pg = body.page;
  const page = parseInt(pg, 10) || 1;
  const r = await fetchPostCards('search=' + encodeURIComponent(wd || ''), page);
  if (r.list.length || page > 1) return listResult(r, page);
  const html = await getText(SITE + '/?s=' + encodeURIComponent(wd || ''), {}, 5000);
  const list = html ? parseCards(html) : [];
  return { page: 1, pagecount: 1, limit: PER_PAGE, total: list.length, list };
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
