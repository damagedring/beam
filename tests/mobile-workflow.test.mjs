import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

test('phone quantity sheet is safe on cold start and gives focus back to its trigger',async()=>{
 const js=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const slice=(a,b)=>js.slice(js.indexOf(a),js.indexOf(b,js.indexOf(a)+1));
 const nodes=new Map(),rendered=[],attrs={};let focused=null;
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{open:false,hidden:false,textContent:'',replaceChildren(){this.cleared=true;},
   focus(){focused=id;},setAttribute(k,v){attrs[id+':'+k]=v;},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}});
  return nodes.get(id);
 };
 const state={receipt:''},questRows=[{sku:'test'}];
 $('questTitle').textContent='Expected';$('questSummary').textContent='0 / 1';
 runInNewContext(slice('function updateMobileQuantities()','function endQuestPeek()').split('mobileQuantityButton.onclick=')[0]+'\nupdateMobileQuantities();',{$,state});
 assert($('mobileExpectedQuantities').hidden);
 const ctx={$,state,questRows,setVirtualList:(id,rows)=>rendered.push([id,rows]),virtualLists:new Map(),closeOrderInfo(){},endQuestPeek(){}};
 runInNewContext(slice('const mobileQuantityButton=','function endQuestPeek()')+'\nglobalThis.update=updateMobileQuantities;',ctx);
 state.receipt='return-1';ctx.update();
 const trigger=$('mobileExpectedQuantities'), dialog=$('mobileQuantityDialog');
 assert(!trigger.hidden);trigger.onclick();
 assert(dialog.open);assert.equal(focused,'mobileQuantityClose');assert.equal(attrs['mobileExpectedQuantities:aria-expanded'],'true');
 assert.deepEqual(rendered,[['mobileQuantityList',questRows]]);
 assert.equal($('mobileQuantityTitle').textContent,'Expected');
 $('mobileQuantityClose').onclick();
 assert(!dialog.open);assert.equal(focused,'mobileExpectedQuantities');assert($('mobileQuantityList').cleared);
});
