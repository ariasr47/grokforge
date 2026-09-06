// Task 4 — PolicyControls unifies what used to be two nearly verbatim copies
// of PermissionPolicyControl + BypassPermissionsControl wiring (the
// composer popover and the Settings view in App.tsx). These tests exercise
// the extracted component directly, following the same idiom
// reliable-autonomous-runs.component.test.tsx already uses for these same
// two child components (api.<method> reassigned per-test, setDesktopBridge
// for the Tauri IPC boundary, restored in `finally`).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PolicyControls } from "./PolicyControls";
import { api, type PublicState } from "../lib/api";
import { setDesktopBridge } from "../lib/desktopBridge";
import type { DesktopCommand } from "../lib/desktopBridge";

beforeEach(() => {
  // A harmless default so BypassPermissionsControl's unconditional mount
  // probe (get_bypass_permissions_unlock) never falls through to the real
  // Tauri `invoke` in tests that aren't exercising Bypass themselves.
  setDesktopBridge((async (cmd: DesktopCommand) =>
    cmd === "get_bypass_permissions_unlock"
      ? { unlocked: false, managedDisabled: false, localAttestation: "local_standard_user" }
      : {}) as never);
});

afterEach(() => {
  cleanup();
  setDesktopBridge(null);
});

const SHELL_CAPABILITY = {
  status: "available" as const,
  platform: "win32" as const,
  osFamily: "windows" as const,
  executable: "C:\\Windows\\System32\\cmd.exe",
  displayName: "Command Prompt (cmd.exe)",
  dialect: "cmd" as const,
  reasonCode: null,
  reason: null,
};

function baseState(overrides: Partial<PublicState> = {}): PublicState {
  return {
    shellCapability: SHELL_CAPABILITY,
    workspace: "C:\\repo",
    workspaceName: "repo",
    authMode: "sub_pool",
    hasApiKey: true,
    authSource: "oauth",
    model: "grok-4",
    connected: true,
    busy: false,
    sessionId: "session-a",
    recent: [],
    permissionPolicy: {
      status: "confirmed",
      workspace: "C:\\repo",
      storedMode: "review",
      effectiveMode: "review",
      source: "saved",
      revision: "pol-1",
      fallbackReason: null,
      savedForWorkspace: true,
    },
    ...overrides,
  };
}

test("saving a policy calls the save callback with the chosen policy", async () => {
  const state = baseState();
  const saveCalls: Array<{ sessionId: string; workspace: string; mode: string }> = [];
  const original = api.saveWorkspacePolicy;
  api.saveWorkspacePolicy = (async (body: { sessionId: string; workspace: string; mode: "review" | "trusted_workspace" }) => {
    saveCalls.push(body);
    return {
      policy: {
        status: "confirmed",
        workspace: body.workspace,
        storedMode: body.mode,
        effectiveMode: body.mode,
        source: "saved",
        revision: "pol-2",
        fallbackReason: null,
        savedForWorkspace: true,
      },
    };
  }) as unknown as typeof api.saveWorkspacePolicy;
  const applied: PublicState[] = [];
  try {
    render(
      <PolicyControls
        state={state}
        sessionId="session-a"
        hostOk
        runStartedAt={null}
        onApplyState={(next) => applied.push(next)}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Trusted workspace/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() => assert.equal(saveCalls.length, 1));
    assert.deepEqual(saveCalls[0], { sessionId: "session-a", workspace: "C:\\repo", mode: "trusted_workspace" });
    await waitFor(() => assert.equal(applied.length, 1));
    assert.equal(applied[0]?.permissionPolicy?.effectiveMode, "trusted_workspace");
  } finally {
    api.saveWorkspacePolicy = original;
  }
});

test("the bypass control's active-change fires", async () => {
  const state = baseState({
    bypassPermissions: { unlocked: true, available: true, activeForSession: false, blockedReason: null, confirmationVersion: 1 },
  });
  const originalMode = api.sessionPermissionMode;
  api.sessionPermissionMode = (async (body: { sessionId: string; mode: "workspace" | "bypass_permissions"; activationToken?: string }) => ({
    sessionId: body.sessionId,
    effectivePermissionMode: body.mode,
    bypassPermissions: {},
  })) as unknown as typeof api.sessionPermissionMode;
  setDesktopBridge((async (cmd: DesktopCommand) => {
    if (cmd === "get_bypass_permissions_unlock") return { unlocked: true, managedDisabled: false, localAttestation: "local_standard_user" };
    if (cmd === "authorize_bypass_permissions_activation") return { activationToken: "ephemeral-secret-token" };
    return {};
  }) as never);
  const applied: PublicState[] = [];
  try {
    render(
      <PolicyControls
        state={state}
        sessionId="session-a"
        hostOk
        runStartedAt={null}
        onApplyState={(next) => applied.push(next)}
      />,
    );
    await screen.findByRole("button", { name: "Enable Bypass permissions" });
    fireEvent.click(screen.getByRole("button", { name: "Enable Bypass permissions" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Enable Bypass permissions" }));
    await waitFor(() => assert.equal(applied.length, 1));
    assert.equal(applied[0]?.bypassPermissions?.activeForSession, true);
  } finally {
    api.sessionPermissionMode = originalMode;
  }
});

test("a save failure surfaces the existing notice copy", async () => {
  const state = baseState();
  const original = api.saveWorkspacePolicy;
  api.saveWorkspacePolicy = (async () => {
    throw new Error("network down");
  }) as unknown as typeof api.saveWorkspacePolicy;
  try {
    render(
      <PolicyControls
        state={state}
        sessionId="session-a"
        hostOk
        runStartedAt={null}
        onApplyState={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Trusted workspace/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    assert.ok(await screen.findByText("Couldn\u2019t save the permission policy. Review remains active."));
  } finally {
    api.saveWorkspacePolicy = original;
  }
});
