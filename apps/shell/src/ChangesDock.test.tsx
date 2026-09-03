import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ChangesDock,
  type ChangesDockFilesState,
  type ChangesDockGitState,
  type ChangesDockMember,
  type ChangesDockVerifyState,
} from "./ChangesDock";
import type { PendingDiff } from "./DiffPanel";
import type { RunGitReviewMember } from "./runGitReviewList";
import type { RunVerifyMember } from "./runVerifyList";

afterEach(() => cleanup());

const EMPTY_FILES: ChangesDockFilesState = { state: "ready", members: [] };
const EMPTY_VERIFY: ChangesDockVerifyState = { state: "ready", members: [] };
const EMPTY_GIT: ChangesDockGitState = { state: "ready", members: [] };

function member(overrides: Partial<ChangesDockMember> = {}): ChangesDockMember {
  return {
    editId: "e-1",
    path: "src/OverviewStrip.tsx",
    kind: "content",
    fromPath: null,
    toPath: null,
    activityId: "a-1",
    invocationId: "i-1",
    requestId: null,
    diff: "--- a/src/OverviewStrip.tsx\n+++ b/src/OverviewStrip.tsx\n@@ -12,4 +12,5 @@ buildSummary\n  const s = buildSummary({\n-   turns: 3,\n+   turnCount: 3,\n+   // renamed in sessions v2\n  branch: \"master\",\n  });\n",
    settlement: "applied",
    recoveryAvailable: false,
    diffUnavailable: false,
    runId: "run-1",
    ...overrides,
  };
}

function verifyMember(overrides: Partial<RunVerifyMember> = {}): RunVerifyMember {
  return {
    activityId: "va-1",
    invocationId: "vi-1",
    command: "npm test -- OverviewStrip",
    execution: "executed",
    outcome: "pass",
    outcomeUnavailable: false,
    ...overrides,
  };
}

function gitMember(overrides: Partial<RunGitReviewMember> = {}): RunGitReviewMember {
  return {
    activityId: "ga-1",
    invocationId: "gi-1",
    command: "git status",
    kind: "status",
    execution: "executed",
    evidenceUnavailable: false,
    ...overrides,
  };
}

function noop() {
  /* no-op */
}

function baseProps() {
  return {
    files: EMPTY_FILES,
    verify: EMPTY_VERIFY,
    git: EMPTY_GIT,
    diffQueue: [] as PendingDiff[],
    onAccept: noop,
    onReject: noop,
    onCollapse: noop,
    onOpenReview: noop,
  };
}

describe("ChangesDock — header and visibility", () => {
  it("renders nothing when files, verify, and git are all empty", () => {
    const { container } = render(<ChangesDock {...baseProps()} />);
    assert.equal(container.firstChild, null);
  });

  it("shows Changes header with file count and ± totals summed across members", () => {
    const { container } = render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [
            member({ editId: "e-1", diff: "--- a\n+++ b\n@@ -1,1 +1,2 @@\n+one\n+two\n" }),
            member({ editId: "e-2", path: "src/other.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,0 @@\n-gone\n" }),
          ],
        }}
      />,
    );
    const sum = container.querySelector(".chead .sum");
    assert.match(sum?.textContent ?? "", /2 files/);
    assert.match(sum?.textContent ?? "", /\+2/);
    assert.match(sum?.textContent ?? "", /−1/);
  });

  it("collapse button calls onCollapse", () => {
    const clicks: number[] = [];
    render(
      <ChangesDock
        {...baseProps()}
        files={{ state: "ready", members: [member()] }}
        onCollapse={() => clicks.push(1)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    assert.deepEqual(clicks, [1]);
  });
});

describe("ChangesDock — Files tab rows", () => {
  it("splits the path into a muted dir and mono filename, and shows ± per file", () => {
    render(<ChangesDock {...baseProps()} files={{ state: "ready", members: [member()] }} />);
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText("OverviewStrip.tsx"));
    assert.ok(within(dock).getByText("src/"));
  });

  it("shows Deleted / Renamed kind badges only for those kinds, and the rename arrow once accepted", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [
            member({ editId: "e-del", path: "gone.txt", kind: "delete", diff: null, diffUnavailable: true }),
            member({
              editId: "e-ren",
              path: "to.txt",
              kind: "rename",
              fromPath: "from.txt",
              toPath: "to.txt",
              settlement: "accepted",
              diff: null,
              diffUnavailable: true,
            }),
          ],
        }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText("Deleted"));
    assert.ok(within(dock).getByText("Renamed"));
    assert.ok(within(dock).getByText("gone.txt"));
    assert.ok(within(dock).getByText("from.txt → to.txt"));
  });

  it("pending + diff-queue-backed row shows Accept/Reject minis that call onAccept/onReject with the request id", () => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [member({ settlement: "pending", requestId: "req-1" })],
        }}
        diffQueue={[{ id: "req-1", path: "src/OverviewStrip.tsx", diff: "+x" }]}
        onAccept={(id) => accepted.push(id)}
        onReject={(id) => rejected.push(id)}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    fireEvent.click(within(dock).getByRole("button", { name: "Accept" }));
    fireEvent.click(within(dock).getByRole("button", { name: "Reject" }));
    assert.deepEqual(accepted, ["req-1"]);
    assert.deepEqual(rejected, ["req-1"]);
  });

  it("pending row NOT backed by the diff queue (permission-gated) shows Pending text and no fabricated buttons", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [member({ settlement: "pending", requestId: "perm-1" })],
        }}
        diffQueue={[]}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText("Pending"));
    assert.equal(within(dock).queryByRole("button", { name: "Accept" }) === null, true);
    assert.equal(within(dock).queryByRole("button", { name: "Reject" }) === null, true);
  });

  it("accepted settlement shows an Accepted check, not action buttons", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{ state: "ready", members: [member({ settlement: "accepted", requestId: "req-1" })] }}
        diffQueue={[{ id: "req-1", path: "src/OverviewStrip.tsx", diff: "+x" }]}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText("Accepted"));
    assert.equal(within(dock).queryByRole("button", { name: "Accept" }) === null, true);
  });

  it("rejected settlement shows a Rejected label, not action buttons", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{ state: "ready", members: [member({ settlement: "rejected", requestId: "req-1" })] }}
        diffQueue={[{ id: "req-1", path: "src/OverviewStrip.tsx", diff: "+x" }]}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText("Rejected"));
    assert.equal(within(dock).queryByRole("button", { name: "Accept" }) === null, true);
    assert.equal(within(dock).queryByRole("button", { name: "Reject" }) === null, true);
  });
});

describe("ChangesDock — hunk preview", () => {
  it("View diff opens the first hunk header, context, and colored lines (closed until clicked, DiffPanel-style)", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [member()],
        }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.equal(within(dock).queryByText("@@ -12,4 +12,5 @@") === null, true);
    fireEvent.click(within(dock).getByRole("button", { name: "View diff" }));
    assert.ok(within(dock).getByText("@@ -12,4 +12,5 @@"));
    assert.ok(within(dock).getByText("buildSummary"));
    assert.ok(within(dock).getByText("turnCount: 3,", { exact: false }));
  });

  it("clicking View diff on a row opens its preview; clicking a different row switches it; clicking the open one again hides it", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [
            member({ editId: "e-1", path: "a.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a-old\n+a-new\n" }),
            member({ editId: "e-2", path: "b.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-b-old\n+b-new\n" }),
          ],
        }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    const toggles = () => within(dock).getAllByRole("button", { name: /View diff|Hide diff/ });
    assert.equal(within(dock).queryByText("a-new", { exact: false }) === null, true);
    fireEvent.click(toggles()[0]!);
    assert.ok(within(dock).getByText("a-new", { exact: false }));
    fireEvent.click(toggles()[1]!);
    assert.ok(within(dock).getByText("b-new", { exact: false }));
    assert.equal(within(dock).queryByText("a-new", { exact: false }) === null, true);
    fireEvent.click(within(dock).getByRole("button", { name: "Hide diff" }));
    assert.equal(within(dock).queryByText("b-new", { exact: false }) === null, true);
  });

  it("stale-hunk handling: when the open file disappears from members, the preview closes instead of showing stale content", () => {
    const twoMembers = {
      state: "ready" as const,
      members: [
        member({ editId: "e-1", path: "a.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a-old\n+a-new\n" }),
        member({ editId: "e-2", path: "b.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-b-old\n+b-new\n" }),
      ],
    };
    const { rerender } = render(<ChangesDock {...baseProps()} files={twoMembers} />);
    const dock = () => screen.getByRole("region", { name: "Changes" });
    fireEvent.click(within(dock()).getAllByRole("button", { name: "View diff" })[0]!);
    assert.ok(within(dock()).getByText("a-new", { exact: false }));
    rerender(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [member({ editId: "e-2", path: "b.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-b-old\n+b-new\n" })],
        }}
      />,
    );
    assert.equal(within(dock()).queryByText("a-new", { exact: false }) === null, true);
    assert.equal(within(dock()).queryByText("b-new", { exact: false }) === null, true);
    assert.ok(within(dock()).getByRole("button", { name: "View diff" }));
  });

  it("no diff preview renders when the list is empty", () => {
    render(<ChangesDock {...baseProps()} verify={{ state: "ready", members: [verifyMember()] }} />);
    assert.equal(screen.queryByText(/^@@/) === null, true);
  });
});

describe("ChangesDock — revert / applied note", () => {
  it("shows the applied-automatically note for a trusted applied member", () => {
    render(<ChangesDock {...baseProps()} files={{ state: "ready", members: [member({ settlement: "applied" })] }} />);
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText(/Applied automatically/));
  });

  it("Restore file for a deleted member calls onRevert with that member", () => {
    const reverted: ChangesDockMember[] = [];
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [
            member({ editId: "e-del", path: "gone.txt", kind: "delete", diff: null, diffUnavailable: true, recoveryAvailable: true }),
          ],
        }}
        onRevert={(m) => reverted.push(m)}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    fireEvent.click(within(dock).getByRole("button", { name: "Restore file" }));
    assert.equal(reverted.length, 1);
    assert.equal(reverted[0]!.editId, "e-del");
  });

  it("Revert rename label is used for rename members", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [
            member({
              editId: "e-ren",
              kind: "rename",
              fromPath: "from.txt",
              toPath: "to.txt",
              path: "to.txt",
              diff: null,
              diffUnavailable: true,
              recoveryAvailable: true,
            }),
          ],
        }}
        onRevert={noop}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByRole("button", { name: "Revert rename" }));
  });

  it("recovery unavailable (e.g. status failed) offers no restore/revert button", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{ state: "ready", members: [member({ settlement: "applied", recoveryAvailable: false })] }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.equal(within(dock).queryByRole("button", { name: "Restore file" }) === null, true);
    assert.equal(within(dock).queryByRole("button", { name: "Revert edit" }) === null, true);
  });

  it("a content-kind member offers Revert edit, not Restore file or Revert rename", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [member({ kind: "content", settlement: "applied", recoveryAvailable: true })],
        }}
        onRevert={noop}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByRole("button", { name: "Revert edit" }));
    assert.equal(within(dock).queryByRole("button", { name: "Restore file" }) === null, true);
    assert.equal(within(dock).queryByRole("button", { name: "Revert rename" }) === null, true);
  });

  it("settlement conflict shows the kind's conflict copy as an alert and hides the revert control", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [member({ kind: "content", settlement: "conflict", recoveryAvailable: true })],
        }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    const alert = within(dock).getByRole("alert");
    assert.ok(within(alert).getByText("Edit not reverted"));
    assert.match(alert.textContent ?? "", /changed after Forge applied this edit/);
    assert.equal(within(dock).queryByRole("button", { name: "Revert edit" }) === null, true);
  });

  it("recoveryFlash reverted overrides settlement to show the kind's success copy, keyed by editId", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [
            member({ editId: "e-flash", kind: "content", settlement: "applied", recoveryAvailable: true }),
          ],
        }}
        recoveryFlash={{ "e-flash": "reverted" }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    const status = within(dock).getByRole("status");
    assert.ok(within(status).getByText("Edit reverted"));
    assert.match(status.textContent ?? "", /restored to its state immediately before this edit/);
    assert.equal(within(dock).queryByRole("button", { name: "Revert edit" }) === null, true);
    assert.equal(within(dock).queryByText(/Applied automatically/) === null, true);
  });

  it("recoveryFlash falls back to the activityId key when the editId is not flashed", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{
          state: "ready",
          members: [
            member({
              editId: "e-2",
              activityId: "act-2",
              kind: "delete",
              settlement: "applied",
              recoveryAvailable: true,
              diff: null,
              diffUnavailable: true,
            }),
          ],
        }}
        recoveryFlash={{ "act-2": "conflict" }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByRole("alert"));
    assert.ok(within(dock).getByText("File not restored"));
  });
});

describe("ChangesDock — tabs", () => {
  it("Files tab is active by default and shows the file count badge", () => {
    render(<ChangesDock {...baseProps()} files={{ state: "ready", members: [member()] }} />);
    const filesTab = screen.getByRole("tab", { name: /Files/ });
    assert.equal(filesTab.getAttribute("aria-selected"), "true");
    assert.ok(within(filesTab).getByText("1"));
  });

  it("switching to the Verify tab hides file rows and shows verify rows", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{ state: "ready", members: [member()] }}
        verify={{ state: "ready", members: [verifyMember()] }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    fireEvent.click(within(dock).getByRole("tab", { name: /Verify/ }));
    assert.ok(within(dock).getByText("npm test -- OverviewStrip"));
    assert.equal(within(dock).queryByText("OverviewStrip.tsx") === null, true);
  });

  it("switching to the Git tab shows git evidence rows", () => {
    render(
      <ChangesDock
        {...baseProps()}
        files={{ state: "ready", members: [member()] }}
        git={{ state: "ready", members: [gitMember()] }}
      />,
    );
    const dock = screen.getByRole("region", { name: "Changes" });
    fireEvent.click(within(dock).getByRole("tab", { name: /Git/ }));
    assert.ok(within(dock).getByText("git status"));
  });
});

describe("ChangesDock — Verify rows", () => {
  it("maps outcomes to Passed/Failed/Running/Unknown/Not run labels", () => {
    render(
      <ChangesDock
        {...baseProps()}
        verify={{
          state: "ready",
          members: [
            verifyMember({ activityId: "v1", command: "npm test", outcome: "pass" }),
            verifyMember({ activityId: "v2", command: "npm run typecheck", outcome: "fail" }),
            verifyMember({ activityId: "v3", command: "npm run build", execution: "pending", outcome: "running" }),
            verifyMember({ activityId: "v4", command: "npm run lint", outcome: "unknown", outcomeUnavailable: true }),
            verifyMember({ activityId: "v5", command: "npm run extra", execution: "not_executed", outcome: null }),
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Verify/ }));
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText("Passed"));
    assert.ok(within(dock).getByText("Failed"));
    assert.ok(within(dock).getByText("Running"));
    assert.ok(within(dock).getByText("Unknown"));
    assert.ok(within(dock).getByText("Not run"));
  });

  it("shows a loading state distinct from an error state", () => {
    const { rerender } = render(<ChangesDock {...baseProps()} verify={{ state: "loading" }} files={{ state: "ready", members: [member()] }} />);
    fireEvent.click(screen.getByRole("tab", { name: /Verify/ }));
    let dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText(/Loading/));
    rerender(
      <ChangesDock
        {...baseProps()}
        verify={{ state: "error", message: "Couldn’t load this run’s verify results." }}
        files={{ state: "ready", members: [member()] }}
      />,
    );
    dock = screen.getByRole("region", { name: "Changes" });
    fireEvent.click(within(dock).getByRole("tab", { name: /Verify/ }));
    assert.ok(within(dock).getByRole("alert"));
  });
});

describe("ChangesDock — Git row", () => {
  it("shows Not run / Running / Failed chrome from activity status and lifecycle", () => {
    render(
      <ChangesDock
        {...baseProps()}
        git={{
          state: "ready",
          members: [
            gitMember({ activityId: "g1", command: "git diff", kind: "diff" }),
            gitMember({ activityId: "g2", command: "git log", kind: "log", execution: "not_executed" }),
          ],
        }}
        activityStatusById={new Map([["g1", "failed"]])}
        activityLifecycleById={new Map([["g1", "terminal"]])}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Git/ }));
    const dock = screen.getByRole("region", { name: "Changes" });
    assert.ok(within(dock).getByText("Failed"));
    assert.ok(within(dock).getByText("Not run"));
  });
});

describe("ChangesDock — footer", () => {
  it("Review & commit button calls onOpenReview", () => {
    const clicks: number[] = [];
    render(
      <ChangesDock
        {...baseProps()}
        files={{ state: "ready", members: [member()] }}
        onOpenReview={() => clicks.push(1)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Review & commit/ }));
    assert.deepEqual(clicks, [1]);
  });
});
