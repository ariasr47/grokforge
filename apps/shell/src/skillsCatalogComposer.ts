import type { CodeAgentFact, ProductMode, SkillsCatalogFact } from "./api";

export const SKILLS_TITLE = "Skills";
export const SKILLS_CHECKING = "Checking skills…";
export const SKILLS_EMPTY = "No skills from Grok Code";
export const SKILLS_FAILED = "Couldn't load skills.";
export const SKILLS_NO_MATCHES = "No matches";
export const SKILLS_RECONNECT = "Reconnect to confirm skills.";
export const SKILLS_ARMED = (name: string) => `Skill · ${name}`;
export const SKILLS_ARMED_TITLE = (name: string) =>
  `Skill · ${name} — will send ${name}`;
export const SKILLS_SENT = (name: string) => `Skill · ${name} sent`;
export const SKILLS_UNAVAILABLE = "Skill no longer available.";

export type SkillsPaletteProjection =
  | { state: "absent" }
  | { state: "checking"; reconnectHint: boolean }
  | { state: "ready"; commands: Array<{ name: string; description: string | null }> }
  | { state: "empty" }
  | { state: "failed" };

export function projectSkillsPalette(input: {
  mode?: ProductMode | string | null;
  codeAgent?: CodeAgentFact | null;
  skillsCatalog?: SkillsCatalogFact | null;
}): SkillsPaletteProjection {
  if (input.mode !== "code") return { state: "absent" };
  if (input.codeAgent?.identity !== "vendor") return { state: "absent" };
  const cat = input.skillsCatalog;
  if (!cat || cat.disposition === "absent_non_vendor") return { state: "absent" };
  if (cat.disposition === "awaiting_first_valid") {
    return { state: "checking", reconnectHint: false };
  }
  if (cat.disposition === "obtain_failed") return { state: "failed" };
  if (cat.disposition === "ready") {
    if (!cat.commands || cat.commands.length === 0) return { state: "empty" };
    return { state: "ready", commands: cat.commands.slice() };
  }
  return { state: "absent" };
}

export function shouldClearArmedInvocation(projection: SkillsPaletteProjection): boolean {
  return projection.state !== "ready";
}

export function filterSkillCommands(
  commands: Array<{ name: string; description: string | null }>,
  filterAfterSlash: string,
): Array<{ name: string; description: string | null }> {
  const needle = filterAfterSlash.toLowerCase();
  if (!needle) return commands;
  return commands.filter(
    (c) =>
      c.name.toLowerCase().includes(needle) ||
      (c.description?.toLowerCase().includes(needle) ?? false),
  );
}

export function composeArmedPromptText(armedName: string, draft: string): string {
  const trimmed = draft.trimStart();
  const withoutFilter = trimmed.startsWith("/")
    ? trimmed.replace(/^[^\s]+/, "").trimStart()
    : trimmed;
  return withoutFilter ? `${armedName} ${withoutFilter}` : armedName;
}

export function slashTokenFilter(draft: string, selectionStart: number): string {
  const before = draft.slice(0, selectionStart);
  const token = before.match(/(?:^|\s)(\/[^\s]*)$/);
  return token ? token[1]!.slice(1) : "";
}

export function mayOpenSkillsPalette(
  projection: SkillsPaletteProjection,
  draft: string,
  selectionStart: number,
): boolean {
  if (projection.state === "absent") return false;
  const before = draft.slice(0, selectionStart);
  const token = before.match(/(?:^|\s)(\/[^\s]*)$/);
  return Boolean(token);
}

export function stripLeadingSlashToken(draft: string, selectionStart: number): string {
  const before = draft.slice(0, selectionStart);
  const after = draft.slice(selectionStart);
  return `${before.replace(/(^|\s)\/[^\s]*$/, "$1")}${after}`;
}
