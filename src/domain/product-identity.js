const brandHeaders=new Set(['brand','brandname','브랜드','브랜드명']);
const headerKey=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu,'');

// Older profiles need no remapping for a single, unclaimed standard brand column.
export function optionalBrandColumn(headers,columns){
 if(Number.isInteger(columns.brand))return columns.brand;
 const used=new Set(Object.values(columns));
 const candidates=headers.flatMap((header,index)=>!used.has(index)&&brandHeaders.has(headerKey(header))?[index]:[]);
 return candidates.length===1?candidates[0]:undefined;
}

// Empty values are missing information; null is a contradiction, not a fallback.
export function mergeProductBrands(values){
 let brand='',folded='';
 for(const value of values){
  if(value===null)return null;
  if(typeof value!=='string'||!value.trim())continue;
  const clean=value.trim(),key=clean.normalize('NFKC').toLowerCase();
  if(folded&&key!==folded)return null;
  if(!folded){brand=clean;folded=key;}
 }
 return brand;
}

export function scannedProductLabel(name,brand){
 const original=String(name??'').trim(),label=mergeProductBrands([brand])||'';
 if(!label)return {name:original,brand:''};
 // Only remove a delimited prefix that agrees with the mapped brand.
 const separator=/\s*[·•|:]\s*|\s+[-–—]\s+/gu;
 for(const hit of original.matchAll(separator)){
  if(mergeProductBrands([original.slice(0,hit.index),label])!==null&&hit.index>0&&original.slice(0,hit.index).trim()){
   const item=original.slice(hit.index+hit[0].length).trim();
   if(item)return {name:item,brand:label};
  }
 }
 return {name:original,brand:label};
}
