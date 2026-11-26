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
 const holdTime=text=>Math.max(6800,Math.min(18000,2500+[...text].length*70));
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
  const prism=strip.firstElementChild;
  const [face,nextFace]=prism.children;
  const ms=holdTime(notice.text);
  const reduce=doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  clearTimeout(s.timer);
  strip.hidden=true;face.textContent=nextFace.textContent=notice.text;
  strip.dataset.tone=notice.tone;strip.dataset.scope=notice.scope;strip.classList.remove('is-running');
  strip.style.setProperty('--notice-hold',ms+'ms');
  strip.hidden=false;
  strip.style.setProperty('--notice-depth',face.offsetHeight/2+'px');
  strip.classList.add('is-running');
  s.timer=setTimeout(()=>end(strip),ms+(reduce?150:1370));
 }
 function target(dialog){
  if(!dialog)return globalStrip;
  let strip=dialog.querySelector(':scope > .beam-notice-strip');
  if(!strip){
   strip=doc.createElement('div');strip.className='beam-notice-strip';
   strip.hidden=true;strip.setAttribute('aria-hidden','true');
   const prism=doc.createElement('div');prism.className='beam-notice-prism';
   const face=doc.createElement('p'),nextFace=doc.createElement('p');
   face.className='beam-notice-face';nextFace.className='beam-notice-face beam-notice-next';
   prism.append(face,nextFace);strip.append(prism);dialog.prepend(strip);
  }
  return strip;
 }
 function show(text,{tone='info',scope='ui',key=null,origin=null,announce=false}={}){
  text=(text||'').replace(/\s+/gu,' ').trim();if(!text)return;
  const dialog=origin?.closest('dialog')||(!origin?[...doc.querySelectorAll('dialog[open]')].at(-1):null);
  if(origin&&!visible(origin))return;
  const strip=target(dialog),s=playing(strip),next={text,tone,scope,key,origin,view:doc.body.dataset.beamView};
  if(s.active?.text===text&&s.active?.tone===tone)return;
  if(announce)doc.getElementById('beamNoticeAnnounce').textContent=text;
  if(key)s.pending=s.pending.filter(item=>item.key!==key);
  if(!s.active||key&&s.active.key===key||tone!=='info'&&s.active.tone==='info'){start(strip,next);return;}
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
  show(text,{origin:node,scope:set.scope,tone:typeof set.tone==='function'?set.tone(node):set.tone});
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
  if(event.target.classList?.contains('beam-notice-strip')&&['beamNoticeVerticalShutter','beamNoticeHide'].includes(event.animationName))end(event.target);
 });
 doc.addEventListener('close',event=>{
  const strip=event.target.querySelector?.(':scope > .beam-notice-strip');if(strip)reset(strip);
  for(const [node,set] of sources)if(node.closest('dialog')===event.target)set.last='';
 },true);
 // Changes of workflow should not replay announcements from the previous view.
 new MutationObserver(()=>{const s=playing(globalStrip);if(s.active&&s.active.view!==doc.body.dataset.beamView)reset(globalStrip);}).observe(doc.body,{attributes:true,attributeFilter:['data-beam-view']});
 return {show,bind};
}
