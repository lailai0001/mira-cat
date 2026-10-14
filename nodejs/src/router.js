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
import hanime from './spider/video/hanime.js';
import spankbang from './spider/video/spankbang_new.js';
import huangdou from './spider/video/huangdou.js';
import huangguo from './spider/video/huangguo.js';
import av123 from './spider/video/av123.js';
import chigua57 from './spider/video/chigua57.js';
import feiye from './spider/video/feiye.js';
import huadu from './spider/video/huadu.js';
import supjav from './spider/video/supjav.js';
import sanjipian from './spider/video/sanjipian.js';
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
    hanime,
    spankbang,
    huangdou,
    huangguo,
    av123,
    chigua57,
    feiye,
    huadu,
    supjav,
    sanjipian,
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
];
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
