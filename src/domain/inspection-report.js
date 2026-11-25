import { productIdentityMarkup } from './product-identity.js';
import { encodeReceiptCode128 } from './code128.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isBlank=value=>value==null||value==='';
const show=value=>isBlank(value)?'—':value;
const signed=count=>count>0?'+'+count:String(count);
const englishStatus=new Map([
 ['일치','Matched'],['부족','Short'],['초과','Excess'],['예정 외','Unexpected'],['정보 충돌','Data conflict'],['식별자 없음','Missing identifier'],
 ['matched','Matched'],['short','Short'],['excess','Excess'],['unexpected','Unexpected'],['conflict','Data conflict'],['unidentified','Missing identifier'],
]);

function orderBarcode(orderId,label='Order No.'){
 if(typeof orderId!=='string'||!/^[\x20-\x7e]{1,80}$/.test(orderId)||!orderId.trim()){
  return {paper:'portrait',markup:'<section class="pr-pda pr-pda-missing"><b>'+label+'</b><strong class="pr-pda-value">'+escape(show(orderId))+'</strong><small>'+'Barcode unavailable'+'</small></section>'};
 }
 const {runs,modules}=encodeReceiptCode128(orderId);
 // Preserve quiet space and switch paper orientation for longer IDs.
 const landscape=modules*.30>168,paper=landscape?'landscape':'portrait';
 const width=Math.max(112,modules*(landscape?.26:.30)).toFixed(2);
 let x=10,bars='';
 for(const [i,n] of runs.entries()){
  if(i%2===0)bars+='<rect x="'+x+'" y="0" width="'+n+'" height="26"/>';
  x+=n;
 }
 return {paper,markup:'<section class="pr-pda" data-pda-paper="'+paper+'"><b>'+label+'</b>'+
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+modules+' 26" width="'+width+'mm" height="26mm" preserveAspectRatio="none" role="img" aria-label="'+escape('Code 128 · '+orderId)+'"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">'+bars+'</g></svg>'+
  '<strong class="pr-pda-value">'+escape(orderId)+'</strong></section>'};
}

// The label is shared by comparison and history so the selected order never
// gets replaced by an external reference or lost when printing scan history.
export function renderInspectionHeader({mode,orderId,externalId='',party='',work='',history=false}){
 if(!['return','outbound'].includes(mode))throw TypeError('Unsupported inspection workflow');
 const title=(mode==='return'?'Return':'Outbound')+(history?' Inspection Scan History':' Inspection Report');
 const barcode=orderBarcode(orderId,history?'Selected Order No.':'Order No.');
 const markup='<div class="pr-label"><div class="pr-label-top">'+
  '<div class="pr-label-mark" aria-hidden="true">B</div><div class="pr-label-head">'+
  '<p class="pr-brand"><b>BEAM</b>'+(externalId&&externalId!==orderId?
   '<span>External Order No. '+escape(externalId)+'</span>':'')+'</p>'+
  '<h1>'+escape(title)+'</h1>'+
  (party?'<p class="pr-label-party">'+escape(party)+'</p>':'')+
  (work?'<p class="pr-label-work">'+escape(work)+'</p>':'')+'</div></div>'+
  barcode.markup+'</div>';
 return {markup,paper:barcode.paper,title};
}

export function renderInspectionReport({rows=[],...context}){
 const header=renderInspectionHeader(context);
 const columns=['Status','Barcode / SKU','Product','Expected','Checked','Difference'];
 const widths=[16,25,35,8,8,8];
 const cells=(tag,values,product=null)=>values.map((v,i)=>'<'+tag+(tag==='th'?' scope="col"':'')+
  (i>=columns.length-3?' class="pr-number"':'')+'>'+(i===2&&product?productIdentityMarkup(product.name,product.status==='conflict'||product.status==='정보 충돌'?null:product.brand):escape(v))+'</'+tag+'>').join('');
 let expected=0,actual=0;
 const body=rows.map(r=>{
  expected+=r.expected;actual+=r.actual;
  return '<tr>'+cells('td',[(englishStatus.get(r.status)||'Review')+(r.held?' · Held':''),[r.barcode,r.sku].filter(Boolean).join(' / '),r.name,
   r.expected,r.actual,signed(r.actual-r.expected)],r)+'</tr>';
 }).join('');
 const totals=['Total','','',expected,actual,signed(actual-expected)];
 const markup='<article class="pr-inspection">'+header.markup+'<section class="pr-section"><table aria-label="Inspection results">'+
  '<colgroup>'+widths.map(w=>'<col style="width:'+w+'%">').join('')+'</colgroup>'+
  '<thead><tr>'+cells('th',columns)+'</tr></thead><tbody>'+
  (body||'<tr><td colspan="'+columns.length+'" class="pr-empty">'+'No inspection items'+'</td></tr>')+
  '</tbody><tfoot><tr>'+cells('td',totals)+'</tr></tfoot></table></section></article>';
 return {...header,markup};
}


// Order-level paperwork is deliberately independent from a carton inspection.
export function renderOutboundDispatch({orderId,externalId='',stores=[],countries=[],cartons=[],fields}){
 const title='Outbound Shipment Summary';
 const enabled=key=>!fields||fields.includes(key);
 const barcode=enabled('internalId')?orderBarcode(orderId,'Internal Order No.'):{paper:'portrait',markup:''};
 const destination=values=>values.length?values.map(escape).join(' · '):'Not provided';
 const values=[['externalId','External Order No.',escape(show(externalId))],['totalCartons','Total Cartons',cartons.length],
  ['store','Destination Store',destination(stores)],['country','Destination Country',destination(countries)]].filter(([key])=>enabled(key));
 const markup='<article class="pr-inspection pr-dispatch"><div class="pr-label"><div class="pr-label-head">'+
  '<p class="pr-brand"><b>BEAM</b></p><h1>'+title+'</h1></div>'+barcode.markup+'</div>'+
  (values.length?'<section class="pr-section"><dl class="pr-dispatch-fields">'+values.map(([,name,value])=>'<div><dt>'+name+'</dt><dd>'+value+'</dd></div>').join('')+'</dl></section>':'')+
  (enabled('cartonLabels')?'<section class="pr-section"><h2>Carton Labels</h2><ol class="pr-dispatch-cartons">'+cartons.map(id=>'<li>'+escape(id)+'</li>').join('')+'</ol></section>':'')+'</article>';
 return {title,paper:barcode.paper,markup};
}
