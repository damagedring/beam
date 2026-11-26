const arrows = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

export function createOutboundCartons({l,onChoose,onDispatch,isComplete,onExpand}) {
 const make=(tag,cls='',text='')=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
 const root=make('section','outbound-cartons');
 const sheet=make('div','outbound-carton-sheet');
 const tools=make('div','outbound-cartons-tools');
 const dispatch=make('button','outbound-cartons-dispatch'),expand=make('button','outbound-cartons-expand');
 const list=make('ul','outbound-cartons-list');
 root.hidden=true;
 dispatch.type=expand.type='button';tools.append(expand,dispatch);sheet.append(tools,list);root.append(sheet);
 let order=null,byKey=new Map();
 let pulling=null;
 function open(key,slip){
  if(!key||!order?.boxes.has(key))return;
  const chosen=order;
  const enter=()=>{
   if(order!==chosen||root.closest('[hidden],[inert]'))return;
   onChoose(chosen,key);
  };
  if(!slip||matchMedia('(prefers-reduced-motion: reduce)').matches||!slip.animate){pulling?.cancel();enter();return;}
  if(pulling)return;
  const animation=slip.animate([
   {transform:'translateY(2px) rotate(.4deg)',opacity:1},
   {transform:'translateY(12px) rotate(2deg)',opacity:.15},
  ],{duration:150,easing:'cubic-bezier(.34,.05,.6,1)',fill:'forwards'});
  pulling=animation;
  animation.onfinish=()=>{if(pulling!==animation)return;pulling=null;animation.cancel();enter();};
  animation.oncancel=()=>{if(pulling===animation)pulling=null;};
 }
 dispatch.onclick=()=>{if(order)onDispatch(order);};
 expand.onclick=()=>{if(order)onExpand(order,expand);};
 list.onkeydown=e=>{
  if(e.isComposing||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
  if(e.key==='Enter'&&e.repeat){e.preventDefault();return;}
  const step=arrows[e.key];if(!step)return;
  const buttons=[...byKey.values()],at=buttons.indexOf(e.target);if(at<0)return;
  e.preventDefault();buttons[(at+step+buttons.length)%buttons.length].focus();
 };
 function update(next,receipt){
  order=next;root.hidden=!order;
  if(pulling){const active=pulling;pulling=null;active.cancel();}
  if(!next)return;
  root.setAttribute('aria-label',l('출고 주문 ','Outbound order ')+(order.external||order.id));
  if(receipt)sheet.prepend(receipt);
  dispatch.textContent=l('출고 명세서','Shipment summary');
  expand.textContent=l('전체 영수증','Full receipt');
  const keys=[...order.boxes.keys()].filter(Boolean);
  list.setAttribute('aria-label',l('검수할 박스 라벨','Carton labels to inspect'));
  const items=document.createDocumentFragment();
  byKey=new Map(keys.map((key,i)=>{
   const li=make('li'),b=make('button','outbound-carton'),top=make('span','outbound-carton-top');
   const done=isComplete(order,key);
   let qty=0;for(const row of order.boxes.get(key).values())qty+=row.expected;
   top.append(make('span','',String(i+1).padStart(2,'0')),make('span','',done?'✓':'↓'));
   b.type='button';
   const orderPrefix=(order.external||order.id)+' ';
   const label=key.startsWith(orderPrefix)?key.slice(orderPrefix.length):key;
   b.setAttribute('aria-label',key+' · '+qty.toLocaleString()+' EA'+(done?' · '+l('완료','Complete'):''));
   b.title=key;
   b.append(top,make('strong','',label),make('span','outbound-carton-quantity',qty.toLocaleString()+' EA'));
   b.onclick=()=>open(key,b);li.append(b);items.append(li);return [key,b];
  }));
  list.replaceChildren(items);
 }
 function focus({box,first=false,scroll}={}){
  if(root.hidden)return;
  const previous=byKey.get(box)||(first?byKey.values().next().value:null);
  if(previous){previous.focus({preventScroll:true});if(scroll)previous.scrollIntoView({block:'nearest'});return;}
  if(scroll)root.scrollIntoView({block:'nearest'});
 }
 return {root,update,focus};
}
