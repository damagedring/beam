import { encodeReceiptCode128 } from './code128.js';
import { scannedProductLabel } from './product-identity.js';

export const A4_LABEL_PAPER=Object.freeze({name:'A4',width:210,height:297});
export const LABEL_BATCH=240;
const MIN_MODULE_MM=0.33;

export function validateLabelPapers(papers=[]){
 if(!Array.isArray(papers)||papers.length>12)throw Error('Up to 12 label sizes are allowed.');
 const names=new Set(['a4']);
 return papers.map(p=>{
  if(!p||typeof p.name!=='string')throw Error('Invalid paper name.');
  const name=p.name.trim(),key=name.toLocaleLowerCase('en-US');
  if(!name||name.length>48||names.has(key)||/[\x00-\x1f\x7f]/u.test(name))throw Error('Invalid or duplicate paper name.');
  if(![p.width,p.height].every(n=>Number.isFinite(n)&&n>=25&&n<=500&&Math.round(n*10)===n*10))throw Error('Paper dimensions must be 25–500 mm (one decimal place).');
  names.add(key);
  return {name,width:p.width,height:p.height};
 });
}

export function planProductLabels(rows){
 const items=[],blocked=[];
 for(const row of rows){
  const count=row.expected-row.actual;
  if(row.unregistered||!Number.isSafeInteger(count)||count<=0)continue;
  let code;
  if(!row.unresolved&&!row.conflict&&row.barcode){try{code=encodeReceiptCode128(row.barcode);}catch{}}
  if(!code){blocked.push({...row,count});continue;}
  const identity=scannedProductLabel(row.name,row.brand);
  items.push({...identity,sku:row.sku,barcode:row.barcode,count,code});
 }
 return {items,blocked,total:items.reduce((sum,r)=>sum+r.count,0)};
}

export function labelPageLayout(paper,landscape,stockSheet){
 const short=Math.min(paper.width,paper.height),long=Math.max(paper.width,paper.height);
 const [width,height]=landscape?[long,short]:[short,long];
 const columns=stockSheet?2:1,rows=stockSheet?(landscape?4:6):1;
 const inset=stockSheet?10:0;
 return {width,height,columns,rows,inset,labelWidth:(width-2*inset)/columns,labelHeight:(height-2*inset)/rows};
}

export function labelsInRange(items,start,count){
 const result=[];let offset=0;
 for(const item of items){
  const end=offset+item.count;
  for(let i=Math.max(offset,start);i<Math.min(end,start+count);i++)result.push(item);
  offset=end;
  if(offset>=start+count)break;
 }
 return result;
}

export function fitsBarcode(code,layout){
 return code.modules*MIN_MODULE_MM<=layout.labelWidth-8;
}
