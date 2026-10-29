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
      { type_id: 'genres/solowork', type_name: 'Solowork' },
      { type_id: 'genres/creampie', type_name: '中出' },
      { type_id: 'genres/big-tits', type_name: '巨乳' },
      { type_id: 'genres/married-womanhousewife', type_name: '已婚女性/家庭主妇' },
      { type_id: 'genres/amateur', type_name: '业余' },
      { type_id: 'genres/high-vision', type_name: '高视力' },
      { type_id: 'genres/e22f5b4c15', type_name: '口交' },
      { type_id: 'genres/beautiful-girl', type_name: '美丽的女孩' },
      { type_id: 'genres/beautiful-breasts', type_name: '美丽的乳房' },
      { type_id: 'genres/slender', type_name: '苗条' },
      { type_id: 'genres/gonzo', type_name: '哈梅哈' },
      { type_id: 'genres/slut', type_name: '荡妇' },
      { type_id: 'genres/threesome-foursome', type_name: '3P/4P' },
      { type_id: 'genres/squirting', type_name: '喷出' },
      { type_id: 'genres/digimo', type_name: '数字的' },
      { type_id: 'genres/cuckold-cuckolded-ntr', type_name: '乌龟, 乌龟, Ntr' },
      { type_id: 'genres/exclusive', type_name: '独家的' },
      { type_id: 'genres/over-4-hours', type_name: '4小时或以上' },
      { type_id: 'genres/paizuri', type_name: '乳交' },
      { type_id: 'genres/cowgirl', type_name: '女牛仔' },
      { type_id: 'genres/competitive-swimmingschool-swimwear', type_name: '竞技游泳/学校泳衣' },
      { type_id: 'genres/lewdhard', type_name: '淫秽/硬核' },
      { type_id: 'genres/facial', type_name: '面部的' },
      { type_id: 'genres/shaved-pussy', type_name: '排盘' },
      { type_id: 'genres/drama', type_name: '戏剧' },
      { type_id: 'genres/schoolgirl', type_name: '女学生' },
      { type_id: 'genres/older-sister', type_name: '姐姐' },
      { type_id: 'genres/handjob', type_name: '手淫' },
      { type_id: 'genres/big-ass', type_name: '大屁股' },
      { type_id: 'genres/planning', type_name: '规划' },
      { type_id: 'genres/masturbation', type_name: '手淫' },
      { type_id: 'genres/adultery', type_name: '事务' },
      { type_id: 'genres/mousozoku', type_name: '妄想集团' },
      { type_id: 'genres/nampa', type_name: '捡起' },
      { type_id: 'genres/cunnilingus', type_name: '舔阴' },
      { type_id: 'genres/documentary', type_name: '记录' },
      { type_id: 'genres/incest', type_name: '乱伦' },
      { type_id: 'genres/7889ef8307', type_name: '角色扮演' },
      { type_id: 'genres/humiliation', type_name: '屈辱' },
      { type_id: 'genres/bareback', type_name: '无套' },
      { type_id: 'genres/sex-toys', type_name: '玩具' },
      { type_id: 'genres/female-college-student', type_name: '大学女生' },
      { type_id: 'genres/deep-throat', type_name: '伊拉马乔' },
      { type_id: 'genres/beautiful-buttocks', type_name: '美丽的臀部' },
      { type_id: 'genres/ol', type_name: '奥尔' },
      { type_id: 'genres/gal', type_name: '加尔' },
      { type_id: 'genres/uniform', type_name: '制服' },
      { type_id: 'genres/orgy', type_name: '狂欢' },
      { type_id: 'genres/voyeurismpeeping', type_name: '偷窥癖' },
      { type_id: 'genres/shame', type_name: '耻辱' },
      { type_id: 'genres/other-fetishes', type_name: '其他恋物癖' },
      { type_id: 'genres/kisskiss', type_name: '吻' },
      { type_id: 'genres/anal', type_name: '肛门' },
      { type_id: 'genres/debut-work', type_name: '处女作' },
      { type_id: 'genres/butt-fetish', type_name: '屁股恋物癖' },
      { type_id: 'genres/idolcelebrity', type_name: '偶像和名人' },
      { type_id: 'genres/beautiful-legs', type_name: '美丽的双腿' },
      { type_id: 'genres/dirty-talk', type_name: '脏话' },
      { type_id: 'genres/restraint', type_name: '克制' },
      { type_id: 'genres/bestcompilation', type_name: '最佳/合辑' },
      { type_id: 'genres/acme-orgasm', type_name: '极致高潮' },
      { type_id: 'genres/small-breaststiny-breasts', type_name: '小乳房' },
      { type_id: 'genres/gulp', type_name: '吞' },
      { type_id: 'genres/lotion', type_name: '乳液/油' },
      { type_id: 'genres/bukkake', type_name: '颜射' },
      { type_id: 'genres/mother', type_name: '母亲' },
      { type_id: 'genres/club-hostess-sex-worker', type_name: '女主人, 妓女' },
      { type_id: 'genres/electric-machine', type_name: '电动按摩器' },
      { type_id: 'genres/massage-reflex', type_name: '按摩和茶点' },
      { type_id: 'genres/subjectivity', type_name: '主观' },
      { type_id: 'genres/vibrator', type_name: '氛围' },
      { type_id: 'genres/minimal-mosaic', type_name: '吉里莫扎' },
      { type_id: 'genres/pornstar', type_name: '色情明星' },
      { type_id: 'genres/finger-fuck', type_name: '指法' },
      { type_id: 'genres/back', type_name: '后退' },
      { type_id: 'genres/pantyhosetights', type_name: '连裤袜和紧身裤' },
      { type_id: 'genres/f0f0e4571c', type_name: '女同性恋' },
      { type_id: 'genres/sm', type_name: '钐' },
      { type_id: 'genres/older-sisteryounger-sister', type_name: '姐姐' },
      { type_id: 'genres/14bfa6bb14', type_name: '六九' },
      { type_id: 'genres/school-uniform', type_name: '校服' },
      { type_id: 'genres/bondage', type_name: '束缚' },
      { type_id: 'genres/various-occupations', type_name: '各种职业' },
      { type_id: 'genres/chubby', type_name: '波恰里' },
      { type_id: 'genres/female-teacher', type_name: '女教师' },
      { type_id: 'genres/urinationwetting', type_name: '撒尿/撒尿' },
      { type_id: 'genres/big-dickhuge-dick', type_name: '大鸡巴' },
      { type_id: 'genres/outdoorexposed', type_name: '户外/暴露' },
      { type_id: 'genres/young-wifeyoung-wife', type_name: '年轻的妻子' },
      { type_id: 'genres/beauty-salon', type_name: '美学' },
      { type_id: 'genres/swimsuit', type_name: '泳衣' },
      { type_id: 'genres/virginity', type_name: '处女' },
      { type_id: 'genres/tall', type_name: '高的' },
      { type_id: 'genres/mouth-cumshot', type_name: '口交射精' },
      { type_id: 'genres/fair-skin', type_name: '白皙的皮肤' },
      { type_id: 'genres/big-breast-fetish', type_name: '巨乳恋物癖' },
      { type_id: 'genres/m-man', type_name: 'M-Man' },
      { type_id: 'genres/vr-only', type_name: '仅限虚拟现实' },
      { type_id: 'genres/lolichildlike-look', type_name: '萝莉/童趣外貌' },
      { type_id: 'genres/sweaty', type_name: '出汗' },
      { type_id: 'genres/hot-spring', type_name: '温泉' },
      { type_id: 'genres/beautybeautiful-woman', type_name: '美女/漂亮女人' },
      { type_id: 'genres/nursenurse', type_name: '护士' },
      { type_id: 'genres/image-video', type_name: '图片视频' },
      { type_id: 'genres/cute-1', type_name: '可爱的' },
      { type_id: 'genres/devil', type_name: '残忍的' },
      { type_id: 'genres/age-bracket-30s40setc', type_name: '年龄段（30岁/40岁/等等）' },
      { type_id: 'genres/lingerie', type_name: '内衣' },
      { type_id: 'genres/panty-shots', type_name: 'Panchira' },
      { type_id: 'genres/vr', type_name: 'Vr' },
      { type_id: 'genres/m-woman', type_name: 'M女人' },
      { type_id: 'genres/foot-fetish', type_name: '恋腿癖' },
      { type_id: 'genres/petite', type_name: '娇小' },
      { type_id: 'genres/neat', type_name: '整洁的' },
      { type_id: 'genres/kimono', type_name: '日式服装/浴衣' },
      { type_id: 'genres/mini-series', type_name: '小型的' },
      { type_id: 'genres/emmanuelle', type_name: '伊曼纽尔' },
      { type_id: 'genres/drag', type_name: '拖' },
      { type_id: 'genres/mother-in-law', type_name: '岳母' },
      { type_id: 'genres/super-milk', type_name: '巨大的乳房' },
      { type_id: 'genres/face-sitting', type_name: '颜面骑乘' },
      { type_id: 'genres/glasses', type_name: '眼镜' },
      { type_id: 'genres/harem', type_name: '后宫' },
      { type_id: 'genres/lesbian-kissing', type_name: '女同之吻' },
      { type_id: 'genres/8kvr', type_name: '8Kvr' },
      { type_id: 'genres/sailor-suit', type_name: '水手服' },
      { type_id: 'genres/virgin-1', type_name: '处女' },
      { type_id: 'genres/maid', type_name: '女佣' },
      { type_id: 'genres/couple', type_name: '夫妻' },
      { type_id: 'genres/footjob', type_name: '足交' },
      { type_id: 'genres/close-up', type_name: '特写' },
      { type_id: 'genres/high-quality-vr', type_name: '高品质虚拟现实' },
      { type_id: 'genres/shemale', type_name: '新一半' },
      { type_id: 'genres/mischief', type_name: '恶作剧' },
      { type_id: 'genres/immediate-saddle', type_name: '立即的' },
      { type_id: 'genres/confinement', type_name: '禁闭' },
      { type_id: 'genres/cross-dressingmale-girl', type_name: '变装/男孩' },
      { type_id: 'genres/gym-clothes-bloomers', type_name: '运动服/灯笼裤' },
      { type_id: 'genres/bitch', type_name: '贱人' },
      { type_id: 'genres/black-hair', type_name: '黑发' },
      { type_id: 'genres/actress-best-compilation', type_name: '最佳女主角合辑' },
      { type_id: 'genres/bath', type_name: '洗澡' },
      { type_id: 'genres/multiple-episodes', type_name: '多个故事' },
      { type_id: 'genres/erotic-wear', type_name: '情趣服装' },
      { type_id: 'genres/female-boss', type_name: '女老板' },
      { type_id: 'genres/impregnate', type_name: '怀孕' },
      { type_id: 'genres/health-soap', type_name: '健康香皂' },
      { type_id: 'genres/post', type_name: '帖子' },
      { type_id: 'genres/drinking-party', type_name: '酒会/约会' },
      { type_id: 'genres/black-actor', type_name: '黑人演员' },
      { type_id: 'genres/miniskirt', type_name: '超短裙' },
      { type_id: 'genres/enema', type_name: '灌肠剂' },
      { type_id: 'genres/love-affair', type_name: '爱' },
      { type_id: 'genres/dvd-toaster', type_name: 'Dvd 烤面包机' },
      { type_id: 'genres/original-collaboration', type_name: '原创合作' },
      { type_id: 'genres/female-investigator', type_name: '女调查员' },
      { type_id: 'genres/model', type_name: '模型' },
      { type_id: 'genres/dating', type_name: '日期' },
      { type_id: 'genres/school-stuff', type_name: '学校用品' },
      { type_id: 'genres/tutor', type_name: '私人教师' },
      { type_id: 'genres/lesbian', type_name: '女同性恋' },
      { type_id: 'genres/sports', type_name: '运动的' },
      { type_id: 'genres/fan-appreciation-home-visit', type_name: '粉丝欣赏/访问' },
      { type_id: 'genres/torture', type_name: '酷刑' },
      { type_id: 'genres/stewardess', type_name: '空中小姐' },
      { type_id: 'genres/sunburn', type_name: '晒斑' },
      { type_id: 'genres/others', type_name: '其他' },
      { type_id: 'genres/shota', type_name: '翔太' },
      { type_id: 'genres/white-actress', type_name: '白人女演员' },
      { type_id: 'genres/sexy', type_name: '性感' },
      { type_id: 'genres/widow', type_name: '寡妇' },
      { type_id: 'genres/ladydaughter', type_name: '女士' },
      { type_id: 'genres/baby-facechildlike-face', type_name: '婴儿脸/稚嫩脸' },
      { type_id: 'genres/hotel', type_name: '酒店' },
      { type_id: 'genres/delusion', type_name: '妄想' },
      { type_id: 'genres/rotor', type_name: '转子' },
      { type_id: 'genres/childhood-friend', type_name: '年轻的纳吉米' },
      { type_id: 'genres/leotards', type_name: '紧身衣' },
      { type_id: 'genres/female-announcer', type_name: '女性安娜' },
      { type_id: 'genres/secretary', type_name: '秘书' },
      { type_id: 'genres/business-attire', type_name: '商务套装' },
      { type_id: 'genres/for-women', type_name: '对女性来说' },
      { type_id: 'genres/reverse-number', type_name: '反向 Nan' },
      { type_id: 'genres/manguripiledriver-position', type_name: '芒古里/打桩机位置' },
      { type_id: 'genres/special-effects', type_name: '特殊效果' },
      { type_id: 'genres/bunny-girl', type_name: '兔女郎' },
      { type_id: 'genres/breast-milk', type_name: '母乳' },
      { type_id: 'genres/hairypubic-hair', type_name: '阴毛' },
      { type_id: 'genres/female-doctor', type_name: '女医生' },
      { type_id: 'genres/drinking-urine', type_name: '喝尿' },
      { type_id: 'genres/innocent', type_name: '清白的' },
      { type_id: 'genres/dildo', type_name: '假阳具' },
      { type_id: 'genres/subordinatescolleagues', type_name: '下属/同事' },
      { type_id: 'genres/man-squirting', type_name: '男性潮吹' },
      { type_id: 'genres/instructor', type_name: '讲师' },
      { type_id: 'genres/short-hair', type_name: '短发' },
      { type_id: 'genres/muscle', type_name: '肌肉' },
      { type_id: 'genres/waist', type_name: '腰部' },
      { type_id: 'genres/portio', type_name: '波尔基奥' },
      { type_id: 'genres/foreign-object-insertion', type_name: '异物插入' },
      { type_id: 'genres/no-bra', type_name: '诺布拉' },
      { type_id: 'genres/car-sex', type_name: '汽车性爱' },
      { type_id: 'genres/nice-bodygreat-style', type_name: '身材好/风格很棒' },
      { type_id: 'genres/travel', type_name: '旅行' },
      { type_id: 'genres/7520ed52ed', type_name: '美臀' },
      { type_id: 'genres/actionfighting', type_name: '动作/格斗' },
      { type_id: 'genres/sex-position-misc', type_name: '性爱姿势（其他）' },
      { type_id: 'genres/race-queen', type_name: '赛车皇后' },
      { type_id: 'genres/western-pinsoverseas-imports', type_name: '西部别针和进口商品' },
      { type_id: 'genres/cusco', type_name: '楠子' },
      { type_id: 'genres/white-of-the-eyesfainting', type_name: '眼白/昏厥' },
      { type_id: 'genres/athlete', type_name: '运动员' },
      { type_id: 'genres/onasapo', type_name: 'Ona 支持' },
      { type_id: 'genres/proprietress-landlady', type_name: '女房东/情妇' },
      { type_id: 'genres/hospitalclinic', type_name: '医院和诊所' },
      { type_id: 'genres/tsundere', type_name: '傲娇' },
      { type_id: 'genres/spanking', type_name: '打屁股' },
      { type_id: 'genres/naked-apron', type_name: '裸体围裙' },
      { type_id: 'genres/rape', type_name: '强奸' },
      { type_id: 'genres/fantasy', type_name: '幻想' },
      { type_id: 'genres/long-hair', type_name: '长发' },
      { type_id: 'genres/beautiful-skinwhitening', type_name: '美白肌肤' },
      { type_id: 'genres/daughteradoptive-daughter', type_name: '女儿/养女' },
      { type_id: 'genres/aunt', type_name: '阿姨' },
      { type_id: 'genres/molesterchikan', type_name: '性骚扰者/痴汉' },
      { type_id: 'genres/knee-socks', type_name: '及膝袜' },
      { type_id: 'genres/ff46e22870', type_name: '荣耀探索 40% 折扣促销' },
      { type_id: 'genres/vip', type_name: 'Vip' },
      { type_id: 'genres/58fc0c7a98', type_name: '原始性爱' },
      { type_id: 'genres/queen', type_name: '情妇' },
      { type_id: 'genres/dance', type_name: '舞蹈' },
      { type_id: 'genres/club-activities-manager', type_name: '俱乐部/经理' },
      { type_id: 'genres/bodycon', type_name: '紧身连衣裙' },
      { type_id: 'genres/cat-earsbeast-type', type_name: '猫耳/动物' },
      { type_id: 'genres/fist', type_name: '拳头' },
      { type_id: 'genres/bride', type_name: '新娘' },
      { type_id: 'genres/teenyoung-18', type_name: '青少年/青年（18岁以上）' },
      { type_id: 'genres/female-warrior', type_name: '女战士' },
      { type_id: 'genres/pregnant-woman', type_name: '孕妇' },
      { type_id: 'genres/premature-ejaculation', type_name: '早泄' },
      { type_id: 'genres/dc863e2c60', type_name: '美丽' },
      { type_id: 'genres/pervert', type_name: '变态' },
      { type_id: 'genres/eb19a4e304', type_name: '可爱的' },
      { type_id: 'genres/sod3040', type_name: 'SOD30周年40%オフセール' },
      { type_id: 'genres/av-3', type_name: 'AV女優' },
      { type_id: 'genres/action', type_name: '行动' },
      { type_id: 'genres/brutal-expression', type_name: '残酷' },
      { type_id: 'genres/grandfather', type_name: '爷爷' },
      { type_id: 'genres/time-stop', type_name: '时间停止' },
      { type_id: 'genres/transformation-heroine', type_name: '变身女主角' },
      { type_id: 'genres/how-to', type_name: '如何' },
      { type_id: 'genres/soft-body', type_name: '软体' },
      { type_id: 'genres/asian-actresses', type_name: '亚洲女演员' },
      { type_id: 'genres/high-sensitivity', type_name: '高灵敏度' },
      { type_id: 'genres/puke', type_name: '呕吐' },
      { type_id: 'genres/scatology', type_name: '粪便' },
      { type_id: 'genres/sokkurisan', type_name: '索库里山' },
      { type_id: 'genres/blonde', type_name: '金发女郎' },
      { type_id: 'genres/nipple-slip', type_name: '乳房闪烁' },
      { type_id: 'genres/interview', type_name: '面试' },
      { type_id: 'genres/no-panties', type_name: '无裤' },
      { type_id: 'genres/celebrity', type_name: '名人' },
      { type_id: 'genres/swapping', type_name: '交换' },
      { type_id: 'genres/nipple-play', type_name: '乳头游戏' },
      { type_id: 'genres/dark-skin', type_name: '深色皮肤' },
      { type_id: 'genres/sex-changefeminization', type_name: '性别弯曲/女性化' },
      { type_id: 'genres/breeding', type_name: '选育' },
      { type_id: 'genres/drunk', type_name: '醉' },
      { type_id: 'genres/tickling', type_name: '楠' },
      { type_id: 'genres/m', type_name: 'M' },
      { type_id: 'genres/defecation', type_name: '排便' },
      { type_id: 'genres/campaign-girl', type_name: '糖果' },
      { type_id: 'genres/anal-sex', type_name: '肛交' },
      { type_id: 'genres/waitress', type_name: '女服务员' },
      { type_id: 'genres/a632acd889', type_name: '美丽的女人' },
      { type_id: 'genres/dark-system', type_name: '黑暗的' },
      { type_id: 'genres/nose-hook', type_name: '鼻钩' },
      { type_id: 'genres/loose-socks', type_name: '宽松的袜子' },
      { type_id: 'genres/sumata-non-penetrative', type_name: '苏玛塔（非穿透性）' },
      { type_id: 'genres/nationality-taiwanrussiahalf', type_name: '国籍（台湾/俄罗斯/混血）' },
      { type_id: 'genres/limited-time-sale', type_name: '限时促销' },
      { type_id: 'genres/abuse', type_name: '侮辱' },
      { type_id: 'genres/d10e314b86', type_name: '巨乳キャンペーン' },
      { type_id: 'genres/mask-mask', type_name: '面具' },
      { type_id: 'genres/b0e982044a', type_name: 'アナルセックス(男ノ娘)' },
      { type_id: 'genres/mom-friend', type_name: '妈妈的朋友' },
      { type_id: 'genres/b660a1357d', type_name: '口射' },
      { type_id: 'genres/beautiful-pussy', type_name: '美丽的猫咪' },
      { type_id: 'genres/futanari', type_name: '双成' },
      { type_id: 'genres/cheongsam-dress', type_name: '中式服饰' },
      { type_id: 'genres/anime-characters', type_name: '动漫人物' },
      { type_id: 'genres/breasts-generic-ungraded', type_name: '乳房（通用，未分级）' },
      { type_id: 'genres/otaku', type_name: '御宅族' },
      { type_id: 'genres/limited-to-fanza-distribution', type_name: 'Fanza独家' },
      { type_id: 'genres/foreigner', type_name: '外国人' },
      { type_id: 'genres/de76af0a33', type_name: '2次射精' },
      { type_id: 'genres/1e15769cb4', type_name: 'Delusional Tribe - Emmanuel 40% 折扣促销' },
      { type_id: 'genres/receptionist', type_name: '接待员' },
      { type_id: 'genres/doll', type_name: '玩具娃娃' },
      { type_id: 'genres/yoga', type_name: '瑜伽' },
      { type_id: 'genres/brown-hair', type_name: '棕色头发' },
      { type_id: 'genres/candle', type_name: '蜡烛' },
      { type_id: 'genres/4aed778d5c', type_name: 'Next Group感恩节促销，全场40%折扣' },
      { type_id: 'genres/cheerleader', type_name: '啦啦队女孩' },
      { type_id: 'genres/82688fd853', type_name: '20岁' },
      { type_id: 'genres/tentacles', type_name: '触手' },
      { type_id: 'genres/gag-comedy', type_name: '搞笑喜剧' },
      { type_id: 'genres/grandma', type_name: '奶奶' },
      { type_id: 'genres/companion', type_name: '伴侣' },
      { type_id: 'genres/cny', type_name: '前偶像' },
      { type_id: 'genres/73ea7f13a9', type_name: '一日拍摄' },
      { type_id: 'genres/417110abc4', type_name: '可爱的' },
      { type_id: 'genres/g-1', type_name: 'G罩杯' },
      { type_id: 'genres/hairstyle-twintailponytailbob', type_name: '发型（双马尾/马尾/波波头）' },
      { type_id: 'genres/ae186fcf7f', type_name: '洛丽塔类型' },
      { type_id: 'genres/bus-tour-guide', type_name: '巴士指南' },
      { type_id: 'genres/06bec123a2', type_name: '胸部' },
      { type_id: 'genres/sci-fi', type_name: '科幻小说' },
      { type_id: 'genres/shrine-maiden', type_name: '巫女' },
      { type_id: 'genres/a815466d96', type_name: '手淫' },
      { type_id: 'genres/martial-artist', type_name: '战斗机' },
      { type_id: 'genres/s', type_name: 'S 女人' },
      { type_id: 'genres/3d', type_name: '3D' },
      { type_id: 'genres/blindfold', type_name: '眼罩' },
      { type_id: 'genres/indies', type_name: '印度群岛' },
      { type_id: 'genres/beauty', type_name: '美丽' },
      { type_id: 'genres/hypnosisbrainwashing', type_name: '催眠/洗脑' },
      { type_id: 'genres/over-16-hours', type_name: '16+小时' },
      { type_id: 'genres/w', type_name: 'W形手指人' },
      { type_id: 'genres/set-product', type_name: '套装产品' },
      { type_id: 'genres/magical-girl', type_name: '魔法少女' },
      { type_id: 'genres/reprint', type_name: '重印' },
      { type_id: 'genres/kunoichi', type_name: '女野市' },
      { type_id: 'genres/4k', type_name: '4K拍摄' },
      { type_id: 'genres/av-open-2014-heavyweight', type_name: '2014年Av公开赛重量级' },
      { type_id: 'genres/seasonalholiday', type_name: '季节性/节日' },
      { type_id: 'genres/2116ccf696-1', type_name: '偶像' },
      { type_id: 'genres/9e108af5d0', type_name: '没有任何' },
      { type_id: 'genres/f-1', type_name: 'F罩杯' },
      { type_id: 'genres/716b636399', type_name: '额外赠送' },
      { type_id: 'genres/b30c1a985e', type_name: '生的' },
      { type_id: 'genres/33a0e9d009-1', type_name: '粗硬的头发' },
      { type_id: 'genres/confession-of-experience', type_name: '体验告白' },
      { type_id: 'genres/d97496ec3b', type_name: '口交' },
      { type_id: 'genres/neglect', type_name: '弃' },
      { type_id: 'genres/3144284b4b', type_name: '传教士职位' },
      { type_id: 'genres/9198b827fe', type_name: '西德克' },
      { type_id: 'genres/b1b332b734', type_name: '两次射精' },
      { type_id: 'genres/30', type_name: '30年代' },
      { type_id: 'genres/firststar40-1', type_name: 'マーキュリー・FirstStar・ワー40%オフセール' },
      { type_id: 'genres/medium-hair', type_name: '中型头发' },
      { type_id: 'genres/tattoo', type_name: '纹身' },
      { type_id: 'genres/e-1', type_name: 'E杯' },
      { type_id: 'genres/fc43e2da49', type_name: '美丽的肌肤' },
      { type_id: 'genres/av-open-2014-middle-class', type_name: '2014年Av Open中级' },
      { type_id: 'genres/70d2b9a4d3', type_name: '小胸' },
      { type_id: 'genres/f5627f945b', type_name: '伊卡斯游戏' },
      { type_id: 'genres/av-open-2015-planning-division', type_name: '2015年Av公开企划部' },
      { type_id: 'genres/coprophagy', type_name: '食粪行为' },
      { type_id: 'genres/511ff31f89', type_name: '恭喜你成年啦！成年人专享40%折扣！' },
      { type_id: 'genres/firststar40', type_name: 'Mercury、Firststar，40% 折扣促销' },
      { type_id: 'genres/4aa5600cd7', type_name: '小胸' },
      { type_id: 'genres/boyish', type_name: '偏干' },
      { type_id: 'genres/dialect', type_name: '方言' },
      { type_id: 'genres/2ee8e88780', type_name: '一镜到底' },
      { type_id: 'genres/1ff879de5d', type_name: '敏感的' },
      { type_id: 'genres/horror', type_name: '恐怖' },
      { type_id: 'genres/ca', type_name: '钙' },
      { type_id: 'genres/ab6c23aea2', type_name: '过去 1' },
      { type_id: 'genres/edging', type_name: '埃布利' },
      { type_id: 'genres/c08a240662-1', type_name: 'ディスクオンデマンドセール' },
      { type_id: 'genres/2de202ecda', type_name: '尊享冬季庆典 - 最高可享50%折扣' },
      { type_id: 'genres/v-cinema', type_name: 'V-影院' },
      { type_id: 'genres/b48b612c43', type_name: '怀孕' },
      { type_id: 'genres/40-4', type_name: '妄想族・エマニエル40%オフセール' },
      { type_id: 'genres/h-1', type_name: 'H罩杯' },
      { type_id: 'genres/40-2', type_name: 'プレステージ40%オフセール' },
      { type_id: 'genres/v', type_name: '虚拟主播' },
      { type_id: 'genres/curly-hair', type_name: '卷发' },
      { type_id: 'genres/4ac27f00cf', type_name: '高的' },
      { type_id: 'genres/89a5a51891', type_name: '全球媒体 40% 折扣促销' },
      { type_id: 'genres/collaboration-work', type_name: '合作作品' },
      { type_id: 'genres/19', type_name: '19岁' },
      { type_id: 'genres/3c4e72db34', type_name: 'Ipoke 活动' },
      { type_id: 'genres/06ae3252c9', type_name: '一半在外面，一半在里面' },
      { type_id: 'genres/70ecf2ba69', type_name: '娃娃脸' },
      { type_id: 'genres/18', type_name: '18岁' },
      { type_id: 'genres/6f61b9f992', type_name: '天真（幼稚）型' },
      { type_id: 'genres/420073d82a', type_name: '第二轮' },
      { type_id: 'genres/bondage-1', type_name: '束缚' },
      { type_id: 'genres/6f4922f455', type_name: '18' },
      { type_id: 'genres/72c9b14385', type_name: '原始射精' },
      { type_id: 'genres/de0737b86a', type_name: '阴毛' },
      { type_id: 'genres/027267b1e5', type_name: '变态' },
      { type_id: 'genres/threesome-foursome-1', type_name: 'Threesome / Foursome' },
      { type_id: 'genres/av-open-2015-maniafetish-section', type_name: 'Av Open 2015 狂热/恋物癖部分' },
      { type_id: 'genres/c08a240662', type_name: '按需折扣促销' },
      { type_id: 'genres/high-heels-1', type_name: '高跟鞋' },
      { type_id: 'genres/8bc0a4b00d', type_name: '3次射精' },
      { type_id: 'genres/paradise-tv', type_name: '天堂电视台' },
      { type_id: 'genres/av-open-2016-dramadocumentary-category', type_name: 'Av Open 2016 剧情/纪录片类' },
      { type_id: 'genres/3dbdbd029d', type_name: '曼古里盖什' },
      { type_id: 'genres/57f900cfa6', type_name: '生哈梅' },
      { type_id: 'genres/gay', type_name: '同性恋' },
      { type_id: 'genres/av-open-2016-maniafetish-section', type_name: 'Av Open 2016 疯狂/恋物部分' },
      { type_id: 'genres/e538d644dd', type_name: '连续两次射精' },
      { type_id: 'genres/59b6cd8984', type_name: 'Prestige 40% 折扣促销' },
      { type_id: 'genres/3151a87f89', type_name: '吻' },
      { type_id: 'genres/68ef1e67bd', type_name: '真正的奶油派' },
      { type_id: 'genres/9eb330fb55', type_name: '2 发' },
      { type_id: 'genres/av-open-2015-smhard', type_name: '2015 年 Av Open 小型/硬式' },
      { type_id: 'genres/0262798b1a', type_name: '奇帕伊' },
      { type_id: 'genres/285f1d32d0', type_name: '阴毛' },
      { type_id: 'genres/5197f94a8c', type_name: '绝佳风格' },
      { type_id: 'genres/mgs', type_name: 'Mgs独家花絮' },
      { type_id: 'genres/miniskirt-police', type_name: '米尼斯卡波利斯' },
      { type_id: 'genres/gothic-lolita', type_name: '哥特洛丽塔' },
      { type_id: 'genres/40', type_name: 'ネクストグループ感謝祭40%オフセール' },
      { type_id: 'genres/avopen2016', type_name: 'Avopen2016 策划部' },
      { type_id: 'genres/av-open-2018-maniafetish-section', type_name: '2018 年 Av 公开赛狂热/恋物癖部分' },
      { type_id: 'genres/af3731b1a3', type_name: '大屁股' },
      { type_id: 'genres/68a853de7e', type_name: '萝莉' },
      { type_id: 'genres/av-open-2016-amateur-division', type_name: '2016年Av公开赛业余组' },
      { type_id: 'genres/6000752b01', type_name: '舔乳头' },
      { type_id: 'genres/40-3', type_name: '40年代' },
      { type_id: 'genres/av-open-2015-maiden-division', type_name: '2015年Av公开赛青少年组' },
      { type_id: 'genres/av-open-2016-planning-division', type_name: '2016年Av公开企划部' },
      { type_id: 'genres/29b54e86a8', type_name: '大约40' },
      { type_id: 'genres/7af2301034', type_name: '初井' },
      { type_id: 'genres/360356cc66', type_name: '未公开' },
      { type_id: 'genres/1ac199e19d', type_name: '无需分阶段' },
      { type_id: 'genres/ad615d068e', type_name: '难波大师' },
      { type_id: 'genres/princess', type_name: '公主' },
      { type_id: 'genres/92a5bfbda2', type_name: 'Nagae Style 40% 折扣促销' },
      { type_id: 'genres/sex', type_name: '晨间性爱' },
      { type_id: 'genres/60483a8c81', type_name: '单反' },
      { type_id: 'genres/d174f2fa2f', type_name: '土豆' },
      { type_id: 'genres/av-open-2015-actress-category', type_name: '2015年Av公开赛女演员组' },
      { type_id: 'genres/bdd6ddecb7', type_name: '施肥' },
      { type_id: 'genres/i-1', type_name: 'I罩杯' },
      { type_id: 'genres/20-2', type_name: '20岁' },
      { type_id: 'genres/m-2', type_name: '受虐狂' },
      { type_id: 'genres/981d556942', type_name: '美丽的身体' },
      { type_id: 'genres/288b949695', type_name: '额外赠送' },
      { type_id: 'genres/168e962cc7', type_name: '5次射精' },
      { type_id: 'genres/f3de6fe979', type_name: '伊卡塞' },
      { type_id: 'genres/av-open-2017-documentary-division', type_name: '2017年Av Open纪录片组' },
      { type_id: 'genres/79591548e5', type_name: 'Crystal Video 限时4折优惠' },
      { type_id: 'genres/a009caa7d8', type_name: '汗' },
      { type_id: 'genres/efb70a9ebd', type_name: '长的' },
      { type_id: 'genres/game-live-action', type_name: '真人游戏' },
      { type_id: 'genres/73b3fb2c7b', type_name: '情色的声音' },
      { type_id: 'genres/av-open-2016-hard-division', type_name: '2016年Av公开赛硬地组' },
      { type_id: 'genres/b193685f69', type_name: '伦雷科米' },
      { type_id: 'genres/6269f71c84', type_name: '连续两次射击' },
      { type_id: 'genres/av-open-2015-amateur-division', type_name: '2015年Av公开赛业余组' },
      { type_id: 'genres/e91247059d', type_name: '关系' },
      { type_id: 'genres/av-open-2016-actress-category', type_name: '2016年Av公开赛女演员组' },
      { type_id: 'genres/9ae6a51d56', type_name: '浴室' },
      { type_id: 'genres/9e5f956fbf', type_name: '勃起的阴茎' },
      { type_id: 'genres/1c26b087b6', type_name: '大屌' },
      { type_id: 'genres/av-open-2017-drama-division', type_name: '2017年Av Open戏剧组' },
      { type_id: 'genres/63d62e674c', type_name: '诺克佐里' },
      { type_id: 'genres/74045258fb', type_name: '打桩机' },
      { type_id: 'genres/40-1', type_name: 'ナガエスタイル40%オフセール' },
      { type_id: 'genres/a9e3de41ce', type_name: '潜望镜' },
      { type_id: 'genres/e1d1b6803a', type_name: '三十岁' },
      { type_id: 'genres/av-open-2017-mania-division', type_name: '2017 年 Av Open Mania 赛区' },
      { type_id: 'genres/with-benefits-av-baseball', type_name: '可用奖金(Avbaseball)' },
      { type_id: 'genres/eros', type_name: '爱神' },
      { type_id: 'genres/psycho-thriller', type_name: '心理惊悚片' },
      { type_id: 'genres/11e98d336a', type_name: '第二轮' },
      { type_id: 'genres/d4072c2279-1', type_name: '清白的' },
      { type_id: 'genres/1a84c82331', type_name: '连续两次射精' },
      { type_id: 'genres/e7a61bc461', type_name: '离婚' },
      { type_id: 'genres/ad7c62202d', type_name: '差距' },
      { type_id: 'genres/19772ca0cb', type_name: '车站便当（火车站便当盒）' },
      { type_id: 'genres/fb3e1c40c2', type_name: '黑色丝袜' },
      { type_id: 'genres/a8a35b28c7', type_name: '最可爱的' },
      { type_id: 'genres/5075d717b1', type_name: '性吸引力' },
      { type_id: 'genres/d-1', type_name: 'D罩杯' },
      { type_id: 'genres/e171e172a0', type_name: '神体' },
      { type_id: 'genres/4ff0077a46', type_name: '成人' },
      { type_id: 'genres/caffa39254', type_name: '双和平' },
      { type_id: 'genres/7922d155a1', type_name: '音乐系学生' },
      { type_id: 'genres/b6e4df7da5', type_name: '张口射精' },
      { type_id: 'genres/447f9b7430', type_name: '魅力四射' },
      { type_id: 'genres/188ac4f9d0', type_name: '性感内衣' },
      { type_id: 'genres/7644a5ef05', type_name: '美男子' },
      { type_id: 'genres/bb707bbfd7', type_name: 'Vibe（那个糟糕的）' },
      { type_id: 'genres/517f59875f', type_name: '全身渔网袜' },
      { type_id: 'genres/a02753a6b7', type_name: '眼罩' },
      { type_id: 'genres/45f6bdf642', type_name: '游泳俱乐部' },
      { type_id: 'genres/be98be125c', type_name: '溅' },
      { type_id: 'genres/anime', type_name: '日本动画片' },
      { type_id: 'genres/91438c2572', type_name: '乌贼' },
      { type_id: 'genres/fd8dfe8caa', type_name: '小脸' },
      { type_id: 'genres/68f8697c8c', type_name: '厨房' },
      { type_id: 'genres/bb1ee8eb76', type_name: '小阴唇' },
      { type_id: 'genres/c6ae14637d', type_name: '纯的' },
      { type_id: 'genres/a6dc80113e', type_name: '游戏' },
      { type_id: 'genres/20', type_name: '20多岁' },
      { type_id: 'genres/tiktok', type_name: '抖音' },
      { type_id: 'actresses/yui-hatano', type_name: 'Yui Hatano' },
      { type_id: 'actresses/shinoda-yu', type_name: 'Shinoda Yu' },
      { type_id: 'actresses/hibiki-ohtsuki', type_name: 'Hibiki Ohtsuki' },
      { type_id: 'actresses/hamazaki-mao', type_name: 'Hamazaki Mao' },
      { type_id: 'actresses/kana-morisawa-kanako-iioka', type_name: 'Kana Morisawa (Kanako Iioka)' },
      { type_id: 'actresses/ichika-matsumoto', type_name: 'Ichika Matsumoto' },
      { type_id: 'actresses/hasumi-claire', type_name: 'Hasumi Claire' },
      { type_id: 'actresses/niimura-akari', type_name: 'Niimura Akari' },
      { type_id: 'actresses/aika', type_name: 'Aika' },
      { type_id: 'actresses/mizuki-yayoi-1', type_name: 'Mizuki Yayoi' },
      { type_id: 'actresses/kobayakawa-reiko', type_name: 'Kobayakawa Reiko' },
      { type_id: 'actresses/waka-misono', type_name: 'Waka Misono' },
      { type_id: 'actresses/aki-sasaki', type_name: 'Aki Sasaki' },
      { type_id: 'actresses/julia', type_name: 'Julia' },
      { type_id: 'actresses/asahi-mizuno', type_name: 'Asahi Mizuno' },
      { type_id: 'actresses/kinoshita-himari-hanazawa-himari', type_name: 'Kinoshita Himari (Hanazawa Himari)' },
      { type_id: 'actresses/mitsuki-nagisa', type_name: 'Mitsuki Nagisa' },
      { type_id: 'actresses/yuu-kawakami-shizuku-morino', type_name: 'Yuu Kawakami (Shizuku Morino)' },
      { type_id: 'actresses/yumi-kazama', type_name: 'Yumi Kazama' },
      { type_id: 'actresses/akari-mitani', type_name: 'Akari Mitani' },
      { type_id: 'actresses/alice-otsu', type_name: 'Alice Otsu' },
      { type_id: 'actresses/minazuki-hikaru', type_name: 'Minazuki Hikaru' },
      { type_id: 'actresses/ayumi-shinoda', type_name: 'Ayumi Shinoda' },
      { type_id: 'actresses/kimishima-mio', type_name: 'Kimishima Mio' },
      { type_id: 'actresses/yuria-yoshine', type_name: 'Yuria Yoshine' },
      { type_id: 'actresses/sumire-kuramoto', type_name: 'Sumire Kuramoto' },
      { type_id: 'actresses/satsuki-ena', type_name: 'Satsuki Ena' },
      { type_id: 'actresses/aoi-kururugi', type_name: 'Aoi Kururugi' },
      { type_id: 'actresses/yui-tenma', type_name: 'Yui Tenma' },
      { type_id: 'actresses/oshikawa-yuri', type_name: 'Oshikawa Yuri' },
      { type_id: 'actresses/shota-chisato', type_name: 'S** Chisato' },
      { type_id: 'actresses/hana-haruna', type_name: 'Hana Haruna' },
      { type_id: 'actresses/rena-aoi', type_name: 'Rena Aoi' },
      { type_id: 'actresses/himesaki-hana', type_name: 'Himesaki Hana' },
      { type_id: 'actresses/kanna-misaki', type_name: 'Kanna Misaki' },
      { type_id: 'actresses/nene-tanaka', type_name: 'Nene Tanaka' },
      { type_id: 'actresses/tsubomi-1', type_name: 'Tsubomi' },
      { type_id: 'actresses/mei-satsuki', type_name: 'Mei Satsuki' },
      { type_id: 'actresses/miho-tsuno', type_name: 'Miho Tsuno' },
      { type_id: 'actresses/eimi-fukada', type_name: 'Eimi Fukada' },
      { type_id: 'actresses/arimura-nozomi', type_name: 'Arimura Nozomi' },
      { type_id: 'actresses/hinako-mori', type_name: 'Hinako Mori' },
      { type_id: 'actresses/hachino-tsubasa', type_name: 'Hachino Tsubasa' },
      { type_id: 'actresses/ai-mukai', type_name: 'Ai Mukai' },
      { type_id: 'actresses/mao-kurata', type_name: 'Mao Kurata' },
      { type_id: 'actresses/maki-kyoko', type_name: 'Maki Kyoko' },
      { type_id: 'actresses/hojo-asahi', type_name: 'Hojo Asahi' },
      { type_id: 'actresses/tsubaki-rika', type_name: 'Tsubaki Rika' },
      { type_id: 'actresses/ayaka-tomoda', type_name: 'Ayaka Tomoda' },
      { type_id: 'actresses/mina-kitano', type_name: 'Mina Kitano' },
      { type_id: 'actresses/shiina-sora', type_name: 'Shiina Sora' },
      { type_id: 'actresses/riho-fujimori', type_name: 'Riho Fujimori' },
      { type_id: 'actresses/sumire-kurokawa', type_name: 'Sumire Kurokawa' },
      { type_id: 'actresses/of-sato-momo-kato', type_name: 'Of Sato (Momo Kato)' },
      { type_id: 'actresses/takarada-monami', type_name: 'Takarada Monami' },
      { type_id: 'actresses/honoka-tsujii', type_name: 'Honoka Tsujii' },
      { type_id: 'actresses/jun-suehiro', type_name: 'Jun Suehiro' },
      { type_id: 'actresses/konno-hikaru', type_name: 'Konno Hikaru' },
      { type_id: 'actresses/natsu-tojo', type_name: 'Natsu Tojo' },
      { type_id: 'actresses/mari-rika', type_name: 'Mari Rika' },
      { type_id: 'actresses/jinguji-nao', type_name: 'Jinguji Nao' },
      { type_id: 'actresses/winter-love', type_name: 'Winter Love' },
      { type_id: 'actresses/really', type_name: 'Really' },
      { type_id: 'actresses/ruka-inaba', type_name: 'Ruka Inaba' },
      { type_id: 'actresses/mary-tachibana', type_name: 'Mary Tachibana' },
      { type_id: 'actresses/reiko-sawamura-honami-takasaka-masumi-takasaka-1', type_name: 'Reiko Sawamura (Honami Takasaka, Masumi Takasaka)' },
      { type_id: 'actresses/nanami-matsumoto', type_name: 'Nanami Matsumoto' },
      { type_id: 'actresses/yui-nagase', type_name: 'Yui Nagase' },
      { type_id: 'actresses/kasumi-tsukino', type_name: 'Kasumi Tsukino' },
      { type_id: 'actresses/shiori-tsukada', type_name: 'Shiori Tsukada' },
      { type_id: 'actresses/mihina-azumi-hina-nagai-mihina', type_name: 'Mihina (Azumi Hina, Nagai Mihina)' },
      { type_id: 'actresses/abe-mikako', type_name: 'Abe Mikako' },
      { type_id: 'actresses/nozomi-hazuki', type_name: 'Nozomi Hazuki' },
      { type_id: 'actresses/abeno-miku', type_name: 'Abeno Miku' },
      { type_id: 'actresses/yuuri-maina', type_name: 'Yuuri Maina' },
      { type_id: 'actresses/noa-eikawa', type_name: 'Noa Eikawa' },
      { type_id: 'actresses/kashiwagi-konatsu', type_name: 'Kashiwagi Konatsu' },
      { type_id: 'actresses/sayama-love', type_name: 'Sayama Love' },
      { type_id: 'actresses/ichijo-mio', type_name: 'Ichijo Mio' },
      { type_id: 'actresses/luna-tsukino', type_name: 'Luna Tsukino' },
      { type_id: 'actresses/tsubaki-kato-kaoru-natsuki', type_name: 'Tsubaki Kato (Kaoru Natsuki)' },
      { type_id: 'actresses/yuna-shiina', type_name: 'Yuna Shiina' },
      { type_id: 'actresses/kitagawa-erika', type_name: 'Kitagawa Erika' },
      { type_id: 'actresses/sarina-momonaga', type_name: 'Sarina Momonaga' },
      { type_id: 'actresses/non-kobana', type_name: 'Non Kobana' },
      { type_id: 'actresses/miu-arioka', type_name: 'Miu Arioka' },
      { type_id: 'actresses/shuri-atomi', type_name: 'Shuri Atomi' },
      { type_id: 'actresses/ayaka-mochizuki', type_name: 'Ayaka Mochizuki' },
      { type_id: 'actresses/mirai-sunohara', type_name: 'Mirai Sunohara' },
      { type_id: 'actresses/saki-okuda', type_name: 'Saki Okuda' },
      { type_id: 'actresses/oda-mako', type_name: 'Oda Mako' },
      { type_id: 'actresses/ai-uehara', type_name: 'Ai Uehara' },
      { type_id: 'actresses/suwon-miso', type_name: 'Suwon Miso' },
      { type_id: 'actresses/kawakami-nanami', type_name: 'Kawakami Nanami' },
      { type_id: 'actresses/arisa-hanyu', type_name: 'Arisa Hanyu' },
      { type_id: 'actresses/akiho-yoshizawa', type_name: 'Akiho Yoshizawa' },
      { type_id: 'actresses/kanou-flower', type_name: 'Kanou Flower' },
      { type_id: 'actresses/yurika-aoi', type_name: 'Yurika Aoi' },
      { type_id: 'actresses/lima-arai', type_name: 'Lima Arai' },
      { type_id: 'actresses/kanae-ruka', type_name: 'Kanae Ruka' },
      { type_id: 'makers/fc2', type_name: 'Fc2' },
      { type_id: 'makers/moodys', type_name: 'Moody\'s' },
      { type_id: 'makers/sod-create', type_name: 'Sod Create' },
      { type_id: 'makers/madonna', type_name: 'Madonna' },
      { type_id: 'makers/prestige', type_name: 'Prestige' },
      { type_id: 'makers/s1-number-one-style', type_name: 'S1 Number One Style' },
      { type_id: 'makers/tv', type_name: '电视机' },
      { type_id: 'makers/km-produce', type_name: 'K.m. Produce' },
      { type_id: 'makers/attackers', type_name: 'Attackers' },
      { type_id: 'makers/idea-pocket', type_name: 'Idea Pocket' },
      { type_id: 'makers/center-village', type_name: 'Center Village' },
      { type_id: 'makers/hunter', type_name: 'Hunter' },
      { type_id: 'makers/doc', type_name: 'Doc' },
      { type_id: 'makers/glory-quest', type_name: 'Glory Quest' },
      { type_id: 'makers/fitch', type_name: 'Fitch' },
      { type_id: 'makers/venus', type_name: 'Venus' },
      { type_id: 'makers/caribbeancom', type_name: '加勒比通讯' },
      { type_id: 'makers/honchu', type_name: 'Honchu' },
      { type_id: 'makers/yessssss', type_name: 'Yessssss!' },
      { type_id: 'makers/fb5491cb59', type_name: 'S-One 第一风格' },
      { type_id: 'makers/heyzo', type_name: 'Heyzo' },
      { type_id: 'makers/premium', type_name: 'Premium' },
      { type_id: 'makers/natural-high', type_name: 'Natural High' },
      { type_id: 'makers/celebrity-friends', type_name: 'Celebrity Friends' },
      { type_id: 'makers/planet-plus', type_name: 'Planet Plus' },
      { type_id: 'makers/ones-factory', type_name: 'One\'s Factory' },
      { type_id: 'makers/faleno', type_name: 'Faleno' },
      { type_id: 'makers/prestige-premium', type_name: '尊贵高级版' },
      { type_id: 'makers/takara-video', type_name: 'Takara Video' },
      { type_id: 'makers/kawaii', type_name: 'Kawaii' },
      { type_id: 'makers/e-body', type_name: 'E-Body' },
      { type_id: 'makers/crystal-video', type_name: 'Crystal Video' },
      { type_id: 'makers/tameike-goro', type_name: 'Tameike Goro' },
      { type_id: 'makers/deeps', type_name: 'Deeps' },
      { type_id: 'makers/1pondo', type_name: '1Pondo' },
      { type_id: 'makers/oppai', type_name: 'Oppai' },
      { type_id: 'makers/s-cute', type_name: 'S-Cute' },
      { type_id: 'makers/10musume', type_name: '10Musume' },
      { type_id: 'makers/tokyo-hot', type_name: '东京热' },
      { type_id: 'makers/im-an-amateur-z', type_name: 'I\'m An Amateur -Z-' },
      { type_id: 'makers/first-star', type_name: 'First Star' },
      { type_id: 'makers/energy', type_name: 'Energy' },
      { type_id: 'makers/maximizing', type_name: 'Maximizing' },
      { type_id: 'makers/alice-japan', type_name: 'Alice Japan' },
      { type_id: 'makers/mercury', type_name: 'Mercury' },
      { type_id: 'makers/pacopacomama', type_name: '帕科帕科马' },
      { type_id: 'makers/h4610', type_name: 'H4610' },
      { type_id: 'makers/max-a', type_name: 'Max A' },
      { type_id: 'makers/ruby', type_name: 'Ruby' },
      { type_id: 'makers/big-mocal', type_name: 'Big Mocal' },
      { type_id: 'makers/hmp', type_name: 'Hmp' },
      { type_id: 'makers/rocket', type_name: 'Rocket' },
      { type_id: 'makers/c0930', type_name: 'C0930' },
      { type_id: 'makers/h0930', type_name: 'H0930' },
      { type_id: 'makers/714b15b1cf', type_name: '第一颗星' },
      { type_id: 'makers/aurora-project-annex', type_name: 'Aurora Project Annex' },
      { type_id: 'makers/momotaro-video-publishing', type_name: 'Momotaro Video Publishing' },
      { type_id: 'makers/avs-collectors', type_name: 'Avs Collector\'s' },
      { type_id: 'makers/fa47310ad1', type_name: '荡妇天堂' },
      { type_id: 'makers/3d449fba56', type_name: '荡妇' },
      { type_id: 'makers/innocence', type_name: 'Innocence' },
      { type_id: 'makers/hmn-works', type_name: 'Hmn Works' },
      { type_id: 'makers/nagae-style', type_name: 'Nagae Style' },
      { type_id: 'makers/s-class-amateur', type_name: 'S Class Amateur' },
      { type_id: 'makers/a755f04771', type_name: '火箭' },
      { type_id: 'makers/warp-entertainment', type_name: 'Warp Entertainment' },
      { type_id: 'makers/switch', type_name: 'Switch' },
      { type_id: 'makers/dogma', type_name: 'Dogma' },
      { type_id: 'makers/akinori', type_name: 'Akinori' },
      { type_id: 'makers/fa-pro', type_name: 'Fa Pro' },
      { type_id: 'makers/jet-video', type_name: 'Jet Video' },
      { type_id: 'makers/hibino', type_name: 'Hibino' },
      { type_id: 'makers/hot-entertainment', type_name: 'Hot Entertainment' },
      { type_id: 'makers/kanbi', type_name: 'Kanbi' },
      { type_id: 'makers/abcdelusion-group', type_name: 'Abc/Delusion Group' },
      { type_id: 'makers/kirakira', type_name: 'Kira☆Kira' },
      { type_id: 'makers/sadistic-village', type_name: 'Sadistic Village' },
      { type_id: 'makers/rebecca', type_name: 'Rebecca' },
      { type_id: 'makers/amateur-clover', type_name: 'Amateur Clover' },
      { type_id: 'makers/real-works', type_name: 'Real Works' },
      { type_id: 'makers/dahlia', type_name: 'Dahlia' },
      { type_id: 'makers/giga', type_name: 'Giga' },
      { type_id: 'makers/aroma-planning', type_name: 'Aroma Planning' },
      { type_id: 'makers/dream-ticket', type_name: 'Dream Ticket' },
      { type_id: 'makers/tma', type_name: 'Tma' },
      { type_id: 'makers/plum', type_name: 'Plum' },
      { type_id: 'makers/blushing-girl', type_name: 'Blushing Girl' },
      { type_id: 'makers/paradise-tv', type_name: 'Paradise Tv' },
      { type_id: 'makers/mbm', type_name: 'Mbm' },
      { type_id: 'makers/k-trib', type_name: 'K-Trib' },
      { type_id: 'makers/c2104f6b6b', type_name: '魔法' },
      { type_id: 'makers/faleno-tube', type_name: 'Faleno Tube' },
      { type_id: 'makers/office-ks', type_name: 'Office K\'s' },
      { type_id: 'makers/pink', type_name: 'Pink' },
      { type_id: 'makers/global-media-entertainment', type_name: 'Global Media Entertainment' },
      { type_id: 'makers/dandy', type_name: 'Dandy' },
      { type_id: 'makers/mr-michiru', type_name: 'Mr. Michiru' },
      { type_id: 'makers/ms-video-group', type_name: 'M\'s Video Group' },
      { type_id: 'makers/japan', type_name: '日本成熟女性' },
      { type_id: 'makers/yamato-soradelusion-group', type_name: 'Yamato Sora/Delusion Group' },
      { type_id: 'series/sex', type_name: '杂技性爱！' },
      { type_id: 'series/av', type_name: '业余视听采访' },
      { type_id: 'series/tv', type_name: '豪华电视' },
      { type_id: 'series/avav', type_name: '【初拍】申请Av在线→Av体验拍摄' },
      { type_id: 'series/ntr', type_name: 'Ntr（Netorare - 日本电视剧中的一个角色）' },
      { type_id: 'series/90cf840150', type_name: '非常轻佻，第一次拍摄。' },
      { type_id: 'series/m', type_name: '喝精液的M女人' },
      { type_id: 'series/tokyo-hot', type_name: '东京热' },
      { type_id: 'series/58b73f0b7a', type_name: '魔镜' },
      { type_id: 'series/sod', type_name: '草皮女员工' },
      { type_id: 'series/8196dba1e7', type_name: '街角业余搭讪' },
      { type_id: 'series/ok', type_name: '一位普通的家庭主妇误入了允许群交的男女混浴温泉！' },
      { type_id: 'series/ol', type_name: '豪华奥尔' },
      { type_id: 'series/kawaii', type_name: '可爱* 美女群交' },
      { type_id: 'series/17096c5428', type_name: '招聘频道~寻找普通业余女性~' },
      { type_id: 'series/5544c187a6', type_name: '首次拍摄已婚女性纪录片' },
      { type_id: 'series/fuck', type_name: '黑人巨根，真他妈爽翻了' },
      { type_id: 'series/h', type_name: '翔太君的恶作剧' },
      { type_id: 'series/av-debut', type_name: 'Av 出道 (Kimihore)' },
      { type_id: 'series/mm', type_name: '魔镜（Mm）' },
      { type_id: 'series/c57a2f91ff', type_name: '性交时体液外流，激烈性行为' },
      { type_id: 'series/no1-style', type_name: '独家1号款式' },
      { type_id: 'series/cny', type_name: '我叫了个应召女郎，结果发现是我老家那个身材丰满的朋友……' },
      { type_id: 'series/w', type_name: 'W 肛门婊子' },
      { type_id: 'series/d02f8e8c51', type_name: '勃起展示情况' },
      { type_id: 'series/best', type_name: 'Ultra Best（胜夫物产/梦祖族）' },
      { type_id: 'series/b', type_name: 'B' },
      { type_id: 'series/b1d1e35f96', type_name: '全国已婚妇女情色百科全书' },
      { type_id: 'series/94eb7f9462', type_name: '业余女孩搭讪！！' },
      { type_id: 'series/a40f66720e', type_name: '请原谅我...' },
      { type_id: 'series/j', type_name: '车站便当中出 J○ 志●' },
      { type_id: 'series/ai1080p', type_name: 'Ai 数字修复版 1080P' },
      { type_id: 'series/9f61ce493a', type_name: '母子乱伦' },
      { type_id: 'series/3b9ff7135f', type_name: '勒索套件' },
      { type_id: 'series/3d9c8e4266', type_name: '猎人黑' },
      { type_id: 'series/e-body', type_name: '完全成熟（E-Body）' },
      { type_id: 'series/s', type_name: 'S' },
      { type_id: 'series/bafceb204b', type_name: '一个古怪的业余颜艺Xx' },
      { type_id: 'series/7141f8bf63', type_name: '禁止照护' },
      { type_id: 'series/eb5f32eede', type_name: '我可以送你回家吗？' },
      { type_id: 'series/vr', type_name: '我挚爱的人，在虚拟现实中等我。' },
      { type_id: 'series/5e97ec73d1', type_name: '拍摄一段彻底羞辱的视频' },
      { type_id: 'series/first-impression', type_name: '第一印象' },
      { type_id: 'series/s1-girls-collection', type_name: 'S1 女童系列' },
      { type_id: 'series/treasured-pussy-selection', type_name: '珍藏的猫咪精选' },
      { type_id: 'series/jpy', type_name: '通过甜心约会认识我的异地恋男友' },
      { type_id: 'series/1f089303de', type_name: '在丈夫面前被强奸' },
      { type_id: 'series/boinbox', type_name: 'Boin“○○”盒子' },
      { type_id: 'series/blu-ray', type_name: 'Catwalk Poison（蓝光）' },
      { type_id: 'series/s1-vr', type_name: 'S1 Vr' },
      { type_id: 'series/4670310bc7', type_name: '第一次体内射精（真精液）' },
      { type_id: 'series/33d3f643f5', type_name: '出租女友' },
      { type_id: 'series/260cf5f1b7', type_name: '本书首次亮相' },
      { type_id: 'series/2dda438621', type_name: '已婚妇女的婚外情' },
      { type_id: 'series/unfinished-vr', type_name: '未完成的Vr' },
      { type_id: 'series/4117bb0961', type_name: '我岳母比我老婆好多了……' },
      { type_id: 'series/no1style', type_name: '独家第一风格' },
      { type_id: 'series/f4103d1312', type_name: '爱情旅馆纪录片（2小时休息）' },
      { type_id: 'series/03aa0ab3e4', type_name: '上帝泳装' },
      { type_id: 'series/a1bcc7495c', type_name: '阴道百科全书' },
    ],
    filters: {},
  };
}

async function category(reqIn) {
  const body = reqIn?.body || {};
  const tid = String(body.id || 'new');
  const page = Math.max(1, parseInt(body.page, 10) || 1);
  const path = '/' + LANG + '/' + tid;
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
