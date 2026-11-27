import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { chooseCarton, enterScan, loadCartons, test } from './beam-fixture.mjs';

test('legacy migration, saved summaries, and clear share one IndexedDB transaction boundary', async ({ beam: page }) => {
  const evidence = await page.evaluate(async () => {
    const module = path => import(new URL(path, document.baseURI));
    const { createIndexedRecoveryStore } = await module('platform/indexed-recovery.js');
    const { createInspectionCompletionStore, completionRetentionMs } = await module('platform/inspection-completions.js');
    const { defaultInspectionWorkspace, savedInventoryMethod } = await module('platform/inspection-completion-record.js');
    const dbName = 'completion-test-' + crypto.randomUUID();
    const raw = createIndexedRecoveryStore(undefined, dbName);
    const otherRaw = createIndexedRecoveryStore(undefined, dbName);
    const initial = Date.parse('2026-11-10T05:00:00Z');
    const completedAt = new Date(initial).toISOString();
    let now = initial, abortMigration = false;
    const opts = { now: () => now };
    const first = createInspectionCompletionStore({ ...opts, store: {
      ...raw,
      transact(mode, run) {
        return raw.transact(mode, (records, finish) => run(records, result => {
          if (abortMigration) records.transaction.abort();
          else finish(result);
        }));
      },
    } });
    const second = createInspectionCompletionStore({ ...opts, store: otherRaw });
    const reference = { workspaceId: defaultInspectionWorkspace, workflow: 'inventory', referenceId: 'reference', workbookId: 'workbook' };
    const [run, matching] = await Promise.all([first.resume(reference), second.resume(reference)]);
    const scope = { ...run, groupId: 'LOCATION', box: null };
    const otherScope = { ...scope, box: 'CARTON' };
    const legacyKey = JSON.stringify(['v1','inventory','workbook','LOCATION',null,'0'.repeat(64)]);
    const legacy = { key: legacyKey, revision: 'v1', status: 'complete', completedAt, outcome: 'matched',
      events: [{ value: '00123', at: initial }, { value: '00123', at: initial }] };
    const candidates = [{ key: legacyKey, box: null, referenceId: reference.referenceId, eventPrefix: 'legacy:scope' }];
    const progress = { covered: 0, excess: 0, unverified: 0 };
    const project = () => progress;
    const newCompletion = { id: 'completion:synthetic-event', revision: 'synthetic-result', completedAt, outcome: 'matched',
      events: [{ id: 'synthetic-event', value: '00123', at: initial, unit: 'each' }] };

    await raw.write(legacy, null);
    abortMigration = true;
    let interrupted = false;
    try { await first.inspect(scope, candidates, project); }
    catch { interrupted = true; }
    abortMigration = false;
    const beforeRetry = { summaries: await first.summaries(run), source: await raw.read(legacyKey) };
    const migrations = await Promise.all([first.inspect(scope, candidates, project), second.inspect(scope, candidates, project)]);
    const opposite = await second.commit(otherScope, newCompletion, progress);
    const next = await second.startNewRun(run);
    const nextScope = { ...next, groupId: scope.groupId, box: scope.box };
    const otherWorkspace = await first.resume({ ...reference, workspaceId: 'isolated-test-workspace' });
    const otherWorkspaceScope = { ...otherWorkspace, groupId: scope.groupId, box: scope.box };
    const originalSummaries = await first.summaries(run);
    const originalRecord = await first.readHistorical(scope);
    const newRead = await first.inspect(nextScope, candidates, project);
    const isolatedRead = await first.inspect(otherWorkspaceScope);
    const mustConflict = await first.commit(scope, newCompletion, progress);
    const isolatedSave = await first.commit(otherWorkspaceScope, newCompletion, progress);
    const isolatedSummaries = await first.summaries(otherWorkspace);
    now = initial + completionRetentionMs - 1;
    const beforeExpiration = await first.summaries(run);
    now++;
    const atExpiration = await first.summaries(run);

    now = initial;
    await second.clear();
    const waiting = await first.resume(reference);
    const waitingScope = { ...waiting, groupId: scope.groupId, box: scope.box };
    await raw.write(legacy, null);
    const pendingKeys = await first.legacyKeys(waitingScope);
    const pendingSource = await raw.read(legacyKey);
    const lateCandidates = candidates.filter(candidate => pendingKeys.includes(candidate.key));
    await second.clear();
    const delayed = await first.inspect(waitingScope, lateCandidates, project);
    const restarted = await second.resume(reference);
    const restartedScope = { ...restarted, groupId: scope.groupId, box: scope.box };
    const noResurrection = await first.inspect(restartedScope, lateCandidates, project);
    const newMethod = await first.commit({ ...restartedScope, box: 'CARTON' }, newCompletion, progress);
    return {
      sameRun: JSON.stringify(run) === JSON.stringify(matching),
      interruption: interrupted && beforeRetry.summaries.length === 0 && beforeRetry.source?.key === legacyKey,
      sameMigration: JSON.stringify(migrations[0]) === JSON.stringify(migrations[1]),
      oldTimestamp: migrations[0].record?.completedAt,
      legacyEvents: migrations[0].record?.events,
      opposite, distinctRun: next.runId !== run.runId, newRunSummaryCount: newRead.summaries.length,
      nextResumed: (await first.resume(reference)).runId === restarted.runId,
      originalSummaryCount: originalSummaries.length, originalRecordId: originalRecord?.id,
      isolated: isolatedRead.summaries.length === 0 && isolatedSave === 'saved' && isolatedSummaries.length === 1,
      mustConflict, beforeExpiration: beforeExpiration.length, atExpiration: atExpiration.length,
      sourceWasRead: pendingSource?.key === legacyKey, delayed, noResurrection,
      newMethod, retainedMethod: savedInventoryMethod(await first.summaries(restarted)),
    };
  });
  expect(evidence).toMatchObject({
    sameRun: true, interruption: true, sameMigration: true,
    oldTimestamp: '2026-11-10T05:00:00.000Z',
    legacyEvents: [{ id: 'legacy:scope:0', value: '00123', unit: 'each' }, { id: 'legacy:scope:1', value: '00123', unit: 'each' }],
    opposite: 'method-conflict', distinctRun: true, newRunSummaryCount: 0, nextResumed: true,
    originalSummaryCount: 1, originalRecordId: 'legacy:scope', isolated: true, mustConflict: 'stale', beforeExpiration: 1, atExpiration: 0,
    sourceWasRead: true, delayed: { record: null, summaries: [], issue: 'stale' },
    noResurrection: { record: null, summaries: [], issue: null },
    newMethod: 'saved', retainedMethod: 'box',
  });
});


test('overlapping legacy Location methods are preserved and opened read-only', async ({ beam: page }) => {
  const workbook = await readFile(new URL('../fixtures/cartons.xlsx', import.meta.url));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const value = '0001234567890', at = Date.parse('2026-04-19T00:00:00Z');
  const entries = [[null, 5], ['BOX-1', 3]].map(([box, qty]) => ({
    key: JSON.stringify(['v1', 'inventory', sha(workbook), 'LOC-1', box, sha(JSON.stringify([[JSON.stringify(['SKU-1', value]), qty]]))]),
    revision: 'v1', status: 'complete', outcome: 'matched', completedAt: new Date(at).toISOString(),
    events: Array.from({ length: qty }, () => ({ value, at })),
  }));
  await page.evaluate(async legacy => {
    const { createIndexedRecoveryStore } = await import(new URL('platform/indexed-recovery.js', document.baseURI));
    const store = createIndexedRecoveryStore(undefined, 'beam-inspection-completions');
    for (const entry of legacy) await store.write(entry, null);
  }, entries);
  await loadCartons(page, 'Inventory');
  await chooseCarton(page, 'BOX-1');
  await expect(page.locator('#cartonFeedback')).toContainText('읽기 전용');
  await expect(page.locator('#cartonScan')).toBeDisabled();
  await expect(page.locator('#cartonCount')).toContainText('0 / 3');
  await page.locator('#cartonScopes button').first().click();
  await expect(page.locator('#cartonFeedback')).toContainText('충돌');
  await expect(page.locator('#cartonCount')).toContainText('0 / 5');
  const preserved = await page.evaluate(async keys => {
    const { createIndexedRecoveryStore } = await import(new URL('platform/indexed-recovery.js', document.baseURI));
    const store = createIndexedRecoveryStore(undefined, 'beam-inspection-completions');
    return Promise.all(keys.map(async key => (await store.read(key))?.events.length));
  }, entries.map(entry => entry.key));
  expect(preserved).toEqual([5, 3]);
});

test('a rejected Finish keeps its scans and can be retried without a duplicate result', async ({ beam: page }) => {
  await loadCartons(page, 'Inventory');
  await chooseCarton(page, 'BOX-1');
  const scan = page.locator('#cartonScan');
  for (let i = 0; i < 3; i++) await enterScan(scan, '0001234567890');
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const tx = transaction.call(this, stores, mode, options);
      if (this.name === 'beam-inspection-completions' && mode === 'readwrite') {
        IDBDatabase.prototype.transaction = transaction;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
  await page.locator('#cartonFinish').click();
  await expect(page.locator('#cartonFeedback')).toContainText('저장하지 못했어요');
  await expect(page.locator('#cartonCount')).toContainText('3 / 3');
  await expect(scan).toBeEnabled();
  await page.locator('#cartonFinish').click();
  await expect(page.locator('#cartonFeedback')).toHaveText('검수를 완료했어요.');
  await expect(scan).toBeDisabled();
  await page.reload();
  await loadCartons(page, 'Inventory');
  await chooseCarton(page, 'BOX-1');
  await expect(page.locator('#cartonCount')).toContainText('3 / 3');
  await expect(page.locator('#cartonFeedback')).toHaveText('검수를 완료했어요.');
});


test('starting a new run keeps an unvisited legacy scope readable until expiration or clear', async ({ beam: page }) => {
  const actual = await page.evaluate(async () => {
    const module = path => import(new URL(path, document.baseURI));
    const { createIndexedRecoveryStore } = await module('platform/indexed-recovery.js');
    const { createInspectionCompletionStore, completionRetentionMs } = await module('platform/inspection-completions.js');
    const { defaultInspectionWorkspace } = await module('platform/inspection-completion-record.js');
    const { createCartonReferenceIdentity } = await module('features/cartons/reference.js');
    const { createCartonIndex } = await module('domain/carton-verification.js');

    let now = Date.parse('2026-04-19T01:00:00Z');
    const completedAt = new Date(now).toISOString(), at = now - 5000;
    const source = { index: createCartonIndex([
      { group: 'ORDER', box: 'BOX', barcode: 'ITEM', sku: 'SKU', name: 'Example', qty: 12, verification: { unit: 'case', caseBarcode: 'CASE', unitsPerCase: 6 } },
    ]) };
    const raw = createIndexedRecoveryStore(undefined, 'completion-history-test-' + crypto.randomUUID());
    const repo = createInspectionCompletionStore({ store: raw, now: () => now });
    const identity = createCartonReferenceIdentity();
    identity.associate(source, new File(['Synthetic reference bytes'], 'example.xlsx'));
    const reference = { workspaceId: defaultInspectionWorkspace, workflow: 'outbound', ...await identity.reference(source) };
    const group = source.index.groups.get('ORDER');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([[JSON.stringify(['SKU', 'ITEM']), 12, 'CASE', 6]])));
    const manifest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = JSON.stringify(['v1', 'outbound', reference.workbookId, group.id, 'BOX', manifest]);
    const record = { key, revision: 'v1', status: 'complete', completedAt, outcome: 'matched',
      events: [{ value: 'CASE', unit: 'case', at }, { value: 'CASE', unit: 'case', at }] };
    await raw.write(record, null);

    const old = await repo.resume(reference);
    const scope = { ...old, groupId: group.id, box: 'BOX' };
    const next = await repo.startNewRun(old);
    const current = { ...next, groupId: scope.groupId, box: scope.box };
    const unrelated = await repo.resume({ ...reference, workspaceId: 'other-test-workspace' });
    const isolated = { ...unrelated, groupId: scope.groupId, box: scope.box };

    const candidates = await identity.legacyScopes(scope, group, await repo.legacyKeys(scope));
    const keys = () => raw.transact('readonly', (records, finish) => {
      const request = records.getAllKeys();
      request.onsuccess = () => finish(request.result);
    });
    const keysBefore = await keys();
    const saved = await repo.readHistorical(scope, candidates);
    const wrongRevision = await repo.readHistorical(scope, candidates.map(candidate => ({ ...candidate, referenceId: 'another-interpretation' })));
    const isolatedHistory = await repo.readHistorical(isolated, candidates);
    const currentInspection = await repo.inspect(current, candidates, () => ({ covered: 12, excess: 0, unverified: 0 }));
    const historicalSummaries = await repo.summaries(old);
    const sourceAfter = await raw.read(key);
    const keysAfter = await keys();

    now = Date.parse(completedAt) + completionRetentionMs;
    const expired = await repo.readHistorical(scope, candidates);
    now = Date.parse(completedAt);
    await repo.clear();
    const cleared = await repo.readHistorical(scope, candidates);
    const recreated = await repo.resume(reference);
    await raw.write(record, null);
    const oldGeneration = await repo.readHistorical(scope, candidates);
    return {
      sameBytes: JSON.stringify(record) === JSON.stringify(sourceAfter),
      noWrites: JSON.stringify(keysBefore) === JSON.stringify(keysAfter),
      differentRun: old.runId !== next.runId,
      differentGeneration: recreated.generation !== old.generation,
      historical: { completedAt: saved?.completedAt, events: saved?.events, distinctIds: saved?.events[0].id !== saved?.events[1].id },
      currentInspection, isolatedHistory, historicalSummaries, wrongRevision, expired, cleared, oldGeneration,
    };
  });
  expect(actual).toMatchObject({
    sameBytes: true, noWrites: true, differentRun: true, differentGeneration: true,
    historical: {
      completedAt: '2026-04-19T01:00:00.000Z', distinctIds: true,
      events: [{ value: 'CASE', unit: 'case', at: Date.parse('2026-04-19T00:59:55Z') },
        { value: 'CASE', unit: 'case', at: Date.parse('2026-04-19T00:59:55Z') }],
    },
    currentInspection: { record: null, summaries: [], issue: null },
    isolatedHistory: null, historicalSummaries: [], wrongRevision: null, expired: null, cleared: null, oldGeneration: null,
  });
});
