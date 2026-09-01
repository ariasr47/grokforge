import React, { useEffect, useState } from "react";
import { Button } from "./ui/Button";
void React;

export type PolicyMode = "review" | "trusted_workspace";
export interface PermissionPolicyControlProps {
  status: "loading" | "confirmed" | "saving" | "stale" | "offline" | "unconfirmed" | "no_workspace";
  confirmedMode?: PolicyMode | null;
  fallbackReason?: string | null;
  onSave?: (mode: PolicyMode) => Promise<void>;
  disabled?: boolean;
}
const label = (m: PolicyMode) => m === "review" ? "Review" : "Trusted workspace";
/** Saved file exists but cannot be used. `missing` is the honest default, not a failure. */
export function savedPolicyUnusable(reason: string | null | undefined): boolean {
  return reason === "invalid" || reason === "unreadable";
}
export function PermissionPolicyControl({ status, confirmedMode = null, fallbackReason = null, onSave, disabled }: PermissionPolicyControlProps) {
  const [draft, setDraft] = useState<PolicyMode | null>(confirmedMode);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(confirmedMode), [confirmedMode]);
  const busy = status === "loading" || status === "saving";
  const locked = Boolean(disabled || status === "offline" || status === "stale" || status === "unconfirmed" || status === "no_workspace");
  async function save() { if (!draft || !onSave || draft === confirmedMode) return; setError(null); try { await onSave(draft); } catch { setError(`Couldn’t save the permission policy. ${label(confirmedMode ?? "review")} remains active.`); } }
  return <div className="policy-control" role="group" aria-label="Permission policy" aria-busy={busy}>
    <div className="policy-heading"><strong>Permission policy</strong>{confirmedMode && <span className="chip">Policy: {label(confirmedMode)}</span>}</div>
    {savedPolicyUnusable(fallbackReason) && <p className="policy-notice" role="status">Forge couldn’t use the saved permission policy. Review is active.</p>}
    {status === "loading" && <p role="status">Loading permission policy…</p>}
    {(status === "offline" || status === "stale" || status === "unconfirmed") && <p role="alert">Permission policy couldn’t be confirmed. Reconnect before sending.</p>}
    {status === "no_workspace" && <p role="status">Open a workspace to choose its permission policy.</p>}
    <fieldset disabled={locked} aria-describedby={error ? "policy-error" : undefined}>
      <legend className="sr-only">Choose workspace policy</legend>
      {(["review", "trusted_workspace"] as PolicyMode[]).map((mode) => (
        <label key={mode} className="policy-option">
          <input
            type="radio"
            name="permission-policy"
            value={mode}
            checked={draft === mode}
            onChange={() => setDraft(mode)}
          />
          <span>{label(mode)}</span>
          <small>{mode === "review" ? "Ask before edits and shell actions." : "Auto-apply eligible text edits in this workspace."}</small>
        </label>
      ))}
    </fieldset>
    {error && <p id="policy-error" role="alert">{error} <Button variant="ghost" onClick={() => void save()}>Try again</Button></p>}
    {status === "saving" && <p className="policy-saving" role="status">Saving permission policy…</p>}
    {draft !== confirmedMode && !locked && <Button variant="primary" onClick={() => void save()}>Save policy</Button>}
  </div>;
}
