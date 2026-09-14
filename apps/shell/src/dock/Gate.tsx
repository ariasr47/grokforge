import { useRef, useState, type ReactNode } from "react";
import type { PlanProposedMember } from "../projections/runReducer";
import { matchTrustedCommandClassId, trustedCommandClassLabel } from "../projections/trustedCommandProvenance";
import { Button } from "../ui/Button";
import {
  GATE_ALLOW,
  GATE_ASK_POLICY,
  GATE_ASK_TITLE,
  GATE_DENY,
  GATE_EDIT_COMMAND,
  GATE_PLAN_POLICY,
  GATE_SHELL_POLICY,
  GATE_SHELL_TITLE,
  GATE_TRUST_FOLDER,
  GATE_WRITE_POLICY,
  GATE_WRITE_TITLE,
  PLAN_ACCEPT,
  PLAN_DOCK_EMPTY,
  PLAN_END_EMPTY,
  PLAN_KEEP,
  PLAN_SETTLING,
  gateAllowSessionLabel,
  planReadyTitle,
} from "../lib/copyDock";

export interface GateDiffStat {
  added: number;
  removed: number;
}

export interface GateAskOption {
  label: string;
  recommended?: boolean;
}

export type GateProps =
  | {
      tier: "shell" | "write";
      /** Raw command (shell) or path (write) — pass-through, never parsed. */
      detail: string;
      /** Real, host-reported workspace name — shell only, omitted when unknown. */
      cwd?: string | null;
      /** Write only, when the request carries a diff. */
      diffStat?: GateDiffStat | null;
      /** Write only, up to 2 lines shown, when the request carries a diff. */
      diffSnippet?: readonly string[] | null;
      onAllow: (command?: string) => void;
      onAllowSession: () => void;
      onDeny: () => void;
      /** Shell only — enter in-place edit on this Gate (parent must not deny). */
      onEditCommand?: () => void;
      /** Write only — persists Trusted workspace policy for this folder. */
      onTrustFolder?: () => void;
    }
  | {
      tier: "plan";
      members: readonly PlanProposedMember[];
      /** Plan body, shown as the why line when present. */
      why?: string | null;
      empty: boolean;
      settling?: boolean;
      error?: string | null;
      onAccept: () => void;
      onKeepPlanning: () => void;
    }
  | {
      tier: "ask";
      question: string;
      options: readonly GateAskOption[];
      onChoose: (index: number) => void;
    };

const GATE_DOT_COLOR: Record<"needs" | "plan" | "ask", string> = {
  needs: "var(--attention)",
  plan: "var(--accent2)",
  ask: "var(--accent)",
};

function GateHeader({ tone, title, policy }: { tone: "needs" | "plan" | "ask"; title: string; policy: string }) {
  return (
    <div className="gh">
      <i
        className={tone === "needs" ? "dot needs" : "dot"}
        aria-hidden="true"
        style={{ background: GATE_DOT_COLOR[tone] }}
      />
      <span>{title}</span>
      <span className="pol">{policy}</span>
    </div>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("-")) return "ln del";
  if (line.startsWith("+")) return "ln add";
  return "ln";
}

/** grok-acp prefixes shell Gates with `Run: `; tests may pass the bare command. */
export function shellCommandFromDetail(detail: string): string {
  return detail.startsWith("Run: ") ? detail.slice("Run: ".length) : detail;
}

function PermissionGate(props: Extract<GateProps, { tier: "shell" | "write" }>) {
  const isShell = props.tier === "shell";
  const title = isShell ? GATE_SHELL_TITLE : GATE_WRITE_TITLE;
  const policy = isShell ? GATE_SHELL_POLICY : GATE_WRITE_POLICY;
  const matchedClass = isShell ? matchTrustedCommandClassId(props.detail) : null;
  const sessionLabel = gateAllowSessionLabel(matchedClass ? trustedCommandClassLabel(matchedClass) : null);
  const snippet = !isShell && props.diffSnippet ? props.diffSnippet.slice(0, 2) : [];
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const allow = () => {
    const live = (editRef.current?.value ?? shellCommandFromDetail(props.detail)).trim();
    props.onAllow(isShell && editing && live ? live : undefined);
  };
  const startEdit = () => {
    setEditing(true);
    props.onEditCommand?.();
  };
  return (
    <div className="gate" role="region" aria-label={title}>
      <GateHeader tone="needs" title={title} policy={policy} />
      <div className="cmd">
        {/* "$ " is baked into this same text node (not a sibling span) so
            .cmd's own text differs from the bare command/path that .why
            renders separately below — otherwise the two would collide as
            duplicate exact-text matches for anything querying by detail. */}
        {isShell && editing ? (
          <textarea
            ref={editRef}
            className="cmd-edit"
            aria-label="Command to run"
            rows={2}
            defaultValue={shellCommandFromDetail(props.detail)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                allow();
              }
            }}
          />
        ) : isShell ? (
          `$ ${props.detail}`
        ) : (
          props.detail
        )}
        {isShell && props.cwd ? <span className="cwd">{props.cwd}</span> : null}
        {!isShell && props.diffStat ? (
          <span className="cwd">
            <span className="mint">+{props.diffStat.added}</span>{" "}
            <span className="rose">−{props.diffStat.removed}</span>
          </span>
        ) : null}
      </div>
      {snippet.length > 0 ? (
        <div className="snip">
          {snippet.map((line, i) => (
            <div key={i} className={diffLineClass(line)}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
      {isShell && !editing ? <div className="why">{props.detail}</div> : null}
      <div className="acts">
        <Button variant="accent" onClick={allow}>
          <span>{GATE_ALLOW}</span>
          <kbd aria-hidden="true">⏎</kbd>
        </Button>
        <Button onClick={props.onAllowSession}>
          <span>{sessionLabel}</span>
          <kbd aria-hidden="true">S</kbd>
        </Button>
        <Button variant="ghost" onClick={props.onDeny}>
          <span>{GATE_DENY}</span>
          <kbd aria-hidden="true">esc</kbd>
        </Button>
        {isShell ? (
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={startEdit}>
              <span>{GATE_EDIT_COMMAND}</span>
            </Button>
          </>
        ) : null}
        {!isShell && props.onTrustFolder ? (
          <Button variant="ghost" onClick={props.onTrustFolder}>
            <span>{GATE_TRUST_FOLDER}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PlanGate(props: Extract<GateProps, { tier: "plan" }>) {
  const title = props.empty ? PLAN_DOCK_EMPTY : planReadyTitle(props.members.length);
  return (
    <div className="gate plan" role="region" aria-label={title} aria-busy={props.settling === true}>
      <GateHeader tone="plan" title={title} policy={GATE_PLAN_POLICY} />
      {!props.empty && props.members.length > 0 ? (
        <div className="files">
          {props.members.map((m, i) => (
            <span key={m.path ?? `${m.summary}-${i}`}>
              {m.path ? `${m.path} · ${m.summary}` : m.summary}
            </span>
          ))}
        </div>
      ) : null}
      {props.why ? <div className="why">{props.why}</div> : null}
      {props.settling ? (
        <p className="plan-dock-settling" role="status">
          {PLAN_SETTLING}
        </p>
      ) : null}
      {props.error ? (
        <p className="plan-dock-error" role="alert">
          {props.error}
          <Button variant="ghost" onClick={props.onAccept}>
            Try again
          </Button>
        </p>
      ) : (
        <div className="acts">
          <Button variant="accent" disabled={props.settling === true} onClick={props.onAccept}>
            <span>{props.empty ? PLAN_END_EMPTY : PLAN_ACCEPT}</span>
            <kbd aria-hidden="true">⏎</kbd>
          </Button>
          <Button disabled={props.settling === true} onClick={props.onKeepPlanning}>
            <span>{PLAN_KEEP}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function AskGate(props: Extract<GateProps, { tier: "ask" }>) {
  return (
    <div className="gate ask" role="region" aria-label={GATE_ASK_TITLE}>
      <GateHeader tone="ask" title={GATE_ASK_TITLE} policy={GATE_ASK_POLICY} />
      <div className="why">{props.question}</div>
      <div className="opt">
        {props.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className={opt.recommended ? "rec" : undefined}
            onClick={() => props.onChoose(i)}
          >
            <kbd aria-hidden="true">{i + 1}</kbd>
            <span>{opt.label}</span>
            {opt.recommended ? <span className="suggested">suggested · ⏎</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Three tiers, three colors. Amber (shell/write) asks for permission, violet
 * (plan) asks you to judge a plan, cyan (ask/recovery_confirmation) asks a
 * question. Replaces PermissionCard — all three tiers are live in ActionDock
 * (shell/write, plan, and the recovery_confirmation ask). The ask tier
 * offers no dismiss: recovery_confirmation has exactly one real server
 * action (Recover), and Escape has no per-gate recovery branch (App.tsx
 * falls through to cancelling the run), so a "dismiss" affordance here
 * would either invent a capability the host doesn't have or mislabel what
 * the key actually does — see ActionDock's own comment on activeRecovery.
 */
export function Gate(props: GateProps): ReactNode {
  switch (props.tier) {
    case "shell":
    case "write":
      return <PermissionGate {...props} />;
    case "plan":
      return <PlanGate {...props} />;
    case "ask":
      return <AskGate {...props} />;
  }
}
