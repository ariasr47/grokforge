import { quietActivityPath } from "./activityWriteLike";

export type ActivityLabelFields = {
  title?: string | null;
  summary?: string | null;
  name?: string | null;
};

function present(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Human-readable tool row label. Never invents a prose headline. */
export function activityHumanLabel(fields: ActivityLabelFields): string | null {
  return present(fields.title) ?? present(fields.summary) ?? present(fields.name);
}

const GENERIC_TOOL_NAMES = new Set([
  "tool",
  "run shell",
  "run terminal command",
  "bash",
  "shell",
  "execute",
  "terminal",
  "command",
]);

export function isGenericToolName(name: string | null | undefined): boolean {
  const n = present(name)?.toLowerCase().replace(/_/g, " ") ?? "";
  return !n || GENERIC_TOOL_NAMES.has(n);
}

/** Vendor Grok TUI tools that Forge does not run. Do not invent an engine. */
export function isForgeUnavailableVendorTool(name: string | null | undefined): boolean {
  const n = present(name)?.toLowerCase().replace(/_/g, " ") ?? "";
  return n === "get command or subagent output";
}

function commandFromExecuteCopy(value: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^Execute\s+`([^`]+)`\s*$/i);
  return match?.[1]?.trim() || null;
}

export function toolRowCaption(fields: {
  name?: string | null;
  title?: string | null;
  summary?: string | null;
  command?: string | null;
}): { name: string; summary: string; plain: boolean } {
  const title = quietActivityPath(fields.title) ?? fields.title;
  const summaryField = quietActivityPath(fields.summary) ?? fields.summary;
  const command =
    present(fields.command) ??
    commandFromExecuteCopy(present(title)) ??
    commandFromExecuteCopy(present(summaryField));
  if (command && isGenericToolName(fields.name)) {
    return { name: command, summary: "", plain: true };
  }
  const displayName = (fields.name ?? "tool").replace(/_/g, " ") || "tool";
  const human = activityHumanLabel({
    title,
    summary: summaryField,
    name: null,
  });
  const summary = human && human !== displayName ? human : "";
  return { name: displayName, summary, plain: false };
}
