import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverviewStrip } from "./OverviewStrip";

afterEach(() => cleanup());

const overview = {
  tools: 1,
  toolFails: 0,
  filesTouched: ["docs/dogfood/KEEP.md"],
  lastError: null,
  userTurns: 1,
};

test("FILES token jumps to File changes when a handler is provided", () => {
  let jumped = 0;
  render(
    <OverviewStrip
      overview={overview}
      workspaceName="grokforge"
      onJumpToFiles={() => {
        jumped += 1;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /files\s+KEEP\.md/i }));
  assert.equal(jumped, 1);
});

test("TOOLS token jumps to Tool activity when a handler is provided", () => {
  let jumped = 0;
  render(
    <OverviewStrip
      overview={overview}
      workspaceName="grokforge"
      onJumpToTools={() => {
        jumped += 1;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /tools\s+1/i }));
  assert.equal(jumped, 1);
});

test("FILES stays plain text when there is nothing to jump to", () => {
  render(
    <OverviewStrip
      overview={{ ...overview, filesTouched: [] }}
      workspaceName="grokforge"
      onJumpToFiles={() => undefined}
    />,
  );
  assert.equal(screen.queryByRole("button", { name: /files/i }) === null, true);
});

const winCmd = {
  status: "available" as const,
  platform: "win32",
  osFamily: "windows" as const,
  executable: "C:\\Windows\\System32\\cmd.exe",
  displayName: "Command Prompt (cmd.exe)",
  dialect: "cmd" as const,
  reasonCode: null,
  reason: null,
};

test("vendor Windows Code shows PowerShell, not Forge cmd.exe", () => {
  render(
    <OverviewStrip
      overview={overview}
      workspaceName="grokforge"
      shellCapability={winCmd}
      codeAgentIdentity="vendor"
    />,
  );
  assert.match(screen.getByLabelText("Run overview").textContent || "", /shell\s+PowerShell/i);
  assert.equal(screen.queryByText(/Command Prompt/i) === null, true);
});

test("fallback Windows Code keeps Command Prompt", () => {
  render(
    <OverviewStrip
      overview={overview}
      workspaceName="grokforge"
      shellCapability={winCmd}
      codeAgentIdentity="fallback"
    />,
  );
  assert.match(screen.getByLabelText("Run overview").textContent || "", /Command Prompt \(cmd\.exe\)/);
});
