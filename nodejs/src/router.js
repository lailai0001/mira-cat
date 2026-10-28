import missav_xptv from './spider/video/missav_xptv.js';
import chigua51 from './spider/video/chigua51.js';
import avdb from './spider/video/avdb.js';
import kanav from './spider/video/kanav.js';
import taiav from './spider/video/taiav.js';
import rou from './spider/video/rou.js';
import madou from './spider/video/madou.js';
import pornhub from './spider/video/pornhub.js';
import ppp from './spider/video/ppp.js';
import xvideos from './spider/video/xvideos.js';
import xxxfollow from './spider/video/xxxfollow.js';
import spankbang from './spider/video/spankbang_new.js';
import huangdou from './spider/video/huangdou.js';
import huangguo from './spider/video/huangguo.js';
import av123 from './spider/video/av123.js';
import chigua57 from './spider/video/chigua57.js';
import feiye from './spider/video/feiye.js';
import supjav from './spider/video/supjav.js';
import hl818 from './spider/video/hl818.js';
import upload5 from './spider/video/upload5.js';
import getav from './spider/video/getav.js';
import hanbj from './spider/video/hanbj.js';
import duanju91 from './spider/video/91duanju.js';
import asmr from './spider/video/asmr.js';
import pandalive from './spider/video/pandalive.js';
import march from './spider/video/march.js';
import jinguo from './spider/video/jinguo.js';
import chengguo from './spider/video/chengguo.js';
import yeguo from './spider/video/yeguo.js';
import mrds from './spider/video/mrds.js';
import bianfu from './spider/video/bianfu.js';
import bagua from './spider/video/bagua.js';
import xnxx from './spider/video/xnxx.js';
import uu from './spider/video/uu.js';
import sanjipian from './spider/video/sanjipian.js';
import woxiu from './spider/video/woxiu.js';
import juheduanju from './spider/video/juheduanju.js';
import xingmengasmr from './spider/video/xingmengasmr.js';
import avjoy from './spider/video/avjoy.js';
import uu_video from './spider/video/uu_video.js';
import kissjav from './spider/video/kissjav.js';
import javhd from './spider/video/javhd.js';
import javgg from './spider/video/javgg.js';
import javmobile from './spider/video/javmobile.js';
import javmost from './spider/video/javmost.js';
import javhdtoday from './spider/video/javhdtoday.js';
import cableav from './spider/video/cableav.js';
import avhub from './spider/video/avhub.js';
import sextb from './spider/video/sextb.js';
import javsb from './spider/video/javsb.js';
import porncgw from './spider/video/porncgw.js';
import xhongyan from './spider/video/xhongyan.js';
import youzidj from './spider/video/youzidj.js';
import stripchat from './spider/video/stripchat.js';
import hohoj from './spider/video/hohoj.js';
import rip17 from './spider/video/rip17.js';
import brazz from './spider/video/brazz.js';
import bigbuttshub from './spider/video/bigbuttshub.js';
import mmtv from './spider/video/7mmtv.js';
import javideo from './spider/video/javideo.js';
import bestjavporn from './spider/video/bestjavporn.js';
import chaturbate from './spider/video/chaturbate.js';
import asmrba from './spider/video/asmrba.js';
import hlbdy from './spider/video/hlbdy.js';
import shipin51 from './spider/video/51shipin.js';
import erome from './spider/video/erome.js';
import javneon from './spider/video/javneon.js';

const spiders = [
    missav_xptv,
    chigua51,
    avdb,
    kanav,
    taiav,
    rou,
    madou,
    pornhub,
    ppp,
    xvideos,
    xxxfollow,
    spankbang,
    huangdou,
    huangguo,
    av123,
    chigua57,
    feiye,
    supjav,
    hl818,
    upload5,
    getav,
    hanbj,
    duanju91,
    asmr,
    pandalive,
    march,
    jinguo,
    chengguo,
    yeguo,
    mrds,
    bianfu,
    bagua,
    xnxx,
    uu,
    sanjipian,
    woxiu,
    juheduanju,
    xingmengasmr,
    avjoy,
    uu_video,
    kissjav,
    javhd,
    javgg,
    javmobile,
    javmost,
    javhdtoday,
    cableav,
    avhub,
    sextb,
    javsb,
    porncgw,
    xhongyan,
    youzidj,
    stripchat,
    hohoj,
    rip17, brazz, bigbuttshub, mmtv, javideo, bestjavporn, chaturbate, asmrba, hlbdy, shipin51, erome, javneon,];
const spiderPrefix = '/spider'; // API 路由前缀

/**
 * A function to initialize the router.
 *
 * @param {Object} fastify - The Fastify instance
 * @return {Promise<void>} - A Promise that resolves when the router is initialized
 */
export default async function router(fastify) {
    // register all spider router
    spiders.forEach((spiderFn) => {
        const spider = typeof spiderFn === 'function' ? spiderFn() : spiderFn;
        const path = spiderPrefix + '/' + spider.meta.key + '/' + spider.meta.type;
        fastify.register(spider.api, { prefix: path });
        console.log('Register spider: ' + path);
    });
    /**
     * @api {get} /check 检查
     */
    fastify.register(
        /**
         *
         * @param {import('fastify').FastifyInstance} fastify
         */
        async (fastify) => {
            fastify.get(
                '/check',
                /**
                 * check api alive or not
                 * @param {import('fastify').FastifyRequest} _request
                 * @param {import('fastify').FastifyReply} reply
                 */
                async function (_request, reply) {
                    reply.send({ run: !fastify.stop });
                }
            );
            fastify.get(
                '/config',
                /**
                 * get catopen format config
                 * @param {import('fastify').FastifyRequest} _request
                 * @param {import('fastify').FastifyReply} reply
                 */
                async function (_request, reply) {
                    const config = {
                        video: {
                            sites: [],
                        },
                        read: {
                            sites: [],
                        },
                        comic: {
                            sites: [],
                        },
                        music: {
                            sites: [],
                        },
                        pan: {
                            sites: [],
                        },
                        color: fastify.config.color || [],
                    };
                    spiders.forEach((spiderFn) => {
                        const spider = typeof spiderFn === 'function' ? spiderFn() : spiderFn;
                        let meta = Object.assign({}, spider.meta);
                        meta.api = spiderPrefix + '/' + meta.key + '/' + meta.type;
                        meta.key = 'nodejs_' + meta.key;
                        const stype = spider.meta.type;
                        if (stype < 10) {
                            config.video.sites.push(meta);
                        } else if (stype >= 10 && stype < 20) {
                            config.read.sites.push(meta);
                        } else if (stype >= 20 && stype < 30) {
                            config.comic.sites.push(meta);
                        } else if (stype >= 30 && stype < 40) {
                            config.music.sites.push(meta);
                        } else if (stype >= 40 && stype < 50) {
                            config.pan.sites.push(meta);
                        }
                    });
                    reply.send(config);
                }
            );
        }
    );
}

