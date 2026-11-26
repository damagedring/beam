import { scannedProductLabel } from './product-identity.js';

export const returnReportFields = Object.freeze(['orderIds','sku','brand']);
export function validateReturnReportProfile(value) {
 const fields=returnReportFields.filter(field=>Array.isArray(value?.fields)&&value.fields.includes(field));
 return {fields};
}

// Keep imported labels on a single line when copying to a report cell.
const oneLine=value=>String(value??'').replace(/\s+/gu,' ').trim();

export function formatReturnReport({rows=[],pending=[],order={},profile,english=false}) {
 const fields=new Set(validateReturnReportProfile(profile).fields);
 const t=(ko,en)=>english?en:ko;
 const bullet=text=>'∙ '+text;
 const amount=n=>'[ '+n+' EA ]';
 const delta=n=>(n>0?'+':'')+n;
 const differences=rows.filter(r=>r.outside||r.actual!==r.expected);
 const issues=[...differences,...pending];
 const labels=issues.map(r=>{
  const brand=oneLine(r.brand);
  const text=scannedProductLabel(oneLine(r.name),brand);
  return {name:text.name,brand,sku:oneLine(r.sku)};
 });
 const unnamed=labels.filter(r=>!r.name).length;
 let unnamedIndex=0;
 function label(index){
  const {name,brand,sku}=labels[index];
  const fallback=name||t('상품명 확인 필요','Product name unverified')+(unnamed>1?' '+(++unnamedIndex):'');
  return (fields.has('brand')&&brand?brand+' · ':'')+fallback+(fields.has('sku')&&sku?' ['+sku+']':'');
 }
 const lines=differences.map((r,index)=>{
  const n=r.actual-r.expected;
  const status=r.outside?(r.known?t('예정 외 입고','Unexpected receipt'):t('미확인 바코드','Unverified barcode')):
   n>0?t('과입고','Over received'):t('미입고','Short received');
  return bullet(label(index)+' '+amount(Math.abs(n))+' '+status+(r.outside&&!r.known?'':' ('+t('전산 수량보다','vs. expected')+' '+delta(n)+')'));
 });
 pending.forEach((r,index)=>lines.push(bullet(label(differences.length+index)+' '+amount(r.actual)+' '+(r.known?t('오더 미배정','Unassigned to order'):t('미확인 바코드 · 미배정','Unverified barcode · unassigned')))));
 if(fields.has('orderIds')){
  const ids=[['외부 주문 ID','External order ID',order.external],['내부 주문 ID','Internal order ID',order.internal]]
   .filter(([, ,id])=>oneLine(id))
   .map(([ko,en,id])=>t(ko,en)+' '+oneLine(id));
  if(ids.length)lines.push(bullet(ids.join(' · ')));
 }
 if(rows.length){
  const total=rows.reduce((sum,r)=>sum+r.actual,0);
  const hasMatched=rows.some(r=>!r.outside&&r.expected>0&&r.actual===r.expected);
  const summary=t('전체 입고 수량 '+total+'EA','Total received: '+total+' EA');
  const rest=hasMatched?(differences.length?t(', 기재된 내역 이외 나머지 SKU는 전산과 실물 일치','; all other SKUs match expected quantities'):t(', 전산과 실물 일치','; all quantities match')):'';
  lines.push(bullet(summary+rest));
 }
 if(pending.length){
  const total=pending.reduce((sum,r)=>sum+r.actual,0);
  lines.push(bullet(rows.length?t('미배정 '+total+'EA는 전체 입고 수량에 미포함', 'Unassigned quantity ('+total+' EA) excluded from order totals'):t('미배정 수량 '+total+'EA','Unassigned quantity: '+total+' EA')));
 }
 return lines.join('\n\n');
}
