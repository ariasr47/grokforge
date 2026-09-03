import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
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

function workspaceWith(sessions: ChatSession[]): WorkspaceNode[] {
  return [
    {
      path: "C:\\repo",
      name: "grokforge",
      branch: "master",
      sessions,
      expanded: true,
      active: true,
    },
  ];
}

// W3-9: SessionStatus is only ever "idle" | "live" | "busy" — there is no
// "done"/finished-successfully value the engine reports. The row used to
// paint an absent status as a "done" dot while its own title, right next to
// it, called the same value "idle" — two fabricated meanings for one
// unknown. Both must now say the one real thing.
describe("Sidebar — session status dot", () => {
  it("an absent status renders the idle dot, and its title agrees", () => {
    const { getByText } = renderSidebar(
      workspaceWith([session({ id: "s1", title: "No status recorded" })]),
    );
    const row = getByText("No status recorded").closest(".row");
    assert.ok(row, "expected a .row for the session");
    const dot = row!.querySelector(".dot");
    assert.ok(dot, "expected a .dot status indicator");
    assert.ok(dot!.classList.contains("idle"), "absent status should paint the idle dot, not done");
    assert.equal(dot!.classList.contains("done"), false);
    assert.equal(dot!.getAttribute("title"), "idle");
  });

  it("an explicit idle status agrees with its own dot class", () => {
    const { getByText } = renderSidebar(
      workspaceWith([session({ id: "s2", title: "Idle session", status: "idle" })]),
    );
    const row = getByText("Idle session").closest(".row");
    const dot = row!.querySelector(".dot");
    assert.ok(dot!.classList.contains("idle"));
    assert.equal(dot!.getAttribute("title"), "idle");
  });

  it("live and busy still paint the live dot with their real status as the title", () => {
    const { getByText } = renderSidebar(
      workspaceWith([
        session({ id: "s3", title: "Busy session", status: "busy" }),
        session({ id: "s4", title: "Live session", status: "live" }),
      ]),
    );
    for (const [title, status] of [
      ["Busy session", "busy"],
      ["Live session", "live"],
    ] as const) {
      const row = getByText(title).closest(".row");
      const dot = row!.querySelector(".dot");
      assert.ok(dot!.classList.contains("live"));
      assert.equal(dot!.getAttribute("title"), status);
    }
  });
});
