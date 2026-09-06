import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSurface } from "../surfaces/RunSurface";
import type { RunProjectionRun } from "../projections/runReducer";
import {
  HOOKS_AVAILABLE_ANNOUNCE,
  HOOKS_FAILED,
  HOOKS_GENERIC_IDENTITY,
  HOOKS_HEADER,
  HOOKS_HELPER,
  HOOKS_LIVE_GROWING,
  HOOKS_LOADING,
  HOOKS_OFFLINE,
  HOOKS_RECONNECT_SHORT,
  HOOKS_STATUS_DONE,
  HOOKS_STATUS_FAILED,
  HOOKS_STATUS_IDLE,
  HOOKS_STATUS_RUNNING,
  HOOKS_TOOLTIP_DONE,
  HOOKS_TOOLTIP_FAILED,
  HOOKS_TOOLTIP_IDLE,
  HOOKS_TOOLTIP_RUNNING,
  HOOKS_UNAVAILABLE,
  type HookRow,
  type HooksProjection,
} from "../projections/hooksProjection";
import { HooksSection } from "./HooksSection";
import { MCP_HEADER } from "../projections/mcpServersProjection";

afterEach(() => cleanup());

function row(overrides: Partial<HookRow> = {}): HookRow {
  return {
    hookId: "h1",
    identityLabel: "PreTool",
    status: "running",
    showLiveRunningChip: true,
    restore: "restored",
    firstEventSeq: 1,
    ...overrides,
  };
}

function ready(overrides: Partial<Extract<HooksProjection, { state: "ready" }>> = {}): Extract<HooksProjection, { state: "ready" }> {
  const members = overrides.members ?? [row()];
  return {
    state: "ready",
    members,
    totalCount: overrides.totalCount ?? members.length,
    runningCount: overrides.runningCount ?? members.filter((m) => m.showLiveRunningChip).length,
    idleCount: overrides.idleCount ?? members.filter((m) => m.status === "idle").length,
    doneCount: overrides.doneCount ?? members.filter((m) => m.status === "done").length,
    failedCount: overrides.failedCount ?? members.filter((m) => m.status === "failed").length,
    liveGrowing: overrides.liveGrowing ?? false,
    offlineCopy: overrides.offlineCopy ?? null,
    reconnectCopy: overrides.reconnectCopy ?? null,
  };
}

test("absent renders no Hooks section", () => {
  const { container } = render(<HooksSection projection={{ state: "absent" }} />);
  assert.equal(container.textContent, "");
  assert.equal(container.querySelector("[aria-label='Hooks']") === null, true);
  assert.equal(screen.queryByText(HOOKS_HEADER) === null, true);
});

test("loading shows Loading hooks…", () => {
  render(
    <HooksSection
      projection={{ state: "loading", members: null, sectionCopy: HOOKS_LOADING, reconnectCopy: null }}
    />,
  );
  assert.ok(screen.getByText(HOOKS_LOADING));
  assert.ok(screen.getByLabelText(HOOKS_HEADER));
  assert.equal(screen.queryByText(HOOKS_OFFLINE) === null, true);
  assert.equal(screen.queryByText(HOOKS_FAILED) === null, true);
});

test("loading keeps prior members inspectable", () => {
  render(
    <HooksSection
      projection={{
        state: "loading",
        members: [row({ status: "idle", showLiveRunningChip: false })],
        sectionCopy: HOOKS_LOADING,
        reconnectCopy: null,
      }}
    />,
  );
  assert.ok(screen.getByText(HOOKS_LOADING));
  assert.ok(screen.getByText("PreTool"));
  assert.ok(screen.getByText(HOOKS_STATUS_IDLE));
});

test("hydrating loading never paints offline reconnect as section lead", () => {
  render(
    <HooksSection
      projection={{
        state: "loading",
        members: [row({ showLiveRunningChip: false })],
        sectionCopy: HOOKS_LOADING,
        reconnectCopy: null,
      }}
    />,
  );
  assert.ok(screen.getByText(HOOKS_LOADING));
  assert.equal(screen.queryByText(HOOKS_OFFLINE) === null, true);
  assert.equal(screen.queryByText(HOOKS_RECONNECT_SHORT) === null, true);
});

test("error without members shows Couldn't load hooks. as alert", () => {
  render(<HooksSection projection={{ state: "error", message: HOOKS_FAILED, members: null }} />);
  const alert = screen.getByRole("alert");
  assert.equal(alert.textContent, HOOKS_FAILED);
  assert.equal(screen.queryByText(HOOKS_LOADING) === null, true);
});

test("error keep-visible paints Couldn't load hooks. and retained members", () => {
  render(
    <HooksSection
      projection={{
        state: "error",
        message: HOOKS_FAILED,
        members: [row({ status: "idle", showLiveRunningChip: false, identityLabel: "SessionStart", hookId: "h2" })],
      }}
    />,
  );
  const alert = screen.getByRole("alert");
  assert.equal(alert.textContent, HOOKS_FAILED);
  assert.ok(screen.getByText("SessionStart"));
  assert.ok(screen.getByText(HOOKS_STATUS_IDLE));
});

test("ready header, count, live Running chip, identity, and helper", () => {
  render(<HooksSection projection={ready({ liveGrowing: true, runningCount: 1, totalCount: 1 })} />);
  const section = screen.getByLabelText(HOOKS_HEADER);
  assert.ok(within(section).getByRole("heading", { name: HOOKS_HEADER }));
  assert.ok(within(section).getByText("1"));
  assert.ok(within(section).getByText("1 running"));
  assert.ok(within(section).getByText("PreTool"));
  const chip = within(section).getByText(HOOKS_STATUS_RUNNING);
  assert.equal(chip.getAttribute("title"), HOOKS_TOOLTIP_RUNNING);
  assert.ok(screen.getByText(HOOKS_LIVE_GROWING));
  assert.ok(screen.getByText(HOOKS_HELPER));
});

test("Idle-only roster mounts section with Idle chip — not quiet empty", () => {
  render(
    <HooksSection
      projection={ready({
        members: [row({ status: "idle", showLiveRunningChip: false, identityLabel: "SessionStart" })],
        runningCount: 0,
        idleCount: 1,
        totalCount: 1,
      })}
    />,
  );
  const section = screen.getByLabelText(HOOKS_HEADER);
  assert.ok(within(section).getByText(HOOKS_HEADER));
  assert.ok(within(section).getByText("1"));
  assert.ok(within(section).getByText("1 idle"));
  assert.ok(within(section).getByText("SessionStart"));
  assert.ok(within(section).getByText(HOOKS_STATUS_IDLE));
  assert.equal(within(section).queryByText(HOOKS_STATUS_RUNNING) === null, true);
});

test("withheld historical running has identity but no live Running chip, tooltip, or live count", () => {
  render(
    <HooksSection
      projection={ready({
        members: [
          row({ showLiveRunningChip: false }),
          row({
            hookId: "h2",
            identityLabel: "SessionStart",
            status: "idle",
            showLiveRunningChip: false,
            firstEventSeq: 2,
          }),
        ],
        runningCount: 0,
        idleCount: 1,
        totalCount: 2,
        offlineCopy: HOOKS_OFFLINE,
      })}
    />,
  );
  const section = screen.getByLabelText(HOOKS_HEADER);
  assert.ok(within(section).getByText("PreTool"));
  assert.equal(within(section).queryByText(HOOKS_STATUS_RUNNING) === null, true);
  assert.equal(within(section).queryByTitle(HOOKS_TOOLTIP_RUNNING) === null, true);
  assert.ok(within(section).getByText(HOOKS_STATUS_IDLE));
  assert.equal(within(section).queryByText("1 running") === null, true);
  assert.ok(within(section).getByText("1 idle"));
  assert.ok(within(section).getByText("2"));
  assert.ok(within(section).getByText(HOOKS_OFFLINE));
});

test("parent-terminal reconnect copy is the short string", () => {
  render(
    <HooksSection
      projection={ready({
        members: [row({ showLiveRunningChip: false })],
        runningCount: 0,
        reconnectCopy: HOOKS_RECONNECT_SHORT,
      })}
    />,
  );
  assert.ok(screen.getByText(HOOKS_RECONNECT_SHORT));
  assert.equal(screen.queryByText(HOOKS_OFFLINE) === null, true);
});

test("Idle / Done / Failed chips carry meaning in text and tooltip; Running ≠ Done", () => {
  render(
    <HooksSection
      projection={ready({
        members: [
          row({
            hookId: "h1",
            identityLabel: "PreTool",
            status: "running",
            showLiveRunningChip: true,
          }),
          row({
            hookId: "h2",
            identityLabel: "SessionStart",
            status: "idle",
            showLiveRunningChip: false,
            firstEventSeq: 2,
          }),
          row({
            hookId: "h3",
            identityLabel: "PostTool",
            status: "done",
            showLiveRunningChip: false,
            firstEventSeq: 3,
          }),
          row({
            hookId: "h4",
            identityLabel: "Auth",
            status: "failed",
            showLiveRunningChip: false,
            firstEventSeq: 4,
          }),
        ],
        runningCount: 1,
        idleCount: 1,
        doneCount: 1,
        failedCount: 1,
        totalCount: 4,
      })}
    />,
  );
  const running = screen.getByText(HOOKS_STATUS_RUNNING);
  const idle = screen.getByText(HOOKS_STATUS_IDLE);
  const done = screen.getByText(HOOKS_STATUS_DONE);
  const failed = screen.getByText(HOOKS_STATUS_FAILED);
  assert.equal(running.getAttribute("title"), HOOKS_TOOLTIP_RUNNING);
  assert.equal(idle.getAttribute("title"), HOOKS_TOOLTIP_IDLE);
  assert.equal(done.getAttribute("title"), HOOKS_TOOLTIP_DONE);
  assert.equal(failed.getAttribute("title"), HOOKS_TOOLTIP_FAILED);
  assert.ok(screen.getByText("1 running"));
  assert.ok(screen.getByText("1 idle"));
  assert.ok(screen.getByText("1 done"));
  assert.ok(screen.getByText("1 failed"));
  assert.notEqual(HOOKS_STATUS_RUNNING, HOOKS_STATUS_DONE);
});

test("unrestorable paints Unavailable beside restored peer, not Failed, no invented name", () => {
  render(
    <HooksSection
      projection={ready({
        members: [
          row({
            hookId: "ok",
            identityLabel: "SessionStart",
            status: "idle",
            showLiveRunningChip: false,
          }),
          row({
            hookId: "gone",
            identityLabel: HOOKS_GENERIC_IDENTITY,
            status: null,
            showLiveRunningChip: false,
            restore: "unrestorable",
            firstEventSeq: 2,
          }),
        ],
        totalCount: 2,
        runningCount: 0,
        idleCount: 1,
        failedCount: 0,
      })}
    />,
  );
  const section = screen.getByLabelText(HOOKS_HEADER);
  assert.ok(within(section).getByText("SessionStart"));
  assert.ok(within(section).getByText(HOOKS_UNAVAILABLE));
  assert.ok(within(section).getByText(HOOKS_GENERIC_IDENTITY));
  assert.equal(within(section).queryByText("Should not paint") === null, true);
  const failedChips = within(section).queryAllByText(HOOKS_STATUS_FAILED);
  assert.equal(failedChips.length, 0);
  assert.ok(within(section).getByText("2"));
  assert.equal(within(section).queryByText("1 failed") === null, true);
});

test("name-null identity paints generic Hook with status chip", () => {
  render(
    <HooksSection
      projection={ready({
        members: [row({ identityLabel: HOOKS_GENERIC_IDENTITY, status: "idle", showLiveRunningChip: false })],
        runningCount: 0,
        idleCount: 1,
      })}
    />,
  );
  assert.ok(screen.getByText(HOOKS_GENERIC_IDENTITY));
  assert.ok(screen.getByText(HOOKS_STATUS_IDLE));
});

test("header {N} is membership size including Unavailable and Idle, not live running count", () => {
  render(
    <HooksSection
      projection={ready({
        members: [
          row({ showLiveRunningChip: false }),
          row({
            hookId: "gone",
            identityLabel: HOOKS_GENERIC_IDENTITY,
            status: null,
            showLiveRunningChip: false,
            restore: "unrestorable",
            firstEventSeq: 2,
          }),
          row({
            hookId: "h3",
            identityLabel: "Auth",
            status: "failed",
            showLiveRunningChip: false,
            firstEventSeq: 3,
          }),
        ],
        totalCount: 3,
        runningCount: 0,
        idleCount: 0,
        failedCount: 1,
        offlineCopy: HOOKS_OFFLINE,
      })}
    />,
  );
  const section = screen.getByLabelText(HOOKS_HEADER);
  assert.ok(within(section).getByText("3"));
  assert.equal(within(section).queryByText("0") === null, true);
  assert.equal(within(section).queryByText("1 running") === null, true);
});

test("header toggle collapses and expands rows", async () => {
  const user = userEvent.setup();
  render(<HooksSection projection={ready()} />);
  assert.ok(screen.getByText("PreTool"));
  await user.click(screen.getByRole("button", { name: /Hooks/i }));
  assert.equal(screen.queryByText("PreTool") === null, true);
  await user.click(screen.getByRole("button", { name: /Hooks/i }));
  assert.ok(screen.getByText("PreTool"));
});

test("long name is in title and accessible name", () => {
  const long = "vendor-hook-with-a-very-long-identity-that-should-truncate";
  render(
    <HooksSection
      projection={ready({
        members: [row({ identityLabel: long })],
      })}
    />,
  );
  const ident = screen.getByLabelText(long);
  assert.equal(ident.getAttribute("title"), long);
  assert.equal(ident.textContent, long);
});

test("Hooks never hosts settle controls", () => {
  render(<HooksSection projection={ready()} />);
  const section = screen.getByLabelText(HOOKS_HEADER);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Reject" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Allow" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Decline" }) === null, true);
});

test("banned Stuck / Status unconfirmed / Healthy / Connected / Error copy is not painted", () => {
  render(<HooksSection projection={ready()} />);
  const text = screen.getByLabelText(HOOKS_HEADER).textContent ?? "";
  assert.equal(/stuck/i.test(text), false);
  assert.equal(/status unconfirmed/i.test(text), false);
  assert.equal(/\bhealthy\b/i.test(text), false);
  assert.equal(/\bconnected\b/i.test(text), false);
  assert.equal(/\berror\b/i.test(text), false);
});

test("Hooks sits after MCP and before Activity", () => {
  const run = {
    sessionId: "s",
    runId: "r",
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "go",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 4,
    policy: { effectiveMode: "review" },
    model: { id: "grok-4.6" },
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    reasoning: {},
    answer: {},
    message: {},
    activities: {
      a1: {
        activityId: "a1",
        invocationId: "f1",
        name: "web_fetch",
        lifecycle: "pending",
        execution: null,
        status: "running",
        input: {},
        output: null,
        error: null,
        diff: null,
        path: null,
        policy: {},
        automaticEligibility: "read",
        autoApplied: false,
        command: null,
        editId: null,
        recovery: null,
        acpToolKind: "fetch",
        url: "https://docs.x.ai",
        title: "Docs",
        snapshotJournaled: false,
      },
    },
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: null,
    childAgents: {},
  } as unknown as RunProjectionRun;
  render(
    <RunSurface
      run={run}
      productMode="code"
      codeAgent={{ resolveStatus: "ready", identity: "vendor", fallbackReason: null }}
      mcpServers={{
        disposition: "ready",
        members: [{
          serverId: "s1",
          name: "Search",
          status: "connected",
          restore: "restored",
          firstEventSeq: 4,
        }],
      }}
      hooks={{
        disposition: "ready",
        members: [{
          hookId: "h1",
          name: "PreTool",
          status: "running",
          restore: "restored",
          firstEventSeq: 5,
        }],
      }}
    />,
  );
  const mcp = screen.getByLabelText(MCP_HEADER);
  const hooks = screen.getByLabelText(HOOKS_HEADER);
  const activity = screen.getByLabelText("Activity");
  assert.ok(mcp.compareDocumentPosition(hooks) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(hooks.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("announces Hooks available once membership becomes non-zero, and Failed when a row fails", () => {
  const { rerender } = render(<HooksSection projection={{ state: "absent" }} />);
  rerender(<HooksSection projection={ready()} />);
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    HOOKS_AVAILABLE_ANNOUNCE,
  );
  rerender(
    <HooksSection
      projection={ready({
        members: [row({ status: "failed", showLiveRunningChip: false })],
        runningCount: 0,
        failedCount: 1,
      })}
    />,
  );
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    HOOKS_STATUS_FAILED,
  );
});
