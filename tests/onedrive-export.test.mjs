import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOneDriveExporter} from '../onedrive-export/core.mjs';
const tenantId='11111111-2222-3333-4444-555555555555';
const scope='Files.ReadWrite.AppFolder',selected='Files.SelectedOperations.Selected';
const json=x=>JSON.stringify(x);
const document={format:'logistics-work-delta',version:1,reference:{scheme:'reference-sha256-chunks-v1',root:'a'.repeat(64),customerScheme:'customer-sha256-chunks-v1',customerRoot:'b'.repeat(64)},work:{version:1,scans:[]}};
const options={kind:'work',tenantId,driveId:'test!drive',folderId:'item-folder',label:'QA Shared Document Library'};
function fixture({settings={kind:'personal'},granted,tokenTenant=tenantId,code=201,folderDrive='test!drive',wrongParent=false}={}){
 const calls=[],clientLog=[];
 class Mock{constructor(x){clientLog.push(x)}async initialize(){clientLog.push('initialize')}async acquireTokenPopup(x){clientLog.push(x);return {scopes:granted||x.scopes,accessToken:'opaque-token',account:{username:'operator@example.test',tenantId:tokenTenant}}}}
 const api=createOneDriveExporter({settings:{clientId:tenantId,...settings},PublicClientApplication:Mock,redirectUri:'https://exports.example.test/blank',request:async(url,opts)=>{
  calls.push({url,opts});
  if(opts.method==='GET')return {ok:true,json:async()=>({id:'item-folder',folder:{},name:'Beam QA',parentReference:{driveId:folderDrive}})};
  const name=url.match(/:\/(Beam-work[^:]+):/)[1];
  return {status:code,json:async()=>({id:'file!new',file:{},name,size:opts.body.byteLength,parentReference:{driveId:'test!drive',id:wrongParent?'wrong':'item-folder'}})};
 }});
 return {api,calls,clientLog};
}
test('personal: consent scope then identify destination, create only and verify 201, burn authorization',async()=>{
 const {api,calls,clientLog}=fixture();await api.initialize();const destination=await api.chooseDestination();
 assert.equal(calls.length,1);assert.match(calls[0].url,/\/me\/drive\/special\/approot\?/);
 assert.deepEqual(clientLog[2].scopes,[scope]);assert.match(clientLog[0].auth.authority,/\/consumers$/);assert.equal(clientLog[0].cache.cacheLocation,'memoryStorage');
 assert.equal(destination.label,'OneDrive / Beam QA');assert.equal(destination.account,'operator@example.test');
 await assert.rejects(api.saveConfirmed({destination:{...destination},workText:json(document)}),/save-not-confirmed/);
 await assert.rejects(api.saveConfirmed({destination,workText:json({...document,work:{data:{raw:[]}}})}),/invalid-work/);
 const result=await api.saveConfirmed({destination,workText:json(document)});assert.match(result.name,/^Beam-work-.*-[a-f0-9-]{36}\.json$/);
 assert.equal(calls.length,2);assert.match(calls[1].url,/drives\/test!drive\/items\/item-folder:\//);assert.match(calls[1].url,/conflictBehavior=fail$/);assert.equal(calls[1].opts.redirect,'error');
 assert.equal(new TextDecoder().decode(calls[1].opts.body),json(document));
 await assert.rejects(api.saveConfirmed({destination,workText:json(document)}),/save-not-confirmed/);
});
test('work: exact administrator destination and scope; deny an unverified drive or tenant',async()=>{
 const yes=fixture({settings:options});await yes.api.initialize();const d=await yes.api.chooseDestination();
 assert.equal(d.label,'QA Shared Document Library / Beam QA');assert.deepEqual(yes.clientLog[2].scopes,[selected]);assert.match(yes.calls[0].url,/\/drives\/test!drive\/items\/item-folder\?/);
 for(const args of [{folderDrive:'other'},{tokenTenant:'wrong'}]){
  const {api}=fixture({settings:options,...args});await api.initialize();await assert.rejects(api.chooseDestination(),/destination-unverified|unexpected-account/);
 }
});
test('fail closed on broader scope, existing-item update response, wrong response parent, and cancel',async()=>{
 const broad=fixture({granted:[scope,'Files.ReadWrite']});await broad.api.initialize();await assert.rejects(broad.api.chooseDestination(),/unexpected-grant/);assert.equal(broad.calls.length,0);
 for(const args of [{code:200},{code:409},{wrongParent:true}]){
  const {api,calls}=fixture(args);await api.initialize();const destination=await api.chooseDestination();
  await assert.rejects(api.saveConfirmed({destination,workText:json(document)}),/upload-unconfirmed/);
  await assert.rejects(api.saveConfirmed({destination,workText:json(document)}),/save-not-confirmed/);
  assert.equal(calls.length,2);
 }
 const {api}=fixture();await api.initialize();const destination=await api.chooseDestination();api.cancel();await assert.rejects(api.saveConfirmed({destination,workText:json(document)}),/save-not-confirmed/);
});
