import test from "node:test";
import assert from "node:assert/strict";
import type { CodeAgentFact, SkillsCatalogFact } from "./api";
import {
  SKILLS_ARMED,
  SKILLS_ARMED_TITLE,
  SKILLS_CHECKING,
  SKILLS_EMPTY,
  SKILLS_FAILED,
  SKILLS_NO_MATCHES,
  SKILLS_RECONNECT,
  SKILLS_SENT,
  SKILLS_TITLE,
  SKILLS_UNAVAILABLE,
  composeArmedPromptText,
  filterSkillCommands,
  mayOpenSkillsPalette,
  projectSkillsPalette,
  shouldClearArmedInvocation,
  slashTokenAt,
  slashTokenFilter,
  stripLeadingSlashToken,
} from "./skillsCatalogComposer";

const vendor: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "vendor",
  fallbackReason: null,
};
const fallback: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "fallback",
  fallbackReason: "cli_missing",
};
const hardFail: CodeAgentFact = {
  resolveStatus: "hard_fail",
  identity: "hard_fail",
  fallbackReason: null,
};

const fixtureCmd = { name: "/forge-skill-fixture", description: "Forge skill fixture" };
const ready: SkillsCatalogFact = {
  disposition: "ready",
  commands: [fixtureCmd],
};

const copyBlob = [
  SKILLS_TITLE,
  SKILLS_CHECKING,
  SKILLS_EMPTY,
  SKILLS_FAILED,
  SKILLS_NO_MATCHES,
  SKILLS_RECONNECT,
  SKILLS_ARMED("/forge-skill-fixture"),
  SKILLS_ARMED_TITLE("/forge-skill-fixture"),
  SKILLS_SENT("/forge-skill-fixture"),
  SKILLS_UNAVAILABLE,
].join("\n");

test("Chat / Mini-Grok / hard_fail never project a Skills palette", () => {
  assert.equal(
    projectSkillsPalette({
      mode: "chat",
      codeAgent: null,
      skillsCatalog: ready,
    }).state,
    "absent",
  );
  assert.equal(
    projectSkillsPalette({
      mode: "code",
      codeAgent: fallback,
      skillsCatalog: ready,
    }).state,
    "absent",
  );
  assert.equal(
    projectSkillsPalette({
      mode: "code",
      codeAgent: hardFail,
      skillsCatalog: ready,
    }).state,
    "absent",
  );
  assert.equal(
    projectSkillsPalette({
      mode: "code",
      codeAgent: vendor,
      skillsCatalog: { disposition: "absent_non_vendor", commands: null },
    }).state,
    "absent",
  );
  assert.equal(
    projectSkillsPalette({
      mode: "code",
      codeAgent: vendor,
      skillsCatalog: undefined,
    }).state,
    "absent",
  );
});

test("awaiting_first_valid is Checking skills… — not empty success", () => {
  const p = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: { disposition: "awaiting_first_valid", commands: null },
  });
  assert.equal(p.state, "checking");
  if (p.state === "checking") assert.equal(p.reconnectHint, false);
  assert.notEqual(p.state, "empty");
  assert.notEqual(p.state, "ready");
});

test("ready + [] is No skills from Grok Code empty — not failed", () => {
  const p = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: { disposition: "ready", commands: [] },
  });
  assert.equal(p.state, "empty");
});

test("obtain_failed is Couldn't load skills. — not empty", () => {
  const p = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: { disposition: "obtain_failed", commands: null },
  });
  assert.equal(p.state, "failed");
});

test("ready lists only voucher names — no invented extras", () => {
  const p = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: ready,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") throw new Error("expected ready");
  assert.deepEqual(p.commands, [fixtureCmd]);
  assert.equal(p.commands.some((c) => c.name === "/invented"), false);
});

test("mixed ready voucher lists every accepted /name — junk absent", () => {
  const p = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: {
      disposition: "ready",
      commands: [
        { name: "/a", description: null },
        { name: "/b", description: "bee" },
      ],
    },
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") throw new Error("expected ready");
  assert.deepEqual(
    p.commands.map((c) => c.name),
    ["/a", "/b"],
  );
  assert.equal(p.commands.some((c) => c.name === "no-slash"), false);
  assert.equal(shouldClearArmedInvocation(p), false);
});

test("ready→ready shrink still projects replace list; does not invent chip-clear rule", () => {
  const shrunk = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: {
      disposition: "ready",
      commands: [{ name: "/keep", description: null }],
    },
  });
  assert.equal(shrunk.state, "ready");
  if (shrunk.state !== "ready") throw new Error("expected ready");
  assert.deepEqual(shrunk.commands.map((c) => c.name), ["/keep"]);
  // Shipped rule: clear only when projection is not ready.
  assert.equal(shouldClearArmedInvocation(shrunk), false);
});

test("unconfirmed/offline awaiting withholds armable rows", () => {
  const p = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: { disposition: "awaiting_first_valid", commands: null },
  });
  assert.equal(p.state, "checking");
  assert.equal(shouldClearArmedInvocation(p), true);
});

test("shouldClearArmedInvocation on non-ready including fallback absence", () => {
  assert.equal(
    shouldClearArmedInvocation(
      projectSkillsPalette({ mode: "code", codeAgent: fallback, skillsCatalog: ready }),
    ),
    true,
  );
  assert.equal(
    shouldClearArmedInvocation(
      projectSkillsPalette({ mode: "code", codeAgent: vendor, skillsCatalog: ready }),
    ),
    false,
  );
});

test("composeArmedPromptText first token is the armed name", () => {
  assert.equal(composeArmedPromptText("/forge-skill-fixture", ""), "/forge-skill-fixture");
  assert.equal(
    composeArmedPromptText("/forge-skill-fixture", "/fil leftover args"),
    "/forge-skill-fixture leftover args",
  );
  assert.equal(
    composeArmedPromptText("/forge-skill-fixture", "please run"),
    "/forge-skill-fixture please run",
  );
  assert.equal(
    composeArmedPromptText("/forge-skill-fixture", "/forge-skill-fixture"),
    "/forge-skill-fixture",
  );
});

test("slash token filter and palette-open predicate", () => {
  const readyP = projectSkillsPalette({
    mode: "code",
    codeAgent: vendor,
    skillsCatalog: ready,
  });
  assert.equal(mayOpenSkillsPalette(readyP, "/", 1), true);
  assert.equal(mayOpenSkillsPalette(readyP, "hello /fo", 9), true);
  assert.equal(mayOpenSkillsPalette(readyP, "hello", 5), false);
  assert.equal(mayOpenSkillsPalette({ state: "absent" }, "/", 1), false);
  assert.equal(slashTokenFilter("/forge", 6), "forge");
  assert.equal(slashTokenFilter("x /ab", 5), "ab");
  assert.equal(mayOpenSkillsPalette(readyP, "/session-info", 0), true);
  assert.equal(slashTokenFilter("/session-info", 0), "session-info");
  assert.equal(slashTokenAt("/session-info", 0), "/session-info");
  assert.equal(stripLeadingSlashToken("/session-info", 0), "");
});

test("filterSkillCommands matches name or vouched description", () => {
  const rows = [
    fixtureCmd,
    { name: "/other", description: null },
  ];
  assert.deepEqual(filterSkillCommands(rows, "forge"), [fixtureCmd]);
  assert.deepEqual(filterSkillCommands(rows, "FIXTURE"), [fixtureCmd]);
  assert.deepEqual(filterSkillCommands(rows, "zzz"), []);
  assert.deepEqual(filterSkillCommands(rows, ""), rows);
});

test("locked copy and banned Started / before-it-thinks strings", () => {
  assert.equal(SKILLS_TITLE, "Skills");
  assert.equal(SKILLS_CHECKING, "Checking skills…");
  assert.equal(SKILLS_EMPTY, "No skills from Grok Code");
  assert.equal(SKILLS_FAILED, "Couldn't load skills.");
  assert.equal(SKILLS_NO_MATCHES, "No matches");
  assert.equal(SKILLS_RECONNECT, "Reconnect to confirm skills.");
  assert.equal(SKILLS_ARMED("/x"), "Skill · /x");
  assert.equal(SKILLS_ARMED_TITLE("/x"), "Skill · /x — will send /x");
  assert.equal(SKILLS_SENT("/x"), "Skill · /x sent");
  assert.equal(SKILLS_UNAVAILABLE, "Skill no longer available.");
  assert.equal(copyBlob.includes("Started ·"), false);
  assert.equal(/before it thinks/i.test(copyBlob), false);
});

test("Skills copy has no skip-count / partially-loaded / malformed-ignored trophy", () => {
  assert.equal(/partially loaded/i.test(copyBlob), false);
  assert.equal(/skip-count|skipped \d+/i.test(copyBlob), false);
  assert.equal(/malformed ignored/i.test(copyBlob), false);
  assert.equal(SKILLS_FAILED, "Couldn't load skills.");
  assert.equal(SKILLS_EMPTY, "No skills from Grok Code");
  assert.equal(SKILLS_CHECKING, "Checking skills…");
  assert.equal(SKILLS_UNAVAILABLE, "Skill no longer available.");
});
