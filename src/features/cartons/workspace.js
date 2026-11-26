import { attachProgressMarkers, coverageReadout } from '../../components/inspection-progress/view.js';
import { inspectionCoverage } from '../../domain/reconcile.js';
import { createCartonWork } from './model.js';
import { createOutboundReceipts } from './outbound-receipts.js';
import { productIdentityMarkup } from '../../components/product-identity/view.js';
import { scannedProductLabel } from '../../domain/product-identity.js';
import { cartonAdapter, cartonQuantityAliases, cartonSearch, codeKey, createCartonIndex, fields, aliases, cartonVerificationPlan, outboundCandidates, outboundDispatch, outboundSearchScope } from '../../domain/carton-verification.js';

export function attachCartonWorkspace({clearScanner,readWorkbook,engine,isEnglish,openLabels,openReport,openDispatch,dispatchProfile,cartonProfile,saveCartonMapping,showHome,notice,renderActivity,quantityLabel,audio,locationFor,syncLocation,progressIcon}){
 const $=id=>document.getElementById(id), root=$('cartonWorkspace'), l=(ko,en)=>isEnglish()?en:ko;
 const work=createCartonWork(),combinedStatus=new Map();
 const markers=attachProgressMarkers(document,isEnglish,progressIcon,{track:'cartonProgressTrack',markers:'cartonProgressMarkers',note:'cartonProgressNote'});
 function writeCoverage(ids,p,options){
  const [quantity,percent,meter,details]=ids.map($),value=coverageReadout(p,isEnglish(),options);
  quantity.textContent=value.quantity;percent.textContent=value.percent;
  meter.max=100;meter.value=value.fill;meter.dataset.phase=p.phase;
  details.textContent=value.details;
  meter.setAttribute('aria-valuetext',[value.quantity,value.percent,value.details].filter(Boolean).join(' · '));
 }
 function drawOutboundProgress(boxCoverage,rows){
  const {covered,excess,unverified}=work.outboundOrderProgress(group);
  const expected=group.qty,remaining=Math.max(0,expected-covered),actual=covered+excess;
  const order={expected,covered,excess,remaining,phase:unverified?'warning':'progress',
   percent:expected?(actual>expected?Math.max(101,Math.floor(actual/expected*100)):Math.floor(covered/expected*100)):null};
  writeCoverage(['outboundOrderQuantity','outboundOrderPercent','outboundOrderMeter','outboundOrderDetails'],order,{unverified});
  const unknown=rows.reduce((total,r)=>total+(r.unregistered||r.conflict?r.actual:0),0);
  writeCoverage(['cartonCount','cartonPercent','cartonMeter','cartonCoverageDetails'],boxCoverage,{unverified:unknown,locked:locked()});
  markers.update(scopeKey(),{events:work.outboundOverages(group,box),expected:boxCoverage.expected});
 }
 let combinedFile=null;
 const receiptPicker=createOutboundReceipts($('outboundReceiptHost'),{l,onChoose:select,onDispatch:g=>openDispatch(dispatchContext(g)),isComplete:(g,key)=>work.locked('outbound',g,key)});
 let mode=null,group=null,box=null,loading=false,page=0,stage='search',outboundLocationOn=true,outboundKind='single';
 const locationMode=()=>!root.hidden&&mode==='outbound'?outboundLocationOn:null;
 const view=()=>work.reference(mode);
 const searchIndex=()=>mode==='outbound'?outboundSearchScope(view()?.index,outboundKind):view()?.index;
 const rowList=()=>group?work.rows(mode,group,box):[];
 const inspectionActive=()=>!root.hidden&&!!group&&(mode==='inventory'||(stage==='inspection'&&box!==null));
 const inspectionContext=()=>({mode:'outbound',orderId:group.id,externalId:group.external,work:'Carton: '+box,party:[...group.stores].join(' / '),partyLabel:'Destination Store',rows:rowList().map(r=>({...r,status:r.conflict?'conflict':r.unregistered?'unexpected':r.actual>r.expected?'excess':r.actual===r.expected?'matched':'short'}))});
 const dispatchContext=(g=group)=>({...outboundDispatch(g),fields:dispatchProfile().fields});
 const scopeKey=()=>JSON.stringify([group?.id,box]);
 const locked=()=>work.locked(mode,group,box);
 const scopeAllowed=()=>work.canScan(mode,group,box);
 const warn=value=>{$('cartonFeedback').textContent=value;};
 function localize(){
  const inventory=mode==='inventory';
  $('cartonTitle').textContent=inventory?l('Location 실사','Location verification'):l('출고','Outbound');
  $('cartonTitle').classList.toggle('beam-sr',!inventory);
  const modes=$('outboundSearchModes');
  modes.hidden=inventory||stage!=='search';
  for(const b of modes.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.outboundKind===outboundKind));
  $('cartonQuery').placeholder=!inventory&&outboundKind==='das'?l('DAS 식별자 · 주문 식별자 · 박스 라벨','DAS ID, order ID or carton label'):inventory?l('Location 또는 박스 라벨 검색','Search by location or carton label'):l('주문 식별자 · 박스 라벨 · 매장명','Order ID, carton label or store');
  $('cartonQuery').setAttribute('aria-label',$('cartonQuery').placeholder);
  $('cartonComparisonTitle').textContent=inventory?l('실사 대조결과','Stock count comparison'):l('현재 박스 대조결과','Carton comparison');
  $('cartonBack').querySelector('span').textContent=stage==='inspection'?l('박스 선택','Choose carton'):l('검색으로','Back to search');
  $('cartonScan').placeholder=l('바코드 또는 SKU','Barcode or SKU');
  const status=combinedStatus.get(mode);
  const messages={
   missing:l('연결한 RAW에 이 작업의 시트가 없어요.','The connected workbook has no sheet for this workflow.'),
   mapping:l('통합 RAW는 연결됐어요. 이 작업의 시트와 열을 지정해 주세요.','The workbook is connected. Select the sheet and columns for this workflow.'),
   invalid:l('이 작업의 시트에서 읽을 수 없는 값이 있어요.','This workflow’s sheet contains values that could not be read.'),
   preserved:l('기존 검수 기록을 유지했어요. 새 RAW로 바꾸려면 시트를 다시 연결하세요.','Existing inspection work was kept. Link the sheet to switch to the new workbook.'),
   empty:l('이 작업의 시트에 검수할 수량이 없어요.','This workflow’s sheet has no quantities to verify.'),
  };
  const source=view()?.name,reason=messages[status];
  const previous=source&&reason?l('이전 기준 파일 사용 중: ','Using previous reference: ')+source:'';
  $('cartonSource').textContent=[reason,previous].filter(Boolean).join(' · ')||source||(inventory?l('기준 파일을 연결하면 검색할 수 있어요.','Connect a workbook to search.'):l('PDA 피킹 결과를 연결하면 출고 박스를 확인할 수 있어요.','Connect a picking results export to see outbound cartons.'));
  $('cartonMapButton').hidden=stage!=='search'||!combinedFile||!status||status==='ready';
  $('cartonMapButton').disabled=loading;
  $('cartonFileButton').hidden=stage!=='search';
  $('cartonFileButton').textContent=inventory?l('기준 파일 연결','Connect workbook'):l('피킹 결과 연결','Connect picking results');
  $('cartonFileButton').disabled=loading;
  $('cartonSearchButton').disabled=!view();

 }
 function make(tag,value,attrs={}){
  const el=document.createElement(tag);Object.assign(el,attrs);if(value!==null)el.textContent=value;return el;
 }
 function chooseSheet(title,build){
  return new Promise((resolve,reject)=>{
   const dialog=$('cartonImportDialog'),body=$('cartonImportFields'),err=$('cartonImportError');
   $('cartonImportTitle').textContent=title;body.replaceChildren();err.textContent='';
   const read=build(body);let selected;
   // Wait for this dialog's close event before the next mapping step can reopen it.
   dialog.onclose=()=>{
    dialog.onclose=null;body.replaceChildren();
    if(selected)resolve(selected);else reject(new DOMException('Cancelled','AbortError'));
   };
   $('cartonImportApply').onclick=()=>{try{selected=read();dialog.close();}catch(e){err.textContent=e.message;}};
   $('cartonImportCancel').onclick=()=>dialog.close();
   dialog.showModal();
  });
 }
 const captions=()=>({
  receipt:mode==='inventory'?l('Location','Location'):l('주문 ID','Order ID'),
  id:l('박스 라벨번호','Carton label ID'),external:l('외부 주문 ID','External order ID'),
  store:l('도착 매장 (선택)','Destination store (optional)'),country:l('도착 국가 (선택)','Destination country (optional)'),
  verificationUnit:l('검수 단위 (선택)','Verification unit (optional)'),unitsPerCase:l('박스 입수 (선택)','Units per case (optional)'),
  caseBarcode:l('제품 박스 바코드 (선택)','Product case barcode (optional)'),
  das:l('DAS 주문 식별자 (선택)','DAS order ID (optional)'),
  qty:mode==='inventory'?l('예정 수량','Expected quantity'):l('피킹 수량','Picked quantity'),name:l('제품명','Product name'),brand:l('브랜드 (선택)','Brand (optional)'),sku:'SKU',barcode:l('상품 바코드','Product barcode')
 });
 async function load(file){
  if(loading||!file)return;
  if(work.hasJobs(mode)&&!window.confirm(l('이 업무의 기존 검수 기록이 바뀝니다. 새 자료를 연결할까요?','Loading a new reference replaces this mode’s inspection history. Continue?')))return;
  loading=true;const target=mode,prefs=cartonProfile(),rememberedMapping=prefs.mappings[target];let separator='',savedMapping=null;localize();
  try{
   const adapter=cartonAdapter(target);
   const {cartonLines}=await readWorkbook(file,'cartonLines',p=>{
    if(p.phase==='sheet')$('cartonSource').textContent=l('읽는 중 · ','Reading · ')+p.rowsProcessed.toLocaleString();
   },{
    cartonAdapter:{validateColumns:adapter.validateColumns,table:(...args)=>cartonAdapter(target,separator).table(...args)},
    selectSheets:({sheets})=>chooseSheet(target==='outbound'?l('피킹 결과 시트 연결','Connect picking results sheet'):l('검수 대상 시트 연결','Connect inspection sheet'),body=>{
     const sel=make('select',null);
     sel.replaceChildren(...sheets.map(x=>new Option(x.name,String(x.index))));
     const words=target==='outbound'?/picking.*(result|export)|picked.*carton|피킹.*(결과|실적|내역)|shipment.*carton|outbound.*carton|출고.*박스/i:/inventory.*carton|location.*carton|재고.*박스/i;
     const match=sheets.find(x=>x.name===rememberedMapping?.sheet)||sheets.find(x=>words.test(x.name));if(match)sel.value=String(match.index);
     const label=make('label',l('시트','Sheet'));label.append(sel);body.append(label);
     return ()=>[{kind:'cartonLines',sheetIndex:Number(sel.value)}];
    }),
    selectColumns:({rows,rowNumbers,sheetName})=>chooseSheet(sheetName,body=>{
     const map=make('div',null,{className:'mapping-fields'}),header=make('select',null),readHeader=()=>Number(header.value);
     const headLabel=make('label',l('제목 행','Header row'));headLabel.append(header);body.append(headLabel,map);
     const clean=v=>codeKey(v).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
     rows.forEach((r,i)=>header.append(new Option(l('행 ','Row ')+rowNumbers[i]+' · '+r.filter(Boolean).slice(0,3).join(' / '),String(i))));
     const saved=rememberedMapping?.sheet===sheetName?rememberedMapping:null;
     const remembered=saved?.headers??null;
     const byHeader=(head,name)=>head.flatMap((c,i)=>codeKey(c)===name?[i]:[]);
     const previous=remembered?rows.findIndex(r=>Object.values(remembered).every(name=>byHeader(r,name).length===1)):-1;
     const detected=previous>=0?previous:rows.findIndex(r=>r.some(c=>aliases.receipt.includes(clean(c)))&&r.some(c=>cartonQuantityAliases(target,r).includes(clean(c))));if(detected>=0)header.value=String(detected);
     const controls=new Map();
     const sep=make('input',null,{type:'text',maxLength:6,placeholder:' /  |  #'}),sepLabel=make('label',l('Location과 박스 사이 구분자 (박스 열이 없을 때)','Separator between location and carton (without a carton column)'));sepLabel.append(sep);sep.value=saved?.separator||'';
     function draw(){
      map.replaceChildren();controls.clear();
      const head=rows[readHeader()],quantityAliases=cartonQuantityAliases(target,head);
      for(const field of fields){
       if(target==='inventory'&&['external','store','country','das','verificationUnit','unitsPerCase','caseBarcode'].includes(field))continue;
       const label=make('label',captions()[field]),select=make('select',null);
       select.append(new Option(l('연결 안 함','Not mapped'),''));
       head.forEach((c,i)=>{if(codeKey(c))select.append(new Option(codeKey(c),String(i)));});
       const matches=remembered&&Object.hasOwn(remembered,field)?byHeader(head,remembered[field]):
        previous>=0&&!['brand','das','verificationUnit','unitsPerCase','caseBarcode'].includes(field)?[]:
        head.flatMap((c,i)=>(field==='qty'?quantityAliases:aliases[field]).includes(clean(c))?[i]:[]);
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
      {
       const head=rows[readHeader()],headers=Object.fromEntries(Object.entries(columns).filter(([,i])=>byHeader(head,codeKey(head[i])).length===1).map(([key,i])=>[key,codeKey(head[i])]));
       // Missing optional fields also stay unmapped instead of auto-mapping again.
       savedMapping={sheet:sheetName,headers,...(separator?{separator}:{})};
      }
      return {headerRow:readHeader(),columns};
     };
    })
   },{Engine:engine,language:isEnglish()?'en':'ko'});
   const index=createCartonIndex(cartonLines);
   if(!index.groups.size)throw Error(l('검수할 예정 수량이 없습니다.','There are no positive expected quantities.'));
   work.connect(target,file.name,index);combinedStatus.set(target,'ready');if(mode===target){group=null;box=null;stage='search';$('cartonQuery').value='';render();}
   if(savedMapping)saveCartonMapping(prefs.id,target,savedMapping);
   notice(l('검수 기준 연결 완료','Inspection reference connected'));
  }catch(e){if(e.name!=='AbortError')notice(e.message,'error');}
  finally{loading=false;localize();}
 }
 function focusStage(id){
  $(id)?.focus({preventScroll:true});
 }
 function showStage(next){
  stage=next;page=0;warn('');clearScanner();$('cartonScan').value='';render();window.scrollTo(0,0);
  if(next==='search'){focusStage(matchMedia('(pointer:fine)').matches?'cartonQuery':'cartonTitle');return;}
  focusStage(matchMedia('(pointer:fine)').matches&&!$('cartonScan').disabled?'cartonScan':'cartonGroupTitle');
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
   const panel=$('cartonInspection');panel.classList.remove('beam-entering');void panel.offsetWidth;panel.classList.add('beam-entering');
  }
 }
 function select(g,boxMatch){
  if(mode==='outbound'&&(!boxMatch||!g.boxes.has(boxMatch)))return;
  group=g;box=boxMatch??null;
  showStage('inspection');
 }
 function back(){
  if(stage==='inspection'){
   const previousGroup=group,previousBox=box;
   group=null;box=null;stage='search';page=0;clearScanner();warn('');$('cartonScan').value='';render();
   if(mode==='outbound')receiptPicker.openCartons(previousGroup,{focus:false});
   receiptPicker.resume(previousBox);
   return;
  }
  if(receiptPicker.back())return;
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
  const value=$('cartonQuery').value.trim(),i=searchIndex(),outbound=mode==='outbound',das=outbound&&outboundKind==='das';
  const note=$('cartonSearchNote');$('cartonResults').hidden=true;
  const result=i?outboundCandidates(i,value):null;
  note.hidden=!i||!!result?.groups.length||(das&&!value?i.groups.size>0:!value);
  receiptPicker.update(i,value,result,{mode,das});
  if(outbound){
   note.textContent=das&&i?(i.groups.size?l('일치하는 DAS 주문이 없어요.','No matching DAS orders.'):l('연결한 자료에 DAS가 할당된 주문이 없어요.','No orders in the connected data are assigned to DAS.')):!i?l('기준 파일을 연결하면 주문을 검색할 수 있어요.','Connect a workbook to search orders.'):
    !value?l('매장 파일을 열거나 주문·박스 라벨을 검색하세요.','Open a store folder or search for an order or carton label.'):
    result.groups.length?l('파일을 열어 출고 주문을 선택하세요.','Open the folder and choose an outbound order.'):l('일치하는 출고 주문이 없어요.','No matching outbound orders.');
  }else{
   note.textContent=!i?l('기준 파일을 연결하면 Location을 검색할 수 있어요.','Connect a workbook to search locations.'):
    !value?l('Location 파일을 열거나 Location·박스 라벨을 검색하세요.','Open a location folder or search by location or carton label.'):
    result.groups.length?l('Location 전체 또는 박스 단위로 실사할 수 있어요.','Verify a whole location or an individual carton.'):l('일치하는 Location이 없어요.','No matching locations.');
  }
 }
 function render(){
  localize();
  syncLocation();
  const outbound=mode==='outbound',scopes=$('cartonScopes'),panel=$('cartonInspection');
  const ready=!!group&&(outbound?stage==='inspection'&&box!==null:true);
  root.dataset.mode=mode;root.dataset.stage=stage;root.dataset.referenced=String(!!view());
  $('cartonFind').hidden=stage!=='search';
  $('cartonQuery').disabled=!view();
  if(!$('cartonFind').hidden)renderSearch();
  $('cartonSheet').hidden=!group;
  $('cartonOrder').hidden=!group;
  $('cartonOrderMeta').hidden=!outbound;
  scopes.replaceChildren();panel.hidden=!ready;
  if(!group)return;
  $('cartonGroupTitle').textContent=group.external||group.id;
  const details=$('cartonOrderDetails');
  details.hidden=!outbound;
  if(outbound){
   details.textContent=[group.das?'DAS · '+group.das:'',group.external&&group.external!==group.id?group.id:'',[...group.stores].join(' / '),[...group.countries].join(' / ')].filter(Boolean).join(' · ');
  }
  // Outbound is a single worker's chosen carton; other cartons remain in search.
  const choices=outbound?[]:[null,...[...group.boxes.keys()].filter(Boolean)];
  for(const choice of choices){
   const button=make('button',choice??l('Location 전체','Whole location'),{type:'button'});
   button.className='inspection-sheet-tab';
   button.title=button.textContent;
   button.replaceChildren(make('span',button.title,{className:'scope-key'}));
   button.setAttribute('aria-pressed',String(choice===box));
   if(work.locked(mode,group,choice))button.append(make('span',' ✓'));
   button.onclick=()=>{
    box=choice;page=0;warn('');$('cartonScan').value='';render();
    if(!$('cartonScan').disabled&&matchMedia('(pointer:fine)').matches)focusStage('cartonScan');
   };
   scopes.append(button);
  }
  $('outboundOrderCoverage').hidden=!outbound||!ready;
  $('cartonPercent').hidden=!outbound;
  $('cartonMeter').classList.toggle('beam-coverage-meter',outbound);
  $('cartonMeter').closest('.carton-coverage').classList.toggle('beam-coverage',outbound);
  if(!ready||!outbound)markers.update(null,{events:[],expected:0});
  if(!ready)return;
  const rows=rowList(),p=inspectionCoverage(rows);
  const pct=p.percent===null?'—':p.percent+'%';
  const coveredText=p.covered.toLocaleString()+' / '+p.expected.toLocaleString()+' EA · '+pct;
  const report=[
   p.remaining?l(p.remaining.toLocaleString()+'개 남음',p.remaining.toLocaleString()+' remaining'):'',
   p.excess?l(p.excess.toLocaleString()+'개 초과',p.excess.toLocaleString()+' excess'):'',
   p.needsReview?l('확인 필요','Review needed'):'',
   p.complete?l(locked()?'검수 완료':'수량 일치 · 완료 대기',locked()?'Complete':'Ready to confirm'):'',
  ].filter(Boolean).join(' · ');
  $('cartonCoverageLabel').textContent=box===null?l('Location 전체 진행','Location progress'):l('박스 전체 진행','Carton progress');
  if(outbound)drawOutboundProgress(p,rows);
  else{
   $('cartonCount').textContent=coveredText;
   $('cartonCoverageDetails').textContent=report;
   const meter=$('cartonMeter');meter.max=p.expected||1;meter.value=p.covered;meter.dataset.phase=p.phase;
   meter.setAttribute('aria-valuetext',[coveredText,report].filter(Boolean).join(' · '));
  }
  $('cartonCurrent').textContent=box??l('Location 전체','Whole location');
  const verificationPlan=$('cartonVerificationPlan'),plan=outbound?cartonVerificationPlan(group,box):null;
  verificationPlan.hidden=!plan||!(plan.eachUnits||plan.caseCount);
  if(!verificationPlan.hidden)verificationPlan.textContent=l('자료상 검수 단위','Planned verification unit')+' · '+[
   plan.eachUnits?l('낱개 '+plan.eachUnits+' EA','Each '+plan.eachUnits+' EA'):'',
   plan.caseCount?l('제품 박스 '+plan.caseCount+'개 ('+plan.caseUnits+' EA)',plan.caseCount+' product cases ('+plan.caseUnits+' EA)'):'',
   plan.unspecifiedUnits?l('미지정 '+plan.unspecifiedUnits+' EA','Unspecified '+plan.unspecifiedUnits+' EA'):'',
  ].filter(Boolean).join(' · ');

  const last=work.latest(mode,group,box),readout=$('cartonLastItem');
  const item=scannedProductLabel(last?.name,last?.brand),badge=$('cartonLastBrand');
  readout.hidden=!last;readout.dataset.result=last?.result||'';
  badge.hidden=!item.brand;badge.textContent=item.brand;
  $('cartonLast').textContent=last?(item.name||last.value):'';
  $('cartonLastCode').textContent=last?[last.barcode,last.sku].filter(Boolean).join(' · '):'';
  const location=$('cartonLastLocation');
  location.hidden=!last||locationMode()!==true;
  if(!location.hidden){
   const locations=locationFor(last);
   $('cartonLastLocationValue').textContent=locations.join(' · ')||l('확인된 피킹 위치 없음','No verified picking location');
  }
  const progress=$('cartonLastProgress'),bar=$('cartonLastMeter'),valid=!!last?.expected;
  progress.hidden=!valid;
  if(valid){
   const label=quantityLabel(last.count,last.expected,isEnglish());
   progress.dataset.phase=last.count===last.expected?'complete':last.count>last.expected?'excess':'progress';
   $('cartonLastQuantity').textContent=label.quantity;
   $('cartonLastPercent').textContent=Math.floor(last.count/last.expected*100)+'%';
   $('cartonLastDetail').textContent=label.detail;
   bar.value=Math.min(100,last.count/last.expected*100);
   bar.setAttribute('aria-valuetext',label.quantity+' · '+label.detail);
  }
  const allowed=scopeAllowed();
  for(const id of ['cartonScan','cartonAdd'])$(id).disabled=!allowed||locked();
  $('cartonUndo').disabled=!allowed||locked()||!last;
  $('cartonFinish').disabled=!allowed||locked()||!last;
  $('cartonLabelTrigger').hidden=mode==='inventory';$('cartonReport').hidden=mode==='inventory';
  if(!allowed)warn(l('중복 집계를 막기 위해 먼저 시작한 실사 방식에서만 입력할 수 있어요. 그 스캔을 모두 취소하면 방식을 바꿀 수 있어요.','To prevent double counting, use the counting method already started. Undo its scans to switch methods.'));
  else if(locked())warn(l('검수를 완료했어요.','Inspection complete.'));
  const body=$('cartonRows');body.replaceChildren();
  const recent=work.recent(mode,group,box).slice(0,5).reverse().map(e=>({
   ...e,scope:'carton',qty:1,at:new Date(e.at).toISOString(),code:e.value,
   name:e.name||l('미확인 바코드','Unverified barcode'),
   barcode:e.barcode||(!e.sku?e.value:''),scanOutcome:e.result==='unexpected'?'unknown':e.result,
   status:e.result==='unexpected'?'예정 외':e.result==='excess'?'초과':'정상',
  }));
  $('cartonHistory').innerHTML=renderActivity(recent);
  page=Math.min(page,Math.max(0,Math.ceil(rows.length/60)-1));
  $('cartonPage').textContent=(page+1)+' / '+Math.max(1,Math.ceil(rows.length/60));
  $('cartonPrev').disabled=page===0;$('cartonNext').disabled=(page+1)*60>=rows.length;
  for(const r of rows.slice(page*60,page*60+60)){
   const tr=make('tr'), state=r.unregistered||r.conflict?'warning':r.actual>r.expected?'excess':r.actual===r.expected?'ok':'progress';
   const status=make('td',l(...({ok:['일치','Match'],excess:['초과','Excess'],warning:r.conflict?['정보 충돌','Conflict']:['미확인','Unknown'],progress:['부족','Short']}[state])));
   status.className='carton-row-status';
   const identifiers=make('td',null,{className:'sheet-code activity-code-pair'});
   for(const [code,cls] of [[r.barcode,'primary-code'],[r.sku,'secondary-code']])if(code)identifiers.append(make('span',code,{className:cls}));
   const product=make('td',null);product.innerHTML=productIdentityMarkup(r.name,r.conflict?null:r.brand,{fallback:l('미확인 바코드','Unverified barcode')});
   if(locationMode()===true){
    const locations=locationFor(r.unregistered?{...r,value:r.barcode}:r);
    if(locations.length)product.append(make('div','Location · '+locations.join(' · '),{className:'carton-row-location'}));
   }
   const delta=r.actual-r.expected;
   tr.append(identifiers,product,...[r.expected,r.actual,delta>0?'+'+delta:delta].map(v=>make('td',String(v),{className:'sheet-qty'})),status);
   tr.dataset.state=state;body.append(tr);
  }
 }
 function add(value){
  if(!inspectionActive()||$('cartonScan').disabled)return;
  const result=work.scan(mode,group,box,value);
  if(result==='conflict'){audio('conflict');warn(l('여러 품목과 일치합니다. 상품 바코드를 확인하세요.','Code matches multiple products. Check the product barcode.'));return;}
  if(!result)return;
  audio(result==='unexpected'?'unknown':result);
  $('cartonScan').value='';render();
  warn(result==='unexpected'?l('이 범위에 예정되지 않은 상품이에요.','Not expected in this scope.'):result==='excess'?l('예정 수량 초과','Over expected quantity'):'');
 }
 $('cartonSearchForm').onsubmit=e=>{
  e.preventDefault();
  const query=$('cartonQuery').value,index=searchIndex();
  if(mode==='outbound'){
   if(!index)return;
   const result=outboundCandidates(index,query);
   const id=codeKey(query);
   if(result.exact&&result.carton)select(result.exact,result.carton);
   else if(result.exact&&(result.exact.id===id||result.exact.external===id))receiptPicker.openCartons(result.exact);
   else if(result.groups.length||!query.trim()) receiptPicker.focus();
   else renderSearch();
   return;
  }
  const result=currentSelection(query);if(result.g)select(result.g,result.box);else {renderSearch();receiptPicker.focus();}
 };
 $('outboundSearchModes').onclick=e=>{
  const kind=e.target.closest('button[data-outbound-kind]')?.dataset.outboundKind;
  if(mode!=='outbound'||stage!=='search'||!kind||kind===outboundKind)return;
  outboundKind=kind;$('cartonQuery').value='';render();
 };
 $('cartonBack').onclick=back;
 $('cartonDispatch').onclick=()=>{if(mode==='outbound'&&group)openDispatch(dispatchContext());};
 $('cartonQuery').onkeydown=e=>{if(!e.isComposing&&e.keyCode!==229&&e.key==='ArrowDown'){e.preventDefault();receiptPicker.focus();}};
 $('cartonQuery').oninput=renderSearch;
 $('cartonScanForm').onsubmit=e=>{e.preventDefault();add($('cartonScan').value);};
 $('cartonFileButton').onclick=()=>$('cartonFile').click();
 $('cartonMapButton').onclick=()=>load(combinedFile);
 $('cartonFile').onchange=e=>{const file=e.currentTarget.files[0];e.currentTarget.value='';load(file);};
 $('cartonUndo').onclick=()=>{if(group&&work.undo(mode,group,box)){warn('');render();}};
 $('cartonFinish').onclick=()=>{
  const rows=rowList(),hasDifference=rows.some(r=>r.conflict||r.expected!==r.actual);
  if(hasDifference&&!window.confirm(l('차이가 남아 있습니다. 이 범위의 검수를 완료할까요?','Differences remain. Finish inspection for this scope?')))return;
  work.finish(mode,group,box);render();
 };
 $('cartonPrev').onclick=()=>{page--;render();};$('cartonNext').onclick=()=>{page++;render();};
 $('cartonReport').onclick=()=>{if(mode==='outbound'&&inspectionActive())openReport(inspectionContext());};
 $('cartonLabelTrigger').onclick=e=>openLabels(e.currentTarget);
 window.addEventListener('beforeunload',e=>{if(work.hasScans()){e.preventDefault();e.returnValue='';}});
 return {
  input:{
   root,visible:()=>!root.hidden,
   canScan:()=>inspectionActive()&&!$('cartonScan').disabled,
   back:()=>{if(markers.dismiss())return true;if(loading)return false;back();return true;},
   scan:add,
  },
  applyCombined({file,results}){
   combinedFile=file;
   const retained=[];
   for(const [kind,result] of Object.entries(results)){
    combinedStatus.set(kind,result.status);
    if(result.status!=='ready'){if(work.reference(kind))retained.push(kind);continue;}
    // A new combined workbook never implicitly discards this workflow's scans.
    if(work.hasJobs(kind)){combinedStatus.set(kind,'preserved');retained.push(kind);continue;}
    work.connect(kind,file.name,result.index);
    if(mode===kind){group=null;box=null;stage='search';$('cartonQuery').value='';}
   }
   if(!root.hidden)render();
   return retained;
  },
  open(newMode){mode=newMode;outboundKind='single';group=null;box=null;page=0;stage='search';warn('');$('cartonQuery').value='';receiptPicker.update(searchIndex(),'',null,{reset:true,mode:newMode});root.hidden=false;root.inert=false;render();
   if(mode==='outbound'&&matchMedia('(any-pointer: fine)').matches)focusStage('cartonQuery');
   else root.focus({preventScroll:true});
  },
  hide(){markers.dismiss();root.hidden=true;root.inert=true;syncLocation();},
  locationMode,
  toggleLocation(){if(locationMode()===null)return false;outboundLocationOn=!outboundLocationOn;render();return true;},
  refresh(){if(!root.hidden)render();},
  printContext(){return !root.hidden&&mode==='outbound'&&group?(inspectionActive()?{report:inspectionContext()}:{dispatch:dispatchContext()}):null;},
  labelContext(){return !root.hidden&&mode==='outbound'&&stage==='inspection'&&group&&box!==null?{key:scopeKey(),external:group.external,carton:box,rows:rowList()}:null;}
 };
}
