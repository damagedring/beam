import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestScanEvent, recentScanEvents, scanHistoryPage } from '../src/domain/scan-history.js';

const oldLatest=events=>events.slice().sort((a,b)=>(a.sequence||0)-(b.sequence||0)||Date.parse(a.at)-Date.parse(b.at)).at(-1);
const oldHistory=(events,start,end)=>events.map((e,i)=>({e,i})).sort((a,b)=>Date.parse(a.e.at)-Date.parse(b.e.at)||a.i-b.i).slice(start,end).map(x=>x.e);

test('scan history and undo preserve stable ordering on ties, legacy entries, undo and reassignment',()=>{
 const start=Date.UTC(2026,0,1);
 const gen=n=>Array.from({length:n},(_,i)=>({id:i,at:new Date(start+((i*79)%293)*1000).toISOString(),sequence:i%4?i%173:undefined}));
 const fixture=gen(600);
 const legacy=gen(3).map((e,i)=>({...e,sequence:['9','10','10'][i]}));
 for(const events of [[],gen(1),gen(4),legacy,fixture,fixture.toReversed(),fixture.toSpliced(119,1),fixture.toSpliced(100,0,{id:'moved',at:fixture[100].at,sequence:fixture[100].sequence}),fixture.toSpliced(40,0,{id:'old',at:'invalid',sequence:172})]){
  assert.strictEqual(latestScanEvent(events),oldLatest(events));
  assert.deepEqual(recentScanEvents(events),oldHistory(events,-5));
  for(const [start,end] of [[0,200],[200,400],[400,600]])assert.deepEqual(scanHistoryPage(events,start,end),oldHistory(events,start,end));
 }
});

test('recent scan selection reads each timestamp at most once rather than parsing each comparison',()=>{
 let reads=0;
 const size=20_000;
 const events=Array.from({length:size},(_,i)=>{const at=new Date(1767225600000+((i*7993)%size)*1000).toISOString();return {i,get at(){reads++;return at;}};});
 const actual=recentScanEvents(events);
 assert.equal(reads,size);
 reads=0;
 assert.deepEqual(actual,oldHistory(events,-5));
 assert.ok(reads>size*5,'fixture requires substantial comparison work on the old path');
});
