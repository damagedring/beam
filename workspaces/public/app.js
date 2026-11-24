const byId=id=>document.getElementById(id);
const status=byId('status'), date=new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short'});
let view='join',busy=false,revision=0,painted='';
const errors={host_required:'관리 키를 확인해 주세요.',brand_forbidden:'이 브랜드를 관리할 권한이 없어요.',invalid_invite:'만료됐거나 올바르지 않은 초대 코드예요.',slow_down:'잠시 후 다시 시도해 주세요.',not_found:'접근할 수 없는 작업공간이에요.',invalid:'입력한 내용을 확인해 주세요.',capacity:'현재 더 추가할 수 없어요.'};
const say=text=>{status.textContent=text;};
const element=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
function action(label,handler,primary=false){
 const button=element('button',label,primary?'primary':'');button.type='button';
 button.onclick=()=>void handler();return button;
}
async function api(route,body) {
 const response=await fetch('./api/'+route,{
  credentials:'same-origin',cache:'no-store',
  ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
 });
 const data=await response.json();
 if(!response.ok)throw Object.assign(new Error(errors[data.error]||'연결을 확인하고 다시 시도해 주세요.'),{code:data.error});
 return data;
}
async function run(fn) {
 if(busy)return;
 busy=true;
 try{await fn();}catch(error){say(error.message);}
 finally{busy=false;}
}
function select(next) {
 view=next;revision++;painted='';say('');
 for(const name of ['join','host']){
  byId(name+'-view').hidden=name!==view;
  const tab=byId(name+'-tab');if(name===view)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
 }
 void refresh();
}
const title=s=>s.brand;
const expiry=s=>s.inviteExpiresAt?'초대 만료 '+date.format(s.inviteExpiresAt):'활성 초대 없음';
const captions={pending:'승인 대기',approved:'참여 중',denied:'참여 불가'};
const codeText=code=>code.slice(0,5)+'-'+code.slice(5);
const link=code=>new URL('./#invite='+code,location.href).href;
async function copy(value) {
 try{await navigator.clipboard.writeText(value);say('복사했어요. Teams에 붙여넣으세요.');}
 catch{
  const area=byId('copy-text');area.value=value;byId('copy-dialog').showModal();area.focus();area.select();
 }
}
function card(s){
 const item=element('li','','card');item.append(element('h2',title(s)));return item;
}
function paintGuest(data) {
 const list=data.spaces;
 if(JSON.stringify(list)===painted)return;painted=JSON.stringify(list);
 byId('my-spaces').replaceChildren(...list.map(s=>{
  const item=card(s);
  item.append(element('p','기기 '+s.number+' · '+captions[s.status],'meta'));
  if(s.status==='pending')item.append(element('p','책임자에게 기기 번호를 알려주세요. 승인되면 여기에 표시돼요.','meta'));
  if(s.status==='approved'){
   const open=element('a','Beam 검수 열기');open.href='/beam/';open.rel='noopener';open.target='_blank';item.append(open);
  }
  return item;
 }));
}
function paintHost(data) {
 byId('host-form').hidden=true;byId('host-panel').hidden=false;
 byId('organization').textContent=data.organization;
 const list=data.spaces;
 if(JSON.stringify(list)===painted)return;painted=JSON.stringify(list);
 byId('host-spaces').replaceChildren(...list.map(s=>{
  const item=card(s),actions=element('div','','actions');
  item.append(element('p',expiry(s),'meta'));
  const create=()=>run(async()=>{
   if(s.code&&!window.confirm(title(s)+'의 기존 초대를 바꿀까요? 이미 참여 중인 기기는 유지돼요.'))return;
   await api('invite',{spaceId:s.id});say('초대를 만들었어요. Teams에 붙여넣을 내용을 복사하세요.');await refresh();
  });
  if(s.code){
   actions.append(
    action('Teams 초대 복사',()=>copy(title(s)+' 작업공간 참여\n'+link(s.code)+'\n초대 코드: '+codeText(s.code)),true),
    action('코드 '+codeText(s.code),()=>copy(codeText(s.code))),
    action('초대 교체',create),
    action('초대 닫기',()=>run(async()=>{
     await api('close-invite',{spaceId:s.id});say('새 참여 요청을 닫았어요. 기존 참여는 유지돼요.');await refresh();
    })),
   );
  }else{actions.append(action('초대 만들기',create,true));}
  item.append(actions);
  for(const member of s.members.filter(m=>m.status!=='denied')){
   const row=element('div','','member'),buttons=element('div','','member-actions');
   const decide=approve=>run(async()=>{
    await api('decide',{spaceId:s.id,memberId:member.id,approve});
    say('기기 '+member.number+(approve?' 참여를 승인했어요.':' 참여를 종료했어요.'));await refresh();
   });
   row.append(element('span','기기 '+member.number+' · '+captions[member.status]));
   if(member.status==='pending')buttons.append(action('승인',()=>decide(true),true));
   buttons.append(action(member.status==='pending'?'거절':'참여 해제',()=>decide(false)));
   row.append(buttons);item.append(row);
  }
  return item;
 }));
}
async function refresh() {
 const t=++revision,current=view;
 try{
  const data=await api(current==='host'?'host':'mine');
  if(t!==revision||current!==view)return;
  if(current==='host')paintHost(data);else paintGuest(data);
 }catch(error){
  if(t!==revision||current!==view)return;
  if(current==='host'&&error.code==='host_required'){
   painted='';byId('host-panel').hidden=true;byId('host-form').hidden=false;return;
  }
  say(error.message);
 }
}
byId('join-tab').onclick=()=>select('join');
byId('host-tab').onclick=()=>select('host');
byId('join-form').onsubmit=event=>{
 event.preventDefault();
 void run(async()=>{
  const data=await api('join',{code:byId('code').value.trim()});byId('code').value='';
  say(data.status==='pending'?'참여를 요청했어요. 기기 '+data.number+'번이에요.':captions[data.status]);await refresh();
 });
};
byId('host-form').onsubmit=event=>{
 event.preventDefault();
 void run(async()=>{const key=byId('key').value.trim();byId('key').value='';await api('host',{key});say('관리 화면을 열었어요.');await refresh();});
};
byId('copy-close').onclick=()=>byId('copy-dialog').close();
byId('signout').onclick=()=>void run(async()=>{await api('signout',{});say('관리 화면을 잠갔어요.');await refresh();});
const params=new URLSearchParams(location.hash.slice(1));
if(params.has('invite')){
 byId('code').value=params.get('invite').slice(0,18);
 history.replaceState(null,'',location.pathname);byId('code').focus();
}
void refresh();
setInterval(()=>{if(!document.hidden&&!busy)void refresh();},3500);
