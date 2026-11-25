import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
test('home exposes exactly the intended four text labels, three modes open enabled workflows',()=>{
 const home=html.slice(html.indexOf('<main id="beamHome"'),html.indexOf('<main id="cartonWorkspace"'));
 assert.match(home,/<main id="beamHome".*?>/);
 assert.deepEqual([...home.matchAll(/class="beam-home-en" lang="en">([^<]+)<\/span> <span class="beam-home-ko" lang="ko">([^<]+)/g)].map(([,en,ko])=>[en,ko]),[['Inbound','입고'],['Outbound','출고'],['Inventory','재고관리'],['Returns','반품']]);
 assert.equal([...home.matchAll(/<button\b/g)].length,4);
 assert.equal([...home.matchAll(/aria-controls="beamSearch"/g)].length,1);
 assert.equal([...home.matchAll(/>준비 중<\/small>/g)].length,1);
 assert.doesNotMatch(home,/<img|<svg|style=/);
});
test('home ↔ returns toggles inert regions and does not write inspection or recovery state',()=>{
 const mark={};
 const nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,inert:false,dataset:{},offsetWidth:({beamHomeInbound:310,beamHomeOutbound:405,beamHomeInventory:392,beamHomeReturns:285})[id]||0,style:{setProperty(key,value){this[key]=value}},setAttribute(key,value){this[key]=value},classList:{remove(){},add(){}},focus(){mark.focus=id}});return nodes.get(id)};
 const document={body:{dataset:{}}},beam={visible:true};
 const cut=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
 runInNewContext(cut('function beamView(', 'function beamKnownJobs(')+'\n'+cut('function beamShowHome(', 'function beamInspectionEscape(')+'\nbeamShowHome(false);',{
  beam,$,document,cartonWorkspace:{hide(){},open(mode){mark.mode=mode;}},window:{scrollTo(){}},beamRender(){mark.rendered=true;},beamDrawJobs(){},beamNewSearch(){},matchMedia:()=>({matches:true}),focusBeamInput:id=>$(id).focus()
 });
 assert.equal(document.body.dataset.beamView,'home');assert.equal($('beamSearch').inert,true);assert.equal($('sheetWorkspace').inert,true);
 assert.equal($('beamHomeSlotReturns').dataset.center,'true');
 const x=id=>parseFloat($(id).style['--home-x']);
 assert.ok(x('beamHomeSlotInbound')>(285+310*.82)/2);
 assert.ok(Math.abs(x('beamHomeSlotInventory'))>(285+392*.82)/2);
 assert.ok(x('beamHomeSlotOutbound')-x('beamHomeSlotInbound')>(310*.82+405*.64)/2);
 $('beamHomeInbound').onclick();
 assert.equal(document.body.dataset.beamView,'home');assert.equal($('beamHomeSlotInbound').dataset.center,'true');
 $('beamHomeReturns').onclick();assert.equal(document.body.dataset.beamView,'home');
 $('beamHomeReturns').onclick();assert.equal(document.body.dataset.beamView,'search');assert.equal(mark.focus,'beamQuery');assert.equal($('beamHome').inert,true);
 $('beamHomeBack').onclick();assert.equal(document.body.dataset.beamView,'home');assert.equal(mark.focus,'beamHomeReturns');
 $('beamHomeOutbound').onclick();$('beamHomeOutbound').onclick();assert.equal(mark.mode,'outbound');assert.equal(document.body.dataset.beamView,'carton');
 assert.match(app,/finishRestore:plan=>[\s\S]{0,700}if\(state\.receipt\)\{beamView\(false\)/);
});
test('home labels avoid the global glass finish and have independently padded, understated capsules',async()=>{
 const [glass,workspace,reels]=await Promise.all(['glass','workspace','touch-reels'].map(name=>readFile(new URL(`../src/styles/${name}.css`,import.meta.url),'utf8')));
 const glassFinishes=glass.split('button:not(.beam-receipt,#workSidebarToggle,.metric,.beam-home-word,.order-tab-link),input[type=button],input[type=submit]');
 assert.equal(glassFinishes.length,3,'satin finish and reduced-transparency fallback exclude bare home labels');
 const homeFinish=workspace.match(/#beamHome \.beam-home-word:not\(\[hidden\]\)\{([^}]+)/)?.[1]??'';
 for(const declaration of ['background:none','border-radius:0','box-shadow:none','-webkit-backdrop-filter:none','backdrop-filter:none']){
  assert.ok(homeFinish.includes(declaration+'!important'),declaration);
 }
 assert.match(reels,/padding:\.17em \.42em/);
 assert.match(reels,/::before[\s\S]+pointer-events:none/);
});
