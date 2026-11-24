const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');

class Element {
 constructor(){this.children=[];this.events=new Map();this.attributes=new Map();this.dataset={};this.classList={add(){}};}
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
 assert.match(html,/<button id="openWorkbook"[^>]*>[^<]+<\/button>\s*<section id="profileShelf"/);
 const elements=new Map(),document={activeElement:null,createElement(tag){const e=new Element();e.doc=document;e.tag=tag;return e;},createElementNS(){return this.createElement();},getElementById(id){if(!elements.has(id))elements.set(id,this.createElement());return elements.get(id);}};
 document.body=document.createElement('body');
 let state=JSON.stringify({version:1,profiles,active});
 const retries=[];
 const c=vm.createContext({document,language:'ko',localStorage:{getItem:()=>state,setItem:(_,value)=>{state=value;}},performance:{now:()=>0},returnChannelValues:()=>undefined,
   Uint8Array,TextDecoder,uiConfirm:()=>true,runCombinedWorkbook:(file,options)=>retries.push({file,options}),
 });
 const source=js.slice(js.indexOf('const MappingUI=(()=>{'),js.indexOf('Object.assign(translations,',js.indexOf('const MappingUI=(()=>{')));
 assert.ok(source.includes('function chooseProfile'));
 const core=js.slice(js.indexOf('const MappingCore=(()=>{'),js.indexOf('const Engine=(()=>{'));
 vm.runInContext(core+source+'\nMappingUI.init(); globalThis.api=MappingUI;',c);
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
 current(shelf).focus();row.dispatch('keydown',{key:'ArrowRight'});assert.equal(read().active,'c');
 assert.equal(document.activeElement,current(shelf));next.onclick();assert.equal(read().active,'c');
 row.dispatch('keydown',{key:'Home'});assert.equal(read().active,'a');
 rail.dispatch('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:8,clientX:120,clientY:30});
 rail.dispatch('pointerup',{pointerId:8,clientX:35,clientY:31});
 assert.equal(read().active,'b');
 rail.dispatch('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:8,clientX:120,clientY:30});
 rail.dispatch('pointerup',{pointerId:8,clientX:70,clientY:140});
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


const raw=(name,sheetName,headerNames)=>({name,file:{raw:{version:1,kind:'raw',sheetName,signature:Object.values(headerNames),headerNames,returnChannelReviewed:true}},paste:{}});
const work=raw('Example A','Intake A',{receipt:'Ref A',qty:'Count A',sku:'Item A'});
const sample=raw('Example B','Intake B',{receipt:'Ticket B',qty:'Units B',sku:'Product B'});
const sampleFile={name:'example-b.xlsx',sheets:[{name:'Intake B',index:4}],rows:[['Notes'],['Units B','Product B','Ticket B'],['3','TEST-B','RETURN-B']]};

function importProfile(details, readBuffer) {
 const input=details.find(el=>el.tag==='input'&&el.type==='file'&&el.accept.includes('json'));
 input.files=[{size:500,arrayBuffer:readBuffer}];
 return input.onchange();
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
 let release;const reading=importProfile(details,()=>new Promise(resolve=>{release=resolve;}));
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
 await importProfile(details,async()=>sampleProfileBytes());
 const retry=byClass(shelf,'profile-workbook-button profile-retry-workbook');
 assert.equal(retry.hidden,false);assert.match(retry.textContent,/example-b\.xlsx/);
 assert.equal(retries.length,0);retry.click();
 assert.equal(retries.length,1);assert.equal(retries[0].file,sampleFile);assert.equal(retries[0].options.retry,true);
 await assertSampleMapping(c.api);
});
