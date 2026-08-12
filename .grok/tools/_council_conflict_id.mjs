import crypto from 'node:crypto';

// The id binds the receipt to the exact normalized R2 file bytes as well as its conflict index.
// Any edit to the critique invalidates every receipt row sourced from that file, fail-closed.
export function councilConflictId(source, index, r2Body) {
  if (typeof source !== 'string' || !Number.isInteger(index) || index < 0 || typeof r2Body !== 'string') {
    throw new TypeError('council conflict id inputs are malformed');
  }
  return crypto.hash('sha256', `${source}\0${index}\0${r2Body}`, 'hex');
}
