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
// 无码破解 (reducing-mosaic) 分区详情页只有 SP 一条线: detail 时按
// 番号站内搜索同片的其他分区版本 (抽样 3/3 命中 censored 孪生),
// 借用其 SW/VH 线; 找不到才只剩 SP 兜底。
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
  { type_id: 'tag:censored:50', type_name: "巨尻", arg: "巨尻" },
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
  { type_id: 'tag:censored:127', type_name: "巨乳", arg: "巨乳" },
  { type_id: 'tag:censored:128', type_name: "貧乳・微乳", arg: "貧乳・微乳" },
  { type_id: 'tag:censored:249', type_name: "蘿莉", arg: "蘿莉" },
  { type_id: 'tag:censored:130', type_name: "熟女", arg: "熟女" },
  { type_id: 'tag:censored:131', type_name: "孕婦", arg: "孕婦" },
  { type_id: 'tag:censored:132', type_name: "苗條", arg: "苗條" },
  { type_id: 'tag:censored:133', type_name: "胖女人", arg: "胖女人" },
  { type_id: 'tag:censored:134', type_name: "無毛", arg: "無毛" },
  { type_id: 'tag:censored:135', type_name: "變性者", arg: "變性者" },
  { type_id: 'tag:censored:136', type_name: "高", arg: "高" },
  { type_id: 'tag:censored:137', type_name: "屁股", arg: "屁股" },
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

// 无码破解等只有 SP 的详情: 站内搜番号找其他分区的同片, 借其 embed
const twinCache = new Map();
async function findTwinEmbeds(code, selfUrl) {
  if (!code || twinCache.has(code)) return twinCache.get(code) || [];
  let embeds = [];
  try {
    const html = await postForm(HOST + '/zh/searchform_search/all/index.html',
      { search_keyword: code, search_type: 'searchall', op: 'search' }, selfUrl);
    const cards = parseCards(html || '');
    const pref = ['censored', 'chinese', 'uncensored', 'amateurjav', 'amateur', 'klive'];
    const twins = cards
      .map(c => c.vod_id)
      .filter(u => u !== selfUrl && sectionOf(u) && sectionOf(u) !== sectionOf(selfUrl))
      .sort((x, y) => pref.indexOf(sectionOf(x)) - pref.indexOf(sectionOf(y)));
    for (const tu of twins.slice(0, 2)) {
      const thtml = await fetchText(tu, selfUrl, 12000);
      if (!thtml) continue;
      const te = extractEmbeds(thtml).filter(e => srvInfo(e).kind === 'W');
      if (te.length) { embeds = te; break; }
    }
  } catch (e) { /* 忽略, 只剩 SP 兜底 */ }
  twinCache.set(code, embeds);
  if (twinCache.size > 200) twinCache.clear();
  return embeds;
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
  let embeds = extractEmbeds(html);
  if (!embeds.some(e => srvInfo(e).kind === 'W')) {
    const twin = await findTwinEmbeds(code, durl);
    if (twin.length) embeds = twin.concat(embeds);
  }
  // 线路组装: 按站方按钮顺序 SW/VH/DO/SP, 同线多 CD 分集
  const order = ['SW', 'VH', 'DO', 'SP'];
  const groups = new Map();
  for (const e of embeds) {
    const info = srvInfo(e);
    if (!groups.has(info.name)) groups.set(info.name, { kind: info.kind, parts: [] });
    groups.get(info.name).parts.push(e);
  }
  const fromArr = [], urlArr = [];
  for (const lname of order) {
    const grp = groups.get(lname);
    if (!grp) continue;
    grp.parts.sort((x, y) => x.part - y.part);
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
  return {
    list: [{
      vod_id: durl,
      vod_name: name,
      vod_pic: picM ? absUrl(picM[1]) : '',
      vod_remarks: metaTxt,
      vod_actor: actors.join(','),
      vod_content: descM ? clean(descM[1]) : '',
      vod_play_from: fromArr.join('$$$'),
      vod_play_url: urlArr.join('$$$'),
    }],
  };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const flag = t(body.flag);
  const raw = t(body.id);
  const [kind, encEmbed, encFrom] = raw.split('|');
  const embed = encEmbed ? decodeURIComponent(encEmbed) : '';
  const from = encFrom ? decodeURIComponent(encFrom) : REFERER;
  if (kind === 'W' && embed) {
    const wurl = `${MMTV_WORKER}/v?u=${encodeURIComponent(embed)}&r=${encodeURIComponent(from)}`;
    return { parse: 0, url: wurl, header: { 'User-Agent': UA, 'Referer': from } };
  }
  if (embed) {
    // DO (DoodStream Turnstile 门禁) / SP (站方 play.php): 无可验证的
    // 直取链, 交 WebView 嗅探作最后兜底
    return { parse: 1, jx: 0, url: embed, header: { 'User-Agent': UA, 'Referer': from } };
  }
  return { parse: 1, jx: 0, url: from, header: { 'User-Agent': UA, 'Referer': REFERER } };
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
