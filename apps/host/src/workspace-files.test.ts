import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { listWorkspaceFiles } from "./workspace-files.js";

describe("listWorkspaceFiles", () => {
  it("includes a late-tree path even when many files walk first", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gf-files-"));
    try {
      await fs.mkdir(path.join(root, "aaa", "pad"), { recursive: true });
      await fs.mkdir(path.join(root, "docs", "dogfood"), { recursive: true });
      const writes = [];
      for (let i = 0; i < 850; i++) {
        writes.push(fs.writeFile(path.join(root, "aaa", "pad", `f-${i}.txt`), "x"));
      }
      writes.push(fs.writeFile(path.join(root, "docs", "dogfood", "KEEP.md"), "KEEP"));
      await Promise.all(writes);
      const files = await listWorkspaceFiles(root);
      assert.ok(
        files.includes("docs/dogfood/KEEP.md"),
        `KEEP.md missing from ${files.length} paths`,
      );
      assert.ok(files.length > 850);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
