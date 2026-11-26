// Announcements may come from different workflows, but share one visual treatment.
// Existing live regions stay in charge of screen-reader announcements and actions.
export function createNoticeStrips(doc,globalStrip) {
 const states=new WeakMap(),sources=new Map();
 const visible=node=>!node.closest('[hidden],[inert],.hidden,dialog:not([open])');
 const playing=strip=>{
  let state=states.get(strip);
  if(!state){state={active:null,pending:[],timer:0};states.set(strip,state);}
  return state;
 };
 const duration=(strip,track)=>Math.max(6200,Math.min(24000,(strip.clientWidth+track.scrollWidth)/0.14));
 function end(strip){
  const s=playing(strip);
  clearTimeout(s.timer);s.active=null;strip.hidden=true;
  while(s.pending.length){
   const next=s.pending.shift();
   if(!next.origin||visible(next.origin)){start(strip,next);break;}
  }
 }
 function reset(strip){
  const s=playing(strip);s.pending.length=0;end(strip);
 }
 function start(strip,notice){
  const s=playing(strip);s.active=notice;
  const track=strip.firstElementChild;
  clearTimeout(s.timer);
  strip.hidden=true;track.textContent=notice.text;
  strip.dataset.tone=notice.tone;strip.classList.remove('is-running');
  strip.hidden=false;
  const ms=duration(strip,track),reduce=doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  strip.style.setProperty('--notice-duration',ms+'ms');
  strip.style.setProperty('--notice-start',strip.clientWidth+'px');
  void strip.offsetWidth;
  strip.classList.add('is-running');
  s.timer=setTimeout(()=>end(strip),reduce?8350:ms+550);
 }
 function target(dialog){
  if(!dialog)return globalStrip;
  let strip=dialog.querySelector(':scope > .beam-notice-strip');
  if(!strip){
   strip=doc.createElement('div');strip.className='beam-notice-strip';
   strip.hidden=true;strip.setAttribute('aria-hidden','true');
   strip.append(doc.createElement('p'));dialog.prepend(strip);
  }
  return strip;
 }
 function show(text,{tone='info',origin=null,announce=false}={}){
  text=(text||'').replace(/\s+/gu,' ').trim();if(!text)return;
  const dialog=origin?.closest('dialog')||(!origin?[...doc.querySelectorAll('dialog[open]')].at(-1):null);
  if(origin&&!visible(origin))return;
  const strip=target(dialog),s=playing(strip),next={text,tone,origin,view:doc.body.dataset.beamView};
  if(s.active?.text===text&&s.active?.tone===tone)return;
  if(announce)doc.getElementById('beamNoticeAnnounce').textContent=text;
  if(!s.active||tone!=='info'&&s.active.tone==='info'){start(strip,next);return;}
  if(origin)s.pending=s.pending.filter(item=>item.origin!==origin);
  s.pending=s.pending.filter(item=>item.text!==text);
  if(s.pending.length===3)s.pending.shift();
  s.pending.push(next);
 }
 const read=node=>{
  if(!visible(node))return;
  const set=sources.get(node),text=node.textContent.trim();
  if(set.last===text)return;
  set.last=text;
  if(!text||set.accept&&!set.accept(text,node))return;
  show(text,{origin:node,tone:typeof set.tone==='function'?set.tone(node):set.tone});
 };
 function bind(id,options={}){
  const node=doc.getElementById(id);if(!node)return;
  sources.set(node,{...options,last:''});
  if(options.transient)node.classList.add('beam-notice-source');
  new MutationObserver(()=>read(node)).observe(node,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style']});
  if(options.container){
   const scope=doc.getElementById(options.container);
   if(scope)new MutationObserver(()=>read(node)).observe(scope,{attributes:true,attributeFilter:['hidden','class']});
  }
 }
 doc.addEventListener('animationend',event=>{
  if(event.target.classList?.contains('beam-notice-strip')&&['beamNoticeFold','beamNoticeHide'].includes(event.animationName))end(event.target);
 });
 doc.addEventListener('close',event=>{
  const strip=event.target.querySelector?.(':scope > .beam-notice-strip');if(strip)reset(strip);
  for(const [node,set] of sources)if(node.closest('dialog')===event.target)set.last='';
 },true);
 // Changes of workflow should not replay announcements from the previous view.
 new MutationObserver(()=>{const s=playing(globalStrip);if(s.active&&s.active.view!==doc.body.dataset.beamView)reset(globalStrip);}).observe(doc.body,{attributes:true,attributeFilter:['data-beam-view']});
 return {show,bind};
}
