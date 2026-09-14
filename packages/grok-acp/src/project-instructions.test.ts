import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// Project-instruction resolver is grok-acp host-read AGENTS.md, not a Forge skills catalog.
import {
  resolveProjectInstructions,
  composeSystemWithRecipe,
  inclusionFromStatus,
  PROJECT_INSTRUCTIONS_MAX_BYTES,
} from "./project-instructions.js";

async function withRoot(fn: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-"));
  try { await fn(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("AGENTS.md non-empty → present", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Rule A\n", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.status, "present");
    assert.equal(snap.path, "AGENTS.md");
    assert.match(snap.body, /Rule A/);
  });
});

test("CLAUDE.md only → present CLAUDE.md", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "CLAUDE.md"), "Claude rules\n", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.path, "CLAUDE.md");
  });
});

test("both files → AGENTS.md wins, no merge", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "A", "utf8");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "C", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.path, "AGENTS.md");
    assert.equal(snap.body.includes("C"), false);
  });
});

test("empty/whitespace/BOM AGENTS.md continues to CLAUDE.md", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "\uFEFF  \n\t  ", "utf8");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "From Claude", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.status, "present");
    assert.equal(snap.path, "CLAUDE.md");
  });
});

test("all empty/missing → absent path null", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "AGENTS.md"), "   ", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.status, "absent");
    assert.equal(snap.path, null);
  });
});

test("oversize AGENTS.md → failed stop, no CLAUDE fallthrough", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "AGENTS.md"), " ".repeat(PROJECT_INSTRUCTIONS_MAX_BYTES), "utf8");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "should-not-win", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.status, "failed");
    assert.equal(snap.path, "AGENTS.md");
    assert.equal(snap.body, "");
  });
});

test("binary/null-byte AGENTS.md → failed stop", async () => {
  await withRoot(async (root) => {
    await fs.writeFile(path.join(root, "AGENTS.md"), Buffer.from([0x41, 0x00, 0x42]));
    await fs.writeFile(path.join(root, "CLAUDE.md"), "nope", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.status, "failed");
    assert.equal(snap.path, "AGENTS.md");
  });
});

test("unreadable AGENTS.md directory → failed stop, no CLAUDE fallthrough", async () => {
  await withRoot(async (root) => {
    await fs.mkdir(path.join(root, "AGENTS.md"));
    await fs.writeFile(path.join(root, "CLAUDE.md"), "should-not-win", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.status, "failed");
    assert.equal(snap.path, "AGENTS.md");
    assert.equal(snap.body, "");
  });
});

test("nested subdirectory AGENTS.md ignored", async () => {
  await withRoot(async (root) => {
    await fs.mkdir(path.join(root, "pkg"));
    await fs.writeFile(path.join(root, "pkg", "AGENTS.md"), "nested", "utf8");
    const snap = await resolveProjectInstructions(root);
    assert.equal(snap.status, "absent");
  });
});

test("composeSystemWithRecipe delimited grammar oracle", () => {
  const out = composeSystemWithRecipe("BASE", {
    status: "present",
    path: "AGENTS.md",
    body: "Body",
  });
  assert.equal(out, "BASE\n\n## Project instructions (`AGENTS.md`)\n\nBody\n");
  assert.equal(composeSystemWithRecipe("BASE", { status: "absent", path: null, body: "" }), "BASE");
  assert.equal(inclusionFromStatus("present"), "included");
  assert.equal(inclusionFromStatus("absent"), "not_included");
  assert.equal(inclusionFromStatus("failed"), "failed");
});

test("symlink/junction escape is not a successful recipe source", async () => {
  await withRoot(async (root) => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-out-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.md");
      await fs.writeFile(outsideFile, "OUTSIDE SECRET BODY\n", "utf8");
      const agentsPath = path.join(root, "AGENTS.md");
      try {
        await fs.symlink(outsideFile, agentsPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows file-symlink creation often requires Developer Mode / elevation.
        // Document the skip; do not mock the confinement check.
        if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
          assert.ok(true, `symlink creation skipped (${code})`);
          return;
        }
        throw error;
      }
      const snap = await resolveProjectInstructions(root);
      assert.notEqual(snap.status, "present");
      assert.equal(snap.body.includes("OUTSIDE SECRET BODY"), false);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
