import { CATCHUP_LOAD_FAILURE, type CatchUpSignal } from "./runChangeList";

export type CatchUpMap = Record<string, CatchUpSignal>;

export type RestoreIntent =
  | "boot_hydrate"
  | "disconnect_restore"
  | "explicit_reconnect"
  | "health_poll"
  | "admission"
  | "live_ws"
  | "cancel_reconcile";

export function shouldOpenCatchUp(intent: RestoreIntent): boolean {
  return intent === "boot_hydrate" || intent === "disconnect_restore" || intent === "explicit_reconnect";
}

export function catchUpForRun(map: CatchUpMap, runId: string): CatchUpSignal {
  return map[runId] ?? { phase: "closed" };
}

export function openCatchUp(map: CatchUpMap, runId: string): CatchUpMap {
  return { ...map, [runId]: { phase: "open" } };
}

export function closeCatchUp(map: CatchUpMap, runId: string): CatchUpMap {
  return { ...map, [runId]: { phase: "closed" } };
}

export function failCatchUp(map: CatchUpMap, runId: string, message?: string): CatchUpMap {
  return { ...map, [runId]: { phase: "failed", message: message ?? CATCHUP_LOAD_FAILURE } };
}

export function appliedThroughLastEventSeq(
  projectedLastEventSeq: number,
  snapshotLastEventSeq: number,
): boolean {
  return projectedLastEventSeq >= snapshotLastEventSeq;
}
