import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSurface } from "./RunSurface";
import type { RunProjectionRun } from "./runReducer";
import {
  BROWSER_AVAILABLE_ANNOUNCE,
  BROWSER_FAILED,
  BROWSER_GENERIC_IDENTITY,
  BROWSER_HEADER,
  BROWSER_HELPER,
  BROWSER_LIVE_GROWING,
  BROWSER_LOADING,
  BROWSER_OFFLINE,
  BROWSER_RECONNECT_SHORT,
  BROWSER_SNAPSHOT,
  BROWSER_SNAPSHOT_MUTED,
  BROWSER_STATUS_DONE,
  BROWSER_STATUS_FAILED,
  BROWSER_STATUS_RUNNING,
  BROWSER_TOOLTIP_DONE,
  BROWSER_TOOLTIP_FAILED,
  BROWSER_TOOLTIP_RUNNING,
  BROWSER_TOOLTIP_SNAPSHOT,
  BROWSER_UNAVAILABLE,
  type BrowserWorkProjection,
  type BrowserWorkRow,
} from "./browserWorkProjection";
import { BrowserSection } from "./BrowserSection";

afterEach(() => cleanup());

function row(overrides: Partial<BrowserWorkRow> = {}): BrowserWorkRow {
  return {
    toolCallId: "f1",
    identityLabel: "Docs",
    url: "https://docs.x.ai",
    title: "Docs",
    status: "running",
    showLiveRunningChip: true,
    snapshotJournaled: false,
    restore: "restored",
    firstEventSeq: 1,
    ...overrides,
  };
}

function ready(overrides: Partial<Extract<BrowserWorkProjection, { state: "ready" }>> = {}): Extract<BrowserWorkProjection, { state: "ready" }> {
  const members = overrides.members ?? [row()];
  return {
    state: "ready",
    members,
    totalCount: overrides.totalCount ?? members.length,
    runningCount: overrides.runningCount ?? members.filter((m) => m.showLiveRunningChip).length,
    doneCount: overrides.doneCount ?? members.filter((m) => m.status === "done").length,
    failedCount: overrides.failedCount ?? members.filter((m) => m.status === "failed").length,
    liveGrowing: overrides.liveGrowing ?? false,
    offlineCopy: overrides.offlineCopy ?? null,
    reconnectCopy: overrides.reconnectCopy ?? null,
  };
}

test("absent renders no Browser section", () => {
  const { container } = render(<BrowserSection projection={{ state: "absent" }} />);
  assert.equal(container.textContent, "");
  assert.equal(container.querySelector("[aria-label='Browser']"), null);
  assert.equal(screen.queryByText(BROWSER_HEADER), null);
});

test("loading shows Loading browser work…", () => {
  render(
    <BrowserSection
      projection={{ state: "loading", members: null, sectionCopy: BROWSER_LOADING, reconnectCopy: null }}
    />,
  );
  assert.ok(screen.getByText(BROWSER_LOADING));
  assert.ok(screen.getByLabelText(BROWSER_HEADER));
  assert.equal(screen.queryByText("0 pages"), null);
  assert.equal(screen.queryByText(BROWSER_OFFLINE), null);
});

test("loading keeps prior members inspectable", () => {
  render(
    <BrowserSection
      projection={{
        state: "loading",
        members: [row({ status: "done", showLiveRunningChip: false })],
        sectionCopy: BROWSER_LOADING,
        reconnectCopy: null,
      }}
    />,
  );
  assert.ok(screen.getByText(BROWSER_LOADING));
  assert.ok(screen.getByText("Docs"));
  assert.ok(screen.getByText(BROWSER_STATUS_DONE));
});

test("hydrating loading never paints offline reconnect as section lead", () => {
  render(
    <BrowserSection
      projection={{
        state: "loading",
        members: [row({ showLiveRunningChip: false })],
        sectionCopy: BROWSER_LOADING,
        reconnectCopy: null,
      }}
    />,
  );
  assert.ok(screen.getByText(BROWSER_LOADING));
  assert.equal(screen.queryByText(BROWSER_OFFLINE), null);
  assert.equal(screen.queryByText(BROWSER_RECONNECT_SHORT), null);
});

test("error shows Couldn't load browser work. as alert", () => {
  render(<BrowserSection projection={{ state: "error", message: BROWSER_FAILED }} />);
  const alert = screen.getByRole("alert");
  assert.equal(alert.textContent, BROWSER_FAILED);
  assert.equal(screen.queryByText(BROWSER_LOADING), null);
});

test("ready header, count, live Running chip, identity, and helper", () => {
  render(<BrowserSection projection={ready({ liveGrowing: true, runningCount: 1, totalCount: 1 })} />);
  const section = screen.getByLabelText(BROWSER_HEADER);
  assert.ok(within(section).getByRole("heading", { name: BROWSER_HEADER }));
  assert.ok(within(section).getByText("1"));
  assert.ok(within(section).getByText("1 running"));
  assert.ok(within(section).getByText("Docs"));
  const chip = within(section).getByText(BROWSER_STATUS_RUNNING);
  assert.equal(chip.getAttribute("title"), BROWSER_TOOLTIP_RUNNING);
  assert.ok(screen.getByText(BROWSER_LIVE_GROWING));
  assert.ok(screen.getByText(BROWSER_HELPER));
});

test("withheld historical running has identity but no live Running chip and is not counted", () => {
  render(
    <BrowserSection
      projection={ready({
        members: [
          row({ showLiveRunningChip: false }),
          row({
            toolCallId: "f2",
            identityLabel: "A",
            url: "https://a.example",
            title: "A",
            status: "done",
            showLiveRunningChip: false,
            firstEventSeq: 2,
          }),
        ],
        runningCount: 0,
        doneCount: 1,
        totalCount: 2,
        offlineCopy: BROWSER_OFFLINE,
      })}
    />,
  );
  const section = screen.getByLabelText(BROWSER_HEADER);
  assert.ok(within(section).getByText("Docs"));
  assert.equal(within(section).queryByText(BROWSER_STATUS_RUNNING), null);
  assert.ok(within(section).getByText(BROWSER_STATUS_DONE));
  assert.equal(within(section).queryByText("1 running"), null);
  assert.ok(within(section).getByText("1 done"));
  assert.ok(within(section).getByText(BROWSER_OFFLINE));
});

test("parent-terminal reconnect copy is the short string", () => {
  render(
    <BrowserSection
      projection={ready({
        members: [row({ showLiveRunningChip: false })],
        runningCount: 0,
        reconnectCopy: BROWSER_RECONNECT_SHORT,
      })}
    />,
  );
  assert.ok(screen.getByText(BROWSER_RECONNECT_SHORT));
  assert.equal(screen.queryByText(BROWSER_OFFLINE), null);
});

test("Done and Failed chips carry meaning in text and tooltip", () => {
  render(
    <BrowserSection
      projection={ready({
        members: [
          row({
            toolCallId: "f2",
            identityLabel: "A",
            url: "https://a.example",
            title: "A",
            status: "done",
            showLiveRunningChip: false,
          }),
          row({
            toolCallId: "f3",
            identityLabel: "Boom",
            url: null,
            title: "Boom",
            status: "failed",
            showLiveRunningChip: false,
            firstEventSeq: 3,
          }),
        ],
        runningCount: 0,
        doneCount: 1,
        failedCount: 1,
        totalCount: 2,
      })}
    />,
  );
  const done = screen.getByText(BROWSER_STATUS_DONE);
  const failed = screen.getByText(BROWSER_STATUS_FAILED);
  assert.equal(done.getAttribute("title"), BROWSER_TOOLTIP_DONE);
  assert.equal(failed.getAttribute("title"), BROWSER_TOOLTIP_FAILED);
  assert.ok(screen.getByText("1 done"));
  assert.ok(screen.getByText("1 failed"));
});

test("unrestorable paints Unavailable beside restored peer, not Failed, no invented url/snapshot", () => {
  render(
    <BrowserSection
      projection={ready({
        members: [
          row({
            toolCallId: "ok",
            identityLabel: "A",
            url: "https://a.example",
            title: "A",
            status: "done",
            showLiveRunningChip: false,
          }),
          row({
            toolCallId: "gone",
            identityLabel: BROWSER_GENERIC_IDENTITY,
            url: null,
            title: null,
            status: null,
            showLiveRunningChip: false,
            snapshotJournaled: false,
            restore: "unrestorable",
            firstEventSeq: 2,
          }),
        ],
        totalCount: 2,
        runningCount: 0,
        doneCount: 1,
        failedCount: 0,
      })}
    />,
  );
  const section = screen.getByLabelText(BROWSER_HEADER);
  assert.ok(within(section).getByText("A"));
  assert.ok(within(section).getByText(BROWSER_UNAVAILABLE));
  assert.ok(within(section).getByText(BROWSER_GENERIC_IDENTITY));
  assert.equal(within(section).queryByText("https://should-not-paint.example"), null);
  assert.equal(within(section).queryByText(BROWSER_SNAPSHOT), null);
  const failedChips = within(section).queryAllByText(BROWSER_STATUS_FAILED);
  assert.equal(failedChips.length, 0);
  assert.ok(within(section).getByText("2"));
  assert.equal(within(section).queryByText("1 failed"), null);
});

test("snapshot caption only when journaled; no img or data-URL", () => {
  const { rerender, container } = render(
    <BrowserSection
      projection={ready({
        members: [row({ status: "done", showLiveRunningChip: false, snapshotJournaled: true })],
        runningCount: 0,
        doneCount: 1,
      })}
    />,
  );
  const section = screen.getByLabelText(BROWSER_HEADER);
  assert.ok(within(section).getByText(BROWSER_SNAPSHOT));
  assert.ok(within(section).getByText(BROWSER_SNAPSHOT_MUTED));
  const snap = within(section).getByText(BROWSER_SNAPSHOT);
  assert.equal(snap.getAttribute("title") ?? snap.parentElement?.getAttribute("title"), BROWSER_TOOLTIP_SNAPSHOT);
  assert.equal(container.querySelector("img"), null);
  assert.equal((container.innerHTML || "").includes("data:"), false);

  rerender(
    <BrowserSection
      projection={ready({
        members: [row({ status: "done", showLiveRunningChip: false, snapshotJournaled: false })],
        runningCount: 0,
        doneCount: 1,
      })}
    />,
  );
  assert.equal(screen.queryByText(BROWSER_SNAPSHOT), null);
  assert.equal(screen.queryByText(BROWSER_SNAPSHOT_MUTED), null);
});

test("neither URL nor title paints generic Browser work — no invented host", () => {
  render(
    <BrowserSection
      projection={ready({
        members: [row({ identityLabel: BROWSER_GENERIC_IDENTITY, url: null, title: null })],
      })}
    />,
  );
  assert.ok(screen.getByText(BROWSER_GENERIC_IDENTITY));
  assert.equal(screen.queryByText("https://"), null);
});

test("title+url shows title primary and muted url", () => {
  render(
    <BrowserSection
      projection={ready({
        members: [row({ identityLabel: "Docs", title: "Docs", url: "https://docs.x.ai" })],
      })}
    />,
  );
  const section = screen.getByLabelText(BROWSER_HEADER);
  assert.ok(within(section).getByText("Docs"));
  assert.ok(within(section).getByText("https://docs.x.ai"));
});

test("header toggle collapses and expands rows", async () => {
  const user = userEvent.setup();
  render(<BrowserSection projection={ready()} />);
  assert.ok(screen.getByText("Docs"));
  await user.click(screen.getByRole("button", { name: /Browser/i }));
  assert.equal(screen.queryByText("Docs"), null);
  await user.click(screen.getByRole("button", { name: /Browser/i }));
  assert.ok(screen.getByText("Docs"));
});

test("long URL is in title and accessible name", () => {
  const long = "https://example.com/vendor-browser-with-a-very-long-path-that-should-truncate";
  render(
    <BrowserSection
      projection={ready({
        members: [row({ identityLabel: long, url: long, title: null })],
      })}
    />,
  );
  const ident = screen.getByLabelText(long);
  assert.equal(ident.getAttribute("title"), long);
  assert.equal(ident.textContent, long);
});

test("Browser never hosts settle controls", () => {
  render(<BrowserSection projection={ready()} />);
  const section = screen.getByLabelText(BROWSER_HEADER);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }), null);
  assert.equal(within(section).queryByRole("button", { name: "Reject" }), null);
  assert.equal(within(section).queryByRole("button", { name: "Allow" }), null);
  assert.equal(within(section).queryByRole("button", { name: "Decline" }), null);
});

test("banned Stuck / Status unconfirmed copy is not painted", () => {
  render(<BrowserSection projection={ready()} />);
  const text = screen.getByLabelText(BROWSER_HEADER).textContent ?? "";
  assert.equal(/stuck/i.test(text), false);
  assert.equal(/status unconfirmed/i.test(text), false);
});

test("Browser sits after Child agents and before Activity", () => {
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
      browserWork={{
        disposition: "ready",
        members: [{
          toolCallId: "f1",
          acpToolKind: "fetch",
          url: "https://docs.x.ai",
          title: "Docs",
          status: "running",
          snapshotJournaled: false,
          restore: "restored",
          firstEventSeq: 3,
        }],
      }}
    />,
  );
  const child = screen.getByLabelText("Child agents");
  const browser = screen.getByLabelText(BROWSER_HEADER);
  const activity = screen.getByLabelText("Activity");
  assert.ok(child.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(browser.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("announces Browser work available once membership becomes non-zero, and Failed when a row fails", () => {
  const { rerender } = render(<BrowserSection projection={{ state: "absent" }} />);
  rerender(<BrowserSection projection={ready()} />);
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    BROWSER_AVAILABLE_ANNOUNCE,
  );
  rerender(
    <BrowserSection
      projection={ready({
        members: [row({ status: "failed", showLiveRunningChip: false })],
        runningCount: 0,
        failedCount: 1,
      })}
    />,
  );
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    BROWSER_STATUS_FAILED,
  );
});
