import req from '../../util/req.js';
async function reqTextAx(url, opt = {}) {
  const method = (opt.method || 'GET').toUpperCase();
  const headers = Object.assign({}, opt.headers || {});
  const timeout = opt.timeout || 20000;
  const body = opt.body !== undefined ? opt.body : opt.data;
  const data = (body != null && typeof body === 'object' && !Buffer.isBuffer(body)) ? JSON.stringify(body) : body;
  try {
    const r = await req({ method, url, headers, data, timeout, responseType: 'text', maxRedirects: 5 });
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');
  } catch (e) {
    if (e && e.response) throw new Error('HTTP ' + e.response.status + ' ' + url);
    if (typeof fetch !== 'undefined') {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      try {
        const r = await fetch(url, { method, headers, body: data, signal: ctl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return await r.text();
      } finally { clearTimeout(t); }
    }
    throw e;
  }
}

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36';
async function siteReq(url, opts = {}) {
  const headers = Object.assign({ 'User-Agent': UA }, opts.headers || {});
  return reqTextAx(url, { ...opts, headers });
}
async function json(u,opt){try{return JSON.parse(await siteReq(u,opt))}catch{return {}}}
const text=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const m=(s,r)=>((String(s||'').match(r)||[])[1]||'');
const abs=(base,u)=>{try{return new URL(u,base).href}catch{return ''}};
const pg=b=>Math.max(1,parseInt(b?.page||b?.pg||1,10)||1);
const id=b=>String(Array.isArray(b?.id)?b.id[0]:(b?.id||b?.ids||''));
const list=(data,page=1,size=20)=>({list:data,page,pagecount:page+(data.length>=size?1:0),limit:size,total:data.length>=size?9999:data.length});

const HOST='https://www.asmrba.com',API=HOST+'/wp-json/wp/v2';
const cover=p=>p?._embedded?.['wp:featuredmedia']?.[0]?.source_url||'';
const card=p=>({vod_id:String(p.id),vod_name:text(p.title?.rendered||p.title),vod_pic:cover(p),vod_remarks:text(p.excerpt?.rendered||'')});
async function categories(){let a=await json(API+'/categories?per_page=100');return (Array.isArray(a)?a:[]).map(x=>({type_id:String(x.id),type_name:x.name}))}
async function page(b,extra={}){let n=pg(b),j=await json(API+'/posts?'+new URLSearchParams({per_page:20,page:n,_embed:1,...extra}));return list(Array.isArray(j)?j.map(card):[],n)}
// 2026-10-25 兜底：iframe 里带的 cid 若已漂移（playurl 取不到流），
// 用 view 接口取当前 cid 重试一次。仅在首发失败时触发，正常路径零额外
// 请求；B站已删稿（稿件不可见）无当前 cid，仍返回空，无法复活。
async function biliUrl(u){
 u=String(u||'').replace(/&amp;/g,'&');
 const bvid=m(u,/(BV[0-9A-Za-z]+)/); if(!bvid)return '';
 let cid=m(u,/[?&]cid=(\d+)/);
 const headers={'User-Agent':UA,'Referer':'https://www.bilibili.com/video/'+bvid+'/'};
 const playurl=async c=>{const j=await json('https://api.bilibili.com/x/player/playurl?'+new URLSearchParams({bvid,cid:c,qn:'64',fnval:'0',platform:'html5'}),{headers});let d=j?.data||{},du=d.durl?.[0]?.url||'';if(!du&&d.dash){du=d.dash.audio?.[0]?.baseUrl||d.dash.video?.[0]?.baseUrl||''}return du};
 if(!cid){const v=await json('https://api.bilibili.com/x/web-interface/view?bvid='+bvid,{headers});cid=String(v?.data?.cid||'')}
 if(!cid)return '';
 let du=await playurl(cid);
 if(!du){const v=await json('https://api.bilibili.com/x/web-interface/view?bvid='+bvid,{headers});const fresh=String(v?.data?.cid||'');if(fresh&&fresh!==cid)du=await playurl(fresh)}
 return du;
}
export default function createSpider() {
  return {meta:{key:'py_asmrba',name:'ASMR吧',type:3,searchable:1,quickSearch:1,filterable:0},api:async f=>{f.post('/init',async()=>({}));f.post('/home',async()=>({class:[{type_id:'latest',type_name:'最新更新'},...await categories()],filters:{},list:(await page({page:1})).list}));f.post('/category',async r=>page(r.body||{},r.body?.id==='latest'?{}:{categories:r.body?.id||''}));f.post('/search',async r=>page(r.body||{},{search:r.body?.wd||''}));f.post('/detail',async r=>{let p=await json(API+'/posts/'+id(r.body)+'?_embed=1');if(!p.id)return {list:[]};let h=p.content?.rendered||'',urls=[...new Set([...h.matchAll(/https?:\/\/[^\s"'<>]+(?:\.m3u8|\.mp4)[^\s"'<>]*/g)].map(x=>x[0]))];let ifr=[...h.matchAll(/<iframe[^>]+src="([^"]+)"/g)].map(x=>abs(HOST,x[1]).replace(/&amp;/g,'&'));let eps=[...urls,...ifr].map((u,i)=>'第'+(i+1)+'段$'+u);return {list:[{...card(p),vod_content:text(h),vod_play_from:'在线',vod_play_url:eps.join('#')}]}});f.post('/play',async r=>{let u=id(r.body).replace(/&amp;/g,'&');if(/bilibili\.com/i.test(u)){let v=await biliUrl(u);if(v)return {parse:0,url:v,header:{'User-Agent':UA,'Referer':'https://www.bilibili.com/'}}}return {parse:/\.(mp4|m3u8)(\?|$)/.test(u)?0:1,url:u}})}};
}
