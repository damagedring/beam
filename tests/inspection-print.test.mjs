import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {encodeReceiptCode128} from '../src/domain/code128.js';
import {renderInspectionHeader,renderInspectionReport,renderOutboundDispatch} from '../src/domain/inspection-report.js';

const css=await readFile(new URL('../dist/app.css',import.meta.url),'utf8');
const src=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const cut=(from,to)=>src.slice(src.indexOf(from),src.indexOf(to));
const render=(orderId,overrides={})=>renderInspectionReport({mode:'return',orderId,...overrides});
const item={status:'일치',name:'가상 상품',sku:'SKU-A',barcode:'0012345',expected:3,actual:3};
function readBars(html) {
 const [_,modules,mm]=html.match(/viewBox="0 0 (\d+) 26" width="([\d.]+)mm" height="26mm"/);
 const bars=[...html.matchAll(/<rect x="(\d+)" y="0" width="(\d+)" height="26"\/>/g)].map(m=>[+m[1],+m[2]]);
 return {modules:+modules,mm:+mm,bars};
}
test('the printed order number encodes the exact internal ID, not the external ID',()=>{
 const {markup,paper}=render('00001234',{externalId:'EX-08',party:'가상 매장',rows:[item]});
 const {modules,mm,bars}=readBars(markup);
 assert.equal(modules,encodeReceiptCode128('00001234').modules);
 assert.equal(bars[0][0],10);
 assert.equal(modules-bars.at(-1).reduce((a,b)=>a+b),10);
 assert.match(markup,/width="100%" height="100%" fill="#fff".*<g fill="#000">/);
 assert.match(markup,/<b>Order No\.<\/b>.*Code 128 · 00001234.*class="pr-pda-value">00001234<\/strong>/);
 assert.doesNotMatch(markup,/Code 128 · EX-08|내부 PDA|입고 예정|pr-end|pr-issued|pr-caption-line|pr-fields|>일치</);
 assert.match(markup,/>Matched<.*가상 상품/);
 assert.ok(markup.indexOf('Code 128 · 00001234')<markup.indexOf('Inspection results"',markup.indexOf('<table')));
 assert.equal(paper,'portrait');
 assert.equal(mm,112);
});
test('return and outbound produce the same label structure with only workflow-specific title and data',()=>{
 const returns=render('RET-01',{rows:[item]});
 const outbound=render('OUT-01',{mode:'outbound',rows:[item]});
 assert.match(outbound.markup,/<h1>Outbound Inspection Report<\/h1>/);
 assert.doesNotMatch(outbound.markup,/반품|ASN|입고|<th scope="col">위치<\/th>/);
 const omitBars=html=>html.replace(/<svg.*?<\/svg>/,'<svg/>');
 assert.equal(omitBars(outbound.markup).replaceAll('OUT-01','RET-01').replace('Outbound Inspection Report','Return Inspection Report'),omitBars(returns.markup));
 const english=render('OUT-01',{mode:'outbound',rows:[{...item,location:'A-10',actual:2}]});
 assert.match(english.markup,/<h1>Outbound Inspection Report<\/h1>.*<b>Order No\.<\/b>.*>-1<\/td>/);
 for(const mode of ['return','outbound']){
  const report=render('EXPORT-01',{mode,rows:[{...item,location:'A-10',actual:2}]}).markup;
  assert.doesNotMatch(report,/>Location<|>A-10</);
  assert.deepEqual([...report.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map(m=>m[1]),['Status','Barcode / SKU','Product','Expected','Checked','Difference']);
 }
 assert.doesNotMatch(render('RET-01',{externalId:'RET-01'}).markup,/External Order No\./);
});
test('long supported IDs use landscape; unsupported values have no misleading barcode',()=>{
 const {markup,paper}=render('A'.repeat(80));
 const {modules,mm}=readBars(markup);
 assert.equal(paper,'landscape');
 assert.ok(mm/modules>=.2599&&mm<253);
 assert.match(css,/@page beam-pda-wide \{size:A4 landscape/);
 assert.match(css,/#printReport\[data-paper="landscape"\].*page:beam-pda-wide/);
 for(const value of ['','한글 ID','A'.repeat(81)]){
  const fallback=render(value).markup;
  assert.match(fallback,/Barcode unavailable/);
  assert.doesNotMatch(fallback,/<svg/);
 }
});
test('the existing Return screen passes its selected internal order to the shared renderer',()=>{
 const api=vm.runInNewContext(cut('function inspectionPrintContext(', 'function scanHistoryReport(')+'inspectionReport',{
  state:{receipt:'00001234'},rawRows:()=>[{seller:'Store',external:'EXT-55'}],printL:a=>a,language:'ko',isB2C:()=>false,
  sortProductRows:x=>x,currentOrderComparison:()=>[item],uiData:x=>x,tr:x=>x,
  renderInspectionReport,
 });
 const {markup}=api();
 assert.match(markup,/Return Inspection Report.*Code 128 · 00001234/);
 assert.doesNotMatch(markup,/Code 128 · EXT-55/);
});

test('the actual print handlers mount the work, order and Code 128 for both menus and native print',()=>{
 const root={dataset:{},innerHTML:''},handlers={};
 const document={title:'Beam'};
 const runtime={
  state:{receipt:'00001234',workNumber:12},rawRows:()=>[{seller:'Example',external:'EX-08'}],
  isB2C:()=>false,sortProductRows:x=>x,currentOrderComparison:()=>[item],
  renderInspectionHeader,renderInspectionReport,sheetEvents:()=>[],activeWorkAudit:()=>[],
  esc:String,printL:(ko,en)=>en,notice(){},date:()=>new Date().toISOString(),document,
  $:()=>root,window:{print(){handlers.body=root.innerHTML;},addEventListener(name,fn){handlers[name]=fn;}}
 };
 const listeners=cut("window.addEventListener('beforeprint'", 'function resetPrintDocument()')+src.split('\n').find(l=>l.startsWith("window.addEventListener('afterprint'"));
 const api=vm.runInNewContext(cut('function printLocalTime(', "const productLabels=attachProductLabels")+cut('function resetPrintDocument()', "window.addEventListener('afterprint'")+listeners+'\nopenPrintDocument',runtime);
 for(const [kind,title] of [['comparison','Return Inspection Report'],['history','Return Inspection Scan History']]){
  api(kind);
  assert.match(handlers.body,new RegExp('<h1>'+title+'</h1>'));
  assert.match(handlers.body,/Work 12 · B2B.*Code 128 · 00001234/);
  assert.doesNotMatch(handlers.body,/<header class="pr-label"|Code 128 · EX-08/);
  handlers.beforeprint();
  assert.equal(root.innerHTML,handlers.body);
  handlers.afterprint();
  assert.equal(document.title,'Beam');
 }
 handlers.beforeprint();
 assert.match(root.innerHTML,/Return Inspection Report.*Code 128 · 00001234/);
 assert.doesNotMatch(root.innerHTML,/\[object Object\]/);
 assert.equal(root.dataset.paper,'portrait');
});


test('shipment summary is a separate order-wide document with distinct identifiers and escaped destinations',()=>{
 const {title,markup}=renderOutboundDispatch({orderId:'00077',externalId:'EXT-77',stores:['Store <West>'],countries:['KR','JP'],cartons:['BX 01','BX 02','BX 03']});
 assert.equal(title,'Outbound Shipment Summary');
 assert.match(markup,/Code 128 · 00077/);
 assert.match(markup,/<dt>External Order No\.<\/dt><dd>EXT-77/);
 assert.match(markup,/<dt>Total Cartons<\/dt><dd>3/);
 assert.match(markup,/Store &lt;West&gt;.*KR · JP/);
 assert.match(markup,/<li>BX 02<\/li>/);
 assert.doesNotMatch(markup,/Code 128 · EXT-77|Inspection results|<td>|<West>/);
 assert.equal(renderOutboundDispatch({orderId:'00077'}).markup.match(/Not provided/g).length,2);
 const hidden=renderOutboundDispatch({orderId:'00077',externalId:'EXT-77',stores:['Test'],fields:['externalId']}).markup;
 assert.match(hidden,/EXT-77/);assert.doesNotMatch(hidden,/00077|Code 128|Total Cartons|Destination|Carton Labels/);
});
