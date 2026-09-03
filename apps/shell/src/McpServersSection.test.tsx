import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunSurface } from "./RunSurface";
import type { RunProjectionRun } from "./runReducer";
import {
  MCP_AVAILABLE_ANNOUNCE,
  MCP_FAILED,
  MCP_GENERIC_IDENTITY,
  MCP_HEADER,
  MCP_HELPER,
  MCP_LIVE_GROWING,
  MCP_LOADING,
  MCP_OFFLINE,
  MCP_RECONNECT_SHORT,
  MCP_STATUS_CONNECTED,
  MCP_STATUS_ERROR,
  MCP_STATUS_IDLE,
  MCP_TOOLTIP_CONNECTED,
  MCP_TOOLTIP_ERROR,
  MCP_TOOLTIP_IDLE,
  MCP_UNAVAILABLE,
  type McpServerRow,
  type McpServersProjection,
} from "./mcpServersProjection";
import { McpServersSection } from "./McpServersSection";
import { BROWSER_HEADER } from "./browserWorkProjection";

afterEach(() => cleanup());

function row(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    serverId: "s1",
    identityLabel: "Docs",
    status: "connected",
    showLiveConnectedChip: true,
    restore: "restored",
    firstEventSeq: 1,
    ...overrides,
  };
}

function ready(overrides: Partial<Extract<McpServersProjection, { state: "ready" }>> = {}): Extract<McpServersProjection, { state: "ready" }> {
  const members = overrides.members ?? [row()];
  return {
    state: "ready",
    members,
    totalCount: overrides.totalCount ?? members.length,
    connectedCount: overrides.connectedCount ?? members.filter((m) => m.showLiveConnectedChip).length,
    idleCount: overrides.idleCount ?? members.filter((m) => m.status === "idle").length,
    errorCount: overrides.errorCount ?? members.filter((m) => m.status === "error").length,
    liveGrowing: overrides.liveGrowing ?? false,
    offlineCopy: overrides.offlineCopy ?? null,
    reconnectCopy: overrides.reconnectCopy ?? null,
  };
}

test("absent renders no MCP section", () => {
  const { container } = render(<McpServersSection projection={{ state: "absent" }} />);
  assert.equal(container.textContent, "");
  assert.equal(container.querySelector("[aria-label='MCP']") === null, true);
  assert.equal(screen.queryByText(MCP_HEADER) === null, true);
});

test("loading shows Loading MCP…", () => {
  render(
    <McpServersSection
      projection={{ state: "loading", members: null, sectionCopy: MCP_LOADING, reconnectCopy: null }}
    />,
  );
  assert.ok(screen.getByText(MCP_LOADING));
  assert.ok(screen.getByLabelText(MCP_HEADER));
  assert.equal(screen.queryByText(MCP_OFFLINE) === null, true);
  assert.equal(screen.queryByText(MCP_FAILED) === null, true);
});

test("loading keeps prior members inspectable", () => {
  render(
    <McpServersSection
      projection={{
        state: "loading",
        members: [row({ status: "idle", showLiveConnectedChip: false })],
        sectionCopy: MCP_LOADING,
        reconnectCopy: null,
      }}
    />,
  );
  assert.ok(screen.getByText(MCP_LOADING));
  assert.ok(screen.getByText("Docs"));
  assert.ok(screen.getByText(MCP_STATUS_IDLE));
});

test("hydrating loading never paints offline reconnect as section lead", () => {
  render(
    <McpServersSection
      projection={{
        state: "loading",
        members: [row({ showLiveConnectedChip: false })],
        sectionCopy: MCP_LOADING,
        reconnectCopy: null,
      }}
    />,
  );
  assert.ok(screen.getByText(MCP_LOADING));
  assert.equal(screen.queryByText(MCP_OFFLINE) === null, true);
  assert.equal(screen.queryByText(MCP_RECONNECT_SHORT) === null, true);
});

test("error without members shows Couldn't load MCP. as alert", () => {
  render(<McpServersSection projection={{ state: "error", message: MCP_FAILED, members: null }} />);
  const alert = screen.getByRole("alert");
  assert.equal(alert.textContent, MCP_FAILED);
  assert.equal(screen.queryByText(MCP_LOADING) === null, true);
});

test("error keep-visible paints Couldn't load MCP. and retained members", () => {
  render(
    <McpServersSection
      projection={{
        state: "error",
        message: MCP_FAILED,
        members: [row({ status: "idle", showLiveConnectedChip: false, identityLabel: "Search", serverId: "s2" })],
      }}
    />,
  );
  const alert = screen.getByRole("alert");
  assert.equal(alert.textContent, MCP_FAILED);
  assert.ok(screen.getByText("Search"));
  assert.ok(screen.getByText(MCP_STATUS_IDLE));
});

test("ready header, count, live Connected chip, identity, and helper", () => {
  render(<McpServersSection projection={ready({ liveGrowing: true, connectedCount: 1, totalCount: 1 })} />);
  const section = screen.getByLabelText(MCP_HEADER);
  assert.ok(within(section).getByRole("heading", { name: MCP_HEADER }));
  assert.ok(within(section).getByText("1"));
  assert.ok(within(section).getByText("1 connected"));
  assert.ok(within(section).getByText("Docs"));
  const chip = within(section).getByText(MCP_STATUS_CONNECTED);
  assert.equal(chip.getAttribute("title"), MCP_TOOLTIP_CONNECTED);
  assert.ok(screen.getByText(MCP_LIVE_GROWING));
  assert.ok(screen.getByText(MCP_HELPER));
});

test("withheld historical connected has identity but no live Connected chip, tooltip, or live count", () => {
  render(
    <McpServersSection
      projection={ready({
        members: [
          row({ showLiveConnectedChip: false }),
          row({
            serverId: "s2",
            identityLabel: "Search",
            status: "idle",
            showLiveConnectedChip: false,
            firstEventSeq: 2,
          }),
        ],
        connectedCount: 0,
        idleCount: 1,
        totalCount: 2,
        offlineCopy: MCP_OFFLINE,
      })}
    />,
  );
  const section = screen.getByLabelText(MCP_HEADER);
  assert.ok(within(section).getByText("Docs"));
  assert.equal(within(section).queryByText(MCP_STATUS_CONNECTED) === null, true);
  assert.equal(within(section).queryByTitle(MCP_TOOLTIP_CONNECTED) === null, true);
  assert.ok(within(section).getByText(MCP_STATUS_IDLE));
  assert.equal(within(section).queryByText("1 connected") === null, true);
  assert.ok(within(section).getByText("1 idle"));
  assert.ok(within(section).getByText("2"));
  assert.ok(within(section).getByText(MCP_OFFLINE));
});

test("parent-terminal reconnect copy is the short string", () => {
  render(
    <McpServersSection
      projection={ready({
        members: [row({ showLiveConnectedChip: false })],
        connectedCount: 0,
        reconnectCopy: MCP_RECONNECT_SHORT,
      })}
    />,
  );
  assert.ok(screen.getByText(MCP_RECONNECT_SHORT));
  assert.equal(screen.queryByText(MCP_OFFLINE) === null, true);
});

test("Idle and Error chips carry meaning in text and tooltip", () => {
  render(
    <McpServersSection
      projection={ready({
        members: [
          row({
            serverId: "s2",
            identityLabel: "Search",
            status: "idle",
            showLiveConnectedChip: false,
          }),
          row({
            serverId: "s3",
            identityLabel: "Auth",
            status: "error",
            showLiveConnectedChip: false,
            firstEventSeq: 3,
          }),
        ],
        connectedCount: 0,
        idleCount: 1,
        errorCount: 1,
        totalCount: 2,
      })}
    />,
  );
  const idle = screen.getByText(MCP_STATUS_IDLE);
  const error = screen.getByText(MCP_STATUS_ERROR);
  assert.equal(idle.getAttribute("title"), MCP_TOOLTIP_IDLE);
  assert.equal(error.getAttribute("title"), MCP_TOOLTIP_ERROR);
  assert.ok(screen.getByText("1 idle"));
  assert.ok(screen.getByText("1 error"));
});

test("unrestorable paints Unavailable beside restored peer, not Error, no invented name", () => {
  render(
    <McpServersSection
      projection={ready({
        members: [
          row({
            serverId: "ok",
            identityLabel: "Search",
            status: "idle",
            showLiveConnectedChip: false,
          }),
          row({
            serverId: "gone",
            identityLabel: MCP_GENERIC_IDENTITY,
            status: null,
            showLiveConnectedChip: false,
            restore: "unrestorable",
            firstEventSeq: 2,
          }),
        ],
        totalCount: 2,
        connectedCount: 0,
        idleCount: 1,
        errorCount: 0,
      })}
    />,
  );
  const section = screen.getByLabelText(MCP_HEADER);
  assert.ok(within(section).getByText("Search"));
  assert.ok(within(section).getByText(MCP_UNAVAILABLE));
  assert.ok(within(section).getByText(MCP_GENERIC_IDENTITY));
  assert.equal(within(section).queryByText("Should not paint") === null, true);
  const errorChips = within(section).queryAllByText(MCP_STATUS_ERROR);
  assert.equal(errorChips.length, 0);
  assert.ok(within(section).getByText("2"));
  assert.equal(within(section).queryByText("1 error") === null, true);
});

test("name-null identity paints generic MCP server with status chip", () => {
  render(
    <McpServersSection
      projection={ready({
        members: [row({ identityLabel: MCP_GENERIC_IDENTITY, status: "idle", showLiveConnectedChip: false })],
        connectedCount: 0,
        idleCount: 1,
      })}
    />,
  );
  assert.ok(screen.getByText(MCP_GENERIC_IDENTITY));
  assert.ok(screen.getByText(MCP_STATUS_IDLE));
});

test("header {N} is membership size including Unavailable, not live connected count", () => {
  render(
    <McpServersSection
      projection={ready({
        members: [
          row({ showLiveConnectedChip: false }),
          row({
            serverId: "gone",
            identityLabel: MCP_GENERIC_IDENTITY,
            status: null,
            showLiveConnectedChip: false,
            restore: "unrestorable",
            firstEventSeq: 2,
          }),
          row({
            serverId: "s3",
            identityLabel: "Auth",
            status: "error",
            showLiveConnectedChip: false,
            firstEventSeq: 3,
          }),
        ],
        totalCount: 3,
        connectedCount: 0,
        idleCount: 0,
        errorCount: 1,
        offlineCopy: MCP_OFFLINE,
      })}
    />,
  );
  const section = screen.getByLabelText(MCP_HEADER);
  assert.ok(within(section).getByText("3"));
  assert.equal(within(section).queryByText("0") === null, true);
  assert.equal(within(section).queryByText("1 connected") === null, true);
});

test("header toggle collapses and expands rows", async () => {
  const user = userEvent.setup();
  render(<McpServersSection projection={ready()} />);
  assert.ok(screen.getByText("Docs"));
  await user.click(screen.getByRole("button", { name: /MCP/i }));
  assert.equal(screen.queryByText("Docs") === null, true);
  await user.click(screen.getByRole("button", { name: /MCP/i }));
  assert.ok(screen.getByText("Docs"));
});

test("long name is in title and accessible name", () => {
  const long = "vendor-mcp-server-with-a-very-long-identity-that-should-truncate";
  render(
    <McpServersSection
      projection={ready({
        members: [row({ identityLabel: long })],
      })}
    />,
  );
  const ident = screen.getByLabelText(long);
  assert.equal(ident.getAttribute("title"), long);
  assert.equal(ident.textContent, long);
});

test("MCP never hosts settle controls", () => {
  render(<McpServersSection projection={ready()} />);
  const section = screen.getByLabelText(MCP_HEADER);
  assert.equal(within(section).queryByRole("button", { name: "Accept" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Reject" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Allow" }) === null, true);
  assert.equal(within(section).queryByRole("button", { name: "Decline" }) === null, true);
});

test("banned Stuck / Status unconfirmed / Disconnected / Healthy copy is not painted", () => {
  render(<McpServersSection projection={ready()} />);
  const text = screen.getByLabelText(MCP_HEADER).textContent ?? "";
  assert.equal(/stuck/i.test(text), false);
  assert.equal(/status unconfirmed/i.test(text), false);
  assert.equal(/\bdisconnected\b/i.test(text), false);
  assert.equal(/\bhealthy\b/i.test(text), false);
});

test("MCP sits after Browser and before Activity", () => {
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
    />,
  );
  const browser = screen.getByLabelText(BROWSER_HEADER);
  const mcp = screen.getByLabelText(MCP_HEADER);
  const activity = screen.getByLabelText("Activity");
  assert.ok(browser.compareDocumentPosition(mcp) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(mcp.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING);
});

test("announces MCP available once membership becomes non-zero, and Error when a row errors", () => {
  const { rerender } = render(<McpServersSection projection={{ state: "absent" }} />);
  rerender(<McpServersSection projection={ready()} />);
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    MCP_AVAILABLE_ANNOUNCE,
  );
  rerender(
    <McpServersSection
      projection={ready({
        members: [row({ status: "error", showLiveConnectedChip: false })],
        connectedCount: 0,
        errorCount: 1,
      })}
    />,
  );
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    MCP_STATUS_ERROR,
  );
});
