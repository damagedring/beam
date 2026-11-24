import {createOneDriveExporter} from './core.mjs';
import {PublicClientApplication} from './msal-browser.mjs';
const prefix='beam-onedrive/', ttl=8*60_000;
const nonce=new URLSearchParams(location.hash.slice(1)).get('nonce');
if(location.hash)history.replaceState(null,'',location.pathname);
const settings=document.body.dataset;
const $=id=>document.getElementById(id);
let appOrigin='',openerRef=window.opener,port=null,phase='waiting',api=null,destination=null,timer,controller=new AbortController();
try{const u=new URL(settings.appOrigin);if(u.protocol==='https:'&&u.origin===settings.appOrigin&&u.origin!==location.origin)appOrigin=u.origin;}catch{}
function close(type,message){
 if(phase==='closed')return;
 phase='closed';clearTimeout(timer);window.removeEventListener('message',accept);
 $('status').textContent=message;$('authorize').disabled=true;$('save').disabled=true;
 api?.cancel();api=null;destination=null;controller.abort();
 port?.postMessage({type:prefix+type,nonce});port?.close();port=null;openerRef=null;
 if(type==='complete'||type==='cancel')window.close();
}
function accept(event){
 if(phase!=='waiting'||event.origin!==appOrigin||event.source!==openerRef||event.data?.type!==prefix+'handoff'||event.data.nonce!==nonce||event.ports?.length!==1)return;
 port=event.ports[0];window.removeEventListener('message',accept);window.opener=null;openerRef=null;phase='initializing';
 port.onmessage=async ({data})=>{
  if(data?.nonce!==nonce||phase==='closed')return;
  if(data.type===prefix+'cancel'){
   const uncertain=phase==='uploading';
   close(uncertain?'uncertain':'cancel',uncertain?'저장 여부를 확인할 수 없어요. 먼저 OneDrive에서 파일을 확인하세요.':'취소했어요. 저장하지 않았어요.');return;
  }
  if(phase!=='requested'||data.type!==prefix+'payload')return;
  phase='uploading';$('cancel').disabled=true;$('status').textContent='검수 기록을 새 파일로 저장하는 중…';
  try{await api.saveConfirmed({destination,workText:data.text,signal:controller.signal});close('complete','새 검수 기록 파일을 저장했어요.');}
  catch(e){
   const ambiguous=e?.message==='upload-unconfirmed';close(ambiguous?'uncertain':'failed',ambiguous?'저장 여부를 확인할 수 없어요. 먼저 OneDrive에서 파일을 확인하세요.':'검수 기록을 준비하지 못했어요. 저장하지 않았어요.');
  }
 };
 port.start();
 try{
  api=createOneDriveExporter({settings,PublicClientApplication,redirectUri:new URL('./redirect.html',location.href).href});
  api.initialize().then(()=>{if(phase!=='initializing')return;phase='connected';$('status').textContent='저장할 Microsoft 계정을 선택해 주세요.';$('authorize').disabled=false;}).catch(()=>close('failed','Microsoft 계정 연결을 준비하지 못했어요.'));
 }catch{close('failed','Microsoft 계정 연결을 준비하지 못했어요.');}
}
$('authorize').onclick=async ()=>{
 if(phase!=='connected')return;
 phase='choosing';$('authorize').disabled=true;$('status').textContent='계정과 접근 가능한 저장 폴더를 확인하는 중…';
 try{
  const candidate=await api.chooseDestination({signal:controller.signal});
  if(phase!=='choosing')return;
  destination=candidate;phase='named';
  $('account').textContent=destination.account;$('destination').textContent=destination.label;
  $('confirmation').hidden=false;$('save').disabled=false;$('status').textContent='계정과 폴더를 확인한 다음 저장하세요.';$('save').focus();
 }catch{close('failed','이 계정의 저장 폴더를 확인하지 못했어요. 저장하지 않았어요.');}
};
$('save').onclick=()=>{
 if(phase!=='named'||!destination)return;
 phase='requested';$('save').disabled=true;$('status').textContent='Beam에 검수 기록을 요청하는 중…';
 port.postMessage({type:prefix+'request',nonce});
};
$('cancel').onclick=()=>{if(phase!=='uploading')close('cancel','취소했어요. 저장하지 않았어요.');};
window.addEventListener('pagehide',()=>{
 if(phase==='closed')return;
 close(phase==='uploading'?'uncertain':'cancel','연결이 종료됐어요.');
});
if(openerRef&&appOrigin&&/^[a-f0-9]{32}$/.test(nonce||'')&&location.protocol==='https:'){
 window.addEventListener('message',accept);openerRef.postMessage({type:prefix+'ready',nonce},appOrigin);
 timer=setTimeout(()=>{const uncertain=phase==='uploading';close(uncertain?'uncertain':'cancel',uncertain?'저장 여부를 확인할 수 없어요. 먼저 OneDrive를 확인하세요.':'연결 시간이 지났어요. 파일을 저장하지 않았어요.');},ttl);
}else close('failed','Beam 작업 화면에서 저장을 시작해 주세요.');
