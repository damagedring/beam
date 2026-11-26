import { createBrowserRecovery, hasRecoveryRecords, offerRecoveryDraft } from '../src/features/returns/recovery.js';
import { createReferenceFingerprint } from '../src/platform/reference-fingerprint.js';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const source=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to,app.indexOf(from)+from.length));
const delta=source('const WorkDelta=(()=>{',"\n$('save').onclick");
const normal=(id='EX-A')=>({
 version:1,data:{raw:[{receipt:id,sku:'ITEM-A',qty:2}],sku:[],loc:[]},scans:[],pending:[],audit:[],
 currentBatch:'WORK-ONE',workNumber:1,receipt:'',sources:{raw:'private-source.xlsx'},customerNames:{[id]:['Private lookup label']},
});
const entry={id:'ENTRY-1',sku:'ITEM-A',kind:'sku',at:'2026-11-24T11:00:00Z',qty:1,batch:'WORK-ONE',receipt:'EX-A'};
function setup(store,start,discardDecision){
 let ids=0,value=start,painted,restored=0,allowRestore=true,work=false;
 const cache=new WeakMap(),c=vm.createContext({console,crypto:webcrypto,TextEncoder,clearTimeout,setTimeout,language:'en',state:start,
  Engine:{getIndex(data){if(!cache.has(data))cache.set(data,{});return cache.get(data);},validateSession(){}},
  MappingCore:{checkedCustomerNames:names=>names||{}},workFields:[],checkedWorkJSONSize(){},
 });
 c.ReferenceFingerprint=createReferenceFingerprint({currentData:()=>c.state.data,getIndex:c.Engine.getIndex,refresh(){}});
 vm.runInContext(delta+`
  function awaitReferenceFingerprint(){return ReferenceFingerprint.wait();}
  globalThis.f=ReferenceFingerprint;globalThis.delta=WorkDelta;`,c);
 const recovery=createBrowserRecovery({
  context:()=>value.data.raw.length?{reference:c.f.request(),names:value.customerNames}:null,
  reference:c.delta.recoveryReference,prepare:()=>c.delta.prepareSave({compact:true}),
  hasWork:()=>work,store,paint:x=>{painted=x},id:()=>String(++ids)+'@'+tag,now:()=>entry.at,
  prepareRestore:c.delta.prepareRestore,confirmRestore:()=>allowRestore,confirmReplace:()=>true,confirmDiscard:discardDecision||(()=>allowRestore),
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
  async inspectDrafts(){return {exists:records.size>0,entry:records.size===1?{...[...records.values()][0],text:undefined}:null};},
  async discard(key,revision){
   if(records.get(key)?.revision!==revision)return false;
   return records.delete(key);
  },
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
 const nope=setup({inspectDrafts:async()=>{throw Error('No storage');}},{data:{raw:[]}});
 await nope.recovery.flush();assert.equal(nope.painted().kind,'unavailable');
 const bad=setup({read:async()=>({revision:'r1',savedAt:entry.at,text:'not JSON'}),hasDraft:async()=>true},normal());
 await bad.flush();assert.equal(bad.painted().kind,'offer');assert.equal(await bad.recovery.recover(),false);
 assert.equal(bad.painted().kind,'restore-error');assert.equal(bad.read().scans.length,0);
});

test('an earlier saved indicator clears as soon as the next inspection change is pending',async()=>{
 const store=database(),client=setup(store,normal());
 client.use({...normal(),receipt:'EX-A'},true);
 await client.flush();
 assert.equal(client.painted().kind,'saved');
 client.use({...client.read(),scans:[entry]},true);
 client.recovery.schedule(60000);
 assert.equal(client.painted().kind,'saving');
 assert.deepEqual(JSON.parse([...store.records.values()][0].text).work.scans,[]);
 await client.recovery.flush();
 assert.equal(client.painted().kind,'saved');
 assert.equal(JSON.parse([...store.records.values()][0].text).work.scans[0].id,entry.id);
});

test('discard a single unopened browser recovery only after confirmation, with revision protection',async()=>{
 const store=database(),first=setup(store,normal()),fresh=setup(store,{data:{raw:[]}});
 first.use({...normal(),receipt:'EX-A',scans:[entry]},true);
 await first.flush();
 await fresh.recovery.flush();assert.equal(fresh.painted().kind,'needs-raw');
 const original=[...store.records.values()][0];
 first.use({...first.read(),scans:[entry,{...entry,id:'NEW'}]},true);
 await first.flush();
 assert.equal(await fresh.recovery.discard(),false);
 assert.notEqual([...store.records.values()][0].revision,original.revision);
 assert.equal(await fresh.recovery.discard(),true);
 assert.equal(fresh.painted().kind,'discarded');assert.equal(store.records.size,0);
 assert.equal(first.read().scans.length,2);
});
test('multiple unmatched browser recoveries cannot be deleted as a group; discard exact matching copy only',async()=>{
 const store=database(),a=setup(store,normal()),b=setup(store,normal('EX-B')),fresh=setup(store,{data:{raw:[]}});
 a.use({...normal(),receipt:'EX-A'},true);b.use({...normal('EX-B'),receipt:'EX-B'},true);
 await a.flush();await b.flush();await fresh.recovery.flush();
 assert.equal(fresh.painted().kind,'needs-raw');assert.equal(fresh.painted().draft,null);
 assert.equal(await fresh.recovery.discard(),false);assert.equal(store.records.size,2);
 fresh.use(normal());await fresh.flush();assert.equal(fresh.painted().kind,'offer');
 const matched=fresh.painted().draft.key;
 assert.equal(await fresh.recovery.discard(),true);assert.equal(store.records.has(matched),false);assert.equal(store.records.size,1);
});

test('the in-app discard dialog makes no write until accepted and rejects a revision changed while open',async()=>{
 const store=database(),first=setup(store,normal());
 first.use({...normal(),receipt:'EX-A',scans:[entry]},true);await first.flush();
 let answer;
 const fresh=setup(store,{data:{raw:[]}},()=>new Promise(resolve=>{answer=resolve;}));
 await fresh.recovery.flush();
 const original=[...store.records.values()][0];
 const cancel=fresh.recovery.discard();
 assert.equal(await fresh.recovery.discard(),false);
 assert.deepEqual([...store.records.values()],[original]);
 answer(false);assert.equal(await cancel,false);
 assert.deepEqual([...store.records.values()],[original]);
 const stale=fresh.recovery.discard();
 first.use({...first.read(),scans:[entry,{...entry,id:'FRESH'}]},true);await first.flush();
 answer(true);assert.equal(await stale,false);
 assert.notEqual([...store.records.values()][0].revision,original.revision);
 const accept=fresh.recovery.discard();
 answer(true);assert.equal(await accept,true);
 assert.equal(store.records.size,0);
});

test('viewing or switching an order is not recoverable work; inspections and previous sheets still are',()=>{
 const opened={receipt:'EX-A',orderTabs:['EX-A','EX-B'],currentBatch:'ONE',audit:[]};
 assert.equal(hasRecoveryRecords(opened),false);
 for(const work of [
  {...opened,scans:[entry]}, {...opened,pending:[entry]}, {...opened,audit:[{events:[entry]}]},
  {...opened,confirmationCommitments:[{}]}, {...opened,workSheets:[{confirmations:[{}]}]},
 ])assert.equal(hasRecoveryRecords(work),true);
 const draft=work=>({text:JSON.stringify({format:'logistics-work-delta',version:1,work})});
 assert.equal(offerRecoveryDraft(draft(opened)),false);
 assert.equal(offerRecoveryDraft(draft({...opened,scans:[entry]})),true);
 assert.equal(offerRecoveryDraft({text:'not json'}),true);
});
