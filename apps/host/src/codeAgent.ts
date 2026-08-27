import path from "node:path";

export type CodeAgentFact = {
  resolveStatus: "resolving" | "ready" | "hard_fail";
  identity: "vendor" | "fallback" | "hard_fail" | null;
  fallbackReason: "cli_missing" | "spawn_failed" | null;
};

export type CodeRunAgentProvenance = {
  identity: "vendor" | "fallback";
  fallbackReason: "cli_missing" | "spawn_failed" | null;
};

export function stampCodeAgentFact(
  input:
    | { kind: "resolving" }
    | { kind: "vendor" }
    | { kind: "cli_missing" }
    | { kind: "spawn_failed" }
    | { kind: "hard_fail" },
): CodeAgentFact {
  switch (input.kind) {
    case "resolving":
      return { resolveStatus: "resolving", identity: null, fallbackReason: null };
    case "vendor":
      return { resolveStatus: "ready", identity: "vendor", fallbackReason: null };
    case "cli_missing":
      return { resolveStatus: "ready", identity: "fallback", fallbackReason: "cli_missing" };
    case "spawn_failed":
      return { resolveStatus: "ready", identity: "fallback", fallbackReason: "spawn_failed" };
    case "hard_fail":
      return { resolveStatus: "hard_fail", identity: "hard_fail", fallbackReason: null };
  }
}

export function resolveVendorCliPath(input: {
  platform: string;
  pathEnv: string;
  pathExt?: string;
  isFile: (absolutePath: string) => boolean;
}): string | null {
  const sep = input.platform === "win32" ? ";" : ":";
  const dirs = input.pathEnv.split(sep).filter(Boolean);
  const names =
    input.platform === "win32"
      ? ["grok.exe", "grok"]
      : ["grok"];
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (input.isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Strip host token inject — ambient OS key inheritance is not a substitute. */
export function vendorSpawnEnv(
  base: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === "XAI_API_KEY" || k === "GROK_API_KEY") continue;
    out[k] = v;
  }
  return out;
}
