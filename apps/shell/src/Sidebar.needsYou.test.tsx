import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Sidebar, type WorkspaceNode } from "./Sidebar";
import type { ChatSession } from "./sessions";

afterEach(() => {
  cleanup();
});

function noop(): void {}

function session(overrides: Partial<ChatSession> & Pick<ChatSession, "id" | "title">): ChatSession {
  return {
    workspace: "C:\\repo",
    messages: [],
    updatedAt: Date.now(),
    open: true,
    ...overrides,
  };
}

function renderSidebar(
  workspaces: WorkspaceNode[],
  extra: Partial<ComponentProps<typeof Sidebar>> = {},
) {
  return render(
    <Sidebar
      mode="code"
      chatSessions={[]}
      onNewChat={noop}
      onSelectChat={noop}
      workspaces={workspaces}
      activeWorkspace="C:\\repo"
      activeSessionId={null}
      onOpenFolder={noop}
      onToggleFolder={noop}
      onSelectWorkspace={noop}
      onSelectCodeSession={noop}
      onNewCodeSession={noop}
      {...extra}
    />,
  );
}

describe("Sidebar — Needs you group", () => {
  it("renders a Needs you group with an amber count when a session needs you", () => {
    const needsSession = session({
      id: "needs-1",
      title: "Fix typecheck in apps/shell",
      needsYou: true,
      updatedAt: Date.now(),
    });
    const plainSession = session({
      id: "plain-1",
      title: "Installer SHA-256 in Settings",
      updatedAt: Date.now() - 60_000,
    });
    const workspaces: WorkspaceNode[] = [
      {
        path: "C:\\repo",
        name: "grokforge",
        branch: "master",
        sessions: [needsSession, plainSession],
        expanded: true,
        active: true,
      },
    ];

    renderSidebar(workspaces, { needsYouReasons: { "needs-1": "approve" } });

    const label = screen.getByText("Needs you");
    const group = label.closest(".group");
    assert.ok(group, "expected a .group ancestor for the Needs you label");
    assert.equal(group!.querySelector(".count.amber")?.textContent, "1");

    // The needs-you row renders inside the group, with the approve/question
    // word instead of a time-ago, and is not duplicated in its workspace.
    assert.ok(within(group as HTMLElement).getByText("Fix typecheck in apps/shell"));
    assert.ok(within(group as HTMLElement).getByText("approve"));
    assert.equal(group!.querySelectorAll(".row").length, 1);

    // Nested under the workspace header, a session row is indented (.sub);
    // the Needs-you row stays at the base indent.
    const plainRow = screen
      .getByText("Installer SHA-256 in Settings")
      .closest(".row");
    assert.ok(plainRow?.classList.contains("sub"));
    const needsRow = within(group as HTMLElement)
      .getByText("Fix typecheck in apps/shell")
      .closest(".row");
    assert.equal(needsRow?.classList.contains("sub"), false);
  });

  it("omits the Needs you group entirely when no session needs you", () => {
    const workspaces: WorkspaceNode[] = [
      {
        path: "C:\\repo",
        name: "grokforge",
        branch: "master",
        sessions: [session({ id: "plain-1", title: "Installer SHA-256 in Settings" })],
        expanded: true,
        active: true,
      },
    ];

    renderSidebar(workspaces);

    assert.equal(screen.queryByText("Needs you") === null, true);
  });

  it("shows the question word for recovery_confirmation/plan-kind decisions", () => {
    const needsSession = session({
      id: "needs-2",
      title: "Sidebar tree · sessions v2",
      needsYou: true,
    });
    const workspaces: WorkspaceNode[] = [
      {
        path: "C:\\repo",
        name: "grokforge",
        branch: "master",
        sessions: [needsSession],
        expanded: true,
        active: true,
      },
    ];

    renderSidebar(workspaces, { needsYouReasons: { "needs-2": "question" } });

    assert.ok(screen.getByText("question"));
  });
});
