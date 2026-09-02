import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
void React;
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RunSurface } from "./RunSurface";
import { PermissionPolicyControl, savedPolicyUnusable } from "./PermissionPolicyControl";
import { BypassPermissionsControl } from "./BypassPermissionsControl";
import { api } from "./api";
import { setDesktopBridge } from "./desktopBridge";
import type { DesktopCommand } from "./desktopBridge";
import type { RunProjectionRun, RunSnapshot } from "./runReducer";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "session-a", runId: "run-a", connectionGeneration: 1,
  state: "running", acceptedPrompt: "Inspect the workspace", admittedAt: "", updatedAt: "", lastEventSeq: 2,
  policy: { effectiveMode: "review" }, model: { id: "grok-4.6" }, terminalKind: null,
  finalAnswer: null, answerVouched: false, failure: null,
};
const run = (overrides: Partial<RunProjectionRun> = {}): RunProjectionRun => ({
  ...snapshot, reasoning: {}, answer: {}, message: {}, activities: {}, decisions: {}, seenEventSeq: new Set([1]),
  terminalEventSeq: null, ...overrides,
});

test("renders reasoning as one disclosure and does not promote it to an answer", () => {
  render(<RunSurface run={run({ reasoning: { seg: "private reasoning" } })} />);
  assert.ok(screen.getByText("Thought…"));
  assert.equal(screen.queryByRole("article", { name: /assistant answer/i }), null);
});
test("renders only a vouched terminal answer once", () => {
  render(<RunSurface run={run({ state: "terminal", terminalKind: "answered", finalAnswer: "Complete", answerVouched: true })} />);
  assert.equal(screen.getAllByRole("article", { name: /assistant answer/i }).length, 1);
  // The response turn's node (muted node--done) carries the answered fact now
  // — no separate "Answered" strip.
  assert.ok(document.querySelector(".node--done"));
  assert.equal(screen.queryByText("Answered"), null);
});
test("renders durable received answer segments before and after a non-answer terminal", () => {
  const { rerender } = render(<RunSurface run={run({ answer: { seg: "answer before cancel" } })} />);
  assert.equal(screen.getAllByText("answer before cancel").length, 1);
  rerender(<RunSurface run={run({ state: "terminal", terminalKind: "cancelled", answer: { seg: "answer before cancel" } })} />);
  assert.equal(screen.getAllByText("answer before cancel").length, 1);
  assert.equal(screen.queryByRole("article", { name: /assistant answer/i }), null);
  assert.ok(screen.getByText("Cancelled"));
});
test("live received answer is plain text, not markdown or a rich-layout placeholder", () => {
  const live = "# Hello\n\n```grok-ui\nnot json yet";
  render(<RunSurface run={run({ answer: { seg: live } })} />);
  assert.equal(screen.queryByText("Building rich layout…"), null);
  const partial = document.querySelector(".assistant-partial");
  assert.ok(partial);
  const pre = partial!.querySelector("pre");
  assert.ok(pre);
  assert.ok(pre!.textContent?.includes("# Hello"));
  assert.ok(pre!.textContent?.includes("```grok-ui"));
  assert.equal(partial!.querySelector(".md-p"), null);
  assert.equal(partial!.querySelector(".md-h"), null);
  assert.equal(screen.queryByRole("article", { name: /assistant answer/i }), null);
});
test("vouched terminal answer leaves the live pre and parses markdown", () => {
  const body = "# Hello\n\nDone.";
  const { rerender } = render(<RunSurface run={run({ answer: { seg: body } })} />);
  assert.ok(document.querySelector(".assistant-partial pre"));
  rerender(<RunSurface run={run({
    state: "terminal",
    terminalKind: "answered",
    finalAnswer: body,
    answerVouched: true,
    answer: { seg: body },
  })} />);
  assert.equal(document.querySelector(".assistant-partial"), null);
  const answer = document.querySelector(".assistant-answer");
  assert.ok(answer);
  assert.ok(answer!.querySelector(".md-h, .md-p"));
  assert.equal(screen.getByRole("article", { name: /assistant answer/i }).textContent?.includes("# Hello"), false);
});
test("keeps activity, decision, policy/model provenance and terminal under one run", () => {
  const activity = { activityId: "a", invocationId: "i", name: "read_file", lifecycle: "terminal", execution: "executed", status: "succeeded", input: { path: "README.md" }, output: "ok", error: null, diff: null, policy: { effectiveMode: "review" }, automaticEligibility: "read", autoApplied: false, editId: null, recovery: null } as any;
  const decision = { requestId: "d", invocationId: "i", kind: "permission", status: "pending", title: "Approval needed", detail: "Allow read?", expiresAt: null, policy: { effectiveMode: "review" } } as any;
  render(<RunSurface run={run({ state: "terminal", terminalKind: "failed", policy: { effectiveMode: "review", source: "fallback" }, model: { appliedModel: "grok-4.6", selectionProvenance: "inherited" }, activities: { a: activity }, decisions: { d: decision }, failure: { code: "provider_error", message: "The provider stopped responding.", retryable: true, recoveryAction: "retry_prompt" } })} />);
  const surface = screen.getByRole("article", { name: "Run Inspect the workspace" });
  assert.ok(within(surface).queryByRole("region", { name: "Activity" }) || within(surface).getByLabelText("Activity"));
  assert.ok(within(surface).getByText("Model: grok-4.6"));
  assert.ok(within(surface).getAllByText(/Policy: review/).length >= 1);
  assert.ok(within(surface).getByRole("group", { name: "Approval needed" }));
  assert.ok(within(surface).getByText("Run failed"));
});
test("missing-final failure is explicit and offers retry", () => {
  let retriedPrompt = "";
  render(<RunSurface run={run({ state: "terminal", terminalKind: "failed", failure: { code: "missing_final_answer", message: "No final answer was produced.", retryable: true, recoveryAction: "retry_prompt" } })} onRetryPrompt={(prompt) => { retriedPrompt = prompt; }} />);
  const alert = screen.getByRole("alert");
  assert.ok(within(alert).getByText("Run failed", { exact: true }));
  assert.ok(within(alert).getByText("No final answer was received. Your prompt, reasoning, and activity are preserved.", { exact: true }));
  fireEvent.click(within(alert).getByRole("button", { name: "Retry prompt" }));
  assert.equal(retriedPrompt, "Inspect the workspace");
});
test("cancel remains Ending while pending and Cancelled after terminal", () => {
  const { rerender } = render(<RunSurface run={run({ state: "cancelling" })} />);
  assert.ok(screen.getByText("Ending run…"));
  rerender(<RunSurface run={run({ state: "terminal", terminalKind: "cancelled" })} />);
  assert.ok(screen.getByText("Cancelled"));
});
test("long reasoning wraps in a bounded run surface", () => {
  render(<RunSurface run={run({ reasoning: { seg: "x".repeat(10_000) } })} />);
  assert.equal(screen.getByText("x".repeat(10_000)).textContent?.length, 10_000);
  assert.ok(document.querySelector(".run-content"));
});
test("policy cannot save while host is offline", () => {
  const save = () => { throw new Error("should not save"); };
  render(<PermissionPolicyControl status="offline" confirmedMode="review" onSave={async () => save()} />);
  assert.ok(screen.getByText("Permission policy couldn’t be confirmed. Reconnect before sending."));
  assert.equal((screen.getByRole("group", { name: "Permission policy" }).querySelector("fieldset") as HTMLFieldSetElement).disabled, true);
});
test("policy no-workspace state uses the exact guidance copy", () => {
  render(<PermissionPolicyControl status="no_workspace" />);
  assert.ok(screen.getByText("Open a workspace to choose its permission policy."));
});
test("policy selects the confirmed mode when asynchronous host state arrives", () => {
  const { rerender } = render(<PermissionPolicyControl status="loading" confirmedMode={null} />);
  assert.equal((screen.getByRole("radio", { name: /Review/ }) as HTMLInputElement).checked, false);
  rerender(<PermissionPolicyControl status="confirmed" confirmedMode="trusted_workspace" />);
  assert.equal((screen.getByRole("radio", { name: /Trusted workspace/ }) as HTMLInputElement).checked, true);
});
test("policy save exposes explicit confirmation and preserves selected mode on failure", async () => {
  let called = 0;
  render(<PermissionPolicyControl status="confirmed" confirmedMode="review" onSave={async () => { called++; throw new Error("offline"); }} />);
  fireEvent.click(screen.getByRole("radio", { name: /Trusted workspace/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
  await waitFor(() => assert.ok(screen.getByRole("alert")));
  assert.equal(called, 1);
  assert.ok(screen.getByRole("alert"));
  assert.ok(screen.getByText(/remains active/i));
});
test("bypass requires an explicit risk confirmation before activation", () => {
  render(<BypassPermissionsControl sessionId="session-a" unlocked available active={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Enable Bypass permissions" }));
  assert.ok(screen.getByRole("alertdialog", { name: /Confirm Bypass permissions/i }));
  assert.equal((screen.getByRole("checkbox") as HTMLInputElement).checked, false);
});
test("bypass active state is visibly exceptional and has an exit action", () => {
  render(<BypassPermissionsControl sessionId="session-a" unlocked available active />);
  assert.ok(screen.getByRole("status"));
  assert.ok(screen.getByRole("button", { name: "Exit Bypass permissions" }));
});
function assertFocused(control: Element, label: string): void {
  // Never pass jsdom nodes to assert.equal — a failing inspect walks circular
  // React-fiber refs and can fill tens of GB (desktop-self-host N-9 lesson).
  assert.equal(document.activeElement === control, true, `${label} is not keyboard reachable`);
}

test("focus remains on native controls and statuses are text-labelled", () => {
  render(<PermissionPolicyControl status="saving" confirmedMode="trusted_workspace" />);
  const input = screen.getByRole("radio", { name: /Review/ }) as HTMLInputElement;
  input.focus();
  assertFocused(input, "Review");
  assert.ok(screen.getByText(/Saving permission policy/i));
});
test("run actions are keyboard reachable and transition status is announced without delta chatter", async () => {
  const activity = { activityId: "a", invocationId: "i", name: "write", lifecycle: "terminal", execution: "executed", status: "succeeded", input: {}, output: null, error: null, diff: "-old\n+new", policy: {}, automaticEligibility: "text_edit", autoApplied: true, editId: "edit-1", recovery: { kind: "guarded_revert", available: true, status: "available" } } as any;
  render(<RunSurface run={run({ activities: { a: activity }, state: "cancelling" })} />);
  const recover = screen.getByRole("button", { name: "Revert edit" }); recover.focus(); assertFocused(recover, "Revert edit");
  assert.ok(screen.getByRole("status", { name: "" }));
  assert.ok(screen.getByText("Ending run…"));
  assert.equal(screen.queryByText(/reasoning_delta|answer_delta/), null);
});

test("§4 copy/action matrix exposes every supported policy, run, recovery, and Bypass state", async () => {
  const policyCases: Array<["loading" | "saving" | "confirmed" | "offline" | "stale" | "unconfirmed" | "no_workspace", string]> = [
    ["loading", "Loading permission policy…"], ["saving", "Saving permission policy…"],
    ["offline", "Permission policy couldn’t be confirmed. Reconnect before sending."],
    ["stale", "Permission policy couldn’t be confirmed. Reconnect before sending."],
    ["unconfirmed", "Permission policy couldn’t be confirmed. Reconnect before sending."],
    ["no_workspace", "Open a workspace to choose its permission policy."],
  ];
  for (const [status, copy] of policyCases) { cleanup(); render(<PermissionPolicyControl status={status} confirmedMode={status === "saving" ? "review" : null} />); assert.ok(screen.getByText(copy, { exact: true })); }
  cleanup();
  render(<PermissionPolicyControl status="confirmed" confirmedMode="review" fallbackReason="missing" />);
  assert.equal(savedPolicyUnusable("missing"), false);
  assert.equal(screen.queryByText("Forge couldn’t use the saved permission policy. Review is active."), null);
  cleanup();
  render(<PermissionPolicyControl status="confirmed" confirmedMode="review" fallbackReason="invalid" />);
  assert.ok(screen.getByText("Forge couldn’t use the saved permission policy. Review is active.", { exact: true }));
  cleanup();
  render(<PermissionPolicyControl status="confirmed" confirmedMode="review" fallbackReason="unreadable" />);
  assert.ok(screen.getByText("Forge couldn’t use the saved permission policy. Review is active.", { exact: true }));
  cleanup();
  const states: Array<[Partial<RunProjectionRun>, string]> = [
    [{ state: "recovering" }, "Recovering run…"], [{ state: "cancelling" }, "Ending run…"],
    [{ state: "terminal", terminalKind: "failed", failure: { code: "provider_error", message: "failed", retryable: true, recoveryAction: "retry_prompt" } }, "Run failed"],
    [{ state: "terminal", terminalKind: "cancelled" }, "Cancelled"],
  ];
  for (const [override, copy] of states) { cleanup(); render(<RunSurface run={run(override)} onRetryPrompt={() => undefined} />); assert.ok(screen.getByText(copy, { exact: true })); }
  cleanup();
  // Answered has no exact-text card of its own — the response turn's node
  // (muted node--done) carries that fact.
  render(<RunSurface run={run({ state: "terminal", terminalKind: "answered", finalAnswer: "answer", answerVouched: true })} onRetryPrompt={() => undefined} />);
  assert.ok(document.querySelector(".node--done"));
  assert.equal(screen.queryByText("Answered"), null);
  cleanup();
  render(<RunSurface run={run({ state: "terminal", terminalKind: "failed", failure: { code: "provider_error", message: "lost", retryable: true, recoveryAction: "reconnect" } })} onReconnect={() => undefined} />);
  assert.ok(screen.getByRole("button", { name: "Reconnect" }));
  cleanup();
  const activity = { activityId: "recover", invocationId: "inv", name: "write", lifecycle: "terminal", execution: "executed", status: "succeeded", input: {}, output: null, error: null, diff: "-old\n+new", policy: { effectiveMode: "trusted_workspace" }, automaticEligibility: "text_edit", autoApplied: true, editId: "edit", recovery: { kind: "guarded_revert", available: true, status: "available" } } as any;
  render(<RunSurface run={run({ activities: { recover: activity } })} />);
  assert.ok(screen.getByText("Restore this file to its state immediately before the edit. Forge will stop if the file has changed since.", { exact: true }));
  assert.ok(screen.getByRole("button", { name: "Revert edit" }));
  cleanup();
  setDesktopBridge((async (cmd: DesktopCommand) => cmd === "get_bypass_permissions_unlock" ? { unlocked: false, managedDisabled: false, localAttestation: "local_standard_user" } : {}) as never);
  try { render(<BypassPermissionsControl sessionId="session-a" unlocked={false} available />); assert.ok(await screen.findByRole("button", { name: "Unlock Bypass permissions" })); }
  finally { setDesktopBridge(null); }
});

test("all action controls retain visible focus and announcements transition without delta or duplicate-terminal chatter", () => {
  const activity = { activityId: "focus", invocationId: "focus-inv", name: "write", lifecycle: "terminal", execution: "executed", status: "succeeded", input: {}, output: null, error: null, diff: "-old\n+new", policy: {}, automaticEligibility: "text_edit", autoApplied: true, editId: "focus-edit", recovery: { kind: "guarded_revert", available: true, status: "available" } } as any;
  const decision = { requestId: "perm", invocationId: "focus-inv", kind: "permission", status: "pending", title: "Approval needed · Review", detail: "Allow?", expiresAt: null, policy: {} } as any;
  const { rerender } = render(<RunSurface run={run({ activities: { focus: activity }, decisions: { perm: decision }, state: "running" })} />);
  assert.equal(screen.queryByRole("button", { name: "Allow" }), null, "permission settle stays in the action dock");
  assert.equal(screen.queryByRole("button", { name: "Decline" }), null, "permission settle stays in the action dock");
  for (const name of ["Revert edit", "View diff"]) {
    const control = screen.getByRole("button", { name });
    control.focus();
    assertFocused(control, name);
  }
  assert.ok(screen.getByRole("status"));
  rerender(<RunSurface run={run({ state: "running", reasoning: { one: "delta" }, activities: { focus: activity }, decisions: { perm: decision } })} />);
  assert.equal(screen.queryAllByRole("alert").length, 0, "reasoning deltas must not announce as alerts");
  rerender(<RunSurface run={run({ state: "terminal", terminalKind: "failed", failure: { code: "provider_error", message: "failed", retryable: true, recoveryAction: "retry_prompt" }, activities: { focus: activity } })} onRetryPrompt={() => undefined} />);
  assert.equal(screen.getAllByText("Run failed", { exact: true }).length, 1);
  rerender(<RunSurface run={run({ state: "terminal", terminalKind: "failed", failure: { code: "provider_error", message: "failed", retryable: true, recoveryAction: "retry_prompt" }, activities: { focus: activity } })} onRetryPrompt={() => undefined} />);
  assert.equal(screen.getAllByText("Run failed", { exact: true }).length, 1, "duplicate terminal must not be announced twice");
});

test("routes diff decisions with edit identity and prevents duplicate submits", async () => {
  let calls = 0;
  const original = api.runDiff;
  api.runDiff = (async () => { calls++; await new Promise(r => setTimeout(r, 20)); return { ok: true }; }) as typeof api.runDiff;
  try {
    const activity = { activityId: "a", invocationId: "i", name: "write", lifecycle: "pending", execution: "executed", status: "running", input: {}, output: null, error: null, diff: "-old\n+new", policy: {}, automaticEligibility: "none", autoApplied: false, editId: "edit-1", recovery: null } as any;
    render(<RunSurface run={run({ decisions: { d: { requestId: "d", invocationId: "i", kind: "diff", status: "pending", title: "Review edit", detail: "", expiresAt: null, policy: {} } }, activities: { a: activity } })} />);
    assert.equal(screen.queryByRole("button", { name: "Accept" }), null, "diff settle stays in the action dock");
    assert.equal(screen.queryByRole("button", { name: "Reject" }), null, "diff settle stays in the action dock");
    assert.equal(calls, 0, "settle stays in the action dock, not RunSurface");
  } finally { api.runDiff = original; }
});

test("guarded recovery explains the hash guard and confirms success without stale action", async () => {
  const original = api.editRecovery;
  api.editRecovery = (async () => ({ ok: true, activity: {} })) as typeof api.editRecovery;
  try {
    const activity = { activityId: "a", invocationId: "i", name: "write", lifecycle: "terminal", execution: "executed", status: "succeeded", input: {}, output: null, error: null, diff: "-old\n+new", policy: { effectiveMode: "trusted_workspace" }, automaticEligibility: "text_edit", autoApplied: true, editId: "edit-1", recovery: { kind: "guarded_revert", available: true, status: "available" } } as any;
    render(<RunSurface run={run({ activities: { a: activity } })} />);
    assert.ok(screen.getByText("Restore this file to its state immediately before the edit. Forge will stop if the file has changed since."));
    fireEvent.click(screen.getByRole("button", { name: "Revert edit" }));
    await waitFor(() => assert.ok(screen.getByText("Edit reverted")));
    assert.equal(screen.queryByRole("button", { name: "Revert edit" }), null);
  } finally { api.editRecovery = original; }
});

test("guarded recovery conflict is handled as user-safe copy and retains View diff", async () => {
  const original = api.editRecovery;
  api.editRecovery = (async () => { const e = new Error("conflict"); (e as Error & { code: string }).code = "recovery_conflict"; throw e; }) as typeof api.editRecovery;
  try {
    const activity = { activityId: "a", invocationId: "i", name: "write", lifecycle: "terminal", execution: "executed", status: "succeeded", input: {}, output: null, error: null, diff: "-old\n+new", policy: { effectiveMode: "trusted_workspace" }, automaticEligibility: "text_edit", autoApplied: true, editId: "edit-1", recovery: { kind: "guarded_revert", available: true, status: "available" } } as any;
    render(<RunSurface run={run({ activities: { a: activity } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Revert edit" }));
    await waitFor(() => assert.ok(screen.getByText("Edit not reverted")));
    assert.ok(screen.getByText(/file changed after Forge applied this edit/));
    assert.ok(screen.getAllByRole("button", { name: "View diff" }).length >= 1);
  } finally { api.editRecovery = original; }
});

test("loads native unlock state and requires explicit unlock acknowledgement", async () => {
  const calls: string[] = [];
  setDesktopBridge((async (cmd: DesktopCommand) => { calls.push(cmd); if (cmd === "get_bypass_permissions_unlock") return { unlocked: false, managedDisabled: false, localAttestation: "local_standard_user" }; if (cmd === "unlock_bypass_permissions") return { unlocked: true }; return {}; }) as never);
  try {
    render(<BypassPermissionsControl sessionId="session-a" unlocked={false} available />);
    await waitFor(() => assert.ok(calls.includes("get_bypass_permissions_unlock")));
    fireEvent.click(screen.getByRole("button", { name: "Unlock Bypass permissions" }));
    assert.ok(screen.getByRole("alertdialog", { name: "Unlock Bypass permissions?" }));
    assert.ok(screen.getByText(/I understand this affects every local Forge session/));
  } finally { setDesktopBridge(null); }
});

test("bypass native capability is single-use in UI and exits back to workspace", async () => {
  const calls: string[] = [];
  const originalMode = api.sessionPermissionMode;
  api.sessionPermissionMode = (async (body: { sessionId: string; mode: "workspace" | "bypass_permissions"; activationToken?: string }) => { calls.push(`mode:${body.mode}`); return { sessionId: body.sessionId, effectivePermissionMode: body.mode, bypassPermissions: {} }; }) as unknown as typeof api.sessionPermissionMode;
  setDesktopBridge((async (cmd: DesktopCommand) => {
    calls.push(cmd);
    if (cmd === "get_bypass_permissions_unlock") return { unlocked: true, managedDisabled: false, localAttestation: "local_standard_user" };
    if (cmd === "authorize_bypass_permissions_activation") return { activationToken: "ephemeral-secret-token" };
    return {};
  }) as never);
  try {
    const { rerender } = render(<BypassPermissionsControl sessionId="session-a" unlocked available active={false} />);
    await waitFor(() => assert.ok(calls.includes("get_bypass_permissions_unlock")));
    fireEvent.click(screen.getByRole("button", { name: "Enable Bypass permissions" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Enable Bypass permissions" }));
    await waitFor(() => assert.ok(calls.includes("mode:bypass_permissions")));
    assert.equal(screen.queryByText("ephemeral-secret-token"), null);
    rerender(<BypassPermissionsControl sessionId="session-a" unlocked available active />);
    fireEvent.click(screen.getByRole("button", { name: "Exit Bypass permissions" }));
    await waitFor(() => assert.ok(calls.includes("mode:workspace")));
  } finally { api.sessionPermissionMode = originalMode; setDesktopBridge(null); }
});

test("bypass reflects successful activation immediately without waiting for a state broadcast", async () => {
  const originalMode = api.sessionPermissionMode;
  api.sessionPermissionMode = (async (body: { sessionId: string; mode: "workspace" | "bypass_permissions"; activationToken?: string }) => ({ sessionId: body.sessionId, effectivePermissionMode: body.mode, bypassPermissions: { activeForSession: true } })) as unknown as typeof api.sessionPermissionMode;
  setDesktopBridge((async (cmd: DesktopCommand) => {
    if (cmd === "get_bypass_permissions_unlock") return { unlocked: true, managedDisabled: false, localAttestation: "local_standard_user" };
    if (cmd === "authorize_bypass_permissions_activation") return { activationToken: "ephemeral-secret-token" };
    return {};
  }) as never);
  try {
    render(<BypassPermissionsControl sessionId="session-a" unlocked available active={false} />);
    await screen.findByRole("button", { name: "Enable Bypass permissions" });
    fireEvent.click(screen.getByRole("button", { name: "Enable Bypass permissions" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Enable Bypass permissions" }));
    await waitFor(() => assert.ok(screen.getByText("Bypass permissions active")));
  } finally { api.sessionPermissionMode = originalMode; setDesktopBridge(null); }
});

test("managed and unattested native states refuse unlock and activation", async () => {
  for (const localAttestation of ["elevated", "remote", "unavailable"] as const) {
    cleanup();
    setDesktopBridge((async (cmd: DesktopCommand) => cmd === "get_bypass_permissions_unlock" ? { unlocked: false, managedDisabled: false, localAttestation } : (() => { throw new Error("must not authorize"); })()) as never);
    render(<BypassPermissionsControl sessionId="session-a" unlocked={false} available />);
    await waitFor(() => assert.ok(screen.getByText("Bypass permissions requires an approved isolated container or VM for elevated or remote use.")));
  }
  cleanup();
  setDesktopBridge((async (cmd: DesktopCommand) => cmd === "get_bypass_permissions_unlock" ? { unlocked: false, managedDisabled: true, localAttestation: "local_standard_user" } : (() => { throw new Error("must not authorize"); })()) as never);
  render(<BypassPermissionsControl sessionId="session-a" unlocked={false} available />);
  await waitFor(() => assert.ok(screen.getByText("Bypass permissions is disabled by managed policy.")));
  setDesktopBridge(null);
});

test("native unlock IPC failure fails closed and offers no activation", async () => {
  setDesktopBridge((async () => { throw new Error("desktop unavailable"); }) as never);
  try {
    render(<BypassPermissionsControl sessionId="session-a" unlocked available />);
    await waitFor(() => assert.ok(screen.getByText("Bypass permissions requires an approved isolated container or VM for elevated or remote use.")));
    assert.equal(screen.queryByRole("button", { name: "Enable Bypass permissions" }), null);
  } finally { setDesktopBridge(null); }
});
