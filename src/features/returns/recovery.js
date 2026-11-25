/* Fingerprint-scoped Returns checkpoints, with storage and view effects supplied by the app. */
export function createBrowserRecovery(api){
 let current=null,timer=null,inflight=null,rerun=false,version=0,savedVersion=-1,display={kind:'hidden'},stopped=false,acting=false;
 const same=(a,b)=>a?.reference===b?.reference&&a?.names===b?.names;
 const still=(context)=>same(context,api.context());
 const tell=(kind,draft=null)=>{display={kind,draft};api.paint(display);};
 const validity=d=>d&&typeof d.revision==='string'&&typeof d.savedAt==='string'&&Number.isFinite(Date.parse(d.savedAt))&&typeof d.text==='string'&&d.text.length<=50e6;
 async function load(context){
  if(current&&same(current.context,context))return current;
  const reference=await api.reference();
  if(!still(context))return null;
  const key='v1:'+reference.root+':'+reference.customerRoot;
  const draft=await api.store.read(key);
  if(!still(context))return null;
  current={context,key,revision:draft?.revision??null,draft:draft||null};
  savedVersion=-1;
  if(draft)tell(validity(draft)?'offer':'invalid',validity(draft)?draft:null);
  else if(await api.store.hasDraft()&&still(context))tell('other');
  else if(still(context))tell('hidden');
  return current;
 }
 async function save(active,allowReplace=false){
  if(active.draft&&!allowReplace)return;
  if(!api.hasWork()||savedVersion===version)return;
  const started=version;
  const prepared=await api.prepare();
  if(!still(active.context)||current!==active)return;
  prepared.assertCurrent();
  const entry={key:active.key,revision:api.id(),savedAt:api.now(),text:prepared.text};
  const committed=await api.store.write(entry,active.revision);
  if(!still(active.context)||current!==active)return;
  if(!committed){
   current=null;await load(active.context);
   if(!current?.draft)tell('conflict');
   return;
  }
  active.revision=entry.revision;active.draft=null;savedVersion=started;tell('saved');
 }
 async function run(){
  const context=api.context();
  try{
   if(!context){current=null;tell(await api.store.hasDraft()&&!api.context()?'needs-raw':'hidden');return;}
   const active=await load(context);if(!active||!still(context))return;
   if(active.draft)api.paint(display);
   await save(active);
  }catch(error){if(still(context))tell('unavailable');}
 }
 function flush(){
  clearTimeout(timer);timer=null;if(stopped)return Promise.resolve();
  if(acting){rerun=true;return Promise.resolve();}
  if(inflight){rerun=true;return inflight;}
  inflight=run().finally(()=>{inflight=null;if(rerun){rerun=false;void flush();}});return inflight;
 }
 // One short window per burst, not a trailing debounce: continuous scans
 // still reach durable checkpoints without writing on every keypress.
 function schedule(delay=450){version++;if(timer===null)timer=setTimeout(()=>void flush(),delay);}
 async function recover(){
  const active=current,draft=active?.draft,started=version;
  if(inflight||acting||!validity(draft)||!still(active.context))return false;
  acting=true;
  try{
   const plan=await api.prepareRestore(JSON.parse(draft.text));
   if(current!==active||version!==started||!still(active.context))return false;
   // A second tab may update a draft, but the user is only offered the exact
   // checkpoint that was reviewed; an old revision must not supersede it.
   const live=await api.store.read(active.key);
   if(current!==active||version!==started||!still(active.context))return false;
   if(live?.revision!==draft.revision){current=null;await load(active.context);return false;}
   if(!api.confirmRestore())return false;
   api.finishRestore(plan);
   active.draft=null;savedVersion=version;tell('restored');return true;
  }catch(error){if(still(active.context))tell('restore-error',draft);return false;}
  finally{acting=false;if(rerun){rerun=false;void flush();}}
 }
 async function replace(){
  const active=current;
  if(inflight||acting||!active?.draft||!still(active.context)||!api.hasWork()||!api.confirmReplace())return false;
  acting=true;
  try{await save(active,true);return !active.draft;}
  catch(error){if(still(active.context))tell('restore-error',validity(active.draft)?active.draft:null);return false;}
  finally{acting=false;if(rerun){rerun=false;void flush();}}
 }
 return {schedule,flush,recover,replace,refresh:()=>api.paint(display),stop(){stopped=true;clearTimeout(timer);}};
}
