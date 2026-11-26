import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { formatReturnReport, validateReturnReportProfile } from '../src/domain/return-report.js';
import { readScanIndex, reconcile, masterInfo, eventCode, units } from '../src/domain/reconcile.js';

const row=(size,sku,actual,expected)=>({name:'Balencianã · Overspan Runner / Black / EU '+size,brand:'Balencianã',sku,actual,expected});
const rows=[row(41,'SKU-41',2,1),row(42,'SKU-42',1,2),row(44,'SKU-44',1,1)];
const order={internal:'IN-123',external:'EX-456'};

test('copy starts with one line per difference and defaults to the product name only',()=>{
 assert.equal(formatReturnReport({rows,order}),[
  '∙ Overspan Runner / Black / EU 41 [ 1 EA ] 과입고 (전산 수량보다 +1)',
  '∙ Overspan Runner / Black / EU 42 [ 1 EA ] 미입고 (전산 수량보다 -1)',
  '∙ 전체 입고 수량 4EA, 기재된 내역 이외 나머지 SKU는 전산과 실물 일치',
 ].join('\n\n'));
});

test('profile fields opt into order IDs, SKU and brand independently',()=>{
 const profile=validateReturnReportProfile({fields:['sku','sku',true,'unsupported','orderIds']});
 assert.deepEqual(profile,{fields:['orderIds','sku']});
 const report=formatReturnReport({rows,order,profile});
 assert.match(report,/^∙ Overspan Runner \/ Black \/ EU 41 \[SKU-41\]/);
 assert.match(report,/외부 주문 ID EX-456 · 내부 주문 ID IN-123/);
 assert.doesNotMatch(report,/Balencianã|보고 범위/);
 assert.match(formatReturnReport({rows,order,profile:{fields:['brand']},english:true}),/^∙ Balencianã · Overspan Runner/);
 assert.deepEqual(validateReturnReportProfile({fields:'sku'}),{fields:[]});
});

test('outside-order products and unverified codes are distinct; unassigned units are not double counted',()=>{
 const report=formatReturnReport({
  rows:[...rows,{name:'Tee\n Black',actual:2,expected:0,outside:true,known:true},{actual:1,expected:0,outside:true,known:false}],
  pending:[{name:'Pants',actual:3,known:true}],
 });
 assert.match(report,/Tee Black \[ 2 EA \] 예정 외 입고 \(전산 수량보다 \+2\)/);
 assert.match(report,/상품명 확인 필요 \[ 1 EA \] 미확인 바코드/);
 assert.match(report,/Pants \[ 3 EA \] 오더 미배정/);
 assert.match(report,/전체 입고 수량 7EA/);
 assert.match(report,/미배정 3EA는 전체 입고 수량에 미포함/);
 const pendingOnly=formatReturnReport({pending:[{actual:1,known:false}]});
 assert.doesNotMatch(pendingOnly,/전체 입고 수량|일치/);
 assert.match(pendingOnly,/미배정 수량 1EA/);
});

test('real reconciliation feeds the concise report and filters pending entries to the selected order',async()=>{
 const src=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const fn=src.slice(src.indexOf('function inspectionReportState('),src.indexOf('function referenceFingerprintState('));
 const raw=rows.map(x=>({...x,barcode:x.sku,receipt:'IN-123',qty:x.expected}));
 const data={raw,sku:[{barcode:'OUTSIDE',sku:'CAT-001',name:'Catalog Tee'}],loc:[]};
 const scans=['SKU-41','SKU-41','SKU-42','SKU-44','OUTSIDE','UNKNOWN'].map((barcode,i)=>({barcode,kind:'barcode',receipt:'IN-123',id:'s'+i}));
 const state={data,scans,receipt:'IN-123',currentBatch:'batch',pending:[
  {kind:'barcode',barcode:'OUTSIDE',id:'p1',batch:'batch',holdOrigin:'IN-123',holdForStore:'store'},
  {kind:'barcode',barcode:'DONT-LEAK',id:'p2',batch:'batch',holdOrigin:'OTHER',holdForStore:'store'},
 ]};
 const report=runInNewContext(fn+'\ninspectionReportState',{state,selectedWorkStoreKey:()=>'store',readScanIndex,rawRows:()=>raw,reconcileView:reconcile,tr:x=>x,Engine:{eventCode,masterInfo,units},receiptDisplay:()=>order.external,formatReturnReport,MappingUI:{returnReportProfile:()=>({fields:[]})},language:'ko'});
 assert.equal(report(true).mode,'report');
 assert.equal(report(true).message,'');
 assert.match(report().message,/Catalog Tee \[ 1 EA \] 예정 외 입고/);
 assert.match(report().message,/Catalog Tee \[ 1 EA \] 오더 미배정/);
 assert.match(report().message,/전체 입고 수량 6EA/);
 assert.doesNotMatch(report().message,/DONT-LEAK|IN-123|CAT-001|UNKNOWN/);
});
