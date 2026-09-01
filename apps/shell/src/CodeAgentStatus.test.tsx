import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CODE_AGENT_CHECKING,
  CODE_AGENT_FALLBACK_CLI,
  CODE_AGENT_FALLBACK_SPAWN,
  CODE_AGENT_HARD_FAIL,
  CODE_AGENT_OFFLINE,
  CODE_AGENT_VENDOR,
  CODE_AGENT_VENDOR_TITLE,
} from "./codeAgentComposer";
import { CodeAgentStatus } from "./CodeAgentStatus";

afterEach(() => cleanup());

test("Chat / absent_chat renders nothing", () => {
  const { container } = render(
    <CodeAgentStatus projection={{ state: "absent_chat" }} />,
  );
  assert.equal(container.textContent, "");
  assert.equal(screen.queryByText(CODE_AGENT_VENDOR), null);
});

test("checking copy is not final Grok Code", () => {
  render(<CodeAgentStatus projection={{ state: "checking" }} />);
  assert.ok(screen.getByText(CODE_AGENT_CHECKING));
  assert.equal(screen.queryByText(CODE_AGENT_VENDOR), null);
  assert.ok(screen.getByRole("status"));
});

test("vendor is quiet inline status with tooltip — not a second pill", () => {
  const { container } = render(
    <CodeAgentStatus projection={{ state: "vendor" }} />,
  );
  assert.ok(screen.getByText(CODE_AGENT_VENDOR));
  const status = screen.getByRole("status");
  assert.equal(status.getAttribute("title"), CODE_AGENT_VENDOR_TITLE);
  assert.ok(container.querySelector(".code-agent-status.is-vendor.is-quiet"));
  assert.equal(container.querySelector(".is-fallback-warn"), null);
});

test("fallback uses warn-tint class and distinct reason copy", () => {
  const { container, rerender } = render(
    <CodeAgentStatus
      projection={{ state: "fallback", reason: "cli_missing" }}
    />,
  );
  assert.ok(screen.getByText(CODE_AGENT_FALLBACK_CLI));
  assert.ok(container.querySelector(".code-agent-status.is-fallback-warn"));
  assert.equal(container.querySelector(".is-quiet"), null);
  assert.equal(screen.queryByText(CODE_AGENT_VENDOR), null);
  rerender(
    <CodeAgentStatus
      projection={{ state: "fallback", reason: "spawn_failed" }}
    />,
  );
  assert.ok(screen.getByText(CODE_AGENT_FALLBACK_SPAWN));
});

test("hard_fail uses error class and is not Mini-Grok fallback", () => {
  const { container } = render(
    <CodeAgentStatus projection={{ state: "hard_fail" }} />,
  );
  assert.ok(screen.getByText(CODE_AGENT_HARD_FAIL));
  assert.ok(container.querySelector(".code-agent-status.is-error"));
  assert.equal(screen.queryByText(/Mini-Grok/), null);
});

test("offline keeps last identity and reconnect copy; does not upgrade fallback", () => {
  const { container } = render(
    <CodeAgentStatus
      projection={{
        state: "offline_unconfirmed",
        last: { state: "fallback", reason: "cli_missing" },
      }}
    />,
  );
  assert.ok(screen.getByText(CODE_AGENT_FALLBACK_CLI));
  assert.ok(screen.getByText(CODE_AGENT_OFFLINE));
  assert.equal(screen.queryByText(CODE_AGENT_VENDOR), null);
  assert.equal(container.querySelector(".is-quiet"), null);
});

test("offline vendor keeps chip chrome (not quiet meta)", () => {
  const { container } = render(
    <CodeAgentStatus
      projection={{
        state: "offline_unconfirmed",
        last: { state: "vendor" },
      }}
    />,
  );
  assert.ok(screen.getByText(CODE_AGENT_VENDOR));
  assert.ok(screen.getByText(CODE_AGENT_OFFLINE));
  assert.ok(container.querySelector(".code-agent-status.is-vendor"));
  assert.equal(container.querySelector(".is-quiet"), null);
});

test("polite live region only on vendor↔fallback / hard_fail flips", () => {
  const { rerender } = render(
    <CodeAgentStatus projection={{ state: "checking" }} />,
  );
  assert.equal(screen.queryByText(CODE_AGENT_VENDOR, { selector: ".sr-only" }), null);
  rerender(<CodeAgentStatus projection={{ state: "vendor" }} />);
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent?.includes(CODE_AGENT_VENDOR) ?? false,
    false,
    "first vendor stamp after checking is not a flip announce",
  );
  rerender(
    <CodeAgentStatus
      projection={{ state: "fallback", reason: "spawn_failed" }}
    />,
  );
  const live = document.querySelector("[aria-live='polite']");
  assert.ok(live);
  assert.equal(live?.textContent, CODE_AGENT_FALLBACK_SPAWN);
  rerender(<CodeAgentStatus projection={{ state: "hard_fail" }} />);
  assert.equal(
    document.querySelector("[aria-live='polite']")?.textContent,
    CODE_AGENT_HARD_FAIL,
  );
});
