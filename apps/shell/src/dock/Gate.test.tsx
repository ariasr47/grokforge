import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Gate } from "./Gate";
import {
  GATE_ALLOW,
  GATE_DENY,
  GATE_EDIT_COMMAND,
  GATE_TRUST_FOLDER,
  PLAN_ACCEPT,
  PLAN_DOCK_EMPTY,
  PLAN_END_EMPTY,
  PLAN_KEEP,
  gateAllowSessionLabel,
  planReadyTitle,
} from "../lib/copyDock";

afterEach(() => cleanup());

// —— Shell tier (amber) ——

test("shell tier: amber header, $ command block, and why line pass through detail verbatim", () => {
  const { container } = render(
    <Gate
      tier="shell"
      detail="npm test -- OverviewStrip"
      onAllow={() => {}}
      onAllowSession={() => {}}
      onDeny={() => {}}
    />,
  );
  const gate = screen.getByRole("region", { name: "Grok wants to run a command" });
  assert.ok(within(gate).getByText("Review policy · asks before shell"));
  const cmd = container.querySelector(".gate .cmd");
  assert.ok(cmd?.textContent?.includes("$"));
  assert.ok(cmd?.textContent?.includes("npm test -- OverviewStrip"));
  // .why is the same pass-through detail, rendered once as its own element.
  assert.ok(within(gate).getByText("npm test -- OverviewStrip"));
});

test("shell tier: no workspace name means no cwd is invented", () => {
  const { container } = render(
    <Gate tier="shell" detail="echo hi" onAllow={() => {}} onAllowSession={() => {}} onDeny={() => {}} />,
  );
  assert.equal(container.querySelector(".gate .cmd .cwd") === null, true);
});

test("shell tier: a real workspace name renders as cwd", () => {
  const { container } = render(
    <Gate
      tier="shell"
      detail="echo hi"
      cwd="apps/shell"
      onAllow={() => {}}
      onAllowSession={() => {}}
      onDeny={() => {}}
    />,
  );
  assert.equal(container.querySelector(".gate .cmd .cwd")?.textContent, "apps/shell");
});

test("shell tier keys: Allow shows kbd ⏎, S allow-session, Deny shows kbd esc", () => {
  render(
    <Gate tier="shell" detail="echo hi" onAllow={() => {}} onAllowSession={() => {}} onDeny={() => {}} />,
  );
  const allow = screen.getByRole("button", { name: GATE_ALLOW });
  assert.equal(within(allow).getByText("⏎").tagName, "KBD");
  const deny = screen.getByRole("button", { name: GATE_DENY });
  assert.equal(within(deny).getByText("esc").tagName, "KBD");
  const session = screen.getByRole("button", { name: gateAllowSessionLabel(null) });
  assert.equal(within(session).getByText("S").tagName, "KBD");
});

test("shell tier: S label uses the matched trusted command class (single token)", () => {
  render(
    <Gate tier="shell" detail="npm test" onAllow={() => {}} onAllowSession={() => {}} onDeny={() => {}} />,
  );
  assert.ok(screen.getByRole("button", { name: "Allow npm for this session" }));
});

test("shell tier: S label matches git-status-style two-token classes", () => {
  render(
    <Gate
      tier="shell"
      detail="git status --porcelain"
      onAllow={() => {}}
      onAllowSession={() => {}}
      onDeny={() => {}}
    />,
  );
  assert.ok(screen.getByRole("button", { name: "Allow git status for this session" }));
});

test("shell tier: an unrecognized command falls back to the generic session label", () => {
  render(
    <Gate tier="shell" detail="echo hi" onAllow={() => {}} onAllowSession={() => {}} onDeny={() => {}} />,
  );
  assert.ok(screen.getByRole("button", { name: "Allow for this session" }));
  assert.equal(screen.queryByRole("button", { name: /^Allow \w+ for this session$/ }) === null, true);
});

test("shell tier: Edit command fires its handler and never appears on write", () => {
  let edited = 0;
  render(
    <Gate
      tier="shell"
      detail="npm test"
      onAllow={() => {}}
      onAllowSession={() => {}}
      onDeny={() => {}}
      onEditCommand={() => {
        edited += 1;
      }}
    />,
  );
  screen.getByRole("button", { name: GATE_EDIT_COMMAND }).click();
  assert.equal(edited, 1);
});

test("shell tier: Allow/Deny/AllowSession call their handlers", () => {
  let allowed = 0;
  let denied = 0;
  let session = 0;
  render(
    <Gate
      tier="shell"
      detail="echo hi"
      onAllow={() => {
        allowed += 1;
      }}
      onAllowSession={() => {
        session += 1;
      }}
      onDeny={() => {
        denied += 1;
      }}
    />,
  );
  screen.getByRole("button", { name: GATE_ALLOW }).click();
  screen.getByRole("button", { name: GATE_DENY }).click();
  screen.getByRole("button", { name: "Allow for this session" }).click();
  assert.deepEqual([allowed, denied, session], [1, 1, 1]);
});

// —— Write tier (amber) ——

test("write tier: amber header names writing a file, path shown, no why line, Edit command absent", () => {
  render(
    <Gate tier="write" detail="notes.md" onAllow={() => {}} onAllowSession={() => {}} onDeny={() => {}} />,
  );
  const gate = screen.getByRole("region", { name: "Grok wants to write a file" });
  assert.ok(within(gate).getByText("Review policy · asks before write"));
  assert.ok(within(gate).getByText("notes.md"));
  assert.equal(screen.queryByRole("button", { name: GATE_EDIT_COMMAND }) === null, true);
  assert.ok(within(gate).getByRole("button", { name: "Allow for this session" }));
});

test("write tier: a diff carried on the request shows the stat and up to a 2-line snippet", () => {
  const { container } = render(
    <Gate
      tier="write"
      detail="config.json"
      diffStat={{ added: 1, removed: 1 }}
      diffSnippet={[
        '-  "effort": "auto",',
        '+  "effort": "expert",',
        "+  a third line the gate must not show",
      ]}
      onAllow={() => {}}
      onAllowSession={() => {}}
      onDeny={() => {}}
    />,
  );
  assert.ok(screen.getByText("+1"));
  assert.ok(screen.getByText("−1"));
  // Diff lines are whitespace-significant (leading "-  "/"+  " indent) —
  // check raw textContent rather than getByText's normalized matcher.
  const lines = Array.from(container.querySelectorAll(".gate .snip .ln")).map((el) => el.textContent);
  assert.deepEqual(lines, ['-  "effort": "auto",', '+  "effort": "expert",']);
});

test("write tier: no diff on the request means no stat and no snippet are invented", () => {
  const { container } = render(
    <Gate tier="write" detail="notes.md" onAllow={() => {}} onAllowSession={() => {}} onDeny={() => {}} />,
  );
  assert.equal(container.querySelector(".gate .snip") === null, true);
  assert.equal(container.querySelector(".gate .cmd .cwd") === null, true);
});

test("write tier: Trust this folder appears only when the caller provides it, and fires once", () => {
  const { rerender } = render(
    <Gate tier="write" detail="notes.md" onAllow={() => {}} onAllowSession={() => {}} onDeny={() => {}} />,
  );
  assert.equal(screen.queryByRole("button", { name: GATE_TRUST_FOLDER }) === null, true);
  let trusted = 0;
  rerender(
    <Gate
      tier="write"
      detail="notes.md"
      onAllow={() => {}}
      onAllowSession={() => {}}
      onDeny={() => {}}
      onTrustFolder={() => {
        trusted += 1;
      }}
    />,
  );
  screen.getByRole("button", { name: GATE_TRUST_FOLDER }).click();
  assert.equal(trusted, 1);
});

// —— Plan tier (violet) ——

test("plan tier: ready headline counts members and lists each as path · summary", () => {
  render(
    <Gate
      tier="plan"
      empty={false}
      members={[
        { path: "src/a.ts", summary: "Update helper" },
        { path: "src/b.ts", summary: "Create UI" },
      ]}
      onAccept={() => {}}
      onKeepPlanning={() => {}}
    />,
  );
  const gate = screen.getByRole("region", { name: planReadyTitle(2) });
  assert.ok(within(gate).getByText("src/a.ts · Update helper"));
  assert.ok(within(gate).getByText("src/b.ts · Create UI"));
  const accept = screen.getByRole("button", { name: PLAN_ACCEPT });
  assert.equal(within(accept).getByText("⏎").tagName, "KBD");
  assert.ok(screen.getByRole("button", { name: PLAN_KEEP }));
  assert.equal(screen.queryByRole("button", { name: /reject/i }) === null, true);
});

test("plan tier: empty plan uses the complete/no-changes copy and End Plan action", () => {
  render(<Gate tier="plan" empty members={[]} onAccept={() => {}} onKeepPlanning={() => {}} />);
  assert.ok(screen.getByRole("region", { name: PLAN_DOCK_EMPTY }));
  assert.ok(screen.getByRole("button", { name: PLAN_END_EMPTY }));
  assert.equal(screen.queryByRole("button", { name: PLAN_ACCEPT }) === null, true);
});

test("plan tier: settling disables Accept and shows the settling status", () => {
  render(
    <Gate tier="plan" empty={false} members={[]} settling onAccept={() => {}} onKeepPlanning={() => {}} />,
  );
  assert.ok(screen.getByRole("status"));
  assert.equal(screen.getByRole("button", { name: PLAN_ACCEPT }).hasAttribute("disabled"), true);
});

test("plan tier: a decision failure shows the error and a Try again in place of the actions", () => {
  render(
    <Gate
      tier="plan"
      empty={false}
      members={[]}
      error="Couldn’t record that plan decision. The proposal is unchanged."
      onAccept={() => {}}
      onKeepPlanning={() => {}}
    />,
  );
  assert.ok(screen.getByRole("alert"));
  assert.equal(screen.queryByRole("button", { name: PLAN_ACCEPT }) === null, true);
  assert.ok(screen.getByRole("button", { name: "Try again" }));
});

// —— Ask tier (cyan, recovery_confirmation) ——

test("ask tier: numbered options, a recommended pick, and no dismiss affordance", () => {
  let chosen: number | null = null;
  render(
    <Gate
      tier="ask"
      question="Two session stores exist. Which one should sessions v2 keep?"
      options={[
        { label: "~/.grokforge/sessions", recommended: true },
        { label: "~/.grok/sessions (vendor)" },
        { label: "Keep both, migrate later" },
      ]}
      onChoose={(i) => {
        chosen = i;
      }}
    />,
  );
  const gate = screen.getByRole("region", { name: "Grok has a question" });
  assert.ok(within(gate).getByText("Two session stores exist. Which one should sessions v2 keep?"));
  const opt1 = within(gate).getByRole("button", { name: /~\/\.grokforge\/sessions/ });
  assert.equal(within(opt1).getByText("1").tagName, "KBD");
  opt1.click();
  assert.equal(chosen, 0);
  const opt3 = within(gate).getByRole("button", { name: /Keep both, migrate later/ });
  assert.equal(within(opt3).getByText("3").tagName, "KBD");
  // W3-2: recovery_confirmation has exactly one real server action and no
  // decline param (api.editRecovery) — an "esc" hint here would either lie
  // about what Escape does (App.tsx has no per-gate recovery branch; it
  // falls through to cancelling the whole run) or invent a capability the
  // host doesn't have. No such kbd should ever render on this tier.
  assert.equal(within(gate).queryByText("esc") === null, true);
});
