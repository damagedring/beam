import { createIndexedRecoveryStore } from './indexed-recovery.js';

export const completionRetentionMs = 30 * 86_400_000;

export function createInspectionCompletionStore({
  store = createIndexedRecoveryStore(undefined, 'beam-inspection-completions'),
  now = Date.now,
} = {}) {
  function expirationCheck() {
    const cutoff = now() - completionRetentionMs;
    return entry => {
      const timestamp = typeof entry.completedAt === 'string' ? Date.parse(entry.completedAt) : NaN;
      return !Number.isFinite(timestamp) || timestamp <= cutoff;
    };
  }
  return {
    read: key => store.readCurrent(key, expirationCheck()),
    write: (entry, expected) => store.write(entry, expected),
    prune: () => store.prune(expirationCheck()),
    clear: () => store.clear(),
  };
}
