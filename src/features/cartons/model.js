import { cartonRows, codeKey, matchCartonScan, pieceVerificationEvidence } from '../../domain/carton-verification.js';

import { quantityOutcome } from '../../domain/reconcile.js';

const methodFor = box => box === null ? 'whole' : 'box';
const emptyCounts = () => ({ counts: new Map(), unknown: new Map() });
const emptyProgress = () => ({ covered: 0, excess: 0, unverified: 0 });
const noMarkers = [];
function tallyProgress(progress, event, delta) {
  if(!event.coverageEligible)progress.unverified+=delta*event.qty;
  else {
    progress.covered+=delta*event.covered;
    progress.excess+=delta*(event.qty-event.covered);
  }
}

function tally(projection, event, delta) {
  const map = event.key === null ? projection.unknown : projection.counts;
  const key = event.key === null ? event.value : event.key;
  const count = (map.get(key) || 0) + delta*event.qty;
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
  function scan(mode, group, box, input, time = now(), unit = 'each') {
    const value = codeKey(input);
    if (!value || value.length > 200 || !canScan(mode, group, box) || locked(mode, group, box)) return null;
    const match = matchCartonScan(group,box,value,0,mode==='outbound'?unit:'each');
    if(match.status==='conflict'||match.status==='wrong-unit')return match.status;
    if(match.status==='empty')return null;
    const jobs=sources.get(mode).jobs,existing=scope(mode,group,box);
    const qty=match.qty||1,prior=match.key===null?(existing?.unknownCount||0):(existing?.counts.get(match.key)||0),count=prior+qty;
    if(!Number.isSafeInteger(count))return null;
    if(!jobs.has(group.id))jobs.set(group.id,{method:methodFor(box),scopes:new Map(),events:[],totals:emptyCounts(),progress:emptyProgress(),done:new Set()});
    const current=jobs.get(group.id);
    if(!current.events.length)current.method=methodFor(box);
    if(!current.scopes.has(box))current.scopes.set(box,{...emptyCounts(),unknownCount:0,events:[],progress:emptyProgress(),overages:[]});
    const active=current.scopes.get(box);
    const result=match.key===null?'unexpected':quantityOutcome(prior,match.expected,qty);
    const event={box,key:match.key,value:match.value,result,at:time,name:match.name,brand:match.brand,sku:match.sku,barcode:match.barcode,count,expected:match.expected,
     coverageEligible:match.coverageEligible,qty,unit:mode==='outbound'?unit:'each',
     covered:match.coverageEligible?Math.min(qty,Math.max(0,match.expected-prior)):0};
    if(!Number.isSafeInteger((current.totals.counts.get(event.key)||0)+qty)||
       !Number.isSafeInteger(current.progress.covered+current.progress.excess+current.progress.unverified+qty))return null;
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
  function completionSnapshot(mode,group,box){
    const active=scope(mode,group,box);
    return active?.events.map(({value,at,unit})=>({value,at,...(unit==='case'?{unit}:{})}))||[];
  }
  function restoreCompletion(mode,group,box,events){
    if(!Array.isArray(events)||!events.length||events.length>200000||scope(mode,group,box)?.events.length||!canScan(mode,group,box))return false;
    if(events.some(e=>!e||typeof e.value!=='string'||!e.value.trim()||e.value.length>200||!Number.isFinite(e.at)||Math.abs(e.at)>8.64e15||
      (e.unit!==undefined&&(e.unit!=='case'||mode!=='outbound'))||
      ['empty','conflict','wrong-unit'].includes(matchCartonScan(group,box,e.value,0,e.unit||'each').status)))return false;
    for(const {value,at,unit} of events)scan(mode,group,box,value,at,unit||'each');
    job(mode,group).done.add(box);
    return true;
  }
  return {
    connect, canScan, locked, scan, undo, completionSnapshot, restoreCompletion,
    reference: mode => sources.get(mode)?.reference,
    hasJobs: mode => !!sources.get(mode)?.jobs.size,
    hasScans: () => [...sources.values()].some(source => [...source.jobs.values()].some(work => work.events.some(event=>!work.done.has(event.box)))),
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
