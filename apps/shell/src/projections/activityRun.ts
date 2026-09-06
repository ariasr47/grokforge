import type { ToolRunEvent } from "../lib/api";

export type ActivityStamp = {
  activityRunKey: string;
  activityOrder: number;
  activityIdentity: string;
};

export type LiveActivityRun = {
  epoch: number;
  activityRunKey: string;
  nextOrder: number;
  acceptingFirstSight: boolean;
  frozenDisconnected: boolean;
  seen: Map<string, ActivityStamp>;
};

export type DisclosureIntent =
  | "automatic_open"
  | "explicit_open"
  | "explicit_closed";

export type ActivityItem = {
  activityRunKey?: string;
  activityOrder?: number;
  activityIdentity?: string;
  activity?: ToolRunEvent;
};

export type ToolRunReduction =
  | { kind: "ignore"; reason: string }
  | { kind: "append"; stamp: ActivityStamp; event: ToolRunEvent }
  | { kind: "update"; stamp: ActivityStamp; event: ToolRunEvent }
  | { kind: "enrich"; stamp: ActivityStamp; detail: ToolRequestDetailEnrichment };

export type ToolRequestDetailEnrichment = {
  activityId: string;
  toolCallId: string;
  name: string | null;
  input: unknown | null;
  summary: string | null;
  command: string | null;
  shellDisplayName: string | null;
};

export function createLiveActivityRun(epoch: number, key: string): LiveActivityRun {
  return {
    epoch,
    activityRunKey: key,
    nextOrder: 0,
    acceptingFirstSight: true,
    frozenDisconnected: false,
    seen: new Map(),
  };
}

export function stampFirstSight(
  run: LiveActivityRun,
  identity: string,
): ActivityStamp | null {
  if (!identity.trim() || run.frozenDisconnected) return null;
  const prior = run.seen.get(identity);
  if (prior) return prior;
  if (!run.acceptingFirstSight) return null;
  const stamp = {
    activityRunKey: run.activityRunKey,
    activityOrder: run.nextOrder++,
    activityIdentity: identity,
  };
  run.seen.set(identity, stamp);
  return stamp;
}

export function closeFirstSights(run: LiveActivityRun): void {
  run.acceptingFirstSight = false;
}

export function freezeDisconnected(run: LiveActivityRun): void {
  run.acceptingFirstSight = false;
  run.frozenDisconnected = true;
}

export function activityIdentityFor(event: ToolRunEvent): string {
  return `tool:${event.activityId}:${event.toolCallId}`;
}

function isTerminal(event: ToolRunEvent): boolean {
  return event.lifecycle === "terminal" && event.execution !== null;
}

export function reduceToolRun(
  current: (ActivityItem & { activity?: ToolRunEvent }) | null,
  event: ToolRunEvent,
  stamp: ActivityStamp | null,
): ToolRunReduction {
  if (!event.activityId.trim() || !event.toolCallId.trim()) {
    return { kind: "ignore", reason: "empty tool identity" };
  }
  if (current?.activity && isTerminal(current.activity) && event.lifecycle === "pending" &&
      (current.activity.activityId !== event.activityId || current.activity.toolCallId !== event.toolCallId)) {
    return { kind: "ignore", reason: "mismatched result-first enrichment identity" };
  }
  if (current?.activity && isTerminal(current.activity) && event.lifecycle === "pending") {
    return {
      kind: "enrich",
      stamp: stamp ?? {
        activityRunKey: current.activityRunKey ?? "",
        activityOrder: current.activityOrder ?? 0,
        activityIdentity: current.activityIdentity ?? activityIdentityFor(event),
      },
      detail: {
        activityId: event.activityId,
        toolCallId: event.toolCallId,
        name: event.name,
        input: event.input,
        summary: event.summary,
        command: event.command,
        shellDisplayName: event.shellDisplayName,
      },
    };
  }
  if (current?.activity && isTerminal(current.activity) && !isTerminal(event)) {
    return { kind: "ignore", reason: "terminal tool cannot regress" };
  }
  if (!stamp) return { kind: "ignore", reason: "unseen activity after run close" };
  return {
    kind: current ? "update" : "append",
    stamp,
    event,
  };
}

export function mergeToolDetail(
  event: ToolRunEvent,
  detail: ToolRequestDetailEnrichment,
): ToolRunEvent {
  const fill = <T>(current: T | null, next: T | null): T | null =>
    current == null || (typeof current === "string" && current.length === 0)
      ? next
      : current;
  return {
    ...event,
    name: fill(event.name, detail.name),
    input: fill(event.input, detail.input),
    summary: fill(event.summary, detail.summary),
    command: fill(event.command, detail.command),
    shellDisplayName: fill(event.shellDisplayName, detail.shellDisplayName),
  };
}
