// Legacy profiles retain their original matching rule; picked values use source text as-is (except outer whitespace).
export function returnChannelKey(value){return String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ').toUpperCase();}
export function returnChannelExact(value){return String(value??'').trim();}
export function returnChannelValues(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('B2B/B2C 구분값을 확인하세요.');
 const exact=value.exact===true,keyFor=exact?returnChannelExact:returnChannelKey;
 const parse=key=>{
  const list=Array.isArray(value[key])?value[key]:[value[key]];
  if((!exact&&!list.length)||list.length>(exact?1048576:64)||list.some(x=>typeof x!=='string'||!x.trim()||x.length>(exact?32767:120)))throw Error('B2B/B2C 구분값을 확인하세요.');
  return [...new Set(list.map(keyFor))];
 };
 const b2b=parse('b2b'),b2c=parse('b2c'),left=new Set(b2b);
 if(b2c.some(v=>left.has(v)))throw Error('B2B와 B2C에는 서로 다른 구분값을 입력하세요. 같은 코드는 두 그룹에 넣을 수 없습니다.');
 // Keep the former single-value profile shape when possible.
 if(exact&&!b2b.length&&!b2c.length)throw Error('원본 값 중 하나 이상에 B2B 또는 B2C를 지정하세요.');
 return {b2b:b2b.length===1?b2b[0]:b2b,b2c:b2c.length===1?b2c[0]:b2c,...(exact?{exact:true}:{})};
}

export const MappingCore=(()=>{
function checkedCustomerNames(value,raw){
 if(value===undefined)return Object.create(null);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('고객명 조회 자료 형식이 올바르지 않습니다.');
 const out=Object.create(null);if(!Object.keys(value).length)return out;const allowed=new Set(raw.map(r=>r.receipt));
 for(const [id,names]of Object.entries(value)){
  if(!allowed.has(id)||!Array.isArray(names)||!names.length||names.some(n=>typeof n!=='string'||!n.trim()||n.length>4096)||new Set(names).size!==names.length)throw Error('고객명 조회 자료의 주문 또는 이름을 확인하세요.');
  out[id]=names.slice();
 }
 return out;
}

 const defs={raw:[['receipt','주문 식별자','Order ID',1],['external','외부 주문 식별자','External order ID'],['returnChannel','B2B/B2C 구분 열','B2B/B2C category column'],['returnTracking','반송장번호 (선택)','Return tracking number (optional)'],['expectedInventoryStatus','입고 예정 상태 (선택)','Expected inventory status (optional)'],['date','고객사 전달일 (선택)','Date sent by client (optional)'],['barcode','상품 바코드','Barcode'],['sku','상품 코드','Product code'],['name','상품명','Product name'],['brand','브랜드 (선택)','Brand (optional)'],['qty','예정 수량','Expected quantity',1],['seller','매장명','Store name'],['company','업체명','Company'],['address','주소','Address'],['memo','추가 정보','Additional information'],['customerName','고객명 · 조회용 (선택)','Customer name · lookup only (optional)'],['customerPhone','고객 전화번호 · 조회용 (선택)','Customer phone · lookup only (optional)'],['customerAddress','고객 배송 주소 · 조회용 (선택)','Customer shipping address · lookup only (optional)'],['originalTracking','원운송장번호 · 조회용 (선택)','Original tracking No. · lookup only (optional)']],sku:[['barcode','상품 바코드','Barcode'],['sku','상품 코드','Product code'],['name','상품명','Product name'],['brand','브랜드 (선택)','Brand (optional)']],loc:[['barcode','상품 바코드','Barcode'],['sku','상품 코드','Product code'],['loc','위치','Location',1],['locationType','위치 유형','Location type'],['zone','구역','Zone'],['putawayZone','적치 구역','Putaway zone'],['warehouse','창고','Warehouse']]};
 defs.sku.push(['unitsPerCase','박스당 수량 (선택)','Units per case (optional)']);
 defs.phoneOrders=[['id','원주문 식별자','Original order ID',1],['customerName','고객명 (선택)','Customer name (optional)'],['phone','고객 전화번호 (선택)','Customer phone (optional)'],['address','배송 주소 (선택)','Shipping address (optional)'],['originalTracking','출고 운송장번호 (선택)','Outbound tracking No. (optional)'],['sku','상품 코드','Product code'],['barcode','상품 바코드','Barcode'],['date','주문일','Order date'],['name','상품명','Product name']];
 const exact=v=>v==null?'':String(v).replace(/^\uFEFF/,'').trim();
 function fields(kind){if(!Object.hasOwn(defs,kind))throw Error('알 수 없는 데이터 역할입니다.');return defs[kind].map(([id,label,labelEn,required])=>({id,label,labelEn,required:!!required}));}
 function signature(header){if(!Array.isArray(header))throw Error('열 제목 행을 선택하세요.');const names=header.map(exact).filter(x=>x!=='');if(!names.length)throw Error('열 제목이 비어 있습니다. 다른 제목 행을 선택하세요.');return [...new Set(names)].sort();}
 function validateColumns(kind,header,columns){signature(header);if(!columns||typeof columns!=='object'||Array.isArray(columns))throw Error('열 연결을 확인하세요.');const out={},used=new Set(),allowed=new Set(fields(kind).map(f=>f.id)),counts=new Map();for(const name of header.map(exact))counts.set(name,(counts.get(name)||0)+1);for(const [id,col]of Object.entries(columns)){if(!allowed.has(id))throw Error('알 수 없는 열 역할입니다.');if(col==null)continue;if(!Number.isInteger(col)||col<0||col>=header.length||exact(header[col])===''||counts.get(exact(header[col]))!==1||used.has(col))throw Error('열 연결이 비어 있거나 중복됩니다.');used.add(col);out[id]=col;}for(const f of fields(kind))if(f.required&&!Object.hasOwn(out,f.id))throw Error(f.label+' 열을 연결하세요.');if(kind!=='phoneOrders'&&!Object.hasOwn(out,'barcode')&&!Object.hasOwn(out,'sku'))throw Error('상품 바코드 또는 상품 코드 열을 연결하세요.');return out;}
 function makeProfile(kind,sheetName,rows,mapping){if(!Number.isInteger(mapping?.headerRow)||mapping.headerRow<0||mapping.headerRow>=Math.min(100,rows.length))throw Error('첫 100행 안의 제목 행을 선택하세요.');const header=rows[mapping.headerRow],columns=validateColumns(kind,header,mapping.columns);return {version:1,kind,sheetName:exact(sheetName),headerNames:Object.fromEntries(Object.entries(columns).map(([id,i])=>[id,exact(header[i])])),signature:signature(header),...(kind==='raw'&&mapping.returnChannelReviewed?{returnChannelReviewed:true}:{}),...(kind==='raw'&&Object.hasOwn(columns,'returnChannel')&&mapping.returnChannelValues!==undefined?{returnChannelValues:returnChannelValues(mapping.returnChannelValues)}:{})};}
 const comparableHeader=v=>exact(v).normalize('NFC').replace(/[\u200B\uFEFF]/gu,'').replace(/\s+/gu,' ').trim().toLowerCase();
 function knownColumns(profile,header){
  const index=new Map(),folded=new Map();
  for(const [i,value] of header.entries()){
   const name=exact(value);if(!name)continue;
   index.set(name,index.has(name)?-1:i);
   const key=comparableHeader(name);if(key)folded.set(key,folded.has(key)?-1:i);
  }
  const proposed=[];
  for(const [field,value] of Object.entries(profile.headerNames)){
   const name=exact(value),direct=index.get(name),col=index.has(name)?direct:folded.get(comparableHeader(name));
   if(col>=0)proposed.push({field,col,exact:direct>=0});
  }
  const uses=new Map();for(const p of proposed)uses.set(p.col,(uses.get(p.col)||0)+1);
  const unique=proposed.filter(p=>uses.get(p.col)===1);
  return {columns:Object.fromEntries(unique.map(p=>[p.field,p.col])),exactCount:unique.filter(p=>p.exact).length,index};
 }
 function reconnectRows(profile,rows){
  try{
   if(profile?.version!==1||typeof profile.sheetName!=='string'||!Array.isArray(profile.signature)||!profile.signature.length||!profile.headerNames||typeof profile.headerNames!=='object')throw Error('저장된 연결 형식이 올바르지 않습니다.');
   const defs=fields(profile.kind),mapped=Object.entries(profile.headerNames).map(([k,v])=>[k,exact(v)]);
   if(!mapped.length||mapped.some(([k,v])=>!v||!defs.some(f=>f.id===k)))throw Error('저장된 열 이름이 올바르지 않습니다.');
   const wanted=new Set(profile.signature.map(exact).filter(Boolean)),full=[],partial=[];
   for(let i=0;i<Math.min(100,rows.length);i++){
    const {columns,exactCount,index:indices}=knownColumns(profile,rows[i]);
    const matched=Object.keys(columns).length;
    if(!matched)continue;
    let known=0;for(const name of indices.keys())if(wanted.has(name))known++;
    const exactShape=known===wanted.size&&indices.size===wanted.size;
    const hit={headerRow:i,columns,matched,known,exactShape,exactCount};
    if(matched===mapped.length)full.push(hit);
    else if(matched>=2||known>=2)partial.push(hit);
   }
   const strict=full.filter(x=>x.exactCount===mapped.length),exactHits=strict.filter(x=>x.exactShape),hits=exactHits.length?exactHits:strict.length?strict:full;
   if(hits.length===1){const {headerRow,columns}=hits[0];return {ok:true,mapping:{headerRow,columns:validateColumns(profile.kind,rows[headerRow],columns),returnChannelReviewed:profile.returnChannelReviewed===true,returnChannelValues:returnChannelValues(profile.returnChannelValues)}};}
   if(hits.length>1)return {ok:false,reason:'일치하는 제목 행이 여러 개입니다. 제목 행만 확인해 주세요.'};
   partial.sort((a,b)=>b.matched-a.matched||b.exactCount-a.exactCount||b.known-a.known);
   const best=partial[0],next=partial[1],hint=best&&(!next||best.matched!==next.matched||best.exactCount!==next.exactCount||best.known!==next.known)?best:null;
   return {ok:false,headerRow:hint?.headerRow,reason:'기존에 연결한 열 중 찾을 수 없거나 이름이 중복된 열만 확인해 주세요.'};
  }catch(e){return {ok:false,reason:e.message};}
 }
 return {fields,validateColumns,makeProfile,reconnectRows,signature,checkedCustomerNames,normalizeHeader:exact,knownColumns,comparableHeader};
})();
