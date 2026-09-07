export function scheduleExtractingCue(
  isPdfBatch: boolean,
  onCue: () => void,
  nowFrame: (cb: () => void) => number = (cb) =>
    requestAnimationFrame(() => cb()),
  cancelFrame: (id: number) => void = cancelAnimationFrame,
): { settle: () => void } {
  if (!isPdfBatch) return { settle() {} };
  let settled = false;
  const id = nowFrame(() => {
    if (!settled) onCue();
  });
  return {
    settle() {
      settled = true;
      cancelFrame(id);
    },
  };
}
