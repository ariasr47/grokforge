/**
 * Runtime channel: prod (stable) vs dev (side-by-side dogfood / building Forge in Forge).
 * TST uses the same isolation as DEV (optional GROKFORGE_CHANNEL=tst).
 */
import os from "node:os";
import path from "node:path";

export type Channel = "prod" | "dev";

export function resolveChannel(
  raw = process.env.GROKFORGE_CHANNEL,
): Channel {
  const c = (raw || "prod").trim().toLowerCase();
  if (
    c === "dev" ||
    c === "development" ||
    c === "tst" ||
    c === "test" ||
    c === "qa"
  ) {
    return "dev";
  }
  return "prod";
}

export function channelLabel(ch: Channel = resolveChannel()): string {
  const raw = (process.env.GROKFORGE_CHANNEL || ch).toLowerCase();
  if (raw === "tst" || raw === "test" || raw === "qa") return "TST";
  return ch === "dev" ? "DEV" : "PROD";
}

/** Isolated app data (config, oauth, logs, connectors, chat sandbox). */
export function dataDir(ch: Channel = resolveChannel()): string {
  const base = ch === "dev" ? ".grokforge-dev" : ".grokforge";
  return path.join(os.homedir(), base);
}

export function defaultPort(ch: Channel = resolveChannel()): number {
  if (process.env.GROKFORGE_PORT) {
    const n = Number(process.env.GROKFORGE_PORT);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return ch === "dev" ? 8788 : 8787;
}

export function channelMeta() {
  const channel = resolveChannel();
  return {
    channel,
    label: channelLabel(channel),
    port: defaultPort(channel),
    dataDir: dataDir(channel),
  };
}
