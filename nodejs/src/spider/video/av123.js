import req from '../../util/req.js';

const KEY = 'py_av123';
const NAME = '123AV';
const HOST = 'https://123av.com';
const LANG = 'cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const PAGE_SIZE = 20;

function t(v) {
  return String(v == null ? '' : v).trim();
}

function headers() {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': HOST + '/' + LANG + '/',
  };
}

async function fetchHtml(path) {
  const url = path.startsWith('http') ? path : HOST + path;
  const { data } = await req.get(url, { headers: headers(), timeout: 20000 });
  return String(data || '');
}

function cfBlocked(html) {
  return html.indexOf('Just a moment') >= 0 || html.indexOf('cf-browser-verification') >= 0;
}

function hiResCover(url) {
  url = t(url);
  if (!url) return '';
  return url.replace(/\/s360\//, '/s1080/');
}

// 从 REX parseList 移植：card__link + 标题，往前找 card__img 封面，card__dur 时长
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
    const im = chunk.match(
      /class="card__img"[^>]+src="([^"]+)"|src="([^"]+)"[^>]+class="card__img"/
    );
    if (im) pic = im[1] || im[2] || '';
    if (!pic) {
      const im2 = chunk.match(
        /(?:src|data-src)="(https?:\/\/[^"]+\/(?:s360|s500|s1080)\/[^"]+)"/i
      );
      if (im2) pic = im2[1];
    }
    const dm = chunk.match(/class="card__dur"[^>]*>([^<]+)</);
    if (dm) dur = t(dm[1]);

    items.push({
      vod_id: 'javxx:' + link,
      vod_name: title,
      vod_pic: hiResCover(pic),
      vod_remarks: dur,
    });
  }

  // 兜底：只有封面链接
  if (!items.length) {
    const re2 = /href="(\/(?:cn|en)\/v\/[^"]+)"[\s\S]{0,400}?class="card__img"[^>]+src="([^"]+)"/gi;
    while ((m = re2.exec(html))) {
      if (seen[m[1]]) continue;
      seen[m[1]] = 1;
      items.push({
        vod_id: 'javxx:' + m[1],
        vod_name: m[1].split('/').pop(),
        vod_pic: hiResCover(m[2]),
        vod_remarks: '',
      });
    }
  }
  // 再兜底：card__cover href
  if (!items.length) {
    const re3 = /class="card__cover"[^>]*href="(\/(?:cn|en)\/v\/[^"]+)"[\s\S]{0,500}?class="card__img"[^>]+src="([^"]+)"/gi;
    while ((m = re3.exec(html))) {
      if (seen[m[1]]) continue;
      seen[m[1]] = 1;
      items.push({
        vod_id: 'javxx:' + m[1],
        vod_name: m[1].split('/').pop(),
        vod_pic: hiResCover(m[2]),
        vod_remarks: '',
      });
    }
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

function playHeadersForEmbed(embedUrl) {
  embedUrl = t(embedUrl);
  let origin = 'https://jav-master-52.site';
  const m = embedUrl.match(/^(https?:\/\/[^/]+)/);
  if (m) origin = m[1];
  return {
    'User-Agent': UA,
    'Referer': origin + '/',
    'Origin': origin,
    'Accept': '*/*',
  };
}

async function resolveStream(embedUrl) {
  embedUrl = t(embedUrl);
  if (!embedUrl) return '';
  const idm = embedUrl.match(/\/e\/([A-Za-z0-9]+)/);
  if (!idm) return '';
  const eid = idm[1];
  const originM = embedUrl.match(/^(https?:\/\/[^/]+)/);
  const origin = originM ? originM[1] : '';
  const streamApi = origin + '/stream?id=' + encodeURIComponent(eid);
  try {
    const { data } = await req.get(streamApi, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': embedUrl,
        'Origin': origin,
      },
      timeout: 20000,
    });
    let body = data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return '';
      }
    }
    return t((body && body.media && body.media.stream) || (body && body.stream) || '');
  } catch (e) {
    return '';
  }
}

function parsePath(vodId) {
  let link = t(vodId);
  if (link.indexOf('javxx:') === 0) link = link.slice(6);
  if (link.indexOf('http') === 0) {
    const m = link.match(/https?:\/\/[^/]+(\/.*)/);
    if (m) link = m[1];
  }
  return link;
}

async function init() {
  return {};
}

async function home() {
  return {
    class: [
      { type_id: 'new', type_name: '新发布' },
      { type_id: 'hot', type_name: '热门' },
      { type_id: 'recent', type_name: '最近更新' },
      { type_id: 'censored', type_name: '有码' },
      { type_id: 'uncensored', type_name: '无码' },
      { type_id: 'uncensored-leaked', type_name: '无码泄露' },
      { type_id: 'genres/big-tits', type_name: '巨乳' },
      { type_id: 'genres/big-ass', type_name: '大屁股' },
      { type_id: 'genres', type_name: '类别' },
      { type_id: 'actresses', type_name: '女演员' },
      { type_id: 'makers', type_name: '制作商' },
      { type_id: 'series', type_name: '系列' },
    ],
    filters: {
    genres: [
      { key: 'sub', name: '题材', value: [
        { n: 'Solowork', v: 'genres/solowork' },
        { n: '中出', v: 'genres/creampie' },
        { n: '巨乳', v: 'genres/big-tits' },
        { n: '已婚女性/家庭主妇', v: 'genres/married-womanhousewife' },
        { n: '业余', v: 'genres/amateur' },
        { n: '高视力', v: 'genres/high-vision' },
        { n: '口交', v: 'genres/e22f5b4c15' },
        { n: '美丽的女孩', v: 'genres/beautiful-girl' },
        { n: '美丽的乳房', v: 'genres/beautiful-breasts' },
        { n: '苗条', v: 'genres/slender' },
        { n: '哈梅哈', v: 'genres/gonzo' },
        { n: '荡妇', v: 'genres/slut' },
        { n: '3P/4P', v: 'genres/threesome-foursome' },
        { n: '喷出', v: 'genres/squirting' },
        { n: '数字的', v: 'genres/digimo' },
        { n: '乌龟, 乌龟, Ntr', v: 'genres/cuckold-cuckolded-ntr' },
        { n: '独家的', v: 'genres/exclusive' },
        { n: '4小时或以上', v: 'genres/over-4-hours' },
        { n: '乳交', v: 'genres/paizuri' },
        { n: '女牛仔', v: 'genres/cowgirl' },
        { n: '竞技游泳/学校泳衣', v: 'genres/competitive-swimmingschool-swimwear' },
        { n: '淫秽/硬核', v: 'genres/lewdhard' },
        { n: '面部的', v: 'genres/facial' },
        { n: '排盘', v: 'genres/shaved-pussy' },
        { n: '戏剧', v: 'genres/drama' },
        { n: '女学生', v: 'genres/schoolgirl' },
        { n: '姐姐', v: 'genres/older-sister' },
        { n: '手淫', v: 'genres/handjob' },
        { n: '大屁股', v: 'genres/big-ass' },
        { n: '规划', v: 'genres/planning' },
        { n: '手淫', v: 'genres/masturbation' },
        { n: '事务', v: 'genres/adultery' },
        { n: '妄想集团', v: 'genres/mousozoku' },
        { n: '捡起', v: 'genres/nampa' },
        { n: '舔阴', v: 'genres/cunnilingus' },
        { n: '记录', v: 'genres/documentary' },
        { n: '乱伦', v: 'genres/incest' },
        { n: '角色扮演', v: 'genres/7889ef8307' },
        { n: '屈辱', v: 'genres/humiliation' },
        { n: '无套', v: 'genres/bareback' },
        { n: '玩具', v: 'genres/sex-toys' },
        { n: '大学女生', v: 'genres/female-college-student' },
        { n: '伊拉马乔', v: 'genres/deep-throat' },
        { n: '美丽的臀部', v: 'genres/beautiful-buttocks' },
        { n: '奥尔', v: 'genres/ol' },
        { n: '加尔', v: 'genres/gal' },
        { n: '制服', v: 'genres/uniform' },
        { n: '狂欢', v: 'genres/orgy' },
        { n: '偷窥癖', v: 'genres/voyeurismpeeping' },
        { n: '耻辱', v: 'genres/shame' },
        { n: '其他恋物癖', v: 'genres/other-fetishes' },
        { n: '吻', v: 'genres/kisskiss' },
        { n: '肛门', v: 'genres/anal' },
        { n: '处女作', v: 'genres/debut-work' },
        { n: '屁股恋物癖', v: 'genres/butt-fetish' },
        { n: '偶像和名人', v: 'genres/idolcelebrity' },
        { n: '美丽的双腿', v: 'genres/beautiful-legs' },
        { n: '脏话', v: 'genres/dirty-talk' },
        { n: '克制', v: 'genres/restraint' },
        { n: '最佳/合辑', v: 'genres/bestcompilation' },
        { n: '极致高潮', v: 'genres/acme-orgasm' },
        { n: '小乳房', v: 'genres/small-breaststiny-breasts' },
        { n: '吞', v: 'genres/gulp' },
        { n: '乳液/油', v: 'genres/lotion' },
        { n: '颜射', v: 'genres/bukkake' },
        { n: '母亲', v: 'genres/mother' },
        { n: '女主人, 妓女', v: 'genres/club-hostess-sex-worker' },
        { n: '电动按摩器', v: 'genres/electric-machine' },
        { n: '按摩和茶点', v: 'genres/massage-reflex' },
        { n: '主观', v: 'genres/subjectivity' },
        { n: '氛围', v: 'genres/vibrator' },
        { n: '吉里莫扎', v: 'genres/minimal-mosaic' },
        { n: '色情明星', v: 'genres/pornstar' },
        { n: '指法', v: 'genres/finger-fuck' },
        { n: '后退', v: 'genres/back' },
        { n: '连裤袜和紧身裤', v: 'genres/pantyhosetights' },
        { n: '女同性恋', v: 'genres/f0f0e4571c' },
        { n: '钐', v: 'genres/sm' },
        { n: '姐姐', v: 'genres/older-sisteryounger-sister' },
        { n: '六九', v: 'genres/14bfa6bb14' },
        { n: '校服', v: 'genres/school-uniform' },
        { n: '束缚', v: 'genres/bondage' },
        { n: '各种职业', v: 'genres/various-occupations' },
        { n: '波恰里', v: 'genres/chubby' },
        { n: '女教师', v: 'genres/female-teacher' },
        { n: '撒尿/撒尿', v: 'genres/urinationwetting' },
        { n: '大鸡巴', v: 'genres/big-dickhuge-dick' },
        { n: '户外/暴露', v: 'genres/outdoorexposed' },
        { n: '年轻的妻子', v: 'genres/young-wifeyoung-wife' },
        { n: '美学', v: 'genres/beauty-salon' },
        { n: '泳衣', v: 'genres/swimsuit' },
        { n: '处女', v: 'genres/virginity' },
        { n: '高的', v: 'genres/tall' },
        { n: '口交射精', v: 'genres/mouth-cumshot' },
        { n: '白皙的皮肤', v: 'genres/fair-skin' },
        { n: '巨乳恋物癖', v: 'genres/big-breast-fetish' },
        { n: 'M-Man', v: 'genres/m-man' },
        { n: '仅限虚拟现实', v: 'genres/vr-only' },
        { n: '萝莉/童趣外貌', v: 'genres/lolichildlike-look' },
        { n: '出汗', v: 'genres/sweaty' },
        { n: '温泉', v: 'genres/hot-spring' },
        { n: '美女/漂亮女人', v: 'genres/beautybeautiful-woman' },
        { n: '护士', v: 'genres/nursenurse' },
        { n: '图片视频', v: 'genres/image-video' },
        { n: '可爱的', v: 'genres/cute-1' },
        { n: '残忍的', v: 'genres/devil' },
        { n: '年龄段（30岁/40岁/等等）', v: 'genres/age-bracket-30s40setc' },
        { n: '内衣', v: 'genres/lingerie' },
        { n: 'Panchira', v: 'genres/panty-shots' },
        { n: 'Vr', v: 'genres/vr' },
        { n: 'M女人', v: 'genres/m-woman' },
        { n: '恋腿癖', v: 'genres/foot-fetish' },
        { n: '娇小', v: 'genres/petite' },
        { n: '整洁的', v: 'genres/neat' },
        { n: '日式服装/浴衣', v: 'genres/kimono' },
        { n: '小型的', v: 'genres/mini-series' },
        { n: '伊曼纽尔', v: 'genres/emmanuelle' },
        { n: '拖', v: 'genres/drag' },
        { n: '岳母', v: 'genres/mother-in-law' },
        { n: '巨大的乳房', v: 'genres/super-milk' },
        { n: '颜面骑乘', v: 'genres/face-sitting' },
        { n: '眼镜', v: 'genres/glasses' },
        { n: '后宫', v: 'genres/harem' },
        { n: '女同之吻', v: 'genres/lesbian-kissing' },
        { n: '8Kvr', v: 'genres/8kvr' },
        { n: '水手服', v: 'genres/sailor-suit' },
        { n: '处女', v: 'genres/virgin-1' },
        { n: '女佣', v: 'genres/maid' },
        { n: '夫妻', v: 'genres/couple' },
        { n: '足交', v: 'genres/footjob' },
        { n: '特写', v: 'genres/close-up' },
        { n: '高品质虚拟现实', v: 'genres/high-quality-vr' },
        { n: '新一半', v: 'genres/shemale' },
        { n: '恶作剧', v: 'genres/mischief' },
        { n: '立即的', v: 'genres/immediate-saddle' },
        { n: '禁闭', v: 'genres/confinement' },
        { n: '变装/男孩', v: 'genres/cross-dressingmale-girl' },
        { n: '运动服/灯笼裤', v: 'genres/gym-clothes-bloomers' },
        { n: '贱人', v: 'genres/bitch' },
        { n: '黑发', v: 'genres/black-hair' },
        { n: '最佳女主角合辑', v: 'genres/actress-best-compilation' },
        { n: '洗澡', v: 'genres/bath' },
        { n: '多个故事', v: 'genres/multiple-episodes' },
        { n: '情趣服装', v: 'genres/erotic-wear' },
        { n: '女老板', v: 'genres/female-boss' },
        { n: '怀孕', v: 'genres/impregnate' },
        { n: '健康香皂', v: 'genres/health-soap' },
        { n: '帖子', v: 'genres/post' },
        { n: '酒会/约会', v: 'genres/drinking-party' },
        { n: '黑人演员', v: 'genres/black-actor' },
        { n: '超短裙', v: 'genres/miniskirt' },
        { n: '灌肠剂', v: 'genres/enema' },
        { n: '爱', v: 'genres/love-affair' },
        { n: 'Dvd 烤面包机', v: 'genres/dvd-toaster' },
        { n: '原创合作', v: 'genres/original-collaboration' },
        { n: '女调查员', v: 'genres/female-investigator' },
        { n: '模型', v: 'genres/model' },
        { n: '日期', v: 'genres/dating' },
        { n: '学校用品', v: 'genres/school-stuff' },
        { n: '私人教师', v: 'genres/tutor' },
        { n: '女同性恋', v: 'genres/lesbian' },
        { n: '运动的', v: 'genres/sports' },
        { n: '粉丝欣赏/访问', v: 'genres/fan-appreciation-home-visit' },
        { n: '酷刑', v: 'genres/torture' },
        { n: '空中小姐', v: 'genres/stewardess' },
        { n: '晒斑', v: 'genres/sunburn' },
        { n: '其他', v: 'genres/others' },
        { n: '翔太', v: 'genres/shota' },
        { n: '白人女演员', v: 'genres/white-actress' },
        { n: '性感', v: 'genres/sexy' },
        { n: '寡妇', v: 'genres/widow' },
        { n: '女士', v: 'genres/ladydaughter' },
        { n: '婴儿脸/稚嫩脸', v: 'genres/baby-facechildlike-face' },
        { n: '酒店', v: 'genres/hotel' },
        { n: '妄想', v: 'genres/delusion' },
        { n: '转子', v: 'genres/rotor' },
        { n: '年轻的纳吉米', v: 'genres/childhood-friend' },
        { n: '紧身衣', v: 'genres/leotards' },
        { n: '女性安娜', v: 'genres/female-announcer' },
        { n: '秘书', v: 'genres/secretary' },
        { n: '商务套装', v: 'genres/business-attire' },
        { n: '对女性来说', v: 'genres/for-women' },
        { n: '反向 Nan', v: 'genres/reverse-number' },
        { n: '芒古里/打桩机位置', v: 'genres/manguripiledriver-position' },
        { n: '特殊效果', v: 'genres/special-effects' },
        { n: '兔女郎', v: 'genres/bunny-girl' },
        { n: '母乳', v: 'genres/breast-milk' },
        { n: '阴毛', v: 'genres/hairypubic-hair' },
        { n: '女医生', v: 'genres/female-doctor' },
        { n: '喝尿', v: 'genres/drinking-urine' },
        { n: '清白的', v: 'genres/innocent' },
        { n: '假阳具', v: 'genres/dildo' },
        { n: '下属/同事', v: 'genres/subordinatescolleagues' },
        { n: '男性潮吹', v: 'genres/man-squirting' },
        { n: '讲师', v: 'genres/instructor' },
        { n: '短发', v: 'genres/short-hair' },
        { n: '肌肉', v: 'genres/muscle' },
        { n: '腰部', v: 'genres/waist' },
        { n: '波尔基奥', v: 'genres/portio' },
        { n: '异物插入', v: 'genres/foreign-object-insertion' },
        { n: '诺布拉', v: 'genres/no-bra' },
        { n: '汽车性爱', v: 'genres/car-sex' },
        { n: '身材好/风格很棒', v: 'genres/nice-bodygreat-style' },
        { n: '旅行', v: 'genres/travel' },
        { n: '美臀', v: 'genres/7520ed52ed' },
        { n: '动作/格斗', v: 'genres/actionfighting' },
        { n: '性爱姿势（其他）', v: 'genres/sex-position-misc' },
        { n: '赛车皇后', v: 'genres/race-queen' },
        { n: '西部别针和进口商品', v: 'genres/western-pinsoverseas-imports' },
        { n: '楠子', v: 'genres/cusco' },
        { n: '眼白/昏厥', v: 'genres/white-of-the-eyesfainting' },
        { n: '运动员', v: 'genres/athlete' },
        { n: 'Ona 支持', v: 'genres/onasapo' },
        { n: '女房东/情妇', v: 'genres/proprietress-landlady' },
        { n: '医院和诊所', v: 'genres/hospitalclinic' },
        { n: '傲娇', v: 'genres/tsundere' },
        { n: '打屁股', v: 'genres/spanking' },
        { n: '裸体围裙', v: 'genres/naked-apron' },
        { n: '强奸', v: 'genres/rape' },
        { n: '幻想', v: 'genres/fantasy' },
        { n: '长发', v: 'genres/long-hair' },
        { n: '美白肌肤', v: 'genres/beautiful-skinwhitening' },
        { n: '女儿/养女', v: 'genres/daughteradoptive-daughter' },
        { n: '阿姨', v: 'genres/aunt' },
        { n: '性骚扰者/痴汉', v: 'genres/molesterchikan' },
        { n: '及膝袜', v: 'genres/knee-socks' },
        { n: '荣耀探索 40% 折扣促销', v: 'genres/ff46e22870' },
        { n: 'Vip', v: 'genres/vip' },
        { n: '原始性爱', v: 'genres/58fc0c7a98' },
        { n: '情妇', v: 'genres/queen' },
        { n: '舞蹈', v: 'genres/dance' },
        { n: '俱乐部/经理', v: 'genres/club-activities-manager' },
        { n: '紧身连衣裙', v: 'genres/bodycon' },
        { n: '猫耳/动物', v: 'genres/cat-earsbeast-type' },
        { n: '拳头', v: 'genres/fist' },
        { n: '新娘', v: 'genres/bride' },
        { n: '青少年/青年（18岁以上）', v: 'genres/teenyoung-18' },
        { n: '女战士', v: 'genres/female-warrior' },
        { n: '孕妇', v: 'genres/pregnant-woman' },
        { n: '早泄', v: 'genres/premature-ejaculation' },
        { n: '美丽', v: 'genres/dc863e2c60' },
        { n: '变态', v: 'genres/pervert' },
        { n: '可爱的', v: 'genres/eb19a4e304' },
        { n: 'SOD30周年40%オフセール', v: 'genres/sod3040' },
        { n: 'AV女優', v: 'genres/av-3' },
        { n: '行动', v: 'genres/action' },
        { n: '残酷', v: 'genres/brutal-expression' },
        { n: '爷爷', v: 'genres/grandfather' },
        { n: '时间停止', v: 'genres/time-stop' },
        { n: '变身女主角', v: 'genres/transformation-heroine' },
        { n: '如何', v: 'genres/how-to' },
        { n: '软体', v: 'genres/soft-body' },
        { n: '亚洲女演员', v: 'genres/asian-actresses' },
        { n: '高灵敏度', v: 'genres/high-sensitivity' },
        { n: '呕吐', v: 'genres/puke' },
        { n: '粪便', v: 'genres/scatology' },
        { n: '索库里山', v: 'genres/sokkurisan' },
        { n: '金发女郎', v: 'genres/blonde' },
        { n: '乳房闪烁', v: 'genres/nipple-slip' },
        { n: '面试', v: 'genres/interview' },
        { n: '无裤', v: 'genres/no-panties' },
        { n: '名人', v: 'genres/celebrity' },
        { n: '交换', v: 'genres/swapping' },
        { n: '乳头游戏', v: 'genres/nipple-play' },
        { n: '深色皮肤', v: 'genres/dark-skin' },
        { n: '性别弯曲/女性化', v: 'genres/sex-changefeminization' },
        { n: '选育', v: 'genres/breeding' },
        { n: '醉', v: 'genres/drunk' },
        { n: '楠', v: 'genres/tickling' },
        { n: 'M', v: 'genres/m' },
        { n: '排便', v: 'genres/defecation' },
        { n: '糖果', v: 'genres/campaign-girl' },
        { n: '肛交', v: 'genres/anal-sex' },
        { n: '女服务员', v: 'genres/waitress' },
        { n: '美丽的女人', v: 'genres/a632acd889' },
        { n: '黑暗的', v: 'genres/dark-system' },
        { n: '鼻钩', v: 'genres/nose-hook' },
        { n: '宽松的袜子', v: 'genres/loose-socks' },
        { n: '苏玛塔（非穿透性）', v: 'genres/sumata-non-penetrative' },
        { n: '国籍（台湾/俄罗斯/混血）', v: 'genres/nationality-taiwanrussiahalf' },
        { n: '限时促销', v: 'genres/limited-time-sale' },
        { n: '侮辱', v: 'genres/abuse' },
        { n: '巨乳キャンペーン', v: 'genres/d10e314b86' },
        { n: '面具', v: 'genres/mask-mask' },
        { n: 'アナルセックス(男ノ娘)', v: 'genres/b0e982044a' },
        { n: '妈妈的朋友', v: 'genres/mom-friend' },
        { n: '口射', v: 'genres/b660a1357d' },
        { n: '美丽的猫咪', v: 'genres/beautiful-pussy' },
        { n: '双成', v: 'genres/futanari' },
        { n: '中式服饰', v: 'genres/cheongsam-dress' },
        { n: '动漫人物', v: 'genres/anime-characters' },
        { n: '乳房（通用，未分级）', v: 'genres/breasts-generic-ungraded' },
        { n: '御宅族', v: 'genres/otaku' },
        { n: 'Fanza独家', v: 'genres/limited-to-fanza-distribution' },
        { n: '外国人', v: 'genres/foreigner' },
        { n: '2次射精', v: 'genres/de76af0a33' },
        { n: 'Delusional Tribe - Emmanuel 40% 折扣促销', v: 'genres/1e15769cb4' },
        { n: '接待员', v: 'genres/receptionist' },
        { n: '玩具娃娃', v: 'genres/doll' },
        { n: '瑜伽', v: 'genres/yoga' },
        { n: '棕色头发', v: 'genres/brown-hair' },
        { n: '蜡烛', v: 'genres/candle' },
        { n: 'Next Group感恩节促销，全场40%折扣', v: 'genres/4aed778d5c' },
        { n: '啦啦队女孩', v: 'genres/cheerleader' },
        { n: '20岁', v: 'genres/82688fd853' },
        { n: '触手', v: 'genres/tentacles' },
        { n: '搞笑喜剧', v: 'genres/gag-comedy' },
        { n: '奶奶', v: 'genres/grandma' },
        { n: '伴侣', v: 'genres/companion' },
        { n: '前偶像', v: 'genres/cny' },
        { n: '一日拍摄', v: 'genres/73ea7f13a9' },
        { n: '可爱的', v: 'genres/417110abc4' },
        { n: 'G罩杯', v: 'genres/g-1' },
        { n: '发型（双马尾/马尾/波波头）', v: 'genres/hairstyle-twintailponytailbob' },
        { n: '洛丽塔类型', v: 'genres/ae186fcf7f' },
        { n: '巴士指南', v: 'genres/bus-tour-guide' },
        { n: '胸部', v: 'genres/06bec123a2' },
        { n: '科幻小说', v: 'genres/sci-fi' },
        { n: '巫女', v: 'genres/shrine-maiden' },
        { n: '手淫', v: 'genres/a815466d96' },
        { n: '战斗机', v: 'genres/martial-artist' },
        { n: 'S 女人', v: 'genres/s' },
        { n: '3D', v: 'genres/3d' },
        { n: '眼罩', v: 'genres/blindfold' },
        { n: '印度群岛', v: 'genres/indies' },
        { n: '美丽', v: 'genres/beauty' },
        { n: '催眠/洗脑', v: 'genres/hypnosisbrainwashing' },
        { n: '16+小时', v: 'genres/over-16-hours' },
        { n: 'W形手指人', v: 'genres/w' },
        { n: '套装产品', v: 'genres/set-product' },
        { n: '魔法少女', v: 'genres/magical-girl' },
        { n: '重印', v: 'genres/reprint' },
        { n: '女野市', v: 'genres/kunoichi' },
        { n: '4K拍摄', v: 'genres/4k' },
        { n: '2014年Av公开赛重量级', v: 'genres/av-open-2014-heavyweight' },
        { n: '季节性/节日', v: 'genres/seasonalholiday' },
        { n: '偶像', v: 'genres/2116ccf696-1' },
        { n: '没有任何', v: 'genres/9e108af5d0' },
        { n: 'F罩杯', v: 'genres/f-1' },
        { n: '额外赠送', v: 'genres/716b636399' },
        { n: '生的', v: 'genres/b30c1a985e' },
        { n: '粗硬的头发', v: 'genres/33a0e9d009-1' },
        { n: '体验告白', v: 'genres/confession-of-experience' },
        { n: '口交', v: 'genres/d97496ec3b' },
        { n: '弃', v: 'genres/neglect' },
        { n: '传教士职位', v: 'genres/3144284b4b' },
        { n: '西德克', v: 'genres/9198b827fe' },
        { n: '两次射精', v: 'genres/b1b332b734' },
        { n: '30年代', v: 'genres/30' },
        { n: 'マーキュリー・FirstStar・ワー40%オフセール', v: 'genres/firststar40-1' },
        { n: '中型头发', v: 'genres/medium-hair' },
        { n: '纹身', v: 'genres/tattoo' },
        { n: 'E杯', v: 'genres/e-1' },
        { n: '美丽的肌肤', v: 'genres/fc43e2da49' },
        { n: '2014年Av Open中级', v: 'genres/av-open-2014-middle-class' },
        { n: '小胸', v: 'genres/70d2b9a4d3' },
        { n: '伊卡斯游戏', v: 'genres/f5627f945b' },
        { n: '2015年Av公开企划部', v: 'genres/av-open-2015-planning-division' },
        { n: '食粪行为', v: 'genres/coprophagy' },
        { n: '恭喜你成年啦！成年人专享40%折扣！', v: 'genres/511ff31f89' },
        { n: 'Mercury、Firststar，40% 折扣促销', v: 'genres/firststar40' },
        { n: '小胸', v: 'genres/4aa5600cd7' },
        { n: '偏干', v: 'genres/boyish' },
        { n: '方言', v: 'genres/dialect' },
        { n: '一镜到底', v: 'genres/2ee8e88780' },
        { n: '敏感的', v: 'genres/1ff879de5d' },
        { n: '恐怖', v: 'genres/horror' },
        { n: '钙', v: 'genres/ca' },
        { n: '过去 1', v: 'genres/ab6c23aea2' },
        { n: '埃布利', v: 'genres/edging' },
        { n: 'ディスクオンデマンドセール', v: 'genres/c08a240662-1' },
        { n: '尊享冬季庆典 - 最高可享50%折扣', v: 'genres/2de202ecda' },
        { n: 'V-影院', v: 'genres/v-cinema' },
        { n: '怀孕', v: 'genres/b48b612c43' },
        { n: '妄想族・エマニエル40%オフセール', v: 'genres/40-4' },
        { n: 'H罩杯', v: 'genres/h-1' },
        { n: 'プレステージ40%オフセール', v: 'genres/40-2' },
        { n: '虚拟主播', v: 'genres/v' },
        { n: '卷发', v: 'genres/curly-hair' },
        { n: '高的', v: 'genres/4ac27f00cf' },
        { n: '全球媒体 40% 折扣促销', v: 'genres/89a5a51891' },
        { n: '合作作品', v: 'genres/collaboration-work' },
        { n: '19岁', v: 'genres/19' },
        { n: 'Ipoke 活动', v: 'genres/3c4e72db34' },
        { n: '一半在外面，一半在里面', v: 'genres/06ae3252c9' },
        { n: '娃娃脸', v: 'genres/70ecf2ba69' },
        { n: '18岁', v: 'genres/18' },
        { n: '天真（幼稚）型', v: 'genres/6f61b9f992' },
        { n: '第二轮', v: 'genres/420073d82a' },
        { n: '束缚', v: 'genres/bondage-1' },
        { n: '18', v: 'genres/6f4922f455' },
        { n: '原始射精', v: 'genres/72c9b14385' },
        { n: '阴毛', v: 'genres/de0737b86a' },
        { n: '变态', v: 'genres/027267b1e5' },
        { n: 'Threesome / Foursome', v: 'genres/threesome-foursome-1' },
        { n: 'Av Open 2015 狂热/恋物癖部分', v: 'genres/av-open-2015-maniafetish-section' },
        { n: '按需折扣促销', v: 'genres/c08a240662' },
        { n: '高跟鞋', v: 'genres/high-heels-1' },
        { n: '3次射精', v: 'genres/8bc0a4b00d' },
        { n: '天堂电视台', v: 'genres/paradise-tv' },
        { n: 'Av Open 2016 剧情/纪录片类', v: 'genres/av-open-2016-dramadocumentary-category' },
        { n: '曼古里盖什', v: 'genres/3dbdbd029d' },
        { n: '生哈梅', v: 'genres/57f900cfa6' },
        { n: '同性恋', v: 'genres/gay' },
        { n: 'Av Open 2016 疯狂/恋物部分', v: 'genres/av-open-2016-maniafetish-section' },
        { n: '连续两次射精', v: 'genres/e538d644dd' },
        { n: 'Prestige 40% 折扣促销', v: 'genres/59b6cd8984' },
        { n: '吻', v: 'genres/3151a87f89' },
        { n: '真正的奶油派', v: 'genres/68ef1e67bd' },
        { n: '2 发', v: 'genres/9eb330fb55' },
        { n: '2015 年 Av Open 小型/硬式', v: 'genres/av-open-2015-smhard' },
        { n: '奇帕伊', v: 'genres/0262798b1a' },
        { n: '阴毛', v: 'genres/285f1d32d0' },
        { n: '绝佳风格', v: 'genres/5197f94a8c' },
        { n: 'Mgs独家花絮', v: 'genres/mgs' },
        { n: '米尼斯卡波利斯', v: 'genres/miniskirt-police' },
        { n: '哥特洛丽塔', v: 'genres/gothic-lolita' },
        { n: 'ネクストグループ感謝祭40%オフセール', v: 'genres/40' },
        { n: 'Avopen2016 策划部', v: 'genres/avopen2016' },
        { n: '2018 年 Av 公开赛狂热/恋物癖部分', v: 'genres/av-open-2018-maniafetish-section' },
        { n: '大屁股', v: 'genres/af3731b1a3' },
        { n: '萝莉', v: 'genres/68a853de7e' },
        { n: '2016年Av公开赛业余组', v: 'genres/av-open-2016-amateur-division' },
        { n: '舔乳头', v: 'genres/6000752b01' },
        { n: '40年代', v: 'genres/40-3' },
        { n: '2015年Av公开赛青少年组', v: 'genres/av-open-2015-maiden-division' },
        { n: '2016年Av公开企划部', v: 'genres/av-open-2016-planning-division' },
        { n: '大约40', v: 'genres/29b54e86a8' },
        { n: '初井', v: 'genres/7af2301034' },
        { n: '未公开', v: 'genres/360356cc66' },
        { n: '无需分阶段', v: 'genres/1ac199e19d' },
        { n: '难波大师', v: 'genres/ad615d068e' },
        { n: '公主', v: 'genres/princess' },
        { n: 'Nagae Style 40% 折扣促销', v: 'genres/92a5bfbda2' },
        { n: '晨间性爱', v: 'genres/sex' },
        { n: '单反', v: 'genres/60483a8c81' },
        { n: '土豆', v: 'genres/d174f2fa2f' },
        { n: '2015年Av公开赛女演员组', v: 'genres/av-open-2015-actress-category' },
        { n: '施肥', v: 'genres/bdd6ddecb7' },
        { n: 'I罩杯', v: 'genres/i-1' },
        { n: '20岁', v: 'genres/20-2' },
        { n: '受虐狂', v: 'genres/m-2' },
        { n: '美丽的身体', v: 'genres/981d556942' },
        { n: '额外赠送', v: 'genres/288b949695' },
        { n: '5次射精', v: 'genres/168e962cc7' },
        { n: '伊卡塞', v: 'genres/f3de6fe979' },
        { n: '2017年Av Open纪录片组', v: 'genres/av-open-2017-documentary-division' },
        { n: 'Crystal Video 限时4折优惠', v: 'genres/79591548e5' },
        { n: '汗', v: 'genres/a009caa7d8' },
        { n: '长的', v: 'genres/efb70a9ebd' },
        { n: '真人游戏', v: 'genres/game-live-action' },
        { n: '情色的声音', v: 'genres/73b3fb2c7b' },
        { n: '2016年Av公开赛硬地组', v: 'genres/av-open-2016-hard-division' },
        { n: '伦雷科米', v: 'genres/b193685f69' },
        { n: '连续两次射击', v: 'genres/6269f71c84' },
        { n: '2015年Av公开赛业余组', v: 'genres/av-open-2015-amateur-division' },
        { n: '关系', v: 'genres/e91247059d' },
        { n: '2016年Av公开赛女演员组', v: 'genres/av-open-2016-actress-category' },
        { n: '浴室', v: 'genres/9ae6a51d56' },
        { n: '勃起的阴茎', v: 'genres/9e5f956fbf' },
        { n: '大屌', v: 'genres/1c26b087b6' },
        { n: '2017年Av Open戏剧组', v: 'genres/av-open-2017-drama-division' },
        { n: '诺克佐里', v: 'genres/63d62e674c' },
        { n: '打桩机', v: 'genres/74045258fb' },
        { n: 'ナガエスタイル40%オフセール', v: 'genres/40-1' },
        { n: '潜望镜', v: 'genres/a9e3de41ce' },
        { n: '三十岁', v: 'genres/e1d1b6803a' },
        { n: '2017 年 Av Open Mania 赛区', v: 'genres/av-open-2017-mania-division' },
        { n: '可用奖金(Avbaseball)', v: 'genres/with-benefits-av-baseball' },
        { n: '爱神', v: 'genres/eros' },
        { n: '心理惊悚片', v: 'genres/psycho-thriller' },
        { n: '第二轮', v: 'genres/11e98d336a' },
        { n: '清白的', v: 'genres/d4072c2279-1' },
        { n: '连续两次射精', v: 'genres/1a84c82331' },
        { n: '离婚', v: 'genres/e7a61bc461' },
        { n: '差距', v: 'genres/ad7c62202d' },
        { n: '车站便当（火车站便当盒）', v: 'genres/19772ca0cb' },
        { n: '黑色丝袜', v: 'genres/fb3e1c40c2' },
        { n: '最可爱的', v: 'genres/a8a35b28c7' },
        { n: '性吸引力', v: 'genres/5075d717b1' },
        { n: 'D罩杯', v: 'genres/d-1' },
        { n: '神体', v: 'genres/e171e172a0' },
        { n: '成人', v: 'genres/4ff0077a46' },
        { n: '双和平', v: 'genres/caffa39254' },
        { n: '音乐系学生', v: 'genres/7922d155a1' },
        { n: '张口射精', v: 'genres/b6e4df7da5' },
        { n: '魅力四射', v: 'genres/447f9b7430' },
        { n: '性感内衣', v: 'genres/188ac4f9d0' },
        { n: '美男子', v: 'genres/7644a5ef05' },
        { n: 'Vibe（那个糟糕的）', v: 'genres/bb707bbfd7' },
        { n: '全身渔网袜', v: 'genres/517f59875f' },
        { n: '眼罩', v: 'genres/a02753a6b7' },
        { n: '游泳俱乐部', v: 'genres/45f6bdf642' },
        { n: '溅', v: 'genres/be98be125c' },
        { n: '日本动画片', v: 'genres/anime' },
        { n: '乌贼', v: 'genres/91438c2572' },
        { n: '小脸', v: 'genres/fd8dfe8caa' },
        { n: '厨房', v: 'genres/68f8697c8c' },
        { n: '小阴唇', v: 'genres/bb1ee8eb76' },
        { n: '纯的', v: 'genres/c6ae14637d' },
        { n: '游戏', v: 'genres/a6dc80113e' },
        { n: '20多岁', v: 'genres/20' },
        { n: '抖音', v: 'genres/tiktok' },
      ] },
    ],
    actresses: [
      { key: 'sub', name: '女演员', value: [
        { n: 'Yui Hatano', v: 'actresses/yui-hatano' },
        { n: 'Shinoda Yu', v: 'actresses/shinoda-yu' },
        { n: 'Hibiki Ohtsuki', v: 'actresses/hibiki-ohtsuki' },
        { n: 'Hamazaki Mao', v: 'actresses/hamazaki-mao' },
        { n: 'Kana Morisawa (Kanako Iioka)', v: 'actresses/kana-morisawa-kanako-iioka' },
        { n: 'Ichika Matsumoto', v: 'actresses/ichika-matsumoto' },
        { n: 'Hasumi Claire', v: 'actresses/hasumi-claire' },
        { n: 'Niimura Akari', v: 'actresses/niimura-akari' },
        { n: 'Aika', v: 'actresses/aika' },
        { n: 'Mizuki Yayoi', v: 'actresses/mizuki-yayoi-1' },
        { n: 'Kobayakawa Reiko', v: 'actresses/kobayakawa-reiko' },
        { n: 'Waka Misono', v: 'actresses/waka-misono' },
        { n: 'Aki Sasaki', v: 'actresses/aki-sasaki' },
        { n: 'Julia', v: 'actresses/julia' },
        { n: 'Asahi Mizuno', v: 'actresses/asahi-mizuno' },
        { n: 'Kinoshita Himari (Hanazawa Himari)', v: 'actresses/kinoshita-himari-hanazawa-himari' },
        { n: 'Mitsuki Nagisa', v: 'actresses/mitsuki-nagisa' },
        { n: 'Yuu Kawakami (Shizuku Morino)', v: 'actresses/yuu-kawakami-shizuku-morino' },
        { n: 'Yumi Kazama', v: 'actresses/yumi-kazama' },
        { n: 'Akari Mitani', v: 'actresses/akari-mitani' },
        { n: 'Alice Otsu', v: 'actresses/alice-otsu' },
        { n: 'Minazuki Hikaru', v: 'actresses/minazuki-hikaru' },
        { n: 'Ayumi Shinoda', v: 'actresses/ayumi-shinoda' },
        { n: 'Kimishima Mio', v: 'actresses/kimishima-mio' },
        { n: 'Yuria Yoshine', v: 'actresses/yuria-yoshine' },
        { n: 'Sumire Kuramoto', v: 'actresses/sumire-kuramoto' },
        { n: 'Satsuki Ena', v: 'actresses/satsuki-ena' },
        { n: 'Aoi Kururugi', v: 'actresses/aoi-kururugi' },
        { n: 'Yui Tenma', v: 'actresses/yui-tenma' },
        { n: 'Oshikawa Yuri', v: 'actresses/oshikawa-yuri' },
        { n: 'S** Chisato', v: 'actresses/shota-chisato' },
        { n: 'Hana Haruna', v: 'actresses/hana-haruna' },
        { n: 'Rena Aoi', v: 'actresses/rena-aoi' },
        { n: 'Himesaki Hana', v: 'actresses/himesaki-hana' },
        { n: 'Kanna Misaki', v: 'actresses/kanna-misaki' },
        { n: 'Nene Tanaka', v: 'actresses/nene-tanaka' },
        { n: 'Tsubomi', v: 'actresses/tsubomi-1' },
        { n: 'Mei Satsuki', v: 'actresses/mei-satsuki' },
        { n: 'Miho Tsuno', v: 'actresses/miho-tsuno' },
        { n: 'Eimi Fukada', v: 'actresses/eimi-fukada' },
        { n: 'Arimura Nozomi', v: 'actresses/arimura-nozomi' },
        { n: 'Hinako Mori', v: 'actresses/hinako-mori' },
        { n: 'Hachino Tsubasa', v: 'actresses/hachino-tsubasa' },
        { n: 'Ai Mukai', v: 'actresses/ai-mukai' },
        { n: 'Mao Kurata', v: 'actresses/mao-kurata' },
        { n: 'Maki Kyoko', v: 'actresses/maki-kyoko' },
        { n: 'Hojo Asahi', v: 'actresses/hojo-asahi' },
        { n: 'Tsubaki Rika', v: 'actresses/tsubaki-rika' },
        { n: 'Ayaka Tomoda', v: 'actresses/ayaka-tomoda' },
        { n: 'Mina Kitano', v: 'actresses/mina-kitano' },
        { n: 'Shiina Sora', v: 'actresses/shiina-sora' },
        { n: 'Riho Fujimori', v: 'actresses/riho-fujimori' },
        { n: 'Sumire Kurokawa', v: 'actresses/sumire-kurokawa' },
        { n: 'Of Sato (Momo Kato)', v: 'actresses/of-sato-momo-kato' },
        { n: 'Takarada Monami', v: 'actresses/takarada-monami' },
        { n: 'Honoka Tsujii', v: 'actresses/honoka-tsujii' },
        { n: 'Jun Suehiro', v: 'actresses/jun-suehiro' },
        { n: 'Konno Hikaru', v: 'actresses/konno-hikaru' },
        { n: 'Natsu Tojo', v: 'actresses/natsu-tojo' },
        { n: 'Mari Rika', v: 'actresses/mari-rika' },
        { n: 'Jinguji Nao', v: 'actresses/jinguji-nao' },
        { n: 'Winter Love', v: 'actresses/winter-love' },
        { n: 'Really', v: 'actresses/really' },
        { n: 'Ruka Inaba', v: 'actresses/ruka-inaba' },
        { n: 'Mary Tachibana', v: 'actresses/mary-tachibana' },
        { n: 'Reiko Sawamura (Honami Takasaka, Masumi Takasaka)', v: 'actresses/reiko-sawamura-honami-takasaka-masumi-takasaka-1' },
        { n: 'Nanami Matsumoto', v: 'actresses/nanami-matsumoto' },
        { n: 'Yui Nagase', v: 'actresses/yui-nagase' },
        { n: 'Kasumi Tsukino', v: 'actresses/kasumi-tsukino' },
        { n: 'Shiori Tsukada', v: 'actresses/shiori-tsukada' },
        { n: 'Mihina (Azumi Hina, Nagai Mihina)', v: 'actresses/mihina-azumi-hina-nagai-mihina' },
        { n: 'Abe Mikako', v: 'actresses/abe-mikako' },
        { n: 'Nozomi Hazuki', v: 'actresses/nozomi-hazuki' },
        { n: 'Abeno Miku', v: 'actresses/abeno-miku' },
        { n: 'Yuuri Maina', v: 'actresses/yuuri-maina' },
        { n: 'Noa Eikawa', v: 'actresses/noa-eikawa' },
        { n: 'Kashiwagi Konatsu', v: 'actresses/kashiwagi-konatsu' },
        { n: 'Sayama Love', v: 'actresses/sayama-love' },
        { n: 'Ichijo Mio', v: 'actresses/ichijo-mio' },
        { n: 'Luna Tsukino', v: 'actresses/luna-tsukino' },
        { n: 'Tsubaki Kato (Kaoru Natsuki)', v: 'actresses/tsubaki-kato-kaoru-natsuki' },
        { n: 'Yuna Shiina', v: 'actresses/yuna-shiina' },
        { n: 'Kitagawa Erika', v: 'actresses/kitagawa-erika' },
        { n: 'Sarina Momonaga', v: 'actresses/sarina-momonaga' },
        { n: 'Non Kobana', v: 'actresses/non-kobana' },
        { n: 'Miu Arioka', v: 'actresses/miu-arioka' },
        { n: 'Shuri Atomi', v: 'actresses/shuri-atomi' },
        { n: 'Ayaka Mochizuki', v: 'actresses/ayaka-mochizuki' },
        { n: 'Mirai Sunohara', v: 'actresses/mirai-sunohara' },
        { n: 'Saki Okuda', v: 'actresses/saki-okuda' },
        { n: 'Oda Mako', v: 'actresses/oda-mako' },
        { n: 'Ai Uehara', v: 'actresses/ai-uehara' },
        { n: 'Suwon Miso', v: 'actresses/suwon-miso' },
        { n: 'Kawakami Nanami', v: 'actresses/kawakami-nanami' },
        { n: 'Arisa Hanyu', v: 'actresses/arisa-hanyu' },
        { n: 'Akiho Yoshizawa', v: 'actresses/akiho-yoshizawa' },
        { n: 'Kanou Flower', v: 'actresses/kanou-flower' },
        { n: 'Yurika Aoi', v: 'actresses/yurika-aoi' },
        { n: 'Lima Arai', v: 'actresses/lima-arai' },
        { n: 'Kanae Ruka', v: 'actresses/kanae-ruka' },
      ] },
    ],
    makers: [
      { key: 'sub', name: '制作商', value: [
        { n: 'Fc2', v: 'makers/fc2' },
        { n: 'Moody\'s', v: 'makers/moodys' },
        { n: 'Sod Create', v: 'makers/sod-create' },
        { n: 'Madonna', v: 'makers/madonna' },
        { n: 'Prestige', v: 'makers/prestige' },
        { n: 'S1 Number One Style', v: 'makers/s1-number-one-style' },
        { n: '电视机', v: 'makers/tv' },
        { n: 'K.m. Produce', v: 'makers/km-produce' },
        { n: 'Attackers', v: 'makers/attackers' },
        { n: 'Idea Pocket', v: 'makers/idea-pocket' },
        { n: 'Center Village', v: 'makers/center-village' },
        { n: 'Hunter', v: 'makers/hunter' },
        { n: 'Doc', v: 'makers/doc' },
        { n: 'Glory Quest', v: 'makers/glory-quest' },
        { n: 'Fitch', v: 'makers/fitch' },
        { n: 'Venus', v: 'makers/venus' },
        { n: '加勒比通讯', v: 'makers/caribbeancom' },
        { n: 'Honchu', v: 'makers/honchu' },
        { n: 'Yessssss!', v: 'makers/yessssss' },
        { n: 'S-One 第一风格', v: 'makers/fb5491cb59' },
        { n: 'Heyzo', v: 'makers/heyzo' },
        { n: 'Premium', v: 'makers/premium' },
        { n: 'Natural High', v: 'makers/natural-high' },
        { n: 'Celebrity Friends', v: 'makers/celebrity-friends' },
        { n: 'Planet Plus', v: 'makers/planet-plus' },
        { n: 'One\'s Factory', v: 'makers/ones-factory' },
        { n: 'Faleno', v: 'makers/faleno' },
        { n: '尊贵高级版', v: 'makers/prestige-premium' },
        { n: 'Takara Video', v: 'makers/takara-video' },
        { n: 'Kawaii', v: 'makers/kawaii' },
        { n: 'E-Body', v: 'makers/e-body' },
        { n: 'Crystal Video', v: 'makers/crystal-video' },
        { n: 'Tameike Goro', v: 'makers/tameike-goro' },
        { n: 'Deeps', v: 'makers/deeps' },
        { n: '1Pondo', v: 'makers/1pondo' },
        { n: 'Oppai', v: 'makers/oppai' },
        { n: 'S-Cute', v: 'makers/s-cute' },
        { n: '10Musume', v: 'makers/10musume' },
        { n: '东京热', v: 'makers/tokyo-hot' },
        { n: 'I\'m An Amateur -Z-', v: 'makers/im-an-amateur-z' },
        { n: 'First Star', v: 'makers/first-star' },
        { n: 'Energy', v: 'makers/energy' },
        { n: 'Maximizing', v: 'makers/maximizing' },
        { n: 'Alice Japan', v: 'makers/alice-japan' },
        { n: 'Mercury', v: 'makers/mercury' },
        { n: '帕科帕科马', v: 'makers/pacopacomama' },
        { n: 'H4610', v: 'makers/h4610' },
        { n: 'Max A', v: 'makers/max-a' },
        { n: 'Ruby', v: 'makers/ruby' },
        { n: 'Big Mocal', v: 'makers/big-mocal' },
        { n: 'Hmp', v: 'makers/hmp' },
        { n: 'Rocket', v: 'makers/rocket' },
        { n: 'C0930', v: 'makers/c0930' },
        { n: 'H0930', v: 'makers/h0930' },
        { n: '第一颗星', v: 'makers/714b15b1cf' },
        { n: 'Aurora Project Annex', v: 'makers/aurora-project-annex' },
        { n: 'Momotaro Video Publishing', v: 'makers/momotaro-video-publishing' },
        { n: 'Avs Collector\'s', v: 'makers/avs-collectors' },
        { n: '荡妇天堂', v: 'makers/fa47310ad1' },
        { n: '荡妇', v: 'makers/3d449fba56' },
        { n: 'Innocence', v: 'makers/innocence' },
        { n: 'Hmn Works', v: 'makers/hmn-works' },
        { n: 'Nagae Style', v: 'makers/nagae-style' },
        { n: 'S Class Amateur', v: 'makers/s-class-amateur' },
        { n: '火箭', v: 'makers/a755f04771' },
        { n: 'Warp Entertainment', v: 'makers/warp-entertainment' },
        { n: 'Switch', v: 'makers/switch' },
        { n: 'Dogma', v: 'makers/dogma' },
        { n: 'Akinori', v: 'makers/akinori' },
        { n: 'Fa Pro', v: 'makers/fa-pro' },
        { n: 'Jet Video', v: 'makers/jet-video' },
        { n: 'Hibino', v: 'makers/hibino' },
        { n: 'Hot Entertainment', v: 'makers/hot-entertainment' },
        { n: 'Kanbi', v: 'makers/kanbi' },
        { n: 'Abc/Delusion Group', v: 'makers/abcdelusion-group' },
        { n: 'Kira☆Kira', v: 'makers/kirakira' },
        { n: 'Sadistic Village', v: 'makers/sadistic-village' },
        { n: 'Rebecca', v: 'makers/rebecca' },
        { n: 'Amateur Clover', v: 'makers/amateur-clover' },
        { n: 'Real Works', v: 'makers/real-works' },
        { n: 'Dahlia', v: 'makers/dahlia' },
        { n: 'Giga', v: 'makers/giga' },
        { n: 'Aroma Planning', v: 'makers/aroma-planning' },
        { n: 'Dream Ticket', v: 'makers/dream-ticket' },
        { n: 'Tma', v: 'makers/tma' },
        { n: 'Plum', v: 'makers/plum' },
        { n: 'Blushing Girl', v: 'makers/blushing-girl' },
        { n: 'Paradise Tv', v: 'makers/paradise-tv' },
        { n: 'Mbm', v: 'makers/mbm' },
        { n: 'K-Trib', v: 'makers/k-trib' },
        { n: '魔法', v: 'makers/c2104f6b6b' },
        { n: 'Faleno Tube', v: 'makers/faleno-tube' },
        { n: 'Office K\'s', v: 'makers/office-ks' },
        { n: 'Pink', v: 'makers/pink' },
        { n: 'Global Media Entertainment', v: 'makers/global-media-entertainment' },
        { n: 'Dandy', v: 'makers/dandy' },
        { n: 'Mr. Michiru', v: 'makers/mr-michiru' },
        { n: 'M\'s Video Group', v: 'makers/ms-video-group' },
        { n: '日本成熟女性', v: 'makers/japan' },
        { n: 'Yamato Sora/Delusion Group', v: 'makers/yamato-soradelusion-group' },
      ] },
    ],
    series: [
      { key: 'sub', name: '系列', value: [
        { n: '杂技性爱！', v: 'series/sex' },
        { n: '业余视听采访', v: 'series/av' },
        { n: '豪华电视', v: 'series/tv' },
        { n: '【初拍】申请Av在线→Av体验拍摄', v: 'series/avav' },
        { n: 'Ntr（Netorare - 日本电视剧中的一个角色）', v: 'series/ntr' },
        { n: '非常轻佻，第一次拍摄。', v: 'series/90cf840150' },
        { n: '喝精液的M女人', v: 'series/m' },
        { n: '东京热', v: 'series/tokyo-hot' },
        { n: '魔镜', v: 'series/58b73f0b7a' },
        { n: '草皮女员工', v: 'series/sod' },
        { n: '街角业余搭讪', v: 'series/8196dba1e7' },
        { n: '一位普通的家庭主妇误入了允许群交的男女混浴温泉！', v: 'series/ok' },
        { n: '豪华奥尔', v: 'series/ol' },
        { n: '可爱* 美女群交', v: 'series/kawaii' },
        { n: '招聘频道~寻找普通业余女性~', v: 'series/17096c5428' },
        { n: '首次拍摄已婚女性纪录片', v: 'series/5544c187a6' },
        { n: '黑人巨根，真他妈爽翻了', v: 'series/fuck' },
        { n: '翔太君的恶作剧', v: 'series/h' },
        { n: 'Av 出道 (Kimihore)', v: 'series/av-debut' },
        { n: '魔镜（Mm）', v: 'series/mm' },
        { n: '性交时体液外流，激烈性行为', v: 'series/c57a2f91ff' },
        { n: '独家1号款式', v: 'series/no1-style' },
        { n: '我叫了个应召女郎，结果发现是我老家那个身材丰满的朋友……', v: 'series/cny' },
        { n: 'W 肛门婊子', v: 'series/w' },
        { n: '勃起展示情况', v: 'series/d02f8e8c51' },
        { n: 'Ultra Best（胜夫物产/梦祖族）', v: 'series/best' },
        { n: 'B', v: 'series/b' },
        { n: '全国已婚妇女情色百科全书', v: 'series/b1d1e35f96' },
        { n: '业余女孩搭讪！！', v: 'series/94eb7f9462' },
        { n: '请原谅我...', v: 'series/a40f66720e' },
        { n: '车站便当中出 J○ 志●', v: 'series/j' },
        { n: 'Ai 数字修复版 1080P', v: 'series/ai1080p' },
        { n: '母子乱伦', v: 'series/9f61ce493a' },
        { n: '勒索套件', v: 'series/3b9ff7135f' },
        { n: '猎人黑', v: 'series/3d9c8e4266' },
        { n: '完全成熟（E-Body）', v: 'series/e-body' },
        { n: 'S', v: 'series/s' },
        { n: '一个古怪的业余颜艺Xx', v: 'series/bafceb204b' },
        { n: '禁止照护', v: 'series/7141f8bf63' },
        { n: '我可以送你回家吗？', v: 'series/eb5f32eede' },
        { n: '我挚爱的人，在虚拟现实中等我。', v: 'series/vr' },
        { n: '拍摄一段彻底羞辱的视频', v: 'series/5e97ec73d1' },
        { n: '第一印象', v: 'series/first-impression' },
        { n: 'S1 女童系列', v: 'series/s1-girls-collection' },
        { n: '珍藏的猫咪精选', v: 'series/treasured-pussy-selection' },
        { n: '通过甜心约会认识我的异地恋男友', v: 'series/jpy' },
        { n: '在丈夫面前被强奸', v: 'series/1f089303de' },
        { n: 'Boin“○○”盒子', v: 'series/boinbox' },
        { n: 'Catwalk Poison（蓝光）', v: 'series/blu-ray' },
        { n: 'S1 Vr', v: 'series/s1-vr' },
        { n: '第一次体内射精（真精液）', v: 'series/4670310bc7' },
        { n: '出租女友', v: 'series/33d3f643f5' },
        { n: '本书首次亮相', v: 'series/260cf5f1b7' },
        { n: '已婚妇女的婚外情', v: 'series/2dda438621' },
        { n: '未完成的Vr', v: 'series/unfinished-vr' },
        { n: '我岳母比我老婆好多了……', v: 'series/4117bb0961' },
        { n: '独家第一风格', v: 'series/no1style' },
        { n: '爱情旅馆纪录片（2小时休息）', v: 'series/f4103d1312' },
        { n: '上帝泳装', v: 'series/03aa0ab3e4' },
        { n: '阴道百科全书', v: 'series/a1bcc7495c' },
      ] },
    ],
    },
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'new');
  const extend = body.filters || body.extend || {};
  // 四个维度走筛选卡片：选中卡片取卡片地址，未选默认取该组第一项；卡片须属于当前维度才生效
  const DIM_DEFAULT = { genres: 'genres/solowork', actresses: 'actresses/yui-hatano', makers: 'makers/fc2', series: 'series/sex' };
  const sub = extend.sub || '';
  const eff = (tid in DIM_DEFAULT) ? ((sub && sub.startsWith(tid + '/')) ? sub : DIM_DEFAULT[tid]) : tid;

  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const path = '/' + LANG + '/' + eff;
  const urlPath = page > 1 ? path.replace(/\/$/, '') + '?page=' + page : path;
  const html = await fetchHtml(urlPath);
  if (cfBlocked(html)) {
    return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [], msg: 'Cloudflare 拦截' };
  }
  const list = parseList(html);
  return {
    page,
    pagecount: 999,
    limit: list.length,
    total: 999 * PAGE_SIZE,
    list,
  };
}

async function search(reqIn) {
  const body = reqIn?.body || {};
  const wd = String(body.wd || '').trim();
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  if (!wd) return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [] };
  const path =
    '/' + LANG + '/search?keyword=' + encodeURIComponent(wd) + (page > 1 ? '&page=' + page : '');
  const html = await fetchHtml(path);
  if (cfBlocked(html)) {
    return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [], msg: 'Cloudflare 拦截' };
  }
  const list = parseList(html);
  return {
    page,
    pagecount: 999,
    limit: list.length,
    total: 999 * PAGE_SIZE,
    list,
  };
}

async function detail(reqIn) {
  const ids = Array.isArray(reqIn?.body?.id) ? reqIn.body.id : [reqIn?.body?.id];
  const list = [];
  for (const rawId of (ids || []).filter(Boolean)) {
    const path = parsePath(rawId);
    if (!path) continue;
    const html = await fetchHtml(path);
    if (cfBlocked(html)) continue;

    // 片名：h1 优先，不要用线路名
    let title = path.split('/').pop() || path;
    const hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (hm) title = t(hm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' '));
    if (!title || title === '1') {
      const og = html.match(/og:title["']\s+content=["']([^"']+)/i);
      if (og) title = t(og[1]);
    }

    let cover = '';
    const bm = html.match(
      /background-image:\s*url\(['"]?(https?:\/\/icdn\.123av\.me\/[^)'"\s]+)/i
    );
    if (bm) cover = bm[1];
    if (!cover) {
      const cm2 = html.match(
        /https?:\/\/icdn\.123av\.me\/img2\/s(?:500|1080)\/[^"'\s\)]+cover\.jpg[^"'\s\)]*/i
      );
      if (cm2) cover = cm2[0];
    }
    if (!cover) {
      const cm3 = html.match(
        /https?:\/\/icdn\.123av\.me\/img2\/s360\/[^"'\s\)]+cover\.jpg[^"'\s\)]*/i
      );
      if (cm3) cover = cm3[0].replace('/s360/', '/s500/');
    }
    cover = t(cover).replace(/[)'"]+$/, '');

    // REX 模式：detail 时直接 resolve 到 m3u8 真实地址（逐个线路尝试）
    const embeds = extractEmbeds(html);
    let streamUrl = '';
    let embedOrigin = '';
    for (const e of embeds) {
      try {
        const s = await resolveStream(e.url);
        if (s) {
          streamUrl = s;
          const om = String(e.url).match(/^(https?:\/\/[^/]+)/);
          embedOrigin = om ? om[1] : '';
          break;
        }
      } catch (err) {}
    }
    // vod_play_url 放 JSON{url, origin}：m3u8 有 Referer 检查，必须用 embed 源站的 Referer/Origin 才能 200
    const vodPlayUrl = streamUrl
      ? `播放$${JSON.stringify({ url: streamUrl, origin: embedOrigin })}`
      : embeds.map((e) => `${e.name}$${JSON.stringify({ url: e.url, embed: 1 })}`).join('#');

    const item = {
      vod_id: 'javxx:' + path,
      vod_name: title,
      vod_pic: cover,
      vod_play_from: NAME,
      vod_play_url: vodPlayUrl,
    };
    if (item.vod_name && item.vod_play_url) subRegister(rawId, item);
    list.push(item);
  }
  return { list };
}

async function play(reqIn) {
  const body = reqIn?.body || {};
  const id = String(Array.isArray(body.id) ? body.id[0] : body.id || '');
  const raw = t(id);
  if (!raw) return { parse: 0, url: '' };
  const subsP = subSearchAll(subNormKey(raw)).catch(() => []);

  // 解析 vod_play_url 的 JSON 负载
  let payload = null;
  if (raw.startsWith('{')) {
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      payload = null;
    }
  }

  // 情形1：detail 已 resolve 到 m3u8（带 origin）
  if (payload && payload.url && /\.m3u8(\?|$)/i.test(payload.url)) {
    const origin = t(payload.origin);
    const header = origin
      ? { 'User-Agent': UA, Referer: origin + '/', Origin: origin, Accept: '*/*' }
      : { 'User-Agent': UA, Referer: HOST + '/' + LANG + '/' };
    return subAttach({ parse: 0, url: payload.url, header }, subsP);
  }

  // 情形2：纯 m3u8 字符串（兼容旧格式）
  if (/\.m3u8(\?|$)/i.test(raw)) {
    return subAttach({
      parse: 0,
      url: raw,
      header: { 'User-Agent': UA, Referer: HOST + '/' + LANG + '/' },
    }, subsP);
  }

  // 情形3：仍是 embed 地址则实时解析
  const embedUrl = payload && payload.url ? payload.url : raw;
  const stream = await resolveStream(embedUrl);
  if (!stream) return { parse: 0, url: '', message: '未获取到播放地址' };
  return subAttach({
    parse: 0,
    url: stream,
    header: playHeadersForEmbed(embedUrl),
  }, subsP);
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

export default function spider() {
  return {
    meta: { key: KEY, name: NAME, type: 3 },
    api: async (fastify) => {
      fastify.post('/init', async () => ({}));
      fastify.post('/home', home);
      fastify.post('/category', category);
      fastify.post('/detail', detail);
      fastify.post('/play', play);
      fastify.post('/search', search);
    },
  };
}
