import assert from 'node:assert/strict';
import test from 'node:test';
import {createOriginalOrderLookup} from '../src/domain/original-order-lookup.js';

const core=createOriginalOrderLookup(String);
const shipment=(id,clue,sku)=>({...core.contactRecord(id,clue),id,sku});
const seed=async()=>{
 const returns=await core.build('returns',[
  shipment('RET-1',{phone:'010-2345-6789',address:'77 Fiction Road, Unit 2',originalTracking:'0012-3456-7890'}),
  shipment('RET-2',{address:'77 Fiction Road Unit 12'}),
 ]);
 const orders=await core.build('orders',[
  shipment('F-1',{phone:'+82 10 2345 6789',address:'７７ Fiction Road Unit 2',originalTracking:'X001234567890X'},'A'),
  {id:'F-1',sku:'B'},
  shipment('F-2',{phone:'01023456789',originalTracking:'001299999990'},'A'),
  shipment('F-3',{address:'77 Fiction Road Unit 12'},'C'),
  shipment('F-4',{originalTracking:'001234567890'},'D'),
 ]);
 return {returns,orders};
};
test('original tracking ranks first, contact-only orders remain candidates, and split product rows count',async()=>{
 const {returns,orders}=await seed();
 const result=await core.find(returns,orders,'RET-1',[{sku:'A'},{sku:'B'}]);
 assert.deepEqual(result.candidates.map(x=>x.id),['F-1','F-4','F-2']);
 const [first,,third]=result.candidates;
 assert.deepEqual(new Set(first.evidence),new Set(['phone','address','tracking']));
 assert.equal(first.matched,2);
 assert.equal(third.contradictsTracking,true);
});
test('manual tracking never guesses from contact, preserves zero, and keeps duplicate waybills reviewable',async()=>{
 const {returns,orders}=await seed();
 assert.deepEqual((await core.find(returns,orders,'RET-1',[],'0012-3456-7890')).candidates.map(x=>x.id),['F-1','F-4']);
 assert.equal((await core.find(returns,orders,'RET-1',[],'01234567890')).status,'no-match');
 assert.equal((await core.find(returns,orders,'RET-1',[],'X001234567890Y')).status,'no-match');
 assert.equal((await core.find(returns,orders,'RET-1',[],'invalid')).status,'invalid-tracking');
});
test('address-only rows and manually entered contact work without storing contact values in safe indexes',async()=>{
 const {returns,orders}=await seed();
 assert.deepEqual((await core.find(returns,orders,'RET-2')).candidates.map(x=>x.id),['F-3']);
 assert.deepEqual((await core.find(null,orders,'RET-3',[],{address:'77 FICTION ROAD, UNIT 12'})).candidates.map(x=>x.id),['F-3']);
 const data=JSON.stringify([...orders.byId]);
 assert.doesNotMatch(data,/Fiction Road|23456789|001234567890/i);
 const cols={headerRow:0,columns:{id:2,address:0,name:1}};
 assert.equal(core.table('orders',[['Route','Item','Order'],['77 Fiction Road, Unit 12','Sample','F-3']],cols)[0].id,'F-3');
});

test('automatic linking requires one candidate and three exact same-row identity matches on both sides',async()=>{
 const contact={customerName:' Sample   Customer ',phone:'010-2345-6789',address:'77 Fiction Road, Unit 2'};
 const returned=(...records)=>core.build('returns',records.map(record=>shipment('RET-1',record)));
 const ordered=(...records)=>core.build('orders',records.map(([id,record])=>shipment(id,record,'A')));
 const returns=await returned(contact);
 const matches={customerName:'sample customer',phone:'+82 10 2345 6789',address:'７７ Fiction Road Unit 2'};
 const orders=await ordered(['F-1',matches],['F-unrelated',{customerName:matches.customerName}]);
 assert.equal(core.automaticMatch(returns,orders,'RET-1'),'F-1');
 assert.deepEqual((await core.find(returns,orders,'RET-1')).candidates[0].evidence.sort(),['address','customerName','phone']);
 assert.doesNotMatch(JSON.stringify([...orders.byId]),/sample customer/i);
 for(const override of [{customerName:'Sample'}, {address:'77 Fiction Road Unit 12'}, {phone:''}]){
  assert.equal(core.automaticMatch(returns,await ordered(['F-1',{...matches,...override}]),'RET-1'),null);
 }
 const conflicting=await ordered(['F-1',matches],['F-1',{address:'77 Fiction Road Unit 12'}]);
 assert.equal(core.automaticMatch(returns,conflicting,'RET-1'),null);
 const ambiguous=await ordered(['F-1',matches],['F-2',{phone:matches.phone}]);
 assert.equal(core.automaticMatch(returns,ambiguous,'RET-1'),null);
 assert.equal(core.automaticMatch(await returned(contact,{customerName:'Other Customer'}),orders,'RET-1'),null);
 const fragments=[{customerName:matches.customerName,phone:matches.phone},{address:matches.address}];
 assert.equal(core.automaticMatch(returns,await ordered(...fragments.map(record=>['F-1',record])),'RET-1'),null);
 assert.equal(core.automaticMatch(await returned(...fragments),orders,'RET-1'),null);
 const tracked=await returned({...contact,originalTracking:'0012-3456-7890'});
 assert.equal(core.automaticMatch(tracked,await ordered(['F-1',{...matches,originalTracking:'001299999990'}]),'RET-1'),null);
 assert.equal(core.automaticMatch(tracked,await ordered(['F-1',{...matches,originalTracking:'X001234567890X'}]),'RET-1'),'F-1');
 const conflictingTracking=await returned({...contact,originalTracking:'0012-3456-7890'},{originalTracking:'999900000001'});
 assert.equal(core.automaticMatch(conflictingTracking,await ordered(['F-1',{...matches,originalTracking:'X001234567890X'}]),'RET-1'),null);
});

test('repeat Cry Later customer: shared identity keeps distinct orders reviewable, not distinct product lines',async()=>{
 // Mirrors two bundled demo orders; use an invented complete address to exercise auto-link.
 const contact={customerName:'임민서 (데모)',address:'77 Fiction Road, Unit 2'};
 const raw=[['ID','Buyer','Phone','Address','Return Waybill'],
  ['CL-RC-0001',contact.customerName,'+1 (202) 555-0101',contact.address,'9003-0001-7001'],
  ['CL-RC-0070',contact.customerName,'+12025550101',contact.address,'9003-0070-7070'],
  ['CL-RC-0070',contact.customerName,'+12025550101',contact.address,'9003-0070-7070']];
 const original=[['ID','Buyer','Phone','Address','SKU','Barcode','Date'],
  ['CL-OC-0001',contact.customerName,'+1 (202) 555-0101',contact.address,'CL-HS-08-01','CLB00801','2026-10-13'],
  ['CL-OC-0070',contact.customerName,'+1 (202) 555-0101',contact.address,'CL-HS-09-03','CLB00903','2026-10-28'],
  ['CL-OC-0070',contact.customerName,'+1 (202) 555-0101',contact.address,'CL-AV-20-01','CLB02001','2026-10-28']];
 const contactColumns={id:0,customerName:1,phone:2,address:3};
 const returns=await core.build('returns',core.table('returns',raw,{headerRow:0,columns:contactColumns}));
 const orders=rows=>core.build('orders',core.table('orders',rows,{headerRow:0,columns:{...contactColumns,sku:4,barcode:5,date:6}}));
 const all=await orders(original);
 const items=[{sku:'CL-HS-09-03',barcode:'CLB00903'},{sku:'CL-AV-20-01',barcode:'CLB02001'}];
 const {candidates}=await core.find(returns,all,'CL-RC-0070',items);
 assert.deepEqual(candidates.map(({id,matched,date})=>[id,matched,date]),[
  ['CL-OC-0070',2,'2026-10-28'],['CL-OC-0001',0,'2026-10-13']]);
 assert.equal(core.automaticMatch(returns,all,'CL-RC-0070'),null);
 assert.equal(core.automaticMatch(returns,all,'CL-RC-0001'),null);
 assert.equal(core.automaticMatch(returns,await orders([original[0],...original.slice(2)]),'CL-RC-0070'),'CL-OC-0070');
 assert.equal((await core.find(returns,all,'CL-RC-0070',items,'9003-0070-7070')).status,'no-match');
});
