import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const source=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to,app.indexOf(from)+from.length));
const core=source('const BrowserRecovery=(()=>{','\n$(\'save\').onclick');
const fingerprint=source('const ReferenceFingerprint=(()=>{','// Exact legacy JSON token comparison');
const delta=source('const WorkDelta=(()=>{','/* Crash recovery:');
const normal=(id='EX-A')=>({
 version:1,data:{raw:[{receipt:id,sku:'ITEM-A',qty:2}],sku:[],loc:[]},scans:[],pending:[],audit:[],
 currentBatch:'WORK-ONE',workNumber:1,receipt:'',sources:{raw:'private-source.xlsx'},customerNames:{[id]:['Private lookup label']},
});
const entry={id:'ENTRY-1',sku:'ITEM-A',kind:'sku',at:'2026-11-24T11:00:00Z',qty:1,batch:'WORK-ONE',receipt:'EX-A'};
function setup(store,start){
 let ids=0,value=start,painted,restored=0,allowRestore=true,work=false;
 const cache=new WeakMap(),c=vm.createContext({console,crypto:webcrypto,TextEncoder,clearTimeout,setTimeout,language:'en',state:start,
  Engine:{getIndex(data){if(!cache.has(data))cache.set(data,{});return cache.get(data);},validateSession(){}},
  MappingCore:{checkedCustomerNames:names=>names||{}},workFields:[],checkedWorkJSONSize(){},
 });
 vm.runInContext(fingerprint+delta+core+`
  function awaitReferenceFingerprint(){return ReferenceFingerprint.wait();}
  globalThis.f=ReferenceFingerprint;globalThis.delta=WorkDelta;globalThis.recovery=BrowserRecovery;`,c);
 const recovery=c.recovery.create({
  context:()=>value.data.raw.length?{reference:c.f.request(),names:value.customerNames}:null,
  reference:c.delta.recoveryReference,prepare:()=>c.delta.prepareSave({compact:true}),
  hasWork:()=>work,store,paint:x=>{painted=x},id:()=>String(++ids)+'@'+tag,now:()=>entry.at,
  prepareRestore:c.delta.prepareRestore,confirmRestore:()=>allowRestore,confirmReplace:()=>true,
  finishRestore:plan=>{value=c.state=c.delta.finalizeRestore(plan);restored++;},
 });
 const tag=++clients;
 return {recovery,
  use(next,hasWork=false){value=c.state=next;work=hasWork;},
  read:()=>value,painted:()=>painted,restored:()=>restored,cancel:()=>allowRestore=false,
  async flush(){recovery.schedule(60000);await recovery.flush();},
 };
}
let clients=0;
function database(){
 const records=new Map();
 return {records,
  async read(key){return structuredClone(records.get(key)??null);},
  async hasDraft(){return records.size>0;},
  async write(value,expected){
   if((records.get(value.key)?.revision??null)!==expected)return false;
   records.set(value.key,structuredClone(value));return true;
  },
 };
}
test('startup waits for matching RAW; source data or names mismatches cannot restore or erase the draft',async()=>{
 const store=database(),first=setup(store,normal()),fresh=setup(store,{data:{raw:[]}});
 first.use({...normal(),receipt:'EX-A',scans:[entry]},true);
 await first.flush();assert.equal(first.painted().kind,'saved');assert.equal(store.records.size,1);
 const original=[...store.records.values()][0],text=original.text,parsed=JSON.parse(text);
 assert.equal(parsed.work.scans[0].sku,'ITEM-A');assert.equal(parsed.work.data,undefined);
 assert.doesNotMatch(text,/private-source\.xlsx|Private lookup label/);
 await fresh.recovery.flush();assert.equal(fresh.painted().kind,'needs-raw');
 fresh.use(normal('EX-B'));await fresh.flush();assert.equal(fresh.painted().kind,'other');assert.equal(await fresh.recovery.recover(),false);
 fresh.use({...normal(),customerNames:{'EX-A':['Changed lookup']}});await fresh.flush();
 assert.equal(fresh.painted().kind,'other');assert.equal(await fresh.recovery.recover(),false);
 assert.deepEqual([...store.records.values()],[original]);
 fresh.use(normal());await fresh.flush();assert.equal(fresh.painted().kind,'offer');
 assert.equal(await fresh.recovery.recover(),true);assert.equal(fresh.restored(),1);
 assert.equal(fresh.read().scans[0].sku,'ITEM-A');assert.equal(fresh.read().data.raw[0].receipt,'EX-A');
 assert.equal(fresh.read().sources.raw,'private-source.xlsx');
});
test('an overlooked recovery is not overwritten and a stale open tab loses its compare-and-swap',async()=>{
 const store=database(),a=setup(store,normal()),b=setup(store,normal()),incoming=setup(store,normal());
 await Promise.all([a.flush(),b.flush()]);
 a.use({...a.read(),receipt:'EX-A',scans:[entry]},true);
 b.use({...b.read(),receipt:'EX-A',scans:[{...entry,id:'STALE'}]},true);
 await a.flush();const [saved]=store.records.values();await b.flush();
 assert.equal(b.painted().kind,'offer');assert.deepEqual([...store.records.values()],[saved]);
 incoming.use({...incoming.read(),receipt:'EX-A',scans:[{...entry,id:'OTHER'}]},true);
 await incoming.flush();incoming.cancel();
 assert.equal(await incoming.recovery.recover(),false);assert.equal(incoming.restored(),0);assert.deepEqual([...store.records.values()],[saved]);
 assert.equal(await incoming.recovery.replace(),true);assert.equal(JSON.parse([...store.records.values()][0].text).work.scans[0].id,'OTHER');
});
test('unavailable browser storage or corrupt recovery leaves current work untouched',async()=>{
 const nope=setup({hasDraft:async()=>{throw Error('No storage');}},{data:{raw:[]}});
 await nope.recovery.flush();assert.equal(nope.painted().kind,'unavailable');
 const bad=setup({read:async()=>({revision:'r1',savedAt:entry.at,text:'not JSON'}),hasDraft:async()=>true},normal());
 await bad.flush();assert.equal(bad.painted().kind,'offer');assert.equal(await bad.recovery.recover(),false);
 assert.equal(bad.painted().kind,'restore-error');assert.equal(bad.read().scans.length,0);
});
