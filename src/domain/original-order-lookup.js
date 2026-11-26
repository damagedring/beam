import { trackingExactKey, trackingNumericCore } from './search-keys.js';

export function createOriginalOrderLookup(identifierValue){
 const fields={returns:[['id','반품 오더 식별자',true],['customerName','반품 고객명'],['phone','반품 고객 전화번호'],['address','반품 배송 주소'],['originalTracking','원운송장번호']],orders:[['id','원주문 식별자',true],['customerName','원주문 고객명'],['phone','원주문 고객 전화번호'],['address','원주문 배송 주소'],['originalTracking','출고 운송장번호'],['sku','상품 코드'],['barcode','상품 바코드'],['date','주문일'],['name','상품명']]};
 const clean=v=>typeof v==='string'?v.trim():v==null?'':String(v).trim();
 const phoneError='전화번호를 확인하세요. 7~15자리 전체 번호를 입력하거나 원본 Excel 파일을 연결하세요.';
 // On XLSX input use the exact stored value, not its rounded on-screen display.
 function excelPhone(raw,format){
  const fmt=(format||'').split(';',1)[0].trim(),pattern=fmt.replace(/"([+ ()-]+)"/g,'$1').replace(/\\([+ ()-])/g,'$1');
  const isPhoneMask=/^\+?[0# ()-]+$/.test(pattern)&&pattern.includes('0');
  const width=isPhoneMask?(pattern.match(/0/g)||[]).length:0;
  if(width>15)throw Error(phoneError);
  let digits;
  try{digits=identifierValue(raw,true,'General');}catch{throw Error(phoneError);}
  return (isPhoneMask&&pattern.startsWith('+')?'+':'')+digits.padStart(width,'0');
 }
 function normalizePhone(v){
  if(typeof v==='number'&&(!Number.isSafeInteger(v)||v<=0))return {status:'invalid'};
  const s=clean(v).normalize('NFKC').replace(/[‐‑‒–—−]/g,'-');if(!s)return {status:'missing'};
  if(s.length>80||!/^\+?[0-9\s().-]+$/u.test(s)||/^[+]?\s*[-.]/.test(s))return {status:'invalid'};
  let digits=s.replace(/[^0-9]/g,'');
  if(digits.length<7||digits.length>15||!/[1-9]/.test(digits))return {status:'length'};
  // One unambiguous Korean mobile shape: domestic 010, international 82 (0)10,
  // or the 10-digit 10… form left when Excel removed the domestic zero.
  if(/^0?10\d{8}$/.test(digits))digits='82'+digits.slice(-10);
  else if(/^82010\d{8}$/.test(digits))digits='82'+digits.slice(3);
  return {status:'ok',key:digits,mask:'•••• '+digits.slice(-4)};
 }
 function validate(kind,header,columns){
  const defs=fields[kind];if(!defs||!Array.isArray(header)||!columns||typeof columns!=='object')throw Error('조회 자료 역할과 열 연결을 확인하세요.');
  const names=header.map(clean),nonempty=names.filter(Boolean);if(!nonempty.length)throw Error('열 제목이 비어 있습니다.');const counts=new Map();for(const name of nonempty)counts.set(name,(counts.get(name)||0)+1);
  const out={},used=new Set();for(const[k,v]of Object.entries(columns)){if(v==null||v==='')continue;if(!defs.some(f=>f[0]===k)||!Number.isInteger(v)||v<0||v>=names.length||!names[v]||counts.get(names[v])!==1||used.has(v))throw Error('조회 열 연결이 중복되거나 올바르지 않습니다.');out[k]=v;used.add(v);}
  for(const[k,label,required]of defs)if(required&&!Object.hasOwn(out,k))throw Error(label+' 열을 연결하세요.');if(!['phone','address','originalTracking'].some(k=>Object.hasOwn(out,k)))throw Error('전화번호, 배송 주소, 운송장번호 중 하나를 연결하세요.');
  return out;
 }
 function table(kind,rows,mapping){
  const n=mapping?.headerRow;if(!Number.isInteger(n)||n<0||n>=rows.length)throw Error('열 제목 행을 선택하세요.');const cols=validate(kind,rows[n],mapping.columns),out=[];
  for(let i=n+1;i<rows.length;i++){const row=rows[i];if(!row.some(v=>clean(v)))continue;const id=clean(row[cols.id]);if(!id||id.length>4096||/^[+]?\d+(?:\.\d*)?[eE][+-]?\d*$/.test(id))throw Error((i+1)+'행: 주문 식별자를 확인하세요.');
   let obj;
   try{obj=contactRecord(id,{customerName:row[cols.customerName],phone:row[cols.phone],address:row[cols.address],originalTracking:row[cols.originalTracking]});}
   catch(error){throw Error((i+1)+'행: '+error.message);}
   if(!obj&&kind==='returns')continue;
   obj??={id};
   for(const k of ['sku','barcode','date','name']){const v=Object.hasOwn(cols,k)?clean(row[cols[k]]):'';if(['sku','barcode'].includes(k)&&/^[+]?\d+(?:\.\d*)?[eE][+-]?\d*$/.test(v))throw Error((i+1)+'행: 상품 식별자 지수 표기는 사용할 수 없습니다.');if(v.length>4096)throw Error((i+1)+'행: 조회 정보가 너무 깁니다.');obj[k]=v;}out.push(obj);
  }return out;
 }
 function customerNameKey(value){
  return clean(value).normalize('NFC').replace(/\s+/gu,' ').trim().toLowerCase();
 }
 function addressKey(value){
  const key=clean(value).normalize('NFKC').toLowerCase()
   .replace(/[‐‑‒–—−]/g,'-').replace(/[\s,，]+/gu,' ').replace(/\s*-\s*/g,'-').trim();
  return key.length>=5&&key.length<=4096?key:'';
 }
 function trackingKeys(value){
  const exact=trackingExactKey(value).replace(/[\s\-‐‑‒–—−]/gu,'');
  if(!/^[A-Z0-9\p{L}]{6,64}$/u.test(exact)||!/\d/.test(exact))return [];
  const core=trackingNumericCore(value);
  return core&&exact!==core?[exact,core]:[exact];
 }
 function contactRecord(id,{customerName,phone,address,originalTracking}){
  const parsed=normalizePhone(phone),dest=addressKey(address),tracking=clean(originalTracking),name=customerNameKey(customerName);
  if(parsed.status!=='missing'&&parsed.status!=='ok')throw Error(phoneError);
  if(clean(address).length>4096||tracking.length>160||name.length>4096)throw Error('조회 정보가 너무 깁니다.');
  return parsed.key||dest||trackingKeys(tracking).length?{id,customerNameKey:name,phoneKey:parsed.key||'',address:dest,originalTracking:tracking}:name?{id,customerNameKey:name}:null;
 }
 const nameRole='customerName';
 const tripleRoles=[nameRole,'phone','address'];
 const encoder=new TextEncoder();
 async function hash(role,value){
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode('beam-original-order-v1\0'+role+'\0'+value));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
 }
 async function build(kind,records,allowedIds){
  if(!fields[kind]||!Array.isArray(records)||records.length>200000)throw Error('조회 자료는 역할별 최대 200,000행입니다.');
  const tokens=new Map(),byId=new Map(),byKey=new Map();let count=0;
  const add=(map,key,row)=>{if(map.has(key))map.get(key).push(row);else map.set(key,[row]);};
  for(const r of records){
   if(!r?.id||r.id.length>4096||kind==='returns'&&allowedIds&&!allowedIds.has(r.id))throw Error('조회 자료의 주문 식별자를 확인하세요.');
   const identity=[...(r.customerNameKey?[[nameRole,r.customerNameKey]]:[]),...(r.phoneKey?[['phone',r.phoneKey]]:[]),...(r.address?[['address',r.address]]:[]),...trackingKeys(r.originalTracking).map(key=>['tracking',key])];
   const keys=[];
   for(const [role,value] of identity){
    const key=role+'\0'+value;
    if(!tokens.has(key))tokens.set(key,await hash(role,value));
    keys.push([role,tokens.get(key)]);
   }
   const safe={id:r.id,keys,sku:r.sku||'',barcode:r.barcode||'',date:r.date||'',name:r.name||''};
   add(byId,r.id,safe);
   // A name verifies a candidate; it cannot generate candidates on its own.
   for(const [role,key]of keys)if(role!==nameRole)add(byKey,key,safe);
   if(++count%256===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {byId,byKey,count};
 }
 async function find(returns,orders,receipt,products=[],manual={}){
  if(!orders?.byKey.size)return {status:'not-loaded',candidates:[]};
  if(typeof manual==='string')manual={originalTracking:manual};
  const trackingEntry=clean(manual.originalTracking),phoneEntry=clean(manual.phone),addressEntry=clean(manual.address);
  const wanted=new Map(),overrides=new Map();
  if(trackingEntry){
   const values=trackingKeys(trackingEntry);
   if(!values.length)return {status:'invalid-tracking',candidates:[]};
   overrides.set('tracking',values);
  }else{
   if(phoneEntry){const phone=normalizePhone(phoneEntry);if(phone.status!=='ok')return {status:'invalid-phone',candidates:[]};overrides.set('phone',[phone.key]);}
   if(addressEntry){const address=addressKey(addressEntry);if(!address)return {status:'invalid-address',candidates:[]};overrides.set('address',[address]);}
   for(const row of returns?.byId.get(receipt)||[])for(const [role,key] of row.keys)if(!overrides.has(role)&&role!==nameRole)wanted.set(key,role);
  }
  for(const [role,values] of overrides)for(const value of values)wanted.set(await hash(role,value),role);
  if(!wanted.size)return {status:'no-evidence',candidates:[]};
  const byOrder=new Map();
  for(const [key,role] of wanted)for(const row of orders.byKey.get(key)||[]){
   if(!byOrder.has(row.id))byOrder.set(row.id,new Set());
   byOrder.get(row.id).add(role);
  }
  const candidates=[],bySku=new Map(),byBarcode=new Map(),barcodeWithoutSku=new Map(),unique=new Set();
  const add=(map,key,id)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(id);};
  for(const p of products){
   if(!p.sku&&!p.barcode)continue;
   const id=JSON.stringify([p.sku||'',p.barcode||'']);
   if(unique.has(id))continue;
   unique.add(id);add(bySku,p.sku,id);add(byBarcode,p.barcode,id);
   if(!p.sku)add(barcodeWithoutSku,p.barcode,id);
  }
  const hasTracking=[...wanted.values()].includes('tracking');
  const wantedNames=new Set((returns?.byId.get(receipt)||[]).flatMap(row=>row.keys.filter(([role])=>role===nameRole).map(([,key])=>key)));
  for(const [id,hits] of byOrder){
   const dates=new Set(),phones=new Set(),matched=new Set(),items=new Set();let hasOrderTracking=false;
   for(const row of orders.byId.get(id)||[]){
    for(const key of bySku.get(row.sku)||[])matched.add(key);
    for(const key of (row.sku?barcodeWithoutSku:byBarcode).get(row.barcode)||[])matched.add(key);
    if(row.date)dates.add(row.date);
    if(items.size<4&&(row.name||row.sku||row.barcode))items.add(row.name||row.sku||row.barcode);
    for(const [role,key] of row.keys){if(role==='phone')phones.add(key);if(role===nameRole&&wantedNames.has(key))hits.add(nameRole);if(role==='tracking')hasOrderTracking=true;}
   }
   candidates.push({id,evidence:[...hits],matched:matched.size,total:unique.size,items:[...items],date:dates.size===1?[...dates][0]:'',conflict:dates.size>1||phones.size>1,contradictsTracking:!hits.has('tracking')&&hasOrderTracking&&hasTracking});
  }
  // Preserve all exact-tracking results, then prioritize independent evidence and item matches.
  candidates.sort((a,b)=>Number(b.evidence.includes('tracking'))-Number(a.evidence.includes('tracking'))||Number(a.contradictsTracking)-Number(b.contradictsTracking)||b.evidence.length-a.evidence.length||b.matched-a.matched||a.id.localeCompare(b.id));
  return {status:candidates.length?'found':'no-match',candidates};
 }
 function consistentIdentity(rows){
  const values=new Map();
  for(const row of rows)for(const [role,key] of row.keys){
   if(!tripleRoles.includes(role))continue;
   if(values.has(role)&&values.get(role)!==key)return null;
   values.set(role,key);
  }
  if(values.size!==tripleRoles.length)return null;
  // All three values must coexist on a source row; never combine fragments.
  return rows.some(row=>tripleRoles.every(role=>row.keys.some(([r,key])=>r===role&&key===values.get(role))))?values:null;
 }
 function automaticMatch(returns,orders,receipt){
  if(!orders?.byKey.size)return null;
  const returnRows=returns?.byId.get(receipt)||[],identity=consistentIdentity(returnRows);
  if(!identity)return null;
  const clues=new Set(returnRows.flatMap(row=>row.keys.filter(([role])=>role!==nameRole).map(([,key])=>key)));
  let id=null;
  // The same candidate set as an unedited lookup, with early exit on ambiguity.
  for(const clue of clues)for(const row of orders.byKey.get(clue)||[]){
   if(id!==null&&id!==row.id)return null;
   id=row.id;
  }
  if(id===null)return null;
  const orderRows=orders.byId.get(id)||[],orderIdentity=consistentIdentity(orderRows);
  if(!orderIdentity||!tripleRoles.every(role=>orderIdentity.get(role)===identity.get(role)))return null;
  const dates=new Set(orderRows.map(row=>row.date).filter(Boolean));
  if(dates.size>1)return null;
  const tracking=row=>row.keys.filter(([role])=>role==='tracking').map(([,key])=>key);
  const orderTracking=new Set(orderRows.flatMap(tracking));
  if(orderTracking.size&&returnRows.some(row=>{const keys=tracking(row);return keys.length&&!keys.some(key=>orderTracking.has(key));}))return null;
  return id;
 }
 return {fields,normalizePhone,excelPhone,validate,table,build,find,contactRecord,automaticMatch};
}
