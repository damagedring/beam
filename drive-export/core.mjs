export const scope='https://www.googleapis.com/auth/drive.file';
export const ready='beam-drive/ready',handoff='beam-drive/handoff',payload='beam-drive/payload',complete='beam-drive/complete',failed='beam-drive/failed',uncertain='beam-drive/uncertain',cancel='beam-drive/cancel';
export const draftByteLimit=50_000_000;
const noncePattern=/^[a-f0-9]{32}$/;
const idPattern=/^[A-Za-z0-9_-]{1,180}$/;
const filenamePattern=/^Beam-work-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/;
export function isNonce(value){return typeof value==='string'&&noncePattern.test(value);}
export function isDriveId(value){return typeof value==='string'&&idPattern.test(value);}
export function pinnedOrigin(value){
 if(typeof value!=='string'||!value)return '';
 try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password?url.origin:'';}catch{return '';}
}
export function validMessage(event,source,origin,type,nonce){
 return !!source&&!!pinnedOrigin(origin)&&isNonce(nonce)&&event.source===source&&event.origin===origin&&event.data?.type===type&&event.data.nonce===nonce;
}
export function decodeWorkPacket(packet,nonce){
 if(!isNonce(nonce)||packet?.type!==payload||packet.nonce!==nonce||!filenamePattern.test(packet.name)||typeof packet.text!=='string'||packet.text.length>draftByteLimit)throw Error('invalid-packet');
 const bytes=new TextEncoder().encode(packet.text);
 if(!bytes.length||bytes.byteLength>draftByteLimit)throw Error('invalid-size');
 const parsed=JSON.parse(packet.text);
 const keys=(item,list)=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).length===list.length&&list.every(k=>Object.hasOwn(item,k));
 if(!keys(parsed,['format','version','reference','work'])||parsed.format!=='logistics-work-delta'||parsed.version!==1||!keys(parsed.reference,['scheme','root','customerScheme','customerRoot'])||parsed.reference.scheme!=='reference-sha256-chunks-v1'||parsed.reference.customerScheme!=='customer-sha256-chunks-v1'||![parsed.reference.root,parsed.reference.customerRoot].every(key=>typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)))throw Error('invalid-work-envelope');
 const workFields=new Set(['version','savedAt','archivedPending','archivedScans','assignment','audit','autoPaused','availabilityEnabled','confirmations','currentBatch','orderTabs','pending','receipt','receiptLocked','scans','store','storeSelection','confirmationCommitments','searchMode','workNumber','workSheets']);
 const validWork=work=>work&&typeof work==='object'&&!Array.isArray(work)&&Object.keys(work).every(k=>workFields.has(k));
 const work=parsed.work;
 if(!validWork(work)||('workSheets' in work&&(!Array.isArray(work.workSheets)||work.workSheets.length>49||work.workSheets.some(w=>!validWork(w)||'workSheets' in w))))throw Error('invalid-work-fields');
 return {name:packet.name,bytes};
}
const driveOrigin='https://www.googleapis.com';
const drivePath='/upload/drive/v3/files';
const endpoint=(uploadType,folder)=>driveOrigin+drivePath+'?uploadType='+uploadType+'&fields=id'+(folder?'&supportsAllDrives=true':'');
const folderMime='application/vnd.google-apps.folder';
const verifiedFolders=new WeakMap();
const requestOptions={mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'};
const resourcePattern=/^[A-Za-z0-9_-]{1,200}$/;
function resourceHeader(id,key){return key?{'X-Goog-Drive-Resource-Keys':id+'/'+key}:{};}
export async function verifyDriveFolder({accessToken,id,resourceKey='',request=globalThis.fetch,signal}){
 if(!isDriveId(id)||typeof resourceKey!=='string'||resourceKey&&!resourcePattern.test(resourceKey)||typeof accessToken!=='string'||!accessToken||!/^[\x21-\x7E]+$/.test(accessToken))throw Error('invalid-folder');
 const url=driveOrigin+'/drive/v3/files/'+encodeURIComponent(id)+'?supportsAllDrives=true&fields=id%2Cname%2CmimeType%2Ctrashed%2Ccapabilities%28canAddChildren%29';
 const response=await request(url,{...requestOptions,signal,headers:{Authorization:'Bearer '+accessToken,...resourceHeader(id,resourceKey)}});
 if(!response.ok)throw Error('folder-unavailable');
 const file=await response.json();
 if(file?.id!==id||file.mimeType!==folderMime||file.trashed!==false||file.capabilities?.canAddChildren!==true||typeof file.name!=='string'||!file.name.trim()||file.name.length>4096)throw Error('folder-not-writable');
 const folder=Object.freeze({id,resourceKey,name:file.name});verifiedFolders.set(folder,accessToken);return folder;
}
export function driveSession(trustedHeader){
 try{const url=new URL(trustedHeader);return url.origin===driveOrigin&&url.pathname===drivePath&&!url.username&&!url.password&&!url.hash&&!!url.searchParams.get('upload_id')?url.href:'';}catch{return '';}
}
export function driveLink(id){return isDriveId(id)?'https://drive.google.com/open?id='+encodeURIComponent(id):'';}
export async function createDriveWorkFile({accessToken,packet,folder=null,request=globalThis.fetch,signal}){
 if(typeof accessToken!=='string'||!accessToken||!/^[\x21-\x7E]+$/.test(accessToken))throw Error('invalid-token');
 if(!filenamePattern.test(packet?.name)||!(packet.bytes instanceof Uint8Array)||!packet.bytes.byteLength||packet.bytes.byteLength>draftByteLimit)throw Error('invalid-packet');
 if(folder!==null){if(verifiedFolders.get(folder)!==accessToken)throw Error('unverified-folder');verifiedFolders.delete(folder);}
 const total=packet.bytes.byteLength,common={...requestOptions,signal};
 const headers={Authorization:'Bearer '+accessToken,'Content-Type':'application/json; charset=UTF-8',...(folder?resourceHeader(folder.id,folder.resourceKey):{})};
 const meta=JSON.stringify({name:packet.name,mimeType:'application/json',...(folder?{parents:[folder.id]}:{})});
 async function verifyResponse(response){
  if(!response.ok)throw Error('upload-unconfirmed');
  const result=await response.json();
  if(!isDriveId(result?.id))throw Error('upload-unconfirmed');
  return {id:result.id,url:driveLink(result.id)};
 }
 if(total<=5_000_000){
  const boundary='beam_'+Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const multipart=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,packet.bytes,`\r\n--${boundary}--\r\n`]);
  try{
   const response=await request(endpoint('multipart',folder),{...common,method:'POST',headers:{...headers,'Content-Type':'multipart/related; boundary='+boundary},body:multipart});
   return await verifyResponse(response);
  }catch{throw Error('upload-unconfirmed');}
 }
 const begun=await request(endpoint('resumable',folder),{...common,method:'POST',headers:{...headers,'X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(total)},body:meta});
 if(!begun.ok)throw Error('start-rejected');
 const session=driveSession(begun.headers.get('Location'));
 if(!session)throw Error('invalid-session');
 // No automatic retry: if a connection drops after the body is sent, the
 // caller reports an uncertain result instead of risking a duplicate file.
 try{
  const response=await request(session,{...common,method:'PUT',headers:{...headers,'Content-Range':`bytes 0-${total-1}/${total}`},body:packet.bytes});
  return await verifyResponse(response);
 }catch{throw Error('upload-unconfirmed');}
}
