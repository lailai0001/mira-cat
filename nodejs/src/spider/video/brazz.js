import req from '../../util/req.js';

// Brazz.org (py_brazz) —— 暂用站方品牌名 (og:site_name 以 "Brazz.org" 开头)，用户可改
// 站点: https://brazz.org (WordPress + WP-Script 类 tube 主题，SSR 直出，无自有 API)
// 性质: Brazzers 系付费片的免费聚合站 (独立站，非 brazzers.com 官方)，全站免登录、
//       无 VIP 墙 (2026-10-20 实测)。根路径 301 到 /home-free-brazz-premium-2026/，
//       所有列表/详情 URL 都带 /free-brazz-premium-2026/ 后缀段。
// 2026-10-20 实测结构:
//   列表: 每页 20 条 <article class="loop-video">，卡片含详情链接 a[href=/video/{id}/{slug}/...][title]、
//         封面 img data-src (media-public-ht.project1content.com 直链，实测无头 200 image/jpeg)、
//         时长 span.duration、浏览量 span.views。
//   分类: 共 556 个 —— 最新/观看最多/评分最高/正在观看 4 个排序列表 +
//         20 个出品系列 (/videos/site/{id}/{slug}/) +
//         532 个标签 (/videos/tags/{id}/{slug}/，取自站内 /tags/ 标签云全量 549 条，
//         17 组同名 slug 去重后 532；逐个抽测/批量实测第 1 页均有真实条目，
//         标签云标注的 items 数虚高 (如 Podcast 标注 50 实有 4)，不可信，只作排序参考)。
//   分页: 列表基址 + /page/{n}/free-brazz-premium-2026/ (如 anal 标签共 38 页、全部视频共 160 页)，
//         页数从分页链接取最大值。
//   详情: og:title (带 "Brazz.Org - " 前缀，需剥)、og:image 封面、meta description 简介、
//         .tags-list 内标签链接、/videos/models/ 演员链接，正文内嵌唯一播放器 iframe。
//   播放: 详情页 iframe → https://brazzpw.xyz/player/?id={vid}&p={base64封面}，
//         播放器页内联 player.src 的相对地址 m3u8_{vid}.m3u8?hash=..&time=..，
//         解析为 https://brazzpw.xyz/player/m3u8_{vid}.m3u8?hash=.. 即得媒体播放列表
//         (单档 "auto"：720p H.264 + AAC，约 2.8Mbps，站方只给这一档)。
//         hash 值实测不校验 (hash=1 亦可出全量列表，字节一致)，但无 hash 参数只回 1 字节；
//         本蜘蛛优先解析播放器页的真实 src，失败时用 m3u8_{vid}.m3u8?hash=1 构造兜底，
//         再失败落 parse:1 嗅探播放器页。
//         播放列表与分片 (video/?id=..&ts=..&sub=index-v1-a1) 实测零自定义请求头可拉
//         (curl 默认 UA 亦 200，分片为真 MPEG-TS)；注意 brazzpw.xyz 在 Cloudflare 后，
//         Python-urllib 类签名会被 CF 1010 拦，浏览器类 UA 正常——蜘蛛自有请求统一带浏览器 UA。
//   搜索: /search/free-brazz-premium-2026/?s={kw}，单页最多 40 条，无分页。
//   封面域名 media-public-ht.project1content.com 实测直连可达，不走图片代理。

const KEY = 'py_brazz';
const NAME = 'Brazz.org';
const SITE = 'https://brazz.org';
const PLAYER_HOST = 'https://brazzpw.xyz';
const SUFFIX = '/free-brazz-premium-2026/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const REFERER = SITE + '/';

const CATS = [
  { type_id: 'latest', type_name: '最新视频' },
  { type_id: 'sort/views', type_name: '观看最多' },
  { type_id: 'sort/rating', type_name: '评分最高' },
  { type_id: 'sort/beingwatched', type_name: '正在观看' },
  { type_id: 'site/62/doctor-adventures', type_name: 'Doctor Adventures' },
  { type_id: 'site/65/big-wet-butts', type_name: 'Big Wet Butts' },
  { type_id: 'site/66/baby-got-boobs', type_name: 'Baby Got Boobs' },
  { type_id: 'site/67/mommy-got-boobs', type_name: 'Mommy Got Boobs' },
  { type_id: 'site/71/big-tits-at-work', type_name: 'Big Tits at Work' },
  { type_id: 'site/75/big-tits-at-school', type_name: 'Big Tits at School' },
  { type_id: 'site/77/pornstars-like-it-big', type_name: 'Pornstars Like it Big' },
  { type_id: 'site/78/milfs-like-it-big', type_name: 'Milfs Like it Big' },
  { type_id: 'site/80/teens-like-it-big', type_name: 'Teens Like It Big' },
  { type_id: 'site/81/real-wife-stories', type_name: 'Real Wife Stories' },
  { type_id: 'site/82/big-butts-like-it-big', type_name: 'Big Butts Like It Big' },
  { type_id: 'site/83/big-tits-in-sports', type_name: 'Big Tits In Sports' },
  { type_id: 'site/87/day-with-a-pornstar', type_name: 'Day With A Pornstar' },
  { type_id: 'site/89/big-tits-in-uniform', type_name: 'Big Tits In Uniform' },
  { type_id: 'site/90/hot-and-mean', type_name: 'Hot And Mean' },
  { type_id: 'site/92/zz-series', type_name: 'ZZ Series' },
  { type_id: 'site/94/dirty-masseur', type_name: 'Dirty Masseur' },
  { type_id: 'site/96/brazzers-exxtra', type_name: 'Brazzers Exxtra' },
  { type_id: 'site/98/cfnm', type_name: 'CFNM' },
  { type_id: 'site/99/moms-in-control', type_name: 'Moms in control' },
  { type_id: 'tag/9/sex', type_name: 'Sex' },
  { type_id: 'tag/277/blowjob', type_name: 'Blowjob' },
  { type_id: 'tag/319/indoors', type_name: 'Indoors' },
  { type_id: 'tag/545/big-dick', type_name: 'Big Dick' },
  { type_id: 'tag/562/doggystyle', type_name: 'Doggystyle' },
  { type_id: 'tag/558/cowgirl', type_name: 'Cowgirl' },
  { type_id: 'tag/578/missionary', type_name: 'Missionary' },
  { type_id: 'tag/585/reverse-cowgirl', type_name: 'Reverse Cowgirl' },
  { type_id: 'tag/630/innie-pussy', type_name: 'Innie Pussy' },
  { type_id: 'tag/666/big-tits', type_name: 'Big Tits' },
  { type_id: 'tag/281/deep-throat', type_name: 'Deep Throat' },
  { type_id: 'tag/386/short-hair', type_name: 'Short Hair' },
  { type_id: 'tag/90/athletic', type_name: 'Athletic' },
  { type_id: 'tag/88/tattoo', type_name: 'Tattoo' },
  { type_id: 'tag/292/pussy-licking', type_name: 'Pussy Licking' },
  { type_id: 'tag/66/facial', type_name: 'Facial' },
  { type_id: 'tag/590/side-fuck', type_name: 'Side Fuck' },
  { type_id: 'tag/50/bubble-butt', type_name: 'Bubble Butt' },
  { type_id: 'tag/294/spanking', type_name: 'Spanking' },
  { type_id: 'tag/283/face-fuck', type_name: 'Face Fuck' },
  { type_id: 'tag/672/enhanced', type_name: 'Enhanced' },
  { type_id: 'tag/286/gagging', type_name: 'Gagging' },
  { type_id: 'tag/107/caucasian', type_name: 'Caucasian' },
  { type_id: 'tag/626/bald-pussy', type_name: 'Bald Pussy' },
  { type_id: 'tag/291/pussy-fingering', type_name: 'Pussy Fingering' },
  { type_id: 'tag/87/piercing', type_name: 'Piercing' },
  { type_id: 'tag/673/natural-tits', type_name: 'Natural Tits' },
  { type_id: 'tag/628/trimmed-pussy', type_name: 'Trimmed Pussy' },
  { type_id: 'tag/207/handjob', type_name: 'Handjob' },
  { type_id: 'tag/62/cum-shot', type_name: 'Cum Shot' },
  { type_id: 'tag/566/doggystyle-standing', type_name: 'Doggystyle - Standing' },
  { type_id: 'tag/455/big-tits-worship', type_name: 'Big Tits Worship' },
  { type_id: 'tag/49/big-ass', type_name: 'Big Ass' },
  { type_id: 'tag/229/high-heels', type_name: 'High Heels' },
  { type_id: 'tag/365/muscular-man', type_name: 'Muscular Man' },
  { type_id: 'tag/505/interracial', type_name: 'Interracial' },
  { type_id: 'tag/55/cumshot-clean-up', type_name: 'Cumshot Clean-Up' },
  { type_id: 'tag/371/american-man', type_name: 'American Man' },
  { type_id: 'tag/210/kissing', type_name: 'Kissing' },
  { type_id: 'tag/279/blowjob-pov', type_name: 'Blowjob - POV' },
  { type_id: 'tag/376/european', type_name: 'European' },
  { type_id: 'tag/126/blonde', type_name: 'Blonde' },
  { type_id: 'tag/127/brunette', type_name: 'Brunette' },
  { type_id: 'tag/125/black-hair', type_name: 'Black Hair' },
  { type_id: 'tag/470/couples-fantasies', type_name: 'Couples Fantasies' },
  { type_id: 'tag/359/average-male-body', type_name: 'Average Male Body ' },
  { type_id: 'tag/296/titty-fuck', type_name: 'Titty Fuck' },
  { type_id: 'tag/381/brown-hair', type_name: 'Brown Hair' },
  { type_id: 'tag/278/blowjob-double', type_name: 'Blowjob - Double' },
  { type_id: 'tag/466/cheating', type_name: 'Caught Cheating' },
  { type_id: 'tag/11/threesome', type_name: 'Threesome' },
  { type_id: 'tag/307/bedroom', type_name: 'Bedroom' },
  { type_id: 'tag/25/dress', type_name: 'Dress' },
  { type_id: 'tag/284/face-sitting', type_name: 'Face Sitting' },
  { type_id: 'tag/227/wet', type_name: 'Wet' },
  { type_id: 'tag/554/ballerina', type_name: 'Ballerina' },
  { type_id: 'tag/631/outie-pussy', type_name: 'Outie Pussy' },
  { type_id: 'tag/596/spoon', type_name: 'Spoon' },
  { type_id: 'tag/543/thong', type_name: 'Thong' },
  { type_id: 'tag/665/big-naturals', type_name: 'Big Naturals' },
  { type_id: 'tag/52/small-ass', type_name: 'Small Ass' },
  { type_id: 'tag/1427/top-ad', type_name: 'Top Ad' },
  { type_id: 'tag/671/big-boobs-natural', type_name: 'Big Boobs (Natural)' },
  { type_id: 'tag/212/masturbation', type_name: 'Masturbation' },
  { type_id: 'tag/669/small-tits', type_name: 'Small Tits' },
  { type_id: 'tag/274/ass-licking', type_name: 'Ass Licking' },
  { type_id: 'tag/448/anal', type_name: 'Anal' },
  { type_id: 'tag/576/fuck-n-lick', type_name: 'Fuck n Lick' },
  { type_id: 'tag/4/ffm', type_name: 'FFM' },
  { type_id: 'tag/538/work-fantasies', type_name: 'Work Fantasies' },
  { type_id: 'tag/617/sex-toys', type_name: 'Sex Toys' },
  { type_id: 'tag/367/slim', type_name: 'Slim' },
  { type_id: 'tag/324/living-room', type_name: 'Living Room' },
  { type_id: 'tag/450/ass-worship', type_name: 'Ass Worship' },
  { type_id: 'tag/203/fetish', type_name: 'Fetish' },
  { type_id: 'tag/550/69', type_name: '69' },
  { type_id: 'tag/91/average-body', type_name: 'Average Body' },
  { type_id: 'tag/615/oil', type_name: 'Oil' },
  { type_id: 'tag/121/latina', type_name: 'Latina' },
  { type_id: 'tag/374/black-male', type_name: 'Black Male' },
  { type_id: 'tag/219/sneaky', type_name: 'Sneaky' },
  { type_id: 'tag/202/feet', type_name: 'Feet' },
  { type_id: 'tag/385/shaved', type_name: 'Shaved' },
  { type_id: 'tag/329/outdoors', type_name: 'Outdoors' },
  { type_id: 'tag/46/tank-top', type_name: 'Tank Top' },
  { type_id: 'tag/112/black', type_name: 'Black' },
  { type_id: 'tag/128/red-head', type_name: 'Redhead' },
  { type_id: 'tag/275/ass-to-mouth', type_name: 'Ass To Mouth' },
  { type_id: 'tag/220/squirt', type_name: 'Squirt' },
  { type_id: 'tag/69/multiple-cum-cleanup', type_name: 'Multiple Cum Cleanup' },
  { type_id: 'tag/599/stand-and-carry', type_name: 'Stand And Carry' },
  { type_id: 'tag/350/25-34', type_name: '25-34' },
  { type_id: 'tag/288/hair-pulling', type_name: 'Hair Pulling' },
  { type_id: 'tag/589/scissoring', type_name: 'Scissoring' },
  { type_id: 'tag/99/voluptuous', type_name: 'Voluptuous' },
  { type_id: 'tag/290/oral-train', type_name: 'Oral Train' },
  { type_id: 'tag/271/anal-fingering', type_name: 'Anal Fingering' },
  { type_id: 'tag/542/g-string', type_name: 'G-String' },
  { type_id: 'tag/23/booty-shorts', type_name: 'Booty Shorts' },
  { type_id: 'tag/191/wife', type_name: 'Wife' },
  { type_id: 'tag/380/blond-hair', type_name: 'Blond Hair' },
  { type_id: 'tag/51/medium-ass', type_name: 'Medium Ass' },
  { type_id: 'tag/223/twerking', type_name: 'Twerking' },
  { type_id: 'tag/44/socks', type_name: 'Socks' },
  { type_id: 'tag/65/cum-swap', type_name: 'Cum Swap' },
  { type_id: 'tag/299/garter-belt', type_name: 'Garter Belt' },
  { type_id: 'tag/79/milf', type_name: 'MILF' },
  { type_id: 'tag/304/bathroom', type_name: 'Bathroom' },
  { type_id: 'tag/567/doggystyle-blowjob', type_name: 'Doggystyle Blowjob' },
  { type_id: 'tag/45/sports-bra', type_name: 'Sports Bra' },
  { type_id: 'tag/668/medium-tits', type_name: 'Medium Tits' },
  { type_id: 'tag/609/dildo', type_name: 'Dildo' },
  { type_id: 'tag/297/tittyfuck-pov', type_name: 'Tittyfuck - POV' },
  { type_id: 'tag/95/petite', type_name: 'Petite' },
  { type_id: 'tag/321/kitchen', type_name: 'Kitchen' },
  { type_id: 'tag/61/cum-on-tits', type_name: 'Cum on Tits' },
  { type_id: 'tag/217/slow-mo', type_name: 'Slow Mo' },
  { type_id: 'tag/382/grey', type_name: 'Grey' },
  { type_id: 'tag/98/thick', type_name: 'Thick' },
  { type_id: 'tag/35/leggings', type_name: 'Leggings' },
  { type_id: 'tag/15/glasses', type_name: 'Glasses' },
  { type_id: 'tag/564/doggystyle-pov', type_name: 'Doggystyle - POV' },
  { type_id: 'tag/56/creampie', type_name: 'Creampie' },
  { type_id: 'tag/593/side-rider', type_name: 'Side Rider' },
  { type_id: 'tag/583/pile-driving', type_name: 'Pile Driving' },
  { type_id: 'tag/31/jean-shorts', type_name: 'Jean Shorts' },
  { type_id: 'tag/215/rimjob', type_name: 'Rimjob' },
  { type_id: 'tag/563/doggystyle-lying', type_name: 'Doggystyle - Lying' },
  { type_id: 'tag/586/reverse-cowgirl-pov', type_name: 'Reverse Cowgirl - POV' },
  { type_id: 'tag/351/35-plus', type_name: '35 Plus' },
  { type_id: 'tag/2/2-on-1-2-males', type_name: '2 on 1 (2 Males)' },
  { type_id: 'tag/228/boots', type_name: 'Boots' },
  { type_id: 'tag/204/footjob', type_name: 'Footjob' },
  { type_id: 'tag/499/gonzo', type_name: 'Gonzo' },
  { type_id: 'tag/560/cowgirl-blowjob', type_name: 'Cowgirl Blowjob' },
  { type_id: 'tag/581/missionary-bj', type_name: 'Missionary BJ' },
  { type_id: 'tag/667/huge-tits', type_name: 'Huge Tits' },
  { type_id: 'tag/507/lesbian', type_name: 'Lesbian' },
  { type_id: 'tag/20/bikini', type_name: 'Bikini' },
  { type_id: 'tag/341/shower', type_name: 'Shower' },
  { type_id: 'tag/47/t-shirt', type_name: 'T-Shirt' },
  { type_id: 'tag/587/reverse-cowgirl-bj', type_name: 'Reverse Cowgirl BJ' },
  { type_id: 'tag/70/pussy-creampie', type_name: 'Pussy Creampie' },
  { type_id: 'tag/103/asian', type_name: 'Asian' },
  { type_id: 'tag/21/blouse', type_name: 'Blouse' },
  { type_id: 'tag/106/british', type_name: 'British' },
  { type_id: 'tag/208/handjob-pov', type_name: 'Handjob - POV' },
  { type_id: 'tag/623/vibrator', type_name: 'Vibrator' },
  { type_id: 'tag/644/black-stockings', type_name: 'Black Stockings' },
  { type_id: 'tag/559/cowgirl-pov', type_name: 'Cowgirl - POV' },
  { type_id: 'tag/592/side-fuck-bj', type_name: 'Side Fuck BJ' },
  { type_id: 'tag/633/boyfriends', type_name: 'Boyfriends' },
  { type_id: 'tag/30/jeans', type_name: 'Jeans' },
  { type_id: 'tag/579/missionary-pov', type_name: 'Missionary - POV' },
  { type_id: 'tag/211/massage', type_name: 'Massage' },
  { type_id: 'tag/42/shorts', type_name: 'Shorts' },
  { type_id: 'tag/454/big-dick-worship', type_name: 'Big Dick Worship' },
  { type_id: 'tag/58/cum-on-ass', type_name: 'Cum On Ass' },
  { type_id: 'tag/209/kinky', type_name: 'Kinky' },
  { type_id: 'tag/604/anal-toys', type_name: 'Anal Toys' },
  { type_id: 'tag/328/office', type_name: 'Office' },
  { type_id: 'tag/553/ass-stacking', type_name: 'Ass Stacking' },
  { type_id: 'tag/181/stepmom', type_name: 'Stepmom' },
  { type_id: 'tag/409/husband', type_name: 'Husband' },
  { type_id: 'tag/468/compilation', type_name: 'Compilation' },
  { type_id: 'tag/544/average-dick', type_name: 'Average Dick' },
  { type_id: 'tag/225/washing', type_name: 'Washing' },
  { type_id: 'tag/648/nude-stockings', type_name: 'Nude Stockings' },
  { type_id: 'tag/377/latin', type_name: 'Latin' },
  { type_id: 'tag/224/voyeur', type_name: 'Voyeur' },
  { type_id: 'tag/540/boyshorts', type_name: 'Boyshorts' },
  { type_id: 'tag/473/double-penetration-dp', type_name: 'Double Penetration' },
  { type_id: 'tag/27/fishnet', type_name: 'Fishnet' },
  { type_id: 'tag/295/spitting', type_name: 'Spitting' },
  { type_id: 'tag/285/fisting', type_name: 'Fisting' },
  { type_id: 'tag/627/hairy-pussy', type_name: 'Hairy Pussy' },
  { type_id: 'tag/68/facial-pov', type_name: 'Facial - POV' },
  { type_id: 'tag/17/sun-glasses', type_name: 'Sun Glasses' },
  { type_id: 'tag/104/australian', type_name: 'Australian' },
  { type_id: 'tag/43/skirt', type_name: 'Skirt' },
  { type_id: 'tag/80/teen18', type_name: 'Teen 18+' },
  { type_id: 'tag/334/pool', type_name: 'Pool' },
  { type_id: 'tag/534/uniform', type_name: 'Uniform' },
  { type_id: 'tag/22/body-suit', type_name: 'Body Suit' },
  { type_id: 'tag/192/yoga', type_name: 'Yoga' },
  { type_id: 'tag/584/pussy-stacking', type_name: 'Pussy Stacking' },
  { type_id: 'tag/649/panty-hose', type_name: 'Panty Hose' },
  { type_id: 'tag/113/euro', type_name: 'Euro' },
  { type_id: 'tag/230/sandals', type_name: 'Sandals' },
  { type_id: 'tag/497/girlfriend', type_name: 'Girlfriend' },
  { type_id: 'tag/1415/outdoor-sex', type_name: 'Outdoor Sex' },
  { type_id: 'tag/518/rough-sex', type_name: 'Rough Sex' },
  { type_id: 'tag/280/blowjob-threeway', type_name: 'Blowjob - Threeway' },
  { type_id: 'tag/619/soap', type_name: 'Soap' },
  { type_id: 'tag/301/teddy', type_name: 'Teddy' },
  { type_id: 'tag/561/doggy-9', type_name: 'Doggy 9' },
  { type_id: 'tag/384/long', type_name: 'Long' },
  { type_id: 'tag/200/cleaning', type_name: 'Cleaning' },
  { type_id: 'tag/60/cum-on-pussy', type_name: 'Cum on Pussy' },
  { type_id: 'tag/198/bondage', type_name: 'Bondage' },
  { type_id: 'tag/621/strap-on', type_name: 'Strap-on' },
  { type_id: 'tag/180/stepdaughter', type_name: 'Stepdaughter' },
  { type_id: 'tag/67/facial-multiple', type_name: 'Facial - Multiple' },
  { type_id: 'tag/310/car', type_name: 'Car' },
  { type_id: 'tag/647/fishnet-stockings', type_name: 'Fishnet Stockings' },
  { type_id: 'tag/226/water', type_name: 'Water' },
  { type_id: 'tag/81/woman-20-29', type_name: 'Woman (20-29)' },
  { type_id: 'tag/5/foursome', type_name: 'Foursome' },
  { type_id: 'tag/287/gaping', type_name: 'Gaping' },
  { type_id: 'tag/110/cuban', type_name: 'Cuban' },
  { type_id: 'tag/205/glory-hole', type_name: 'Gloryhole' },
  { type_id: 'tag/414/married', type_name: 'Married' },
  { type_id: 'tag/53/anal-creampie', type_name: 'Anal Creampie' },
  { type_id: 'tag/511/parody', type_name: 'Parody' },
  { type_id: 'tag/119/italian', type_name: 'Italian' },
  { type_id: 'tag/610/food', type_name: 'Food' },
  { type_id: 'tag/415/masseur', type_name: 'Masseur' },
  { type_id: 'tag/305/bathtub', type_name: 'Bathtub' },
  { type_id: 'tag/33/latex', type_name: 'Latex' },
  { type_id: 'tag/316/gym', type_name: 'Gym' },
  { type_id: 'tag/476/femdom', type_name: 'Femdom' },
  { type_id: 'tag/651/3-part-series', type_name: '3 Part Series' },
  { type_id: 'tag/472/doctornurse', type_name: 'Doctor/Nurse' },
  { type_id: 'tag/552/arch', type_name: 'Arch' },
  { type_id: 'tag/300/slip', type_name: 'Slip' },
  { type_id: 'tag/439/stepson', type_name: 'Stepson' },
  { type_id: 'tag/349/18-24', type_name: '18-24' },
  { type_id: 'tag/298/corset', type_name: 'Corset' },
  { type_id: 'tag/318/hotel-room', type_name: 'Hotel Room' },
  { type_id: 'tag/1/one-on-one', type_name: 'One-on-One' },
  { type_id: 'tag/606/blindfold', type_name: 'Blindfold' },
  { type_id: 'tag/34/leather', type_name: 'Leather' },
  { type_id: 'tag/7751/employee', type_name: 'Employee' },
  { type_id: 'tag/650/2-part-series', type_name: '2 Part Series' },
  { type_id: 'tag/71/swallow', type_name: 'Swallow' },
  { type_id: 'tag/114/french', type_name: 'French' },
  { type_id: 'tag/652/4-part-series', type_name: '4 Part Series' },
  { type_id: 'tag/93/curvy-woman', type_name: 'Curvy Woman' },
  { type_id: 'tag/8/orgy', type_name: 'Orgy' },
  { type_id: 'tag/519/school-fantasies', type_name: 'School Fantasies' },
  { type_id: 'tag/132/boss', type_name: 'Boss' },
  { type_id: 'tag/109/colombian', type_name: 'Colombian' },
  { type_id: 'tag/332/party', type_name: 'Party' },
  { type_id: 'tag/461/brazzers-debut', type_name: 'Brazzers Debut' },
  { type_id: 'tag/3/couples', type_name: 'Couples' },
  { type_id: 'tag/6/gangbang', type_name: 'Gangbang' },
  { type_id: 'tag/7/group-sex', type_name: 'Group Sex' },
  { type_id: 'tag/10/solo', type_name: 'Solo' },
  { type_id: 'tag/12/cap', type_name: 'Cap' },
  { type_id: 'tag/13/cowboy-hat', type_name: 'Cowboy Hat' },
  { type_id: 'tag/14/fedora', type_name: 'Fedora' },
  { type_id: 'tag/18/sun-hat', type_name: 'Sun Hat' },
  { type_id: 'tag/26/dress-socks', type_name: 'Dress Socks' },
  { type_id: 'tag/36/leg-warmers', type_name: 'Leg Warmers' },
  { type_id: 'tag/39/pyjamas', type_name: 'Pyjamas' },
  { type_id: 'tag/48/underwear', type_name: 'Underwear' },
  { type_id: 'tag/54/bukkake', type_name: 'Bukkake' },
  { type_id: 'tag/59/cum-on-feet', type_name: 'Cum On Feet' },
  { type_id: 'tag/64/cumshot-on-tits-multiple', type_name: 'Cumshot on Tits - Multiple' },
  { type_id: 'tag/124/russian', type_name: 'Russian' },
  { type_id: 'tag/78/mature', type_name: 'Mature' },
  { type_id: 'tag/92/bbw', type_name: 'BBW' },
  { type_id: 'tag/94/muscular', type_name: 'Muscular' },
  { type_id: 'tag/96/skinny', type_name: 'Skinny' },
  { type_id: 'tag/97/tall', type_name: 'Tall' },
  { type_id: 'tag/101/arab', type_name: 'Arab' },
  { type_id: 'tag/102/argentinian', type_name: 'Argentinian' },
  { type_id: 'tag/105/brazilian', type_name: 'Brazilian' },
  { type_id: 'tag/108/chinese', type_name: 'Chinese' },
  { type_id: 'tag/111/czech', type_name: 'Czech' },
  { type_id: 'tag/115/french-canadian', type_name: 'French Canadian' },
  { type_id: 'tag/116/german', type_name: 'German' },
  { type_id: 'tag/117/hungarian', type_name: 'Hungarian' },
  { type_id: 'tag/118/indian', type_name: 'Indian' },
  { type_id: 'tag/120/japanese', type_name: 'Japanese' },
  { type_id: 'tag/122/native', type_name: 'Native' },
  { type_id: 'tag/123/persian', type_name: 'Persian' },
  { type_id: 'tag/130/army', type_name: 'Army' },
  { type_id: 'tag/131/babysitter', type_name: 'Babysitter' },
  { type_id: 'tag/133/burglar', type_name: 'Burglar' },
  { type_id: 'tag/134/business-woman', type_name: 'Business Woman' },
  { type_id: 'tag/135/cheerleader', type_name: 'Cheerleader' },
  { type_id: 'tag/136/chef', type_name: 'Chef' },
  { type_id: 'tag/138/construction', type_name: 'Construction' },
  { type_id: 'tag/139/cop', type_name: 'Cop' },
  { type_id: 'tag/140/cougar', type_name: 'Cougar' },
  { type_id: 'tag/141/criminal', type_name: 'Criminal' },
  { type_id: 'tag/142/customer', type_name: 'Customer' },
  { type_id: 'tag/143/doctor', type_name: 'Doctor' },
  { type_id: 'tag/144/dominatrix', type_name: 'Dominatrix' },
  { type_id: 'tag/145/firefighter', type_name: 'Firefighter' },
  { type_id: 'tag/146/flight-attendant', type_name: 'Flight Attendant' },
  { type_id: 'tag/147/gangster', type_name: 'Gangster' },
  { type_id: 'tag/148/geek-nerd', type_name: 'Geek / Nerd' },
  { type_id: 'tag/154/lawyer', type_name: 'Lawyer' },
  { type_id: 'tag/155/lifeguard', type_name: 'Lifeguard' },
  { type_id: 'tag/156/maid', type_name: 'Maid' },
  { type_id: 'tag/158/masseuse', type_name: 'Masseuse' },
  { type_id: 'tag/159/mechanic', type_name: 'Mechanic' },
  { type_id: 'tag/160/military', type_name: 'Military' },
  { type_id: 'tag/162/mom', type_name: 'Mom' },
  { type_id: 'tag/163/nurse', type_name: 'Nurse' },
  { type_id: 'tag/165/plumber', type_name: 'Plumber' },
  { type_id: 'tag/424/police', type_name: 'Police' },
  { type_id: 'tag/427/principal', type_name: 'Principal' },
  { type_id: 'tag/168/prisoner', type_name: 'Prisoner' },
  { type_id: 'tag/173/school-girl', type_name: 'School Girl' },
  { type_id: 'tag/174/sci-fi', type_name: 'Sci-Fi' },
  { type_id: 'tag/175/secretary', type_name: 'Secretary' },
  { type_id: 'tag/176/sex-therapist', type_name: 'Sex Therapist' },
  { type_id: 'tag/177/slave', type_name: 'Slave' },
  { type_id: 'tag/178/soldier-girl', type_name: 'Soldier Girl' },
  { type_id: 'tag/179/special-agent', type_name: 'Special Agent' },
  { type_id: 'tag/182/stepsister', type_name: 'Stepsister' },
  { type_id: 'tag/183/store-clerk', type_name: 'Store Clerk' },
  { type_id: 'tag/184/stripper', type_name: 'Stripper' },
  { type_id: 'tag/185/swingers', type_name: 'Swingers' },
  { type_id: 'tag/186/teacher', type_name: 'Teacher' },
  { type_id: 'tag/187/teen18-role', type_name: 'Teen18+ Role' },
  { type_id: 'tag/188/therapist', type_name: 'Therapist' },
  { type_id: 'tag/190/waitress', type_name: 'Waitress' },
  { type_id: 'tag/194/fetishbdsm', type_name: 'Fetish/BDSM' },
  { type_id: 'tag/196/anal-winking', type_name: 'Anal Winking' },
  { type_id: 'tag/197/body-painting', type_name: 'Body Painting' },
  { type_id: 'tag/199/cfnm', type_name: 'CFNM' },
  { type_id: 'tag/201/domination', type_name: 'Domination' },
  { type_id: 'tag/214/piss', type_name: 'Piss' },
  { type_id: 'tag/216/shaving', type_name: 'Shaving' },
  { type_id: 'tag/218/smoking', type_name: 'Smoking' },
  { type_id: 'tag/221/strip-tease', type_name: 'Strip Tease' },
  { type_id: 'tag/222/sweat', type_name: 'Sweat' },
  { type_id: 'tag/241/crime', type_name: 'Crime' },
  { type_id: 'tag/249/game-show', type_name: 'Game-Show' },
  { type_id: 'tag/251/horror', type_name: 'Horror' },
  { type_id: 'tag/252/interview', type_name: 'Interview' },
  { type_id: 'tag/253/music', type_name: 'Music' },
  { type_id: 'tag/257/reality', type_name: 'Reality' },
  { type_id: 'tag/258/reality-tv', type_name: 'Reality-TV' },
  { type_id: 'tag/264/talk-show', type_name: 'Talk-Show' },
  { type_id: 'tag/272/anal-fisting', type_name: 'Anal Fisting' },
  { type_id: 'tag/273/anal-play', type_name: 'Anal Play' },
  { type_id: 'tag/276/autofellatio', type_name: 'Autofellatio' },
  { type_id: 'tag/302/alley', type_name: 'Alley' },
  { type_id: 'tag/303/bar', type_name: 'Bar' },
  { type_id: 'tag/306/beach', type_name: 'Beach' },
  { type_id: 'tag/308/boat', type_name: 'Boat' },
  { type_id: 'tag/309/camp', type_name: 'Camp' },
  { type_id: 'tag/311/classroom', type_name: 'Classroom' },
  { type_id: 'tag/312/college', type_name: 'College' },
  { type_id: 'tag/314/garage', type_name: 'Garage' },
  { type_id: 'tag/317/hospital', type_name: 'Hospital' },
  { type_id: 'tag/322/library', type_name: 'Library' },
  { type_id: 'tag/323/limo', type_name: 'Limo' },
  { type_id: 'tag/325/locker-room', type_name: 'Locker Room' },
  { type_id: 'tag/327/night-club', type_name: 'Night Club' },
  { type_id: 'tag/330/park', type_name: 'Park' },
  { type_id: 'tag/331/parking-lot', type_name: 'Parking Lot' },
  { type_id: 'tag/333/police-station', type_name: 'Police Station' },
  { type_id: 'tag/335/prison', type_name: 'Prison' },
  { type_id: 'tag/337/restaurant', type_name: 'Restaurant' },
  { type_id: 'tag/339/sauna', type_name: 'Sauna' },
  { type_id: 'tag/340/school', type_name: 'School' },
  { type_id: 'tag/344/store', type_name: 'Store' },
  { type_id: 'tag/345/strip-club', type_name: 'Strip Club' },
  { type_id: 'tag/347/theater', type_name: 'Theater' },
  { type_id: 'tag/348/wedding', type_name: 'Wedding' },
  { type_id: 'tag/352/old', type_name: 'Old' },
  { type_id: 'tag/364/male-to-female', type_name: 'Male to Female' },
  { type_id: 'tag/372/asian-man', type_name: 'Asian Man' },
  { type_id: 'tag/373/australian-man', type_name: 'Australian Man' },
  { type_id: 'tag/375/cuban-male', type_name: 'Cuban Male' },
  { type_id: 'tag/388/army-man', type_name: 'Army Man' },
  { type_id: 'tag/389/artist', type_name: 'Artist' },
  { type_id: 'tag/390/athletejock', type_name: 'Athlete/Jock' },
  { type_id: 'tag/391/bartender', type_name: 'Bartender' },
  { type_id: 'tag/392/male-boss', type_name: 'Male Boss' },
  { type_id: 'tag/393/male-burglar', type_name: 'Male Burglar' },
  { type_id: 'tag/394/businessman', type_name: 'Businessman' },
  { type_id: 'tag/395/male-chef', type_name: 'Male Chef' },
  { type_id: 'tag/396/coach', type_name: 'Coach' },
  { type_id: 'tag/398/male-cop', type_name: 'Male Cop' },
  { type_id: 'tag/399/cowboy', type_name: 'Cowboy' },
  { type_id: 'tag/400/male-criminal', type_name: 'Male Criminal' },
  { type_id: 'tag/401/daddydilf', type_name: 'Daddy/DILF' },
  { type_id: 'tag/402/delivery-guy', type_name: 'Delivery Guy' },
  { type_id: 'tag/403/detective', type_name: 'Detective' },
  { type_id: 'tag/404/male-doctor', type_name: 'Male Doctor' },
  { type_id: 'tag/405/male-firefighter', type_name: 'Male Firefighter' },
  { type_id: 'tag/406/male-gangster', type_name: 'Male Gangster' },
  { type_id: 'tag/407/gardener', type_name: 'Gardener' },
  { type_id: 'tag/408/handy-man', type_name: 'Handy Man' },
  { type_id: 'tag/410/janitor', type_name: 'Janitor' },
  { type_id: 'tag/411/male-judge', type_name: 'Male Judge' },
  { type_id: 'tag/412/male-lawyer', type_name: 'Male Lawyer' },
  { type_id: 'tag/413/male-lifeguard', type_name: 'Male Lifeguard' },
  { type_id: 'tag/416/male-mechanic', type_name: 'Male Mechanic' },
  { type_id: 'tag/417/military-man', type_name: 'Military Man' },
  { type_id: 'tag/418/nerd', type_name: 'Nerd' },
  { type_id: 'tag/419/pharmacist', type_name: 'Pharmacist' },
  { type_id: 'tag/420/photographer', type_name: 'Photographer' },
  { type_id: 'tag/421/pilot', type_name: 'Pilot' },
  { type_id: 'tag/423/male-plumber', type_name: 'Male Plumber' },
  { type_id: 'tag/425/pool-guy', type_name: 'Pool Guy' },
  { type_id: 'tag/428/male-prisoner', type_name: 'Male Prisoner' },
  { type_id: 'tag/429/professionalwhite-collar', type_name: 'Professional/White Collar' },
  { type_id: 'tag/432/security-guard', type_name: 'Security Guard' },
  { type_id: 'tag/434/skater', type_name: 'Skater' },
  { type_id: 'tag/435/soldier', type_name: 'Soldier' },
  { type_id: 'tag/437/step-brother', type_name: 'Step-brother' },
  { type_id: 'tag/438/stepdad', type_name: 'Stepdad' },
  { type_id: 'tag/440/storeclerk', type_name: 'Storeclerk' },
  { type_id: 'tag/442/student', type_name: 'Student' },
  { type_id: 'tag/443/male-teacher', type_name: 'Male Teacher' },
  { type_id: 'tag/445/waiter', type_name: 'Waiter' },
  { type_id: 'tag/447/amateur', type_name: 'Amateur' },
  { type_id: 'tag/453/behind-the-scenes', type_name: 'Behind The Scenes' },
  { type_id: 'tag/460/boob-play', type_name: 'Boob play' },
  { type_id: 'tag/462/brazzers-live', type_name: 'Brazzers Live' },
  { type_id: 'tag/465/caught', type_name: 'Caught' },
  { type_id: 'tag/467/classicvintage', type_name: 'classic/vintage' },
  { type_id: 'tag/469/cosplay', type_name: 'Cosplay' },
  { type_id: 'tag/471/cuckold', type_name: 'Cuckold' },
  { type_id: 'tag/475/fan-submitted', type_name: 'Fan Submitted' },
  { type_id: 'tag/477/first-anal', type_name: 'First Anal' },
  { type_id: 'tag/478/first-bg-on-zz', type_name: 'FIRST BG on ZZ' },
  { type_id: 'tag/479/manwoman', type_name: 'Man/Woman' },
  { type_id: 'tag/480/first-dp', type_name: 'First DP' },
  { type_id: 'tag/481/first-gangbang', type_name: 'First Gangbang' },
  { type_id: 'tag/484/first-scene-ever', type_name: 'First Scene Ever' },
  { type_id: 'tag/485/first-time-anal-on-zz', type_name: 'FIRST TIME ANAL on ZZ' },
  { type_id: 'tag/487/first-timers', type_name: 'First Timers' },
  { type_id: 'tag/488/first-zz-anal', type_name: 'FIRST ZZ ANAL' },
  { type_id: 'tag/490/first-zz-gangbang', type_name: 'FIRST ZZ GANGBANG' },
  { type_id: 'tag/492/football', type_name: 'Football' },
  { type_id: 'tag/493/fuck-my-wife', type_name: 'Fuck My Wife' },
  { type_id: 'tag/500/guy-fucks-trans', type_name: 'Guy fucks Trans' },
  { type_id: 'tag/504/international', type_name: 'International' },
  { type_id: 'tag/512/pov', type_name: 'POV' },
  { type_id: 'tag/514/public-sex', type_name: 'Public Sex' },
  { type_id: 'tag/516/reality-porn', type_name: 'Reality Porn' },
  { type_id: 'tag/517/role-play', type_name: 'Role Play' },
  { type_id: 'tag/521/series', type_name: 'Series' },
  { type_id: 'tag/1451/trans', type_name: 'Trans' },
  { type_id: 'tag/525/trans-fucks-female', type_name: 'Trans fucks female' },
  { type_id: 'tag/529/sports', type_name: 'Sports' },
  { type_id: 'tag/537/wife-swap', type_name: 'Wife Swap' },
  { type_id: 'tag/541/briefs', type_name: 'Briefs' },
  { type_id: 'tag/555/blow-bang', type_name: 'Blow Bang' },
  { type_id: 'tag/556/bridge', type_name: 'Bridge' },
  { type_id: 'tag/565/doggystyle-reverse', type_name: 'Doggystyle - Reverse' },
  { type_id: 'tag/568/double-anal', type_name: 'Double Anal' },
  { type_id: 'tag/569/double-anal-bj', type_name: 'Double Anal BJ' },
  { type_id: 'tag/571/double-vaginal', type_name: 'Double Vaginal' },
  { type_id: 'tag/572/double-vaginal-bj', type_name: 'Double Vaginal BJ' },
  { type_id: 'tag/573/dp-standing', type_name: 'DP - Standing' },
  { type_id: 'tag/574/dp-bj', type_name: 'DP BJ' },
  { type_id: 'tag/577/keirans-cowboy', type_name: 'Keiran\'s Cowboy' },
  { type_id: 'tag/580/missionary-reverse', type_name: 'Missionary - Reverse' },
  { type_id: 'tag/582/pile-driver-pov', type_name: 'Pile Driver - POV' },
  { type_id: 'tag/588/reverse-piledriver', type_name: 'Reverse Piledriver' },
  { type_id: 'tag/591/side-fuck-pov', type_name: 'Side Fuck - POV' },
  { type_id: 'tag/594/side-rider-bj', type_name: 'Side Rider BJ' },
  { type_id: 'tag/595/slow-dance', type_name: 'Slow Dance' },
  { type_id: 'tag/597/spoon-bj', type_name: 'Spoon BJ' },
  { type_id: 'tag/600/standing-69', type_name: 'Standing 69' },
  { type_id: 'tag/601/super-woman', type_name: 'Super Woman' },
  { type_id: 'tag/602/tribbing', type_name: 'Tribbing' },
  { type_id: 'tag/603/anal-beads', type_name: 'Anal Beads' },
  { type_id: 'tag/605/ball-gag', type_name: 'Ball Gag' },
  { type_id: 'tag/612/handcuffs', type_name: 'Handcuffs' },
  { type_id: 'tag/614/masks', type_name: 'Masks' },
  { type_id: 'tag/618/ski-mask', type_name: 'Ski Mask' },
  { type_id: 'tag/622/sybian', type_name: 'Sybian' },
  { type_id: 'tag/625/whip', type_name: 'Whip' },
  { type_id: 'tag/629/cameltoe', type_name: 'Cameltoe' },
  { type_id: 'tag/645/body-stockings', type_name: 'Body Stockings' },
  { type_id: 'tag/646/colored-stockings', type_name: 'Colored Stockings' },
  { type_id: 'tag/653/christmas', type_name: 'Christmas' },
  { type_id: 'tag/657/halloween', type_name: 'Halloween' },
  { type_id: 'tag/658/independence-day', type_name: 'Independence Day' },
  { type_id: 'tag/659/new-years', type_name: 'New Years' },
  { type_id: 'tag/660/spanish', type_name: 'Spanish' },
  { type_id: 'tag/661/st-patricks-day', type_name: 'St Patricks Day' },
  { type_id: 'tag/663/thanksgiving', type_name: 'Thanksgiving' },
  { type_id: 'tag/664/valentines-day', type_name: 'Valentines Day' },
  { type_id: 'tag/670/big-boobs-implants', type_name: 'Big Boobs (Implants)' },
  { type_id: 'tag/674/puffy-nipples', type_name: 'Puffy Nipples' },
  { type_id: 'tag/684/ahegao', type_name: 'Ahegao' },
  { type_id: 'tag/685/futanari', type_name: 'Futanari' },
  { type_id: 'tag/703/tenants', type_name: 'Tenants' },
  { type_id: 'tag/704/female-orgasm', type_name: 'Female Orgasm' },
  { type_id: 'tag/705/gilf', type_name: 'GILF' },
  { type_id: 'tag/706/blowbang', type_name: 'Blowbang' },
  { type_id: 'tag/709/condom', type_name: 'Condom' },
  { type_id: 'tag/800/first-manwoman', type_name: 'First Man/Woman' },
  { type_id: 'tag/1413/public-flashing', type_name: 'Public Flashing' },
  { type_id: 'tag/1419/black-friday', type_name: 'Black Friday' },
  { type_id: 'tag/1469/trans-man', type_name: 'Trans Man' },
  { type_id: 'tag/1581/playground-hills', type_name: 'Playground Hills' },
  { type_id: 'tag/1701/transzz', type_name: 'TransZZ' },
  { type_id: 'tag/1861/vr', type_name: 'VR' },
  { type_id: 'tag/7681/gamer-girl', type_name: 'Gamer Girl' },
  { type_id: 'tag/7701/video-games', type_name: 'Video Games' },
  { type_id: 'tag/7711/gamer', type_name: 'Gamer' },
  { type_id: 'tag/7721/e-girls', type_name: 'E Girls' },
  { type_id: 'tag/7731/girl-gamer', type_name: 'Girl Gamer' },
  { type_id: 'tag/7761/librarian', type_name: 'Librarian' },
  { type_id: 'tag/7781/reporter', type_name: 'Reporter' },
  { type_id: 'tag/7791/streamer', type_name: 'Streamer' },
  { type_id: 'tag/7811/tech-support', type_name: 'Tech Support' },
  { type_id: 'tag/7821/realtor', type_name: 'Realtor' },
  { type_id: 'tag/7831/food-truck', type_name: 'Food Truck' },
  { type_id: 'tag/7841/work-from-home', type_name: 'Work From Home' },
  { type_id: 'tag/7871/interactive-porn', type_name: 'Interactive Porn' },
  { type_id: 'tag/7881/interactive', type_name: 'Interactive' },
  { type_id: 'tag/8201/audio', type_name: 'Audio' },
  { type_id: 'tag/8721/joi', type_name: 'JOI' },
  { type_id: 'tag/8791/dirty-talk', type_name: 'Dirty-Talk' },
  { type_id: 'tag/9051/mixed', type_name: 'Mixed' },
  { type_id: 'tag/9061/moms', type_name: 'Moms' },
  { type_id: 'tag/9071/step-fantasy', type_name: 'Step Fantasy' },
  { type_id: 'tag/9081/pinay', type_name: 'Pinay' },
  { type_id: 'tag/9141/closed-captioned', type_name: 'Closed-Captioned' },
  { type_id: 'tag/9161/first-blowbang', type_name: 'First Blowbang' },
  { type_id: 'tag/9311/south-asian', type_name: 'South Asian' },
  { type_id: 'tag/9361/bbq', type_name: 'BBQ' },
  { type_id: 'tag/9791/taboo', type_name: 'Taboo' },
  { type_id: 'tag/9821/pussy-to-mouth', type_name: 'Pussy To Mouth' },
  { type_id: 'tag/9841/facial-hair', type_name: 'Facial Hair' },
  { type_id: 'tag/9851/courthouse', type_name: 'Courthouse' },
  { type_id: 'tag/10163/barbershop', type_name: 'Barbershop' },
  { type_id: 'tag/10167/podcast', type_name: 'Podcast' },
];

function t(v) {
  return String(v == null ? '' : v).trim();
}

function clean(s) {
  return t(s).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/\s+/g, ' ');
}

function stripTags(s) {
  return clean(String(s || '').replace(/<[^>]+>/g, ' '));
}

// 带超时的原生 fetch 取文本 (req 兜底通道)
async function timedFetchText(url, headers, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) return '';
    return await r.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(to);
  }
}

// 取页面 HTML: 框架 req 优先，fetch 兜底 (统一带浏览器 UA，brazzpw 侧 CF 按签名拦 bot UA)
async function getHtml(url, timeoutMs) {
  const headers = { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  try {
    const { data, status } = await req.get(url, { headers, timeout: timeoutMs || 15000 });
    if (status === 200 && typeof data === 'string' && data) return data;
  } catch (e) { /* 换 fetch */ }
  return timedFetchText(url, headers, timeoutMs || 15000);
}

// 列表基址 (不含域名与页码)
function listPath(tid) {
  if (tid === 'latest') return 'videos';
  if (tid.startsWith('sort/')) return 'videos/sortby/' + tid.slice(5);
  if (tid.startsWith('site/')) return 'videos/' + tid;
  if (tid.startsWith('tag/')) return 'videos/tags/' + tid.slice(4);
  return 'videos';
}

function listUrl(tid, page) {
  page = Math.max(1, page || 1);
  const base = SITE + '/' + listPath(tid);
  return page > 1 ? `${base}/page/${page}${SUFFIX}` : `${base}${SUFFIX}`;
}

// 解析列表卡片 (首页/分类/搜索通用: article.loop-video)
function parseCards(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split('<article');
  for (let i = 1; i < blocks.length; i++) {
    const win = blocks[i].slice(0, 3000);
    const am = win.match(/href="(https:\/\/brazz\.org\/video\/(\d+)\/[^"]*)"\s+title="([^"]*)"/);
    if (!am) continue;
    const durl = am[1];
    if (seen.has(durl)) continue;
    seen.add(durl);
    let pic = '';
    const pm = win.match(/<img[^>]+data-src="([^"]+)"/) || win.match(/<img[^>]+src="(https:\/\/media-public[^"]+)"/);
    if (pm) pic = pm[1];
    let remarks = '';
    const dm = win.match(/class="duration">(?:<[^>]+>)*\s*([\d:]+)/);
    if (dm) remarks = dm[1];
    out.push({ vod_id: durl, vod_name: clean(am[3]) || am[2], vod_pic: pic, vod_remarks: remarks });
  }
  return out;
}

// 从分页链接取总页数 (只认分页块内、当前列表基址下的 /page/N/；
// 不能扫全页——越界页的 canonical/og:url 也含 /page/N/ 会冒充总页数)
function parsePagecount(html, tid) {
  const s = String(html || '');
  const base = '/' + listPath(tid) + '/';
  const re = new RegExp(base.replace(/\//g, '\\/') + 'page\\/(\\d+)\\/', 'g');
  let max = 1;
  for (const blk of s.matchAll(/class="pagination">([\s\S]*?)<\/ul>/g)) {
    for (const m of blk[1].matchAll(re)) {
      const n = parseInt(m[1], 10);
      if (n > max && n < 100000) max = n;
    }
  }
  return max;
}

async function init(reqIn) {
  return {};
}

async function home(reqIn) {
  const cls = CATS.map(c => ({ type_id: c.type_id, type_name: c.type_name }));
  const html = await getHtml(listUrl('latest', 1));
  const list = html ? parseCards(html) : [];
  return { class: cls, list };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = t(body.tid || body.id) || 'latest';
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const html = await getHtml(listUrl(tid, page));
  if (!html) return { page, pagecount: page, limit: 20, total: 0, list: [] };
  const pc = parsePagecount(html, tid);
  if (page > 1) {
    // 越界页守卫: 单页列表请求 page>=2 时站方会原样重发第 1 页内容且不带分页块，
    // 不拦会无限重复加载更多；多页列表的真实页必带本列表的 /page/N/ 链接 (pc>=2)。
    if (pc <= 1) return { page, pagecount: 1, limit: 20, total: 0, list: [] };
    // 分页块标记的当前页小于请求页，同样是越界重发
    const cur = html.match(/<a[^>]+href="[^"]*\/page\/(\d+)\/[^"]*"[^>]*class="current"/);
    if (cur && parseInt(cur[1], 10) < page) return { page, pagecount: pc, limit: 20, total: 0, list: [] };
  }
  const list = parseCards(html);
  return { page, pagecount: Math.max(pc, page), limit: 20, total: list.length, list };
}

async function detail(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { list: [] };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const durl = /^https?:\/\//.test(id) ? id : SITE + '/video/' + id.replace(/^\//, '');
  const html = await getHtml(durl);
  if (!html) return { list: [] };

  let name = '';
  const nm = html.match(/property="og:title"\s+content="([^"]*)"/);
  if (nm) name = clean(nm[1]).replace(/^Brazz\.Org\s*-\s*/i, '');
  let pic = '';
  const pm = html.match(/property="og:image"\s+content="([^"]*)"/);
  if (pm) pic = pm[1];
  let content = '';
  const cm = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
  if (cm) content = clean(cm[1]);
  // 演员: /videos/models/{id}/{slug}/ 链接 (去重，排除 "Show more" 类)
  const actors = [];
  const seenA = new Set();
  const castRegion = html.split('<div class="tags">')[0];
  for (const m of castRegion.matchAll(/href="https:\/\/brazz\.org\/videos\/models\/\d+\/[^"]*"[^>]*>([^<]+)<\/a>/g)) {
    const a = clean(m[1]);
    if (a && !seenA.has(a) && !/show more/i.test(a)) { seenA.add(a); actors.push(a); }
  }
  // 标签: 只取 .tags-list 区内的链接 title
  let vodClass = '';
  const tm = html.match(/<div class="tags-list">([\s\S]*?)<\/div>/);
  if (tm) {
    const tags = [...tm[1].matchAll(/\/videos\/tags\/\d+\/[^"]*"\s+class="label"\s+title="([^"]*)"/g)].map(x => clean(x[1]));
    vodClass = [...new Set(tags)].join(',');
  }

  const vod = {
      vod_id: durl,
      vod_name: name || durl,
      vod_pic: pic,
      vod_remarks: '',
      vod_actor: actors.join(' '),
      vod_class: vodClass,
      vod_content: content || name,
      vod_play_from: NAME,
      vod_play_url: `正片$${durl}`,
  };
  subRegister(body.id, vod);
  return { list: [vod] };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  let id = t(body.id);
  if (!id) return { parse: 0, url: '' };
  if (id.includes('$')) id = id.split('$').pop().trim();
  const subsP = subSearchAll(subNormKey(id)).catch(() => []);
  const durl = /^https?:\/\//.test(id) ? id : SITE + '/video/' + id.replace(/^\//, '');
  const vidm = durl.match(/\/video\/(\d+)\//);
  const vid = vidm ? vidm[1] : '';
  const fallbackHeaders = { 'User-Agent': UA, 'Referer': durl };

  const html = await getHtml(durl, 12000);
  let playerUrl = '';
  if (html) {
    const im = html.match(/<iframe[^>]+src="(https:\/\/brazzpw\.xyz\/player\/\?[^"]+)"/);
    if (im) playerUrl = im[1].replace(/&amp;/g, '&');
  }
  if (playerUrl) {
    const phtml = await getHtml(playerUrl, 12000);
    if (phtml) {
      const sm = phtml.match(/player\.src\(\{[^}]*?src:\s*"([^"]+)"/) || phtml.match(/src:\s*"(m3u8_[^"]+)"/);
      if (sm) {
        try {
          const m3u8 = new URL(sm[1], playerUrl).href;
          return subAttach({ parse: 0, url: m3u8, header: fallbackHeaders }, subsP);
        } catch (e) { /* 落兜底 */ }
      }
    }
  }
  // 兜底1: hash 值不校验，凭视频 id 直接构造播放列表地址 (实测 hash=1 可出全量列表)
  if (vid) {
    return subAttach({ parse: 0, url: `${PLAYER_HOST}/player/m3u8_${vid}.m3u8?hash=1`, header: fallbackHeaders }, subsP);
  }
  // 兜底2: 嗅探播放器页/详情页
  return subAttach({ parse: 1, jx: 0, url: playerUrl || durl, header: fallbackHeaders }, subsP);
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = t(body.wd);
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: 1, limit: 40, total: 0, list: [] };
  if (page > 1) return { page, pagecount: 1, limit: 40, total: 0, list: [] };
  const url = `${SITE}/search${SUFFIX}?s=${encodeURIComponent(wd)}`;
  const html = await getHtml(url);
  if (!html) return { page, pagecount: 1, limit: 40, total: 0, list: [] };
  const list = parseCards(html);
  return { page, pagecount: 1, limit: 40, total: list.length, list };
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
