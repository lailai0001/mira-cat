// BestJavPorn (https://www.bestjavporn.com) -> CatPawOpen spider
// 暂用名: 站方品牌 BestJavPorn (用户可改)。
//
// 站点性质: WordPress + WP-Script RetroTube 主题的 JAV 聚合站, 服务端渲染,
// 全站公开免费 (无登录/无付费墙, WP REST API 对匿名锁定但页面全开)。
// 列表卡片 article.thumb-block.loop-video; 分类体系 = 精选分类 17 +
// 片商 195 + 标签 265 (共 477, 2026-10-21 逐个实测第一页有视频才收,
// 站方 /categories/ /studios/ /tags/ 索引为据; 女优索引数百页未全量收)。
// 封面 pics.pornfhd.com 直连无防盗链 (VM 实测 200, 不需要图片代理;
// bagua-img-proxy 对该域不在白名单, 勿用)。
//
// 播放链 (2026-10-21 完整逆向 + VM 全链验证):
//   详情页 #video-player 的 data-mpu + video-id(post_id)
//   -> token = dex(post_id, data-mpu)
//   -> POST /api/play/ (sources=token&ver=2) 得 {data, reserve, lo}
//   -> 主线路径 = dex(post_id, data); 备线 = dex(post_id, reserve) 解出
//      JSON [{data, lo}...], 每条再 dex 得路径 (区域线 lo=sg/de/nl/fr/...)
//   -> 路径形如 //video{,1}.bestjavporn.com/p/{code}?t=..&s=..
//   -> GET 该 embed 页取 data-config, 解密得 {src, img, vtt}:
//      sources = JSON.parse(b64decode(src)) -> [{file, type, label}]
//   dex(seed, data) = b64decode( RC4( key, b64decode(data) ) ),
//      key = reverse( b64encode( seed + '_0x58fe15' ) )       (cast.js)
//   embed 配置解密同构 (video 页 main.js):
//      key = reverse( b64encode( b64encode(pathname+search).substr(4,20)
//             + '_0x59a0e4' ) ), 明文 = b64decode 后的 {src,...} JSON。
//   两组样本 (SHIND-116 / ACHJ-103) token 与明文逐字节对齐验证通过,
//   FC2 样本纯 Node 全链跑通 (主线 + 5 条区域备线全部解出)。
//
// 宿主线 (逐片不同, 详情里逐线标注宿主名):
//   - MaxStream (HLS, AES-128 标准 EXT-X-KEY 加密): VM 同会话实拉
//     master+变体+key+首分片, AES 解密后 0x47/188 对齐真 TS —— 全验通。
//     单档 720p (master 只有一档)。
//   - CloudDataCDN (MP4 直链): VM 实测 206 Partial Content / video/mp4。
//   - StreamTape (MP4): get_video 302 跳 tapecontent 成立; 终跳文件对
//     "取 302 的 IP" 绑定, VM 轮换出口下 403 unauthorized —— 设备单 IP
//     环境应自洽, VM 无法字节级终验 (如实标注)。
//   - StreamHLS / PianoPic (HLS): VM 出口拉 master 即 403 (铸造后立即
//     拉亦然), 疑出口/区域门禁更严; 设备侧结果未知, 排在末尾作备线。
//   线的令牌多为 IP 绑定型: 整条链在 App 内 (设备同一出口) 完成才自洽,
//   故 play 时现场重铸 (详情只把线路序号编进 play id, 不缓存流地址)。
//   播放器不转发 header 给分片的限制对本源无影响: 各线均为 URL 自带
//   令牌的直链, 分片不依赖蜘蛛给的 Referer (MaxStream 线 VM 实拉时
//   带了 Referer, 未验无 Referer 形态 —— 真机风险项之一)。
//
// 2026-10-21 第三轮修复 (与 javhdporn 同病同方):
//   真机故障根因 (VM 实测坐实): 本站 (与 javhdporn 同运营网络) 的
//   Cloudflare 按 User-Agent 拉黑 HTTP 库特征 UA —— okhttp / Java /
//   axios / node-fetch / python-requests 等一律 403, 只回 17B~5.5KB
//   空壳页; 浏览器 UA 则 200 满页。App 运行时发出的请求带的正是
//   这类被拉黑的 UA (蜘蛛设置的 Chrome UA 未能生效到站方), 于是
//   真机上所有页面抓取都只拿到 403 空壳 -> 解析 0 卡 -> "有分类、
//   无内容、点不开"。其他源 (Brazz/javideo/7mmtv) 的 CF 区没有
//   这条规则, 故独这两站全灭。版本前缀 /v{n}/ 经实测不是病因:
//   旧版本路径 (v2/v3/v9) 至今仍回真实内容页。
//   对策: GET/POST 抓取全部改为多层兜底 + 内容校验 + 胜出层记忆:
//   直连 req -> 直连 fetch -> jina 读页 (x-respond-with:html 取
//   原始 HTML, 实测 1~2s 满页保真) -> allorigins -> codetabs;
//   POST /api/play/ 走 直连 req -> 直连 fetch -> allorigins 转发。
//   铸造链若最终仍拿不到线路, play 落 parse:1 嗅探详情页兜底
//   (真机 WebView 是真实浏览器, 站方 cast 链可在页内原生跑通)。
// 2026-10-22 第四轮 (与 javhdporn 同步): 第三轮的串行逐层试错在
//   真机上仍被拖死 (用户复报: 分类能出、内容加载不出)。VM 复测
//   坐实 allorigins / codetabs 抽风时各回 522 且各烧 20~30s, 串行
//   叠加 (直连两败 + 两中转) 轻松超过 App 等待耐心。本轮 GET 与
//   POST 全部改并行竞速、首个合格响应胜出 (jina 实测 0.3~2s 全
//   覆盖), 中转只作 B 组/末位兜底并封顶; validPlayResp 收紧为
//   status===true, 防 allorigins 丢 body 的假成功抢答。
// 2026-10-22 第五轮: 第四轮真机仍全灭 —— 见抓取层上方长注:
//   通道池扩容 (workers.dev + allorigins/get + 原生 https 栈)、
//   校验改解析型、慢中转降第二波。根因裁定区分实测/推导, 详见
//   catfix_jhp_bjp_r3.md。
import req from '../../util/req.js';

const KEY = 'py_bestjavporn';
const NAME = 'BestJavPorn';
const HOST = 'https://www.bestjavporn.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = HOST + '/';

// 分类: type_id = 站方规范路径 (含 /v{n}/ 版本前缀, 站方 301 的落点);
// 2026-10-21 逐个抓取第一页验卡 (有视频才收), 顺序: 精选分类 / 片商 / 标签。
const CATS = [
{
"type_id": "/v42/category/censored/",
"type_name": "Censored"
},
{
"type_id": "/v12/category/uncensored/",
"type_name": "Uncensored"
},
{
"type_id": "/v25/category/decensored/",
"type_name": "Decensored"
},
{
"type_id": "/v25/category/amateur/",
"type_name": "Amateur"
},
{
"type_id": "/v10/category/censored/english-subtitle/",
"type_name": "English Subtitle"
},
{
"type_id": "/v14/category/chinese-subtitle/",
"type_name": "Chinese Subtitle"
},
{
"type_id": "/v2/category/subtitle-indonesia/",
"type_name": "Subtitle Indonesia"
},
{
"type_id": "/v11/category/uncensored/fc2-ppv/",
"type_name": "FC2 PPV"
},
{
"type_id": "/v39/category/uncensored/1pondo/",
"type_name": "1Pondo"
},
{
"type_id": "/v28/category/uncensored/caribbeancom/",
"type_name": "Caribbeancom"
},
{
"type_id": "/v50/category/uncensored/10musume/",
"type_name": "10Musume"
},
{
"type_id": "/v54/category/uncensored/heyzo/",
"type_name": "Heyzo"
},
{
"type_id": "/v59/category/uncensored/pacopacomama/",
"type_name": "Pacopacomama"
},
{
"type_id": "/v1/category/uncensored/tokyo-hot/",
"type_name": "Tokyo Hot"
},
{
"type_id": "/category/hitozuma/",
"type_name": "Hitozuma"
},
{
"type_id": "/category/subthai/",
"type_name": "SubThai"
},
{
"type_id": "/v25/category/decensored/uncensored-leaked/",
"type_name": "Uncensored Leaked"
},
{
"type_id": "/studio/moodyz/",
"type_name": "MOODYZ"
},
{
"type_id": "/v3/studio/madonna/",
"type_name": "MADONNA"
},
{
"type_id": "/v56/studio/fc2/",
"type_name": "FC2"
},
{
"type_id": "/studio/prestige/",
"type_name": "Prestige"
},
{
"type_id": "/v4/studio/s1-no-1-style/",
"type_name": "S1 NO.1 Style"
},
{
"type_id": "/v32/studio/sod-create/",
"type_name": "SOD Create"
},
{
"type_id": "/studio/idea-pocket/",
"type_name": "Idea Pocket"
},
{
"type_id": "/v1/studio/attackers/",
"type_name": "Attackers"
},
{
"type_id": "/studio/venus/",
"type_name": "VENUS"
},
{
"type_id": "/studio/glory-quest/",
"type_name": "Glory Quest"
},
{
"type_id": "/studio/wanz-factory/",
"type_name": "Wanz Factory"
},
{
"type_id": "/studio/k-m-produce/",
"type_name": "K M Produce"
},
{
"type_id": "/v1/studio/center-village/",
"type_name": "Center Village"
},
{
"type_id": "/studio/h-m-p/",
"type_name": "h.m.p"
},
{
"type_id": "/studio/hunter/",
"type_name": "Hunter"
},
{
"type_id": "/v1/studio/fitch/",
"type_name": "Fitch"
},
{
"type_id": "/v4/studio/kawaii/",
"type_name": "kawaii"
},
{
"type_id": "/v3/studio/premium/",
"type_name": "PREMIUM"
},
{
"type_id": "/studio/faleno/",
"type_name": "Faleno"
},
{
"type_id": "/studio/planet-plus/",
"type_name": "Planet Plus"
},
{
"type_id": "/studio/alice-japan/",
"type_name": "Alice JAPAN"
},
{
"type_id": "/studio/tameike-goro/",
"type_name": "Tameike Goro"
},
{
"type_id": "/v1/studio/das/",
"type_name": "Das"
},
{
"type_id": "/studio/oppai/",
"type_name": "OPPAI"
},
{
"type_id": "/studio/star-paradise/",
"type_name": "STAR PARADISE"
},
{
"type_id": "/studio/takara-eizo/",
"type_name": "Takara Eizo"
},
{
"type_id": "/v3/studio/natural-high/",
"type_name": "Natural High"
},
{
"type_id": "/v1/studio/ruby/",
"type_name": "Ruby"
},
{
"type_id": "/v1/studio/e-body/",
"type_name": "E-BODY"
},
{
"type_id": "/studio/maxing/",
"type_name": "MAXING"
},
{
"type_id": "/studio/crystal-eizo/",
"type_name": "Crystal Eizo"
},
{
"type_id": "/studio/shiroutotv/",
"type_name": "シロウトTV"
},
{
"type_id": "/studio/big-morkal/",
"type_name": "Big Morkal"
},
{
"type_id": "/studio/hon-naka/",
"type_name": "Hon Naka"
},
{
"type_id": "/studio/max-a/",
"type_name": "Max A"
},
{
"type_id": "/studio/waap-entertainment/",
"type_name": "Waap Entertainment"
},
{
"type_id": "/v1/studio/nagae-style/",
"type_name": "Nagae Style"
},
{
"type_id": "/studio/takara-eizou/",
"type_name": "Takara Eizou"
},
{
"type_id": "/studio/media-station/",
"type_name": "Media Station"
},
{
"type_id": "/v25/studio/hot-entertainment/",
"type_name": "Hot Entertainment"
},
{
"type_id": "/v6/studio/doc/",
"type_name": "DOC"
},
{
"type_id": "/studio/puresutezipuremiamu-prestige-premium/",
"type_name": "プレステージプレミアム(PRESTIGE PREMIUM)"
},
{
"type_id": "/studio/next-group/",
"type_name": "NEXT GROUP"
},
{
"type_id": "/v15/studio/rocket/",
"type_name": "ROCKET"
},
{
"type_id": "/studio/dogma/",
"type_name": "Dogma"
},
{
"type_id": "/studio/first-star/",
"type_name": "First Star"
},
{
"type_id": "/studio/hibino/",
"type_name": "Hibino"
},
{
"type_id": "/v2/studio/real-works/",
"type_name": "Real Works"
},
{
"type_id": "/studio/an-nosu-ren/",
"type_name": "俺の素人"
},
{
"type_id": "/studio/office-k-s/",
"type_name": "OFFICE K'S"
},
{
"type_id": "/studio/raguziyutv/",
"type_name": "ラグジュTV"
},
{
"type_id": "/studio/skyu-shiroto/",
"type_name": "Skyu Shiroto"
},
{
"type_id": "/studio/ienergy/",
"type_name": "Ienergy"
},
{
"type_id": "/v1/studio/tma/",
"type_name": "TMA"
},
{
"type_id": "/studio/aurora-project-annex/",
"type_name": "Aurora Project ANNEX"
},
{
"type_id": "/studio/celeb-no-tomo/",
"type_name": "Celeb no Tomo"
},
{
"type_id": "/studio/honnaka/",
"type_name": "Honnaka"
},
{
"type_id": "/studio/nadeshiko/",
"type_name": "Nadeshiko"
},
{
"type_id": "/studio/muku/",
"type_name": "Muku"
},
{
"type_id": "/studio/dream-ticket/",
"type_name": "Dream Ticket"
},
{
"type_id": "/v1/studio/sodkurieito/",
"type_name": "SODクリエイト"
},
{
"type_id": "/studio/momotaro-eizo/",
"type_name": "Momotaro Eizo"
},
{
"type_id": "/v1/studio/nanpatv/",
"type_name": "ナンパTV"
},
{
"type_id": "/v28/studio/caribbeancom/",
"type_name": "Caribbeancom"
},
{
"type_id": "/v1/studio/giga/",
"type_name": "GIGA"
},
{
"type_id": "/v1/studio/deep-s/",
"type_name": "Deep's"
},
{
"type_id": "/studio/akinori/",
"type_name": "Akinori"
},
{
"type_id": "/studio/deeps/",
"type_name": "Deeps"
},
{
"type_id": "/v6/studio/switch/",
"type_name": "SWITCH"
},
{
"type_id": "/studio/an-nosu-ren-z/",
"type_name": "俺の素人-Z-"
},
{
"type_id": "/v1/studio/kira-kira/",
"type_name": "kira*kira"
},
{
"type_id": "/studio/fa-pro/",
"type_name": "FA Pro"
},
{
"type_id": "/studio/m-s-video-group/",
"type_name": "M's Video Group"
},
{
"type_id": "/studio/avs-collector-s/",
"type_name": "AVS collector's"
},
{
"type_id": "/studio/lahaina-tokai/",
"type_name": "Lahaina Tokai"
},
{
"type_id": "/v1/studio/dahlia/",
"type_name": "DAHLIA"
},
{
"type_id": "/studio/serebu-no-tomo/",
"type_name": "Serebu No Tomo"
},
{
"type_id": "/studio/s-cute/",
"type_name": "S-Cute"
},
{
"type_id": "/v4/studio/sadistic-village/",
"type_name": "Sadistic Village"
},
{
"type_id": "/v55/studio/heyzo/",
"type_name": "HEYZO"
},
{
"type_id": "/v1/studio/tokyo-hot/",
"type_name": "Tokyo-Hot"
},
{
"type_id": "/v1/studio/global-media-entertainment/",
"type_name": "Global Media Entertainment"
},
{
"type_id": "/studio/momotarou-eizou-shuppan/",
"type_name": "Momotarou Eizou Shuppan"
},
{
"type_id": "/studio/crystal-eizou/",
"type_name": "Crystal Eizou"
},
{
"type_id": "/studio/rebecca/",
"type_name": "REbecca"
},
{
"type_id": "/studio/chijo-heaven/",
"type_name": "Chijo Heaven"
},
{
"type_id": "/v10/studio/dandy/",
"type_name": "DANDY"
},
{
"type_id": "/studio/befree/",
"type_name": "BeFree"
},
{
"type_id": "/studio/mercury-mercury/",
"type_name": "MERCURY (Mercury)"
},
{
"type_id": "/studio/plum/",
"type_name": "Plum"
},
{
"type_id": "/studio/digital-ark/",
"type_name": "Digital Ark"
},
{
"type_id": "/v1/studio/scoop/",
"type_name": "Scoop"
},
{
"type_id": "/studio/glay-z/",
"type_name": "Glay'z"
},
{
"type_id": "/studio/abc-mousouzoku/",
"type_name": "ABC / Mousouzoku"
},
{
"type_id": "/studio/janesu/",
"type_name": "Janesu"
},
{
"type_id": "/v50/studio/10musume/",
"type_name": "10Musume"
},
{
"type_id": "/v2/studio/cinemagic/",
"type_name": "Cinemagic"
},
{
"type_id": "/studio/v-r-produce/",
"type_name": "V&R PRODUCE"
},
{
"type_id": "/studio/avs/",
"type_name": "Avs"
},
{
"type_id": "/studio/non/",
"type_name": "NON"
},
{
"type_id": "/studio/aroma-planning/",
"type_name": "Aroma Planning"
},
{
"type_id": "/studio/ei-ten/",
"type_name": "Ei Ten"
},
{
"type_id": "/studio/yama-to-sora/",
"type_name": "Yama to Sora"
},
{
"type_id": "/studio/abc-mousou-zoku/",
"type_name": "Abc/ Mousou Zoku"
},
{
"type_id": "/studio/karuma/",
"type_name": "Karuma"
},
{
"type_id": "/studio/red/",
"type_name": "Red"
},
{
"type_id": "/studio/kanbi/",
"type_name": "KANBi"
},
{
"type_id": "/studio/leo/",
"type_name": "LEO"
},
{
"type_id": "/studio/babyentertainment/",
"type_name": "BabyEntertainment"
},
{
"type_id": "/studio/radix/",
"type_name": "Radix"
},
{
"type_id": "/studio/u-k/",
"type_name": "U & K"
},
{
"type_id": "/v24/studio/gogos/",
"type_name": "Gogos"
},
{
"type_id": "/studio/marx/",
"type_name": "MARX"
},
{
"type_id": "/studio/atena-eizou/",
"type_name": "Atena Eizou"
},
{
"type_id": "/studio/hei-chuan/",
"type_name": "黒船"
},
{
"type_id": "/v59/studio/pacopacomama/",
"type_name": "Pacopacomama"
},
{
"type_id": "/studio/huresutesihuremiamu-prestige-premium/",
"type_name": "プレステージプレミアム(PRESTIGE PREMIUM)"
},
{
"type_id": "/studio/royal/",
"type_name": "Royal"
},
{
"type_id": "/studio/su-ren-hoihoi/",
"type_name": "素人ホイホイ"
},
{
"type_id": "/studio/siroutotv/",
"type_name": "シロウトTV"
},
{
"type_id": "/studio/alpha-international/",
"type_name": "Alpha International"
},
{
"type_id": "/studio/mr-michiru/",
"type_name": "Mr. Michiru"
},
{
"type_id": "/studio/i-b-works/",
"type_name": "I.B.WORKS"
},
{
"type_id": "/studio/ie-nergy/",
"type_name": "IE NERGY"
},
{
"type_id": "/studio/rookie/",
"type_name": "ROOKIE"
},
{
"type_id": "/studio/mirai-future/",
"type_name": "Mirai Future"
},
{
"type_id": "/studio/kuki/",
"type_name": "KUKI"
},
{
"type_id": "/studio/janes/",
"type_name": "Janes"
},
{
"type_id": "/studio/paradise-tv/",
"type_name": "Paradise TV"
},
{
"type_id": "/studio/nanhatv/",
"type_name": "ナンパTV"
},
{
"type_id": "/studio/marrion/",
"type_name": "MARRION"
},
{
"type_id": "/v2/studio/lunatics/",
"type_name": "LUNATICS"
},
{
"type_id": "/studio/hajime-kikaku/",
"type_name": "Hajime Kikaku"
},
{
"type_id": "/v7/studio/go-go-zu/",
"type_name": "Go-go-zu"
},
{
"type_id": "/studio/apache/",
"type_name": "Apache"
},
{
"type_id": "/studio/bigmorkal/",
"type_name": "BIGMORKAL"
},
{
"type_id": "/studio/sex-agent/",
"type_name": "SEX Agent"
},
{
"type_id": "/v29/studio/bullitt/",
"type_name": "Bullitt"
},
{
"type_id": "/v1/studio/nanpa-japan/",
"type_name": "Nanpa JAPAN"
},
{
"type_id": "/studio/bibian/",
"type_name": "bibian"
},
{
"type_id": "/studio/puresutezi/",
"type_name": "プレステージ"
},
{
"type_id": "/studio/jet-eizou/",
"type_name": "JET Eizou"
},
{
"type_id": "/studio/jet-eizo/",
"type_name": "JET Eizo"
},
{
"type_id": "/studio/hentai-shinshi-club/",
"type_name": "Hentai Shinshi Club"
},
{
"type_id": "/studio/shiroutomanman/",
"type_name": "しろうとまんまん"
},
{
"type_id": "/studio/media-bank/",
"type_name": "Media Bank"
},
{
"type_id": "/studio/audaz-japan/",
"type_name": "Audaz Japan"
},
{
"type_id": "/v1/studio/k-tribe/",
"type_name": "K-tribe"
},
{
"type_id": "/studio/spice-visual/",
"type_name": "Spice Visual"
},
{
"type_id": "/studio/bi/",
"type_name": "Bi"
},
{
"type_id": "/studio/nampa-japan/",
"type_name": "Nampa JAPAN"
},
{
"type_id": "/studio/mbm/",
"type_name": "MBM"
},
{
"type_id": "/studio/puramu/",
"type_name": "プラム"
},
{
"type_id": "/studio/pakopakodan-to-yukaina-nakamatachi/",
"type_name": "Pakopakodan to Yukaina Nakamatachi"
},
{
"type_id": "/studio/h0930/",
"type_name": "H0930"
},
{
"type_id": "/studio/unfinished/",
"type_name": "Unfinished"
},
{
"type_id": "/v1/studio/c0930/",
"type_name": "C0930"
},
{
"type_id": "/studio/hayabusa/",
"type_name": "Hayabusa"
},
{
"type_id": "/studio/baltan/",
"type_name": "Baltan"
},
{
"type_id": "/studio/dream-stage/",
"type_name": "Dream Stage"
},
{
"type_id": "/studio/s-kyuu-shirouto/",
"type_name": "S Kyuu Shirouto"
},
{
"type_id": "/studio/reddo/",
"type_name": "Reddo"
},
{
"type_id": "/studio/teppan/",
"type_name": "TEPPAN"
},
{
"type_id": "/studio/huresutesi/",
"type_name": "プレステージ"
},
{
"type_id": "/studio/toyohiko/",
"type_name": "Toyohiko"
},
{
"type_id": "/studio/ksb-kikaku-emmanuelle/",
"type_name": "KSB Kikaku/Emmanuelle"
},
{
"type_id": "/studio/fa-pro-platinum/",
"type_name": "FA Pro . Platinum"
},
{
"type_id": "/studio/sekimenjoshi/",
"type_name": "Sekimenjoshi"
},
{
"type_id": "/studio/wu-waihu/",
"type_name": "舞ワイフ"
},
{
"type_id": "/studio/vip/",
"type_name": "VIP"
},
{
"type_id": "/v11/studio/gos/",
"type_name": "GOS"
},
{
"type_id": "/studio/barutan/",
"type_name": "Barutan"
},
{
"type_id": "/studio/maza/",
"type_name": "Maza"
},
{
"type_id": "/studio/shy-kikaku/",
"type_name": "Shy Kikaku"
},
{
"type_id": "/studio/mellow-moon/",
"type_name": "Mellow Moon"
},
{
"type_id": "/studio/ara/",
"type_name": "ARA"
},
{
"type_id": "/studio/jukujo-japan/",
"type_name": "Jukujo JAPAN"
},
{
"type_id": "/studio/glayz/",
"type_name": "GLAYz"
},
{
"type_id": "/studio/golden-time/",
"type_name": "Golden Time"
},
{
"type_id": "/studio/daddy-s-private-photos/",
"type_name": "Daddy's Private Photos"
},
{
"type_id": "/v19/studio/peters/",
"type_name": "Peters"
},
{
"type_id": "/studio/mercury/",
"type_name": "MERCURY"
},
{
"type_id": "/studio/su-ren-clover/",
"type_name": "素人CLOVER"
},
{
"type_id": "/studio/insuta/",
"type_name": "いんすた"
},
{
"type_id": "/studio/milk/",
"type_name": "MILK"
},
{
"type_id": "/studio/jump/",
"type_name": "JUMP"
},
{
"type_id": "/v5/studio/next/",
"type_name": "NEXT"
},
{
"type_id": "/studio/onetime/",
"type_name": "ONETIME"
},
{
"type_id": "/studio/ke-toraibu/",
"type_name": "Ke- . Toraibu"
},
{
"type_id": "/studio/fetish-box-mousouzoku/",
"type_name": "Fetish Box / Mousouzoku"
},
{
"type_id": "/studio/afro-film/",
"type_name": "AFRO-FILM"
},
{
"type_id": "/studio/h4610/",
"type_name": "H4610"
},
{
"type_id": "/studio/geneisha/",
"type_name": "Geneisha"
},
{
"type_id": "/studio/aroma-kikaku/",
"type_name": "Aroma Kikaku"
},
{
"type_id": "/studio/kaguya-hime-pt-mousozoku/",
"type_name": "Kaguya Hime Pt / Mousozoku"
},
{
"type_id": "/v23/tag/creampie/",
"type_name": "Creampie"
},
{
"type_id": "/v13/tag/affair/",
"type_name": "Affair"
},
{
"type_id": "/v25/tag/amateur/",
"type_name": "Amateur"
},
{
"type_id": "/v6/tag/cuckold/",
"type_name": "Cuckold"
},
{
"type_id": "/v3/tag/female-college-student/",
"type_name": "Female College Student"
},
{
"type_id": "/v1/tag/first-creampie/",
"type_name": "First Creampie"
},
{
"type_id": "/v1/tag/gal/",
"type_name": "Gal"
},
{
"type_id": "/v4/tag/gonzo/",
"type_name": "Gonzo"
},
{
"type_id": "/v29/tag/married-woman/",
"type_name": "Married Woman"
},
{
"type_id": "/v1/tag/individual-shooting/",
"type_name": "Individual Shooting"
},
{
"type_id": "/v4/tag/masturbation/",
"type_name": "Masturbation"
},
{
"type_id": "/v2/tag/model/",
"type_name": "Model"
},
{
"type_id": "/v13/tag/nampa/",
"type_name": "Nampa"
},
{
"type_id": "/v3/tag/nurse/",
"type_name": "Nurse"
},
{
"type_id": "/v5/tag/ol/",
"type_name": "Ol"
},
{
"type_id": "/v9/tag/ntr/",
"type_name": "Ntr"
},
{
"type_id": "/v4/tag/original/",
"type_name": "Original"
},
{
"type_id": "/v1/tag/slender/",
"type_name": "Slender"
},
{
"type_id": "/v5/tag/squirting/",
"type_name": "Squirting"
},
{
"type_id": "/v18/tag/4hr/",
"type_name": "4HR+"
},
{
"type_id": "/v2/tag/3p-4p/",
"type_name": "3P, 4P"
},
{
"type_id": "/v1/tag/uniform/",
"type_name": "Uniform"
},
{
"type_id": "/v2/tag/30-s/",
"type_name": "30S"
},
{
"type_id": "/v1/tag/50-s/",
"type_name": "50S"
},
{
"type_id": "/v1/tag/40-s/",
"type_name": "40S"
},
{
"type_id": "/v1/tag/69/",
"type_name": "69"
},
{
"type_id": "/v5/tag/adultery/",
"type_name": "Adultery"
},
{
"type_id": "/v1/tag/abuse/",
"type_name": "Abuse"
},
{
"type_id": "/v3/tag/1080p/",
"type_name": "1080p"
},
{
"type_id": "/v3/tag/adult-movie/",
"type_name": "Adult Movie"
},
{
"type_id": "/v2/tag/ami-kiuchi-akina-sakura/",
"type_name": "Ami Kiuchi, Akina Sakura"
},
{
"type_id": "/v1/tag/anal-play/",
"type_name": "Anal Play"
},
{
"type_id": "/v2/tag/anal/",
"type_name": "Anal"
},
{
"type_id": "/v1/tag/anal-sex/",
"type_name": "Anal Sex"
},
{
"type_id": "/v1/tag/anal-training/",
"type_name": "Anal Training"
},
{
"type_id": "/v5/tag/anna/",
"type_name": "Anna"
},
{
"type_id": "/v4/tag/anri/",
"type_name": "Anri"
},
{
"type_id": "/v1/tag/aokan/",
"type_name": "aokan"
},
{
"type_id": "/v1/tag/aozora-sex/",
"type_name": "Aozora Sex"
},
{
"type_id": "/v4/tag/av-actress/",
"type_name": "Av Actress"
},
{
"type_id": "/v8/tag/av-open-2015-cougar-division/",
"type_name": "AV OPEN 2015 Cougar Division"
},
{
"type_id": "/v5/tag/aya/",
"type_name": "Aya"
},
{
"type_id": "/v11/tag/bareback/",
"type_name": "Bareback"
},
{
"type_id": "/v1/tag/bbw/",
"type_name": "Bbw"
},
{
"type_id": "/v11/tag/beautiful-girl/",
"type_name": "Beautiful Girl"
},
{
"type_id": "/v2/tag/beautiful-tits/",
"type_name": "Beautiful Tits"
},
{
"type_id": "/v1/tag/beautiful-pussy/",
"type_name": "Beautiful Pussy"
},
{
"type_id": "/v2/tag/beauty-shop/",
"type_name": "Beauty Shop"
},
{
"type_id": "/v25/tag/big-tits/",
"type_name": "Big-tits"
},
{
"type_id": "/v1/tag/beautiful-woman/",
"type_name": "Beautiful Woman"
},
{
"type_id": "/v2/tag/best-omnibus/",
"type_name": "Best, Omnibus"
},
{
"type_id": "/v1/tag/big-asses/",
"type_name": "Big Asses"
},
{
"type_id": "/v1/tag/big-vibrator/",
"type_name": "Big Vibrator"
},
{
"type_id": "/v2/tag/big-tits-lover/",
"type_name": "Big Tits Lover"
},
{
"type_id": "/v1/tag/bikyaku/",
"type_name": "Bikyaku"
},
{
"type_id": "/v1/tag/binyuu/",
"type_name": "Binyuu"
},
{
"type_id": "/v1/tag/bishiri/",
"type_name": "Bishiri"
},
{
"type_id": "/v1/tag/black-man/",
"type_name": "Black Man"
},
{
"type_id": "/v1/tag/black-hair/",
"type_name": "Black Hair"
},
{
"type_id": "/v4/tag/blowjob/",
"type_name": "Blowjob"
},
{
"type_id": "/v1/tag/bontage/",
"type_name": "bontage"
},
{
"type_id": "/v4/tag/breasts/",
"type_name": "Breasts"
},
{
"type_id": "/v1/tag/breast-milk/",
"type_name": "Breast Milk"
},
{
"type_id": "/v1/tag/bribri/",
"type_name": "Bribri"
},
{
"type_id": "/v2/tag/bukkake/",
"type_name": "BUKKAKE"
},
{
"type_id": "/v1/tag/celebrity/",
"type_name": "Celebrity"
},
{
"type_id": "/v5/tag/c-cup/",
"type_name": "C Cup"
},
{
"type_id": "/v42/tag/censored/",
"type_name": "Censored"
},
{
"type_id": "/v1/tag/changing-room/",
"type_name": "Changing Room"
},
{
"type_id": "/v7/tag/cheating-wife/",
"type_name": "Cheating Wife"
},
{
"type_id": "/v4/tag/cherry-boy/",
"type_name": "Cherry Boy"
},
{
"type_id": "/v6/tag/chihiro-akino/",
"type_name": "Chihiro Akino"
},
{
"type_id": "/v1/tag/chijyo/",
"type_name": "Chijyo"
},
{
"type_id": "/v1/tag/chikan/",
"type_name": "chikan"
},
{
"type_id": "/v1/tag/chubby/",
"type_name": "Chubby"
},
{
"type_id": "/v1/tag/clear/",
"type_name": "Clear"
},
{
"type_id": "/v1/tag/clothed-titty-fuck/",
"type_name": "Clothed Titty Fuck"
},
{
"type_id": "/v9/tag/compilation/",
"type_name": "Compilation"
},
{
"type_id": "/v2/tag/cosplay/",
"type_name": "Cosplay"
},
{
"type_id": "/v3/tag/college-girl/",
"type_name": "College Girl"
},
{
"type_id": "/v2/tag/confinement/",
"type_name": "Confinement"
},
{
"type_id": "/v2/tag/couple/",
"type_name": "Couple"
},
{
"type_id": "/v3/tag/cowgirl/",
"type_name": "Cowgirl"
},
{
"type_id": "/v1/tag/couple-swapping/",
"type_name": "Couple Swapping"
},
{
"type_id": "/v1/tag/cross-dressing/",
"type_name": "Cross Dressing"
},
{
"type_id": "/v3/tag/cunnilingus/",
"type_name": "Cunnilingus"
},
{
"type_id": "/v1/tag/deep-throating/",
"type_name": "Deep Throating"
},
{
"type_id": "/v1/tag/dead-drunk/",
"type_name": "Dead Drunk"
},
{
"type_id": "/v1/tag/debut/",
"type_name": "Debut"
},
{
"type_id": "/v1/tag/cyoushin/",
"type_name": "Cyoushin"
},
{
"type_id": "/v7/tag/dildo/",
"type_name": "Dildo"
},
{
"type_id": "/v1/tag/dirty-talk/",
"type_name": "Dirty Talk"
},
{
"type_id": "/v4/tag/drama/",
"type_name": "Drama"
},
{
"type_id": "/v1/tag/dmm-exclusive/",
"type_name": "DMM Exclusive"
},
{
"type_id": "/v6/tag/documentary/",
"type_name": "Documentary"
},
{
"type_id": "/v1/tag/eatpussy/",
"type_name": "Eatpussy"
},
{
"type_id": "/v2/tag/exclusive/",
"type_name": "Exclusive"
},
{
"type_id": "/v1/tag/exposure/",
"type_name": "Exposure"
},
{
"type_id": "/v9/tag/extra-movie/",
"type_name": "Extra Movie"
},
{
"type_id": "/v1/tag/fairness/",
"type_name": "Fairness"
},
{
"type_id": "/v1/tag/fair-skin/",
"type_name": "Fair Skin"
},
{
"type_id": "/v2/tag/fan-appreciation-home-visit/",
"type_name": "Fan Appreciation/ Home Visit"
},
{
"type_id": "/v16/tag/featured-actress/",
"type_name": "Featured Actress"
},
{
"type_id": "/v56/tag/fc2/",
"type_name": "Fc2"
},
{
"type_id": "/v11/tag/fc2-ppv/",
"type_name": "Fc2-Ppv"
},
{
"type_id": "/v1/tag/fellatio/",
"type_name": "Fellatio"
},
{
"type_id": "/v1/tag/female-boss/",
"type_name": "Female Boss"
},
{
"type_id": "/v1/tag/female-doctor/",
"type_name": "Female Doctor"
},
{
"type_id": "/v1/tag/female-investigator/",
"type_name": "Female Investigator"
},
{
"type_id": "/v3/tag/female-teacher/",
"type_name": "Female Teacher"
},
{
"type_id": "/v2/tag/fetish/",
"type_name": "Fetish"
},
{
"type_id": "/v1/tag/fisting/",
"type_name": "Fisting"
},
{
"type_id": "/v1/tag/foot-fetish/",
"type_name": "Foot Fetish"
},
{
"type_id": "/v3/tag/fingering/",
"type_name": "Fingering"
},
{
"type_id": "/v2/tag/first-time-drinking-semen/",
"type_name": "First Time Drinking Semen"
},
{
"type_id": "/v1/tag/gansha/",
"type_name": "Gansha"
},
{
"type_id": "/v1/tag/gym-clothes/",
"type_name": "Gym Clothes"
},
{
"type_id": "/v1/tag/golden-shower/",
"type_name": "Golden Shower"
},
{
"type_id": "/v3/tag/groping/",
"type_name": "Groping"
},
{
"type_id": "/v1/tag/gbei/",
"type_name": "G杯"
},
{
"type_id": "/v1/tag/hame/",
"type_name": "Hame"
},
{
"type_id": "/v5/tag/handjob/",
"type_name": "Handjob"
},
{
"type_id": "/v1/tag/h-cup/",
"type_name": "H Cup"
},
{
"type_id": "/v1/tag/hentai/",
"type_name": "hentai"
},
{
"type_id": "/v18/tag/hi-def/",
"type_name": "Hi-Def"
},
{
"type_id": "/v2/tag/homemade/",
"type_name": "Homemade"
},
{
"type_id": "/v2/tag/himari/",
"type_name": "Himari"
},
{
"type_id": "/v10/tag/hotel/",
"type_name": "Hotel"
},
{
"type_id": "/v1/tag/huge-butt/",
"type_name": "Huge Butt"
},
{
"type_id": "/v1/tag/how-to/",
"type_name": "How To"
},
{
"type_id": "/v2/tag/hot-spring/",
"type_name": "Hot Spring"
},
{
"type_id": "/v3/tag/huge-tits/",
"type_name": "Huge Tits"
},
{
"type_id": "/v5/tag/humiliation/",
"type_name": "Humiliation"
},
{
"type_id": "/v1/tag/ingo/",
"type_name": "Ingo"
},
{
"type_id": "/v1/tag/internal-ejaculation/",
"type_name": "Internal Ejaculation"
},
{
"type_id": "/v1/tag/iramatio/",
"type_name": "Iramatio"
},
{
"type_id": "/v1/tag/kaori/",
"type_name": "Kaori"
},
{
"type_id": "/v4/tag/kawaii/",
"type_name": "Kawaii"
},
{
"type_id": "/v1/tag/k-cup/",
"type_name": "K Cup"
},
{
"type_id": "/v5/tag/kimono/",
"type_name": "KIMONO"
},
{
"type_id": "/v1/tag/kimono-mourning/",
"type_name": "Kimono, Mourning"
},
{
"type_id": "/v2/tag/kimonoyukata/",
"type_name": "Kimono・Yukata"
},
{
"type_id": "/v2/tag/kiss-kiss/",
"type_name": "Kiss Kiss"
},
{
"type_id": "/v1/tag/kosupre/",
"type_name": "Kosupre"
},
{
"type_id": "/v1/tag/kusco/",
"type_name": "kusco"
},
{
"type_id": "/v2/tag/kyonyu/",
"type_name": "kyonyu"
},
{
"type_id": "/v6/tag/lesbian-kissing/",
"type_name": "Lesbian Kissing"
},
{
"type_id": "/v37/tag/lesbian/",
"type_name": "Lesbian"
},
{
"type_id": "/v13/tag/lotion/",
"type_name": "Lotion"
},
{
"type_id": "/v1/tag/m-jo/",
"type_name": "M-jo"
},
{
"type_id": "/v3/tag/madonna/",
"type_name": "Madonna"
},
{
"type_id": "/v1/tag/maid-cosplay/",
"type_name": "Maid Cosplay"
},
{
"type_id": "/v1/tag/mask/",
"type_name": "Mask"
},
{
"type_id": "/v6/tag/massage/",
"type_name": "Massage"
},
{
"type_id": "/v17/tag/massage-parlor/",
"type_name": "Massage Parlor"
},
{
"type_id": "/v4/tag/masterbation/",
"type_name": "masterbation"
},
{
"type_id": "/v29/tag/mature-woman/",
"type_name": "Mature Woman"
},
{
"type_id": "/v2/tag/milf/",
"type_name": "MILF"
},
{
"type_id": "/v1/tag/masturbation-support/",
"type_name": "Masturbation Support"
},
{
"type_id": "/v1/tag/mother/",
"type_name": "Mother"
},
{
"type_id": "/v1/tag/nasty-hardcore/",
"type_name": "Nasty, Hardcore"
},
{
"type_id": "/v6/tag/natsuki/",
"type_name": "Natsuki"
},
{
"type_id": "/v1/tag/neat-and-clean/",
"type_name": "Neat And Clean"
},
{
"type_id": "/v1/tag/netori/",
"type_name": "Netori"
},
{
"type_id": "/v3/tag/nicetitties/",
"type_name": "nicetitties"
},
{
"type_id": "/v11/tag/new-original-movie/",
"type_name": "New Original Movie"
},
{
"type_id": "/v1/tag/nymphomaniac/",
"type_name": "Nymphomaniac"
},
{
"type_id": "/v11/tag/office-ks-sod-sale/",
"type_name": "OFFICE K’S / SOD SALE"
},
{
"type_id": "/v17/tag/office-lady/",
"type_name": "Office Lady"
},
{
"type_id": "/v1/tag/ona-support/",
"type_name": "Ona Support"
},
{
"type_id": "/v7/tag/older-sister/",
"type_name": "Older Sister"
},
{
"type_id": "/v1/tag/orgasm/",
"type_name": "Orgasm"
},
{
"type_id": "/v3/tag/orgy/",
"type_name": "Orgy"
},
{
"type_id": "/v1/tag/outdoors/",
"type_name": "Outdoors"
},
{
"type_id": "/v21/tag/over-4-hours/",
"type_name": "Over 4 Hours"
},
{
"type_id": "/v1/tag/other-fetish/",
"type_name": "Other Fetish"
},
{
"type_id": "/v2/tag/other-fetishes/",
"type_name": "Other Fetishes"
},
{
"type_id": "/v1/tag/outdoor/",
"type_name": "Outdoor"
},
{
"type_id": "/v1/tag/peach-butt/",
"type_name": "Peach Butt"
},
{
"type_id": "/v1/tag/pajamas/",
"type_name": "Pajamas"
},
{
"type_id": "/v1/tag/panty-shot/",
"type_name": "Panty Shot"
},
{
"type_id": "/v2/tag/panty-shots/",
"type_name": "Panty Shots"
},
{
"type_id": "/v1/tag/personal-photoshoot/",
"type_name": "Personal Photoshoot"
},
{
"type_id": "/v23/tag/picking-up-girls/",
"type_name": "Picking Up Girls"
},
{
"type_id": "/v2/tag/pissingincontinence/",
"type_name": "Pissing・Incontinence"
},
{
"type_id": "/v1/tag/petite/",
"type_name": "Petite"
},
{
"type_id": "/v8/tag/planning/",
"type_name": "Planning"
},
{
"type_id": "/v1/tag/prank/",
"type_name": "Prank"
},
{
"type_id": "/v1/tag/porn-star/",
"type_name": "Porn Star"
},
{
"type_id": "/v3/tag/premium/",
"type_name": "Premium"
},
{
"type_id": "/v5/tag/pov/",
"type_name": "POV"
},
{
"type_id": "/v4/tag/pranks/",
"type_name": "Pranks"
},
{
"type_id": "/v6/tag/promiscuity/",
"type_name": "Promiscuity"
},
{
"type_id": "/v1/tag/rankou/",
"type_name": "Rankou"
},
{
"type_id": "/v1/tag/raw-saddle/",
"type_name": "Raw Saddle"
},
{
"type_id": "/v1/tag/quickie/",
"type_name": "Quickie"
},
{
"type_id": "/v4/tag/reversed-role/",
"type_name": "Reversed Role"
},
{
"type_id": "/v22/tag/red-hot-fetish-collection/",
"type_name": "Red Hot Fetish Collection"
},
{
"type_id": "/v2/tag/rental-girlfriend/",
"type_name": "Rental Girlfriend"
},
{
"type_id": "/v1/tag/relatives/",
"type_name": "Relatives"
},
{
"type_id": "/v1/tag/reverse-pick-up/",
"type_name": "Reverse Pick-Up"
},
{
"type_id": "/v15/tag/rocket/",
"type_name": "Rocket"
},
{
"type_id": "/v1/tag/runa/",
"type_name": "Runa"
},
{
"type_id": "/v1/tag/rolling-back-eyes-fainting/",
"type_name": "Rolling Back Eyes / Fainting"
},
{
"type_id": "/v1/tag/rough-sex/",
"type_name": "Rough Sex"
},
{
"type_id": "/v4/tag/s-cute-prestige-gogos-sale/",
"type_name": "S-Cute / Prestige / Gogos SALE"
},
{
"type_id": "/v1/tag/sale-limited-time/",
"type_name": "Sale (limited time)"
},
{
"type_id": "/v1/tag/school-girls/",
"type_name": "School Girls"
},
{
"type_id": "/v11/tag/schoolgirl/",
"type_name": "Schoolgirl"
},
{
"type_id": "/v2/tag/sauna/",
"type_name": "Sauna"
},
{
"type_id": "/v1/tag/secretary/",
"type_name": "Secretary"
},
{
"type_id": "/v5/tag/school-uniform/",
"type_name": "School Uniform"
},
{
"type_id": "/v4/tag/series/",
"type_name": "Series"
},
{
"type_id": "/v4/tag/sex-toys/",
"type_name": "Sex Toys"
},
{
"type_id": "/v1/tag/sexy-legs/",
"type_name": "Sexy Legs"
},
{
"type_id": "/v2/tag/shaved-pussy/",
"type_name": "Shaved Pussy"
},
{
"type_id": "/v1/tag/shame/",
"type_name": "Shame"
},
{
"type_id": "/v1/tag/shemale/",
"type_name": "Shemale"
},
{
"type_id": "/v6/tag/she/",
"type_name": "She"
},
{
"type_id": "/v1/tag/shiofuki/",
"type_name": "Shiofuki"
},
{
"type_id": "/v8/tag/sister/",
"type_name": "Sister"
},
{
"type_id": "/v1/tag/sixtynine/",
"type_name": "Sixtynine"
},
{
"type_id": "/v4/tag/small-tits/",
"type_name": "Small Tits"
},
{
"type_id": "/v10/tag/slut/",
"type_name": "Slut"
},
{
"type_id": "/v8/tag/solowork/",
"type_name": "Solowork"
},
{
"type_id": "/v1/tag/sperm-donation/",
"type_name": "Sperm Donation"
},
{
"type_id": "/v1/tag/sokkuri/",
"type_name": "sokkuri"
},
{
"type_id": "/v1/tag/special-smartphone-vertical-video/",
"type_name": "Special Smartphone Vertical Video"
},
{
"type_id": "/v1/tag/sport/",
"type_name": "Sport"
},
{
"type_id": "/v1/tag/sports/",
"type_name": "Sports"
},
{
"type_id": "/v2/tag/submissive-men/",
"type_name": "Submissive Men"
},
{
"type_id": "/v1/tag/stepmom/",
"type_name": "Stepmom"
},
{
"type_id": "/v1/tag/strong-sexual-desire/",
"type_name": "Strong Sexual Desire"
},
{
"type_id": "/v1/tag/stewardess/",
"type_name": "Stewardess"
},
{
"type_id": "/v1/tag/substance-use/",
"type_name": "Substance Use"
},
{
"type_id": "/v10/tag/subtitles/",
"type_name": "Subtitles"
},
{
"type_id": "/v1/tag/swallow/",
"type_name": "Swallow"
},
{
"type_id": "/v3/tag/threesome-foursome/",
"type_name": "Threesome / Foursome"
},
{
"type_id": "/v5/tag/titty-fuck/",
"type_name": "Titty Fuck"
},
{
"type_id": "/v1/tag/tittyfuck/",
"type_name": "Tittyfuck"
},
{
"type_id": "/v2/tag/too-wet/",
"type_name": "Too Wet"
},
{
"type_id": "/v1/tag/training/",
"type_name": "Training"
},
{
"type_id": "/v1/tag/toys/",
"type_name": "Toys"
},
{
"type_id": "/v1/tag/transformed-heroine/",
"type_name": "Transformed Heroine"
},
{
"type_id": "/v4/tag/transsexual/",
"type_name": "Transsexual"
},
{
"type_id": "/v9/tag/trip/",
"type_name": "Trip"
},
{
"type_id": "/v3/tag/two-consecutive-creampies/",
"type_name": "Two Consecutive Creampies"
},
{
"type_id": "/v1/tag/tutor/",
"type_name": "Tutor"
},
{
"type_id": "/v2/tag/ultra-huge-tits/",
"type_name": "Ultra-Huge Tits"
},
{
"type_id": "/v12/tag/uncensored/",
"type_name": "Uncensored"
},
{
"type_id": "/v1/tag/underwear/",
"type_name": "Underwear"
},
{
"type_id": "/v1/tag/user-submission/",
"type_name": "User Submission"
},
{
"type_id": "/v1/tag/urination/",
"type_name": "Urination"
},
{
"type_id": "/v5/tag/various-worker/",
"type_name": "Various Worker"
},
{
"type_id": "/v25/tag/variety/",
"type_name": "Variety"
},
{
"type_id": "/v1/tag/vibe/",
"type_name": "Vibe"
},
{
"type_id": "/v5/tag/vibrator/",
"type_name": "Vibrator"
},
{
"type_id": "/v5/tag/virgin-man/",
"type_name": "Virgin Man"
},
{
"type_id": "/v14/tag/voyeur/",
"type_name": "Voyeur"
},
{
"type_id": "/v1/tag/yokui/",
"type_name": "Yokui"
},
{
"type_id": "/v2/tag/youthful/",
"type_name": "Youthful"
},
{
"type_id": "/v1/tag/yukata/",
"type_name": "Yukata"
},
{
"type_id": "/v1/tag/huruhaibiziyon-fhd/",
"type_name": "フルハイビジョン(FHD)"
},
{
"type_id": "/v1/tag/wu-shi-lu/",
"type_name": "五十路"
},
{
"type_id": "/v2/tag/pei-xin-zhuan-yong-su-ren/",
"type_name": "配信専用素人"
}
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ');
}

function absUrl(u) {
  u = t(u);
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return HOST + (u.startsWith('/') ? u : '/' + u);
}

// ---------- 抓取层 (第五轮: 解析型校验 + 扩容通道池竞速) ----------
// 2026-10-22 第五轮 (与 javhdporn 同步)。第四轮真机仍全灭后, 逐
// 通道原始应答复测 (VM 出口, 原始应答与校验判定分开记录):
//   直连 fetch、jina(html 模式): 两站均 200 真页 (0.1~2s);
//   allorigins /raw、codetabs: 当日全程 522 (各烧约 20s);
//   allorigins /get (JSON 包装, 旧版未用): 对本站可用 (2/2 真页,
//     7~8s), 对 javhdporn 被其出口挡 —— 两站区域规则不一致;
//   新通道 test.cors.workers.dev (Cloudflare 官方 CORS demo, 须带
//     X-Requested-With 头): GET 对规范 URL 直出真页且极快
//     (0.1~1.5s); POST /api/play/ 转发 body 后回本站真 JSON
//     (status:true, 与直连应答逐字节一致, 120ms) —— GET/POST
//     双通道成立。但目标 URL 若会 301 (如 /search/ 的无前缀
//     形态), 它回自己的说明页, 故该通道对 /search/ 喂学习到的
//     规范前缀 (从成功页面的 /v{n}/ 链接学习);
//   框架 req (axios) 在 VM 沙箱被出口代理 ECONNRESET (连
//     httpbin 都挂), 属沙箱假象; 其线上 UA 经回显实测确为蜘蛛
//     所设 Chrome UA —— 前轮"蜘蛛 UA 不生效"无直接证据, 本轮
//     按"多栈并存、不押单栈"设计。
// (推导, 非实测) 真机全灭的最合理解释仍是出口差异: 用户运行时
// 出口下直连各栈与 jina (大陆不可达) 同时失效时, 第四轮只剩
// 当时全 522 的中转组。本轮对策与 javhdporn 同构: 通道池扩容
// (workers.dev + allorigins/get + 原生 https 栈) 全部竞速;
// 校验改解析型 (列表=能解出卡片, 详情=带 data-mpu/og 标记,
// embed=带 data-config), 杜绝误杀与误收; 慢中转只进第二波且
// 封顶; 全灭回空, 不再回未校验残页。
import https from 'https';
import zlib from 'zlib';

function isShellPage(s) {
  return /Attention Required|Just a moment|cf-challenge|Checking your browser/i.test(s || '');
}
// 解析型校验 (parseCards 为函数声明, 已提升)
function validListPage(html) {
  return !!html && !isShellPage(html) && parseCards(html).length > 0;
}
function validDetailPage(html) {
  return !!html && !isShellPage(html) && html.length > 4000 &&
    (html.includes('data-mpu') || html.includes('video-id=') || /property="og:title"/.test(html));
}
function validEmbedPage(html) {
  return !!html && !isShellPage(html) && html.length > 200 && html.includes('data-config');
}
function validFor(url, html, kind) {
  if (kind === 'detail') return validDetailPage(html);
  if (kind === 'embed') return validEmbedPage(html);
  return validListPage(html);
}

async function fetchRaw(url, headers, timeout, method, body) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeout || 12000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow', method: method || 'GET', body });
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally { clearTimeout(to); }
}

async function viaReqGet(url, headers, timeout) {
  try {
    const { data, status } = await req.get(url, { headers, timeout: timeout || 12000 });
    if ((!status || status === 200) && data != null && data !== '') {
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
  } catch (e) { /* 落空 */ }
  return '';
}

// 原生 https 栈 (独立代码路径; 手工重定向 + 解压)
function viaHttps(url, headers, timeoutMs, depth = 0) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const u = new URL(url);
      const rq = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: { ...headers, 'Accept-Encoding': 'gzip, deflate, br' },
        timeout: timeoutMs || 12000,
      }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          res.resume();
          fin(viaHttps(new URL(loc, url).toString(), headers, timeoutMs, depth + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); fin(''); return; }
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '');
        try {
          if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
          else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
          else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        } catch (e) { /* 按原文读 */ }
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => fin(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', () => fin(''));
      });
      rq.on('timeout', () => { rq.destroy(); fin(''); });
      rq.on('error', () => fin(''));
      rq.end();
    } catch (e) { fin(''); }
  });
}

// workers.dev 通道: /search/ 需规范前缀 (从成功页学习; 分类路径
// 的 type_id 本就带前缀, 详情 /video/ 本就规范, 均不改写)
let learnedPrefix = '';
function notePrefix(html) {
  const m = String(html || '').match(/bestjavporn\.com(\/v\d+)\/search\//);
  if (m) { learnedPrefix = m[1]; return; }
  if (!learnedPrefix) {
    const m2 = String(html || '').match(/bestjavporn\.com(\/v\d+)\//);
    if (m2) learnedPrefix = m2[1];
  }
}
function wdTarget(url) {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/search/') && learnedPrefix) u.pathname = learnedPrefix + u.pathname;
    return u.toString();
  } catch (e) { return url; }
}
const WD_HEADERS = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Origin: HOST };
async function viaWorkersDemo(url, timeout) {
  return fetchRaw('https://test.cors.workers.dev/?' + wdTarget(url), WD_HEADERS, timeout || 12000);
}

async function viaJina(url, timeout) {
  return fetchRaw('https://r.jina.ai/' + url, {
    'User-Agent': UA,
    'x-respond-with': 'html',
  }, timeout || 12000);
}

async function viaAlloriginsGet(url, timeout) {
  const txt = await fetchRaw('https://api.allorigins.win/get?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeout || 15000);
  if (!txt) return '';
  try {
    const j = JSON.parse(txt);
    return typeof j.contents === 'string' ? j.contents : '';
  } catch (e) { return ''; }
}

async function viaAlloriginsRaw(url, timeout) {
  return fetchRaw('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeout || 15000);
}

async function viaCodetabs(url, timeout) {
  return fetchRaw('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeout || 12000);
}

async function raceValid(fns, valid) {
  const jobs = fns.map((fn) => (async () => {
    let html = '';
    try { html = await fn(); } catch (e) { html = ''; }
    if (valid(html)) return html;
    throw new Error('invalid page');
  })());
  return Promise.any(jobs);
}

async function httpGet(url, opts = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
    'Referer': opts.referer || REFERER,
  };
  const valid = (html) => validFor(url, html, opts.kind);
  // embed 页小而多 (detail 并行解 ≤8 条): 用精简通道组, 避免
  // 每条 embed 都拉满 6 通道造成连接风暴 (harness 追踪实测全量
  // 竞速下 embed 阶段被并发拖到 12s+; 精简后回落到 ~2s 级)。
  const isEmbed = opts.kind === 'embed';
  const wave1 = isEmbed ? [
    () => fetchRaw(url, headers, 10000),
    () => viaWorkersDemo(url, 10000),
    () => viaReqGet(url, headers, 10000),
  ] : [
    () => fetchRaw(url, headers, 12000),
    () => viaReqGet(url, headers, 12000),
    () => viaHttps(url, headers, 12000),
    () => viaWorkersDemo(url, 12000),
    () => viaJina(url, 12000),
    () => viaAlloriginsGet(url, 15000),
  ];
  try {
    const html = await raceValid(wave1, valid);
    notePrefix(html);
    return html;
  } catch (e) { /* 第一波全灭, 进第二波 */ }
  const wave2 = isEmbed ? [
    () => viaJina(url, 10000),
    () => viaAlloriginsGet(url, 12000),
  ] : [
    () => viaAlloriginsRaw(url, 15000),
    () => viaCodetabs(url, 12000),
    () => viaJina(url, 10000),
    () => viaWorkersDemo(url, 10000),
  ];
  try {
    const html = await raceValid(wave2, valid);
    notePrefix(html);
    return html;
  } catch (e) { /* 全灭: 回空 */ }
  return '';
}

function validPlayResp(text) {
  // 必须 status === true 才算铸造成功 (第四轮已坐实: allorigins
  // 转发 POST 会丢 body, 站方回 {"status":false,...} 假成功)。
  if (!text) return false;
  try {
    const j = JSON.parse(text);
    return !!j && typeof j === 'object' && j.status === true;
  } catch (e) { return false; }
}

async function postViaAllorigins(url, bodyStr, headers, timeout) {
  const relay = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeout || 10000);
  try {
    const r = await fetch(relay, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': headers['User-Agent'] || UA },
      body: bodyStr,
      signal: ctl.signal,
    });
    if (r.ok) {
      const text = await r.text();
      if (validPlayResp(text)) return text;
    }
  } catch (e) { /* 落空 */ } finally { clearTimeout(to); }
  return '';
}

async function httpPostForm(url, bodyStr, opts = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': opts.referer || REFERER,
    'Origin': HOST,
  };
  // 第一波: 直连 fetch / 直连 req / workers.dev 转发 (实测回真
  // JSON 且最快); 第二波: allorigins 转发兜底。总截止约 22s,
  // 铸造全灭时快速落嗅探, 不陪慢通道死等。
  const wave1 = [
    async () => { // 直连 fetch
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 12000);
      try {
        const r = await fetch(url, { method: 'POST', headers, body: bodyStr, signal: ctl.signal, redirect: 'follow' });
        if (r.ok) return await r.text();
      } catch (e) { /* 落空 */ } finally { clearTimeout(to); }
      return '';
    },
    async () => { // 直连 req (axios)
      try {
        const { data, status } = await req.post(url, bodyStr, { headers, timeout: 12000 });
        if ((!status || status === 200) && data != null && data !== '') {
          return typeof data === 'string' ? data : JSON.stringify(data);
        }
      } catch (e) { /* 落空 */ }
      return '';
    },
    async () => fetchRaw('https://test.cors.workers.dev/?' + url, {
      ...WD_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded',
    }, 12000, 'POST', bodyStr),
  ];
  try { return await raceValid(wave1, validPlayResp); } catch (e) { /* 进第二波 */ }
  try { return await raceValid([() => postViaAllorigins(url, bodyStr, headers, 10000)], validPlayResp); }
  catch (e) { return ''; }
}


// ---------- 页面缓存 (详情供 play 复用, 省一次整链) ----------
const pageCache = new Map();
function cacheGet(url, ttl) {
  const e = pageCache.get(url);
  if (e && Date.now() - e.t < ttl) return e.s;
  return '';
}
function cacheSet(url, s) {
  pageCache.set(url, { t: Date.now(), s });
  if (pageCache.size > 60) pageCache.delete(pageCache.keys().next().value);
}
async function getDetailHtml(durl) {
  const hit = cacheGet(durl, 300000);
  if (hit) return hit;
  const html = await httpGet(durl, { timeout: 18000, kind: 'detail' });
  if (html) cacheSet(durl, html);
  return html;
}

// ---------- 列表解析 ----------
function parseCards(html) {
  const out = [];
  const re = /<article[^>]*class="[^"]*thumb-block[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    if (/thumb-block-native-ad|native-banner/.test(m[0])) continue;
    const a = block.match(/<a href="(https:\/\/(?:www\.)?bestjavporn\.com\/(?:v\d+\/)?video\/[^"]+)" title="([^"]*)"/);
    if (!a) continue;
    const img = block.match(/data-lazy-src="([^"]+)"/) || block.match(/data-wpsrc="([^"]+)"/);
    const dur = block.match(/<span class="duration">[\s\S]*?([\d]{1,2}:[\d]{2}(?::[\d]{2})?)\s*<\/span>/);
    const views = block.match(/<span class="views">[\s\S]*?([\d,]+)\s*<\/span>/);
    const remarks = [dur ? dur[1] : '', views ? views[1] + ' views' : ''].filter(Boolean).join(' · ');
    out.push({
      vod_id: a[1],
      vod_name: clean(a[2]),
      vod_pic: img ? img[1] : '',
      vod_remarks: remarks,
    });
  }
  return out;
}

function pagecountOf(html) {
  // 只看分页块内的页码 (页面别处也有 /page/N/ 链接, 会报出假总页数)
  const block = (String(html).match(/<div class="pagination">([\s\S]*?)<\/div>/) || [])[1] || '';
  let max = 1;
  const re = /\/page\/(\d+)\//g;
  let m;
  while ((m = re.exec(block))) max = Math.max(max, parseInt(m[1], 10) || 1);
  return max;
}

// ---------- 纯 JS 密码件 (与站方 cast.js / video main.js 同构) ----------
const B64CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64REV = (() => {
  const o = {};
  for (let i = 0; i < B64CH.length; i++) o[B64CH[i]] = i;
  o['-'] = 62; o['_'] = 63;
  return o;
})();

function b64ToBytes(s) {
  const str = String(s || '').replace(/[^A-Za-z0-9+/=_-]/g, '');
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of str) {
    if (ch === '=') break;
    const v = B64REV[ch];
    if (v == null) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64CH[a >> 2] + B64CH[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? B64CH[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? B64CH[c & 63] : '=');
  }
  return s;
}

function strToB64(str) { // ASCII/UTF-8 安全的 btoa 等价 (入参均为 ASCII)
  return bytesToB64(new TextEncoder().encode(String(str || '')));
}

function bytesToLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return s;
}

function bytesToUtf8(bytes) {
  try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return bytesToLatin1(bytes); }
}

function rc4(keyStr, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  const kb = [];
  for (let i = 0; i < keyStr.length; i++) kb.push(keyStr.charCodeAt(i) & 0xff);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + kb[i % kb.length]) & 0xff;
    const tmp = S[i]; S[i] = S[j]; S[j] = tmp;
  }
  let a = 0; j = 0;
  const out = new Uint8Array(data.length);
  for (let n = 0; n < data.length; n++) {
    a = (a + 1) & 0xff;
    j = (j + S[a]) & 0xff;
    const tmp = S[a]; S[a] = S[j]; S[j] = tmp;
    out[n] = data[n] ^ S[(S[a] + S[j]) & 0xff];
  }
  return out;
}

// dex(seed, data) = b64decode( RC4( reverse(b64(seed + '_0x58fe15')), b64decode(data) ) )
function dex(seed, data) {
  const key = strToB64(String(seed) + '_0x58fe15').split('').reverse().join('');
  const mid = bytesToLatin1(rc4(key, b64ToBytes(data)));
  return bytesToLatin1(b64ToBytes(mid));
}
function dexUtf8(seed, data) {
  const key = strToB64(String(seed) + '_0x58fe15').split('').reverse().join('');
  const mid = bytesToLatin1(rc4(key, b64ToBytes(data)));
  return bytesToUtf8(b64ToBytes(mid));
}

// embed 页 data-config 解密: key = reverse( b64( b64(pathname+search).substr(4,20) + '_0x59a0e4' ) )
function decryptConfig(cfgB64, pathname, search) {
  const arg = strToB64(String(pathname) + String(search)).substring(4, 20);
  const key = strToB64(arg + '_0x59a0e4').split('').reverse().join('');
  const pt = bytesToLatin1(rc4(key, b64ToBytes(cfgB64)));
  const json = JSON.parse(bytesToUtf8(b64ToBytes(pt)));
  const sources = JSON.parse(bytesToUtf8(b64ToBytes(json.src || '')));
  return { json, sources };
}

// ---------- 播放解析 ----------
function extractPlaySeed(html) {
  const postId = (html.match(/id="video-player-area"[^>]*video-id="(\d+)"/) || html.match(/video-id="(\d+)"/) || [])[1] || '';
  const mpu = (html.match(/data-mpu="([^"]+)"/) || [])[1] || '';
  return { postId, mpu };
}

// 调 /api/play/ 并解出全部线路的 embed 路径: [{lo, path}]
async function fetchEmbedPaths(postId, mpu, referer) {
  const token = dex(postId, mpu);
  const body = 'sources=' + encodeURIComponent(token) + '&ver=2';
  const text = await httpPostForm(HOST + '/api/play/', body, { referer, timeout: 18000 });
  if (!text) return [];
  let resp;
  try { resp = JSON.parse(text); } catch (e) { return []; }
  if (!resp || resp.status !== true || !resp.data) return [];
  const paths = [];
  try { paths.push({ lo: t(resp.lo) || 'main', path: dex(postId, resp.data) }); } catch (e) { /* 主线解码失败 */ }
  if (resp.reserve) {
    try {
      const arr = JSON.parse(dexUtf8(postId, resp.reserve));
      for (const r of arr) {
        if (r && r.data) {
          try { paths.push({ lo: t(r.lo) || 'bak', path: dex(postId, r.data) }); } catch (e) { /* 跳过坏备线 */ }
        }
      }
    } catch (e) { /* reserve 整体解码失败: 只用主线 */ }
  }
  return paths.filter(p => p.path && p.path.startsWith('//'));
}

const HOST_PRETTY = [
  [/streamtape|tapecontent/i, 'StreamTape'],
  [/maxstream/i, 'MaxStream'],
  [/cloudatacdn|clouddata/i, 'CloudCDN'],
  [/streamhls/i, 'StreamHLS'],
  [/pianopic/i, 'PianoPic'],
  [/dood|ds2play|d0o0d/i, 'Dood'],
  [/filemoon|filemoonu/i, 'FileMoon'],
  [/vidhide|earnvid|vidhideplus/i, 'VidHide'],
  [/streamwish|wish/i, 'StreamWish'],
  [/voe/i, 'VOE'],
];
function prettyHost(fileUrl) {
  for (const [re, name] of HOST_PRETTY) if (re.test(fileUrl)) return name;
  try { return new URL(fileUrl).hostname.replace(/^www\./, ''); } catch (e) { return '线路'; }
}
// VM 实测可靠性排序 (越小越靠前): CloudCDN 直链 / MaxStream 已验 > StreamTape > 其他 > StreamHLS/PianoPic (VM 403)
function hostRank(name) {
  if (name === 'CloudCDN') return 0;
  if (name === 'MaxStream') return 1;
  if (name === 'StreamTape') return 2;
  if (name === 'StreamHLS' || name === 'PianoPic') return 9;
  return 5;
}

// embed 页 -> 配置里的源数组 (含宿主标注)
// 单条 embed 硬顶 15s: detail 要并行解最多 8 条, 不能让某一条的
// 慢通道把整个详情拖过 App 耐心 (第五轮 harness 实测个别 embed
// 宿主会让全波次跑满, 详情总耗时冲到 26s)。
async function resolveEmbed(embedUrl, referer) {
  const html = await Promise.race([
    httpGet(embedUrl, { referer, timeout: 15000, kind: 'embed' }),
    new Promise((res) => setTimeout(() => res(''), 15000)),
  ]);
  if (!html) return null;
  const cfg = (html.match(/data-config="([^"]+)"/) || [])[1];
  if (!cfg) return null;
  let u;
  try { u = new URL(embedUrl); } catch (e) { return null; }
  try {
    const { sources } = decryptConfig(cfg, u.pathname, u.search);
    if (Array.isArray(sources) && sources.length) return sources;
  } catch (e) { /* 解密失败 */ }
  return null;
}

function pickSource(sources) {
  if (!sources || !sources.length) return null;
  let best = sources[0], bestScore = -1;
  for (const s of sources) {
    const label = t(s.label);
    let score = 0;
    const res = label.match(/(\d{3,4})\s*p/i);
    if (res) score = parseInt(res[1], 10);
    if (/hls|m3u8/i.test(s.type || '') || /\.m3u8(\?|$)/i.test(s.file || '')) score += 1;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// 全链解析: 详情页 -> 全部线路 [{lo, embedUrl, file, type, host}]
async function resolveLines(durl) {
  const html = await getDetailHtml(durl);
  if (!html) return { html: '', lines: [] };
  const { postId, mpu } = extractPlaySeed(html);
  if (!postId || !mpu) return { html, lines: [] };
  const paths = await fetchEmbedPaths(postId, mpu, durl);
  const lines = [];
  await Promise.all(paths.slice(0, 8).map(async (p, idx) => {
    const embedUrl = 'https:' + p.path;
    const sources = await resolveEmbed(embedUrl, durl);
    const src = sources && pickSource(sources);
    if (src && src.file) {
      lines.push({ idx, lo: p.lo, embedUrl, file: src.file, type: t(src.type), host: prettyHost(src.file) });
    }
  }));
  lines.sort((a, b) => (hostRank(a.host) - hostRank(b.host)) || (a.idx - b.idx));
  return { html, lines };
}

// ---------- 接口 ----------
async function init() {
  return {};
}

async function home() {
  const html = await httpGet(HOST + '/', { timeout: 18000 });
  const list = html ? parseCards(html).slice(0, 30) : [];
  return { class: CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name })), list };
}

function listUrl(tid, page) {
  const path = tid.startsWith('/') ? tid : '/' + tid;
  return HOST + path + (page > 1 ? 'page/' + page + '/' : '');
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATS.find(c => c.type_id === tid);
  if (!cat) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const html = await httpGet(listUrl(cat.type_id, page), { timeout: 18000 });
  if (!html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = parseCards(html);
  let pc = pagecountOf(html);
  if (list.length >= 24) pc = Math.max(pc, page + 1);
  return { page, pagecount: Math.max(pc, page), limit: 24, total: list.length, list };
}

function og(html, prop) {
  const m = String(html || '').match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`));
  return m ? clean(m[1]) : '';
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  const durl = absUrl(id);
  const { html, lines } = await resolveLines(durl);
  if (!html) return { list: [] };
  let name = og(html, 'title').replace(/\s*-\s*BestJavPorn\s*$/i, '');
  const pic = og(html, 'image') || (html.match(/<meta name="twitter:image" content="([^"]*)"/) || [])[1] || '';
  const code = (html.match(/<h4 class="entry-title">([^<]*)<\/h4>/) || [])[1] || '';
  const views = (html.match(/<i class="fa fa-eye"><\/i>\s*([\d,]+)\s*views/) || [])[1] || '';
  const relDate = (html.match(/Release Date:\s*([\d/]+)/) || [])[1] || '';
  const durMin = (html.match(/Duration:\s*([\d]+)\s*min/) || [])[1] || '';
  const desc = (html.match(/<div class="video-description">[\s\S]*?<p>([\s\S]*?)<\/p>/) || [])[1] || og(html, 'description');
  const studio = (html.match(/Studio:\s*<a[^>]*>([^<]+)<\/a>/) || [])[1] || '';
  const stars = [];
  const starRe = /href="https:\/\/(?:www\.)?bestjavporn\.com\/(?:v\d+\/)?pornstar\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  let sm;
  while ((sm = starRe.exec(html)) && stars.length < 8) {
    const nm = clean(sm[1]);
    if (nm && !/^more videos/i.test(nm) && !stars.includes(nm)) stars.push(nm);
  }
  const contentParts = [];
  if (desc) contentParts.push(clean(desc));
  if (studio) contentParts.push('Studio: ' + clean(studio));
  if (relDate) contentParts.push('Release: ' + relDate);
  if (durMin) contentParts.push('Duration: ' + durMin + ' min');
  const remarks = [code ? clean(code) : '', durMin ? durMin + ' min' : '', views ? views + ' views' : ''].filter(Boolean).join(' · ');
  const fromNames = [];
  const playUrls = [];
  lines.forEach((ln) => {
    fromNames.push(ln.host);
    playUrls.push('播放$' + durl + '@@' + ln.idx);
  });
  if (!lines.length) {
    // 铸造链没拿到线路 (多为抓取层被站方挡): 至少给一条嗅探线,
    // 真机 WebView 是真实浏览器, 站方 cast 链可在详情页内原生跑通。
    fromNames.push('网页嗅探');
    playUrls.push('播放$' + durl + '@@sniff');
  }
  return {
    list: [{
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_remarks: remarks,
      vod_actor: stars.join(', '),
      vod_content: contentParts.join('\n'),
      vod_play_from: fromNames.join('$$$'),
      vod_play_url: playUrls.join('$$$'),
    }],
  };
}

function sniffResult(durl) {
  // 最后兜底: 交给 App 的 WebView 嗅探 (真实浏览器环境可跑站方链)
  return { parse: 1, jx: 0, url: durl, header: { 'User-Agent': UA, Referer: REFERER } };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  // @@sniff 伪线 (detail 时铸造链没拿到线路才生成): 点播时先再试一次
  // 完整铸造链 (中转有偶发性, 第二次常能成), 实在不行才落嗅探。
  const sniffOnly = id.endsWith('@@sniff');
  if (sniffOnly) id = id.slice(0, -'@@sniff'.length);
  const mm = id.match(/^(https?:\/\/\S+?)@@(\d+)$/);
  const durl = mm ? mm[1] : absUrl(id);
  const wantIdx = mm ? parseInt(mm[2], 10) : 0;
  const html = await getDetailHtml(durl);
  if (!html) return sniffResult(durl);
  const { postId, mpu } = extractPlaySeed(html);
  if (!postId || !mpu) return sniffResult(durl);
  const paths = await fetchEmbedPaths(postId, mpu, durl);
  if (!paths.length) return sniffResult(durl);
  const order = paths.map((p, idx) => idx);
  // 与 detail 相同的排序口径: 先按 detail 时的 idx 顺序尝试想要的那条,
  // 拿不到再按顺序逐条兜底 (区域铸造偶发失败时换线还能播)。
  const tries = [wantIdx, ...order.filter(i => i !== wantIdx)];
  for (const i of tries) {
    const p = paths[i];
    if (!p) continue;
    const embedUrl = 'https:' + p.path;
    const sources = await resolveEmbed(embedUrl, durl);
    const src = sources && pickSource(sources);
    if (src && src.file) {
      return { parse: 0, url: src.file, header: { 'User-Agent': UA, 'Referer': embedUrl } };
    }
  }
  return sniffResult(durl);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const url = HOST + '/search/' + encodeURIComponent(wd) + '/' + (page > 1 ? 'page/' + page + '/' : '');
  const html = await httpGet(url, { timeout: 18000 });
  if (!html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = parseCards(html);
  let pc = pagecountOf(html);
  if (list.length >= 24) pc = Math.max(pc, page + 1);
  return { page, pagecount: Math.max(pc, page), limit: 24, total: list.length, list };
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
