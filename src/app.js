import { createNoticeStrips } from './ui/notice-strip.js';
import { MappingCore, returnChannelExact, returnChannelKey, returnChannelValues } from './import/mapping/profiles.js';
import { createPrintSession } from './platform/print.js';
import { createNavigation } from './app/navigation.js';
import { attachMobileQuantities } from './features/returns/quantities.js';
import { createReturnsScanCommands } from './features/returns/scan-commands.js';
import { mergeProductBrands, optionalBrandColumn, scannedProductLabel } from "./domain/product-identity.js";
import { productIdentityMarkup } from "./components/product-identity/view.js";
import { attachCartonWorkspace } from "./features/cartons/workspace.js";
import { validateCartonMappings, prepareCartonReferences } from "./features/cartons/reference.js";
import { validateLabelPapers } from "./domain/product-labels.js";
import { attachProductLabels } from "./components/product-labels/view.js";
import { latestScanEvent, recentScanEvents, scanHistoryPage } from "./domain/scan-history.js";
import { createBrowserRecovery } from "./features/returns/recovery.js";
import { createIndexedRecoveryStore } from "./platform/indexed-recovery.js";
import { createReferenceFingerprint } from "./platform/reference-fingerprint.js";
import { createInspectionInput } from "./platform/inspection-input.js";
import { createScanAudio } from "./platform/scan-audio.js";
import { normalizeExpectedInventoryStatus, summarizeExpectedInventoryStatus } from "./domain/expected-inventory-status.js";
import { key, units, eventCode, matches, getIndex, invalidate, masterInfo, reconcile, asnProgress, storeMatches, inspectEntry, entryOutcome, candidateReceipts, readScanIndex, excessEntrySet } from "./domain/reconcile.js";
import { readWorkbook as readSpreadsheet } from "./import/workbook.js";
import { encodeReceiptCode128 } from "./domain/code128.js";
import { dispatchFields, validateDispatchProfile } from './domain/carton-verification.js';
import { renderInspectionHeader, renderInspectionReport, renderOutboundDispatch } from "./components/print/inspection-report.js";
import { trackingExactKey, trackingKey, trackingNumericCore, looksLikeTracking, beamInitialKey } from "./domain/search-keys.js";
import { translations } from "./ui/translations.js";

'use strict';
Object.assign(translations,{'OneDrive에 검수 기록 저장':'Save inspection records to OneDrive','OneDrive 저장':'OneDrive export'});
Object.assign(translations,{'바코드 / SKU':'Barcode / SKU','바코드 또는 SKU 입력':'Enter a barcode or SKU','최근 스캔 상품 검수 진행률':'Last scanned item progress','피킹 위치 안내':'Picking location information','검수 시작':'Start inspection'});
const ReferenceFingerprint = createReferenceFingerprint({
 currentData: () => state.data,
 getIndex,
 // Refresh confirmation state without replacing drafts or moving focus.
 refresh: () => { invalidateConfirmations(); updateConfirmButton(); },
});

// Exact legacy JSON token comparison uses bounded tokens, not JSON.parse of the
// old full-data signature and not a second whole reference JSON allocation.
function* confirmationJSONTokens(value){
 const active=new Set();
 function* walk(v,inArray=false){
  if(v===null){yield 'null';return;}const type=typeof v;
  if(type==='string'||type==='boolean'||type==='number'){yield JSON.stringify(v);return;}
  if(type==='undefined'||type==='function'||type==='symbol'){if(inArray){yield 'null';return;}throw Error('Unsupported legacy JSON value');}
  if(type!=='object'||active.has(v)||typeof v.toJSON==='function')throw Error('Unsupported legacy JSON structure');
  active.add(v);
  if(Array.isArray(v)){yield '[';for(let i=0;i<v.length;i++){if(i)yield ',';yield* walk(v[i],true);}yield ']';}
  else{yield '{';let first=true;for(const key of Object.keys(v)){const item=v[key],t=typeof item;if(t==='undefined'||t==='function'||t==='symbol')continue;if(!first)yield ',';first=false;yield JSON.stringify(key);yield ':';yield* walk(item);}yield '}';}
  active.delete(v);
 }
 yield* walk(value);
}
function exactLegacyConfirmation(signature,receipt,context){
 if(typeof signature!=='string'||!signature.startsWith('['))return false;
 let offset=0;try{for(const token of confirmationJSONTokens([context.batch,state.data,context.byReceipt.get(receipt)||[],context.currentPending])){if(!signature.startsWith(token,offset))return false;offset+=token.length;}return offset===signature.length;}catch{return false;}
}

let uiIndexCache=null,protectedTextCache=null,renderReadCache=null,dataJsonCache=null;
let resultPage=0,resultPageKey='',historyPage=0,questRows=[];const virtualLists=new Map();
let questPeekTimer=null,questHotkeyHeld=false,questReturnFocus=null;
let orderInfoAnchor=null,orderInfoPinned=false;
function customerLookupKey(value){return String(value??'').normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();}

function returnChannelFormValues(b2b,b2c){
 const split=v=>String(v??'').split(/[,，、]/u).map(x=>x.trim()).filter(Boolean);
 return returnChannelValues({b2b:split(b2b),b2c:split(b2c)});
}
function returnChannelFormText(value,fallback){return value===undefined?fallback:[].concat(value).join(', ');}
const returnChannelInputLimit=8192;
const Engine=(()=>{
const text=v=>String(v??'').trim();
function parseDelimited(src,delimiter='\t'){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<src.length;i++){const c=src[i];if(c==='"'){if(quoted&&src[i+1]==='"'){field+='"';i++;}else if(!field||quoted)quoted=!quoted;else field+=c;}else if(!quoted&&c===delimiter){row.push(field);field='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&src[i+1]==='\n')i++;row.push(field);if(row.some(v=>v!==''))rows.push(row);row=[];field='';}else field+=c;}if(quoted)throw Error('따옴표로 묶인 셀이 닫히지 않았습니다.');row.push(field);if(row.some(v=>v!==''))rows.push(row);return rows;}
// Decode the stored value separately from the display format. A presentation
// style may preserve leading zeros, but never decides a column's semantic role.
function storedInteger(value,maxDigits){
 const v=text(value),m=v.length<=160&&v.match(/^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('0 이상의 정수 값이 필요합니다.');
 const exponent=+(m[3]||0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>160)throw Error('숫자 자릿수를 확인해 주세요.');
 let digits=m[1]+(m[2]||'');const point=m[1].length+exponent;
 if(point<digits.length){if(/[1-9]/.test(digits.slice(Math.max(point,0))))throw Error('소수 값은 사용할 수 없습니다.');digits=digits.slice(0,Math.max(point,0));}
 else digits+='0'.repeat(point-digits.length);
 digits=digits.replace(/^0+/,'')||'0';
 if(digits.length>maxDigits)throw Error(maxDigits===15?'Excel 숫자 셀의 15자리 정밀도 한계를 넘습니다. 원래 전체 값을 텍스트로 연결해 주세요.':'숫자가 너무 큽니다.');
 return digits;
}
function identifierValue(value,numeric=false,format='General'){
 const v=text(value);if(!v)return v;
 if(!numeric){
  if(/^[+]?\d+(?:\.\d*)?[eE][+-]?\d*$/.test(v))throw Error('텍스트로 표시된 지수 값에서 원래 식별자를 확인할 수 없습니다. 원본 Excel 파일이나 전체 식별자 텍스트를 사용하세요.');
  return v;
 }
 const digits=storedInteger(v,15);
 const mask=(format||'').split(';',1)[0].trim();
 const width=/^#*0{1,64}$/.test(mask)?(mask.match(/0+$/)[0].length):0;
 return digits.padStart(width,'0');
}
function quantityValue(value,numeric=false){
 if(numeric){const n=+storedInteger(value,16);if(Number.isSafeInteger(n))return n;}
 else{
  const s=text(value).normalize('NFKC');
  if(/^\+?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(s)){
   const n=+s.replace(/,/g,'');if(Number.isSafeInteger(n))return n;
  }
 }
 throw Error('예정 수량은 0 이상의 정수여야 합니다.');
}
function orderDateText(value){
 const v=text(value);if(!v)return '';
 const match=v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:(?:T|\s)(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?))?$/)||v.match(/^(\d{4})(\d{2})(\d{2})$/);
 if(!match)return v;
 const [,y,m,d,time]=match,day=y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0'),dt=new Date(day+'T00:00:00Z');
 if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==day)throw Error('주문일의 연·월·일을 확인해 주세요.');
 return time?day+' '+time:day;
}
function rawReturnDay(value){
 try{
  const d=orderDateText(value);return /^\d{4}-\d{2}-\d{2}(?:$| )/.test(d)?d.slice(0,10):'';
 }catch{return '';}
}
function excelDateValue(value,date1904){
 const s=text(value);
 if(/^\d{8}$/.test(s))return orderDateText(s);
 if(s.length>80||!/^\+?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(s))throw Error('주문일을 확인해 주세요.');
 const n=Number(s),day=Math.floor(n);
 if(!Number.isFinite(n)||day<(date1904?0:1)||day>2958465||(!date1904&&day===60))throw Error('Excel 주문일 일련번호를 확인해 주세요.');
 const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,31)-(day>=61?86400000:0);
 // Order date is a day field; avoid timezone conversion of Excel serials.
 const d=new Date(base+day*86400000).toISOString().slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d))throw Error('Excel 주문일이 지원 범위를 벗어났습니다.');
 return d;
}
function headerKey(v){return v==null?'':String(v);}
function headerIndex(kind,rows,mapping){return Number.isInteger(mapping?.headerRow)?mapping.headerRow:-1;}
function table(kind,rows,mapping){if(kind==='phoneOrders')return PhoneOrderCore.table('orders',rows,mapping);const index=mapping?.headerRow;if(!Array.isArray(rows)||!Number.isInteger(index)||index<0||index>=rows.length)throw Error('제목 행과 열 연결을 먼저 선택하세요.');const columns=MappingCore.validateColumns(kind,rows[index],mapping.columns),records=[],customerNames=Object.create(null),phoneRecords=[],importSummary={missingIdentifier:0,missingLocation:0,skuOnly:0};const brandColumn=kind==='raw'||kind==='sku'?optionalBrandColumn(rows[index],columns):undefined;const channelMapped=kind==='raw'&&Object.hasOwn(columns,'returnChannel'),channelValues=channelMapped?(returnChannelValues(mapping.returnChannelValues)||{b2b:'B2B',b2c:'B2C'}):null,channelLookup=channelValues?new Map(['b2b','b2c'].flatMap(mode=>[].concat(channelValues[mode]).map(code=>[code,mode]))):null;for(let i=index+1;i<rows.length;i++){const r=rows[i];if(!r.some(v=>text(v)))continue;const get=k=>['receipt','external','barcode','sku','returnTracking'].includes(k)?identifierValue(r[columns[k]]):text(r[columns[k]]),barcode=get('barcode'),sku=get('sku'),brand=brandColumn===undefined?'':text(r[brandColumn]);if(kind==='raw'){const receipt=get('receipt');let qty;try{qty=quantityValue(r[columns.qty]);}catch(error){throw Error((i+1)+'행: '+error.message);}if(!receipt)throw Error(`${i+1}행: 주문 식별자가 비어 있습니다.`);if(Object.hasOwn(columns,'customerPhone')){const value=r[columns.customerPhone];if(String(value??'').trim()){const phone=PhoneOrderCore.normalizePhone(value);if(phone.status!=='ok')throw Error(`${i+1}행: 고객 전화번호를 확인하세요. 7~15자리 전체 번호를 입력하거나 원본 Excel 파일을 연결하세요.`);phoneRecords.push({id:receipt,phoneKey:phone.key,phoneMask:phone.mask});}}const customer=get('customerName');if(customer){if(customer.length>4096)throw Error(`${i+1}행: 고객명은 4096자 이하여야 합니다.`);(customerNames[receipt]??=new Set()).add(customer);}const expectedInventoryStatus=normalizeExpectedInventoryStatus(get('expectedInventoryStatus'));records.push({receipt,barcode,sku,name:get('name'),...(expectedInventoryStatus?{expectedInventoryStatus}:{}),...(brand?{brand}:{}),qty,seller:get('seller')||get('company'),company:get('company'),address:get('address'),external:get('external'),returnTracking:get('returnTracking'),memo:get('memo'),...(get('date')?{date:rawReturnDay(get('date'))}:{}),...(channelMapped?{returnChannel:(v=>v?(channelLookup.get(v)||'unknown'):'')((channelValues.exact?returnChannelExact:returnChannelKey)(get('returnChannel')))}:{}),...(!barcode&&!sku?{unresolvedId:'row-'+(i+1)}:{})});}else if(kind==='sku'){if(!barcode&&!sku)throw Error(`${i+1}행: 상품 식별 정보가 비어 있습니다.`);records.push({barcode,sku,name:get('name'),...(brand?{brand}:{})});}else{const loc=get('loc');if(!barcode&&!sku){importSummary.missingIdentifier++;continue;}if(!loc){importSummary.missingLocation++;continue;}if(!barcode)importSummary.skuOnly++;records.push({barcode,sku,loc,locationType:get('locationType'),zone:get('zone'),putawayZone:get('putawayZone'),warehouse:get('warehouse')});}}if(kind==='raw'){if(!Number.isSafeInteger(records.reduce((n,r)=>n+r.qty,0)))throw Error('총 예정 수량이 너무 큽니다.');const totals=new Map();for(const r of records){const k=JSON.stringify([r.receipt,key(r)]);totals.set(k,(totals.get(k)||0)+r.qty);if(!Number.isSafeInteger(totals.get(k)))throw Error('합산 예정 수량이 너무 큽니다.');}}if(kind==='raw')Object.defineProperty(records,'customerNames',{value:Object.fromEntries(Object.entries(customerNames).map(([id,names])=>[id,[...names]])),enumerable:false,configurable:true});if(kind==='raw')Object.defineProperty(records,'phoneRecords',{value:phoneRecords,enumerable:false,configurable:true});if(kind==='loc')Object.defineProperty(records,'importSummary',{value:importSummary,enumerable:false});return records;}

// Advisory only: rank expected codes by how evenly they divide active ASNs.
// Absence is not recorded or treated as evidence; this never modifies inspection data.
function suggest(raw,receiptIds,entered=[],limit=2){const active=new Set(receiptIds);if(active.size<2)return [];const rows=raw.filter(r=>active.has(r.receipt)),index=new Map(),proposals=new Set();for(const r of rows){if(r.qty>0&&(r.barcode||r.sku))proposals.add(r.barcode||r.sku);for(const code of new Set([r.barcode,r.sku].filter(Boolean))){if(!index.has(code))index.set(code,[]);index.get(code).push(r);}}const ranked=[];for(const code of proposals){const matched=index.get(code)||[],receipts=new Set(matched.map(r=>r.receipt));if(receipts.size===active.size||!receipts.size)continue;if(entered.some(e=>matched.some(r=>matches(r,e))))continue;const perReceipt=new Map();for(const r of matched){if(!perReceipt.has(r.receipt))perReceipt.set(r.receipt,new Set());perReceipt.get(r.receipt).add(key(r));}if([...perReceipt.values()].some(keys=>keys.size>1))continue;const skus=[...new Set(matched.map(r=>r.sku).filter(Boolean))],names=[...new Set(matched.map(r=>r.name).filter(Boolean))];if(skus.length>1||names.length>1)continue;const count=receipts.size;ranked.push({code,sku:skus[0]||'',name:names[0]||'',score:count*(active.size-count),membership:[...receipts].sort().join('\u001f')});}ranked.sort((a,b)=>b.score-a.score||a.code.localeCompare(b.code,'en'));const selected=[],seen=new Set();for(const item of ranked){if(seen.has(item.membership))continue;seen.add(item.membership);selected.push({code:item.code,sku:item.sku,name:item.name});if(selected.length>=limit)break;}return selected;}
function validEvent(r){return r&&(r.scanOutcome===undefined||['accepted','excess','unknown','conflict','held'].includes(r.scanOutcome))&&typeof eventCode(r)==='string'&&eventCode(r).trim()&&Number.isFinite(Date.parse(r.at))&&Number.isSafeInteger(units(r))&&units(r)>0;}
function validateSession(s,{preserveIndex=false}={}){if(s?.searchMode!==undefined&&!['b2b','b2c'].includes(s.searchMode))throw Error('검색 방식 설정이 올바르지 않습니다.');if(s?.version!==1||!s.data||!Array.isArray(s.scans)||!['raw','sku','loc'].every(k=>Array.isArray(s.data[k])))throw Error('지원하지 않는 작업파일입니다.');MappingCore.checkedCustomerNames(s.customerNames,s.data.raw);for(const r of s.data.raw)if(typeof r.receipt!=='string'||!r.receipt.trim()||typeof r.barcode!=='string'||!Number.isSafeInteger(r.qty)||r.qty<0)throw Error('예정 데이터가 올바르지 않습니다.');for(const k of ['sku','loc'])for(const r of s.data[k])if(typeof r.barcode!=='string')throw Error('기준 데이터가 올바르지 않습니다.');for(const r of s.scans)if(!validEvent(r)||typeof r.receipt!=='string'||!r.receipt.trim())throw Error('검수 기록이 올바르지 않습니다.');if(s.confirmations!==undefined&&(!Array.isArray(s.confirmations)||s.confirmations.some(c=>!c||typeof c.receipt!=='string'||!c.receipt||typeof c.batch!=='string'||typeof c.signature!=='string'||(c.outcome!==undefined&&!['matched','difference'].includes(c.outcome))||!Number.isFinite(Date.parse(c.at)))))throw Error('검수 확인 기록이 올바르지 않습니다.');if(s.pending!==undefined&&!Array.isArray(s.pending))throw Error('보류 스캔 형식이 올바르지 않습니다.');for(const r of s.pending||[])if(!validEvent(r))throw Error('보류 기록이 올바르지 않습니다.');if(s.archivedScans!==undefined&&(!Array.isArray(s.archivedScans)||s.archivedScans.some(e=>!validEvent(e)||typeof e.receipt!=='string'||!e.receipt)))throw Error('이전 작업 검수 기록이 올바르지 않습니다.');if(s.archivedPending!==undefined&&(!Array.isArray(s.archivedPending)||s.archivedPending.some(e=>!validEvent(e))))throw Error('이전 작업 보류 기록이 올바르지 않습니다.');if(s.audit!==undefined){if(!Array.isArray(s.audit))throw Error('이력 형식이 올바르지 않습니다.');for(const a of s.audit)if(!a||typeof a.id!=='string'||!Number.isFinite(Date.parse(a.at))||typeof a.action!=='string'||!Array.isArray(a.events)||a.events.some(e=>!validEvent(e)))throw Error('이력 사건이 올바르지 않습니다.');}for(const kind of ['raw','sku','loc'])for(const r of s.data[kind])for(const [k,v]of Object.entries(r))if(k!=='qty'&&typeof v!=='string')throw Error('셀 값은 텍스트여야 합니다.');if(s.storeSelection!==undefined&&(!s.storeSelection||typeof s.storeSelection!=='object'||Array.isArray(s.storeSelection)||!['name','company','address'].every(k=>typeof s.storeSelection[k]==='string')||!s.storeSelection.name.trim()||s.store!==s.storeSelection.name))throw Error('매장 선택 정보가 올바르지 않습니다.');if(s.sources!==undefined&&(!s.sources||typeof s.sources!=='object'||Array.isArray(s.sources)))throw Error('출처 형식이 올바르지 않습니다.');if(s.receiptLocked!==undefined&&(typeof s.receiptLocked!=='boolean'||(s.receiptLocked&&!s.receipt)))throw Error('검수 대상 고정 상태가 올바르지 않습니다.');if(s.availabilityEnabled!==undefined&&typeof s.availabilityEnabled!=='boolean')throw Error('피킹 위치 안내 설정이 올바르지 않습니다.');if(s.autoPaused!==undefined&&typeof s.autoPaused!=='boolean')throw Error('자동 연결 상태가 올바르지 않습니다.');for(const e of [...s.scans,...(s.pending||[]),...(s.archivedPending||[]),...(s.archivedScans||[])]){if(e.holdForStore!==undefined&&(typeof e.holdForStore!=='string'||typeof e.holdOrigin!=='string'))throw Error('보류 배정 정보가 올바르지 않습니다.');if(e.allocationConfirmed!==undefined&&typeof e.allocationConfirmed!=='boolean')throw Error('배정 상태가 올바르지 않습니다.');}for(const e of [...s.scans,...(s.pending||[]),...(s.archivedPending||[]),...(s.archivedScans||[])])if(e.batch!==undefined&&typeof e.batch!=='string')throw Error('묶음 식별자가 올바르지 않습니다.');for(const k of ['receipt','store','currentBatch','assignment'])if(s[k]!==undefined&&typeof s[k]!=='string')throw Error('조회 조건이 올바르지 않습니다.');if(!Number.isSafeInteger([...s.scans,...(s.pending||[]),...(s.archivedPending||[]),...(s.archivedScans||[])].reduce((n,r)=>n+units(r),0))||!Number.isSafeInteger(s.data.raw.reduce((n,r)=>n+r.qty,0)))throw Error('총 수량이 너무 큽니다.');if(!preserveIndex)invalidate(s.data);for(const receipt of getIndex(s.data).rawByReceipt.keys())reconcile(s.data,receipt,[]);return s;}
return {getIndex,invalidate,parseDelimited,identifierValue,quantityValue,excelDateValue,orderDateText,headerKey,headerIndex,table,masterInfo,reconcile,validateSession,key,units,eventCode,matches,storeMatches,suggest,asnProgress};})();
if(typeof module!=='undefined')module.exports=Engine;

function readWorkbook(file,wantedKind,onProgress,hooks){
 return readSpreadsheet(file,wantedKind,onProgress,hooks,{Engine,MappingCore,PhoneOrderCore,returnChannelExact,language});
}

// Lookup-only data. Never attach this cache to inspection state or backup objects.
const PhoneOrderCore=(()=>{
 const fields={returns:[['id','반품 오더 식별자',true],['phone','반품 고객 전화번호',true]],orders:[['id','원주문 식별자',true],['phone','원주문 고객 전화번호',true],['sku','상품 코드'],['barcode','상품 바코드'],['date','주문일'],['name','상품명']]};
 const clean=v=>typeof v==='string'?v.trim():v==null?'':String(v).trim();
 const phoneError='전화번호를 확인하세요. 7~15자리 전체 번호를 입력하거나 원본 Excel 파일을 연결하세요.';
 // On XLSX input use the exact stored value, not its rounded on-screen display.
 function excelPhone(raw,format){
  const fmt=(format||'').split(';',1)[0].trim(),pattern=fmt.replace(/"([+ ()-]+)"/g,'$1').replace(/\\([+ ()-])/g,'$1');
  const isPhoneMask=/^\+?[0# ()-]+$/.test(pattern)&&pattern.includes('0');
  const width=isPhoneMask?(pattern.match(/0/g)||[]).length:0;
  if(width>15)throw Error(phoneError);
  let digits;
  try{digits=Engine.identifierValue(raw,true,'General');}catch{throw Error(phoneError);}
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
  for(const[k,label,required]of defs)if(required&&!Object.hasOwn(out,k))throw Error(label+' 열을 연결하세요.');return out;
 }
 function table(kind,rows,mapping){
  const n=mapping?.headerRow;if(!Number.isInteger(n)||n<0||n>=rows.length)throw Error('열 제목 행을 선택하세요.');const cols=validate(kind,rows[n],mapping.columns),out=[];
  for(let i=n+1;i<rows.length;i++){const row=rows[i];if(!row.some(v=>clean(v)))continue;const id=clean(row[cols.id]);if(!id||id.length>4096||/^[+]?\d+(?:\.\d*)?[eE][+-]?\d*$/.test(id))throw Error((i+1)+'행: 주문 식별자를 확인하세요.');
   const phone=normalizePhone(row[cols.phone]);if(phone.status!=='ok')throw Error((i+1)+'행: '+phoneError);
   const obj={id,phoneKey:phone.key,phoneMask:phone.mask};for(const k of ['sku','barcode','date','name']){const v=Object.hasOwn(cols,k)?clean(row[cols[k]]):'';if(['sku','barcode'].includes(k)&&/^[+]?\d+(?:\.\d*)?[eE][+-]?\d*$/.test(v))throw Error((i+1)+'행: 상품 식별자 지수 표기는 사용할 수 없습니다.');if(v.length>4096)throw Error((i+1)+'행: 조회 정보가 너무 깁니다.');obj[k]=v;}out.push(obj);
  }return out;
 }
 async function build(kind,records,allowedIds){
  if(!fields[kind]||!Array.isArray(records)||records.length>200000)throw Error('조회 자료는 역할별 최대 200,000행입니다.');if(!records.length)throw Error('조회 자료 행이 없습니다.');
  const tokens=new Map(),byId=new Map(),byPhone=new Map();let count=0;
  for(const r of records){if(!r||typeof r.id!=='string'||!r.id.trim()||r.id!==r.id.trim()||r.id.length>4096||['sku','barcode','date','name'].some(k=>r[k]!=null&&(typeof r[k]!=='string'||r[k].length>4096)))throw Error('조회 자료 레코드가 올바르지 않습니다.');const phone=normalizePhone(r.phoneKey);if(phone.status!=='ok'||phone.key!==r.phoneKey)throw Error('전화번호 조회 키가 올바르지 않습니다.');if(kind==='returns'&&allowedIds&&!allowedIds.has(r.id))throw Error('현재 반품 예정 자료에 없는 오더가 있습니다. 오더 식별자 연결을 확인하세요.');
   let token=tokens.get(r.phoneKey);if(!token){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('warehouse-kit-phone-lookup-v1\0'+r.phoneKey));token=Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');tokens.set(r.phoneKey,token);}
   const safe={id:r.id,token,mask:phone.mask,sku:r.sku||'',barcode:r.barcode||'',date:r.date||'',name:r.name||''};
   if(!byId.has(safe.id))byId.set(safe.id,[]);byId.get(safe.id).push(safe);if(!byPhone.has(token))byPhone.set(token,[]);byPhone.get(token).push(safe);
   if(++count%256===0)await new Promise(r=>setTimeout(r,0));
  }
  tokens.clear();return {kind,byId,byPhone,count};
 }
 function find(returns,orders,receipt,products=[]){
  if(!returns||!orders)return {status:'not-loaded',candidates:[],masks:[]};const phones=returns.byId.get(receipt)||[];if(!phones.length)return {status:'no-return-phone',candidates:[],masks:[]};
  const unique=new Map(phones.map(r=>[r.token,r.mask])),candidates=new Map(),required=new Set(),bySku=new Map(),byBarcode=new Map(),byBarcodeNoSku=new Map(),idConflicts=new Map();
  const add=(map,k,id)=>{if(!k)return;if(!map.has(k))map.set(k,new Set());map.get(k).add(id);};
  for(const p of products){if(!p.sku&&!p.barcode)continue;const id=JSON.stringify([p.sku||'',p.barcode||'']);required.add(id);add(bySku,p.sku,id);add(byBarcode,p.barcode,id);if(!p.sku)add(byBarcodeNoSku,p.barcode,id);}
  for(const[token,mask]of unique)for(const row of orders.byPhone.get(token)||[]){const k=JSON.stringify([row.id,token]);if(!candidates.has(k))candidates.set(k,{id:row.id,mask,matched:new Set(),products:new Set(),dates:new Set(),names:new Set()});const c=candidates.get(k);if(row.sku)c.products.add('S:'+row.sku);if(row.barcode)c.products.add('B:'+row.barcode);if(row.date)c.dates.add(row.date);if(row.name)c.names.add(row.name);
   if(row.sku)for(const id of bySku.get(row.sku)||[])c.matched.add(id);for(const id of (row.sku?byBarcodeNoSku:byBarcode).get(row.barcode)||[])c.matched.add(id);
  }
  const out=[...candidates.values()].map(c=>{if(!idConflicts.has(c.id))idConflicts.set(c.id,new Set((orders.byId.get(c.id)||[]).map(r=>r.token)).size>1);return {id:c.id,mask:c.mask,matched:c.matched.size,total:required.size,dates:[...c.dates],names:[...c.names],products:[...c.products],conflict:c.dates.size>1||idConflicts.get(c.id)};}).sort((a,b)=>b.matched-a.matched||a.id.localeCompare(b.id));
  return {status:out.length?'found':'no-match',multiplePhones:unique.size>1,masks:[...new Set(unique.values())],candidates:out};
 }
 return {fields,normalizePhone,excelPhone,validate,table,build,find};
})();

const PhoneOrderUI=(()=>{
 let api,cache={returns:null,orders:null},bound=null,generation=0,lastContext='',busy=false;
 const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const same=(a,b)=>a&&b&&a.data===b.data&&a.batch===b.batch;
 const context=()=>api.getContext();
 function clear(){cache={returns:null,orders:null};bound=null;generation++;lastContext='';if(api){api.result.replaceChildren();api.paste.value='';api.error.textContent='';api.status.textContent='조회 자료는 작업파일에 저장되지 않습니다. 다시 열면 재불러오세요.';}}
 function sync(){if(!api)return;const c=context();if(bound&&!same(bound,c)){if(bound.data===c.data){bound=c;generation++;lastContext='';}else clear();}const key=String(c.batch)+'\0'+String(c.b2c)+'\0'+c.receipt+'\0'+(c.store||'');if(key!==lastContext){lastContext=key;api.result.replaceChildren();api.details.open=false;}api.details.hidden=!c.b2c||!c.receipt;}
 async function install(kind,records,capture=context()){
  const gen=generation,prepared=await PhoneOrderCore.build(kind,records,kind==='returns'?new Set(capture.raw.map(r=>r.receipt)):null);
  if(gen!==generation||!same(capture,context()))throw Error('작업이나 기준 자료가 바뀌었습니다. 다시 불러오세요.');
  if(bound&&!same(bound,capture))clear();bound=capture;cache[kind]=prepared;api.result.replaceChildren();api.status.textContent='반품 전화 '+(cache.returns?.count||0)+'행 · 원주문 '+(cache.orders?.count||0)+'행 · 현재 세션 전용';return prepared.count;
 }
 function query(){sync();const c=context();api.result.replaceChildren();if(!c.b2c||!c.receipt)return;const answer=PhoneOrderCore.find(cache.returns,cache.orders,c.receipt,c.raw.filter(r=>r.receipt===c.receipt));
  const states={'not-loaded':'기준 데이터의 통합 RAW에서 반품 고객 전화번호와 원주문 시트를 연결하세요.','no-return-phone':'이 반품 오더의 전화 조회 자료가 없습니다.','no-match':'동일 전화번호의 원주문 후보가 없습니다.'};
  api.result.append(el('p',states[answer.status]||`${answer.candidates.length}개 원주문 후보 · 상품 코드/바코드 정확 일치순`));
  if(answer.masks.length)api.result.append(el('p',answer.masks.slice(0,3).join(' / ')+(answer.masks.length>3?' 외 '+(answer.masks.length-3)+'개':''),{class:'small'}));if(answer.multiplePhones)api.result.append(el('p','이 반품 오더에 여러 전화번호가 연결되어 있습니다. 확인이 필요합니다.',{class:'notice'}));
  if(answer.candidates.length){const list=el('ul',undefined,{class:'phone-order-candidates'}),pager=el('div',undefined,{class:'phone-actions'}),previous=el('button','이전',{type:'button'}),pageLabel=el('span','',{role:'status'}),next=el('button','다음',{type:'button'});let page=0;const pageSize=50,origin=lastContext,epoch=generation;
   const sample=(values,n)=>values.slice(0,n).join(' · ')+(values.length>n?' · 외 '+(values.length-n)+'개':'');
   const fullInfo=(li,item)=>{if(item.products.length<=8&&item.names.length<=5&&item.dates.length<=3)return;const detail=el('details'),title=el('summary','상품 정보 모두 보기'),rows=el('div'),actions=el('div',undefined,{class:'phone-actions'}),prev=el('button','앞 정보',{type:'button'}),label=el('span'),after=el('button','다음 정보',{type:'button'});let part=0;const count=item.products.length+item.names.length+item.dates.length,size=50,at=i=>i<item.products.length?item.products[i].replace(/^S:/,'SKU ').replace(/^B:/,'Barcode '):i<item.products.length+item.names.length?'상품명 '+item.names[i-item.products.length]:'주문일 '+item.dates[i-item.products.length-item.names.length];const show=()=>{if(origin!==lastContext||epoch!==generation)return;rows.replaceChildren();for(let i=part*size;i<Math.min(count,(part+1)*size);i++)rows.append(el('p',at(i),{class:'small'}));prev.disabled=part===0;after.disabled=(part+1)*size>=count;label.textContent=(part+1)+' / '+Math.ceil(count/size)+' · 정보 '+count+'개';};prev.onclick=()=>{if(part>0){part--;show();}};after.onclick=()=>{if((part+1)*size<count){part++;show();}};detail.ontoggle=()=>{if(detail.open)show();};actions.append(prev,label,after);detail.append(title,rows,actions);li.append(detail);};
   const drawPage=()=>{sync();if(origin!==lastContext||epoch!==generation)return;list.replaceChildren();for(const item of answer.candidates.slice(page*pageSize,(page+1)*pageSize)){const li=el('li'),head=el('div');head.append(el('strong',item.id),el('span',item.total?`상품 ${item.matched} / ${item.total} 일치`:'대조할 상품 식별자 없음'));li.append(head,el('p',item.mask+(item.dates.length?' · '+sample(item.dates,3):''),{class:'small'}));if(item.names.length)li.append(el('p',sample(item.names,5)));if(item.products.length)li.append(el('p',sample(item.products.slice(0,8).map(x=>(x.startsWith('S:')?'SKU ':'Barcode ')+x.slice(2)),8)+(item.products.length>8?' · 외 '+(item.products.length-8)+'개':''),{class:'small'}));if(item.conflict)li.append(el('p','같은 원주문에 서로 다른 전화번호 또는 주문일이 있습니다. 원본을 확인하세요.',{class:'notice'}));fullInfo(li,item);list.append(li);}previous.disabled=page===0;next.disabled=(page+1)*pageSize>=answer.candidates.length;pageLabel.textContent=(page+1)+' / '+Math.ceil(answer.candidates.length/pageSize)+' 페이지 · 총 '+answer.candidates.length+'개';};previous.onclick=()=>{if(page>0){page--;drawPage();}};next.onclick=()=>{if((page+1)*pageSize<answer.candidates.length){page++;drawPage();}};pager.append(previous,pageLabel,next);api.result.append(list,pager);drawPage();
  }
  api.result.append(el('p','조회 후보만 표시합니다. 원주문은 자동 확정하지 않습니다.',{class:'small'}));
 }
 function ask(title,render){return new Promise((resolve,reject)=>{const d=el('dialog',undefined,{class:'phone-mapping-dialog'}),h=el('h2',title),body=el('div'),error=el('p','',{role:'alert'}),actions=el('div',undefined,{class:'phone-actions'}),ok=el('button','연결'),cancel=el('button','취소');ok.type=cancel.type='button';const get=render(body);actions.append(cancel,ok);d.append(h,body,error,actions);document.body.append(d);const done=(value,fail)=>{d.close();d.remove();fail?reject(new Error('조회 자료 연결을 취소했습니다.')):resolve(value);};ok.onclick=()=>{try{done(get());}catch(e){error.textContent=e.message;}};cancel.onclick=()=>done(null,true);d.addEventListener('cancel',e=>{e.preventDefault();done(null,true);});d.showModal();});}
 async function mapping(kind,rows){return ask('조회 자료 열 연결',body=>{const rowSelect=el('select',undefined,{'aria-label':'열 제목 행'}),fields=el('div'),selects={};for(let i=0;i<Math.min(100,rows.length);i++){const o=el('option',(i+1)+'행');o.value=i;rowSelect.append(o);}body.append(el('label','열 제목 행'),rowSelect,fields);const draw=()=>{fields.replaceChildren();for(const[k,label,required]of PhoneOrderCore.fields[kind]){const sel=el('select',undefined,{'aria-label':label}),none=el('option','연결 안 함');none.value='';sel.append(none);(rows[+rowSelect.value]||[]).forEach((v,i)=>{if(v==null||String(v)==='')return;const o=el('option',String(v));o.value=i;sel.append(o);});selects[k]=sel;fields.append(el('label',label+(required?' *':'')),sel);}};draw();rowSelect.onchange=draw;return()=>{const headerRow=+rowSelect.value,columns={};for(const[k,n]of Object.entries(selects))if(n.value!=='')columns[k]=+n.value;return {headerRow,columns:PhoneOrderCore.validate(kind,rows[headerRow],columns)};};});}
 async function importData(file){if(busy)return;busy=true;api.importButton.disabled=api.fileButton.disabled=true;const capture=context(),epoch=generation;try{const kind=api.kind.value;if(file&&file.size>30*1024*1024)throw Error('조회 파일은 최대 30MB입니다.');let records;
  if(file&&/\.xls[xm]$/i.test(file.name)){
   const adapter={kinds:['phoneReturns','phoneOrders'],phoneField:'phone',identifierFields:['id','sku','barcode'],validateColumns:(k,h,c)=>PhoneOrderCore.validate(k==='phoneReturns'?'returns':'orders',h,c),table:(k,r,m)=>PhoneOrderCore.table(k==='phoneReturns'?'returns':'orders',r,m)};
   const wanted=kind==='returns'?'phoneReturns':'phoneOrders';const parsed=await api.readWorkbook(file,wanted,null,{referenceAdapter:adapter,selectSheets:({sheets})=>ask('조회 시트 선택',body=>{const s=el('select',undefined,{'aria-label':'조회 시트'});for(const sh of sheets){const o=el('option',sh.name);o.value=sh.index;s.append(o);}body.append(s);return()=>[{kind:wanted,sheetIndex:+s.value}];}),selectColumns:({rows})=>mapping(kind,rows)});records=parsed[wanted];
  }else{const text=file?await file.text():api.paste.value;if(text.length>16*1024*1024)throw Error('조회 텍스트는 최대 16MB입니다.');const rows=api.parseDelimited(text,api.delimiter.value==='csv'?',':'\t');const map=await mapping(kind,rows);records=PhoneOrderCore.table(kind,rows,map);}
  if(epoch!==generation)throw Error('조회 자료 연결이 취소되었습니다.');await install(kind,records,capture);records.length=0;api.paste.value='';api.error.textContent='불러왔습니다. 조회 자료는 현재 세션에서만 사용합니다.';
 }catch(e){api.error.textContent=e.message;}finally{busy=false;api.importButton.disabled=api.fileButton.disabled=false;api.file.value='';}}
 function init(options){
  const dialog=el('dialog',undefined,{id:'phoneLookupSettings',class:'phone-mapping-dialog'}),close=el('button','닫기'),kind=el('select',undefined,{'aria-label':'조회 자료 역할'});for(const[v,label]of [['returns','반품 오더 · 전화번호'],['orders','원주문 · 전화번호 · 상품']]){const o=el('option',label);o.value=v;kind.append(o);}
  close.type='button';close.onclick=()=>dialog.close();const paste=el('textarea',undefined,{rows:'5','aria-label':'조회 자료 붙여넣기',placeholder:'열 제목을 포함해 붙여넣으세요.'}),delimiter=el('select',undefined,{'aria-label':'텍스트 구분 방식'});for(const[v,t]of [['tsv','탭으로 구분'],['csv','쉼표로 구분']]){const o=el('option',t);o.value=v;delimiter.append(o);}const file=el('input',undefined,{type:'file',accept:'.xlsx,.xlsm,.csv,.tsv,.txt',hidden:''}),fileButton=el('button','파일 불러오기'),importButton=el('button','붙여넣기 연결'),clearButton=el('button','조회 자료 비우기'),error=el('p','',{role:'status'}),status=el('p','조회 자료는 작업파일에 저장되지 않습니다. 다시 열면 재불러오세요.',{class:'small'}),actions=el('div',undefined,{class:'phone-actions'});for(const b of[fileButton,importButton,clearButton])b.type='button';actions.append(fileButton,importButton,clearButton);dialog.append(el('h2','원주문 전화 조회 자료'),close,el('label','조회 자료 역할'),kind,status,el('p','전화번호는 구분기호만 제거합니다. +·선행 0은 유지하며 국가번호를 추정하지 않습니다.',{class:'small'}),el('p','엑셀 숫자 셀은 사용할 수 없습니다. 원본 전화번호를 텍스트로 준비하세요.',{class:'small'}),delimiter,paste,actions,file,error);document.body.append(dialog);dialog.addEventListener('close',()=>{paste.value='';error.textContent='';generation++;});
  const launcher=el('button','원주문 조회 자료',{id:'phoneLookupLauncher',type:'button'});launcher.onclick=()=>{sync();dialog.showModal();};launcher.hidden=true;document.getElementById('fileMenuPanel').append(launcher);
  const details=el('details',undefined,{id:'phoneOrderLookup',class:'phone-order-lookup'}),summary=el('summary','원주문 찾기'),queryButton=el('button','전화번호로 후보 조회',{type:'button',id:'phoneOrderQuery'}),result=el('div',undefined,{role:'status',id:'phoneOrderResults'});details.append(summary,queryButton,result);document.querySelector('.work-overview').insertAdjacentElement('afterend',details);
  api={...options,dialog,kind,paste,delimiter,file,fileButton,importButton,error,status,result,details};queryButton.onclick=query;fileButton.onclick=()=>file.click();file.onchange=()=>{if(file.files[0])importData(file.files[0]);};importButton.onclick=()=>importData();clearButton.onclick=()=>{clear();paste.value='';error.textContent='조회 자료를 비웠습니다.';};sync();
 }
 function commitPrepared(prepared){bound=context();generation++;for(const [kind,value] of Object.entries(prepared))cache[kind]=value;api.result.replaceChildren();api.status.textContent='현재 세션 전용';sync();}
 function count(kind){return cache[kind]?.count||0;}
 function rebindCategoryOnly(previous){if(!api||!bound||bound.data!==previous)return;const now=context();if(now.batch!==bound.batch)return;bound=now;generation++;lastContext='';api.result.replaceChildren();api.details.open=false;}
 return {init,sync,clear,install,query,commitPrepared,count,rebindCategoryOnly};
})();

let language='ko';try{language=localStorage.getItem('returns-app-language')==='en'?'en':'ko';}catch{}
/* Local mapping preferences are intentionally separate from work state/JSON. */
// The component owns meaning and accessibility; the sprite owns artwork.
function beamIcon(role){return '<svg class="beam-ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#beam-glyph-'+role+'"/></svg>';}
const MappingUI=(()=>{
 const KEY='logistics-local-mapping-v1',kinds=['raw','sku','loc','phoneOrders'];
 // Mapping profiles are local operator inputs, not bundled warehouse presets.
 function validateLocationRules(r){
  if(r===undefined)return {eligibleTypes:[],zoneSeparator:''};
  if(!r||typeof r!=='object'||!Array.isArray(r.eligibleTypes)||r.eligibleTypes.length>100||
   r.eligibleTypes.some(v=>typeof v!=='string'||!v.trim()||v.length>128||/[\r\n]/u.test(v))||
   typeof r.zoneSeparator!=='string'||(r.zoneSeparator&&!/^[-/._:]$/.test(r.zoneSeparator)))throw Error('Invalid location rules');
  return {eligibleTypes:[...new Set(r.eligibleTypes.map(locationTypeKey))],zoneSeparator:r.zoneSeparator};
 }
 function locationRules(){return db.profiles[db.active]?.locationRules||{eligibleTypes:[],zoneSeparator:''};}
 async function editLocationRules(){
  if(busy)return;
  const active=db.active,before=locationRules();
  try{
   const value=await modal(t('위치 표시 규칙','Location display rules'),body=>{
    const typeLabel=node('label',t('피킹에 사용할 위치 유형 (한 줄에 하나)','Eligible picking location types (one per line)'));
    const input=node('textarea',undefined,{value:before.eligibleTypes.join('\n'),rows:4});typeLabel.append(input);
    const zoneLabel=node('label',t('Zone 열이 없을 때의 구분자 (선택)','Optional separator if no zone is mapped'));
    const sep=node('select');for(const v of ['','-','/','.','_',':'])option(sep,v,v||t('사용 안 함','None'));sep.value=before.zoneSeparator;zoneLabel.append(sep);
    body.append(typeLabel,zoneLabel,node('p',t('지정한 유형만 표시합니다. 비워두면 피킹 위치를 표시하지 않습니다. Zone 열이 연결되어 있으면 그 값을 우선합니다.','Only explicitly selected types are shown. Leave blank to hide picking locations. A mapped zone takes priority.'),{className:'small'}));
    return ()=>validateLocationRules({eligibleTypes:input.value.split(/\r?\n/u).map(v=>v.trim()).filter(Boolean),zoneSeparator:sep.value});
   },t('저장','Save'));
   if(db.active!==active)return;
   const next=copy(db);next.profiles[active].locationRules=value;persist(next);draw();
  }catch(e){if(e.name!=='AbortError'){storageNote=e.message;refresh();}}
 }
 function labelPapers(){return db.profiles[db.active]?.labelPapers||[];}
 async function editLabelPapers(){
  if(busy)return;
  const active=db.active;
  try{
   const papers=await modal(t('라벨 용지','Label paper'),body=>{
    body.append(node('p',t('A4는 항상 쓸 수 있어요. 라벨지 한 장의 가로·세로를 mm로 등록하세요.','A4 is always available. Add the width and height of one label in mm.'),{className:'small'}));
    const list=node('div'),add=node('button',t('+ 용지 추가','+ Add paper'),{type:'button'});
    const append=(paper={})=>{
     if(list.childElementCount>=12)return;
     const row=node('div',undefined,{className:'product-label-paper-row'});
     const field=(caption,config)=>{const holder=node('label',caption),input=node('input',undefined,config);holder.append(input);row.append(holder);return input;};
     const n=field(t('이름','Name'),{value:paper.name||'',maxLength:48});
     field(t('가로 mm','Width mm'),{type:'number',min:25,max:500,step:0.1,value:paper.width||''});
     field(t('세로 mm','Height mm'),{type:'number',min:25,max:500,step:0.1,value:paper.height||''});
     const del=node('button',t('삭제','Remove'),{type:'button'});del.onclick=()=>{row.remove();add.disabled=false;add.focus();};
     row.append(del);list.append(row);add.disabled=list.childElementCount>=12;return n;
    };
    labelPapers().forEach(append);add.onclick=()=>append()?.focus();body.append(list,add);
    return ()=>validateLabelPapers([...list.children].map(row=>{const [name,width,height]=row.querySelectorAll('input');return {name:name.value,width:Number(width.value),height:Number(height.value)};}));
   },t('저장','Save'));
   if(db.active!==active)return;
   const next=copy(db);next.profiles[active].labelPapers=papers;persist(next);refresh();
  }catch(e){if(e.name!=='AbortError'){storageNote=e.message;refresh();}}
 }
 function dispatchProfile(){return {id:db.active,...validateDispatchProfile(db.profiles[db.active]?.dispatchProfile)};}
 function cartonProfile(){
  const current=db.profiles[db.active];
  const legacy=dispatchProfile().mapping;
  return {id:db.active,mappings:{...(legacy?{outbound:legacy}:{}),...current?.cartonMappings}};
 }
 function saveCartonMapping(active,mode,mapping){
  if(db.active!==active||busy)return;
  const next=copy(db),profile=next.profiles[active];
  profile.cartonMappings=validateCartonMappings({...profile.cartonMappings,[mode]:mapping});
  if(mode==='outbound')profile.dispatchProfile=validateDispatchProfile({fields:dispatchProfile().fields,mapping:{sheet:mapping.sheet,headers:mapping.headers}});
  persist(next);
 }
 async function editDispatchProfile(){
  if(busy)return;
  const previous=dispatchProfile();
  try{
   const value=await modal(t('출고 명세서','Shipment summary'),body=>{
    const labels={internalId:t('내부 주문 식별자 · 바코드','Internal order ID and barcode'),externalId:t('외부 주문 식별자','External order ID'),
      totalCartons:t('전체 박스 수','Total cartons'),store:t('도착 매장','Destination store'),
      country:t('도착 국가','Destination country'),cartonLabels:t('박스 라벨 목록','Carton label list')};
    const options=node('div',undefined,{className:'dispatch-profile-options'});
    const controls=new Map(dispatchFields.map(key=>{
     const label=node('label'),check=node('input',undefined,{type:'checkbox',checked:previous.fields.includes(key)});
     label.append(check,node('span',labels[key]));options.append(label);return [key,check];
    }));
    body.append(options,node('p',t('목적지 열은 출고 기준 파일을 연결할 때 선택하면 이 프로필에 저장돼요.','Destination columns are saved in this profile when you connect the outbound workbook.'),{className:'small'}));
    return ()=>validateDispatchProfile({fields:[...controls].filter(([,check])=>check.checked).map(([key])=>key),mapping:previous.mapping});
   },t('저장','Save'));
   if(db.active!==previous.id)return;
   const next=copy(db);next.profiles[previous.id].dispatchProfile=value;persist(next);
  }catch(e){if(e.name!=='AbortError'){storageNote=e.message;refresh();}}
 }
 const copy=x=>JSON.parse(JSON.stringify(x));
 const blank=()=>({version:1,active:'default',profiles:{default:{name:t('기본 프로필','Default profile'),file:{},paste:{}}}});
 const en=()=>typeof language!=='undefined'&&language==='en';
 const t=(ko,english)=>en()?english:ko;
 const roles={raw:'Return ASN',sku:'SKU Master',loc:'Inventory Locations',phoneOrders:'Original Outbound Orders'};
 const role=k=>roles[k];
 function resolveSavedSheets(sheets,selectedKinds,profiles){
  const byName=new Map();
  for(const sheet of sheets){const matches=byName.get(sheet.name)||[];matches.push(sheet);byName.set(sheet.name,matches);}
  const savedKinds=selectedKinds.filter(k=>Object.hasOwn(profiles,k));
  const bySpelling=new Map();for(const sheet of sheets){const key=MappingCore.comparableHeader(sheet.name),matches=bySpelling.get(key)||[];matches.push(sheet);bySpelling.set(key,matches);}
  const candidates=savedKinds.flatMap(kind=>{const name=profiles[kind].sheetName;if(!name)return [];const matches=byName.get(name)||bySpelling.get(MappingCore.comparableHeader(name))||[];return matches.length===1?[{kind,sheetIndex:matches[0].index}]:[];});
  const counts=new Map();
  for(const c of candidates)counts.set(c.sheetIndex,(counts.get(c.sheetIndex)||0)+1);
  const reused=candidates.filter(c=>counts.get(c.sheetIndex)===1);
  const resolvedKinds=new Set(reused.map(c=>c.kind));
  const confirmKinds=(savedKinds.length?savedKinds:selectedKinds).filter(k=>!resolvedKinds.has(k));
  return {reused,confirmKinds};
 }
 let db=blank(),storageNote='',busy=false,dialog=null,statusNodes=[],localizers=[],storageAvailable=null,profileImport=null,lastWorkbook=null;
 function rememberWorkbook(file,reusable){lastWorkbook=reusable?{file,offer:false}:null;refresh();}
 function offerWorkbookRetry(){if(lastWorkbook)lastWorkbook.offer=true;}
 async function waitForProfileImport(){return profileImport?await profileImport:!busy;}
 function fileMappingCount(profile=db.profiles[db.active]){return Object.keys(profile.file).length;}
 function profileDiagnostic(code,ko,en){return '['+code+'] '+t(ko,en);}
 // Current-window only; no workbook, pasted rows or observed values are serialized in the profile.
 const sessionSources=new Map();
 const sessionKey=(sourceType,kind)=>sourceType+':'+kind;
 function forgetSources(){sessionSources.clear();}
 const node=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;Object.assign(n,attrs);return n;};
 function validateProfile(p,kind){
  if(!p||p.version!==1||p.kind!==kind||typeof p.sheetName!=='string'||p.sheetName.length>1024||!Array.isArray(p.signature)||!p.signature.length||p.signature.length>16384||!p.headerNames||typeof p.headerNames!=='object')throw Error(t('잘못된 매핑 프로필입니다.','Invalid mapping profile.'));
  if(p.signature.some(x=>typeof x!=='string'||!x||x.length>32768)||new Set(p.signature).size!==p.signature.length)throw Error(t('헤더 이름이 누락되거나 중복되었습니다.','Missing or duplicate header names.'));
  const cols=Object.create(null),allowed=new Set(MappingCore.fields(kind).map(f=>f.id));for(const [field,name] of Object.entries(p.headerNames)){if(!allowed.has(field))throw Error('Invalid mapping field');if(typeof name!=='string'||!p.signature.includes(name))throw Error('Invalid mapped header');cols[field]=p.signature.indexOf(name);}
  return MappingCore.makeProfile(kind,p.sheetName,[p.signature],{headerRow:0,columns:MappingCore.validateColumns(kind,p.signature,cols),returnChannelReviewed:p.returnChannelReviewed===true,returnChannelValues:returnChannelValues(p.returnChannelValues)});
 }
 function validateStore(input){
  if(!input||input.version!==1||typeof input.active!=='string'||!input.profiles||typeof input.profiles!=='object'||Array.isArray(input.profiles))throw Error(t('지원하지 않는 프로필 파일입니다.','Unsupported profile file.'));
  const entries=Object.entries(input.profiles);if(!entries.length||entries.length>50)throw Error(t('프로필은 1~50개까지 가능합니다.','Between 1 and 50 profiles are supported.'));const out={version:1,active:input.active,profiles:Object.create(null)},names=new Set();
  for(const [id,profile] of entries){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||['__proto__','prototype','constructor'].includes(id)||!profile||typeof profile.name!=='string'||!profile.name.trim()||profile.name.length>100)throw Error('Invalid profile identity');if(names.has(profile.name))throw Error('Duplicate profile names');names.add(profile.name);const dest={name:profile.name,file:{},paste:{},...(profile.locationRules===undefined?{}:{locationRules:validateLocationRules(profile.locationRules)}),...(profile.labelPapers===undefined?{}:{labelPapers:validateLabelPapers(profile.labelPapers)}),...(profile.dispatchProfile===undefined?{}:{dispatchProfile:validateDispatchProfile(profile.dispatchProfile)}),...(profile.cartonMappings===undefined?{}:{cartonMappings:validateCartonMappings(profile.cartonMappings)})};
   for(const source of ['file','paste']){const profiles=profile[source];if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))throw Error('Invalid profile collection');for(const [kind,p] of Object.entries(profiles)){if(!kinds.includes(kind))throw Error('Invalid mapping role');dest[source][kind]=validateProfile(p,kind);}}
   out.profiles[id]=dest;
  }if(!Object.hasOwn(out.profiles,out.active))throw Error('Invalid active profile');return out;
 }
 function exampleConnection(profileText){
  const saved=validateStore(JSON.parse(profileText)),profile=saved.profiles[saved.active];
  return {
   locationRules:profile.locationRules,
   cartonMappings:profile.cartonMappings,
   hooks:{
    selectSheets({sheets}){
     const {reused,confirmKinds}=resolveSavedSheets(sheets,kinds,profile.file);
     if(!profile.file.raw||confirmKinds.length)throw Error('The example workbook does not match its profile');
     return reused;
    },
    selectColumns({kind,rows}){
     const result=MappingCore.reconnectRows(profile.file[kind],rows);
     if(!result.ok)throw Error(result.reason);
     return result.mapping;
    },
   },
  };
 }
 function refresh(){for(const fn of localizers)fn();for(const n of statusNodes)n.textContent=storageNote;}
 function persist(next,successNote){
  // Commit to the current window first. Browser storage is optional and never decides which mapping this window uses.
  db=copy(next);
  try{const encoded=JSON.stringify(db);localStorage.setItem(KEY,encoded);if(localStorage.getItem(KEY)!==encoded)throw Error('readback mismatch');storageAvailable=true;}
  catch{storageAvailable=false;}
  storageNote=(successNote||'')+(storageAvailable?(successNote?'':t('이 브라우저에 저장됨 · 작업 JSON과 별도','Saved in this browser · separate from work JSON')):(successNote?' · ':'')+profileDiagnostic('PROFILE-SESSION','브라우저 저장 불가. 현재 창에서는 적용되고, 창을 다시 열면 JSON을 불러와야 해요.','Browser storage unavailable. This window can still use the profile. Import the JSON again after reopening.'));refresh();
 }
 function load(){
  let encoded;
  try{encoded=localStorage.getItem(KEY);}
  catch{storageAvailable=false;storageNote=profileDiagnostic('PROFILE-SESSION','브라우저 저장 불가. 프로필 JSON을 불러오면 현재 창에서 바로 쓸 수 있어요.','Browser storage unavailable. Import a profile JSON to use it in this window.');return;}
  try{if(encoded)db=validateStore(JSON.parse(encoded));}catch{storageNote=profileDiagnostic('PROFILE-RECOVER','브라우저에 저장된 프로필을 읽지 못했어요. 프로필 JSON을 불러오세요.','The browser-saved profile could not be read. Import the profile JSON.');}
 }
 async function readProfileFile(file){
  if(file.size>2e6)throw Error(profileDiagnostic('PROFILE-SIZE','프로필은 2MB 이하만 가능합니다.','Profile must be at most 2 MB.'));
  let bytes;
  try{bytes=new Uint8Array(await file.arrayBuffer());}
  catch{throw Error(profileDiagnostic('PROFILE-READ','브라우저가 JSON 파일을 읽지 못했어요. 파일을 열 수 있는지 확인해 주세요.','The browser could not read the JSON. Check that the file can be opened.'));}
  let parsed;
  try{
   const utf16=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
   parsed=JSON.parse(new TextDecoder(utf16,{fatal:true}).decode(bytes));
  }catch{throw Error(profileDiagnostic('PROFILE-JSON','JSON 형식을 읽지 못했어요. 설정에서 내보낸 프로필 JSON을 선택해 주세요.','Could not parse JSON. Select a profile exported from Settings.'));}
  try{return validateStore(parsed);}
  catch{throw Error(profileDiagnostic('PROFILE-FORMAT','이 파일에 유효한 데이터 연결 프로필이 없어요. 작업 백업과 별도인 프로필 JSON을 선택해 주세요.','No valid data connection profile. Select the profile JSON, not a work backup.'));}
 }
 function cancelled(){const e=Error(t('매핑을 취소했습니다. 기존 데이터와 프로필을 유지합니다.','Mapping cancelled. Existing data and profiles retained.'));e.name='AbortError';return e;}
 function modal(title,build,confirmLabel,canChangeProfile=false){return new Promise((resolve,reject)=>{
  if(dialog){reject(Error('A mapping dialog is already open'));return;}
  const focus=document.activeElement,d=node('dialog',undefined,{className:'mapping-dialog'});dialog=d;d.setAttribute('aria-labelledby','mappingDialogTitle');
  const h=node('h2',title,{id:'mappingDialogTitle'}),note=node('p',t('현재 프로필 ','Current profile ')+db.profiles[db.active].name),body=node('div'),err=node('p','',{className:'mapping-error'}),actions=node('div',undefined,{className:'mapping-actions'}),cancel=node('button',t('취소','Cancel'),{type:'button'}),ok=node('button',confirmLabel||t('연결 확인','Confirm mapping'),{type:'button',className:'primary'});err.setAttribute('role','alert');
  d.append(h,note,body,err,actions);actions.append(cancel,ok);let settled=false;
  if(canChangeProfile){const useAnother=node('button',t('다른 프로필 사용','Use a different profile'),{type:'button'});useAnother.onclick=()=>{const e=cancelled();e.changeProfile=true;done(null,e);};actions.prepend(useAnother);}
  function done(value,error){if(settled)return;settled=true;d.close();d.remove();dialog=null;if(focus?.isConnected)focus.focus({preventScroll:true});error?reject(error):resolve(value);}
  let getValue;try{getValue=build(body);}catch(e){dialog=null;d.remove();reject(e);return;}ok.onclick=()=>{try{done(getValue());}catch(e){err.textContent=e.message;}};cancel.onclick=()=>done(null,cancelled());d.addEventListener('cancel',e=>{e.preventDefault();done(null,cancelled());});d.addEventListener('close',()=>{if(!settled)done(null,cancelled());});document.body.append(d);d.showModal();(body.querySelector('select,input,button')||cancel).focus();
 });}
 function option(select,value,label){select.append(node('option',label,{value:String(value)}));}
 function colLetter(i){let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;}
 function sameConnection(a,b){
  return !!a&&!!b&&MappingCore.comparableHeader(a.sheetName)===MappingCore.comparableHeader(b.sheetName)&&
   Object.keys(a.headerNames).length===Object.keys(b.headerNames).length&&Object.entries(a.headerNames).every(([key,value])=>
    Object.hasOwn(b.headerNames,key)&&MappingCore.comparableHeader(value)===MappingCore.comparableHeader(b.headerNames[key]));
 }
 function workbookProfileName(staged,file,except){
  const base=String(file?.name||'').split(/[\\/]/u).at(-1).replace(/\.xls[xm]$/iu,'').trim()||t('연결 프로필','Connection profile');
  const used=new Set(Object.entries(staged.profiles).filter(([id])=>id!==except).map(([,p])=>p.name));
  for(let n=1;;n++){
   const suffix=n===1?'':' ('+n+')',name=base.slice(0,100-suffix.length).trimEnd()+suffix;
   if(!used.has(name))return name;
  }
 }
 async function begin(kind,sourceType,{onReview=null,canChangeProfile=false,autoProfile=false}={}){
  if(busy)throw Error(t('다른 가져오기가 진행 중입니다.','Another import is in progress.'));
  if(kind!==null&&!kinds.includes(kind))throw Error('Invalid mapping kind');if(!['file','paste'].includes(sourceType))throw Error('Invalid mapping source');
  busy=true;refresh();const mode=db.active,staged=copy(db),profiles=staged.profiles[mode][sourceType],captured=new Map();let finished=false,owner=mode,profileNote='';
  function remember(k,sheetName,preview,mapping){captured.set(k,{sheetName,header:preview[mapping.headerRow].slice(),headerRow:mapping.headerRow});return mapping;}
  function end(){if(finished)return;finished=true;busy=false;refresh();}
  async function review(reason,open){onReview?.(reason,true);try{return await open();}finally{onReview?.(reason,false);}}
  const hooks={
   async selectSheets({sheets,wantedKind}){
    const selectedKinds=wantedKind?[wantedKind]:kinds;
    // Optional roles not configured in an existing profile remain unselected.
    const {reused,confirmKinds}=resolveSavedSheets(sheets,selectedKinds,profiles);
    if(reused.length&&!confirmKinds.length)return reused;
    const occupied=new Set(reused.map(x=>x.sheetIndex));
    const candidates=sheets.filter(sheet=>!occupied.has(sheet.index));
    return review('sheet',()=>modal(t('시트 연결','Connect sheets'),body=>{
     body.append(node('p',fileMappingCount(staged.profiles[mode])?
      profileDiagnostic('MAP-SHEET','저장한 시트 이름이 일치하지 않거나 현재 자료 역할에 연결된 시트가 없어요. 아래 항목만 선택해 주세요.','A saved worksheet name did not match or this role has no saved worksheet. Select the roles shown below.'):
      profileDiagnostic('MAP-NO-SHEET','현재 프로필에 저장된 Excel 시트 연결이 없어요. 시트를 한 번 선택해 주세요.','This profile has no saved Excel worksheets. Choose them once.')));
     if(reused.length)body.append(node('p',t('일치한 시트 '+reused.length+'개는 그대로 사용해요.','Reusing '+reused.length+' matching worksheets.')));
     const controls=new Map();
     for(const k of confirmKinds){
      const label=node('label',role(k)),s=node('select');
      label.className='mapping-sheet-role';
      s.setAttribute('aria-label',role(k));
      option(s,'',t('선택하지 않음','Not selected'));
      for(const sheet of candidates)option(s,sheet.index,sheet.name);
      label.append(s);body.append(label);controls.set(k,s);
     }
     return ()=>{
      const out=[...reused,...confirmKinds.filter(k=>controls.get(k).value!=='').map(k=>({kind:k,sheetIndex:Number(controls.get(k).value)}))];
      if(!out.length||wantedKind&&!out.some(x=>x.kind===wantedKind))throw Error(t('가져올 시트를 선택하세요.','Select a sheet to import.'));
      if(new Set(out.map(x=>x.sheetIndex)).size!==out.length)throw Error(t('같은 시트를 두 역할에 연결할 수 없습니다.','A sheet cannot have two roles.'));
      return selectedKinds.flatMap(k=>out.filter(x=>x.kind===k));
     };
    },undefined,canChangeProfile));
   },
   async selectColumns({kind:k,sheetName='',rows,rowNumbers}){
    const preview=rows.slice(0,100),saved=profiles[k];
    // A paste profile can reuse known column mappings once the operator
    // explicitly chooses a file sheet; it never assigns a sheet automatically.
    const fallback=!saved?staged.profiles[mode][sourceType==='file'?'paste':'file'][k]:null;
    const known=saved||fallback;
    let reconnect=null;
    if(known){reconnect=MappingCore.reconnectRows(known,preview);if(reconnect.ok&&(k!=='raw'||known.returnChannelReviewed===true||Object.hasOwn(reconnect.mapping.columns,'returnChannel'))){profiles[k]=MappingCore.makeProfile(k,sheetName,preview,reconnect.mapping);return remember(k,sheetName,preview,reconnect.mapping);}}
    const mapping=await review('columns',()=>modal(role(k)+' · '+t('열 연결','Column mapping'),body=>{
     if(sheetName)body.append(node('p',sheetName));if(k==='raw'&&reconnect?.ok)body.append(node('p',profileDiagnostic('MAP-CHANNEL','저장한 열은 연결했어요. B2B/B2C 구분 열만 확인해 주세요.','Saved columns are mapped. Review only the B2B/B2C category column.')));if(reconnect&&!reconnect.ok)body.append(node('p','[MAP-COLUMNS] '+reconnect.reason,{className:'mapping-error'}));if(!known)body.append(node('p',profileDiagnostic('MAP-NO-COLUMNS','이 자료에 저장된 열 연결이 없어요. 제목 행과 사용할 열을 한 번 선택해 주세요.','This role has no saved columns. Select a header row and map the columns once.')));
     if(!preview.length)throw Error(t('미리볼 행이 없습니다.','No rows to preview.'));
     const label=node('label',t('헤더 행','Header row')),header=node('select');header.setAttribute('aria-label',t('헤더 행','Header row'));option(header,'',t('헤더 행 선택','Select header row'));
     preview.forEach((r,i)=>option(header,i,t('행 ','Row ')+(rowNumbers?.[i]??i+1)+' · '+r.map(v=>String(v??'')).filter(Boolean).slice(0,4).join(' | ').slice(0,180)));label.append(header);body.append(label);
     const wrap=node('div',undefined,{className:'mapping-preview',tabIndex:0}),table=node('table'),head=node('thead'),tbody=node('tbody');wrap.setAttribute('role','region');wrap.setAttribute('aria-label',t('원본 미리보기','Source preview'));const width=Math.max(0,...preview.map(r=>r.length));let colStart=0;
     const nav=node('div',undefined,{className:'mapping-preview-nav'}),prev=node('button',t('이전 열','Previous columns'),{type:'button'}),range=node('span'),next=node('button',t('다음 열','Next columns'),{type:'button'});range.setAttribute('role','status');nav.append(prev,range,next);table.append(head,tbody);wrap.append(table);body.append(nav,wrap);
     function drawPreview(){head.replaceChildren();tbody.replaceChildren();const end=Math.min(width,colStart+24),hr=node('tr');hr.append(node('th',t('행','Row')));for(let c=colStart;c<end;c++)hr.append(node('th',colLetter(c)));head.append(hr);preview.forEach((r,i)=>{const tr=node('tr');tr.append(node('th',String(rowNumbers?.[i]??i+1)));for(let c=colStart;c<end;c++){const text=String(r[c]??''),td=node('td',text);td.title=text;tr.append(td);}tbody.append(tr);});range.textContent=width?colLetter(colStart)+'–'+colLetter(end-1)+' / '+width+t('열',' columns'):'0';prev.disabled=colStart===0;next.disabled=end>=width;wrap.scrollLeft=0;}
     prev.onclick=()=>{colStart=Math.max(0,colStart-24);drawPreview();};next.onclick=()=>{colStart+=24;drawPreview();};drawPreview();
     const matchInfo=node('p','',{className:'small'}),reveal=node('button',t('모든 열 보기','Show all columns'),{type:'button'});reveal.hidden=matchInfo.hidden=true;body.append(matchInfo,reveal);
     const fieldBox=node('div',undefined,{className:'mapping-fields'}),selects={},labels={};body.append(fieldBox);
     const desc=MappingCore.fields(k);for(const field of desc){const l=node('label',(en()?field.labelEn:field.label)+(field.required?' *':'')),s=node('select');s.setAttribute('aria-label',en()?field.labelEn:field.label);selects[field.id]=s;labels[field.id]=l;l.append(s);fieldBox.append(l);}
     function populate(){const values=header.value===''?[]:preview[Number(header.value)];for(const s of Object.values(selects)){s.replaceChildren();option(s,'',t('연결 안 함','Not mapped'));values.forEach((v,c)=>{if(String(v??''))option(s,c,colLetter(c)+' · '+String(v));});s.disabled=header.value==='';}let matched=[];
      if(known&&header.value!==''){const found=MappingCore.knownColumns(known,values).columns;for(const [id,i] of Object.entries(found)){if(selects[id]){selects[id].value=String(i);matched.push(id);}}}
      const onlyChannel=k==='raw'&&known&&known.returnChannelReviewed!==true&&!matched.includes('returnChannel');
      const review=known&&matched.length>0;
      for(const [id,label] of Object.entries(labels))label.hidden=!!(review&&((matched.includes(id)&&!(id==='returnChannel'&&onlyChannel))||(!Object.hasOwn(known.headerNames,id)&&!(id==='returnChannel'&&onlyChannel))));
      const missing=known?Object.keys(known.headerNames).filter(id=>!matched.includes(id)):[];
      // If no previously connected field is missing, focus the one-time category review.
      reveal.hidden=!review;matchInfo.hidden=!review;
      if(review){matchInfo.textContent=t('저장한 열 '+matched.length+'개는 그대로 연결했어요. '+(missing.length?'찾지 못한 '+missing.length+'개만 확인해 주세요.':'나머지 설정만 확인해 주세요.'),matched.length+' saved mappings reused. '+(missing.length?'Review only the '+missing.length+' unmatched fields.':'Review the remaining setting.'));}
     }
     reveal.onclick=()=>{for(const label of Object.values(labels))label.hidden=false;reveal.hidden=true;};
     let channelInputs=null;
     if(k==='raw'){
      const help=node('p',t('한 그룹에 여러 코드가 있으면 쉼표로 구분하세요. 원본 값이 B2B / B2C라면 기본값을 그대로 두세요.','Separate multiple codes in the same group with commas. Keep the defaults if the source uses B2B / B2C.'));
      channelInputs={};fieldBox.append(help);for(const key of ['b2b','b2c']){const label=node('label',key.toUpperCase()+t(' 원본 값',' source value')),input=node('input',undefined,{type:'text',maxLength:returnChannelInputLimit,value:returnChannelFormText(known?.returnChannelValues?.[key],key.toUpperCase())});label.append(input);fieldBox.append(label);channelInputs[key]=input;}
      selects.returnChannel.onchange=()=>{for(const input of Object.values(channelInputs))input.disabled=selects.returnChannel.value==='';};
     }
     header.onchange=()=>{populate();selects.returnChannel?.onchange?.();};const suggested=reconnect?.mapping?.headerRow??reconnect?.headerRow;if(Number.isInteger(suggested))header.value=String(suggested);header.onchange();if(k==='loc')body.append(node('p',t('위치 유형 열이 없으면 유형 미확인으로 가져옵니다. 피킹 위치로 추정하지 않습니다.','Without a location-type column, type stays unknown. Picking locations are not inferred.')));
     return ()=>{if(header.value==='')throw Error(t('헤더 행을 선택하세요.','Select the header row.'));const headerRow=Number(header.value),columns={};for(const [id,s] of Object.entries(selects))if(s.value!=='')columns[id]=Number(s.value);const valid=MappingCore.validateColumns(k,preview[headerRow],columns);
      const removed=known?Object.keys(known.headerNames).filter(id=>!Object.hasOwn(valid,id)):[];
      const protectsOriginal=autoProfile&&sourceType==='file'&&k==='raw'&&!!db.profiles[mode].file.raw;
      if(removed.length&&!protectsOriginal&&!uiConfirm(t('연결하지 않은 기존 열 '+removed.length+'개를 이 프로필에서 해제할까요?','Remove '+removed.length+' previously mapped fields from this profile?')))throw Error(t('빠진 열을 연결하거나, 연결 해제를 확인해 주세요.','Reconnect the missing columns or confirm their removal.'));
      const result={headerRow,columns:valid,...(k==='raw'?{returnChannelReviewed:true}:{}),...(channelInputs&&Object.hasOwn(valid,'returnChannel')?{returnChannelValues:known?.returnChannelValues?.exact===true&&MappingCore.knownColumns(known,preview[headerRow]).columns.returnChannel===valid.returnChannel&&['b2b','b2c'].every(k=>channelInputs[k].value===returnChannelFormText(known.returnChannelValues[k],k.toUpperCase()))?known.returnChannelValues:returnChannelFormValues(channelInputs.b2b.value,channelInputs.b2c.value)}:{})};MappingCore.makeProfile(k,sheetName,preview,result);return result;};
    },undefined,canChangeProfile));
    profiles[k]=MappingCore.makeProfile(k,sheetName,preview,mapping);return remember(k,sheetName,preview,mapping);
   }
  };
  return {hooks,prepareProfile(file,hasRaw){
   if(finished)throw Error('Mapping transaction ended');
   if(!autoProfile||sourceType!=='file'||!hasRaw||!captured.has('raw'))return;
   const previous=db.profiles[mode];
   const props=[...captured.keys()];
   const changedSchema=props.some(k=>previous.file[k]&&!sameConnection(previous.file[k],profiles[k]));
   if(changedSchema){
    const fileConnections=Object.fromEntries(props.map(k=>[k,profiles[k]]));
    const match=Object.entries(db.profiles).find(([id,p])=>id!==mode&&props.every(k=>sameConnection(p.file[k],fileConnections[k])));
    staged.profiles[mode]=previous;
    if(match){
     owner=match[0];
     staged.profiles[owner].file={...staged.profiles[owner].file,...fileConnections};
    }else{
     if(Object.keys(staged.profiles).length>=50)throw Error(t('저장할 수 있는 프로필은 최대 50개예요. 기존 프로필과 같은 구조의 RAW를 선택해 주세요.','Up to 50 profiles can be saved. Choose a workbook that matches an existing profile.'));
     do{owner='p_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);}while(Object.hasOwn(staged.profiles,owner));
     staged.profiles[owner]={name:workbookProfileName(staged,file),file:fileConnections,paste:{}};
     profileNote=t('새 프로필 연결 완료','New profile connected');
    }
    staged.active=owner;
   }else if(mode==='default'&&!Object.keys(previous.file).length&&!Object.keys(previous.paste).length&&!previous.locationRules){
    staged.profiles[mode].name=workbookProfileName(staged,file,mode);
    profileNote=t('새 프로필 연결 완료','New profile connected');
   }
  },commit(original){if(finished)throw Error('Mapping transaction ended');
   if(owner!==mode)forgetSources();
   persist(staged,profileNote);
   for(const [k,metadata] of captured){
    const key=sessionKey(sourceType,k);sessionSources.delete(key);
    if(sourceType==='file'&&typeof original?.file?.arrayBuffer==='function'||sourceType==='paste'&&typeof original?.text==='string')sessionSources.set(key,{...metadata,owner,...(sourceType==='file'?{file:original.file}:{text:original.text}),activeRaw:k==='raw'?original.activeRaw:null,codes:new Map()});
   }
   end();},abort:end};
 }
 async function editName(){
  if(busy)return;busy=true;refresh();
  try{
   const name=await modal(t('프로필 이름 변경','Rename profile'),body=>{
    const label=node('label',t('프로필 이름','Profile name')),input=node('input',undefined,{type:'text',maxLength:100,value:db.profiles[db.active].name});label.append(input);body.append(label);
    return ()=>{const value=input.value.trim();if(!value)throw Error(t('이름을 입력하세요.','Enter a name.'));if(Object.entries(db.profiles).some(([id,p])=>id!==db.active&&p.name===value))throw Error(t('같은 이름의 프로필이 있습니다.','A profile with that name exists.'));return value;};
   });
   const next=copy(db);next.profiles[next.active].name=name;persist(next);
  }catch(e){if(e.name!=='AbortError')storageNote=e.message;}finally{busy=false;refresh();}
 }
 async function inspectProfileSource(file,kind,profile,columnName=null){
  return readWorkbook(file,kind,null,{
   selectSheets({sheets}){const matches=sheets.filter(x=>x.name===profile.sheetName);if(matches.length!==1)throw Error(t('프로필에 저장된 시트와 같은 시트가 있는 파일을 선택해 주세요.','Select a workbook with the worksheet saved in this profile.'));return [{kind,sheetIndex:matches[0].index}];},
   selectColumns({rows}){const match=MappingCore.reconnectRows(profile,rows),headerRow=match.mapping?.headerRow??match.headerRow;if(!Number.isInteger(headerRow))throw Error(t('이 파일에서 제목 행을 확정할 수 없어요. 기준 데이터 연결에서 제목 행을 확인해 주세요.','Could not identify the header row. Confirm it from the reference data import.'));return {headerRow};},
   inspectColumn({header}){if(columnName===null)return null;const hits=header.map((v,i)=>MappingCore.normalizeHeader(v)===columnName?i:-1).filter(i=>i>=0);if(hits.length!==1)throw Error(t('원본에서 해당 열을 하나로 찾지 못했어요.','Could not find exactly one matching source column.'));return hits[0];}
  });
 }
 function savedConnections(){
  const profile=db.profiles[db.active];
  return ['file','paste'].flatMap(source=>kinds.filter(kind=>Object.hasOwn(profile[source],kind)).map(kind=>({source,kind,profile:profile[source][kind]})));
 }
 async function editConnection(){
  if(busy||!savedConnections().length)return false;
  busy=true;refresh();
  try{
   const connections=savedConnections();
   const updated=await modal(t('열 연결 편집','Edit column mapping'),body=>{
    body.append(node('p',t('선택한 항목만 저장합니다. 이 창에서 불러온 단일 원본의 B2B/B2C 그룹은 검색에 바로 적용됩니다.','Only the selected field is saved. B2B/B2C groups apply immediately when a single source was loaded in this window.')));
    function control(labelText,element,parent=body){const label=node('label',labelText);element.setAttribute('aria-label',labelText);label.append(element);parent.append(label);return label;}
    const form=node('div',undefined,{className:'mapping-fields'});body.append(form);
    const source=node('select'),field=node('select'),column=node('select');
    control(t('편집할 자료','Data connection'),source,form);
    control(t('바꿀 항목','Field to edit'),field,form);
    control(t('원본 열','Source column'),column,form);
    const file=node('input',undefined,{type:'file',accept:'.xlsx,.xlsm',hidden:true}),loadSource=node('button',t('원본에서 열 목록 가져오기','Read columns from workbook'),{type:'button',className:'profile-workbook-button'}),feedback=node('p','',{className:'small'});
    const pasteSource=node('button',t('복사한 원본 붙여넣기','Paste copied source'),{type:'button',className:'profile-workbook-button'});
    feedback.setAttribute('role','status');body.append(file,loadSource,pasteSource,feedback);
    pasteSource.onclick=()=>{feedback.textContent=t('원본 표를 복사한 뒤 이 버튼에서 붙여넣기(Ctrl+V / ⌘V)를 하세요.','Copy the table, then paste (Ctrl+V / ⌘V) on this button.');};
    const values=node('fieldset',undefined,{className:'profile-code-choices'}),legend=node('legend',t('구분값 그룹 지정','Assign category codes')),help=node('p',t('원본 값마다 B2B 또는 B2C를 고르세요. 지정하지 않은 값은 검색에서 제외됩니다.','Choose B2B or B2C for each source value. Unassigned values are excluded from search.'),{className:'small'}),codeList=node('div');
    values.append(legend,help,codeList);body.append(values);
    const selected=()=>connections[Number(source.value)];
    const stateBySource=new Map(connections.flatMap(entry=>{
     const cached=sessionSources.get(sessionKey(entry.source,entry.kind));
     return cached?.owner===db.active&&cached.sheetName===entry.profile.sheetName?[[entry,cached]]:[];
    }));let revision=0,loading=false,choices=new Map(),page=0;
    const context=()=>stateBySource.get(selected());
    const profileCodes=profile=>profile.returnChannelValues??(profile.headerNames.returnChannel?{b2b:'B2B',b2c:'B2C'}:{});
    const profileAssignments=profile=>{const saved=profileCodes(profile);return new Map(['b2b','b2c'].flatMap(group=>[].concat(saved[group]??[]).map(code=>[code,group])));};
    function headers(){
     const now=context();
     return now?now.header.map(MappingCore.normalizeHeader).filter(Boolean):selected().profile.signature;
    }
    const chosenName=()=>column.value===''?'':headers()[Number(column.value)]||'';
    connections.forEach(({source:kindOfSource,kind,profile},i)=>option(source,i,role(kind)+' · '+(kindOfSource==='file'?t('Excel','Excel')+(profile.sheetName?' / '+profile.sheetName:''):t('붙여넣기','Paste'))));
    function syncValues(){
     const {kind,profile}=selected(),name=chosenName(),now=context(),show=kind==='raw'&&field.value==='returnChannel'&&!!name;
     values.hidden=!show;choices=new Map();page=0;codeList.replaceChildren();
     if(!show)return;
     const codes=now?.codes.get(name);
     if(!codes?.length){codeList.append(node('p',codes?t('선택한 열에 빈칸이 아닌 값이 없어요.','The selected column has no nonblank values.'):t('실제 원본 값만 표시합니다. 원본을 불러오면 목록이 나와요.','Only actual source values are shown. Load the source to see the list.'),{className:'small'}));return;}
     const assigned=name===profile.headerNames.returnChannel?profileAssignments(profile):new Map(),keyFor=profile.returnChannelValues?.exact===true?returnChannelExact:returnChannelKey;
     for(const code of codes){const group=assigned.get(keyFor(code));if(group)choices.set(code,group);}
     const perPage=60,pages=Math.ceil(codes.length/perPage);
     function render(){
      codeList.replaceChildren();
      for(const code of codes.slice(page*perPage,(page+1)*perPage)){
       const group=node('select');option(group,'',t('미지정','Unassigned'));option(group,'b2b','B2B');option(group,'b2c','B2C');group.value=choices.get(code)||'';
       group.onchange=()=>{if(group.value)choices.set(code,group.value);else choices.delete(code);};control(code,group,codeList);
      }
      const navigation=node('div',undefined,{className:'profile-code-pages'}),prev=node('button',t('이전','Previous'),{type:'button'}),next=node('button',t('다음','Next'),{type:'button'}),count=node('span',codes.length.toLocaleString()+t('개 고유값',' unique values')+(pages>1?' · '+(page+1)+' / '+pages:''));
      count.setAttribute('role','status');if(pages>1){prev.disabled=page===0;next.disabled=page+1>=pages;prev.onclick=()=>{page--;render();codeList.querySelector('select')?.focus();};next.onclick=()=>{page++;render();codeList.querySelector('select')?.focus();};navigation.append(prev,count,next);}else navigation.append(count);codeList.append(navigation);
     }
     render();
    }
    async function readCodes(force=false){
     const entry=selected(),now=context(),name=chosenName();
     if(!now||entry.kind!=='raw'||field.value!=='returnChannel'||!name||now.codes.has(name)&&!force)return;
     const token=++revision;loading=true;feedback.textContent=t('원본 구분값 읽는 중…','Reading source codes…');
     try{const result=now.file?await inspectProfileSource(now.file,entry.kind,entry.profile,name):pasteSourceCodes(now,name);if(token!==revision)return;now.codes.set(name,result.codes);feedback.textContent=t('원본 구분값을 불러왔어요.','Source codes loaded.');syncValues();}
     catch(error){if(token===revision){feedback.textContent=error.message;loadSource.hidden=entry.source!=='file';pasteSource.hidden=entry.source!=='paste';}}
     finally{if(token===revision)loading=false;}
    }
    function populateColumns(preferred){
     const {profile}=selected(),names=profile.headerNames,current=preferred??names[field.value],list=headers(),counts=new Map();
     for(const name of list)counts.set(name,(counts.get(name)||0)+1);
     column.replaceChildren();option(column,'',t('연결 안 함','Not mapped'));
     const used=new Set(Object.entries(names).filter(([id])=>id!==field.value).map(([,name])=>name));
     for(const [i,name]of list.entries()){option(column,i,name+(counts.get(name)>1?t(' · 원본에 중복',' · Duplicate header'):''));column.lastElementChild.disabled=used.has(name)||counts.get(name)>1;}
     column.value=current!==undefined&&counts.get(current)===1?String(list.indexOf(current)):'';
     const cached=!!context();
     loadSource.hidden=selected().source!=='file'||cached;pasteSource.hidden=selected().source!=='paste'||cached;
     if(cached)feedback.textContent=t('이 창에서 이미 불러온 원본을 사용하고 있어요.','Using the source already loaded in this window.');
     syncValues();
    }
    function pasteSourceCodes(now,name){const rows=now.rows||Engine.parseDelimited(now.text),col=now.header.findIndex(v=>MappingCore.normalizeHeader(v)===name),codes=new Set();for(let i=now.headerRow+1;i<rows.length;i++){const code=returnChannelExact(rows[i][col]);if(code)codes.add(code);}return {codes:[...codes]};}
    body.addEventListener('paste',event=>{
     if(selected().source!=='paste')return;event.preventDefault();
     const input=event.clipboardData?.getData('text/plain')||'';if(!input.trim())return;
     const entry=selected(),preferred=chosenName()||undefined;revision++;loading=false;
     try{const rows=Engine.parseDelimited(input),match=MappingCore.reconnectRows(entry.profile,rows),headerRow=match.mapping?.headerRow??match.headerRow;if(!Number.isInteger(headerRow))throw Error(t('복사한 표의 제목 행을 찾지 못했어요. 제목 행을 포함해 주세요.','Could not find a header. Copy the table with its header.'));stateBySource.set(entry,{rows,headerRow,header:rows[headerRow],codes:new Map()});populateColumns(preferred);feedback.textContent=t('원본의 열 목록을 불러왔어요.','Source columns loaded.');void readCodes();}
     catch(error){feedback.textContent=error.message;}
    });
    loadSource.onclick=()=>file.click();
    file.onchange=async()=>{
     const picked=file.files[0];file.value='';if(!picked)return;
     const entry=selected(),preferred=chosenName()||undefined,token=++revision;loading=true;feedback.textContent=t('원본 열 읽는 중…','Reading workbook columns…');
     try{const result=await inspectProfileSource(picked,entry.kind,entry.profile);if(token!==revision)return;stateBySource.set(entry,{file:picked,header:result.header,codes:new Map()});populateColumns(preferred);feedback.textContent=t('원본의 열 목록을 불러왔어요.','Workbook columns loaded.');}
     catch(error){if(token===revision)feedback.textContent=error.message;}
     finally{if(token===revision)loading=false;}
     if(token===revision)await readCodes();
    };
    function populateFields(){
     const {kind}=selected(),fields=MappingCore.fields(kind);field.replaceChildren();
     for(const entry of fields)option(field,entry.id,en()?entry.labelEn:entry.label);
     field.value=kind==='raw'?'returnChannel':fields[0].id;populateColumns();
    }
    source.onchange=()=>{revision++;loading=false;feedback.textContent='';populateFields();void readCodes();};
    field.onchange=()=>{revision++;loading=false;feedback.textContent='';populateColumns();void readCodes();};
    column.onchange=()=>{revision++;loading=false;feedback.textContent='';syncValues();void readCodes();};source.value='0';populateFields();void readCodes();
    return ()=>{
     const {source:sourceType,kind,profile}=selected();
     if(loading)throw Error(t('원본 읽기가 끝나면 저장해 주세요.','Wait until the workbook scan finishes.'));
     const name=chosenName(),names={...profile.headerNames};
     if(name){if(headers().filter(v=>v===name).length!==1||Object.entries(names).some(([id,v])=>id!==field.value&&v===name))throw Error(t('중복되거나 이미 연결된 열은 선택할 수 없어요.','Duplicate or already mapped source column.'));names[field.value]=name;}
     else delete names[field.value];
     const signature=[...new Set([...headers(),...Object.values(names),...profile.signature])].sort(),columns=Object.fromEntries(Object.entries(names).map(([id,name])=>[id,signature.indexOf(name)]));
     const editingChannel=kind==='raw'&&field.value==='returnChannel',channelChoices={b2b:[],b2c:[],exact:true};
     for(const [code,group]of choices)if(group==='b2b'||group==='b2c')channelChoices[group].push(code);
     if(editingChannel&&name&&!context()?.codes.has(name))throw Error(t('원본을 먼저 불러와 실제 구분값을 선택하세요.','Load the source before assigning its actual category values.'));
     const channelValues=editingChannel?(name?returnChannelValues(channelChoices):undefined):profile.returnChannelValues;
     const revised=MappingCore.makeProfile(kind,profile.sheetName,[signature],{headerRow:0,columns,returnChannelReviewed:profile.returnChannelReviewed||editingChannel,returnChannelValues:channelValues});
     return {sourceType,kind,revised,liveSource:editingChannel?context():null};
    };
   },t('변경 저장','Save change'));
   const next=copy(db);next.profiles[next.active][updated.sourceType][updated.kind]=updated.revised;
   let applied=false,applyError='';
   if(updated.liveSource?.activeRaw){storageNote=t('B2B/B2C 검색을 갱신하는 중…','Updating B2B/B2C search…');refresh();
    try{applied=await applyLiveChannelProfile(updated.liveSource,updated.revised);}catch(error){applyError=error.message;}
   }
   persist(next,applied?t('저장했어요. B2B/B2C 검색에 적용됐고, 검수 기록은 유지했어요.','Saved and applied to B2B/B2C search. Inspection records are unchanged.'):applyError?t('설정만 저장했어요. 기준 데이터는 그대로예요. RAW를 다시 연결해 주세요.','Profile saved, reference data unchanged. Reconnect the workbook.')+' · '+applyError:t('선택한 연결을 저장했어요. 같은 원본을 다시 연결하면 적용돼요.','Mapping saved. Reconnect the same source to apply it.'));
   return true;
  }catch(e){if(e.name!=='AbortError')storageNote=e.message;return false;}finally{busy=false;refresh();}
 }
 function chooseProfile(id){
  if(busy||!Object.hasOwn(db.profiles,id)||id===db.active)return false;
  const next=copy(db);next.active=id;offerWorkbookRetry();
  persist(next,t('선택한 프로필은 다음 파일에 적용돼요.','The selected profile applies to the next file.'));
  return true;
 }
 function importProfile(f){
  if(!f||busy)return false;
  return loadProfile(f);
 }
 async function loadProfile(f){
   let settleImport;profileImport=new Promise(resolve=>{settleImport=resolve;});
   busy=true;storageNote=t('프로필 JSON 확인 중…','Reading profile JSON…');refresh();
   let applied=false;
   try{
    const incoming=await readProfileFile(f);
    if(!uiConfirm(t('현재 프로필 목록을 가져온 목록으로 바꿀까요? 검수 데이터는 바뀌지 않아요.','Replace the current profile list with the imported list? Inspection data stays unchanged.'))){
     storageNote=t('가져오기를 취소했어요. 기존 프로필을 유지합니다.','Import cancelled. Existing profiles retained.');return;
    }
    forgetSources();offerWorkbookRetry();applied=true;
    const count=fileMappingCount(incoming.profiles[incoming.active]);
    persist(incoming,count?t('프로필 적용 완료 · 저장된 Excel 시트 '+count+'개','Profile applied · '+count+' saved Excel worksheets'):t('프로필을 적용했어요. 첫 파일에서 연결할 시트를 골라 주세요.','Profile applied. Choose the worksheets on the first import.'));
   }catch(e){storageNote=e.message;}
   finally{busy=false;profileImport=null;settleImport(applied);refresh();if(applied)document.getElementById(lastWorkbook?.offer?'retryCombinedWorkbook':'openWorkbook')?.focus({preventScroll:true});}
   return applied;
 }
 function init(){
  load();
  const shelf=document.getElementById('profileShelf'),details=document.getElementById('dataProfileDetails'),dialog=document.getElementById('dataDialog');
  if(!shelf||!details)return;
  const top=node('div',undefined,{className:'profile-shelf-heading'});
  const title=node('h3','',{id:'profileShelfTitle'});
  const page=node('span','',{className:'profile-shelf-page'});page.setAttribute('aria-hidden','true');
  const openWorkbook=document.getElementById('openWorkbook');
  const shelfTools=node('span',undefined,{className:'profile-shelf-tools'});
  shelfTools.append(page,openWorkbook);top.append(title,shelfTools);
  const row=node('div',undefined,{className:'profile-shelf-row'});
  const prev=node('button',undefined,{type:'button',className:'profile-shelf-arrow'});prev.append(icon('back'));
  const next=node('button',undefined,{type:'button',className:'profile-shelf-arrow'});next.append(icon('forward'));
  const rail=node('div',undefined,{className:'profile-documents'});
  const activeInfo=node('p','',{className:'profile-active-info'});activeInfo.setAttribute('role','status');
  const status=node('p','',{className:'small profile-storage-note'});status.setAttribute('role','status');
  statusNodes.push(status);row.append(prev,rail,next);
  const retry=node('button','',{id:'retryCombinedWorkbook',type:'button',className:'profile-workbook-button profile-retry-workbook'});
  retry.onclick=()=>{if(lastWorkbook?.offer&&!busy)void runCombinedWorkbook(lastWorkbook.file,{retry:true});};
  shelf.append(top,row,activeInfo,retry,status);
  let direction=0,gesture=null,suppressUntil=0,wheelAt=-Infinity,wheelDistance=0,wheelUsed=false;
  const entries=()=>Object.entries(db.profiles);
  const activeIndex=list=>list.findIndex(([id])=>id===db.active);
  function activate(index,focusDocument=false){
   const list=entries(),here=activeIndex(list),target=list[index];
   if(!target||busy||index===here)return;
   direction=Math.sign(index-here);
   if(chooseProfile(target[0])&&focusDocument)rail.querySelector('[aria-current="true"]')?.focus({preventScroll:true});
  }
  function slide(by,focusDocument=false){activate(activeIndex(entries())+by,focusDocument);}
  prev.onclick=()=>slide(-1);next.onclick=()=>slide(1);
  dialog.addEventListener('keydown',event=>{
   if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||busy||entries().length<2)return;
   if(event.target?.closest?.('input, textarea, select, [contenteditable]'))return;
   const onDocument=rail.contains(document.activeElement);
   const move={ArrowLeft:-1,ArrowRight:1};
   if(Object.hasOwn(move,event.key)){event.preventDefault();slide(move[event.key],onDocument);}
   else if(onDocument&&(event.key==='Home'||event.key==='End')){event.preventDefault();activate(event.key==='Home'?0:entries().length-1,true);}
  });
  row.addEventListener('pointerdown',event=>{
   if(event.pointerType==='touch'&&event.isPrimary&&!busy&&entries().length>1)gesture={id:event.pointerId,x:event.clientX,y:event.clientY};
  });
  row.addEventListener('pointercancel',event=>{if(gesture?.id===event.pointerId)gesture=null;});
  row.addEventListener('pointerup',event=>{
   if(gesture?.id!==event.pointerId)return;
   const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;gesture=null;
   if(Math.abs(dx)<34||Math.abs(dx)<Math.abs(dy)*1.3)return;
   suppressUntil=performance.now()+350;slide(dx<0?1:-1,rail.contains(document.activeElement));
  });
  row.addEventListener('click',event=>{
   if(event.detail&&performance.now()<suppressUntil){event.preventDefault();event.stopPropagation();}
  },true);
  row.addEventListener('wheel',event=>{
   if(event.ctrlKey||event.metaKey||busy||entries().length<2)return;
   const dx=event.shiftKey&&!event.deltaX?event.deltaY:event.deltaX;
   const dy=event.shiftKey&&!event.deltaX?0:event.deltaY;
   if(Math.abs(dx)<=Math.abs(dy)*1.3||!dx)return;
   if(event.cancelable)event.preventDefault();
   if(event.timeStamp-wheelAt>170){wheelUsed=false;wheelDistance=0;}
   wheelAt=event.timeStamp;
   if(wheelUsed)return;
   wheelDistance+=dx*(event.deltaMode===1?16:event.deltaMode===2?160:1);
   if(Math.abs(wheelDistance)>=34){wheelUsed=true;slide(Math.sign(wheelDistance),rail.contains(document.activeElement));}
  },{passive:false});
  const group=node('div',undefined,{className:'mapping-controls profile-management'});
  const named=node('strong','',{className:'profile-management-name'});
  const mappings=node('ul',undefined,{className:'profile-mapping-list'});
  const actions=node('div',undefined,{className:'profile-actions'});
  const io=node('div',undefined,{className:'profile-json-actions'});
  function icon(id){
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),use=document.createElementNS(ns,'use');
   const role={rename:'edit',out:'download',back:'chevron-left',forward:'chevron-right'}[id]||id;
   svg.setAttribute('class','beam-ui-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
   use.setAttribute('href','#beam-glyph-'+role);svg.append(use);return svg;
  }
  function action(parent,ko,english,fn,symbol=null,id='',blocked=()=>false){
   const button=node('button',undefined,{type:'button'}),caption=node('span','');if(id)button.id=id;
   if(symbol)button.append(icon(symbol));button.append(caption);parent.append(button);button.onclick=fn;
   localizers.push(()=>{caption.textContent=t(ko,english);button.disabled=busy||blocked();});
   return button;
  }
  action(actions,'열 연결 편집','Edit column mapping',editConnection,'columns','',()=>!savedConnections().length);
  action(actions,'이름 변경','Rename',editName,'rename');
  action(actions,'위치 표시 규칙','Location display rules',editLocationRules,null,'locationRulesButton');
  action(actions,'출고 명세서','Shipment summary',editDispatchProfile,null,'dispatchProfileButton');
  action(actions,'라벨 용지','Label paper',editLabelPapers);
  action(io,'JSON 내보내기','Export JSON',()=>{
   if(busy)return;download('mapping-profiles.json',JSON.stringify(db,null,2),'application/json');
   storageNote=t('프로필 다운로드 요청됨 · 파일 저장 여부를 확인하세요.','Profile download requested · verify the saved file.');refresh();
  },'out');
  group.append(named,mappings,actions,io);details.append(group);
  localizers.push(()=>{
   const list=entries(),index=activeIndex(list),profile=list[index][1],files=fileMappingCount(profile);
   retry.hidden=!lastWorkbook?.offer;retry.disabled=busy;
   retry.textContent=lastWorkbook?.offer?t('이 프로필로 다시 연결: ','Reconnect with this profile: ')+lastWorkbook.file.name:'';
   title.textContent=t('사용 중인 프로필','Active profile');
   page.textContent=list.length>1?(index+1)+' / '+list.length:'';page.hidden=list.length===1;
   const workbookLabel=t('RAW 또는 프로필 불러오기','Import workbook or profile');
   openWorkbook.setAttribute('aria-label',workbookLabel);openWorkbook.title=workbookLabel;
   openWorkbook.disabled=busy||(typeof dataImportBusy!=='undefined'&&dataImportBusy);
   row.dataset.count=String(Math.min(list.length,3));
   prev.hidden=next.hidden=list.length===1;
   for(const [button,edge,label] of [[prev,index===0,t('이전 프로필','Previous profile')],[next,index===list.length-1,t('다음 프로필','Next profile')]]){
    button.setAttribute('aria-label',label);button.setAttribute('aria-disabled',String(busy||edge));button.disabled=busy;
   }
   rail.replaceChildren();
   for(const offset of [-1,0,1]){
    const item=list[index+offset];
    if(!item&&list.length===1)continue;
    const slot=node('div',undefined,{className:'profile-document-slot'});
    if(item){
     const [id,p]=item,active=id===db.active;
     const button=node('button',undefined,{type:'button',className:'profile-document'});
     const glyph=node('span',undefined,{className:'profile-file-icon'});
     glyph.setAttribute('aria-hidden','true');glyph.append(node('span','JSON',{className:'profile-file-type'}));
     button.append(glyph,node('span',p.name,{className:'profile-document-name'}));button.title=p.name;
     if(active)button.setAttribute('aria-current','true');
     button.disabled=busy;button.onclick=()=>activate(index+offset,true);slot.append(button);
    }
    rail.append(slot);
   }
   if(direction){const selected=rail.querySelector('[aria-current="true"]');selected?.classList.add(direction>0?'profile-doc-from-right':'profile-doc-from-left');direction=0;}
   activeInfo.replaceChildren(node('span',profile.name+' · ',{className:'beam-sr'}),node('span',files?t('저장된 시트 '+files+'개',files+' saved worksheets'):t('저장된 시트 연결 없음','No saved worksheet mappings')));
   named.textContent=profile.name;mappings.replaceChildren();
   const saved=savedConnections();
   for(const {source,kind,profile:mapping} of saved){
    const line=node('li');line.append(node('span',role(kind)),node('small',source==='file'?(mapping.sheetName||'Excel'):t('붙여넣기','Paste')));mappings.append(line);
   }
   if(!saved.length)mappings.append(node('li',t('아직 저장된 연결이 없어요.','No saved mappings yet.'),{className:'profile-empty-mapping'}));
  });
  refresh();
 }
 return {begin,init,refresh,importProfile,exampleConnection,editConnection,forgetSources,locationRules,labelPapers,dispatchProfile,cartonProfile,saveCartonMapping,rememberWorkbook,offerWorkbookRetry,waitForProfileImport,isBusy:()=>busy};
})();


Object.assign(translations,{"이전":"Previous","다음":"Next","현재 오더 대조 결과":"Current order reconciliation","통합 파일 불러오기":"Import combined workbook","현재 프로필의 연결을 재사용합니다. 선택하지 않은 자료는 유지합니다.":"Reuses the active profile. Unselected data stays unchanged.","위치 자료를 불러오세요":"Load location data","위치 자료의 SKU 확인 필요":"Verify SKU in location data","피킹 위치 안내":"Picking locations","켜짐: 설정한 피킹 위치 표시. 위치 안내만 제공하며 실제 재고 이동은 실행하지 않습니다.":"On: show configured picking locations. Guidance only; no inventory movement.","피킹 위치 안내 안내": "Picking location guidance", "켜짐: 설정한 피킹 위치 표시": "On: show configured picking locations", "위치 안내만 제공 · 실제 재고 이동 없음": "Guidance only · No inventory movement", "SKU 확인 필요": "SKU verification needed", "현재 오더에 배정된 상품의 위치를 확인하세요": "View a product assigned to the current order", "SKU·Barcode 위치 정보 충돌": "SKU / Barcode location conflict", "위치 유형 열을 연결한 자료를 다시 불러오세요": "Reload location data with its location-type column mapped", "등록된 피킹 위치 없음": "No eligible picking location", "같은 Loc의 Zone 정보 충돌": "Conflicting zones for the same Loc", "Zone 확인 필요": "Zone needs verification", "비정형 Loc · Zone 확인 필요": "Non-standard Loc · Verify Zone", "복수 창고 위치 · 창고 확인 필요": "Multiple warehouses · Verify warehouse"});
Object.assign(translations,{'반품 예정 자료':'Expected return data','상품 자료':'Product data','위치 자료':'Location data','반품 예정':'Expected returns','Order ID가 비어 있습니다.':'Order ID is empty.','Expected quantity는 0 이상의 정수여야 합니다.':'Expected quantity must be a non-negative integer.'});
Object.assign(translations,{'주문번호 또는 고객명 검색':'Search order number or customer name','고객명 조회 자료 형식이 올바르지 않습니다.':'Invalid customer lookup data.','고객명 조회 자료의 주문 또는 이름을 확인하세요.':'Verify the order IDs and names in customer lookup data.','고객명은 4096자 이하여야 합니다.':'Customer name must not exceed 4096 characters.'});
const orderedTranslations=Object.keys(translations).sort((a,b)=>b.length-a.length);
function tr(value){const text=String(value??'');if(language!=='en')return text;if(translations[text])return translations[text];let out=text;out=out.replace(/^입력 ([\d,]+)개 기록됨$/,'$1 units recorded').replace(/^입력 ([\d,]+)개$/,'$1 units entered').replace(/^실물 ([\d,]+) \/ 전산 수량 ([\d,]+)$/,'Counted $1 / Expected quantity $2').replace(/^ · ([\d,]+)개 바코드 \/ 일치 ([\d,]+)개$/,' · $1 codes / $2 matched').replace(/^차이 ([+-]?[\d,]+)$/,'Difference $1').replace(/^(\d+)행: /,'Row $1: ').replace(/(\d+)행/g,'$1 rows').replace(/(\d+)개 등록 · /,'$1 units registered · ').replace(/ 입력 (\d+)개를 취소했습니다\.$/,' · Reversed $1 units.');for(const key of orderedTranslations)if(key.length>1)out=out.split(key).join(translations[key]);return out;}
function uiData(value){
 const out=String(value??'');if(language!=='en')return out;const core=Engine.getIndex(state.data);
 if(protectedTextCache?.core!==core){const exact=new Set(),groups=new Map();for(const rows of Object.values(state.data))for(const r of rows)for(const value of Object.values(r)){const v=typeof value==='string'?value:'';if(!v||!/[가-힣]/.test(v))continue;exact.add(v);exact.add(v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));}for(const v of exact){if(!groups.has(v[0]))groups.set(v[0],[]);groups.get(v[0]).push(v);}for(const a of groups.values())a.sort((a,b)=>b.length-a.length);protectedTextCache={core,exact,groups};}
 if(protectedTextCache.exact.has(out))return out;let text=out;const protectedValues=[],candidates=[];for(const c of new Set(out))for(const v of protectedTextCache.groups.get(c)||[])if(v.length<=out.length&&out.includes(v))candidates.push(v);for(const e of [...state.scans,...(state.pending||[])])for(const k of ['barcode','sku','receipt'])if(e[k]&&/[가-힣]/.test(e[k])&&out.includes(e[k]))candidates.push(e[k]);candidates.sort((a,b)=>b.length-a.length);for(const v of new Set(candidates)){const token=String.fromCharCode(0xE100+protectedValues.length);text=text.split(v).join(token);protectedValues.push(v);}return tr(text).replace(/[\uE100-\uF8FF]/g,c=>protectedValues[c.charCodeAt(0)-0xE100]??c);
}
const staticText=[],staticAttrs=[];
if(document.createTreeWalker){const walk=document.createTreeWalker(document.body,4);let n;while(n=walk.nextNode()){if(n.parentElement?.closest('script,style,#rows,#history,#meta,#lastsku,#lastname,#lastbarcode,#location,#receipt,#sources,#message,#feedback,#saved,#assignment,#candidates,#heading,#subtitle,#rowcount,#laststatus,#remaininglabel,#lastcount,#itemdelta,#empty'))continue;if(/[가-힣]/.test(n.nodeValue))staticText.push([n,n.nodeValue]);}for(const el of document.querySelectorAll('[placeholder],[aria-label],[title]'))for(const attr of ['placeholder','aria-label','title'])if(el.hasAttribute(attr))staticAttrs.push([el,attr,el.getAttribute(attr)]);}
function localizeStatic(){for(const el of document.querySelectorAll('[data-ko][data-en]'))el.textContent=language==='en'?el.dataset.en:el.dataset.ko;for(const [node,text]of staticText)node.nodeValue=tr(text);for(const [el,key,value]of staticAttrs)el.setAttribute(key,tr(value));document.documentElement?.setAttribute('lang',language==='en'?'en':'ko');const select=document.getElementById('language');if(select)select.value=language;}
const nativeConfirm=globalThis.confirm;function uiConfirm(message){return nativeConfirm(uiData(message));}

function ui(value){return tr(value);}
const canonicalUI=new Map();
function setUI(id,value,html=false,protect=false){canonicalUI.set(id,{value,html,protect});document.getElementById(id)[html?'innerHTML':'textContent']=protect?uiData(value):tr(value);}
function refreshUI(){for(const [id,{value,html,protect}]of canonicalUI)document.getElementById(id)[html?'innerHTML':'textContent']=protect?uiData(value):tr(value);}
const productCollator=new Intl.Collator('ko-KR',{numeric:true,sensitivity:'base'});
function sortProductRows(rows){const namesByKey=new Map();for(const r of rawRows(state.receipt)){const k=Engine.key(r);if(!namesByKey.has(k))namesByKey.set(k,new Set());if(String(r.name||'').trim())namesByKey.get(k).add(r.name);}const masterNames=uiIndex().masterNames;const actualName=r=>{const names=namesByKey.get(r.key);if(!r.unregistered&&names&&!names.size)return '';if(['ASN 상품명 없음','상품 정보 없음'].includes(r.name)&&!names?.has(r.name)&&!masterNames.has(r.name))return '';return String(r.name||'').trim();};const group=s=>!s?3:/^[0-9]/.test(s)?0:/^[A-Za-z]/.test(s)?1:2;return rows.map((r,i)=>({r,i,name:actualName(r)})).sort((a,b)=>group(a.name)-group(b.name)||productCollator.compare(a.name,b.name)||productCollator.compare(String(a.r.sku||''),String(b.r.sku||''))||productCollator.compare(String(a.r.barcode||''),String(b.r.barcode||''))||String(a.r.key||'').localeCompare(String(b.r.key||''),'en')||a.i-b.i).map(x=>x.r);}

// The resolved ASN's store is presentation only: never narrow candidates with it.
function resolvedStoreName(){
 if(!state.receipt)return '';
 const names=[...new Set(rawRows(state.receipt).map(r=>String(r.seller||r.company||'').trim()).filter(Boolean))];
 return names.length===1?names[0]:'';
}
function syncStoreDisplay(){
 const input=$('store');
 if(document.activeElement===input)return;
 input.value=state.store||resolvedStoreName();
}
function matchesStore(r){const selected=state.storeSelection;if(selected&&state.store===selected.name)return (r.seller||r.company||'')===selected.name&&(r.company||'')===selected.company&&(r.address||'')===selected.address;return Engine.storeMatches(r,state.store);}
function drawAsnProgress(){
 const p=Engine.asnProgress(state.data,state.receipt,state.scans,state.pending||[],state.currentBatch||''),english=language==='en';
 $('asnProgress').dataset.phase=p.phase;
 $('orderCoverage').dataset.phase=p.phase;
 setUI('asnProgressStatus',p.phase==='waiting'?(state.receipt?'ASN 기준 데이터 없음':'ASN 선택 필요'):isInspectionConfirmed()?'✓ ASN 검수 완료':p.complete?'ASN 수량 일치 · 완료 대기':p.phase==='excess'?'! ASN 수량 초과':p.phase==='warning'?'! ASN 확인 필요':'… ASN 검수 진행',false,false);
 $('asnProgressCount').textContent=state.receipt?tr('실물')+' '+p.actual.toLocaleString()+' / '+tr('예정')+' '+p.expected.toLocaleString()+' EA':'— / —';
 setUI('asnProgressScope',(state.receipt?'ASN '+state.receipt+' · ':'')+'현재 ASN 전체 · 실물 / Expected quantity',false,true);
 const coverage=$('asnCoverage'),bar=$('asnProgressBar'),details=$('asnCoverageDetails'),qty=$('asnCoverageQuantity');
 qty.textContent=p.percent===null?'—':p.covered.toLocaleString()+' / '+p.expected.toLocaleString()+' EA';
 const remaining=Math.max(0,p.expected-p.covered),detail=[];
 if(remaining)detail.push(remaining.toLocaleString()+(english?' remaining':'개 남음'));
 if(p.excess)detail.push(p.excess.toLocaleString()+(english?' excess':'개 초과'));
 if(p.phase==='warning')detail.push(english?'Review needed':'확인 필요');
 if(p.complete)detail.push(isInspectionConfirmed()?(english?'Complete':'검수 완료'):(english?'Ready to confirm':'수량 일치 · 완료 대기'));
 coverage.textContent=p.percent===null?'—':p.percent+'%';
 details.textContent=p.percent===null?(english?'Waiting for order data':'오더 기준 대기'):detail.join(' · ');
 bar.value=p.expected?Math.min(100,p.covered/p.expected*100):0;
 bar.setAttribute('aria-valuetext',[qty.textContent,coverage.textContent,details.textContent].filter(Boolean).join(' · '));
 $('asnBatchCount').textContent=tr('현재 묶음')+' '+p.batch.toLocaleString()+' · '+tr('미배정 입력')+' '+p.unassigned.toLocaleString();
 $('mobileBatchCount').textContent=$('asnBatchCount').textContent;
}

const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Keep phone keyboards tied to deliberate input taps, not navigation.
function beamPhoneUI(){return globalThis.matchMedia?.('(max-width: 760px) and (any-pointer: coarse)').matches===true;}
function focusBeamInput(id,fallback){
 const field=$(id);
 if(!beamPhoneUI()||document.activeElement===field){field.focus({preventScroll:true});return;}
 if(fallback)$(fallback)?.focus({preventScroll:true});
}
const makeId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
let lastBarcode='',receiptIds=[];
let viewedSheetKey=null;
let state={version:1,data:{raw:[],sku:[],loc:[]},scans:[],receipt:'',sources:{},pending:[],store:'',audit:[]},dirty=false;
function audit(action,events=[],receipt='',note=''){state.audit??=[];state.audit.push({id:makeId(),at:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,offsetMinutes:-new Date().getTimezoneOffset(),action,receipt,events:events.map(s=>({id:s.id||'',barcode:s.barcode||'',sku:s.sku||'',kind:s.kind||'barcode',qty:Engine.units(s),inputSource:s.inputSource||'scanner',at:s.at})),note});}
const noticeStrips=createNoticeStrips(document,$('beamNoticeStrip'));
const actionable=/확인|필요|선택|오류|없|불가|경고|다시|verify|warning|cannot|not found|select|required|unavailable|try again/i;
for(const [id,options] of Object.entries({
 feedback:{transient:true,accept:text=>!text.includes('개 등록')||/ASN 변경|배정 확인/.test(text)},
 cartonFeedback:{tone:'warning'},
 beamDriveExportStatus:{container:'beamDriveNotice'},beamOneDriveExportStatus:{container:'beamOneDriveNotice'},
 cartonSearchNote:{container:'cartonFind',tone:'warning'},cartonSource:{accept:text=>actionable.test(text)},
 allocationHint:{container:'allocationNotice',tone:'warning'},
 beamSearchStatus:{accept:text=>!/^검색 결과|^\d+[\s,]+(orders?|results?|matches)/i.test(text)&&actionable.test(text)},
 cartonImportError:{tone:'error'},dataEditorFeedback:{tone:'error'},allocationError:{tone:'error'},
 demoStatus:{},reportNotice:{},productLabelStatus:{},beamRecoveryStatus:{container:'beamRecoveryPanel',tone:'warning'},
 beamRawMessage:{container:'beamRawStatus'},beamEmptyText:{container:'beamEmpty',accept:text=>actionable.test(text)},
}))noticeStrips.bind(id,options);

function notice(msg,severity='info',reason=''){
 const message=$('message'),dialog=$('dialogNotice');
 const important=severity!=='info';
 message.dataset.reason=reason;
 for(const k of ['warning','error'])message.classList.toggle('notice-'+k,severity===k);
 message.classList.toggle('beam-notice-source',!important);
 dialog.classList.toggle('beam-notice-source',!important);
 setUI('message',msg,false,true);setUI('dialogNotice',msg,false,true);
 message.style.display=msg?'block':'none';
 if(msg){
  const activeDialog=[...document.querySelectorAll('dialog[open]')].at(-1);
  noticeStrips.show(message.textContent,{tone:severity,announce:activeDialog?activeDialog.id!=='dataDialog':!!message.closest('[hidden],[inert]')});
 }
}
var workFields=['workNumber','currentBatch','searchMode','receipt','store','storeSelection','receiptLocked','assignment','autoPaused','scans','pending','audit','orderTabs','archivedScans','archivedPending','confirmations','confirmationCommitments'];
function workHasEntries(){
 if(state.scans.length||state.pending?.length||state.confirmations?.some(c=>c.batch===state.currentBatch))return true;
 const audit=state.audit||[];for(let i=audit.length-1;i>=0;i--){if(audit[i].action==='새 작업 시작')break;if(audit[i].events?.length)return true;}
 return false;
}
function workReceiptGate(){
 const b2c=isB2C(),bound=workHasEntries();
 const customer=b2c&&bound?(state.scans.find(e=>e.receipt)?.receipt||state.receipt||(state.audit||[]).findLast(a=>a.events?.length&&a.receipt)?.receipt):'';
 const key=!b2c&&(bound||state.storeSelection||state.store?.trim())?selectedWorkStoreKey():'';
 return id=>modeAllowsReceipt(id)&&(b2c?(!customer||id===customer):(!key||asnStoreKey(id)===key));
}
function workAllowsReceipt(id){return workReceiptGate()(id);}
function workContextWarning(){
 notice(language==='en'?'Use + New work to change the store, customer, or mode after scanning.':'스캔 후 매장·고객·모드를 바꾸려면 + 새 작업을 열어 주세요.','warning');
 return false;
}
function workSnapshot(s){return Object.fromEntries(workFields.filter(k=>Object.hasOwn(s,k)).map(k=>[k,s[k]]));}
function workLabel(w){
 const base=(language==='en'?'Work ':'작업 ')+(w.workNumber||1);
 const target=w.searchMode==='b2c'?(w.receipt?state.customerNames?.[w.receipt]?.[0]||receiptDisplay(w.receipt)||w.receipt:''):w.storeSelection?.name||w.store||rawRows(w.receipt)[0]?.seller||'';
 return base+(target?' · '+target:'');
}
function normalizedActiveWork(w){
 if(!w.currentBatch)w.currentBatch=makeId();
 w.workNumber??=1;
 const normalize=(events)=>{const current=[],older=[];for(const event of events||[]){if(event.batch&&event.batch!==w.currentBatch)older.push(event);else current.push(event.batch?event:{...event,batch:w.currentBatch});}return [current,older];};
 for(const [key,archived] of [['scans','archivedScans'],['pending','archivedPending']]){
  const [current,older]=normalize(w[key]);w[key]=current;if(older.length)w[archived]=[...(w[archived]||[]),...older];
 }
 return w;
}
function drawWorkTabs(){
 state.currentBatch??=makeId();state.workNumber??=1;
 const tabs=[...(state.workSheets||[]),state].sort((a,b)=>a.workNumber-b.workNumber);
 const label=language==='en'?'Return work sheets':'반품 작업 시트';$('workDeck').setAttribute('aria-label',label);
 $('beamNewWorkLabel').textContent=language==='en'?'New work':'새 작업';$('newWorkTab').disabled=!!dataImportBusy||tabs.length>=50;
 const shown=workLabel(state),key=JSON.stringify([language,shown,tabs.map(w=>[w.currentBatch,workLabel(w),w===state])]);if($('workTabs').dataset.renderKey!==key){
  const strip=$('workTabs'),active=document.activeElement?.dataset?.workTab;
  strip.dataset.renderKey=key;strip.replaceChildren(...tabs.map(w=>{const b=document.createElement('button');b.type='button';b.className='work-tab';b.dataset.workTab=w.currentBatch;b.textContent=workLabel(w);b.title=b.textContent;b.setAttribute('aria-pressed',String(w===state));if(w===state)b.setAttribute('aria-current','true');b.setAttribute('aria-controls','orderInspectionPanel');return b;}));if(active)[...strip.children].find(b=>b.dataset.workTab===active)?.focus({preventScroll:true});
 }
 const strip=$('workTabs'),current=[...strip.children].find(b=>b.dataset.workTab===state.currentBatch);
 const visibleKey=JSON.stringify([state.currentBatch,shown,strip.clientWidth]);
 if(current&&strip.dataset.visibleWork!==visibleKey){
  strip.dataset.visibleWork=visibleKey;
  const bounds=strip.getBoundingClientRect(),rect=current.getBoundingClientRect();
  if(rect.left<bounds.left)strip.scrollLeft-=bounds.left-rect.left;
  else if(rect.right>bounds.right)strip.scrollLeft+=rect.right-bounds.right;
 }
 $('workScopeBar').setAttribute('aria-label',shown);
}
function switchWorkTab(id,create=false){
 if(dataImportBusy)return false;
 const current=workSnapshot(state),sheets=state.workSheets||[];
 if(!create&&id===current.currentBatch)return true;
 if(create&&sheets.length>=49)return false;
 const other=create?{currentBatch:makeId(),workNumber:1+Math.max(state.workNumber||1,...sheets.map(s=>s.workNumber)),searchMode:state.searchMode||'b2b',receipt:'',store:'',assignment:'',autoPaused:false,receiptLocked:false,scans:[],pending:[],audit:[],orderTabs:[],confirmations:[]}:sheets.find(w=>w.currentBatch===id);
 if(!other)return false;
 closeStoreList();closeReceiptList();
 for(const field of workFields)delete state[field];
 state={...state,...other,workSheets:[...sheets.filter(w=>w!==other),current]};
 $('store').value=state.store||resolvedStoreName();$('customerQuery').value='';$('barcode').value='';lastBarcode='';orderSearchCache=null;historyPage=0;resultPage=0;
 changed();draw();notice('');
 if(create)(isB2C()?$('customerQuery'):$('store')).focus();else [...$('workTabs').children].find(b=>b.dataset.workTab===id)?.focus({preventScroll:true});
 return true;
}
function startNewWork(){
 if(!switchWorkTab('',true))return;
 $('newWorkDialog').close();
 requestAnimationFrame(()=> (isB2C()?$('customerQuery'):$('store')).focus());
 notice(language==='en'?'New work sheet opened. The previous sheet is unchanged.':'새 작업 시트를 열었어요. 이전 시트의 기록은 그대로예요.');
}
function activeWorkAudit(){
 const audit=state.audit||[];let start=0;
 for(let i=audit.length-1;i>=0;i--)if(audit[i].action==='새 작업 시작'){start=i+1;break;}
 return audit.slice(start);
}

var browserRecovery;
let workbenchReady=false;
function changed(){dirty=true;setUI('saved','저장 필요',false,false);browserRecovery?.schedule();}

function reconcileView(data,receipt,scans){if(!renderReadCache)return Engine.reconcile(data,receipt,scans);let byScan=renderReadCache.get(data);if(!byScan){byScan=new WeakMap();renderReadCache.set(data,byScan);}let byReceipt=byScan.get(scans);if(!byReceipt){byReceipt=new Map();byScan.set(scans,byReceipt);}if(!byReceipt.has(receipt))byReceipt.set(receipt,Engine.reconcile(data,receipt,scans));return byReceipt.get(receipt);}
function rawRows(receipt){return Engine.getIndex(state.data).rawByReceipt.get(receipt)||[];}
let orderSearchCache=null,storeCandidateCache=null,trackingIndexCache=null;
function uiIndex(){
 const core=Engine.getIndex(state.data),customerNames=state.customerNames;
 if(uiIndexCache?.core===core&&uiIndexCache.customerNames===customerNames)return uiIndexCache;protectedTextCache=null;orderSearchCache=null;storeCandidateCache=null;
 const stores=new Map(),modeIds={b2b:[],b2c:[]},modeSets={b2b:new Set(),b2c:new Set()},external=new Map(),masterNames=new Set(state.data.sku.map(r=>r.name).filter(Boolean)),orderSearch=new Map(),orderExact=new Map();
 const addExact=(text,id)=>{if(!text)return;if(!orderExact.has(text))orderExact.set(text,new Set());orderExact.get(text).add(id);};
 for(const [id,rows]of core.rawByReceipt){
  const values=[...new Set(rows.map(r=>r.external).filter(Boolean))];external.set(id,values);for(const value of [id,...values])addExact(value,id);
  const names=customerNames&&Object.hasOwn(customerNames,id)?customerNames[id]:[];const mode=core.hasReturnChannel?core.returnChannels.get(id):names.length?'b2c':'b2b';if(mode){modeIds[mode].push(id);modeSets[mode].add(id);}orderSearch.set(id,{numberKeys:[id,...values].map(v=>v.toLowerCase()),nameKeys:[...new Set(names.map(customerLookupKey))],names,expected:rows.reduce((sum,r)=>sum+r.qty,0)});
  if(mode==='b2b')for(const r of rows){const key=JSON.stringify([r.seller||r.company||'',r.company||'',r.address||'']);if(!stores.has(key))stores.set(key,{row:r,name:r.seller||r.company||'',company:r.company||'',address:r.address||'',receipts:new Set()});stores.get(key).receipts.add(id);}
 }
 uiIndexCache={core,stores,modeIds,modeSets,external,masterNames,ids:[...core.rawByReceipt.keys()],orderSearch,orderExact,customerNames};return uiIndexCache;
}
function isB2C(){return state.searchMode==='b2c';}
function modeReceiptIds(){return uiIndex().modeIds[isB2C()?'b2c':'b2b'];}
function modeAllowsReceipt(id){return uiIndex().modeSets[isB2C()?'b2c':'b2b'].has(id);}
function clearModeSelection(){state.receipt='';state.assignment='';state.receiptLocked=false;state.autoPaused=true;lastBarcode='';}
function enforceActiveMode(){if(state.receipt&&rawRows(state.receipt).length&&!modeAllowsReceipt(state.receipt))clearModeSelection();}
function syncSearchMode(){
 const b=isB2C(),en=language==='en',bound=workHasEntries();for(const [id,active] of [['searchB2B',!b],['searchB2C',b]])$(id).setAttribute('aria-disabled',String(bound&&!active));$('store').readOnly=bound;$('customerQuery').readOnly=bound;$('workScopeBar').hidden=bound;$('searchB2B').setAttribute('aria-pressed',String(!b));$('searchB2C').setAttribute('aria-pressed',String(b));$('searchB2B').textContent=en?'B2B · Store':'B2B · 매장';$('searchB2C').textContent=en?'B2C · Customer':'B2C · 고객';
 $('storeSearchField').hidden=b;$('customerSearchField').hidden=!b;$('customerQuery').disabled=!!state.receiptLocked;$('customerQuery').placeholder=en?'Customer name or return tracking number':'고객명 또는 반송장번호';$('customerQuery').previousElementSibling.textContent=en?'Customer name':'고객명';
 $('store').placeholder=en?'Store name or return tracking number':'매장명 또는 반송장번호';
 $('receipt').placeholder=b?(en?'Customer name or return tracking':'고객명 또는 반송장번호'):(en?'Order number':'오더번호');$('receipt').setAttribute('aria-label',$('receipt').placeholder);
 $('rawImportModeLabel').textContent=en?'Expected order import':'예정 자료 적용';$('rawImportMode').options[0].textContent=en?'Replace':'교체';$('rawImportMode').options[1].textContent=en?'Add orders · reject duplicate keys':'오더 추가 · 중복 키 거절';
}
function setSearchMode(mode){if(!['b2b','b2c'].includes(mode))return false;if(mode===(isB2C()?'b2c':'b2b'))return true;if(workHasEntries())return workContextWarning();if(state.receiptLocked){notice(tr('검수 대상 고정을 먼저 해제해 주세요.'),'warning');return false;}closeReceiptList();closeStoreList();closeDiscrepancyPreview();clearModeSelection();state.store='';delete state.storeSelection;$('store').value='';$('barcode').value='';state.searchMode=mode;orderSearchCache=null;$('customerQuery').value='';changed();draw();if(!beamPhoneUI())(isB2C()?(state.receiptLocked?$('searchB2C'):$('customerQuery')):$('store')).focus();return true;}
function selectCustomerOrder(id){if(!isB2C()||!workAllowsReceipt(id)||state.receiptLocked&&id!==state.receipt)return false;state.receipt=id;state.assignment='선택됨';state.autoPaused=true;state.orderTabs=[...new Set([...(state.orderTabs||[]),id])];changed();draw();$('customerQuery').value='';focusBeamInput('barcode');return true;}
function storeReceiptCandidates(){
 if(isB2C())return [];const ix=uiIndex(),key=JSON.stringify([state.store||'',state.storeSelection||null]);
 if(storeCandidateCache?.ix===ix&&storeCandidateCache.key===key)return storeCandidateCache.ids;
 const selected=new Set();for(const st of ix.stores.values())if(matchesStore(st.row))for(const id of st.receipts)selected.add(id);
 const ids=ix.modeIds.b2b.filter(id=>selected.has(id));storeCandidateCache={ix,key,ids};return ids;
}
function matchesReference(r,event){return Engine.matches(r,event,state.data);}
function getCandidates(){let list=storeReceiptCandidates();for(const scan of (state.pending||[]).filter(e=>!e.holdForStore))list=list.filter(id=>rawRows(id).some(r=>matchesReference(r,scan)));return list;}
function drawSuggestions(){const selected=state.storeSelection;const eligible=!isB2C()&&!state.receipt&&!state.autoPaused&&!!selected?.name&&selected.name===state.store;const ids=eligible?getCandidates():[],show=ids.length>1;$('scanSuggestions').classList.toggle('hidden',!show);if(!show){$('suggestedProducts').innerHTML='';return;}const items=Engine.suggest(state.data.raw,ids,state.pending||[],2);$('suggestionHeading').textContent=tr(items.length?'이 상품이 있으면 먼저 스캔해 보세요':'ASN을 직접 선택해 주세요');$('suggestionNote').textContent=tr(items.length?'아직 검수하지 않은 실물이 있을 때만 스캔하세요.':'먼저 스캔할 상품을 찾지 못했습니다. 입력 기록은 유지됩니다.');$('suggestedProducts').innerHTML=items.map(item=>`<li><span class="suggest-name">${esc(item.name||tr('상품명 없음'))}</span><span class="suggest-code">${esc(item.code)}</span>${item.sku&&item.sku!==item.code?`<span class="suggest-sku">SKU ${esc(item.sku)}</span>`:''}</li>`).join('');}
function setMarkup(id,html){const el=$(id);if(el.innerHTML!==html)el.innerHTML=html;}
function drawWorkspaceContext(){
 enforceActiveMode();syncSearchMode();referenceFingerprintState();
 const hasCustomerNames=!!Object.keys(state.customerNames||{}).length;
 const button=$('save');
 button.title=hasCustomerNames
  ?(language==='en'?'Save work file, including customer names':'작업파일 저장 · 고객명 포함')
  :(language==='en'?'Save work file':'작업파일 저장');
 button.title+=(language==='en'?' · Up to 50 MB':' · 최대 50MB');
 button.setAttribute('aria-label',button.title);
 closeOrderInfo();syncAvailabilitySetting();endQuestPeek();
 if($('receiptBarcodeDialog')?.open)$('receiptBarcodeDialog').close();
 closeDiscrepancyPreview();$('confirmationText').value='';$('copyConfirmation').disabled=true;
 const receipts=modeReceiptIds();
 receiptIds=(!isB2C()&&state.store?.trim()?storeReceiptCandidates():receipts).filter(workReceiptGate());
 const selected=!!state.receipt;
 $('receipt').value=receiptDisplay(state.receipt);$('receipt').setAttribute('aria-invalid','false');
 syncStoreDisplay();drawWorkTabs();
 $('print').disabled=$('reset').disabled=!selected;
 $('barcode').disabled=$('scanbutton').disabled=!receipts.length;
 const sources=['반품 예정 자료','위치 자료','상품 자료'];
 setMarkup('sources',['raw','loc','sku'].map((key,i)=>`<div class="source"><span>${tr(sources[i])}</span><span>${state.data[key].length.toLocaleString()} ${tr('행')}</span></div>`).join(''));
 setUI('subtitle',selected?'바코드를 입력하면 실물 수량이 1개씩 쌓입니다.':'기준 데이터를 넣고 ASN을 선택하면 검수를 시작합니다.',false,false);
 $('externalRef').textContent=receiptIdentityLabel(state.receipt);
 $('selectedInternalLabel').textContent=language==='en'?'External order ID':'외부 주문 번호';
 const external=$('selectedExternalKey');
 external.hidden=!selected;
 external.textContent=selected&&!receiptDisplay(state.receipt)?(language==='en'?'External order number missing or ambiguous':'외부 주문 번호를 확인하세요.'): '';
 $('receiptBarcode').disabled=!receiptBarcodeValue();
 drawOverviewTracking(rawRows(state.receipt));
}
function drawInspectionTotals(rows){
 const totals={expected:0,actual:0,missing:0,excess:0,matched:0,matchedTypes:0,types:0};
 for(const r of rows){
  totals.expected+=r.expected;totals.actual+=r.actual;totals.missing+=r.missing;
  if(r.unregistered)continue;
  totals.excess+=r.excess;
  if(r.expected<=0)continue;
  totals.types++;
  if(r.status==='일치'&&!r.unresolved){totals.matched+=r.actual;totals.matchedTypes++;}
 }
 for(const key of ['expected','actual','missing','excess'])$(key).textContent=totals[key].toLocaleString();
 $('normal').textContent=totals.matched.toLocaleString();
 $('normalTypes').textContent=tr('정상 확인')+' '+totals.matchedTypes.toLocaleString()+' SKU';
 $('normalTypes').title=totals.matchedTypes+' / '+totals.types+' SKU';
 $('normalUnit').textContent='EA';
 drawWorkUnverified();
 for(const id of ['normal','unregistered','expected','actual','missing','excess'])$(id).classList.toggle('quiet',$(id).textContent==='0');
}
function drawComparison(rows){
 const filter=$('filter').value;
 const comparison=currentOrderComparison(rows);
 const filtered=comparison.filter(r=>filter==='all'||(filter==='ok'?r.status==='일치':r.status!=='일치'));
 setUI('rowcount',` · ${rows.length}개 바코드 / 일치 ${rows.filter(r=>r.status==='일치').length}개`,false,false);
 const pageKey=state.receipt+'|'+filter;
 if(resultPageKey!==pageKey){resultPage=0;resultPageKey=pageKey;}
 resultPage=Math.min(resultPage,Math.max(0,Math.ceil(filtered.length/200)-1));
 $('resultPager').hidden=filtered.length<=200;
 $('resultPrev').disabled=resultPage===0;$('resultNext').disabled=(resultPage+1)*200>=filtered.length;
 $('resultPageLabel').textContent=(filtered.length?(resultPage*200+1)+'–'+Math.min(filtered.length,(resultPage+1)*200):'0')+' / '+filtered.length;
 const visible=$('results').open?sortProductRows(filtered).slice(resultPage*200,(resultPage+1)*200):[];
 setMarkup('rows',visible.map(r=>`<tr data-quantity-state="${r.missing>0?'shortage':r.unregistered?'unexpected':r.excess>0?'excess':''}"><td><span class="badge ${r.status==='일치'?'ok':['정보 충돌','예정 외','식별자 없음'].includes(r.status)?'bad':''}">${esc((r.status==='예정 외'?(language==='en'?'Not on this ASN':'현재 ASN에 없음'):tr(r.status)))}</span>${r.heldDisplay?'<small class="comparison-held">'+esc(language==='en'?'Includes held input':'보류 입력 포함')+'</small>':''}</td><td class="mono">${esc(r.barcode)}<div class="small">${esc(r.sku)}</div></td><td class="name">${productIdentityMarkup(uiData(r.name),r.conflict?null:r.brand)}${pickingLocationLine(r)}</td>${['expected','actual'].map(k=>`<td class="num">${r[k].toLocaleString()}</td>`).join('')}<td class="num">${r.actual-r.expected>0?'+':''}${(r.actual-r.expected).toLocaleString()}</td></tr>`).join(''));
 $('empty').style.display=filtered.length?'none':'block';
 setUI('empty',state.receipt?'<strong>이 조건에 해당하는 항목이 없습니다.</strong>전체 필터에서 다시 확인하세요.':'<strong>검수할 ASN을 기다리고 있어요.</strong>설정에서 기준 데이터를 불러와 주세요.',true,false);
}
function draw(scanOnly=false){
 scanOnly=scanOnly===true;
 renderReadCache=new Map();
 try{
  invalidateConfirmations();
  if(!scanOnly)drawWorkspaceContext();
  const rows=reconcileView(state.data,state.receipt,state.scans);
  drawInspectionTotals(rows);
  if(!scanOnly)drawOrderWorkspace();
  drawComparison(rows);syncSheetView();drawLast(rows);drawScanActivity(rows);drawSkuQuest(rows);drawLastScanned(rows);
  drawAsnProgress();updateConfirmButton();drawAllocationHint();drawAsnNavigation();
  if(!scanOnly){drawSuggestions();drawTargetLock();updateDataRows();PhoneOrderUI.sync();}
 }finally{renderReadCache=null;}
 if(workbenchReady){
  beamSaveState();
  if(!navigation.isInspection())beamRender();
  if(!scanOnly&&!$('beamSidebar').hidden)beamDrawJobs();
 }
}
function locationMarkup(r){if(!r)return '';const info=pickingLocationData(r);if(info.reason)return esc(tr(info.reason));return info.groups.map(({zone,locs})=>`<div class="loc-entry">${zone?`<span class="loc-zone"><span class="loc-zone-label">${esc(tr('구역'))}</span> ${esc(zone)}</span>`:''}${locs.map(full=>`<span class="loc-full">${esc(language==='en'?'Picking location':'피킹 위치')} ${esc(full)}</span>`).join('')}</div>`).join('')+(info.missingType?'<small>'+esc(language==='en'?'Some location types need verification':'일부 위치 유형 확인 필요')+'</small>':'');}
function phase(name){for(const key of ['progress','complete','warning','excess'])$('scanresult').classList.toggle('state-'+key,key===name);}
function showDifference(value,label){$('remaining').textContent=value;$('remaining').setAttribute('aria-label',label);}
function drawLast(rows){$('scanresult').setAttribute('data-quantity-state','');if(!state.receipt&&sheetEvents().length){phase(getCandidates().length?'progress':'warning');const last=latestSheetEvent(),rawMatches=state.data.raw.filter(x=>modeAllowsReceipt(x.receipt)&&matchesStore(x)&&matchesReference(x,last)),master=Engine.masterInfo(state.data,last),matches=rawMatches.length?rawMatches:[],skuNames=matches.length?[...new Set(matches.map(x=>x.sku).filter(Boolean))]:[master.sku].filter(Boolean),names=matches.length?[...new Set(matches.map(x=>x.name).filter(Boolean))]:[master.name].filter(Boolean);setUI('lastsku',(skuNames.length>1||(!rawMatches.length&&master.conflict))?'SKU 정보 충돌':skuNames[0]||(last.kind==='sku'?last.sku:'SKU 확인 필요'),false,true);setUI('lastname',(names.length>1||(!rawMatches.length&&master.conflict))?'상품명 확인 필요':names[0]||'상품 정보 없음',false,true);setUI('lastbarcode',Engine.eventCode(last)+(last.kind==='sku'?' · 수동 SKU':''),false,true);setUI('laststatus',state.autoPaused?'ASN을 선택해 주세요':getCandidates().length?'상품을 더 스캔해 주세요':'상품과 매장을 확인해 주세요',false,false);setUI('location','',false,true);setUI('itemdelta','',false,false);showDifference('—',tr('입력 기록 유지'));setUI('remaininglabel','입력 기록 유지',false,false);setUI('lastcount',`입력 ${(state.pending||[]).reduce((n,s)=>n+Engine.units(s),0)}개`,false,false);return;}const r=rows.find(x=>x.key===lastBarcode||x.barcode===lastBarcode);setUI('lastsku',r?(r.sku||'SKU 정보 없음'):'—',false,true);setUI('lastname',r?r.name:'',false,true);setUI('lastbarcode',r?r.barcode:'',false,true);setUI('laststatus',r?(r.unregistered&&!r.matchedInAsn?'현재 ASN에 없음':'ASN 포함')+' · '+(r.status==='일치'?'✓ 수량 일치':r.status==='정보 충돌'?'! 정보 충돌':r.status==='식별자 없음'?'! 식별자 없음':r.unregistered?'! 현재 ASN에 없음':r.actual>r.expected?'↑ 과입고':'… 검수 진행 · 부족') :'상품을 스캔해 주세요',false,false);const unsure=r&&(r.status==='정보 충돌'||r.status==='식별자 없음');$('scanresult').setAttribute('data-quantity-state',!r||unsure?'':r.unregistered?'unexpected':r.actual<r.expected?'shortage':r.actual>r.expected?'excess':'matched');phase(!r?'':unsure||r.unregistered?'warning':r.actual>r.expected?'excess':r.actual===r.expected?'complete':'progress');const delta=r?r.actual-r.expected:0;const matched=!!r&&!unsure&&!r.unregistered&&delta===0;const difference=r?(unsure?tr('확인'):delta>0?'+'+delta:delta):'—';showDifference(matched?'✓':difference,matched?tr('전산 · 실물 일치'):tr('실물 − 예정')+' '+difference);setUI('remaininglabel',!r?'실물 − 예정':unsure?'기준 정보 확인 필요':r?.unregistered?'ASN 미포함 수량':delta<0?'부족 수량':delta>0?'초과 수량':'전산 · 실물 일치',false,false);setUI('lastcount',r?`실물 ${r.actual} / 전산 수량 ${r.expected}`:'',false,false);$('location').innerHTML=locationMarkup(r);setUI('itemdelta',r?'차이 '+(r.actual-r.expected>0?'+':'')+(r.actual-r.expected):'',false,false);}
function prepareOrderAddition(next){
 if(!next.raw||$('rawImportMode').value!=='append')return next;
 if(!next.raw.length)throw Error(language==='en'?'No order rows to add.':'추가할 예정 자료 행이 없습니다.');
 const canonical=new Map();for(const row of next.raw){const original=String(row.receipt),key=original.normalize('NFC').trim();if(canonical.has(key)&&canonical.get(key)!==original)throw Error(language==='en'?'Ambiguous normalized order keys. Nothing was added.':'정규화 후 겹치는 오더 키가 있습니다. 추가하지 않았습니다.');canonical.set(key,original);}
 const existing=new Set(state.data.raw.map(r=>String(r.receipt).normalize('NFC').trim()));
 const conflicts=new Set(next.raw.map(r=>String(r.receipt).normalize('NFC').trim()).filter(id=>existing.has(id)));
 if(conflicts.size)throw Error(language==='en'?'Existing order keys overlap. Nothing was added; use Replace only if intended.':'기존 오더 키가 겹칩니다. 추가하지 않았습니다. 교체가 필요한 경우 적용 방식을 확인하세요.');
 const names=MappingCore.checkedCustomerNames(next.raw.customerNames,next.raw),oldNames=MappingCore.checkedCustomerNames(state.customerNames,state.data.raw),merged=[...state.data.raw,...next.raw],combined=Object.assign(Object.create(null),oldNames,names);
 Object.defineProperty(merged,'customerNames',{value:combined,enumerable:false,configurable:true});return {...next,raw:merged};
}
function replaceData(next,source){const addingOrders=!!next.raw&&$('rawImportMode').value==='append';try{next=prepareOrderAddition(next);}catch(error){notice(error.message,'error');return false;}if(Object.values(next).some(rows=>!rows.length)){notice('실제 데이터 행이 없습니다. 기존 기준 데이터와 검수 기록은 유지했습니다.','warning');return false;}const locStats=next.loc?.importSummary,locUnusable=!!locStats&&!next.loc.length;if(locUnusable){next={...next};delete next.loc;if(!Object.keys(next).length){notice('적용할 Loc 정보가 없습니다. 기존 Loc 정보는 유지했습니다. '+'식별자 없음'+': '+locStats.missingIdentifier+' / '+'Location 정보없음'+': '+locStats.missingLocation,'warning');return false;}}const updated={...state.data,...next},nextCustomerNames=Object.hasOwn(next,'raw')?MappingCore.checkedCustomerNames(next.raw.customerNames,updated.raw):MappingCore.checkedCustomerNames(state.customerNames,updated.raw);Engine.validateSession({...state,data:updated,customerNames:nextCustomerNames});for(const id of new Set([...updated.raw.map(r=>r.receipt),...state.scans.map(e=>e.receipt)]))reconcileView(updated,id,state.scans);if(next.raw&&Object.getOwnPropertyDescriptor(next.raw,'customerNames')?.configurable)delete next.raw.customerNames;state.data=updated;state.customerNames=nextCustomerNames;state.sources??={};for(const k of Object.keys(next))state.sources[k]=k==='raw'&&addingOrders&&state.sources[k]?[...new Set([state.sources[k],source])].join(' + '):source;audit('기준 데이터 갱신',[],state.receipt,Object.keys(next).join(', '));const latest=state.scans.filter(e=>e.receipt===state.receipt).at(-1);lastBarcode=latest?lastKey(latest):'';changed();draw();if(state.data.raw.length)$('dataPanel').open=false;notice('');setUI('dialogNotice',(state.receipt&&!rawRows(state.receipt).length>0?'선택한 ASN이 새 기준 데이터에 없습니다. 입력 기록은 유지했습니다. ':'')+'입력 기록 유지 · 결과 다시 계산 완료. '+Object.entries(next).map(([k,v])=>`${({raw:'반품 예정 자료',sku:'상품 자료',loc:'위치 자료'})[k]}: ${v.length}행`).join(' · ')+(next.raw?.length===0?' — 헤더만 있습니다. 실제 데이터를 붙여넣어 주세요.':' 적용했습니다.')+(next.raw?.filter(r=>!r.barcode&&!r.sku).length?' · 식별자 없는 행 '+next.raw.filter(r=>!r.barcode&&!r.sku).length+'개는 확인이 필요합니다.':'')+(locStats?' · '+'Loc 제외 행'+': '+(locStats.missingIdentifier+locStats.missingLocation)+' ('+'식별자 없음'+' '+locStats.missingIdentifier+', '+'Location 정보없음'+' '+locStats.missingLocation+') · '+'SKU 기준 Loc'+': '+locStats.skuOnly:'')+(locUnusable?' · 기존 Loc 정보는 유지했습니다.':'')+(next.raw?returnChannelImportNote():''),false,true);return true;}
function returnChannelImportNote(){
 const ix=uiIndex(),unclassified=ix.ids.length-ix.modeIds.b2b.length-ix.modeIds.b2c.length;
 if(!ix.core.hasReturnChannel)return language==='en'?' · No B2B/B2C category column is connected. Connect it for exact separation.':' · B2B/B2C 구분 열이 연결되지 않았습니다. 정확히 분리하려면 구분 열을 연결하세요.';
 return unclassified?(language==='en'?' · Orders hidden because the category is unknown or conflicting: ':' · 구분값 누락·미인식·충돌로 검색에서 제외된 오더: ')+unclassified.toLocaleString():'';
}
var dataImportBusy=false,dataDrafts={raw:'',sku:'',loc:''};
const dataDefinitions={raw:{title:'반품 예정 자료',button:'addRaw'},sku:{title:'상품 자료',button:'addSku'},loc:{title:'위치 자료',button:'addLoc'},phoneOrders:{title:'원주문 조회 자료',button:'addPhoneOrders'}};
function updateDataRows(){$('openWorkbook').disabled=dataImportBusy;for(const [kind,def]of Object.entries(dataDefinitions)){
 $(kind+'DataCount').textContent=(kind==='phoneOrders'?PhoneOrderUI.count('orders'):state.data[kind].length).toLocaleString()+' '+tr('행')+(state.sources?.[kind]?' · '+state.sources[kind]:'');
 $(def.button).disabled=dataImportBusy;
}}
function chooseData(kind){
 if(dataImportBusy||!dataDefinitions[kind])return false;
 const prev=$('kind').value;if(dataDefinitions[prev])dataDrafts[prev]=$('paste').value;
 $('kind').value=kind;$('paste').value=dataDrafts[kind]||'';
 $('dataEditorTitle').textContent=dataDefinitions[kind].title;
 $('dataFileNote').textContent=language==='en'?'XLSX / XLSM · Reuses the active profile.':'XLSX / XLSM · 현재 프로필의 연결을 재사용합니다.';
 $('dataEditor').classList.remove('hidden');
 for(const [k,def]of Object.entries(dataDefinitions))$(def.button).setAttribute('aria-expanded',String(k===kind));
 updateDataApply();$('paste').setAttribute('aria-invalid','false');$('open').focus();return true;
}
function closeDataEditor(){
 const kind=$('kind').value;if(dataDefinitions[kind])dataDrafts[kind]=$('paste').value;
 $('dataEditor').classList.add('hidden');
 for(const def of Object.values(dataDefinitions))$(def.button).setAttribute('aria-expanded','false');
 if($('dataDialog').open)$(dataDefinitions[kind]?.button||'addRaw').focus();
}
for(const [kind,def]of Object.entries(dataDefinitions))$(def.button).onclick=()=>chooseData(kind);
$('dataEditorClose').onclick=()=>{if(!dataImportBusy)closeDataEditor();};
function updateDataApply(){
 const ready=!!$('paste').value.trim();$('apply').disabled=dataImportBusy||!ready;
 $('apply').setAttribute('data-ready',String(ready&&!dataImportBusy));
 $('dataEditorFeedback').textContent=tr(ready?'붙여넣은 데이터를 확인하고 적용하세요.':'데이터를 붙여넣으면 적용할 수 있습니다.');
}
$('paste').oninput=()=>{dataDrafts[$('kind').value]=$('paste').value;$('paste').setAttribute('aria-invalid','false');updateDataApply();};
function finishDataImport(kind,clearDraft=true){
 if(clearDraft){dataDrafts[kind]='';$('paste').value='';}closeDataEditor();updateDataApply();
 const order=Object.keys(dataDefinitions),next=order[Math.min(order.indexOf(kind)+1,order.length-1)];
 if($('dataDialog').open)$(dataDefinitions[next].button).focus();
}
function dataImportError(message,pasted=false){
 notice(message,'error');$('dataEditorFeedback').textContent=tr(message);
 if(pasted)$('paste').setAttribute('aria-invalid','true');
}
function lastKey(ev){const rows=reconcileView(state.data,state.receipt,state.scans),matched=rows.filter(r=>!r.unregistered&&matchesReference(r,ev));return matched.length===1?matched[0].key:(ev.kind==='sku'?'M:':'X:')+Engine.eventCode(ev);}
function assignReceipt(id,automatic=false,keepStoreFocus=false){if(isB2C())return selectCustomerOrder(id);if(state.receiptLocked&&id!==state.receipt){notice('검수 대상 고정을 먼저 해제해 주세요.','warning');return false;}if(!workAllowsReceipt(id))return workContextWarning();let pending=(state.pending||[]).filter(e=>!e.holdForStore);const held=(state.pending||[]).filter(e=>e.holdForStore);const moving=[];if(moving.length){/* Explicit target selection re-evaluates this batch without changing its scanned content. */const prior=state.receipt;audit('ASN 연결 수정',moving,prior,'변경 ASN: '+id);state.scans=state.scans.filter(e=>!moving.includes(e));pending=[...pending,...moving.map(({receipt,...e})=>e)];}/* An explicit ASN choice accepts pending scans for reconciliation, including outside-ASN items. */state.currentBatch??=makeId();audit(automatic?'ASN 자동 연결':'ASN 수동 연결',pending,id);state.receipt=id;state.assignment=automatic?'자동 연결':'수동 연결';state.autoPaused=false;for(const scan of pending)state.scans.push({...scan,receipt:id,scanOutcome:entryOutcome(state.data,id,state.scans,scan),batch:scan.batch||state.currentBatch});lastBarcode=pending.at(-1)?lastKey(pending.at(-1)):'';state.pending=held;stageOutsideScans();changed();draw();if($('message').dataset.reason==='asn-selection')notice('');setUI('feedback','ASN '+id+' · '+state.assignment,false,true);if(!keepStoreFocus)focusBeamInput('barcode');return true;}
function autoAssign(keepStoreFocus=false){if(state.receiptLocked||state.receipt||state.autoPaused)return false;const ids=getCandidates();return ids.length===1?assignReceipt(ids[0],true,keepStoreFocus):false;}
function releaseBatch(){if(state.receiptLocked){notice('검수 대상 고정을 먼저 해제해 주세요.','warning');return;}const events=state.scans.filter(e=>e.receipt===state.receipt&&e.batch&&e.batch===state.currentBatch&&!e.allocationConfirmed);if(!state.receipt)return;if(!uiConfirm('현재 묶음 '+events.reduce((n,e)=>n+Engine.units(e),0)+'개를 보류로 돌리고 ASN을 수정할까요? 이전 묶음은 유지됩니다.'))return;const old=state.receipt;audit('ASN 연결 수정',events,old,'현재 묶음을 보류로 이동');state.scans=state.scans.filter(e=>!events.includes(e));state.pending??=[];state.pending.push(...events.map(({receipt,...e})=>e));state.receipt='';state.assignment='수정 중';state.autoPaused=true;lastBarcode='';changed();draw();$('receipt').focus();};
function commitReceipt(id){if(id&&!receiptIds.includes(id)){notice(tr('목록에서 ASN을 선택해 주세요.'),'warning');return;}if(id){if(!(isB2C()?selectCustomerOrder(id):assignReceipt(id)))draw();}else{releaseBatch();draw();}closeReceiptList();}
let receiptIndex=-1,receiptPageStart=0;
function receiptDisplay(id){const values=uiIndex().external.get(id)||[];return values.length===1?values[0]:'';}
function resolveReceiptDraft(value){const q=value.trim();if(!q)return '';const ix=uiIndex(),ids=receiptIds,allowed=new Set(ids),matches=[...(ix.orderExact.get(q)||[])].filter(id=>allowed.has(id));return matches.length===1?matches[0]:'';}
function receiptOptions(){
 const customerQuery=isB2C()?$('customerQuery').value.trim():'';
 if(customerQuery){
  const matches=trackingOrders(customerQuery);if(matches.length)return matches;
  const name=customerLookupKey(customerQuery),allow=workReceiptGate(),{orderSearch}=uiIndex();
  return modeReceiptIds().filter(id=>allow(id)&&orderSearch.get(id)?.nameKeys.some(value=>value.includes(name)));
 }
 const entered=$('receipt').value,q=entered===receiptDisplay(state.receipt)?'':entered.trim().toLowerCase(),nameQ=customerLookupKey(q),ix=uiIndex(),ids=receiptIds;
 if(orderSearchCache?.ix===ix&&orderSearchCache.ids===ids&&orderSearchCache.q===q)return orderSearchCache.result;
 const result=!q?ids:ids.filter(id=>{const entry=ix.orderSearch.get(id);return entry&&(entry.numberKeys.some(v=>v.includes(q))||isB2C()&&entry.nameKeys.some(v=>v.includes(nameQ)));});
 orderSearchCache={ix,ids,q,result};return result;
}
function orderCustomerLabel(id){if(!isB2C())return '';const names=uiIndex().orderSearch.get(id)?.names||[];if(!names.length)return '';const label=language==='en'?'Customer: ':'고객명: ',extra=names.length>3?(language==='en'?' · '+(names.length-3)+' more':' · 외 '+(names.length-3)+'개'):'';return label+names.slice(0,3).join(' / ')+extra+(names.length>1?(language==='en'?' · Multiple name values':' · 복수 표기 · 확인 필요'):'');}
function receiptIdentityLabel(id){const external=uiIndex().external.get(id)||[];return 'External order ID · '+(external.join(' / ')||'—')+' | Order ID · '+(id||'—');}
function receiptExpectedLabel(id){const expected=uiIndex().orderSearch.get(id)?.expected??0;return Number.isSafeInteger(expected)&&expected>=0?tr('예정')+' '+expected.toLocaleString()+' EA':tr('예정 수량 확인 필요');}
function positionReceiptList(){const r=(isB2C()&&($('customerQuery').value||document.activeElement===$('customerQuery'))?$('customerQuery'):$('receipt')).getBoundingClientRect(),width=Math.min(440,Math.max(220,innerWidth-24));Object.assign($('receiptList').style,{position:'fixed',left:Math.max(12,Math.min(r.left,innerWidth-width-12))+'px',top:(r.bottom+4)+'px',width:width+'px',maxHeight:Math.max(80,Math.min(220,innerHeight-r.bottom-16))+'px'});}
function renderReceiptList(){positionReceiptList();if(state.receiptLocked){closeReceiptList();return;}const opts=receiptOptions();if(receiptIndex>=0&&(receiptIndex<receiptPageStart||receiptIndex>=receiptPageStart+160))receiptPageStart=Math.floor(receiptIndex/160)*160;receiptPageStart=Math.min(receiptPageStart,Math.max(0,Math.floor((opts.length-1)/160)*160));const windowStart=receiptPageStart;$('receiptList').innerHTML=opts.slice(windowStart,windowStart+160).map((id,offset)=>({id,i:windowStart+offset})).map(({id,i})=>`<div role="option" id="asn-option-${i}" aria-selected="${i===receiptIndex}" data-index="${i}" data-receipt="${esc(id)}"><span class="asn-option-id">${esc(receiptIdentityLabel(id))}${orderCustomerLabel(id)?`<br><bdi dir="auto" class="small">${esc(orderCustomerLabel(id))}</bdi>`:''}</span><span class="asn-option-quantity">${esc(receiptExpectedLabel(id))}</span></div>`).join('')||'<div class="store-empty" role="status">'+esc(tr(storeReceiptCandidates().length?'검색과 일치하는 ASN이 없습니다.':'이 매장의 ASN이 없습니다.'))+'</div>';if(opts.length>160)$('receiptList').insertAdjacentHTML('beforeend','<div class="receipt-pages"><button type="button" tabindex="-1" data-receipt-page="-1" '+(windowStart===0?'disabled':'')+'>'+esc(tr('이전'))+'</button><span role="status">'+(windowStart+1)+'–'+Math.min(opts.length,windowStart+160)+' / '+opts.length+'</span><button type="button" tabindex="-1" data-receipt-page="1" '+(windowStart+160>=opts.length?'disabled':'')+'>'+esc(tr('다음'))+'</button></div>');$('receiptList').classList.toggle('hidden',false);$('receipt').setAttribute?.('aria-expanded','true');$('receiptToggle').setAttribute('aria-expanded','true');if(receiptIndex>=0)$('receipt').setAttribute?.('aria-activedescendant','asn-option-'+receiptIndex);else $('receipt').removeAttribute?.('aria-activedescendant');if(receiptIndex>=0)$('asn-option-'+receiptIndex)?.scrollIntoView?.({block:'nearest'});}
function closeReceiptList(){$('customerQuery').setAttribute('aria-expanded','false');$('customerQuery').removeAttribute('aria-activedescendant');$('receiptList').classList.toggle('hidden',true);$('receipt').setAttribute?.('aria-expanded','false');$('receiptToggle').setAttribute('aria-expanded','false');$('receipt').removeAttribute?.('aria-activedescendant');receiptIndex=-1;receiptPageStart=0;}
let receiptComposing=false;$('receipt').oncompositionstart=()=>{receiptComposing=true;};$('receipt').oncompositionend=()=>{receiptComposing=false;receiptIndex=-1;receiptPageStart=0;renderReceiptList();};$('receipt').onclick=()=>renderReceiptList();$('receipt').oninput=()=>{if(receiptComposing)return;$('customerQuery').value='';receiptIndex=-1;receiptPageStart=0;renderReceiptList();};$('receipt').onfocus=()=>{receiptIndex=-1;renderReceiptList();};
$('receipt').onkeydown=e=>{if(e.isComposing||receiptComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=receiptOptions().length;receiptIndex=n?(receiptIndex<0?(e.key==='ArrowDown'?0:n-1):(receiptIndex+(e.key==='ArrowDown'?1:-1)+n)%n):-1;renderReceiptList();}else if(e.key==='Enter'){e.preventDefault();const opts=receiptOptions();const draft=$('receipt').value.trim();const id=receiptIndex>=0?opts[receiptIndex]:draft===receiptDisplay(state.receipt)&&state.receipt?state.receipt:resolveReceiptDraft(draft)||(!draft&&opts.length===1?opts[0]:'');if(id)commitReceipt(id);else renderReceiptList();}else if(e.key==='Escape'){e.preventDefault();$('receipt').value=receiptDisplay(state.receipt);$('receipt').setAttribute('aria-invalid','false');closeReceiptList();}};
$('receiptList').onmousedown=e=>{if(e.target.closest?.('[data-receipt-page]')){e.preventDefault();return;}const option=e.target.closest?.('[data-index]');if(!option||$('receiptList').classList.contains('hidden'))return;e.preventDefault();const id=option.dataset.receipt||receiptOptions()[Number(option.dataset.index)];if(id)commitReceipt(id);};$('receiptList').onpointerdown=$('receiptList').onmousedown;
$('receipt').onblur=()=>{if(receiptComposing){receiptComposing=false;closeReceiptList();return;}closeReceiptList();const draft=$('receipt').value.trim();if(draft!==receiptDisplay(state.receipt)){const resolved=resolveReceiptDraft(draft);if(resolved)commitReceipt(resolved);else{ $('receipt').setAttribute('aria-invalid','true');notice('목록에서 ASN을 선택해 주세요.','warning');}}};
$('receiptList').onclick=e=>{const page=e.target.closest?.('[data-receipt-page]');if(page){e.preventDefault();if(!page.disabled){receiptPageStart=Math.max(0,receiptPageStart+Number(page.dataset.receiptPage)*160);receiptIndex=-1;renderReceiptList();$('receiptList').scrollTop=0;}return;}const option=e.target.closest?.('[data-index]');if(!option||$('receiptList').classList.contains('hidden'))return;const id=option.dataset.receipt||receiptOptions()[Number(option.dataset.index)];if(id)commitReceipt(id);};
let storeIndex=-1,storeComposing=false,storeOpen=false;
function storeOptions(){
 if(isB2C())return [];
 const value=$('store').value,ids=trackingOrders(value);
 if(ids.length)return ids.map(id=>{
  const row=rawRows(id)[0]||{};
  return {name:row.seller||row.company||'—',company:row.company||'',address:row.address||'',trackingReceipt:id};
 });
 return [...uiIndex().stores.values()].filter(item=>item.name&&Engine.storeMatches(item.row,value))
  .map(({name,company,address})=>({name,company,address,query:[...new Set([name,company,address].filter(Boolean))].join(' ')}))
  .sort((a,b)=>a.name.localeCompare(b.name)||a.company.localeCompare(b.company)||a.address.localeCompare(b.address)).slice(0,12);
}
function closeStoreList(){storeOpen=false;storeIndex=-1;$('storeList').classList.toggle('hidden',true);$('store').setAttribute?.('aria-expanded','false');$('store').removeAttribute?.('aria-activedescendant');}
function renderStoreList(){
 if(state.receiptLocked){closeStoreList();return;}
 const items=storeOptions(),track=items.some(item=>item.trackingReceipt),field=$('store'),list=$('storeList');
 storeOpen=true;list.classList.remove('hidden');field.setAttribute('aria-expanded','true');
 list.innerHTML=items.length?items.map((item,i)=>{
  const detail=track?receiptIdentityLabel(item.trackingReceipt):[...new Set([item.company===item.name?'':item.company,item.address].filter(Boolean))].join(' · ');
  return '<div class="store-option" id="store-option-'+i+'" role="option" aria-selected="'+(i===storeIndex)+'" data-store-index="'+i+'">'+esc(item.name)+'<small>'+esc(detail)+'</small></div>';
 }).join(''):'<div class="store-empty">'+esc(tr('일치하는 매장이 없습니다. 직접 입력할 수 있습니다.'))+'</div>';
 if(storeIndex<0){field.removeAttribute('aria-activedescendant');return;}
 const active='store-option-'+storeIndex;
 field.setAttribute('aria-activedescendant',active);
 if(!track)$(active).scrollIntoView?.({block:'nearest'});
}
function applyStoreQuery(preserveSelection=false,keepStoreFocus=false){
 if(workHasEntries()&&!preserveSelection){$('store').value=state.store||resolvedStoreName();return false;}
 if(state.receiptLocked){$('store').value=state.store||resolvedStoreName();notice('검수 대상 고정을 먼저 해제해 주세요.','warning');return false;}
 if(!preserveSelection)delete state.storeSelection;
 const previousQuery=state.store||'';state.store=$('store').value;
 let detached=false;
 if(state.receipt&&!state.data.raw.some(r=>r.receipt===state.receipt&&matchesStore(r))){
  const moving=[];
  audit('매장 검색 대상 변경',moving,state.receipt,'현재 묶음 보류 · 이전 묶음 유지');
  state.scans=state.scans.filter(e=>!moving.includes(e));
  state.pending=[...(state.pending||[]),...moving.map(({receipt,...event})=>event)];
  state.receipt='';state.assignment='';lastBarcode='';detached=true;
 }
 // Typing is search, not authority to reassign or silently confirm a target.
 if(previousQuery!==state.store||detached)state.autoPaused=true;
 let assigned=false;
 if(preserveSelection&&!state.receipt){
  // Choosing a store resumes scan-based narrowing; typing alone still pauses it.
  state.autoPaused=false;
  const ids=storeReceiptCandidates();
  if(ids.length===1){state.autoPaused=false;assigned=assignReceipt(ids[0],true,keepStoreFocus);}
 }
 changed();if(!assigned)draw();
 if(detached&&!assigned)notice('매장 변경 · 현재 묶음의 스캔을 유지했습니다. 새 ASN 선택 후 다시 대조합니다.','warning','asn-selection');
 else if(!state.receipt)notice(receiptIds.length?'매장 기준 ASN을 선택해 주세요. 입력 기록은 유지됩니다.':'매장 기준 ASN이 없습니다. 입력 기록은 유지됩니다.','warning','asn-selection');
 return assigned;
}
function chooseStore(index){
 if(workHasEntries())return workContextWarning();
 if(state.receiptLocked)return;
 const item=storeOptions()[index];if(!item)return;
 $('store').value=item.name;if(item.trackingReceipt)state.store=item.name;
 state.storeSelection={name:item.name,company:item.company,address:item.address};
 closeStoreList();$('receipt').setAttribute('aria-invalid','false');
 if(item.trackingReceipt)assignReceipt(item.trackingReceipt);
 else{
  applyStoreQuery(true);
  if(!state.receipt){$('receipt').value='';closeReceiptList();}
 }
 focusBeamInput('barcode');
}
$('searchB2B').onclick=()=>setSearchMode('b2b');$('searchB2C').onclick=()=>setSearchMode('b2c');
$('customerQuery').oninput=e=>{if(e.isComposing)return;$('receipt').value=$('customerQuery').value;receiptIndex=-1;renderReceiptList();$('customerQuery').setAttribute('aria-expanded','true');};
$('customerQuery').oncompositionend=()=>{$('receipt').value=$('customerQuery').value;receiptIndex=-1;renderReceiptList();$('customerQuery').setAttribute('aria-expanded','true');};
$('customerQuery').onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();const opts=receiptOptions(),exact=trackingOrders($('customerQuery').value);const id=receiptIndex>=0?opts[receiptIndex]:exact.length===1?exact[0]:'';if(id)commitReceipt(id);else{renderReceiptList();if(!opts.length&&looksLikeTracking($('customerQuery').value))trackingNotFound();}}else{$('receipt').onkeydown(e);}const active=$('receipt').getAttribute('aria-activedescendant');if(active)$('customerQuery').setAttribute('aria-activedescendant',active);else $('customerQuery').removeAttribute('aria-activedescendant');};
$('customerQuery').onblur=()=>{$('receipt').value=receiptDisplay(state.receipt);$('receipt').setAttribute('aria-invalid','false');closeReceiptList();};
// Numeric/scanner-like search drafts must not detach the active order.
function updateStoreQuery(composing=false){
 const value=$('store').value;
 storeIndex=-1;
 if(!composing&&!looksLikeTracking(value)&&!trackingOrders(value).length)applyStoreQuery(false,true);
 renderStoreList();
}
$('store').oninput=e=>updateStoreQuery(storeComposing||e?.isComposing);
$('store').onfocus=()=>{if(!storeComposing){storeIndex=-1;renderStoreList();}};
$('store').oncompositionstart=()=>{storeComposing=true;storeIndex=-1;renderStoreList();};
$('store').oncompositionend=()=>{storeComposing=false;updateStoreQuery();};
$('store').onkeydown=e=>{
 if(storeComposing||e.isComposing||e.keyCode===229)return;
 if(e.key==='Enter'){
  const items=storeOptions();
  if(items.some(item=>item.trackingReceipt)){
   e.preventDefault();
   if(storeIndex>=0)chooseStore(storeIndex);else if(items.length===1)chooseStore(0);else renderStoreList();
   return;
  }
  if(looksLikeTracking($('store').value)){e.preventDefault();trackingNotFound();renderStoreList();return;}
  if(storeOpen){e.preventDefault();if(storeIndex>=0)chooseStore(storeIndex);else closeStoreList();}
 }else if(e.key==='ArrowDown'||e.key==='ArrowUp'){
  e.preventDefault();const n=storeOptions().length,step=e.key==='ArrowDown'?1:-1;
  storeIndex=n?(storeIndex<0?(step===1?0:n-1):(storeIndex+step+n)%n):-1;
  renderStoreList();
 }else if(e.key==='Escape'){e.preventDefault();closeStoreList();}
};
$('storeList').onmousedown=e=>{const option=e.target.closest?.('[data-store-index]');if(!option)return;e.preventDefault();chooseStore(Number(option.dataset.storeIndex));};
$('storeList').onclick=e=>{const option=e.target.closest?.('[data-store-index]');if(!option||!storeOpen)return;chooseStore(Number(option.dataset.storeIndex));};
$('store').onblur=()=>{closeStoreList();syncStoreDisplay();};

function drawTargetLock(){
 const locked=!!state.receiptLocked&&!!state.receipt,button=$('newreceipt');
 button.hidden=!locked&&!(state.receipt&&state.assignment==='자동 연결'&&!state.store?.trim()&&!state.storeSelection);button.disabled=!state.receipt;button.setAttribute('aria-pressed',String(locked));
 button.textContent=tr(locked?'고정 해제':'검수 대상 고정');
 button.setAttribute('title',tr(locked?'고정을 해제해도 기존 ASN과 입력 기록은 유지됩니다.':'선택한 ASN을 고정합니다. 다른 상품도 이 ASN의 검수로 기록됩니다.'));
 $('receiptToggle').disabled=locked;$('receipt').disabled=locked;$('store').disabled=locked;
 if(locked){closeReceiptList();closeStoreList();}
}
$('newreceipt').onclick=()=>{
 if(!state.receiptLocked&&$('receipt').value.trim()!==receiptDisplay(state.receipt)){const draft=resolveReceiptDraft($('receipt').value.trim());if(!draft){notice('목록에서 ASN을 선택해 주세요.','warning');$('receipt').focus();return;}if(!assignReceipt(draft))return;}
 if(!state.receipt)return;
 state.receiptLocked=!state.receiptLocked;
 audit(state.receiptLocked?'검수 대상 고정':'검수 대상 고정 해제',[],state.receipt);
 changed();draw();
 setUI('feedback',state.receiptLocked?'다른 ASN 상품은 현재 검수에 포함되지 않은 것으로 표시됩니다.':'고정 해제 · ASN을 다시 선택할 수 있습니다. 기존 기록은 유지됩니다.',false,false);
 (state.receiptLocked?$('barcode'):$('receipt')).focus();
};
// Clearing unassigned entries is intentionally not exposed; use undo, allocation or New work.

$('barcode').onkeydown=e=>{if(e.key==='Enter'&&(e.repeat||e.isComposing))e.preventDefault();};
const scanAudio = createScanAudio(window, () => localStorage);
function canRegisterScan(){
 if(!state.receipt&&(isB2C()||!selectedWorkStoreKey())){
  notice(isB2C()?(language==='en'?'Select an order before scanning.':'오더를 선택한 뒤 스캔해 주세요.')
   :(language==='en'?'Select the store before scanning.':'매장을 선택한 뒤 스캔해 주세요.'),'warning');
  return false;
 }
 if(!modeReceiptIds().length||(state.receipt&&!modeAllowsReceipt(state.receipt)))return false;
 if(!state.receiptLocked&&$('receipt').getAttribute('aria-invalid')==='true'){
  notice('목록에서 ASN을 선택해 주세요.','warning');return false;
 }
 return true;
}
const returnsScan = createReturnsScanCommands({
 current:()=>state,
 identity:{id:makeId,now:()=>new Date().toISOString()},
 routing:{
  canRegister:canRegisterScan,storeKey:selectedWorkStoreKey,autoAssign,event:allocationEvent,
  stageOutside:stageOutsideScans,moveUnique:routeUniqueOrder,
 },
 effects:{
  notice,audit,changed,draw,audio:scanAudio.play,
  lastEvent:event=>{lastBarcode=lastKey(event);},
  pendingFeedback:()=>setUI('feedback',state.autoPaused?'ASN을 선택해 주세요 · 입력 기록 유지':
   getCandidates().length?'상품을 더 스캔해 주세요 · 입력 기록 유지':'상품과 매장을 확인해 주세요 · 입력 기록 유지',false,true),
  assignedFeedback:({value,quantity,moved,outcome})=>{
   const row=reconcileView(state.data,state.receipt,state.scans).find(item=>item.key===lastBarcode);
   const status=outcome==='held'?'ASN 배정 확인':row?.status||'확인 필요';
   setUI('feedback',value+' · '+quantity+'개 등록 · '+status+
    (moved?' · 검수 ASN 변경 '+(receiptDisplay(state.receipt)||state.receipt):''),false,true);
  },
 },
});
$('scanform').onsubmit=e=>{e.preventDefault();const barcode=$('barcode').value.trim();if(!barcode)return;if(returnsScan.register({barcode,kind:'code',qty:1,inputSource:'unified'})){$('barcode').value='';focusBeamInput('barcode');}};
$('undo').onclick=()=>undoSheetEvent();
$('reset').onclick=()=>{if(uiConfirm(`ASN ${state.receipt}의 스캔 기록만 초기화할까요? 저장된 작업파일은 바뀌지 않습니다.`)){returnsScan.reset();setUI('feedback','이 ASN의 스캔 기록을 초기화했습니다.',false,true);focusBeamInput('barcode');}};
$('filter').onchange=draw;$('results').ontoggle=draw;
function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
const date=()=>new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
// Count the exact UTF-8 bytes of JSON.stringify(value,null,2), stopping at the
// restore limit before allocating a whole oversized work-file string.
function checkedWorkJSONSize(value,limit=50e6){
 const encoder=new TextEncoder(),active=new Set();let bytes=0;
 const add=text=>{bytes+=encoder.encode(text).byteLength;if(bytes>limit){const error=Error(language==='en'?'This work file exceeds the 50 MB restore limit. Nothing was downloaded; current data is retained.':'작업파일이 복원 가능한 50MB를 넘습니다. 다운로드하지 않았으며 현재 데이터는 유지합니다.');error.code='WORK_SIZE_LIMIT';throw error;}};
 function walk(v,depth,inArray=false){
  if(v===null){add('null');return;}const type=typeof v;
  if(type==='string'||type==='number'||type==='boolean'){add(JSON.stringify(v));return;}
  if(type==='undefined'||type==='function'||type==='symbol'){if(inArray){add('null');return;}throw Error('Unsupported work-file value');}
  if(type!=='object'||active.has(v)||typeof v.toJSON==='function')throw Error('Unsupported work-file structure');
  active.add(v);const array=Array.isArray(v),keys=array?null:Object.keys(v).filter(k=>!['undefined','function','symbol'].includes(typeof v[k])),length=array?v.length:keys.length;
  add(array?'[':'{');
  for(let i=0;i<length;i++){add((i?',\n':'\n')+'  '.repeat(depth+1));if(!array)add(JSON.stringify(keys[i])+': ');walk(array?v[i]:v[keys[i]],depth+1,array);}
  if(length)add('\n'+'  '.repeat(depth));add(array?']':'}');active.delete(v);
 }
 walk(value,0);return bytes;
}

/* v1.10 work-only backup. Reference and customer commitments bind local content;
   they are not signatures, access controls, anonymization or proof of authorship. */
const WorkDelta=(()=>{
 const customerScheme='customer-sha256-chunks-v1',legacyScheme='legacy-confirmation-string-chunks-v1',chunkRows=256,hashPattern=/^[a-f0-9]{64}$/,restorePlans=new WeakMap();
 const fail=(ko,en)=>Error(language==='en'?en:ko);
 const workKeys=new Set(['version','savedAt','archivedPending','archivedScans','assignment','audit','autoPaused','availabilityEnabled','confirmations','currentBatch','orderTabs','pending','receipt','receiptLocked','scans','store','storeSelection','confirmationCommitments','searchMode','workNumber','workSheets']),excludedKeys=new Set(['data','customerNames','sources']);
 function checkedWorkKeys(work,fullState=false){if(!work||typeof work!=='object'||Array.isArray(work)||Object.keys(work).some(k=>!workKeys.has(k)&&!(fullState&&excludedKeys.has(k))))throw fail('지원하지 않는 추가 작업 정보가 있어 기록 전용 저장·복원을 중단합니다. 전체 작업파일 기능은 유지됩니다.','Unsupported additional work fields prevent work-only backup/restore. Full work-file functionality remains available.');}
 function validTimestamp(value){if(typeof value!=='string')return false;const m=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/);if(!m)return false;const y=+m[1],month=+m[2],day=+m[3],days=[31,(y%4===0&&(y%100!==0||y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];return month>=1&&month<=12&&day>=1&&day<=days[month-1]&&+m[4]<24&&+m[5]<60&&+m[6]<60&&(!m[7]||(+m[8]<24&&+m[9]<60))&&Number.isFinite(Date.parse(value));}
 function checkedConfirmations(value){if(value===undefined)return [];if(!Array.isArray(value)||value.some(c=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['receipt','batch','at','signature','outcome'].includes(k))||typeof c.receipt!=='string'||!c.receipt.trim()||typeof c.batch!=='string'||typeof c.signature!=='string'||(c.outcome!==undefined&&!['matched','difference'].includes(c.outcome))||!validTimestamp(c.at)))throw fail('확정 기록의 추가 정보 또는 형식을 확인할 수 없습니다. 기록 전용 저장을 중단합니다.','Unsupported confirmation fields or format prevent work-only backup.');return value;}


 function checkedEvents(value){
  const stringKeys=new Set(['scanOutcome','id','barcode','sku','kind','inputSource','at','batch','receipt','workStoreKey','holdForStore','holdOrigin']),allowed=new Set([...stringKeys,'qty','sequence','allocationConfirmed']);
  if(!Array.isArray(value))throw fail('입력 기록 목록 형식이 올바르지 않습니다.','Invalid entry list.');
  for(const event of value){if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).some(k=>!allowed.has(k))||Object.entries(event).some(([k,v])=>stringKeys.has(k)&&typeof v!=='string')||!validTimestamp(event.at)||(event.scanOutcome!==undefined&&!['accepted','excess','unknown','conflict','held'].includes(event.scanOutcome))||(event.qty!==undefined&&(!Number.isSafeInteger(event.qty)||event.qty<=0))||(event.sequence!==undefined&&(!Number.isSafeInteger(event.sequence)||event.sequence<0))||(event.allocationConfirmed!==undefined&&typeof event.allocationConfirmed!=='boolean')||(event.kind!==undefined&&!['barcode','code','sku'].includes(event.kind)))throw fail('입력 기록에 지원하지 않는 추가 정보 또는 형식이 있습니다.','Unsupported fields or values in an entry.');}
  return value;
 }
 function validateWorkSheets(work){
  if(work.workNumber!==undefined&&(!Number.isSafeInteger(work.workNumber)||work.workNumber<1))throw Error('작업 시트 번호가 올바르지 않습니다.');
  if(work.workSheets===undefined)return;
  if(!Array.isArray(work.workSheets)||work.workSheets.length>49||typeof work.currentBatch!=='string'||!work.currentBatch)throw Error('작업 시트 목록이 올바르지 않습니다.');
  const batches=new Set([work.currentBatch]),numbers=new Set([work.workNumber||1]);
  for(const w of work.workSheets){
   if(!w||Array.isArray(w)||typeof w!=='object'||Object.keys(w).some(k=>!workFields.includes(k))||typeof w.currentBatch!=='string'||!w.currentBatch||batches.has(w.currentBatch)||!Number.isSafeInteger(w.workNumber)||w.workNumber<1||numbers.has(w.workNumber)||!Array.isArray(w.scans)||!Array.isArray(w.pending)||!Array.isArray(w.audit)||w.scans.some(e=>!e?.receipt||e.batch!==w.currentBatch)||w.pending.some(e=>!e||e.receipt||e.batch!==w.currentBatch)||(w.receiptLocked&&!w.receipt))throw Error('분리된 작업 시트의 기록이나 식별자가 올바르지 않습니다.');
   batches.add(w.currentBatch);numbers.add(w.workNumber);checkedWorkShape(w,false,false);
  }
 }
 function checkedWorkShape(work,fullState=false,validateSheets=true){
  if(validateSheets)validateWorkSheets(work);
  checkedWorkKeys(work,fullState);if(work.searchMode!==undefined&&!['b2b','b2c'].includes(work.searchMode))throw fail('검색 방식 설정이 올바르지 않습니다.','Invalid search mode.');
  for(const key of ['scans','pending','archivedScans','archivedPending'])if(work[key]!==undefined)checkedEvents(work[key]);
  for(const key of ['savedAt'])if(work[key]!==undefined&&!validTimestamp(work[key]))throw fail('작업 시각 형식이 올바르지 않습니다.','Invalid work timestamp.');
  for(const key of ['assignment','currentBatch','receipt','store'])if(work[key]!==undefined&&typeof work[key]!=='string')throw fail('작업 문맥 형식이 올바르지 않습니다.','Invalid work context.');
  for(const key of ['autoPaused','availabilityEnabled','receiptLocked'])if(work[key]!==undefined&&typeof work[key]!=='boolean')throw fail('작업 설정 형식이 올바르지 않습니다.','Invalid work option.');
  if(work.orderTabs!==undefined&&(!Array.isArray(work.orderTabs)||work.orderTabs.some(x=>typeof x!=='string'||!x.trim())))throw fail('오더 탭 형식이 올바르지 않습니다.','Invalid order tabs.');
  if(work.storeSelection!==undefined){const st=work.storeSelection;if(!st||typeof st!=='object'||Array.isArray(st)||Object.keys(st).length!==3||!['name','company','address'].every(k=>Object.hasOwn(st,k)&&typeof st[k]==='string'))throw fail('매장 선택 정보의 추가 필드 또는 형식이 지원되지 않습니다.','Unsupported fields or format in store selection.');}
  if(work.audit!==undefined){if(!Array.isArray(work.audit))throw fail('이력 목록 형식이 올바르지 않습니다.','Invalid audit list.');for(const event of work.audit){if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).some(k=>!['id','at','timezone','offsetMinutes','action','receipt','events','note'].includes(k))||!validTimestamp(event.at)||!['id','action','receipt'].every(k=>typeof event[k]==='string')||['timezone','note'].some(k=>event[k]!==undefined&&typeof event[k]!=='string')||(event.offsetMinutes!==undefined&&(!Number.isSafeInteger(event.offsetMinutes)||Math.abs(event.offsetMinutes)>1440)))throw fail('이력에 지원하지 않는 추가 정보 또는 형식이 있습니다.','Unsupported fields or values in audit history.');checkedEvents(event.events);}}
  checkedCommitments(work.confirmationCommitments);for(const confirmation of checkedConfirmations(work.confirmations))if(confirmation.signature.startsWith('v2:sha256-chunks:'))safeV2(confirmation.signature);
 }
 async function digest(value){
  if(!globalThis.crypto?.subtle||typeof globalThis.crypto.subtle.digest!=='function'||typeof TextEncoder!=='function')throw fail('WebCrypto 확인 기능을 사용할 수 없습니다. 기록은 유지합니다.','WebCrypto verification is unavailable. Current work is retained.');
  const result=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  if(Object.prototype.toString.call(result)!=='[object ArrayBuffer]'||result.byteLength!==32)throw fail('SHA-256 확인 결과가 올바르지 않습니다.','Invalid SHA-256 verification result.');
  return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
 }
 function capture(){
  if(!state.data?.raw?.length)throw fail('원본 기준자료를 먼저 불러오세요.','Load the original reference data first.');
  const record=ReferenceFingerprint.request();return {data:state.data,names:state.customerNames,core:Engine.getIndex(state.data),record};
 }
 function assertCurrent(c){
  if(state.data!==c.data||state.customerNames!==c.names||Engine.getIndex(state.data)!==c.core||ReferenceFingerprint.request()!==c.record)throw fail('확인하는 동안 기준자료 또는 고객명 자료가 바뀌었습니다. 다시 시도하세요.','Reference or customer data changed during verification. Try again.');
 }
 async function customerRoot(c){
  assertCurrent(c);const names=MappingCore.checkedCustomerNames(c.names,c.data.raw),keys=Object.keys(names).sort(),chunks=[];
  for(let i=0;i<keys.length;i+=chunkRows){const entries=keys.slice(i,i+chunkRows).map(id=>[id,names[id]]);chunks.push(await digest(['customer-chunk-v1',i,entries]));assertCurrent(c);}
  const root=await digest([customerScheme,chunkRows,keys.length,chunks]);assertCurrent(c);return root;
 }
 let verifiedCache=null;
 async function verifiedReferences(c){
  const root=await awaitReferenceFingerprint();assertCurrent(c);
  if(c.record.status!=='ready'||c.record.root!==root)throw fail('기준자료 확인이 완료되지 않았습니다.','Reference verification is not ready.');
  if(verifiedCache?.record===c.record&&verifiedCache.names===c.names)return verifiedCache.value;
  const namesRoot=await customerRoot(c);assertCurrent(c);
  const value={scheme:ReferenceFingerprint.domain,root,customerScheme,customerRoot:namesRoot};
  verifiedCache={record:c.record,names:c.names,value};return value;
 }
 function safeV2(signature){
  if(typeof signature!=='string'||!signature.startsWith('v2:sha256-chunks:'))return false;
  try{if(signature.length>50e6)throw Error('too large');const v=JSON.parse(signature.slice('v2:sha256-chunks:'.length));if(!Array.isArray(v)||v.length!==5||typeof v[0]!=='string'||!hashPattern.test(v[0])||typeof v[1]!=='string'||typeof v[2]!=='string')throw Error('shape');checkedEvents(v[3]);checkedEvents(v[4]);return true;}catch{throw fail('v2 확정 증거에 지원하지 않는 추가 정보 또는 형식이 있어 기록 전용 저장·복원을 중단합니다.','Unsupported fields or format in v2 confirmation evidence prevent work-only backup/restore.');}
 }
 function checkedCommitments(value){
  if(value===undefined)return [];if(!Array.isArray(value))throw fail('확정 참고 해시 형식이 올바르지 않습니다.','Invalid confirmation commitment list.');
  return value.map(c=>{
   if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['receipt','batch','at','scheme','root','utf16Length'].includes(k))||typeof c.receipt!=='string'||!c.receipt||typeof c.batch!=='string'||!validTimestamp(c.at)||c.scheme!==legacyScheme||typeof c.root!=='string'||!hashPattern.test(c.root)||!Number.isSafeInteger(c.utf16Length)||c.utf16Length<0)throw fail('확정 참고 해시를 확인할 수 없습니다.','Invalid confirmation commitment.');
   return {receipt:c.receipt,batch:c.batch,at:c.at,scheme:c.scheme,root:c.root,utf16Length:c.utf16Length};
  });
 }
 async function legacyCommitment(signature,c){
  const chunks=[];for(let i=0;i<signature.length;i+=65536){chunks.push(await digest(['legacy-confirmation-chunk-v1',i,signature.slice(i,i+65536)]));assertCurrent(c);}
  const root=await digest([legacyScheme,signature.length,65536,chunks]);assertCurrent(c);return {scheme:legacyScheme,root,utf16Length:signature.length};
 }
 function cleanConfirmation(record){return {receipt:record.receipt,batch:record.batch,signature:record.signature,at:record.at,...(record.outcome?{outcome:record.outcome}:{})};}
 async function prepareSave({compact=false}={}){
  checkedWorkShape(state,true);if(!compact)Engine.validateSession(state,{preserveIndex:true});
  const c=capture(),reference=await verifiedReferences(c),cache=new Map(),safeCache=new Map();
  const isSafe=signature=>{if(!safeCache.has(signature))safeCache.set(signature,safeV2(signature));return safeCache.get(signature);};
  // Scans may continue while hashing. Snapshot only after the last await and
  // re-check the live confirmations, so late scans/confirmations are retained.
  for(;;){assertCurrent(c);checkedWorkKeys(state,true);const all=[state,...(state.workSheets||[])],current=all.flatMap(w=>checkedConfirmations(w.confirmations));let missing=null;
   for(const record of current)if(!isSafe(record.signature)&&!cache.has(record.signature)){missing=record.signature;break;}
   if(missing!==null){cache.set(missing,await legacyCommitment(missing,c));continue;}
   assertCurrent(c);checkedWorkShape(state,true);if(!compact)Engine.validateSession(state,{preserveIndex:true});const work=Object.fromEntries(Object.entries(state).filter(([key])=>workKeys.has(key)));work.savedAt=new Date().toISOString();
   function cleanSheet(dst,src){
    const commitments=checkedCommitments(src.confirmationCommitments),confirmed=[];
    for(const record of checkedConfirmations(src.confirmations)){if(isSafe(record.signature))confirmed.push(cleanConfirmation(record));else{const commitment=cache.get(record.signature);if(!commitment)throw fail('확정 기록이 바뀌었습니다. 다시 저장하세요.','Confirmation records changed. Save again.');commitments.push({receipt:record.receipt,batch:record.batch,at:record.at,...commitment});}}
    dst.confirmations=confirmed;
    const seen=new Set();dst.confirmationCommitments=commitments.filter(item=>{const key=JSON.stringify(item);if(seen.has(key))return false;seen.add(key);return true;});
    return dst;
   }
   cleanSheet(work,state);if(work.workSheets)work.workSheets=work.workSheets.map(w=>cleanSheet({...w},w));
   const delta={format:'logistics-work-delta',version:1,reference,work};checkedWorkJSONSize(delta);assertCurrent(c);const text=JSON.stringify(delta,null,compact?0:2);assertCurrent(c);return Object.freeze({text,assertCurrent:()=>assertCurrent(c)});
  }
 }
 function validateEnvelope(delta){
  const keys=(o,wanted)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===wanted.length&&wanted.every(k=>Object.hasOwn(o,k));
  if(!keys(delta,['format','version','reference','work'])||delta.format!=='logistics-work-delta'||delta.version!==1||!keys(delta.reference,['scheme','root','customerScheme','customerRoot'])||delta.reference.scheme!==ReferenceFingerprint.domain||delta.reference.customerScheme!==customerScheme||typeof delta.reference.root!=='string'||!hashPattern.test(delta.reference.root)||typeof delta.reference.customerRoot!=='string'||!hashPattern.test(delta.reference.customerRoot)||!delta.work||typeof delta.work!=='object'||Array.isArray(delta.work)||['data','customerNames','sources'].some(k=>Object.hasOwn(delta.work,k)))throw fail('검수 기록 전용 파일 형식이 올바르지 않습니다.','Invalid work-only backup format.');
  checkedWorkShape(delta.work);
  if([delta.work,...(delta.work.workSheets||[])].some(w=>w.confirmations!==undefined&&(!Array.isArray(w.confirmations)||w.confirmations.some(r=>!r||!safeV2(r.signature)))))throw fail('기록 전용 파일에 지원하지 않는 확정 원문이 있습니다.','Unsupported raw confirmation evidence in work-only backup.');
  checkedWorkJSONSize(delta);
 }
 async function prepareRestore(delta){
  validateEnvelope(delta);
  // Detach only bounded work data, never the large current reference arrays.
  // A caller mutating its parsed file during asynchronous checks cannot alter
  // what was reviewed. Opaque plans do not expose mutable work arrays.
  const workText=JSON.stringify(delta.work),expected={...delta.reference},c=capture(),reference=await verifiedReferences(c);assertCurrent(c);
  if(reference.root!==expected.root)throw fail('현재 기준자료가 저장 당시와 다릅니다. 원본 파일과 열 연결을 확인하세요.','Current reference data differs from this backup. Check the original file and column mapping.');
  if(reference.customerRoot!==expected.customerRoot)throw fail('고객명 조회 자료가 저장 당시와 다릅니다. 고객명 열 연결도 확인하세요.','Customer lookup data differs from this backup. Check its customer-name mapping too.');
  const candidate={...JSON.parse(workText),data:c.data,customerNames:c.names,sources:state.sources||{}};checkedWorkShape(candidate,true);Engine.validateSession(candidate,{preserveIndex:true});assertCurrent(c);
  const token=Object.freeze({});restorePlans.set(token,{candidate,capture:c});return token;
 }
 function finalizeRestore(token){
  // Called only after explicit user confirmation; one-shot opaque plans and
  // synchronous revalidation precede the caller's single state assignment.
  const prepared=restorePlans.get(token);if(!prepared)throw fail('복원 준비 정보가 올바르지 않거나 이미 사용되었습니다.','Restore preparation is invalid or already used.');
  restorePlans.delete(token);assertCurrent(prepared.capture);const candidate={...prepared.candidate,data:state.data,customerNames:state.customerNames,sources:state.sources||{}};checkedWorkShape(candidate,true);Engine.validateSession(candidate,{preserveIndex:true});return candidate;
 }
 return {prepareSave,prepareRestore,finalizeRestore,recoveryReference:()=>verifiedReferences(capture()),customerScheme,legacyScheme,validateWorkSheets};
})();

$('save').onclick=async()=>{
 try{
  const work={...state,savedAt:new Date().toISOString()};WorkDelta.validateWorkSheets(work);checkedWorkJSONSize(work);download('반품검수-작업-'+date()+'.json',JSON.stringify(work,null,2),'application/json');setUI('saved','다운로드 요청됨',false,false);notice('작업파일 다운로드를 확인하세요.');
 }catch(error){
  if(error?.code!=='WORK_SIZE_LIMIT'){notice(error.message,'error');return;}
  const prompt=language==='en'?'The complete backup exceeds 50 MB. Save inspection records only? Reference data, customer names and source labels will not be included. To restore, load the same original reference files and mappings first. Legacy confirmation text becomes unverified hash commitments. Scans at the end of saving are included.':'전체 작업파일이 50MB를 넘습니다. 검수 기록만 저장할까요? 기준자료·고객명·출처는 제외합니다. 복원하려면 동일한 원본 기준자료와 열 연결을 먼저 불러와야 합니다. 이전 확정 원문은 확정 권한 없는 참고 해시로 보관하며, 저장 완료 시점의 스캔까지 포함합니다.';
  if(!uiConfirm(prompt))return;
  try{const prepared=await WorkDelta.prepareSave();prepared.assertCurrent();download('반품검수-기록전용-원본필요-'+date()+'.json',prepared.text,'application/json');setUI('saved',language==='en'?'Records download requested':'기록 다운로드 요청됨',false,false);notice(language==='en'?'Verify the work-only backup download. Keep the matching original reference files separately.':'기록 전용 파일 다운로드를 확인하세요. 일치하는 원본 기준자료를 별도로 보관해야 합니다.');}catch(e){notice(e.message,'error');}
 }
};
$('restore').onclick=()=>$('backup').click();
$('backup').onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 const before=state;
 try{
  if(f.size>50e6)throw Error('작업파일은 50MB 이하만 열 수 있습니다.');const parsed=JSON.parse(await f.text());let next;
  if(parsed?.format==='logistics-work-delta'){
   const prepared=await WorkDelta.prepareRestore(parsed);
   if(!uiConfirm(language==='en'?'Reference data and customer lookup data match. Restore these inspection records and replace the current work? Current source data stays in place. Hash commitments do not grant inspection confirmation.':'기준자료와 고객명 조회 자료가 일치합니다. 현재 검수 기록을 이 파일로 바꿔 복원할까요? 현재 기준자료는 유지되며 참고 해시는 검수 확정 권한이 없습니다.'))return;
   next=WorkDelta.finalizeRestore(prepared);
  }else{
   next=Engine.validateSession(parsed);if(next.workSheets!==undefined)WorkDelta.validateWorkSheets(next);if(dirty&&!uiConfirm('현재 작업을 불러온 작업파일로 바꿀까요? 저장하지 않은 변경은 사라집니다.'))return;
  }
  PhoneOrderUI.clear();state=normalizedActiveWork({...next,pending:next.pending||[],store:next.store||'',sources:next.sources||{},audit:next.audit||[]});lastBarcode='';dirty=false;draw();if(state.data.raw.length)$('dataPanel').open=false;setUI('saved','작업파일 불러옴',false,false);notice('작업파일을 불러왔습니다.');
 }catch(err){notice(err.message,'error');}finally{e.target.value='';}
 if(state!==before){
  browserRecovery?.schedule();
  openRestoredWork();
 }
};


function showImportProgress(p){const text=(p.sheet||(language==='en'?'Strings':'문자열'))+' · '+Number(p.rowsProcessed||0).toLocaleString()+(language==='en'?' rows read':'행 읽는 중');$('dialogNotice').classList.remove('beam-notice-source');$('dialogNotice').textContent=text;}
function applyCombinedWorkbook(parsed,source){
 const next={},kept=[];for(const kind of ['raw','sku','loc']){if(parsed[kind]?.length)next[kind]=parsed[kind];else kept.push(dataDefinitions[kind].title+(parsed[kind]?' · 빈 시트':' · 시트 없음'));}
 if(!Object.keys(next).length){notice('실제 데이터 행이 없습니다. 기존 기준 데이터와 검수 기록은 유지했습니다. '+kept.join(' / ')+(parsed.workbookSummary?.ignored.length?' · 제외 시트 '+parsed.workbookSummary.ignored.length+'개':''),'warning');return false;}
 const ok=replaceData(next,source);if(ok===false)return false;
 notice('통합 파일 적용 · '+Object.entries(next).map(([k,v])=>dataDefinitions[k].title+' '+v.length.toLocaleString()+'행').join(' / ')+(kept.length?' · 기존 데이터 유지: '+kept.join(' / '):'')+(parsed.workbookSummary?.ignored.length?' · 제외 시트 '+parsed.workbookSummary.ignored.length+'개':'')+' · 검수 기록 유지');return true;
}
$('openWorkbook').onclick=()=>{if(!dataImportBusy&&!MappingUI.isBusy())$('workbookFile').click();};
$('open').onclick=()=>{if(!dataImportBusy&&!MappingUI.isBusy()&&dataDefinitions[$('kind').value])$('file').click();};
const printL=(ko,en)=>language==='en'?en:ko;
function printLocalTime(value){
 const d=new Date(value);if(!value||!Number.isFinite(+d))return '—';
 const pad=n=>String(n).padStart(2,'0'),m=-d.getTimezoneOffset(),offset=(m<0?'-':'+')+pad(Math.floor(Math.abs(m)/60))+':'+pad(Math.abs(m)%60);
 return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+' UTC'+offset;
}
function printGrid(title,labels,widths,rows,{numeric=[],total=null}={}){
 const cls=i=>numeric.includes(i)?' class="pr-number"':'';
 return '<section class="pr-section"><h2>'+esc(title)+'</h2><table><colgroup>'+widths.map(w=>'<col style="width:'+w+'%">').join('')+'</colgroup><thead><tr>'+labels.map((v,i)=>'<th scope="col"'+cls(i)+'>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+
 (rows.length?rows.map(row=>'<tr>'+row.map((v,i)=>'<td'+cls(i)+'>'+esc(v)+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+labels.length+'" class="pr-empty">'+'No records'+'</td></tr>')+
 '</tbody>'+(!total?'':'<tfoot><tr>'+total.map((v,i)=>'<td'+cls(i)+'>'+esc(v)+'</td>').join('')+'</tr></tfoot>')+'</table></section>';
}
function inspectionPrintContext(){
 const receipt=state.receipt,meta=rawRows(receipt);
 const field=k=>[...new Set(meta.map(r=>r[k]).filter(Boolean))].join(' / ');
 const party=isB2C()?MappingCore.checkedCustomerNames(state.customerNames,state.data.raw)[receipt]?.join(' / ')||field('seller'):field('seller');
 return {mode:'return',orderId:receipt,externalId:field('external'),party:party||field('company'),partyLabel:isB2C()?'Customer':'Store',work:'Work '+(state.workNumber||1)+' · '+(isB2C()?'B2C':'B2B')};
}
function inspectionReport(){
 const rows=sortProductRows(currentOrderComparison()).map(r=>({
  status:r.status,held:!!r.heldDisplay,
  barcode:r.barcode,sku:r.sku,name:r.name,brand:r.conflict?null:r.brand,expected:r.expected,actual:r.actual,
 }));
 return renderInspectionReport({...inspectionPrintContext(),rows});
}
function scanHistoryReport(){
 const header=renderInspectionHeader({...inspectionPrintContext(),history:true});
 const active=sheetEvents(true,'all'),audit=activeWorkAudit();
 const inferred=active.some(e=>!e.scanOutcome)?legacyScanOutcomes(active):null;
 const statuses={accepted:'Accepted',excess:'Excess',unknown:'Not on this order',conflict:'Product data conflict',held:'Held'};
 const inputs=active.map(e=>[printLocalTime(e.at),e.receipt||e.holdOrigin||'—',Engine.eventCode(e),Engine.units(e),statuses[e.scanOutcome??inferred?.get(e)]||'—',e.id||'—']).sort((a,b)=>a[0].localeCompare(b[0]));
 const log=audit.flatMap(a=>(a.events?.length?a.events:[null]).map(e=>[printLocalTime(a.at),a.action||'—',a.receipt||'—',e?Engine.eventCode(e):'—',e?Engine.units(e):'',e?printLocalTime(e.at):'—',[a.note,e?.id,a.id].filter(Boolean).join(' · ')||'—']));
 const tables=[
  printGrid('Retained Scans',['Input time','Order No.','Code','Qty','Status','Input ID'],[25,15,20,7,11,22],inputs,{numeric:[3]}),
  printGrid('Audit Log',['Event time','Action','Order No.','Code','Qty','Original input time','Reference / ID'],[18,15,11,13,6,18,19],log,{numeric:[4]})
 ];
 return {...header,markup:'<article class="pr-inspection">'+header.markup+tables.join('')+'</article>'};
}
const printSession = createPrintSession({
 browser:window,document,root:$('printReport'),
 nativeTarget:()=>{
  if(document.body.dataset.beamView!=='carton')return inspectionReport();
  const context=cartonWorkspace.printContext();
  if(context?.report)return renderInspectionReport(context.report);
  if(context?.dispatch)return renderOutboundDispatch(context.dispatch);
  return {paper:'portrait',markup:''};
 },
});
function openPrintDocument(kind){
 if(!state.receipt||printSession.busy())return;
 const target=kind==='history'?scanHistoryReport():inspectionReport();
 const order=String(state.receipt).replace(/[^\p{L}\p{N}_.-]/gu,'-');
 printSession.open(target,{
  title:'beam - '+target.title+' '+order+' - '+date().slice(0,10),
  beforePrint:()=>notice(printL('인쇄 창에서 PDF로 저장을 선택하세요.','Choose Save as PDF in the print dialog.')),
 });
}
function printProductLabelDocument(target){
 printSession.open({paper:'product-label',markup:target.markup},{
  title:'Beam · '+target.title,size:target,defer:false,onError:error=>notice(error.message,'error'),
 });
}
const productLabels=attachProductLabels({
 getContext:source=>source.id==='productLabelTrigger'?(state.receipt?{key:state.receipt,external:rawRows(state.receipt)[0]?.external||'',rows:reconcileView(state.data,state.receipt,state.scans)}:null):cartonWorkspace.labelContext(),
 getPapers:MappingUI.labelPapers,print:printProductLabelDocument,isEnglish:()=>language==='en',escape:esc
});
function openCartonPrint(target,orderId){
 printSession.open(target,{title:'Beam · '+target.title+' · '+orderId,onError:error=>notice(error.message,'error')});
}
const inspectionInput = createInspectionInput(document, window);
const cartonWorkspace=attachCartonWorkspace({clearScanner:inspectionInput.clearCartons,readWorkbook:readSpreadsheet,engine:Engine,isEnglish:()=>language==='en',openLabels:source=>productLabels.open(source),
 openReport:context=>openCartonPrint(renderInspectionReport(context),context.orderId),
 openDispatch:context=>openCartonPrint(renderOutboundDispatch(context),context.orderId),
 dispatchProfile:MappingUI.dispatchProfile,cartonProfile:MappingUI.cartonProfile,saveCartonMapping:MappingUI.saveCartonMapping,
 showHome:()=>beamShowHome(),notice,
 renderActivity:entries=>activityMarkup(entries,true),quantityLabel:lastScannedCountLabel,audio:scanAudio.play,
 locationFor:outboundLocation, syncLocation:syncAvailabilitySetting});
inspectionInput.bindCartons(cartonWorkspace.input);
const navigation = createNavigation(document, cartonWorkspace);
$('productLabelTrigger').onclick=e=>productLabels.open(e.currentTarget);

const exampleWorkbookName='Cry-Later-Demo.xlsx';
const exampleProfileName='Cry-Later-Profile.json';
const exampleWorkbookType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const exampleLocationRules=new WeakMap();
const loadExampleAssets=()=>import("./features/examples/cry-later-assets.js");
const exampleWorkbookBytes=base64=>Uint8Array.from(atob(base64),character=>character.charCodeAt(0));

function showExampleStatus(ko,en){
 const status=$('demoStatus');
 status.hidden=false;
 status.dataset.ko=ko;
 status.dataset.en=en;
 status.textContent=language==='en'?en:ko;
}

for(const [id,name,type,content] of [
 ['downloadDemoWorkbook',exampleWorkbookName,exampleWorkbookType,assets=>exampleWorkbookBytes(assets.workbookBase64)],
 ['downloadDemoProfile',exampleProfileName,'application/json',assets=>assets.profileText],
]){
 $(id).onclick=async()=>{
  try{download(name,content(await loadExampleAssets()),type);}
  catch{showExampleStatus('Cry Later 파일을 다운로드하지 못했습니다.','Could not download the Cry Later file.');}
 };
}

$('demo').onclick=async()=>{
 const button=$('demo'),dialog=$('helpDialog'),original=state;
 if(button.disabled||dataImportBusy||MappingUI.isBusy())return;
 if(dirty&&!uiConfirm(beamL('예제 데이터로 현재 작업을 바꿀까요? 실제 작업은 먼저 저장해 주세요.','Replace the current work with example data? Save any real work first.')))return;
 let cancelled=false,prepared;
 const cancel=()=>{cancelled=true;};
 dialog.addEventListener('close',cancel,{once:true});
 button.disabled=true;
 showExampleStatus('Cry Later 예제를 불러오는 중…','Loading the Cry Later example…');
 try{
  const {workbookBase64,profileText}=await loadExampleAssets();
  const {hooks,locationRules,cartonMappings}=MappingUI.exampleConnection(profileText);
  const workbook=new File([exampleWorkbookBytes(workbookBase64)],exampleWorkbookName,{type:exampleWorkbookType});
  const parsed=await readWorkbook(workbook,null,null,hooks);
  const {raw,sku,loc}=parsed;
  const phones=await prepareReferencePhones(parsed);
  const data={raw,sku,loc};
  const customerNames=MappingCore.checkedCustomerNames(raw.customerNames,raw);
  const sources={raw:workbook.name,sku:workbook.name,loc:workbook.name};
  const next=normalizedActiveWork(Engine.validateSession({version:1,data,scans:[],customerNames,sources}));
  delete raw.customerNames;
  delete raw.phoneRecords;
  const cartons=await prepareCartonReferences(workbook,cartonMappings,readSpreadsheet,{Engine,language});
  prepared={next,phones,locationRules,cartons};
 }catch{
  if(!cancelled&&dialog.open)showExampleStatus('Cry Later 예제를 불러오지 못했습니다. 현재 작업은 유지됩니다.','Could not load the Cry Later example. Your current work is unchanged.');
 }finally{
  dialog.removeEventListener('close',cancel);
  button.disabled=false;
  if(cancelled||!dialog.open)$('demoStatus').hidden=true;
 }
 if(!prepared||cancelled||!dialog.open||state!==original||dataImportBusy||MappingUI.isBusy())return;
 const {next,phones,locationRules,cartons}=prepared;
 cartonWorkspace.applyCombined(cartons);
 if(locationRules)exampleLocationRules.set(next.data.raw,locationRules);
 PhoneOrderUI.clear();
 state=next;
 lastBarcode='';
 PhoneOrderUI.commitPrepared(phones);
 changed();
 draw();
 $('dataPanel').open=false;
 notice('');
 beam.mode='b2b';
 beamNewSearch(true);
 showExampleStatus('Cry Later 예제를 불러왔습니다.','Cry Later example loaded.');
};

const updateMobileQuantities = attachMobileQuantities({
 element: $,
 hasReceipt: () => Boolean(state.receipt),
 getRows: () => questRows,
 closeOverlays: () => { closeOrderInfo(); endQuestPeek(); },
 virtualList: { set: setVirtualList, render: renderVirtualList, forget: id => virtualLists.delete(id) },
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});draw();

let theme='light';try{const pref=localStorage.getItem('returns-app-theme');theme=pref==='dark'||pref==='light'?pref:(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{}
function applyTheme(value){theme=value;document.documentElement?.setAttribute('data-theme',theme);$('theme').ariaPressed=String(theme==='dark');$('theme').setAttribute?.('aria-label',tr(theme==='dark'?'라이트 모드로 전환':'다크 모드로 전환'));$('theme').setAttribute?.('title',tr(theme==='dark'?'라이트 모드로 전환':'다크 모드로 전환'));try{localStorage.setItem('returns-app-theme',theme);}catch{}}
$('theme').onclick=()=>applyTheme(theme==='dark'?'light':'dark');applyTheme(theme);

function switchLanguage(nextLanguage){const asnDraft=$('receipt').value;closeStoreList();language=nextLanguage==='en'?'en':'ko';try{localStorage.setItem('returns-app-language',language);}catch{}localizeStatic();refreshUI();draw();if(asnDraft!==receiptDisplay(state.receipt)){$('receipt').value=asnDraft;renderReceiptList();}applyTheme(theme);updateLanguageToggle();labelReceiptToggle();MappingUI.refresh();browserRecovery?.refresh();cartonWorkspace.refresh();}$('language').onclick=()=>switchLanguage(language==='ko'?'en':'ko');$('language').onchange=()=>switchLanguage($('language').value);function updateLanguageToggle(){$('beamLanguageLabel').textContent=language==='ko'?'언어 · 한국어 / English':'Language · English / 한국어';const label=language==='ko'?'현재 한국어 · 영어로 변경':'Currently English · Switch to Korean';$('language').setAttribute('aria-label',label);$('language').setAttribute('title',label);$('language').value=language;}localizeStatic();draw();updateLanguageToggle();

function confirmInspection(skipPending=false,summaryOnly=false){
 if(!state.receipt)return {blocked:true,message:tr('ASN을 선택해 주세요.')};
 const raw=rawRows(state.receipt);
 if(!raw.length)return {blocked:true,message:tr('ASN 기준 데이터가 없어 확인할 수 없습니다.')};
 if(!skipPending&&(state.pending||[]).length)return {blocked:true,message:tr('미배정 입력을 먼저 확인해 주세요. 고객 안내문은 아직 만들지 않았습니다.')};
 const rows=reconcileView(state.data,state.receipt,state.scans);
 if(rows.some(r=>r.status==='정보 충돌'||r.unresolved))return {blocked:true,message:tr('상품 식별 정보를 먼저 확인해 주세요. 고객 안내문은 아직 만들지 않았습니다.')};
 if(!rows.some(r=>r.expected>0))return {blocked:true,message:tr('예정 수량이 없어 확인할 수 없습니다.')};
 if(summaryOnly)return {blocked:false,message:''};
 const prefix='';
 let unnamed=0;const unnamedCount=rows.filter(r=>!hasProductName(r)).length;
 function hasProductName(r){if(!r.name)return false;if(!['ASN 상품명 없음','상품 정보 없음'].includes(r.name))return true;return (r.unregistered?state.data.sku:raw).some(x=>x.name===r.name&&((r.barcode&&x.barcode===r.barcode)||(r.sku&&x.sku===r.sku)));}
 const label=r=>(hasProductName(r)?r.name:tr('상품명 확인 필요')+(unnamedCount>1?' ('+tr('별도 상품')+' '+(++unnamed)+')':''))+' ['+(r.barcode||r.sku||tr('식별자 없음'))+']';
 const diff=[];
 for(const r of rows){
  if(!r.unregistered&&r.actual===r.expected)continue;
  const item=label(r),delta=r.actual-r.expected,units=n=>'[ '+n+' EA ]';
  if(r.unregistered){
   diff.push(item+' '+units(r.actual)+' '+(language==='en'?'Unverified barcode':'미확인 바코드')+'\n'+(language==='en'?'Expected: ':'예정 수량: ')+tr('ASN 예정 없음')+' ▶ '+item+' '+units(r.actual)+' ('+(language==='en'?'Unverified barcode':'미확인 바코드')+' +'+r.actual+')');
   continue;
  }
  const kind=delta<0?'미입고':'과입고';
  diff.push(item+' '+units(Math.abs(delta))+' '+tr(kind)+'\n'+(language==='en'?'Expected: ':'예정 수량: ')+item+' '+units(r.expected)+' ▶ '+item+' '+units(r.actual)+' ('+tr('전산 수량보다')+' '+(delta>0?'+':'')+delta+')');
 }

 return {blocked:false,message:prefix+(diff.length?diff.join('\n\n'):tr('예정 수량과 검수 수량이 모두 일치합니다.'))};
}
function inspectionReportState(summaryOnly=false){
 const key=selectedWorkStoreKey(),batch=state.currentBatch;
 const pending=(state.pending||[]).filter(e=>state.receipt&&e.holdOrigin===state.receipt&&e.batch===batch&&key&&e.holdForStore===key);
 const assigned=state.scans.filter(e=>e.receipt===state.receipt),all=[...state.scans,...(state.pending||[])],seen=new Set();
 if(all.some(e=>{if(!e.id)return false;if(seen.has(e.id))return true;seen.add(e.id);return false;}))return {blocked:true,mode:'blocked',message:language==='en'?'Duplicate input IDs. Review the work file before copying a report.':'중복 입력 ID가 있습니다. 작업파일을 확인한 뒤 보고서를 복사해 주세요.'};
 const parts=[];
 if(state.receipt){
  const header=(language==='en'?'Selected order: ':'선택 오더: ')+(receiptDisplay(state.receipt)||'External order ID 확인 필요')+' · Order ID '+state.receipt;
  if(assigned.length){const result=confirmInspection(true,summaryOnly);if(result.blocked)return {...result,mode:'blocked'};parts.push(header+'\n'+result.message);}
  else if(pending.length)parts.push(header+'\n'+(language==='en'?'No inspected entries yet; expected quantities are not declared missing.':'아직 검수 입력 없음 · 예정 수량을 미입고로 확정하지 않음'));
 }
 if(pending.length&&summaryOnly)parts.push('pending');
 if(pending.length&&!summaryOnly){
  const storeRows=state.data.raw.filter(r=>asnStoreKey(r.receipt)===key),names=[...new Set(storeRows.map(r=>r.seller||r.company).filter(Boolean))],store=names.length===1?names[0]:(language==='en'?'Store needs verification':'매장명 확인 필요');
  const lines=pending.map(e=>{const known=storeRows.some(r=>matchesReference(r,e));return Engine.eventCode(e)+' [ '+Engine.units(e)+' EA ] · '+(known?(language==='en'?'Order unassigned':'오더 미배정'):(language==='en'?'Unverified barcode':'미확인 바코드'));});
  parts.push((language==='en'?'Store unassigned entries: ':'매장 미배정 입력: ')+store+'\n'+(language==='en'?'Separate from selected-ASN totals; not confirmed as misdelivery.':'선택 ASN 수량 합계와 별도 · 오입고로 확정하지 않음')+'\n'+lines.join('\n')+'\n'+(language==='en'?'Unassigned total: ':'미배정 합계: ')+pending.reduce((n,e)=>n+Engine.units(e),0)+' EA');
 }
 if(!parts.length)return {blocked:true,mode:'waiting',message:language==='en'?'Select a store/order and scan a product first.':'매장 또는 오더를 선택하고 상품을 먼저 스캔해 주세요.'};
 const rows=state.receipt?reconcileView(state.data,state.receipt,state.scans):[],different=rows.some(r=>r.unregistered||r.actual!==r.expected);
 if(pending.length||different)parts.push(language==='en'?'Scope: selected ASN, including unassigned entries first scanned against this ASN only.':'보고 범위: 현재 ASN과 이 ASN에서 발생한 미배정 입력만 포함합니다.');
 return {blocked:false,mode:pending.length||different?'report':'matched',message:summaryOnly?'':parts.join('\n\n')};
}

function referenceFingerprintState(){return ReferenceFingerprint.request();}
function awaitReferenceFingerprint(){return ReferenceFingerprint.wait();}
function confirmationContext(){
 const reference=referenceFingerprintState();if(reference.status!=='ready')return null;
 const key='v107.confirmation.context',cached=renderReadCache?.get(key);
 if(cached&&cached.state===state&&cached.reference===reference&&cached.scans===state.scans&&cached.pending===state.pending&&cached.rawBatch===state.currentBatch)return cached;
 const byReceipt=new Map();for(const scan of state.scans){if(!byReceipt.has(scan.receipt))byReceipt.set(scan.receipt,[]);byReceipt.get(scan.receipt).push(scan);}
 const context={state,scans:state.scans,pending:state.pending,rawBatch:state.currentBatch,batch:state.currentBatch||'',reference,byReceipt,currentPending:(state.pending||[]).filter(e=>e.batch===state.currentBatch),signatures:new Map()};
 if(renderReadCache)renderReadCache.set(key,context);return context;
}
function signatureInContext(receipt,context){
 if(!context)throw Error('Reference fingerprint is not ready');
 if(!context.signatures.has(receipt))context.signatures.set(receipt,'v2:sha256-chunks:'+JSON.stringify([context.reference.root,context.batch,receipt,context.byReceipt.get(receipt)||[],context.currentPending]));return context.signatures.get(receipt);
}
function confirmationSignature(receipt){return signatureInContext(receipt,confirmationContext());}
function matchingConfirmation(c,context){
 const signature=signatureInContext(c.receipt,context);
 if(c.signature!==signature&&!exactLegacyConfirmation(c.signature,c.receipt,context))return '';
 if(c.outcome){const rows=reconcileView(state.data,c.receipt,context.byReceipt.get(c.receipt)||[]);
  const different=rows.some(r=>r.unregistered||r.actual!==r.expected)||context.currentPending.some(e=>e.holdOrigin===c.receipt&&e.holdForStore===asnStoreKey(c.receipt));
  if((c.outcome==='difference')!==different)return '';
 }
 return signature;
}
function invalidateConfirmations(){
 if(!state.confirmations?.some(c=>c.batch===(state.currentBatch||'')))return;
 const context=confirmationContext();if(!context)return; // Preserve existing records while pending/error; never treat them as verified.
 state.confirmations=state.confirmations.flatMap(c=>{if(c.batch!==context.batch)return [c];const signature=matchingConfirmation(c,context);return signature?[c.signature===signature?c:{...c,signature}]:[];});
}
function inspectionCompletion(id=state.receipt){
 const records=(state.confirmations||[]).filter(c=>c.receipt===id&&c.batch===(state.currentBatch||''));
 if(!records.length)return null;
 const ctx=confirmationContext();if(!ctx)return null;
 return records.find(c=>!!matchingConfirmation(c,ctx))||null;
}
function isInspectionConfirmed(){return !!inspectionCompletion();}
function completionLabel(record){
 return record?.outcome==='difference'?(language==='en'?'Inspection complete · discrepancies recorded':'검수 완료 · 차이 기록 있음'):(language==='en'?'Inspection complete · quantities matched':'검수 완료 · 수량 일치');
}
function completionMark(id){
 const record=inspectionCompletion(id);if(!record)return '';
 const outcome=record.outcome==='difference'?'difference':'matched',label=esc(completionLabel(record));
 return '<span class="asn-tab-mark" data-outcome="'+outcome+'" role="img" aria-label="'+label+'" title="'+label+'">'+beamIcon('check')+'</span>';
}
function completionState(){
 const result=inspectionReportState(true);
 if(result.blocked)return result;
 const raw=rawRows(state.receipt),rows=reconcileView(state.data,state.receipt,state.scans);
 if(!raw.length||!rows.some(r=>r.expected>0)||rows.some(r=>r.status==='정보 충돌'||r.unresolved))return {blocked:true,mode:'blocked',message:language==='en'?'Verify this ASN and its product identifiers first.':'ASN 기준 정보와 상품 식별 정보를 먼저 확인해 주세요.'};
 return result;
}
function completeLocalInspection(outcome){
 if(!confirmationFingerprintGuard())return false;if(isInspectionConfirmed())return true;
 const result=completionState();
 if(result.blocked||(outcome==='difference'?result.mode!=='report':result.mode!=='matched'))return false;
 const record={receipt:state.receipt,batch:state.currentBatch||'',signature:confirmationSignature(state.receipt),at:new Date().toISOString(),outcome};
 state={...state,confirmations:[...(state.confirmations||[]).filter(c=>!(c.receipt===record.receipt&&c.batch===record.batch)),record]};
 audit(outcome==='difference'?'ASN 검수 완료 · 차이 기록':'ASN 정상 검수 확인',[],state.receipt);
 changed();draw();$('receipt').focus({preventScroll:true});return true;
}
function confirmMatchedInspection(){return completeLocalInspection('matched');}
function openDifferenceConfirm(){
 const content=$('confirmDifferenceDialog'),result=inspectionReportState();
 if(result.blocked||result.mode!=='report')return false;
 content.dataset.scope=JSON.stringify([state.currentBatch,state.receipt,confirmationSignature(state.receipt)]);
 $('confirmDifferenceTitle').textContent=language==='en'?'Do the received SKUs or quantities differ from the ASN?':'ASN과 실제 입고 SKU 또는 수량이 상이한 상황이 맞나요?';
 openUtilityDialog('confirmDifferenceDialog','confirmInspection','confirmDifferenceClose');return true;
}
$('confirmDifferenceAccept').onclick=()=>{
 const dialog=$('confirmDifferenceDialog');
 if(!confirmationFingerprintGuard())return;
 if(dialog.dataset.scope!==JSON.stringify([state.currentBatch,state.receipt,confirmationSignature(state.receipt)])){dialog.close();notice(language==='en'?'The inspection changed. Review it before confirming.':'검수 내용이 바뀌었어요. 다시 확인해 주세요.','warning');return;}
 dialog.close();completeLocalInspection('difference');
};
function fingerprintReadinessMessage(status){return language==='en'?(status==='error'?'Reference verification is unavailable. Confirmation remains disabled; inspection records are retained.':'Preparing reference verification. Inspection records are retained.'):(status==='error'?'기준 데이터 확인을 준비하지 못했습니다. 검수 기록은 유지하며 확정은 차단합니다.':'기준 데이터 확인을 준비하고 있습니다. 검수 기록은 유지합니다.');}
function confirmationFingerprintGuard(){const reference=referenceFingerprintState();if(reference.status==='ready')return true;notice(fingerprintReadinessMessage(reference.status),'warning');return false;}

function refreshReportDialog(){
 $('confirmationPanel').classList.remove('hidden');
 const result=inspectionReportState();
 $('confirmationText').value=result.message;
 $('confirmationText').setAttribute('aria-invalid',String(result.blocked));
 $('copyConfirmation').disabled=result.blocked;
 $('reportNotice').textContent=result.blocked?result.message:tr('내용을 확인한 뒤 복사해 주세요.');
 return result;
}
$('confirmInspection').onclick=()=>{
 const result=completionState();if(result.blocked){notice(result.message,'warning');return;}if(!confirmationFingerprintGuard())return;
 if(result.mode==='matched')confirmMatchedInspection();else openDifferenceConfirm();
};
$('orderMixReview').onclick=()=>{const first=allocationReviewEntries().find(e=>(e.receipt||e.holdOrigin)===state.receipt);if(first&&!state.receiptLocked)openAllocation(first.id,$('orderMixReview'));};
$('copyConfirmation').onclick=async()=>{const result=refreshReportDialog();if(result.blocked){$('copyConfirmation').disabled=true;return;}try{if(!globalThis.navigator?.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(result.message);notice('안내문을 복사했습니다.');}catch{$('confirmationText').focus();$('confirmationText').select?.();notice('안내문을 선택했습니다. Ctrl+C 또는 복사 메뉴를 사용하세요.');}};

let skipWorkbookDataDialogFocusRestore=false;
function openUtilityDialog(id,launcher,focusId){const d=$(id);d.returnFocus=launcher;if(typeof d.showModal==='function')d.showModal();else{notice('이 브라우저는 대화상자를 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.','error');return;}$(focusId).focus();}
for(const [id,launcher,close,focusId]of [['dataDialog','dataLauncher','dataClose','openWorkbook'],['helpDialog','helpLauncher','helpClose','helpClose'],['activityDialog','activityExpand','activityClose','activityClose'],['reportDialog',null,'reportClose','confirmationText'],['confirmDifferenceDialog',null,'confirmDifferenceClose','confirmDifferenceClose'],['allocationDialog',null,'allocationClose','allocationClose'],['newWorkDialog',null,'newWorkClose','newWorkClose']]){const d=$(id);if(launcher)$(launcher).onclick=()=>openUtilityDialog(id,launcher,focusId);$(close).onclick=()=>d.close();d.onclose=()=>{
 if(id==='dataDialog'&&skipWorkbookDataDialogFocusRestore){skipWorkbookDataDialogFocusRestore=false;return;}
 if(id==='dataDialog'&&dataImportBusy)return;
 const target=$(d.returnFocus||launcher);if(target&&!target.hidden&&!target.disabled)target.focus();else if(id==='confirmDifferenceDialog')$('receipt').focus();};d.oncancel=e=>{e.preventDefault();d.close();};d.onkeydown=e=>{if(e.key!=='Tab')return;const nodes=Array.from(d.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,a[href],[tabindex="0"]')).filter(n=>n.getClientRects().length);if(!nodes.length){e.preventDefault();return;}const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};}

function updateConfirmButton(){
 const result=completionState(),button=$('confirmInspection'),report=$('directReport'),mix=$('orderMixReview'),record=inspectionCompletion();
 $('currentAsnActions').hidden=!state.receipt;
 $('activeAsnMark').innerHTML=record?completionMark(state.receipt):'';
 const isReport=inspectionReportState(true).mode==='report',reference=referenceFingerprintState();
 report.hidden=!isReport;
 report.textContent=language==='en'?'Inspection report':'검수 보고';report.setAttribute('aria-label',language==='en'?'ASN Report for active order':'현재 ASN 보고문 복사');
 button.hidden=!!record;button.disabled=result.blocked||reference.status!=='ready';
 button.textContent=language==='en'?'Finish inspection':'검수 완료';button.setAttribute('data-mode',result.mode);
 const hint=result.blocked?result.message:reference.status!=='ready'?fingerprintReadinessMessage(reference.status):result.mode==='report'?(language==='en'?'Complete inspection with discrepancies retained':'차이 기록을 남기고 검수 완료'):(language==='en'?'Confirm matched inspection':'수량 일치 검수 완료');
 $('confirmHint').textContent=hint;button.title=hint;button.setAttribute('aria-label',hint);
 if(result.mode==='report'){button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','confirmDifferenceDialog');}else{button.removeAttribute('aria-haspopup');button.removeAttribute('aria-controls');}
 mix.hidden=!allocationReviewEntries().some(e=>(e.receipt||e.holdOrigin)===state.receipt);
 mix.disabled=!!state.receiptLocked;mix.textContent=language==='en'?'Assign':'배정 검토';
 if($('reportDialog').open)refreshReportDialog();
}

var allocationEventId='',allocationSnapshot='',allocationReturnFocus=null;
function asnStoreKey(id){return Engine.getIndex(state.data).receiptStoreKey.get(id)||'';}
function sameStoreAsns(key){const ids=key?(Engine.getIndex(state.data).storeReceipts.get(key)||[]):[];const allow=workReceiptGate(),b=isB2C();return ids.filter(id=>allow(id)&&(!b||id===state.receipt));}
$('newWork').onclick=()=>openUtilityDialog('newWorkDialog','newWork','newWorkClose');
$('saveBeforeNewWork').onclick=()=>$('save').onclick();
$('startNewWork').onclick=startNewWork;

function workAsnNavigation(){
 const key=selectedWorkStoreKey();if(!key)return [];
 const list=sameStoreAsns(key).map(id=>({id,matches:0,fit:0,evidence:[]}));
 const byId=new Map(list.map(item=>[item.id,item]));
 const exceptions=[...(state.pending||[]).filter(e=>e.batch===state.currentBatch&&e.holdForStore===key),...state.scans.filter(excessAllocationSource)];
 const groups=new Map();
 for(const event of exceptions){
  const signature=JSON.stringify([event.receipt,event.kind,Engine.eventCode(event),Engine.units(event)]);
  const previous=groups.get(signature);if(previous)previous.count++;else groups.set(signature,{event,count:1});
 }
 for(const {event,count} of groups.values()){
  for(const option of allocationOptions(event)){
   const entry=byId.get(option.id);if(!entry)continue;
   entry.matches+=count;
   if(option.fits){
    entry.fit+=count;
    const {row}=inspectEntry(state.data,option.id,state.scans,event);
    const evidence=(row?.name||Engine.eventCode(event))+' ['+Engine.eventCode(event)+'] · '+tr('잔여')+' '+option.remaining+' EA';
    if(entry.evidence.length<5&&!entry.evidence.includes(evidence))entry.evidence.push(evidence);
   }
  }
 }
 return list.sort((a,b)=>b.fit-a.fit||b.matches-a.matches||asnOrderCollator().compare(a.id,b.id));
}
function asnOrderCollator(){return (asnOrderCollator.value??=new Intl.Collator('en',{numeric:true}));}
function drawAsnNavigation(){const list=workAsnNavigation(),index=list.findIndex(o=>o.id===state.receipt),locked=!!state.receiptLocked;
 $('asnPrevious').disabled=locked||index<=0;$('asnNext').disabled=locked||!list.length||index>=list.length-1;
 $('asnPrevious').setAttribute('title',tr(locked?'고정 해제 후 ASN을 탐색할 수 있습니다.':!list.length?'선택 매장 ASN 없음':index<=0?'이전 ASN 없음':'이전 ASN'));$('asnNext').setAttribute('title',tr(locked?'고정 해제 후 ASN을 탐색할 수 있습니다.':!list.length?'선택 매장 ASN 없음':index>=list.length-1?'다음 ASN 없음':'다음 ASN'));
 $('asnPosition').textContent=(index<0?'—':String(index+1))+' / '+list.length+' ASN';
 const o=list[index],reason=$('asnNavigationReason');reason.textContent=o?.evidence.length?(language==='en'?'Assignable here: ':'현재 ASN 배정 가능: ')+o.evidence.join(' / '):'';reason.hidden=!reason.textContent;
}
function navigateWorkAsn(direction){
 if(state.receiptLocked||document.querySelector?.('dialog[open]'))return false;
 const list=workAsnNavigation(),index=list.findIndex(o=>o.id===state.receipt),next=index<0?(direction>0?0:-1):index+direction;if(next<0||next>=list.length)return false;
 // Viewing another ASN must never allocate or move pending/scanned entries.
 state.receipt=list[next].id;state.assignment='선택됨';state.autoPaused=true;lastBarcode='';changed();draw();return true;
}
$('asnPrevious').onclick=()=>{if(navigateWorkAsn(-1))$('overviewStatus').focus();};
$('asnNext').onclick=()=>{if(navigateWorkAsn(1))$('overviewStatus').focus();};
$('overviewStatus').onkeydown=e=>{if(e.target!==$('overviewStatus')||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();navigateWorkAsn(e.key==='ArrowRight'?1:-1);}};
function selectedWorkStoreKey(){
 if(state.receipt)return asnStoreKey(state.receipt);
 if(!state.store?.trim())return '';
 const keys=[...new Set(storeReceiptCandidates().map(asnStoreKey).filter(Boolean))];return keys.length===1?keys[0]:'';
}
function wmsUnverifiedEntries(){
 if(renderReadCache?.has('wms-entries'))return renderReadCache.get('wms-entries');
 const key=selectedWorkStoreKey(),batch=state.currentBatch,seen=new Set(),items=[],assignedIds=new Set(state.scans.map(e=>e.id).filter(Boolean));
 const add=(e,held=false)=>{const token=e.id||e;if(seen.has(token))return;seen.add(token);const master=Engine.masterInfo(state.data,e);items.push({event:e,qty:Engine.units(e),name:master.name||e.name||'상품 정보 없음',brand:master.brand,sku:master.sku||e.sku||'',barcode:Engine.eventCode(e),receipt:e.receipt||'',held});};
 // Union, never addition of two overlapping counters. Selected ASN includes saved history.
 if(state.receipt){
  const outside=new Set(reconcileView(state.data,state.receipt,state.scans).filter(row=>row.unregistered&&!row.matchedInAsn).map(row=>row.key));
  if(outside.size)for(const event of readScanIndex(state.scans).byReceipt.get(state.receipt)||[]){
   if(outside.has((event.kind==='sku'?'M:':'X:')+Engine.eventCode(event)))add(event);
  }
 }
 // Other assigned orders belong to their own sheets, not this counter.
 for(const e of state.pending||[]){if(!eventInCurrentMode(e)||state.receipt&&e.holdOrigin!==state.receipt)continue;const unassignedUnknown=!e.holdForStore&&(!e.workStoreKey||e.workStoreKey===key)&&![...candidateReceipts(state.data,e)].some(id=>modeAllowsReceipt(id)&&asnStoreKey(id)===key);if(batch&&e.batch===batch&&key&&(e.holdForStore===key||unassignedUnknown)&&(!e.id||!assignedIds.has(e.id)))add(e,true);}
 const result=items.filter(x=>!hasOtherAsnCandidate(x.event));renderReadCache?.set('wms-entries',result);return result;
}
function currentOrderComparison(rows=reconcileView(state.data,state.receipt,state.scans)){
 if(!state.receipt)return rows;
 // Older sessions can contain a no-candidate scan held against this ASN.
 // Show it in this order only, without turning pending input into an assigned scan.
 const pending=new Map(),key=selectedWorkStoreKey();
 if(!key)return rows;
 for(const {event:e,qty,name,brand,sku,barcode,held} of wmsUnverifiedEntries()){
  if(!held||e.holdOrigin!==state.receipt)continue;
  const id=(e.kind==='sku'?'M:':'X:')+Engine.eventCode(e),prior=pending.get(id);
  if(prior)prior.actual+=qty;
  else pending.set(id,{key:id,barcode:e.kind==='sku'?'':barcode,sku,name,brand,expected:0,actual:qty,missing:0,excess:0,unregistered:true,heldDisplay:true,status:'예정 외'});
 }
 if(!pending.size)return rows;
 const present=new Set();
 return [...rows.map(r=>{const held=pending.get(r.key);if(!r.unregistered||!held)return r;present.add(r.key);return {...r,actual:r.actual+held.actual,heldDisplay:true};}),...[...pending.values()].filter(x=>!present.has(x.key))];
}

function routeUniqueOrder(id){
 if(state.receiptLocked)return false;
 const all=[...state.scans,...(state.pending||[])];if(all.filter(e=>e.id===id).length!==1)return false;
 const e=allocationEvent(id);if(!e||e.batch!==state.currentBatch)return false;
 const fits=allocationOptions(e).filter(o=>o.fits);if(fits.length!==1)return false;
 const target=fits[0].id,origin=e.receipt||e.holdOrigin||state.receipt;
 const {holdForStore,holdOrigin,...original}=e,routed={...original,receipt:target,scanOutcome:entryOutcome(state.data,target,state.scans,e),allocationConfirmed:true};
 const tabs=Array.isArray(state.orderTabs)?state.orderTabs:[];
 const next={...state,receipt:target,assignment:'자동 연결',autoPaused:true,orderTabs:[...new Set([...tabs,origin,target].filter(Boolean))],scans:[...state.scans.filter(x=>x.id!==id),routed],pending:(state.pending||[]).filter(x=>x.id!==id)};
 next.audit=[...(state.audit||[]),{id:makeId(),at:new Date().toISOString(),action:'혼입 유일 후보 자동 배정',events:[{...e}],receipt:target,note:origin+' → '+target}];
 // The target came from the current validated reference and this move conserves quantities.
 state=next;lastBarcode=lastKey(routed);return true;
}
function eventInCurrentMode(e){const origin=e.receipt||e.holdOrigin;return origin?modeAllowsReceipt(origin):!isB2C();}
function drawOrderWorkspace(){
 const key=selectedWorkStoreKey(),known=Engine.getIndex(state.data).rawByReceipt;
 const saved=Array.isArray(state.orderTabs)?state.orderTabs.filter(id=>typeof id==='string'&&known.has(id)):[];
 const touched=state.scans.filter(e=>e.batch===state.currentBatch).map(e=>e.receipt);
 const origins=(state.pending||[]).filter(e=>e.batch===state.currentBatch).map(e=>e.holdOrigin).filter(Boolean);
 state.orderTabs=[...new Set([...saved,...[state.receipt].filter(id=>known.has(id)),...touched,...origins])];
 const allowInWork=workReceiptGate();const ids=state.orderTabs.filter(id=>allowInWork(id)&&(isB2C()||key&&asnStoreKey(id)===key));
 $('orderWorkspaceHint').textContent='';
 const heading=$('beamWorkName'),partyRow=known.get(state.receipt)?.[0],partyEntry=state.receipt?uiIndex().orderSearch.get(state.receipt):null;
 const party=isB2C()?partyEntry?.names?.join(' / ')||partyRow?.seller:partyRow?.seller||partyRow?.company||state.store;
 heading.textContent=party||'';heading.hidden=!state.receipt||!party;
 const active=$('activeOrderSheet');active.dataset.orderPeek=state.receipt;
 const info=$('activeOrderInfo');info.dataset.orderInfo=state.receipt;info.disabled=!state.receipt;
 info.setAttribute('aria-label',(receiptDisplay(state.receipt)||state.receipt||'')+' · '+(language==='en'?'Order inspection info':'오더 검수 정보'));
 active.classList.toggle('is-order-active',!!state.receipt);
 active.setAttribute('aria-label',(language==='en'?'Selected order: ':'선택 오더: ')+(receiptDisplay(state.receipt)||state.receipt||'External order ID'));
 const rail=$('orderTabs');
 const tabs=ids.map(id=>{
  const label=esc(receiptDisplay(id)||id),selected=id===state.receipt;
  return '<button type="button" class="order-tab-link inspection-sheet-tab" data-order-tab="'+esc(id)+'" title="'+label+'" aria-controls="orderInspectionPanel"'+
   (selected?' aria-current="true"':state.receiptLocked?' disabled':'')+'><span class="order-key">'+label+'</span>'+completionMark(id)+'</button>';
 }).join('');
 if(rail.beamMarkup!==tabs){
  rail.beamMarkup=tabs;rail.innerHTML=tabs;
  const selected=rail.querySelector?.('[aria-current=true]');
  if(selected&&rail.clientWidth&&rail.scrollWidth>rail.clientWidth){
   const r=rail.getBoundingClientRect(),tab=selected.getBoundingClientRect();
   if(tab.left<r.left)rail.scrollLeft+=tab.left-r.left-6;
   else if(tab.right>r.right)rail.scrollLeft+=tab.right-r.right+6;
  }
 }
 $('orderInspectionPanel').removeAttribute('aria-labelledby');$('orderInspectionPanel').setAttribute('aria-label',(language==='en'?'Selected order inspection: ':'선택 오더 검수: ')+(receiptDisplay(state.receipt)||state.receipt||'—'));
}
function switchOrderTab(id){
 if(state.receiptLocked&&id!==state.receipt)return false;
 if(!workAllowsReceipt(id)||(!isB2C()&&asnStoreKey(id)!==selectedWorkStoreKey()))return false;
 // Viewing a sheet is never authority to allocate held input or copy scan events.
 state.receipt=id;state.assignment='선택됨';state.autoPaused=true;lastBarcode='';changed();draw();focusBeamInput('barcode');return true;
}
function hasOtherAsnCandidate(e){return allocationOptions(e).some(o=>o.fits&&o.id!==(e.receipt||e.holdOrigin||state.receipt));}
function otherAsnEntries(){
 if(renderReadCache?.has('other-entries'))return renderReadCache.get('other-entries');
 const key=selectedWorkStoreKey(),batch=state.currentBatch,seen=new Set(),assignedIds=new Set(state.scans.map(e=>e.id)),entries=[];
 for(const e of [...state.scans,...(state.pending||[])]){
  if(!e.id||seen.has(e.id)||e.batch!==batch)continue;
  const eligible=e.receipt?e.receipt===state.receipt:e.holdForStore===key&&!assignedIds.has(e.id);
  if(eligible&&hasOtherAsnCandidate(e)){seen.add(e.id);entries.push(e);}
 }renderReadCache?.set('other-entries',entries);return entries;
}
function drawWorkUnverified(){
 const entries=wmsUnverifiedEntries(),value=entries.reduce((n,x)=>n+x.qty,0),candidates=otherAsnEntries(),candidateQty=candidates.reduce((n,e)=>n+Engine.units(e),0);
 $('unregistered').textContent=value.toLocaleString();$('unverifiedScope').textContent='';
 const info=(language==='en'?'Unverified barcode':'미확인 바코드')+' '+value+' EA · '+(language==='en'?'No assignable order found; entries counted once.':'배정 가능한 오더를 찾지 못한 입력 · 같은 입력은 한 번만 집계');
 $('outsideDetails').setAttribute('title',info);$('outsideDetails').setAttribute('aria-label',info);
 const button=$('otherAsnDetails');button.hidden=!candidateQty;$('otherAsnCount').textContent=candidateQty.toLocaleString();button.querySelector('span').firstChild.nodeValue=language==='en'?'Possible other ASN':'다른 ASN 혼입 후보';button.disabled=state.receiptLocked===true;button.setAttribute('aria-label',(language==='en'?'Review possible other ASN entries':'다른 ASN 추정 입력 확인')+' · '+candidateQty+' EA');
}
function openOtherAsnEntries(){
 const entries=otherAsnEntries();if(!entries.length||state.receiptLocked)return;
 if(entries.length===1){openAllocation(entries[0].id,$('otherAsnDetails'));return;}
 let dialog=$('otherAsnDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='otherAsnDialog';dialog.className='phone-mapping-dialog';dialog.setAttribute('aria-labelledby','otherAsnTitle');document.body.append(dialog);dialog.addEventListener('close',()=>{$('otherAsnDetails').focus();});}
 dialog.replaceChildren();const title=document.createElement('h2');title.id='otherAsnTitle';title.textContent=language==='en'?'Possible other ASN':'다른 ASN 혼입 후보';const list=document.createElement('div');list.className='phone-actions';
 for(const e of entries){const button=document.createElement('button');button.type='button';button.textContent=Engine.eventCode(e)+' · '+Engine.units(e)+' EA';button.onclick=()=>{dialog.close();openAllocation(e.id,$('otherAsnDetails'));};list.append(button);}
 const close=document.createElement('button');close.type='button';close.textContent=language==='en'?'Close':'닫기';close.onclick=()=>dialog.close();dialog.append(title,list,close);dialog.showModal();
}
$('otherAsnDetails').onclick=openOtherAsnEntries;

function stageOutsideScans(newEntry=null){
 const key=asnStoreKey(state.receipt);if(!state.currentBatch||state.receiptLocked||(Engine.getIndex(state.data).storeReceipts.get(key)?.length||0)<2)return;
 const rows=reconcileView(state.data,state.receipt,state.scans);
 const outsideKeys=new Set(rows.filter(r=>r.unregistered&&!r.matchedInAsn).map(r=>r.key));
 const outside=(newEntry?[newEntry]:(readScanIndex(state.scans).byReceipt.get(state.receipt)||[])).filter(e=>{
  if(e.receipt!==state.receipt||e.batch!==state.currentBatch||e.allocationConfirmed||!outsideKeys.has((e.kind==='sku'?'M:':'X:')+Engine.eventCode(e)))return false;
  const {receipt,...entry}=e;
  return hasOtherAsnCandidate({...entry,holdForStore:key,holdOrigin:receipt});
 });
 if(!outside.length)return;
 state.scans=state.scans.filter(e=>!outside.includes(e));state.pending=[...(state.pending||[]),...outside.map(({receipt,...e})=>({...e,holdForStore:key,holdOrigin:receipt}))];audit('ASN 밖 입력 보류',outside,state.receipt);
}
// Only whole latest input events entirely within a verified excess may be reassigned.
function excessAllocationSource(event){
 if(!event?.id||!event.receipt||event.batch!==state.currentBatch||asnStoreKey(event.receipt)!==selectedWorkStoreKey())return false;
 const cacheKey='allocation-excess';
 let eligible=renderReadCache?.get(cacheKey);
 if(!eligible){
  const key=selectedWorkStoreKey();
  eligible=excessEntrySet(state.data,state.scans,state.currentBatch,id=>asnStoreKey(id)===key);
  renderReadCache?.set(cacheKey,eligible);
 }
 return eligible.has(event.id);
}
function allocationEvent(id){return [...(state.pending||[]),...state.scans].find(e=>e.id===id);}
function allocationOptions(event){
 const origin=event?.receipt||event?.holdOrigin;
 if(!event?.id||event.batch!==state.currentBatch||(origin?!modeAllowsReceipt(origin):isB2C()))return [];
 const excess=event.receipt&&excessAllocationSource(event),store=excess?asnStoreKey(event.receipt):event.holdForStore;
 if(!store||store!==selectedWorkStoreKey()||(!excess&&event.receipt))return [];
 const optionsKey='allocation-options';
 let cache=renderReadCache?.get(optionsKey);
 if(!cache&&renderReadCache){cache=new Map();renderReadCache.set(optionsKey,cache);}
 const signature=JSON.stringify([event.receipt,event.kind,Engine.eventCode(event),Engine.units(event)]);
 if(cache?.has(signature))return cache.get(signature);
 const options=[];
 if(!Engine.masterInfo(state.data,event).conflict){
  const allow=workReceiptGate();
  for(const id of candidateReceipts(state.data,event)){
   if(id===event.receipt||asnStoreKey(id)!==store||!allow(id)||(isB2C()&&id!==state.receipt))continue;
   const {row,actual}=inspectEntry(state.data,id,state.scans,event);
   if(!row||row.unresolved||row.conflict)continue;
   const remaining=Math.max(0,row.expected-actual);
   options.push({id,expected:row.expected,remaining,fits:remaining>=Engine.units(event)});
  }
 }
 options.sort((a,b)=>Number(b.fits)-Number(a.fits)||a.remaining-b.remaining||a.id.localeCompare(b.id));
 cache?.set(signature,options);
 return options;
}
function allocationReviewEntries(){if(renderReadCache?.has('allocation-entries'))return renderReadCache.get('allocation-entries');const result=[...(state.pending||[]),...state.scans].filter(e=>allocationOptions(e).some(o=>o.fits)).sort((a,b)=>(a.sequence||0)-(b.sequence||0)||Date.parse(a.at)-Date.parse(b.at));renderReadCache?.set('allocation-entries',result);return result;}
// Allocation dialogs are transient: bind to the immutable reference revision, not a persisted digest.
function allocationFingerprint(){return JSON.stringify([referenceFingerprintState().revision,state.scans,state.pending,state.receipt,state.currentBatch,state.receiptLocked]);}
function drawAllocationHint(){const held=allocationReviewEntries();$('allocationNotice').classList.toggle('hidden',!held.length);$('allocationHint').textContent=held.length?tr(held.some(e=>allocationOptions(e).length)?'다른 ASN에 포함된 제품이 혼입되었을 가능성이 있습니다':'보류 입력의 상품 및 ASN 정보를 확인하세요.'):'';}
function openAllocation(id,origin=null){const e=allocationEvent(id),options=allocationOptions(e);if(!options.some(o=>o.fits)||state.receiptLocked)return;
 $('allocationTitle').textContent=language==='en'?'Assign entry to ASN':'입력 ASN 배정';$('allocationReport').textContent=language==='en'?'Inspection Report':'검수 Report';$('allocationReport').hidden=inspectionReportState().mode!=='report';
 allocationEventId=id;allocationReturnFocus=origin;allocationSnapshot=allocationFingerprint();$('allocationProduct').textContent=Engine.eventCode(e)+' · '+Engine.units(e)+' EA'+(e.receipt?' · '+e.receipt+' · '+(language==='en'?'Reassign excess entry':'초과 입력 재배정'):'');
 $('allocationCandidates').innerHTML=options.map(o=>'<button type="button" data-allocate-asn="'+esc(o.id)+'"'+(!o.fits?' disabled':'')+'>'+esc(o.id)+'<small>'+esc(tr('상품 예정')+' '+o.expected+' EA · '+tr('잔여')+' '+o.remaining+' EA'+(options.filter(x=>x.fits===o.fits&&x.remaining===o.remaining).length>1?' · '+tr('동률 후보 · 직접 선택'):''))+'</small></button>').join('');
 $('allocationError').textContent=tr('잔여 수량이 맞는 후보부터 표시합니다. 순위는 제안이며 직접 선택해야 합니다. 한 입력은 나누지 않습니다.');openUtilityDialog('allocationDialog','activityExpand','allocationClose');
}
function assignHeldEvent(id,target){try{
 if(state.receiptLocked)throw Error(tr('검수 대상 고정을 먼저 해제해 주세요.'));
 if(allocationSnapshot!==allocationFingerprint())throw Error(tr('검수 데이터가 바뀌었습니다. 창을 닫고 다시 검토하세요.'));
 const e=allocationEvent(id),option=allocationOptions(e).find(o=>o.id===target);
 if(!e||!option?.fits||[...state.scans,...(state.pending||[])].filter(s=>s.id===id).length!==1)throw Error(tr('배정 후보와 잔여 수량을 다시 확인하세요.'));
 const {holdForStore,holdOrigin,...originalEvent}=e;
 const next={...state,receipt:target,assignment:'수동 연결',autoPaused:true,scans:[...state.scans.filter(s=>s.id!==id),{...originalEvent,receipt:target,allocationConfirmed:true}],pending:(state.pending||[]).filter(s=>s.id!==id)};
 next.audit=[...(state.audit||[]),{id:makeId(),at:new Date().toISOString(),action:e.receipt?'초과 입력 ASN 재배정':'보류 입력 ASN 배정',events:[{...e}],receipt:target,note:target}];Engine.validateSession(next);state=next;lastBarcode=lastKey(state.scans.find(s=>s.id===id));changed();draw();allocationReturnFocus=$('overviewStatus');$('allocationDialog').close();$('overviewStatus').focus();return true;
 }catch(err){$('allocationError').textContent=err.message;return false;}}
$('directReport').onclick=()=>{const result=refreshReportDialog();if(result.blocked||result.mode!=='report'){notice(result.message,'warning');return;}openUtilityDialog('reportDialog','directReport','confirmationText');};
$('allocationReport').onclick=()=>{const result=refreshReportDialog();if(result.blocked||result.mode!=='report'){notice(result.message,'warning');return;}$('allocationDialog').close();openUtilityDialog('reportDialog','confirmInspection','confirmationText');};
$('allocationCandidates').onclick=e=>{const b=e.target.closest?.('[data-allocate-asn]');if(b&&!b.disabled)assignHeldEvent(allocationEventId,b.dataset.allocateAsn);};
$('allocationDialog').onclose=()=>{if(allocationReturnFocus?.isConnected&&!allocationReturnFocus.disabled)allocationReturnFocus.focus();else $($('activityDialog').open?'activityClose':'activityExpand').focus();};
for(const id of ['scanActivity','activityHistory'])$(id).onclick=e=>{const b=e.target.closest?.('[data-assign-event]');if(b&&!b.disabled)openAllocation(b.dataset.assignEvent,b);};

var discrepancyMode='',discrepancyPinned=false,discrepancyTimer=null,suppressPreviewFocus=false;
function closeDiscrepancyPreview(returnFocus=false){const target=discrepancyMode+'Details';if(discrepancyTimer)clearTimeout(discrepancyTimer);discrepancyMode='';discrepancyPinned=false;$('discrepancyPopover').classList.toggle('hidden',true);for(const id of ['missingDetails','excessDetails','outsideDetails'])$(id).setAttribute('aria-expanded','false');if(returnFocus){suppressPreviewFocus=true;$(target).focus();suppressPreviewFocus=false;}}
function showDiscrepancyPreview(mode,pin=false){$('discrepancyPopover').setAttribute('data-mode',mode);if(discrepancyTimer)clearTimeout(discrepancyTimer);discrepancyMode=mode;discrepancyPinned=pin;const button=$(mode+'Details'),rows=mode==='outside'?wmsUnverifiedEntries().map(x=>({name:x.name,brand:x.brand,sku:x.sku,barcode:x.barcode,actual:x.qty,expected:0,status:x.held?'보류':(language==='en'?'Unverified barcode':'미확인 바코드')})):reconcileView(state.data,state.receipt,state.scans).filter(r=>mode==='missing'?r.missing>0:mode==='outside'?r.unregistered&&r.actual>0:!r.unregistered&&r.excess>0);$('discrepancyTitle').textContent=mode==='outside'?(language==='en'?'Unverified barcode':'미확인 바코드'):tr(mode==='missing'?'부족 상품':'초과 상품');$('discrepancyProducts').innerHTML=rows.length?rows.map(r=>'<div class="discrepancy-product"><span>'+productIdentityMarkup(uiData(r.name),r.conflict?null:r.brand)+'</span><b>'+(r.actual-r.expected>0?'+':'')+(r.actual-r.expected)+'</b><small>'+esc([r.sku?'SKU '+r.sku:'',r.barcode?'Barcode '+r.barcode:'',(r.status==='예정 외'?(language==='en'?'Not on this ASN':'현재 ASN에 없음'):tr(r.status))].filter(Boolean).join(' · '))+'</small></div>').join(''):'<div class="discrepancy-empty">'+esc(tr('해당 상품이 없습니다.'))+'</div>';for(const id of ['missingDetails','excessDetails','outsideDetails'])$(id).setAttribute('aria-expanded',String(id===button.id));const panel=$('discrepancyPopover');panel.classList.toggle('hidden',false);const rect=button.getBoundingClientRect?.()||{left:12,bottom:80,top:40},vw=window.innerWidth||800,vh=window.innerHeight||600,width=Math.min(400,vw-24),height=Math.min(panel.offsetHeight||220,340,vh-24);panel.style.left=Math.max(12,Math.min(rect.left,vw-width-12))+'px';panel.style.top=Math.max(12,rect.bottom+8+height<=vh?rect.bottom+8:rect.top-height-8)+'px';}
function scheduleDiscrepancyClose(){if(discrepancyPinned)return;if(discrepancyTimer)clearTimeout(discrepancyTimer);discrepancyTimer=setTimeout(()=>closeDiscrepancyPreview(),180);}
for(const mode of ['missing','excess','outside']){const b=$(mode+'Details');b.onmouseenter=()=>{if(!discrepancyPinned)showDiscrepancyPreview(mode);};b.onmouseleave=scheduleDiscrepancyClose;b.onfocus=()=>{if(!suppressPreviewFocus)showDiscrepancyPreview(mode);};b.onclick=()=>{if(discrepancyMode===mode&&discrepancyPinned)closeDiscrepancyPreview();else showDiscrepancyPreview(mode,true);};b.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closeDiscrepancyPreview();}};b.onblur=e=>{if(!e.relatedTarget?.closest?.('#discrepancyPopover'))scheduleDiscrepancyClose();};}
$('discrepancyPopover').onmouseenter=()=>{if(discrepancyTimer)clearTimeout(discrepancyTimer);};$('discrepancyPopover').onmouseleave=scheduleDiscrepancyClose;$('discrepancyPopover').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closeDiscrepancyPreview(true);}};$('discrepancyClose').onclick=()=>closeDiscrepancyPreview(true);window.addEventListener('resize',()=>closeDiscrepancyPreview());

var activityMinimized=false;
// A sheet is a projection over shared persisted events, never a copy of them.

function pendingInSelectedStore(e){if(!eventInCurrentMode(e))return false;const key=selectedWorkStoreKey(),eventKey=e.holdForStore||e.workStoreKey||'';return !eventKey||!!key&&eventKey===key;}
function sheetEvents(all=false,scope='order'){
 const events=[...state.scans,...(state.pending||[])].filter(e=>e.batch===state.currentBatch);
 if(scope==='all')return events;
 if(scope==='pending'||!state.receipt)return events.filter(e=>!e.receipt&&pendingInSelectedStore(e));
 return events.filter(e=>e.receipt===state.receipt);
}
function latestSheetEvent(scope='order'){
 const cacheKey='latest-sheet-event:'+scope;
 if(renderReadCache?.has(cacheKey))return renderReadCache.get(cacheKey);
 const event=latestScanEvent(sheetEvents(false,scope));
 renderReadCache?.set(cacheKey,event);
 return event;
}
function syncSheetView(){
 const key=JSON.stringify([state.receipt||'',selectedWorkStoreKey(),state.currentBatch||'']);
 if(key!==viewedSheetKey){viewedSheetKey=key;historyPage=0;resultPage=0;$('historyScope').value='order';setUI('feedback','',false,true);}
 const last=latestSheetEvent();lastBarcode=last?lastKey(last):'';
 const undoLabel=state.receipt?(language==='en'?'Undo latest input in this order':'이 오더 최근 입력 취소'):(language==='en'?'Undo latest unassigned store input':'매장 미배정 최근 입력 취소');
 $('undo').disabled=!last;$('undo').setAttribute('aria-label',undoLabel);$('undo').title=undoLabel;
}
function undoSheetEvent(scope='order'){
 const latest=latestSheetEvent(scope);if(!returnsScan.undo(latest))return false;
 setUI('feedback',Engine.eventCode(latest)+(language==='en'?' · ':' 입력 ')+Engine.units(latest)+(language==='en'?' cancelled · ':'개를 취소했습니다. · ')+(latest.receipt?(receiptDisplay(latest.receipt)||latest.receipt):(language==='en'?'Store unassigned':'매장 미배정')),false,true);if(!$('activityDialog').open)focusBeamInput('barcode');return true;
}
function legacyScanOutcomes(events){
 const outcomes=new Map(),prefix=[];
 for(const {e} of events.map((e,i)=>({e,i})).sort((a,b)=>Date.parse(a.e.at)-Date.parse(b.e.at)||a.i-b.i)){
  if(!e.scanOutcome)outcomes.set(e,entryOutcome(state.data,e.receipt,prefix,e));
  if(e.receipt)prefix.push(e);
 }
 return outcomes;
}
function scanActivityRows(rows,all=false){
 const cacheKey=all?'activity-history':'activity-recent';
 if(renderReadCache?.has(cacheKey))return renderReadCache.get(cacheKey);
 const events=sheetEvents(all,all?$('historyScope').value:'order');
 let historical;
 const page=all?scanHistoryPage(events,historyPage*200,(historyPage+1)*200):recentScanEvents(events);
 const values=page.map(e=>{
  const pending=!e.receipt,master=Engine.masterInfo(state.data,e);const eventRows=e.receipt&&e.receipt!==state.receipt?reconcileView(state.data,e.receipt,state.scans):rows;
  const inAsn=pending?[...candidateReceipts(state.data,e)].flatMap(id=>{const {row}=inspectEntry(state.data,id,state.scans,e);return row&&matchesStore(row)?[row]:[];}):eventRows.filter(r=>!r.unregistered&&matchesReference(r,e));
  const outsideKey=(e.kind==='sku'?'M:':'X:')+Engine.eventCode(e);
  const matched=pending?inAsn:inAsn.length===1?inAsn:eventRows.filter(r=>r.key===outsideKey);
  const external=!inAsn.length,conflict=matched.some(r=>r.status==='정보 충돌'||r.unresolved)||(external&&master.conflict);
  const names=[...new Set(matched.map(r=>r.name).filter(n=>n&&!['상품 정보 없음','ASN 상품명 없음'].includes(n)))];
  const name=conflict?tr('상품명 확인 필요'):external&&master.name?master.name:names.length===1?names[0]:tr(names.length>1?'상품명 확인 필요':'상품 정보 없음');
  const scopedBrand=mergeProductBrands(matched.filter(r=>!r.unregistered).map(r=>r.brand));
  const brand=conflict||names.length>1?'':(scopedBrand===''?master.brand:scopedBrand)||'';
  const status=conflict?'정보 충돌':pending?'입력 기록 유지':matched.length===1?matched[0].status:matched.length>1?'정보 충돌':'확인 필요';
  return {sku:!conflict&&matched.length===1?(matched[0].sku||master.sku||''):(!conflict?master.sku||'':''),barcode:!conflict&&matched.length===1?(matched[0].barcode||''):(!conflict&&e.kind!=='sku'?e.barcode||'':''),expected:matched.length===1?matched[0].expected:null,actual:matched.length===1?matched[0].actual:null,id:e.id,name,brand,code:Engine.eventCode(e),qty:Engine.units(e),at:e.at,pending,status,scanOutcome:e.scanOutcome??(historical??=legacyScanOutcomes(events)).get(e),priorWork:e.batch!==state.currentBatch,assignedReceipt:e.receipt||'',held:pending&&!!e.holdForStore,reallocatable:!pending&&excessAllocationSource(e)&&allocationOptions(e).some(o=>o.fits),canAssign:!state.receiptLocked&&allocationOptions(e).some(o=>o.fits)};
 });
 renderReadCache?.set(cacheKey,values);return values;
}

function activityDateLabel(date){
 const day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
 const weekday=date.toLocaleDateString(language==='ko'?'ko-KR':'en-GB',{weekday:'short'});
 return day+' ('+weekday+')';
}
function activityCellState(e,ledger=false){
 if(ledger&&e.held&&!e.assignedReceipt)return {kind:'hold',symbol:'Ⅱ',label:language==='en'?'Another ASN may match':'다른 ASN 혼입 후보 · 배정 확인'};
 if(ledger&&e.scanOutcome==='held')return {kind:'hold',symbol:'Ⅱ',label:language==='en'?'Held at scan time':'입력 당시 보류'};
 if(ledger&&e.scanOutcome==='accepted')return {kind:'accepted',symbol:'✓',label:language==='en'?'Scan accepted':'스캔 정상 등록'};
 if(ledger&&e.scanOutcome==='excess')return {kind:'excess',symbol:'⚠︎',label:language==='en'?'This entry exceeded the expected quantity':'이 입력부터 예정 수량 초과'};
 if(ledger&&e.scanOutcome==='unknown')return {kind:'unknown',symbol:'⚠︎',label:e.scope==='carton'?(language==='en'?'Not expected in this scope':'현재 검수 범위의 예정 외 상품'):(language==='en'?'Entry not on the selected order':'현재 ASN에 없는 입력')};
 if(ledger&&e.scanOutcome==='conflict')return {kind:'review',symbol:'⚠︎',label:language==='en'?'Product identifiers conflict':'상품 식별 정보 충돌'};
 const count=Number.isFinite(e.expected)&&Number.isFinite(e.actual)?` · ${e.actual} / ${e.expected} EA`:'';
 if(e.held)return {kind:'hold',symbol:'Ⅱ',label:language==='en'?'On hold · Assign an ASN':'보류 · ASN 배정 필요'};
 if(e.status==='일치')return {kind:'complete',symbol:'O',label:(language==='en'?'Quantity matched':'수량 일치')+count};
 if(e.status==='부족')return {kind:'progress',symbol:'◔',label:(language==='en'?'Inspection in progress':'검수 진행 중')+count+(language==='en'?` · ${e.expected-e.actual} remaining`:` · ${e.expected-e.actual}개 남음`)};
 if(e.status==='초과')return {kind:'excess',symbol:'⚠︎',label:tr(e.status)+count};
 if(e.status==='예정 외')return {kind:'unknown',symbol:'⚠︎',label:(language==='en'?'Unverified barcode':'미확인 바코드')+count};
 if(e.pending||e.status==='입력 기록 유지')return {kind:'waiting',symbol:'…',label:language==='en'?'Waiting for ASN · Entry preserved':'ASN 선택 대기 · 입력 기록 유지'};
 return {kind:'review',symbol:'?',label:tr(e.status)};
}

function syncAvailabilitySetting(){const on=cartonWorkspace.locationMode()??(state.availabilityEnabled===true);$('availabilityToggle').setAttribute('aria-checked',String(on));$('availabilityState').textContent=on?'ON':'OFF';}
// Display-only picking projection; reference rows and all original Loc values remain intact.
function locationTypeKey(v){return String(v??'').normalize('NFKC').trim().toUpperCase();}
function pickingLocationData(item){
 if(!item||!item.sku||item.conflict||item.unresolved||item.status==='정보 충돌'||item.status==='식별자 없음')return {reason:'SKU 확인 필요',groups:[]};
 if(!state.data.loc.length)return {reason:'위치 자료를 불러오세요',groups:[]};
 const ix=Engine.getIndex(state.data);if(!ix.locationTypePresent)return {reason:'위치 유형 열을 연결한 자료를 다시 불러오세요',groups:[]};
 const barcode=item.barcode||'',related=[...new Set([...(ix.locBySku.get(item.sku)||[]),...(barcode?ix.locByBarcode.get(barcode)||[]:[])])];
 if(related.some(r=>barcode&&r.barcode===barcode&&r.sku&&r.sku!==item.sku))return {reason:'SKU·Barcode 위치 정보 충돌',groups:[]};
 if(related.some(r=>barcode&&r.barcode===barcode&&!r.sku))return {reason:'위치 자료의 SKU 확인 필요',groups:[]};
 const rules=exampleLocationRules.get(state.data.raw)??MappingUI.locationRules(),eligible=new Set(rules.eligibleTypes);
 if(!eligible.size)return {reason:language==='en'?'Set eligible types in Location display rules':'위치 표시 규칙에서 피킹 유형을 지정하세요',groups:[]};
 const typeOf=r=>locationTypeKey(r.locationType),missingType=related.some(r=>!typeOf(r)),picking=related.filter(r=>eligible.has(typeOf(r))&&r.sku===item.sku);
 if(picking.some(r=>!String(r.loc||'').trim()))return {reason:language==='en'?'Picking location needs verification':'피킹 위치 정보 확인 필요',groups:[]};
 const typed=picking.filter(r=>String(r.loc||'').trim());
 if(!typed.length)return {reason:missingType?'위치 유형 열을 연결한 자료를 다시 불러오세요':'NEW LOCATION',groups:[]};
 if(new Set(typed.map(r=>r.warehouse||'')).size>1)return {reason:'복수 창고 위치 · 창고 확인 필요',groups:[]};
 const zoneByLoc=new Map();
 for(const row of typed){
  const loc=row.loc, zone=String(row.zone??'').trim();
  const previous=zoneByLoc.get(loc)||'';
  if(zone&&previous&&zone!==previous)return {reason:'같은 Loc의 Zone 정보 충돌',groups:[]};
  if(!zoneByLoc.has(loc)||zone)zoneByLoc.set(loc,zone);
 }
 const groups=new Map();for(const [loc,explicit] of zoneByLoc){
  const at=rules.zoneSeparator?loc.indexOf(rules.zoneSeparator):-1;
  const zone=explicit||(at>0?loc.slice(0,at).trim():'');
  if(!groups.has(zone))groups.set(zone,[]);groups.get(zone).push(loc);
 }
 return {reason:'',missingType,putaway:[...new Set(typed.map(r=>r.putawayZone).filter(Boolean))],groups:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([zone,locs])=>({zone,locs:locs.sort()}))};
}
function outboundLocation(item){
 if(!item||item.conflict)return [];
 const master=!item.sku&&item.value?Engine.masterInfo(state.data,{kind:'code',barcode:item.value}):null;
 if(master?.conflict)return [];
 const pick=pickingLocationData({...item,sku:item.sku||master?.sku||''});
 return pick.reason?[]:pick.groups.flatMap(group=>group.locs);
}
function pickingLocationText(item){const info=pickingLocationData(item);if(info.reason)return '';return (language==='en'?'Picking location · ':'피킹 위치 · ')+info.groups.flatMap(g=>g.locs).join(', ')+(info.missingType?(language==='en'?' · Some location types need verification':' · 일부 위치 유형 확인 필요'):'');}
function pickingLocationLine(item){const value=pickingLocationText(item);return value?'<div class="small">'+esc(value)+'</div>':'';}
function pickingLocationInfo(last){
 if(!last)return {reason:'마지막 입력 없음',groups:[]};
 if(!last.sku||last.status==='정보 충돌')return {reason:'SKU 확인 필요',groups:[]};
 if(!state.receipt||last.assignedReceipt!==state.receipt||last.pending)return {reason:'현재 오더에 배정된 상품의 위치를 확인하세요',groups:[]};
 return pickingLocationData(last);
}
function drawPickingLocation(last){
 const node=$('lastScannedPicking'),card=$('overviewPutaway');node.replaceChildren();$('putawayLabel').textContent=language==='en'?'Planned Location':'예정 Location';card.hidden=state.availabilityEnabled!==true||!last;if(card.hidden)return;
 const info=pickingLocationInfo(last);
 if(info.reason){const note=document.createElement('p');note.className='picking-note';note.textContent=info.reason==='NEW LOCATION'?(language==='en'?'New location':'신규 위치'):tr(info.reason);node.append(note);return;}
 for(const group of info.groups){const section=document.createElement('div');section.className='picking-zone-group';const title=document.createElement('strong');title.textContent=group.zone||(language==='en'?'Zone needs verification':'구역 확인 필요');title.setAttribute('aria-label',group.zone?'Zone · '+group.zone:(language==='en'?'Zone needs verification':'구역 확인 필요'));section.append(title);for(const loc of group.locs){const row=document.createElement('span');row.className='picking-loc';row.textContent=loc;row.setAttribute('aria-label',(language==='en'?'Location · ':'위치 · ')+loc);section.append(row);}node.append(section);}
 if(info.missingType){const note=document.createElement('p');note.className='picking-note';note.textContent=tr('위치 유형 열을 연결한 자료를 다시 불러오세요');node.append(note);}
 if(info.putaway?.length&&!(info.groups.length===1&&info.putaway.length===1&&info.putaway[0]===info.groups[0].zone)){const note=document.createElement('p');note.className='picking-note';note.textContent=(language==='en'?'Putaway zone · ':'적치 구역 · ')+info.putaway.join(' / ');node.append(note);}
 if(info.groups.some(g=>!g.zone)){const note=document.createElement('p');note.className='picking-note';note.textContent=language==='en'?'Verify the zone for this location':'이 위치의 구역을 확인하세요.';node.append(note);}
 if(info.groups.length>1){const note=document.createElement('p');note.className='picking-note';note.textContent=language==='en'?'Multiple zones · destination not selected':'구역이 여러 곳입니다. 적치 위치를 확인하세요.';node.append(note);}
}


function lastScannedOutsideStore(last){
 if(!last||last.status==='정보 충돌')return false;
 const key=selectedWorkStoreKey();if(!key)return false;
 const events=[...state.scans,...(state.pending||[])].filter(e=>e.id===last.id&&e.batch===state.currentBatch);if(events.length!==1)return false;
 const e=events[0],eventStore=e.receipt?asnStoreKey(e.receipt):e.holdForStore||e.workStoreKey||'';if(eventStore!==key)return false;
 const master=Engine.masterInfo(state.data,e);if(master.conflict)return false;
 return ![...candidateReceipts(state.data,e,{allowMasterSku:true})].some(id=>modeAllowsReceipt(id)&&asnStoreKey(id)===key);
}

function lastScannedCountLabel(actual,expected,english){
 const delta=expected-actual, count=Math.abs(delta).toLocaleString(english?'en':'ko');
 const quantity=actual.toLocaleString(english?'en':'ko')+' / '+expected.toLocaleString(english?'en':'ko')+' EA';
 return {quantity,detail:delta===0?(english?'Quantity matched':'수량 일치'):delta>0?(english?count+' remaining':count+'개 남음'):(english?count+' excess':count+'개 초과')};
}
function drawLastScanned(rows){
 const entries=scanActivityRows(rows),last=entries.at(-1),box=$('lastScanned');$('scanReadout').hidden=!last&&!state.availabilityEnabled;
 box.hidden=!last;
 const outside=lastScannedOutsideStore(last);box.classList.toggle('store-unregistered',outside);$('lastScannedStoreWarning').hidden=!outside;$('lastScannedStoreWarning').textContent=outside?(language==='en'?'Not registered in any order for this store':'선택 매장 전체 오더에 미등록'):'';
 drawPickingLocation(last);
 const label=scannedProductLabel(last?.name,last?.brand),badge=$('lastScannedBrand');
 badge.hidden=!label.brand;badge.textContent=label.brand;
 if(!last)return;
 $('lastScannedName').textContent=label.name;
 $('lastScannedSku').textContent='SKU · '+(last.sku||'—');
 $('lastScannedBarcode').textContent=(language==='en'?'Barcode · ':'상품 바코드 · ')+(last.barcode||'—');
 $('lastScannedContext').textContent=last.pending?(language==='en'?'ASN pending':'ASN 미배정'):last.assignedReceipt!==state.receipt?'ASN · '+last.assignedReceipt:'';
 const progress=$('lastScannedProgress'),group=$('lastScannedProgressGroup'),bar=$('lastScannedBar');
 const valid=last.assignedReceipt===state.receipt&&!last.pending&&Number.isFinite(last.actual)&&Number.isFinite(last.expected)&&last.expected>0&&!['정보 충돌','식별자 없음','예정 외','확인 필요'].includes(last.status);
 const phase=valid?activityCellState(last).kind:'';
 const {quantity,detail}=valid?lastScannedCountLabel(last.actual,last.expected,language==='en'):{quantity:'',detail:''};
 group.hidden=!valid;group.dataset.phase=phase;
 progress.textContent=quantity;$('lastScannedRemaining').textContent=detail;
 $('lastScannedPercent').textContent=valid?Math.floor(last.actual/last.expected*100)+'%':'';
 bar.value=valid?Math.min(100,Math.max(0,last.actual/last.expected*100)):0;
 bar.dataset.phase=phase;bar.setAttribute('aria-valuetext',valid?quantity+' · '+detail:'');
 box.title=(language==='en'?'Last input: ':'마지막 입력: ')+last.code;
}



function syncQuestPeek(){$('questPeekTitle').textContent=$('questTitle').textContent+' · '+$('questSummary').textContent;setVirtualList('questPeekList',questRows);}
function endQuestPeek(){if(questPeekTimer!==null)clearTimeout(questPeekTimer);questPeekTimer=null;questHotkeyHeld=false;const pane=$('questPeek'),restore=typeof document!=='undefined'&&pane.contains?.(document.activeElement);pane.hidden=true;virtualLists.delete('questPeekList');$('questPeekList').replaceChildren();if(restore&&questReturnFocus?.isConnected)questReturnFocus.focus({preventScroll:true});questReturnFocus=null;}
function startQuestPeek(e){
 if(e.key!=='F2'||e.isComposing||e.keyCode===229||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey)return;
 if(!state.receipt||e.target?.closest?.('dialog'))return;
 e.preventDefault();closeOrderInfo();
 if(questHotkeyHeld)return;
 // F2 never advances focus, including when the scan input owns focus.
 questHotkeyHeld=true;questReturnFocus=document.activeElement;syncQuestPeek();$('questPeek').hidden=false;
}
document.addEventListener('keydown',startQuestPeek);
document.addEventListener('keyup',e=>{if(e.key==='F2')endQuestPeek();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')endQuestPeek();});
window.addEventListener('blur',endQuestPeek);document.addEventListener('visibilitychange',()=>{if(document.hidden)endQuestPeek();});

function questItemMarkup(r){const v=activityCellState({status:r.status,actual:r.actual,expected:r.expected}),note=r.status==='부족'?(language==='en'?`${r.missing} left`:`${r.missing}개 남음`):r.status==='일치'?(language==='en'?'Complete':'완료'):(r.status==='예정 외'?(language==='en'?'Not on this ASN':'현재 ASN에 없음'):tr(r.status));return `<li class="quest-item" data-phase="${v.kind}" title="${esc(r.name+' · '+(r.sku||r.barcode||'—')+' · '+v.label)}"><span class="quest-symbol" aria-label="${esc(v.label)}">${v.kind==='complete'?beamIcon('check'):v.kind==='progress'?beamIcon('clock'):v.symbol==='⚠︎'?beamIcon('warning'):v.symbol}</span><div class="quest-product"><strong>${productIdentityMarkup(r.name,r.conflict?null:r.brand)}</strong><small tabindex="0">${esc(r.sku||r.barcode||'—')}</small></div><div class="quest-count"><b>${r.actual.toLocaleString()} <span>/ ${r.expected.toLocaleString()}</span></b><small>${esc(note)}</small></div></li>`;}
function setVirtualList(id,rows){const el=$(id);virtualLists.set(id,{rows,start:-1,end:-1});el.scrollTop=0;renderVirtualList(id);}
function renderVirtualList(id){const el=$(id),model=virtualLists.get(id);if(!model)return;const height=64,start=Math.max(0,Math.floor(el.scrollTop/height)-6),end=Math.min(model.rows.length,start+Math.ceil((el.clientHeight||600)/height)+18);if(model.start===start&&model.end===end)return;model.start=start;model.end=end;const spacer=n=>n?`<li class="virtual-spacer" aria-hidden="true" style="height:${n*height}px"></li>`:'';el.innerHTML=spacer(start)+model.rows.slice(start,end).map((r,i)=>questItemMarkup(r).replace('<li ',`<li aria-posinset="${start+i+1}" aria-setsize="${model.rows.length}" `)).join('')+spacer(model.rows.length-end);if(!model.rows.length)el.innerHTML='<li class="quest-empty">'+(language==='en'?'No expected items':'예정 상품 없음')+'</li>';}
function drawSkuQuest(rows){const expected=rows.filter(r=>!r.unregistered),done=expected.filter(r=>r.status==='일치').length;questRows=expected;$('skuQuest').hidden=!state.receipt;$('questTitle').textContent=language==='en'?'Expected return receipts':'반품 입고 예정 수량';$('questSummary').textContent=language==='en'?`${done} / ${expected.length} SKU complete`:`${done} / ${expected.length} SKU 완료`;$('questNote').textContent=language==='en'?'Inspected / expected · EA':'검수 / 예정 · EA';$('questAlerts').textContent='';$('questList').replaceChildren();updateMobileQuantities();}

function activityMarkup(events,compact=false){
 const columns=compact?(language==='en'?['Barcode / SKU','Product','Qty','Timestamp','Status']:['상품 바코드 / SKU','제품명','수량','타임스탬프','상태']):(language==='en'?['#','Barcode','SKU','Product','Qty','Timestamp','Status']:['#','Barcode','SKU','제품명','수량','타임스탬프','상태']);
 const codeLine=(label,value,secondary=false)=>'<span class="'+(secondary?'secondary-code':'primary-code')+'" title="'+esc(label+': '+(value||'—'))+'"><span class="sr-only">'+label+' </span>'+esc(value||'—')+'</span>';
 const head='<thead><tr>'+columns.map((label,i)=>'<th scope="col" class="'+(compact?'compact-col-':'sheet-col-')+i+'">'+esc(label)+'</th>').join('')+'</tr></thead>';
 const body=events.map((e,i)=>{const visual=activityCellState(e,true);const date=new Date(e.at),validDate=Number.isFinite(date.getTime()),time=!validDate?'—':date.toLocaleTimeString(language==='ko'?'ko-KR':'en-GB',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
 return `<tr class="sheet-row"${e.result?' data-result="'+esc(e.result)+'"':''} data-status="${esc(e.held?'보류':e.status)}">${compact?'<td class="sheet-code activity-code-pair">'+codeLine(language==='en'?'Barcode':'상품 바코드',e.barcode)+codeLine('SKU',e.sku,true)+'</td>':`<th scope="row" class="sheet-index">${historyPage*200+i+1}</th><td class="sheet-code sheet-barcode">${esc(e.barcode||'—')}</td><td class="sheet-code sheet-sku">${esc(e.sku||'—')}</td>`}<td class="sheet-name" title="${esc(e.name)}">${productIdentityMarkup(e.name,e.brand)}${e.code&&e.code!==e.barcode&&e.code!==e.sku?'<small class="original-input">'+esc((language==='en'?'Input: ':'입력: ')+e.code)+'</small>':''}</td><td class="sheet-qty"><b>${e.qty.toLocaleString()}</b><small>EA</small></td><td class="sheet-time"><time datetime="${esc(validDate?e.at:'')}" title="${esc(validDate?date.toString():(language==='en'?'Timestamp unavailable':'입력 시각 확인 필요'))}"><span>${esc(time)}</span><small>${esc(validDate?activityDateLabel(date):'—')}</small></time>${e.priorWork?'<small>'+esc(tr('이전 작업'))+'</small>':''}</td><td class="sheet-status" data-cell-state="${visual.kind}" title="${esc(visual.label)}" aria-label="${esc(visual.label)}"><span class="status-symbol${visual.symbol==='⚠︎'?' status-warning':visual.kind==='accepted'?' status-accepted':''}" aria-hidden="true">${visual.symbol==='⚠︎'?beamIcon('warning'):visual.kind==='accepted'?beamIcon('check'):visual.symbol}</span>${(e.held||e.reallocatable)&&!e.priorWork?'<button type="button" class="assign-entry" data-assign-event="'+esc(e.id)+'" aria-haspopup="dialog" aria-label="'+esc(e.reallocatable?(language==='en'?'Reassign this excess entry to another ASN':'이 초과 입력을 다른 ASN에 재배정'):tr('이 입력을 ASN에 배정'))+'" title="'+esc(e.canAssign&&e.reallocatable?(language==='en'?'Reassign this excess entry to another ASN':'이 초과 입력을 다른 ASN에 재배정'):tr(e.canAssign?'이 입력을 ASN에 배정':state.receiptLocked?'검수 대상 고정을 먼저 해제해 주세요.':'배정 가능한 ASN 없음'))+'"'+(e.canAssign?'':' disabled')+'>↗</button>':''}</td></tr>`;
 }).join('')||'<tr><td colspan="'+columns.length+'" class="sheet-empty">'+esc(tr('스캔 기록이 없습니다.'))+'</td></tr>';
 return '<table class="activity-sheet'+(compact?' compact-activity':'')+'" aria-label="'+esc(tr(compact?'최근 입력 5건':'입력 기록'))+'">'+head+'<tbody>'+body+'</tbody></table>';
}
function syncActivityVisibility(){
 const collapsed=!!activityMinimized,button=$('activityMinimize');
 $('scanActivityViewport').hidden=collapsed;$('recentActivityBar').hidden=collapsed;
 button.innerHTML=beamIcon(collapsed?'add':'minus');
 button.setAttribute('aria-expanded',String(!collapsed));
 const label=language==='en'?(collapsed?'Restore recent entries':'Minimize recent entries'):(collapsed?'최근 입력 복원':'최근 입력 최소화');
 button.setAttribute('aria-label',label);button.setAttribute('title',label);
}
function drawScanActivity(rows){
 syncActivityVisibility();
 $('scanActivity').innerHTML=activityMarkup(scanActivityRows(rows),true);
 $('scanActivityTitle').textContent=language==='en'?'Recent 5':'최근 입력 5건';$('recentActivityRef').textContent=state.receipt?'· '+(receiptDisplay(state.receipt)||state.receipt):'';const pending=sheetEvents(false,'pending'),units=pending.reduce((n,e)=>n+Engine.units(e),0);$('unassignedActivity').hidden=!units;$('unassignedActivity').textContent=(language==='en'?'Store unassigned ':'매장 미배정 ')+units+' EA';const unknownStore=pending.some(e=>!e.holdForStore&&!e.workStoreKey);if(unknownStore)$('unassignedActivity').textContent+=(language==='en'?' · Store unknown included':' · 매장 미지정 포함');
 const action=tr('입력 기록 펼치기');$('activityExpand').setAttribute('aria-label',action);$('activityExpand').setAttribute('title',action);
 if($('activityDialog').open)drawActivityHistory(rows);
}
function drawActivityHistory(rows){const scope=$('historyScope').value,total=sheetEvents(true,scope).length;const en=language==='en';$('activityDialogTitle').textContent=scope==='all'?(en?'This work sheet':'이 작업 전체'):scope==='pending'?(en?'Store unassigned entries':'매장 미배정 입력'):(en?'Order entries · ':'오더 입력 · ')+(receiptDisplay(state.receipt)||state.receipt||'—');if(scope==='pending'&&sheetEvents(true,'pending').some(e=>!e.holdForStore&&!e.workStoreKey))$('activityDialogTitle').textContent+=(en?' · Unknown store included':' · 매장 미지정 포함');$('historyScope').options[0].textContent=en?'Selected order':'선택 오더';$('historyScope').options[1].textContent=en?'Store unassigned':'매장 미배정';$('historyScope').options[2].textContent=en?'This work sheet':'이 작업 전체';$('historyScope').previousElementSibling.textContent=en?'History scope':'기록 범위';$('historyPendingUndo').hidden=scope!=='pending';$('historyPendingUndo').disabled=!latestSheetEvent('pending');$('historyPendingUndo').textContent=en?'Undo latest unassigned store input':'매장 미배정 최근 입력 취소';historyPage=Math.min(historyPage,Math.max(0,Math.ceil(total/200)-1));$('historyPager').hidden=total<=200;$('historyPrev').disabled=historyPage===0;$('historyNext').disabled=(historyPage+1)*200>=total;$('historyPageLabel').textContent=(total?(historyPage*200+1)+'–'+Math.min(total,(historyPage+1)*200):'0')+' / '+total;const viewport=$('activityHistoryViewport'),top=viewport.scrollTop||0,follow=(viewport.scrollHeight||0)-(viewport.clientHeight||0)-top<48;$('activityHistory').innerHTML=activityMarkup(scanActivityRows(rows,true));viewport.scrollTop=follow?(viewport.scrollHeight||0):top;}
$('historyScope').onchange=()=>{historyPage=0;drawActivityHistory(reconcileView(state.data,state.receipt,state.scans));};
$('historyPendingUndo').onclick=()=>undoSheetEvent('pending');
$('unassignedActivity').onclick=()=>{$('historyScope').value='pending';historyPage=0;openUtilityDialog('activityDialog','unassignedActivity','activityClose');drawActivityHistory(reconcileView(state.data,state.receipt,state.scans));};
$('activityMinimize').onclick=()=>{activityMinimized=!activityMinimized;syncActivityVisibility();};
$('activityExpand').onclick=()=>{$('historyScope').value='all';historyPage=0;openUtilityDialog('activityDialog','activityExpand','activityClose');if(!$('activityDialog').open)return;$('activityExpand').setAttribute('aria-expanded','true');drawActivityHistory(reconcileView(state.data,state.receipt,state.scans));};
$('activityDialog').onclose=()=>{$('activityExpand').setAttribute('aria-expanded','false');$('activityExpand').focus();};


// File is a local-work disclosure, not a connection to an external database.
function closeFileMenu(returnFocus=false){$('fileMenuPanel').hidden=true;$('fileMenuButton').setAttribute('aria-expanded','false');if(returnFocus)$('fileMenuButton').focus();}
function openFileMenu(){$('fileMenuPanel').hidden=false;$('fileMenuButton').setAttribute('aria-expanded','true');}
$('fileMenuButton').onclick=()=>{if($('fileMenuPanel').hidden)openFileMenu();else closeFileMenu();};
$('fileMenuButton').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();openFileMenu();$('dataLauncher').focus();}else if(e.key==='Escape'){e.preventDefault();closeFileMenu(true);}};
$('fileMenuPanel').onkeydown=e=>{const ids=['dataLauncher','restore','save','beamDriveExport','beamOneDriveExport','newWork','language','helpLauncher'].filter(id=>!$(id).hidden&&!$(id).disabled);const index=ids.indexOf(document.activeElement.id);if(e.key==='Escape'){e.preventDefault();closeFileMenu(true);}else if(index>=0&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?ids.length-1:(index+(e.key==='ArrowDown'?1:-1)+ids.length)%ids.length;$(ids[next]).focus();}};
$('fileMenu').onfocusout=e=>{if(!e.relatedTarget||!$('fileMenu').contains(e.relatedTarget))closeFileMenu();};
window.addEventListener('pointerdown',e=>{if(!$('fileMenu').contains(e.target))closeFileMenu();});
for(const [id,dialog] of [['dataLauncher','dataDialog'],['restore',null],['save',null],['newWork','newWorkDialog'],['helpLauncher','helpDialog']]){const action=$(id).onclick;$(id).onclick=e=>{closeFileMenu(true);action(e);if(dialog&&$(dialog).open)$(dialog).returnFocus='fileMenuButton';};}

document.querySelector('.order-workspace-top').addEventListener('scroll',()=>closeReceiptList());window.addEventListener('resize',()=>closeReceiptList());
$('receiptToggle').onpointerdown=e=>e.preventDefault();
function labelReceiptToggle(){const b=$('receiptToggle');const label=beamL('ASN 목록','ASN list');b.title=label;b.setAttribute('aria-label',label);}
$('receiptToggle').onclick=()=>{if(state.receiptLocked)return;const expanded=$('receipt').getAttribute('aria-expanded')==='true';if(expanded){closeReceiptList();}else{$('receipt').focus();receiptIndex=-1;renderReceiptList();}};
$('receiptToggle').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();if(state.receiptLocked)return;$('receipt').focus();$('receipt').onkeydown(e);}else if(e.key==='Escape'){e.preventDefault();closeReceiptList();}};

$('overviewDetailsToggle').onclick=()=>{const expanded=$('overviewExtra').classList.toggle('is-expanded');$('overviewDetailsToggle').setAttribute('aria-expanded',String(expanded));};
$('availabilityToggle').onclick=()=>{if(cartonWorkspace.toggleLocation())return;state.availabilityEnabled=state.availabilityEnabled!==true;changed();draw();};

function receiptBarcodeValue(id=state.receipt){return typeof id==='string'&&/^[\x20-\x7e]{1,80}$/.test(id)&&rawRows(id).length>0?id:'';}

function showReceiptBarcode(){
 const id=state.receipt;if(!receiptBarcodeValue(id))return;
 $('receiptBarcodeTicket').innerHTML=beamTicketFace(id,isB2C()?'b2c':'b2b');
 $('receiptBarcodeDialog').showModal();
}
$('receiptBarcode').onclick=showReceiptBarcode;$('receiptBarcodeClose').onclick=()=>$('receiptBarcodeDialog').close();
$('receiptBarcodeDialog').addEventListener('close',()=>{
 if(!$('receiptBarcodeDialog').open)$('receiptBarcodeTicket').replaceChildren();
 if(navigation.isInspection()&&!$('receiptBarcode').disabled)$('receiptBarcode').focus({preventScroll:true});
});



function closeOrderInfo(restore=false){
 const pane=$('orderInfoPopover');if(!pane)return;const inside=pane.contains(document.activeElement),anchor=orderInfoAnchor;
 pane.hidden=true;pane.inert=false;delete pane.dataset.preview;pane.removeAttribute('data-receipt');virtualLists.delete('orderInfoList');$('orderInfoList').replaceChildren();orderInfoPinned=false;orderInfoAnchor=null;
 for(const b of document.querySelectorAll('[data-order-info]'))b.setAttribute('aria-expanded','false');
 if(inside)(restore&&anchor?.isConnected?anchor:$('barcode')).focus({preventScroll:true});
}
function showOrderInfo(id,anchor,pinned=false){
 if(!id||!rawRows(id).length||asnStoreKey(id)!==selectedWorkStoreKey())return;
 if(document.querySelector('dialog[open]')||!$('questPeek').hidden)return;
 if(orderInfoPinned&&!pinned)return;
 const rows=reconcileView(state.data,id,state.scans),p=Engine.asnProgress(state.data,id,state.scans,state.pending||[],state.currentBatch||''),normal=rows.filter(r=>!r.unregistered&&r.status==='일치');
 const pane=$('orderInfoPopover');orderInfoAnchor=anchor;orderInfoPinned=pinned;pane.dataset.receipt=id;
 $('orderInfoTitle').textContent=receiptDisplay(id)||id;
 $('orderInfoCounts').textContent=(language==='en'?'Actual ':'실물 ')+p.actual.toLocaleString()+' / '+(language==='en'?'Expected ':'예정 ')+p.expected.toLocaleString()+' EA';
 $('orderInfoComplete').textContent=(language==='en'?'Matched ':'정상 확인 ')+normal.length+' SKU · '+normal.reduce((n,r)=>n+r.actual,0).toLocaleString()+' EA';
 $('orderInfoListTitle').textContent=language==='en'?'Expected return receipts':'반품 입고 예정 수량';
 setVirtualList('orderInfoList',rows.filter(r=>!r.unregistered));
 const rect=anchor.getBoundingClientRect(),width=Math.min(520,innerWidth-24);
 const top=Math.min(rect.bottom+8,Math.max(12,innerHeight-180));
 pane.dataset.preview=String(!pinned);
 pane.inert=!pinned;
 pane.hidden=false;
 Object.assign(pane.style,{
  left:Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px',top:top+'px',
  width:width+'px',maxHeight:Math.max(140,Math.min(innerHeight-top-12,innerHeight*.7))+'px'
 });
 for(const b of document.querySelectorAll('[data-order-info]'))b.setAttribute('aria-expanded',String(b.dataset.orderInfo===id));
 if(pinned)$('orderInfoClose').focus({preventScroll:true});
}
const orderInfoButton=$('activeOrderInfo');
orderInfoButton.addEventListener('pointerenter',e=>{
 if(e.pointerType!=='touch'&&!orderInfoButton.disabled)showOrderInfo(orderInfoButton.dataset.orderInfo,orderInfoButton);
});
orderInfoButton.addEventListener('pointerleave',()=>{if(!orderInfoPinned)closeOrderInfo();});
orderInfoButton.addEventListener('click',()=>{
 if(orderInfoPinned){closeOrderInfo(true);return;}
 showOrderInfo(orderInfoButton.dataset.orderInfo,orderInfoButton,true);
});
document.querySelector('.order-workspace-top').addEventListener('scroll',()=>closeOrderInfo());
$('orderInfoClose').onclick=()=>closeOrderInfo(true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('orderInfoPopover').hidden){e.preventDefault();closeOrderInfo(true);}});
document.addEventListener('pointerdown',e=>{if(!$('orderInfoPopover').hidden&&!$('orderInfoPopover').contains(e.target)&&!orderInfoButton.contains(e.target))closeOrderInfo();});
window.addEventListener('scroll',e=>{if(!$('orderInfoPopover').contains(e.target))closeOrderInfo();},true);
window.addEventListener('resize',()=>closeOrderInfo());window.addEventListener('blur',()=>closeOrderInfo());document.addEventListener('visibilitychange',()=>{if(document.hidden)closeOrderInfo();});


$('results').append($('resultPager'));
for(const id of ['questPeekList','orderInfoList'])$(id).addEventListener('scroll',()=>renderVirtualList(id));
$('resultPrev').onclick=()=>{resultPage=Math.max(0,resultPage-1);draw();$('results').querySelector('.tablewrap').scrollTop=0;};
$('resultNext').onclick=()=>{resultPage++;draw();$('results').querySelector('.tablewrap').scrollTop=0;};
$('historyPrev').onclick=()=>{historyPage=Math.max(0,historyPage-1);drawActivityHistory(reconcileView(state.data,state.receipt,state.scans));$('activityHistoryViewport').scrollTop=0;};
$('historyNext').onclick=()=>{historyPage++;drawActivityHistory(reconcileView(state.data,state.receipt,state.scans));$('activityHistoryViewport').scrollTop=0;};

$('orderTabs').onclick=e=>{const tab=e.target.closest?.('[data-order-tab]');if(tab&&!tab.disabled&&tab.dataset.orderTab!==state.receipt)switchOrderTab(tab.dataset.orderTab);};
$('orderTabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const list=[...$('orderTabs').querySelectorAll('[data-order-tab]:not(:disabled)')],at=list.indexOf(e.target);if(at<0)return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?list.length-1:(at+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;list[n].focus();};
/* Replace the existing apply/file/workbookFile handlers, do not append duplicates. */
// Reclassify only a positively identified live source; never replace an appended set or alter scan entries.
async function applyLiveChannelProfile(source,profile){
 const original=source.activeRaw;
 if(!original||state.data.raw!==original)return false;
 const getMapping=rows=>{const result=MappingCore.reconnectRows(profile,rows.slice(0,100));if(!result.ok)throw Error(result.reason);return result.mapping;};
 let parsed;
 if(source.file){
  parsed=(await readWorkbook(source.file,'raw',null,{
   selectSheets({sheets}){const matches=sheets.filter(x=>x.name===profile.sheetName);if(matches.length!==1)throw Error('저장한 Return ASN 시트를 찾지 못했어요.');return [{kind:'raw',sheetIndex:matches[0].index}];},
   selectColumns({rows}){return getMapping(rows);}
  })).raw;
 }else{
  const rows=Engine.parseDelimited(source.text);parsed=Engine.table('raw',rows,getMapping(rows));
 }
 if(state.data.raw!==original)return false;
 // A pending edit to another field, or a changed workbook, may not piggyback on channel edits.
 if(parsed.length!==original.length||!original.every((row,i)=>{
  const previous=Object.keys(row).filter(k=>k!=='returnChannel'),next=Object.keys(parsed[i]).filter(k=>k!=='returnChannel');
  return previous.length===next.length&&previous.every(k=>Object.hasOwn(parsed[i],k)&&row[k]===parsed[i][k]);
 }))return false;
 const raw=original.map((row,i)=>{
  const next=parsed[i];if(Object.hasOwn(next,'returnChannel'))return row.returnChannel===next.returnChannel?row:{...row,returnChannel:next.returnChannel};
  if(!Object.hasOwn(row,'returnChannel'))return row;
  const {returnChannel,...rest}=row;return rest;
 });
 if(!raw.every((row,i)=>row===original[i])){
  const data={...state.data,raw};Engine.validateSession({...state,data});
  state.data=data;source.activeRaw=raw;PhoneOrderUI.rebindCategoryOnly(original);closeReceiptList();closeStoreList();changed();draw();
 }
 return true;
}
async function prepareReferencePhones(parsed){
 const prepared={};
 if(parsed.raw?.phoneRecords?.length)prepared.returns=await PhoneOrderCore.build('returns',parsed.raw.phoneRecords,new Set(parsed.raw.map(r=>r.receipt)));
 if(parsed.phoneOrders?.length)prepared.orders=await PhoneOrderCore.build('orders',parsed.phoneOrders);
 return prepared;
}
async function applyMappedResult(parsed,source,headerOnlyKinds=[]){
 const capture={data:state.data,batch:state.currentBatch};
 const prepared=await prepareReferencePhones(parsed);
 if(state.data!==capture.data||state.currentBatch!==capture.batch)throw Error('작업이 변경되었습니다. 다시 연결하세요.');
 const next={};let count=0;
 for(const k of ['raw','sku','loc'])if(Object.hasOwn(parsed,k)){
  count++;if(parsed[k].length)next[k]=parsed[k];else if(!headerOnlyKinds.includes(k))throw Error(language==='en'?'No usable data rows. Existing data and profiles retained.':'사용할 데이터 행이 없습니다. 기존 데이터와 프로필을 유지합니다.');
 }
 if(parsed.phoneOrders?.length)count++;if(!count)throw Error(language==='en'?'No mapped data.':'연결한 데이터가 없습니다.');
 if(Object.keys(next).length){if(replaceData(next,source)===false)throw Error(language==='en'?'Data not applied. Profiles retained.':'데이터를 적용하지 않았습니다. 기존 프로필을 유지합니다.');}
 else if(!parsed.phoneOrders?.length)notice(language==='en'?'Header mapping configured. Existing data and scans retained.':'헤더 연결만 설정했습니다. 기존 기준 데이터와 검수 기록은 유지합니다.');
 if(Object.keys(prepared).length)PhoneOrderUI.commitPrepared(prepared);
 if(parsed.raw?.phoneRecords)delete parsed.raw.phoneRecords;
 updateDataRows();
}
function mappingBusyUI(value){dataImportBusy=value;for(const id of ['paste','open','apply','dataEditorClose'])$(id).disabled=value;updateDataRows();updateDataApply();}
$('apply').onclick=async()=>{
 if(dataImportBusy||!$('paste').value.trim())return;const kind=$('kind').value;let tx;
 mappingBusyUI(true);
 try{
  tx=await MappingUI.begin(kind,'paste');const sourceText=$('paste').value,rows=Engine.parseDelimited(sourceText),preview=rows.slice(0,100);
  const mapping=await tx.hooks.selectColumns({kind,sheetName:'',rows:preview,rowNumbers:preview.map((_,i)=>i+1)});
  const records=Engine.table(kind,rows,mapping),headerOnly=!rows.slice(mapping.headerRow+1).some(r=>r.some(v=>String(v??'').trim()!==''));
  await applyMappedResult({[kind]:records},language==='en'?'Paste':'붙여넣기',headerOnly?[kind]:[]);tx.commit({text:sourceText,activeRaw:state.data.raw===records?records:null});finishDataImport(kind);
 }catch(e){tx?.abort();dataImportError(e.message,true);}finally{mappingBusyUI(false);}
};
let beamRawProgressAt=-Infinity;
function beamRawStatus(phase,message='',showProgress=true){
 const l=(ko,en)=>language==='en'?en:ko, box=$('beamRawStatus'),p=$('beamRawProgress');
 beamRawProgressAt=-Infinity;box.hidden=false;box.dataset.phase=phase;
 $('beamRawMessage').textContent=message;$('beamRawCount').textContent='';
 p.setAttribute('aria-label',l('통합 RAW 불러오기','Import combined workbook'));
 p.hidden=!showProgress;
 p.removeAttribute('value');
 const announce=$('beamRawAnnounce');if(announce)announce.textContent=phase==='done'?message:'';
 if(phase==='done'){p.hidden=true;box.hidden=true;noticeStrips.show(message);}
}
function beamRawProgress(info){
 const now=performance.now();if($('beamRawStatus').dataset.phase!=='read'||now-beamRawProgressAt<140&&info.phase!=='sheet-complete')return;
 beamRawProgressAt=now;
 $('beamRawCount').textContent=Number(info.rowsProcessed||0).toLocaleString()+(language==='en'?' rows read in current part':'행 읽음 · 현재 시트 기준');
}
let combinedWorkbookRequest=0;
async function runCombinedWorkbook(file,{retry=false}={}){
 if(!file||dataImportBusy)return;
 const l=(ko,en)=>language==='en'?en:ko;
 const request=++combinedWorkbookRequest;
 if(!await MappingUI.waitForProfileImport()){if(request===combinedWorkbookRequest)notice(l('프로필이 적용되지 않았어요. 프로필 확인 후 RAW를 다시 선택해 주세요.','The profile was not applied. Confirm it, then select the workbook again.'),'warning');return;}
 if(request!==combinedWorkbookRequest||dataImportBusy)return;
 const reusable=$('rawImportMode').value!=='append';
 if(retry&&!reusable){notice(l('오더 추가 모드에서는 파일을 다시 선택해 주세요.','In append mode, select the workbook again.'),'warning');return;}
 MappingUI.rememberWorkbook(file,reusable);
 let tx,phase='read',changeProfile=false;
 if(typeof beamResetSelection==='function'&&$('beamFindFold'))beamResetSelection();
 mappingBusyUI(true);
 try{
  const settings=$('dataDialog');
  if(settings.open){
   // Native close events can arrive after the import has returned focus to search.
   skipWorkbookDataDialogFocusRestore=true;
   settings.close();
  }
  beamRawStatus('read',l('통합 RAW 읽는 중…','Reading combined workbook…'));
  beamView(true,false);
  // Give the main screen a paint opportunity before decompression or indexing.
  await new Promise(resolve=>setTimeout(resolve,0));
  tx=await MappingUI.begin(null,'file',{canChangeProfile:reusable,autoProfile:true,onReview:(kind,waiting)=>{
   if(waiting)beamRawStatus('review',kind==='sheet'?l('시트 연결 확인 대기 중','Waiting for worksheet mapping'):l('열 연결 확인 대기 중','Waiting for column mapping'),false);
   else beamRawStatus('read',l('통합 RAW 읽는 중…','Reading combined workbook…'));
  }});
  const parsed=await readWorkbook(file,null,beamRawProgress,tx.hooks);
  phase='apply';
  tx.prepareProfile(file,!!parsed.raw?.length);
  beamRawStatus('apply',l('기준 자료 적용 중…','Applying reference data…'));
  await new Promise(resolve=>setTimeout(resolve,0));
  await applyMappedResult(parsed,file.name,parsed.headerOnlyKinds||[]);
  tx.commit({file,activeRaw:state.data.raw===parsed.raw?parsed.raw:null});
  cartonWorkspace.applyCombined(await prepareCartonReferences(file,MappingUI.cartonProfile().mappings,readSpreadsheet,{Engine,language}));
  const n=parsed.raw?.length||0;
  beamRawStatus('done',n?l('RAW 연결 완료 · 반품 예정 '+n.toLocaleString()+'행','RAW connected · '+n.toLocaleString()+' return rows'):l('선택한 연결 저장 완료 · 기존 반품 예정 자료 유지','Selected mappings saved · existing return data retained'));
 }catch(error){
  tx?.abort();
  changeProfile=error.changeProfile===true;
  if(changeProfile){MappingUI.offerWorkbookRetry();beamRawStatus('done');return;}
  const cancelled=error.name==='AbortError';
  const code=cancelled?'MAP-CANCEL':phase==='apply'?'RAW-APPLY':'RAW-READ';
  beamRawStatus(cancelled?'cancelled':'error','['+code+'] '+error.message,false);
 }finally{
  mappingBusyUI(false);beamRender();
  if(changeProfile){$('dataProfileDetails').open=true;openUtilityDialog('dataDialog','dataLauncher','openWorkbook');return;}
  if(!navigation.isInspection()&&(!document.activeElement||document.activeElement===document.body||document.activeElement===$('dataLauncher')))focusBeamInput('beamQuery');
 }
}
function importReferenceFile(file){
 if(!file||dataImportBusy)return;
 if(/\.json$/iu.test(file.name))return MappingUI.importProfile(file);
 if(/\.xls[xm]$/iu.test(file.name))return runCombinedWorkbook(file);
 notice(language==='en'?'Select a RAW workbook (.xlsx, .xlsm) or a profile (.json).':'RAW 엑셀(.xlsx, .xlsm)이나 프로필(.json)을 선택하세요.','warning');
}
$('workbookFile').onchange=e=>{
 const file=e.target.files[0];e.target.value='';return importReferenceFile(file);
};
$('file').onchange=async e=>{
 const file=e.target.files[0],kind=$('kind').value;if(!file||dataImportBusy||!dataDefinitions[kind])return;let tx;mappingBusyUI(true);
 try{tx=await MappingUI.begin(kind,'file',{autoProfile:kind==='raw'});const parsed=await readWorkbook(file,kind,showImportProgress,tx.hooks);tx.prepareProfile(file,!!parsed.raw?.length);await applyMappedResult(parsed,file.name,parsed.headerOnlyKinds||[]);tx.commit({file,activeRaw:state.data.raw===parsed.raw?parsed.raw:null});finishDataImport(kind,false);}
 catch(error){tx?.abort();dataImportError(error.message);}finally{e.target.value='';mappingBusyUI(false);}
};

MappingUI.init();
PhoneOrderUI.init({getContext:()=>({data:state.data.raw,raw:state.data.raw,batch:state.currentBatch,b2c:isB2C(),receipt:state.receipt,store:JSON.stringify([state.store||'',state.storeSelection||null])}),parseDelimited:Engine.parseDelimited,readWorkbook});
{const button=$('phoneLookupLauncher'),dialog=$('phoneLookupSettings'),open=button.onclick;button.onclick=()=>{closeFileMenu(true);open();};dialog.addEventListener('close',()=>$('fileMenuButton').focus());}


/* Return-tracking lookup: local-only, header-mapped, no numeric coercion. */


function drawOverviewTracking(rows){
 const values=new Map();for(const row of rows){const value=String(row.returnTracking??'').trim();if(!value)continue;const key=trackingKey(value)||value;const known=values.get(key);if(!known||(!known.includes('-')&&value.includes('-')))values.set(key,value);}
 $('overviewTracking').hidden=!state.receipt||!values.size;
 $('overviewTrackingLabel').textContent=language==='en'?'Return tracking':'반송장번호';
 $('overviewTrackingValues').replaceChildren(...[...values.values()].map(value=>{const el=document.createElement('span');el.textContent=value;return el;}));
}
// A paired scanner sentinel is not part of a domestic numeric waybill.
 // Only use the fallback for a whole, plausibly sized number; retain zeros.

function trackingIndex(){
 const core=Engine.getIndex(state.data);
 if(trackingIndexCache?.core===core)return trackingIndexCache;
 const exact=new Map(),normalized=new Map(),wrapped=new Map();
 const add=(map,key,id)=>{if(!key)return;if(!map.has(key))map.set(key,new Set());map.get(key).add(id);};
 for(const r of state.data.raw){
  if(!r.returnTracking)continue;
  const key=trackingKey(r.returnTracking),digits=trackingNumericCore(r.returnTracking);
  add(exact,trackingExactKey(r.returnTracking),r.receipt);add(normalized,key,r.receipt);
  if(digits&&digits!==key)add(wrapped,digits,r.receipt);
 }
 return trackingIndexCache={core,exact,normalized,wrapped};
}
function trackingMatches(query,allow){
 if(!String(query??'').trim())return [];
 const ix=trackingIndex(),key=trackingKey(query);
 const scoped=matches=>[...(matches||[])].filter(allow);
 const exact=scoped(ix.exact.get(trackingExactKey(query)));if(exact.length)return exact;
 const normalized=scoped(ix.normalized.get(key));if(normalized.length)return normalized;
 const digits=trackingNumericCore(query);
 return digits?[...new Set([...scoped(ix.normalized.get(digits)),...scoped(ix.wrapped.get(digits))])]:[];
}
function trackingOrders(query){return trackingMatches(query,workReceiptGate());}

function trackingNotFound(){
 noticeStrips.show(isB2C()
  ?beamL('반송장번호를 찾지 못했어요. 고객명으로 검색해 주세요.','Return tracking number not found. Search by customer name.')
  :beamL('반송장번호를 찾지 못했어요. 매장명으로 검색해 주세요.','Return tracking number not found. Search by store name.'),{tone:'warning',announce:true});
}
$('newWorkTab').onclick=()=>{if(switchWorkTab('',true))notice(language==='en'?'New work sheet opened.':'새 작업 시트를 열었어요.');};
$('workTabs').onclick=e=>{const b=e.target.closest?.('[data-work-tab]');if(b)switchWorkTab(b.dataset.workTab);};
syncSearchMode();

/* Separate search state: nothing viewed or typed here is an inspection event. */
const beam={mode:isB2C()?'b2c':'b2b',query:'',sku:'',picked:'',candidate:'',phase:'search',party:'',nodes:new Map(),motion:null,index:null,lookup:null,composing:false,skuComposing:false};
const beamL=(ko,en)=>language==='en'?en:ko;
const beamCode=x=>String(x??'').normalize('NFKC').trim().toUpperCase();
function beamIndex(){
 const ix=uiIndex();
 if(beam.index?.ix===ix)return beam.index;
 const dateById=new Map();
 // Index names only once per RAW refresh. Search then ranks orders, not line items.
 const names={b2b:new Map(),b2c:new Map()};
 for(const {name,row,receipts} of ix.stores.values()){
  const label=customerLookupKey(name),joined=customerLookupKey([row.seller,row.company,row.address].filter(Boolean).join(' ')).replace(/\s+/gu,'');
  const initials=beamInitialKey(label);
  for(const id of receipts){const vals=names.b2b.get(id)||[];vals.push([label,joined,initials]);names.b2b.set(id,vals);}
 }
 for(const id of ix.modeIds.b2c)names.b2c.set(id,(ix.orderSearch.get(id)?.nameKeys||[]).map(name=>[name,name.replace(/\s+/gu,''),beamInitialKey(name)]));
 for(const [id,rows] of ix.core.rawByReceipt){
  let oldest='';
  for(const row of rows){
   const day=row.date;
   if(typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&(!oldest||day<oldest))oldest=day;
  }
  if(oldest)dateById.set(id,oldest);
 }
 const timeline={},positions={},dated={};
 for(const m of ['b2b','b2c']){
  const source=ix.modeIds[m];dated[m]=source.some(id=>dateById.has(id));
  timeline[m]=dated[m]?source.slice().sort((a,b)=>{
   const x=dateById.get(a),y=dateById.get(b);return x&&y?(x<y?-1:x>y?1:0):x?-1:y?1:0;
  }):source;
  positions[m]=new Map(timeline[m].map((id,i)=>[id,i]));
 }
 return beam.index={ix,names,dateById,timeline,positions,dated};
}
function beamQueryMatches(){
 const bi=beamIndex(),{ix}=bi,mode=beam.mode,q=beam.query.trim(),k=customerLookupKey(q),ids=ix.modeIds[mode],kind=ix.modeSets[mode];
 if(beam.lookup?.bi===bi&&beam.lookup.mode===mode&&beam.lookup.q===q)return beam.lookup;
 let base;
 const initialQuery=q?beamInitialKey(q,true):'';
 if(!q)base=bi.timeline[mode];
 else {
  const track=trackingMatches(q,id=>kind.has(id));
  if(track.length)base=track.sort((a,b)=>bi.positions[mode].get(a)-bi.positions[mode].get(b));
  else if(looksLikeTracking(q))base=[];
  else if(initialQuery)base=bi.timeline[mode].filter(id=>(bi.names[mode].get(id)||[]).some(([, , initials])=>initials.startsWith(initialQuery)));
  else {
   const ranked=[],compact=k.replace(/\s+/gu,''),tokens=k.split(/\s+/u);
   for(const id of bi.timeline[mode]){
    let rank=0;
    for(const [name,joined] of bi.names[mode].get(id)||[]){
     const h=joined;
     rank=Math.max(rank,name===k?4:name.startsWith(k)?3:h.includes(compact)?2:tokens.every(t=>h.includes(t))?1:0);
     if(rank===4)break;
    }
    if(rank)ranked.push([id,rank]);
   }
   base=ranked.sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  }
 }
 return beam.lookup={bi,mode,q,base};
}
function beamFilterClue(ids,q){
 const scope=new Set(ids), tracking=new Set(trackingMatches(q,id=>scope.has(id)));
 const products=new Set(beamFilterSku(ids,q));
 // If a numeric clue is both a product ID and a waybill, keep all matching ASNs.
 return ids.filter(id=>tracking.has(id)||products.has(id));
}
function beamFilterSku(ids,q){
 const info=Engine.masterInfo(state.data,{kind:'barcode',barcode:q});
 const alias=info.found&&!info.conflict?beamCode(info.sku):'';
 return ids.filter(id=>rawRows(id).some(r=>{
  const sku=beamCode(r.sku),barcode=beamCode(r.barcode);
  return sku===q||barcode===q||(!barcode&&alias&&sku===alias);
 }));
}
function beamPartyLabel(id,mode){
 const head=rawRows(id)[0]||{},entry=uiIndex().orderSearch.get(id);
 return mode==='b2c'?entry?.names?.join(' / ')||head.seller||'—':head.seller||head.company||'—';
}
function beamTicketFace(id,mode,compact=false,{long=false,quick=false}={}){
 const raw=rawRows(id),entry=uiIndex().orderSearch.get(id),head=raw[0]||{};
 const party=beamPartyLabel(id,mode),ext=receiptDisplay(id)||'—',value=compact?'':receiptBarcodeValue(id),d=beamIndex().dateById.get(id);
 const amount=esc((entry?.expected??0).toLocaleString()),limit=long?200:compact?3:4;
 const rows=raw.slice(0,limit).map(r=>'<span class="beam-line beam-ticket-item"><span title="'+esc(r.name||r.sku||r.barcode||'—')+'">'+productIdentityMarkup(r.name,r.brand,{fallback:r.sku||r.barcode||'—'})+'</span><i>'+esc(r.qty)+'</i></span>').join('');
 const more=raw.length>limit?'<span class="beam-ticket-more">+ '+(raw.length-limit)+' '+beamL('행','lines')+'</span>':'';
 const tracking=head.returnTracking?'<span class="beam-ticket-ref"><span>'+beamL('반송장번호','Return tracking')+'</span><b title="'+esc(head.returnTracking)+'">'+esc(head.returnTracking)+'</b></span>':'';
 const stock=mode==='b2b'?summarizeExpectedInventoryStatus(raw):null;
 const stockMarkup=stock?'<span class="beam-receipt-stock"><span class="beam-receipt-stock-label">'+beamL('입고 예정 상태','Expected inventory status')+'</span>'+[
  ['sellable',beamL('가용','Sellable'),stock.sellable],
  ['non-sellable',beamL('불용','Non-sellable'),stock.nonSellable],
  ['unreported',beamL('미기재','Unreported'),stock.unreported]
 ].filter(([, , n])=>n>0).map(([type,label,n])=>'<span class="beam-receipt-stock-count" data-stock="'+type+'">'+label+' <b>'+esc(n.toLocaleString())+'</b></span>').join('')+'</span>':'';
 const date=d?'<span class="beam-center-date">'+beamL('전달일','Sent on')+' <time datetime="'+esc(d)+'">'+esc(d)+'</time></span>':'';
 let barcode='';
 if(value){
  const encoded=encodeReceiptCode128(value);let x=10,rects='';
  encoded.runs.forEach((n,i)=>{if(!(i%2))rects+='<rect x="'+x+'" y="13" width="'+n+'" height="62"/>';x+=n;});
  barcode='<span class="beam-ticket-code-scroll"><span class="beam-ticket-code-plate"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+encoded.modules+' 88" width="'+(encoded.modules*2)+'" height="88" role="img" aria-label="'+esc(beamL('내부 주문번호','Internal order ID')+' · Code 128 · '+value)+'" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">'+rects+'</g></svg></span></span>';
 }
 const pda=compact?'':(value?'<span class="beam-ticket-pda"><span class="beam-ticket-pda-caption"><b title="'+esc(value)+'">'+esc(value)+'</b><span>CODE 128</span></span>'+barcode+'</span>':'<small>'+beamL('바코드로 표시할 수 없는 키','Key unavailable for barcode')+'</small>');
 return '<span class="beam-ticket beam-paper-ticket '+(compact?'beam-side':'beam-center-paper')+(quick?' beam-ticket-quick':'')+'">'
 +'<span class="beam-paper-top"><span class="beam-paper-ref"><span>RETURN ORDER</span><b title="'+esc(ext)+'">'+esc(ext)+'</b></span><span class="beam-paper-party"><b title="'+esc(party)+'">'+esc(party)+'</b><b>'+amount+' EA</b></span>'+stockMarkup+(quick?pda:'')+'</span>'
 +'<span class="beam-paper-tear" aria-hidden="true"></span>'
 +'<span class="beam-paper-body">'+(quick?'':pda)+date
 +'<span class="beam-line beam-headline"><span>'+beamL('상품','Items')+'</span><span>'+beamL('수량','Qty')+'</span></span>'+rows+more+tracking+'</span></span>';
}
function beamNode(id){
 const prior=beam.nodes.get(id);if(prior)return prior;
 const entry=uiIndex().orderSearch.get(id),party=beamPartyLabel(id,beam.mode),external=receiptDisplay(id)||id;
 const el=document.createElement('button');el.type='button';el.className='beam-receipt';el.dataset.id=id;
 el.dataset.asnLabel=party+' · '+external+' · '+(entry?.expected??0)+' EA';el.setAttribute('aria-label',el.dataset.asnLabel);el.title=party+' · '+external;
 beam.nodes.set(id,el);return el;
}
function beamPartyKey(id){const k=beam.mode==='b2b'?asnStoreKey(id):'';return k?'store:'+k:'order:'+id;}
function beamGroups(filtered){
 if(beam.groupCache?.filtered===filtered&&beam.groupCache.mode===beam.mode&&beam.groupCache.bi===beam.index)return beam.groupCache;
 const byKey=new Map(),byId=new Map();
 for(const id of filtered){
  const key=beamPartyKey(id);let group=byKey.get(key);
  if(!group){group={key,rep:id,ids:[],at:byKey.size};byKey.set(key,group);}
  group.ids.push(id);byId.set(id,group);
 }
 const groups=[...byKey.values()];
 return beam.groupCache={filtered,mode:beam.mode,bi:beam.index,groups,byKey,byId,reps:groups.map(g=>g.rep)};
}
const beamFolderItemCache=new WeakMap();
function beamFolderItems(raw){
 const cached=beamFolderItemCache.get(raw);if(cached)return cached;
 const keys=new Map(),items=[];let total=0;
 for(const row of raw){
  const key=row.barcode?'B:'+row.barcode:row.sku?'S:'+row.sku:'';
  const qty=Number(row.qty)||0;total+=qty;
  const previous=key&&keys.get(key);
  if(previous){previous.qty+=qty;previous.brand=mergeProductBrands([previous.brand,row.brand]);continue;}
  const item={name:row.name||row.sku||row.barcode||'—',brand:row.brand,code:row.sku||row.barcode||'',qty};
  if(key)keys.set(key,item);items.push(item);
 }
 const summary={items,total};beamFolderItemCache.set(raw,summary);return summary;
}
const beamFolderCount=n=>n.toLocaleString()+beamL('종',' items');
const beamFolderTotal=n=>n.toLocaleString()+' EA';
function beamFolderQuick(group){
 return beam.mode==='b2c'&&!!beam.lookup?.q&&group.rep===beam.browseAnchor;
}
function beamFolderFace(el,group,preview=false){
 const at=beam.folderPeek.get(group.key)||0,id=group.ids[at],label=beamPartyLabel(id,beam.mode);
 const {items,total}=beamFolderItems(rawRows(id)),ext=receiptDisplay(id)||id;
 const position=(at+1)+' / '+group.ids.length,long=beam.openFolderPreview===group.key,quick=beamFolderQuick(group);
 const internal=quick?receiptBarcodeValue(id):'';
 el.dataset.quick=String(quick);el.dataset.folderIndex=String(at);
 el.dataset.peek=String(preview);el.dataset.longPeek=String(long);
 el.innerHTML='<span class="beam-file" aria-hidden="true">'
 +'<span class="beam-file-back"></span>'
 +(group.ids.length>1?'<span class="beam-file-sheet beam-file-sheet-left"></span>':'')
 +(group.ids.length>2?'<span class="beam-file-sheet beam-file-sheet-right"></span>':'')
 +'<span class="beam-file-window"><span class="beam-file-paper">'+beamTicketFace(id,beam.mode,false,{long,quick})+'</span></span>'
 +'<span class="beam-file-glass"><span class="beam-file-position">'+position+'</span><span class="beam-file-arrow">↗</span></span></span>'
 +'<span class="beam-file-caption"><strong title="'+esc(label)+'">'+esc(label)+'</strong><span>'+beamL('주문 ','Orders: ')+group.ids.length.toLocaleString()+beamL('건','')+'</span></span>';
 el.setAttribute('aria-label',label+beamL(' · 주문 ',' · Orders: ')+group.ids.length+(preview||quick?' · '+position+' · '+ext+' · '+beamFolderCount(items.length)+' · '+beamL('합계 ','Total ')+beamFolderTotal(total):'')+(internal?' · '+beamL('내부 주문번호 ','Internal order ID ')+internal:''));
 el.title=label+beamL(' · 주문 ',' · Orders: ')+group.ids.length+(group.ids.length>1?' · '+beamL('휠 또는 Page ↑/↓로 영수증 미리보기','Wheel or Page ↑/↓ to preview receipts'):'');
}
let beamLongReceipt=null;
function beamAppendReceiptItems(){
 if(!beamLongReceipt)return;
 const sheet=beamLongReceipt,part=sheet.items.slice(sheet.next,sheet.next+200);
 $('beamFolderReceiptRows').insertAdjacentHTML('beforeend',part.map(item=>'<tr><td>'+productIdentityMarkup(item.name,item.brand)+(item.code&&item.code!==item.name?'<small>'+esc(item.code)+'</small>':'')+'</td><td>'+esc(item.qty.toLocaleString())+'</td></tr>').join(''));
 sheet.next+=part.length;
 const remaining=sheet.items.length-sheet.next,more=$('beamFolderReceiptMore');
 more.hidden=remaining<=0;
 more.textContent=beamL('다음 '+Math.min(remaining,200).toLocaleString()+'종 보기','Show next '+Math.min(remaining,200).toLocaleString()+' items');
}
function beamDrawFolderReceipt(group,at){
 const id=group.ids[at],sheet=beamFolderItems(rawRows(id));
 beamLongReceipt={group,at,items:sheet.items,next:0};
 const title=receiptDisplay(id)||id;
 $('beamFolderReceiptTitle').textContent=title;
 $('beamFolderReceiptStore').textContent=beamPartyLabel(id,beam.mode);
 $('beamFolderReceiptTotal').textContent=beamL('합계','Total')+' · '+beamFolderCount(sheet.items.length)+' · '+beamFolderTotal(sheet.total);
 $('beamFolderReceiptNav').hidden=group.ids.length<2;
 $('beamFolderReceiptPosition').textContent=(at+1)+' / '+group.ids.length;
 $('beamFolderReceiptPosition').setAttribute('aria-label',title+' · '+(at+1)+' / '+group.ids.length);
 const more=$('beamFolderReceiptMore'),hadMoreFocus=document.activeElement===more;
 $('beamFolderReceiptRows').replaceChildren();beamAppendReceiptItems();
 if(hadMoreFocus&&more.hidden)$('beamFolderReceiptScroll').focus({preventScroll:true});
 $('beamFolderReceiptScroll').scrollTop=0;
}
function beamOpenFolderReceipt(){
 const group=beam.phase!=='asn'&&beam.groups?.byId.get(beam.browseAnchor);
 if(!group||dataImportBusy)return;
 beamDrawFolderReceipt(group,beam.folderPeek.get(group.key)||0);
 openUtilityDialog('beamFolderReceiptDialog','beamFolderReceiptOpen','beamFolderReceiptClose');
}
function beamStepFolderReceipt(step){
 if(!beamLongReceipt||dataImportBusy)return false;
 const {group,at}=beamLongReceipt,count=group.ids.length;
 if(count<2)return false;
 beamDrawFolderReceipt(group,(at+step+count)%count);
 return true;
}
function beamSizeLongFolder(){
 const stage=$('beamStage'),el=beam.nodes.get(beam.browseAnchor);
 const paper=el?.dataset.longPeek==='true'?el.querySelector('.beam-file-paper'):null;
 if(!beam.openFolderPreview||!paper?.getBoundingClientRect||!stage.clientHeight){
  delete stage.dataset.longPeek;beam.folderStageHeight=null;return;
 }
 const base=beam.folderStageHeight??stage.clientHeight;
 beam.folderStageHeight=base;
 stage.style.setProperty('--beam-peek-anchor',Math.round(base*.47)+'px');
 stage.style.setProperty('--beam-peek-height',base+'px');
 stage.dataset.longPeek='true';
 const needed=paper.getBoundingClientRect().bottom-stage.getBoundingClientRect().top+22;
 stage.style.setProperty('--beam-peek-height',Math.ceil(Math.max(base,needed))+'px');
}
function beamPeekFolder(el,step,{wrap=false,reveal=true}={}){
 const group=beam.phase!=='asn'&&beam.groups?.byId.get(el?.dataset.id);
 if(!group||dataImportBusy)return false;
 const from=beam.folderPeek.get(group.key)||0,count=group.ids.length;
 const to=wrap?(from+step+count)%count:Math.max(0,Math.min(count-1,from+step));
 const center=el.dataset.id===beam.browseAnchor,firstPull=reveal&&center&&beam.openFolderPreview!==group.key;
 if(to===from&&!firstPull)return false;
 if(reveal&&center)beam.openFolderPreview=group.key;
 beam.folderPeek.set(group.key,to);beamFolderFace(el,group,true);beamSizeLongFolder();
 if(center)$('beamFolderPage').textContent=(to+1)+' / '+count;
 const paper=el.querySelector('.beam-file-paper');
 if(paper?.animate&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  paper.animate([{translate:'0 '+(step>0?26:-12)+'px',opacity:.4},{translate:'0 0',opacity:1}],{duration:475,easing:'cubic-bezier(.28,.08,.22,1)'});
 }
 return true;
}
function beamResetSelection(){beam.phase='search';beam.party='';beam.picked='';beam.openFolderPreview='';}
function beamFocusCard(){beam.nodes.get(beam.browseAnchor)?.focus({preventScroll:true});}
function beamAdvance(){
 if(dataImportBusy||!beam.candidate)return;
 if(beam.phase==='search'){
  if(!beam.query.trim()&&!beam.picked)return;
  const group=beam.groups.byId.get(beam.candidate);if(!group)return;
  beam.party=group.key;beam.picked=beam.candidate;
  beam.phase=beamPhoneUI()&&group.ids.length===1?'asn':'party';
  const previewAt=group.ids.indexOf(beam.picked);if(previewAt>0&&!beam.folderPeek.has(group.key))beam.folderPeek.set(group.key,previewAt);
 }else if(beam.phase==='party'){
  const group=beam.groups.byKey.get(beam.party);if(!group)return;
  if(beam.folderPeek?.has(group.key))beam.picked=group.ids[beam.folderPeek.get(group.key)];
  beam.phase='asn';
 }else{beamEnter();return;}
 beamRender(beam.phase==='asn'?'open-folder':true);beamFocusCard();
}
function beamBackStep(edit=false){
 if(!edit&&beam.phase==='asn'&&!(beamPhoneUI()&&beam.groups.byKey.get(beam.party)?.ids.length===1)){beam.phase='party';beam.ribbonAxis='x';beamRender(true);beamFocusCard();return;}
 beamResetSelection();beamRender(true);focusBeamInput('beamQuery','beamSearch');
}
function beamStep(direction,axis='x'){
 const ids=beam.browseIds||[],at=ids.indexOf(beam.browseAnchor);
 if(ids.length<2||at<0||dataImportBusy)return;
 const wrap=beam.phase==='asn'&&axis==='x';
 const id=ids[wrap?(at+direction+ids.length)%ids.length:at+direction];
 if(!id)return;
 beam.ribbonAxis=axis;beam.railStepDirection=direction;beamPick(id,'step');beamFocusCard();
}
function beamPlaceOnRibbon(el,slot,slide=0){
 const offset=slot-slide,dist=Math.abs(offset),vertical=beam.ribbonAxis==='y';
 const angle=Math.max(-1.42,Math.min(1.42,offset*.39)),arc=Math.sin(angle)/Math.sin(.39),depth=1-Math.cos(angle);
 el.style.setProperty('--ribbon-x',String(vertical?arc*.13:arc));
 el.style.setProperty('--ribbon-lift',String(vertical?arc:depth*.18));
 el.style.setProperty('--ribbon-z',Math.round(-depth*342)+'px');
 el.style.setProperty('--ribbon-pitch',((vertical?-1:.21)*angle*180/Math.PI)+'deg');
 el.style.setProperty('--ribbon-yaw',((vertical?-.16:-1)*angle*180/Math.PI)+'deg');
 el.style.setProperty('--ribbon-roll',(offset*(vertical?2.4:1.3))+'deg');
 el.style.setProperty('--ribbon-zoom',String(1-Math.min(.22,dist*(vertical?.088:.047))));
 el.style.setProperty('--ribbon-layer',String(9-Math.round(dist)));
}
function beamTurnPaper(phase,axis,direction){
 const el=[...beam.nodes.values()].find(node=>node.dataset.ribbonSlot==='0');
 const paper=el?.firstElementChild;
 if(!paper?.animate)return;
 beam.paperTurns??=new WeakMap();
 const existing=beam.paperTurns.get(paper);
 if(existing?.playState==='running')return;
 const searching=phase==='query',vertical=axis==='y';
 // Let the reel carry the translation. A shallow turn of the new face reads as
 // the same sheet settling, rather than a separate pop or a second full flip.
 const pitch=direction*(vertical?(searching?34:22):searching?16:4);
 const yaw=direction*(vertical?3:searching?32:11);
 const frame=(factor,opacity)=>({
  transform:`perspective(850px) rotateX(${pitch*factor}deg) rotateY(${yaw*factor}deg)`,opacity
 });
 beam.paperTurns.set(paper,paper.animate([
  {...frame(1,.90),offset:0,easing:'cubic-bezier(.25,.12,.22,1)'},
  {...frame(.12,.99),offset:.76,easing:'cubic-bezier(.28,.02,.2,1)'},
  {...frame(0,1),offset:1}
 ],{duration:searching?540:480}));
}
function beamRender(animate=false){
 if(navigation.isInspection())return;
 const q=$('beamQuery'),qLabel=beam.mode==='b2c'?beamL('고객명 또는 반송장번호','Customer name or return tracking number'):beamL('매장명 또는 반송장번호','Store name or return tracking number');
 q.placeholder=qLabel;$('beamQueryLabel').textContent=qLabel;
 for(const b of document.querySelectorAll('[data-beam-mode]'))b.setAttribute('aria-pressed',String(beam.mode===b.dataset.beamMode));
 const lookup=beamQueryMatches(),{base}=lookup;
 const narrowing=!!lookup.q&&base.length>1;
 $('beamNarrow').hidden=!narrowing;
 $('beamSku').placeholder=beamL('SKU / 반송장번호','SKU / return tracking');
 const filtered=narrowing&&beam.sku?(beam.filtered?.lookup===lookup&&beam.filtered?.value===beam.sku?beam.filtered.ids:(beam.filtered={lookup,value:beam.sku,ids:beamFilterClue(base,beam.sku)}).ids):base;
 if(beam.nodeContext!==lookup.bi||beam.nodeMode!==beam.mode||beam.nodeLang!==language){beam.nodes.clear();$('beamStage').replaceChildren();beam.nodeContext=lookup.bi;beam.nodeMode=beam.mode;beam.nodeLang=language;}
 const groups=beam.groups=beamGroups(filtered);
 if(beam.folderGroup!==groups){beam.folderGroup=groups;beam.folderPeek=new Map();}
 let selectedGroup=groups.byKey.get(beam.party);
 if(beam.phase!=='search'&&!selectedGroup){beamResetSelection();selectedGroup=null;}
 const phase=beam.phase,fold=phase!=='search',partyMode=phase==='party',asnMode=phase==='asn';
 const folders=!asnMode;
 const browse=folders?groups.reps:selectedGroup.ids;
 const chosen=selectedGroup&&groups.byId.get(beam.picked)===selectedGroup?beam.picked:selectedGroup?.rep;
 const browseAnchor=partyMode?selectedGroup.rep:asnMode?chosen:(groups.byId.get(beam.picked)?.rep??browse[0]);
 const at=Math.max(0,browse.indexOf(browseAnchor));
 if(!folders||groups.byId.get(browseAnchor)?.key!==beam.openFolderPreview)beam.openFolderPreview='';
 beam.filteredIds=filtered;beam.browseIds=browse;beam.browseAnchor=browseAnchor;beam.candidate=partyMode?chosen||selectedGroup.rep:browse[at]||'';
 const root=$('beamSearch'),find=$('beamFindFold'),edit=$('beamEditSearch'),start=$('beamStart'),stage=$('beamStage'),rail=$('beamRailLabel');
 root.dataset.pickPhase=phase;root.dataset.returnMode=beam.mode;stage.dataset.folders=String(folders);find.inert=fold;find.setAttribute('aria-hidden',String(fold));edit.hidden=!fold;
 edit.querySelector('span').textContent=beamL('다시 검색','Edit search');
 const noun=beam.mode==='b2c'?beamL('고객','customer'):beamL('매장','store');
 const partyLabel=selectedGroup?beamPartyLabel(selectedGroup.rep,beam.mode):'';
 const matched=lookup.q?beamL('검색 결과 ','Matching return orders · ')+filtered.length.toLocaleString()+(language==='en'?'':'건'):beamL('전체 반품 주문 · ','All return orders · ')+filtered.length.toLocaleString();
 $('beamSearchStatus').textContent=partyMode?partyLabel+beamL(' · 주문 ',' · Orders: ')+selectedGroup.ids.length.toLocaleString()+beamL('건',''):asnMode?partyLabel+beamL(' · 주문 ',' · Orders: ')+selectedGroup.ids.length.toLocaleString()+beamL('건','')+' · '+(at+1)+' / '+selectedGroup.ids.length:filtered.length?matched:'';
 $('beamEmpty').hidden=!!filtered.length||(!state.data.raw.length&&dataImportBusy);$('beamConnect').hidden=!!state.data.raw.length||dataImportBusy;
 $('beamEmptyTitle').textContent=!state.data.raw.length?beamL('연결된 기준 자료가 없어요','No reference data loaded'):lookup.q||beam.sku?beamL('일치하는 반품 주문이 없어요','No matching return order'):beamL('이 모드에 반품 주문이 없어요','No return orders in this mode');
 $('beamEmptyText').textContent=!state.data.raw.length?beamL('반품 예정 자료를 불러오면 매장·고객 또는 반송장번호로 검색할 수 있어요.','Load expected returns to search by store, customer, or return tracking number.'):!lookup.q&&!beam.sku?beamL('다른 검색 모드로 전환하거나 기준 자료를 확인해 주세요.','Switch search modes or check the loaded reference data.'):narrowing&&beam.sku?beamL('이 SKU나 반송장번호와 일치하는 오더가 없어요.','No order matches this SKU or return tracking number.'):beamL('다른 '+(beam.mode==='b2c'?'고객명':'매장명')+'이나 반송장번호로 찾아보세요.','Try another name or return tracking number.');
 $('beamStartArea').hidden=!filtered.length;$('beamBrowse').hidden=browse.length<=1;
 const previewGroup=folders?groups.byId.get(browseAnchor):null;
 $('beamFolderActions').hidden=!folders;
 const folderCount=previewGroup?.ids.length||0;
 $('beamFolderActions').dataset.multiple=String(folderCount>1);
 $('beamFolderPage').textContent=folderCount>1?((beam.folderPeek.get(previewGroup.key)||0)+1)+' / '+folderCount:'';
 $('beamFolderPeekPrev').disabled=$('beamFolderPeekNext').disabled=dataImportBusy||folderCount<2;
 $('beamFolderReceiptOpen').hidden=!folders;$('beamFolderReceiptOpen').disabled=dataImportBusy;
 start.disabled=dataImportBusy||!beam.candidate||(!fold&&!lookup.q&&!beam.picked);
 const chooseOrder=partyMode;
 const action=!fold?beamL(noun+' 선택','Choose '+noun):chooseOrder?beamL('파일 열기','Open folder'):beamL('검수 시작','Start inspection');
 start.querySelector('span').textContent=action;
 start.setAttribute('aria-label',fold&&!chooseOrder?beamL('선택한 주문 검수 시작','Inspect selected return order'):action);
 $('beamPrev').setAttribute('aria-label',partyMode?beamL('이전 '+noun,'Previous '+noun):beamL('이전 주문','Previous return order'));
 $('beamNext').setAttribute('aria-label',partyMode?beamL('다음 '+noun,'Next '+noun):beamL('다음 주문','Next return order'));
 $('beamPage').textContent=browse.length?(at+1)+' / '+browse.length:'';
 $('beamPrev').disabled=asnMode?browse.length<2:at<=0;$('beamNext').disabled=asnMode?browse.length<2:at>=browse.length-1;
 const ring=browse,count=ring.length;
 root.dataset.hasReceipts=String(!!count);root.dataset.rail=String(count>1);
 stage.dataset.axis=beam.ribbonAxis||'x';stage.dataset.browsable=String(browse.length>1&&!dataImportBusy);
 stage.setAttribute('aria-label',folders?beamL(noun+' 후보',noun+' results'):beamL('반품 주문 후보','Return order results'));
 rail.hidden=fold||count<2;
 rail.textContent=lookup.bi.dated[beam.mode]?beamL('전달일 빠른 순 · 날짜 없는 주문은 뒤에','Oldest sent date first · undated orders last'):beamL('원본 순서','Source order');
 const active=partyMode?selectedGroup.rep:beam.candidate;
 const anchor=at;
 const shown=new Map();
 const add=(offset)=>{
  if(!count)return;
  const i=anchor+offset;
  const id=ring[asnMode&&count>2?(i+count*2)%count:i];
  if(id&&!shown.has(id))shown.set(id,offset);
 };
 if(active)add(0);
 for(let i=1;i<=4;i++){add(-i);add(i);}
 for(const [id,el] of beam.nodes)if(!shown.has(id)){el.remove();beam.nodes.delete(id);}
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const changedResult=beam.revealedReceipt!==active||beam.hadQuery!==!!lookup.q;
 const travel=anchor-(beam.railAnchor??anchor);
 const moved=beam.railMode===beam.mode&&beam.railPhase===phase&&Number.isInteger(beam.railAnchor)&&beam.railAnchor!==anchor;
 beam.railMode=beam.mode;beam.railPhase=phase;beam.railAnchor=anchor;
 for(const [id,slot] of shown){
  const el=beamNode(id),newNode=!el.isConnected,dist=Math.abs(slot);
  const previousSlot=Number(el.dataset.ribbonSlot);
  const rebase=!newNode&&(Math.abs(previousSlot-slot)>1||(!moved&&changedResult));
  const group=groups.byId.get(id);
  const face=folders?'folder':String(slot===0);
  if(folders){
   el.dataset.folder='true';
   if(el.dataset.face!==face||el.beamFolderGroup!==group||el.dataset.quick!==String(beamFolderQuick(group))||el.dataset.folderIndex!==String(beam.folderPeek.get(group.key)||0)||(el.dataset.longPeek==='true')!==(beam.openFolderPreview===group.key))beamFolderFace(el,group,beam.folderPeek.has(group.key));
   el.beamFolderGroup=group;
  }else{
   delete el.dataset.folder;delete el.dataset.quick;delete el.dataset.folderIndex;delete el.dataset.peek;delete el.dataset.longPeek;el.removeAttribute('title');
   if(el.dataset.face!==face)el.innerHTML=beamTicketFace(id,beam.mode,slot!==0);
   if(slot===0&&animate==='open-folder'&&!reduced){
    el.insertAdjacentHTML('beforeend','<span class="beam-file-opening" aria-hidden="true"></span>');
    el.firstElementChild?.animate?.([
     {transform:'translateY(54px) scale(.94)',clipPath:'inset(0 0 74% 0)',opacity:.5,offset:0},
     {transform:'translateY(11px) scale(.98)',clipPath:'inset(0 0 18% 0)',opacity:1,offset:.65},
     {transform:'translateY(0) scale(1)',clipPath:'inset(0 0 0 0)',opacity:1,offset:1}
    ],{duration:455,easing:'cubic-bezier(.19,.75,.25,1)'});
   }
  }
  el.dataset.face=face;
  if(newNode)stage.append(el);
  el.dataset.center=String(slot===0);el.dataset.distance=String(dist);
  el.setAttribute('aria-pressed',String(id===browseAnchor&&(fold||!!beam.picked)));
  el.tabIndex=slot===0?0:-1;
  if(!folders)el.setAttribute('aria-label',el.dataset.asnLabel);
  el.dataset.ribbonSlot=String(slot);
  if(rebase)el.dataset.rebasing='';
  beamPlaceOnRibbon(el,slot);
  el.style.opacity=String(dist===0?1:.94);
  if(rebase){
   // A reused card that relocated across the ring must not sweep through the active card.
   void el.offsetWidth;
   delete el.dataset.rebasing;
  }
  if((rebase||newNode&&moved)&&animate&&!reduced&&typeof el.animate==='function')el.animate(
   [{opacity:0},{opacity:Number(el.style.opacity)}],{duration:200,easing:'ease-out'});
 }
 const turnDirection=animate==='step'&&beam.railStepDirection?beam.railStepDirection:Math.sign(travel)||1;
 beam.railStepDirection=0;
 if(active&&!reduced&&changedResult&&(animate==='query'||animate==='step'))beamTurnPaper(animate,beam.ribbonAxis||'x',turnDirection);
 beam.revealedReceipt=active;beam.hadQuery=!!lookup.q;beamSizeLongFolder();
}
function beamInput(isSku=false){
 if(isSku){const next=beamCode($('beamSku').value);if(next===beam.sku)return;beam.sku=next;}else{const next=$('beamQuery').value;if(next===beam.query)return;beam.query=next;beam.sku='';$('beamSku').value='';}
 beam.ribbonAxis='x';beamResetSelection();beamRender('query');
}
for(const [field,isSku] of [[$('beamQuery'),false],[$('beamSku'),true]]){
 const key=isSku?'skuComposing':'composing';
 field.oncompositionstart=()=>beam[key]=true;
 field.oncompositionend=()=>{beam[key]=false;beamInput(isSku);};
 field.oninput=()=>beamInput(isSku);
 field.onkeydown=e=>{
  if(e.isComposing||beam[key]||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.key==='Tab'&&!e.shiftKey&&!isSku&&!$('beamNarrow').hidden){e.preventDefault();$('beamSku').focus();return;}
  if((e.key==='ArrowDown'||e.key==='ArrowUp')&&beam.candidate&&beam.query.trim()&&!dataImportBusy){
   e.preventDefault();beamFocusCard();return;
  }
  if(e.key!=='Enter')return;
  e.preventDefault();if(e.repeat)return;
  beamInput(isSku);
  if(!beam.candidate&&!isSku&&looksLikeTracking(beam.query))$('beamSearchStatus').textContent=beam.mode==='b2c'?beamL('반송장번호를 찾지 못했어요. 고객명으로 검색해 주세요.','Tracking number not found. Search by customer name.'):beamL('반송장번호를 찾지 못했어요. 매장명으로 검색해 주세요.','Tracking number not found. Search by store name.');
  else beamAdvance();
 };
}
document.querySelector('.beam-modes').onclick=e=>{
 const m=e.target.closest('[data-beam-mode]')?.dataset.beamMode;
 if(!m||m===beam.mode)return;
 beam.mode=m;beam.sku='';$('beamSku').value='';beamResetSelection();beamRender(true);focusBeamInput('beamQuery');
};
function beamPick(id,animate=true){
 if(!id||!beam.groups?.byId.has(id)||dataImportBusy)return;
 if(beam.phase==='asn'&&!beam.browseIds.includes(id))return;
 beam.picked=id;if(beam.phase==='party')beam.party=beam.groups.byId.get(id).key;beamRender(animate);
}
const beamRibbon=$('beamStage');
window.addEventListener?.('resize',()=>{if(beam.openFolderPreview){delete beamRibbon.dataset.longPeek;beam.folderStageHeight=null;beamSizeLongFolder();}});
let ribbonPointer=null,ribbonClickUntil=0;
function beamDrawRibbonDrag(n){
 for(const el of beam.nodes.values())beamPlaceOnRibbon(el,Number(el.dataset.ribbonSlot),n);
}
beamRibbon.addEventListener('pointerdown',e=>{
 if(!e.isPrimary||e.button!==0||dataImportBusy||!beam.candidate||(!beam.browseIds.length))return;
 ribbonClickUntil=0;
 ribbonPointer={id:e.pointerId,x:e.clientX,y:e.clientY,axis:null,offset:0,reduced:window.matchMedia('(prefers-reduced-motion: reduce)').matches};
});
beamRibbon.addEventListener('pointermove',e=>{
 const g=ribbonPointer;if(!g||e.pointerId!==g.id)return;
 const dx=e.clientX-g.x,dy=e.clientY-g.y;
 if(!g.axis){
  if(Math.max(Math.abs(dx),Math.abs(dy))<9)return;
  g.axis=Math.abs(dy)>Math.abs(dx)?'y':'x';
  if(e.pointerType==='touch'&&g.axis==='y'){ribbonPointer=null;return;}
  beam.ribbonAxis=g.axis;beamRibbon.dataset.axis=g.axis;
  beamRibbon.dataset.dragging='true';beamRibbon.setPointerCapture(e.pointerId);
 }
 g.offset=g.axis==='y'?dy:dx;
 const at=beam.browseIds.indexOf(beam.browseAnchor);
 const wraps=beam.phase==='asn'&&g.axis==='x';
 const bound=!wraps&&((g.offset>0&&at<=0)||(g.offset<0&&at>=beam.browseIds.length-1));
 // Elastic at either end. A drag previews the reel; selection only changes on release.
 if(!g.reduced){
  beamDrawRibbonDrag(-Math.max(-122,Math.min(122,g.offset))/(bound?420:140));
 }
});
function beamEndRibbon(e,commit){
 const g=ribbonPointer;if(!g||e.pointerId!==g.id)return;
 ribbonPointer=null;
 if(!g.axis)return;
 delete beamRibbon.dataset.dragging;
 ribbonClickUntil=performance.now()+400;
 if(commit&&Math.abs(g.offset)>=30){
  const step=g.offset<0?1:-1;
  beamStep(step,g.axis);
 }
 beamDrawRibbonDrag(0);
}
beamRibbon.addEventListener('pointerup',e=>beamEndRibbon(e,true));
beamRibbon.addEventListener('pointercancel',e=>beamEndRibbon(e,false));
beamRibbon.addEventListener('lostpointercapture',e=>beamEndRibbon(e,false));
let folderWheel={id:'',delta:0,at:0};
beamRibbon.addEventListener('wheel',e=>{
 const el=e.target.closest?.('[data-folder=true]');
 if(!el||e.ctrlKey||e.metaKey||Math.abs(e.deltaY)<=Math.abs(e.deltaX)||!e.deltaY)return;
 const group=beam.groups.byId.get(el.dataset.id);if(!group)return;
 const from=beam.folderPeek.get(group.key)||0,step=Math.sign(e.deltaY);
 const atEnd=from+step<0||from+step>=group.ids.length;
 const canPull=el.dataset.id===beam.browseAnchor&&beam.openFolderPreview!==group.key;
 if(atEnd&&!canPull)return;
 e.preventDefault();
 const now=performance.now();
 if(folderWheel.id!==el.dataset.id||now-folderWheel.at>280||Math.sign(folderWheel.delta)!==step)folderWheel={id:el.dataset.id,delta:0,at:now-145};
 folderWheel.delta+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?100:1);
 if(Math.abs(folderWheel.delta)<26||now-folderWheel.at<140)return;
 if(beamPeekFolder(el,step)){folderWheel.at=now;folderWheel.delta=step;}
},{passive:false});
beamRibbon.onclick=e=>{
 if(e.detail&&performance.now()<ribbonClickUntil)return;
 const el=e.target.closest('.beam-receipt');
 if(el?.dataset.folder==='true'&&el.dataset.center==='true'){
  if(beam.phase==='search'&&!beam.query.trim())beam.picked=el.dataset.id;
  beamAdvance();return;
 }
 beamPick(el?.dataset.id);
 if(beam.phase!=='search')beamFocusCard();
};
for(const [id,step] of [['beamFolderPeekPrev',-1],['beamFolderPeekNext',1]]){
 $(id).onclick=()=>beamPeekFolder(beam.nodes.get(beam.browseAnchor),step,{wrap:true,reveal:false});
}
$('beamFolderReceiptOpen').onclick=beamOpenFolderReceipt;
$('beamFolderReceiptMore').onclick=beamAppendReceiptItems;
$('beamFolderReceiptClose').onclick=()=>$('beamFolderReceiptDialog').close();
$('beamFolderReceiptPrev').onclick=()=>beamStepFolderReceipt(-1);
$('beamFolderReceiptNext').onclick=()=>beamStepFolderReceipt(1);
$('beamFolderReceiptDialog').addEventListener('keydown',e=>{
 if(e.defaultPrevented||e.isComposing||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
 const step=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
 if(step&&beamStepFolderReceipt(step))e.preventDefault();
});
$('beamFolderReceiptDialog').onclose=()=>{
 const viewed=beamLongReceipt;
 beamLongReceipt=null;$('beamFolderReceiptRows').replaceChildren();
 if(viewed&&beam.groups?.byKey.get(viewed.group.key)===viewed.group&&(beam.folderPeek.get(viewed.group.key)||0)!==viewed.at){
  beam.folderPeek.set(viewed.group.key,viewed.at);beamRender();
 }
 $('beamFolderReceiptOpen').focus({preventScroll:true});
};
$('beamPrev').onclick=()=>beamStep(-1);
$('beamNext').onclick=()=>beamStep(1);
$('beamEditSearch').onclick=()=>beamBackStep(true);
$('beamSearch').addEventListener('keydown',e=>{
 if((beam.phase==='search'&&!e.target.closest?.('.beam-receipt'))||e.defaultPrevented||e.isComposing||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
 if(e.key==='Escape'){e.preventDefault();if(beam.openFolderPreview){beam.openFolderPreview='';beamRender();beamFocusCard();return;}beamBackStep();return;}
 const folder=beam.phase!=='asn'&&(e.target.closest?.('[data-folder=true]')||beam.nodes.get(beam.browseAnchor));
 if(folder&&['ArrowDown','ArrowUp','PageDown','PageUp'].includes(e.key)){
  e.preventDefault();beamPeekFolder(folder,e.key.endsWith('Down')?1:-1,{wrap:e.key.startsWith('Arrow')});return;
 }
 const direction={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[e.key];
 if(direction){e.preventDefault();beamStep(direction,/Up|Down/.test(e.key)?'y':'x');}
 else if(e.key==='Enter'&&(e.target===$('beamStart')||e.target.closest?.('.beam-receipt'))){
  e.preventDefault();if(e.repeat)return;
  if(beam.phase==='search'&&!beam.query.trim()&&e.target.closest?.('[data-folder=true]'))beam.picked=beam.browseAnchor;
  beamAdvance();
 }
});
function beamView(search,animate=false){
 const wasSearch=!navigation.isInspection(),s=$('beamSearch'),w=$('sheetWorkspace');
 navigation.show(search?'search':'inspection');
 s.classList.remove('beam-returning');w.classList.remove('beam-entering');
 if(search)beamRender();if(!$('beamSidebar').hidden)beamDrawJobs();
 if(animate&&wasSearch!==search&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  const live=search?s:w;void live.offsetWidth;live.classList.add(search?'beam-returning':'beam-entering');
 }
 window.scrollTo(0,0);
 if(search)focusBeamInput('beamQuery','beamSearch');
}
function beamKnownJobs(){return [...(state.workSheets||[]),state].sort((a,b)=>a.workNumber-b.workNumber);}
function beamKnownAsns(work){
 return [...new Set([work.receipt,...(work.orderTabs||[]),...(work.scans||[]).map(e=>e.receipt),...(work.confirmations||[]).map(e=>e.receipt)].filter(id=>id&&rawRows(id).length&&uiIndex().modeSets[work.searchMode==='b2c'?'b2c':'b2b'].has(id)))];
}
function beamNewSearch(reset=false){
 beamResetSelection();
 if(reset){beam.query='';beam.sku='';$('beamQuery').value='';$('beamSku').value='';}
 beamView(true,true);
}
function beamShowHome(focus=true){
 navigation.show('home');
 beamCenterHome(beamHomeAt,focus);
 if(focus)window.scrollTo(0,0);
}
const beamHomeModes=['Inbound','Outbound','Inventory','Returns'];
let beamHomeAt=beamHomeModes.length-1,beamHomeDrag=null,beamHomeIgnoreClick=0;
function beamHomeLayout(index=beamHomeAt){
 const home=$('beamHome');
 if(home.hidden)return;
 const n=beamHomeModes.length,rail=home.querySelector?.('.beam-home-choices');
 const gap=Math.max(15,Math.min(34,(rail?.clientWidth||0)*.026));
 const items=beamHomeModes.map((name,i)=>{
  const d=(i-index+n)%n,delta=d>2?d-n:d;
  const button=$('beamHome'+name),slot=$('beamHomeSlot'+name);
  return {i,delta,slot,button,width:button.offsetWidth||0};
 });
 const [middle,before,after,outer]=[0,-1,1,2].map(d=>items.find(item=>item.delta===d));
 const maxSpan=Math.max(...items.map(({width},i)=>width/2+.82*Math.max(items[(i+1)%n].width,items[(i+n-1)%n].width)));
 const fit=rail?.clientWidth&&maxSpan?Math.max(.1,Math.min(1,(rail.clientWidth/2-gap-8)/maxSpan)):1;
 rail?.style.setProperty('--home-fit',String(fit));
 rail?.style.setProperty('--home-mobile-step',(Math.max(...items.map(({button})=>button.offsetHeight||0))+14)+'px');
 const sideX=item=>fit*(middle.width+.82*item.width)/2+gap;
 const edgeX=item=>sideX(item)+fit*(.82*item.width+.64*outer.width)/2+gap;
 const place=(item,d,x)=>{
  item.slot.dataset.homeSlot=String(d);
  item.slot.style.setProperty('--home-x',x+'px');
  item.slot.style.setProperty('--home-offset',String(d));
  item.slot.style.setProperty('--home-depth',String(Math.abs(d)));
  item.slot.style.setProperty('--home-yaw',(d*-10)+'deg');
 };
 const previous=Number(outer.slot.dataset.homeSlot);
 // The fourth word leaves outwards, not across the other words.
 const exit=previous<0?-1:1;
 const rebased=[];
 for(const [item,side] of [[before,-1],[after,1]]){
  if(Math.abs(Number(item.slot.dataset.homeSlot))!==2)continue;
  item.slot.dataset.rebasing='';
  place(item,side*2,side*edgeX(item));
  rebased.push(item.slot);
 }
 if(rebased.length){
  // Resolve the invisible edge positions before allowing the inward transition.
  void rail?.offsetWidth;
  for(const slot of rebased)delete slot.dataset.rebasing;
 }
 place(outer,exit*2,exit*edgeX(exit<0?before:after));
 place(before,-1,-sideX(before));
 place(middle,0,0);
 place(after,1,sideX(after));
 for(const {i,delta,slot,button} of items){
  slot.dataset.center=String(delta===0);
  slot.inert=delta===2;
  button.setAttribute('aria-current',String(i===index));button.tabIndex=i===index?0:-1;
 }
 if(rail&&!rail.hasAttribute('data-home-ready')){void rail.offsetWidth;rail.dataset.homeReady='';}
}
function beamCenterHome(index,focus=false){
 const n=beamHomeModes.length,next=((index%n)+n)%n;
 const rail=$('beamHome').querySelector?.('.beam-home-choices');
 if(next!==beamHomeAt&&rail?.getAnimations?.({subtree:true}).some(a=>a.transitionProperty==='transform'&&a.playState==='running')){
  // Finish the whole rail together before accepting a new turn. Mixing positions
  // from two turns can put a leaving label in the way of an entering one.
  rail.dataset.settling='';
  void rail.offsetWidth;
  delete rail.dataset.settling;
  void rail.offsetWidth;
 }
 beamHomeAt=next;
 beamHomeLayout();
 if(focus)$('beamHome'+beamHomeModes[beamHomeAt]).focus({preventScroll:true});
}
if(typeof ResizeObserver==='function'){
 const beamHomeResize=new ResizeObserver(()=>beamHomeLayout());
 for(const name of beamHomeModes)beamHomeResize.observe($('beamHome'+name));
 beamHomeResize.observe($('beamHome').querySelector('.beam-home-choices'));
}
$('beamBack').onclick=()=>beamNewSearch();
$('beamHomeBack').onclick=()=>beamShowHome();
for(const [i,name] of beamHomeModes.entries())$('beamHome'+name).onclick=()=>{
 if(beamHomeIgnoreClick&&performance.now()<beamHomeIgnoreClick)return;
 if(name==='Returns'&&i===beamHomeAt){beamView(true);return;}
 if((name==='Outbound'||name==='Inventory')&&i===beamHomeAt){
  navigation.show('carton',name.toLowerCase());window.scrollTo(0,0);return;
 }
 beamCenterHome(i,true);
};
$('beamHome').addEventListener?.('keydown',e=>{
 if(e.defaultPrevented||e.isComposing||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey)return;
 const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[e.key];
 if(step){e.preventDefault();beamCenterHome(beamHomeAt+step,true);}
});
$('beamHome').addEventListener?.('pointerdown',e=>{
 if(e.isPrimary&&e.button===0)beamHomeDrag={id:e.pointerId,x:e.clientX,y:e.clientY};
});
$('beamHome').addEventListener?.('pointercancel',()=>{beamHomeDrag=null;});
$('beamHome').addEventListener?.('pointerup',e=>{
 const from=beamHomeDrag;beamHomeDrag=null;
 if(!from||from.id!==e.pointerId)return;
 const x=e.clientX-from.x,y=e.clientY-from.y;
 const swipe=e.pointerType==='touch'&&matchMedia('(max-width: 720px)').matches&&Math.abs(y)>Math.abs(x)?y:x;
 if(Math.abs(swipe)<32||swipe===x&&Math.abs(x)<Math.abs(y)*1.25)return;
 beamHomeIgnoreClick=performance.now()+400;beamCenterHome(beamHomeAt+(swipe<0?1:-1),true);
});

function beamInspectionEscape(e){
 if(e.key!=='Escape'||!navigation.isInspection()||dataImportBusy||e.defaultPrevented||e.repeat||
    e.isComposing||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||
    document.querySelector('dialog[open]')||e.target?.tagName==='SELECT')return;
 e.preventDefault();e.stopPropagation();
 // Consume the nearest open layer before leaving the work screen.
 if(!$('fileMenuPanel').hidden){closeFileMenu(true);return;}
 if(!$('questPeek').hidden){endQuestPeek();return;}
 if(!$('orderInfoPopover').hidden){closeOrderInfo(true);return;}
 if(!$('discrepancyPopover').classList.contains('hidden')){closeDiscrepancyPreview(true);return;}
 if(!$('receiptList').classList.contains('hidden')){closeReceiptList();return;}
 if(!$('storeList').classList.contains('hidden')){closeStoreList();return;}
 beamNewSearch();
}
document.addEventListener('keydown',beamInspectionEscape,true);
inspectionInput.bindReturns({
 canScan:()=>navigation.isInspection()&&!dataImportBusy&&!!state.receipt&&!$('barcode').disabled&&!$('barcode').value&&$('fileMenuPanel').hidden,
 scan:value=>{
  const field=$('barcode');field.value=value;field.focus({preventScroll:true});
  $('scanform').requestSubmit();
 },
});
$('scanSound').checked=scanAudio.enabled();
$('scanSound').onchange=()=>scanAudio.setEnabled($('scanSound').checked);
$('beamConnect').onclick=()=>$('dataLauncher').click();
function beamEnter(){
 const id=beam.candidate,mode=beam.mode,rows=rawRows(id);
 if($('beamStart').disabled||dataImportBusy||!rows.length||!uiIndex().modeSets[mode].has(id))return;
 const matching=beamKnownJobs().filter(w=>(w.searchMode||'b2b')===mode&&beamKnownAsns(w).includes(id));
 const job=matching.find(w=>w===state)||matching.at(-1);
 const blank=!workHasEntries()&&!state.receipt&&!state.receiptLocked&&!(state.orderTabs||[]).length;
 if(!job&&!blank&&(state.workSheets||[]).length>=49){$('beamSearchStatus').textContent=beamL('작업 50개 한도에 도달했어요. 기존 작업을 열어 주세요.','The 50-work limit was reached. Open an existing work.');return;}
 beamView(false,true);
 if(job){
  if(job!==state&&!switchWorkTab(job.currentBatch)){beamView(true);return;}
  if(state.receipt!==id&&!switchOrderTab(id)){notice(beamL('검수 대상 고정을 먼저 해제해 주세요.','Unlock the current order first.'),'warning');return;}
 }else{
  if(!blank&&!switchWorkTab('',true)){beamView(true);return;}
  if(!setSearchMode(mode)){beamView(true);return;}
  if(mode==='b2b'){
   const r=rows[0],name=r.seller||r.company||'';
   state.store=name;state.storeSelection={name,company:r.company||'',address:r.address||''};
  }
  if(!assignReceipt(id)){beamView(true);return;}
 }
 focusBeamInput('barcode','overviewStatus');
}
$('beamStart').onclick=beamAdvance;
function beamDrawJobs(){
 const jobs=$('beamJobs');
 jobs.replaceChildren(...beamKnownJobs().filter(w=>w.receipt||w.store||w.scans?.length||w.pending?.length||w.audit?.length).map(w=>{
  const group=document.createElement('div');group.className='beam-job';
  const item=document.createElement('button');item.type='button';item.className='beam-job-btn';item.dataset.work=w.currentBatch;
  const title=document.createElement('span');title.className='beam-job-name';title.textContent=workLabel(w);item.title=title.textContent;
  const mode=document.createElement('span');mode.className='beam-job-mode';mode.textContent=w.searchMode==='b2c'?'B2C':'B2B';
  item.append(title,mode);
  if(w===state&&navigation.isInspection())item.setAttribute('aria-current','true');
  group.append(item);
  for(const id of beamKnownAsns(w)){
   const b=document.createElement('button');b.type='button';b.className='beam-job-asn';b.dataset.work=w.currentBatch;b.dataset.asn=id;
   const complete=w.confirmations?.some(c=>c.receipt===id&&c.batch===w.currentBatch);
   b.textContent=receiptDisplay(id)||id;
   if(complete){b.insertAdjacentHTML('beforeend',beamIcon('check'));b.setAttribute('aria-label',b.textContent+' · '+beamL('검수 완료','Inspection complete'));}
   if(w===state&&id===state.receipt&&navigation.isInspection())b.setAttribute('aria-current','true');
   group.append(b);
  }
  return group;
 }));
 if(!jobs.children.length){const p=document.createElement('p');p.textContent=beamL('시작한 작업이 아직 없어요.','No work started yet.');jobs.append(p);}
}
const beamRailKey='beam:work-sidebar:v1';
function beamSetSidebar(open,remember=true){
 const pane=$('beamSidebar'),logo=$('workSidebarToggle');pane.hidden=!open;pane.inert=!open;
 document.body.dataset.beamRailOpen=String(open);logo.setAttribute('aria-expanded',String(open));
 if(open)beamDrawJobs();
 if(remember){try{localStorage.setItem(beamRailKey,open?'open':'closed');}catch{}}
}
try{beamSetSidebar(localStorage.getItem(beamRailKey)==='open',false);}catch{beamSetSidebar(false,false);}
$('workSidebarToggle').onclick=()=>{closeFileMenu();closeOrderInfo();beamSetSidebar($('beamSidebar').hidden);};
$('beamSidebarClose').onclick=()=>{beamSetSidebar(false);$('workSidebarToggle').focus({preventScroll:true});};
$('beamNewWork').onclick=()=>beamNewSearch(true);

$('beamJobs').onclick=e=>{
 const b=e.target.closest('[data-work]');if(!b||dataImportBusy)return;
 beamView(false);
 if(state.currentBatch!==b.dataset.work&&!switchWorkTab(b.dataset.work)){beamView(true);return;}
 if(b.dataset.asn&&b.dataset.asn!==state.receipt&&!switchOrderTab(b.dataset.asn)){notice(beamL('검수 대상 고정을 먼저 해제해 주세요.','Unlock the current order first.'),'warning');return;}
 focusBeamInput('barcode');
};
$('asnShare').onclick=()=>{
 if(!state.receipt)return;
 const d=$('asnShareDialog');d.dataset.scope=JSON.stringify([state.currentBatch,state.receipt]);
 $('asnShareTitle').textContent=beamL('PDF 저장 · ','Save PDF · ')+(receiptDisplay(state.receipt)||state.receipt);d.showModal();$('asnShareClose').focus();
};
$('asnShareClose').onclick=()=>$('asnShareDialog').close();
$('asnShareDialog').onclose=()=>{$('asnShare').focus({preventScroll:true});};
for(const [id,kind] of [['print','comparison'],['evidence','history']]){
 $(id).onclick=()=>{
  const d=$('asnShareDialog');if(d.dataset.scope!==JSON.stringify([state.currentBatch,state.receipt])){d.close();return;}
  d.close();openPrintDocument(kind);
 };
}
$('beamSaveHint').onclick=async()=>{
 const b=$('beamSaveHint');b.disabled=true;try{await $('save').onclick();}finally{b.disabled=false;beamSaveState();if(b.hidden){(!navigation.isInspection()?$('beamQuery'):$('barcode')).focus({preventScroll:true});}}
};
function beamSaveState(){
 const b=$('beamSaveHint'), label=beamL('변경사항 저장','Save changes');b.setAttribute('aria-label',label);b.title=label;
 b.hidden=!dirty||/다운로드 요청됨|download requested/i.test($('saved').textContent);
}
new MutationObserver(beamSaveState).observe($('saved'),{childList:true,subtree:true,characterData:true});
workbenchReady=true;
labelReceiptToggle();
beamRender();beamShowHome(false);beamSaveState();

function openRestoredWork(){
 beam.mode=isB2C()?'b2c':'b2b';
 if(state.receipt){beamView(false);focusBeamInput('barcode');}
 else beamNewSearch(true);
}

function hasBrowserRecoveryWork(){
 return [state,...(state.workSheets||[])].some(w=>w.receipt||['scans','pending','archivedScans','archivedPending','confirmations','confirmationCommitments'].some(key=>w[key]?.length)||w.audit?.some(entry=>entry.events?.length));
}
let passiveRecoveryKind='';
function paintBrowserRecovery({kind,draft}){
 const panel=$('beamRecoveryPanel'),message=$('beamRecoveryStatus'),restore=$('beamRecoverDraft'),keep=$('beamKeepDraft'),saved=$('beamRecoverySaved');
 const time=draft?new Date(draft.savedAt).toLocaleString(language==='en'?'en':'ko'):'';
 const notes={
  'needs-raw':beamL('이 브라우저에 복구본이 있어요. 저장할 때 연결했던 기준 자료를 먼저 불러오세요.','This browser has recovery records. Load the same reference data first.'),
  offer:beamL('복구 가능한 작업 · ','Recoverable work · ')+time,
  other:beamL('현재 기준 자료와 일치하는 복구본이 없어요. 다른 기준 자료의 복구본은 그대로 남아 있어요.','No recovery matches the current reference data. Other recovery records are unchanged.'),
  restored:beamL('이 브라우저의 작업을 복구했어요.','Recovered work from this browser.'),
  invalid:beamL('복구본 형식을 확인할 수 없어요. 이전 복구본은 변경하지 않았어요.','The recovery format could not be verified. The previous recovery is unchanged.'),
  conflict:beamL('다른 창에서 복구본이 바뀌었어요. 이 창에서는 덮어쓰지 않았어요.','Another tab changed this recovery. This tab did not overwrite it.'),
  unavailable:beamL('브라우저 자동 저장을 사용할 수 없어요. 별도로 작업파일을 저장해 주세요.','Browser autosave is unavailable. Save a separate work file.'),
  'restore-error':beamL('이 복구본을 적용할 수 없어요. 현재 작업은 그대로예요.','This recovery could not be applied. Your current work is unchanged.'),
 };
 const text=notes[kind]||'',passive=kind==='needs-raw'||kind==='other';
 panel.hidden=!text||passive||kind==='restored';
 const panelText=passive?'':text;
 if(message.textContent!==panelText)message.textContent=panelText;
 if(passive&&passiveRecoveryKind!==kind)noticeStrips.show(text);
 passiveRecoveryKind=passive?kind:'';

 restore.hidden=!draft;keep.hidden=!draft||!hasBrowserRecoveryWork();
 restore.textContent=beamL('작업 복구','Recover work');
 keep.textContent=beamL('현재 작업으로 대체','Replace with current work');
 const announce=kind==='saved'?beamL('이 브라우저에 검수 기록 자동 저장됨','Inspection records autosaved in this browser.'):kind==='restored'||passive?text:'';
 if(saved.textContent!==announce)saved.textContent=announce;
}
browserRecovery=createBrowserRecovery({
 store:createIndexedRecoveryStore(),
 context:()=>state.data.raw.length?{reference:ReferenceFingerprint.request(),names:state.customerNames}:null,
 reference:WorkDelta.recoveryReference,
 hasWork:hasBrowserRecoveryWork,
 prepare:()=>WorkDelta.prepareSave({compact:true}),
 prepareRestore:WorkDelta.prepareRestore,
 confirmRestore:()=>!hasBrowserRecoveryWork()||uiConfirm(beamL('복구본으로 현재 검수 기록을 바꿀까요? 기준 자료는 유지됩니다.','Replace the current inspection records with this recovery? Reference data is kept.')),
 confirmReplace:()=>uiConfirm(beamL('이 기준 자료의 이전 복구본을 현재 검수 기록으로 바꿀까요?','Replace the previous recovery for this reference data with the current inspection records?')),
 finishRestore:plan=>{
  const next=WorkDelta.finalizeRestore(plan);
  PhoneOrderUI.clear();state=normalizedActiveWork({...next,pending:next.pending||[],store:next.store||'',sources:next.sources||{},audit:next.audit||[]});
  lastBarcode='';dirty=false;draw();setUI('saved','작업 복구 완료',false,false);
  openRestoredWork();
 },
 id:makeId,now:()=>new Date().toISOString(),paint:paintBrowserRecovery,
});
$('beamRecoverDraft').onclick=()=>browserRecovery.recover();
$('beamKeepDraft').onclick=()=>browserRecovery.replace();
document.addEventListener('visibilitychange',()=>{if(document.hidden)void browserRecovery.flush();});
window.addEventListener('pagehide',()=>{void browserRecovery.flush();});
void browserRecovery.flush();

/* Export is a separate trusted HTTPS origin; only a one-use MessagePort
   crosses the boundary. The main app never loads GIS or contacts Drive. */
(()=>{
 const trigger=$('beamDriveExport'),status=$('beamDriveExportStatus'),link=$('beamDriveResult');
 let origin;
 try{
  const value=trigger.dataset.exportOrigin,url=new URL(value);
  if(url.origin!==value||url.protocol!=='https:'||url.origin===location.origin||location.protocol!=='https:')return;
  origin=url.origin;
 }catch{return;}
 trigger.hidden=false;
 const report=(ko,en)=>{status.textContent=beamL(ko,en);status.parentElement.hidden=false;};
 const consent=$('beamDriveConsent'),dismiss=$('beamDriveDismiss'),proceed=$('beamDriveProceed');
 dismiss.onclick=()=>consent.close();
 consent.addEventListener('close',()=>$('fileMenuButton').focus({preventScroll:true}));
 trigger.onclick=()=>{
  closeFileMenu(true);if(trigger.disabled)return;
  if(!state.data.raw.length){report('기준 자료를 먼저 연결하세요.','Connect reference data first.');return;}
  consent.showModal();dismiss.focus({preventScroll:true});
 };
 proceed.onclick=()=>{
  consent.close();if(trigger.disabled||!state.data.raw.length)return;
  link.hidden=true;link.removeAttribute('href');
  if(!globalThis.crypto?.getRandomValues||typeof MessageChannel!=='function'){
   report('이 브라우저에서 분리된 저장 창을 연결할 수 없어요.','This browser cannot connect to the isolated export window.');return;
  }
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const popup=window.open(origin+'/#nonce='+nonce,'beam-drive-'+nonce,'popup,width=540,height=660');
  if(!popup){
   report('저장 창이 차단됐어요. 팝업을 허용하고 다시 시도하세요.','The export window was blocked. Allow popups and try again.');return;
  }
  let port=null,used=false,ended=false,sent=false;
  trigger.disabled=true;
  report('분리된 Google Drive 저장 창을 기다리는 중…','Waiting for the separate Google Drive window…');
  const stop=()=>{
   if(ended)return;ended=true;
   window.removeEventListener('message',accept);
   window.removeEventListener('pagehide',unload);
   clearTimeout(timer);clearInterval(watch);
   port?.close();trigger.disabled=false;
  };
  function unload(){if(!sent)port?.postMessage({type:'beam-drive/cancel',nonce});stop();}
  async function accept(event){
   if(ended||used||event.origin!==origin||event.source!==popup||event.data?.type!=='beam-drive/ready'||event.data.nonce!==nonce)return;
   used=true;window.removeEventListener('message',accept);
   const channel=new MessageChannel();port=channel.port1;
   port.onmessage=e=>{
    const message=e.data;if(ended||message?.nonce!==nonce)return;
    const {type,id}=message;
    if(type==='beam-drive/complete'&&sent&&typeof id==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(id)){
     link.href='https://drive.google.com/open?id='+encodeURIComponent(id);link.hidden=false;
     report('검수 기록을 Google Drive에 저장했어요.','Inspection records saved to Google Drive.');stop();
    }else if(type==='beam-drive/uncertain'){
     report('저장 결과를 확인하지 못했어요. 다시 저장하기 전에 Google Drive를 먼저 확인하세요.','Could not verify the save. Check Google Drive before trying again.');stop();
    }else if(type==='beam-drive/failed'||type==='beam-drive/cancel'){
     report(type==='beam-drive/cancel'?'Google Drive 저장을 취소했어요.':'Google Drive에 저장하지 못했어요. 저장 창을 확인해 주세요.',type==='beam-drive/cancel'?'Google Drive export was cancelled.':'Could not save to Google Drive. Check the export window.');stop();
    }
   };
   port.start();
   try{
    popup.postMessage({type:'beam-drive/handoff',nonce},origin,[channel.port2]);
    const prepared=await WorkDelta.prepareSave({compact:true});
    if(ended)return;
    prepared.assertCurrent();
    const name='Beam-work-'+new Date().toISOString().replace(/\.\d+Z$/,'Z').replaceAll(':','-')+'.json';
    port.postMessage({type:'beam-drive/payload',nonce,name,text:prepared.text});sent=true;
    report('저장 창에서 저장할 Google 계정을 선택하세요.','Choose the Google account in the export window.');
   }catch{
    if(ended)return;
    port.postMessage({type:'beam-drive/cancel',nonce});
    report('이 작업의 검수 기록을 준비하지 못했어요. 기준 자료 연결과 작업 상태를 확인해 주세요.','Could not prepare these records. Check the reference connection and work status.');stop();
   }
  }
  const timeout=()=>{
   if(!sent)port?.postMessage({type:'beam-drive/cancel',nonce});
   report(sent?'저장 창과 연결이 끝났어요. 다시 저장하기 전에 Google Drive를 확인하세요.':'저장 창 연결이 종료됐어요. 다시 시도해 주세요.',sent?'The export window disconnected. Check Google Drive before retrying.':'The export connection closed. Try again.');stop();
  };
  const timer=setTimeout(timeout,8*60_000),watch=setInterval(()=>{if(popup.closed)timeout();},700);
  window.addEventListener('message',accept);
  window.addEventListener('pagehide',unload,{once:true});
 };
})();

/* Microsoft authentication is isolated. No payload before the one-shot named
   destination confirmation message from the exact pinned exporter origin. */
(()=>{
 const prefix='beam-onedrive/',trigger=$('beamOneDriveExport'),status=$('beamOneDriveExportStatus');
 if(!trigger||!status)return;
 let origin;
 try{
  const u=new URL(trigger.dataset.oneDriveOrigin);
  if(u.protocol!=='https:'||u.origin!==trigger.dataset.oneDriveOrigin||u.origin===location.origin||location.protocol!=='https:')return;
  origin=u.origin;
 }catch{return;}
 trigger.hidden=false;
 const report=(ko,en)=>{status.textContent=beamL(ko,en);status.parentElement.hidden=false;};
 trigger.onclick=()=>{
  closeFileMenu(true);if(trigger.disabled)return;
  if(!state.data.raw.length){report('기준 자료를 먼저 연결하세요.','Load reference data first.');return;}
  if(!globalThis.crypto?.getRandomValues||typeof MessageChannel!=='function'){report('분리된 저장 창을 지원하지 않는 브라우저예요.','This browser cannot open the isolated export channel.');return;}
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const initialWork=state.currentBatch, initialData=state.data, initialNumber=state.workNumber;
  const sameWork=()=>state.currentBatch===initialWork&&state.data===initialData&&state.workNumber===initialNumber;
  let port,handed=false,requested=false,sent=false,ended=false,timer,watch;
  function stop(){
   if(ended)return;ended=true;clearTimeout(timer);clearInterval(watch);window.removeEventListener('message',accept);window.removeEventListener('pagehide',unload);port?.close();trigger.disabled=false;
  }
  function unload(){if(!sent)port?.postMessage({type:prefix+'cancel',nonce});stop();}
  function timeout(){
   if(!sent)port?.postMessage({type:prefix+'cancel',nonce});
   if(sent)report('저장 여부를 확인하지 못했어요. 다시 시도하기 전에 OneDrive를 확인하세요.','Could not confirm the save. Check OneDrive before trying again.');
   else report('저장 창 연결이 끝났어요. 검수 기록을 보내지 않았어요.','The export window disconnected. No inspection records were sent.');
   stop();
  }
  function accept(event){
   if(ended||handed||event.source!==popup||event.origin!==origin||event.data?.type!==prefix+'ready'||event.data.nonce!==nonce)return;
   handed=true;window.removeEventListener('message',accept);
   const channel=new MessageChannel();port=channel.port1;
   port.onmessage=async ({data})=>{
    if(ended||data?.nonce!==nonce)return;
    if(data.type===prefix+'request'&&!requested){
     requested=true;
     try{
      if(!sameWork())throw Error('work-changed');
      const prepared=await WorkDelta.prepareSave({compact:true});
      if(ended)return;
      if(!sameWork())throw Error('work-changed');
      prepared.assertCurrent();
      port.postMessage({type:prefix+'payload',nonce,text:prepared.text});sent=true;
      report('검수 기록을 OneDrive 저장 창에 전달했어요. 저장 결과를 기다리는 중…','Working records sent to the OneDrive window. Waiting for the result…');
     }catch{
      if(ended)return;port.postMessage({type:prefix+'cancel',nonce});report('작업이 바뀌었거나 검수 기록을 준비할 수 없어요. 파일을 보내지 않았어요.','The work changed or could not be prepared. No file was sent.');stop();
     }
    }else if(data.type===prefix+'complete'&&sent){
     report('OneDrive에 새 검수 기록을 저장했어요.','Saved a new inspection record file to OneDrive.');stop();
    }else if(data.type===prefix+'uncertain'&&sent)timeout();
    else if(data.type===prefix+'failed'||data.type===prefix+'cancel'){
     report('OneDrive 저장이 끝나지 않았어요. 저장 창과 폴더 권한을 확인해 주세요.','OneDrive did not report a completed save. Check the export window and folder access.');stop();
    }
   };
   port.start();
   try{popup.postMessage({type:prefix+'handoff',nonce},origin,[channel.port2]);}
   catch{timeout();}
  }
  const popup=window.open(origin+'/#nonce='+nonce,'beam-onedrive-'+nonce,'popup,width=500,height=620');
  if(!popup){report('저장 창이 차단됐어요. 팝업을 허용하고 다시 시도하세요.','The export window was blocked. Allow popups and try again.');return;}
  trigger.disabled=true;report('별도 창에서 저장할 Microsoft 계정과 폴더를 확인하세요.','Confirm the Microsoft account and folder in the separate window.');
  timer=setTimeout(timeout,8*60_000);watch=setInterval(()=>{if(popup.closed)timeout();},700);
  window.addEventListener('message',accept);window.addEventListener('pagehide',unload,{once:true});
 };
})();
