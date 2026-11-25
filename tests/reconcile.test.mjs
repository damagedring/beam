import {test} from 'node:test';
import assert from 'node:assert/strict';
import {asnProgress, candidateReceipts, entryOutcome, excessEntrySet, inspectEntry, reconcile, readScanIndex} from '../src/domain/reconcile.js';
import {createScannerBurst} from '../src/domain/scanner-input.js';

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
