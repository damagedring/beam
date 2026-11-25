import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const css=await readFile(new URL('../src/styles/workspace.css',import.meta.url),'utf8');
const palette=await readFile(new URL('../src/styles/status-colors.css',import.meta.url),'utf8');
const styles=css.slice(css.indexOf('/* Inspection glass: neutral outer material'));
const readToken=name=>styles.match(new RegExp('--'+name+':(#[0-9a-f]{6})(?:;|\\s)'))?.[1];
const luminance=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255)
 .map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const l=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (l[0]+.05)/(l[1]+.05);};

const readSwatch=name=>palette.match(new RegExp('--status-'+name+':(#[0-9a-f]{6})'))?.[1];
const mix=(a,b,weight)=>'#'+a.slice(1).match(/../g).map((x,i)=>Math.round(parseInt(x,16)*weight+parseInt(b.slice(i*2+1,i*2+3),16)*(1-weight)).toString(16).padStart(2,'0')).join('');
test('scanner and ledger keep legible status and text over their neutral dark surfaces',()=>{
 assert.match(styles,/@media screen and \(forced-colors:none\)/);
 for(const ink of ['scan-text','scan-hint'])assert.ok(contrast(readToken(ink),readToken('scan-well'))>=4.5,ink);
 assert.ok(contrast(readSwatch('info'),readToken('scan-well'))>=4.5);
 for(const swatch of ['match','short','over','info']){
  const color=readSwatch(swatch);
  assert.ok(contrast(color,mix(color,'#1d1d1d',.15))>=4.5,swatch+' on dark');
  assert.ok(contrast(mix(color,'#111111',.28),mix(color,'#ffffff',.30))>=4.5,swatch+' on light');
 }
 assert.match(styles,/#scanActivitySection \.compact-activity td\.sheet-status\[data-cell-state=accepted\]\{[^}]*background:var\(--recent-surface\)!important;color:var\(--complete-ink\)!important/);
 assert.match(styles,/--tui-dim:var\(--term-dim\);--muted:var\(--term-dim\)/);
 assert.ok(contrast(readSwatch('match'),readToken('recent-surface'))>=4.5);
 assert.ok(contrast('#bdbdbd',readToken('recent-surface'))>=4.5);
});
test('screen information colors are sourced from the shared palette, including the order popover',async()=>{
 const glass=await readFile(new URL('../src/styles/glass.css',import.meta.url),'utf8');
 const live=css+'\n'+glass;
 for(const role of ['match','short','over','info']){
  assert.equal([...palette.matchAll(new RegExp('--status-'+role+':','g'))].length,1);
  assert.doesNotMatch(live,new RegExp(readSwatch(role),'i'));
 }
 assert.doesNotMatch(live,/--(?:complete|warning|shortage|progress|excess|lemon|coral|beam-error)-(?:bg|ink|fill|edge|alert)\s*:/);
 assert.match(css,/:is\(#orderInfoList,#questPeekList\) \.quest-item\[data-phase=progress\]\{--quest-fill:var\(--shortage-bg\);--quest-ink:var\(--shortage-ink\)/);
 assert.match(css,/:is\(#orderInfoList,#questPeekList\) \.quest-item\[data-phase\]\{\s*color:var\(--quest-ink\);background:var\(--quest-fill\)/);
});

test('last scan shows a visible quantity, with shortage, equality or surplus spelled out',async()=>{
 const src=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const fn=src.slice(src.indexOf('function lastScannedCountLabel('),src.indexOf('function drawLastScanned('));
 const label=runInNewContext(fn+'\nlastScannedCountLabel');
 assert.equal(label(1,6,false).quantity,'1 / 6 EA');
 assert.equal(label(1,6,false).detail,'5개 남음');
 assert.equal(label(6,6,false).detail,'수량 일치');
 assert.equal(label(7,6,false).detail,'1개 초과');
 assert.equal(label(1,6,true).detail,'5 remaining');
});


test('normal displays do not paint focus glows while forced contrast and selected cards stay supported',async()=>{
 const glass=await readFile(new URL('../src/styles/glass.css',import.meta.url),'utf8');
 const joined=css+'\n'+glass;
 assert.doesNotMatch(joined,/:focus(?:-visible|-within)?[^{}]*\{[^{}]*(?:box-shadow|filter):\s*(?!none)[^{}]*drop-shadow/);
 assert.match(css,/\(forced-colors:none\)\{\s*html\[data-theme\] body :focus\{outline:none!important/);
 assert.match(css,/\(forced-colors:active\)[^\n]*Highlight/);
 assert.match(glass,/\[data-center=true\] \.beam-file-caption>strong\{font-size:clamp\(24px,3.2vw,38px\)!important/);
});


test('folder captions wrap long store names without trimming them',()=>{
 const caption=css.match(/#beamSearch \.beam-file-caption>strong\{([^}]+)\}/)?.[1]??'';
 assert.match(caption,/white-space:normal/);
 assert.match(caption,/overflow-wrap:anywhere/);
 assert.doesNotMatch(caption,/text-overflow:ellipsis|line-clamp/);
});


test('order identity, order actions and both inspection tables are inside the same sheet surface',async()=>{
 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
 const sheet=html.slice(html.indexOf('<section id="inspectionOrderSurface"'),html.indexOf('<div id="orderSummarySource"'));
 for(const id of ['orderWorkspace','currentAsnActions','beamWorkName','overviewTracking','scanActivitySection','results']){
  assert.match(sheet,new RegExp('id="'+id+'"'));
 }
 assert.match(sheet,/<\/main>\s*<\/div>\s*<\/section>\s*<\/div>/);
 assert.match(css,/#inspectionOrderSurface::before\{\s*content:"";position:absolute;inset:0/);
});

test('switching inspection orders never regenerates a second action header',async()=>{
 const src=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const workspace=src.slice(src.indexOf('function drawOrderWorkspace()'),src.indexOf('function hasOtherAsnCandidate('));
 const orders=new Map([['i-1',[{seller:'Test store'}]],['i-2',[{seller:'Test store'}]]]);
 const nodes=new Map();
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{dataset:{},classList:{toggle(){}},setAttribute(k,v){this[k]=v},removeAttribute(){},focus(){this.focused=true}});
  return nodes.get(id);
 };
 const state={data:{},orderTabs:['i-1','i-2'],currentBatch:'b',scans:[{batch:'b',receipt:'i-1'}],pending:[],receipt:'i-1'};
 const ctx={$,state,language:'en',lastBarcode:'',selectedWorkStoreKey:()=>'s',Engine:{getIndex:()=>({rawByReceipt:orders})},
  workReceiptGate:()=>id=>orders.has(id),workAllowsReceipt:id=>orders.has(id),isB2C:()=>false,asnStoreKey:()=>'s',
  uiIndex:()=>({orderSearch:new Map()}),receiptDisplay:id=>'Ext-'+id,completionMark:()=>'',esc:String,changed(){},focusBeamInput:id=>$(id).focus()};
 const api=runInNewContext(workspace+'\nfunction draw(){drawOrderWorkspace()}\n({drawOrderWorkspace,switchOrderTab})',ctx);
 const originalScan=state.scans[0];
 for(const [id,other] of [['i-1','i-2'],['i-2','i-1'],['i-1','i-2']]){
  assert.equal(api.switchOrderTab(id),true);
  assert.equal($('activeOrderInfo').dataset.orderInfo,id);
  assert.equal(($('orderTabs').innerHTML.match(/<button/g)||[]).length,2);
  assert.match($('orderTabs').innerHTML,new RegExp('data-order-tab="'+id+'"[^>]*aria-current="true"'));
  assert.match($('orderTabs').innerHTML,new RegExp('data-order-tab="'+other+'"'));
  assert.doesNotMatch($('orderTabs').innerHTML,/data-order-info|data-order-open|data-order-barcode|<svg|type="text"/);
  assert.strictEqual(state.scans[0],originalScan);
 }
 assert.equal($('barcode').focused,true);
});

test('long receipts keep a native scroll track inside the paper and retain their own header and footer',async()=>{
 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
 const receipt=html.slice(html.indexOf('<dialog id="beamFolderReceiptDialog"'),html.indexOf('<dialog id="asnShareDialog"'));
 assert.match(receipt,/beam-long-receipt-head[\s\S]*<div id="beamFolderReceiptScroll" tabindex="0">[\s\S]*<\/table>[\s\S]*<\/div>\s*<div class="beam-long-receipt-foot">[\s\S]*id="beamFolderReceiptNav"/);
 assert.match(css,/#beamFolderReceiptDialog\[open\]\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
 assert.match(css,/#beamFolderReceiptScroll\{[^}]*overflow-y:auto[^}]*scrollbar-gutter:stable/);
 assert.match(css,/#beamFolderReceiptScroll::-webkit-scrollbar-thumb\{[^}]*border:4px solid transparent/);
});

test('folder and paper positions use the same eased transition after keyboard input, but not during drag',async()=>{
 const glass=await readFile(new URL('../src/styles/glass.css',import.meta.url),'utf8');
 assert.match(glass,/@media screen and \(prefers-reduced-motion:no-preference\)\{\s*#beamSearch \.beam-stage:not\(\[data-dragging\]\) \.beam-receipt\{\s*transition:transform 520ms cubic-bezier\(\.28,\.08,\.22,1\)[^}]*!important/);
 assert.match(css,/\.beam-stage\[data-dragging\] \.beam-receipt\{[^}]*transition:none!important/);
});

test('the scanner well never paints its containing console in either theme',()=>{
 const well=styles.match(/([^{}]+)\{\s*background:var\(--scan-well\)!important/)?.[1]?.trim();
 assert.equal(well,'html[data-theme] body #sheetWorkspace #beamTerminal #overviewStatus .scan #scanform #barcode');
 assert.match(css,/#beamTerminal #overviewStatus \.scan\{[^}]*background:transparent!important/);
 assert.match(styles,/#beamTerminal #scanform \.beam-scan-prompt\{color:var\(--status-info\)\}/);
 assert.ok(contrast('#505050','#f4f4f4')>=4.5);
 assert.ok(contrast('#bdbdbd','#252525')>=4.5);
});


test('overall progress cannot trade extra units of one SKU for missing units of another',async()=>{
 const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('function drawAsnProgress()'),app.indexOf('const $=id=>',app.indexOf('function drawAsnProgress()')));
 const map=new Map(),$=id=>{if(!map.has(id))map.set(id,{dataset:{},setAttribute(k,v){this[k]=v;}});return map.get(id);};
 const data={expected:6,actual:8,covered:5,percent:116,excess:2,phase:'excess',batch:8,unassigned:0,complete:false};
 runInNewContext(source+'\ndrawAsnProgress()',{$,state:{receipt:'ORD',scans:[]},language:'ko',tr:x=>x,setUI(){},Engine:{asnProgress:()=>data},isInspectionConfirmed:()=>false});
 assert.equal($('asnCoverageQuantity').textContent,'5 / 6 EA');
 assert.equal($('asnCoverage').textContent,'116%');
 assert.equal($('asnCoverageDetails').textContent,'1개 남음 · 2개 초과');
 assert.ok($('asnProgressBar').value<100);
});

test('order progress is a single full-width sibling immediately beneath the order sheet controls',async()=>{
 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
 const rail=await readFile(new URL('../src/styles/inspection-rail.css',import.meta.url),'utf8');
 assert.match(html,/id="orderWorkspaceHint">\s*<\/span>\s*<\/div>\s*<\/section>\s*<section id="orderCoverage"/);
 assert.match(html,/id="orderCoverage"[\s\S]*?id="asnProgressBar"[\s\S]*?id="beamTerminal"[\s\S]*?id="lastScannedBar"/);
 assert.equal(html.match(/id="asnProgressBar"/g).length,1);
 assert.match(rail,/#orderCoverage\{[\s\S]*?margin:8px var\(--order-inset\) 0/);
});
