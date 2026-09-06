import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Sidebar, homeSwatchColor } from "./Sidebar";
import type { ChatSession } from "../lib/sessions";

afterEach(() => cleanup());

function noop(): void {}

function chatSession(
  overrides: Partial<ChatSession> & Pick<ChatSession, "id" | "title">,
): ChatSession {
  return {
    workspace: "chat:__sandbox__",
    committedName: true,
    messages: [],
    updatedAt: Date.now(),
    status: "idle",
    subagents: [],
    open: true,
    ...overrides,
  };
}

function renderChatSidebar(
  chatSessions: ChatSession[],
  extra: Partial<ComponentProps<typeof Sidebar>> = {},
) {
  return render(
    <Sidebar
      mode="chat"
      chatSessions={chatSessions}
      onNewChat={noop}
      onSelectChat={noop}
      workspaces={[]}
      activeWorkspace={null}
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

describe("Sidebar — Chat homes", () => {
  it("New chat CTA calls onNewChat", () => {
    let called = 0;
    renderChatSidebar([], {
      onNewChat: () => {
        called += 1;
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    assert.equal(called, 1);
  });

  it("lists each session as a Homes row with a swatch, name, and real message count", () => {
    renderChatSidebar([
      chatSession({
        id: "h1",
        title: "Family admin",
        messages: [
          { id: "m1", role: "user", content: "hi" },
          { id: "m2", role: "assistant", content: "hey" },
        ],
      }),
    ]);
    const row = document.querySelector(".home") as HTMLElement | null;
    assert.ok(row);
    assert.ok(within(row!).getByText("Family admin"));
    assert.equal(row!.querySelector(".n")?.textContent, "2");
    assert.ok(row!.querySelector(".hm"));
  });

  it("marks the active session's row .home.on and leaves others untouched", () => {
    renderChatSidebar(
      [
        chatSession({ id: "h1", title: "Family admin" }),
        chatSession({ id: "h2", title: "Japanese study" }),
      ],
      { activeSessionId: "h2" },
    );
    const rows = [...document.querySelectorAll(".home")];
    const active = rows.find((r) => r.textContent?.includes("Japanese study"));
    const inactive = rows.find((r) => r.textContent?.includes("Family admin"));
    assert.equal(active?.classList.contains("on"), true);
    assert.equal(inactive?.classList.contains("on"), false);
  });

  it("clicking a Homes row selects that session", () => {
    let selected: string | null = null;
    renderChatSidebar([chatSession({ id: "h1", title: "Family admin" })], {
      onSelectChat: (id) => {
        selected = id;
      },
    });
    fireEvent.click(screen.getByText("Family admin"));
    assert.equal(selected, "h1");
  });

  it("search filters Homes rows by title", () => {
    renderChatSidebar([
      chatSession({ id: "h1", title: "Family admin" }),
      chatSession({ id: "h2", title: "Japanese study" }),
    ]);
    fireEvent.change(screen.getByLabelText("Search chats"), {
      target: { value: "japanese" },
    });
    assert.equal(screen.queryByText("Family admin") === null, true);
    assert.ok(screen.getByText("Japanese study"));
  });

  it("search box carries the Ctrl+P hint, matching Code's own search box", () => {
    renderChatSidebar([]);
    const search = screen.getByLabelText("Search chats").closest(".search");
    assert.ok(search);
    assert.ok(within(search as HTMLElement).getByText("Ctrl+P"));
  });

  it("shows honest empty copy when there are no chats yet", () => {
    renderChatSidebar([]);
    assert.ok(screen.getByText(/No chats yet/));
  });

  it("Pack: Add calls onBindChatFolder; file rows show real names only, no invented page/size", () => {
    let bound = 0;
    renderChatSidebar([], {
      onBindChatFolder: () => {
        bound += 1;
      },
      chatPackFiles: [{ path: "C:\\docs\\lease-2025.pdf" }, { path: "notes.md" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    assert.equal(bound, 1);
    const rows = [...document.querySelectorAll(".file")];
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.querySelector(".fn")?.textContent, "lease-2025.pdf");
    assert.equal(rows[1]!.querySelector(".fn")?.textContent, "notes.md");
    // ChatPackView.members.files carries only `path` today — no page/size
    // field exists to render, so none must be invented.
    assert.equal(document.querySelector(".file .sz") === null, true);
  });

  it("Add is absent when onBindChatFolder is not provided", () => {
    renderChatSidebar([]);
    assert.equal(screen.queryByRole("button", { name: "Add" }) === null, true);
  });

  it("Pack: Use private folder is hidden while Chat is on the private sandbox (no chatRootLabel)", () => {
    renderChatSidebar([], { onClearChatFolder: noop });
    assert.equal(
      screen.queryByRole("button", { name: "Use private folder" }) === null,
      true,
    );
  });

  it("Pack: Use private folder is hidden when onClearChatFolder is not provided, even with a folder bound", () => {
    renderChatSidebar([], { chatRootLabel: "Documents" });
    assert.equal(
      screen.queryByRole("button", { name: "Use private folder" }) === null,
      true,
    );
  });

  it("Pack: Use private folder appears once a folder is bound and calls the clear path", () => {
    let cleared = 0;
    renderChatSidebar([], {
      chatRootLabel: "Documents",
      onClearChatFolder: () => {
        cleared += 1;
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use private folder" }));
    assert.equal(cleared, 1);
  });

  it("footer shows the avatar, real auth label, and version", () => {
    renderChatSidebar([], { authLabel: "Grok · subscription", version: "0.7.0" });
    const foot = document.querySelector(".railfoot");
    assert.ok(foot);
    assert.ok(within(foot as HTMLElement).getByText("Grok · subscription"));
    assert.ok(within(foot as HTMLElement).getByText("v0.7.0"));
  });

  it("the old Local files panel is gone — folder choice lives in Pack's Add", () => {
    renderChatSidebar([]);
    assert.equal(screen.queryByText(/Private folder by default/) === null, true);
    assert.equal(screen.queryByText("Local files") === null, true);
    assert.equal(screen.queryByText(/Change folder/) === null, true);
  });

  it("double-click renames and hover Delete removes, guarded by confirm", () => {
    let renamed: [string, string] | null = null;
    let deleted: string | null = null;
    const confirmOrig = window.confirm;
    window.confirm = () => true;
    try {
      renderChatSidebar([chatSession({ id: "h1", title: "Family admin" })], {
        onRenameChat: (id, t) => {
          renamed = [id, t];
        },
        onDeleteChat: (id) => {
          deleted = id;
        },
      });
      fireEvent.doubleClick(screen.getByText("Family admin"));
      const input = screen.getByLabelText("Rename session");
      fireEvent.change(input, { target: { value: "Renamed home" } });
      fireEvent.submit(input.closest("form")!);
      assert.deepEqual(renamed, ["h1", "Renamed home"]);

      fireEvent.click(screen.getByTitle("Delete"));
      assert.equal(deleted, "h1");
    } finally {
      window.confirm = confirmOrig;
    }
  });
});

describe("homeSwatchColor", () => {
  it("the same id always returns the same colour", () => {
    assert.equal(homeSwatchColor("abc-123"), homeSwatchColor("abc-123"));
    assert.equal(homeSwatchColor("a-very-different-id"), homeSwatchColor("a-very-different-id"));
  });

  it("only returns the three allowed swatch colours — amber never appears", () => {
    const allowed = new Set(["#a78bfa", "#5ce1ff", "#8b93a7"]);
    const ids = ["a", "family-admin", "japanese-study", "work-notes", "", "z".repeat(40), "1", "2", "3"];
    for (const id of ids) {
      const c = homeSwatchColor(id);
      assert.equal(allowed.has(c), true, `unexpected colour ${c} for id "${id}"`);
      assert.notEqual(c, "#f0b45a");
    }
  });
});
