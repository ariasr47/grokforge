import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  FILE_CHANGES_APPLIED_HELPER,
  FILE_CHANGES_DIFF_UNAVAILABLE,
  FILE_CHANGES_HEADER,
  FILE_CHANGES_LIVE_GROWING,
  FILE_CHANGES_LOAD_FAILURE,
  FILE_CHANGES_LOADING,
  FILE_CHANGES_OFFLINE,
  FILE_CHANGES_PENDING_HELPER,
  FILE_CHANGES_REVERT_CONFLICT_BODY,
  FILE_CHANGES_REVERT_CONFLICT_TITLE,
  FILE_CHANGES_REVERT_GUARD,
  FILE_CHANGES_REVERT_SUCCESS_BODY,
  FILE_CHANGES_REVERT_SUCCESS_TITLE,
  FileChangesSection,
} from "./FileChangesSection";
import type { RunChangeMember } from "./runChangeList";

afterEach(() => cleanup());

function member(overrides: Partial<RunChangeMember> = {}): RunChangeMember {
  return {
    editId: "e1",
    path: "src/a.ts",
    activityId: "a1",
    invocationId: "i1",
    requestId: null,
    diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+hello",
    settlement: "applied",
    recoveryAvailable: true,
    diffUnavailable: false,
    ...overrides,
  };
}

test("loading shows Loading file changes… and never a zero inventory", () => {
  render(<FileChangesSection projection={{ state: "loading" }} />);
  assert.ok(screen.getByText(FILE_CHANGES_LOADING));
  assert.equal(screen.queryByText(FILE_CHANGES_HEADER), null);
  assert.equal(screen.queryByText("0"), null);
});

test("error shows membership load-failure copy, not empty/absent", () => {
  render(<FileChangesSection projection={{ state: "error", message: FILE_CHANGES_LOAD_FAILURE }} />);
  assert.ok(screen.getByRole("alert"));
  assert.equal(screen.getByRole("alert").textContent, FILE_CHANGES_LOAD_FAILURE);
  assert.equal(screen.queryByText(FILE_CHANGES_LOADING), null);
});

test("absent renders no File changes section", () => {
  const { container } = render(<FileChangesSection projection={{ state: "absent" }} />);
  assert.equal(container.textContent, "");
  assert.equal(screen.queryByRole("region", { name: FILE_CHANGES_HEADER }), null);
  assert.equal(screen.queryByText(FILE_CHANGES_HEADER), null);
});

test("ready Trusted list names paths, Applied chips, count, and no list Accept/Reject", () => {
  render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [
          member({ editId: "e1", path: "a.txt", activityId: "a1" }),
          member({ editId: "e2", path: "b.txt", activityId: "a2", invocationId: "i2" }),
          member({ editId: "e3", path: "c.txt", activityId: "a3", invocationId: "i3" }),
        ],
      }}
    />,
  );
  assert.ok(screen.getByRole("heading", { name: FILE_CHANGES_HEADER }));
  assert.ok(screen.getByLabelText("3 file changes"));
  assert.ok(screen.getByText("3 applied"));
  assert.ok(screen.getByText("a.txt"));
  assert.ok(screen.getByText("b.txt"));
  assert.ok(screen.getByText("c.txt"));
  assert.equal(screen.getAllByText("Applied").length, 3);
  assert.equal(screen.queryByText("Pending"), null);
  assert.equal(screen.queryByRole("button", { name: "Accept" }), null);
  assert.equal(screen.queryByRole("button", { name: "Reject" }), null);
  assert.ok(screen.getAllByText(FILE_CHANGES_APPLIED_HELPER).length >= 1);
});

test("pending rows use dock helper and never a list-only Accept control", () => {
  render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [
          member({
            editId: "e1",
            path: "r1.txt",
            settlement: "pending",
            requestId: "req-1",
            recoveryAvailable: false,
          }),
          member({
            editId: "e2",
            path: "r2.txt",
            activityId: "a2",
            invocationId: "i2",
            settlement: "pending",
            requestId: "req-2",
            recoveryAvailable: false,
          }),
        ],
      }}
    />,
  );
  assert.equal(screen.getAllByText("Pending").length, 2);
  assert.ok(screen.getByText("2 pending"));
  assert.equal(screen.getAllByText(FILE_CHANGES_PENDING_HELPER).length, 2);
  assert.equal(screen.queryByRole("button", { name: "Accept" }), null);
  assert.equal(screen.queryByRole("button", { name: "Reject" }), null);
});

test("View diff shows the stored member.diff and Hide diff collapses it", () => {
  const body = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+hello";
  const { rerender } = render(
    <FileChangesSection
      projection={{ state: "ready", members: [member({ diff: body })] }}
      openEditId={null}
    />,
  );
  assert.equal(screen.queryByLabelText("Stored diff"), null);
  fireEvent.click(screen.getByRole("button", { name: "View diff" }));
  rerender(
    <FileChangesSection
      projection={{ state: "ready", members: [member({ diff: body })] }}
      openEditId="e1"
    />,
  );
  assert.ok(screen.getByLabelText("Stored diff").textContent?.includes("+hello"));
  fireEvent.click(screen.getByRole("button", { name: "Hide diff" }));
});

test("mixed list keeps the missing body listed as Diff unavailable", () => {
  render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [
          member({ editId: "e1", path: "kept.ts" }),
          member({
            editId: "e2",
            path: "missing.ts",
            activityId: "a2",
            diff: null,
            diffUnavailable: true,
            recoveryAvailable: false,
          }),
        ],
      }}
    />,
  );
  assert.ok(screen.getByText("kept.ts"));
  assert.ok(screen.getByText("missing.ts"));
  assert.ok(screen.getByText(FILE_CHANGES_DIFF_UNAVAILABLE));
  assert.ok(screen.getByRole("button", { name: "View diff" }));
});

test("reverted chip and no Revert edit even when flash is absent", () => {
  render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [member({ settlement: "reverted", recoveryAvailable: false })],
      }}
    />,
  );
  assert.ok(screen.getByText("Reverted"));
  assert.equal(screen.queryByRole("button", { name: "Revert edit" }), null);
  assert.ok(screen.getByText(FILE_CHANGES_REVERT_SUCCESS_TITLE));
  assert.ok(screen.getByText(FILE_CHANGES_REVERT_SUCCESS_BODY));
});

test("recovery conflict uses Edit not reverted chrome, keeps View diff, hides Revert", () => {
  render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [member({ settlement: "conflict", recoveryAvailable: false })],
      }}
    />,
  );
  assert.ok(screen.getByText(FILE_CHANGES_REVERT_CONFLICT_TITLE));
  assert.ok(screen.getByText(FILE_CHANGES_REVERT_CONFLICT_BODY));
  assert.equal(screen.queryByText("Applied"), null);
  assert.equal(screen.queryByRole("button", { name: "Revert edit" }), null);
  assert.ok(screen.getByRole("button", { name: "View diff" }));
});

test("Revert edit is offered only when recoveryAvailable and shows the shipped guard", () => {
  let reverted: string | null = null;
  render(
    <FileChangesSection
      projection={{ state: "ready", members: [member({ recoveryAvailable: true })] }}
      onRevert={(m) => {
        reverted = m.editId;
      }}
    />,
  );
  assert.ok(screen.getByText(FILE_CHANGES_REVERT_GUARD));
  fireEvent.click(screen.getByRole("button", { name: "Revert edit" }));
  assert.equal(reverted, "e1");
});

test("offline copy is exact and does not wipe the list", () => {
  render(
    <FileChangesSection
      projection={{ state: "ready", members: [member()] }}
      offline
    />,
  );
  assert.ok(screen.getByText(FILE_CHANGES_OFFLINE));
  assert.ok(screen.getByText("src/a.ts"));
});

test("live growing copy only while non-terminal", () => {
  const { rerender } = render(
    <FileChangesSection
      projection={{ state: "ready", members: [member()] }}
      runNonTerminal
    />,
  );
  assert.ok(screen.getByText(FILE_CHANGES_LIVE_GROWING));
  rerender(
    <FileChangesSection
      projection={{ state: "ready", members: [member()] }}
      runNonTerminal={false}
    />,
  );
  assert.equal(screen.queryByText(FILE_CHANGES_LIVE_GROWING), null);
  assert.equal(screen.queryByText("Change set complete"), null);
});

test("accepted and rejected chips use vouched labels and keep View diff", () => {
  render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [
          member({ editId: "acc", path: "ok.ts", settlement: "accepted", recoveryAvailable: false }),
          member({
            editId: "rej",
            path: "no.ts",
            activityId: "a2",
            settlement: "rejected",
            recoveryAvailable: false,
          }),
        ],
      }}
    />,
  );
  assert.ok(screen.getByText("Accepted"));
  assert.ok(screen.getByText("Rejected"));
  assert.equal(screen.getAllByRole("button", { name: "View diff" }).length, 2);
});

test("banned framing is absent from the ready section", () => {
  const { container } = render(
    <FileChangesSection
      projection={{
        state: "ready",
        members: [member(), member({ editId: "e2", path: "p.ts", settlement: "pending", requestId: "r", recoveryAvailable: false })],
      }}
    />,
  );
  const text = container.textContent ?? "";
  for (const banned of ["commit", "pull request", "workspace dirty", "undo run", "undo stack", "sandbox"]) {
    assert.equal(text.toLowerCase().includes(banned), false, banned);
  }
});
