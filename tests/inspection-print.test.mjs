import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {encodeReceiptCode128} from '../src/domain/code128.js';

const src=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../dist/app.css',import.meta.url),'utf8');
const cut=(from,to)=>src.slice(src.indexOf(from),src.indexOf(to));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=vm.runInNewContext(cut('function printLocalTime(', 'function inspectionReport(')+cut('function receiptBarcodeValue(', 'function showReceiptBarcode(')+
  '({printReceiptPda,printSheet})',{printL:(a)=>a,esc,rawRows:id=>id==='missing'?[]:[{receipt:id}],encodeReceiptCode128});
function readBars(html) {
 const [_,modules,mm]=html.match(/viewBox="0 0 (\d+) 26" width="([\d.]+)mm" height="26mm"/);
 const bars=[...html.matchAll(/<rect x="(\d+)" y="0" width="(\d+)" height="26"\/>/g)].map(m=>[+m[1],+m[2]]);
 return {modules:+modules,mm:+mm,bars};
}
test('internal PDA entry encodes the exact receipt ID, including leading zeroes, with real black bars and white quiet zones',()=>{
 const barcode=api.printReceiptPda('00001234');
 const {modules,mm,bars}=readBars(barcode);
 const exact=encodeReceiptCode128('00001234');
 assert.equal(modules,exact.modules);
 assert.equal(bars[0][0],10);
 assert.equal(modules-bars.at(-1).reduce((a,b)=>a+b),10);
 assert.match(barcode,/width="100%" height="100%" fill="#fff".*<g fill="#000">/);
 assert.match(barcode,/<strong class="pr-pda-value">00001234<\/strong>/);
 assert.match(barcode,/data-pda-paper="portrait"/);
 assert.equal(mm,112);
 const report=api.printSheet('반품 검수 결과','주문별 대조표',[['입고 주문 ID','00001234']],['<section>대조 결과</section>'],'비고',{external:'EX-08',party:'가상 매장',quantity:'10 EA',barcode});
 assert.ok(report.indexOf('EX-08')<report.indexOf('내부 PDA 진입용 바코드'));
 assert.ok(report.indexOf('주문별 대조표')<report.indexOf('Code 128 · 00001234'));
 assert.ok(report.indexOf('Code 128 · 00001234')<report.lastIndexOf('대조 결과'));
 assert.doesNotMatch(report,/Code 128 · EX-08/);
});
test('long supported IDs use landscape instead of clipping; invalid IDs cannot become misleading marks',()=>{
 const barcode=api.printReceiptPda('A'.repeat(80));
 assert.match(barcode,/data-pda-paper="landscape"/);
 const {modules,mm}=readBars(barcode);
 assert.ok(mm/modules>=.2599);
 assert.ok(mm<253);
 assert.match(css,/@page beam-pda-wide \{size:A4 landscape/);
 assert.match(css,/#printReport\[data-paper="landscape"\].*page:beam-pda-wide/);
 for(const value of ['missing','한글 ID','A'.repeat(81)]){
  const fallback=api.printReceiptPda(value);
  assert.match(fallback,/바코드로 인쇄할 수 없어요/);
  assert.doesNotMatch(fallback,/<svg/);
 }
});
test('the scan history layout is not converted into an order label',()=>{
 const history=api.printSheet('스캔 이력','작업 이력',[],[],'');
 assert.match(history,/pr-heading/);
 assert.doesNotMatch(history,/pr-inspection|pr-pda/);
});
