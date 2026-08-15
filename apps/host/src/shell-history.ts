/**
 * The prior-conversation signal's durable store (SPEC §2.8, §9.1; INTERFACE_CONTRACT.md).
 *
 * GATE PLAN decision (desktop-self-host D1): a JSON file under the HOST data root, keyed by the
 * exact `Origin` request header of the shell that ran the prompt. Two contract properties depend
 * on those two choices:
 *   1. it OUTLIVES the WebView2 localStorage partition — the store is not inside it (AC12d);
 *   2. it is ATTRIBUTABLE to the requesting shell — the dev browser shell (http://localhost:5173)
 *      and the installed app (http://tauri.localhost) are different keys, so the installed app's
 *      genuine first launch reports false even on a machine whose dev shell has years of history
 *      against the same data root (AC12e).
 * A bare "a prompt once ran on this machine" flag is disqualified: it passes AC12b and fails AC12e.
 *
 * Only allowlisted origins can ever reach here — the origin gate in index.ts runs first — so the key
 * space is the compile-time allowlist (1 key in prod, 5 in dev), not attacker-controlled.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./channel.js";

interface ShellRecord {
  conversations: number;
  firstAt: number;
  lastAt: number;
}
interface ShellHistory {
  version: 1;
  shells: Record<string, ShellRecord>;
}

const EMPTY: ShellHistory = { version: 1, shells: {} };

export function shellHistoryPath(): string {
  return path.join(dataDir(), "shells.json");
}

function read(): ShellHistory {
  try {
    const raw = fs.readFileSync(shellHistoryPath(), "utf8");
    const parsed = JSON.parse(raw) as ShellHistory;
    if (!parsed || typeof parsed !== "object" || typeof parsed.shells !== "object") {
      return { ...EMPTY };
    }
    return { version: 1, shells: parsed.shells ?? {} };
  } catch {
    // Missing, empty or corrupt: a first run, never a throw. A 500 on /api/state would be a worse
    // failure than a false negative here.
    return { ...EMPTY };
  }
}

function normalize(origin: string | string[] | null | undefined): string | null {
  const value = Array.isArray(origin) ? undefined : origin;
  if (value == null || value === "") return null; // native probe / conformance runner: not a shell
  return value;
}

/** True when this exact requesting shell has completed at least one conversation on this engine. */
export function hasPriorConversations(origin: string | string[] | null | undefined): boolean {
  const key = normalize(origin);
  if (key == null) return false;
  return (read().shells[key]?.conversations ?? 0) > 0;
}

/**
 * Called when a prompt run STARTED BY THIS ORIGIN reaches `done` (a completed conversation). A run
 * that ends in `error` does not count. Atomic tmp+rename so a crash mid-write cannot corrupt it.
 */
export function recordCompletedConversation(origin: string | string[] | null | undefined): void {
  const key = normalize(origin);
  if (key == null) return;
  const store = read();
  const now = Date.now();
  const prev = store.shells[key];
  store.shells[key] = {
    conversations: (prev?.conversations ?? 0) + 1,
    firstAt: prev?.firstAt ?? now,
    lastAt: now,
  };
  const target = shellHistoryPath();
  const tmp = `${target}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch {
    /* best effort: never take the engine down over the signal's store */
  }
}
