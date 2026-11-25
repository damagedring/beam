import { optionalBrandColumn } from '../domain/product-identity.js';
import { XlsxSaxesParser } from "../vendor/xml-parser.js";

export async function readWorkbook(file,wantedKind=null,onProgress=null,hooks=null,{Engine, MappingCore, PhoneOrderCore, returnChannelExact, language='ko', MetadataParser=globalThis.DOMParser}={}){
 if(!hooks||typeof hooks.selectSheets!=='function'||typeof hooks.selectColumns!=='function')throw Error('시트와 열 연결 설정이 필요합니다.');
 const lookupAdapter=hooks.referenceAdapter;
 if(lookupAdapter&&(!Array.isArray(lookupAdapter.kinds)||lookupAdapter.kinds.length!==2||lookupAdapter.kinds[0]!=='phoneReturns'||lookupAdapter.kinds[1]!=='phoneOrders'||lookupAdapter.phoneField!=='phone'||JSON.stringify(lookupAdapter.identifierFields)!==JSON.stringify(['id','sku','barcode'])||typeof lookupAdapter.validateColumns!=='function'||typeof lookupAdapter.table!=='function'))throw Error('조회 전용 변환 설정이 올바르지 않습니다.');
 const carton=hooks.cartonAdapter;
 if(carton&&(lookupAdapter||wantedKind!=="cartonLines"||typeof carton.validateColumns!=="function"||typeof carton.table!=="function"))throw Error("Invalid carton workbook adapter.");
 const workbookKinds=carton?["cartonLines"]:lookupAdapter?lookupAdapter.kinds:['raw','sku','loc','phoneOrders'];
 const workbookValidate=carton?carton.validateColumns:lookupAdapter?lookupAdapter.validateColumns:MappingCore.validateColumns;
 const workbookTable=carton?carton.table:lookupAdapter?lookupAdapter.table:Engine.table;

 if(file.size>30*1024*1024)throw Error('파일은 30MB 이하로 나누어 주세요.');
 const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);let e=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65558);p--)if(view.getUint32(p,true)===0x06054b50){e=p;break;}
 if(e<0)throw Error('유효한 XLSX/XLSM 파일이 아닙니다.');
 const count=view.getUint16(e+10,true),offset=view.getUint32(e+16,true);if(count>10000)throw Error('파일 내부 항목이 너무 많습니다.');let pos=offset,total=0;const entries=new Map(),dec=new TextDecoder();
 for(let i=0;i<count;i++){if(view.getUint32(pos,true)!==0x02014b50)throw Error('압축파일 구조가 올바르지 않습니다.');const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),size=view.getUint32(pos+20,true),out=view.getUint32(pos+24,true),nl=view.getUint16(pos+28,true),el=view.getUint16(pos+30,true),cl=view.getUint16(pos+32,true),off=view.getUint32(pos+42,true);const name=dec.decode(bytes.slice(pos+46,pos+46+nl));entries.set(name,{flags,method,size,out,off});pos+=46+nl+el+cl;}
 async function* xmlChunks(name){const x=entries.get(name);if(!x)return;if(x.flags&1)throw Error('암호화된 파일은 읽을 수 없습니다.');if(x.out>192e6||(total+=x.out)>384e6)throw Error('압축 해제 데이터가 너무 큽니다.');if(view.getUint32(x.off,true)!==0x04034b50)throw Error('파일 데이터가 손상되었습니다.');const p=x.off+30+view.getUint16(x.off+26,true)+view.getUint16(x.off+28,true);if(p+x.size>bytes.length)throw Error('파일 데이터가 손상되었습니다.');let stream=new Blob([bytes.subarray(p,p+x.size)]).stream();if(x.method===8){if(typeof DecompressionStream==='undefined')throw Error('브라우저가 파일 압축 해제를 지원하지 않습니다. 복사·붙여넣기를 이용해 주세요.');let inflater;try{inflater=new DecompressionStream('deflate-raw');}catch{throw Error('이 브라우저는 XLSX 압축 해제를 지원하지 않습니다. 최신 Edge/Chrome 또는 복사·붙여넣기를 이용해 주세요.');}stream=stream.pipeThrough(inflater);}else if(x.method!==0)throw Error('지원하지 않는 압축 방식입니다.');const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let actual=0,done=false;try{for(;;){const chunk=await reader.read();if(chunk.done){done=true;break;}actual+=chunk.value.length;if(actual>x.out||actual>192e6)throw Error('압축 해제 데이터가 너무 큽니다.');yield decoder.decode(chunk.value,{stream:true});}if(actual!==x.out)throw Error('압축 해제 크기가 일치하지 않습니다.');const tail=decoder.decode();if(tail)yield tail;}finally{if(!done)await reader.cancel();reader.releaseLock();}}
 async function xmlText(name){if(!entries.has(name))return null;if(entries.get(name).out>8e6)throw Error('XML 메타데이터가 너무 큽니다.');let text='';for await(const part of xmlChunks(name))text+=part;return text;}
 const sheetNamespaces=new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main']);
 const relNamespaces=new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships']);
 const packageRelNs='http://schemas.openxmlformats.org/package/2006/relationships';
 const nodes=(doc,name,namespaces=sheetNamespaces)=>doc?[...doc.getElementsByTagNameNS('*',name)].filter(n=>namespaces.has(n.namespaceURI)):[];
 function xmlError(kind,part,location=''){return Error(language==='en'?'Could not read workbook XML ('+part+'). '+kind+(location?' '+location:''):'시트 XML을 읽지 못했습니다 ('+part+'). '+kind+(location?' '+location:''));}
 async function xml(name){const text=await xmlText(name);if(text===null)return null;
  const doc=new MetadataParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagNameNS('*','parsererror').length||doc.doctype)throw xmlError(language==='en'?'Invalid metadata XML.':'통합문서 정보 XML 형식이 올바르지 않습니다.',name);
  return doc;
 }
 // SAXES validates XML; retain only flat cell values, never a generic XML node tree.
 async function visitXml(path,recordTag,visit,sheetName,afterChunk=null){
  let depth=0,captureDepth=0,record=null,seen=0,rootSeen=false,sinceRecord=0;
  const cells=[],texts=[];
  const parser=new XlsxSaxesParser({xmlns:true,position:true,defaultXMLVersion:'1.0',forceXMLVersion:true});
  const part=sheetName?sheetName+' · '+path:path;
  const badXml=()=>xmlError(language==='en'?'Invalid worksheet XML.':'시트 데이터 XML 형식이 올바르지 않습니다.',part,'XML '+parser.line+':'+parser.column);
  parser.on('error',()=>{throw badXml();});
  parser.on('doctype',()=>{throw Error('지원하지 않는 XML 선언입니다.');});
  parser.on('xmldecl',d=>{if(d.version!=='1.0'||d.encoding&&!/^utf-8$/i.test(d.encoding))throw Error('지원하지 않는 XML 선언입니다.');});
  parser.on('opentag',tag=>{
   const own=sheetNamespaces.has(tag.uri),name=tag.local;
   if(!depth){if(rootSeen||!own||name!==(recordTag==='row'?'worksheet':'sst'))throw badXml();rootSeen=true;}
   if(depth>=128)throw Error('XML 구조가 너무 깊습니다.');
   depth++;
   if(!own)return;
   if(!record&&name===recordTag){record=[];record.rowNumber=+(tag.attributes.r?.value||0);captureDepth=depth;return;}
   if(!record)return;
   if(recordTag==='row'&&name==='c'){
    const a=tag.attributes,c={r:a.r?.value||'',type:a.t?.value||null,s:a.s?.value||'',v:null,ts:null,formula:false,depth};record.push(c);cells.push(c);
   }else if(recordTag==='row'&&name==='f'){
    for(let i=0;i<cells.length;i++)cells[i].formula=true;
   }else if(name==='t'||name==='v'){
    let buffer=null;
    if(recordTag==='si'&&name==='t'){buffer={value:'',depth};record.push(buffer);}
    else if(recordTag==='row')for(let i=0;i<cells.length;i++){
     const c=cells[i];
     if(name==='v'&&c.v===null){if(!buffer)buffer={value:'',depth};c.v=buffer;}
     else if(name==='t'&&c.type==='inlineStr'){if(!buffer)buffer={value:'',depth};(c.ts||(c.ts=[])).push(buffer);}
    }
    if(buffer)texts.push(buffer);
   }
  });
  const text=value=>{for(let i=0;i<texts.length;i++)texts[i].value+=value;};parser.on('text',text);parser.on('cdata',text);
  parser.on('closetag',()=>{
   while(texts.length&&texts[texts.length-1].depth===depth)texts.pop();
   if(cells.length&&cells[cells.length-1].depth===depth)cells.pop();
   if(record&&depth===captureDepth){visit(record);record=null;seen++;sinceRecord=0;}
   depth--;
  });
  let lastYield=0;for await(const part of xmlChunks(path)){sinceRecord+=part.length;if(sinceRecord>8e6)throw Error('XML 레코드가 너무 큽니다.');for(let offset=0;offset<part.length;offset+=16384){parser.write(part.slice(offset,offset+16384));if(afterChunk)await afterChunk(false);}if(seen-lastYield>=256){lastYield=seen;if(typeof onProgress==='function')onProgress({phase:recordTag==='row'?'sheet':'sharedStrings',sheet:sheetName||'',rowsProcessed:seen});await new Promise(r=>setTimeout(r,0));}}
  parser.close();if(afterChunk)await afterChunk(true);if(!rootSeen||depth)throw badXml();if(typeof onProgress==='function')onProgress({phase:recordTag==='row'?'sheet':'sharedStrings',sheet:sheetName||'',rowsProcessed:seen});
 }
 const wb=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');if(!wb||!rels)throw Error('Excel 통합문서를 찾지 못했습니다.');const relationship=new Map(nodes(rels,'Relationship',new Set([packageRelNs])).filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));const strings=[];if(entries.has('xl/sharedStrings.xml'))await visitXml('xl/sharedStrings.xml','si',s=>strings.push(s.map(t=>t.value).join('')));const result={};
 const styleDoc=await xml('xl/styles.xml'),formats=new Map([[0,'General'],[1,'0'],[2,'0.00'],[3,'#,##0'],[4,'#,##0.00'],[11,'0.00E+00'],[48,'##0.0E+0'],[49,'@']]);
 if(styleDoc)for(const f of nodes(styleDoc,'numFmt'))formats.set(+f.getAttribute('numFmtId'),f.getAttribute('formatCode'));
 const cellStyles=nodes(styleDoc,'cellXfs')[0];const numberFormats=cellStyles?nodes(cellStyles,'xf').map(x=>formats.get(+x.getAttribute('numFmtId'))||'unsupported'):['General'];
 const date1904=/^(1|true)$/i.test(nodes(wb,'workbookPr')[0]?.getAttribute('date1904')||'');
 const sheets=nodes(wb,'sheet'),headerOnlyKinds=[];
 const selection=await hooks.selectSheets({sheets:sheets.map((s,index)=>({index,name:s.getAttribute('name')||''})),wantedKind});
 if(!Array.isArray(selection)||!selection.length)throw Error('가져올 시트를 선택하세요.');
 const kinds=new Set(),sheetIds=new Set();for(const item of selection){if(!item||!workbookKinds.includes(item.kind)||wantedKind&&item.kind!==wantedKind||!Number.isInteger(item.sheetIndex)||item.sheetIndex<0||item.sheetIndex>=sheets.length||kinds.has(item.kind)||sheetIds.has(item.sheetIndex))throw Error('시트 역할이 중복되거나 올바르지 않습니다.');kinds.add(item.kind);sheetIds.add(item.sheetIndex);}
 for(const choice of selection){const kind=choice.kind,sheet=sheets[choice.sheetIndex],name=sheet.getAttribute('name')||'';
 const id=[...relNamespaces].map(ns=>sheet.getAttributeNS(ns,'id')).find(Boolean),target=relationship.get(id);if(!target)throw Error('선택한 시트 연결 정보가 없거나 손상되었습니다.');const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');if(path.includes('..'))throw Error('지원하지 않는 파일 경로입니다.');if(!entries.has(path))throw Error('선택한 시트 데이터가 파일에 없습니다.');
 const inspection=typeof hooks.inspectColumn==='function',inspectionCodes=new Set(),inspectionDone={};let inspectSummary=null;
 const rows=[],rowIds=[],records=[],preview=[],summary={missingIdentifier:0,missingLocation:0,skuOnly:0};let mapping=null,headerRow=null,processed=0,totalQty=0,dataRows=0;const rawTotals=new Map(),customerNames=new Map(),phoneRecords=[];
 function flushRows(){if(!rows.length)return;let converted;try{converted=workbookTable(kind,[headerRow,...rows],{...mapping,headerRow:0});}catch(error){error.message=error.message.replace(/^(\d+)행:/,(_,n)=>(rowIds[Number(n)-2]??rowIds[0])+'행:');throw error;}if(kind==='raw')phoneRecords.push(...(converted.phoneRecords||[]));if(kind==='raw')for(const[receipt,names]of Object.entries(converted.customerNames||{})){let seen=customerNames.get(receipt);if(!seen)customerNames.set(receipt,seen=new Set());for(const name of names)seen.add(name);}if(kind==='loc')for(const[key,value]of Object.entries(converted.importSummary||{}))summary[key]=(summary[key]||0)+value;for(const r of converted){if(r.unresolvedId?.startsWith('row-'))r.unresolvedId='row-'+rowIds[Number(r.unresolvedId.slice(4))-2];if(kind==='raw'){totalQty+=r.qty;const key=JSON.stringify([r.receipt,Engine.key(r)]),n=(rawTotals.get(key)||0)+r.qty;if(!Number.isSafeInteger(totalQty))throw Error('총 예정 수량이 너무 큽니다.');if(!Number.isSafeInteger(n))throw Error('합산 예정 수량이 너무 큽니다.');rawTotals.set(key,n);}records.push(r);}rows.length=0;rowIds.length=0;}
 function unpack(cells){const values=[];let nextCol=0;for(const c of cells){const letters=c.r.match(/^[A-Z]+/)?.[0];let col=nextCol;if(letters){col=0;for(const l of letters)col=col*26+l.charCodeAt(0)-64;col--;}if(col>16383)throw Error('Excel 열 범위를 벗어났습니다.');nextCol=col+1;c.col=col;if(mapping&&!columnRoles.has(col))continue;const v=c.v?.value||'';if(c.type==='s'&&(!/^\d+$/.test(v)||!Number.isSafeInteger(+v)||+v>=strings.length))throw Error('공유 문자열 참조가 올바르지 않습니다.');values[col]=c.value=c.type==='s'?(strings[+v]||''):c.type==='inlineStr'?(c.ts||[]).map(t=>t.value).join(''):v;}return values;}
 function consume(item){
  if(item.index<=mapping.headerRow)return;
  if(inspection){
   const c=item.cells.find(cell=>columnRoles.has(cell.col));
   if(!c||c.type==='e'||c.formula)return;
   const code=returnChannelExact(c.type==='b'?(c.value==='1'?'TRUE':'FALSE'):c.value);
   if(code)inspectionCodes.add(code);
   return;
  }
  const values=[];let hasMapped=false;
  for(const c of item.cells){
   const field=columnRoles.get(c.col);if(!field)continue;
   try{
    if(c.formula)throw Error('수식이 있습니다. 계산 결과를 값으로 저장한 뒤 연결해 주세요.');
    if(c.type==='e')throw Error('Excel 오류 값입니다. 해당 셀을 확인해 주세요.');
    const v=c.value;if(!String(v??'').trim())continue;
    const numeric=!c.type||c.type==='n',fmt=numberFormats[+(c.s||0)]||'General';
    if(c.type==='b'&&(field==='qty'||field==='date'||phoneFields.has(field)||codeFields.has(field)))throw Error('참/거짓 값은 이 열에서 사용할 수 없습니다.');
    if(c.type==='d'&&field!=='date'&&(field==='qty'||phoneFields.has(field)||codeFields.has(field)))throw Error('원본이 날짜 값으로 저장되어 숫자나 식별자를 복원할 수 없습니다. 원래 값을 텍스트로 연결해 주세요.');
    if(field==='qty')values[c.col]=String(Engine.quantityValue(v,numeric));
    else if(field==='date'){try{values[c.col]=numeric?Engine.excelDateValue(v,date1904):Engine.orderDateText(v);}catch(error){if(kind!=='raw')throw error;values[c.col]='';}}
    else if(phoneFields.has(field))values[c.col]=numeric?PhoneOrderCore.excelPhone(v,fmt):v;
    else if(codeFields.has(field))values[c.col]=Engine.identifierValue(v,numeric,fmt);
    else values[c.col]=c.type==='b'?(v==='1'?'TRUE':'FALSE'):v;
    hasMapped=true;
   }catch(error){throw Error(item.number+'행 '+columnLetter(c.col)+'열: '+error.message);}
  }
  if(!hasMapped)return;
  dataRows++;if(kind==="cartonLines"&&dataRows>200000)throw Error("Maximum 200,000 inspection lines.");rows.push(values);rowIds.push(item.number);if(rows.length>=256)flushRows();
 }
 const columnRoles=new Map(),phoneFields=new Set(['customerPhone','phone']),codeFields=new Set(['receipt','external','returnTracking','sku','barcode','id','loc','zone','putawayZone','warehouse']);
 function columnLetter(n){let label='';for(n++;n;n=Math.floor((n-1)/26))label=String.fromCharCode(65+(n-1)%26)+label;return label;}
 async function resolvePreview(final){if(mapping||!final&&preview.length<100)return;const shown=preview.slice(0,100);if(!shown.length)throw Error('시트에 제목 행이 없습니다.');const selected=await hooks.selectColumns({kind,sheetName:name,rows:shown.map(x=>x.values.slice()),rowNumbers:shown.map(x=>x.number)});if(!selected||!Number.isInteger(selected.headerRow)||selected.headerRow<0||selected.headerRow>=shown.length)throw Error('제목 행을 선택하세요.');headerRow=shown[selected.headerRow].values.slice();if(inspection){inspectSummary={header:headerRow,codes:inspectionCodes};const col=hooks.inspectColumn({header:headerRow,headerRow:selected.headerRow});if(col===null)throw inspectionDone;if(!Number.isInteger(col)||col<0||col>=headerRow.length)throw Error('구분 열을 다시 선택하세요.');mapping={headerRow:selected.headerRow};columnRoles.set(col,'returnChannel');for(const item of preview)consume(item);preview.length=0;return;}mapping={headerRow:selected.headerRow,columns:workbookValidate(kind,headerRow,selected.columns),returnChannelValues:selected.returnChannelValues};if(kind==='raw'||kind==='sku'){const brand=optionalBrandColumn(headerRow,mapping.columns);if(brand!==undefined)mapping.columns.brand=brand;}workbookTable(kind,[headerRow],{...mapping,headerRow:0});for(const [field,col] of Object.entries(mapping.columns))columnRoles.set(col,field);for(const item of preview)consume(item);preview.length=0;}
 try{await visitXml(path,'row',cells=>{const index=processed++,number=Number.isSafeInteger(cells.rowNumber)&&cells.rowNumber>0?cells.rowNumber:index+1,item={index,number,cells,values:unpack(cells)};if(mapping)consume(item);else preview.push(item);},name,resolvePreview);}catch(error){if(error!==inspectionDone)throw error;}
 if(inspection)return {header:inspectSummary.header,codes:[...inspectionCodes]};
 flushRows();
 if(!dataRows)headerOnlyKinds.push(kind);if(kind==='raw'){Object.defineProperty(records,'phoneRecords',{value:phoneRecords,enumerable:false,configurable:true});const names=Object.create(null);for(const[receipt,set]of customerNames)names[receipt]=[...set];Object.defineProperty(records,'customerNames',{value:names,enumerable:false,configurable:true});}if(kind==='loc')Object.defineProperty(records,'importSummary',{value:summary,enumerable:false});result[kind]=records;if(typeof onProgress==='function')onProgress({phase:'sheet-complete',sheet:name,rowsProcessed:processed,records:records.length});
 }
 Object.defineProperty(result,'headerOnlyKinds',{value:headerOnlyKinds,enumerable:false});
 Object.defineProperty(result,'workbookSummary',{value:{ignored:sheets.filter((_,i)=>!sheetIds.has(i)).map(x=>x.getAttribute('name'))},enumerable:false});return result;
}


