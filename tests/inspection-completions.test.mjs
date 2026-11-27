import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionRetentionMs, createInspectionCompletionStore } from '../src/platform/inspection-completions.js';

test('completion retention is enforced at the 30-day boundary even before a sweep', async () => {
  let now = Date.parse('2026-11-26T00:00:00Z');
  const record = { key: 'carton', completedAt: new Date(now).toISOString() };
  const records = new Map([['carton', record], ['malformed', { completedAt: '' }]]);
  const store = {
    readCurrent(key, expired) {
      const item = records.get(key);
      if (!item) return null;
      if (!expired(item)) return item;
      records.delete(key);
      return null;
    },
    prune(expired) {
      for (const [key, item] of records) if (expired(item)) records.delete(key);
    },
  };
  const service = createInspectionCompletionStore({ store, now: () => now });
  now += completionRetentionMs - 1;
  await service.prune();
  assert.equal(records.has('malformed'), false);
  assert.equal(await service.read('carton'), record);
  now++;
  assert.equal(await service.read('carton'), null);
  assert.equal(records.has('carton'), false);
});


test('carton mapping writes are scoped to workspace, profile, and workflow', async () => {
 const {createCartonProfileNamespaces}=await import('../src/features/cartons/reference.js');
 const store=new Map();
 const profile=createCartonProfileNamespaces(()=>({getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)}));
 const inventory={sheet:'Inventory sample',headers:{receipt:'Location',qty:'Qty'}};
 const outbound={sheet:'Outbound sample',headers:{receipt:'Order',qty:'Qty'}};
 profile.save('first','profile','inventory',inventory);
 profile.save('second','profile','outbound',outbound);
 assert.deepEqual(profile.mappings('first','profile'),{inventory});
 assert.deepEqual(profile.mappings('second','profile'),{outbound});
 assert.deepEqual(profile.mappings('first','other-profile'),{});
});

test('deferred print cancels when the captured inspection is no longer current', async () => {
 const {createPrintSession}=await import('../src/platform/print.js');
 let releaseFonts, printCount=0, current=true;
 const document={title:'Beam',fonts:{ready:new Promise(resolve=>{releaseFonts=resolve;})}};
 const browser={addEventListener(){},print(){printCount++;}};
 const root={dataset:{}};
 const session=createPrintSession({browser,document,root,nativeTarget:()=>null});
 session.open({paper:'comparison',markup:'Count'},{
  title:'Carton A',stillCurrent:()=>current,
 });
 current=false;
 releaseFonts();
 await document.fonts.ready;
 assert.equal(printCount,0);
 assert.equal(document.title,'Beam');
 assert.equal(session.busy(),false);
});
