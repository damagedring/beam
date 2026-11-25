// Preserve the two existing orders: undo by sequence then time, history by time
// then original position. Valid session timestamps avoid the compatibility fallback.
const legacyLatest=events=>events.slice().sort((a,b)=>(a.sequence||0)-(b.sequence||0)||Date.parse(a.at)-Date.parse(b.at)).at(-1);

export function latestScanEvent(events){
 let last,lastSequence=0,lastTime=NaN;
 for(const event of events){
  const sequence=event.sequence||0;
  // Some older work files omitted a numeric type check. Keep their coercion.
  if(!Number.isFinite(sequence))return legacyLatest(events);
  if(!last||sequence>lastSequence){
   last=event;lastSequence=sequence;lastTime=Date.parse(event.at);
  }else if(sequence===lastSequence){
   const time=Date.parse(event.at);
   if(!Number.isFinite(time)||!Number.isFinite(lastTime)){
    return legacyLatest(events);
   }
   if(time>=lastTime){last=event;lastTime=time;}
  }
 }
 return last;
}

const cmp=(a,b)=>a.time-b.time||a.index-b.index;
const decorate=(event,index)=>({event,index,time:Date.parse(event.at)});

export function scanHistoryPage(events,start,end){
 return events.map(decorate).sort(cmp).slice(start,end).map(x=>x.event);
}

export function recentScanEvents(events){
 const top=[];
 for(let index=0;index<events.length;index++){
  const item=decorate(events[index],index);
  if(!Number.isFinite(item.time))return scanHistoryPage(events,-5);
  if(top.length===5){
   if(cmp(item,top[0])<=0)continue;
   top.shift();
  }
  let i=top.length;
  while(i>0&&cmp(item,top[i-1])<0)i--;
  top.splice(i,0,item);
 }
 return top.map(x=>x.event);
}
