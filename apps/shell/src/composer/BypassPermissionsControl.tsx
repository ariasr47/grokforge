import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { callDesktop } from "../lib/desktopBridge";
import { Button } from "../ui/Button";
export interface BypassPermissionsControlProps { sessionId: string; unlocked: boolean; available: boolean; active?: boolean; blockedReason?: string | null; onActiveChange?: (active: boolean) => void; }
export function BypassPermissionsControl({ sessionId, unlocked, available, active = false, blockedReason, onActiveChange }: BypassPermissionsControlProps) {
  const [activeState, setActiveState] = useState(active);
  const [nativeUnlocked, setNativeUnlocked] = useState(unlocked);
  const [nativeAvailable, setNativeAvailable] = useState(available);
  const [nativeBlocked, setNativeBlocked] = useState(blockedReason);
  useEffect(() => setActiveState(active), [active]);
  useEffect(() => { let live = true; void callDesktop<{ unlocked?: boolean; managedDisabled?: boolean; localAttestation?: string }>("get_bypass_permissions_unlock").then(v => { if (!live) return; setNativeUnlocked(Boolean(v.unlocked)); const managed = Boolean(v.managedDisabled); const unattested = !managed && Boolean(v.localAttestation && v.localAttestation !== "local_standard_user"); const blocked = managed || unattested; setNativeAvailable(available && !blocked); setNativeBlocked(managed ? "Bypass permissions is disabled by managed policy." : unattested ? "Bypass permissions requires an approved isolated container or VM for elevated or remote use." : blockedReason); }).catch(() => { if (!live) return; setNativeUnlocked(false); setNativeAvailable(false); setNativeBlocked("Bypass permissions requires an approved isolated container or VM for elevated or remote use."); }); return () => { live = false; }; }, [available, blockedReason]);
  unlocked = nativeUnlocked; available = nativeAvailable; blockedReason = nativeBlocked;
  const [confirming, setConfirming] = useState(false); const [acknowledged, setAcknowledged] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function unlock() { if (!acknowledged) return; setBusy(true); setError(null); try { await callDesktop("unlock_bypass_permissions", { acknowledged: true, confirmationVersion: 1 }); setNativeUnlocked(true); setConfirming(false); } catch (err) { setError(err instanceof Error ? err.message : "Unlock failed"); } finally { setBusy(false); } }
  async function activate() {
    setBusy(true); setError(null);
    let activationToken: string | null = null;
    try {
      const cap = await callDesktop<{ activationToken: string }>("authorize_bypass_permissions_activation", { sessionId });
      activationToken = cap.activationToken;
      await api.sessionPermissionMode({ sessionId, mode: "bypass_permissions", activationToken });
      setActiveState(true);
      setConfirming(false);
      onActiveChange?.(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bypass activation failed");
    } finally {
      // Capability material is single-use and must never become UI state,
      // storage, diagnostics, or a loggable error value.
      activationToken = null;
      setBusy(false);
    }
  }
  async function exit() { setBusy(true); setError(null); try { await api.sessionPermissionMode({ sessionId, mode: "workspace" }); setActiveState(false); onActiveChange?.(false); } catch (e) { setError(e instanceof Error ? e.message : "Couldn’t exit Bypass permissions"); } finally { setBusy(false); } }
  if (activeState) return <div className="bypass-danger" role="status"><strong>Bypass permissions active</strong><p>Approvals are bypassed for this session. OS permissions and destructive-operation circuit breakers still apply.</p><Button variant="ghost" onClick={exit} disabled={busy}>Exit Bypass permissions</Button>{error && <p role="alert">{error}</p>}</div>;
  if (!available) return <div className="bypass-control"><strong>Bypass permissions unavailable</strong><p>{blockedReason || "Bypass permissions requires an approved isolated container or VM for elevated or remote use."}</p></div>;
  if (!unlocked) return <div className="bypass-control"><strong>Advanced permissions</strong>{confirming ? <div role="alertdialog" aria-label="Unlock Bypass permissions?"><h3>Unlock Bypass permissions?</h3><p>Bypass permissions can change or delete files, run commands, use the network, and access paths outside the selected workspace without asking. Audit history remains visible, but command side effects may not be reversible.</p><label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> I understand this affects every local Forge session I explicitly place in Bypass permissions.</label><Button variant="primary" onClick={() => void unlock()} disabled={!acknowledged || busy}>Unlock on this machine</Button><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button></div> : <Button onClick={() => setConfirming(true)} disabled={busy}>Unlock Bypass permissions</Button>}{error && <p role="alert">{error}</p>}</div>;
  return <div className="bypass-control"><strong>Advanced permissions</strong>{confirming ? <div role="alertdialog" aria-label="Confirm Bypass permissions"><h3>Enable Bypass permissions?</h3><p>Bypass permissions — Runs tools without approval, including commands, network use, and paths outside this workspace. OS permissions and destructive-operation circuit breakers still apply.</p><label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> I understand this affects every local Forge session I explicitly place in Bypass permissions.</label><Button variant="primary" onClick={() => void activate()} disabled={!acknowledged || busy}>Enable Bypass permissions</Button><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button></div> : <Button onClick={() => setConfirming(true)} disabled={busy}>Enable Bypass permissions</Button>}{error && <p role="alert">{error}</p>}</div>;
}
import React from "react";
void React;
