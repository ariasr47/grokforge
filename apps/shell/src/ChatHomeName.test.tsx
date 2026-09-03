import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatHomeName, HOME_NAME_PLACEHOLDER, HOME_NAME_SAVE_FAILED } from "./ChatHomeName";

afterEach(() => cleanup());

test("Code renders nothing", () => {
  const { container } = render(
    <ChatHomeName
      mode="code"
      committedName={false}
      title="x"
      saveFailed={false}
      onCommit={() => undefined}
    />,
  );
  assert.equal(container.textContent, "");
});

test("uncommitted empty title shows Name this home placeholder", () => {
  render(
    <ChatHomeName
      mode="chat"
      committedName={false}
      title="New chat"
      saveFailed={false}
      onCommit={() => undefined}
    />,
  );
  assert.ok(screen.getByRole("button", { name: HOME_NAME_PLACEHOLDER }));
});

test("uncommitted auto-title is shown so chats are distinguishable", () => {
  render(
    <ChatHomeName
      mode="chat"
      committedName={false}
      title="Reply with exactly CHAT-GLANCE-OK and stop. Do not edit files."
      saveFailed={false}
      onCommit={() => undefined}
    />,
  );
  assert.ok(
    screen.getByRole("button", {
      name: "Reply with exactly CHAT-GLANCE-OK and stop. Do not edit files.",
    }),
  );
  assert.equal(screen.queryByRole("button", { name: HOME_NAME_PLACEHOLDER }) === null, true);
});

test("committed shows title", () => {
  render(
    <ChatHomeName
      mode="chat"
      committedName
      title="Atlas"
      saveFailed={false}
      onCommit={() => undefined}
    />,
  );
  assert.ok(screen.getByRole("button", { name: "Atlas" }));
});

test("save-failed copy is distinct and retryable", async () => {
  let retried = false;
  render(
    <ChatHomeName
      mode="chat"
      committedName={false}
      title=""
      saveFailed
      onCommit={() => undefined}
      onRetry={() => {
        retried = true;
      }}
    />,
  );
  assert.ok(screen.getByRole("alert"));
  assert.ok(screen.getByText(HOME_NAME_SAVE_FAILED));
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  assert.equal(retried, true);
});

test("commit from placeholder sends trimmed title", async () => {
  let committed = "";
  render(
    <ChatHomeName
      mode="chat"
      committedName={false}
      title=""
      saveFailed={false}
      onCommit={(t) => {
        committed = t;
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: HOME_NAME_PLACEHOLDER }));
  await userEvent.type(screen.getByLabelText(HOME_NAME_PLACEHOLDER), "Keep this");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  assert.equal(committed, "Keep this");
});
