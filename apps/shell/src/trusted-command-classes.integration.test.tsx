import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";

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

afterEach(() => {
  cleanup();
});

async function openSettingsApp(opts?: {
  workspace?: string | null;
  policy?: "review" | "trusted_workspace";
  fallbackReason?: "missing" | "invalid" | "unreadable";
  classes?: Array<"npm" | "cargo">;
  classSaveError?: { status: number; code: string };
}) {
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
  const workspace = opts?.workspace === undefined ? "C:\\repo" : opts.workspace;
  const policyMode = opts?.policy ?? "review";
  const host = createFakeHost({
    mode: "chat",
    workspace,
    workspaceName: workspace ? "repo" : null,
    permissionPolicy: {
      status: "confirmed",
      workspace: workspace ?? "",
      storedMode: policyMode,
      effectiveMode: policyMode,
      source: workspace ? "saved" : "default",
      revision: "pol-1",
      fallbackReason: null,
      savedForWorkspace: Boolean(workspace),
    },
  }, {
    trustedClasses: workspace
      ? {
          status: "confirmed",
          workspace,
          classes: opts?.classes ?? [],
          revision: opts?.classes?.length ? "r1" : "fallback",
          source: opts?.classes?.length ? "saved" : "fallback",
          fallbackReason: opts?.fallbackReason ?? (opts?.classes?.length ? null : "missing"),
          savedForWorkspace: Boolean(opts?.classes?.length),
          catalog: [
            { id: "npm", label: "npm" },
            { id: "npx", label: "npx" },
            { id: "cargo", label: "cargo" },
            { id: "git:status", label: "git status" },
            { id: "git:diff", label: "git diff" },
            { id: "git:log", label: "git log" },
            { id: "git:show", label: "git show" },
          ],
        }
      : undefined,
    classSaveError: opts?.classSaveError,
  });
  globalThis.fetch = host.fetchImpl;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByText(/Grok · (live|reconnecting)/);
  const settings = screen
    .getAllByRole("button", { name: "Settings" })
    .find((button) => button.className.includes("ghost"));
  assert.ok(settings);
  await userEvent.setup().click(settings);
  await screen.findByRole("heading", { name: "Settings" });
  return host;
}

test("Settings shows Trusted command classes for a workspace and keeps Review honest", async () => {
  await openSettingsApp({ policy: "review" });
  const editor = screen.getByRole("group", { name: "Trusted command classes" });
  assert.ok(within(editor).getByText(/No Trusted command classes yet/i));
  assert.ok(within(editor).getByText(/does not skip approvals while Policy is Review/i));
  assert.equal(within(editor).queryByRole("textbox"), null);
  assert.equal(within(editor).queryByText(/allowlist/i), null);
});

test("Trusted policy helper is distinct from Review and empty never means allow-all", async () => {
  await openSettingsApp({ policy: "trusted_workspace" });
  const editor = screen.getByRole("group", { name: "Trusted command classes" });
  assert.ok(within(editor).getByText("List is active for this workspace under Trusted workspace."));
  assert.ok(within(editor).getByText(/No Trusted command classes yet/i));
  assert.equal(screen.queryByText("Ran without asking · Trusted command class"), null);
});

test("no workspace uses the exact editor guidance", async () => {
  await openSettingsApp({ workspace: null });
  assert.ok(screen.getByText("Open a workspace to manage Trusted command classes."));
});

test("unreadable store uses load-failure copy instead of the empty happy path", async () => {
  await openSettingsApp({ fallbackReason: "unreadable" });
  const editor = screen.getByRole("group", { name: "Trusted command classes" });
  assert.ok(
    within(editor).getByText(
      "Trusted command classes couldn’t be loaded. Matching shell will still ask until a valid list is saved.",
    ),
  );
  assert.equal(within(editor).queryByText(/No Trusted command classes yet/i), null);
});

test("saving a closed class POSTs the draft and shows success without inventing allow", async () => {
  const host = await openSettingsApp({ policy: "trusted_workspace" });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add npm" }));
  await user.click(screen.getByRole("button", { name: "Save classes" }));
  await screen.findByText("Trusted command classes saved.");
  const posts = host.callsTo("/api/trusted-command-classes").filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0]?.body?.classes, ["npm"]);
  assert.equal(posts[0]?.body?.expectedRevision, "fallback");
  assert.ok(screen.getByText("Saved for this workspace"));
  assert.equal(screen.queryByText("Ran without asking · Trusted command class"), null);
});

test("mid-run save is refused and does not claim success", async () => {
  const host = await openSettingsApp({
    policy: "trusted_workspace",
    classSaveError: { status: 409, code: "run_active" },
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add cargo" }));
  await user.click(screen.getByRole("button", { name: "Save classes" }));
  await screen.findByText(
    "Couldn’t save Trusted command classes while a run is in progress. The last confirmed list remains active.",
  );
  assert.equal(screen.queryByText("Trusted command classes saved."), null);
  assert.equal(host.trustedClasses.get("C:\\repo")?.source, "fallback");
});

test("CAS 409 re-GETs expectedRevision before retry", async () => {
  const host = await openSettingsApp({
    policy: "trusted_workspace",
    classSaveError: { status: 409, code: "class_revision_conflict" },
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add npm" }));
  await user.click(screen.getByRole("button", { name: "Save classes" }));
  await screen.findByText(/Couldn’t save Trusted command classes\. The last confirmed list remains active/);
  const getsAfterConflict = host.callsTo("/api/trusted-command-classes").filter((call) => call.method === "GET");
  assert.ok(getsAfterConflict.length >= 2, "conflict must re-GET the current revision");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Trusted command classes saved.");
  const posts = host.callsTo("/api/trusted-command-classes").filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.notEqual(posts[1]?.body?.expectedRevision, "fallback");
});

test("Review still asks: permission dock is unchanged by a saved list", async () => {
  await openSettingsApp({ policy: "review", classes: ["npm"] });
  const user = userEvent.setup();
  // Settings has no sidebar tab back to chat any more (Task 5) — the same
  // topbar toggle that opened Settings flips back; its title/accessible
  // name swaps to "Chat" while view === "settings" (AppTopbar.tsx).
  const backToChat = screen
    .getAllByRole("button", { name: "Chat" })
    .find((button) => button.className.includes("ghost"));
  assert.ok(backToChat);
  await user.click(backToChat!);
  const composer = await screen.findByLabelText("Message to agent");
  await user.type(composer, "run tests");
  await user.click(screen.getByRole("button", { name: "Send" }));
  const socket = FakeWebSocket.latest();
  assert.ok(socket);
  socket!.emit({
    type: "permission_request",
    id: "perm-1",
    kind: "shell",
    detail: "npm test",
  });
  const dock = await screen.findByRole("region", { name: "Pending agent actions" });
  assert.ok(within(dock).getByRole("region", { name: "Grok wants to run a command" }));
  assert.ok(within(dock).getByRole("button", { name: "Allow" }));
  // The S label is a cosmetic class match on the command text alone — it
  // shows "Allow npm for this session" here even though this saved list
  // ("npm") is never consulted, because Policy stays Review and still asks.
  assert.ok(within(dock).getByRole("button", { name: "Allow npm for this session" }));
  assert.ok(within(dock).getByRole("button", { name: "Deny" }));
  assert.equal(within(dock).queryByText(/Trusted command class/i), null);
});
