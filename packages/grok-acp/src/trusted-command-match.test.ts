import test from "node:test";
import assert from "node:assert/strict";
import { matchTrustedCommandClass } from "./trusted-command-match.js";

const saved = new Set(["npm", "npx", "cargo", "git:status", "git:diff", "git:log", "git:show"]);

const cases: Array<[string, string | null]> = [
  ["npm test", "npm"],
  ["npm.cmd test", "npm"],
  ['"npm" test', "npm"],
  ["npx cowsay hi", "npx"],
  ["cargo test", "cargo"],
  ["git show HEAD", "git:show"],
  ["git status -sb", "git:status"],
  ["git diff --name-only", "git:diff"],
  ["git log --all", "git:log"],
  // W1: global options — first arg is not the verb → non-match
  ["git --no-pager status", null],
  ["git -C . diff", null],
  ["git push --force", null],
  ["git", null],
  // multi-statement / chain
  ["npm test && echo x", null],
  ["npm test || echo x", null],
  ["npm test & echo x", null],
  ["npm test | more", null],
  ["npm test\ndel /s /q C:\\", null],
  ["npm test\r\necho x", null],
  // off-list leading
  ["python -V", null],
  ["", null],
];

for (const [cmd, expect] of cases) {
  test(`match: ${JSON.stringify(cmd)} → ${expect}`, () => {
    assert.equal(matchTrustedCommandClass(cmd, saved), expect);
  });
}

test("empty saved set never matches", () => {
  assert.equal(matchTrustedCommandClass("npm test", new Set()), null);
});
