import { encodeReceiptCode128 } from './code128.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isBlank=value=>value==null||value==='';
const show=value=>isBlank(value)?'—':value;
const signed=count=>count>0?'+'+count:String(count);
const englishStatus=new Map([
 ['일치','Matched'],['부족','Short'],['초과','Excess'],['예정 외','Unexpected'],['정보 충돌','Data conflict'],['식별자 없음','Missing identifier'],
 ['matched','Matched'],['short','Short'],['excess','Excess'],['unexpected','Unexpected'],['conflict','Data conflict'],['unidentified','Missing identifier'],
]);

function orderBarcode(orderId){
 const label='Order No.';
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

// Supply only the selected internal warehouse order ID and already reconciled
// rows. The same paper layout accepts either returns or outbound workflows.
export function renderInspectionReport({mode,orderId,externalId='',party='',rows=[]}){
 if(!['return','outbound'].includes(mode))throw TypeError('Unsupported inspection workflow');
 const title=mode==='return'?'Return Inspection Report':'Outbound Inspection Report';
 const barcode=orderBarcode(orderId),location=rows.some(r=>r.location&&r.location!=='—');
 const columns=['Status','Barcode / SKU','Product',...(location?['Location']:[]),'Expected','Checked','Difference'];
 const widths=location?[15,20,25,16,8,8,8]:[16,25,35,8,8,8];
 const cells=(tag,values)=>values.map((v,i)=>'<'+tag+(tag==='th'?' scope="col"':'')+
  (i>=columns.length-3?' class="pr-number"':'')+'>'+escape(v)+'</'+tag+'>').join('');
 let expected=0,actual=0;
 const body=rows.map(r=>{
  expected+=r.expected;actual+=r.actual;
  return '<tr>'+cells('td',[(englishStatus.get(r.status)||'Review')+(r.held?' · Held':''),[r.barcode,r.sku].filter(Boolean).join(' / '),r.name,
   ...(location?[show(r.location)]:[]),r.expected,r.actual,signed(r.actual-r.expected)])+'</tr>';
 }).join('');
 const totals=['Total','','',...(location?['']:[]),expected,actual,signed(actual-expected)];
 const markup='<article class="pr-inspection"><header class="pr-label"><div class="pr-label-top">'+
  '<div class="pr-label-mark" aria-hidden="true">B</div><div class="pr-label-head">'+
  '<p class="pr-brand"><b>BEAM</b>'+(externalId&&externalId!==orderId?
   '<span>'+'External Order No. '+escape(externalId)+'</span>':'')+'</p>'+
  '<h1>'+escape(title)+'</h1>'+(party?'<p class="pr-label-party">'+escape(party)+'</p>':'')+'</div></div>'+
  barcode.markup+'</header><section class="pr-section"><table aria-label="'+'Inspection results'+'">'+
  '<colgroup>'+widths.map(w=>'<col style="width:'+w+'%">').join('')+'</colgroup>'+
  '<thead><tr>'+cells('th',columns)+'</tr></thead><tbody>'+
  (body||'<tr><td colspan="'+columns.length+'" class="pr-empty">'+'No inspection items'+'</td></tr>')+
  '</tbody><tfoot><tr>'+cells('td',totals)+'</tr></tfoot></table></section></article>';
 return {markup,paper:barcode.paper,title};
}
