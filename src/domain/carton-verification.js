import { quantityOutcome } from './reconcile.js';
import { mergeProductBrands } from './product-identity.js';
const LIMIT=200000;
export const fields=['receipt','id','external','store','country','barcode','sku','name','brand','qty','das','verificationUnit','unitsPerCase','caseBarcode'];
export const aliases={
 receipt:['orderid','originalorderid','outboundorderid','location','주문번호','오더번호','로케이션'],
 id:['boxlabelid','cartonlabelid','cartonid','boxid','cartonlpn','박스라벨번호','박스번호'],
 external:['externalorderid','orderreference','외부주문번호'],
 store:['destinationstore','store','storename','shiptostore','도착매장','매장명'],
 country:['destinationcountry','country','shiptocountry','countrycode','도착국가','국가'],
 barcode:['scancode','barcode','productbarcode','상품바코드','바코드'],
 verificationUnit:['verificationunit','inspectionunit','검수단위'],
 unitsPerCase:['unitspercase','casepackquantity','박스입수'],
 caseBarcode:['casebarcode','productcasebarcode','제품박스바코드'],
 das:['dasorderid','dasid','dasbatchid','dasassignmentid','das오더번호','das오더id','das할당번호','das식별자'],
 sku:['sku','상품코드'],brand:['brand','brandname','브랜드','브랜드명'],name:['productname','name','상품명','제품명'],qty:['expectedunits','plannedunits','onhand','quantity','qty','예정수량','수량']
};
export const pickedUnitsAliases=['pickedunits','pickedqty','pickedquantity','actualpickedunits','actualpickedquantity','피킹수량','실피킹수량'];
export const cartonHeaderKey=value=>codeKey(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function cartonQuantityAliases(mode,headers){
 return mode==='outbound'&&headers.some(v=>pickedUnitsAliases.includes(cartonHeaderKey(v)))?pickedUnitsAliases:aliases.qty;
}
export const codeKey=value=>String(value??'').trim();
export function cartonLocation(value,box,separator){
 const full=codeKey(value);
 if(box||!separator)return [full,box];
 const index=full.lastIndexOf(separator);
 if(index<0)return [full,''];
 const location=full.slice(0,index).trim(),carton=full.slice(index+separator.length).trim();
 if(!location||!carton)throw Error('Invalid Location / carton separator.');
 return [location,carton];
}
function packSize(value){
 const text=codeKey(value),units=Number(text);
 return /^[0-9]+$/.test(text)&&Number.isSafeInteger(units)&&units>1?units:null;
}
export function catalogCasePacks(rows=[]){
 const result=new Map();
 for(const row of rows){
  const sku=codeKey(row.sku),value=codeKey(row.unitsPerCase);
  if(!sku||!value)continue;
  const size=packSize(value);result.set(sku,!result.has(sku)||result.get(sku)===size?size:null);
 }
 return result;
}
export function cartonAdapter(mode,separator='',packs=new Map()){
 const inventory=mode==='inventory';
 const required=['receipt','qty','name',...(!inventory?['id']:[])];
 function validateColumns(_kind,headers,selected){
  const out={}, used=new Set();
  for(const name of fields){
   const n=selected[name];
   if(n===undefined)continue;
   if(!Number.isInteger(n)||n<0||n>=headers.length||!codeKey(headers[n])||used.has(n))throw Error('Select a separate column for each field.');
   out[name]=n;used.add(n);
  }
  if(required.some(f=>out[f]===undefined)||(out.barcode===undefined&&out.sku===undefined))throw Error('Connect the required columns and Barcode or SKU.');
  return out;
 }
 function table(_kind,rows,mapping){
  const read=(r,k)=>codeKey(r[mapping.columns[k]]);
  return rows.slice(1).map((r,i)=>{
   const external=read(r,'external'),sku=read(r,'sku'),barcode=read(r,'barcode'),name=read(r,'name'),brand=read(r,'brand'),store=inventory?'':read(r,'store'),country=inventory?'':read(r,'country');
   let group=read(r,'receipt'),box=read(r,'id');
   if(inventory)[group,box]=cartonLocation(group,box,mapping.columns.id===undefined?separator:'');
   const das=inventory?'':read(r,'das');
   const picked=read(r,'qty'),qty=Number(picked);
   // Exports can include unpicked request rows. They are not evidence of a carton.
   if(!inventory&&!box&&(!picked||qty===0))return null;
   if(!group||(!inventory&&!box)||!(sku||barcode)||!name||!Number.isSafeInteger(qty)||qty<0||!read(r,'qty')||[group,box,external,sku,barcode,das].some(v=>v.length>200)||name.length>1000||store.length>300||country.length>100)
    throw Error((i+2)+'행: Verify group, carton, item, and expected quantity.');
   const declared=inventory?'':cartonHeaderKey(read(r,'verificationUnit'));
   const pickedPack=read(r,'unitsPerCase'),master=packs.get(sku);
   const unitsPerCase=pickedPack?packSize(pickedPack):master;
   const verifiedPack=unitsPerCase&&(!packs.has(sku)||master===unitsPerCase);
   const caseCode=read(r,'caseBarcode'),caseBarcode=caseCode.length<=200?caseCode:'';
   const verification=declared==='each'?{unit:'each'}:declared==='case'&&verifiedPack&&qty%unitsPerCase===0?{unit:'case',unitsPerCase,...(caseBarcode?{caseBarcode}:{})}:undefined;
   return {group,box,external,sku,barcode,name,qty,...(verification?{verification}:{}),...(das?{das}:{}),...(brand?{brand}:{}),...(store?{store}:{}),...(country?{country}:{})};
  }).filter(r=>r&&r.qty>0);
 }
 return {validateColumns,table};
}

export function createCartonIndex(lines){
 if(lines.length>LIMIT)throw Error('Use at most 200,000 inspection rows.');
 const groups=new Map(), boxes=new Map();
 for(const line of lines){
  let group=groups.get(line.group);
  if(!group){group={id:line.group,external:line.external,boxes:new Map(),totals:new Map(),stores:new Set(),countries:new Set(),qty:0};groups.set(line.group,group);}
  if(line.external&&group.external&&line.external!==group.external)throw Error('Conflicting External order IDs: '+line.group);
  if(line.external)group.external=line.external;
  if(line.das){
   if(group.das&&group.das!==line.das)throw Error('한 주문의 DAS 식별자가 여러 개입니다. / Conflicting DAS IDs for order: '+line.group);
   group.das=line.das;
  }
  if(line.store)group.stores.add(line.store);
  if(line.country)group.countries.add(line.country);
  if(!group.boxes.has(line.box))group.boxes.set(line.box,new Map());
  if(line.box){if(!boxes.has(line.box))boxes.set(line.box,new Set());boxes.get(line.box).add(line.group);}
  add(group.boxes.get(line.box),line);add(group.totals,line);
  group.qty+=line.qty;if(!Number.isSafeInteger(group.qty))throw Error('Expected quantity exceeds the limit.');
 }
 return {groups,boxes};
}
// Imported packaging describes the plan, never how the operator actually verified it.
const verificationPlans=new WeakMap();
export function cartonVerificationPlan(group,box){
 const rows=group.boxes.get(box);
 if(!rows)return {eachUnits:0,caseUnits:0,caseCount:0,unspecifiedUnits:0,skuCount:0};
 if(verificationPlans.has(rows))return verificationPlans.get(rows);
 const plan={eachUnits:0,caseUnits:0,caseCount:0,unspecifiedUnits:0,skuCount:rows.size};
 for(const row of rows.values()){
  if(row.verification?.unit==='each')plan.eachUnits+=row.expected;
  else if(row.verification?.unit==='case'){
   plan.caseUnits+=row.expected;plan.caseCount+=row.expected/row.verification.unitsPerCase;
  }else plan.unspecifiedUnits+=row.expected;
 }
 verificationPlans.set(rows,plan);
 return plan;
}
const itemKey=(r)=>JSON.stringify([r.sku,r.barcode]);
function add(items,row){
 const key=itemKey(row),old=items.get(key);
 if(old){if(old.name!==row.name)throw Error('Conflicting product names: '+(row.sku||row.barcode));old.expected+=row.qty;if(row.brand)old.brand=mergeProductBrands([old.brand,row.brand]);
  if(old.verification?.unit!==row.verification?.unit||old.verification?.unitsPerCase!==row.verification?.unitsPerCase||old.verification?.caseBarcode!==row.verification?.caseBarcode)delete old.verification;
 }
 else items.set(key,{key,name:row.name,sku:row.sku,barcode:row.barcode,...(row.brand?{brand:row.brand}:{}),expected:row.qty,actual:0,...(row.verification?{verification:row.verification}:{})});
}
const scopeIndexes = new WeakMap();
function scopeIndex(expected) {
 const existing = scopeIndexes.get(expected);
 if (existing) return existing;
 const barcodes = new Map(), skus = new Map(), cases=new Map();
 function index(map, value, row) {
  if (value) map.set(value, map.has(value) ? null : row);
 }
 for (const row of expected.values()) {
  index(barcodes, row.barcode, row);
  index(skus, row.sku, row);
  index(cases,row.verification?.caseBarcode,row);
 }
 const result = { barcodes, skus, cases };
 scopeIndexes.set(expected, result);
 return result;
}

export function cartonRows(group,box,{counts,unknown}={counts:new Map(),unknown:new Map()}){
 const expected=box===null?group.totals:group.boxes.get(box);
 if(!expected)return [];
 const {barcodes}=scopeIndex(expected);
 return [...[...expected.values()].map(r=>({...r,actual:counts.get(r.key)||0,conflict:barcodes.get(r.barcode)===null})),
  ...[...unknown].map(([barcode,actual])=>({key:'unknown:'+barcode,barcode,actual,expected:0,unregistered:true}))];
}
function usableCase(box,code,index){
 const row=index.cases.get(code);
 return row&&code!==box&&!index.barcodes.has(code)&&!index.skus.has(code)&&index.barcodes.get(row.barcode)!==null?row:null;
}
export function cartonCaseSizes(group,box){
 const rows=group.boxes.get(box);
 if(!rows||!box)return [];
 const index=scopeIndex(rows);
 return [...new Set([...index.cases.keys()].map(code=>usableCase(box,code,index)?.verification.unitsPerCase).filter(Boolean))].sort((a,b)=>a-b);
}
export function matchCartonScan(group,box,input,actual=0,unit='each'){
 const value=codeKey(input),expected=box===null?group.totals:group.boxes.get(box);
 if(!value||!expected)return {status:'empty'};
 const index=scopeIndex(expected),{barcodes,skus,cases}=index;
 const r=unit==='case'?usableCase(box,value,index):(barcodes.has(value)?barcodes.get(value):skus.get(value));
 if(unit==='case'&&!r||unit==='each'&&cases.has(value)&&!barcodes.has(value)&&!skus.has(value))return {status:'wrong-unit'};

 if(r===null)return {status:'conflict'};
 if(!r)return {status:'unexpected',key:null,value};
 const qty=unit==='case'?r.verification.unitsPerCase:1;
 return {status:quantityOutcome(actual,r.expected,qty),...(unit==='case'?{qty}:{}),key:r.key,value,name:r.name,sku:r.sku,barcode:r.barcode,...(r.brand?{brand:r.brand}:{}),expected:r.expected,coverageEligible:barcodes.get(r.barcode)!==null};
}
export function cartonSearch(index,query){
 const value=codeKey(query).toLocaleLowerCase();
 if(!value)return [];
 const selected=[];
 for(const g of index.groups.values()){
  if(![g.id,g.external,g.das||'',...g.stores].some(x=>x.toLocaleLowerCase().includes(value))&&![...g.boxes.keys()].some(x=>x&&x.toLocaleLowerCase().includes(value)))continue;
  selected.push(g);if(selected.length>=50)break;
 }
 return selected;
}

// Only exact identifiers resolve a result automatically. A repeated carton
// label narrows the list but cannot choose which order owns the scan.
export function outboundCandidates(index,query){
 const value=codeKey(query);
 const batch=index.dasBatches?.get(value);
 if(batch)return {groups:batch,exact:null,carton:''};
 const order=index.groups.get(value);
 if(order)return {groups:[order],exact:order,carton:''};
 const cartonOrders=index.boxes.get(value);
 if(cartonOrders){
  const groups=[...cartonOrders].map(id=>index.groups.get(id));
  return {groups:groups.slice(0,50),exact:groups.length===1?groups[0]:null,carton:value};
 }
 const matches=cartonSearch(index,value);
 return {groups:matches,exact:matches.length===1?matches[0]:null,carton:''};
}

// Search projections share the original orders and carton scopes; changing search
// mode never creates a new inspection identity or combines item quantities.
const outboundScopes=new WeakMap();
export function outboundSearchScope(index, kind){
 if(!index)return null;
 let scopes=outboundScopes.get(index);
 if(!scopes){
  const create=()=>({groups:new Map(),boxes:new Map()});
  const single=create(),das={...create(),dasBatches:new Map()};
  for(const order of index.groups.values()){
   const scope=order.das?das:single;
   scope.groups.set(order.id,order);
   for(const key of order.boxes.keys()){
    if(!key)continue;
    if(!scope.boxes.has(key))scope.boxes.set(key,new Set());
    scope.boxes.get(key).add(order.id);
   }
   if(order.das){
    if(!das.dasBatches.has(order.das))das.dasBatches.set(order.das,[]);
    das.dasBatches.get(order.das).push(order);
   }
  }
  scopes={single,das};outboundScopes.set(index,scopes);
 }
 return scopes[kind];
}

export function outboundDispatch(group){
 return {orderId:group.id,externalId:group.external,stores:[...group.stores],countries:[...group.countries],cartons:[...group.boxes.keys()].filter(Boolean)};
}

export const dispatchFields=Object.freeze(['internalId','externalId','totalCartons','store','country','cartonLabels']);
export function validateDispatchProfile(value){
 if(value===undefined)return {fields:[...dispatchFields]};
 if(!value||typeof value!=='object'||!Array.isArray(value.fields)||!value.fields.length||
    value.fields.some(x=>!dispatchFields.includes(x))||new Set(value.fields).size!==value.fields.length)throw Error('Select at least one valid shipment summary field.');
 const result={fields:dispatchFields.filter(key=>value.fields.includes(key))};
 if(value.mapping!==undefined){
  const {sheet,headers}=value.mapping||{};
  if(typeof sheet!=='string'||!sheet||sheet.length>1024||!headers||typeof headers!=='object'||Array.isArray(headers)||
     Object.entries(headers).some(([key,name])=>!fields.includes(key)||typeof name!=='string'||!name||name.length>1024)||
     new Set(Object.values(headers)).size!==Object.keys(headers).length)throw Error('Invalid outbound column mapping.');
  result.mapping={sheet,headers:{...headers}};
 }
 return result;
}

// An unknown or ambiguous destination is not evidence that two orders share a store.
export function outboundFolders(groups){
 const folders=new Map();
 const fold=s=>s.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
 for(const order of groups){
  const stores=[...order.stores],countries=[...order.countries];
  const key=stores.length===1&&countries.length<=1?JSON.stringify(['store',fold(stores[0]),fold(countries[0]||'')]):JSON.stringify(['order',order.id]);
  if(!folders.has(key))folders.set(key,{key,label:stores.join(' / '),orders:[]});
  folders.get(key).orders.push(order);
 }
 return [...folders.values()];
}
export function dasFolders(groups){
 const batches=new Map();
 for(const order of groups){
  if(!order.das)continue;
  if(!batches.has(order.das))batches.set(order.das,{key:JSON.stringify(['das',order.das]),label:order.das,orders:[]});
  batches.get(order.das).orders.push(order);
 }
 return [...batches.values()];
}
export function wrapOutboundIndex(index,step,count){return count?((index+step)%count+count)%count:0;}

export function pieceVerificationEvidence(group,box,events){
 const rows=group.boxes.get(box), seen=new Set();
 let pieceScans=0, repeatedSkuRuns=0, previous=null;
 for(const event of events){
  if(event.box!==box||event.result!=='accepted'||event.unit==='case'||!event.coverageEligible||rows?.get(event.key)?.verification?.unit!=='each')continue;
  pieceScans++;
  if(event.key!==previous&&seen.has(event.key))repeatedSkuRuns++;
  seen.add(event.key);previous=event.key;
 }
 return {pieceScans,distinctSku:seen.size,repeatedSkuRuns};
}
