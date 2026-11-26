import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeProductBrands, optionalBrandColumn, scannedProductLabel} from '../src/domain/product-identity.js';
import {masterInfo, reconcile} from '../src/domain/reconcile.js';
import {cartonAdapter, createCartonIndex, matchCartonScan} from '../src/domain/carton-verification.js';

test('existing profile finds one standard brand header without claiming another mapped column',()=>{
 assert.equal(optionalBrandColumn(['SKU','Brand','Name'],{sku:0,name:2}),1);
 assert.equal(optionalBrandColumn(['SKU','Brand','브랜드 명'],{sku:0}),undefined);
 assert.equal(optionalBrandColumn(['SKU','Brand','Maker'],{sku:0,brand:2}),2);
 assert.equal(optionalBrandColumn(['SKU','Brand'],{sku:0,name:1}),undefined);
});
test('badge separates only a verified brand prefix and never invents a brand',()=>{
 assert.deepEqual(scannedProductLabel('Helmut Lang · Relaxed Shirt / Royal Blue','Helmut Lang'),{name:'Relaxed Shirt / Royal Blue',brand:'Helmut Lang'});
 assert.deepEqual(scannedProductLabel('Helmut Langline · Shirt','Helmut Lang'),{name:'Helmut Langline · Shirt',brand:'Helmut Lang'});
 assert.deepEqual(scannedProductLabel('Helmut Lang · Shirt',null),{name:'Helmut Lang · Shirt',brand:''});
 assert.deepEqual(scannedProductLabel('Asymmetric Top','Rick Owens'),{name:'Asymmetric Top',brand:'Rick Owens'});
 assert.equal(mergeProductBrands(['','Rick Owens','RICK OWENS']),'Rick Owens');
 assert.equal(mergeProductBrands(['Yohji Yamamoto','Rick Owens']),null);
});
test('return and carton scopes retain brands, without changing the inspection totals',()=>{
 const sku=[{sku:'A',barcode:'B',name:'Top',brand:'Rick Owens'}];
 const raw=[{...sku[0],receipt:'O',qty:2}];
 const event={kind:'barcode',barcode:'B',receipt:'O'};
 assert.equal(masterInfo({sku,raw},event).brand,'Rick Owens');
 const [row]=reconcile({sku,raw},'O',[event]);
 assert.deepEqual([row.brand,row.actual,row.expected],['Rick Owens',1,2]);
 const adapter=cartonAdapter('outbound');
 const lines=adapter.table('cartonLines',[[],['O','Carton','A','B','Top','Rick Owens','2']],{columns:{receipt:0,id:1,sku:2,barcode:3,name:4,brand:5,qty:6}});
 const group=createCartonIndex(lines).groups.get('O');
 assert.deepEqual([matchCartonScan(group,'Carton','B').brand,group.qty],['Rick Owens',2]);
});
