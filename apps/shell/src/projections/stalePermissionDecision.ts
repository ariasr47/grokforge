import { ApiError } from "../lib/api";

/** Second Allow once (or a race after the host already settled) is not a crash. */
export function isStalePermissionDecision(err: unknown): boolean {
  if (err instanceof ApiError && err.code === "decision_not_found") return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /no pending permission/i.test(msg);
}
