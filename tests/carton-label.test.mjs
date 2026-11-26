import test from 'node:test';
import assert from 'node:assert/strict';
import {A4_LABEL_PAPER, planProductLabels, labelPageLayout, fitsBarcode, labelsInRange, validateLabelPapers} from '../dist/domain/product-labels.js';
import { productBarcodeSvg } from '../dist/components/print/barcode.js';
import {cartonAdapter, cartonLocation, createCartonIndex, cartonSearch, matchCartonScan, outboundCandidates, outboundFolders, wrapOutboundIndex, outboundDispatch, validateDispatchProfile} from '../dist/domain/carton-verification.js';
import {createCartonWork} from '../dist/features/cartons/model.js';

const first={group:'ORDER',box:'BOX 01',external:'EXT-001',sku:'SKU-01',barcode:'0012345678901',name:'Test product',qty:3};
const second={...first,box:'BOX 02',qty:2};
const third={...first,group:'OTHER',box:'BOX 01',external:'EXT-002',qty:1};
test('outbound preserves carton scopes even when order, carton and product identifiers repeat',()=>{
 const index=createCartonIndex([first,second,third]), order=index.groups.get('ORDER');
 const work=createCartonWork();work.connect('outbound','fixture',index);
 assert.equal(work.scan('outbound',order,'BOX 01',first.barcode),'accepted');
 assert.equal(work.rows('outbound',order,'BOX 01')[0].actual,1);
 assert.equal(work.rows('outbound',order,'BOX 02')[0].actual,0);
 assert.equal(work.rows('outbound',order,null)[0].expected,5);
 assert.equal(work.rows('outbound',order,null)[0].actual,1);
 assert.equal(index.boxes.get('BOX 01').size,2);
 assert.deepEqual(cartonSearch(index,'EXT-002').map(g=>g.id),['OTHER']);
 assert.equal(matchCartonScan(order,'BOX 02','no such barcode').status,'unexpected');
});
test('carton undo retains aggregate ordering across scopes and never changes earlier verdicts',()=>{
 const index=createCartonIndex([first,second]),order=index.groups.get('ORDER'),work=createCartonWork(()=>1);
 work.connect('inventory','fixture',index);
 for(const [box,code] of [['BOX 01','a'],['BOX 02','b'],['BOX 02','a']])assert.equal(work.scan('inventory',order,box,code),'unexpected');
 assert.equal(work.undo('inventory',order,'BOX 01'),true);
 assert.deepEqual(work.rows('inventory',order,null).filter(row=>row.unregistered).map(row=>row.barcode),['b','a']);
 assert.equal(work.canScan('inventory',order,null),false);
 for(let i=0;i<3;i++) work.scan('inventory',order,'BOX 02',first.barcode);
 assert.deepEqual(work.recent('inventory',order,'BOX 02').slice(0,3).map(event=>event.result),['excess','accepted','accepted']);
});
test('inventory splits only the last configured separator or uses explicit carton, never hardcoded work codes',()=>{
 assert.deepEqual(cartonLocation('27 105 C | CTN 21','','|'),['27 105 C','CTN 21']);
 assert.deepEqual(cartonLocation('27 / 105 C / CTN 21','','/'),['27 / 105 C','CTN 21']);
 assert.deepEqual(cartonLocation('27 / 105 C','ABC','/'),['27 / 105 C','ABC']);
 assert.throws(()=>cartonLocation('27 105 C |','','|'));
 const a=cartonAdapter('inventory','|'), headers=['Qty','Location','Name','SKU'];
 const columns=a.validateColumns('cartonLines',headers,{receipt:1,name:2,sku:3,qty:0});
 assert.deepEqual(a.table('cartonLines',[headers,['3','27 105 C | CTN 21','Product','SKU-A']],{columns}),[
  {group:'27 105 C',box:'CTN 21',external:'',name:'Product',sku:'SKU-A',barcode:'',qty:3}]);
 assert.throws(()=>a.validateColumns('',headers,{receipt:1,name:2,sku:3,qty:2}));
 assert.throws(()=>cartonAdapter('outbound').validateColumns('',headers,columns));
});
test('labels use exactly the remaining units and never turn a SKU into a product barcode',()=>{
 const item={...first,expected:7,actual:3};
 const plan=planProductLabels([item,{...item,expected:3,actual:3},{...item,expected:2,actual:3},
   {...item,barcode:'',sku:'NOT-BARCODE'},{...item,barcode:'한글'},{...item,conflict:true},{...item,unregistered:true}]);
 assert.equal(plan.total,4);
 assert.equal(plan.blocked.length,3);
 assert.equal(labelsInRange(plan.items,2,3).length,2);
 assert.deepEqual(plan.items[0].code.codes.slice(0,3),[104,16,16]);
 assert.match(productBarcodeSvg(plan.items[0].code),/<rect x="10"/);
});
test('profiles store multiple physical sizes and landscape swaps actual width and height',()=>{
 assert.deepEqual(validateLabelPapers(),[]);
 const [small,large]=validateLabelPapers([{name:'Small',width:78,height:34},{name:'Large',width:101.6,height:152.4}]);
 assert.equal(labelPageLayout(small,true,false).labelWidth,78);
 assert.equal(labelPageLayout(small,false,false).labelWidth,34);
 assert.equal(labelPageLayout(large,false,false).rows,1);
 assert.equal(labelPageLayout(A4_LABEL_PAPER,true,true).height,210);
 assert.equal(labelPageLayout(A4_LABEL_PAPER,false,true).rows,6);
 const [label]=planProductLabels([{...first,barcode:'A'.repeat(80),expected:1,actual:0}]).items;
 assert(!fitsBarcode(label.code,labelPageLayout(large,true,false)));
 assert.throws(()=>validateLabelPapers([{name:'A4',width:60,height:60}]));
 assert.throws(()=>validateLabelPapers([{name:'Label',width:Infinity,height:60}]));
});


test('outbound search can select an exact carton but never chooses an ambiguous repeated carton',()=>{
 const idx=createCartonIndex([{...first,store:'Fictional Site A',country:'KR'},second,{...third,country:'JP'}]);
 assert.equal(outboundCandidates(idx,'BOX 01').exact,null);
 assert.deepEqual(outboundCandidates(idx,'BOX 01').groups.map(x=>x.id),['ORDER','OTHER']);
 assert.equal(outboundCandidates(idx,'BOX 02').carton,'BOX 02');
 assert.equal(outboundCandidates(idx,'BOX 02').exact.id,'ORDER');
 assert.equal(outboundCandidates(idx,'Fictional Site A').exact.id,'ORDER');
 assert.equal(outboundCandidates(idx,'ORDER').carton,'');
 assert.deepEqual(outboundDispatch(idx.groups.get('ORDER')),{orderId:'ORDER',externalId:'EXT-001',stores:['Fictional Site A'],countries:['KR'],cartons:['BOX 01','BOX 02']});
});
test('destination fields are optional workbook mappings on outbound',()=>{
 const headers=['Order ID','Carton Label ID','Expected Units','Product Name','SKU','Destination Store','Country'];
 const map={receipt:0,id:1,qty:2,name:3,sku:4,store:5,country:6};
 const a=cartonAdapter('outbound'),columns=a.validateColumns('cartonLines',headers,map);
 const [r]=a.table('cartonLines',[headers,['OUT-01','BOX 01','4','Hoodie','S1','DemoAb',' KR ']],{columns});
 assert.equal(r.store,'DemoAb');assert.equal(r.country,'KR');
 delete columns.country;
 assert(!('country' in a.table('cartonLines',[headers,['OUT-01','BOX 01','4','Hoodie','S1','DemoAb',' JP ']],{columns})[0]));
});


test('shipment summary profile roundtrips flags and header names without imported values',()=>{
 const pref={fields:['externalId','country'],mapping:{sheet:'My shipments',headers:{country:'Ship to nation'}}};
 assert.deepEqual(validateDispatchProfile(JSON.parse(JSON.stringify(validateDispatchProfile(pref)))),pref);
 assert.equal(validateDispatchProfile().fields.length,6);
 assert.throws(()=>validateDispatchProfile({fields:[]}));
 assert.throws(()=>validateDispatchProfile({fields:['externalId','data']}));
 assert.throws(()=>validateDispatchProfile({fields:['store'],mapping:{sheet:'Sheet',headers:{store:'Same',country:'Same'}}}));
});

test('preview shows one card per product, including split batches, without changing print copies',async()=>{
 const {labelPreviewItems}=await import('../dist/components/product-labels/view.js');
 const a={count:4,sku:'A'},b={count:3,sku:'B'};
 const copies=labelsInRange([a,b],2,4);
 assert.deepEqual(labelPreviewItems(copies),[{item:a,count:2},{item:b,count:2}]);
 assert.deepEqual(copies,[a,a,b,b]);
 assert.deepEqual(labelPreviewItems([]),[]);
});

test('unscanned labels keep copy counts while splitting an explicit brand from the product name',()=>{
 const plan=planProductLabels([
  {name:'HOUSE STUDIO · Long Sleeve Shirt',brand:'House Studio',sku:'A',barcode:'00012345',expected:6,actual:1},
  {name:'Another Studio · Coat',brand:null,sku:'B',barcode:'00012346',expected:1,actual:0},
  {name:'Actual brand is not part of the name',brand:'Third House',sku:'C',barcode:'00012347',expected:2,actual:1},
 ]);
 assert.deepEqual(plan.items.map(({name,brand,count,barcode})=>[name,brand,count,barcode]),[
  ['Long Sleeve Shirt','House Studio',5,'00012345'],
  ['Another Studio · Coat','',1,'00012346'],
  ['Actual brand is not part of the name','Third House',1,'00012347'],
 ]);
 assert.equal(plan.total,7);
});


test('outbound store folders keep destination boundaries and wrap without losing order identity',()=>{
 const i=createCartonIndex([
  {...first,store:'Demo',country:'KR'},
  {...third,store:'  DEMO  ',country:'kr'},
  {...third,group:'JAPAN',store:'Demo',country:'JP'},
  {...third,group:'UNKNOWN'}, {...third,group:'UNKNOWN2'}
 ]);
 assert.deepEqual(outboundFolders(i.groups.values()).map(f=>f.orders.map(o=>o.id)),[['ORDER','OTHER'],['JAPAN'],['UNKNOWN'],['UNKNOWN2']]);
 const narrowed=outboundCandidates(i,'EXT-001');
 assert.deepEqual(outboundFolders(narrowed.groups)[0].orders.map(o=>o.id),['ORDER']);
 assert.equal(wrapOutboundIndex(0,-1,3),2);assert.equal(wrapOutboundIndex(2,1,3),0);
});

test('inspection PDFs and product views share the square badge and do not repeat a known brand',async()=>{
 const {productIdentityMarkup}=await import('../dist/components/product-identity/view.js');
 const {renderInspectionReport}=await import('../dist/components/print/inspection-report.js');
 const mark=productIdentityMarkup('House · <Shirt>', 'House');
 assert.match(mark,/>House<.*>&lt;Shirt&gt;</);
 assert.doesNotMatch(mark,/House ·/);
 assert.doesNotMatch(productIdentityMarkup('House · Shirt',null),/scan-brand-badge/);
 const r=renderInspectionReport({mode:'outbound',orderId:'1',rows:[{name:'House · Shirt',brand:'House',expected:1,actual:0,status:'short'}]});
 assert.match(r.markup,/scan-brand-badge product-brand-inline">House<.*product-name-inline">Shirt</);
});
