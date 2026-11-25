import { productIdentityMarkup } from '../domain/product-identity.js';
import { outboundFolders, wrapOutboundIndex } from '../domain/carton-verification.js';
import { encodeReceiptCode128 } from '../domain/code128.js';
import { productBarcodeSvg } from '../domain/product-labels.js';

export function createOutboundReceipts(host,{l,onChoose}){
 const make=(tag,cls='',text='')=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text)x.textContent=text;return x;};
 const button=(text,action,cls='')=>{const b=make('button',cls,text);b.type='button';b.onclick=action;return b;};
 const stage=make('div','outbound-reel'),controls=make('div','outbound-reel-tools'),dialog=make('dialog','outbound-ticket-dialog');
 const title=make('h2','',l('출고 주문 영수증','Outbound order receipt'));title.id='outboundReceiptTitle';
 const scroll=make('div','outbound-ticket-scroll'),footer=make('div','outbound-reel-tools');scroll.tabIndex=0;
 dialog.setAttribute('aria-labelledby',title.id);
 const close=button('×',()=>dialog.close());close.setAttribute('aria-label',l('닫기','Close'));
 const head=make('div','outbound-dialog-heading');head.append(title,close);dialog.append(head,scroll,footer);
 host.classList.add('outbound-receipt-picker');host.append(stage,controls,dialog);
 let folders=[],folderIndex=0,phase='folder',carton='',resultKey=null,gesture=null,suppressClick=0,wheelAt=-Infinity,wheelDistance=0,wheelCard=-1;
 const positions=new Map(),allFolders=new WeakMap(),receiptItems=new WeakMap();
 const at=(f)=>positions.get(f.key)||0;
 const current=()=>folders[folderIndex];
 const goFocus=()=>stage.querySelector('[data-center=true]')?.focus({preventScroll:true});
 const labelFor=f=>f.label||f.orders[0].external||f.orders[0].id;
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 function move(el,keyframes){
  if(!reduced())el?.animate?.(keyframes,{duration:450,easing:'cubic-bezier(.28,.08,.22,1)'});
 }
 function ticket(o,limit,{barcode=false}={}){
  const card=make('span','beam-paper-ticket outbound-paper'),top=make('span','beam-paper-top'),ref=make('span','beam-paper-ref');
  const ext=make('b','',o.external||o.id);ext.title=ext.textContent;ref.append(make('span','','OUTBOUND ORDER'),ext);
  const total=make('span','beam-paper-party');total.append(make('b','',[...o.stores].join(' / ')||o.id),make('b','',o.qty.toLocaleString()+' EA'));
  const meta=make('span','outbound-paper-meta',[o.external&&o.external!==o.id?o.id:'',l(`박스 ${o.boxes.size}개`,`${o.boxes.size} cartons`),[...o.countries].join(' / ')].filter(Boolean).join(' · '));
  top.append(ref,total,meta);
  if(barcode){try{
   const plate=make('span','outbound-code128');plate.innerHTML=productBarcodeSvg(encodeReceiptCode128(o.id));plate.setAttribute('role','img');plate.setAttribute('aria-label','Code 128 · '+o.id);top.append(plate);
  }catch{/* Identifiers outside Code 128 still display as text. */}}
  const body=make('span','beam-paper-body');
  const line=(name,value,cls='')=>{const row=make('span','outbound-paper-line '+cls);row.append(make('span','',name),make('b','',String(value)));return row;};
  body.append(line(l('상품','Items'),l('수량','Qty'),'outbound-paper-columns'));
  let items=receiptItems.get(o);if(!items){items=[...o.totals.values()];receiptItems.set(o,items);}
  let end=Math.min(limit,items.length),i=0;
  function append(to){const frag=document.createDocumentFragment();for(;i<to;i++){const r=items[i],el=line('',r.expected);el.firstElementChild.innerHTML=productIdentityMarkup(r.name,r.conflict?null:r.brand,{fallback:r.sku||r.barcode||'—'});frag.append(el);}body.append(frag);}
  append(end);
  if(end<items.length&&!barcode)body.append(make('span','outbound-paper-meta',l(`+ ${items.length-end}종`,`+ ${items.length-end} items`)));
  card.append(top,make('span','beam-paper-tear'),body);
  return {card,more:()=>{end=Math.min(end+100,items.length);append(end);return end<items.length;},remaining:items.length-end};
 }
 function fileFace(f,selected){
  const position=at(f),paper=make('span','beam-file-paper'),file=make('span','beam-file'),win=make('span','beam-file-window');
  const glass=make('span','beam-file-glass'),caption=make('span','beam-file-caption');
  file.append(make('span','beam-file-back'));
  if(f.orders.length>1)file.append(make('span','beam-file-sheet beam-file-sheet-left'));
  if(f.orders.length>2)file.append(make('span','beam-file-sheet beam-file-sheet-right'));
  paper.append(ticket(f.orders[position],selected?7:3).card);win.append(paper);
  glass.append(make('span','beam-file-position',(position+1)+' / '+f.orders.length),make('span','beam-file-arrow','↗'));file.append(win,glass);
  caption.append(make('strong','',labelFor(f)),make('span','',l(`주문 ${f.orders.length}건`,`${f.orders.length} orders`)));
  return [file,caption];
 }
 function stepFolder(step,focus){
  if(folders.length<2)return false;
  folderIndex=wrapOutboundIndex(folderIndex,step,folders.length);render(step,'folder');if(focus)goFocus();return true;
 }
 function stepOrder(step,focus){
  const f=current();if(!f||f.orders.length<2)return false;
  positions.set(f.key,wrapOutboundIndex(at(f),step,f.orders.length));
  render(step,phase==='folder'?'peek':'order');if(focus&&!dialog.open)goFocus();
  if(dialog.open)renderDialog(step);
  return true;
 }
 function activate(){
  const f=current();if(!f)return false;
  if(phase==='folder'){phase='order';render(1,'open');goFocus();return true;}
  const o=f.orders[at(f)];onChoose(o,carton&&o.boxes.has(carton)?carton:undefined);return true;
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
 function render(step=0,axis=''){
  const f=current(),lastFocus=[...controls.querySelectorAll('button')].indexOf(document.activeElement);stage.replaceChildren();controls.replaceChildren();host.dataset.phase=phase;host.hidden=!f;
  if(!f)return;
  const inFolder=phase==='folder',n=inFolder?folders.length:f.orders.length,index=inFolder?folderIndex:at(f);
  for(const slot of visibleSlots(n,index)){
   const i=wrapOutboundIndex(index,slot,n),entry=inFolder?folders[i]:f.orders[i];
   const b=button('',()=>{
    if(performance.now()<suppressClick)return;
    if(!slot){activate();return;}
    if(inFolder)stepFolder(slot,true);else stepOrder(slot,true);
   },'outbound-reel-card');
   b.dataset.slot=String(slot);b.dataset.center=String(!slot);
   if(inFolder){b.dataset.folder='true';b.dataset.peek=String(!slot);b.dataset.folderIndex=String(i);b.append(...fileFace(entry,!slot));}
   else b.append(ticket(entry,slot?3:8).card);
   const aria=inFolder?labelFor(entry)+l(` · 주문 ${entry.orders.length}건`,` · ${entry.orders.length} orders`):[entry.external||entry.id,entry.id,l(`박스 ${entry.boxes.size}개`,`${entry.boxes.size} cartons`)].join(' · ');
   b.setAttribute('aria-label',aria);b.setAttribute('aria-current',String(!slot));b.tabIndex=slot?-1:0;
   stage.append(b);
  }
  if(inFolder&&folders.length>1||!inFolder&&f.orders.length>1){
   const stepper=inFolder?stepFolder:stepOrder;
   controls.append(navButton('‹',inFolder?l('이전 파일','Previous folder'):l('이전 영수증','Previous receipt'),()=>stepper(-1)),status((index+1)+' / '+n),navButton('›',inFolder?l('다음 파일','Next folder'):l('다음 영수증','Next receipt'),()=>stepper(1)));
  }
  controls.append(button(l('영수증 펼쳐보기','Expand receipt'),()=>{renderDialog();dialog.showModal();close.focus();}));
  if(!inFolder)controls.append(button(l('파일 묶음으로','Back to folders'),back));
  controls.append(button(inFolder?l('파일 열기','Open folder'):l('박스 선택','Choose carton'),activate,'outbound-activate'));
  if(lastFocus>=0)controls.querySelectorAll('button')[lastFocus]?.focus({preventScroll:true});
  if(step){const active=stage.querySelector('[data-center=true]');
   if(axis==='peek')move(active?.querySelector('.beam-file-paper'),[{translate:'0 '+(step>0?32:-12)+'px',opacity:.45},{translate:'0 0',opacity:1}]);
   else move(active,[{transform:`perspective(850px) translate3d(${axis==='open'?0:step*42}px,${axis==='open'?27:0}px,0) rotate${axis==='open'?'X':'Y'}(${step*14}deg)`,opacity:.46},{transform:'none',opacity:1}]);
  }
 }
 function renderDialog(step=0){
  const f=current();if(!f)return;
  const order=f.orders[at(f)],paper=ticket(order,100,{barcode:true});
  title.textContent=order.external||order.id;
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
 dialog.addEventListener('close',goFocus);
 host.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing||e.keyCode===229||dialog.open)return;
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
  update(index,key,result,{reset=false}={}){
   if(!index){folders=[];resultKey=null;render();return;}
   if(!reset&&resultKey?.index===index&&resultKey?.key===key){if(resultKey.lang!==l('ko','en')){resultKey.lang=l('ko','en');render();}return;}
   resultKey={index,key,lang:l('ko','en')};phase='folder';folderIndex=0;positions.clear();carton=result?.carton||'';
   if(key)folders=outboundFolders(result.groups);
   else{
    if(!allFolders.has(index))allFolders.set(index,outboundFolders(index.groups.values()));
    folders=allFolders.get(index);
   }
   render();
  },
  resume(){render();goFocus();},
  focus:goFocus,back
 };
}
