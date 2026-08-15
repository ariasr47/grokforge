/**
 * Workspace-scoped config partitioning (SPEC §2.8 amendment, GATE Z ruling 2026-08-13 option A;
 * QA_REPORT.md N-1 / AC20). The prod data root stays frozen and shared. Only `recent` and
 * `lastWorkspace` are partitioned per `installIdentity()` (§2.8 rule 1's closed set). Everything
 * else — credentials, `model`, `shellAllowlist`, `mode` (SPEC §9.9 resolves it to shared
 * explicitly), `effort`, `chatRoot` and `agentId` — stays shared across every install reading the
 * same root, so the operator is never asked to sign in twice.
 *
 * This suite drives `loadConfig`/`saveConfig` with an explicit `identity` argument — the only seam
 * production code never uses (every real call site calls with zero arguments, defaulting to this
 * process's real `installIdentity()`) — so the partitioning property itself is proven without
 * needing two physically different install locations on disk.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, type HostConfig } from "./config.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "grokforge-config-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
});

const INSTALL_A = "install-a-devsrc";
const INSTALL_B = "install-b-packaged";

function withWorkspace(base: HostConfig, patch: Partial<HostConfig>): HostConfig {
  return { ...base, ...patch };
}

describe("workspace partitioning (N-1 / AC20)", () => {
  it("a fresh, never-before-seen identity starts completely empty", () => {
    const cfg = loadConfig(INSTALL_A);
    assert.equal(cfg.lastWorkspace, null);
    assert.deepEqual(cfg.recent, []);
    assert.equal(cfg.mode, "chat");
    assert.equal(cfg.chatRoot, null);
  });

  it("opening a workspace under one identity is invisible to a different identity", () => {
    const a = loadConfig(INSTALL_A);
    saveConfig(
      withWorkspace(a, {
        lastWorkspace: "C:\\Dev\\grokforge",
        recent: [{ name: "grokforge", path: "C:\\Dev\\grokforge", openedAt: 1 }],
      }),
      INSTALL_A,
    );

    // A brand new install identity — the installed app's first launch — must not see any of it.
    const b = loadConfig(INSTALL_B);
    assert.equal(b.lastWorkspace, null);
    assert.deepEqual(b.recent, []);

    // And re-reading A still returns what A saved — the partition is not a one-way clobber.
    const aAgain = loadConfig(INSTALL_A);
    assert.equal(aAgain.lastWorkspace, "C:\\Dev\\grokforge");
    assert.equal(aAgain.recent.length, 1);
  });

  it("both identities independently accumulate their own recent list without cross-contamination", () => {
    saveConfig(
      withWorkspace(loadConfig(INSTALL_A), {
        lastWorkspace: "C:\\Dev\\grokforge",
        recent: [{ name: "grokforge", path: "C:\\Dev\\grokforge", openedAt: 1 }],
      }),
      INSTALL_A,
    );
    saveConfig(
      withWorkspace(loadConfig(INSTALL_B), {
        lastWorkspace: "C:\\Users\\rodri\\qa-ws",
        recent: [{ name: "qa-ws", path: "C:\\Users\\rodri\\qa-ws", openedAt: 2 }],
      }),
      INSTALL_B,
    );

    const a = loadConfig(INSTALL_A);
    const b = loadConfig(INSTALL_B);
    assert.equal(a.lastWorkspace, "C:\\Dev\\grokforge");
    assert.equal(b.lastWorkspace, "C:\\Users\\rodri\\qa-ws");
    assert.notDeepEqual(a.recent, b.recent);
  });

  it("credentials, model, shellAllowlist, effort and agentId are shared across identities", () => {
    saveConfig(
      withWorkspace(loadConfig(INSTALL_A), {
        apiKey: "sk-shared-secret",
        model: "grok-4-fast",
        shellAllowlist: false,
        effort: "heavy",
        agentId: "grok-acp",
      }),
      INSTALL_A,
    );

    const b = loadConfig(INSTALL_B);
    assert.equal(b.apiKey, "sk-shared-secret");
    assert.equal(b.model, "grok-4-fast");
    assert.equal(b.shellAllowlist, false);
    assert.equal(b.effort, "heavy");
    // ...but B's own workspace fields remain untouched by A's save.
    assert.equal(b.lastWorkspace, null);
    assert.deepEqual(b.recent, []);
  });

  it("mode and chatRoot are shared, NOT partitioned (SPEC §9.9 / §2.8 rule 1's closed set)", () => {
    saveConfig(
      withWorkspace(loadConfig(INSTALL_A), {
        mode: "code",
        chatRoot: "C:\\Dev\\grokforge\\chat",
      }),
      INSTALL_A,
    );

    // Unlike lastWorkspace/recent, mode and chatRoot ARE visible to a different identity —
    // §2.8 rule 1 names only `workspace` and `recent` as the partitioned closed set; §9.9 resolves
    // `mode` to shared explicitly, and chatRoot falls to rule 2's "every other field" by omission.
    const b = loadConfig(INSTALL_B);
    assert.equal(b.mode, "code");
    assert.equal(b.chatRoot, "C:\\Dev\\grokforge\\chat");
  });

  it("the workspace store lives under the host data root, not the install tree", () => {
    saveConfig(withWorkspace(loadConfig(INSTALL_A), { lastWorkspace: "C:\\x" }), INSTALL_A);
    const storePath = path.join(home, ".grokforge", "workspaces.json");
    assert.equal(fs.existsSync(storePath), true);
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
      installs: Record<string, unknown>;
    };
    assert.ok(Object.prototype.hasOwnProperty.call(raw.installs, INSTALL_A));
  });

  it("a corrupt workspaces.json degrades every identity to empty rather than throwing", () => {
    fs.mkdirSync(path.join(home, ".grokforge"), { recursive: true });
    fs.writeFileSync(path.join(home, ".grokforge", "workspaces.json"), "{not json", "utf8");
    const cfg = loadConfig(INSTALL_A);
    assert.equal(cfg.lastWorkspace, null);
    assert.deepEqual(cfg.recent, []);
  });
});
