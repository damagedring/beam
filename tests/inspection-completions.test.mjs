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
