// BestJavPorn (https://www.bestjavporn.com) -> CatPawOpen spider
// 暂用名: 站方品牌 BestJavPorn (用户可改)。
//
// 站点性质: WordPress + WP-Script RetroTube 主题的 JAV 聚合站, 服务端渲染,
// 全站公开免费 (无登录/无付费墙, 页面全开)。
// 封面 pics.pornfhd.com 直连无防盗链 (VM 实测 200, 不需要图片代理)。
//
// 播放链 (2026-10-21 完整逆向, 2026-10-22 侦察复核未变):
//   详情页 #video-player 的 data-mpu + #video-player-area 的 video-id
//   (post_id; 今日实况仍为 video-id 属性, 无 data-real-id)
//   -> token = dex(post_id, data-mpu)
//   -> POST /api/play/ (sources=token&ver=2) 得 {data, reserve, lo}
//   -> 主线/备线路径各经 dex 解出 //video{,1}.bestjavporn.com/p/{code}
//      或第三方 embed 前置站 (今日实测新增 hugstream.xyz, 解密同构)
//   -> GET embed 页取 data-config, 解密得 sources [{file,type,label}]。
//   dex(seed, data) = b64decode( RC4( key, b64decode(data) ) ),
//      key = reverse( b64encode( seed + '_0x58fe15' ) )       (cast.js)
//   embed 配置解密同构 (video main.js):
//      key = reverse( b64encode( b64encode(pathname+search).substr(4,20)
//             + '_0x59a0e4' ) )。
//   2026-10-22 侦察: 经自有 Worker POST 铸造 6/6 片 status:true;
//   embed 宿主分布: video/video1.bestjavporn.com (站内) + hugstream.xyz
//   (前置, 解出 streamhls/pianopic/acek-cdn 文件), MaxStream 仍在。
//   线的令牌多为 IP 绑定型: 整条链在 App 内 (设备同一出口) 完成才
//   自洽, 故 play 时现场重铸 (详情只把线路序号编进 play id)。
//
// 2026-10-22 第七轮 (删除重写, 与 javhdporn 同步):
// 前四轮本地 harness 全过、真机全灭且不可归因。本轮按当日实况重写:
//   ① 取数分层、逐通道归因 (状态码/字节/解卡数/耗时全记录);
//   ② home 与每个分类首行放诊断卡 (vod_id=__diag__), 卡名写命中
//      通道与出卡数, 全灭时带回各通道状态; 点开可见完整明细表;
//   ③ 解析双层 (严格层沿用旧解析 + 宽松层属性顺序无关), 页面
//      变体解 0 卡时宽松层接住并在诊断卡标注;
//   ④ 分类 type_id 内嵌的 /v{n}/ 前缀会漂移 (今日无前缀请求已跳
//      /v43/, 表内 /v42/ 尚可用): 分类出 0 卡时自动用无前缀路径
//      重试一次 (站方 301 到当前前缀), 诊断卡标注;
//   ⑤ 详情线路名标注来源家族 (宿主 + 区域线 lo); 铸造失败时嗅探
//      兜底线名带失败阶段 (详情未取到/无种子/铸造通道不通/
//      铸造被站方拒/embed未解出), 真机截图即可定位死点;
//   ⑥ 播放铸造/解包算法与旧版逐字沿用 (本地验通的部分不动)。
//
// 2026-10-22 真机归因修复: 诊断卡回传坐实 App 蜘蛛运行时里没有
// 全局 fetch ("fetch is not a function"), 旧版全部 fetch 通道在
// 设备上 0ms 秒死, 只剩 req/https 两栈真发出请求 (且直连被 CF
// 403)。本地 harness 跑在有 fetch 的 Node 里, 四轮全被掩盖。本次
// 只换 HTTP 层: 全部通道 (含 /api/play/ 的 POST 铸造) 底层改走
// 框架 req (axios), 全局 fetch 仅在 typeof 守卫成立时作 'fetch'
// 直连通道的附加实现, 缺失时该通道自动退化为 req —— 任何通道
// 不得再依赖 fetch 存在。
//
// 2026-10-22 第八轮 (只修播放; 列表/分类/封面真机已通): 真机报
// 「能加载不能播」。实测坐实失败层在 embed->文件令牌的 IP 绑定:
// 同一 MaxStream embed 页, 经 jina / 自有 Worker 出口看页后解出
// 的 m3u8, 换一出口取必 403; 经同出口直连看页解出的则 200。即
// lk 家族文件令牌绑 embed 查看者 IP, 而旧版 resolveEmbed 在多
// 出口通道间竞速、胜出出口随机, 令牌几乎永远绑不到播放器 (手
// 机) 的 IP —— 本地全链同出口, harness 永远测不出。本轮改法:
//   ① embed 取页改「直连三栈优先」分波 (fetch/req/https = 设备
//      自身出口), 代理通道只兜底; 解出线按出口分组排序: 直连线
//      最前、借线的 hugstream 前置 (master.txt, 实测不绑 IP 只
//      认 Referer) 次之、借线的绑定型宿主末位; 线名给直连线加
//      「·直」标记, 详情恒附一条网页嗅探兜底线;
//   ② play 改走 resolveLines 同一排序选线 (点的线与最优线同组
//      才尊重选择), 不再逐条盲试;
//   ③ 铸造 POST 全灭且 own 为 403/网络错时, 隔 1.2s 只重试 own
//      一发 (CF 对 Workers 出口的间歇拒绝会分钟级自愈)。
//
// 2026-10-22 第九轮 (真机 JUR-887 截图坐实): 详情只剩一条
// 「网页嗅探·铸造通道不通」—— 设备上 GET 通道是通的 (列表靠
// jina 取胜), 死的是 /api/play/ 铸造 POST: 全部 POST 通道 100%
// 失败 (stage=post-none), 而嗅探对此站等于不能播。本轮:
//   ① own 重试做足: 无人胜出且没有任何通道拿到站方 JSON 时,
//      隔 1.2s / 再隔 2.5s 共打 own 三发 (上游 403 是间歇的,
//      多打几发命中自愈窗口; apex 主机名实测 405 不收 POST,
//      不做主机名轮换);
//   ② detail 永不返回空: 取页全灭旧版直接 {list: []} (兜底线被
//      短路, 真机详情全空) —— 改为回保底 vod, 分集名带取页通道
//      逐个结论; 铸造全灭的分集名带 POST 各通道逐个结论 (own
//      每次状态用 > 串联、直连 POST 合并), 下一张真机截图即可
//      读出 own 是在抖还是恒死 (MiraPlayer 不显示线路名、但显
//      示分集名, 沿用 JAVSB 已验证套路);
//   ③ detail/play 给 resolveLines 包 try/catch, 异常不再吞掉
//      整个响应, 一律落保底/嗅探。
import req from '../../util/req.js';
import https from 'https';
import zlib from 'zlib';

const KEY = 'py_bestjavporn';
const NAME = 'BestJavPorn';
const HOST = 'https://www.bestjavporn.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = HOST + '/';
// 自有取页跳板 pornfhd-fetch (用户自有 Cloudflare Worker, 第一通道)
const OWN_FETCH = 'https://pornfhd-fetch.li768435813.workers.dev';
const DIAG_ID = '__diag__';

// 分类: type_id = 站方规范路径 (含 /v{n}/ 版本前缀); 精选分类 /
// 片商 / 标签共 477 个, 逐个实测第一页有视频才收 (表体由构建脚本
// 从上一版逐字拼入, 本轮未增删)。
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

// ---------------- 解析 (严格层 + 宽松层) ----------------
// 严格层: 沿用旧解析 (文章块 + <a href="...video/..." title="...">)。
function parseCardsStrict(html) {
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

// 宽松层: 属性顺序无关、相对/绝对 href 通吃; 标题 title 属性 ->
// img alt -> 锚内 header 文本 -> slug 兜底。
function parseCardsLoose(html) {
  const out = [];
  const seen = new Set();
  const h = String(html || '');
  const re = /<a\b[^>]*?href\s*=\s*["']((?:https?:\/\/(?:www\.)?bestjavporn\.com)?\/(?:v\d+\/)?video\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(h)) !== null) {
    let url = m[1];
    if (url.startsWith('/')) url = HOST + url;
    url = url.replace(/^http:\/\//, 'https://');
    if (seen.has(url)) continue;
    seen.add(url);
    const tag = m[0];
    const win = h.slice(m.index, m.index + 1800);
    let name = '';
    const tm = tag.match(/title\s*=\s*"([^"]+)"/) || tag.match(/title\s*=\s*'([^']+)'/);
    if (tm) name = clean(tm[1]);
    if (!name) {
      const altM = win.match(/<img[^>]+alt="([^"]{4,})"/);
      if (altM) name = clean(altM[1]);
    }
    if (!name) {
      const txtM = win.match(/<header class="entry-header">\s*<span>([^<]{4,})<\/span>/);
      if (txtM) name = clean(txtM[1]);
    }
    if (!name) name = url.split('/video/')[1].replace(/\//g, '');
    const img = win.match(/data-lazy-src="(https:[^"]+)"/) || win.match(/data-wpsrc="(https:[^"]+)"/);
    const dur = win.match(/<span class="duration">[\s\S]*?([\d]{1,2}:[\d]{2}(?::[\d]{2})?)\s*<\/span>/);
    const views = win.match(/<span class="views">[\s\S]*?([\d,]+)\s*<\/span>/);
    const remarks = [dur ? dur[1] : '', views ? views[1] + ' views' : ''].filter(Boolean).join(' · ');
    out.push({ vod_id: url, vod_name: name, vod_pic: img ? img[1] : '', vod_remarks: remarks });
  }
  return out;
}

function parseCardsEx(html) {
  const strict = parseCardsStrict(html);
  const byUrl = new Map(strict.map(c => [c.vod_id, c]));
  let looseOnly = 0;
  for (const c of parseCardsLoose(html)) {
    if (!byUrl.has(c.vod_id)) { byUrl.set(c.vod_id, c); looseOnly++; }
  }
  return { list: [...byUrl.values()], strict: strict.length, looseOnly };
}
function parseCards(html) {
  return parseCardsEx(html).list;
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

// ---------------- 抓取层 (分层竞速 + 逐通道归因) ----------------
const BROWSER_HEADERS = {
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
};

function isShellPage(s) {
  return /Attention Required|Just a moment|cf-challenge|Checking your browser/i.test(s || '');
}
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
function validFor(kind, html) {
  if (kind === 'detail') return validDetailPage(html);
  if (kind === 'embed') return validEmbedPage(html);
  return validListPage(html);
}

// ---- 传输层: 全部走框架 req (axios); fetch 仅守卫内附加 ----
// 设备运行时无全局 fetch (见文件头归因), 故所有通道的底层统一走
// req。HAS_FETCH 只决定 'fetch' 直连通道用不用原生 fetch 多一栈。
const HAS_FETCH = typeof fetch === 'function';

// reqRaw: 统一回 {status, body, rawBytes, headers, err}。状态码不
// 抛错 (validateStatus 全放行), body 仅 2xx 时给正文 (对齐 fetch
// 的 r.ok 口径); axios 默认跟随重定向 (maxRedirects 5, 对齐旧
// redirect:'follow'); 网络错误/超时回 status 0。transformResponse
// 设恒等: 防 axios 按 Content-Type 自动 JSON 解析污染正文
// (/api/play/ 与 aoGet 的正文都由上层自行 JSON.parse)。
async function reqRaw(url, headers, timeoutMs, method, body) {
  try {
    const cfg = {
      method: method || 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    };
    if (body !== undefined && body !== null) cfg.data = body;
    const r = await req.request(cfg);
    const text = typeof r.data === 'string' ? r.data : (r.data === null || r.data === undefined ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '', rawBytes: text.length, headers: r.headers || {} };
  } catch (e) {
    const isTimeout = !!(e && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(String(e.message || ''))));
    return { status: 0, body: '', rawBytes: 0, headers: {}, err: isTimeout ? 'timeout' : String((e && e.message) || e) };
  }
}

// 全局 fetch 实现 (仅 HAS_FETCH 时被 chFetch / fetchPost 调用):
// 与 reqRaw 同返回形态; headers 归一为空对象 (调用方不依赖)。
async function fetchViaGlobal(url, headers, timeoutMs, method, body) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 10000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow', method: method || 'GET', body });
    const text = await r.text();
    return { status: r.status, body: r.ok ? text : '', rawBytes: text.length, headers: {} };
  } catch (e) {
    return { status: 0, body: '', rawBytes: 0, headers: {}, err: (e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || e) };
  } finally { clearTimeout(to); }
}

// 通用取数原语 (全部通道经此; 底层 = reqRaw, 不再是全局 fetch)
async function fetchRaw2(url, headers, timeoutMs, method, body) {
  return reqRaw(url, headers, timeoutMs, method, body);
}

const OWN_HOST_RE = /(^|\.)(javhdporn\.net|bestjavporn\.com|pornfhd\.com)$/i;
async function chOwn(url, timeoutMs, referer) {
  try {
    if (!OWN_HOST_RE.test(new URL(url).hostname)) return { status: 0, body: '', note: '白名单外跳过' };
  } catch (e) { return { status: 0, body: '', note: 'URL非法' }; }
  const w = OWN_FETCH + '/get?u=' + encodeURIComponent(url) + '&ref=' + encodeURIComponent(referer || REFERER);
  const r = await reqRaw(w, { 'User-Agent': UA }, timeoutMs || 10000);
  return { ...r, upst: (r.headers && r.headers['x-pornfhd-upst']) || '' };
}

// 'fetch' 直连通道: 有全局 fetch 时用它多一栈; 设备上无 fetch 时
// 退化为 req 直连 (同为 BROWSER_HEADERS 全套头), 通道不许死。
async function chFetch(url, timeoutMs, referer) {
  const headers = { ...BROWSER_HEADERS, Referer: referer || REFERER };
  if (HAS_FETCH) return fetchViaGlobal(url, headers, timeoutMs);
  return reqRaw(url, headers, timeoutMs);
}

async function chReq(url, timeoutMs, referer) {
  try {
    const r = await req.get(url, {
      headers: { ...BROWSER_HEADERS, Referer: referer || REFERER },
      timeout: timeoutMs || 10000,
    });
    const status = (r && typeof r.status === 'number') ? r.status : 200;
    const d = typeof r === 'string' ? r : (r && r.data !== undefined ? r.data : r);
    return { status, body: typeof d === 'string' ? d : '' };
  } catch (e) {
    const st = e && e.response && typeof e.response.status === 'number' ? e.response.status : 0;
    return { status: st, body: '', err: String((e && e.message) || e) };
  }
}

function chHttps(url, timeoutMs, referer, depth = 0) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const u = new URL(url);
      const rq = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: { ...BROWSER_HEADERS, Referer: referer || REFERER, 'Accept-Encoding': 'gzip, deflate, br' },
        timeout: timeoutMs || 10000,
      }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          res.resume();
          fin(chHttps(new URL(loc, url).toString(), timeoutMs, referer, depth + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); fin({ status: res.statusCode || 0, body: '' }); return; }
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '');
        try {
          if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
          else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
          else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        } catch (e) { /* 按原文读 */ }
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => fin({ status: 200, body: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', () => fin({ status: 200, body: '', err: 'stream error' }));
      });
      rq.on('timeout', () => { rq.destroy(); fin({ status: 0, body: '', err: 'timeout' }); });
      rq.on('error', (e) => fin({ status: 0, body: '', err: String((e && e.message) || e) }));
      rq.end();
    } catch (e) { fin({ status: 0, body: '', err: String((e && e.message) || e) }); }
  });
}

// workers.dev 公共 demo: /search/ 需规范前缀 (从成功页学习; 分类
// type_id 本就带前缀、详情本就规范, 均不改写)
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
async function chDemo(url, timeoutMs) {
  return fetchRaw2('https://test.cors.workers.dev/?' + wdTarget(url), WD_HEADERS, timeoutMs);
}

async function chJina(url, timeoutMs) {
  return fetchRaw2('https://r.jina.ai/' + url, {
    'User-Agent': UA,
    'x-respond-with': 'html',
  }, timeoutMs);
}

async function chAoGet(url, timeoutMs) {
  const r = await fetchRaw2('https://api.allorigins.win/get?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
  if (!r.body) return r;
  try {
    const j = JSON.parse(r.body);
    return { status: r.status, body: typeof j.contents === 'string' ? j.contents : '' };
  } catch (e) { return { status: r.status, body: '' }; }
}

async function chAoRaw(url, timeoutMs) {
  return fetchRaw2('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
}

async function chCodetabs(url, timeoutMs) {
  return fetchRaw2('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), {
    'User-Agent': UA,
  }, timeoutMs);
}

// 分层竞速 + 归因。opts: {kind, referer, profile: 'full'|'embed', deadlineMs}
async function fetchPage(url, opts = {}) {
  const t0 = Date.now();
  const budget = opts.deadlineMs || 24000; // 全局总截止 (两波共享)
  const kind = opts.kind || 'list';
  const referer = opts.referer;
  const outcomes = [];
  let winner = null;
  let resolveWin;
  const winP = new Promise((r) => { resolveWin = r; });
  const judge = (name, res, ms) => {
    const body = (res && res.body) || '';
    const oc = {
      name,
      status: (res && res.status) || 0,
      upst: (res && res.upst) || '',
      bytes: body.length || (res && res.rawBytes) || 0,
      ms,
      ok: false,
      note: (res && res.note) || '',
      err: (res && res.err) || '',
    };
    if (kind === 'list') oc.cards = body ? parseCards(body).length : 0;
    oc.ok = validFor(kind, body);
    outcomes.push(oc);
    if (oc.ok && !winner) { winner = { html: body, oc }; resolveWin(winner); }
    return oc;
  };
  const runWave = async (wave) => {
    const jobs = wave.map(([name, fn, to]) => (async () => {
      const t0 = Date.now();
      let res;
      try { res = await fn(url, to, referer); } catch (e) { res = { status: 0, body: '', err: String((e && e.message) || e) }; }
      return judge(name, res, Date.now() - t0);
    })());
    const all = Promise.allSettled(jobs);
    const remain = Math.max(3000, budget - (Date.now() - t0));
    const deadline = new Promise((r) => setTimeout(r, remain));
    await Promise.race([winP, all, deadline]);
  };
  if (opts.profile === 'embed') {
    // embed 页: 出口一致性优先 (第八轮实测坐实, 见文件头): 文件令牌
    // 与 embed 查看者 IP 绑定, 故第一波只用直连三栈 (设备自身出口,
    // 与播放器同 IP); 直连全灭才借代理通道 —— 借线解出的令牌绑的
    // 是代理出口, 对绑定型宿主必然 403, 只能作排序末位兜底。
    await runWave([
      ['fetch', chFetch, 9000],
      ['req', chReq, 9000],
      ['https', chHttps, 9000],
    ]);
    if (!winner && !opts.directOnly) {
      await runWave([
        ['own', chOwn, 10000],
        ['demo', chDemo, 10000],
      ]);
    }
    if (!winner && !opts.directOnly) {
      await runWave([
        ['jina', chJina, 10000],
        ['aoGet', chAoGet, 12000],
      ]);
    }
  } else {
    await runWave([
      ['own', chOwn, 10000],
      ['fetch', chFetch, 10000],
      ['req', chReq, 10000],
      ['https', chHttps, 10000],
      ['demo', chDemo, 10000],
      ['jina', chJina, 12000],
      ['aoGet', chAoGet, 12000],
    ]);
    if (!winner) {
      await runWave([
        ['aoRaw', chAoRaw, 12000],
        ['codetabs', chCodetabs, 10000],
        ['jina2', chJina, 8000],
        ['demo2', chDemo, 8000],
      ]);
    }
  }
  if (winner) {
    notePrefix(winner.html);
    const ex = kind === 'list' ? parseCardsEx(winner.html) : null;
    return { html: winner.html, win: winner.oc, outcomes, looseOnly: ex ? ex.looseOnly : 0 };
  }
  return { html: '', win: null, outcomes, looseOnly: 0 };
}

// 兼容旧签名: 只要正文 (详情/播放/embed 内部用)
async function httpGet(url, opts = {}) {
  const r = await fetchPage(url, { kind: opts.kind, referer: opts.referer, profile: opts.kind === 'embed' ? 'embed' : 'full' });
  return r.html;
}

// ---------------- POST /api/play/ (铸造, 带通道归因) ----------------
function validPlayResp(text) {
  // 必须 status === true 才算铸造成功 (旧轮已坐实: allorigins 转发
  // POST 会丢 body, 站方回 {"status":false,...} 假成功)。
  if (!text) return false;
  try {
    const j = JSON.parse(text);
    return !!j && typeof j === 'object' && j.status === true;
  } catch (e) { return false; }
}

async function httpPostForm(url, bodyStr, opts = {}) {
  const referer = opts.referer || REFERER;
  const formHeaders = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': referer,
    'Origin': HOST,
  };
  const t0 = Date.now();
  const budget = 30000; // POST 铸造全局总截止 (各波共享)
  const outcomes = [];
  let winner = null;
  let resolveWin;
  const winP = new Promise((r) => { resolveWin = r; });
  const judge = (name, res) => {
    const text = (res && res.body) || '';
    const oc = { name, status: (res && res.status) || 0, bytes: text.length, ok: validPlayResp(text), sawJson: false, err: (res && res.err) || '' };
    if (text) {
      try { const j = JSON.parse(text); if (j && typeof j === 'object' && 'status' in j) oc.sawJson = true; } catch (e) { /* 非 JSON */ }
    }
    outcomes.push(oc);
    if (oc.ok && !winner) { winner = { text, via: name }; resolveWin(winner); }
    return oc;
  };
  const runWave = async (wave) => {
    const jobs = wave.map(([name, fn]) => (async () => {
      let res;
      try { res = await fn(); } catch (e) { res = { status: 0, body: '' }; }
      return judge(name, res);
    })());
    const all = Promise.allSettled(jobs);
    const remain = Math.max(3000, budget - (Date.now() - t0));
    const deadline = new Promise((r) => setTimeout(r, remain));
    await Promise.race([winP, all, deadline]);
  };
  const ownPostTo = async (target, to) => {
    const w = OWN_FETCH + '/post?u=' + encodeURIComponent(target) + '&ref=' + encodeURIComponent(referer);
    return fetchRaw2(w, { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, to || 12000, 'POST', bodyStr);
  };
  const ownPost = async () => ownPostTo(url);
  // 'fetch' 铸造通道: 有全局 fetch 时用它; 设备无 fetch 时退化为
  // req POST (与 ownPost/reqPost 同栈多一发), 通道不许死。
  const fetchPost = async () => (HAS_FETCH
    ? fetchViaGlobal(url, formHeaders, 12000, 'POST', bodyStr)
    : fetchRaw2(url, formHeaders, 12000, 'POST', bodyStr));
  const reqPost = async () => {
    try {
      const r = await req.post(url, bodyStr, { headers: formHeaders, timeout: 12000 });
      const status = (r && typeof r.status === 'number') ? r.status : 200;
      const d = typeof r === 'string' ? r : (r && r.data !== undefined ? r.data : r);
      return { status, body: typeof d === 'string' ? d : JSON.stringify(d || '') };
    } catch (e) {
      const st = e && e.response && typeof e.response.status === 'number' ? e.response.status : 0;
      return { status: st, body: '' };
    }
  };
  const demoPost = async () => fetchRaw2('https://test.cors.workers.dev/?' + url, {
    ...WD_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded',
  }, 12000, 'POST', bodyStr);
  const aoPost = async () => fetchRaw2('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
    'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA,
  }, 10000, 'POST', bodyStr);
  // 注: codetabs POST 已实测挂掉 (VM 与真机均超时, 2026-10-27
  // 删), 仅 GET 波次保留 codetabs。
  await runWave([['own', ownPost], ['fetch', fetchPost], ['req', reqPost], ['demo', demoPost]]);
  if (!winner && !outcomes.some((o) => o.sawJson) && (Date.now() - t0) < 20000) {
    // own 单次短重试 (2026-10-27 详情巨慢修复): own 的上游 403
    // 是站方 CF 对 Workers 出口的时段/colo 间歇拒绝, 但实测自愈
    // 在分钟级 (16:07 403、16:10 200), 秒级连打两发基本无益,
    // 却各烧 12s 超时 —— 原 own2+own3 是详情超时的主因之一。
    // 只留一发 8s 短重试, 20s 后不再重试; aoRaw 也只在 25s
    // 内才打, 总 POST 封顶约 30s。均打 www 上游 (apex 主机名
    // 实测回 405 不收 POST, 轮换无用, 2026-10-22 curl 直验)。
    // 前提不变: 任何通道拿到过 JSON=false 说明令牌本身被拒,
    // 重试无益, 跳过。
    const tryOwn = async (name, target) => {
      let res;
      try { res = await ownPostTo(target, 8000); } catch (e) { res = { status: 0, body: '' }; }
      judge(name, res);
    };
    await new Promise((r) => setTimeout(r, 1200));
    await tryOwn('own2', url);
  }
  if (!winner && (Date.now() - t0) < 25000) await runWave([['aoRaw', aoPost]]);
  if (winner) return { text: winner.text, via: winner.via, outcomes, diag: postDiagOf(outcomes) };
  // 全灭归因: 有通道拿到带 status 字段的 JSON (站方明确回 false) ->
  // post-bad; 连 JSON 都没拿到 -> post-none。
  const sawJson = outcomes.some((o) => o.sawJson);
  return { text: '', via: '', outcomes, stage: sawJson ? 'post-bad' : 'post-none', diag: postDiagOf(outcomes) };
}

// POST 通道逐个结论的短串 (进分集名, 真机截图可直接读):
// own 多次尝试按顺序用 > 串联 (own403>403>200), 直连两栈
// (fetch/req) 合并为「直连」, 其余通道逐个列。状态 0 记 ERR/超时。
function postDiagOf(outcomes) {
  if (!outcomes || !outcomes.length) return '';
  const st = (o) => (o.status ? String(o.status) : (o.err === 'timeout' ? '超时' : 'ERR'));
  const parts = [];
  const owns = outcomes.filter((o) => /^own\d*$/.test(o.name));
  if (owns.length) parts.push('own' + owns.map(st).join('>'));
  const dirs = outcomes.filter((o) => o.name === 'fetch' || o.name === 'req');
  if (dirs.length) parts.push('直连' + [...new Set(dirs.map(st))].join('/'));
  for (const o of outcomes) {
    if (/^own\d*$/.test(o.name) || o.name === 'fetch' || o.name === 'req') continue;
    parts.push(o.name + st(o));
  }
  return parts.join(' ');
}

// GET 通道逐个结论的短串 (取页全灭时进分集名/正文)
function pageDiagOf(outcomes) {
  if (!outcomes || !outcomes.length) return '';
  const st = (o) => (o.status ? String(o.status) : (o.err === 'timeout' ? '超时' : 'ERR'));
  return outcomes.map((o) => o.name + st(o)).join(' ');
}

// ---------------- 诊断卡 ----------------
function diagCardName(res, cardCount, suffix) {
  if (res && res.win) {
    let s = `诊断 ${res.win.name} ${res.win.status} · ${cardCount}卡`;
    if (res.win.upst) s += `·上游${res.win.upst}`;
    if (res.looseOnly) s += '·含宽松解析';
    if (suffix) s += suffix;
    return s;
  }
  const parts = (res ? res.outcomes : []).map((o) => {
    const st = o.status ? String(o.status) : (o.err ? 'ERR' : '0');
    return o.cards !== undefined ? `${o.name}:${st}/${o.cards}卡` : `${o.name}:${st}`;
  });
  return ('诊断 全通道失败 ' + parts.join(' ') + (suffix || '')).slice(0, 190);
}
function diagCard(res, cardCount, suffix) {
  return {
    vod_id: DIAG_ID,
    vod_name: diagCardName(res, cardCount, suffix),
    vod_pic: '',
    vod_remarks: '诊断卡·点开看通道明细',
  };
}
function diagText(url, res) {
  const lines = [];
  lines.push('取数通道明细');
  lines.push('目标: ' + url);
  lines.push('时间: ' + new Date().toISOString());
  if (res.win) lines.push(`胜出: ${res.win.name} 状态${res.win.status} ${res.win.ms}ms`);
  else lines.push('胜出: 无 (全通道失败)');
  for (const o of res.outcomes) {
    lines.push(`${o.name}: 状态${o.status || 'ERR'} ${o.bytes}B ${o.ms}ms` +
      (o.cards !== undefined ? ` 解卡${o.cards}` : '') +
      (o.upst ? ` 上游${o.upst}` : '') +
      (o.ok ? ' ✓合格' : '') +
      (o.note ? ' ' + o.note : '') +
      (o.err ? ' ' + o.err : ''));
  }
  const missing = ['own', 'fetch', 'req', 'https', 'demo', 'jina', 'aoGet', 'aoRaw', 'codetabs']
    .filter((n) => !res.outcomes.some((o) => o.name === n || o.name === n + '2'));
  if (missing.length) lines.push('未及返回 (竞速已胜出或总截止): ' + missing.join(' '));
  lines.push('判读: 200/0卡=通道通但解析为零; 403/5xx=通道被拒; ERR/timeout=通道不通; own=自有Worker, demo=公共cors演示, jina/ao/codetabs=公共中转, fetch/req/https=直连三栈(全走req, fetch仅运行时有时多一栈)。');
  return lines.join('\n');
}

// ---------------- 页面缓存 (详情供 play 复用, 省一次整链) ----------------
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
async function getDetailRes(durl) {
  const hit = cacheGet(durl, 300000);
  if (hit) return { html: hit, res: null };
  const res = await fetchPage(durl, { kind: 'detail' });
  if (res.html) cacheSet(durl, res.html);
  return { html: res.html, res };
}
async function getDetailHtml(durl) {
  const r = await getDetailRes(durl);
  return r.html;
}

// ---------------- 纯 JS 密码件 (与站方 cast.js / video main.js 同构, 沿用旧版) ----------------
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

// ---------------- 播放解析 ----------------
function extractPlaySeed(html) {
  const postId = (html.match(/id="video-player-area"[^>]*video-id="(\d+)"/) || html.match(/video-id="(\d+)"/) || [])[1] || '';
  const mpu = (html.match(/data-mpu="([^"]+)"/) || [])[1] || '';
  return { postId, mpu };
}

// ---------------- 铸造库 (cast-bank, 2026-10-22) ----------------
// 服务端预铸: VM 侧把当前目录的铸造结果 (embed 路径集) 预先算好
// 存入 pornfhd-fetch 的 KV; 蜘蛛在铸造 POST 竞速之前先查库, 命中
// 即以库内路径集走原下游 (resolveEmbed 等完全共用) —— 设备侧 own
// 出口被站方 CF 按 colo 信誉拉黑时活铸造全灭, 此路只用一次经自有
// Worker 的 GET, 不碰 POST。
// 契约: GET {OWN_FETCH}/cast?u=<watch 页完整 URL> -> 命中 200
// {"paths":[embed 路径数组],"ts":epoch}; 未命中 404。
// 只走 req (App 运行时无全局 fetch); 未命中/超时/坏 JSON/空路
// 径集一律落回原铸造。
// 形态别名 (2026-10-23 真机坐实): 站方列表/搜索发的 watch 链
// 接带 /v\d+/ 前缀且会漂移, 入库键多为去前缀 canonical 形 ——
// 精确一发未命中时, 明明在库的片也照样全灭。候选序: 精确址 ->
// canonical 形 -> 其余前缀形, 全部并行查 (查库不耗写入预
// 算), 按序取首命中; 首发超时沿用 6s, 变体发 3s。
// 2026-10-27 截图定位修复: 原 slice(0,3) 会截掉别名前缀形
// 入库键, 造成假性库未命中。
const CAST_ALIAS_PREFIXES = '/v1,/v2'.split(',');
function castBankCandidates(watchUrl) {
  const out = [watchUrl];
  const m = String(watchUrl).match(/^(https?:\/\/[^/]+)(?:\/v\d+)?(\/video\/\S*)$/);
  if (!m) return out;
  const canonical = m[1] + m[2];
  if (!out.includes(canonical)) out.push(canonical);
  for (const p of CAST_ALIAS_PREFIXES) {
    const u = m[1] + p + m[2];
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

async function castBankGet(watchUrl, timeoutMs) {
  try {
    const w = OWN_FETCH + '/cast?u=' + encodeURIComponent(watchUrl);
    const r = await reqRaw(w, { 'User-Agent': UA }, timeoutMs);
    if (!r || r.status !== 200 || !r.body) return null;
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return null; }
    const seen = new Set();
    const arr = (j && Array.isArray(j.paths))
      ? j.paths.filter((p) => {
          if (typeof p !== 'string' || !p.startsWith('//') || seen.has(p)) return false;
          seen.add(p);
          return true;
        })
      : [];
    if (!arr.length) return null;
    return { hit: true, paths: arr.map((p, i) => ({ lo: i === 0 ? 'main' : 'bak', path: p })) };
  } catch (e) {
    return null;
  }
}

async function castBankLookup(watchUrl) {
  const cands = castBankCandidates(watchUrl);
  const results = await Promise.all(cands.map((c, i) => castBankGet(c, i === 0 ? 6000 : 3000)));
  for (const hit of results) if (hit) return hit;
  return { hit: false };
}

// 调 /api/play/ 并解出全部线路的 embed 路径: {paths, stage, via}
async function fetchEmbedPaths(postId, mpu, referer) {
  // 2026-10-27 详情巨慢+播不了修复: 库直出已由 resolveLines
  // 先做 (命中且有线直接返回); 走到这里说明库未命中或库内
  // 路径已死 (embed 全灭), 必须现铸拿新路径 —— 原先这里又
  // 查一次库、命中即原样返回同一批死路径, POST 永不执行,
  // 还白跑第二遍 embed 全波次, 是详情巨慢的主因之一。
  const token = dex(postId, mpu);
  const body = 'sources=' + encodeURIComponent(token) + '&ver=2';
  const r = await httpPostForm(HOST + '/api/play/', body, { referer, timeout: 18000 });
  if (!r.text) return { paths: [], stage: r.stage || 'post-none', via: '', postDiag: r.diag || '', bank: 'miss' };
  let resp;
  try { resp = JSON.parse(r.text); } catch (e) { return { paths: [], stage: 'post-bad', via: r.via, postDiag: r.diag || '', bank: 'miss' }; }
  if (!resp || resp.status !== true || !resp.data) return { paths: [], stage: 'post-bad', via: r.via, postDiag: r.diag || '', bank: 'miss' };
  const paths = [];
  try { paths.push({ lo: t(resp.lo) || 'main', path: dex(postId, resp.data) }); } catch (e) { /* 主线解码失败 */ }
  if (resp.reserve) {
    try {
      const arr = JSON.parse(dexUtf8(postId, resp.reserve));
      for (const x of arr) {
        if (x && x.data) {
          try { paths.push({ lo: t(x.lo) || 'bak', path: dex(postId, x.data) }); } catch (e) { /* 跳过坏备线 */ }
        }
      }
    } catch (e) { /* reserve 整体解码失败: 只用主线 */ }
  }
  return { paths: paths.filter(p => p.path && p.path.startsWith('//')), stage: 'ok', via: r.via, postDiag: r.diag || '', bank: 'miss' };
}

const HOST_PRETTY = [
  [/streamtape|tapecontent/i, 'StreamTape'],
  [/maxstream/i, 'MaxStream'],
  [/cloudatacdn|clouddata/i, 'CloudCDN'],
  [/streamhls/i, 'StreamHLS'],
  [/pianopic/i, 'PianoPic'],
  [/acek-cdn/i, 'AcekCDN'],
  [/hugstream/i, 'HugStream'],
  [/turbovid|turbo/i, 'TurboVid'],
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
// VM 实测可靠性排序 (越小越靠前): CloudCDN 直链 / MaxStream 已验 > StreamTape / AcekCDN > 其他 > StreamHLS/PianoPic (VM 403)
function hostRank(name) {
  if (name === 'CloudCDN') return 0;
  if (name === 'MaxStream') return 1;
  if (name === 'StreamTape') return 2;
  if (name === 'AcekCDN') return 3;
  if (name === 'StreamHLS' || name === 'PianoPic') return 9;
  return 5;
}

// 直连通道名 (设备自身出口; 与播放器同 IP)。其余通道 (own/demo/
// jina/ao*) 均为代理出口, 解出的绑定型令牌与播放器 IP 不符。
const DIRECT_CHANNELS = new Set(['fetch', 'req', 'https']);

// embed 页 -> {sources, direct} (单条硬顶 20s, 防慢 embed 拖死详情)。
// direct=true 表示 embed 由直连栈取回, 文件令牌绑设备 IP, 与播放器
// 自洽; direct=false 为借代理出口解出, 仅对非绑定宿主可用。
async function resolveEmbed(embedUrl, referer, directOnly) {
  const r = await Promise.race([
    fetchPage(embedUrl, { kind: 'embed', referer, profile: 'embed', deadlineMs: 20000, directOnly }),
    new Promise((res) => setTimeout(() => res(null), 20000)),
  ]);
  if (!r || !r.html) return null;
  const cfg = (r.html.match(/data-config="([^"]+)"/) || [])[1];
  if (!cfg) return null;
  let u;
  try { u = new URL(embedUrl); } catch (e) { return null; }
  try {
    const { sources } = decryptConfig(cfg, u.pathname, u.search);
    if (Array.isArray(sources) && sources.length) {
      return { sources, direct: !!(r.win && DIRECT_CHANNELS.has(r.win.name)), viaName: r.win ? r.win.name : '' };
    }
  } catch (e) { /* 解密失败 */ }
  return null;
}

// 线路出口分组 (见 resolveLines 排序注释)。变体线的文件是变体
// 清单本身, 分组按其父清单 (parentFile) 判。
function lineGroup(ln) {
  if (ln.direct) return 0;
  if (/master\.txt(\?|$)/i.test(ln.parentFile || ln.file || '')) return 1;
  return 2;
}

// ---------------- 详情线路缓存 (2026-10-25 能解析不能播修复) ----------------
// 真机症结: detail 时解出的线 (用户眼前所见) 与 play 时现场重解的线
// 常不是同一批 —— play 时直连 embed 偶发超时/抖动, 重解结果丢直连
// 线、甚至全空落嗅探, 用户点的线根本没被播。令牌 12h 有效、同机
// IP 不变, 详情 10 分钟内的线直接复用最稳: play 先用缓存 (含所点
// 的线才算命中), 缓存过期或无所点的线才重解, 重解有线则刷新缓存。
const LINE_CACHE_TTL = 10 * 60 * 1000;
const lineCache = new Map(); // durl -> {lines, ts}
function cacheLines(durl, lines) {
  if (!durl || !lines || !lines.length) return;
  lineCache.set(durl, { lines, ts: Date.now() });
  if (lineCache.size > 100) lineCache.delete(lineCache.keys().next().value);
}
function cachedLines(durl, wantIdx, wantV) {
  const hit = lineCache.get(durl);
  if (!hit || (Date.now() - hit.ts) > LINE_CACHE_TTL) return null;
  if (wantIdx >= 0 && !hit.lines.some((l) => l.idx === wantIdx && (l.v || 0) === (wantV || 0)) && !hit.lines.some((l) => l.idx === wantIdx)) return null;
  return hit.lines;
}
// MP4 判定: 非 HLS (type 非 hls 且文件非 m3u8/txt)。播放器不把 play
// header 转给 HLS 分片, 分片缺 Referer 会 302/403 (CloudCDN MP4
// 实测: 有 Referer 206、无 Referer 302); MP4 单请求、header 直达,
// 同组内优先 MP4 最稳 (CloudCDN MP4 本就是 1080p, 不降清晰度)。
function isMp4Line(l) {
  if (!l) return false;
  if (/hls/i.test(l.type || '')) return false;
  if (/\.m3u8(\?|$)/i.test(l.file || '') || /\.txt(\?|$)/i.test(l.file || '')) return false;
  return true;
}
function pickPlayLine(lines, tapped) {
  const best = lines[0];
  const playable = lines.filter((l) => lineGroup(l) <= lineGroup(best));
  if (tapped && lineGroup(tapped) <= lineGroup(best) && isMp4Line(tapped)) return tapped;
  const mp4s = playable.filter(isMp4Line).sort((a, b) => ((b.q || 0) - (a.q || 0)) || (hostRank(a.host) - hostRank(b.host)) || (a.idx - b.idx) || ((a.v || 0) - (b.v || 0)));
  if (mp4s.length) return mp4s[0];
  return (tapped && lineGroup(tapped) <= lineGroup(best)) ? tapped : best;
}

// ---------------- 清晰度展开 (2026-10-22 高清修复) ----------------
// 普查坐实 (两站各 4 部样本, castbank/REPORT_hires.md): 每个 embed
// 的 data-config 只给 1 个 source, "低清"不在选源层 —— (1) 旧排序
// 同组内 MaxStream (主清单实测单档 720p) 压在 CloudCDN (1080p
// MP4) 前, 默认首线即 720p; (2) hugstream urlset 主清单含
// 480/720/1080 三档却被整张直出, 播放器从首档 480p 起播。故:
// HLS 主清单在 detail 时经直连栈取回展开变体, 多档逐档出线 (线
// 路名标清晰度, 组内按清晰度降序), 单档主清单照旧直出、只借其
// 标称清晰度参与排序/命名; MP4 按 label 标清晰度。
function labelRes(label) {
  const m = t(label).match(/(\d{3,4})\s*p/i);
  return m ? parseInt(m[1], 10) : 0;
}

// 主清单正文 -> 变体表 [{file, q, bw}] (q 降序, 同 q 码率降序);
// 变体 URI 相对主清单地址解析。无变体回 []。
function parseVariants(body, base) {
  const out = [];
  const lines = String(body || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#EXT-X-STREAM-INF:([^\r\n]*)/);
    if (!m) continue;
    const bw = parseInt((m[1].match(/BANDWIDTH=(\d+)/) || [])[1] || '0', 10);
    const rm = m[1].match(/RESOLUTION=(\d+)x(\d+)/);
    let q = rm ? parseInt(rm[2], 10) : 0;
    if (!q && bw) q = bw >= 2500000 ? 1080 : (bw >= 1100000 ? 720 : 480);
    let uri = '';
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const s = lines[j].trim();
      if (s && !s.startsWith('#')) { uri = s; break; }
    }
    if (!uri) continue;
    try { uri = new URL(uri, base).toString(); } catch (e) { continue; }
    out.push({ file: uri, q, bw });
  }
  out.sort((a, b) => (b.q - a.q) || (b.bw - a.bw));
  return out;
}

// 取清单并判形态: {master:true, variants} / {master:false} (本体
// 即媒体清单) / null (取不到/不是清单)。只走 reqRaw 直连栈 ——
// 与 embed 同为设备出口, 清单令牌自洽; 借线出口取回的变体令牌
// 与播放器 IP 不符, 不用代理通道。
async function fetchMasterVariants(file, referer) {
  try {
    const r = await reqRaw(file, { 'User-Agent': UA, Referer: referer, Accept: '*/*' }, 8000);
    if (!r || !r.body || !r.body.includes('#EXTM3U')) return null;
    const variants = parseVariants(r.body, file);
    if (variants.length) return { master: true, variants };
    if (r.body.includes('#EXTINF')) return { master: false, variants: [] };
    return null;
  } catch (e) { return null; }
}

// 一个 embed 的全部 sources -> 线路表 [{file, type, q, v, parent}]:
// MP4 单条 (q 取 label); HLS 多档主清单逐档一条 (q 降序); 单档
// 主清单/媒体清单/清单取不到时按原文件一条 (q 借变体或 label,
// 借不到为 0)。v = 该 embed 内的序号 (detail/play 对位用)。
async function expandSources(sources, embedUrl) {
  const out = [];
  for (const s of (sources || [])) {
    if (!s || !s.file) continue;
    const isHls = /hls|m3u8/i.test(s.type || '') || /\.m3u8(\?|$)/i.test(s.file) || /\.txt(\?|$)/i.test(s.file);
    if (!isHls) { out.push({ file: s.file, type: t(s.type), q: labelRes(s.label), parent: s.file }); continue; }
    const mv = await fetchMasterVariants(s.file, embedUrl);
    if (mv && mv.master && mv.variants.length > 1) {
      for (const v of mv.variants) out.push({ file: v.file, type: 'hls', q: v.q, parent: s.file });
    } else if (mv && mv.master && mv.variants.length === 1) {
      out.push({ file: s.file, type: t(s.type), q: mv.variants[0].q || labelRes(s.label), parent: s.file });
    } else {
      out.push({ file: s.file, type: t(s.type), q: labelRes(s.label), parent: s.file });
    }
  }
  out.forEach((e, i) => { e.v = i; });
  return out;
}

// 线路显示宿主: 文件宿主无家族命中 (urlset 轮换 CDN 域名) 时回
// 落 embed 家族名 (如 HugStream) —— 轮换域名不是用户能认的宿主。
function displayHost(file, embedUrl) {
  const h = prettyHost(file);
  try {
    if (new URL(file).hostname.replace(/^www\./, '') === h) {
      const eh = prettyHost(embedUrl);
      if (eh && eh !== h) return eh;
    }
  } catch (e) { /* 保持原名 */ }
  return h;
}

// 全链解析: {html, lines, stage, via, postDiag, pageDiag, pathsN}
// stage: ok / page(详情未取到) / seed(无种子) / post-none(铸造通道
// 不通) / post-bad(铸造被站方拒) / embed(铸出路径但 embed 未解出)
// 路径集 -> 线路表 (embed 解出 + 清晰度展开 + 全局排序), 供库直出
// 与常规流程共用。
async function linesFromPaths(paths, durl) {
  // 2026-10-27 截图定位修复: 首发 0 线时只用直连三栈再打一发
  // (直连失败多为间歇 403/抖动, 第二发常能成; 借线对绑定型
  // 宿主必 403, 重试不走代理波, 成功路径零额外耗时)。
  const run = async (directOnly) => {
    const out = [];
    await Promise.all(paths.slice(0, 8).map(async (p, idx) => {
      const embedUrl = 'https:' + p.path;
      const r = await resolveEmbed(embedUrl, durl, directOnly);
      if (!r) return;
      const expanded = await expandSources(r.sources, embedUrl);
      for (const e of expanded) {
        out.push({ idx, v: e.v, lo: p.lo, embedUrl, file: e.file, parentFile: e.parent, type: e.type, host: displayHost(e.file, embedUrl), q: e.q, direct: !!r.direct });
      }
    }));
    return out;
  };
  let lines = await run(false);
  if (!lines.length && paths.length) lines = await run(true);
  // 排序: 直连解出 (令牌绑设备 IP, 与播放器自洽) 最前; 借线解出的
  // hugstream 前置 (master.txt, 实测不绑 IP、只认 Referer) 次之;
  // 借线解出的绑定型宿主 (令牌绑代理出口, 设备必 403) 末位。组内
  // 先比清晰度 (高清在前), 再比宿主可靠性与原序。
  lines.sort((a, b) => (lineGroup(a) - lineGroup(b)) || ((b.q || 0) - (a.q || 0)) || (hostRank(a.host) - hostRank(b.host)) || (a.idx - b.idx) || ((a.v || 0) - (b.v || 0)));
  return lines;
}

async function resolveLines(durl) {
  // 库直出 (2026-10-25, 同 javhdporn): 详情取页常被站方墙挡, 但库
  // 内路径只凭 watch URL 即可查 —— 先查库, 命中且 embed 解出线则
  // 直接用, 不必等详情页。未命中或 embed 全灭才走原流程。
  // 2026-10-27 详情巨慢修复: 查库与详情取页并行 (getDetailRes
  // 内有 5 分钟详情缓存, 并行不影响缓存语义); 库命中且有线
  // 仍优先, 未命中时直接用已在跑的详情结果。
  const detailP = getDetailRes(durl);
  const bank0 = await castBankLookup(durl);
  if (bank0.hit) {
    const lines0 = await linesFromPaths(bank0.paths, durl);
    if (lines0.length) return { html: '', lines: lines0, stage: 'ok', via: 'cast-bank', postDiag: '', bank: 'hit' };
  }
  const { html, res } = await detailP;
  if (!html) return { html: '', lines: [], stage: 'page', via: '', pageDiag: pageDiagOf(res ? res.outcomes : []) };
  const { postId, mpu } = extractPlaySeed(html);
  if (!postId || !mpu) return { html, lines: [], stage: 'seed', via: '' };
  const { paths, stage, via, postDiag, bank: postBank } = await fetchEmbedPaths(postId, mpu, durl);
  const bank = bank0.hit ? 'hit' : postBank;
  if (!paths.length) return { html, lines: [], stage, via, postDiag, bank };
  const lines = await linesFromPaths(paths, durl);
  if (!lines.length) return { html, lines: [], stage: 'embed', via, postDiag, pathsN: paths.length, bank };
  return { html, lines, stage: 'ok', via, postDiag, bank };
}

// ---------------- 字幕聚合 (Layer A 重写, 2026-10-23) ----------------
// 按用户自有迅雷看看 REX 组件 (xunlei.subtitle) 的方法重写: 旧版把
// [番号, 全标题, 番号+标题] 多个键的召回合并成一池只排序不过滤,
// 全标题键的模糊召回灌进大量别片字幕 (实测 JUR-887 全标题键池
// 前排即 JUX-021 等别片), 且迅雷档位恒占满上限 10, SubtitleCat
// 永远挤不进来。新版三招 (与组件一致):
// (a) 键序逐个查、首个有结果的键即停 — 番号键命中的池小而准;
// (b) 命中后严过滤: 条目 name/langs/ext 须含番号 (宽松形亦可)
//     或片名全文, 不含的全扔, 无回退 (组件原法的回退宽松名单
//     在冷门番号上会把邻近番号的模糊池整池放行, 实测有害已删;
//     乱码单字键亦实测能召回无关字幕, 同样靠严过滤挡下);
// (c) 组件打分: cid_match 100000、含番号 +25000, 再加 oracle 自
//     带 score / fingerprintScore / 下载量, 按名+址去重取 top。
// 槽位 (用户钦定): 迅雷 (键序 [番号, 紧凑番号]) > 迅雷看看
// (组件完整键序 [番号, 紧凑番号, 番号+标题, 紧凑番号+标题,
// 全标题]) > SubtitleCat; 两迅雷槽同走同一 oracle 接口、不管
// 重不重复, 合并按 URL 去重、同条归高档位。合并序 = 档位 ->
// 语言 (简中>繁中>双语>英文>日文>其他, 沿用 subLangOf 口径)
// -> 分数; 全局上限 10、单槽软上限 8 (SubtitleCat 留位)。
// 全程 reqRaw (框架 req 主栈), 迅雷系逐请求超时 3s、键序串行
// 首中即停; 总预算 6s、失败全静默; 无结果时 play 返回对象不带
// subs 键, 与未接入前逐字段一致。SubHD (下载被站方门控) 与
// 射手 (源站 522) 仍不接入。
const SUB_TTL = 10 * 60 * 1000;
const subNameCache = new Map();   // durl -> 片名 (detail 时 best-effort 写入)
const subResultCache = new Map(); // durl -> {ts, subs}

function subCacheName(durl, name) {
  if (!durl || !name) return;
  subNameCache.set(durl, String(name));
  if (subNameCache.size > 200) subNameCache.delete(subNameCache.keys().next().value);
}

function subSlugTitle(durl) {
  const slug = (String(durl || '').match(/\/video\/([^/]+)\//) || [])[1] || '';
  return slug ? clean(slug.replace(/[-_]+/g, ' ')) : '';
}

// 番号抽取 (移植自迅雷看看 REX 组件 extractSearchCode 的核心档)
function subExtractCode(text) {
  const s = String(text || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ');
  const pats = [
    /\bFC2(?:[- ]?PPV)?[- ]?\d{5,8}\b/,
    /\bCARIB(?:PR)?[- ]?\d{6,8}\b/,
    /\b1PONDO[- ]?\d{6,8}\b/,
    /\bHEYZO[- ]?\d{3,6}\b/,
    /\b[A-Z]{2,10}[- ]\d{2,8}[A-Z]?\b/,
    /\b[A-Z]{2,10}\d{2,8}[A-Z]?\b/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[0].replace(/\s+/g, '-').replace(/-+/g, '-');
  }
  return '';
}

// 搜索上下文: 片名、番号、紧凑番号、标题部分 (去番号与噪声词)
function subCtx(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const compact = code ? code.replace(/[-_ ]/g, '') : '';
  let titlePart = '';
  if (code && title) {
    titlePart = title
      .replace(new RegExp(code.replace(/[-_]/g, '[-_ ]?'), 'i'), ' ')
      .replace(/\b(UNCENSORED|LEAK|OTHER|COMPLETE|FULL|HDR|WEB|BLURAY|BDRIP|WEBDL|REMUX|X264|X265|10BIT|8BIT|HEVC|AVC)\b/gi, ' ')
      .replace(/\b(?:EP|E|S|SEASON)\s*\d{1,3}\b/gi, ' ')
      .replace(/^[\s\-_:]+|[\s\-_:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (titlePart === code || titlePart === compact) titlePart = '';
  }
  return { title, code, compact, titlePart };
}

// 迅雷槽键序: 只番号两键 (锚定)
function subKeysX(ctx) {
  const keys = [];
  if (ctx.code) {
    keys.push(ctx.code);
    if (ctx.compact && ctx.compact !== ctx.code) keys.push(ctx.compact);
  }
  return keys;
}

// 迅雷看看槽键序: 组件完整键序 (番号、紧凑番号、番号+标题、
// 紧凑番号+标题、全标题), 逐个查、首中即停。
function subKeysXL(ctx) {
  const keys = subKeysX(ctx);
  if (ctx.code && ctx.titlePart) {
    keys.push(ctx.code + ' ' + ctx.titlePart);
    keys.push(ctx.compact + ' ' + ctx.titlePart);
  }
  if (ctx.title && ctx.title !== ctx.code) keys.push(ctx.title);
  return [...new Set(keys)].filter((k) => k.length >= 2);
}

// 严过滤的匹配文本 (组件口径: 片名 + 上下文, 全小写与去分隔符两形)
function subMatchOf(durl, ctx) {
  const text = ((ctx.title || '') + ' ' + String(durl || '')).trim().toLowerCase();
  const title = (ctx.title || '').toLowerCase();
  return {
    text,
    loose: text.replace(/[-_\s.]/g, ''),
    title,
    titleLoose: title.replace(/[-_\s.]/g, ''),
  };
}

// 语言判定: rank 越小越优先 (简中 > 繁中 > 双语 > 英文 > 其他)
function subLangOf(name, langs) {
  const s = (String(name || '') + ' ' + String(langs || '')).toLowerCase();
  if (/简体|简中|chs|zh[-_. ]?cn|zh[-_. ]?hans/.test(s)) return { tag: '简中', rank: 0 };
  if (/繁体|繁中|cht|zh[-_. ]?tw|zh[-_. ]?hk|zh[-_. ]?hant/.test(s)) return { tag: '繁中', rank: 1 };
  if (/双语|中英|中日|bilingual/.test(s)) return { tag: '双语', rank: 2 };
  if (/英文|english|eng|(^|[-_. ])en([-_. ]|$)/.test(s)) return { tag: '英文', rank: 3 };
  if (/日文|日语|japanese|jpn|(^|[-_. ])ja([-_. ]|$)/.test(s)) return { tag: '日文', rank: 4 };
  return { tag: '', rank: 5 };
}

const SUB_TEXT_RE = /\.(srt|vtt|ass|ssa)(\?|#|$)/i;

// 文本字幕格式判定: 文件名扩展名 > 条目 ext 字段 > url 后缀;
// 压缩包一律剔除 (与组件 getExt 口径一致, 只认 srt/vtt/ass/ssa)。
function subFmtOf(name, ext, url) {
  const hay = (String(name || '') + ' ' + String(url || '')).toLowerCase();
  if (/\.(zip|rar|7z)(\?|#|$)/.test(hay)) return '';
  const fromName = String(name || '').toLowerCase().match(/\.(srt|vtt|ass|ssa)$/);
  if (fromName) return fromName[1];
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (/^(srt|vtt|ass|ssa)$/.test(e)) return e;
  const fromUrl = String(url || '').match(SUB_TEXT_RE);
  if (fromUrl) return fromUrl[1].toLowerCase();
  return '';
}

// 裸哈希名不可读: 显示名换成番号字幕 (匹配/过滤仍用原名)
function subDispName(nm, code) {
  const base = String(nm || '').replace(/\.(srt|vtt|ass|ssa)$/i, '');
  if (/^[0-9a-f]{24,}$/i.test(base.trim())) return code ? code + ' 字幕' : '字幕';
  return nm;
}

// oracle 单键查询 (同趟搜索内按键缓存, 两槽共用, 不重复发请求)
async function subOracle(key, ocache) {
  if (ocache.has(key)) return ocache.get(key);
  const p = (async () => {
    const r = await reqRaw('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 3000);
    if (r.status !== 200 || !r.body) return [];
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return []; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return [];
    return j.data;
  })();
  ocache.set(key, p);
  return p;
}

// oracle 条目归一 (组件 normalizeResult 的字段口径)
function subNormItem(it) {
  const name = String(it.name || it.Name || it.title || it.Title || it.filename || it.FileName || '字幕');
  const langs = Array.isArray(it.languages) ? it.languages.join(',')
    : (Array.isArray(it.Languages) ? it.Languages.join(',') : String(it.langs || it.Langs || it.language || ''));
  return {
    name,
    langs,
    ext: String(it.ext || it.Ext || it.format || it.Format || ''),
    url: String(it.url || it.Url || ''),
    cid: Boolean(it.cid_match ?? it.CidMatch),
    down: Number(it.down_count || it.DownCount || it.downloads || it.Downloads || 0) || 0,
    score: Number(it.score || it.Score || 0) || 0,
    fp: Number(it.fingerprintf_score || it.fingerprint_score || it.FingerprintScore || it.fingerprintfScore || 0) || 0,
    duration: Number(it.duration || it.Duration || 0) || 0,
    size: Number(it.file_size || it.FileSize || it.size || it.Size || 0) || 0,
  };
}

// 严过滤 (组件口径): 条目 name/langs/ext 须含番号 (原形或宽松
// 形) 或片名全文, 否则扔掉。片名分支必须守非空: 个别蜘蛛的
// 播放 id 与 detail 登记键对不上时片名缓存会落空 (title=''),
// 空串是任何字符串的子串, 不守就会全池放行 (bigbuttshub 实测
// 教训: 假番号 EMPTY-24 搜出的 Sherlock 剧集字幕整页漏入)。
function subRelevant(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  if (ctx.code) {
    if (text.includes(ctx.code.toLowerCase())) return true;
    if (ctx.compact && loose.includes(ctx.compact.toLowerCase())) return true;
  }
  if (!match.text) return false;
  return text.includes(match.text) || loose.includes(match.loose)
    || (match.title ? (text.includes(match.title) || loose.includes(match.titleLoose)) : false)
    || match.text.includes(text);
}

// 组件打分 (scoreItem 的电影路径): cid_match 100000、含番号
// +25000、oracle 自带 score/fingerprintScore、下载量、时长/大小。
function subScoreItem(it, ctx, match) {
  const text = (it.name + ' ' + it.langs + ' ' + it.ext).toLowerCase();
  const loose = text.replace(/[-_\s.]/g, '');
  let s = (it.cid ? 100000 : 0) + it.down / 10000;
  if (ctx.code && (text.includes(ctx.code.toLowerCase()) || (ctx.compact && loose.includes(ctx.compact.toLowerCase())))) s += 25000;
  s += Math.max(0, it.score) + Math.max(0, it.fp);
  if (it.duration > 0) s += 50;
  if (it.size > 0) s += Math.min(it.size / 1024 / 1024, 20);
  if (match.title && (text.includes(match.title) || loose.includes(match.titleLoose))) s += 1000;
  if (ctx.code) s += 500;
  if (text.includes('sub') || text.includes('subtitle') || text.includes('字幕')) s += 300;
  return s;
}

// 迅雷系槽位 (迅雷 tier 0 / 迅雷看看 tier 1): 键序逐个查、首个
// 有结果的键即停; 命中池只过严过滤、无任何回退 — 组件原法的
// 「过滤到空回退宽松名单」在冷门番号上实测有害 (oracle 对无精
// 确字幕的番号返回邻近番号的模糊池, 回退等于整池垃圾放行:
// MOGK-006 挂上 MOGK-004/002、FC2-PPV-4991508 挂上他人番号),
// 与「宁缺毋滥」冲突, 故删除 (与 REX 版相关性闸门口径一致)。
async function subSlotOracle(keys, src, tier, ctx, match, ocache, bag) {
  let pool = null;
  for (const k of keys) {
    const list = await subOracle(k, ocache);
    if (list && list.length) { pool = list; break; }
  }
  if (!pool) return;
  const items = [];
  for (const raw of pool) {
    if (!raw) continue;
    const it = subNormItem(raw);
    if (!it.url) continue;
    const fmt = subFmtOf(it.name, it.ext, it.url);
    if (!fmt) continue;
    items.push({ name: it.name, langs: it.langs, ext: it.ext, url: it.url, fmt, norm: it });
  }
  if (!items.length) return;
  const finalItems = items.filter((it) => subRelevant(it, ctx, match));
  for (const it of finalItems) {
    const lang = subLangOf(it.name, it.langs);
    bag.push({ src, tier, name: subDispName(it.name, ctx.code), url: it.url, fmt: it.fmt, lang: lang.tag, langRank: lang.rank, score: subScoreItem(it.norm, ctx, match) });
  }
}

// SubtitleCat 槽 (tier 2): 沿用旧芯搜索/解析 (按番号键搜、逐页
// 取按语言分的直链), 同样过严过滤 (无回退)。
async function subFromSubtitleCat(ctx, match, bag) {
  const key = ctx.code || ctx.title;
  if (!key) return;
  const r = await reqRaw('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': UA, Referer: 'https://subtitlecat.com/' }, 5000);
  if (r.status !== 200 || !r.body) return;
  const pages = [];
  const seen = new Set();
  for (const m of r.body.matchAll(/href="(subs\/\d+\/[^"]+\.html)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    pages.push(m[1]);
    if (pages.length >= 3) break;
  }
  await Promise.all(pages.map(async (p) => {
    const pr = await reqRaw('https://subtitlecat.com/' + p, { 'User-Agent': UA, Referer: 'https://subtitlecat.com/' }, 4000);
    if (pr.status !== 200 || !pr.body) return;
    for (const m of pr.body.matchAll(/href="(\/subs\/\d+\/[^"]+\.(?:srt|vtt|ass))"/gi)) {
      let nm = m[1].split('/').pop() || '字幕';
      try { nm = decodeURIComponent(nm); } catch (e) { /* 保持原样 */ }
      if (!subRelevant({ name: nm, langs: '', ext: '' }, ctx, match)) continue;
      const lang = subLangOf(nm, '');
      const fmt = (nm.match(/\.(srt|vtt|ass)$/i) || [])[1].toLowerCase();
      bag.push({ src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], fmt, lang: lang.tag, langRank: lang.rank, score: 0 });
    }
  }));
}

// 合并: 档位 -> 语言 -> 分数; 按 URL 去重 (同条归先到高档位);
// 全局上限 10、单槽软上限 8 (给 SubtitleCat 留位)。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const perTier = {};
  const out = [];
  for (const it of sorted) {
    if (out.length >= 10) break;
    if (seenUrl.has(it.url)) continue;
    if ((perTier[it.tier] || 0) >= 8) continue;
    seenUrl.add(it.url);
    perTier[it.tier] = (perTier[it.tier] || 0) + 1;
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: it.fmt });
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const ctx = subCtx(durl);
    let subs = [];
    if (ctx.code || ctx.title) {
      const match = subMatchOf(durl, ctx);
      const bag = [];
      const ocache = new Map();
      const jobs = [
        subSlotOracle(subKeysX(ctx), '迅雷', 0, ctx, match, ocache, bag),
        subSlotOracle(subKeysXL(ctx), '迅雷看看', 1, ctx, match, ocache, bag),
        subFromSubtitleCat(ctx, match, bag),
      ].map((jp) => Promise.resolve(jp).catch(() => {}));
      const all = Promise.allSettled(jobs);
      // 总预算 6s: 到点先用已入 bag 的部分合并返回; 后台源跑完
      // 后若凑出结果再迟填缓存 (慢出口下 detail 预热靠此命中)。
      // 空结果不缓存 (无字幕的片每次点播重查, 由在途去重兜底)。
      await Promise.race([all, new Promise((r) => setTimeout(r, 6000))]);
      subs = subMerge(bag);
      if (subs.length) {
        subResultCache.set(durl, { ts: Date.now(), subs });
        if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
      } else {
        all.then(() => {
          const late = subMerge(bag);
          if (late.length) {
            subResultCache.set(durl, { ts: Date.now(), subs: late });
            if (subResultCache.size > 200) subResultCache.delete(subResultCache.keys().next().value);
          }
        }).catch(() => {});
      }
    }
    return subs;
  })();
  subInflight.set(durl, p);
  try { return await p; } finally { subInflight.delete(durl); }
}

// detail 入口即预热 (不 await): 慢出口下单趟搜索可达数秒, 让它
// 与详情页的铸造链并行跑, 用户点播时 play 直接命中缓存/在途。
function subWarm(durl) {
  subSearchAll(durl).catch(() => {});
}

// ---------------- 接口 ----------------
async function init() {
  return {};
}

async function home() {
  const url = HOST + '/';
  const res = await fetchPage(url, { kind: 'list' });
  const list = res.html ? parseCards(res.html).slice(0, 30) : [];
  return {
    class: CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name })),
    list: [diagCard(res, list.length), ...list],
  };
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
  let res = await fetchPage(listUrl(cat.type_id, page), { kind: 'list' });
  let list = res.html ? parseCards(res.html) : [];
  let drift = '';
  if (!list.length && /\/v\d+\//.test(cat.type_id)) {
    // 前缀漂移兜底: 表内 /v{n}/ 若被站方废弃, 无前缀路径会 301 到
    // 当前前缀 —— 出 0 卡时自动重试一次, 诊断卡标注。
    const stripped = cat.type_id.replace(/\/v\d+(?=\/)/, '');
    const res2 = await fetchPage(listUrl(stripped, page), { kind: 'list' });
    const list2 = res2.html ? parseCards(res2.html) : [];
    if (list2.length) { res = res2; list = list2; drift = '·无前缀重试'; }
  }
  if (!list.length) {
    return { page, pagecount: page, limit: 24, total: 0, list: [diagCard(res, 0, drift)] };
  }
  let pc = pagecountOf(res.html);
  if (list.length >= 24) pc = Math.max(pc, page + 1);
  return { page, pagecount: Math.max(pc, page), limit: 24, total: list.length, list: [diagCard(res, list.length, drift), ...list] };
}

function og(html, prop) {
  const m = String(html || '').match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`));
  return m ? clean(m[1]) : '';
}

const STAGE_TEXT = {
  page: '详情未取到',
  seed: '无播放种子',
  'post-none': '铸造通道不通',
  'post-bad': '铸造被站方拒',
  embed: 'embed未解出',
};

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  if (id === DIAG_ID) {
    const url = HOST + '/';
    const res = await fetchPage(url, { kind: 'list' });
    const cards = res.html ? parseCards(res.html).length : 0;
    return {
      list: [{
        vod_id: DIAG_ID,
        vod_name: diagCardName(res, cards),
        vod_pic: '',
        vod_remarks: '通道诊断',
        vod_content: diagText(url, res),
        vod_play_from: '诊断',
        vod_play_url: '状态$' + DIAG_ID,
      }],
    };
  }
  const durl = absUrl(id);
  subWarm(durl); // 字幕预热: 与下方铸造链并行, 不 await (见字幕聚合节)
  let rl;
  try { rl = await resolveLines(durl); }
  catch (e) { rl = { html: '', lines: [], stage: 'error', via: '', pageDiag: '', postDiag: '' }; }
  const { html, lines, stage, via } = rl;
  if (lines.length) cacheLines(durl, lines); // 供 play 复用 (见详情线路缓存节)
  if (!html && !lines.length) {
    // 取页全灭且无库直出线: 永不返回空 —— 名字从 URL slug 派生,
    // 分集名带取页通道逐个结论, 点播落 watch 页嗅探 (重开详情或
    // 点这一集都会整链重试)。
    const slug = (durl.match(/\/video\/([^/]+)\//) || [])[1] || '';
    const nm = slug ? clean(slug.replace(/[-_]+/g, ' ')) : 'BestJavPorn';
    subCacheName(durl, nm);
    const diag = rl.pageDiag || '无记录';
    const epName = ('正片·取页全灭 ' + diag + '·仅嗅探').slice(0, 110);
    return {
      list: [{
        vod_id: durl,
        vod_name: nm,
        vod_pic: '',
        vod_remarks: '详情取不到·仅嗅探',
        vod_content: '诊断: 详情页取数全灭\n通道: ' + diag + '\n已附网页嗅探兜底一集; 通道恢复后重开详情即可整链重试。',
        vod_play_from: '网页嗅探·取页全灭',
        vod_play_url: epName + '$' + durl + '@@sniff',
      }],
    };
  }
  // 库直出 (详情页被墙、但库内有线): 片名从 slug 派生, 封面空缺,
  // 线路照常出 —— 有线可播远胜取页全灭仅嗅探。
  let name = '';
  if (!html) {
    const slug = (durl.match(/\/video\/([^/]+)\//) || [])[1] || '';
    name = slug ? clean(slug.replace(/[-_]+/g, ' ')) : 'BestJavPorn';
  } else {
    name = og(html, 'title').replace(/\s*-\s*BestJavPorn\s*$/i, '');
  }
  if (name) subCacheName(durl, name); // 字幕搜索键优先用真片名 (见字幕聚合节)
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
  // 呈现 (清晰度自选): 按清晰度分组 tab —— tab 名即清晰度
  // (1080p/720p/480p…, 仅 5 字符, MiraPlayer tab 栏不会截断;
  // 本仓 missav.js 有质量 tab 先例), tab 按清晰度降序, 默认首
  // tab = 最高档, 网差时用户切低档 tab。tab 内每线一集, 集名 =
  // 宿主+lo+「·直」 (同名加 ·N 序号消歧), 集序沿用 lines 全局
  // 序在同档内的相对序 (出口组→宿主序→原序)。q 不明的线归
  // 「默认」tab 垫底; 嗅探兜底独立 tab 放最后 (下方 else 分支)。
  // 注: resolveLines 的全局排序不动 —— play() 靠它做"借线令牌
  // 在设备必 403 时替用户改走最优线"的守卫, 清晰度只落呈现层。
  const qGroups = new Map();
  lines.forEach((ln) => {
    const q = ln.q || 0;
    if (!qGroups.has(q)) qGroups.set(q, []);
    qGroups.get(q).push(ln);
  });
  const qOrder = [...qGroups.keys()].sort((a, b) => b - a);
  for (const q of qOrder) {
    fromNames.push(q ? q + 'p' : '默认');
    const seen = new Map();
    const eps = qGroups.get(q).map((ln) => {
      let nm = ln.lo && ln.lo !== 'main' ? `${ln.host}·${ln.lo}` : ln.host;
      if (ln.direct) nm += '·直';
      const n = (seen.get(nm) || 0) + 1;
      seen.set(nm, n);
      if (n > 1) nm += '·' + n;
      return nm + '$' + durl + '@@' + ln.idx + '.' + (ln.v || 0);
    });
    playUrls.push(eps.join('#'));
  }
  if (!lines.length) {
    // 铸造链没拿到线路: 给一条嗅探线, 线名带失败阶段便于真机归因
    // (真机 WebView 是真实浏览器, 站方 cast 链可在详情页内原生跑通)。
    // 第九轮: 分集名带铸造各通道逐个结论 (MiraPlayer 显示分集名),
    // 下一张截图即可读出死点与 own 是在抖还是恒死。
    fromNames.push('网页嗅探·' + (STAGE_TEXT[stage] || '铸造失败'));
    let epName;
    const bankNote = rl.bank === 'hit' ? '库命中·' : '库未命中·';
    if (stage === 'post-none') epName = '正片·' + bankNote + '铸造全灭 ' + (rl.postDiag || '无记录') + '·仅嗅探';
    else if (stage === 'post-bad') epName = '正片·' + bankNote + '铸造被站方拒 ' + (rl.postDiag || '无记录') + '·仅嗅探';
    else if (stage === 'embed') epName = '正片·' + bankNote + 'embed未解出' + (rl.pathsN ? ' 铸出' + rl.pathsN + '路' : '') + '·仅嗅探';
    else if (stage === 'seed') epName = '正片·无播放种子·仅嗅探';
    else epName = '正片·' + (STAGE_TEXT[stage] || '铸造失败') + '·仅嗅探';
    playUrls.push(epName.slice(0, 110) + '$' + durl + '@@sniff');
    contentParts.push('铸造诊断: ' + (STAGE_TEXT[stage] || '铸造失败') + (rl.postDiag ? ' (' + rl.postDiag + ')' : ''));
  } else {
    if (via) contentParts.push('铸造通道: ' + via);
    const nDirect = lines.filter((l) => l.direct).length;
    contentParts.push(`线路出口: 直连${nDirect}/${lines.length} (直连线令牌绑本机IP, 优先点带「·直」的线; 已按清晰度分 tab, 首个 tab 为最高档, 网差时切 720p tab)`);
    // 直链全为借线或仍播不了时的最后兜底: WebView 嗅探详情页
    fromNames.push('网页嗅探·兜底');
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
  if (id.includes(DIAG_ID)) return { parse: 0, url: '' };
  // @@sniff 伪线 (detail 时铸造链没拿到线路才生成): 点播时先再试一次
  // 完整铸造链 (通道有偶发性, 第二次常能成), 实在不行才落嗅探。
  const sniffOnly = id.endsWith('@@sniff');
  if (sniffOnly) id = id.slice(0, -'@@sniff'.length);
  const mm = id.match(/^(https?:\/\/\S+?)@@(\d+)(?:\.(\d+))?$/);
  const durl = mm ? mm[1] : absUrl(id);
  const wantIdx = mm ? parseInt(mm[2], 10) : -1;
  const wantV = mm && mm[3] !== undefined ? parseInt(mm[3], 10) : 0;
  // 详情缓存优先 (见详情线路缓存节): 10 分钟内且含所点的线, 直接
  // 用详情时那批线, 不重解; 否则现场重解 (令牌时效 + IP 绑定的要
  // 求仍在, 重解有线则刷新缓存)。选线: 可播组内优先 MP4 (见
  // pickPlayLine), 否则沿用旧规则 (同组尊重所点、异组回最优线)。
  // 字幕搜索与铸造链并行发起 (不串行叠加延迟; 见字幕聚合节)
  const subsP = subSearchAll(durl).catch(() => []);
  let lines = cachedLines(durl, wantIdx, wantV);
  if (!lines) {
    try { ({ lines } = await resolveLines(durl)); } catch (e) { lines = []; }
    if (lines.length) cacheLines(durl, lines);
  }
  if (!lines.length) return sniffResult(durl);
  const tapped = lines.find((l) => l.idx === wantIdx && (l.v || 0) === wantV) || lines.find((l) => l.idx === wantIdx);
  const pick = pickPlayLine(lines, tapped);
  const result = { parse: 0, url: pick.file, header: { 'User-Agent': UA, 'Referer': pick.embedUrl } };
  const subs = await subsP;
  if (subs && subs.length) result.subs = subs; // 无字幕命中时不带此键, 返回与接入前逐字段一致
  return result;
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const url = HOST + '/search/' + encodeURIComponent(wd) + '/' + (page > 1 ? 'page/' + page + '/' : '');
  const res = await fetchPage(url, { kind: 'list' });
  if (!res.html) return { page, pagecount: page, limit: 24, total: 0, list: [] };
  const list = parseCards(res.html);
  let pc = pagecountOf(res.html);
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
