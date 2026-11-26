import { cartonRows, codeKey, matchCartonScan, pieceVerificationEvidence } from '../../domain/carton-verification.js';

import { quantityOutcome } from '../../domain/reconcile.js';

const methodFor = box => box === null ? 'whole' : 'box';
const emptyCounts = () => ({ counts: new Map(), unknown: new Map() });
const emptyProgress = () => ({ covered: 0, excess: 0, unverified: 0 });
const noMarkers = [];
function tallyProgress(progress, event, delta) {
  const key = !event.coverageEligible ? 'unverified' : event.result === 'excess' ? 'excess' : 'covered';
  progress[key] += delta;
}

function tally(projection, event, delta) {
  const map = event.key === null ? projection.unknown : projection.counts;
  const key = event.key === null ? event.value : event.key;
  const count = (map.get(key) || 0) + delta;
  if (count === 0) map.delete(key);
  else map.set(key, count);
}

export function createCartonWork(now = Date.now) {
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
  function locked(mode, group, box) {
    return !!job(mode, group)?.done.has(box);
  }
  function scan(mode, group, box, input) {
    const value = codeKey(input);
    if (!value || value.length > 200 || !canScan(mode, group, box) || locked(mode, group, box)) return null;
    const jobs = sources.get(mode).jobs;
    if (!jobs.has(group.id)) {
      jobs.set(group.id, { method: methodFor(box), scopes: new Map(), events: [], totals: emptyCounts(), progress: emptyProgress(), done: new Set() });
    }
    const current = jobs.get(group.id);
    const match = matchCartonScan(group, box, value);
    if (match.status === 'conflict') return 'conflict';
    if (match.status === 'empty') return null;
    if (!current.events.length) current.method = methodFor(box);
    if (!current.scopes.has(box)) current.scopes.set(box, { ...emptyCounts(), unknownCount: 0, events: [], progress: emptyProgress(), overages: [] });
    const active = current.scopes.get(box);
    const count = (match.key === null ? active.unknownCount : active.counts.get(match.key) || 0) + 1;
    const result = match.key === null ? 'unexpected' : quantityOutcome(count-1,match.expected);
    const event = { box, key: match.key, value: match.value, result, at: now(), name: match.name,
      brand: match.brand, sku: match.sku, barcode: match.barcode, count, expected: match.expected, coverageEligible: match.coverageEligible };
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
      // Rebuild unknown codes in the order of their first surviving entry.
      current.totals.unknown.clear();
      for (const entry of current.events) if (entry.key === null) tally(current.totals, entry, 1);
    }
    return true;
  }
  return {
    connect, canScan, locked, scan, undo,
    reference: mode => sources.get(mode)?.reference,
    hasJobs: mode => !!sources.get(mode)?.jobs.size,
    hasScans: () => [...sources.values()].some(source => [...source.jobs.values()].some(work => work.events.length)),
    finish: (mode, group, box) => job(mode, group)?.done.add(box),
    outboundOrderProgress: group => job('outbound', group)?.progress || emptyProgress(),
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
