import { createOutboundReceipts } from './outbound-receipts.js';
import { productIdentityMarkup } from '../components/product-identity/view.js';
import { scannedProductLabel } from '../domain/product-identity.js';
import { cartonAdapter, cartonRows, cartonSearch, codeKey, createCartonIndex, fields, aliases, matchCartonScan, outboundCandidates, outboundDispatch } from '../domain/carton-verification.js';

export function attachCartonWorkspace({clearScanner,readWorkbook,engine,isEnglish,openLabels,openReport,openDispatch,dispatchProfile,saveDispatchMapping,showHome,notice}){
 const $=id=>document.getElementById(id), root=$('cartonWorkspace'), l=(ko,en)=>isEnglish()?en:ko;
 const sources=new Map();
 const receiptPicker=createOutboundReceipts($('outboundReceiptHost'),{l,onChoose:select});
 let mode=null,group=null,box=null,loading=false,page=0,stage='search';
 const view=()=>sources.get(mode), work=()=>view()?.work.get(group?.id);
 const currentEvents=()=>work()?.events||[];
 const rowList=()=>group?cartonRows(group,box,currentEvents()):[];
 const inspectionActive=()=>!root.hidden&&!!group&&(mode==='inventory'||(stage==='inspection'&&box!==null));
 const inspectionContext=()=>({mode:'outbound',orderId:group.id,externalId:group.external,work:'Carton: '+box,rows:rowList().map(r=>({...r,status:r.conflict?'conflict':r.unregistered?'unexpected':r.actual>r.expected?'excess':r.actual===r.expected?'matched':'short'}))});
 const dispatchContext=()=>({...outboundDispatch(group),fields:dispatchProfile().fields});
 const scopeKey=()=>JSON.stringify([group?.id,box]);
 const locked=()=>work()?.done.has(scopeKey());
 const scopeAllowed=()=>!work()?.events.length||work().method===(box===null?'whole':'box');
 const warn=value=>{$('cartonFeedback').textContent=value;};
 function localize(){
  const inventory=mode==='inventory';
  $('cartonTitle').textContent=inventory?l('Location 실사','Location verification'):l('출고 검수','Outbound verification');
  $('cartonQuery').placeholder=inventory?l('Location 또는 박스 라벨 검색','Search by location or carton label'):l('주문 식별자 · 박스 라벨 · 매장명','Order ID, carton label or store');
  $('cartonQuery').setAttribute('aria-label',$('cartonQuery').placeholder);
  $('cartonComparisonTitle').textContent=inventory?l('실사 대조결과','Stock count comparison'):l('현재 박스 대조결과','Carton comparison');
  $('cartonBack').querySelector('span').textContent=stage==='inspection'?l('박스 선택','Choose carton'):l('검색으로','Back to search');
  $('cartonScan').placeholder=l('바코드 또는 SKU','Barcode or SKU');
  $('cartonSource').textContent=view()?.name||l('통합 RAW에서 이 작업의 시트를 연결하세요.','Connect the relevant sheet from a combined workbook.');
 }
 function make(tag,value,attrs={}){
  const el=document.createElement(tag);Object.assign(el,attrs);if(value!==null)el.textContent=value;return el;
 }
 function chooseSheet(title,build){
  return new Promise((resolve,reject)=>{
   const dialog=$('cartonImportDialog'),body=$('cartonImportFields'),err=$('cartonImportError');
   $('cartonImportTitle').textContent=title;body.replaceChildren();err.textContent='';
   const read=build(body);let settled=false;
   function finish(value){if(settled)return;settled=true;dialog.close();body.replaceChildren();if(value)resolve(value);else reject(new DOMException('Cancelled','AbortError'));}
   $('cartonImportApply').onclick=()=>{try{finish(read());}catch(e){err.textContent=e.message;}};
   $('cartonImportCancel').onclick=()=>finish();dialog.onclose=()=>finish();
   dialog.showModal();
  });
 }
 const captions=()=>({
  receipt:mode==='inventory'?l('Location','Location'):l('주문 ID','Order ID'),
  id:l('박스 라벨번호','Carton label ID'),external:l('외부 주문 ID','External order ID'),
  store:l('도착 매장 (선택)','Destination store (optional)'),country:l('도착 국가 (선택)','Destination country (optional)'),
  qty:l('예정 수량','Expected quantity'),name:l('제품명','Product name'),brand:l('브랜드 (선택)','Brand (optional)'),sku:'SKU',barcode:l('상품 바코드','Product barcode')
 });
 async function load(file){
  if(loading||!file)return;
  if(view()?.work.size&&!window.confirm(l('이 업무의 기존 검수 기록이 바뀝니다. 새 자료를 연결할까요?','Loading a new reference replaces this mode’s inspection history. Continue?')))return;
  loading=true;const target=mode,prefs=target==='outbound'?dispatchProfile():null;let separator='',savedMapping=null;$('cartonFileButton').disabled=true;
  try{
   const adapter=cartonAdapter(target);
   const {cartonLines}=await readWorkbook(file,'cartonLines',p=>{
    if(p.phase==='sheet')$('cartonSource').textContent=l('읽는 중 · ','Reading · ')+p.rowsProcessed.toLocaleString();
   },{
    cartonAdapter:{validateColumns:adapter.validateColumns,table:(...args)=>cartonAdapter(target,separator).table(...args)},
    selectSheets:({sheets})=>chooseSheet(l('검수 대상 시트 연결','Connect inspection sheet'),body=>{
     const sel=make('select',null);
     sel.replaceChildren(...sheets.map(x=>new Option(x.name,String(x.index))));
     const words=target==='outbound'?/shipment.*carton|outbound.*carton|출고.*박스/i:/inventory.*carton|location.*carton|재고.*박스/i;
     const match=sheets.find(x=>x.name===prefs?.mapping?.sheet)||sheets.find(x=>words.test(x.name));if(match)sel.value=String(match.index);
     const label=make('label',l('시트','Sheet'));label.append(sel);body.append(label);
     return ()=>[{kind:'cartonLines',sheetIndex:Number(sel.value)}];
    }),
    selectColumns:({rows,rowNumbers,sheetName})=>chooseSheet(sheetName,body=>{
     const map=make('div',null,{className:'mapping-fields'}),header=make('select',null),readHeader=()=>Number(header.value);
     const headLabel=make('label',l('제목 행','Header row'));headLabel.append(header);body.append(headLabel,map);
     const clean=v=>codeKey(v).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
     rows.forEach((r,i)=>header.append(new Option(l('행 ','Row ')+rowNumbers[i]+' · '+r.filter(Boolean).slice(0,3).join(' / '),String(i))));
     const remembered=prefs?.mapping?.sheet===sheetName?prefs.mapping.headers:null;
     const byHeader=(head,name)=>head.flatMap((c,i)=>codeKey(c)===name?[i]:[]);
     const previous=remembered?rows.findIndex(r=>Object.values(remembered).every(name=>byHeader(r,name).length===1)):-1;
     const detected=previous>=0?previous:rows.findIndex(r=>r.some(c=>aliases.receipt.includes(clean(c)))&&r.some(c=>aliases.qty.includes(clean(c))));if(detected>=0)header.value=String(detected);
     const controls=new Map();
     const sep=make('input',null,{type:'text',maxLength:6,placeholder:' /  |  #'}),sepLabel=make('label',l('Location과 박스 사이 구분자 (박스 열이 없을 때)','Separator between location and carton (without a carton column)'));sepLabel.append(sep);
     function draw(){
      map.replaceChildren();controls.clear();
      const head=rows[readHeader()];
      for(const field of fields){
       if(target==='inventory'&&['external','store','country'].includes(field))continue;
       const label=make('label',captions()[field]),select=make('select',null);
       select.append(new Option(l('연결 안 함','Not mapped'),''));
       head.forEach((c,i)=>{if(codeKey(c))select.append(new Option(codeKey(c),String(i)));});
       const matches=remembered&&Object.hasOwn(remembered,field)?byHeader(head,remembered[field]):
        previous>=0&&field!=='brand'?[]:
        head.flatMap((c,i)=>aliases[field].includes(clean(c))?[i]:[]);
       if(matches.length===1)select.value=String(matches[0]);
       label.append(select);map.append(label);controls.set(field,select);
      }
      const sync=()=>{sepLabel.hidden=target!=='inventory'||controls.get('id').value!=='';};
      controls.get('id').onchange=sync;sync();
     }
     header.onchange=draw;draw();body.append(sepLabel);
     return ()=>{
      const columns=Object.fromEntries([...controls].filter(([,el])=>el.value!=='').map(([k,el])=>[k,Number(el.value)]));
      separator=target==='inventory'&&columns.id===undefined?sep.value.trim():'';
      adapter.validateColumns('cartonLines',rows[readHeader()],columns);
      if(target==='outbound'){
       const head=rows[readHeader()],headers=Object.fromEntries(Object.entries(columns).filter(([,i])=>byHeader(head,codeKey(head[i])).length===1).map(([key,i])=>[key,codeKey(head[i])]));
       // Missing optional fields also stay unmapped instead of auto-mapping again.
       savedMapping={sheet:sheetName,headers};
      }
      return {headerRow:readHeader(),columns};
     };
    })
   },{Engine:engine,language:isEnglish()?'en':'ko'});
   const index=createCartonIndex(cartonLines);
   if(!index.groups.size)throw Error(l('검수할 예정 수량이 없습니다.','There are no positive expected quantities.'));
   sources.set(target,{name:file.name,index,work:new Map()});if(mode===target){group=null;box=null;stage='search';$('cartonQuery').value='';render();}
   if(prefs&&savedMapping)saveDispatchMapping(prefs.id,savedMapping);
   notice(l('검수 기준 연결 완료','Inspection reference connected'));
  }catch(e){if(e.name!=='AbortError')notice(e.message,'error');}
  finally{loading=false;$('cartonFileButton').disabled=false;localize();}
 }
 function focusStage(id){
  $(id)?.focus({preventScroll:true});
 }
 function showStage(next){
  stage=next;page=0;warn('');clearScanner();$('cartonScan').value='';render();window.scrollTo(0,0);
  if(next==='search'){focusStage(matchMedia('(pointer:fine)').matches?'cartonQuery':'cartonTitle');return;}
  if(next==='pick'){
   $('cartonScopes').querySelector('[aria-pressed=true]')?.focus({preventScroll:true});
   return;
  }
  focusStage(matchMedia('(pointer:fine)').matches&&!$('cartonScan').disabled?'cartonScan':'cartonGroupTitle');
  if(mode==='outbound'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   const panel=$('cartonInspection');panel.classList.remove('beam-entering');void panel.offsetWidth;panel.classList.add('beam-entering');
  }
 }
 function select(g,boxMatch){
  group=g;page=0;warn('');
  box=boxMatch||(mode==='outbound'?[...g.boxes.keys()][0]:null);
  if(mode==='outbound'){showStage('pick');return;}
  render();focusStage(matchMedia('(pointer:fine)').matches?'cartonScan':'cartonGroupTitle');
 }
 function back(){
  if(mode==='outbound'&&stage==='inspection'){showStage('pick');return;}
  if(mode==='outbound'&&stage==='pick'){group=null;box=null;showStage('search');receiptPicker.resume();return;}
  if(mode==='outbound'&&receiptPicker.back())return;
  showHome();
 }
 function currentSelection(searchText){
  const i=view()?.index;if(!i)return {};
  const v=codeKey(searchText);const exact=i.groups.get(v);
  if(exact)return {g:exact};
  const matches=i.boxes.get(v);
  if(matches?.size===1)return {g:i.groups.get([...matches][0]),box:v};
  const ex=[...i.groups.values()].filter(g=>g.external&&g.external===v);
  if(ex.length===1)return {g:ex[0]};
  const found=cartonSearch(i,v);
  if(found.length===1)return {g:found[0]};
  return {};
 }
 function renderSearch(){
  const value=$('cartonQuery').value,i=view()?.index,outbound=mode==='outbound';
  const note=$('cartonSearchNote'),list=$('cartonResults');list.replaceChildren();
  note.hidden=!outbound;
  list.hidden=outbound;
  if(!outbound)$('outboundReceiptHost').hidden=true;
  if(outbound){
   const result=i?outboundCandidates(i,value):null;
   receiptPicker.update(i,value.trim(),result);
   note.textContent=!i?l('기준 파일을 연결하면 주문을 검색할 수 있어요.','Connect a workbook to search orders.'):
    !value.trim()?l('매장 파일을 열거나 주문·박스 라벨을 검색하세요.','Open a store folder or search for an order or carton label.'):
    result.groups.length?l('파일을 열어 출고 주문을 선택하세요.','Open the folder and choose an outbound order.'):l('일치하는 출고 주문이 없어요.','No matching outbound orders.');
   return;
  }
  if(!i||!value.trim())return;
  const matches=cartonSearch(i,value);
  for(const g of matches){
   const btn=make('button',null,{type:'button'}),count=[...g.boxes.keys()].filter(Boolean).length;
   btn.append(make('strong',g.external||g.id));
   btn.append(make('small',l(`${count}개 박스 · ${g.qty} EA`,`${count} cartons · ${g.qty} ea`)));
   btn.onclick=()=>select(g,g.boxes.has(codeKey(value))?codeKey(value):undefined);list.append(btn);
  }
 }
 function render(){
  localize();
  const outbound=mode==='outbound',scopes=$('cartonScopes'),panel=$('cartonInspection');
  const ready=!!group&&(outbound?stage==='inspection'&&box!==null:true);
  root.dataset.mode=mode;root.dataset.stage=stage;
  $('cartonFind').hidden=outbound&&stage!=='search';
  $('cartonQuery').disabled=outbound&&!view();
  if(!$('cartonFind').hidden)renderSearch();
  $('cartonOrder').hidden=!group;
  $('cartonOrderMeta').hidden=!outbound;
  scopes.replaceChildren();panel.hidden=!ready;
  $('cartonStart').hidden=!(outbound&&stage==='pick'&&box!==null);
  if(!group)return;
  $('cartonGroupTitle').textContent=group.external||group.id;
  const details=$('cartonOrderDetails');
  details.hidden=!outbound;
  if(outbound){
   const count=group.boxes.size;
   details.textContent=[group.external&&group.external!==group.id?group.id:'',l(`박스 ${count}개`,`${count} cartons`),[...group.stores].join(' / '),[...group.countries].join(' / ')].filter(Boolean).join(' · ');
  }
  const choices=[...(!outbound?[null]:[]),...[...group.boxes.keys()].filter(Boolean)];
  for(const choice of choices){
   const button=make('button',choice??l('Location 전체','Whole location'),{type:'button'});
   button.setAttribute('aria-pressed',String(choice===box));
   if(work()?.done.has(JSON.stringify([group.id,choice])))button.append(make('span',' ✓'));
   button.onclick=()=>{
    if(outbound&&stage==='pick'){
     box=choice;for(const [i,btn] of [...scopes.children].entries())btn.setAttribute('aria-pressed',String(choices[i]===box));
     return;
    }
    box=choice;page=0;warn('');$('cartonScan').value='';render();
    if(!$('cartonScan').disabled&&matchMedia('(pointer:fine)').matches)focusStage('cartonScan');
   };
   scopes.append(button);
  }
  if(!ready)return;
  const rows=rowList(),expected=rows.reduce((n,r)=>n+r.expected,0);
  const covered=rows.reduce((n,r)=>n+Math.min(r.expected,r.actual),0);
  const missing=expected-covered,excess=rows.reduce((n,r)=>n+(r.unregistered?0:Math.max(0,r.actual-r.expected)),0);
  const pending=rows.some(r=>r.unregistered||r.conflict);
  const percent=expected?Math.floor(((covered+excess)>expected?covered+excess:covered)/expected*100):0;
  const coveredText=covered.toLocaleString()+' / '+expected.toLocaleString()+' EA · '+percent+'%';
  const report=[missing?l(`${missing}개 남음`,`${missing} remaining`):'',excess?l(`${excess}개 초과`,`${excess} excess`):'',pending?l('확인 필요','Review needed'):''].filter(Boolean).join(' · ');
  $('cartonCoverageLabel').textContent=box===null?l('Location 전체 진행','Location progress'):l('박스 전체 진행','Carton progress');
  $('cartonCount').textContent=coveredText;
  $('cartonCoverageDetails').textContent=report||(expected?l('수량 일치','Quantity matched'):'');
  const meter=$('cartonMeter');meter.max=expected||1;meter.value=covered;meter.dataset.phase=excess?'excess':pending?'warning':missing?'progress':'complete';
  meter.setAttribute('aria-valuetext',[coveredText,report].filter(Boolean).join(' · '));
  $('cartonCurrent').textContent=box??l('Location 전체','Whole location');
  const last=currentEvents().findLast(e=>e.box===box);
  const item=scannedProductLabel(last?.name,last?.brand),badge=$('cartonLastBrand'),quantity=$('cartonLastQuantity');
  badge.hidden=!item.brand;badge.textContent=item.brand;
  quantity.hidden=!last?.name;quantity.textContent=last?.name?last.count+' / '+last.expected:'';
  $('cartonLast').textContent=last?(item.name||last.value):l('아직 스캔하지 않았어요.','No scans yet.');
  $('cartonLast').dataset.result=last?.result||'';
  const allowed=scopeAllowed();
  for(const id of ['cartonScan','cartonAdd'])$(id).disabled=!allowed||locked();
  $('cartonUndo').disabled=!allowed||locked()||!currentEvents().some(e=>e.box===box);
  $('cartonFinish').disabled=!allowed||locked()||!currentEvents().some(e=>e.box===box);
  $('cartonLabelTrigger').hidden=mode==='inventory';$('cartonReport').hidden=mode==='inventory';
  if(!allowed)warn(l('중복 집계를 막기 위해 먼저 시작한 실사 방식에서만 입력할 수 있어요. 그 스캔을 모두 취소하면 방식을 바꿀 수 있어요.','To prevent double counting, use the counting method already started. Undo its scans to switch methods.'));
  else if(locked())warn(l('검수를 완료했어요.','Inspection complete.'));
  const body=$('cartonRows');body.replaceChildren();
  const recent=currentEvents().filter(e=>e.box===box||(mode==='inventory'&&box===null)).slice(-8).reverse();
  $('cartonHistory').replaceChildren(...(recent.length?recent.map(e=>{
   const item=make('li',null);item.dataset.result=e.result;
   const meaning={accepted:l('스캔 정상','Accepted scan'),excess:l('수량 초과','Excess scan'),unexpected:l('예정 외','Unexpected item')}[e.result];
   const mark=make('span',({accepted:'✓',excess:'!',unexpected:'?'})[e.result]);mark.setAttribute('aria-label',meaning);mark.title=meaning;
   const product=make('span',null);product.innerHTML=productIdentityMarkup(e.name,e.brand,{fallback:e.value});
   if(e.box&&box===null)product.append(document.createTextNode(' · '+e.box));
   item.append(make('time',new Date(e.at).toLocaleTimeString()),mark,product);
   return item;
  }):[make('li',l('아직 스캔하지 않았어요.','No scans yet.'))]));
  page=Math.min(page,Math.max(0,Math.ceil(rows.length/60)-1));
  $('cartonPage').textContent=(page+1)+' / '+Math.max(1,Math.ceil(rows.length/60));
  $('cartonPrev').disabled=page===0;$('cartonNext').disabled=(page+1)*60>=rows.length;
  for(const r of rows.slice(page*60,page*60+60)){
   const tr=make('tr'), state=r.unregistered?'warning':r.conflict?'warning':r.actual>r.expected?'excess':r.actual===r.expected?'ok':'progress';
   const product=make('td',null);product.innerHTML=productIdentityMarkup(r.name,r.conflict?null:r.brand,{fallback:l('예정 외','Unexpected')});tr.append(product);
   for(const v of [[r.sku,r.barcode].filter(Boolean).join(' / '),r.expected,r.actual,state==='ok'?'✓':state==='excess'?'!':state==='warning'?'?':'◔'])tr.append(make('td',String(v)));
   tr.dataset.state=state;body.append(tr);
  }
 }
 function add(value){
  if(!inspectionActive()||$('cartonScan').disabled||!codeKey(value)||codeKey(value).length>200)return;
  let job=work();
  if(!job){job={method:box===null?'whole':'box',events:[],done:new Set()};view().work.set(group.id,job);}
  const res=matchCartonScan(group,box,value);
  if(res.status==='conflict'){warn(l('여러 품목과 일치합니다. 상품 바코드를 확인하세요.','Code matches multiple products. Check the product barcode.'));return;}
  if(res.status==='empty')return;
  if(!job.events.length)job.method=box===null?'whole':'box';
  const scanned=job.events.reduce((n,x)=>n+(x.box===box&&x.key===res.key?1:0),0);
  const isExcess=res.key!==null&&scanned>=res.expected;
  job.events.push({box,key:res.key,value:res.value,result:res.key===null?'unexpected':isExcess?'excess':'accepted',at:Date.now(),name:res.name,brand:res.brand,count:scanned+1,expected:res.expected});
  $('cartonScan').value='';render();
  warn(res.key===null?l('이 범위에 예정되지 않은 상품이에요.','Not expected in this scope.'):isExcess?l('예정 수량 초과','Over expected quantity'):'');
 }
 $('cartonSearchForm').onsubmit=e=>{
  e.preventDefault();
  const query=$('cartonQuery').value,index=view()?.index;
  if(mode==='outbound'){
   if(!index)return;
   const result=outboundCandidates(index,query);
   const id=codeKey(query);
   if(result.exact&&(result.carton||result.exact.id===id||result.exact.external===id))select(result.exact,result.carton);
   else if(result.groups.length||!query.trim()) receiptPicker.focus();
   else renderSearch();
   return;
  }
  const result=currentSelection(query);if(result.g)select(result.g,result.box);else renderSearch();
 };
 $('cartonBack').onclick=back;
 $('cartonStart').onclick=()=>{if(mode==='outbound'&&stage==='pick'&&group&&box!==null)showStage('inspection');};
 $('cartonDispatch').onclick=()=>{if(mode==='outbound'&&group)openDispatch(dispatchContext());};
 function moveChoice(e,list){
  const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[e.key];
  if(!step||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return false;
  const buttons=[...list.querySelectorAll('button')];if(!buttons.length)return false;
  const at=buttons.indexOf(e.target),i=at<0?(step>0?0:buttons.length-1):(at+step+buttons.length)%buttons.length;
  e.preventDefault();buttons[i].focus();if(list.id==='cartonScopes'&&stage==='pick')buttons[i].click();
  return true;
 }
 $('cartonQuery').onkeydown=e=>{if(mode==='outbound'&&!e.isComposing&&e.key==='ArrowDown'){e.preventDefault();receiptPicker.focus();}};
 $('cartonScopes').onkeydown=e=>{
  if(mode!=='outbound'||stage!=='pick'||e.isComposing)return;
  if(e.key==='Enter'&&!e.repeat&&e.target.closest('button')){e.preventDefault();e.target.click();$('cartonStart').click();return;}
  moveChoice(e,e.currentTarget);
 };
 $('cartonQuery').oninput=renderSearch;
 $('cartonScanForm').onsubmit=e=>{e.preventDefault();add($('cartonScan').value);};
 $('cartonFileButton').onclick=()=>$('cartonFile').click();
 $('cartonFile').onchange=e=>{const file=e.currentTarget.files[0];e.currentTarget.value='';load(file);};
 $('cartonUndo').onclick=()=>{const job=work(),i=job?.events.findLastIndex(e=>e.box===box);if(i>=0){job.events.splice(i,1);warn('');render();}};
 $('cartonFinish').onclick=()=>{
  const rows=rowList(),hasDifference=rows.some(r=>r.conflict||r.expected!==r.actual);
  if(hasDifference&&!window.confirm(l('차이가 남아 있습니다. 이 범위의 검수를 완료할까요?','Differences remain. Finish inspection for this scope?')))return;
  work()?.done.add(scopeKey());render();
 };
 $('cartonPrev').onclick=()=>{page--;render();};$('cartonNext').onclick=()=>{page++;render();};
 $('cartonReport').onclick=()=>{if(mode==='outbound'&&inspectionActive())openReport(inspectionContext());};
 $('cartonLabelTrigger').onclick=e=>openLabels(e.currentTarget);
 window.addEventListener('beforeunload',e=>{if([...sources.values()].some(s=>[...s.work.values()].some(w=>w.events.length))){e.preventDefault();e.returnValue='';}});
 return {
  input:{
   root,visible:()=>!root.hidden,
   canScan:()=>inspectionActive()&&!$('cartonScan').disabled,
   back:()=>{if(loading)return false;back();return true;},
   scan:add,
  },
  open(newMode){mode=newMode;group=null;box=null;page=0;stage='search';warn('');$('cartonQuery').value='';if(newMode==='outbound')receiptPicker.update(view()?.index,'',null,{reset:true});root.hidden=false;root.inert=false;render();root.focus({preventScroll:true});},
  hide(){root.hidden=true;root.inert=true;},
  refresh(){if(!root.hidden)render();},
  printContext(){return !root.hidden&&mode==='outbound'&&group?(inspectionActive()?{report:inspectionContext()}:{dispatch:dispatchContext()}):null;},
  labelContext(){return !root.hidden&&mode==='outbound'&&stage==='inspection'&&group&&box!==null?{key:scopeKey(),external:group.external,carton:box,rows:rowList()}:null;}
 };
}
