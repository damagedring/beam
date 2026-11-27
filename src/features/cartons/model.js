import { cartonRows, codeKey, matchCartonScan, pieceVerificationEvidence } from '../../domain/carton-verification.js';
import { quantityOutcome } from '../../domain/reconcile.js';
import { maxCompletionEvents } from '../../platform/inspection-completion-record.js';

const methodFor = box => box === null ? 'whole' : 'box';
const emptyCounts = () => ({ counts: new Map(), unknown: new Map() });
const emptyProgress = () => ({ covered: 0, excess: 0, unverified: 0 });
const emptyScope = () => ({ ...emptyCounts(), unknownCount: 0, events: [], progress: emptyProgress(), overages: [] });
const emptyJob = box => ({ method: methodFor(box), scopes: new Map(), events: [], totals: emptyCounts(), progress: emptyProgress(), done: new Set(), reviewed: new Set() });
const noMarkers = [];
const totalProgress = progress => progress.covered + progress.excess + progress.unverified;

function addProgress(target, contribution, direction = 1) {
  for (const key of Object.keys(target)) target[key] += direction * contribution[key];
}

function tallyProgress(progress, event, delta) {
  if (!event.coverageEligible) progress.unverified += delta * event.qty;
  else {
    progress.covered += delta * event.covered;
    progress.excess += delta * (event.qty - event.covered);
  }
}

function tally(projection, event, delta) {
  const map = event.key === null ? projection.unknown : projection.counts;
  const key = event.key === null ? event.value : event.key;
  const count = (map.get(key) || 0) + delta * event.qty;
  if (count === 0) map.delete(key);
  else map.set(key, count);
}

function recordScan(current, active, mode, group, box, value, at, unit, identify) {
  const match = matchCartonScan(group, box, value, 0, unit);
  if (match.status === 'conflict' || match.status === 'wrong-unit') return match.status;
  if (match.status === 'empty') return null;
  const qty = match.qty || 1, prior = match.key === null ? active.unknownCount : active.counts.get(match.key) || 0;
  const count = prior + qty, totals = match.key === null ? current.totals.unknown : current.totals.counts;
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger((totals.get(match.key ?? value) || 0) + qty) ||
      !Number.isSafeInteger(totalProgress(current.progress) + qty)) return null;
  const result = match.key === null ? 'unexpected' : quantityOutcome(prior, match.expected, qty);
  const event = {
    id: identify(), box, key: match.key, value: match.value, result, at, name: match.name, brand: match.brand, sku: match.sku,
    barcode: match.barcode, count, expected: match.expected, coverageEligible: match.coverageEligible, qty, unit,
    covered: match.coverageEligible ? Math.min(qty, Math.max(0, match.expected - prior)) : 0,
  };
  active.events.push(event);
  current.events.push(event);
  if (event.key === null) active.unknownCount++;
  tally(active, event, 1);
  tally(current.totals, event, 1);
  if (mode === 'outbound') {
    tallyProgress(active.progress, event, 1);
    tallyProgress(current.progress, event, 1);
    if (event.coverageEligible && result === 'excess') {
      active.overages.push({ covered: active.progress.covered, position: active.events.length, at: event.at,
        name: event.name, brand: event.brand, code: event.sku || event.barcode || event.value,
        actual: count, expected: match.expected, delta: count - match.expected });
    }
  }
  return result;
}

function replayCompletion(mode, group, box, events) {
  if (!Array.isArray(events) || !events.length || events.length > maxCompletionEvents) return null;
  const replay = emptyJob(box), active = emptyScope(), ids = new Set();
  for (const event of events) {
    if (!event || typeof event.value !== 'string' || !event.value.trim() || event.value.length > 200 ||
        !Number.isFinite(event.at) || Math.abs(event.at) > 8.64e15 ||
        (event.unit !== undefined && event.unit !== 'each' && (event.unit !== 'case' || mode !== 'outbound')) ||
        (event.id !== undefined && (typeof event.id !== 'string' || !event.id || ids.has(event.id)))) return null;
    const id = event.id ?? 'legacy:' + replay.events.length;
    if (ids.has(id)) return null;
    ids.add(id);
    const result = recordScan(replay, active, mode, group, box, event.value, event.at, event.unit || 'each', () => id);
    if (!result || result === 'conflict' || result === 'wrong-unit') return null;
  }
  replay.scopes.set(box, active);
  replay.done.add(box);
  return replay;
}

export function projectCartonCompletion(mode, group, box, events) {
  return replayCompletion(mode, group, box, events)?.progress ?? null;
}

export function createCartonWork(now = Date.now, newEventId = () => crypto.randomUUID()) {
  const sources = new Map();
  const job = (mode, group) => sources.get(mode)?.jobs.get(group.id);
  const scope = (mode, group, box) => job(mode, group)?.scopes.get(box);

  function connect(mode, name, index) {
    sources.set(mode, { reference: { name, index }, jobs: new Map() });
  }
  function canScan(mode, group, box) {
    const current = job(mode, group);
    return !current?.events.length || current.method === methodFor(box);
  }
  function completed(mode, group, box) {
    return !!job(mode, group)?.done.has(box);
  }
  function locked(mode, group, box) {
    return completed(mode, group, box) || !!job(mode, group)?.reviewed.has(box);
  }
  function scan(mode, group, box, input, time = now(), unit = 'each') {
    const value = codeKey(input);
    if (!value || value.length > 200 || !canScan(mode, group, box) || locked(mode, group, box)) return null;
    const jobs = sources.get(mode).jobs, current = job(mode, group) || emptyJob(box);
    const active = current.scopes.get(box) || emptyScope();
    const result = recordScan(current, active, mode, group, box, value, time, mode === 'outbound' ? unit : 'each', newEventId);
    if (result && result !== 'conflict' && result !== 'wrong-unit') {
      if (current.events.length === 1) current.method = methodFor(box);
      current.scopes.set(box, active);
      jobs.set(group.id, current);
    }
    return result;
  }
  function undo(mode, group, box) {
    const current = job(mode, group), active = scope(mode, group, box);
    if (!active?.events.length || locked(mode, group, box)) return false;
    const event = active.events.pop();
    current.events.splice(current.events.lastIndexOf(event), 1);
    tally(active, event, -1);
    if (mode === 'outbound') {
      tallyProgress(active.progress, event, -1);
      tallyProgress(current.progress, event, -1);
      if (event.coverageEligible && event.result === 'excess') active.overages.pop();
    }
    if (event.key !== null) tally(current.totals, event, -1);
    else {
      active.unknownCount--;
      // Preserve the order of the surviving unknown scans.
      current.totals.unknown.clear();
      for (const entry of current.events) if (entry.key === null) tally(current.totals, entry, 1);
    }
    return true;
  }
  function completionSnapshot(mode, group, box) {
    return scope(mode, group, box)?.events.map(({ id, value, at, unit }) => ({ id, value, at, unit })) || [];
  }
  function restoreCompletion(mode, group, box, events) {
    if (scope(mode, group, box)?.events.length || !canScan(mode, group, box)) return false;
    const replay = replayCompletion(mode, group, box, events);
    if (!replay) return false;
    const jobs = sources.get(mode).jobs, current = job(mode, group);
    if (!current || !current.events.length) {
      jobs.set(group.id, replay);
      return true;
    }
    if (!Number.isSafeInteger(totalProgress(current.progress) + totalProgress(replay.progress))) return false;
    for (const kind of ['counts', 'unknown']) {
      for (const [key, count] of replay.totals[kind]) {
        if (!Number.isSafeInteger((current.totals[kind].get(key) || 0) + count)) return false;
      }
    }
    current.scopes.set(box, replay.scopes.get(box));
    current.done.add(box);
    addProgress(current.progress, replay.progress);
    for (const event of replay.events) {
      current.events.push(event);
      tally(current.totals, event, 1);
    }
    return true;
  }
  function clearSavedCompletions() {
    for (const source of sources.values()) {
      for (const current of source.jobs.values()) {
        for (const box of current.done) current.reviewed.add(box);
        current.done.clear();
      }
    }
  }
  function outboundOrderProgress(group, saved = []) {
    const current = job('outbound', group), progress = { ...(current?.progress || emptyProgress()) };
    for (const summary of saved) {
      const local = current?.scopes.get(summary.box)?.progress;
      if (local) addProgress(progress, local, -1);
      addProgress(progress, summary.progress);
    }
    return progress;
  }
  return {
    connect, reset: mode => sources.get(mode)?.jobs.clear(), canScan, locked, scan, undo, completionSnapshot, restoreCompletion, clearSavedCompletions, outboundOrderProgress,
    reference: mode => sources.get(mode)?.reference,
    hasJobs: mode => !!sources.get(mode)?.jobs.size,
    hasScans: () => [...sources.values()].some(source => [...source.jobs.values()].some(work => work.events.some(event => !work.done.has(event.box) && !work.reviewed.has(event.box)))),
    finish: (mode, group, box) => job(mode, group)?.done.add(box),
    scopeProgress: (mode, group, box) => scope(mode, group, box)?.progress ?? emptyProgress(),
    outboundPieceEvidence: (group, box) => pieceVerificationEvidence(group, box, scope('outbound', group, box)?.events || []),
    outboundOverages: (group, box) => scope('outbound', group, box)?.overages || noMarkers,
    latest: (mode, group, box) => scope(mode, group, box)?.events.at(-1),
    recent: (mode, group, box) => {
      const list = mode === 'inventory' && box === null ? job(mode, group)?.events : scope(mode, group, box)?.events;
      return list?.slice(-8).reverse() || [];
    },
    rows: (mode, group, box) => cartonRows(group, box, box === null ? job(mode, group)?.totals : scope(mode, group, box)),
  };
}
