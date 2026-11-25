/* v1.10 local content fingerprints. WebCrypto only; no authentication/signing claim.
   Format: reference-sha256-chunks-v1; maximum 256 rows per role-array chunk.
   Data is immutable by Engine's existing contract; same-length edits MUST call
   Engine.invalidate(data). Customer lookup metadata is outside state.data. */
export function createReferenceFingerprint({currentData, getIndex, refresh}){
 let revision=0,current=null;
 const domain='reference-sha256-chunks-v1',chunkRows=256;
 const isCurrent=record=>current===record&&record.revision===revision&&currentData()===record.data&&getIndex(record.data)===record.core;
 async function digest(value){
  if(!globalThis.crypto?.subtle||typeof globalThis.crypto.subtle.digest!=='function'||typeof TextEncoder!=='function')throw Error('WebCrypto SHA-256 is unavailable');
  const encoded=new TextEncoder().encode(JSON.stringify(value));
  const result=await globalThis.crypto.subtle.digest('SHA-256',encoded);
  if(Object.prototype.toString.call(result)!=='[object ArrayBuffer]'||result.byteLength!==32)throw Error('WebCrypto returned an invalid SHA-256 result');
  return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
 }
 async function build(record){
  const entries=[];
  for(const key of Object.keys(record.data)){
   const rows=record.data[key];
   if(Array.isArray(rows)){
    const chunks=[];
    for(let offset=0;offset<rows.length;offset+=chunkRows){chunks.push(await digest(['reference-chunk-v1',key,offset,rows.slice(offset,offset+chunkRows)]));if(!isCurrent(record))throw Error('Reference data changed');}
    entries.push([key,'array',rows.length,chunks]);
   }else{
    // Preserve unknown legacy JSON properties in the content boundary, rather
    // than silently leaving them out of reference-change invalidation.
    entries.push([key,'value',await digest(['reference-value-v1',key,rows])]);if(!isCurrent(record))throw Error('Reference data changed');
   }
  }
  const root=await digest([domain,chunkRows,entries]);if(!isCurrent(record))throw Error('Reference data changed');return root;
 }
 function request(){
  const data=currentData(),core=getIndex(data);
  if(current&&current.core===core&&current.data===data)return current;
  const record={revision:++revision,core,data,status:'pending',root:'',error:'',promise:null};current=record;
  record.promise=build(record).then(root=>{if(!isCurrent(record)){record.status='superseded';return record;}record.root=root;record.status='ready';refresh();return record;},error=>{if(!isCurrent(record)){record.status='superseded';return record;}record.status='error';record.error=error?.message||'Reference fingerprint failed';refresh();return record;});
  return record;
 }
 async function wait(){const record=request();await record.promise;if(!isCurrent(record)||record.status!=='ready')throw Error(record.error||'Reference fingerprint is not ready');return record.root;}
 // Explicit invalidation is available for callers that intentionally revise data.
 // It does not mutate inspection records or silently grant confirmation.
 function invalidate(){revision++;current=null;}
 return {request,wait,invalidate,domain,chunkRows};
}
