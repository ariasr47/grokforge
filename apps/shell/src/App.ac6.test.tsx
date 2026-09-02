// AC6 — Code: workspace + tools + permission + staged diff still work. The
// regression-protection centerpiece named by the conductor: this path is
// what the Code dogfood depends on and had zero automated coverage before
// this bounce. Mocks the network boundary only (fetch + WebSocket); real
// App, real session store, real permission/diff wiring.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";

function resetBrowserState(): void {
  localStorage.clear();
  localStorage.setItem(
    "grokforge.firstRun",
    JSON.stringify({
      dismissed: true,
      openedFolder: true,
      signedIn: true,
      sentMessage: true,
      pickedMode: true,
      seenAt: new Date().toISOString(),
    }),
  );
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;

before(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

beforeEach(() => {
  resetBrowserState();
});

afterEach(() => {
  cleanup();
});

describe("AC6 — Code: workspace + tools + permission + staged diff", () => {
  it("runs a tool, decides a permission, and accepts a staged diff end to end", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: "C:\\repo",
      workspaceName: "repo",
      busy: false,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(<App />);
    const user = userEvent.setup();

    // Workspace chrome present (SPEC AC6's "workspace" clause).
    await waitFor(() => {
      assert.ok(document.querySelector('.ws[title="C:\\\\repo"]'));
      assert.ok(screen.getAllByText(/repo/).length > 0);
    });

    await user.keyboard("{Control>}n{/Control}");
    const composer = screen.getByLabelText("Message to agent");
    await user.type(composer, "add a README section");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));

    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;

    // 1) Tool call — a read that succeeds.
    ws.emit({ type: "tool_request", id: "tool-1", name: "read_file", input: { path: "README.md" } });
    ws.emit({ type: "tool_result", id: "tool-1", ok: true, output: { content: "# repo" } });

    // 2) Permission — a write needs the user's decision before it can stage.
    ws.emit({
      type: "permission_request",
      id: "perm-1",
      kind: "write",
      detail: "Write README.md",
    });

    await waitFor(() => {
      assert.ok(screen.getByRole("region", { name: "Grok wants to write a file" }));
    });
    await user.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      const permCalls = host.callsTo("/api/permission");
      assert.ok(permCalls.length >= 1);
      assert.equal(permCalls[permCalls.length - 1]!.body?.decision, "allow_once");
    });
    // Dock clears the decided permission.
    assert.equal(screen.queryByRole("region", { name: "Grok wants to write a file" }), null);

    // 3) Staged diff — proposed after the permission is granted.
    const diff = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1,2 @@",
      " # repo",
      "+New section",
      "",
    ].join("\n");
    ws.emit({ type: "file_edit", id: "diff-1", path: "README.md", diff, status: "proposed" });

    await waitFor(() => {
      const diffRegion = screen.getByRole("region", { name: /Pending file edits/ });
      assert.ok(within(diffRegion).getAllByText(/README\.md/).length > 0);
    });

    // Diff staged, not yet applied — file_edit "proposed" only, no "accepted" yet.
    assert.equal(host.callsTo("/api/diff").length, 0);

    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      const diffCalls = host.callsTo("/api/diff");
      assert.ok(diffCalls.length >= 1);
      assert.equal(diffCalls[diffCalls.length - 1]!.body?.action, "accept");
    });
    await waitFor(() => {
      assert.equal(screen.queryByRole("region", { name: /Pending file edits/ }), null);
    });

    ws.emit({ type: "text_delta", text: "Added the README section." });
    ws.emit({ type: "done", reason: "stop" });

    await waitFor(() => assert.ok(screen.getByText(/Added the README section\./)));
  });
});
