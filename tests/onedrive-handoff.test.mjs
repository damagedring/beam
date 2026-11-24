import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('src/app.js',root),'utf8');
const appScript=source.slice(source.indexOf('/* Microsoft authentication is isolated.'));
const exporter=(await readFile(new URL('onedrive-export/export.mjs',root),'utf8')).replace(/^import .*;$/gm,'');
const nonce='0'.repeat(32),app='https://beam.example.test',isolated='https://one.example.test';
const elems=()=>{const els=new Map();return id=>{if(!els.has(id))els.set(id,{parentElement:{},focus(){}});return els.get(id);}};
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
const port=()=>({out:[],postMessage(x){this.out.push(x)},start(){},close(){}});
const bridge=()=>{const listeners={};return {listeners,addEventListener(k,f){listeners[k]=f},removeEventListener(k){delete listeners[k]},close(){}}};
const timers={setTimeout:()=>1,clearTimeout(){},setInterval:()=>2,clearInterval(){}};

test('app gates one-use payload on pinned popup, origin, nonce and a separate request',async()=>{
 const $=elems(),pipe=port(),initial=[],popup={postMessage:x=>initial.push(x)},window={...bridge(),open:()=>popup};
 $('beamOneDriveExport').dataset={oneDriveOrigin:isolated};
 let prepares=0;
 runInNewContext(appScript,{URL,$,window,location:new URL(app),closeFileMenu(){},state:{data:{raw:[1]},currentBatch:'batch'},beamL:(_,en)=>en,MessageChannel:class {port1=pipe;port2=port()},crypto:{getRandomValues:a=>a},WorkDelta:{async prepareSave(){prepares++;return {text:'work-only',assertCurrent(){}}}},...timers});
 $('beamOneDriveExport').onclick();
 const data={type:'beam-onedrive/ready',nonce};
 window.listeners.message({source:popup,origin:'https://wrong.test',data});assert.equal(initial.length,0);
 window.listeners.message({source:popup,origin:isolated,data});assert.equal(initial[0].type,'beam-onedrive/handoff');
 assert.equal(prepares,0);assert.equal(pipe.out.length,0);
 await pipe.onmessage({data:{type:'beam-onedrive/request',nonce:'f'.repeat(32)}});assert.equal(prepares,0);
 await pipe.onmessage({data:{type:'beam-onedrive/request',nonce}});await pipe.onmessage({data:{type:'beam-onedrive/request',nonce}});
 assert.equal(prepares,1);assert.equal(pipe.out.length,1);assert.equal(pipe.out[0].text,'work-only');
 await pipe.onmessage({data:{type:'beam-onedrive/complete',nonce}});
 assert.match($('beamOneDriveExportStatus').textContent,/Saved a new/);
});

test('exporter drops opener; no upload/request before authenticated named destination and save click',async()=>{
 const $=elems(),pipe=port(),opener={out:[],postMessage(x){this.out.push(x)}},window={...bridge(),opener};
 let saves=0,auth=0;
 const destination=Object.freeze({account:'qa@example.test',label:'Verified staging folder'});
 runInNewContext(exporter,{URL,URLSearchParams,window,document:{body:{dataset:{appOrigin:app}},getElementById:$},location:new URL(isolated+'/#nonce='+nonce),history:{replaceState(){}},AbortController,PublicClientApplication:class{},createOneDriveExporter:()=>({initialize:async()=>{},chooseDestination:async()=>{auth++;return destination},saveConfirmed:async val=>{assert.equal(val.destination,destination);assert.equal(val.workText,'work-only');saves++},cancel(){}}),...timers});
 assert.equal(opener.out[0].type,'beam-onedrive/ready');
 const data={type:'beam-onedrive/handoff',nonce};
 window.listeners.message({source:{},origin:app,data,ports:[pipe]});assert.equal(window.opener,opener);
 window.listeners.message({source:opener,origin:app,data,ports:[pipe]});await tick();assert.equal(window.opener,null);
 await pipe.onmessage({data:{type:'beam-onedrive/payload',nonce,text:'unsolicited'}});assert.equal(saves,0);
 await $('authorize').onclick();assert.equal(auth,1);assert.equal($('destination').textContent,destination.label);
 assert.equal(pipe.out.length,0);assert.equal(saves,0);
 $('save').onclick();$('save').onclick();assert.equal(pipe.out.length,1);assert.equal(pipe.out[0].type,'beam-onedrive/request');
 await pipe.onmessage({data:{type:'beam-onedrive/payload',nonce,text:'work-only'}});assert.equal(saves,1);assert.equal(pipe.out.at(-1).type,'beam-onedrive/complete');
});
