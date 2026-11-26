import assert from 'node:assert/strict';
import test from 'node:test';
import {cartonAdapter,createCartonIndex,dasFolders,outboundCandidates,outboundSearchScope} from '../src/domain/carton-verification.js';
import {matchCartonHeaders,validateCartonMappings} from '../src/features/cartons/reference.js';
import {createCartonWork} from '../src/features/cartons/model.js';

const heading=['Sort key','Item','Actual units','Tote','Internal order','Product'];
const row=(id,tote,sku,batch='')=>[batch,sku,'1',tote,id,sku];
const rows=[heading,row('A','T1','01','RUN-7'),row('A','T1','02'),row('B','T1','03','RUN-7'),row('C','T3','04'),row('D','T4','05','RUN-9')];
const profile=validateCartonMappings({outbound:{sheet:'Fulfillment data',headers:{das:'Sort key',receipt:'Internal order',id:'Tote',qty:'Actual units',sku:'Item',name:'Product'}}}).outbound;
const parse=(data,p=profile)=>{
 const {table}=cartonAdapter('outbound');
 return createCartonIndex(table('cartonLines',data,matchCartonHeaders('outbound',data,p)));
};

test('DAS assignment is optional and follows saved headers even if workbook columns move',()=>{
 const shuffled=rows.map(r=>[r[3],r[1],r[0],r[4],r[2],r[5]]);
 const index=parse(shuffled);
 const single=outboundSearchScope(index,'single'),das=outboundSearchScope(index,'das');
 assert.deepEqual([...single.groups.keys()],['C']);
 assert.deepEqual([...das.groups.keys()],['A','B','D']);
 assert.deepEqual(dasFolders(das.groups.values()).map(f=>[f.label,f.orders.map(o=>o.id)]),[['RUN-7',['A','B']],['RUN-9',['D']]]);
 assert.deepEqual(outboundCandidates(das,'RUN-7').groups.map(g=>g.id),['A','B']);
 assert.equal(outboundCandidates(das,'RUN-7').exact,null);
 assert.equal(outboundCandidates(das,'T1').exact,null);
 assert.equal(outboundCandidates(single,'T1').groups.length,0);
 assert.equal(outboundCandidates(single,'T3').exact.id,'C');
 const {das:ignored,...headers}=profile.headers;
 const legacy=parse(rows.map(r=>r.slice(1)),{...profile,headers});
 assert.equal(outboundSearchScope(legacy,'das').groups.size,0);
 assert.equal(outboundSearchScope(legacy,'single').groups.size,4);
 assert.throws(()=>parse([...rows,row('A','T2','06','RUN-8')]),/Conflicting DAS/);
});

test('shared carton captions and DAS membership do not share inspection records',()=>{
 const index=parse(rows), scope=outboundSearchScope(index,'das');
 const [a,b]=outboundCandidates(scope,'RUN-7').groups;
 assert.equal(a,index.groups.get('A'));
 const work=createCartonWork(()=>0);
 work.connect('outbound','Fixture',index);
 work.scan('outbound',a,'T1','01');
 work.finish('outbound',a,'T1');
 assert.equal(work.locked('outbound',a,'T1'),true);
 assert.equal(work.locked('outbound',b,'T1'),false);
 assert.deepEqual(work.rows('outbound',b,'T1').map(r=>[r.sku,r.actual]),[['03',0]]);
});
