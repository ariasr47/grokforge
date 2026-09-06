import { activityHumanLabel, type ActivityLabelFields } from "./activityLabel";
import { isLivePlanning } from "./runPlanSection";
import type { LiveContentKind, RunProjectionRun } from "./runReducer";

export type LivePhaseKind =
  | "tool"
  | "decision"
  | "plan"
  | "provider_wait"
  | "thinking"
  | "writing"
  | "hidden"
  | "clear";

export type DerivedLivePhase = {
  kind: LivePhaseKind;
  lastContentKind: "thought" | "message" | "tool" | null;
  liveness: "provider" | "tool" | "decision" | "background" | "journal_recovery" | null;
  planOwned: boolean;
  terminal: boolean;
  toolLabel: string | null;
};

export type DeriveLivePhaseInput = {
  terminal: boolean;
  ownedBusy: boolean;
  liveness: DerivedLivePhase["liveness"];
  planOwned: boolean;
  pendingTool: ActivityLabelFields | null;
  lastContentKind: DerivedLivePhase["lastContentKind"];
  decisionPending: boolean;
  postToolProviderWait?: boolean;
};

const RETIRED_PHASE = /Awaiting presence|Thinking field|Tools in orbit|Shaping answer|Writing answer/;

function asLiveness(value: string | null | undefined): DerivedLivePhase["liveness"] {
  if (
    value === "provider" ||
    value === "tool" ||
    value === "decision" ||
    value === "background" ||
    value === "journal_recovery"
  ) {
    return value;
  }
  return null;
}

export function lastContentKindFromRun(
  run: Pick<RunProjectionRun, "lastContentKind" | "reasoning" | "message" | "activities">,
): LiveContentKind | null {
  if (run.lastContentKind === "thought" || run.lastContentKind === "message" || run.lastContentKind === "tool") {
    return run.lastContentKind;
  }
  const pending = Object.values(run.activities ?? {}).some((a) => a.lifecycle === "pending");
  if (pending) return "tool";
  const mid = Object.values(run.message ?? {}).join("");
  if (mid.trim()) return "message";
  const thought = Object.values(run.reasoning ?? {}).join("");
  if (thought.trim()) return "thought";
  return null;
}

export function deriveLivePhase(input: DeriveLivePhaseInput): DerivedLivePhase {
  const lastContentKind = input.lastContentKind;
  const liveness = input.liveness;
  const planOwned = input.planOwned;
  const terminal = input.terminal;
  const toolLabel = input.pendingTool ? activityHumanLabel(input.pendingTool) : null;
  const base = { lastContentKind, liveness, planOwned, terminal, toolLabel };

  if (terminal || !input.ownedBusy) {
    return { ...base, kind: "clear" };
  }
  // B1 first match: (1) in-flight tool
  if (input.pendingTool || liveness === "tool") {
    return { ...base, kind: "tool" };
  }
  // (2) decision owns busy — leftover thought/message demoted
  if (liveness === "decision" || input.decisionPending) {
    return { ...base, kind: "decision", liveness: liveness === "decision" ? "decision" : liveness };
  }
  // (3) Plan-owned
  if (planOwned) {
    return { ...base, kind: "plan" };
  }
  // (4) post-tool provider-wait demotes leftover thought/message and tool title
  if (input.postToolProviderWait && (liveness === "provider" || liveness == null)) {
    return { ...base, kind: "provider_wait" };
  }
  // (5) newest live content kind
  if (lastContentKind === "thought") {
    return { ...base, kind: "thinking" };
  }
  if (lastContentKind === "message") {
    return { ...base, kind: "writing" };
  }
  // (6) provider / hidden recovery
  if (liveness === "background" || liveness === "journal_recovery") {
    return { ...base, kind: "hidden" };
  }
  return { ...base, kind: "provider_wait" };
}

export function phaseCopy(d: DerivedLivePhase): { status: string | null; footer: string | null } {
  let status: string | null = null;
  let footer: string | null = null;
  switch (d.kind) {
    case "tool":
      status = d.toolLabel || "Using tools…";
      footer = status;
      break;
    case "decision":
      // Dock owns approval chrome; stream phase does not paint Writing…/Thinking….
      status = null;
      footer = null;
      break;
    case "plan":
      status = "Planning";
      footer = "Plan · no edits applied";
      break;
    case "provider_wait":
      status = "Waiting for model…";
      footer = status;
      break;
    case "thinking":
      status = "Thinking…";
      footer = status;
      break;
    case "writing":
      status = "Writing…";
      footer = status;
      break;
    case "hidden":
    case "clear":
      status = null;
      footer = null;
      break;
  }
  if (status && RETIRED_PHASE.test(status)) status = null;
  if (footer && RETIRED_PHASE.test(footer)) footer = null;
  return { status, footer };
}

export function statusBarPhaseText(d: DerivedLivePhase): string | null {
  return phaseCopy(d).status;
}

export function composerFooterPhaseText(d: DerivedLivePhase): string | null {
  const copy = phaseCopy(d);
  return d.kind === "plan" ? copy.footer : copy.status;
}

function pendingToolFromRun(run: RunProjectionRun): ActivityLabelFields | null {
  const pending = Object.values(run.activities).find((a) => a.lifecycle === "pending");
  if (!pending) return null;
  return { title: pending.title ?? null, summary: pending.summary ?? null, name: pending.name ?? null };
}

export function deriveLivePhaseFromRun(run: RunProjectionRun | null | undefined): DerivedLivePhase {
  if (!run) {
    return deriveLivePhase({
      terminal: true,
      ownedBusy: false,
      liveness: null,
      planOwned: false,
      pendingTool: null,
      lastContentKind: null,
      decisionPending: false,
    });
  }
  const terminal = run.state === "terminal";
  return deriveLivePhase({
    terminal,
    ownedBusy: !terminal,
    liveness: asLiveness(run.liveness),
    planOwned: isLivePlanning(run),
    pendingTool: pendingToolFromRun(run),
    lastContentKind: lastContentKindFromRun(run),
    decisionPending: Object.values(run.decisions).some((d) => d.status === "pending"),
    postToolProviderWait: Boolean(run.postToolProviderWait),
  });
}
