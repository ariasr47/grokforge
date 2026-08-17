import React, { useEffect, useRef, useState } from "react";
void React;
import type { TrustedCommandClassId, TrustedCommandClassCatalogEntry, TrustedCommandClassesFallbackReason } from "./api";

export type TrustedCommandClassesStatus =
  | "loading"
  | "confirmed"
  | "saving"
  | "offline"
  | "stale"
  | "unconfirmed"
  | "no_workspace";

export type TrustedCommandClassesConfirmed = {
  classes: TrustedCommandClassId[];
  revision: string;
  source: "saved" | "fallback";
  fallbackReason: TrustedCommandClassesFallbackReason;
  savedForWorkspace: boolean;
  catalog: TrustedCommandClassCatalogEntry[];
};

export interface TrustedCommandClassesControlProps {
  status: TrustedCommandClassesStatus;
  policyMode: "review" | "trusted_workspace" | null;
  confirmed: TrustedCommandClassesConfirmed;
  onSave?: (classes: TrustedCommandClassId[], expectedRevision: string) => Promise<void>;
  disabled?: boolean;
}

const COPY = {
  heading: "Trusted command classes",
  savedChip: "Saved for this workspace",
  helper: "Applies only when Policy is Trusted workspace. Review still asks. Commands stay unsandboxed after they run.",
  trustedStatus: "List is active for this workspace under Trusted workspace.",
  reviewStatus: "List is saved; it does not skip approvals while Policy is Review.",
  empty: "No Trusted command classes yet. Add ordinary verification classes (for example npm or cargo) so Trusted runs can skip the approval card for matches.",
  loadFailure: "Trusted command classes couldn’t be loaded. Matching shell will still ask until a valid list is saved.",
  saveError: "Couldn’t save Trusted command classes. The last confirmed list remains active.",
  midRun: "Couldn’t save Trusted command classes while a run is in progress. The last confirmed list remains active.",
  offline: "Trusted command classes couldn’t be confirmed. Reconnect before changing them.",
  noWorkspace: "Open a workspace to manage Trusted command classes.",
  loading: "Loading Trusted command classes…",
  saving: "Saving Trusted command classes…",
  success: "Trusted command classes saved.",
} as const;

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = sortedIds(a);
  const right = sortedIds(b);
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return undefined;
}

export function TrustedCommandClassesControl({
  status,
  policyMode,
  confirmed,
  onSave,
  disabled,
}: TrustedCommandClassesControlProps) {
  const [draft, setDraft] = useState<TrustedCommandClassId[]>(() => confirmed.classes.slice());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [localSaving, setLocalSaving] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const nextDirty = !sameSet(draft, confirmed.classes);
    dirtyRef.current = nextDirty;
  }, [draft, confirmed.classes]);

  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(confirmed.classes.slice());
  }, [confirmed.revision, confirmed.classes]);

  const busy = status === "loading" || status === "saving" || localSaving;
  const locked = Boolean(
    disabled ||
      status === "offline" ||
      status === "stale" ||
      status === "unconfirmed" ||
      status === "no_workspace" ||
      status === "loading",
  );
  const dirty = !sameSet(draft, confirmed.classes);
  const loadFailed =
    confirmed.fallbackReason === "unreadable" || confirmed.fallbackReason === "invalid";
  const emptyHappy =
    !loadFailed &&
    confirmed.classes.length === 0 &&
    (confirmed.fallbackReason === "missing" || confirmed.fallbackReason === null) &&
    !dirty;
  const showEditor = status !== "no_workspace";

  async function save() {
    if (!onSave || locked || localSaving || !dirty) return;
    setError(null);
    setSuccess(false);
    setLocalSaving(true);
    try {
      await onSave(draft.slice(), confirmed.revision);
      setSuccess(true);
    } catch (err) {
      const code = errorCode(err);
      setSuccess(false);
      setError(code === "run_active" ? COPY.midRun : COPY.saveError);
    } finally {
      setLocalSaving(false);
    }
  }

  function toggle(id: TrustedCommandClassId) {
    if (locked || localSaving) return;
    setSuccess(false);
    setError(null);
    setDraft((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <div
      className="policy-control trusted-classes-control"
      role="group"
      aria-label={COPY.heading}
      aria-busy={busy}
    >
      <div className="policy-heading">
        <strong>{COPY.heading}</strong>
        {confirmed.savedForWorkspace ? <span className="chip">{COPY.savedChip}</span> : null}
      </div>
      {status === "loading" && <p role="status">{COPY.loading}</p>}
      {(status === "offline" || status === "stale" || status === "unconfirmed") && (
        <p role="alert">{COPY.offline}</p>
      )}
      {status === "no_workspace" && <p role="status">{COPY.noWorkspace}</p>}
      {showEditor && (
        <>
          <p className="trusted-classes-helper">{COPY.helper}</p>
          {policyMode === "trusted_workspace" && (
            <p className="trusted-classes-status" role="status">{COPY.trustedStatus}</p>
          )}
          {policyMode === "review" && (
            <p className="trusted-classes-status" role="status">{COPY.reviewStatus}</p>
          )}
          {loadFailed && <p role="alert">{COPY.loadFailure}</p>}
          {emptyHappy && status === "confirmed" && (
            <p role="status">
              No Trusted command classes yet. Add ordinary verification classes (for example{" "}
              <code>npm</code> or <code>cargo</code>) so Trusted runs can skip the approval card for
              matches.
            </p>
          )}
          {(confirmed.classes.length > 0 || draft.some((id) => !confirmed.classes.includes(id))) && (
            <div className="trusted-classes-confirmed" aria-label="Confirmed classes">
              {confirmed.classes.map((id) => {
                const label = confirmed.catalog.find((entry) => entry.id === id)?.label ?? id;
                return (
                  <span key={id} className="chip class-chip">
                    {label}
                  </span>
                );
              })}
              {draft.filter((id) => !confirmed.classes.includes(id)).map((id) => {
                const label = confirmed.catalog.find((entry) => entry.id === id)?.label ?? id;
                return (
                  <span key={`draft-${id}`} className="chip class-chip class-chip-draft">
                    {label}
                  </span>
                );
              })}
            </div>
          )}
          <fieldset disabled={locked || localSaving} className="trusted-classes-catalog">
            <legend className="sr-only">Closed catalog classes</legend>
            <div className="class-catalog">
              {confirmed.catalog.map((entry) => {
                const selected = draft.includes(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={selected ? "btn ghost class-remove" : "btn ghost"}
                    onClick={() => toggle(entry.id)}
                  >
                    {selected ? `Remove ${entry.label}` : `Add ${entry.label}`}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}
      {error && (
        <p id="trusted-classes-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void save()}>
            Try again
          </button>
        </p>
      )}
      {(status === "saving" || localSaving) && (
        <p className="policy-saving" role="status">
          {COPY.saving}
        </p>
      )}
      {success && !error && <p role="status">{COPY.success}</p>}
      {dirty && !locked && !localSaving && status !== "saving" && (
        <button type="button" className="btn primary" onClick={() => void save()}>
          Save classes
        </button>
      )}
    </div>
  );
}
