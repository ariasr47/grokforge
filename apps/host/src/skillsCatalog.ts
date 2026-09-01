export type SkillsCatalogCommand = {
  name: string;
  description: string | null;
};

export type SkillsCatalogFact = {
  disposition:
    | "absent_non_vendor"
    | "awaiting_first_valid"
    | "ready"
    | "obtain_failed";
  commands: SkillsCatalogCommand[] | null;
};

export const ABSENT_NON_VENDOR: SkillsCatalogFact = {
  disposition: "absent_non_vendor",
  commands: null,
};

export function enterAwaiting(prior: SkillsCatalogFact): SkillsCatalogFact {
  if (prior.disposition === "obtain_failed") return prior;
  return { disposition: "awaiting_first_valid", commands: null };
}

export function applyValidCommands(
  _prior: SkillsCatalogFact,
  commands: SkillsCatalogCommand[],
): SkillsCatalogFact {
  return { disposition: "ready", commands: commands.slice() };
}

export function ignoreMalformed(prior: SkillsCatalogFact): SkillsCatalogFact {
  if (prior.disposition === "ready" && prior.commands) return prior;
  return { disposition: "obtain_failed", commands: null };
}

export function markObtainFailed(prior: SkillsCatalogFact): SkillsCatalogFact {
  if (prior.disposition === "ready" && prior.commands) return prior;
  return { disposition: "obtain_failed", commands: null };
}

/** Stdio/session disconnect — AC12 withhold. Distinct from obtain-timer keep-ready. */
export function markTransportDisconnect(_prior: SkillsCatalogFact): SkillsCatalogFact {
  return { disposition: "awaiting_first_valid", commands: null };
}

export function clearToAbsent(_prior: SkillsCatalogFact): SkillsCatalogFact {
  return ABSENT_NON_VENDOR;
}

/** ACP advertises `name` without a leading slash; Forge palettes/handoff use `/name`. */
export function normalizeAvailableCommandName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length < 2) return null;
  if (/\s/.test(withSlash)) return null;
  return withSlash;
}

export function parseAvailableCommands(raw: unknown): SkillsCatalogCommand[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SkillsCatalogCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = normalizeAvailableCommandName((item as { name?: unknown }).name);
    if (!name) continue;
    const description = (item as { description?: unknown }).description;
    out.push({
      name,
      description: typeof description === "string" ? description : null,
    });
  }
  if (raw.length > 0 && out.length === 0) return null;
  return out;
}

export function firstToken(text: string): string {
  const trimmed = text.trimStart();
  const m = trimmed.match(/^[^\s]+/);
  return m ? m[0]! : "";
}
