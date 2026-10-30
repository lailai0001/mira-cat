// 7mmtv (https://7mmtv.sx/zh/) -> CatPawOpen spider
// 站点性质: 自研 PHP CMS 的 JAV 聚合站, SSR 直出。7 个视频分区
// (有码/无码破解/中字/无码/素人/国产/韩国直播; 中国直播 clive 站方
// 计数 0、实测列表为空, 不收; H漫画是图文区, 不收)。
// 列表: /zh/{section}_list/all/{page}.html, 每页 20 卡;
// 片商: /zh/{section}_makersr/{id}/{name}/{page}.html;
// 标签: /zh/{section}_category/{id}/{label}/{page}.html
// (标签表来自站方分类筛选表单: censored 216 个 + amateurjav 117 个,
//  均为站方官方条目, 已抽样实测有内容)。
// 封面: n3.1024cdn.sx / n3.1025cdn.sx 直链, 实测无防盗链, 不需代理。
//
// 播放链 (2026-10-21 侦察坐实): 详情页 mvarr 数组给出各服务器 embed,
// 地址经两层混淆: (1) hsdf: 以字符 'c'(=char(hc+97)) 切分的 base-hc
// 数字串, 逐个 parseInt(..,hc) 后 XOR ha 得 base64 串; (2) CryptoJS
// AES-128-CBC 解密 (key/iv 是详情页内每页随机的 argdeqweqweqwz /
// hdddedf252 全局量, hc/hadeedg252 本次实测恒为 2/21, 仍按页解析)。
// 本文件内嵌纯 JS AES-128 解密实现 (3 组真实向量验证一致), 不依赖
// node:crypto (App 运行时可用性未定), 不用 vm 模块。
// 服务器构成 (站方按钮名):
//   SW = mmsi02.com/e/  —— vidhide/earnvid 系 (streamhide 品牌壳)
//   VH = mmvh02.com/v/  —— vidhide 系
//   DO = playmogo.com/e/ —— DoodStream 镜像, embed 页被 Cloudflare
//        Turnstile 交互验证门禁, 蜘蛛无法取流 (仅 parse:1 兜底列出)
//   SP = 站方 play.php —— 对 VM/机房等全部非浏览器出口只回 110B 空壳
//        (POST/带 Cookie/伪 iframe 头/换中转均实测), 无法验证取流
//        (仅 parse:1 兜底列出)
// vidhide 系按请求方网络身份放行 (m3u8 token 明文带 asn=), 蜘蛛直解
// 或播放器裸连在真机必死 (JavGG 项目已坐实), 故 SW/VH 走全链同出口
// Worker 代理 (与 javgg-vidhide v3 同形态, 本源配套 mmtv-vidhide):
// 播放器只连 Worker, embed 解码在蜘蛛侧完成后把 embed 地址交给
// Worker /v, Worker 内完成抓 embed/解包/铸 token/拉列表/透传分片。
// 分片伪装 (本地实测): SW(mmsi02) 线 hls4 分片带 70 字节 PNG 头
// (首字节 0x89, 其后为 188 对齐真 TS), 原生播放器不认 —— 配套
// Worker 的 /s 带图片前缀剥离 (与 BigButtsHub 二轮同款已验逻辑);
// VH(mmvh02) 线分片实测为干净 TS。
// 2026-10-21 二轮 (真机反馈: 部分帖 SW/VH 点开播不了) 普查结论:
// vidhide 系 embed 的 links 分三档 (hls4/hls3/hls2), 只有 hls4 档的
// token 能被同出口 Worker 链用活; hls3/hls2 对一切非浏览器/机房出口
// 一律 403/连接切断/502 (VM 与 Worker 出口双实证)。不少帖子的 embed
// 根本没有 hls4 档 (如 censored 的 SSIS-832 三条 W 线全无 hls4) ——
// 这类线经 Worker 必 502, 是死线。另有 hls4 档在、但分片后端整表
// 死亡的 (redirector.cdnsync.cloud 全段 522, 如 censored SSIS-817
// 的 VH 线)。SW 线 (qooglecdn 后端) 本轮抽测 100% 存活, VH 线分片
// 后端 (cdnsync) 明显更脆。
// 二轮 detail 策略: 对每条 W 线 embed 在蜘蛛侧抓 embed 页解包验档
// (纯 JS Dean Edwards 解包, 与 Worker 同算法), 只保留有 hls4 的线;
// 本帖 W 线全灭时按番号借同片其他分区版本的线 (借线触发条件由
// "无 W 线" 放宽为 "无可用 W 线", SSIS-832/817 即靠借 reducing-
// mosaic 版的 SW 线得救); 组装后对首条 W 线经 Worker 探活首分片,
// 死则把第二条 W 线提到前面。探测失败 (网络异常) 一律按存活对待,
// 绝不因探测误杀好线。
// 无码破解 (reducing-mosaic) 等分区的部分帖子全站任何版本都没有
// vidhide 线 (只有 SP/DO): 这类帖无可借之线, 只剩 SP/DO 嗅探兜底,
// 属站方内容构成问题, 非蜘蛛可解 (如 FTHT-360、259LUXU-990)。
// (一轮旧注 "无码破解详情页只有 SP 一条线" 不准确: 该分区多数帖
//  有自己的 SW/VH 线, 少数帖才只有 SP。)
import req from '../../util/req.js';

const KEY = 'py_7mmtv';
const NAME = '7mmtv';
const HOST = 'https://7mmtv.sx';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = HOST + '/zh/';
// vidhide 系全链代理 Worker (用户手动部署 mmtv-vidhide 后生效)
const MMTV_WORKER = 'https://mmtv-vidhide.li768435813.workers.dev';

const CATS = [
  { type_id: 'list:censored', type_name: '有碼AV' },
  { type_id: 'list:reducing-mosaic', type_name: '無碼破解' },
  { type_id: 'list:chinese', type_name: '中字AV' },
  { type_id: 'tag:censored:50', type_name: "巨尻", arg: "巨尻" },
  { type_id: 'tag:censored:127', type_name: "巨乳", arg: "巨乳" },
  { type_id: 'tag:censored:137', type_name: "屁股", arg: "屁股" },
  { type_id: 'list:uncensored', type_name: '無碼AV' },
  { type_id: 'list:amateurjav', type_name: '素人AV' },
  { type_id: 'list:amateur', type_name: '國產影片' },
  { type_id: 'list:klive', type_name: '韓國直播' },
  { type_id: 'maker:amateurjav:1752', type_name: "シロウトTV(SIRO)", arg: "シロウトTV(SIRO)" },
  { type_id: 'maker:amateurjav:1586', type_name: "ラグジュTV(LUXU)", arg: "ラグジュTV(LUXU)" },
  { type_id: 'maker:amateurjav:1751', type_name: "ナンパTV(200GANA)", arg: "ナンパTV(200GANA)" },
  { type_id: 'maker:amateurjav:1318', type_name: "PRESTIGE PREMIUM(300MAAN)", arg: "PRESTIGE PREMIUM(300MAAN)" },
  { type_id: 'maker:amateurjav:1069', type_name: "S-CUTE", arg: "S-CUTE" },
  { type_id: 'maker:amateurjav:1585', type_name: "ARA", arg: "ARA" },
  { type_id: 'maker:uncensored:37', type_name: "FC2", arg: "FC2" },
  { type_id: 'maker:uncensored:17', type_name: "HEYZO", arg: "HEYZO" },
  { type_id: 'maker:uncensored:29', type_name: "東京熱(Tokyo Hot)", arg: "東京熱(Tokyo Hot)" },
  { type_id: 'maker:uncensored:32', type_name: "一本道(1pondo)", arg: "一本道(1pondo)" },
  { type_id: 'maker:uncensored:30', type_name: "カリビアンコム(Caribbeancom)", arg: "カリビアンコム(Caribbeancom)" },
  { type_id: 'maker:uncensored:40', type_name: "カリビアンコム PPV(Caribbeancompr)", arg: "カリビアンコムPPV(Caribbeancompr)" },
  { type_id: 'maker:uncensored:31', type_name: "天然むすめ(10musume)", arg: "天然むすめ(10musume)" },
  { type_id: 'maker:uncensored:36', type_name: "パコパコママ(pacopacomama)", arg: "パコパコママ(pacopacomama)" },
  { type_id: 'maker:uncensored:35', type_name: "ガチん娘！(Gachinco)", arg: "ガチん娘！(Gachinco)" },
  { type_id: 'maker:uncensored:34', type_name: "エッチな4610", arg: "エッチな4610" },
  { type_id: 'maker:uncensored:38', type_name: "人妻斬り0930", arg: "人妻斬り0930" },
  { type_id: 'maker:uncensored:39', type_name: "エッチな0930", arg: "エッチな0930" },
  { type_id: 'maker:uncensored:126', type_name: "トリプルエックス (XXX-AV)", arg: "トリプルエックス (XXX-AV)" },
  { type_id: 'tag:censored:1', type_name: "企畫", arg: "企畫" },
  { type_id: 'tag:censored:2', type_name: "女同性戀", arg: "女同性戀" },
  { type_id: 'tag:censored:3', type_name: "獵豔", arg: "獵豔" },
  { type_id: 'tag:censored:4', type_name: "野外・露出", arg: "野外・露出" },
  { type_id: 'tag:censored:5', type_name: "偶像藝人", arg: "偶像藝人" },
  { type_id: 'tag:censored:6', type_name: "其他戀物癖", arg: "其他戀物癖" },
  { type_id: 'tag:censored:7', type_name: "近親相姦", arg: "近親相姦" },
  { type_id: 'tag:censored:8', type_name: "戀乳癖", arg: "戀乳癖" },
  { type_id: 'tag:censored:9', type_name: "情侶", arg: "情侶" },
  { type_id: 'tag:censored:10', type_name: "男同性恋", arg: "男同性恋" },
  { type_id: 'tag:censored:11', type_name: "花癡", arg: "花癡" },
  { type_id: 'tag:censored:12', type_name: "偷窥", arg: "偷窥" },
  { type_id: 'tag:censored:13', type_name: "戀腿癖", arg: "戀腿癖" },
  { type_id: 'tag:censored:14', type_name: "其他", arg: "其他" },
  { type_id: 'tag:censored:15', type_name: "性騷擾", arg: "性騷擾" },
  { type_id: 'tag:censored:16', type_name: "倒追", arg: "倒追" },
  { type_id: 'tag:censored:17', type_name: "性奴", arg: "性奴" },
  { type_id: 'tag:censored:18', type_name: "跳舞", arg: "跳舞" },
  { type_id: 'tag:censored:19', type_name: "雙性人", arg: "雙性人" },
  { type_id: 'tag:censored:20', type_name: "姐妹", arg: "姐妹" },
  { type_id: 'tag:censored:21', type_name: "通姦", arg: "通姦" },
  { type_id: 'tag:censored:22', type_name: "粗暴", arg: "粗暴" },
  { type_id: 'tag:censored:23', type_name: "學校作品", arg: "學校作品" },
  { type_id: 'tag:censored:24', type_name: "惡作劇", arg: "惡作劇" },
  { type_id: 'tag:censored:25', type_name: "妄想", arg: "妄想" },
  { type_id: 'tag:censored:26', type_name: "殘忍畫面", arg: "殘忍畫面" },
  { type_id: 'tag:censored:27', type_name: "爛醉如泥的", arg: "爛醉如泥的" },
  { type_id: 'tag:censored:28', type_name: "處女", arg: "處女" },
  { type_id: 'tag:censored:29', type_name: "美容院", arg: "美容院" },
  { type_id: 'tag:censored:30', type_name: "性感的", arg: "性感的" },
  { type_id: 'tag:censored:31', type_name: "女同接吻", arg: "女同接吻" },
  { type_id: 'tag:censored:32', type_name: "運動", arg: "運動" },
  { type_id: 'tag:censored:33', type_name: "瘙癢", arg: "瘙癢" },
  { type_id: 'tag:censored:34', type_name: "出軌", arg: "出軌" },
  { type_id: 'tag:censored:35', type_name: "正太控", arg: "正太控" },
  { type_id: 'tag:censored:36', type_name: "處男", arg: "處男" },
  { type_id: 'tag:censored:37', type_name: "蠻橫嬌羞", arg: "蠻橫嬌羞" },
  { type_id: 'tag:censored:38', type_name: "觸手", arg: "觸手" },
  { type_id: 'tag:censored:39', type_name: "嘔吐", arg: "嘔吐" },
  { type_id: 'tag:censored:40', type_name: "折磨", arg: "折磨" },
  { type_id: 'tag:censored:42', type_name: "女優ベスト・総集編", arg: "女優ベスト・総集編" },
  { type_id: 'tag:censored:43', type_name: "温泉", arg: "温泉" },
  { type_id: 'tag:censored:44', type_name: "M男", arg: "M男" },
  { type_id: 'tag:censored:45', type_name: "原作コラボ", arg: "原作コラボ" },
  { type_id: 'tag:censored:46', type_name: "16時間以上作品", arg: "16時間以上作品" },
  { type_id: 'tag:censored:47', type_name: "デカチン・巨根", arg: "デカチン・巨根" },
  { type_id: 'tag:censored:48', type_name: "ファン感謝・訪問", arg: "ファン感謝・訪問" },
  { type_id: 'tag:censored:51', type_name: "ハーレム", arg: "ハーレム" },
  { type_id: 'tag:censored:52', type_name: "日焼け", arg: "日焼け" },
  { type_id: 'tag:censored:53', type_name: "早漏", arg: "早漏" },
  { type_id: 'tag:censored:54', type_name: "キス・接吻", arg: "キス・接吻" },
  { type_id: 'tag:censored:55', type_name: "汗だく", arg: "汗だく" },
  { type_id: 'tag:censored:56', type_name: "服務生", arg: "服務生" },
  { type_id: 'tag:censored:57', type_name: "高中女生", arg: "高中女生" },
  { type_id: 'tag:censored:58', type_name: "女主播", arg: "女主播" },
  { type_id: 'tag:censored:59', type_name: "女生", arg: "女生" },
  { type_id: 'tag:censored:60', type_name: "黑人演員", arg: "黑人演員" },
  { type_id: 'tag:censored:61', type_name: "蕩婦", arg: "蕩婦" },
  { type_id: 'tag:censored:62', type_name: "護士", arg: "護士" },
  { type_id: 'tag:censored:63', type_name: "家教", arg: "家教" },
  { type_id: 'tag:censored:64', type_name: "母親", arg: "母親" },
  { type_id: 'tag:censored:65', type_name: "女教師", arg: "女教師" },
  { type_id: 'tag:censored:66', type_name: "展場女孩", arg: "展場女孩" },
  { type_id: 'tag:censored:67', type_name: "女大學生", arg: "女大學生" },
  { type_id: 'tag:censored:68', type_name: "賽車女郎", arg: "賽車女郎" },
  { type_id: 'tag:censored:69', type_name: "妓女", arg: "妓女" },
  { type_id: 'tag:censored:70', type_name: "各種職業", arg: "各種職業" },
  { type_id: 'tag:censored:71', type_name: "女醫生", arg: "女醫生" },
  { type_id: 'tag:censored:72', type_name: "已婚婦女", arg: "已婚婦女" },
  { type_id: 'tag:censored:73', type_name: "白人", arg: "白人" },
  { type_id: 'tag:censored:74', type_name: "千金小姐", arg: "千金小姐" },
  { type_id: 'tag:censored:75', type_name: "寡婦", arg: "寡婦" },
  { type_id: 'tag:censored:76', type_name: "車掌小姐", arg: "車掌小姐" },
  { type_id: 'tag:censored:77', type_name: "格鬥家", arg: "格鬥家" },
  { type_id: 'tag:censored:78', type_name: "姐姐", arg: "姐姐" },
  { type_id: 'tag:censored:79', type_name: "新娘、嫩妻", arg: "新娘、嫩妻" },
  { type_id: 'tag:censored:80', type_name: "美少女", arg: "美少女" },
  { type_id: 'tag:censored:81', type_name: "秘書", arg: "秘書" },
  { type_id: 'tag:censored:82', type_name: "模特兒", arg: "模特兒" },
  { type_id: 'tag:censored:83', type_name: "女主人、女老板", arg: "女主人、女老板" },
  { type_id: 'tag:censored:84', type_name: "明星臉", arg: "明星臉" },
  { type_id: 'tag:censored:85', type_name: "女檢察官", arg: "女檢察官" },
  { type_id: 'tag:censored:86', type_name: "格鬥家", arg: "格鬥家" },
  { type_id: 'tag:censored:87', type_name: "義母", arg: "義母" },
  { type_id: 'tag:censored:88', type_name: "講師", arg: "講師" },
  { type_id: 'tag:censored:89', type_name: "伴侶", arg: "伴侶" },
  { type_id: 'tag:censored:90', type_name: "亞洲女演員", arg: "亞洲女演員" },
  { type_id: 'tag:censored:91', type_name: "公主", arg: "公主" },
  { type_id: 'tag:censored:92', type_name: "童年朋友", arg: "童年朋友" },
  { type_id: 'tag:censored:93', type_name: "黑幫成員", arg: "黑幫成員" },
  { type_id: 'tag:censored:94', type_name: "角色扮演", arg: "角色扮演" },
  { type_id: 'tag:censored:95', type_name: "眼鏡", arg: "眼鏡" },
  { type_id: 'tag:censored:96', type_name: "泳裝", arg: "泳裝" },
  { type_id: 'tag:censored:97', type_name: "校服", arg: "校服" },
  { type_id: 'tag:censored:98', type_name: "迷你裙", arg: "迷你裙" },
  { type_id: 'tag:censored:99', type_name: "女樸", arg: "女樸" },
  { type_id: 'tag:censored:100', type_name: "旗袍", arg: "旗袍" },
  { type_id: 'tag:censored:101', type_name: "學校泳裝", arg: "學校泳裝" },
  { type_id: 'tag:censored:102', type_name: "水手服", arg: "水手服" },
  { type_id: 'tag:censored:103', type_name: "內衣", arg: "內衣" },
  { type_id: 'tag:censored:104', type_name: "體育服", arg: "體育服" },
  { type_id: 'tag:censored:105', type_name: "和服・喪服", arg: "和服・喪服" },
  { type_id: 'tag:censored:106', type_name: "OL", arg: "OL" },
  { type_id: 'tag:censored:107', type_name: "身體意識", arg: "身體意識" },
  { type_id: 'tag:censored:108', type_name: "連褲襪", arg: "連褲襪" },
  { type_id: 'tag:censored:109', type_name: "空中小姐", arg: "空中小姐" },
  { type_id: 'tag:censored:110', type_name: "迷你裙警察", arg: "迷你裙警察" },
  { type_id: 'tag:censored:111', type_name: "裸體圍裙", arg: "裸體圍裙" },
  { type_id: 'tag:censored:112', type_name: "緊身衣", arg: "緊身衣" },
  { type_id: 'tag:censored:113', type_name: "制服", arg: "制服" },
  { type_id: 'tag:censored:114', type_name: "泡泡襪", arg: "泡泡襪" },
  { type_id: 'tag:censored:115', type_name: "女祭司", arg: "女祭司" },
  { type_id: 'tag:censored:116', type_name: "貓耳女", arg: "貓耳女" },
  { type_id: 'tag:censored:117', type_name: "兔女郎", arg: "兔女郎" },
  { type_id: 'tag:censored:118', type_name: "猥褻穿著", arg: "猥褻穿著" },
  { type_id: 'tag:censored:119', type_name: "內衣", arg: "內衣" },
  { type_id: 'tag:censored:120', type_name: "女裝人妖", arg: "女裝人妖" },
  { type_id: 'tag:censored:121', type_name: "女忍者", arg: "女忍者" },
  { type_id: 'tag:censored:122', type_name: "娃娃", arg: "娃娃" },
  { type_id: 'tag:censored:123', type_name: "及膝襪", arg: "及膝襪" },
  { type_id: 'tag:censored:124', type_name: "女戰士", arg: "女戰士" },
  { type_id: 'tag:censored:126', type_name: "角色扮演", arg: "角色扮演" },
  { type_id: 'tag:censored:128', type_name: "貧乳・微乳", arg: "貧乳・微乳" },
  { type_id: 'tag:censored:249', type_name: "蘿莉", arg: "蘿莉" },
  { type_id: 'tag:censored:130', type_name: "熟女", arg: "熟女" },
  { type_id: 'tag:censored:131', type_name: "孕婦", arg: "孕婦" },
  { type_id: 'tag:censored:132', type_name: "苗條", arg: "苗條" },
  { type_id: 'tag:censored:133', type_name: "胖女人", arg: "胖女人" },
  { type_id: 'tag:censored:134', type_name: "無毛", arg: "無毛" },
  { type_id: 'tag:censored:135', type_name: "變性者", arg: "變性者" },
  { type_id: 'tag:censored:136', type_name: "高", arg: "高" },
  { type_id: 'tag:censored:250', type_name: "嬌小的", arg: "嬌小的" },
  { type_id: 'tag:censored:139', type_name: "乳房", arg: "乳房" },
  { type_id: 'tag:censored:140', type_name: "肌肉", arg: "肌肉" },
  { type_id: 'tag:censored:141', type_name: "超乳", arg: "超乳" },
  { type_id: 'tag:censored:142', type_name: "中出", arg: "中出" },
  { type_id: 'tag:censored:143', type_name: "顏射", arg: "顏射" },
  { type_id: 'tag:censored:144', type_name: "自慰", arg: "自慰" },
  { type_id: 'tag:censored:145', type_name: "顏射", arg: "顏射" },
  { type_id: 'tag:censored:146', type_name: "肛交", arg: "肛交" },
  { type_id: 'tag:censored:147', type_name: "吞精", arg: "吞精" },
  { type_id: 'tag:censored:148', type_name: "打手槍", arg: "打手槍" },
  { type_id: 'tag:censored:149', type_name: "放尿", arg: "放尿" },
  { type_id: 'tag:censored:150', type_name: "亂交", arg: "亂交" },
  { type_id: 'tag:censored:151', type_name: "口交", arg: "口交" },
  { type_id: 'tag:censored:152', type_name: "飲尿", arg: "飲尿" },
  { type_id: 'tag:censored:153', type_name: "排便", arg: "排便" },
  { type_id: 'tag:censored:154', type_name: "乳交", arg: "乳交" },
  { type_id: 'tag:censored:155', type_name: "潮吹", arg: "潮吹" },
  { type_id: 'tag:censored:156', type_name: "淫語", arg: "淫語" },
  { type_id: 'tag:censored:157', type_name: "69", arg: "69" },
  { type_id: 'tag:censored:158', type_name: "深喉", arg: "深喉" },
  { type_id: 'tag:censored:159', type_name: "拳交", arg: "拳交" },
  { type_id: 'tag:censored:160', type_name: "舔陰", arg: "舔陰" },
  { type_id: 'tag:censored:161', type_name: "騎乗位", arg: "騎乗位" },
  { type_id: 'tag:censored:162', type_name: "按摩", arg: "按摩" },
  { type_id: 'tag:censored:163', type_name: "手指插入", arg: "手指插入" },
  { type_id: 'tag:censored:164', type_name: "母乳", arg: "母乳" },
  { type_id: 'tag:censored:165', type_name: "足交", arg: "足交" },
  { type_id: 'tag:censored:166', type_name: "食糞", arg: "食糞" },
  { type_id: 'tag:censored:167', type_name: "顏面騎乘", arg: "顏面騎乘" },
  { type_id: 'tag:censored:168', type_name: "肛内中出", arg: "肛内中出" },
  { type_id: 'tag:censored:169', type_name: "多P", arg: "多P" },
  { type_id: 'tag:censored:170', type_name: "按摩棒", arg: "按摩棒" },
  { type_id: 'tag:censored:171', type_name: "緊縛", arg: "緊縛" },
  { type_id: 'tag:censored:172', type_name: "跳蛋", arg: "跳蛋" },
  { type_id: 'tag:censored:173', type_name: "玩具", arg: "玩具" },
  { type_id: 'tag:censored:174', type_name: "糞便", arg: "糞便" },
  { type_id: 'tag:censored:175', type_name: "SM", arg: "SM" },
  { type_id: 'tag:censored:176', type_name: "車震", arg: "車震" },
  { type_id: 'tag:censored:177', type_name: "藥物", arg: "藥物" },
  { type_id: 'tag:censored:179', type_name: "緊縛", arg: "緊縛" },
  { type_id: 'tag:censored:180', type_name: "監禁", arg: "監禁" },
  { type_id: 'tag:censored:181', type_name: "灌腸", arg: "灌腸" },
  { type_id: 'tag:censored:182', type_name: "鴨嘴", arg: "鴨嘴" },
  { type_id: 'tag:censored:183', type_name: "插入異物", arg: "插入異物" },
  { type_id: 'tag:censored:184', type_name: "輪姦", arg: "輪姦" },
  { type_id: 'tag:censored:185', type_name: "拘束", arg: "拘束" },
  { type_id: 'tag:censored:186', type_name: "凌辱", arg: "凌辱" },
  { type_id: 'tag:censored:187', type_name: "羞恥", arg: "羞恥" },
  { type_id: 'tag:censored:188', type_name: "乳液", arg: "乳液" },
  { type_id: 'tag:censored:189', type_name: "催眠", arg: "催眠" },
  { type_id: 'tag:censored:190', type_name: "子宮頸", arg: "子宮頸" },
  { type_id: 'tag:censored:191', type_name: "女優按摩棒", arg: "女優按摩棒" },
  { type_id: 'tag:censored:192', type_name: "立即口交", arg: "立即口交" },
  { type_id: 'tag:censored:193', type_name: "合集", arg: "合集" },
  { type_id: 'tag:censored:194', type_name: "單體作品", arg: "單體作品" },
  { type_id: 'tag:censored:195', type_name: "DMM獨家", arg: "DMM獨家" },
  { type_id: 'tag:censored:197', type_name: "局部特寫", arg: "局部特寫" },
  { type_id: 'tag:censored:198', type_name: "素人", arg: "素人" },
  { type_id: 'tag:censored:199', type_name: "第一人稱攝影", arg: "第一人稱攝影" },
  { type_id: 'tag:censored:200', type_name: "國外進口", arg: "國外進口" },
  { type_id: 'tag:censored:201', type_name: "纪录片", arg: "纪录片" },
  { type_id: 'tag:censored:202', type_name: "投稿", arg: "投稿" },
  { type_id: 'tag:censored:203', type_name: "數位馬賽克", arg: "數位馬賽克" },
  { type_id: 'tag:censored:204', type_name: "首次亮相", arg: "首次亮相" },
  { type_id: 'tag:censored:206', type_name: "薄馬賽克", arg: "薄馬賽克" },
  { type_id: 'tag:censored:207', type_name: "4小時以上作品", arg: "4小時以上作品" },
  { type_id: 'tag:censored:208', type_name: "介紹影片", arg: "介紹影片" },
  { type_id: 'tag:censored:209', type_name: "主觀視角", arg: "主觀視角" },
  { type_id: 'tag:censored:210', type_name: "高畫質", arg: "高畫質" },
  { type_id: 'tag:censored:211', type_name: "戀愛", arg: "戀愛" },
  { type_id: 'tag:censored:212', type_name: "戲劇", arg: "戲劇" },
  { type_id: 'tag:censored:213', type_name: "複刻版", arg: "複刻版" },
  { type_id: 'tag:censored:214', type_name: "限時降價", arg: "限時降價" },
  { type_id: 'tag:censored:215', type_name: "故事集", arg: "故事集" },
  { type_id: 'tag:censored:216', type_name: "特效", arg: "特效" },
  { type_id: 'tag:censored:217', type_name: "3D", arg: "3D" },
  { type_id: 'tag:censored:218', type_name: "戲劇", arg: "戲劇" },
  { type_id: 'tag:censored:222', type_name: "教學", arg: "教學" },
  { type_id: 'tag:censored:223', type_name: "給女性觀眾", arg: "給女性觀眾" },
  { type_id: 'tag:censored:224', type_name: "恐怖", arg: "恐怖" },
  { type_id: 'tag:censored:225', type_name: "合作作品", arg: "合作作品" },
  { type_id: 'tag:amateurjav:3', type_name: "花癡", arg: "花癡" },
  { type_id: 'tag:amateurjav:4', type_name: "獵豔、搭訕", arg: "獵豔、搭訕" },
  { type_id: 'tag:amateurjav:19', type_name: "美容按摩", arg: "美容按摩" },
  { type_id: 'tag:amateurjav:21', type_name: "情侶", arg: "情侶" },
  { type_id: 'tag:amateurjav:55', type_name: "風俗", arg: "風俗" },
  { type_id: 'tag:amateurjav:24', type_name: "企畫", arg: "企畫" },
  { type_id: 'tag:amateurjav:27', type_name: "偷窥", arg: "偷窥" },
  { type_id: 'tag:amateurjav:32', type_name: "通姦", arg: "通姦" },
  { type_id: 'tag:amateurjav:36', type_name: "女同性戀", arg: "女同性戀" },
  { type_id: 'tag:amateurjav:43', type_name: "處男", arg: "處男" },
  { type_id: 'tag:amateurjav:48', type_name: "近親相姦", arg: "近親相姦" },
  { type_id: 'tag:amateurjav:58', type_name: "汗だく", arg: "汗だく" },
  { type_id: 'tag:amateurjav:80', type_name: "奴隷", arg: "奴隷" },
  { type_id: 'tag:amateurjav:81', type_name: "デカチン・巨根", arg: "デカチン・巨根" },
  { type_id: 'tag:amateurjav:86', type_name: "野外・露出", arg: "野外・露出" },
  { type_id: 'tag:amateurjav:102', type_name: "鬼畜", arg: "鬼畜" },
  { type_id: 'tag:amateurjav:115', type_name: "巨尻", arg: "巨尻" },
  { type_id: 'tag:amateurjav:121', type_name: "倒追", arg: "倒追" },
  { type_id: 'tag:amateurjav:127', type_name: "運動", arg: "運動" },
  { type_id: 'tag:amateurjav:128', type_name: "温泉", arg: "温泉" },
  { type_id: 'tag:amateurjav:130', type_name: "姐妹", arg: "姐妹" },
  { type_id: 'tag:amateurjav:133', type_name: "處女", arg: "處女" },
  { type_id: 'tag:amateurjav:143', type_name: "爛醉如泥的", arg: "爛醉如泥的" },
  { type_id: 'tag:amateurjav:160', type_name: "偶像藝人", arg: "偶像藝人" },
  { type_id: 'tag:amateurjav:169', type_name: "出軌", arg: "出軌" },
  { type_id: 'tag:amateurjav:187', type_name: "日焼け", arg: "日焼け" },
  { type_id: 'tag:amateurjav:73', type_name: "金髪・ブロンド", arg: "金髪・ブロンド" },
  { type_id: 'tag:amateurjav:147', type_name: "淫亂", arg: "淫亂" },
  { type_id: 'tag:amateurjav:5', type_name: "人妻", arg: "人妻" },
  { type_id: 'tag:amateurjav:6', type_name: "女生", arg: "女生" },
  { type_id: 'tag:amateurjav:13', type_name: "高中女生", arg: "高中女生" },
  { type_id: 'tag:amateurjav:23', type_name: "痴女", arg: "痴女" },
  { type_id: 'tag:amateurjav:29', type_name: "女大學生", arg: "女大學生" },
  { type_id: 'tag:amateurjav:31', type_name: "新娘、嫩妻", arg: "新娘、嫩妻" },
  { type_id: 'tag:amateurjav:35', type_name: "姐姐", arg: "姐姐" },
  { type_id: 'tag:amateurjav:39', type_name: "各種職業", arg: "各種職業" },
  { type_id: 'tag:amateurjav:46', type_name: "妓女", arg: "妓女" },
  { type_id: 'tag:amateurjav:53', type_name: "美少女", arg: "美少女" },
  { type_id: 'tag:amateurjav:59', type_name: "女教師", arg: "女教師" },
  { type_id: 'tag:amateurjav:75', type_name: "護士", arg: "護士" },
  { type_id: 'tag:amateurjav:76', type_name: "千金小姐", arg: "千金小姐" },
  { type_id: 'tag:amateurjav:175', type_name: "模特兒", arg: "模特兒" },
  { type_id: 'tag:amateurjav:183', type_name: "女主播", arg: "女主播" },
  { type_id: 'tag:amateurjav:186', type_name: "教練", arg: "教練" },
  { type_id: 'tag:amateurjav:195', type_name: "伴侶", arg: "伴侶" },
  { type_id: 'tag:amateurjav:93', type_name: "空姐・CA", arg: "空姐・CA" },
  { type_id: 'tag:amateurjav:9', type_name: "角色扮演", arg: "角色扮演" },
  { type_id: 'tag:amateurjav:68', type_name: "和服・浴衣", arg: "和服・浴衣" },
  { type_id: 'tag:amateurjav:26', type_name: "OL", arg: "OL" },
  { type_id: 'tag:amateurjav:60', type_name: "制服", arg: "制服" },
  { type_id: 'tag:amateurjav:65', type_name: "迷你裙", arg: "迷你裙" },
  { type_id: 'tag:amateurjav:69', type_name: "女僕", arg: "女僕" },
  { type_id: 'tag:amateurjav:70', type_name: "內衣", arg: "內衣" },
  { type_id: 'tag:amateurjav:101', type_name: "泳裝", arg: "泳裝" },
  { type_id: 'tag:amateurjav:113', type_name: "及膝襪", arg: "及膝襪" },
  { type_id: 'tag:amateurjav:120', type_name: "眼鏡", arg: "眼鏡" },
  { type_id: 'tag:amateurjav:126', type_name: "學校泳裝", arg: "學校泳裝" },
  { type_id: 'tag:amateurjav:8', type_name: "乳房", arg: "乳房" },
  { type_id: 'tag:amateurjav:11', type_name: "苗條", arg: "苗條" },
  { type_id: 'tag:amateurjav:17', type_name: "熟女", arg: "熟女" },
  { type_id: 'tag:amateurjav:33', type_name: "巨乳", arg: "巨乳" },
  { type_id: 'tag:amateurjav:85', type_name: "爆乳", arg: "爆乳" },
  { type_id: 'tag:amateurjav:54', type_name: "屁股", arg: "屁股" },
  { type_id: 'tag:amateurjav:89', type_name: "無毛", arg: "無毛" },
  { type_id: 'tag:amateurjav:90', type_name: "貧乳・微乳", arg: "貧乳・微乳" },
  { type_id: 'tag:amateurjav:119', type_name: "高", arg: "高" },
  { type_id: 'tag:amateurjav:129', type_name: "胖女人", arg: "胖女人" },
  { type_id: 'tag:amateurjav:49', type_name: "童顔", arg: "童顔" },
  { type_id: 'tag:amateurjav:231', type_name: "D杯", arg: "D杯" },
  { type_id: 'tag:amateurjav:226', type_name: "E杯", arg: "E杯" },
  { type_id: 'tag:amateurjav:229', type_name: "F杯", arg: "F杯" },
  { type_id: 'tag:amateurjav:230', type_name: "G杯", arg: "G杯" },
  { type_id: 'tag:amateurjav:222', type_name: "H杯", arg: "H杯" },
  { type_id: 'tag:amateurjav:125', type_name: "口内発射", arg: "口内発射" },
  { type_id: 'tag:amateurjav:15', type_name: "中出", arg: "中出" },
  { type_id: 'tag:amateurjav:16', type_name: "自慰", arg: "自慰" },
  { type_id: 'tag:amateurjav:18', type_name: "打手槍", arg: "打手槍" },
  { type_id: 'tag:amateurjav:25', type_name: "顏射", arg: "顏射" },
  { type_id: 'tag:amateurjav:34', type_name: "潮吹", arg: "潮吹" },
  { type_id: 'tag:amateurjav:40', type_name: "乳交", arg: "乳交" },
  { type_id: 'tag:amateurjav:57', type_name: "亂交", arg: "亂交" },
  { type_id: 'tag:amateurjav:62', type_name: "深喉", arg: "深喉" },
  { type_id: 'tag:amateurjav:79', type_name: "肛交", arg: "肛交" },
  { type_id: 'tag:amateurjav:88', type_name: "顏射", arg: "顏射" },
  { type_id: 'tag:amateurjav:95', type_name: "顏面騎乘", arg: "顏面騎乘" },
  { type_id: 'tag:amateurjav:104', type_name: "足交", arg: "足交" },
  { type_id: 'tag:amateurjav:161', type_name: "母乳", arg: "母乳" },
  { type_id: 'tag:amateurjav:181', type_name: "吞精", arg: "吞精" },
  { type_id: 'tag:amateurjav:37', type_name: "放尿・失禁", arg: "放尿・失禁" },
  { type_id: 'tag:amateurjav:42', type_name: "羞恥・辱め", arg: "羞恥・辱め" },
  { type_id: 'tag:amateurjav:7', type_name: "女優按摩棒", arg: "女優按摩棒" },
  { type_id: 'tag:amateurjav:14', type_name: "拘束", arg: "拘束" },
  { type_id: 'tag:amateurjav:38', type_name: "按摩棒", arg: "按摩棒" },
  { type_id: 'tag:amateurjav:50', type_name: "SM", arg: "SM" },
  { type_id: 'tag:amateurjav:51', type_name: "車震", arg: "車震" },
  { type_id: 'tag:amateurjav:64', type_name: "立即口交", arg: "立即口交" },
  { type_id: 'tag:amateurjav:108', type_name: "多P", arg: "多P" },
  { type_id: 'tag:amateurjav:123', type_name: "輪姦", arg: "輪姦" },
  { type_id: 'tag:amateurjav:56', type_name: "乳液・油", arg: "乳液・油" },
  { type_id: 'tag:amateurjav:72', type_name: "藥物・壯陽藥", arg: "藥物・壯陽藥" },
  { type_id: 'tag:amateurjav:1', type_name: "素人", arg: "素人" },
  { type_id: 'tag:amateurjav:106', type_name: "配信専用素人", arg: "配信専用素人" },
  { type_id: 'tag:amateurjav:228', type_name: "短髮", arg: "短髮" },
  { type_id: 'tag:amateurjav:145', type_name: "清楚", arg: "清楚" },
  { type_id: 'tag:amateurjav:66', type_name: "美腳", arg: "美腳" },
  { type_id: 'tag:amateurjav:67', type_name: "美尻", arg: "美尻" },
  { type_id: 'tag:amateurjav:103', type_name: "手マン", arg: "手マン" },
  { type_id: 'tag:amateurjav:78', type_name: "初撮り", arg: "初撮り" },
  { type_id: 'tag:amateurjav:2', type_name: "纪录片", arg: "纪录片" },
  { type_id: 'tag:amateurjav:61', type_name: "高清(HD)", arg: "高清(HD)" },
  { type_id: 'tag:amateurjav:10', type_name: "第一人稱攝影", arg: "第一人稱攝影" },
  { type_id: 'tag:amateurjav:44', type_name: "單體作品", arg: "單體作品" },
  { type_id: 'tag:amateurjav:52', type_name: "主觀視角", arg: "主觀視角" },
  { type_id: 'tag:amateurjav:74', type_name: "國外進口", arg: "國外進口" },
  { type_id: 'tag:amateurjav:132', type_name: "投稿", arg: "投稿" },
  { type_id: 'tag:amateurjav:216', type_name: "獨家", arg: "獨家" },
  { type_id: 'tag:amateurjav:246', type_name: "新登場メーカー", arg: "新登場メーカー" },
];

const CATMAP = new Map(CATS.map(c => [c.type_id, c]));

function t(v) {
  return v == null ? '' : String(v).trim();
}
function clean(s) {
  return t(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
}
function absUrl(u) {
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return HOST + u;
  return u;
}

// ---------- 抓取 (框架 req 优先, fetch 兜底; 带简单页缓存) ----------
const pageCache = new Map();
function cacheGet(url, ttl) {
  const e = pageCache.get(url);
  if (e && Date.now() - e.at < ttl) return e.body;
  return '';
}
function cacheSet(url, body) {
  if (body) pageCache.set(url, { at: Date.now(), body });
  if (pageCache.size > 300) pageCache.clear();
}
async function fetchText(url, referer, timeoutMs) {
  const headers = {
    'User-Agent': UA,
    'Referer': referer || REFERER,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  try {
    const { data, status } = await req.get(url, { headers, timeout: timeoutMs || 15000 });
    if ((!status || status === 200) && data != null && data !== '') {
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
  } catch (e) { /* 落 fetch */ }
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs || 15000);
    try {
      const r = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow' });
      if (r.ok) return await r.text();
    } finally { clearTimeout(to); }
  } catch (e) { /* ignore */ }
  return '';
}
async function getPage(url, ttl, referer) {
  const hit = cacheGet(url, ttl || 60000);
  if (hit) return hit;
  const body = await fetchText(url, referer);
  cacheSet(url, body);
  return body;
}
async function postForm(url, params, referer) {
  const body = new URLSearchParams(params).toString();
  const headers = {
    'User-Agent': UA,
    'Referer': referer || REFERER,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  };
  try {
    const { data, status } = await req.post(url, body, { headers, timeout: 15000 });
    if ((!status || status === 200) && typeof data === 'string' && data) return data;
  } catch (e) { /* 落 fetch */ }
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { method: 'POST', headers, body, signal: ctl.signal, redirect: 'follow' });
      if (r.ok) return await r.text();
    } finally { clearTimeout(to); }
  } catch (e) { /* ignore */ }
  return '';
}

// ---------- 列表解析 ----------
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const re = /<div class='video'>[\s\S]*?<a[^>]+href="([^"]+_content\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<h3 class='video-title'>\s*<a[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = absUrl(m[1]);
    if (seen.has(url)) continue;
    seen.add(url);
    const imgM = m[2].match(/data-src='([^']+)'/) || m[2].match(/src='([^']+)'/) || m[2].match(/data-src="([^"]+)"/);
    const name = clean(m[3].replace(/<[^>]+>/g, ''));
    const tail = url.match(/\/([^/]+)\.html(?:[?#]|$)/);
    out.push({
      vod_id: url,
      vod_name: name,
      vod_pic: imgM ? absUrl(imgM[1]) : '',
      vod_remarks: tail ? tail[1] : '',
    });
  }
  return out;
}
function pagecountOf(html) {
  const i = html.indexOf('pagination-row');
  if (i < 0) return 1;
  const seg = html.slice(i, i + 6000);
  let max = 1;
  for (const m of seg.matchAll(/\/(\d+)\.html/g)) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

// ---------- 纯 JS AES-128-CBC 解密 (仅解密方向) ----------
const AES_SBOX = [], AES_INV = [], AES_LOG = new Uint8Array(256), AES_EXP = new Uint8Array(256);
(function aesInit() {
  let x = 1;
  for (let i = 0; i < 256; i++) {
    AES_EXP[i] = x; AES_LOG[x] = i;
    x ^= ((x << 1) & 0xff) ^ ((x & 0x80) ? 0x1b : 0);
  }
  for (let i = 0; i < 256; i++) {
    let s = i ? AES_EXP[(255 - AES_LOG[i]) % 255] : 0;
    let y = s;
    y = ((y << 1) | (y >> 7)) & 0xff; s ^= y;
    y = ((y << 1) | (y >> 7)) & 0xff; s ^= y;
    y = ((y << 1) | (y >> 7)) & 0xff; s ^= y;
    y = ((y << 1) | (y >> 7)) & 0xff; s ^= y;
    s ^= 0x63;
    AES_SBOX[i] = s & 0xff; AES_INV[s & 0xff] = i;
  }
})();
function aesMul(a, b) { return a && b ? AES_EXP[(AES_LOG[a] + AES_LOG[b]) % 255] : 0; }
const AES_RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
function aesExpandKey(key) {
  const w = new Uint8Array(176);
  w.set(key.subarray(0, 16));
  for (let i = 4; i < 44; i++) {
    let t0 = w[4 * i - 4], t1 = w[4 * i - 3], t2 = w[4 * i - 2], t3 = w[4 * i - 1];
    if (i % 4 === 0) {
      const n0 = AES_SBOX[t1] ^ AES_RCON[i / 4 - 1], n1 = AES_SBOX[t2], n2 = AES_SBOX[t3], n3 = AES_SBOX[t0];
      t0 = n0; t1 = n1; t2 = n2; t3 = n3;
    }
    w[4 * i] = w[4 * i - 16] ^ t0;
    w[4 * i + 1] = w[4 * i - 15] ^ t1;
    w[4 * i + 2] = w[4 * i - 14] ^ t2;
    w[4 * i + 3] = w[4 * i - 13] ^ t3;
  }
  return w;
}
function aesDecryptBlock(w, block, out, off) {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = block[i] ^ w[160 + i];
  for (let round = 9; round >= 1; round--) {
    for (let i = 0; i < 16; i++) s[i] = AES_INV[s[i]];
    const u = new Uint8Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) u[4 * c + r] = s[4 * ((c - r + 4) % 4) + r];
    s.set(u);
    for (let i = 0; i < 16; i++) s[i] ^= w[16 * round + i];
    for (let c = 0; c < 4; c++) {
      const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
      s[4 * c]     = aesMul(a0, 14) ^ aesMul(a1, 11) ^ aesMul(a2, 13) ^ aesMul(a3, 9);
      s[4 * c + 1] = aesMul(a0, 9) ^ aesMul(a1, 14) ^ aesMul(a2, 11) ^ aesMul(a3, 13);
      s[4 * c + 2] = aesMul(a0, 13) ^ aesMul(a1, 9) ^ aesMul(a2, 14) ^ aesMul(a3, 11);
      s[4 * c + 3] = aesMul(a0, 11) ^ aesMul(a1, 13) ^ aesMul(a2, 9) ^ aesMul(a3, 14);
    }
  }
  for (let i = 0; i < 16; i++) s[i] = AES_INV[s[i]];
  const u = new Uint8Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) u[4 * c + r] = s[4 * ((c - r + 4) % 4) + r];
  for (let i = 0; i < 16; i++) out[off + i] = u[i] ^ w[i];
}
function aes128CbcDecrypt(data, keyBytes, ivBytes) {
  if (!data.length || data.length % 16 !== 0) return new Uint8Array(0);
  const w = aesExpandKey(keyBytes);
  const out = new Uint8Array(data.length);
  let prev = ivBytes;
  for (let off = 0; off < data.length; off += 16) {
    const block = data.subarray(off, off + 16);
    aesDecryptBlock(w, block, out, off);
    for (let i = 0; i < 16; i++) out[off + i] ^= prev[i];
    prev = block;
  }
  const pad = out[out.length - 1];
  if (pad >= 1 && pad <= 16) return out.subarray(0, out.length - pad);
  return out;
}
function b64ToBytes(b64) {
  const bin = atob(String(b64).replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8Bytes(s) { return new TextEncoder().encode(s); }
function utf8Text(bytes) { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }

// ---------- mvarr 解码 ----------
function parseGlobals(html) {
  const grabS = (n) => { const m = html.match(new RegExp(n + "\\s*=\\s*'([^']+)'")); return m ? m[1] : ''; };
  const grabN = (n) => { const m = html.match(new RegExp(n + "\\s*=\\s*(\\d+)")); return m ? parseInt(m[1], 10) : NaN; };
  return { hc: grabN('hcdeedg252'), ha: grabN('hadeedg252'), key: grabS('argdeqweqweqwz'), iv: grabS('hdddedf252') };
}
function hsdf(s, hc, ha) {
  const sep = String.fromCharCode(hc + 97);
  return s.split(sep).filter(x => x.length).map(tok => String.fromCharCode((parseInt(tok, hc) * 1) ^ ha)).join('');
}
// 返回 [{srv, part, base, embed}] —— embed 为解码后的完整 embed 地址
function extractEmbeds(html) {
  const g = parseGlobals(html);
  if (!g.key || !g.iv || !(g.hc >= 2) || isNaN(g.ha)) return [];
  const out = [];
  const re = /mvarr\['(\d+)_(\d+)'\]\s*=\s*\[(.*?)\];/gs;
  let m;
  while ((m = re.exec(html)) !== null) {
    const srv = m[1], part = parseInt(m[2], 10);
    const strs = [];
    const sre = /'((?:[^'\\]|\\.)*)'/g;
    let sm;
    while ((sm = sre.exec(m[3])) !== null) strs.push(sm[1]);
    const sep = String.fromCharCode(g.hc + 97);
    const blobIdx = strs.findIndex(s => s.length > 50 && s.includes(sep) && /^[0-9a-z]+$/i.test(s));
    if (blobIdx < 0) continue;
    let base = '';
    for (let i = blobIdx + 1; i < strs.length; i++) {
      if (/^(https?:)?\/\//.test(strs[i])) { base = strs[i]; break; }
    }
    if (!base) continue;
    let suffix = '';
    if (strs[blobIdx + 2] === base && typeof strs[blobIdx + 3] === 'string' && !strs[blobIdx + 3].startsWith('<')) suffix = strs[blobIdx + 3];
    try {
      const plain = utf8Text(aes128CbcDecrypt(b64ToBytes(hsdf(strs[blobIdx], g.hc, g.ha)), utf8Bytes(g.key), utf8Bytes(g.iv)));
      if (!plain || /[\u0000-\u001f]/.test(plain)) continue;
      const embed = base.includes('emturbovid') ? plain : absUrl(base) + plain + suffix;
      out.push({ srv, part, base: absUrl(base), embed });
    } catch (e) { /* 跳过坏条目 */ }
  }
  return out;
}
const SRV_INFO = {
  '37': { name: 'SW', kind: 'W' },
  '38': { name: 'VH', kind: 'W' },
  '28': { name: 'DO', kind: 'S' },
  '42': { name: 'SP', kind: 'S' },
};
function srvInfo(e) {
  if (SRV_INFO[e.srv]) return SRV_INFO[e.srv];
  if (/mmsi02|mmvh02/.test(e.base)) return { name: 'VH', kind: 'W' };
  return { name: 'SP', kind: 'S' };
}

// ---------- embed 验档 (与 mmtv-vidhide Worker 同算法的纯 JS 解包) ----------
// vidhide 系 embed 页的 links 分 hls4/hls3/hls2 三档: 只有 hls4 能被
// Worker 链用活, hls3/hls2 对非浏览器出口全拒。detail 时先在蜘蛛侧
// 解包 embed 页验档, 无 hls4 的 embed 是必死线, 不组装进线路表。
function jsUnescapeSingle(s) {
  return s.replace(/\\(.)/g, (m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c;
  });
}
function unpackPacker(html) {
  const m = String(html).match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/);
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
function extractEmbedLinks(text) {
  const links = {};
  for (const m of String(text).matchAll(/"hls(\d+)"\s*:\s*"([^"]+)"/g)) {
    links['hls' + m[1]] = m[2];
  }
  if (!Object.keys(links).length) {
    const f = String(text).match(/"file"\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/) || String(text).match(/(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/);
    if (f) links.hls2 = f[1];
  }
  return links;
}
// true = 有 hls4 (可用); false = 明确无 hls4 (死线); 探测失败返回 true
// (按存活对待, 不因网络抖动误杀)
const tierCache = new Map();
async function probeEmbedViable(embed, referer) {
  if (tierCache.has(embed)) return tierCache.get(embed);
  let viable = true;
  try {
    const html = await fetchText(embed, referer, 12000);
    if (html) {
      const links = extractEmbedLinks(unpackPacker(html) || html);
      viable = !!links.hls4;
      tierCache.set(embed, viable);
      if (tierCache.size > 300) tierCache.clear();
    }
  } catch (e) { /* 探测异常 -> 按存活对待 */ }
  return viable;
}
async function filterViableW(wEmbeds, referer) {
  if (!wEmbeds.length) return [];
  const flags = await Promise.all(wEmbeds.map(e => probeEmbedViable(e.embed, referer)));
  return wEmbeds.filter((e, i) => flags[i]);
}
// 经 Worker 探活一条线的首分片: 'alive' | 'dead' | 'unknown'
// (探活的 /v 请求同时给 Worker 的边缘缓存预热, 真 play 时更快)
async function probeLineAlive(embed, referer) {
  try {
    if (typeof fetch !== 'function') return 'unknown';
    const wurl = `${MMTV_WORKER}/v?u=${encodeURIComponent(embed)}&r=${encodeURIComponent(referer)}`;
    let txt = await fetchText(wurl, referer, 30000);
    if (!txt || !txt.includes('#EXTM3U')) return 'unknown';
    let seg = '';
    for (let hop = 0; hop < 2 && !seg; hop++) {
      const line = txt.split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#'));
      if (!line) return 'unknown';
      if (/\.m3u8($|\?)|\/p\?/.test(line)) {
        txt = await fetchText(line, referer, 20000);
        if (!txt || !txt.includes('#EXTM3U')) return 'unknown';
      } else seg = line;
    }
    if (!seg) return 'unknown';
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(seg, { headers: { 'Range': 'bytes=0-0', 'User-Agent': UA }, signal: ctl.signal });
      if (r.status !== 200 && r.status !== 206) return 'dead';
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!buf.length) return 'unknown';
      return buf[0] === 0x47 ? 'alive' : 'dead';
    } finally { clearTimeout(to); }
  } catch (e) { return 'unknown'; }
}

// ---------- 路由处理器 ----------
async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getPage(HOST + '/zh/censored_list/all/1.html', 60000);
  const list = html ? parseCards(html) : [];
  return { class: cls, list };
}

function catUrl(cat, page) {
  const [kind, a, b] = cat.type_id.split(':');
  if (kind === 'list') return `${HOST}/zh/${a}_list/all/${page}.html`;
  if (kind === 'maker') return `${HOST}/zh/${a}_makersr/${b}/${encodeURIComponent(cat.arg || '')}/${page}.html`;
  if (kind === 'tag') return `${HOST}/zh/${a}_category/${b}/${encodeURIComponent(cat.arg || '')}/${page}.html`;
  return HOST + '/zh/';
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'list:censored';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATMAP.get(tid) || CATS[0];
  // 巨尻/巨乳/屁股（有码组）同时并有码与无码破解两版：两区标签 id 通用，并行各取一页拼接
  const DUAL = ['tag:censored:127', 'tag:censored:50', 'tag:censored:137'];
  if (DUAL.includes(tid)) {
    const cat2 = { type_id: 'tag:reducing-mosaic-censored:' + tid.split(':')[2], arg: cat.arg };
    const [h1, h2] = await Promise.all([getPage(catUrl(cat, page), 60000), getPage(catUrl(cat2, page), 60000)]);
    const seen = new Set();
    const list = [];
    for (const c of (h1 ? parseCards(h1) : []).concat(h2 ? parseCards(h2) : [])) {
      if (!seen.has(c.vod_id)) { seen.add(c.vod_id); list.push(c); }
    }
    const pc = Math.max(h1 ? pagecountOf(h1) : page, h2 ? pagecountOf(h2) : page, page);
    return { page, pagecount: pc, limit: list.length, total: list.length, list };
  }
  const html = await getPage(catUrl(cat, page), 60000);
  if (!html) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const list = parseCards(html);
  const pc = pagecountOf(html);
  return { page, pagecount: Math.max(pc, page), limit: 20, total: list.length, list };
}

function sectionOf(url) {
  const m = String(url).match(/\/zh\/([a-z-]+)_content\//);
  return m ? m[1] : '';
}
function codeOf(url) {
  const m = String(url).match(/\/([^/]+)\.html(?:[?#]|$)/);
  return m ? m[1] : '';
}

// 站内搜番号找同片的其他分区版本, 借其可用的 W 线 embed (验档在
// 本函数内做: 抓到一个孪生页就先验它的线, 有可用线立即返回, 不白
// 抓第二个)。amateur/klive 的帖 URL 文件名是 content.html 无番号,
// 无法按号搜, 跳过。
const twinCache = new Map();
async function findViableTwinEmbeds(code, selfUrl) {
  if (!code || code === 'content') return [];
  if (twinCache.has(code)) return twinCache.get(code);
  let viable = [];
  try {
    // 先走 GET 搜索 (与 search() 同端点, 可缓存、较快); 无卡再落 POST 表单搜索
    let cards = parseCards(await getPage(`${HOST}/zh/searchall_search/all/${encodeURIComponent(code)}/1.html`, 60000, selfUrl) || '');
    if (!cards.length) {
      const html = await postForm(HOST + '/zh/searchform_search/all/index.html',
        { search_keyword: code, search_type: 'searchall', op: 'search' }, selfUrl);
      cards = parseCards(html || '');
    }
    const pref = ['censored', 'chinese', 'uncensored', 'amateurjav', 'amateur', 'klive'];
    const twins = cards
      .map(c => c.vod_id)
      .filter(u => u !== selfUrl && sectionOf(u) && sectionOf(u) !== sectionOf(selfUrl))
      .sort((x, y) => pref.indexOf(sectionOf(x)) - pref.indexOf(sectionOf(y)));
    for (const tu of twins.slice(0, 2)) {
      const thtml = await fetchText(tu, selfUrl, 12000);
      if (!thtml) continue;
      const te = extractEmbeds(thtml).filter(e => srvInfo(e).kind === 'W');
      if (!te.length) continue;
      const tv = await filterViableW(te, selfUrl);
      if (tv.length) { viable = tv; break; }
    }
  } catch (e) { /* 忽略, 只剩 SP 兜底 */ }
  twinCache.set(code, viable);
  if (twinCache.size > 200) twinCache.clear();
  return viable;
}

// 线路组装 helper: W 线 (已验档) + 本帖 S 线 -> 分组与顺序; 再经
// Worker 探活 W 线首分片决定 W 线间顺序与"是否有活线"。
// 返回 { order, anyW, wAlive } —— wAlive=false 表示无 W 线, 或探活
// 的 W 线全被判死 (分片后端死亡), 调用方应尝试借线。
function buildGroups(wEmbeds, sEmbeds) {
  const groups = new Map();
  for (const e of wEmbeds.concat(sEmbeds)) {
    const info = srvInfo(e);
    if (!groups.has(info.name)) groups.set(info.name, { kind: info.kind, parts: [] });
    groups.get(info.name).parts.push(e);
  }
  for (const grp of groups.values()) grp.parts.sort((x, y) => x.part - y.part);
  return groups;
}
async function orderWithProbe(groups, referer) {
  const order = ['SW', 'VH', 'DO', 'SP'].filter(n => groups.has(n));
  const wLines = order.filter(n => groups.get(n).kind === 'W');
  if (!wLines.length) return { order, anyW: false, wAlive: false };
  const st1 = await probeLineAlive(groups.get(wLines[0]).parts[0].embed, referer);
  if (st1 === 'alive' || st1 === 'unknown') return { order, anyW: true, wAlive: true };
  // 首条 W 线被判死
  if (wLines.length > 1) {
    const st2 = await probeLineAlive(groups.get(wLines[1]).parts[0].embed, referer);
    if (st2 === 'alive') {
      const rest = order.filter(n => n !== wLines[0] && n !== wLines[1]);
      return { order: [wLines[1], wLines[0]].concat(rest), anyW: true, wAlive: true };
    }
    if (st2 === 'unknown') return { order, anyW: true, wAlive: true };
  }
  return { order, anyW: true, wAlive: false };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  const durl = absUrl(id);
  const html = await getPage(durl, 300000);
  if (!html) return { list: [] };
  const nameM = html.match(/<h1 class="fullvideo-title[^"]*">([\s\S]*?)<\/h1>/);
  const name = nameM ? clean(nameM[1].replace(/<[^>]+>/g, '')) : durl;
  const picM = html.match(/content_main_cover[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/) ||
               html.match(/<meta property="og:image" content="([^"]+)"/);
  const metaM = html.match(/<div class="d-flex mb-4">([\s\S]*?)<\/div>/);
  const metaTxt = metaM ? clean(metaM[1].replace(/<[^>]+>/g, ' ')) : '';
  const code = codeOf(durl);
  const actors = [];
  const actBlock = html.match(/col-idols[\s\S]*?<\/div>\s*<\/div>/);
  if (actBlock) {
    for (const am of actBlock[0].matchAll(/_avperformer\/\d+\/[^/']+\/1\.html'>([^<]+)<\/a>/g)) {
      if (!actors.includes(am[1])) actors.push(am[1]);
    }
  }
  const descM = html.match(/<meta name="description" content="([^"]*)"/);
  const allEmbeds = extractEmbeds(html);
  const ownS = allEmbeds.filter(e => srvInfo(e).kind !== 'W');
  // W 线先验档: 无 hls4 的 embed 经 Worker 必死, 不进线路表
  let wEmbeds = await filterViableW(allEmbeds.filter(e => srvInfo(e).kind === 'W'), durl);
  let groups = buildGroups(wEmbeds, ownS);
  let ord = await orderWithProbe(groups, durl);
  if (!ord.wAlive) {
    // 本帖无可用 W 线 (无 hls4 / 分片后端全死 / 根本没有 W 线):
    // 借同片其他分区版本的可用线
    const tv = await findViableTwinEmbeds(code, durl);
    if (tv.length) {
      wEmbeds = tv;
      groups = buildGroups(wEmbeds, ownS);
      ord = await orderWithProbe(groups, durl);
    }
  }
  const lineOrder = ord.order;
  const fromArr = [], urlArr = [];
  for (const lname of lineOrder) {
    const grp = groups.get(lname);
    const eps = grp.parts.map((e, i) => {
      const epName = grp.parts.length > 1 ? `CD${e.part}` : (code || '正片');
      const pid = `${grp.kind}|${encodeURIComponent(e.embed)}|${encodeURIComponent(durl)}`;
      return `${epName}$${pid}`;
    });
    fromArr.push(lname);
    urlArr.push(eps.join('#'));
  }
  if (!fromArr.length) {
    fromArr.push('SP');
    urlArr.push(`正片$S|${encodeURIComponent(durl)}|${encodeURIComponent(durl)}`);
  }
  const vod = {
    vod_id: durl,
    vod_name: name,
    vod_pic: picM ? absUrl(picM[1]) : '',
    vod_remarks: metaTxt,
    vod_actor: actors.join(','),
    vod_content: descM ? clean(descM[1]) : '',
    vod_play_from: fromArr.join('$$$'),
    vod_play_url: urlArr.join('$$$'),
  };
  subRegister(id, vod);
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const flag = t(body.flag);
  const raw = t(body.id);
  const [kind, encEmbed, encFrom] = raw.split('|');
  const subsP = subSearchAll(subNormKey(raw)).catch(() => []);
  const embed = encEmbed ? decodeURIComponent(encEmbed) : '';
  const from = encFrom ? decodeURIComponent(encFrom) : REFERER;
  if (kind === 'W' && embed) {
    const wurl = `${MMTV_WORKER}/v?u=${encodeURIComponent(embed)}&r=${encodeURIComponent(from)}`;
    return subAttach({ parse: 0, url: wurl, header: { 'User-Agent': UA, 'Referer': from } }, subsP);
  }
  if (embed) {
    // DO (DoodStream Turnstile 门禁) / SP (站方 play.php): 无可验证的
    // 直取链, 交 WebView 嗅探作最后兜底
    return subAttach({ parse: 1, jx: 0, url: embed, header: { 'User-Agent': UA, 'Referer': from } }, subsP);
  }
  return subAttach({ parse: 1, jx: 0, url: from, header: { 'User-Agent': UA, 'Referer': REFERER } }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: 1, limit: 20, total: 0, list: [] };
  let html = await getPage(`${HOST}/zh/searchall_search/all/${encodeURIComponent(wd)}/${page}.html`, 60000);
  let list = html ? parseCards(html) : [];
  if (page === 1 && !list.length) {
    html = await postForm(HOST + '/zh/searchform_search/all/index.html',
      { search_keyword: wd, search_type: 'searchall', op: 'search' });
    list = html ? parseCards(html) : [];
  }
  const pc = html ? pagecountOf(html) : 1;
  return { page, pagecount: Math.max(pc, page), limit: 20, total: list.length, list };
}

// ---------------- 字幕聚合 (Layer A 铺开, 2026-10-23) ----------------
// 与 bestjavporn 试点同一实现 (提交 9c339419, 用户真机确认
// MiraPlayer 可加载并选择字幕): 点播时按片名/番号并行搜迅雷看看
// oracle (首档; 「迅雷」与「迅雷看看」实为同一接口) + SubtitleCat
// (第二档), 合并排序 = 来源档位 -> 语言 (简中>繁中>双语>英文>
// 其他) -> 番号命中 -> 热度, 只收 .srt/.vtt/.ass/.ssa 直链, 上限
// 10 条, 以 TVBox 标准 subs:[{name,url,format}] 挂到 play 结果。
// 总预算 6s、单请求 4~5s、全程框架 req (NOFETCH 安全)、结果缓存
// 10 分钟 (空结果不缓存); 无命中时不带 subs 键, play 返回与接入
// 前逐字段一致。SubHD (下载被站方门控) 与射手 (源站 522) 不接入。
const SUB_UA = (typeof UA !== 'undefined' && UA) ? UA : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)';

function subCleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// subHttp: 与试点 reqRaw 同语义 (状态码不抛错、仅 2xx 给正文、
// 文本恒等变换防自动 JSON 解析), 底层框架 req。
async function subHttp(url, headers, timeoutMs) {
  try {
    const r = await req.request({
      method: 'GET',
      url,
      headers: headers || {},
      timeout: timeoutMs || 10000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      maxRedirects: 5,
    });
    const text = typeof r.data === 'string' ? r.data : (r.data == null ? '' : String(r.data));
    const ok = r.status >= 200 && r.status < 300;
    return { status: r.status || 0, body: ok ? text : '' };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

// play 入参归一: 个别 App 会把 "集名$播放id" 整段传回, 集名短且
// 不含 {/http 时剥掉前缀, 与 detail 登记的 episode id 对齐。
function subNormKey(k) {
  const s = String(k || '');
  const i = s.indexOf('$');
  if (i > 0) {
    const before = s.slice(0, i);
    if (before.length <= 30 && !/[{/]/.test(before) && !/http/i.test(before)) return s.slice(i + 1).trim();
  }
  return s.trim();
}

// detail 侧登记: 片名按 [detail 入参 id, vod_id, 每个 episode 的
// 播放 id] 多键写入 subNameCache, 并以首个 episode id 预热搜索。
function subRegister(detailIds, vod) {
  try {
    if (!vod || !vod.vod_name) return;
    const name = String(vod.vod_name);
    const keys = new Set();
    for (const i of (Array.isArray(detailIds) ? detailIds : [detailIds])) {
      if (i) keys.add(String(i));
    }
    if (vod.vod_id) keys.add(String(vod.vod_id));
    const eps = [];
    for (const grp of String(vod.vod_play_url || '').split('$$$')) {
      for (const seg of grp.split('#')) {
        const k = seg.indexOf('$');
        if (k >= 0) {
          const ep = seg.slice(k + 1);
          if (ep) { keys.add(ep); eps.push(ep); }
        }
      }
    }
    for (const k of keys) subCacheName(k, name);
    const warmKey = eps[0] || (vod.vod_id ? String(vod.vod_id) : '');
    if (warmKey) subWarm(warmKey);
  } catch (e) { /* 字幕登记失败不影响详情 */ }
}

// play 侧挂载: 仅当结果带非空 url 且字幕有命中时才加 subs 键。
async function subAttach(res, subsP) {
  try {
    const subs = await subsP;
    if (subs && subs.length && res && typeof res === 'object' && res.url) res.subs = subs;
  } catch (e) { /* 字幕挂载失败不影响播放结果 */ }
  return res;
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
// 全程 subHttp (框架 req 主栈), 迅雷系逐请求超时 3s、键序串行
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
  return slug ? subCleanText(slug.replace(/[-_]+/g, ' ')) : '';
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
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
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
  const r = await subHttp('https://subtitlecat.com/index.php?search=' + encodeURIComponent(key),
    { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 5000);
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
    const pr = await subHttp('https://subtitlecat.com/' + p, { 'User-Agent': SUB_UA, Referer: 'https://subtitlecat.com/' }, 4000);
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
