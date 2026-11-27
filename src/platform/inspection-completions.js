// @ts-check

import { createIndexedRecoveryStore } from './indexed-recovery.js';
import { completionRetentionMs, completionSummary, decodeInspectionCompletion, defaultInspectionWorkspace, encodeInspectionCompletion, isCompletionSummary, savedInventoryMethod } from './inspection-completion-record.js';

export { completionRetentionMs };

/** @typedef {import('./inspection-completion-record.js').InspectionCompletionRepository} InspectionCompletionRepository */

/** @typedef {import('./inspection-completion-record.js').InspectionReference} InspectionReference */
/** @typedef {import('./inspection-completion-record.js').InspectionRun} InspectionRun */
/** @typedef {import('./inspection-completion-record.js').InspectionScope} InspectionScope */
/** @typedef {import('./inspection-completion-record.js').InspectionRead} InspectionRead */
/** @typedef {import('./inspection-completion-record.js').InspectionProgress} InspectionProgress */
/** @typedef {import('./inspection-completion-record.js').InspectionEvent} InspectionEvent */
/** @typedef {import('./inspection-completion-record.js').InspectionCompletion} InspectionCompletion */
/** @typedef {import('./inspection-completion-record.js').CompletionSummary} CompletionSummary */
/** @typedef {import('./inspection-completion-record.js').LegacyScope} LegacyScope */
/** @typedef {Record<string, unknown>} StoredValue */
/** @typedef {(value: StoredValue) => boolean} ExpirationCheck */
/**
 * @typedef {{
 *   transact: <Result>(mode: 'readonly' | 'readwrite', run: (store: IDBObjectStore, finish: (result: Result) => void) => void) => Promise<Result>,
 *   readCurrent(key: string, expired: ExpirationCheck): Promise<unknown>,
 *   prune(expired: ExpirationCheck): Promise<void>,
 *   clear(): Promise<void>,
 * }} CompletionStorage
 */

/** @param {InspectionReference} reference */
const runKey = reference => JSON.stringify(['inspection-run', reference.workspaceId, reference.workflow, reference.referenceId]);
/** @param {string} type @param {InspectionRun} run */
const ownedByRun = (type, run) => [type, run.workspaceId, run.workflow, run.referenceId, run.runId];
/** @param {string} type @param {InspectionScope} scope */
const scopeKey = (type, scope) => JSON.stringify([...ownedByRun(type, scope), scope.groupId, scope.box]);
/** @param {string} key */
const migrationKey = key => JSON.stringify(['inspection-migrated', key]);
/** @template T @param {IDBRequest<T>} request @param {(result: T) => void} accept */
const apply = (request, accept) => { request.onsuccess = () => accept(request.result); };

/**
 * @param {{store?: CompletionStorage, now?: () => number, newId?: () => string, keyRange?: (lower: string, upper: string) => IDBKeyRange}} [options]
 * @returns {InspectionCompletionRepository & {read(key: string): Promise<unknown>}}
 */
export function createInspectionCompletionStore({
  store = /** @type {CompletionStorage} */ (createIndexedRecoveryStore(undefined, 'beam-inspection-completions')),
  now = Date.now,
  newId = () => crypto.randomUUID(),
  keyRange = (lower, upper) => IDBKeyRange.bound(lower, upper),
} = {}) {
  /** @param {string[]} parts */
  function prefix(parts) {
    const lower = JSON.stringify(parts).slice(0, -1) + ',';
    return keyRange(lower, lower + '\uffff');
  }

  /** @returns {ExpirationCheck} */
  function expirationCheck() {
    const cutoff = now() - completionRetentionMs;
    return entry => {
      const timestamp = typeof entry.completedAt === 'string' ? Date.parse(entry.completedAt) : NaN;
      if (Number.isFinite(timestamp)) return timestamp <= cutoff;
      return !entry.kind && entry.schemaVersion === undefined && !(typeof entry.key === 'string' && entry.key.startsWith('["v1",'));
    };
  }

  /** @param {InspectionReference} reference @param {boolean} allowLegacy @returns {InspectionRun} */
  function createRun(reference, allowLegacy) {
    const generation = newId();
    return {
      workspaceId: reference.workspaceId,
      workflow: reference.workflow,
      referenceId: reference.referenceId,
      workbookId: reference.workbookId,
      runId: allowLegacy ? 'legacy:' + reference.referenceId : generation,
      generation,
      legacy: allowLegacy,
    };
  }

  // The active run pointer is created in one serialized read/write transaction.
  /** @param {InspectionReference} reference @returns {Promise<InspectionRun>} */
  function resume(reference) {
    const key = runKey(reference);
    return store.transact('readwrite', (records, finish) => {
      apply(records.get(key), existing => {
        if (existing) {
          if (existing.kind !== 'run' || !existing.run?.generation) throw Error('Unsupported inspection run');
          finish(existing.run);return;
        }
        const run = createRun(reference, reference.workspaceId === defaultInspectionWorkspace);
        records.add({ key, kind: 'run', run });
        finish(run);
      });
    });
  }

  /** @param {InspectionRun} previous @returns {Promise<InspectionRun | null>} */
  function startNewRun(previous) {
    const key = runKey(previous);
    return store.transact('readwrite', (records, finish) => {
      apply(records.get(key), existing => {
        if (existing?.run?.generation !== previous.generation) { finish(null); return; }
        const run = createRun(previous, false);
        records.put({ key, kind: 'run', run });
        finish(run);
      });
    });
  }

  /** @param {InspectionScope} scope @returns {Promise<string[]>} */
  function legacyKeys(scope) {
    if (!scope.legacy) return Promise.resolve([]);
    return store.transact('readonly', (records, finish) => {
      apply(records.getAllKeys(prefix(['v1', scope.workflow, scope.workbookId, scope.groupId])), keys => finish(keys.filter(key => typeof key === 'string')));
    });
  }

  /** @param {IDBObjectStore} records @param {InspectionRun} run @param {ExpirationCheck} expired @param {(rows: CompletionSummary[]) => void} accept @param {string} [groupId] */
  function listSummaries(records, run, expired, accept, groupId) {
    const parts = ownedByRun('inspection-summary', run);
    if (groupId !== undefined) parts.push(groupId);
    apply(records.getAll(prefix(parts)), rows => accept(rows.filter(isCompletionSummary).filter(row => !expired(row))));
  }

  /** @param {InspectionRun} run @returns {Promise<CompletionSummary[]>} */
  function summaries(run) {
    return store.transact('readonly', (records, finish) => listSummaries(records, run, expirationCheck(), finish));
  }

  /** @param {InspectionScope} scope @returns {ReturnType<InspectionCompletionRepository['readHistorical']>} */
  function readHistorical(scope) {
    const expired = expirationCheck();
    return store.transact('readonly', (records, finish) => {
      apply(records.get(scopeKey('inspection-record', scope)), record => {
        finish(record && !expired(record) && decodeInspectionCompletion(record, scope.workflow).status === 'ready' ? record : null);
      });
    });
  }

  /** @param {IDBObjectStore} records @param {InspectionScope} scope @param {InspectionCompletion} completion @param {InspectionProgress} progress */
  function writeCompletion(records, scope, completion, progress) {
    const record = encodeInspectionCompletion(scopeKey('inspection-record', scope), completion);
    records.put(record);
    records.put(completionSummary(scopeKey('inspection-summary', scope), scope, completion, progress));
    return record;
  }

  /** @param {InspectionScope} scope @param {LegacyScope[]} [candidates] @param {(box: string | null, events: InspectionEvent[]) => InspectionProgress | null} [project] @returns {Promise<InspectionRead>} */
  function inspect(scope, candidates = [], project = () => null) {
    return store.transact('readwrite', (records, finish) => {
      const expired = expirationCheck();
      apply(records.get(runKey(scope)), current => {
        if (current?.run?.generation !== scope.generation) {
          finish({ record: null, summaries: [], issue: 'stale' });
          return;
        }
        let invalid = false;
        const selectedKey = scopeKey('inspection-record', scope);
        // Re-read the legacy source here. A list of keys from before a clear is
        // only a set of candidates and cannot re-create missing records.
        /** @param {number} index */
        function migrate(index) {
          if (index >= candidates.length) {
            apply(records.get(selectedKey), entry => {
              const record = entry && !expired(entry) ? entry : null;
              if (record && decodeInspectionCompletion(record, scope.workflow).status !== 'ready') invalid = true;
              listSummaries(records, scope, expired, summaries => finish({
                record: invalid ? null : record, summaries: invalid ? summaries.filter(row => row.box !== scope.box) : summaries,
                issue: invalid ? 'invalid' : null,
              }), scope.groupId);
            });
            return;
          }
          const candidate = candidates[index];
          const next = () => migrate(index + 1);
          const destination = { ...scope, box: candidate.box };
          const markerKey = migrationKey(candidate.key);
          apply(records.get(markerKey), marker => {
            if (marker) { next(); return; }
            apply(records.get(candidate.key), source => {
              if (!source || expired(source)) { next(); return; }
              const decoded = decodeInspectionCompletion(source, scope.workflow, candidate.eventPrefix);
              const progress = decoded.status === 'ready' ? project(candidate.box, decoded.completion.events) : null;
              if (!progress || decoded.status !== 'ready') {
                if (scope.box === candidate.box) invalid = true;
                next();
                return;
              }
              apply(records.get(scopeKey('inspection-record', destination)), existing => {
                if (!existing || expired(existing)) {
                  writeCompletion(records, destination, decoded.completion, progress);
                  records.add({ key: markerKey, completedAt: decoded.completion.completedAt });
                }
                next();
              });
            });
          });
        }
        migrate(0);
      });
    });
  }

  /** @param {InspectionScope} scope @param {InspectionCompletion} completion @param {InspectionProgress} progress @returns {ReturnType<InspectionCompletionRepository['commit']>} */
  function commit(scope, completion, progress) {
    return store.transact('readwrite', (records, finish) => {
      const expired = expirationCheck();
      apply(records.get(runKey(scope)), current => {
        if (current?.run?.generation !== scope.generation) { finish('stale'); return; }
        apply(records.get(scopeKey('inspection-record', scope)), existing => {
          if (existing && !expired(existing)) { finish('scope-conflict'); return; }
          listSummaries(records, scope, expired, entries => {
            const method = scope.workflow === 'inventory' ? savedInventoryMethod(entries) : null;
            if (method && method !== (scope.box === null ? 'whole' : 'box')) { finish('method-conflict'); return; }
            writeCompletion(records, scope, completion, progress);
            finish('saved');
          }, scope.groupId);
        });
      });
    });
  }

  return {
    resume, startNewRun, legacyKeys, inspect, summaries, readHistorical, commit,
    read: key => store.readCurrent(key, expirationCheck()),
    prune: () => store.prune(expirationCheck()),
    clear: () => store.clear(),
  };
}
