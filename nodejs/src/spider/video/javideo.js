import req from '../../util/req.js';

// JAVIDEO (py_javideo) —— 名称暂用站方品牌「JAVIDEO」, 用户可改。
// 站点: https://javideo.net/ (日本 JAV 免费流媒体站, 自研 CMS 非 WP,
//   VM 直连 curl 全 200, 无 CF 墙; 站内标题 エロ動画・アダルトビデオ・
//   JAVIDEO)。侦察与实测: 2026-10-21。
// 列表: 卡片 div.card.card--big (封面 cdn.javideo.net/{年月}/{slug}.webp
//   裸拉 200 image/webp, 无防盗链, 不需要图片代理), 每页 30 条;
//   分页 /{路径}/pg-{N} (分类页 paginator 带末页直达链接, 取最大 pg-N
//   为总页数)。分类 = 5 个站内分区 + 题材索引 /genres-5UVd82Holk 公布
//   计数的全部 421 个题材 (计数>0 才收, 已含; 抽验 office 计数 6 与
//   实际卡片 6 逐一吻合, 3p 计数 176 ↔ 6 页)。女优索引 1000 条/厂商
//   索引 703 条同为 pg-N 列表但量级过大, 本版未收 (机制相同, 可后扩)。
// 详情: h1 标题 + 假播放器海报 (DMM 图) + 信息表 (厂商/题材/出演者/
//   发售日/时长/简介); 播放入口是 .episodeShow 里的服务器按钮
//   (data-id=集数id), 逐线 POST /api/movie/getPlayer {id} 换 embed:
//   - S-VIP → play.javideo.net/embed/{uuid} (站方自营): GET
//     /api/playlist-token/{uuid} 得 {t} → GET /v/{t} (须带 Referer=
//     embed 页) 302 → vid-snap-player.com 签名 playlist.sb; 列表与
//     分片 (.png 名、内容自首字节即真 TS, 188 对齐) 均裸拉 200,
//     无头要求 → 蜘蛛内全链直解, parse:0。实测单档 1080p。
//   - SW → javv.xyz (StreamWish, vidhide/earnvid 系): packer 内
//     links{hls4,hls3,hls2}, token 带 asn= 按铸造方网络身份签发 ——
//     与 JavGG/SexTB 实证一致: 蜘蛛/播放器直解在真机必死 (VM 出口
//     拉 hls3/hls2 亦 403), 正解全链同出口 Worker (下方
//     JAVIDEO_WORKER, 逻辑同 javgg-vidhide v3); 未部署时回退蜘蛛内
//     解包直返 (不保证能播)。
//   - LLS → luluvid.xyz (LuluStream): JW sources 直给 hls2 master
//     (720p, AES-128 加密, key/分片同域裸拉 200, token 无 asn) ——
//     同走 Worker 求稳 (Worker 的 extractLinks file 兜底可取此线),
//     未部署时回退蜘蛛内解包直返 (VM 侧全链验过)。
//   - STAPE → streamtape.com: embed 页 robotlink 由 JS substring
//     拼装 (静态 div 里是诱饵串), 蜘蛛内复现拼装得 get_video 地址
//     parse:0 直返; get_video 按请求 IP 签发、302 到 tapecontent,
//     蜘蛛与播放器同在设备出口故绑定自洽 (沙箱出口逐请求轮换,
//     VM 侧只能验到 302 这一步, 末跳字节待真机)。
//   - DSTR → playmogo.com (DoodStream 马甲): 点播前强制 Cloudflare
//     Turnstile 人机验证, 蜘蛛解不了 —— 不生成线路 (其余四线每片
//     均有, 采样 4 片 S-VIP/SW/LLS/STAPE 恒全)。
// 搜索: /search/{kw}/pg-{N}, kw 按站方 JS 同规则规范化 (小写、
//   空白与 .:;=+ 转 '-')。

const KEY = 'py_javideo';
const NAME = 'JAVIDEO';
const SITE = 'https://javideo.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = SITE + '/';
// vidhide 系 (SW/LLS) 全链代理 Worker 基址 (需用户把同目录
// javideo-vidhide-worker.js 部署为同名 Worker 后生效; 名字暂定
// javideo-vidhide, 用户可改, 改名后同步此行)。未部署时 SW/LLS 线
// 自动回退蜘蛛内解包直返; S-VIP/STAPE 两线不依赖此常量。
const JAVIDEO_WORKER = 'https://javideo-vidhide.li768435813.workers.dev';

// 分类: 5 个站内分区 + 421 个题材 (题材按站方索引公布计数降序,
// 计数最小 6, 全部 >0; 两个含特殊字符的 slug 已按站方 href 预编码,
// 实测可达)
const CATS = [
  { type_id: 'censored', type_name: 'モザあり' },
  { type_id: 'uncensored-h65gJ931GK', type_name: '無修正' },
  { type_id: 'amateur', type_name: '素人' },
  { type_id: 'engsub-h65gJ931ti', type_name: 'Engsub' },
  { type_id: 'studio/fc2ppv-s2padYt6q8', type_name: 'FC2PPV' },
  { type_id: 'genre/solowork', type_name: '単体作品' },
  { type_id: 'genre/high-quality', type_name: 'ハイビジョン' },
  { type_id: 'genre/creampie', type_name: '中出し' },
  { type_id: 'genre/exclusive', type_name: '独占配信' },
  { type_id: 'genre/amateur', type_name: '素人' },
  { type_id: 'genre/handjob', type_name: '手コキ' },
  { type_id: 'genre/toy', type_name: 'おもちゃ' },
  { type_id: 'genre/69', type_name: 'シックスナイン' },
  { type_id: 'genre/big-tits', type_name: '巨乳' },
  { type_id: 'genre/married-woman', type_name: '人妻・主婦' },
  { type_id: 'genre/4k', type_name: '4K' },
  { type_id: 'genre/milf', type_name: '熟女' },
  { type_id: 'genre/beautiful-girl', type_name: '美少女' },
  { type_id: 'genre/blow', type_name: 'フェラ' },
  { type_id: 'genre/slut', type_name: '痴女' },
  { type_id: 'genre/cuckold', type_name: '寝取り・寝取られ・NTR' },
  { type_id: 'genre/slender', type_name: 'スレンダー' },
  { type_id: 'genre/digimo', type_name: 'デジモ' },
  { type_id: 'genre/3p4p', type_name: '3P・4P' },
  { type_id: 'genre/squirting', type_name: '潮吹き' },
  { type_id: 'genre/nasty-hardcore', type_name: '淫乱・ハード系' },
  { type_id: 'genre/breasts', type_name: '美乳' },
  { type_id: 'genre/4hr', type_name: '4時間以上作品' },
  { type_id: 'genre/titty-fuck', type_name: 'パイズリ' },
  { type_id: 'genre/cowgirl', type_name: '騎乗位' },
  { type_id: 'genre/drama', type_name: 'ドラマ' },
  { type_id: 'genre/pov', type_name: 'ハメ撮り' },
  { type_id: 'genre/cross-dressing', type_name: '妄想族' },
  { type_id: 'genre/school-girls', type_name: '女子校生' },
  { type_id: 'genre/huge-butt', type_name: '巨尻' },
  { type_id: 'genre/affair', type_name: '不倫' },
  { type_id: 'genre/facials', type_name: '顔射' },
  { type_id: 'genre/kiss-kiss', type_name: 'キス・接吻' },
  { type_id: 'genre/older-sister', type_name: 'お姉さん' },
  { type_id: 'genre/acme-%C2%B7-orgasm', type_name: 'アクメ・オーガズム' },
  { type_id: 'genre/shaved', type_name: 'パイパン' },
  { type_id: 'genre/documentary', type_name: 'ドキュメンタリー' },
  { type_id: 'genre/ol', type_name: 'OL' },
  { type_id: 'genre/incest', type_name: '近親相姦' },
  { type_id: 'genre/deep-throating', type_name: 'イラマチオ' },
  { type_id: 'genre/masturbation', type_name: 'オナニー' },
  { type_id: 'genre/uniform', type_name: '制服' },
  { type_id: 'genre/debut-production', type_name: 'デビュー作品' },
  { type_id: 'genre/humiliation', type_name: '羞恥' },
  { type_id: 'genre/cosplay', type_name: 'コスプレ' },
  { type_id: 'genre/cunnilingus', type_name: 'クンニ' },
  { type_id: 'genre/shamed', type_name: '辱め' },
  { type_id: 'genre/butt', type_name: '尻フェチ' },
  { type_id: 'genre/gal', type_name: 'ギャル' },
  { type_id: 'genre/dirty-words', type_name: '淫語' },
  { type_id: 'genre/orgy', type_name: '乱交' },
  { type_id: 'genre/other-fetish', type_name: 'その他フェチ' },
  { type_id: 'genre/risky-mosaic', type_name: 'ギリモザ' },
  { type_id: 'genre/lotion', type_name: 'ローション・オイル' },
  { type_id: 'genre/subjectivity', type_name: '主観' },
  { type_id: 'genre/restraints', type_name: '拘束' },
  { type_id: 'genre/voyeur', type_name: '盗撮・のぞき' },
  { type_id: 'genre/nampa', type_name: 'ナンパ' },
  { type_id: 'genre/female-college-student', type_name: '女子大生' },
  { type_id: 'genre/anal', type_name: 'アナル' },
  { type_id: 'genre/cum', type_name: 'ごっくん' },
  { type_id: 'genre/beauty-shop', type_name: 'エステ' },
  { type_id: 'genre/pantyhose', type_name: 'パンスト・タイツ' },
  { type_id: 'genre/huge-cock', type_name: 'デカチン・巨根' },
  { type_id: 'genre/planning', type_name: '企画' },
  { type_id: 'genre/submissive-men', type_name: 'M男' },
  { type_id: 'genre/sweat', type_name: '汗だく' },
  { type_id: 'genre/female-teacher', type_name: '女教師' },
  { type_id: 'genre/nice-ass', type_name: '美尻' },
  { type_id: 'genre/bakku', type_name: 'バック' },
  { type_id: 'genre/bukkake', type_name: 'ぶっかけ' },
  { type_id: 'genre/miss-customs', type_name: 'キャバ嬢・風俗嬢' },
  { type_id: 'genre/massage', type_name: 'マッサージ・リフレ' },
  { type_id: 'genre/sister', type_name: '姉・妹' },
  { type_id: 'genre/hot-spring', type_name: '温泉' },
  { type_id: 'genre/urination', type_name: '放尿・お漏らし' },
  { type_id: 'genre/anal-sex', type_name: 'アナルセックス' },
  { type_id: 'genre/m-woman', type_name: 'M女' },
  { type_id: 'genre/vibe', type_name: 'バイブ' },
  { type_id: 'genre/tits', type_name: '貧乳・微乳' },
  { type_id: 'genre/busty-fetish', type_name: '巨乳フェチ' },
  { type_id: 'genre/various-professions', type_name: '職業色々' },
  { type_id: 'genre/entertainer', type_name: 'アイドル・芸能人' },
  { type_id: 'genre/emanieru', type_name: 'エマニエル' },
  { type_id: 'genre/bbw', type_name: 'ぽっちゃり' },
  { type_id: 'genre/image-video', type_name: 'イメージビデオ' },
  { type_id: 'genre/sm', type_name: 'SM' },
  { type_id: 'genre/tall', type_name: '長身' },
  { type_id: 'genre/leg-fetish', type_name: '脚フェチ' },
  { type_id: 'genre/mini', type_name: 'ミニ系' },
  { type_id: 'genre/beautiful-legs', type_name: '美脚' },
  { type_id: 'genre/mother', type_name: 'お母さん' },
  { type_id: 'genre/rezubian', type_name: 'レズビアン' },
  { type_id: 'genre/finger-fuck', type_name: '指マン' },
  { type_id: 'genre/virgin-man', type_name: '童貞' },
  { type_id: 'genre/evil', type_name: '鬼畜' },
  { type_id: 'genre/school-uniform', type_name: '学生服' },
  { type_id: 'genre/outdoors', type_name: '野外・露出' },
  { type_id: 'genre/hitodzuma', type_name: '人妻' },
  { type_id: 'genre/bondage', type_name: '縛り・緊縛' },
  { type_id: 'genre/av-idol', type_name: 'AV女優' },
  { type_id: 'genre/ultra-huge-tits', type_name: '超乳' },
  { type_id: 'genre/harem', type_name: 'ハーレム' },
  { type_id: 'genre/electric-massager', type_name: '電マ' },
  { type_id: 'genre/close-up', type_name: '局部アップ' },
  { type_id: 'genre/mother-in-law', type_name: '義母' },
  { type_id: 'genre/underwear', type_name: 'パンチラ' },
  { type_id: 'genre/brideyoung-wife', type_name: '若妻・幼妻' },
  { type_id: 'genre/nurse', type_name: '看護婦・ナース' },
  { type_id: 'genre/transsexual', type_name: 'ニューハーフ' },
  { type_id: 'genre/petite', type_name: '小柄' },
  { type_id: 'genre/drug', type_name: 'ドラッグ' },
  { type_id: 'genre/facesitting', type_name: '顔面騎乗' },
  { type_id: 'genre/female-boss', type_name: '女上司' },
  { type_id: 'genre/kiss', type_name: 'レズキス' },
  { type_id: 'genre/daughter', type_name: '女装・男の娘' },
  { type_id: 'genre/3p-4p', type_name: '3P、4P' },
  { type_id: 'genre/raw-saddle', type_name: '生ハメ' },
  { type_id: 'genre/school-swimsuit', type_name: '競泳・スクール水着' },
  { type_id: 'genre/lingerie', type_name: 'ランジェリー' },
  { type_id: 'genre/bitchi', type_name: 'ビッチ' },
  { type_id: 'genre/swimsuit', type_name: '水着' },
  { type_id: 'genre/original-collaboration', type_name: '原作コラボ' },
  { type_id: 'genre/maid', type_name: 'メイド' },
  { type_id: 'genre/sexy', type_name: 'セクシー' },
  { type_id: 'genre/soapland', type_name: 'ヘルス・ソープ' },
  { type_id: 'genre/footjob', type_name: '足コキ' },
  { type_id: 'genre/bareback', type_name: '生ハメ・生姦' },
  { type_id: 'genre/confinement', type_name: '監禁' },
  { type_id: 'genre/soku-hame', type_name: '即ハメ' },
  { type_id: 'genre/glasses', type_name: 'めがね' },
  { type_id: 'genre/erotic-wear', type_name: '着エロ' },
  { type_id: 'genre/oral-launch', type_name: '口内発射' },
  { type_id: 'genre/kimonomourning', type_name: '和服・浴衣' },
  { type_id: 'genre/sailor-suit', type_name: 'セーラー服' },
  { type_id: 'genre/lesbian', type_name: 'レズ' },
  { type_id: 'genre/mischief', type_name: 'イタズラ' },
  { type_id: 'genre/impregnate', type_name: '孕ませ' },
  { type_id: 'genre/date', type_name: 'デート' },
  { type_id: 'genre/best-omnibus', type_name: '女優ベスト・総集編' },
  { type_id: 'genre/sleeping-sleeping', type_name: '寝取り、寝取られ' },
  { type_id: 'genre/bloomers', type_name: '体操着・ブルマ' },
  { type_id: 'genre/milf', type_name: '熟女/人妻' },
  { type_id: 'genre/actress', type_name: '女優' },
  { type_id: 'genre/multiple-story', type_name: '複数話' },
  { type_id: 'genre/couple', type_name: 'カップル' },
  { type_id: 'genre/ryoojoku', type_name: '凌辱' },
  { type_id: 'genre/enema', type_name: '浣腸' },
  { type_id: 'genre/love', type_name: '恋愛' },
  { type_id: 'genre/bath', type_name: 'お風呂' },
  { type_id: 'genre/fair-skinned', type_name: '色白' },
  { type_id: 'genre/mini-skirt', type_name: 'ミニスカ' },
  { type_id: 'genre/female-investigator', type_name: '女捜査官' },
  { type_id: 'genre/fan-appreciation', type_name: 'ファン感謝・訪問' },
  { type_id: 'genre/male-squirting', type_name: '男の潮吹き' },
  { type_id: 'genre/childhood-friend', type_name: '幼なじみ' },
  { type_id: 'genre/original-video', type_name: 'オリジナル動画' },
  { type_id: 'genre/bunny-girl', type_name: 'バニーガール' },
  { type_id: 'genre/school-stuff', type_name: '学園もの' },
  { type_id: 'genre/subordinates--colleagues', type_name: '部下・同僚' },
  { type_id: 'genre/black-actor', type_name: '黒人男優' },
  { type_id: 'genre/svip', type_name: '超VIP' },
  { type_id: 'genre/dirudo', type_name: 'ディルド' },
  { type_id: 'genre/nasty-hard-system', type_name: '淫乱、ハード系' },
  { type_id: 'genre/hotel', type_name: 'ホテル' },
  { type_id: 'genre/stewardess', type_name: 'スチュワーデス' },
  { type_id: 'genre/torture', type_name: '拷問' },
  { type_id: 'genre/secretary', type_name: '秘書' },
  { type_id: 'genre/business-suit', type_name: 'ビジネススーツ' },
  { type_id: 'genre/tutor', type_name: '家庭教師' },
  { type_id: 'genre/no-bra', type_name: 'ノーブラ' },
  { type_id: 'genre/drinking-party', type_name: '飲み会・合コン' },
  { type_id: 'genre/onasapo', type_name: 'オナサポ' },
  { type_id: 'genre/small-tits', type_name: '微乳' },
  { type_id: 'genre/white-actress', type_name: '白人女優' },
  { type_id: 'genre/user-submission', type_name: '投稿' },
  { type_id: 'genre/reotado', type_name: 'レオタード' },
  { type_id: 'genre/reversed-role', type_name: '逆ナン' },
  { type_id: 'genre/document', type_name: 'ドキュメント' },
  { type_id: 'genre/sport', type_name: 'スポーツ' },
  { type_id: 'genre/oral', type_name: '口内射精' },
  { type_id: 'genre/athlete', type_name: 'アスリート' },
  { type_id: 'genre/sun-tan', type_name: '日焼け' },
  { type_id: 'genre/undead', type_name: '未亡人' },
  { type_id: 'genre/travel', type_name: '旅行' },
  { type_id: 'genre/black-hair', type_name: '黒髪' },
  { type_id: 'genre/aunt', type_name: '叔母さん' },
  { type_id: 'genre/hospital--clinic', type_name: '病院・クリニック' },
  { type_id: 'genre/feranuki', type_name: 'フェラ抜き' },
  { type_id: 'genre/joshi-ana', type_name: '女子アナ' },
  { type_id: 'genre/fantasy', type_name: 'ファンタジー' },
  { type_id: 'genre/piss-drinking', type_name: '飲尿' },
  { type_id: 'genre/30s', type_name: '30代' },
  { type_id: 'genre/rolling-back-eyes--fainting', type_name: '白目・失神' },
  { type_id: 'genre/rooshon', type_name: 'ローション' },
  { type_id: 'genre/delusion', type_name: '妄想' },
  { type_id: 'genre/race-queen', type_name: 'レースクィーン' },
  { type_id: 'genre/foreign-objects', type_name: '異物挿入' },
  { type_id: 'genre/spanking', type_name: 'スパンキング' },
  { type_id: 'genre/rape', type_name: 'レイプ' },
  { type_id: 'genre/shotacon', type_name: 'ショタ' },
  { type_id: 'genre/daughterfoster', type_name: '娘・養女' },
  { type_id: 'genre/female-doctor', type_name: '女医' },
  { type_id: 'genre/pansuto', type_name: 'パンスト' },
  { type_id: 'genre/tosatsu', type_name: '盗撮' },
  { type_id: 'genre/chubby', type_name: 'ポッチャリ' },
  { type_id: 'genre/geinoojin', type_name: '芸能人' },
  { type_id: 'genre/club-activities--manager', type_name: '部活・マネージャー' },
  { type_id: 'genre/breast-milk', type_name: '母乳' },
  { type_id: 'genre/tsundere', type_name: 'ツンデレ' },
  { type_id: 'genre/muscle', type_name: '筋肉' },
  { type_id: 'genre/instructor', type_name: 'インストラクター' },
  { type_id: 'genre/portio', type_name: 'ポルチオ' },
  { type_id: 'genre/tied-up', type_name: '縛り' },
  { type_id: 'genre/besuto-soshuhen', type_name: 'ベスト、総集編' },
  { type_id: 'genre/elder-male', type_name: 'お爺ちゃん' },
  { type_id: 'genre/training', type_name: '調教' },
  { type_id: 'genre/bonteji', type_name: 'ボンテージ' },
  { type_id: 'genre/imooto', type_name: '妹' },
  { type_id: 'genre/rota', type_name: 'ローター' },
  { type_id: 'genre/lori', type_name: 'ロリ' },
  { type_id: 'genre/special-effects', type_name: '特撮' },
  { type_id: 'genre/3p', type_name: '3P' },
  { type_id: 'genre/landlady-hostess', type_name: '女将・女主人' },
  { type_id: 'genre/selfie', type_name: '個人撮影' },
  { type_id: 'genre/loli-system', type_name: 'ロリ系' },
  { type_id: 'genre/dance', type_name: 'ダンス' },
  { type_id: 'genre/car-sex', type_name: 'カーセックス' },
  { type_id: 'genre/model', type_name: 'モデル' },
  { type_id: 'genre/action-fight', type_name: 'アクション格闘' },
  { type_id: 'genre/kusuko', type_name: 'クスコ' },
  { type_id: 'genre/knee-socks', type_name: 'ニーソックス' },
  { type_id: 'genre/for-women', type_name: '女性向け' },
  { type_id: 'genre/young', type_name: 'お嬢様・令嬢' },
  { type_id: 'genre/premature-ejaculation', type_name: '早漏' },
  { type_id: 'genre/miss-manners', type_name: '風俗嬢' },
  { type_id: 'genre/naive', type_name: '初心 (うぶ) 系' },
  { type_id: 'genre/time-stop', type_name: '時間停止' },
  { type_id: 'genre/chest-chiller', type_name: '胸チラ' },
  { type_id: 'genre/akushon', type_name: 'アクション' },
  { type_id: 'genre/yagai', type_name: '野外' },
  { type_id: 'genre/piledriver', type_name: 'マングリ返し' },
  { type_id: 'genre/ghost-animal', type_name: '鬼畜系' },
  { type_id: 'genre/gero', type_name: 'ゲロ' },
  { type_id: 'genre/swapping--couple-exchange', type_name: 'スワッピング・夫婦交換' },
  { type_id: 'genre/affair--cheating', type_name: '不倫・浮気' },
  { type_id: 'genre/pissing', type_name: '放尿' },
  { type_id: 'genre/bride', type_name: '花嫁' },
  { type_id: 'genre/oversea-import', type_name: '洋ピン・海外輸入' },
  { type_id: 'genre/no-undies', type_name: 'ノーパン' },
  { type_id: 'genre/how-to', type_name: 'How To' },
  { type_id: 'genre/anal-sex-cross-dressing-man', type_name: 'アナルセックス（男の娘）' },
  { type_id: 'genre/massaji', type_name: 'マッサージ' },
  { type_id: 'genre/scat', type_name: 'スカトロ' },
  { type_id: 'genre/naked-apron', type_name: '裸エプロン' },
  { type_id: 'genre/nantai', type_name: '軟体' },
  { type_id: 'genre/virgin', type_name: '処女' },
  { type_id: 'genre/defecation', type_name: '脱糞' },
  { type_id: 'genre/nurse', type_name: '看護婦' },
  { type_id: 'genre/cruel-expression', type_name: '残虐表現' },
  { type_id: 'genre/body-conscious', type_name: 'ボディコン' },
  { type_id: 'genre/nose-hook', type_name: '鼻フック' },
  { type_id: 'genre/queen', type_name: '女王様' },
  { type_id: 'genre/kimono', type_name: '浴衣・着物' },
  { type_id: 'genre/rinkan', type_name: '輪姦' },
  { type_id: 'genre/interview', type_name: '面接' },
  { type_id: 'genre/tickling', type_name: 'くすぐり' },
  { type_id: 'genre/mom-friends', type_name: 'ママ友' },
  { type_id: 'genre/fisting', type_name: 'フィスト' },
  { type_id: 'genre/beautiful-woman', type_name: '美女' },
  { type_id: 'genre/other-asian', type_name: 'アジア女優' },
  { type_id: 'genre/rimjob', type_name: 'アナル舐め' },
  { type_id: 'genre/seitenka-jotaika', type_name: '性転換・女体化' },
  { type_id: 'genre/catgirl', type_name: 'ネコミミ・獣系' },
  { type_id: 'genre/masked', type_name: '覆面・マスク' },
  { type_id: 'genre/loose-socks', type_name: 'ルーズソックス' },
  { type_id: 'genre/kimono-mourning', type_name: '和服、喪服' },
  { type_id: 'genre/ai-generated-artwork', type_name: 'AI生成作品' },
  { type_id: 'genre/otaku', type_name: 'オタク' },
  { type_id: 'genre/dark-system', type_name: 'ダーク系' },
  { type_id: 'genre/fighting-action', type_name: 'アクション・格闘' },
  { type_id: 'genre/hanayome-wakadzuma', type_name: '花嫁、若妻' },
  { type_id: 'genre/debut-work', type_name: 'デビュー作' },
  { type_id: 'genre/waitress', type_name: 'ウェイトレス' },
  { type_id: 'genre/yoga', type_name: 'ヨガ' },
  { type_id: 'genre/streaming', type_name: 'ストリーミング対応' },
  { type_id: 'genre/bloomers', type_name: 'ブルマ' },
  { type_id: 'genre/manko-zukan', type_name: 'マンコ図鑑' },
  { type_id: 'genre/20s', type_name: '20代' },
  { type_id: 'genre/grandma', type_name: 'お婆ちゃん' },
  { type_id: 'genre/cheerleader', type_name: 'チアガール' },
  { type_id: 'genre/hard', type_name: 'ハード系' },
  { type_id: 'genre/cleaning-blow', type_name: 'お掃除フェラ' },
  { type_id: 'genre/fetish', type_name: 'フェチ' },
  { type_id: 'genre/40s', type_name: '40代' },
  { type_id: 'genre/knee-high-boots', type_name: 'ロングブーツ' },
  { type_id: 'genre/receptionist', type_name: '受付嬢' },
  { type_id: 'genre/chikan', type_name: '痴漢' },
  { type_id: 'genre/celebrity', type_name: 'セレブ' },
  { type_id: 'genre/candle', type_name: '蝋燭' },
  { type_id: 'genre/gyagu-komedi', type_name: 'ギャグ・コメディ' },
  { type_id: 'genre/princess-story', type_name: '極上泡姫物語' },
  { type_id: 'genre/saimin', type_name: '催眠' },
  { type_id: 'genre/swimsuit-school', type_name: 'スクール水着' },
  { type_id: 'genre/futanari', type_name: 'ふたなり' },
  { type_id: 'genre/seiso', type_name: '清楚' },
  { type_id: 'genre/campaign-girl', type_name: 'キャンギャル' },
  { type_id: 'genre/young-wife', type_name: '若妻' },
  { type_id: 'genre/intercrural-sex', type_name: '素股' },
  { type_id: 'genre/omnibus--omnibus', type_name: '総集編・オムニバス' },
  { type_id: 'genre/china-dress', type_name: 'チャイナドレス' },
  { type_id: 'genre/sophisticated-adult-healing-pavilion', type_name: '洗練された大人のいやし亭' },
  { type_id: 'genre/insult', type_name: '罵倒' },
  { type_id: 'genre/female-soldier', type_name: '女戦士' },
  { type_id: 'genre/fast-pull-out-best', type_name: '早抜きBEST' },
  { type_id: 'genre/friends-with-benefits', type_name: 'セフレ' },
  { type_id: 'genre/%EF%BC%93p', type_name: '３P' },
  { type_id: 'genre/furo', type_name: '風呂' },
  { type_id: 'genre/look-alike', type_name: 'そっくりさん' },
  { type_id: 'genre/pregnant-woman', type_name: '妊婦' },
  { type_id: 'genre/kawaii', type_name: '可愛い' },
  { type_id: 'genre/the-unreleased', type_name: 'THE 未公開' },
  { type_id: 'genre/soap', type_name: 'ソープ' },
  { type_id: 'genre/epuron', type_name: 'エプロン' },
  { type_id: 'genre/debut', type_name: 'Debut' },
  { type_id: 'genre/hattori', type_name: '初撮り' },
  { type_id: 'genre/over-16-hours', type_name: '16時間以上作品' },
  { type_id: 'genre/experience-confession', type_name: '体験告白' },
  { type_id: 'genre/fighter', type_name: '格闘家' },
  { type_id: 'genre/reprint', type_name: '復刻' },
  { type_id: 'genre/clothes', type_name: '着衣' },
  { type_id: 'genre/ntr', type_name: 'NTR' },
  { type_id: 'genre/abandoned', type_name: '放置' },
  { type_id: 'genre/vip', type_name: 'VIP' },
  { type_id: 'genre/nasty', type_name: '淫乱' },
  { type_id: 'genre/shuchi-purei', type_name: '羞恥プレイ' },
  { type_id: 'genre/lady', type_name: 'お嬢様' },
  { type_id: 'genre/model', type_name: 'モデル系' },
  { type_id: 'genre/shave', type_name: '剃毛' },
  { type_id: 'genre/doll', type_name: 'ドール' },
  { type_id: 'genre/big-breasts', type_name: '爆乳' },
  { type_id: 'genre/dod', type_name: '2010年代後半（DOD）' },
  { type_id: 'genre/sf', type_name: 'SF' },
  { type_id: 'genre/brush-down', type_name: '筆おろし' },
  { type_id: 'genre/netorare', type_name: 'ネトラレ' },
  { type_id: 'genre/woman-slutty', type_name: 'この女、ふしだら。' },
  { type_id: 'genre/gay', type_name: 'ゲイ' },
  { type_id: 'genre/beauty', type_name: '美人' },
  { type_id: 'genre/kunoichi', type_name: 'くノ一' },
  { type_id: 'genre/summer-nude', type_name: 'サマーヌード' },
  { type_id: 'genre/yagairode', type_name: '野外露出' },
  { type_id: 'genre/anthology', type_name: 'アンソロジー' },
  { type_id: 'genre/shower', type_name: 'シャワー' },
  { type_id: 'genre/wakai', type_name: '若い' },
  { type_id: 'genre/bus-guide', type_name: 'バスガイド' },
  { type_id: 'genre/irama', type_name: 'イラマ' },
  { type_id: 'genre/sm-restraint', type_name: 'SM拘束' },
  { type_id: 'genre/companion', type_name: 'コンパニオン' },
  { type_id: 'genre/collaborative-work', type_name: 'コラボ作品' },
  { type_id: 'genre/oil-play', type_name: 'オイルプレイ' },
  { type_id: 'genre/g-cup', type_name: 'Gカップ' },
  { type_id: 'genre/drunk', type_name: '泥酔' },
  { type_id: 'genre/being-taken-asleep', type_name: '寝取られ' },
  { type_id: 'genre/actress-soul', type_name: '女優魂' },
  { type_id: 'genre/shokushu', type_name: '触手' },
  { type_id: 'genre/classic', type_name: 'クラシック' },
  { type_id: 'genre/priestess', type_name: '巫女' },
  { type_id: 'genre/50s', type_name: '50代' },
  { type_id: 'genre/cute', type_name: 'かわいい' },
  { type_id: 'genre/3d', type_name: '3D' },
  { type_id: 'genre/coprophagy', type_name: '食糞' },
  { type_id: 'genre/wafuku', type_name: '和服' },
  { type_id: 'genre/outflow', type_name: '流出' },
  { type_id: 'genre/ecstasy', type_name: '恍惚' },
  { type_id: 'genre/boga-x-boga', type_name: 'BOGA x BOGA' },
  { type_id: 'genre/digital-mosaic', type_name: 'Digital Mosaic' },
  { type_id: 'genre/cuckold--cuckold', type_name: '寝取り・寝取られ' },
  { type_id: 'genre/semen', type_name: 'ザーメン' },
  { type_id: 'genre/breaststroke', type_name: '胸射' },
  { type_id: 'genre/naked', type_name: '全裸' },
  { type_id: 'genre/fellatio', type_name: 'フェラチオ' },
  { type_id: 'genre/swallowing', type_name: '精飲' },
  { type_id: 'genre/cleaning-blowjob', type_name: '掃除フェラ' },
  { type_id: 'genre/dainamaito', type_name: 'ダイナマイト' },
  { type_id: 'genre/delivery-health-lady', type_name: 'デリヘル嬢' },
  { type_id: 'genre/belochu', type_name: 'ベロチュー' },
  { type_id: 'genre/f-cup', type_name: 'Fカップ' },
  { type_id: 'genre/baby-face', type_name: '童顔' },
  { type_id: 'genre/jd', type_name: 'JD' },
  { type_id: 'genre/princess', type_name: 'お姫様' },
  { type_id: 'genre/female-hot-continent', type_name: '女熱大陸' },
  { type_id: 'genre/taiwan-model', type_name: '台湾モデル' },
  { type_id: 'genre/shame-humiliation', type_name: '羞恥・辱め' },
  { type_id: 'genre/butterfly', type_name: '蝶が如く' },
  { type_id: 'genre/new-employee-job', type_name: '新入社員のお仕事' },
  { type_id: 'genre/roshutsu', type_name: '露出' },
  { type_id: 'genre/lucky-bag', type_name: '福袋' },
  { type_id: 'genre/landlady', type_name: '女将、女主人' },
  { type_id: 'genre/pillow-business', type_name: '枕営業' },
  { type_id: 'genre/hatsuura', type_name: '初裏' },
  { type_id: 'genre/anaru-zukan', type_name: 'アナル図鑑' },
  { type_id: 'genre/kurokami-rongu', type_name: '黒髪ロング' },
  { type_id: 'genre/sexy-actress-encyclopedia', type_name: 'セクシー女優エンサイクロペディア' },
  { type_id: 'genre/bristle', type_name: '剛毛' },
  { type_id: 'genre/dirty-blame', type_name: '淫語責め' },
  { type_id: 'genre/frustration', type_name: '欲求不満' },
  { type_id: 'genre/henshin-hiroin', type_name: '変身ヒロイン' },
  { type_id: 'genre/chippai', type_name: 'ちっぱい' },
  { type_id: 'genre/horror', type_name: 'ホラー' },
  { type_id: 'genre/promiscuity', type_name: 'Promiscuity' },
  { type_id: 'genre/panties', type_name: 'パンティ' },
  { type_id: 'genre/small-breasts', type_name: '貧乳' },
  { type_id: 'genre/4p', type_name: '４P' },
  { type_id: 'genre/nekomimi', type_name: 'ネコミミ' },
  { type_id: 'genre/sokui', type_name: '側位' },
  { type_id: 'genre/outdoor-sex', type_name: '青姦' },
  { type_id: 'genre/eichikappu', type_name: 'Hカップ' },
  { type_id: 'genre/2-ana-seme', type_name: '2穴責め' },
  { type_id: 'genre/besuto-omunibasu', type_name: 'ベスト/オムニバス' },
  { type_id: 'genre/office', type_name: 'オフィス' },
  { type_id: 'genre/teen-18', type_name: '10代 (18+)' },
];

// ---------- 工具 ----------
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
  const to = timeoutMs || 15000;
  const h = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.8,en;q=0.7',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const need = minLen || 200;
  try {
    const { data, status } = await req.get(url, { headers: h, timeout: to, responseType: 'text' });
    if ((status === 200 || status === 206) && data) {
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

// POST JSON (getPlayer 用): req 先行, fetch 兜底; 返回解析后的对象或 null
async function postJson(url, obj, headers, timeoutMs) {
  const to = timeoutMs || 25000;
  const h = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Referer': REFERER,
    ...(headers || {}),
  };
  const pick = (data) => {
    if (!data) return null;
    let j = data;
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { return null; } }
    if (j && typeof j === 'object') return j;
    return null;
  };
  try {
    const { data, status } = await req.post(url, obj, { headers: h, timeout: to });
    if (status === 200) { const j = pick(data); if (j) return j; }
  } catch (e) { /* 换通道2 */ }
  try {
    const r = await withTimeout(fetch(url, { method: 'POST', headers: h, body: JSON.stringify(obj) }), to);
    if (r.ok) { const j = pick(await r.text()); if (j) return j; }
  } catch (e) { /* ignore */ }
  return null;
}

// 带 Referer 的手动重定向解析 (S-VIP 的 /v/{t} → 302 取 Location);
// 原生 fetch 优先 (redirect:'manual' 只有它可控), req 兜底跟随后取终点文本判定。
// 返回 {url, isV}: isV=true 表示没拿到 302 终点、url 仍是 /v 地址本身
// (播放器取它时必须带 Referer=embed 页, 由 play 结果的 header 承担)
async function fetchLocation(url, referer) {
  const h = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': referer || REFERER };
  try {
    const r = await withTimeout(fetch(url, { headers: h, redirect: 'manual' }), 15000);
    const loc = r.headers.get('location');
    if (loc) { try { return { url: new URL(loc, url).href, isV: false }; } catch (e) { /* fallthrough */ } }
    if (r.url && r.url !== url) return { url: r.url, isV: false };
    if (r.status === 200) {
      const txt = await r.text();
      if (txt.includes('#EXTM3U')) return { url: r.url || url, isV: !r.url || r.url === url };
    }
  } catch (e) { /* 换通道2 */ }
  try {
    const txt = await getText(url, { 'Referer': referer || REFERER }, 10, 15000);
    if (txt && txt.includes('#EXTM3U')) return { url, isV: true };
  } catch (e) { /* ignore */ }
  return null;
}

// ---------- 列表 ----------
// 卡片: div.card.card--big 内 img[data-src]=封面、h3.card__title a=标题页、
// span.card__category a=番号。按卡片块切分解析, 同页去重。
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const parts = String(html || '').split('<div class="card card--big">');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 3500);
    const linkM = chunk.match(/card__title"><a href="(https:\/\/javideo\.net\/[^"]+)"[^>]*title="([^"]*)"/) ||
                  chunk.match(/card__title"><a href="(https:\/\/javideo\.net\/[^"]+)"[^>]*>([^<]*)</);
    if (!linkM) continue;
    const durl = linkM[1];
    const rest = durl.slice(SITE.length + 1);
    if (!rest || rest.includes('/')) continue; // 只收单段 slug 的视频页
    if (seen.has(durl)) continue;
    seen.add(durl);
    let pic = '';
    const imgM = chunk.match(/data-src="(https:[^"]+)"/) || chunk.match(/<img[^>]+src="(https:[^"]+)"/);
    if (imgM && !/default-cover/.test(imgM[1])) pic = imgM[1];
    const codeM = chunk.match(/card__category"><a[^>]*>([^<]+)</);
    out.push({
      vod_id: durl,
      vod_name: clean(linkM[2]) || durl,
      vod_pic: fixUrl(pic),
      vod_remarks: codeM ? clean(codeM[1]) : '',
    });
  }
  return out;
}

function pagecountOf(html, page) {
  const nums = [...String(html || '').matchAll(/\/pg-(\d+)/g)].map(x => parseInt(x[1], 10)).filter(n => n > 0 && n < 1000000);
  return nums.length ? Math.max(...nums) : 0;
}

function listUrl(tid, page) {
  return SITE + '/' + tid + (page > 1 ? '/pg-' + page : '');
}

async function listPage(tid, page) {
  const html = await getText(listUrl(tid, page));
  if (!html) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  const list = parseCards(html);
  let pc = pagecountOf(html, page);
  if (!pc) pc = list.length >= 30 ? page + 1 : page;
  return { page, pagecount: Math.max(pc, page), limit: 30, total: list.length, list };
}

// ---------- 接口 ----------
async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getText(SITE + '/');
  const list = html ? parseCards(html).slice(0, 30) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'censored';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const cat = CATS.find(c => c.type_id === tid);
  if (!cat) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  return listPage(cat.type_id, page);
}

// ---------- 详情 ----------
// 信息表 li 按标签文本定位取值
function infoRow(html, label) {
  const i = html.indexOf(label);
  if (i < 0) return '';
  return html.slice(i, i + 1200);
}

// 播放入口: .episodeShow 内 button[data-id]=集数id, 文本=线路名
// (S-VIP/SW/DSTR/STAPE/LLS)。DSTR 是 DoodStream 马甲, 点播前强制
// Turnstile 人机验证 —— 不生成线路。
function extractLines(html) {
  const i = html.indexOf('episodeShow');
  const region = i >= 0 ? html.slice(i, i + 4000) : '';
  const found = [];
  for (const m of region.matchAll(/<button data-id="(\d+)"[^>]*>([^<]+)<\/button>/g)) {
    const label = clean(m[2]).toUpperCase();
    let kind = '';
    if (label.startsWith('S-VIP')) kind = 'v';
    else if (label.startsWith('SW')) kind = 'w';
    else if (label.startsWith('LLS')) kind = 'l';
    else if (label.startsWith('STAPE')) kind = 't';
    else continue; // DSTR 及未知线路跳过
    if (!found.some(f => f.kind === kind)) found.push({ kind, epi: m[1] });
  }
  const order = { v: 0, w: 1, l: 2, t: 3 };
  found.sort((a, b) => order[a.kind] - order[b.kind]);
  return found;
}

const LINE_NAMES = { v: 'S-VIP', w: 'SW', l: 'LLS', t: 'STAPE' };

async function detail(reqIn) {
  const body = reqIn?.body || {};
  const id = t(body.id);
  if (!id) return { list: [] };
  const durl = /^https?:\/\//.test(id) ? id : SITE + '/' + id.replace(/^\//, '');
  const html = await getText(durl);
  if (!html) return { list: [] };

  let name = '';
  const h1M = html.match(/<h1 class="section__title">([\s\S]*?)<\/h1>/);
  if (h1M) name = clean(h1M[1]);
  if (!name) {
    const ogM = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (ogM) name = clean(ogM[1]);
  }
  // 信息行查找限定在详情信息块内 (页头导航里也有同名标签, 会切错区)
  const infoStart = html.indexOf('card__content_info');
  const infoHtml = infoStart >= 0 ? html.slice(infoStart, infoStart + 9000) : html;
  let pic = '';
  const ogiM = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (ogiM) pic = fixUrl(ogiM[1]);
  if (!pic) {
    const fpM = html.match(/<img class="fp-poster" src="([^"]+)"/);
    if (fpM) pic = fixUrl(fpM[1]);
  }
  const studioM = infoRow(infoHtml, 'AVメーカー').match(/href="https:\/\/javideo\.net\/studio\/[^"]+"[^>]*title="([^"]+)"/) ||
                  infoRow(infoHtml, 'AVメーカー').match(/href="https:\/\/javideo\.net\/studio\/[^"]+"[^>]*>([^<]+)</);
  const genres = [];
  for (const m of infoRow(infoHtml, 'ジャンル').matchAll(/href="https:\/\/javideo\.net\/genre\/[^"]+"[^>]*title="([^"]+)"/g)) {
    if (!genres.includes(clean(m[1]))) genres.push(clean(m[1]));
  }
  let actor = '';
  const actRow = infoRow(infoHtml, '出演者');
  const actNames = [...actRow.matchAll(/href="https:\/\/javideo\.net\/actress\/[^"]+"[^>]*>([^<]+)</g)].map(x => clean(x[1]));
  if (actNames.length) actor = actNames.join(',');
  let year = '';
  const dateM = infoRow(infoHtml, '発売日').match(/(20\d{2})-\d{2}-\d{2}/);
  if (dateM) year = dateM[1];
  let remarks = '';
  const minM = infoRow(infoHtml, '収録時間').match(/(\d+)\s*分/);
  if (minM) {
    const mins = parseInt(minM[1], 10);
    remarks = Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0') + ':00';
  }
  let content = '';
  const descM = html.match(/<div class="card__description">([\s\S]*?)<\/div>/);
  if (descM) content = clean(descM[1]);
  if (!content) {
    const ogdM = html.match(/<meta property="og:description" content="([^"]+)"/);
    if (ogdM) content = clean(ogdM[1]);
  }

  const lines = extractLines(html);
  const fromNames = [];
  const playEntries = [];
  for (const ln of lines) {
    fromNames.push(LINE_NAMES[ln.kind]);
    playEntries.push('正片$' + ln.kind + ':' + ln.epi + ':' + durl);
  }
  if (!playEntries.length) {
    // 无可用线路 (极少数): 仍给出条目, play 落空返 —— 不拿 DSTR 充数
    fromNames.push('无可用线路');
    playEntries.push('正片$x:0:' + durl);
  }

  const vod = {
    vod_id: durl,
    vod_name: name || durl,
    vod_pic: pic,
    vod_remarks: remarks,
    vod_actor: actor,
    vod_year: year,
    vod_class: genres.join(','),
    vod_content: content,
    vod_play_from: fromNames.join('$$$'),
    vod_play_url: playEntries.join('$$$'),
  };
  subRegister(id, vod);
  return { list: [vod] };
}

// ---------- 播放 ----------
// 集数id → embed 地址 (站方官方接口, 与网页按钮点击同一调用)
async function getEmbed(epi, durl) {
  const j = await postJson(SITE + '/api/movie/getPlayer', { id: String(epi) }, { 'Referer': durl || REFERER });
  if (!j) return '';
  const u = t(j.data).replace(/\\\//g, '/');
  return /^https?:\/\//.test(u) ? u : '';
}

// S-VIP 自营链: embed uuid → 签名 token → /v/{t} 302 → 最终签名列表
async function resolveSvip(embedUrl) {
  let origin = '', uuid = '';
  try {
    const u = new URL(embedUrl);
    origin = u.origin;
    uuid = u.pathname.split('/').filter(Boolean).pop() || '';
  } catch (e) { return null; }
  if (!uuid) return null;
  const tokTxt = await getText(origin + '/api/playlist-token/' + encodeURIComponent(uuid),
    { 'Accept': 'application/json', 'Referer': embedUrl }, 10, 15000);
  let tok = '';
  if (tokTxt) { try { tok = t(JSON.parse(tokTxt).t); } catch (e) { /* ignore */ } }
  if (!tok) return null;
  const fin = await fetchLocation(origin + '/v/' + encodeURIComponent(tok), embedUrl);
  if (!fin) return null;
  if (fin.isV) return { url: fin.url, referer: embedUrl };
  // 校验最终地址确为播放列表 (含 #EXTM3U); 校验请求本身失败时信任 302 结果
  const pl = await getText(fin.url, {}, 5, 12000);
  if (pl && !pl.includes('#EXTM3U')) return null;
  return { url: fin.url, referer: REFERER };
}

// vidhide 系 packer 纯字符串解包 (与 Worker 同算法)
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

// 从 embed 页 (解包后文本优先) 提取流地址: vidhide 的 links{hlsN}
// 或 LuluStream 的 JW sources file 兜底; 返回按优先级排好的候选列
function extractStreamCandidates(html, embedUrl) {
  const text = unpackDeanEdwards(html) || String(html || '');
  const links = {};
  for (const m of text.matchAll(/"hls(\d+)"\s*:\s*"([^"]+)"/g)) links['hls' + m[1]] = m[2];
  const out = [];
  for (const key of ['hls4', 'hls3', 'hls2']) {
    const raw = links[key];
    if (!raw) continue;
    try { const abs = new URL(raw, embedUrl).href; if (!out.includes(abs)) out.push(abs); } catch (e) { /* 下一个 */ }
  }
  if (!out.length) {
    const f = text.match(/"file"\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/) || text.match(/(https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*)/);
    if (f) { try { out.push(new URL(f[1], embedUrl).href); } catch (e) { /* ignore */ } }
  }
  return out;
}

// SW/LLS: Worker 全链优先 (蜘蛛侧校验 /v 确为列表才用), 未部署/不通
// 时回退蜘蛛内解包直解 (候选逐个校验, 全灭则交第一个候选裸返)
async function resolveVidhideLike(embedUrl, durl) {
  if (JAVIDEO_WORKER) {
    const wurl = JAVIDEO_WORKER + '/v?u=' + encodeURIComponent(embedUrl) + '&r=' + encodeURIComponent(durl || REFERER);
    const txt = await getText(wurl, {}, 20, 25000);
    if (txt && txt.includes('#EXTM3U')) {
      return { parse: 0, url: wurl, header: { 'User-Agent': UA, 'Referer': REFERER } };
    }
  }
  const html = await getText(embedUrl, { 'Referer': durl || REFERER }, 1000, 12000);
  if (html) {
    const cands = extractStreamCandidates(html, embedUrl);
    for (const c of cands) {
      const pl = await getText(c, { 'Referer': embedUrl }, 5, 10000);
      if (pl && pl.includes('#EXTM3U')) {
        return { parse: 0, url: c, header: { 'User-Agent': UA, 'Referer': embedUrl } };
      }
    }
    if (cands.length) {
      return { parse: 0, url: cands[0], header: { 'User-Agent': UA, 'Referer': embedUrl } };
    }
  }
  return { parse: 1, jx: 0, url: embedUrl, header: { 'User-Agent': UA, 'Referer': durl || REFERER } };
}

// Streamtape robotlink 拼装复现: 静态 div 是诱饵, 真地址由页面脚本
// 对诱饵串做 substring 后与前缀拼接 (三个元素同理, 取 robotlink)
function resolveRobotlink(html) {
  const s = String(html || '');
  for (const el of ['robotlink', 'botlink', 'ideoolink']) {
    const re = new RegExp("getElementById\\('" + el + "'\\)\\.innerHTML\\s*=\\s*'([^']*)'\\s*(?:\\+\\s*\\(\\s*'([^']*)'\\s*\\)\\s*((?:\\.substring\\(\\d+\\))*))?");
    const m = s.match(re);
    if (!m) continue;
    let out = m[1];
    if (m[2]) {
      let d = m[2];
      for (const sm of m[3].matchAll(/\.substring\((\d+)\)/g)) d = d.substring(parseInt(sm[1], 10));
      out += d;
    }
    out = out.replace(/^\/\//, 'https://').replace(/^\//, 'https:/');
    if (/get_video\?/.test(out)) return out;
  }
  return '';
}

async function resolveStape(embedUrl, durl) {
  const html = await getText(embedUrl, { 'Referer': durl || REFERER }, 1000, 12000);
  if (html) {
    const link = resolveRobotlink(html);
    if (link) return { parse: 0, url: link, header: { 'User-Agent': UA, 'Referer': embedUrl } };
  }
  return { parse: 1, jx: 0, url: embedUrl, header: { 'User-Agent': UA, 'Referer': durl || REFERER } };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.startsWith('正片$')) id = id.slice(3);
  const p1 = id.indexOf(':');
  const p2 = p1 >= 0 ? id.indexOf(':', p1 + 1) : -1;
  if (p1 < 0 || p2 < 0) return { parse: 0, url: '' };
  const kind = id.slice(0, p1);
  const epi = id.slice(p1 + 1, p2);
  const durl = id.slice(p2 + 1);
  if (!epi || epi === '0') return { parse: 0, url: '' };
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);

  if (kind === 'v' || kind === 'w' || kind === 'l' || kind === 't') {
    const embed = await getEmbed(epi, durl);
    if (!embed) return { parse: 0, url: '' };
    if (kind === 'v') {
      const r = await resolveSvip(embed);
      if (r) return subAttach({ parse: 0, url: r.url, header: { 'User-Agent': UA, 'Referer': r.referer } }, subsP);
      return { parse: 0, url: '' };
    }
    if (kind === 'w' || kind === 'l') return subAttach(await resolveVidhideLike(embed, durl), subsP);
    return subAttach(await resolveStape(embed, durl), subsP);
  }
  return { parse: 0, url: '' };
}

// ---------- 搜索 ----------
// kw 规范化与站方 JS 同规则: 小写, 空白与 .:;=+ 转 '-', 折叠并去首尾 '-'
function normKw(wd) {
  return t(wd).toLowerCase()
    .replace(/[\s\.:;=+]+/g, '-')
    .replace(/-+-/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  const kw = normKw(wd);
  if (!kw) return { page, pagecount: page, limit: 30, total: 0, list: [] };
  return listPage('search/' + encodeURIComponent(kw), page);
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

// ---------------- 字幕聚合 (Layer A 试点, 2026-10-22) ----------------
// 点播时按片名多源搜字幕, 候选以 TVBox 标准 subs 数组挂到 play
// 返回对象上 (播放器是否渲染由播放器决定, 蜘蛛只负责挂载)。
// 来源优先级 (用户钦定): 迅雷 > 迅雷看看 > SubtitleCat > SubHD
// > 射手。实探结论 (报告 castbank/REPORT_subtitle_pilot.md):
// 「迅雷」与「迅雷看看」是同一个 oracle 接口 (api-shoulei-ssl.
// xunlei.com, 按名搜、结果即 .srt 直链), 实现合并为一源占首档;
// SubHD 搜索与 prepare 通但 /down/ 被站方门控 (VM 出口实测 403
// 「下载页面已失效」)、射手 assrt.net 源站经 CF 522 不可达 —
// 两源本轮不接入 (不挂未验证链路)。全程 req 主栈 (subHttp),
// 每源独立超时、总预算 6s、与 resolveLines 并行, 失败全静默;
// 无结果时 play 返回对象不带 subs 键, 与未接入前逐字段一致。
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

function subKeys(durl) {
  const title = (subNameCache.get(durl) || subSlugTitle(durl) || '').trim();
  const code = subExtractCode(title) || subExtractCode(String(durl || ''));
  const keys = [];
  if (code) keys.push(code);
  if (title && title !== code) keys.push(title);
  if (code && title) {
    const tp = title.replace(new RegExp(code.replace(/-/g, '[- ]?'), 'i'), '').replace(/^[\s\-_:]+|[\s\-_:]+$/g, '').trim();
    if (tp && tp.length >= 3) keys.push(code + ' ' + tp);
  }
  return [...new Set(keys)].filter((k) => k.length >= 2).slice(0, 3);
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

// 迅雷看看 (兼「迅雷」位, 同一 oracle 接口): 按名搜, 结果即直链。
// 前 2 个键并行查, 每键返回即入 bag (不互相等候 — 慢键不能扣住
// 快键的结果), 最终由 subMerge 按档位/语言/番号命中/热度排序。
async function subFromXunlei(keys, code, bag) {
  await Promise.all(keys.slice(0, 2).map(async (key) => {
    const r = await subHttp('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(key),
      { 'User-Agent': 'ForwardWidgets/1.0.2', Accept: '*/*' }, 5000);
    if (r.status !== 200 || !r.body) return;
    let j;
    try { j = JSON.parse(r.body); } catch (e) { return; }
    if (!j || Number(j.code) !== 0 || !Array.isArray(j.data)) return;
    for (const it of j.data) {
      if (!it) continue;
      const url = String(it.url || it.Url || '');
      if (!SUB_TEXT_RE.test(url)) continue; // 压缩包/非文本字幕剔除
      const nm = String(it.name || it.Name || '字幕');
      const langs = Array.isArray(it.languages) ? it.languages.join(',') : String(it.langs || it.Langs || '');
      const lang = subLangOf(nm, langs);
      const pop = (Number(it.down_count || it.DownCount || it.downloads || 0) || 0)
        + (Number(it.score || 0) || 0) + (Number(it.fingerprintf_score || it.fingerprint_score || 0) || 0);
      // 个别条目名是裸哈希 (不可读): 显示名换成番号字幕, 匹配/
      // 语言判定仍用原名
      const dispName = /^[0-9a-f]{24,}$/i.test(nm.trim()) ? (code ? code + ' 迅雷字幕' : '迅雷字幕') : nm;
      bag.push({
        src: '迅雷看看', tier: 0, name: dispName, url, lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop,
      });
    }
  }));
}

// SubtitleCat: 搜索页 -> 字幕页 -> 按语言分的 .srt 直链 (逐页入 bag)
async function subFromSubtitleCat(keys, code, bag) {
  const key = keys[0];
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
      const lang = subLangOf(nm, '');
      bag.push({
        src: 'SubtitleCat', tier: 2, name: nm, url: 'https://subtitlecat.com' + m[1], lang: lang.tag, langRank: lang.rank,
        codeHit: code && nm.toUpperCase().replace(/[._]/g, ' ').includes(code.replace(/-/g, ' ')) ? 1 : 0, pop: 0,
      });
    }
  }));
}

// 合并排序: 来源档位 -> 语言 -> 番号命中 -> 热度; 按 url 与
// (语言|去扩展名文件名) 双键去重 (迅雷与 SubtitleCat 常有同源
// 同名文件、不同直链); 上限 10 条。
function subMerge(items) {
  const sorted = items.slice().sort((a, b) =>
    (a.tier - b.tier) || (a.langRank - b.langRank) || (b.codeHit - a.codeHit) || (b.pop - a.pop) || String(a.name).localeCompare(String(b.name)));
  const seenUrl = new Set();
  const seenName = new Set();
  const out = [];
  for (const it of sorted) {
    if (seenUrl.has(it.url)) continue;
    const nameKey = it.lang + '|' + it.name.toLowerCase().replace(/\.(srt|vtt|ass|ssa)$/i, '');
    if (seenName.has(nameKey)) continue;
    seenUrl.add(it.url);
    seenName.add(nameKey);
    const ext = (it.url.match(SUB_TEXT_RE) || [])[1].toLowerCase();
    const cleanName = it.name.replace(/\.(srt|vtt|ass|ssa)$/i, '').slice(0, 60);
    out.push({ name: it.src + '·' + (it.lang ? it.lang + '·' : '') + cleanName, url: it.url, format: ext });
    if (out.length >= 10) break;
  }
  return out;
}

const subInflight = new Map(); // durl -> Promise<subs> (detail 预热与 play 共用同一趟)

async function subSearchAll(durl) {
  const hit = subResultCache.get(durl);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.subs;
  if (subInflight.has(durl)) return subInflight.get(durl);
  const p = (async () => {
    const keys = subKeys(durl);
    let subs = [];
    if (keys.length) {
      const code = subExtractCode(subNameCache.get(durl) || '') || subExtractCode(String(durl || ''));
      const bag = [];
      const jobs = [
        subFromXunlei(keys, code, bag),
        subFromSubtitleCat(keys, code, bag),
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
