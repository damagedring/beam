const graph='https://graph.microsoft.com/v1.0';
const appFolderScope='Files.ReadWrite.AppFolder';
const folderScope='Files.SelectedOperations.Selected';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=/^[A-Za-z0-9!._-]{1,240}$/;
const safeId=x=>typeof x==='string'&&id.test(x)&&x!=='.'&&x!=='..';
const noStore={mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'};
const maxBytes=50_000_000;
const keys=(x,names)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===names.length&&names.every(k=>Object.hasOwn(x,k));
const cleanLabel=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=160&&!/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(x);
const workFields=new Set(['version','savedAt','archivedPending','archivedScans','assignment','audit','autoPaused','availabilityEnabled','confirmations','currentBatch','orderTabs','pending','receipt','receiptLocked','scans','store','storeSelection','confirmationCommitments','searchMode','workNumber','workSheets']);
const validWork=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>workFields.has(k));
function validateWorkText(text){
 if(typeof text!=='string'||!text.length||text.length>maxBytes)throw Error('invalid-work');
 const bytes=new TextEncoder().encode(text);
 if(bytes.byteLength>maxBytes)throw Error('invalid-work');
 const p=JSON.parse(text);
 if(!keys(p,['format','version','reference','work'])||p.format!=='logistics-work-delta'||p.version!==1||!keys(p.reference,['scheme','root','customerScheme','customerRoot'])||p.reference.scheme!=='reference-sha256-chunks-v1'||p.reference.customerScheme!=='customer-sha256-chunks-v1'||![p.reference.root,p.reference.customerRoot].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||!validWork(p.work)||('workSheets'in p.work&&(!Array.isArray(p.work.workSheets)||p.work.workSheets.length>49||p.work.workSheets.some(w=>!validWork(w)||'workSheets'in w))))throw Error('invalid-work');
 return bytes;
}
function deployment(settings){
 if(!settings||!uuid.test(settings.clientId||''))throw Error('invalid-settings');
 if(settings.kind==='personal')return {kind:'personal',clientId:settings.clientId,tenant:'consumers',scope:appFolderScope};
 if(settings.kind==='work'&&uuid.test(settings.tenantId||'')&&safeId(settings.driveId)&&safeId(settings.folderId)&&cleanLabel(settings.label))return {kind:'work',clientId:settings.clientId,tenant:settings.tenantId,scope:folderScope,driveId:settings.driveId,folderId:settings.folderId,label:settings.label};
 throw Error('invalid-settings');
}
// Inject a vetted, pinned @azure/msal-browser PublicClientApplication constructor.
// Keep the SDK and this module in an explicitly enabled, dedicated exporter origin.
export function createOneDriveExporter({settings,PublicClientApplication,redirectUri,request=globalThis.fetch}){
 const config=deployment(settings);
 let redirect;
 try{redirect=new URL(redirectUri);}catch{throw Error('invalid-redirect');}
 if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||redirect.search)throw Error('invalid-redirect');
 if(globalThis.location&&redirect.origin!==globalThis.location.origin)throw Error('invalid-redirect');
 const client=new PublicClientApplication({auth:{clientId:config.clientId,authority:'https://login.microsoftonline.com/'+config.tenant,redirectUri:redirect.href,navigateToLoginRequestUrl:false},cache:{cacheLocation:'memoryStorage',temporaryCacheLocation:'memoryStorage',storeAuthStateInCookie:false},telemetry:{application:{appName:'Beam OneDrive exporter',appVersion:'0.1.0'}}});
 let init,record=null,epoch=0;
 const initialize=()=>init??=client.initialize();
 const cancel=()=>{record=null;epoch++;};
 async function chooseDestination({signal}={}){
  const previous=++epoch;record=null;
  if(signal?.aborted)throw Error('cancelled');
  const auth=await client.acquireTokenPopup({scopes:[config.scope],prompt:'select_account'});
  if(signal?.aborted||epoch!==previous)throw Error('cancelled');
  const scopes=Array.isArray(auth?.scopes)?auth.scopes.map(s=>String(s).toLowerCase()):[];
  const expected=config.scope.toLowerCase();
  const permitted=new Set([expected,'openid','profile','email','offline_access']);
  if(!scopes.includes(expected)||scopes.some(s=>!permitted.has(s)))throw Error('unexpected-grant');
  const token=auth.accessToken,account=auth.account;
  if(typeof token!=='string'||!/^[\x21-\x7e]+$/.test(token)||!cleanLabel(account?.username)||(config.kind==='work'&&account.tenantId?.toLowerCase()!==config.tenant.toLowerCase()))throw Error('unexpected-account');
  const path=config.kind==='personal'?'/me/drive/special/approot':'/drives/'+encodeURIComponent(config.driveId)+'/items/'+encodeURIComponent(config.folderId);
  const found=await request(graph+path+'?$select=id,name,parentReference,folder',{...noStore,method:'GET',headers:{Authorization:'Bearer '+token},signal});
  if(!found.ok)throw Error('destination-unavailable');
  const folder=await found.json();
  if(!safeId(folder?.id)||!folder.folder||!cleanLabel(folder.name)||!safeId(folder.parentReference?.driveId)||(config.kind==='work'&&(folder.id!==config.folderId||folder.parentReference.driveId!==config.driveId)))throw Error('destination-unverified');
  if(signal?.aborted||epoch!==previous)throw Error('cancelled');
  const destination=Object.freeze({kind:config.kind,account:account.username,label:config.kind==='work'?config.label+' / '+folder.name:'OneDrive / '+folder.name});
  record={destination,token,driveId:folder.parentReference.driveId,folderId:folder.id};
  return destination;
 }
 async function saveConfirmed({destination,workText,signal}){
  if(!record||destination!==record.destination||signal?.aborted)throw Error('save-not-confirmed');
  const bytes=validateWorkText(workText);
  const active=record;cancel();
  const stamp=new Date().toISOString().slice(0,19).replaceAll(':','-');
  const name='Beam-work-'+stamp+'Z-'+globalThis.crypto.randomUUID()+'.json';
  const path='/drives/'+encodeURIComponent(active.driveId)+'/items/'+encodeURIComponent(active.folderId)+':/'+name+':/content?@microsoft.graph.conflictBehavior=fail';
  try{
   const response=await request(graph+path,{...noStore,method:'PUT',headers:{Authorization:'Bearer '+active.token,'Content-Type':'application/json'},body:bytes,signal});
   if(response.status!==201)throw Error('unverified-status');
   const result=await response.json(),ref=result?.parentReference;
   if(!safeId(result?.id)||result.name!==name||!result.file||ref?.driveId!==active.driveId||ref.id!==active.folderId||result.size!==bytes.byteLength)throw Error('unverified-item');
   return {id:result.id,name,destination:destination.label};
  }catch{throw Error('upload-unconfirmed');}
 }
 return Object.freeze({initialize,chooseDestination,saveConfirmed,cancel});
}
