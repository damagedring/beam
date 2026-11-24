const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../dist/index.html','utf8').replace(/>\s+</g,'><'),js=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
const searchKeys=fs.readFileSync(__dirname+'/../dist/domain/search-keys.js','utf8').replace(/^export /gm,'');
function slice(a,b){let at=js.indexOf(a),end=js.indexOf(b,at+1);assert.ok(at>=0&&end>at,[a,b]);return js.slice(at,end);}
const active={element:null};
class El {
 constructor(){this.dataset={};this.style={setProperty:(k,v)=>this.style[k]=v};this.children=[];this.first=new Object();this.events={};this.value='';this.hidden=false;this.isConnected=false;}
 querySelector(){return this.first;}
 setAttribute(k,v){this[k]=v;}
 removeAttribute(k){delete this[k];}
 addEventListener(k,f){this.events[k]=f;}
 setPointerCapture(id){this.captured=id;}
 replaceChildren(){for(const c of this.children)c.isConnected=false;this.children=[];}
 append(e){e.isConnected=true;this.children.push(e);}
 insertAdjacentHTML(place,markup){this.html=(this.html||'')+markup;}
 remove(){this.isConnected=false;}
 focus(){active.element=this;}
 closest(selector){return this.className==='beam-receipt'&&(selector!=='[data-folder=true]'||this.dataset.folder==='true')?this:null;}
}
const el=new Map(),$=k=>{if(!el.has(k))el.set(k,new El());return el.get(k)};
const modes=new El(),orderRows=new Map([
 ['A1',[{receipt:'A1',seller:'가상 성수점',qty:3,sku:'AS1',name:'Paper One',date:'2026-11-01',returnTracking:'1234-9999-0001'}]],
 ['B1',[{receipt:'B1',seller:'가상 성수북점',qty:2,sku:'BS1',name:'Paper Three',date:'2026-11-02',returnTracking:'1234-9999-0003'}]],
 ['A2',[{receipt:'A2',seller:'가상 성수점',qty:6,sku:'AS2',name:'Paper Two',date:'2026-11-04',returnTracking:'1234-9999-0002'}]],
 ['C1',[{receipt:'C1',seller:'가상 고객',qty:1,sku:'CS1',name:'Customer Paper',date:'2026-11-05'}]]
]);
const entries=new Map([...orderRows].map(([id,[r]])=>[id,{expected:r.qty,nameKeys:id==='C1'?['가상 고객']:[],names:id==='C1'?['가상 고객']:[]}]));
const b2b=['A1','B1','A2'],b2c=['C1'];
const ix={modeIds:{b2b,b2c},modeSets:{b2b:new Set(b2b),b2c:new Set(b2c)},orderSearch:entries,core:{rawByReceipt:orderRows},stores:new Map([['a',{name:'가상 성수점',row:orderRows.get('A1')[0],receipts:['A1','A2']}],['b',{name:'가상 성수북점',row:orderRows.get('B1')[0],receipts:['B1']}]])};
const entered=[],deferred={},turns=[]; let reduced=true;
El.prototype.firstElementChild={animate(frames,options){turns.push({frames,options});return {cancel(){}};}};
const c=vm.createContext({$,document:{querySelector:()=>modes,querySelectorAll:()=>[],createElement:()=>new El()},window:{matchMedia:()=>({matches:reduced})},uiIndex:()=>ix,isB2C:()=>false,asnStoreKey:id=>({A1:'a',A2:'a',B1:'b'})[id]||'',rawRows:id=>orderRows.get(id)||[],receiptDisplay:id=>'Ext-'+id,receiptBarcodeValue:id=>id,encodeReceiptCode128:()=>({runs:[2,1,2],modules:25}),esc:x=>String(x??'').replace(/[&<>"']/g,'X'),customerLookupKey:v=>v.trim().toLowerCase(),trackingMatches:(q,filter)=>[...orderRows.keys()].filter(id=>filter(id)&&q.replaceAll('-','')===orderRows.get(id)[0].returnTracking?.replaceAll('-','')),looksLikeTracking:q=>/^[0-9-]{10,}$/.test(q),Engine:{masterInfo:()=>({})},state:{data:{raw:[...orderRows.values()].flat()}},language:'ko',dataImportBusy:false,entered,performance,printL:(a)=>a});
vm.runInContext(searchKeys+'\n'+slice('const beam={mode:', 'function beamView(')+`\nfunction beamEnter(){entered.push(beam.candidate);} \$('beamStart').onclick=beamAdvance; globalThis.R={beam,beamRender,beamFolderItems,beamOpenFolderReceipt,beamTicketFace};`,c);
const beam=c.R.beam;
function ev(key,target,more={}){return {key,target,preventDefault(){this.defaultPrevented=true},stopPropagation(){},...more};}
const key=(name,more={})=>$('beamSearch').events.keydown(ev(name,active.element,more));
const type=(which,v)=>{$(which).value=v;$(which).focus();$(which).oninput();};
const inputKey=(which,name,more={})=>$(which).onkeydown(ev(name,$(which),more));
c.R.beamRender();
assert.equal($('beamStage').dataset.folders,'true');
assert.equal(beam.nodes.size,2);
assert.equal(beam.nodes.get('A1').dataset.center,'true');
assert.equal(beam.nodes.get('B1').dataset.center,'false');
assert.match(beam.nodes.get('A1').innerHTML,/beam-file-caption.*가상 성수점.*주문 2건/);
assert.match(beam.nodes.get('A1').innerHTML,/beam-file-paper.*beam-paper-top.*beam-paper-tear.*Code 128 · A1/);
assert.equal($('beamStart').disabled,true);inputKey('beamQuery','Enter');assert.equal(beam.phase,'search');
reduced=false;
type('beamQuery','성수');assert.ok(turns.some(t=>/rotateY\(32deg\)/.test(t.frames[0].transform)));
assert.ok(turns[0].frames.every((f,i,a)=>i===0||f.offset>a[i-1].offset));
assert.equal(turns[0].frames.at(-1).opacity,1);
const moving=turns.length;
type('beamQuery','성수점');assert.equal(turns.length,moving); // the same anchor must not jitter
type('beamQuery','성수');
inputKey('beamQuery','ArrowDown');assert.equal(active.element.dataset.id,'A1');
key('ArrowDown');assert.equal(beam.candidate,'B1');
assert.ok(turns.slice(moving).some(t=>/rotateX\(22deg\)/.test(t.frames[0].transform)));
key('ArrowLeft');assert.equal(beam.candidate,'A1');
assert.ok(turns.slice(moving).some(t=>/rotateY\(-11deg\)/.test(t.frames[0].transform)));
reduced=true;const motionBefore=turns.length;
type('beamQuery','');assert.equal(turns.length,motionBefore);

type('beamQuery','성수');assert.equal(beam.candidate,'A1');assert.equal($('beamNarrow').hidden,false);
inputKey('beamQuery','Tab');assert.strictEqual(active.element,$('beamSku'));
type('beamSku','123499990002');assert.equal(beam.candidate,'A2');
assert.match(beam.nodes.get('A2').innerHTML,/주문 1건/);
inputKey('beamSku','Enter',{isComposing:true});assert.equal(beam.phase,'search');
inputKey('beamSku','Enter');assert.equal(beam.phase,'party');assert.equal($('beamFindFold').inert,true);assert.equal(active.element.dataset.id,'A2');
key('Enter',{repeat:true});assert.equal(entered.length,0);key('Enter');
assert.equal(beam.phase,'asn');assert.match(beam.nodes.get('A2').innerHTML,/Code 128 · A2/);
key('Enter');assert.deepEqual(entered,['A2']);
$('beamEditSearch').onclick();assert.equal(beam.phase,'search');assert.strictEqual(active.element,$('beamQuery'));assert.equal($('beamSku').value,'123499990002');
type('beamSku','');
inputKey('beamQuery','Enter');assert.equal(beam.phase,'party');assert.equal(active.element.dataset.id,'A1');assert.equal($('beamPage').textContent,'1 / 2');
key('ArrowRight');assert.equal(active.element.dataset.id,'B1');assert.equal($('beamPage').textContent,'2 / 2');assert.match($('beamSearchStatus').textContent,/성수북점/);
key('ArrowLeft');key('Enter');assert.equal(beam.phase,'asn');assert.equal($('beamPage').textContent,'1 / 2');assert.equal(active.element.dataset.id,'A1');
key('ArrowDown');assert.equal(active.element.dataset.id,'A2');
const reel=$('beamStage'),gesture=(kind,x,y)=>reel.events[kind]({isPrimary:true,button:0,pointerId:10,clientX:x,clientY:y});
assert.equal(reel.dataset.axis,'y');
assert.ok(Number.parseFloat(beam.nodes.get('A1').style['--ribbon-pitch'])>0);
assert.equal(Number.parseFloat(beam.nodes.get('A2').style['--ribbon-pitch']),0);
gesture('pointerdown',100,100);gesture('pointermove',104,147);assert.equal(reel.captured,10);
assert.equal(reel.dataset.dragging,'true');assert.equal(beam.candidate,'A2');
gesture('pointerup',104,147);assert.equal(beam.candidate,'A1');assert.equal(reel.dataset.dragging,undefined);
gesture('pointerdown',100,100);gesture('pointermove',55,104);gesture('pointercancel',55,104);
assert.equal(beam.candidate,'A1');assert.equal(reel.dataset.axis,'x');
gesture('pointerdown',100,100);gesture('pointermove',55,104);gesture('pointerup',55,104);
assert.equal(beam.candidate,'A2');assert.equal(reel.dataset.axis,'x');
gesture('pointerdown',100,100);gesture('pointermove',95,55);gesture('pointerup',95,55);
assert.equal(beam.candidate,'A2');assert.equal(reel.dataset.dragging,undefined);
key('Enter');assert.deepEqual(entered,['A2','A2']);
key('Escape');assert.equal(beam.phase,'party');assert.equal(active.element.dataset.id,'A1');
assert.match(beam.nodes.get('A1').innerHTML,/beam-file-glass.*1 \/ 2.*가상 성수점.*주문 2건/);
assert.match(beam.nodes.get('B1').innerHTML,/주문 1건/);
const fixture=Array.from({length:401},(_,i)=>({sku:'SKU-'+i,barcode:'BAR-'+i,name:'Product '+i,qty:i+1}));
fixture.push({sku:'SKU-0',barcode:'BAR-0',name:'Product 0',qty:7});
const sheet=c.R.beamFolderItems(fixture);
assert.equal(sheet.items.length,401);assert.equal(sheet.items[0].qty,8);assert.equal(sheet.total,80608);
assert.strictEqual(c.R.beamFolderItems(fixture),sheet);
const originalRows=orderRows.get('A1');
orderRows.set('A1',fixture);
let exposed;
c.openUtilityDialog=(id)=>{exposed=id;};
c.R.beamOpenFolderReceipt();assert.equal(exposed,'beamFolderReceiptDialog');
assert.equal(($('beamFolderReceiptRows').html.match(/<tr>/g)||[]).length,200);
assert.match($('beamFolderReceiptTotal').textContent,/401종.*80,608 EA/);
assert.equal($('beamFolderReceiptMore').hidden,false);
$('beamFolderReceiptMore').onclick();$('beamFolderReceiptMore').onclick();
assert.equal(($('beamFolderReceiptRows').html.match(/<tr>/g)||[]).length,401);
assert.equal($('beamFolderReceiptMore').hidden,true);
$('beamFolderReceiptDialog').onclose();orderRows.set('A1',originalRows);

const folder=beam.nodes.get('A1'),candidateBeforePeek=beam.candidate;folder.focus();
const whisk=ev('wheel',folder,{deltaX:0,deltaY:73,deltaMode:0});
reel.events.wheel(whisk);assert.equal(whisk.defaultPrevented,true);
assert.match(folder.innerHTML,/Ext-A2.*Paper Two.*2 \/ 2/);
assert.ok(folder.innerHTML.includes(c.R.beamTicketFace('A2','b2b')));
assert.equal(beam.phase,'party');assert.equal(beam.candidate,candidateBeforePeek);
const endWheel=ev('wheel',folder,{deltaX:0,deltaY:73,deltaMode:0});reel.events.wheel(endWheel);assert.equal(endWheel.defaultPrevented,undefined);
key('PageUp');assert.match(folder.innerHTML,/Ext-A1.*Paper One.*1 \/ 2/);
key('PageDown');assert.match(folder.innerHTML,/Ext-A2.*Paper Two.*2 \/ 2/);
assert.ok(folder.innerHTML.includes(c.R.beamTicketFace('A2','b2b')));
key('Enter');assert.equal(beam.phase,'asn');assert.equal(beam.candidate,'A2');assert.doesNotMatch(beam.nodes.get('A2').innerHTML,/beam-file-glass/);
assert.equal(beam.nodes.get('A2').innerHTML,c.R.beamTicketFace('A2','b2b'));
$('beamEditSearch').onclick();assert.equal(beam.phase,'search');
type('beamQuery','000000000000');inputKey('beamQuery','Enter');assert.equal(beam.phase,'search');assert.match($('beamSearchStatus').textContent,/찾지 못했어요/);
type('beamQuery','성수');c.dataImportBusy=true;inputKey('beamQuery','Enter');assert.equal(beam.phase,'search');c.dataImportBusy=false;
type('beamQuery','성수');
assert.match(beam.nodes.get('A1').innerHTML,/beam-file-caption/);
inputKey('beamQuery','Enter');key('Enter');
assert.match(beam.nodes.get('A1').innerHTML,/beam-paper-top.*beam-paper-tear.*beam-paper-body/);
assert.match(beam.nodes.get('A1').innerHTML,/Code 128 · A1/);
$('beamEditSearch').onclick();
type('beamQuery','');
modes.onclick({target:{closest:()=>({dataset:{beamMode:'b2c'}})}});
assert.match(beam.nodes.get('C1').innerHTML,/beam-file-caption.*가상 고객/);
assert.equal(beam.nodes.get('C1').dataset.center,'true');
modes.onclick({target:{closest:()=>({dataset:{beamMode:'b2b'}})}});
type('beamQuery','성수');
// Escape mirrors the back button and lets modal / popover controls go first.
const closed=[],returned=[];
c.document.querySelector=()=>null;c.beamView=(search,animate)=>returned.push({search,animate});
for(const id of ['fileMenuPanel','questPeek','orderInfoPopover'])$(id).hidden=true;
const layerStates={discrepancyPopover:false,receiptList:true,storeList:true};
for(const id of Object.keys(layerStates))$(id).classList={contains:()=>layerStates[id]};
c.closeDiscrepancyPreview=()=>{layerStates.discrepancyPopover=true;closed.push('discrepancy');};
vm.runInContext(slice('function beamNewSearch(', "document.addEventListener('keydown',beamInspectionEscape")+ "\nglobalThis.escInspection=beamInspectionEscape;",c);
beam.visible=false;
c.escInspection(ev('Escape',$('barcode')));assert.deepEqual(closed,['discrepancy']);assert.equal(returned.length,0);
c.document.querySelector=()=>({open:true});c.escInspection(ev('Escape',$('barcode')));assert.equal(returned.length,0);
c.document.querySelector=()=>null;c.escInspection(ev('Escape',$('barcode'),{isComposing:true}));assert.equal(returned.length,0);
c.escInspection(ev('Escape',$('barcode')));assert.deepEqual(returned,[{search:true,animate:true}]);assert.equal(beam.query,'성수');
beam.visible=true;c.escInspection(ev('Escape',$('beamQuery')));assert.equal(returned.length,1);
vm.runInContext(slice('let beamRawProgressAt=', 'async function runCombinedWorkbook(')+`\nglobalThis.status=beamRawStatus;`,c);
c.status('read','Loading');assert.equal($('beamRawStatus').hidden,false);assert.equal($('beamRawProgress').hidden,false);
c.status('review','Review',false);assert.equal($('beamRawStatus').hidden,false);assert.equal($('beamRawProgress').hidden,true);
c.status('done','Loaded');assert.equal($('beamRawStatus').hidden,true);assert.equal($('beamRawProgress').hidden,true);assert.equal($('beamRawAnnounce').textContent,'Loaded');
c.status('error','Error',false);assert.equal($('beamRawStatus').hidden,false);
console.log('Beam state/DOM harness: focus, Tab, IME, repeated Enter, store arrows, scoped ASN arrows, Esc, SKU/tracking, loading guards, hidden success bar, recoverable errors pass.');
