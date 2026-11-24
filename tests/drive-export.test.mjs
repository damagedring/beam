import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {scope,ready,handoff,payload,pinnedOrigin,validMessage,decodeWorkPacket,createDriveWorkFile,driveSession,driveLink,verifyDriveFolder} from '../drive-export/core.mjs';

const nonce='5a'.repeat(16),app='https://beam.example.test',exporter='https://export.example.test';
const source={tab:'original'},other={tab:'other'};
const model={format:'logistics-work-delta',version:1,reference:{scheme:'reference-sha256-chunks-v1',root:'a'.repeat(64),customerScheme:'customer-sha256-chunks-v1',customerRoot:'c'.repeat(64)},work:{version:1,scans:[{sku:'SYNTHETIC'}]}};
const name='Beam-work-2026-11-24T12-00-01Z.json';
const makePacket=work=>({type:payload,nonce,name,text:JSON.stringify(work)});
const context=work=>decodeWorkPacket(makePacket(work),nonce);
const mockedLocation='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&upload_id=test-123';

test('cross-origin exporter handshake binds exact origin, source, phase and a nonce',()=>{
 const message={source,origin:app,data:{type:handoff,nonce}};
 assert.equal(validMessage(message,source,app,handoff,nonce),true);
 for(const counterfeit of [{source:other},{origin:exporter},{origin:'https://beam.example.test:8443'},{data:{type:ready,nonce}},{data:{type:handoff,nonce:'fb'.repeat(16)}}]){
  assert.equal(validMessage({...message,...counterfeit},source,app,handoff,nonce),false);
 }
 assert.equal(pinnedOrigin('https://host.example/path'),'');
 assert.equal(pinnedOrigin('http://host.example'),'');
 assert.equal(pinnedOrigin('https://user@host.example'),'');
 assert.equal(scope,'https://www.googleapis.com/auth/drive.file');
});
test('only the bounded work-only envelope can be handed to the exporter',()=>{
 assert.deepEqual(JSON.parse(new TextDecoder().decode(context(model).bytes)),model);
 for(const contaminated of [{...model,data:{}},{...model,work:{...model.work,data:{raw:[]}}},{...model,work:{...model.work,customerNames:[]}},{...model,work:{workSheets:[{sources:{}}]}}]){
  assert.throws(()=>context(contaminated),/invalid-work/);
 }
 assert.throws(()=>decodeWorkPacket({...makePacket(model),name:'company-data.json'},nonce),/packet/);
 assert.throws(()=>decodeWorkPacket({...makePacket(model),text:'s'.repeat(50_000_001)},nonce),/packet/);
});
test('a small export creates one multipart JSON file only; no upload is confirmed without a valid ID',async()=>{
 const calls=[],packet=context(model);
 const request=async (url,options)=>{calls.push([url,options]);return new Response(JSON.stringify({id:'test_abc-123',webViewLink:'https://not-trusted.example/'}));};
 const result=await createDriveWorkFile({accessToken:'IN_MEMORY_ONLY',packet,request});
 assert.equal(result.url,'https://drive.google.com/open?id=test_abc-123');
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id');
 const options=calls[0][1];
 assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer IN_MEMORY_ONLY');
 assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.match(options.headers['Content-Type'],/^multipart\/related; boundary=beam_[a-f0-9]+$/);
 assert.match(await options.body.text(),/SYNTHETIC/);
 const bad=async ()=>new Response(JSON.stringify({id:'../outside'}));
 await assert.rejects(createDriveWorkFile({accessToken:'probe',packet,request:bad}),/upload-unconfirmed/);
 assert.equal(driveLink('javascript:alert(1)'),'');
});
test('a large export sends bytes only to a pinned Drive session URI, with no retry on an uncertain result',async()=>{
 const packet={name,bytes:new Uint8Array(5_000_001)},calls=[];
 const request=async (url,options)=>{
  calls.push([url,options]);
  if(calls.length===1)return new Response(null,{headers:{Location:mockedLocation}});
  throw Error('Disconnected after upload');
 };
 await assert.rejects(createDriveWorkFile({accessToken:'probe',packet,request}),/upload-unconfirmed/);
 assert.equal(calls.length,2);
 assert.equal(calls[0][0],'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id');
 assert.equal(calls[1][0],mockedLocation);assert.equal(calls[1][1].headers['Content-Range'],'bytes 0-5000000/5000001');
 assert.strictEqual(calls[1][1].body,packet.bytes);
 const evil='https://www.googleapis.com.bad.example/upload/drive/v3/files?upload_id=steal';
 assert.equal(driveSession(evil),'');assert.equal(driveSession('https://www.googleapis.com/drive/v3/files?upload_id=wrong-path'),'');
 let n=0;await assert.rejects(createDriveWorkFile({accessToken:'probe',packet,request:async()=>{n++;return new Response(null,{headers:{Location:evil}});}}),/invalid-session/);
 assert.equal(n,1);
});
test('default build hides the exporter and does not move Google services into the local app',async()=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.match(html,/connect-src 'none'/);
 assert.doesNotMatch(html,/accounts\.google\.com\/gsi|www\.googleapis\.com/);
 const expected=process.env.BEAM_DRIVE_EXPORTER_ORIGIN||'';
 assert.ok(html.includes('id="beamDriveExport" type="button" data-export-origin="'+expected+'" aria-haspopup="dialog" hidden'));
 const script=await readFile(new URL('../drive-export/export.mjs',import.meta.url),'utf8');
 assert.match(script,/include_granted_scopes:false/);
 assert.doesNotMatch(script,/localStorage|sessionStorage|indexedDB/);
 assert.match(script,/window\.opener=null/);
});


test('a shared folder must be explicitly chosen, writable, and checked by the very same account token',async()=>{
 const id='TEST-INVITED-FOLDER',resourceKey='TEST-RESOURCE-KEY',wanted={id,name:'Invited team folder',mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:true}};
 const auth='FOLDER_PROBE',packet=context(model),seen=[];
 const request=async (url,opts)=>{
  seen.push([url,opts]);
  if(!opts.method)return new Response(JSON.stringify(wanted));
  return new Response(JSON.stringify({id:'NEW-TEST-FILE'}));
 };
 const folder=await verifyDriveFolder({accessToken:auth,id,resourceKey,request});
 assert.equal(folder.name,wanted.name);
 assert.match(seen[0][0],/supportsAllDrives=true/);assert.equal(seen[0][1].headers['X-Goog-Drive-Resource-Keys'],id+'/'+resourceKey);
 await assert.rejects(createDriveWorkFile({accessToken:'OTHER-ACCOUNT',packet,folder,request}),/unverified-folder/);
 await assert.rejects(createDriveWorkFile({accessToken:auth,packet,folder:{...folder},request}),/unverified-folder/);
 assert.equal(seen.length,1);
 const saved=await createDriveWorkFile({accessToken:auth,packet,folder,request});
 assert.equal(saved.id,'NEW-TEST-FILE');assert.equal(seen.length,2);
 assert.match(seen[1][0],/supportsAllDrives=true/);
 assert.match(await seen[1][1].body.text(),/"parents":\["TEST-INVITED-FOLDER"\]/);
 assert.equal(seen[1][1].headers['X-Goog-Drive-Resource-Keys'],id+'/'+resourceKey);
 await assert.rejects(createDriveWorkFile({accessToken:auth,packet,folder,request}),/unverified-folder/);
 for(const check of [
  {...wanted,capabilities:{canAddChildren:false}}, {...wanted,trashed:true}, {...wanted,mimeType:'text/plain'},{...wanted,id:'SOMETHING-ELSE'}
 ]){
  await assert.rejects(verifyDriveFolder({id,accessToken:auth,request:async()=>new Response(JSON.stringify(check))}),/folder-not-writable/);
 }
});
