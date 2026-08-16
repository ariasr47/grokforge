/** Test-only scheduler seam; production leaves this unset and uses 4s polling. */
let scheduler: ((poll: () => void) => (() => void)) | null = null;
export function setHealthPollTestScheduler(next: ((poll: () => void) => (() => void)) | null): void {
  scheduler = next;
}
export function installHealthPollTestScheduler(poll: () => void): (() => void) | null {
  return scheduler ? scheduler(poll) : null;
}
