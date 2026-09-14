import test from "node:test";
import assert from "node:assert/strict";
// Catalog-pin tests cover grok-acp Trusted match, not a Forge Git UI.
import { matchTrustedCommandClass } from "./trusted-command-match.js";

test("Trusted catalog still excludes bare git and gh (git-review observe must not expand)", () => {
  const allVerification = new Set([
    "npm", "npx", "cargo", "git:status", "git:diff", "git:log", "git:show",
  ]);
  assert.equal(matchTrustedCommandClass("git", allVerification), null);
  assert.equal(matchTrustedCommandClass("git status", allVerification), "git:status");
  assert.equal(matchTrustedCommandClass("gh pr view", allVerification), null);
  assert.equal(matchTrustedCommandClass("gh", allVerification), null);
});

test("force-push never matches a Trusted class even with all verification git saved", () => {
  const allVerification = new Set([
    "npm", "npx", "cargo", "git:status", "git:diff", "git:log", "git:show",
  ]);
  assert.equal(matchTrustedCommandClass("git push --force", allVerification), null);
  assert.equal(matchTrustedCommandClass("git push --force-with-lease", allVerification), null);
  assert.equal(matchTrustedCommandClass("git push origin HEAD", allVerification), null);
});
