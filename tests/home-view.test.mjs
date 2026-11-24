import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
test('home exposes exactly the intended four text labels, only Returns is actionable',()=>{
 const home=html.slice(html.indexOf('<main id="beamHome"'),html.indexOf('<section id="beamSearch"'));
 assert.match(home,/<main id="beamHome".*?>/);
 assert.deepEqual([...home.matchAll(/class="beam-home-en" lang="en">([^<]+)<\/span> <span class="beam-home-ko" lang="ko">([^<]+)/g)].map(([,en,ko])=>[en,ko]),[['Inbound','입고'],['Outbound','출고'],['Inventory','재고관리'],['Returns','반품']]);
 assert.equal([...home.matchAll(/<button\b/g)].length,1);
 assert.equal([...home.matchAll(/>준비 중<\/small>/g)].length,3);
 assert.doesNotMatch(home,/<img|<svg|style=/);
});
test('home ↔ returns toggles inert regions and does not write inspection or recovery state',()=>{
 const mark={};
 const nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,inert:false,classList:{remove(){},add(){}},focus(){mark.focus=id}});return nodes.get(id)};
 const document={body:{dataset:{}}},beam={visible:true};
 const cut=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
 runInNewContext(cut('function beamView(', 'function beamKnownJobs(')+'\n'+cut('function beamShowHome(', 'function beamInspectionEscape(')+'\nbeamShowHome(false);',{
  beam,$,document,window:{scrollTo(){}},beamRender(){mark.rendered=true;},beamDrawJobs(){},beamNewSearch(){},matchMedia:()=>({matches:true})
 });
 assert.equal(document.body.dataset.beamView,'home');assert.equal($('beamSearch').inert,true);assert.equal($('sheetWorkspace').inert,true);
 $('beamHomeReturns').onclick();assert.equal(document.body.dataset.beamView,'search');assert.equal(mark.focus,'beamQuery');assert.equal($('beamHome').inert,true);
 $('beamHomeBack').onclick();assert.equal(document.body.dataset.beamView,'home');assert.equal(mark.focus,'beamHomeReturns');
 assert.match(app,/finishRestore:plan=>[\s\S]{0,700}if\(state\.receipt\)\{beamView\(false\)/);
});
