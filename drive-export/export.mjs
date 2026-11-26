import {scope,ready,handoff,payload,complete,failed,uncertain,cancel,isNonce,pinnedOrigin,validMessage,decodeWorkPacket,createDriveWorkFile,verifyDriveFolder} from './core.mjs';

const appOrigin=pinnedOrigin(document.body.dataset.appOrigin);
const oauthClient=document.body.dataset.oauthClientId;
const pickerKey=document.body.dataset.pickerApiKey,pickerProject=document.body.dataset.pickerProject;
const pickerConfigured=/^[A-Za-z0-9_-]{24,100}$/.test(pickerKey)&&/^\d{5,24}$/.test(pickerProject);
const configured=/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(oauthClient);
const nonce=new URLSearchParams(location.hash.slice(1)).get('nonce');
if(location.hash)history.replaceState(null,'',location.pathname);
const expire=8*60_000;
const status=document.getElementById('status'),authorize=document.getElementById('authorize'),abortButton=document.getElementById('cancel'),result=document.getElementById('open-result');
const destinations=document.getElementById('destination-choices'),folderConfirmation=document.getElementById('folder-confirmation'),folderName=document.getElementById('folder-name'),writeFolder=document.getElementById('write-folder');
let connectOnly=false,openerWindow=window.opener,port=null,packet=null,client=null,ended=false,uploading=false,controller=null,initialTimer=null,folderFlow=false,folderToken='',folder=null,pickerWindow=null;
function release(closePort=true){
 clearTimeout(initialTimer);window.removeEventListener('message',acceptHandoff);
 if(closePort){port?.close();port=null;}
 packet=null;client=null;openerWindow=null;folderToken='';folder=null;pickerWindow?.setVisible(false);pickerWindow=null;authorize.disabled=true;writeFolder.disabled=true;
}
function finish(type,statusText,id){
 if(ended)return;ended=true;
 status.textContent=statusText;
 if(port)port.postMessage({type,nonce,...(id?{id}:{})});
 release();
}
function fail(text){finish(failed,text);}
function waitForScript(src='https://accounts.google.com/gsi/client'){
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=src;script.async=true;
  script.onload=resolve;script.onerror=reject;document.head.append(script);
 });
}
async function onToken(response){
 if(ended||(!packet&&!connectOnly)||uploading)return;
 const oauth=globalThis.google?.accounts?.oauth2;
 if(response?.error||typeof response?.access_token!=='string'||!oauth?.hasGrantedAllScopes(response,scope)){
  fail('Google Drive 저장 권한을 받지 못했어요. Beam에서 다시 시도할 수 있어요.');return;
 }
 if(connectOnly){finish('beam-drive/connected','Google Drive 접근을 확인했어요. 작업 데이터를 받거나 저장하지 않았어요.');return;}
 if(folderFlow){folderToken=response.access_token;void chooseFolder();return;}
 void upload(response.access_token,null);
}
async function upload(accessToken,destination){
 if(ended||uploading)return;
 uploading=true;abortButton.disabled=true;writeFolder.disabled=true;status.textContent='검수 기록을 Google Drive에 저장하는 중…';
 controller=new AbortController();
 try{
  const uploaded=await createDriveWorkFile({packet,accessToken,folder:destination,signal:controller.signal});
  result.href=uploaded.url;result.hidden=false;
  finish(complete,'Google Drive에 새 검수 기록을 저장했어요.',uploaded.id);
 }catch(error){
  if(error?.message==='upload-unconfirmed')finish(uncertain,'저장 결과를 확인하지 못했어요. 중복 저장을 막으려면 Drive에서 파일을 먼저 확인하세요.');
  else fail('Google Drive에 연결하지 못했어요. 계정 권한과 연결 상태를 확인하세요.');
 }
}
async function chooseFolder(){
 try{
  status.textContent='선택한 Google 계정의 폴더 선택기를 여는 중…';
  await waitForScript('https://apis.google.com/js/api.js');if(ended)return;
  await new Promise((resolve,reject)=>globalThis.gapi.load('picker',{callback:resolve,onerror:reject,ontimeout:reject,timeout:15_000}));
  if(ended)return;
  const p=globalThis.google.picker;
  const view=()=>new p.DocsView(p.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder').setMode(p.DocsViewMode.LIST);
  pickerWindow=new p.PickerBuilder()
   .setAppId(pickerProject).setDeveloperKey(pickerKey).setOAuthToken(folderToken).setOrigin(location.origin)
   .addView(view().setOwnedByMe(false))
   .addView(view().setEnableDrives(true))
   .addView(view().setOwnedByMe(true))
   .setCallback(response=>void onPicked(response,p)).build();
  pickerWindow.setVisible(true);
 }catch{fail('Google 폴더 선택기를 열지 못했어요. Beam에서 다시 열고 계정 권한을 확인하세요.');}
}
let checkingFolder=false;
async function onPicked(response,p){
 if(ended||checkingFolder||folder)return;
 if(response?.[p.Response.ACTION]===p.Action.CANCEL){finish(cancel,'폴더 선택을 취소했어요. 저장하지 않았어요.');return;}
 if(response?.[p.Response.ACTION]!==p.Action.PICKED)return;
 const documents=response[p.Response.DOCUMENTS];
 if(!Array.isArray(documents)||documents.length!==1){fail('폴더를 하나만 골라 주세요. 저장하지 않았어요.');return;}
 checkingFolder=true;status.textContent='이 폴더에 파일을 추가할 수 있는지 확인하는 중…';controller=new AbortController();
 const selected=documents[0];
 try{
  const writable=await verifyDriveFolder({accessToken:folderToken,id:selected[p.Document.ID],resourceKey:selected.resourceKey||'',signal:controller.signal});
  if(ended)return;folder=writable;folderName.textContent=folder.name;
  folderConfirmation.hidden=false;status.textContent='정확한 저장 위치를 확인한 다음 저장을 눌러 주세요.';writeFolder.focus();
 }catch{fail('이 계정으로 선택한 폴더에 파일을 추가할 수 없어요. 폴더 초대 및 저장 권한을 확인하세요. 내 드라이브로 대신 저장하지 않았어요.');}
}
writeFolder.onclick=()=>{if(folder&&folderToken&&!ended&&!uploading){const token=folderToken;folderToken='';void upload(token,folder);}};
async function prepareAuthorization(){
 try{
  await waitForScript();if(ended)return;
  const oauth=globalThis.google?.accounts?.oauth2;
  if(!oauth)throw Error('GIS unavailable');
  client=oauth.initTokenClient({
   client_id:oauthClient,scope,include_granted_scopes:false,callback:response=>void onToken(response),
   error_callback:()=>fail('Google 계정 선택 창이 닫혔거나 열리지 않았어요. 팝업을 허용한 뒤 Beam에서 다시 시도하세요.'),
  });
  status.textContent=connectOnly?'저장 없이 Google Drive 접근만 확인합니다.':packet.name+' · Google 계정을 선택해 주세요.';
  if(connectOnly)authorize.textContent='Google 계정 연결 확인';
  destinations.hidden=connectOnly||!pickerConfigured;authorize.disabled=false;
 }catch{fail('Google 계정 선택 모듈을 불러오지 못했어요.');}
}
function acceptHandoff(event){
 if(ended||port||event.ports?.length!==1||!validMessage(event,openerWindow,appOrigin,handoff,nonce))return;
 port=event.ports[0];window.removeEventListener('message',acceptHandoff);
 window.opener=null;openerWindow=null;
 port.onmessage=message=>{
  if(ended||message.data?.nonce!==nonce)return;
  if(message.data.type===cancel){if(uploading){controller?.abort();finish(uncertain,'저장 결과를 확인하지 못했어요. Drive에서 먼저 확인하세요.');}else finish(cancel,'Beam에서 저장을 취소했어요.');return;}
  if(packet||connectOnly)return;
  if(message.data.type==='beam-drive/connect'){connectOnly=true;void prepareAuthorization();return;}
  if(message.data.type!==payload)return;
  try{packet=decodeWorkPacket(message.data,nonce);}
  catch{fail('지원하지 않는 검수 기록이에요. 저장하지 않았어요.');return;}
  void prepareAuthorization();
 };
 port.start();
}
destinations.onchange=()=>{authorize.textContent=document.querySelector('input[name=destination]:checked')?.value==='folder'?'Google 계정 선택 후 폴더 고르기':'Google 계정 선택 후 저장';};
authorize.onclick=()=>{
 if(ended||!client||(!packet&&!connectOnly)||uploading)return;
 folderFlow=!connectOnly&&pickerConfigured&&document.querySelector('input[name=destination]:checked')?.value==='folder';
 destinations.disabled=true;authorize.disabled=true;status.textContent='Google 계정 확인 중…';
 try{client.requestAccessToken({prompt:'consent select_account'});}
 catch{fail('Google 계정 선택을 열지 못했어요.');}
};
abortButton.onclick=()=>{if(!uploading){finish(cancel,'저장을 취소했어요.');window.close();}};
window.addEventListener('pagehide',()=>{controller?.abort();release();});
if(configured&&appOrigin&&appOrigin!==location.origin&&openerWindow&&isNonce(nonce)){
 initialTimer=setTimeout(()=>{controller?.abort();if(uploading)finish(uncertain,'저장 결과를 확인하지 못했어요. Drive에서 먼저 확인하세요.');else fail('안전한 연결 시간이 지났어요. Beam에서 다시 열어 주세요.');},expire);
 window.addEventListener('message',acceptHandoff);
 openerWindow.postMessage({type:ready,nonce},appOrigin);
}else{
 status.textContent='Beam에서 시작한 연결이 없거나 이 배포에 Google Drive 설정이 없어요.';
 release();
}
