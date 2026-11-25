import { A4_LABEL_PAPER, LABEL_BATCH, planProductLabels, labelPageLayout, labelsInRange, fitsBarcode, productBarcodeSvg } from '../domain/product-labels.js';

// The preview has one card per product in the active batch; printing still uses every copy.
export function labelPreviewItems(copies){
 const products=new Map();
 for(const item of copies)products.set(item,(products.get(item)||0)+1);
 return [...products].map(([item,count])=>({item,count}));
}

export function attachProductLabels({getContext,getPapers,print,isEnglish,escape}){
 const $=id=>document.getElementById(id), l=(ko,en)=>isEnglish()?en:ko;
 const dialog=$('productLabelDialog'), paper=$('productLabelPaper'), rotate=$('productLabelRotate'), batch=$('productLabelBatch'), submit=$('productLabelPrint'), notice=$('productLabelStatus'), preview=$('productLabelPreview');
 const nav=$('productLabelNav'),position=$('productLabelPosition');
 let launcher,context,plan,papers,landscape=false,selectedBatch=0,previewIndex=0,previewItems=[],gesture=null,measuring=false;
 function renderPreview(direction=0){
  const current=previewItems[previewIndex];
  nav.hidden=previewItems.length<2;
  position.textContent=current?l(`상품 ${previewIndex+1} / ${previewItems.length} · ${current.count}장`,`Product ${previewIndex+1} / ${previewItems.length} · ${current.count} labels`):'';
  position.setAttribute('aria-label',current?[current.item.brand,current.item.name,position.textContent].filter(Boolean).join(' · '):'');
  preview.innerHTML=current?'<div class="product-label-sample" style="'+style(layout())+'">'+label(current.item,localDate())+'</div>':'';
  preview.scrollTop=0;
  if(direction&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   preview.firstElementChild?.animate?.([
    {transform:`perspective(700px) translateX(${direction*30}px) rotateY(${direction*12}deg)`,opacity:.45},
    {transform:'perspective(700px) translateX(0) rotateY(0)',opacity:1}
   ],{duration:330,easing:'cubic-bezier(.28,.08,.22,1)'});
  }
 }
 function movePreview(direction){
  if(previewItems.length<2)return false;
  previewIndex=(previewIndex+direction+previewItems.length)%previewItems.length;
  renderPreview(direction);return true;
 }
 function localDate(){
  const d=new Date(),pad=v=>String(v).padStart(2,'0');
  return [d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
 }
 const label=(item,printed)=>'<div class="product-label">'+(item.brand?'<div class="scan-brand-badge product-label-brand">'+escape(item.brand)+'</div>':'')+'<div class="product-label-name">'+escape(item.name||l('제품명 없음','Name unavailable'))+'</div><div class="product-label-code" style="--bars-ideal:'+(item.code.modules*0.55).toFixed(2)+'mm">'+productBarcodeSvg(item.code)+'</div><div class="product-label-barcode">'+escape(item.barcode)+'</div><div class="product-label-ref"><div>SKU <b>'+escape(item.sku||'—')+'</b></div><div>'+l('외부 주문 ID','External order ID')+' <b>'+escape(context.external||'—')+'</b></div>'+(context.carton?'<div>'+l('박스','Carton')+' <b>'+escape(context.carton)+'</b></div>':'')+'<div>'+l('인쇄일','Print date')+' <b>'+printed+'</b></div></div></div>';
 function report(text){notice.textContent=text;}
 function layout(){const id=Number(paper.value);return labelPageLayout(papers[id],landscape,id===0);}
 const style=g=>`--label-name-size:${g.labelHeight<40?'10.5pt':'13pt'};--label-code-height:${g.labelHeight<40?'7mm':'9mm'};--label-ref-cols:${g.labelHeight<40?2:1};--label-w:${g.labelWidth}mm;--label-h:${g.labelHeight}mm;--paper-w:${g.width}mm;--paper-h:${g.height}mm;--paper-inset:${g.inset}mm;--label-cols:${g.columns}`;
 function refresh(){
  const geometry=layout(), start=selectedBatch*LABEL_BATCH;
  const current=labelsInRange(plan.items,start,LABEL_BATCH),sample=current[0];
  rotate.setAttribute('aria-pressed',String(landscape));rotate.textContent=landscape?l('가로 → 세로','Landscape → portrait'):l('세로 → 가로','Portrait → landscape');
  $('productLabelOrientation').textContent=geometry.width+' × '+geometry.height+' mm';
  $('productLabelCount').textContent=plan.total?l(`${plan.total.toLocaleString()}장 · ${plan.items.length}개 품목`,`${plan.total.toLocaleString()} labels · ${plan.items.length} products`):l('출력할 미스캔 라벨 없음','No unscanned labels to print');
  const errors=[];
  if(plan.blocked.length)errors.push(l('바코드가 없거나 식별이 불확실해 제외: ','Excluded because a barcode or product match is unavailable: ')+plan.blocked.slice(0,5).map(r=>(r.sku||r.name)+' × '+r.count).join(', ')+(plan.blocked.length>5?' +'+(plan.blocked.length-5):''));
  if(!context.external)errors.push(l('외부 주문 ID가 비어 있습니다.','External order ID is unavailable.'));
  const tooWide=current.some(item=>!fitsBarcode(item.code,geometry));
  if(tooWide)errors.push(l('이 용지는 바코드에 너무 좁아요. 회전하거나 더 큰 용지를 골라 주세요.','Barcode too wide for this paper. Rotate it or choose larger stock.'));
  submit.disabled=measuring||!sample||tooWide;
  submit.textContent=current.length?l(`${current.length.toLocaleString()}장 인쇄`,`Print ${current.length.toLocaleString()} labels`):l('인쇄','Print');
  report(errors.join(' · '));
  previewItems=labelPreviewItems(current);
  previewIndex=Math.min(previewIndex,Math.max(0,previewItems.length-1));
  renderPreview();
 }
 function open(source){
  const fresh=getContext(source);if(!fresh)return;
  launcher=source;context=fresh;plan=planProductLabels(fresh.rows);papers=[A4_LABEL_PAPER,...getPapers()];landscape=false;selectedBatch=0;previewIndex=0;
  paper.replaceChildren(...papers.map((p,i)=>new Option(p.name+' · '+p.width+' × '+p.height+' mm',String(i))));
  paper.value=papers.length>1?"1":"0";
  landscape=papers[Number(paper.value)].width>papers[Number(paper.value)].height;
  const batches=Math.ceil(plan.total/LABEL_BATCH);
  batch.hidden=batches<=1;
  batch.replaceChildren(...Array.from({length:Math.min(batches,500)},(_,i)=>new Option(l('인쇄 묶음 ','Print batch ')+(i+1)+' · '+(i*LABEL_BATCH+1)+'–'+Math.min((i+1)*LABEL_BATCH,plan.total),String(i))));
  if(batches>500){report(l('한 주문의 출력 가능 범위를 초과했습니다.','This order exceeds the print limit.'));plan={items:[],total:0,blocked:plan.items};}
  refresh();dialog.showModal();paper.focus();
 }
 paper.onchange=()=>{const stock=papers[Number(paper.value)];landscape=stock.width>stock.height;refresh();};
 rotate.onclick=()=>{landscape=!landscape;refresh();};
 batch.onchange=()=>{selectedBatch=Number(batch.value);previewIndex=0;refresh();};
 $('productLabelPrev').onclick=()=>movePreview(-1);
 $('productLabelNext').onclick=()=>movePreview(1);
 dialog.addEventListener('keydown',e=>{
  if(e.isComposing||e.altKey||e.ctrlKey||e.metaKey||e.target.matches?.('input,textarea,select'))return;
  const direction=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
  if(direction&&movePreview(direction))e.preventDefault();
 });
 preview.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch'&&e.isPrimary&&previewItems.length>1){
   gesture={id:e.pointerId,x:e.clientX,y:e.clientY};preview.setPointerCapture?.(e.pointerId);
  }
 });
 preview.addEventListener('pointerup',e=>{
  if(gesture?.id!==e.pointerId)return;
  const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture=null;
  if(Math.abs(dx)>33&&Math.abs(dx)>Math.abs(dy)*1.3)movePreview(dx<0?1:-1);
 });
 preview.addEventListener('pointercancel',()=>{gesture=null;});
 preview.addEventListener('lostpointercapture',()=>{gesture=null;});
 $('productLabelClose').onclick=()=>dialog.close();
 dialog.onclose=()=>{gesture=null;preview.replaceChildren();launcher?.focus({preventScroll:true});};
 submit.onclick=async()=>{
  if(submit.disabled)return;
  const fresh=getContext(launcher);
  const signature=c=>JSON.stringify([c.key,c.external,c.carton,c.rows.map(r=>[r.key,r.sku,r.barcode,r.name,r.brand,r.expected,r.actual,r.unregistered,r.conflict,r.unresolved])]);
  if(!fresh||signature(fresh)!==signature(context)){submit.disabled=true;report(l('검수 내용이 바뀌었습니다. 창을 닫고 다시 열어 주세요.','Inspection changed. Close and reopen this dialog.'));return;}
  const g=layout(), printBatch=selectedBatch, printPlan=plan, current=labelsInRange(plan.items,printBatch*LABEL_BATCH,LABEL_BATCH),printed=localDate();
  if(!current.length)return;
  const pageSize=g.columns*g.rows;
  let pages='';
  for(let i=0;i<current.length;i+=pageSize)pages+='<div class="product-label-page" style="'+style(g)+'">'+current.slice(i,i+pageSize).map(x=>label(x,printed)).join('')+'</div>';
  // Measure all distinct labels using the same physical CSS as print; never crop a product name.
  measuring=true;submit.disabled=true;
  const probe=document.createElement('div');probe.className='product-label-probe';probe.setAttribute('aria-hidden','true');probe.setAttribute('style',style(g));
  probe.innerHTML=[...new Set(current)].map(x=>label(x,printed)).join('');document.body.append(probe);
  let overflow;
  try{
   await document.fonts?.ready;
   if(!dialog.open||plan!==printPlan||selectedBatch!==printBatch||JSON.stringify(g)!==JSON.stringify(layout()))return;
   overflow=[...probe.children].some(node=>node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1);
  }finally{probe.remove();measuring=false;if(dialog.open)refresh();}
  if(overflow){report(l('일부 제품명이나 식별자가 이 크기에 다 들어가지 않아요. 회전하거나 더 큰 용지를 골라 주세요.','Some product names or IDs do not fit. Rotate or choose larger stock.'));return;}
  print({width:g.width,height:g.height,title:l('미스캔 상품 라벨','Unscanned product labels'),markup:pages});
 };
 return {open};
}
