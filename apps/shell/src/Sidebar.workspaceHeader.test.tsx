import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Sidebar, type WorkspaceNode } from "./Sidebar";

afterEach(() => {
  cleanup();
});

function noop(): void {}

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

function workspace(overrides: Partial<WorkspaceNode> = {}): WorkspaceNode {
  return {
    path: "C:\\repo",
    name: "grokforge",
    branch: "master",
    sessions: [],
    expanded: true,
    active: true,
    ...overrides,
  };
}

// F-DEAD-PROPS: onSelectWorkspace was declared on SidebarProps and threaded
// in from App.tsx, but never destructured or read inside Sidebar — clicking
// a workspace header did nothing. These prove the wiring now reaches it,
// without dropping the existing expand/collapse affordance.
describe("Sidebar — workspace header selects the workspace", () => {
  it("clicking the header calls onSelectWorkspace with the workspace's path", () => {
    const selected: string[] = [];
    const { container } = renderSidebar([workspace()], {
      onSelectWorkspace: (path) => selected.push(path),
    });
    const header = container.querySelector(".wshead");
    assert.ok(header, "expected a .wshead workspace header button");
    fireEvent.click(header as HTMLElement);
    assert.deepEqual(selected, ["C:\\repo"]);
  });

  it("still calls onToggleFolder so the expand/collapse affordance keeps working", () => {
    const toggled: string[] = [];
    const { container } = renderSidebar([workspace()], {
      onToggleFolder: (path) => toggled.push(path),
    });
    fireEvent.click(container.querySelector(".wshead") as HTMLElement);
    assert.deepEqual(toggled, ["C:\\repo"]);
  });
});
