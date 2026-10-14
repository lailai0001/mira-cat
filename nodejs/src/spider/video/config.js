import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KEY = 'py_config';
const NAME = '「设」配置';
const PORT = 2333;

// 配置文件路径（按优先级尝试）
function getConfigPath() {
    const candidates = [
        path.join(os.tmpdir(), 'mira_source_config.json'),
        path.join(process.cwd(), 'mira_source_config.json'),
    ];
    return candidates[0];
}

// 默认源列表（与 bundle 保持一致）
const DEFAULT_SOURCES = [
    { key: 'py_51chigua', name: '51吃瓜' },
    { key: 'py_818hl', name: '818黑料网' },
    { key: 'py_acfan', name: 'AcFan' },
    { key: 'py_av123', name: '123AV' },
    { key: 'py_avdb', name: 'Avdb' },
    { key: 'py_chigua57', name: '57吃瓜' },
    { key: 'py_feiye', name: '绯夜' },
    { key: 'py_getav', name: 'GetAV' },
    { key: 'py_hanbj', name: '韩国BJ' },
    { key: 'py_hanime', name: 'Hanime' },
    { key: 'py_hanime_new', name: 'Hanime(新版)' },
    { key: 'py_huadu', name: '花都影院' },
    { key: 'py_huangdou', name: '黄豆短剧' },
    { key: 'py_huangdou_rex', name: '黄豆短剧(REX)' },
    { key: 'py_huangguo', name: '黄果短剧' },
    { key: 'py_kanav', name: 'KanAV' },
    { key: 'py_madou', name: '麻豆社' },
    { key: 'py_missav', name: 'MissAV' },
    { key: 'py_missav_xptv', name: 'MissAV(XPTV版)' },
    { key: 'py_pornhub', name: 'Pornhub' },
    { key: 'py_ppp', name: 'PPPHub' },
    { key: 'py_rou', name: '肉视频' },
    { key: 'py_sanjipian', name: '蝴蝶影院' },
    { key: 'py_soop', name: 'SOOP直播' },
    { key: 'py_spankbang_new', name: 'Eporner' },
    { key: 'py_superchatlive', name: 'SuperChat直播' },
    { key: 'py_supjav', name: 'SupJav' },
    { key: 'py_taiav', name: 'Taiav' },
    { key: 'py_upload5', name: '蜜桃' },
    { key: 'py_xvideos', name: 'XVideos' },
    { key: 'py_xxxfollow', name: 'XXXFollow' },
    { key: 'douban', name: '豆瓣榜单' },
    { key: 'ffm3u8', name: '非凡采集' },
    { key: 'live', name: 'IPTV直播' },
    { key: 'myvideo', name: '我的影视' },
    { key: 'push', name: '推送' },
    { key: 'xgcartoon', name: '西瓜卡通' },
    { key: 't4', name: '站源' },
    { key: 'cms', name: '采集站' },
    { key: 'kkys', name: '快看影视' },
    { key: 'kunyu77', name: '琨娱七七' },
];

// 读取配置
export function loadConfig() {
    try {
        const p = getConfigPath();
        if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (data && Array.isArray(data.sources)) return data;
        }
    } catch (e) {}
    return { sources: DEFAULT_SOURCES.map((s, i) => ({ ...s, order: i + 1, enabled: true })) };
}

// 保存配置
function saveConfig(sources) {
    try {
        const p = getConfigPath();
        fs.writeFileSync(p, JSON.stringify({ sources }, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

// 获取本机 IP
function getLocalIP() {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    } catch (e) {}
    return '127.0.0.1';
}

let serverStarted = false;
let serverIP = '';

function startServer() {
    if (serverStarted) return;
    serverStarted = true;

    const server = http.createServer((req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://localhost:${PORT}`);

        // 获取配置
        if (url.pathname === '/api/config' && req.method === 'GET') {
            const config = loadConfig();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(config));
            return;
        }

        // 保存配置
        if (url.pathname === '/api/config' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const ok = saveConfig(data.sources);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok, msg: ok ? '已保存，重启 App 生效' : '保存失败' }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, msg: '数据格式错误' }));
                }
            });
            return;
        }

        // 配置页面
        if (url.pathname === '/website' || url.pathname === '/website/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(CONFIG_HTML);
            return;
        }

        res.writeHead(404);
        res.end('Not Found');
    });

    server.listen(PORT, '0.0.0.0', () => {
        serverIP = getLocalIP();
        console.log(`[config] Server listening on http://${serverIP}:${PORT}/website`);
    });

    server.on('error', (e) => {
        console.log(`[config] Server error: ${e.message}`);
    });
}

// 配置页面 HTML（内嵌）
const CONFIG_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>猫源配置</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#f2f3f6;color:#1a1a1a;padding:16px;max-width:600px;margin:0 auto}
h1{font-size:20px;text-align:center;margin:16px 0}
.tabs{display:flex;background:#e8e9ed;border-radius:12px;padding:4px;margin-bottom:16px}
.tab{flex:1;text-align:center;padding:10px;border-radius:8px;font-size:14px;color:#888}
.tab.active{background:#fff;color:#1a1a1a;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.list{background:#fff;border-radius:12px;overflow:hidden}
.row{display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid #f0f0f0;gap:12px}
.row:last-child{border-bottom:none}
.drag{color:#ccc;font-size:18px;cursor:grab;user-select:none}
.name{flex:1;font-size:15px}
.switch{position:relative;width:52px;height:32px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#ddd;transition:.3s;border-radius:32px}
.slider:before{position:absolute;content:"";height:26px;width:26px;left:3px;bottom:3px;background:#fff;transition:.3s;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.2)}
input:checked+.slider{background:#4cd964}
input:checked+.slider:before{transform:translateX(20px)}
.btn{display:block;width:100%;padding:14px;margin-top:16px;background:#1a1a1a;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600}
.btn:active{opacity:.8}
.tip{text-align:center;color:#888;font-size:13px;margin-top:12px;line-height:1.6}
.updown{display:flex;flex-direction:column;gap:2px}
.updown button{border:1px solid #e0e0e0;background:#fff;border-radius:6px;width:28px;height:22px;font-size:12px;color:#666}
</style>
</head>
<body>
<h1>站源列表</h1>
<div class="tabs"><div class="tab active">站源列表</div></div>
<div class="list" id="list"></div>
<button class="btn" onclick="save()">保存配置</button>
<div class="tip">调整顺序、开关后点保存<br>重启 App 生效</div>
<script>
let sources=[];
async function load(){
  const r=await fetch('/api/config');
  const d=await r.json();
  sources=d.sources.sort((a,b)=>a.order-b.order);
  render();
}
function render(){
  const el=document.getElementById('list');
  el.innerHTML=sources.map((s,i)=>
    '<div class="row"><span class="drag">⋮⋮</span>'+
    '<span class="name">'+s.name+'</span>'+
    '<span class="updown"><button onclick="move('+i+',-1)">▲</button><button onclick="move('+i+',1)">▼</button></span>'+
    '<label class="switch"><input type="checkbox" '+(s.enabled?'checked':'')+' onchange="toggle('+i+',this.checked)"><span class="slider"></span></label>'+
    '</div>').join('');
}
function move(i,d){
  const j=i+d;
  if(j<0||j>=sources.length)return;
  [sources[i],sources[j]]=[sources[j],sources[i]];
  sources.forEach((s,k)=>s.order=k+1);
  render();
}
function toggle(i,v){sources[i].enabled=v;}
async function save(){
  const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sources})});
  const d=await r.json();
  alert(d.msg);
}
load();
</script>
</body>
</html>`;

// 启动服务
startServer();

async function home() {
    const ip = serverIP || getLocalIP();
    const url = `http://${ip}:${PORT}/website`;
    return {
        class: [{ type_id: 'config', type_name: '配置页面' }],
        list: [{
            vod_id: 'config_page',
            vod_name: '📱 手机浏览器打开以下地址配置',
            vod_pic: '',
            vod_remarks: url,
        }],
        ext: { url },
    };
}

async function category() {
    return { class: [{ type_id: 'config', type_name: '配置页面' }], list: [] };
}

async function detail(reqIn) {
    const ip = serverIP || getLocalIP();
    const url = `http://${ip}:${PORT}/website`;
    return {
        list: [{
            vod_id: 'config_page',
            vod_name: '配置地址',
            vod_pic: '',
            vod_remarks: url,
            vod_content: `在手机浏览器中打开以下地址，即可排序、启用/禁用各个源：\n\n${url}\n\n调整后点保存，重启 App 生效。`,
            vod_play_from: '操作',
            vod_play_url: `打开配置页面$${url}`,
        }],
    };
}

async function play(reqIn) {
    const ip = serverIP || getLocalIP();
    const url = `http://${ip}:${PORT}/website`;
    return { parse: 0, url, msg: `请在浏览器打开：${url}` };
}

async function search(reqIn) {
    return { list: [] };
}

export default function spider() {
    return {
        meta: { key: KEY, name: NAME, type: 1 },
        api: async (fastify) => {
            fastify.get('/', async (_, reply) => reply.send(await home()));
            fastify.get('/category', async (_, reply) => reply.send(await category()));
            fastify.post('/detail', async (req, reply) => reply.send(await detail(req)));
            fastify.post('/play', async (req, reply) => reply.send(await play(req)));
            fastify.post('/search', async (req, reply) => reply.send(await search(req)));
        },
    };
}
