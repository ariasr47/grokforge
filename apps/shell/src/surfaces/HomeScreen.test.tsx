// Task 13 — Home screen. Pure component test: no App/host mocking, mirrors
// the isolated-render style already used for ChatHomeName.test.tsx and
// chat.journeys.unit.test.tsx. Covers: greeting variants (including the
// no-real-name case — Forge never invents a name), real counts (the
// needs-you clause omitted at zero; there is deliberately no prop for a
// "finished while you were away" count since the app cannot derive one —
// see HomeScreen.tsx's module comment), focus + Enter opening the first
// Needs-you session, arrow-key roving focus, and the footer facts.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen, type HomeScreenProps } from "./HomeScreen";

afterEach(() => cleanup());

function baseProps(overrides: Partial<HomeScreenProps> = {}): HomeScreenProps {
  return {
    greetingName: null,
    needsYou: [],
    recentWorkspaces: [],
    chatHomes: [],
    footer: {
      version: "0.7.0",
      installerWarning: null,
      authLabel: "Grok · subscription",
      channel: null,
      isPackagedWindows: false,
    },
    onFieldQuery: () => undefined,
    onOpenNeedsYou: () => undefined,
    onOpenWorkspace: () => undefined,
    onOpenChatHome: () => undefined,
    onAllSessions: () => undefined,
    onNewChatHome: () => undefined,
    onOpenFolder: () => undefined,
    onNewSession: () => undefined,
    onNewChat: () => undefined,
    ...overrides,
  };
}

test("greeting: morning/afternoon/evening, no real name available — never invents one", () => {
  const { rerender } = render(
    <HomeScreen {...baseProps({ now: new Date(2026, 0, 1, 9, 0) })} />,
  );
  assert.ok(screen.getByRole("heading", { name: "Good morning." }));

  rerender(<HomeScreen {...baseProps({ now: new Date(2026, 0, 1, 15, 0) })} />);
  assert.ok(screen.getByRole("heading", { name: "Good afternoon." }));

  rerender(<HomeScreen {...baseProps({ now: new Date(2026, 0, 1, 21, 0) })} />);
  assert.ok(screen.getByRole("heading", { name: "Good evening." }));
});

test("greeting: uses a real name when the caller has one", () => {
  render(
    <HomeScreen
      {...baseProps({ now: new Date(2026, 0, 1, 9, 0), greetingName: "Rodrigo" })}
    />,
  );
  assert.ok(screen.getByRole("heading", { name: "Good morning, Rodrigo." }));
});

test("needs-you count: real phrase when > 0, singular grammar at 1, absent at 0", () => {
  const { rerender } = render(<HomeScreen {...baseProps({ needsYou: [] })} />);
  assert.equal(screen.queryByText(/need you/) === null, true);
  assert.equal(screen.queryByText("Needs you") === null, true);

  rerender(
    <HomeScreen
      {...baseProps({
        needsYou: [{ workspace: "C:\\repo", id: "s1", title: "Approve a command" }],
      })}
    />,
  );
  assert.ok(screen.getByText("1 session needs you."));

  rerender(
    <HomeScreen
      {...baseProps({
        needsYou: [
          { workspace: "C:\\repo", id: "s1", title: "Approve a command" },
          { workspace: "C:\\repo", id: "s2", title: "Answer a question" },
        ],
      })}
    />,
  );
  assert.ok(screen.getByText("2 sessions need you."));
  // The "N others finished while you were away" clause never renders — the
  // app has no way to know what finished since the last visit, and there is
  // no prop that could fabricate it (see HomeScreenProps).
  assert.equal(screen.queryByText(/finished while you were away/) === null, true);
});

test("first Needs-you item is focused on mount; Enter opens it", () => {
  const opened: Array<[string, string]> = [];
  render(
    <HomeScreen
      {...baseProps({
        needsYou: [
          { workspace: "C:\\repo", id: "s1", title: "Approve a command", reason: "approve" },
          { workspace: "C:\\repo", id: "s2", title: "Answer a question", reason: "question" },
        ],
        onOpenNeedsYou: (workspace, id) => opened.push([workspace, id]),
      })}
    />,
  );
  const first = screen.getByRole("button", { name: /Approve a command/ });
  assert.equal(document.activeElement, first);
  fireEvent.keyDown(first, { key: "Enter" });
  assert.deepEqual(opened, [["C:\\repo", "s1"]]);
});

test("arrow keys move roving focus across Needs-you and Recent items", () => {
  render(
    <HomeScreen
      {...baseProps({
        needsYou: [
          { workspace: "C:\\repo", id: "s1", title: "Approve a command" },
        ],
        recentWorkspaces: [
          {
            path: "C:\\repo",
            name: "grokforge",
            branch: "master",
            sessionCount: 4,
            lastSessionId: "r1",
            lastTitle: "Fix typecheck",
            updatedAt: Date.now(),
          },
        ],
      })}
    />,
  );
  const needsItem = screen.getByRole("button", { name: /Approve a command/ });
  const recentItem = screen.getByRole("button", { name: /grokforge/ });
  assert.equal(document.activeElement, needsItem);
  fireEvent.keyDown(needsItem, { key: "ArrowDown" });
  assert.equal(document.activeElement, recentItem);
  fireEvent.keyDown(recentItem, { key: "ArrowUp" });
  assert.equal(document.activeElement, needsItem);
});

test("Recent workspace row: sessions count, last title, branch, time-ago; click opens the last session", () => {
  const opened: Array<[string, string]> = [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  render(
    <HomeScreen
      {...baseProps({
        recentWorkspaces: [
          {
            path: "C:\\Dev\\grokforge",
            name: "grokforge",
            branch: "master",
            sessionCount: 4,
            lastSessionId: "sess-9",
            lastTitle: "Installer SHA-256 in Settings finished",
            updatedAt: oneHourAgo,
          },
        ],
        onOpenWorkspace: (path, lastSessionId) => opened.push([path, lastSessionId]),
      })}
    />,
  );
  const row = screen.getByRole("button", { name: /grokforge/ });
  assert.match(row.textContent ?? "", /master/);
  assert.match(row.textContent ?? "", /4 sessions · Installer SHA-256 in Settings finished/);
  assert.match(row.textContent ?? "", /1h ago/);
  fireEvent.click(row);
  assert.deepEqual(opened, [["C:\\Dev\\grokforge", "sess-9"]]);
});

// W3-10: sessions.ts stamps a session's branch once and never overwrites an
// already-set value, so this chip is the branch as of the last session
// opened here, not a live git read — the title says so rather than let the
// chip pass as current state.
test("Recent workspace row's branch chip says it's last-known, not live, in its title", () => {
  render(
    <HomeScreen
      {...baseProps({
        recentWorkspaces: [
          {
            path: "C:\\Dev\\grokforge",
            name: "grokforge",
            branch: "master",
            sessionCount: 4,
            lastSessionId: "sess-9",
            lastTitle: "Installer SHA-256 in Settings finished",
            updatedAt: Date.now(),
          },
        ],
      })}
    />,
  );
  const branchChip = screen.getByText("master");
  assert.match(branchChip.getAttribute("title") ?? "", /not a live git read/);
});

// W3-10: the local store caps each workspace at MAX_PER_WS (20) sessions —
// createSession's .slice silently drops the oldest once full, so a count
// that reads exactly 20 cannot be told apart from "20 or more, some already
// gone". A bare "20" would understate that; "20+" says what's actually known.
test("Recent workspace row marks a saturated session count as N+, not a bare count that undersells it", () => {
  render(
    <HomeScreen
      {...baseProps({
        recentWorkspaces: [
          {
            path: "C:\\Dev\\grokforge",
            name: "grokforge",
            branch: "master",
            sessionCount: 20,
            lastSessionId: "sess-9",
            lastTitle: "Installer SHA-256 in Settings finished",
            updatedAt: Date.now(),
          },
        ],
      })}
    />,
  );
  const row = screen.getByRole("button", { name: /grokforge/ });
  assert.match(row.textContent ?? "", /20\+ sessions · Installer SHA-256 in Settings finished/);
});

test("Recent workspace row omits branch when the workspace has none on record", () => {
  render(
    <HomeScreen
      {...baseProps({
        recentWorkspaces: [
          {
            path: "C:\\Dev\\no-git",
            name: "no-git",
            branch: null,
            sessionCount: 1,
            lastSessionId: "sess-1",
            lastTitle: "New session",
            updatedAt: Date.now(),
          },
        ],
      })}
    />,
  );
  const row = screen.getByRole("button", { name: /no-git/ });
  assert.equal(/master|no-git-branch/.test(row.textContent ?? ""), false);
});

test("no workspaces yet: Recent shows an honest empty line, not fabricated content", () => {
  render(<HomeScreen {...baseProps()} />);
  assert.ok(screen.getByText("Open a folder to start your first workspace."));
  assert.equal(screen.queryByRole("button", { name: /grokforge/ }) === null, true);
});

test("Chat homes row: title, preview, time-ago; click opens it", () => {
  const opened: string[] = [];
  const twoMinAgo = Date.now() - 2 * 60 * 1000;
  render(
    <HomeScreen
      {...baseProps({
        chatHomes: [
          { id: "home-1", title: "Family admin", preview: "Landlord email draft", updatedAt: twoMinAgo },
        ],
        onOpenChatHome: (id) => opened.push(id),
      })}
    />,
  );
  const row = screen.getByRole("button", { name: /Family admin/ });
  assert.match(row.textContent ?? "", /Landlord email draft/);
  assert.match(row.textContent ?? "", /2m ago/);
  fireEvent.click(row);
  assert.deepEqual(opened, ["home-1"]);
});

test("Start rows trigger their handlers and show the right shortcut hints", async () => {
  const calls: string[] = [];
  render(
    <HomeScreen
      {...baseProps({
        onOpenFolder: () => calls.push("open-folder"),
        onNewSession: () => calls.push("new-session"),
        onNewChat: () => calls.push("new-chat"),
      })}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Open a folder as a Code workspace/ }));
  await user.click(screen.getByRole("button", { name: /New session in the last workspace/ }));
  await user.click(screen.getByRole("button", { name: /New chat in a home/ }));
  assert.deepEqual(calls, ["open-folder", "new-session", "new-chat"]);
  // The same shortcuts also appear as static hints above the grid — assert
  // presence, not exclusivity, of each in the Start rows themselves.
  assert.equal(screen.getAllByText("Ctrl+O").length >= 2, true);
  assert.equal(screen.getAllByText("Ctrl+N").length >= 2, true);
  assert.equal(screen.getAllByText("Ctrl+Shift+N").length >= 2, true);
});

test("All sessions and New home links call their handlers", async () => {
  const calls: string[] = [];
  render(
    <HomeScreen
      {...baseProps({
        onAllSessions: () => calls.push("all-sessions"),
        onNewChatHome: () => calls.push("new-home"),
      })}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "All sessions" }));
  await user.click(screen.getByRole("button", { name: "New home" }));
  assert.deepEqual(calls, ["all-sessions", "new-home"]);
});

test("typing in the field reports the query to the caller", async () => {
  const queries: string[] = [];
  render(<HomeScreen {...baseProps({ onFieldQuery: (q) => queries.push(q) })} />);
  const user = userEvent.setup();
  await user.type(
    screen.getByPlaceholderText("Search sessions…"),
    "auth",
  );
  assert.deepEqual(queries, ["a", "au", "aut", "auth"]);
});

// W3-6: the field is wired to openPalette("sessions", text) only — sessions
// mode can only select a session (CommandPalette.tsx), never open a folder
// or send Grok a message. "Search sessions" is the palette's own established
// name for that exact feature (INPUT_PLACEHOLDER.sessions in
// CommandPalette.tsx). @ file and / command hints have meaning only in the
// composer, so this field describes only what it does and drops them.
test("field describes only what it does — no @ file / command hints that belong to the composer", () => {
  render(<HomeScreen {...baseProps()} />);
  assert.ok(screen.getByPlaceholderText("Search sessions…"));
  assert.ok(screen.getByLabelText("Search sessions"));
  assert.equal(screen.queryByText("file") === null, true);
  assert.equal(screen.queryByText("command") === null, true);
});

test("footer: version + Windows, auth label, and channel badge only when non-prod", () => {
  const { rerender } = render(
    <HomeScreen
      {...baseProps({
        footer: {
          version: "0.7.0",
          installerWarning: null,
          authLabel: "Grok · subscription",
          channel: null,
          isPackagedWindows: true,
        },
      })}
    />,
  );
  assert.ok(screen.getByText("Forge 0.7.0 · Windows"));
  assert.ok(screen.getByText("Grok · subscription"));
  assert.equal(screen.queryByText("DEV") === null, true);

  rerender(
    <HomeScreen
      {...baseProps({
        footer: {
          version: "0.7.0",
          installerWarning: null,
          authLabel: "Grok · API key",
          channel: "DEV",
          isPackagedWindows: true,
        },
      })}
    />,
  );
  assert.ok(screen.getByText("DEV"));
  assert.ok(screen.getByText("Grok · API key"));
});

// W3-10: "· Windows" used to be a bare string literal, asserted regardless
// of the real environment. isPackagedWindowsInstallerSession() (Tauri +
// user-agent) is the same real check the installer-honesty warning already
// uses — when it says no, the footer omits the claim rather than fake it.
test("footer: the Windows suffix is omitted, not hardcoded, when the session can't verify it's a packaged Windows build", () => {
  render(
    <HomeScreen
      {...baseProps({
        footer: {
          version: "0.7.0",
          installerWarning: null,
          authLabel: "Grok · subscription",
          channel: null,
          isPackagedWindows: false,
        },
      })}
    />,
  );
  assert.ok(screen.getByText("Forge 0.7.0"));
  assert.equal(screen.queryByText(/Windows/) === null, true);
});

test("footer: installer honesty warning renders only when the caller says the build is unsigned", () => {
  const { rerender } = render(
    <HomeScreen
      {...baseProps({
        footer: {
          version: "0.7.0",
          installerWarning: null,
          authLabel: "Grok · subscription",
          channel: null,
          isPackagedWindows: false,
        },
      })}
    />,
  );
  assert.equal(screen.queryByText(/not Authenticode-signed/) === null, true);

  rerender(
    <HomeScreen
      {...baseProps({
        footer: {
          version: "0.7.0",
          installerWarning:
            "This Windows installer is not Authenticode-signed. Windows may show an unknown-publisher or SmartScreen warning.",
          authLabel: "Grok · subscription",
          channel: null,
          isPackagedWindows: true,
        },
      })}
    />,
  );
  assert.ok(screen.getByText(/not Authenticode-signed/));
});
