import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSurface } from "../surfaces/RunSurface";
import type { RunProjectionRun } from "../projections/runReducer";
import {
  CHILD_AGENTS_AVAILABLE_ANNOUNCE,
  CHILD_AGENTS_FAILED,
  CHILD_AGENTS_HEADER,
  CHILD_AGENTS_HELPER,
  CHILD_AGENTS_LIVE_GROWING,
  CHILD_AGENTS_LOADING,
  CHILD_AGENTS_OFFLINE,
  CHILD_AGENTS_RECONNECT_SHORT,
  CHILD_AGENTS_STATUS_DONE,
  CHILD_AGENTS_STATUS_FAILED,
  CHILD_AGENTS_STATUS_RUNNING,
  CHILD_AGENTS_TOOLTIP_DONE,
  CHILD_AGENTS_TOOLTIP_FAILED,
  CHILD_AGENTS_TOOLTIP_RUNNING,
  type ChildAgentsProjection,
  type ChildAgentsRow,
} from "../projections/childAgentsProjection";
import { ChildAgentsSection } from "./ChildAgentsSection";

afterEach(() => cleanup());

function row(overrides: Partial<ChildAgentsRow> = {}): ChildAgentsRow {
  return {
    childId: "c1",
    identityLabel: "Researcher",
    status: "running",
    showLiveRunningChip: true,
    firstEventSeq: 1,
    ...overrides,
  };
}

function ready(overrides: Partial<Extract<ChildAgentsProjection, { state: "ready" }>> = {}): Extract<ChildAgentsProjection, { state: "ready" }> {
  const members = overrides.members ?? [row()];
  return {
    state: "ready",
    members,
    runningCount: overrides.runningCount ?? members.filter((m) => m.showLiveRunningChip).length,
    doneCount: overrides.doneCount ?? members.filter((m) => m.status === "done").length,
    failedCount: overrides.failedCount ?? members.filter((m) => m.status === "failed").length,
    liveGrowing: overrides.liveGrowing ?? false,
    offlineCopy: overrides.offlineCopy ?? null,
    reconnectCopy: overrides.reconnectCopy ?? null,
  };
}

test("absent renders no Child agents section", () => {
  const { container } = render(<ChildAgentsSection projection={{ state: "absent" }} />);
  assert.equal(container.textContent, "");
  assert.equal(container.querySelector("[aria-label='Child agents']") === null, true);
  assert.equal(screen.queryByText(CHILD_AGENTS_HEADER) === null, true);
});

test("loading shows Loading child agents…", () => {
  render(<ChildAgentsSection projection={{ state: "loading", members: null, reconnectCopy: null }} />);
  assert.ok(screen.getByText(CHILD_AGENTS_LOADING));
  assert.ok(screen.getByLabelText(CHILD_AGENTS_HEADER));
  assert.equal(screen.queryByText("0 children") === null, true);
});

test("loading keeps prior members inspectable", () => {
  render(
    <ChildAgentsSection
      projection={{
        state: "loading",
        members: [row({ status: "done", showLiveRunningChip: false })],
        reconnectCopy: null,
      }}
    />,
  );
  assert.ok(screen.getByText(CHILD_AGENTS_LOADING));
  assert.ok(screen.getByText("Researcher"));
  assert.ok(screen.getByText(CHILD_AGENTS_STATUS_DONE));
});

test("error shows Couldn't load child agents. as alert", () => {
  render(<ChildAgentsSection projection={{ state: "error", message: CHILD_AGENTS_FAILED }} />);
  const alert = screen.getByRole("alert");
  assert.equal(alert.textContent, CHILD_AGENTS_FAILED);
  assert.equal(screen.queryByText(CHILD_AGENTS_LOADING) === null, true);
});

test("ready header, count, live Running chip, and identity", () => {
  render(<ChildAgentsSection projection={ready({ liveGrowing: true, runningCount: 1 })} />);
  const section = screen.getByLabelText(CHILD_AGENTS_HEADER);
  assert.ok(within(section).getByRole("heading", { name: CHILD_AGENTS_HEADER }));
  assert.ok(within(section).getByText("1"));
  assert.ok(within(section).getByText("1 running"));
  assert.ok(within(section).getByText("Researcher"));
  const chip = within(section).getByText(CHILD_AGENTS_STATUS_RUNNING);
  assert.equal(chip.getAttribute("title"), CHILD_AGENTS_TOOLTIP_RUNNING);
  assert.ok(screen.getByText(CHILD_AGENTS_LIVE_GROWING));
  assert.ok(screen.getByText(CHILD_AGENTS_HELPER));
});

test("withheld historical running has identity but no live Running chip and is not counted", () => {
  render(
    <ChildAgentsSection
      projection={ready({
        members: [
          row({ showLiveRunningChip: false }),
          row({
            childId: "c2",
            identityLabel: "Summarizer",
            status: "done",
            showLiveRunningChip: false,
            firstEventSeq: 2,
          }),
        ],
        runningCount: 0,
        doneCount: 1,
        offlineCopy: CHILD_AGENTS_OFFLINE,
      })}
    />,
  );
  const section = screen.getByLabelText(CHILD_AGENTS_HEADER);
  assert.ok(within(section).getByText("Researcher"));
  assert.equal(within(section).queryByText(CHILD_AGENTS_STATUS_RUNNING) === null, true);
  assert.ok(within(section).getByText(CHILD_AGENTS_STATUS_DONE));
  assert.equal(within(section).queryByText("1 running") === null, true);
  assert.ok(within(section).getByText("1 done"));
  assert.ok(within(section).getByText(CHILD_AGENTS_OFFLINE));
});

test("parent-terminal reconnect copy is the short string", () => {
  render(
    <ChildAgentsSection
      projection={ready({
        members: [row({ showLiveRunningChip: false })],
        runningCount: 0,
        reconnectCopy: CHILD_AGENTS_RECONNECT_SHORT,
      })}
    />,
  );
  assert.ok(screen.getByText(CHILD_AGENTS_RECONNECT_SHORT));
  assert.equal(screen.queryByText(CHILD_AGENTS_OFFLINE) === null, true);
});

test("Done and Failed chips carry meaning in text and tooltip", () => {
  render(
    <ChildAgentsSection
      projection={ready({
        members: [
          row({
            childId: "c2",
            identityLabel: "Summarizer",
            status: "done",
            showLiveRunningChip: false,
          }),
          row({
            childId: "c3",
            identityLabel: "Boom",
            status: "failed",
            showLiveRunningChip: false,
            firstEventSeq: 3,
          }),
        ],
        runningCount: 0,
        doneCount: 1,
        failedCount: 1,
      })}
    />,
  );
  const done = screen.getByText(CHILD_AGENTS_STATUS_DONE);
  const failed = screen.getByText(CHILD_AGENTS_STATUS_FAILED);
  assert.equal(done.getAttribute("title"), CHILD_AGENTS_TOOLTIP_DONE);
  assert.equal(failed.getAttribute("title"), CHILD_AGENTS_TOOLTIP_FAILED);
  assert.ok(screen.getByText("1 done"));
  assert.ok(screen.getByText("1 failed"));
});

test("header toggle collapses and expands rows", async () => {
  const user = userEvent.setup();
  render(<ChildAgentsSection projection={ready()} />);
  assert.ok(screen.getByText("Researcher"));
  await user.click(screen.getByRole("button", { name: /Child agents/i }));
  assert.equal(screen.queryByText("Researcher") === null, true);
  await user.click(screen.getByRole("button", { name: /Child agents/i }));
  assert.ok(screen.getByText("Researcher"));
});

test("long identity is in title and accessible name", () => {
  const long = "vendor-child-with-a-very-long-identity-label-that-should-truncate";
  render(
    <ChildAgentsSection
      projection={ready({
        members: [row({ identityLabel: long })],
      })}
    />,
  );
  const ident = screen.getByLabelText(long);
  assert.equal(ident.getAttribute("title"), long);
  assert.equal(ident.textContent, long);
});

test("Child agents never hosts settle controls", () => {
  render(<ChildAgentsSection projection={ready()} />);
  const section = screen.getByLabelText(CHILD_AGENTS_HEADER);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Reject" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Allow" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Decline" }) === null, true);
});

test("banned Stuck / Status unconfirmed copy is not painted", () => {
  render(<ChildAgentsSection projection={ready()} />);
  const text = screen.getByLabelText(CHILD_AGENTS_HEADER).textContent ?? "";
  assert.equal(/stuck/i.test(text), false);
  assert.equal(/status unconfirmed/i.test(text), false);
});

test("Child agents sits after Git review / inventories and before Activity", () => {
  const run = {
    sessionId: "s",
    runId: "r",
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "go",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 3,
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
        invocationId: "i1",
        name: "read_file",
        lifecycle: "pending",
        execution: null,
        status: "running",
        input: {},
        output: null,
        error: null,
        diff: null,
        path: "notes.md",
        policy: {},
        automaticEligibility: "read",
        autoApplied: false,
        command: null,
        editId: null,
        recovery: null,
      },
    },
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: null,
    childAgents: {
      c1: { childId: "c1", identityLabel: "Researcher", status: "running", firstEventSeq: 2 },
    },
  } as unknown as RunProjectionRun;
  render(
    <RunSurface
      run={run}
      productMode="code"
      codeAgent={{ resolveStatus: "ready", identity: "vendor", fallbackReason: null }}
      childAgents={{
        disposition: "ready",
        members: [{ childId: "c1", identityLabel: "Researcher", status: "running", firstEventSeq: 2 }],
      }}
    />,
  );
  const child = screen.getByLabelText(CHILD_AGENTS_HEADER);
  const activity = screen.getByLabelText("Activity");
  assert.ok(child.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("announces Child agents available once membership becomes non-zero, and Failed when a row fails", () => {
  const { rerender } = render(<ChildAgentsSection projection={{ state: "absent" }} />);
  rerender(<ChildAgentsSection projection={ready()} />);
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    CHILD_AGENTS_AVAILABLE_ANNOUNCE,
  );
  rerender(
    <ChildAgentsSection
      projection={ready({
        members: [row({ status: "failed", showLiveRunningChip: false })],
        runningCount: 0,
        failedCount: 1,
      })}
    />,
  );
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    CHILD_AGENTS_STATUS_FAILED,
  );
});
