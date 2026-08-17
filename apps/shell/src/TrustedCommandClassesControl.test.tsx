import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TrustedCommandClassesControl } from "./TrustedCommandClassesControl";

afterEach(() => cleanup());

const catalog = [
  { id: "npm" as const, label: "npm" },
  { id: "cargo" as const, label: "cargo" },
  { id: "git:show" as const, label: "git show" },
];

const emptyConfirmed = {
  classes: [] as Array<"npm" | "cargo" | "git:show">,
  revision: "fallback",
  source: "fallback" as const,
  fallbackReason: "missing" as const,
  savedForWorkspace: false,
  catalog,
};

test("empty happy path vs load-failure copy", () => {
  const { rerender } = render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={emptyConfirmed}
      onSave={async () => {}}
    />,
  );
  assert.ok(screen.getByText(/No Trusted command classes yet/i));
  assert.ok(screen.getByText(/List is active for this workspace under Trusted workspace/i));

  rerender(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={{
        classes: [],
        revision: "fallback",
        source: "fallback",
        fallbackReason: "unreadable",
        savedForWorkspace: false,
        catalog,
      }}
      onSave={async () => {}}
    />,
  );
  assert.ok(screen.getByText(/couldn’t be loaded/i));
  assert.equal(screen.queryByText(/No Trusted command classes yet/i), null);
});

test("Review helper says list does not skip approvals; closed catalog only", () => {
  render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="review"
      confirmed={{
        classes: ["npm"],
        revision: "r1",
        source: "saved",
        fallbackReason: null,
        savedForWorkspace: true,
        catalog,
      }}
      onSave={async () => {}}
    />,
  );
  assert.ok(screen.getByText(/does not skip approvals while Policy is Review/i));
  assert.ok(screen.getByText("npm"));
  assert.equal(screen.queryByRole("textbox"), null);
});

test("save error retains draft and shows exact copy", async () => {
  render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={emptyConfirmed}
      onSave={async () => {
        throw Object.assign(new Error("fail"), { code: "class_save_failed" });
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add npm/i }));
  fireEvent.click(screen.getByRole("button", { name: /Save classes/i }));
  await waitFor(() =>
    assert.ok(screen.getByText(/Couldn’t save Trusted command classes\. The last confirmed list remains active/i)),
  );
  assert.ok(screen.getByRole("button", { name: /Remove npm/i }));
  assert.ok(screen.getByRole("button", { name: /Save classes/i }));
  assert.ok(screen.getByRole("button", { name: /Try again/i }));
});

test("mid-run refuse copy", async () => {
  render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={emptyConfirmed}
      onSave={async () => {
        throw Object.assign(new Error("run"), { code: "run_active" });
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add cargo/i }));
  fireEvent.click(screen.getByRole("button", { name: /Save classes/i }));
  await waitFor(() =>
    assert.ok(
      screen.getByText(
        /Couldn’t save Trusted command classes while a run is in progress\. The last confirmed list remains active/,
      ),
    ),
  );
  assert.equal(screen.queryByText("Trusted command classes saved."), null);
  assert.ok(screen.getByRole("button", { name: /Remove cargo/i }));
});

test("§4 editor states use exact copy and keep Save host-authoritative", () => {
  const cases: Array<["loading" | "saving" | "offline" | "stale" | "unconfirmed" | "no_workspace", string]> = [
    ["loading", "Loading Trusted command classes…"],
    ["saving", "Saving Trusted command classes…"],
    ["offline", "Trusted command classes couldn’t be confirmed. Reconnect before changing them."],
    ["stale", "Trusted command classes couldn’t be confirmed. Reconnect before changing them."],
    ["unconfirmed", "Trusted command classes couldn’t be confirmed. Reconnect before changing them."],
    ["no_workspace", "Open a workspace to manage Trusted command classes."],
  ];
  for (const [status, copy] of cases) {
    cleanup();
    render(
      <TrustedCommandClassesControl
        status={status}
        policyMode="trusted_workspace"
        confirmed={emptyConfirmed}
        onSave={async () => {}}
      />,
    );
    assert.ok(screen.getByText(copy, { exact: true }));
    assert.equal(screen.queryByRole("button", { name: /Save classes/i }), null);
  }
});

test("invalid store uses load-failure copy, not the empty happy path", () => {
  render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="review"
      confirmed={{
        ...emptyConfirmed,
        fallbackReason: "invalid",
      }}
      onSave={async () => {}}
    />,
  );
  assert.ok(
    screen.getByText(
      "Trusted command classes couldn’t be loaded. Matching shell will still ask until a valid list is saved.",
      { exact: true },
    ),
  );
  assert.equal(screen.queryByText(/No Trusted command classes yet/i), null);
});

test("successful save announces exact copy and does not invent a free-text field", async () => {
  let saved: string[] | null = null;
  render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={emptyConfirmed}
      onSave={async (classes) => {
        saved = classes;
      }}
    />,
  );
  assert.ok(
    screen.getByText(
      "Applies only when Policy is Trusted workspace. Review still asks. Commands stay unsandboxed after they run.",
      { exact: true },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /Add npm/i }));
  fireEvent.click(screen.getByRole("button", { name: /Save classes/i }));
  await waitFor(() => assert.ok(screen.getByText("Trusted command classes saved.", { exact: true })));
  assert.deepEqual(saved, ["npm"]);
  assert.equal(screen.queryByRole("textbox"), null);
});

test("CAS retry keeps the draft and resends after parent refreshes expectedRevision", async () => {
  const revisions: string[] = [];
  const { rerender } = render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={emptyConfirmed}
      onSave={async (_classes, expectedRevision) => {
        revisions.push(expectedRevision);
        throw Object.assign(new Error("conflict"), { code: "class_revision_conflict" });
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add npm/i }));
  fireEvent.click(screen.getByRole("button", { name: /Save classes/i }));
  await waitFor(() =>
    assert.ok(screen.getByText(/Couldn’t save Trusted command classes\. The last confirmed list remains active/i)),
  );
  rerender(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={{
        ...emptyConfirmed,
        revision: "fresh-rev",
      }}
      onSave={async (_classes, expectedRevision) => {
        revisions.push(expectedRevision);
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
  await waitFor(() => assert.deepEqual(revisions, ["fallback", "fresh-rev"]));
  assert.ok(screen.getByRole("button", { name: /Remove npm/i }));
});

test("product noun is Trusted command classes; source bans bare allowlist and sandbox claims", () => {
  render(
    <TrustedCommandClassesControl
      status="confirmed"
      policyMode="trusted_workspace"
      confirmed={{
        ...emptyConfirmed,
        classes: ["cargo"],
        source: "saved",
        fallbackReason: null,
        savedForWorkspace: true,
        revision: "r2",
      }}
      onSave={async () => {}}
    />,
  );
  assert.ok(screen.getByRole("group", { name: "Trusted command classes" }));
  assert.ok(screen.getByText("Saved for this workspace"));
  assert.equal(screen.queryByText(/allowlist/i), null);
  assert.equal(screen.queryByText(/permission mode/i), null);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, "TrustedCommandClassesControl.tsx"), "utf8");
  const stripped = source
    .replace(/Commands stay unsandboxed after they run\./g, "")
    .replace(/The process is not sandboxed\./g, "");
  assert.equal(/\ballowlist\b/i.test(source), false, "editor source must not use bare allowlist");
  assert.equal(/\bsandbox(?:ed)?\b/i.test(stripped), false, "editor source must not claim sandbox except allowed phrases");
});
