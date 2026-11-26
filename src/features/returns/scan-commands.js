import { entryOutcome, eventCode, readScanIndex } from '../../domain/reconcile.js';

export function createReturnsScanCommands({ current, identity, routing, effects }) {
  function register(input) {
    if (!routing.canRegister()) return false;
    const work = current();
    const assigned = readScanIndex(work.scans);
    const pending = work.pending ??= [];
    const held = readScanIndex(pending);
    if (!Number.isSafeInteger(input.qty) || input.qty < 1 || !Number.isSafeInteger(assigned.total + held.total + input.qty)) {
      effects.notice('입력 수량을 확인하세요.', 'error');
      return false;
    }
    const value = eventCode(input);
    if (!value || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) {
      effects.notice('식별자는 1~128자의 한 줄 텍스트여야 합니다.', 'error');
      return false;
    }
    work.currentBatch ??= identity.id();
    const event = { ...input, id: identity.id(), batch: work.currentBatch, at: identity.now(),
      sequence: Math.max(assigned.sequence, held.sequence) + 1,
      scanOutcome: entryOutcome(work.data, work.receipt, work.scans, input) };
    let outcome = event.scanOutcome;
    if (!work.receipt) {
      const store = routing.storeKey();
      if (store) event.workStoreKey = store;
      pending.push(event);
      effects.audit('ASN 배정 대기', [event]);
      effects.changed();
      if (routing.autoAssign()) outcome = routing.event(event.id)?.scanOutcome || outcome;
      else {
        effects.draw();
        effects.pendingFeedback();
      }
    } else {
      const origin = work.receipt;
      event.receipt = origin;
      work.scans.push(event);
      effects.audit(event.kind === 'sku' ? '수동 입력' : '스캔', [event], origin);
      effects.lastEvent(event);
      let moved = false;
      if (work.searchMode !== 'b2c' && (outcome === 'unknown' || outcome === 'excess')) {
        if (outcome === 'unknown') routing.stageOutside(event);
        moved = routing.moveUnique(event.id);
        const final = routing.event(event.id);
        outcome = final?.receipt ? final.scanOutcome : 'held';
      }
      effects.changed();
      effects.draw(!moved);
      effects.assignedFeedback({ value, quantity: event.qty, moved, outcome });
    }
    effects.audio(outcome);
    effects.notice('');
    return true;
  }

  function undo(event) {
    if (!event) return false;
    const work = current();
    work.scans = work.scans.filter(candidate => candidate !== event);
    work.pending = (work.pending || []).filter(candidate => candidate !== event);
    effects.audit(event.receipt ? '오더 최근 입력 취소' : '매장 미배정 최근 입력 취소', [event], event.receipt || '');
    effects.changed();
    effects.draw();
    return true;
  }

  function reset() {
    const work = current(), { receipt } = work;
    effects.audit('ASN 스캔 초기화', work.scans.filter(event => event.receipt === receipt), receipt);
    work.scans = work.scans.filter(event => event.receipt !== receipt);
    effects.changed();
    effects.draw();
  }

  return { register, undo, reset };
}
