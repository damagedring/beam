import {test} from 'node:test';
import assert from 'node:assert/strict';
import {asnProgress, candidateReceipts, entryOutcome, excessEntrySet, inspectEntry, inspectionOverages, reconcile, readScanIndex} from '../src/domain/reconcile.js';
import {createReturnsScanCommands} from '../src/features/returns/scan-commands.js';
import {createScannerBurst} from '../src/domain/scanner-input.js';

import {groupOverageMarkers} from '../src/components/inspection-progress/view.js';

const row=(receipt,barcode,sku,qty,name=sku)=>({receipt,barcode,sku,qty,name,seller:'Test',company:'',address:''});
const data={raw:[row('A','000001','S1',3),row('A','000002','S2',7),row('B','000003','S3',2),row('C','','S4',4)],sku:[{sku:'S4',barcode:'000004',name:'S4'}],loc:[]};
const event=(id,barcode='000001',qty=1,receipt='A')=>({receipt,id:String(id),sequence:id,kind:'code',barcode,qty,batch:'test'});

test('each scan verdict freezes at entry; aggregate stays live through append, undo and receipt moves',()=>{
 const scans=[];
 for(let n=1;n<=4;n++){
  const next=event(n);
  next.scanOutcome=entryOutcome(data,'A',scans,next);
  scans.push(next);
 }
 assert.deepEqual(scans.map(e=>e.scanOutcome),['accepted','accepted','accepted','excess']);
 assert.equal(reconcile(data,'A',scans)[0].excess,1);
 assert.deepEqual([...excessEntrySet(data,scans,'test',()=>true)],['4']);
 assert.equal(reconcile(data,'A',scans.slice(0,-1))[0].excess,0);
 assert.equal(inspectEntry(data,'A',scans,event(5)).actual,4);
 scans.push(event(5,'000001',2));
 assert.equal(readScanIndex(scans).total,6);
 assert.deepEqual([...excessEntrySet(data,scans,'test',()=>true)],['5','4']);
 assert.deepEqual(scans.slice(0,3).map(e=>e.scanOutcome),['accepted','accepted','accepted']);
});

test('coverage, confirmed surplus and unknown input are not mixed',()=>{
 const accepted=[event(1,'000001',3),event(2,'000002',7)];
 assert.equal(asnProgress(data,'A',accepted).phase,'complete');
 const unknown=event(3,'999999');
 assert.equal(entryOutcome(data,'A',accepted,unknown),'unknown');
 assert.equal(asnProgress(data,'A',[...accepted,unknown]).phase,'warning');
 assert.equal(asnProgress(data,'A',[...accepted,unknown]).percent,100);
 const over=asnProgress(data,'A',[event(1,'000001',6),event(2,'000002',7)]);
 assert.equal(over.percent,130);
 assert.equal(over.phase,'excess');
 assert.equal(over.covered,10);
 const mixed=asnProgress(data,'A',[event(1,'000001',6)]);
 assert.equal(mixed.phase,'excess');
 assert.equal(mixed.percent,30);
 assert.equal(over.excess,3);
 assert.equal(over.complete,false);
 assert.equal(asnProgress({raw:[row('D','000005','S5',1000)],sku:[],loc:[]},'D',[event(1,'000005',1001,'D')]).percent,101);
});

test('candidate lookup distinguishes another ASN, unknown, aliases and ambiguous codes',()=>{
 assert.deepEqual([...candidateReceipts(data,event(1,'000003'))],['B']);
 assert.equal(entryOutcome(data,'A',[],event(1,'000003')),'unknown');
 assert.deepEqual([...candidateReceipts(data,event(1,'unknown'))],[]);
 assert.deepEqual([...candidateReceipts(data,event(1,'000004'))],['C']);
 assert.equal(entryOutcome(data,'C',[],event(1,'000004')),'accepted');
 const alias={...data,raw:[...data.raw,row('D','000004','S4',1)]};
 assert.deepEqual([...candidateReceipts(alias,event(1,'000004'))],['D']);
 const collision={...data,raw:[...data.raw,row('A','777777','000001',1)]};
 assert.equal(entryOutcome(collision,'A',[],event(1)),'conflict');
});

test('fallback only captures complete, fast scanner-like bursts',()=>{
 const input=createScannerBurst(),run=(code,start,gap)=>{
  [...code].forEach((key,i)=>assert.equal(input.consume(key,start+i*gap),''));
  return input.consume('Enter',start+code.length*gap);
 };
 assert.equal(run('000123456789',0,9),'000123456789');
 assert.equal(run('WH00042',1000,12),'WH00042');
 assert.equal(run('Abcdefghi',2000,8),'');
 assert.equal(run('000123',3000,140),'');
 assert.equal(run('1234',5000,5),'');
 input.consume('1',6000);input.clear();
 assert.equal(input.consume('Enter',6002),'');
});

test('large reference data and long scans read only the appended entries when aggregating',()=>{
 const raw=Array.from({length:20_000},(_,i)=>Array.from({length:3},(_,n)=>row(String(i),String(i*3+n+100000),String(i*3+n),640))).flat();
 const large={raw,sku:[],loc:[]};
 let readCount=0;
 const list=new Proxy([], {get(target,key){if(typeof key==='string'&&/^\d+$/.test(key))readCount++;return Reflect.get(target,key);}});
 for(let i=0;i<600;i++){
  const scan=event(i+1,'100000',1,'0');
  assert.equal(entryOutcome(large,'0',list,scan),'accepted');
  list.push(scan);
  assert.equal(inspectEntry(large,'0',list,scan).actual,i+1);
 }
 assert.equal(readCount,600);
 assert.equal(reconcile(large,'0',list)[0].actual,600);
 assert.equal(readCount,600);
});

test('indexed excess budgets exactly preserve selection for mixed batches, whole inputs, aliases and conflicts',()=>{
 const timestamp='2026-11-24T00:00:00Z';
 const raw=[
  {receipt:'A',sku:'sku-a',barcode:'101',qty:7},
  {receipt:'A',sku:'sku-b',qty:4},
  {receipt:'A',sku:'sku-c',barcode:'303',qty:1,name:'x'},
  {receipt:'A',sku:'sku-conflict',barcode:'303',qty:1,name:'y'},
  {receipt:'B',sku:'sku-a',barcode:'101',qty:2},
  {receipt:'B',unresolvedId:'missing',qty:2},
 ];
 const data={raw,sku:[{sku:'sku-b',barcode:'202',name:'Alias'}],loc:[]};
 const codes=['101','sku-a','202','303','9999'];
 const scan=(i)=>({id:String(i+1),receipt:i%7?'A':'B',kind:i%3===0?'code':'barcode',barcode:codes[i%5],sequence:i%19,at:timestamp,qty:(i%7)+1,batch:i%4?'now':'older'});
 let scans=[];
 for(let i=0;i<180;i++){
  scans.push(scan(i));
  if(i%21===0)scans=scans.filter(e=>+e.id%3);
  const previous=new Set();
  for(const [receipt,events] of readScanIndex(scans).byReceipt){
   const budget=new Map(reconcile(data,receipt,scans).filter(r=>!r.unregistered&&!r.conflict&&!r.unresolved&&r.excess>0).map(r=>[r.key,r.excess]));
   for(const event of events.filter(e=>e.batch==='now').sort((a,b)=>(b.sequence||0)-(a.sequence||0)||Date.parse(b.at)-Date.parse(a.at))){
    const {row}=inspectEntry(data,receipt,scans,event);
    if(!row||!budget.has(row.key))continue;
    const remaining=budget.get(row.key)-event.qty;
    if(remaining>=0)previous.add(event.id);
    if(remaining<=0)budget.delete(row.key);else budget.set(row.key,remaining);
   }
  }
  assert.deepEqual([...excessEntrySet(data,scans,'now',()=>true)],[...previous]);
 }
});

test('selected Returns ASN keeps overage even when another ASN could take it',()=>{
 const refs={raw:[row('A','000001','S1',4),row('B','000001','S1',1),row('B','000002','S2',1)],sku:[],loc:[]};
 const work={data:refs,scans:[],pending:[],receipt:'A',currentBatch:'test',searchMode:'b2b'};
 let n=0,staged=0,routed=0;const feedback=[];
 const commands=createReturnsScanCommands({
  current:()=>work,identity:{id:()=>String(++n),now:()=>new Date(0).toISOString()},
  routing:{canRegister:()=>true,stageOutside:()=>staged++,moveUnique:()=>{routed++;return false;},event:id=>work.scans.find(e=>e.id===id)},
  effects:{audit(){},lastEvent(){},changed(){},draw(){},assignedFeedback:info=>feedback.push(info.outcome),audio(){},notice(){}},
 });
 for(let i=0;i<5;i++)assert.equal(commands.register({kind:'code',barcode:'000001',qty:1}),true);
 assert.deepEqual(feedback,['accepted','accepted','accepted','accepted','excess']);
 assert.equal(work.receipt,'A');assert.equal(routed,0);assert.equal(staged,0);
 assert.equal(reconcile(refs,'A',work.scans)[0].actual,5);
 assert.equal(reconcile(refs,'B',work.scans)[0].actual,0);
 assert.deepEqual([...excessEntrySet(refs,work.scans,'test',()=>true)],['5']);
 const {actual}=inspectEntry(refs,'B',work.scans,work.scans[4]);assert.equal(actual,0);
 assert.equal(commands.register({kind:'code',barcode:'000002',qty:1}),true);
 assert.equal(routed,1,'outside-ASN workflow remains distinct');assert.equal(staged,1);
 const mixed=[event(1),event(2),event(3),event(4,'000001',2)];
 assert.equal(reconcile(refs,'A',mixed)[0].excess,1);
 assert.equal(excessEntrySet(refs,mixed,'test',()=>true).size,0,'a mixed quantity event cannot move accepted units');
});

test('overage markers retain the exact scan position and at-scan quantity across further scans and undo',()=>{
 const refs={raw:[row('A','000001','S1',1),row('A','000002','S2',3)],sku:[],loc:[]};
 const t='2026-11-26T15:00:00Z',scans=[
  {...event(1),at:t,scanOutcome:'accepted'},
  {...event(2),at:t,scanOutcome:'excess'},
  {...event(3,'999999'),at:t,scanOutcome:'unknown'},
  {...event(4,'000002'),at:t,scanOutcome:'accepted'},
 ];
 const first=inspectionOverages(refs,'A',scans);
 assert.deepEqual(first,{expected:4,events:[{covered:1,position:2,at:t,name:'S1',brand:undefined,code:'S1',actual:2,expected:1,delta:1}]});
 scans.push({...event(5),at:t,scanOutcome:'excess'});
 const after=inspectionOverages(refs,'A',scans);assert.deepEqual(after.events.map(x=>[x.position,x.actual,x.delta]),[[2,2,1],[5,3,2]]);
 assert.equal(inspectionOverages(refs,'A',scans.slice(0,-1)).events.length,1);
 assert.equal(inspectionOverages(refs,'OTHER',scans).events.length,0);
 assert.deepEqual(groupOverageMarkers(after.events,4,400).map(g=>g.x),[100,200]);
 const screenshotCase=[scans[0],scans[1],scans[3]];
 const progress=asnProgress(refs,'A',screenshotCase),pinned=inspectionOverages(refs,'A',screenshotCase);
 assert.equal(progress.percent,50);assert.equal(progress.actual,3);
 assert.deepEqual(groupOverageMarkers(pinned.events,pinned.expected,400).map(g=>g.x),[100]);
 assert.deepEqual(groupOverageMarkers(first.events,first.expected,800).map(g=>g.x/800),[.25,.5]);
 const dense=Array.from({length:85},(_,i)=>({covered:i+10}));
 const groups=groupOverageMarkers(dense,94,320);
 assert.ok(groups.length<10);assert.equal(groups.flatMap(g=>g.events).length,85);
 assert.ok(groups.every(g=>g.x>=0&&g.x<=320));
});
