import { mergeProductBrands } from './product-identity.js';
const key=r=>r.barcode?'B:'+r.barcode:r.sku?'S:'+r.sku:'U:'+r.unresolvedId;
const units=s=>s.qty??1;
const eventCode=s=>s.kind==='sku'?s.sku:s.barcode;
const directMatch=(r,s)=>s.kind==='sku'?r.sku===s.sku:s.kind==='code'?(r.barcode===s.barcode||r.sku===s.barcode):r.barcode===s.barcode;
const matches=(r,s,data=null)=>{if(directMatch(r,s))return true;if(!data||r.barcode||!r.sku||s.kind==='sku')return false;const ix=getIndex(data);if(directCandidates(ix.rawByBarcode,ix.rawBySku,s).length)return false;const info=masterInfo(data,s);return info.found&&!info.conflict&&!!info.sku&&r.sku===info.sku;};
// Index only immutable reference data. New arrays/lengths rebuild automatically;
// deliberate same-length in-place reference edits must call Engine.invalidate(data).
const dataIndexes=new WeakMap();
function invalidate(data){if(data&&typeof data==='object')dataIndexes.delete(data);}
// Read-only singleton buckets may be shared across indexes; the first append detaches.
function addIndex(map,key,row,singleton=null){const bucket=map.get(key);if(!bucket){map.set(key,singleton||[row]);return;}if(bucket.length===1)map.set(key,[bucket[0],row]);else bucket.push(row);}
function directCandidates(barcodes,skus,event){
 if(event.kind==='sku')return skus.get(event.sku)||[];
 if(event.kind!=='code')return barcodes.get(event.barcode)||[];
 const a=barcodes.get(event.barcode)||[],b=skus.get(event.barcode)||[];
 return !a.length?b:!b.length?a:[...new Set([...a,...b])];
}
function getIndex(data){
 let ix=dataIndexes.get(data);const raw=data.raw||[],sku=data.sku||[],loc=data.loc||[];
 if(ix&&ix.raw===raw&&ix.sku===sku&&ix.loc===loc&&ix.rawLength===raw.length&&ix.skuLength===sku.length&&ix.locLength===loc.length)return ix;
 ix={raw,sku,loc,rawLength:raw.length,skuLength:sku.length,locLength:loc.length,rawByReceipt:new Map(),rawByBarcode:new Map(),rawBySku:new Map(),skuByBarcode:new Map(),skuBySku:new Map(),locByBarcode:new Map(),locBySku:new Map(),hasReturnChannel:raw.some(r=>Object.hasOwn(r,'returnChannel')),returnChannels:new Map(),locations:new Map(),templates:new Map(),masterCache:new Map(),receiptStoreKey:new Map(),storeReceipts:new Map(),stores:new Map(),locationTypePresent:false};
 for(const r of raw){const singleton=[r];addIndex(ix.rawByReceipt,r.receipt,r,singleton);addIndex(ix.rawByBarcode,r.barcode,r,singleton);addIndex(ix.rawBySku,r.sku,r,singleton);}
 for(const r of sku){const singleton=[r];addIndex(ix.skuByBarcode,r.barcode,r,singleton);addIndex(ix.skuBySku,r.sku,r,singleton);}
 for(const r of loc){const singleton=[r];addIndex(ix.locByBarcode,r.barcode,r,singleton);addIndex(ix.locBySku,r.sku,r,singleton);if(String(r.locationType||'').trim())ix.locationTypePresent=true;const lk=r.barcode?'B:'+r.barcode:r.sku?'S:'+r.sku:'';if(!lk||!r.loc)continue;for(const id of new Set([lk,r.sku?'S:'+r.sku:''].filter(Boolean))){if(!ix.locations.has(id))ix.locations.set(id,new Set());ix.locations.get(id).add(r.loc);}}
 for(const [receipt,rows]of ix.rawByReceipt){if(ix.hasReturnChannel){let channel='';for(const r of rows){const v=r.returnChannel;if(!v)continue;if(!['b2b','b2c'].includes(v)||(channel&&channel!==v)){channel='';break;}channel=v;}if(channel)ix.returnChannels.set(receipt,channel);}const keys=new Set(rows.map(r=>JSON.stringify([r.seller||r.company||'',r.company||'',r.address||''])));const storeKey=keys.size===1&&rows.some(r=>r.seller||r.company)?[...keys][0]:'';ix.receiptStoreKey.set(receipt,storeKey);if(storeKey){addIndex(ix.storeReceipts,storeKey,receipt);if(!ix.stores.has(storeKey)){const [name,company,address]=JSON.parse(storeKey);ix.stores.set(storeKey,{name,company,address});}}}
 dataIndexes.set(data,ix);return ix;
}
function masterInfo(data,event){
 const ix=getIndex(data),cacheKey=JSON.stringify([event.kind,eventCode(event)]);
 if(ix.masterCache.has(cacheKey))return ix.masterCache.get(cacheKey);
 const masterCandidates=directCandidates(ix.skuByBarcode,ix.skuBySku,event),candidates=masterCandidates.length?masterCandidates:directCandidates(ix.rawByBarcode,ix.rawBySku,event);
 const skus=new Set(),names=new Set(),keys=event.kind==='code'?new Set():null;
 for(const r of candidates){if(r.sku)skus.add(r.sku);if(r.name)names.add(r.name);if(keys)keys.add(key(r));}
 const conflict=skus.size>1||names.size>1||(keys&&keys.size>1)||false;
 const brand=!conflict&&mergeProductBrands(candidates.map(r=>r.brand));
 const info={found:!!candidates.length,conflict,...(brand?{brand}:{}),sku:!conflict&&skus.size===1?[...skus][0]:'',name:!conflict&&names.size===1?[...names][0]:''};
 if(ix.masterCache.size===4096)ix.masterCache.delete(ix.masterCache.keys().next().value);
 ix.masterCache.set(cacheKey,info);
 return info;
}
function receiptTemplate(ix,receipt){
 if(ix.templates.has(receipt))return ix.templates.get(receipt);
 const found=new Map(),raw=ix.rawByReceipt.get(receipt)||[];
 for(const [i,r]of raw.entries()){const k=key({...r,unresolvedId:r.unresolvedId||'row-'+i});if(!found.has(k)){const {expectedInventoryStatus:declared,...product}=r;found.set(k,{...product,key:k,expected:0,actual:0,conflict:!r.barcode&&!r.sku,unresolved:!r.barcode&&!r.sku});}const a=found.get(k);a.expected+=r.qty;if(!Number.isSafeInteger(a.expected))throw Error('합산 예정 수량이 너무 큽니다.');if(a.sku&&r.sku&&a.sku!==r.sku)a.conflict=true;if(a.name&&r.name&&a.name!==r.name)a.conflict=true;if(r.brand)a.brand=mergeProductBrands([a.brand,r.brand]);}
 const byBarcode=new Map(),bySku=new Map(),skuOnly=new Map();for(const r of found.values()){addIndex(byBarcode,r.barcode,r);addIndex(bySku,r.sku,r);if(!r.barcode&&r.sku)addIndex(skuOnly,r.sku,r);}
 const template={rows:[...found.values()],byBarcode,bySku,skuOnly};
 // Keep reference-sized templates only for used receipts, bounded for very fragmented imports.
 if(ix.templates.size>=2048)ix.templates.delete(ix.templates.keys().next().value);
 ix.templates.set(receipt,template);return template;
}
function lookupEntry(ix, template, data, event) {
 const direct=directCandidates(template.byBarcode,template.bySku,event);
 if(direct.length)return direct;
 if(event.kind==='sku'||directCandidates(ix.rawByBarcode,ix.rawBySku,event).length)return direct;
 const info=masterInfo(data,event);
 return info.found&&!info.conflict&&info.sku?(template.skuOnly.get(info.sku)||[]):direct;
}

function candidateReceipts(data,event,{allowMasterSku=false}={}){
 const ix=getIndex(data);
 const direct=directCandidates(ix.rawByBarcode,ix.rawBySku,event);
 const ids=new Set(direct.map(row=>row.receipt));
 if(event.kind!=='sku'&&(!direct.length||allowMasterSku)){
  const info=masterInfo(data,event);
  if(info.sku&&!info.conflict)for(const row of ix.rawBySku.get(info.sku)||[]){
   if(allowMasterSku||!row.barcode)ids.add(row.receipt);
  }
 }
 return ids;
}

// Scan lists are append-only while their array identity is retained. Undo,
// reassignment, and restore replace the array; reference replacement changes ix.
const scanIndexes=new WeakMap();
function readScanIndex(scans){
 let index=scanIndexes.get(scans);
 if(!index||index.length>scans.length){
  index={length:0,total:0,sequence:0,byReceipt:new Map(),aggregates:new WeakMap()};
  scanIndexes.set(scans,index);
 }
 for(;index.length<scans.length;index.length++){
  const event=scans[index.length];
  index.total+=units(event);
  index.sequence=Math.max(index.sequence,event.sequence||0);
  addIndex(index.byReceipt,event.receipt,event);
 }
 return index;
}

function scanAggregate(data,receipt,scans,ix=getIndex(data),template=receiptTemplate(ix,receipt)){
 const index=readScanIndex(scans);
 let receipts=index.aggregates.get(ix);
 if(!receipts){receipts=new Map();index.aggregates.set(ix,receipts);}
 const events=index.byReceipt.get(receipt)||[];
 let agg=receipts.get(receipt);
 if(agg?.length===events.length)return agg;
 if(!agg)agg={length:0,total:0,rows:null,byBatch:new Map(),counts:new Map(),outside:new Map(),covered:0,expected:template.rows.reduce((sum,row)=>sum+row.expected,0),overages:[]};
 for(;agg.length<events.length;agg.length++){
  const event=events[agg.length],qty=units(event),possible=lookupEntry(ix,template,data,event);
  const product=possible.length===1?possible[0]:null;
  const id=product?.key??((event.kind==='sku'?'M:':'X:')+eventCode(event));
  if(!product&&!agg.outside.has(id)){
   agg.outside.set(id,{key:id,barcode:event.kind==='sku'?'':event.barcode,sku:event.kind==='sku'?event.sku:'',expected:0,unregistered:true,matchedInAsn:possible.length>0,inputKind:event.kind||'barcode',conflict:possible.length>1});
  }
  const n=(agg.counts.get(id)||0)+qty;
  if(!Number.isSafeInteger(n))throw Error('합산 실물 수량이 너무 큽니다.');
  agg.counts.set(id,n);
  const verified=product&&!product.conflict&&!product.unresolved;
  if(verified)agg.covered+=Math.min(n,product.expected)-Math.min(n-qty,product.expected);
  if(verified&&n>product.expected&&(!event.scanOutcome||event.scanOutcome==='excess')){
   agg.overages.push({covered:agg.covered,position:agg.length+1,at:event.at,name:product.name,brand:product.brand,code:product.sku||product.barcode||eventCode(event),actual:n,expected:product.expected,delta:n-product.expected});
  }
  agg.total+=qty;
  agg.byBatch.set(event.batch,(agg.byBatch.get(event.batch)||0)+qty);
 }
 agg.rows=null;
 if(events.length)receipts.set(receipt,agg);
 return agg;
}

function inspectEntry(data,receipt,scans,event){
 const ix=getIndex(data),template=receiptTemplate(ix,receipt),possible=lookupEntry(ix,template,data,event);
 if(possible.length!==1)return {row:null,actual:0,ambiguous:possible.length>1};
 const row=possible[0],actual=scanAggregate(data,receipt,scans,ix,template).counts.get(row.key)||0;
 return {row,actual,ambiguous:false};
}
function entryOutcome(data,receipt,scans,event){
 if(!receipt)return 'held';
 const {row,actual,ambiguous}=inspectEntry(data,receipt,scans,event);
 if(ambiguous||row?.conflict||row?.unresolved||(!row&&masterInfo(data,event).conflict))return 'conflict';
 if(!row)return 'unknown';
 return quantityOutcome(actual,row.expected,units(event));
}

// A reassignment may only consume whole latest events within each SKU's excess.
function excessEntrySet(data,scans,batch,includeReceipt){
 const result=new Set(),ix=getIndex(data);
 for(const [receipt,events] of readScanIndex(scans).byReceipt){
  if(!includeReceipt(receipt))continue;
  const template=receiptTemplate(ix,receipt),{counts}=scanAggregate(data,receipt,scans,ix,template);
  const budget=new Map();
  // Only known product rows can be moved. Read their indexed quantities
  // directly; report formatting, outside rows and Location are irrelevant.
  for(const row of template.rows){
   if(row.conflict||row.unresolved)continue;
   const excess=(counts.get(row.key)||0)-row.expected;
   if(excess>0)budget.set(row.key,excess);
  }
  if(!budget.size)continue;
  const order=events.filter(e=>e.batch===batch).sort((a,b)=>(b.sequence||0)-(a.sequence||0)||Date.parse(b.at)-Date.parse(a.at));
  for(const event of order){
   if(!budget.size)break;
   const possible=lookupEntry(ix,template,data,event);
   if(possible.length!==1||!budget.has(possible[0].key))continue;
   const key=possible[0].key,remaining=budget.get(key)-units(event);
   if(remaining>=0&&event.id)result.add(event.id);
   if(remaining<=0)budget.delete(key);else budget.set(key,remaining);
  }
 }
 return result;
}

function reconcile(data,receipt,scans){
 const ix=getIndex(data),template=receiptTemplate(ix,receipt),agg=scanAggregate(data,receipt,scans,ix,template);
 if(agg.rows)return agg.rows;
 const rows=[...template.rows,...agg.outside.values()].map(r=>({...r,actual:agg.counts.get(r.key)||0}));
 return agg.rows=rows.map(r=>{const master=r.unregistered&&!r.conflict?masterInfo(data,{kind:r.inputKind,barcode:r.barcode,sku:r.sku}):{conflict:false,sku:'',name:''},conflict=r.conflict||master.conflict;const locations=[...(ix.locations.get('B:'+r.barcode)||ix.locations.get('S:'+r.sku)||[])];return {...r,...(r.unregistered&&master.brand&&!conflict?{brand:master.brand}:{}),name:r.unregistered?(master.name||'상품 정보 없음'):(r.name||'ASN 상품명 없음'),sku:r.unregistered?(r.sku||master.sku):(r.sku||''),locations,location:locations.join(', '),missing:Math.max(0,r.expected-r.actual),excess:Math.max(0,r.actual-r.expected),status:r.unresolved?'식별자 없음':conflict?'정보 충돌':r.unregistered?'예정 외':r.expected===r.actual?'일치':r.actual>r.expected?'초과':'부족'};});
}
// Shared quantity rules; reference selection and event ownership stay with each workflow.
export function quantityOutcome(actual,expected,added=1){
 return actual+added>expected?'excess':'accepted';
}
export function inspectionCoverage(rows,{known=true,unassigned=0}={}){
 let expected=0,covered=0,excess=0,needsReview=!!unassigned,allMatched=true;
 for(const row of rows){
  expected+=row.expected;
  if(row.unregistered||row.unresolved||row.conflict||row.status==='정보 충돌'){
   needsReview=true;allMatched=false;continue;
  }
  covered+=Math.min(row.actual,row.expected);
  excess+=Math.max(0,row.actual-row.expected);
  if(row.actual!==row.expected)allMatched=false;
 }
 const complete=known&&expected>0&&!needsReview&&allMatched;
 const verifiedActual=covered+excess;
 const percent=known&&expected>0?(verifiedActual>expected?Math.max(101,Math.floor(verifiedActual/expected*100)):Math.floor(covered/expected*100)):null;
 return {expected,covered,excess,remaining:Math.max(0,expected-covered),needsReview:known&&(needsReview||!expected),complete,percent,phase:!known?'waiting':excess?'excess':needsReview||!expected?'warning':complete?'complete':'progress'};
}
function asnProgress(data,receipt,scans,pending=[],currentBatch=''){
 const rows=reconcile(data,receipt,scans),agg=scanAggregate(data,receipt,scans);
 const batch=currentBatch?(agg.byBatch.get(currentBatch)||0):0;
 const unassigned=pending.reduce((sum,event)=>sum+units(event),0),known=!!receipt&&getIndex(data).rawByReceipt.has(receipt);
 const {expected,covered,excess,complete,percent,phase}=inspectionCoverage(rows,{known,unassigned});
 return {expected,actual:agg.total,batch,unassigned,complete,covered,percent,excess,phase};
}
function inspectionOverages(data,receipt,scans){
 const agg=scanAggregate(data,receipt,scans);
 return {expected:agg.expected,events:agg.overages};
}
function storeMatches(r,query){const normalize=x=>String(x||'').toLowerCase().replace(/\s+/g,'');const hay=normalize([r.seller,r.company,r.address].filter(Boolean).join(' '));return String(query||'').trim().split(/\s+/).filter(Boolean).every(token=>hay.includes(normalize(token)));}


export { key, units, eventCode, matches, getIndex, invalidate, masterInfo, reconcile, asnProgress, storeMatches, inspectEntry, entryOutcome, candidateReceipts, readScanIndex, excessEntrySet, inspectionOverages };
