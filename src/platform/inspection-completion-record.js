// @ts-check

/** @typedef {'outbound' | 'inventory'} InspectionWorkflow */
/** @typedef {{workspaceId: string, workflow: InspectionWorkflow, referenceId: string, workbookId: string}} InspectionReference */
/** @typedef {InspectionReference & {runId: string, generation: string, legacy: boolean}} InspectionRun */
/** @typedef {InspectionRun & {groupId: string, box: string | null}} InspectionScope */
/** @typedef {{id: string, value: string, at: number, unit: 'each' | 'case'}} InspectionEvent */
/** @typedef {{covered: number, excess: number, unverified: number}} InspectionProgress */
/** @typedef {{id: string, revision: string, completedAt: string, outcome: 'matched' | 'difference', events: InspectionEvent[]}} InspectionCompletion */
/** @typedef {InspectionCompletion & {schemaVersion: 2, key: string, status: 'complete'}} CompletionRecord */
/** @typedef {{schemaVersion: 2, key: string, groupId: string, box: string | null, revision: string, completedAt: string, progress: InspectionProgress}} CompletionSummary */
/** @typedef {{key: string, box: string | null, eventPrefix: string}} LegacyScope */
/** @typedef {{status: 'missing'} | {status: 'unsupported'} | {status: 'ready', completion: InspectionCompletion}} DecodedCompletion */
/** @typedef {{record: CompletionRecord | null, summaries: CompletionSummary[], issue: 'stale' | 'invalid' | null}} InspectionRead */
/** @typedef {{resume(reference: InspectionReference): Promise<InspectionRun>, startNewRun(run: InspectionRun): Promise<InspectionRun | null>, legacyKeys(scope: InspectionScope): Promise<string[]>, inspect(scope: InspectionScope, legacy?: LegacyScope[], project?: (box: string | null, events: InspectionEvent[]) => InspectionProgress | null): Promise<InspectionRead>, summaries(run: InspectionRun): Promise<CompletionSummary[]>, readHistorical(scope: InspectionScope): Promise<CompletionRecord | null>, commit(scope: InspectionScope, completion: InspectionCompletion, progress: InspectionProgress): Promise<'saved' | 'scope-conflict' | 'method-conflict' | 'stale'>, prune(): Promise<void>, clear(): Promise<void>}} InspectionCompletionRepository */

export const defaultInspectionWorkspace = '43fb3e9a-d22f-4d47-a697-975c28a30ff4';
export const completionSchemaVersion = 2;
export const maxCompletionEvents = 200000;
export const completionRetentionMs = 30 * 86_400_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string} */
const nonempty = value => typeof value === 'string' && value.length > 0;

/** @param {unknown} value @returns {value is number} */
const eventTime = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;

/**
 * A legacy scope supplies its own immutable event ID prefix. Occurrences are
 * identified by position so equal scans at the same time remain distinct.
 * @param {unknown} raw
 * @param {InspectionWorkflow} workflow
 * @param {string} [legacyPrefix]
 * @returns {DecodedCompletion}
 */
export function decodeInspectionCompletion(raw, workflow, legacyPrefix) {
  if (raw === undefined || raw === null) return { status: 'missing' };
  const legacy = legacyPrefix !== undefined;
  if (!object(raw) || raw.status !== 'complete' ||
      (legacy ? raw.schemaVersion !== undefined || raw.revision !== 'v1' : raw.schemaVersion !== completionSchemaVersion) ||
      !nonempty(raw.revision) || !nonempty(raw.completedAt) || !Number.isFinite(Date.parse(raw.completedAt)) ||
      (raw.outcome !== 'matched' && raw.outcome !== 'difference') ||
      !Array.isArray(raw.events) || !raw.events.length || raw.events.length > maxCompletionEvents) return { status: 'unsupported' };

  const resultId = legacy ? legacyPrefix : raw.id;
  if (!nonempty(resultId)) return { status: 'unsupported' };

  /** @type {InspectionEvent[]} */
  const events = [];
  const ids = new Set();
  for (const entry of raw.events) {
    if (!object(entry) || !nonempty(entry.value) || !entry.value.trim() || entry.value.length > 200 || !eventTime(entry.at)) {
      return { status: 'unsupported' };
    }
    const unit = legacy && entry.unit === undefined ? 'each' : entry.unit;
    if ((unit !== 'case' && unit !== 'each') || (unit === 'case' && workflow !== 'outbound')) return { status: 'unsupported' };
    const id = legacy ? legacyPrefix + ':' + events.length : entry.id;
    if (!nonempty(id) || ids.has(id)) return { status: 'unsupported' };
    ids.add(id);
    events.push({ id, value: entry.value, at: entry.at, unit });
  }
  return {
    status: 'ready',
    completion: { id: resultId, revision: legacy ? legacyPrefix : raw.revision, completedAt: raw.completedAt, outcome: raw.outcome, events },
  };
}

/** @param {string} key @param {InspectionCompletion} completion @returns {CompletionRecord} */
export function encodeInspectionCompletion(key, completion) {
  return { ...completion, key, schemaVersion: completionSchemaVersion, status: 'complete' };
}

/** @param {string} key @param {InspectionScope} scope @param {InspectionCompletion} completion @param {InspectionProgress} progress @returns {CompletionSummary} */
export function completionSummary(key, scope, completion, progress) {
  return { key, schemaVersion: completionSchemaVersion, groupId: scope.groupId, box: scope.box, revision: completion.revision, completedAt: completion.completedAt, progress };
}

/** @param {CompletionSummary[]} summaries @returns {'whole' | 'box' | 'conflict' | null} */
export function savedInventoryMethod(summaries) {
  const whole = summaries.some(summary => summary.box === null);
  const cartons = summaries.some(summary => summary.box !== null);
  return whole ? cartons ? 'conflict' : 'whole' : cartons ? 'box' : null;
}

/** @param {unknown} value @returns {value is CompletionSummary} */
export function isCompletionSummary(value) {
  if (!object(value) || value.schemaVersion !== completionSchemaVersion || !nonempty(value.key) ||
      !nonempty(value.groupId) || (value.box !== null && !nonempty(value.box)) ||
      !nonempty(value.revision) || !nonempty(value.completedAt) || !Number.isFinite(Date.parse(value.completedAt)) ||
      !object(value.progress)) return false;
  const { covered, excess, unverified } = value.progress;
  return [covered, excess, unverified].every(amount => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0);
}
