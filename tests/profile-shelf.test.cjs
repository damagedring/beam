const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');

class Element {
 constructor(){this.children=[];this.events=new Map();this.attributes=new Map();this.dataset={};this.value='';this.classList={add(){}};}
 append(...children){this.children.push(...children);}
 prepend(...children){this.children.unshift(...children);}
 showModal(){this.open=true;}
 close(){this.open=false;}
 remove(){this.removed=true;}
 click(){return this.onclick?.();}
 replaceChildren(...children){this.children=children;}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 contains(element){return this===element||this.children.some(child=>child.contains(element));}
 querySelector(selector){return this.find(el=>selector==='[aria-current="true"]'?el.attributes.get('aria-current')==='true':selector.split(',').includes(el.tag));}
 find(fn){if(fn(this))return this;for(const child of this.children){const found=child.find(fn);if(found)return found;}return null;}
 addEventListener(name,fn){this.events.set(name,fn);}
 dispatch(name,params={}){this.events.get(name)?.({preventDefault(){},stopPropagation(){},...params});}
 focus(){this.doc.activeElement=this;}
}

function boot(profiles,active){
 const html=fs.readFileSync(__dirname+'/../dist/index.html','utf8'),js=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
 assert.match(html,/<section id="profileShelf"[^>]*><button id="openWorkbook"[^>]*>.*beam-glyph-open-file.*>불러오기<\/span><\/button><\/section>/);
 assert.match(html,/id="workbookFile" type="file" accept="\.xlsx,\.xlsm,\.json,application\/json"/);
 const elements=new Map(),document={activeElement:null,createElement(tag){const e=new Element();e.doc=document;e.tag=tag;return e;},createElementNS(){return this.createElement();},getElementById(id){if(!elements.has(id))elements.set(id,this.createElement());return elements.get(id);}};
 document.body=document.createElement('body');
 let state=JSON.stringify({version:1,profiles,active});
 const retries=[];
 const c=vm.createContext({document,language:'ko',localStorage:{getItem:()=>state,setItem:(_,value)=>{state=value;}},performance:{now:()=>0},
   Uint8Array,TextDecoder,returnChannelInputLimit:256,returnChannelFormText:(_,fallback)=>fallback,uiConfirm:()=>true,runCombinedWorkbook:(file,options)=>retries.push({file,options}),
 });
 const source=js.slice(js.indexOf('const MappingUI=(()=>{'),js.indexOf('Object.assign(translations,',js.indexOf('const MappingUI=(()=>{')));
 assert.ok(source.includes('function chooseProfile'));
 const {MappingCore,returnChannelExact,returnChannelKey,returnChannelValues}=require('../dist/import/mapping/profiles.js');
 Object.assign(c,{MappingCore,returnChannelExact,returnChannelKey,returnChannelValues});
 vm.runInContext(source+'\nMappingUI.init(); globalThis.api=MappingUI;',c);
 return {document,c,retries,read:()=>JSON.parse(state),shelf:elements.get('profileShelf'),details:elements.get('dataProfileDetails')};
}

const profile=(name,sheetName)=>({name,file:sheetName?{sku:{version:1,kind:'sku',sheetName,signature:['SKU'],headerNames:{sku:'SKU'}}}:{},paste:{}});
const byClass=(root,name)=>root.find(el=>el.className===name);
const current=shelf=>shelf.querySelector('[aria-current="true"]');

test('profile documents switch the next workbook mapping and keep expanded profile details in sync',async()=>{
 const {shelf,details,read,c,document}=boot({a:profile('Alpha','A SKU'),b:profile('가상 프로필 Beta','B SKU'),c:profile('Third')},'a');
 const row=byClass(shelf,'profile-shelf-row'),[prev,rail,next]=row.children;
 assert.equal(prev.attributes.get('aria-disabled'),'true');
 assert.equal(current(shelf).title,'Alpha');
 next.onclick();
 assert.equal(read().active,'b');
 assert.equal(current(shelf).title,'가상 프로필 Beta');
 assert.equal(byClass(details,'profile-management-name').textContent,'가상 프로필 Beta');
 assert.equal(byClass(details,'profile-mapping-list').children[0].children[1].textContent,'B SKU');
 const transaction=await c.api.begin('sku','file');
 await assert.rejects(async()=>await c.api.begin('sku','file'),/진행 중/);
 assert.equal(next.disabled,true);prev.onclick();assert.equal(read().active,'b');
 const sheets=await transaction.hooks.selectSheets({sheets:[{name:'A SKU',index:1},{name:'B SKU',index:2}],wantedKind:'sku'});
 assert.deepEqual(JSON.parse(JSON.stringify(sheets)),[{kind:'sku',sheetIndex:2}]);transaction.abort();
 current(shelf).focus();document.getElementById('dataDialog').dispatch('keydown',{key:'ArrowRight'});assert.equal(read().active,'c');
 assert.equal(document.activeElement,current(shelf));next.onclick();assert.equal(read().active,'c');
 document.getElementById('dataDialog').dispatch('keydown',{key:'Home'});assert.equal(read().active,'a');
 row.dispatch('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:8,clientX:120,clientY:30});
 row.dispatch('pointerup',{pointerId:8,clientX:35,clientY:31});
 assert.equal(read().active,'b');
 row.dispatch('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:8,clientX:120,clientY:30});
 row.dispatch('pointerup',{pointerId:8,clientX:70,clientY:140});
 assert.equal(read().active,'b');
});

test('single-profile shelf does not show decorative navigation or a position count',()=>{
 const {shelf,details}=boot({default:profile('Default')},'default');
 const [prev,rail,next]=byClass(shelf,'profile-shelf-row').children;
 assert.ok(prev.hidden&&next.hidden);
 assert.equal(rail.children.length,1);
 assert.equal(byClass(shelf,'profile-shelf-page').textContent,'');
 assert.equal(byClass(details,'profile-empty-mapping').textContent,'아직 저장된 연결이 없어요.');
});

test('one file picker handles workbook and profile imports from the former plus slot',async()=>{
 const {shelf,details,c,document}=boot({a:profile('Alpha')},'a');
 const button=document.getElementById('openWorkbook');
 assert.equal(byClass(shelf,'profile-shelf-tools').children.at(-1),button);
 assert.equal(button.attributes.get('aria-label'),'RAW 또는 프로필 불러오기');
 assert.equal(byClass(shelf,'profile-shelf-add'),null);
 assert.ok(!byClass(details,'profile-json-actions').find(el=>el.textContent==='JSON 불러오기'));
 assert.ok(byClass(details,'profile-json-actions').find(el=>el.textContent==='JSON 내보내기'));
 const tx=await c.api.begin('sku','file');
 assert.equal(button.disabled,true);tx.abort();assert.equal(button.disabled,false);
});


const raw=(name,sheetName,headerNames)=>({name,file:{raw:{version:1,kind:'raw',sheetName,signature:Object.values(headerNames).sort(),headerNames,returnChannelReviewed:true}},paste:{}});
const work=raw('Example A','Intake A',{receipt:'Ref A',qty:'Count A',sku:'Item A'});
const sample=raw('Example B','Intake B',{receipt:'Ticket B',qty:'Units B',sku:'Product B'});
const sampleFile={name:'example-b.xlsx',sheets:[{name:'Intake B',index:4}],rows:[['Notes'],['Units B','Product B','Ticket B'],['3','TEST-B','RETURN-B']]};

function importProfile(c,readBuffer){
 return c.api.importProfile({name:'profile.json',size:500,arrayBuffer:readBuffer});
}
const sampleProfileBytes=()=>new TextEncoder().encode(JSON.stringify({version:1,active:'sample',profiles:{sample}})).buffer;
async function assertSampleMapping(api) {
 const tx=await api.begin(null,'file');
 assert.deepEqual(JSON.parse(JSON.stringify(await tx.hooks.selectSheets({sheets:sampleFile.sheets}))),[{kind:'raw',sheetIndex:4}]);
 const mapping=await tx.hooks.selectColumns({kind:'raw',sheetName:'Intake B',rows:sampleFile.rows});
 assert.equal(mapping.headerRow,1);
 assert.deepEqual(JSON.parse(JSON.stringify(mapping.columns)),{receipt:2,qty:0,sku:1});
 tx.abort();
}
test('combining an incoming workbook and asynchronous profile import waits for the selected profile',async()=>{
 const {details,read,c}=boot({work},'work');
 let release;const reading=importProfile(c,()=>new Promise(resolve=>{release=resolve;}));
 const ready=c.api.waitForProfileImport();
 assert.equal(read().active,'work');
 release(sampleProfileBytes());
 assert.equal(await ready,true);await reading;
 assert.equal(read().active,'sample');await assertSampleMapping(c.api);
});
test('RAW chosen first can return to profiles and replay that exact workbook, never the old workbook',async()=>{
 const {details,shelf,read,c,document,retries}=boot({work},'work');
 c.api.rememberWorkbook({name:'example-a.xlsx'},true);
 c.api.rememberWorkbook(sampleFile,true);
 const tx=await c.api.begin(null,'file',{canChangeProfile:true});
 const review=tx.hooks.selectSheets({sheets:sampleFile.sheets});
 const modal=document.body.children.at(-1);
 modal.find(el=>el.textContent==='다른 프로필 사용').click();
 await assert.rejects(review,error=>error.name==='AbortError'&&error.changeProfile===true);
 tx.abort();c.api.offerWorkbookRetry();c.api.refresh();
 assert.equal(read().active,'work');
 await importProfile(c,async()=>sampleProfileBytes());
 const retry=byClass(shelf,'profile-workbook-button profile-retry-workbook');
 assert.equal(retry.hidden,false);assert.match(retry.textContent,/example-b\.xlsx/);
 assert.equal(retries.length,0);retry.click();
 assert.equal(retries.length,1);assert.equal(retries[0].file,sampleFile);assert.equal(retries[0].options.retry,true);
 await assertSampleMapping(c.api);
});


async function mapReturnFile(c,document){
 const tx=await c.api.begin('raw','file',{autoProfile:true});
 const pending=tx.hooks.selectColumns({kind:'raw',sheetName:'Intake B',rows:[['Ticket B','Units B','Product B'],['R1','2','SKU1']]});
 const modal=document.body.children.at(-1);
 const byLabel=name=>modal.find(el=>el.attributes.get('aria-label')===name);
 const header=byLabel('헤더 행');header.value='0';header.onchange();
 for(const field of byClass(modal,'mapping-fields').children)for(const child of field.children)if(child.tag==='select')child.value='';
 byLabel('주문 식별자').value='0';
 byLabel('예정 수량').value='1';
 byLabel('상품 코드').value='2';
 modal.find(el=>el.textContent==='연결 확인').click();
 await pending;
 return tx;
}
test('first connected RAW names the empty profile only after a successful apply',async()=>{
 const {document,c,read}=boot({default:profile('기본 프로필')},'default');
 let tx=await mapReturnFile(c,document);tx.prepareProfile({name:'Sandbox.xlsx'},true);
 assert.equal(read().profiles.default.name,'기본 프로필');
 tx.abort();assert.equal(read().profiles.default.name,'기본 프로필');
 tx=await mapReturnFile(c,document);tx.prepareProfile({name:'Sandbox.xlsx'},true);tx.commit({});
 assert.equal(read().active,'default');
 assert.equal(read().profiles.default.name,'Sandbox');
 assert.equal(read().profiles.default.file.raw.sheetName,'Intake B');
});
test('a different RAW schema creates a named profile and keeps previous mappings untouched',async()=>{
 const {document,c,read}=boot({work,other:profile('Sandbox')},'work');
 const before=read().profiles.work;
 const tx=await mapReturnFile(c,document);tx.prepareProfile({name:'Sandbox.XLSM'},true);tx.commit({});
 const saved=read();
 assert.notEqual(saved.active,'work');
 assert.deepEqual(saved.profiles.work,before);
 assert.equal(saved.profiles[saved.active].name,'Sandbox (2)');
 assert.equal(saved.profiles[saved.active].file.raw.sheetName,'Intake B');
 assert.equal(Object.keys(saved.profiles).length,3);
});
test('same mapping with reordered headers reuses the active profile instead of creating a copy',async()=>{
 const {read,c}=boot({sample},'sample');
 const tx=await c.api.begin(null,'file',{autoProfile:true});
 await tx.hooks.selectSheets({sheets:sampleFile.sheets});
 await tx.hooks.selectColumns({kind:'raw',sheetName:'Intake B',rows:sampleFile.rows});
 tx.prepareProfile({name:'renamed-copy.xlsx'},true);tx.commit({});
 assert.deepEqual(Object.keys(read().profiles),['sample']);
 assert.equal(read().profiles.sample.name,sample.name);
});
test('a source already mapped in another profile selects it without making a duplicate',async()=>{
 const {document,c,read}=boot({work,sample},'work');
 const tx=await mapReturnFile(c,document);tx.prepareProfile({name:'already-known.xlsx'},true);tx.commit({});
 assert.deepEqual(Object.keys(read().profiles),['work','sample']);
 assert.equal(read().active,'sample');
 assert.equal(read().profiles.sample.name,sample.name);
});


test('the shared import handler dispatches only JSON and supported workbook extensions',()=>{
 const js=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
 const at=js.indexOf('function importReferenceFile('),end=js.indexOf("$('workbookFile').onchange",at),actions=[];
 const handle=vm.runInNewContext(js.slice(at,end)+'\nimportReferenceFile',{
  language:'en',dataImportBusy:false,MappingUI:{importProfile:file=>actions.push(['profile',file.name])},
  runCombinedWorkbook:file=>actions.push(['workbook',file.name]),notice:()=>actions.push(['invalid']),
 });
 for(const name of ['setup.JSON','daily.XLSX','data.xlsm','old.xls','text.txt'])handle({name});
 assert.deepEqual(actions,[['profile','setup.JSON'],['workbook','daily.XLSX'],['workbook','data.xlsm'],['invalid'],['invalid']]);
});

test('profile arrows work from import button, but preserve editable controls and vertical scroll',()=>{
 const {shelf,read,document}=boot({a:profile('Alpha'),b:profile('Beta'),c:profile('Gamma')},'a');
 const dialog=document.getElementById('dataDialog'),importButton=document.getElementById('openWorkbook'),row=byClass(shelf,'profile-shelf-row');
 importButton.focus();
 dialog.dispatch('keydown',{key:'ArrowRight',target:importButton});
 assert.equal(read().active,'b');
 assert.equal(document.activeElement,importButton);
 dialog.dispatch('keydown',{key:'ArrowRight',target:{closest:()=>true}});
 dialog.dispatch('keydown',{key:'ArrowRight',isComposing:true});
 assert.equal(read().active,'b');
 const wheel=(p)=>{let prevented=false;row.dispatch('wheel',{deltaX:0,deltaY:0,deltaMode:0,cancelable:true,...p,preventDefault(){prevented=true;}});return prevented;};
 assert.equal(wheel({timeStamp:10,deltaY:72}),false);
 assert.equal(read().active,'b');
 assert.equal(wheel({timeStamp:12,deltaX:24}),true);
 wheel({timeStamp:17,deltaX:16});assert.equal(read().active,'c');
 wheel({timeStamp:26,deltaX:-65});assert.equal(read().active,'c');
 wheel({timeStamp:250,deltaX:-72});assert.equal(read().active,'b');
 row.dispatch('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:1,clientX:30,clientY:80});
 row.dispatch('pointercancel',{pointerId:1});
 row.dispatch('pointerup',{pointerId:1,clientX:100,clientY:80});assert.equal(read().active,'b');
});
