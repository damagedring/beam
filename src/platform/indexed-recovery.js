/* Local work-only checkpoints with optimistic revision checks. */
const storeName='drafts';
export function createIndexedRecoveryStore(getIndexedDB=()=>globalThis.indexedDB,databaseName='beam-work-recovery'){
 let opening;
 function open(){
  if(opening)return opening;
  opening=new Promise((resolve,reject)=>{
   const idb=getIndexedDB();if(!idb)throw Error('IndexedDB unavailable');
   const request=idb.open(databaseName,1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName,{keyPath:'key'});};
   request.onerror=()=>reject(request.error||Error('IndexedDB open failed'));
   request.onblocked=()=>reject(Error('IndexedDB is blocked by another tab'));
   request.onsuccess=()=>{
    const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);
   };
  }).catch(error=>{opening=null;throw error;});
  return opening;
 }
 async function operate(mode,run){
  const db=await open();
  return new Promise((resolve,reject)=>{
   let tx;
   if(mode==='readwrite'){try{tx=db.transaction(storeName,mode,{durability:'strict'});}catch{tx=db.transaction(storeName,mode);}}
   else tx=db.transaction(storeName,mode);
   let result;
   tx.oncomplete=()=>resolve(result);
   tx.onerror=tx.onabort=()=>reject(tx.error||Error('IndexedDB transaction failed'));
   try{run(tx.objectStore(storeName),value=>{result=value;});}catch(error){try{tx.abort();}catch{}reject(error);}
  });
 }
 return {
  read:key=>operate('readonly',(s,finish)=>{const req=s.get(key);req.onsuccess=()=>finish(req.result??null);}),
  hasDraft:(offer=()=>true)=>operate('readonly',(s,finish)=>{
   const cursor=s.openCursor();cursor.onsuccess=()=>{
    if(!cursor.result){finish(false);return;}
    if(offer(cursor.result.value)){finish(true);return;}
    cursor.result.continue();
   };
  }),
  inspectDrafts:(offer=()=>true)=>operate('readonly',(s,finish)=>{
   const cursor=s.openCursor();let entry=null;
   cursor.onsuccess=()=>{
    if(!cursor.result){finish({exists:!!entry,entry});return;}
    const draft=cursor.result.value;
    if(offer(draft)){
     if(entry){finish({exists:true,entry:null});return;}
     entry={key:cursor.result.primaryKey,revision:draft.revision,savedAt:draft.savedAt};
    }
    cursor.result.continue();
   };
  }),
  discard:(key,revision)=>operate('readwrite',(s,finish)=>{
   const req=s.get(key);req.onsuccess=()=>{
    if(!req.result||req.result.revision!==revision){finish(false);return;}
    s.delete(key);finish(true);
   };
  }),
  write:(entry,expected)=>operate('readwrite',(s,finish)=>{
   const req=s.get(entry.key);req.onsuccess=()=>{if((req.result?.revision??null)!==expected){finish(false);return;}s.put(entry);finish(true);};
  }),
 };
}
