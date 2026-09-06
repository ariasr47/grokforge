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

// W3-3: git.ts's getGitBranch returns null on ANY failure (git missing, a 5s
// timeout, a permission error, an empty repo with no HEAD, or genuinely not
// a repo) — the header used to turn that null into the specific assertion
// "no-git", which is true for only one of those causes. Every sibling
// surface (AppTopbar, HomeScreen, CommandPalette) omits instead.
describe("Sidebar — workspace header branch", () => {
  it("a real branch renders", () => {
    const { container } = renderSidebar([workspace({ branch: "master" })]);
    const branchEl = container.querySelector(".wshead .br");
    assert.ok(branchEl, "expected a .br branch element");
    assert.equal(branchEl!.textContent, "master");
  });

  it("a null branch is omitted, never rendered as 'no-git'", () => {
    const { container } = renderSidebar([workspace({ branch: null })]);
    assert.equal(container.querySelector(".wshead .br") === null, true);
    assert.equal(/no-git/.test(container.querySelector(".wshead")!.textContent ?? ""), false);
  });
});

// W3-10: the store caps each workspace at 20 (MAX_PER_WS) stored sessions —
// at the cap, an older one has already silently fallen off, so a bare "20"
// can't be told apart from "20 or more".
describe("Sidebar — workspace header session count", () => {
  it("a count under the cap renders as a bare number", () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      workspace: "C:\\repo",
      title: `Session ${i}`,
      messages: [],
      updatedAt: Date.now(),
      open: true,
    }));
    const { container } = renderSidebar([workspace({ sessions })]);
    assert.equal(container.querySelector(".wshead .count")!.textContent, "5");
  });

  it("a count at the MAX_PER_WS cap renders as N+, not a bare count that undersells it", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      workspace: "C:\\repo",
      title: `Session ${i}`,
      messages: [],
      updatedAt: Date.now(),
      open: true,
    }));
    const { container } = renderSidebar([workspace({ sessions })]);
    assert.equal(container.querySelector(".wshead .count")!.textContent, "20+");
  });
});
