import { folderShellMarkup, placeFolderOnRibbon } from '../../components/folder-reel/view.js';
import { createOutboundCartons } from './outbound-cartons.js';
import { productIdentityMarkup } from '../../components/product-identity/view.js';
import { dasFolders, outboundFolders, wrapOutboundIndex } from '../../domain/carton-verification.js';
import { encodeReceiptCode128 } from '../../domain/code128.js';
import { productBarcodeSvg } from '../../components/print/barcode.js';

// Each Location folder has one aggregate slip and, where provided, individual
// carton slips. Leave item arrays and carton totals lazy until a slip is shown.
export function locationFolders(groups, carton = '') {
  return [...groups].map(group => {
    const cartonCount = group.boxes.size - Number(group.boxes.has(''));
    const narrow = carton && group.boxes.has(carton);
    let scopes, slips;
    return {
      key: JSON.stringify(['location', group.id]), label: group.id, cartonCount,
      orders: {
        length: narrow ? 1 : cartonCount + 1,
        at(index) {
          if (index < 0 || index >= this.length) return;
          slips ??= new Map();
          if (slips.has(index)) return slips.get(index);
          if (!narrow && index > 0) scopes ??= [...group.boxes.keys()].filter(Boolean);
          const scope = narrow ? carton : index ? scopes[index - 1] : null;
          const totals = scope === null ? group.totals : group.boxes.get(scope);
          let qty = scope === null ? group.qty : 0;
          if (scope !== null) for (const row of totals.values()) qty += row.expected;
          const slip = { id: group.id, scope, totals, qty, group };
          slips.set(index, slip);
          return slip;
        },
      },
    };
  });
}

export function createOutboundReceipts(host,{l,onChoose,onDispatch,isComplete}){
 const make=(tag,cls='',text='')=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text)x.textContent=text;return x;};
 const button=(text,action,cls='')=>{const b=make('button',cls,text);b.type='button';b.onclick=action;return b;};
 const stage=make('div','outbound-reel'),controls=make('div','outbound-reel-tools'),dialog=make('dialog','outbound-ticket-dialog');
 const title=make('h2','',l('출고 주문 영수증','Outbound order receipt'));title.id='outboundReceiptTitle';
 const scroll=make('div','outbound-ticket-scroll'),footer=make('div','outbound-reel-tools');scroll.tabIndex=0;
 dialog.setAttribute('aria-labelledby',title.id);
 const close=button('×',()=>dialog.close());close.setAttribute('aria-label',l('닫기','Close'));
 const head=make('div','outbound-dialog-heading');head.append(title,close);dialog.append(head,scroll,footer);
 const flyers=make('div','outbound-order-flyers'),flyerList=make('div','outbound-order-flyers-list');
 const flyerMore=button('',()=>{flyerLimit+=8;paintFlyers();},'outbound-flyers-more');
 flyerList.tabIndex=0;flyerList.setAttribute('role','region');
 flyers.append(flyerList,flyerMore);
 host.classList.add('outbound-receipt-picker');host.append(stage,controls,flyers,dialog);
 let flyerFolder=null,flyerLimit=8,flyerLanguage='',dialogLauncher=null;
 const flyerViews=new Map();

 let inventory=false,dasView=false,folders=[],folderIndex=0,phase='folder',carton='',resultKey=null,gesture=null,suppressClick=0,wheelAt=-Infinity,wheelDistance=0,wheelCard=-1;
 const folderNodes=new Map();
 const positions=new Map(),allFolders=new WeakMap(),receiptItems=new WeakMap();
 const at=(f)=>positions.get(f.key)||0;
 const current=()=>folders[folderIndex];
 const goFocus=()=>stage.querySelector('[data-center=true]')?.focus({preventScroll:true});
 const labelFor=f=>f.label||f.orders.at(0).external||f.orders.at(0).id;
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 function move(el,keyframes){
  if(!reduced())el?.animate?.(keyframes,{duration:450,easing:'cubic-bezier(.28,.08,.22,1)'});
 }
 function ticket(o,limit,{barcode=false,summary=false}={}){
  const card=make('span','beam-paper-ticket outbound-paper'),top=make('span','beam-paper-top'),ref=make('span','beam-paper-ref');
  const ext=make('b','',inventory?o.id:o.external||o.id);ext.title=ext.textContent;
  ref.append(make('span','',inventory?l('LOCATION 실사','LOCATION VERIFICATION'):l('출고 주문','OUTBOUND ORDER')),ext);
  const total=make('span','beam-paper-party');
  const scope=o.scope??l('Location 전체','Whole location');
  total.append(make('b','',inventory?scope:[...o.stores].join(' / ')||o.id),make('b','',o.qty.toLocaleString()+' EA'));
  const meta=inventory?(o.scope?l('박스 단위','Carton scope'):l('Location 단위','Location scope')):
   [o.das?'DAS · '+o.das:'',o.external&&o.external!==o.id?o.id:'',l(`박스 ${o.boxes.size}개`,`${o.boxes.size} cartons`),[...o.countries].join(' / ')].filter(Boolean).join(' · ');
  top.append(ref,total,make('span','outbound-paper-meta',meta));
  if(barcode&&!inventory){try{
   const plate=make('span','outbound-code128');plate.innerHTML=productBarcodeSvg(encodeReceiptCode128(o.id));plate.setAttribute('role','img');plate.setAttribute('aria-label','Code 128 · '+o.id);top.append(plate);
  }catch{/* Identifiers outside Code 128 still display as text. */}}
  const body=make('span','beam-paper-body');
  const line=(name,value,cls='')=>{const row=make('span','outbound-paper-line '+cls);row.append(make('span','',name),make('b','',String(value)));return row;};
  body.append(line(l('상품','Items'),l('수량','Qty'),'outbound-paper-columns'));
  let items=receiptItems.get(o);if(!items){items=[...o.totals.values()];receiptItems.set(o,items);}
  let end=Math.min(limit,items.length),i=0;
  function append(to){const frag=document.createDocumentFragment();for(;i<to;i++){const r=items[i],el=line('',r.expected);el.firstElementChild.innerHTML=productIdentityMarkup(r.name,r.conflict?null:r.brand,{fallback:r.sku||r.barcode||'—'});frag.append(el);}body.append(frag);}
  append(end);
  if(end<items.length&&(!barcode||summary))body.append(make('span','outbound-paper-meta',l(`+ ${items.length-end}종`,`+ ${items.length-end} items`)));
  card.append(top,make('span','beam-paper-tear'),body);
  return {card,more:()=>{end=Math.min(end+100,items.length);append(end);return end<items.length;},remaining:items.length-end};
 }
 function folderSummary(f){return inventory?l(`박스 ${f.cartonCount}개`,`${f.cartonCount} cartons`):l(`주문 ${f.orders.length}건`,`${f.orders.length} orders`);}
 function fillFolder(card,f,selected){
  const position=at(f),count=f.orders.length;
  if(!card.firstElementChild){
   card.innerHTML=folderShellMarkup(position,count);
   const caption=make('span','beam-file-caption');
   caption.append(make('strong','',labelFor(f)),make('span','',folderSummary(f)));
   card.append(caption);
  }
  const paper=card.querySelector('.beam-file-paper');
  const key=position+':'+selected+':'+l('ko','en');
  if(card.dataset.paperKey===key)return;
  card.dataset.paperKey=key;
  paper.replaceChildren(ticket(f.orders.at(position),selected?7:3).card);
  card.querySelector('.beam-file-position').textContent=(position+1)+' / '+count;
  card.querySelector('.beam-file-caption>span').textContent=folderSummary(f);
 }
 function stepFolder(step,focus){
  if(folders.length<2)return false;
  folderIndex=wrapOutboundIndex(folderIndex,step,folders.length);render(step,'folder');if(focus)goFocus();return true;
 }
 function revealFlyer(order,smooth=false){
  const card=flyerViews.get(order)?.root;
  if(!card)return;
  const left=card.getBoundingClientRect().left-flyerList.getBoundingClientRect().left+flyerList.scrollLeft;
  flyerList.scrollTo({left:Math.max(0,left-4),behavior:smooth&&!reduced()?'smooth':'instant'});
 }
 flyerList.addEventListener('keydown',event=>{
  if(event.target!==flyerList||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const step={ArrowLeft:-1,ArrowRight:1}[event.key];
  if(!step)return;
  event.preventDefault();stepOrder(step);
 });
 function stepOrder(step,focus){
  const f=current();if(!f||f.orders.length<2)return false;
  positions.set(f.key,wrapOutboundIndex(at(f),step,f.orders.length));
  render(step,phase==='folder'?'peek':'order');if(focus&&!dialog.open)goFocus();
  if(dialog.open)renderDialog(step);
  else if(!inventory)revealFlyer(f.orders.at(at(f)),true);
  return true;
 }
 function activate(){
  const f=current();if(!f)return false;
  if(!inventory){flyerViews.get(f.orders.at(at(f)))?.focus({first:true,scroll:true});return true;}
  if(phase==='folder'){phase='order';render(1,'open');goFocus();return true;}
  const o=f.orders.at(at(f));onChoose(o.group,o.scope);
  return true;
 }
 function openCartons(order,{focus=true}={}){
  const fi=folders.findIndex(f=>f.orders.includes(order));
  if(fi<0)return false;
  folderIndex=fi;positions.set(current().key,current().orders.indexOf(order));
  render();
  revealFlyer(order);
  if(focus)flyerViews.get(order)?.focus({first:true,scroll:true});
  return true;
 }
 function back(){
  if(phase!=='order')return false;
  phase='folder';render(-1,'open');goFocus();return true;
 }
 function visibleSlots(count,index){
  if(count<=1)return [0];if(count===2)return index===0?[0,1]:[-1,0];return [-1,0,1];
 }
 function navButton(text,label,action){const b=button(text,action,'outbound-nav-arrow');b.setAttribute('aria-label',label);return b;}
 function status(text){const x=make('span','outbound-reel-position',text);x.setAttribute('role','status');return x;}
 function openReceipt(order,launcher){
  const f=current(),i=f?.orders.indexOf(order)??-1;
  if(i<0)return;
  positions.set(f.key,i);dialogLauncher=launcher;
  renderDialog();dialog.showModal();close.focus();
 }
 function paintFlyers(){
  const f=current();
  flyers.hidden=inventory||!f;
  if(flyers.hidden){flyerFolder=null;flyerViews.clear();flyerList.replaceChildren();return;}
  flyerList.setAttribute('aria-label',dasView?l('DAS 주문 영수증','DAS order receipts'):l('매장 출고 주문 영수증','Store outbound order receipts'));
  const lang=l('ko','en'),active=at(f);
  if(f!==flyerFolder||lang!==flyerLanguage){
   flyerFolder=f;flyerLanguage=lang;flyerLimit=8;
   flyerViews.clear();flyerList.replaceChildren();flyerList.scrollLeft=0;
  }
  const visible=Math.min(f.orders.length,Math.max(flyerLimit,active+1));
  for(let i=flyerViews.size;i<visible;i++){
   const order=f.orders[i],view=createOutboundCartons({l,onChoose,onDispatch,isComplete,onExpand:openReceipt});
   view.update(order,ticket(order,3,{barcode:true,summary:true}).card);
   flyerViews.set(order,view);flyerList.append(view.root);
  }
  flyerMore.hidden=visible>=f.orders.length;
  flyerMore.textContent=l(`주문 더 보기 · ${visible} / ${f.orders.length}`,`More orders · ${visible} / ${f.orders.length}`);
 }
 function render(step=0,axis=''){
  const f=current(),lastFocus=[...controls.querySelectorAll('button')].indexOf(document.activeElement);
  if(!f||phase!=='folder'||stage.dataset.folders!=='true'){stage.replaceChildren();folderNodes.clear();}
  stage.dataset.folders=String(phase==='folder');controls.replaceChildren();host.dataset.phase=phase;host.dataset.inlineCartons=String(!inventory);host.hidden=!f;
  paintFlyers();
  if(!f)return;
  const inFolder=phase==='folder',n=inFolder?folders.length:f.orders.length,index=inFolder?folderIndex:at(f);
  const nextFolders=new Set(),arrivals=[];
  for(const slot of visibleSlots(n,index)){
   const i=wrapOutboundIndex(index,slot,n),entry=inFolder?folders[i]:f.orders.at(i);
   const existing=inFolder?folderNodes.get(entry):null;
   const b=existing||button('',null,'outbound-reel-card');
   b.onclick=()=>{
    if(performance.now()<suppressClick)return;
    if(!slot){activate();return;}
    if(inFolder)stepFolder(slot,true);else stepOrder(slot,true);
   };
   b.dataset.slot=String(slot);b.dataset.center=String(!slot);
   if(inFolder){
    b.dataset.folder='true';b.dataset.peek=String(!slot);b.dataset.folderIndex=String(i);
    fillFolder(b,entry,!slot);nextFolders.add(entry);folderNodes.set(entry,b);
    if(!existing&&step&&axis==='folder'&&!reduced()){
     placeFolderOnRibbon(b,slot+step);arrivals.push([b,slot]);
    }else placeFolderOnRibbon(b,slot);
   }
   else b.append(ticket(entry,slot?3:8).card);
   const aria=inFolder?labelFor(entry)+' · '+folderSummary(entry):inventory?[entry.id,entry.scope??l('Location 전체','Whole location')].join(' · '):[entry.external||entry.id,entry.id,l(`박스 ${entry.boxes.size}개`,`${entry.boxes.size} cartons`)].join(' · ');
   b.setAttribute('aria-label',aria);b.setAttribute('aria-current',String(!slot));b.tabIndex=slot?-1:0;
   if(!existing)stage.append(b);
  }
  for(const [entry,node] of folderNodes)if(!nextFolders.has(entry)){node.remove();folderNodes.delete(entry);}
  if(arrivals.length){void stage.offsetWidth;for(const [node,slot] of arrivals)placeFolderOnRibbon(node,slot);}
  if(inFolder&&folders.length>1||!inFolder&&f.orders.length>1){
   const stepper=inFolder?stepFolder:stepOrder;
   controls.append(navButton('‹',inFolder?l('이전 파일','Previous folder'):l('이전 영수증','Previous receipt'),()=>stepper(-1)),status((index+1)+' / '+n),navButton('›',inFolder?l('다음 파일','Next folder'):l('다음 영수증','Next receipt'),()=>stepper(1)));
  }
  if(inventory)controls.append(button(l('영수증 펼쳐보기','Expand receipt'),e=>{dialogLauncher=e.currentTarget;renderDialog();dialog.showModal();close.focus();}));
  if(!inFolder)controls.append(button(l('파일 묶음으로','Back to folders'),back));
  if(inventory)controls.append(button(inFolder?l('파일 열기','Open folder'):l('실사 시작','Start verification'),activate,'outbound-activate'));
  if(lastFocus>=0)controls.querySelectorAll('button')[lastFocus]?.focus({preventScroll:true});
  if(step){const active=stage.querySelector('[data-center=true]');
   if(axis==='peek')move(active?.querySelector('.beam-file-paper'),[{translate:'0 '+(step>0?32:-12)+'px',opacity:.45},{translate:'0 0',opacity:1}]);
   else if(inFolder&&axis==='folder'&&matchMedia('(max-width: 680px)').matches)
    move(active?.querySelector('.beam-file'),[{transform:`rotateY(${step*24}deg)`,opacity:.55},{transform:'none',opacity:1}]);
   else if(!inFolder)move(active,[{transform:`perspective(850px) translate3d(${axis==='open'?0:step*8}px,${axis==='open'?27:0}px,0) rotate${axis==='open'?'X':'Y'}(${step*14}deg)`,opacity:.46},{transform:'none',opacity:1}]);
  }
 }
 function renderDialog(step=0){
  const f=current();if(!f)return;
  const order=f.orders.at(at(f)),paper=ticket(order,100,{barcode:true});
  title.textContent=inventory?[order.id,order.scope??l('Location 전체','Whole location')].join(' · '):order.external||order.id;
  scroll.replaceChildren(paper.card);
  if(paper.remaining)scroll.append(button(l('상품 더 보기','Show more items'),e=>{if(!paper.more()){e.currentTarget.remove();scroll.focus({preventScroll:true});}}));
  scroll.scrollTop=0;
  // Keep the footer controls mounted on navigation so repeated clicks and focus remain usable.
  if(!footer.children.length){
   footer.append(navButton('‹',l('이전 영수증','Previous receipt'),()=>stepOrder(-1)),status(''),navButton('›',l('다음 영수증','Next receipt'),()=>stepOrder(1)));
  }
  footer.hidden=f.orders.length<2;footer.children[1].textContent=(at(f)+1)+' / '+f.orders.length;
  if(step)move(paper.card,[{translate:(step*30)+'px 0',opacity:.45},{translate:'0 0',opacity:1}]);
 }
 dialog.addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing)return;
  const step={ArrowLeft:-1,ArrowRight:1}[e.key];if(step&&stepOrder(step))e.preventDefault();
 });
 dialog.addEventListener('close',()=>{if(dialogLauncher?.isConnected)dialogLauncher.focus({preventScroll:true});else goFocus();dialogLauncher=null;});
 host.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing||e.keyCode===229||dialog.open||e.target.closest('.outbound-cartons'))return;
  const horizontal={ArrowLeft:-1,ArrowRight:1},vertical={ArrowUp:-1,ArrowDown:1,PageUp:-1,PageDown:1};
  if(Object.hasOwn(horizontal,e.key)){e.preventDefault();(phase==='folder'?stepFolder:stepOrder)(horizontal[e.key],true);}
  else if(Object.hasOwn(vertical,e.key)){e.preventDefault();stepOrder(vertical[e.key],true);}
 });
 stage.addEventListener('wheel',e=>{
  if(phase!=='folder'||e.ctrlKey||e.metaKey||Math.abs(e.deltaY)<=Math.abs(e.deltaX))return;
  const card=e.target.closest?.('[data-folder=true]'),idx=Number(card?.dataset.folderIndex);
  if(!card||folders[idx]?.orders.length<2)return;
  e.preventDefault();
  const now=performance.now();if(wheelCard!==idx||now-wheelAt>280||Math.sign(wheelDistance)!==Math.sign(e.deltaY)){wheelCard=idx;wheelAt=now-160;wheelDistance=0;}
  wheelDistance+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?100:1);
  if(Math.abs(wheelDistance)<29||now-wheelAt<150)return;
  folderIndex=idx;stepOrder(Math.sign(wheelDistance),stage.contains(document.activeElement));wheelAt=now;wheelDistance=0;
 },{passive:false});
 stage.addEventListener('pointerdown',e=>{
  if(e.isPrimary&&e.button===0){gesture={id:e.pointerId,x:e.clientX,y:e.clientY,preview:phase==='folder'&&e.pointerType==='touch'&&!!e.target.closest?.('.outbound-reel-card[data-center=true] .beam-file')&&current()?.orders.length>1};suppressClick=0;}
 });
 stage.addEventListener('pointercancel',e=>{if(gesture?.id===e.pointerId)gesture=null;});
 stage.addEventListener('pointerup',e=>{
  if(gesture?.id!==e.pointerId)return;
  const {x,y,preview}=gesture,dx=e.clientX-x,dy=e.clientY-y;gesture=null;
  if(Math.abs(dx)<34||Math.abs(dx)<Math.abs(dy)*1.3)return;
  suppressClick=performance.now()+350;(phase==='folder'&&!preview?stepFolder:stepOrder)(dx<0?1:-1);
 });
 return {
  update(index,key,result,{reset=false,mode='outbound',das=false}={}){
   if(!index){folders=[];resultKey=null;phase='folder';render();return;}
   if(!reset&&resultKey?.index===index&&resultKey?.key===key&&resultKey?.mode===mode&&resultKey?.das===das){if(resultKey.lang!==l('ko','en')){resultKey.lang=l('ko','en');render();}return;}
   inventory=mode==='inventory';dasView=das;resultKey={index,key,mode,das,lang:l('ko','en')};phase='folder';folderIndex=0;positions.clear();carton=result?.carton||'';
   const makeFolders=inventory?locationFolders:das?dasFolders:outboundFolders;
   if(key)folders=makeFolders(result.groups,carton);
   else{
    const cached=allFolders.get(index);
    if(cached?.mode===mode)folders=cached.folders;
    else {folders=makeFolders(index.groups.values());allFolders.set(index,{mode,folders});}
   }
   render();
  },
  resume(box){
   // Returning from a verification refreshes completion marks from the current job.
   const f=current(),limit=flyerLimit;flyerFolder=null;render();
   if(!inventory&&f&&box){
    if(limit>flyerLimit){flyerLimit=limit;paintFlyers();}
    const order=f.orders.at(at(f));revealFlyer(order);flyerViews.get(order)?.focus({box,scroll:true});
   }else goFocus();
  },
  focus:goFocus,back,openCartons
 };
}
