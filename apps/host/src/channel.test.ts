import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { dataDir } from "./channel.js";

test("absolute GROKFORGE_DATA_DIR isolates all host state", () => {
  const old = process.env.GROKFORGE_DATA_DIR;
  try { process.env.GROKFORGE_DATA_DIR = path.resolve(".tmp-host-isolation"); assert.equal(dataDir(), path.resolve(".tmp-host-isolation")); }
  finally { if (old === undefined) delete process.env.GROKFORGE_DATA_DIR; else process.env.GROKFORGE_DATA_DIR = old; }
});
