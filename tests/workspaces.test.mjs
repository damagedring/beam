import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createWorkspaceServer } from '../workspaces/server.mjs';

const alpha='a'.repeat(40),beta='b'.repeat(40);
const config={brands:[{id:'a',name:'A 브랜드'},{id:'b',name:'B 브랜드'},{id:'c',name:'C 브랜드'}],hosts:[
 {id:'one',key:alpha,brands:['a','b']},{id:'two',key:beta,brands:['c']},
]};
let time=Date.now(),server,origin;
before(async()=>{
 const probe=createServer().listen(0,'127.0.0.1');await once(probe,'listening');
 const {port}=probe.address();await new Promise(resolve=>probe.close(resolve));
 origin='http://127.0.0.1:'+port;
 server=createWorkspaceServer({origin,config,now:()=>time}).listen(port,'127.0.0.1');await once(server,'listening');
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});
function client() {
 const jar=new Map();
 return async(path,body,extra={})=>{
  const response=await fetch(origin+'/beam/workspaces/api/'+path,{
   headers:{cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),
    ...(body===undefined?{}:{origin,'content-type':'application/json'}),...extra},
   ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),
  });
  for(const header of response.headers.getSetCookie()){
   assert.match(header,/HttpOnly; SameSite=Strict; Path=\/beam\/workspaces\//);
   const [name,value]=header.split(';')[0].split('=');
   if(value)jar.set(name,value);else jar.delete(name);
  }
  return {status:response.status,data:await response.json()};
 };
}
test('one manager can invite for multiple assigned brands; membership remains separately approved',async()=>{
 const host=client(),otherHost=client(),device=client(),otherDevice=client();
 assert.equal((await host('invite',{spaceId:'a'})).status,401);
 assert.equal((await host('host',{key:alpha})).status,200);
 const initial=await host('host');
 assert.deepEqual(initial.data.spaces.map(b=>[b.id,b.code]),[['a',null],['b',null]]);
 assert.equal((await host('invite',{spaceId:'c'})).status,404);
 const a=(await host('invite',{spaceId:'a'})).data;
 const b=(await host('invite',{spaceId:'b'})).data;
 assert.match(a.code,/^[2-9A-HJ-NP-Z]{10}$/);
 assert.notEqual(a.code,b.code);
 const entered=(await device('join',{code:a.code.slice(0,5)+'-'+a.code.slice(5)})).data;
 assert.equal(entered.status,'pending');
 assert.ok(!('code' in entered));
 assert.deepEqual((await device('mine')).data.spaces.map(s=>s.brand),['A 브랜드']);
 assert.deepEqual((await otherDevice('mine')).data.spaces,[]);
 const aLive=(await host('host')).data.spaces.find(s=>s.id===a.id);
 const member=aLive.members[0];
 assert.equal((await otherHost('host',{key:beta})).status,200);
 assert.deepEqual((await otherHost('host')).data.spaces.map(s=>s.id),['c']);
 assert.equal((await otherHost('decide',{spaceId:a.id,memberId:member.id,approve:true})).status,404);
 assert.equal((await host('decide',{spaceId:b.id,memberId:member.id,approve:true})).status,404);
 assert.equal((await host('decide',{spaceId:a.id,memberId:member.id,approve:true})).status,200);
 assert.equal((await device('mine')).data.spaces[0].status,'approved');
 assert.equal((await device('join',{code:a.code})).data.number,entered.number);
 const second=(await device('join',{code:b.code})).data;
 assert.equal(second.status,'pending');
 assert.equal((await device('mine')).data.spaces.length,2);
 assert.equal((await host('close-invite',{spaceId:a.id})).status,200);
 assert.equal((await otherDevice('join',{code:a.code})).status,404);
 assert.equal((await device('mine')).data.spaces[0].status,'approved');
 time+=9*3600_000;
 assert.equal((await device('join',{code:b.code})).status,404);
 assert.equal((await device('mine')).data.spaces[0].status,'approved');
 assert.deepEqual((await host('host')).data.spaces.map(s=>[s.id,s.code]),[['a',null],['b',null]]);
 const renewed=(await host('invite',{spaceId:'a'})).data;
 const rotated=(await host('invite',{spaceId:'a'})).data;
 assert.equal((await otherDevice('join',{code:renewed.code})).status,404);
 assert.equal((await host('decide',{spaceId:a.id,memberId:member.id,approve:false})).status,200);
 assert.equal((await device('join',{code:rotated.code})).data.status,'denied');
 time+=4*3600_000;
 assert.deepEqual((await device('mine')).data.spaces,[]);
 assert.equal((await host('host')).status,401);
 assert.equal((await host('host',{key:alpha})).data.ok,true);
 assert.equal((await host('signout',{})).status,200);
 assert.equal((await host('host')).status,401);
});
test('write requests check actual origin, allow only known fields, and have no spreadsheet or work API',async()=>{
 const host=client(),guest=client();
 assert.equal((await host('host',{key:alpha},{origin:'https://elsewhere.invalid'})).status,403);
 assert.equal((await host('host',{key:alpha},{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await host('host',{key:alpha})).status,200);
 assert.equal((await host('invite',{spaceId:'a',raw:[]})).status,400);
 assert.equal((await guest('join',{code:'1111111111',items:[]})).status,400);
 assert.equal((await guest('upload',{size:200})).status,404);
 assert.equal((await guest('join',{code:'x'.repeat(3000)})).status,413);
 const publicFrame=await fetch(origin+'/beam/');
 assert.match(await publicFrame.text(),/작업공간 참여 · 관리/);
 assert.match(publicFrame.headers.get('content-security-policy'),/connect-src 'none'/);
 const shift=await fetch(origin+'/beam/workspaces/');
 assert.match(await shift.text(),/작업공간 참여/);
 assert.match(shift.headers.get('content-security-policy'),/connect-src 'self'/);
 assert.match(shift.headers.get('cache-control'),/no-store/);
});
test('deployment configuration refuses public cleartext and cross-brand misconfiguration',()=>{
 assert.throws(()=>createWorkspaceServer({origin:'http://8.8.8.8',config}),/HTTPS/);
 assert.throws(()=>createWorkspaceServer({origin:'http://127.0.0.1:8080',config:{...config,hosts:[{id:'bad',key:alpha,brands:['unknown']} ]}}),/configuration|brand assignment/);
});
