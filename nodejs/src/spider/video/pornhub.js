import req from '../../util/req.js';
import * as cheerio from 'cheerio';

const Oc = 'https://cn.pornhub.com';
const HM = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
async function G5(url) {
  const { data } = await req.get(url, { headers: { 'User-Agent': HM }, timeout: 20000 });
  return String(data || '');
}

async function Cye(e,t){return{class:[{type_id:"sy",type_name:"Home"},{type_id:"cm",type_name:"Newest"},{type_id:"mv",type_name:"Most Viewed"},{type_id:"ht",type_name:"Hottest"},{type_id:"tr",type_name:"Top Rated"},{type_id:"lg",type_name:"Longest"}]}}async function Rye(e,t){let a=e.body.id,i=e.body.page||1;i==0&&(i=1);let r=`${Oc}/video?`;a!=="sy"&&(r=`${Oc}/video?o=${a}`),i>1&&(r+=a==="sy"?`page=${i}`:`&page=${i}`);let n=await G5(r),o=cheerio.load(n),c=[];return o("li.videoBox").each((l,u)=>{let d=o(u).find(".phimage a.img").attr("href"),f=o(u).find(".title a").attr("title"),m=o(u).find(".phimage a.img img").attr("src")||o(u).find(".phimage a.img img").attr("data-mediumthumb")||"",p=o(u).find(".views").text().trim()||"",b=o(u).find(".duration").text().trim()||"";c.push({vod_id:d,vod_name:f,vod_pic:m,vod_remarks:p,vod_duration:b})}),{page:i,pagecount:c.length<20?i:i+1,list:c,filter:[]}}async function Iye(e,t){let a=e.body.id,s=Oc+a,i=await G5(s),r=i.match(/var flashvars_.* = \{(.*?)\};/),n="";if(r&&r[1])try{let f=JSON.parse("{"+r[1]+"}").mediaDefinitions.filter(m=>m.format==="hls");f.length>0&&(n=f[f.length-1].videoUrl)}catch{}let o=cheerio.load(i),c=o("h1.title").text().trim()||o('meta[property="og:title"]').attr("content")||"",l=o('meta[property="og:image"]').attr("content")||"";return{list:[{vod_id:a,vod_name:c,vod_pic:l,vod_play_from:"Pornhub",vod_play_url:"\u64AD\u653E$"+n}]}}async function Nye(e,t){return{url:e.body.id,header:{"User-Agent":HM,origin:Oc,referer:Oc+"/"}}}async function Oye(e,t){let a=e.body.page,s=e.body.wd,i=a||1;i==0&&(i=1);let r=encodeURIComponent(s),n=`${Oc}/video/search?search=${r}&page=${i}`,o=await G5(n),c=cheerio.load(o),l=[];return c("li.videoBox").each((u,d)=>{let f=c(d).find(".phimage a.img").attr("href"),m=c(d).find(".title a").attr("title"),p=c(d).find(".phimage a.img img").attr("src")||c(d).find(".phimage a.img img").attr("data-mediumthumb")||"",b=c(d).find(".views").text().trim()||"",v=c(d).find(".duration").text().trim()||"";l.push({vod_id:f,vod_name:m,vod_pic:p,vod_remarks:b,vod_duration:v})}),{page:i,pagecount:l.length<20?i:i+1,list:l}}var UM={meta:{key:"py_pornhub",name:"Pornhub",type:3},api:async e=>{e.post("/init",async()=>({})),e.post("/home",Cye),e.post("/category",Rye),e.post("/detail",Iye),e.post("/play",Nye),e.post("/search",Oye)}};

export default function spider() {
  return UM;
}
