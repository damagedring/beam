import { scannedProductLabel } from '../../domain/product-identity.js';

export function groupOverageMarkers(events,expected,width){
 if(!expected||!events.length)return [];
 const groups=[];
 for(const event of events){
  const x=Math.min(1,event.covered/expected)*width,previous=groups.at(-1);
  if(previous&&x-previous.x<33)previous.events.push(event);
  else groups.push({x,events:[event]});
 }
 return groups;
}

export function attachProgressMarkers(doc,isEnglish,icon,{track,markers:markerId,note:noteId}){
 const rail=doc.getElementById(track),markers=doc.getElementById(markerId),note=doc.getElementById(noteId);
 const say=(ko,en)=>isEnglish()?en:ko,make=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 let model=null,groups=[],active=null,pinned=false;
 function close(restoreFocus=false){
  const previous=active;active=null;pinned=false;note.hidden=true;note.replaceChildren();
  previous?.setAttribute('aria-expanded','false');
  if(restoreFocus&&previous?.isConnected)previous.focus({preventScroll:true});
 }
 function fill(list,items,start=0){
  const next=Math.min(items.length,start+25);
  const fragment=doc.createDocumentFragment();
  for(let i=start;i<next;i++){
   const e=items[i],li=make('li'),dt=new Date(e.at),valid=Number.isFinite(dt.getTime());
   const clock=valid?new Intl.DateTimeFormat(isEnglish()?'en-GB':'ko-KR',{dateStyle:'short',timeStyle:'medium',hour12:false}).format(dt):'—';
   li.append(make('strong',say(e.position+'번째 스캔 · '+clock,'Scan '+e.position+' · '+clock)));
   const product=scannedProductLabel(e.name,e.brand);
   li.append(make('span',[product.name,e.code].filter(Boolean).join(' · ')));
   li.append(make('b',say('초과 +'+e.delta+' EA · 실물 '+e.actual+' / 예정 '+e.expected,'Excess +'+e.delta+' EA · counted '+e.actual+' / expected '+e.expected)));
   fragment.append(li);
  }
  list.append(fragment);
  return next;
 }
 function open(trigger,sticky=false){
  const items=groups[Number(trigger.dataset.overageMarker)]?.events;
  if(!items?.length)return;
  if(active===trigger&&pinned&&sticky){close(true);return;}
  if(active===trigger&&!sticky)return;
  close();active=trigger;pinned=sticky;trigger.setAttribute('aria-expanded','true');
  const list=make('ol');note.append(list);let cursor=fill(list,items);
  if(cursor<items.length&&sticky){
   const next=make('button',say('다음 기록 보기','Show more scans'));next.type='button';
   next.onclick=()=>{cursor=fill(list,items,cursor);if(cursor===items.length){next.remove();note.focus({preventScroll:true});}};
   note.append(next);
  }else if(cursor<items.length)note.append(make('small',say('눌러서 나머지 기록 보기','Click to see more scans')));
  note.style.setProperty('--overage-anchor',trigger.style.left);note.hidden=false;
 }
 const target=e=>e.target.closest?.('button[data-overage-marker]');
 markers.addEventListener('pointerover',e=>{const trigger=target(e);if(e.pointerType!=='touch'&&trigger&&!pinned)open(trigger);});
 markers.addEventListener('pointerout',e=>{const trigger=target(e);if(trigger&&trigger===active&&!pinned&&!trigger.contains(e.relatedTarget)&&doc.activeElement!==trigger)close();});
 markers.addEventListener('focusin',e=>{const trigger=target(e);if(trigger&&!pinned)open(trigger);});
 rail.addEventListener('focusout',e=>{if(!rail.contains(e.relatedTarget))close();});
 markers.addEventListener('click',e=>{const trigger=target(e);if(trigger)open(trigger,true);});
 rail.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){e.preventDefault();e.stopPropagation();close(note.contains(doc.activeElement));}});
 doc.addEventListener('pointerdown',e=>{if(active&&!rail.contains(e.target))close();});
 function render(){
  if(!model)return;
  const width=rail.clientWidth||400;
  if(model.width===width)return;model.width=width;
  const focused=markers.contains(doc.activeElement),oldPosition=active?groups[Number(active.dataset.overageMarker)]?.events[0]?.position:null;
  close();
  groups=groupOverageMarkers(model.events,model.expected,width);
  const fragment=doc.createDocumentFragment();let resume=null;
  groups.forEach(({x,events},i)=>{
   const trigger=make('button');trigger.type='button';trigger.dataset.overageMarker=String(i);trigger.style.left=x+'px';
   const label=events.length===1?say(events[0].position+'번째 스캔: 수량 초과','Scan '+events[0].position+': excess quantity'):say('초과 스캔 '+events.length+'건',events.length+' excess scans');
   trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-controls',note.id);trigger.setAttribute('aria-expanded','false');
   trigger.innerHTML=icon();
   if(events.length>1)trigger.append(make('span',String(events.length)));
   fragment.append(trigger);
   if(focused&&events.some(e=>e.position===oldPosition))resume=trigger;
  });
  markers.replaceChildren(fragment);markers.hidden=!groups.length;
  if(resume)resume.focus({preventScroll:true});
 }
 if(typeof ResizeObserver==='function')new ResizeObserver(render).observe(rail);
 return {dismiss(){if(!active)return false;close(note.contains(doc.activeElement));return true;},update(receipt,{events,expected}){
  const english=isEnglish();
  if(model?.receipt===receipt&&model.events===events&&model.total===events.length&&model.expected===expected&&model.english===english)return;
  model={receipt,events,expected,english,total:events.length};render();
 }};
}


// Fill tracks expected units covered even when the displayed count exceeds the plan.
export function coverageReadout(p,english,{unverified=0,locked=false,waiting}={}){
 const l=(ko,en)=>english?en:ko;
 const counts=[l('정상 ','Matched ')+p.covered.toLocaleString()];
 if(p.excess)counts.push(l('초과 ','Excess ')+p.excess.toLocaleString());
 if(unverified)counts.push(l('확인 필요 ','Needs review ')+unverified.toLocaleString());
 const quantity=p.percent===null?'—':counts.join(' + ')+' / '+l('전체 예정 ','Expected ')+p.expected.toLocaleString()+' EA';
 const details=[
  p.remaining?p.remaining.toLocaleString()+l('개 남음',' remaining'):'',
  p.excess?p.excess.toLocaleString()+l('개 초과',' excess'):'',
  p.phase==='warning'?l('확인 필요','Review needed'):'',
  p.complete&&waiting!==false?(locked?l('검수 완료','Complete'):l('수량 일치 · 완료 대기','Ready to confirm')):'',
 ].filter(Boolean).join(' · ');
 const percent=p.percent===null?'—':p.percent+'%';
 return {quantity,percent,details,fill:p.expected?Math.min(100,p.covered/p.expected*100):0};
}
