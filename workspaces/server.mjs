import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const token=()=>randomBytes(24).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest();
const tokenHash=value=>digest(value).toString('hex');
const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const inviteCode=()=>Array.from(randomBytes(10),n=>alphabet[n&31]).join('');
const hour=3600_000, maxMembers=100;
const validSecret=/^[A-Za-z0-9_-]{32,128}$/;
const validId=/^[A-Za-z0-9_-]{1,48}$/;
const cleanText=(v,max)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\p{Cc}\p{Cf}]/u.test(v);
const staticFiles=new Map([
 ['/beam/workspaces/', ['index.html','text/html; charset=utf-8']],
 ['/beam/workspaces/app.js', ['app.js','text/javascript; charset=utf-8']],
 ['/beam/workspaces/app.css', ['app.css','text/css; charset=utf-8']],
]);
const beamFiles=new Map([
 ['index.html','text/html; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['app.css','text/css; charset=utf-8'],
 ['import/workbook.js','text/javascript; charset=utf-8'],['domain/code128.js','text/javascript; charset=utf-8'],
 ['domain/search-keys.js','text/javascript; charset=utf-8'],['domain/reconcile.js','text/javascript; charset=utf-8'],
 ['domain/scanner-input.js','text/javascript; charset=utf-8'],['ui/translations.js','text/javascript; charset=utf-8'],
 ['vendor/xml-parser.js','text/javascript; charset=utf-8'],['assets/pretendard-variable.woff2','font/woff2'],
 ['assets/OFL-Pretendard.txt','text/plain; charset=utf-8'],
]);
const publicRoot=new URL('./public/',import.meta.url), buildRoot=new URL('../dist/',import.meta.url);
const hostCookie='beam_workspaces_host', deviceCookie='beam_workspaces_device';
const fail=(status,error)=>Object.assign(new Error(error),{status});

function readConfig(origin, config) {
 const u=new URL(origin);
 const loopback=u.hostname==='127.0.0.1';
 if(u.origin!==origin||!(u.protocol==='https:'||loopback&&u.protocol==='http:'))throw Error('Use a canonical HTTPS internal origin, or 127.0.0.1 for local testing.');
 if(!Array.isArray(config?.brands)||!Array.isArray(config?.hosts)||!config.hosts.length||
   config.hosts.length>100||!config.brands.length||config.brands.length>100)throw Error('Invalid workspace configuration.');
 const brands=new Map(),hosts=new Map(),keys=new Set();
 for(const b of config.brands){
  if(!b||!validId.test(b.id??'')||!cleanText(b.name,80)||brands.has(b.id))throw Error('Invalid configured brand.');
  brands.set(b.id,b.name);
 }
 for(const h of config.hosts){
  if(!h||!validId.test(h.id??'')||!validSecret.test(h.key??'')||hosts.has(h.id)||keys.has(h.key)||
   !Array.isArray(h.brands)||!h.brands.length||h.brands.some(id=>!brands.has(id)))throw Error('Invalid configured host or brand assignment.');
  keys.add(h.key);hosts.set(h.id,{id:h.id,key:digest(h.key),brands:new Set(h.brands)});
 }
 const organization=config.organization??'현장 업무';
 if(!cleanText(organization,80))throw Error('Invalid organization name.');
 return {url:u,hosts,brands,organization};
}

async function readJSON(req) {
 if(req.headers['content-type']!=='application/json')throw fail(415,'unsupported');
 let length=0;const parts=[];
 for await(const chunk of req){
  length+=chunk.length;
  if(length>2048)throw fail(413,'too_large');
  parts.push(chunk);
 }
 try {
  const body=JSON.parse(Buffer.concat(parts).toString());
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error();
  return body;
 }catch{throw fail(400,'invalid');}
}
function fields(obj, ...keys) {
 if(Object.keys(obj).some(k=>!keys.includes(k)))throw fail(400,'invalid');
}
function cookie(req,name) {
 const items=String(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
 const value=items.length===1?items[0].slice(name.length+1):'';
 return validSecret.test(value)?value:'';
}
function cookieLine(name,value,secure,seconds) {
 return name+'='+value+'; HttpOnly; SameSite=Strict; Path=/beam/workspaces/; Max-Age='+seconds+(secure?'; Secure':'');
}

export function createWorkspaceServer({origin,config,now=Date.now}={}) {
 const {url,hosts,brands,organization}=readConfig(origin,config),secure=url.protocol==='https:';
 const spaces=new Map([...brands.keys()].map(id=>[id,{id,code:null,inviteExpiresAt:null,members:new Map(),sequence:0}]));
 const codes=new Map(),sessions=new Map();
 const counters=new Map();
 function limited(scope,max,period) {
  const t=now();let counter=counters.get(scope);
  if(!counter||counter.until<=t){counter={until:t+period,count:0};counters.set(scope,counter);}
  if(++counter.count>max)throw fail(429,'slow_down');
 }
 function closeInvite(space){codes.delete(space.code);space.code=null;space.inviteExpiresAt=null;}
 function prune() {
  const t=now();
  for(const space of spaces.values()){
   if(space.inviteExpiresAt!==null&&space.inviteExpiresAt<=t)closeInvite(space);
   for(const [id,member] of space.members)if(member.expiresAt<=t)space.members.delete(id);
  }
  for(const [key,s] of sessions)if(s.expiresAt<=t)sessions.delete(key);
 }
 function currentHost(req) {
  const value=cookie(req,hostCookie);
  return value?sessions.get(tokenHash(value)):undefined;
 }
 function authorize(req) {
  const host=currentHost(req);
  if(!host)throw fail(401,'host_required');
  return host;
 }
 function hostSpace(req,id) {
  const host=authorize(req),space=spaces.get(id);
  if(!space||!hosts.get(host.id).brands.has(id))throw fail(404,'not_found');
  return space;
 }
 function publicSpace(space){return {id:space.id,brand:brands.get(space.id)};}
 function privateSpace(space){return {...publicSpace(space),code:space.code,inviteExpiresAt:space.inviteExpiresAt,
  members:[...space.members.values()].map(({id,number,status})=>({id,number,status}))};}
 function memberKey(req){const value=cookie(req,deviceCookie);return value?tokenHash(value):'';}
 const policy="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
 const beamPolicy=policy.replace("style-src 'self'","style-src 'self' 'unsafe-inline'").replace("connect-src 'self'","connect-src 'none'; img-src data:");
 function headers(res,csp=policy) {
  res.setHeader('Content-Security-Policy',csp);
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 }
 function json(res,data,status=200) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
 }
 const routes={
  'GET /host'(req,res){
   const host=authorize(req);
   json(res,{organization,spaces:[...hosts.get(host.id).brands].map(id=>privateSpace(spaces.get(id)))});
  },
  async 'POST /host'(req,res) {
   limited('host',25,60_000);const input=await readJSON(req);fields(input,'key');
   const key=digest(typeof input.key==='string'?input.key:'');let match;
   for(const host of hosts.values())if(timingSafeEqual(host.key,key))match=host;
   if(!match)throw fail(401,'host_required');
   if(sessions.size>=500)throw fail(503,'capacity');
   const old=cookie(req,hostCookie);if(old)sessions.delete(tokenHash(old));
   const value=token();sessions.set(tokenHash(value),{id:match.id,expiresAt:now()+12*hour});
   res.setHeader('Set-Cookie',cookieLine(hostCookie,value,secure,12*3600));json(res,{ok:true});
  },
  async 'POST /signout'(req,res) {
   fields(await readJSON(req));const value=cookie(req,hostCookie);
   if(value)sessions.delete(tokenHash(value));
   res.setHeader('Set-Cookie',cookieLine(hostCookie,'',secure,0));json(res,{ok:true});
  },
  async 'POST /invite'(req,res) {
   const input=await readJSON(req);fields(input,'spaceId');
   const space=hostSpace(req,input.spaceId);
   closeInvite(space);
   let code;do{code=inviteCode();}while(codes.has(code));
   space.code=code;space.inviteExpiresAt=now()+8*hour;codes.set(code,space);
   json(res,privateSpace(space),201);
  },
  async 'POST /join'(req,res) {
   limited('join',160,60_000);const input=await readJSON(req);fields(input,'code');
   const code=typeof input.code==='string'?input.code.toUpperCase().replace(/[ -]/g,''):'';
   const space=codes.get(code);
   if(!space||space.inviteExpiresAt<=now())throw fail(404,'invalid_invite');
   let value=cookie(req,deviceCookie);if(!value)value=token();
   const hash=tokenHash(value);
   if(!space.members.has(hash)){
    if(space.members.size>=maxMembers)throw fail(503,'capacity');
    space.members.set(hash,{id:token(),number:++space.sequence,status:'pending',expiresAt:now()+12*hour});
   }
   res.setHeader('Set-Cookie',cookieLine(deviceCookie,value,secure,12*3600));
   const member=space.members.get(hash);
   json(res,{...publicSpace(space),status:member.status,number:member.number});
  },
  'GET /mine'(req,res) {
   const hash=memberKey(req);
   const list=hash?[...spaces.values()].flatMap(space=>{
    const m=space.members.get(hash);return m?[{...publicSpace(space),status:m.status,number:m.number}]:[];
   }):[];
   json(res,{spaces:list});
  },
  async 'POST /decide'(req,res) {
   const input=await readJSON(req);fields(input,'spaceId','memberId','approve');
   if(typeof input.approve!=='boolean')throw fail(400,'invalid');
   const space=hostSpace(req,input.spaceId);
   const member=[...space.members.values()].find(m=>m.id===input.memberId&&m.expiresAt>now());
   if(!member)throw fail(404,'not_found');
   if(input.approve&&member.status!=='pending')throw fail(409,'not_pending');
   member.status=input.approve?'approved':'denied';
   json(res,privateSpace(space));
  },
  async 'POST /close-invite'(req,res) {
   const input=await readJSON(req);fields(input,'spaceId');
   closeInvite(hostSpace(req,input.spaceId));json(res,{ok:true});
  },
 };
 return createServer({requestTimeout:10_000,headersTimeout:8_000,maxHeaderSize:8192},async(req,res)=>{
  headers(res);
  try{
   if(req.headers.host!==url.host)throw fail(421,'invalid_host');
   if(!req.url?.startsWith('/')||req.url.startsWith('//'))throw fail(400,'invalid');
   const target=new URL(req.url,origin),path=target.pathname;
   if(path.startsWith('/beam/workspaces/api/')){
    if(target.search||!['GET','POST'].includes(req.method))throw fail(404,'not_found');
    if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')throw fail(403,'invalid_origin');
    if(req.method==='POST'&&req.headers.origin!==origin)throw fail(403,'invalid_origin');
    const route=routes[req.method+' '+path.slice('/beam/workspaces/api'.length)];
    if(!route)throw fail(404,'not_found');
    prune();await route(req,res);return;
   }
   if(!['GET','HEAD'].includes(req.method))throw fail(404,'not_found');
   const staticEntry=staticFiles.get(path);
   if(staticEntry){
    const bytes=await readFile(new URL(staticEntry[0],publicRoot));
    res.writeHead(200,{'Content-Type':staticEntry[1]}).end(req.method==='HEAD'?undefined:bytes);return;
   }
   const name=path==='/beam/'?'index.html':path.startsWith('/beam/')?path.slice(6):'';
   const type=beamFiles.get(name);
   if(!type)throw fail(404,'not_found');
   let bytes=await readFile(new URL(name,buildRoot));
   if(name==='index.html'){
    const marker='<body';const html=bytes.toString();
    if(!html.includes(marker)||!html.includes('</header>'))throw fail(503,'build_required');
    bytes=html.replace('</header>','</header><div class="app-shell" style="padding:0 20px"><a href="/beam/workspaces/">작업공간 참여 · 관리</a></div>');
   }
   headers(res,beamPolicy);
   res.writeHead(200,{'Content-Type':type}).end(req.method==='HEAD'?undefined:bytes);
  }catch(error){
   if(!res.headersSent)json(res,{error:error.status?error.message:'unavailable'},error.status||503);
   else res.end();
  }
 });
}
