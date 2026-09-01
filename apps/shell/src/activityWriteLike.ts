function toolName(a: { name?: string | null; title?: string | null }): string {
  return `${a.name || ""} ${a.title || ""}`.replace(/[_-]+/g, " ").trim().toLowerCase();
}

/** File tools that inspect content must not count as File changes / View diff. */
export function activityIsReadLike(a: {
  name?: string | null;
  title?: string | null;
}): boolean {
  const n = toolName(a);
  if (/^(write|edit|search replace|str replace|replace)\b/.test(n)) return false;
  return /^(read|grep|glob|find|ls|list dir)\b/.test(n);
}

export function activityLooksLikeWrite(a: {
  editId?: string | null;
  kind?: string | null;
  name?: string | null;
  title?: string | null;
}): boolean {
  if (activityIsReadLike(a)) return false;
  const n = toolName(a);
  if (/^(write|edit|search replace|str replace|replace)\b/.test(n)) return true;
  if (a.editId) return true;
  if (a.kind === "edit") return true;
  return false;
}

/** Grok TUI session plan.md lives under ~/.grok/sessions — not a workspace File change. */
export function activityIsVendorSessionPlan(a: { path?: string | null }): boolean {
  const p = (a.path || "").replace(/\\/g, "/").toLowerCase();
  if (!p.endsWith("plan.md")) return false;
  return p.includes("/.grok/sessions/") || p.includes("/.grokforge/");
}

export const VENDOR_SESSION_PLAN_CAPTION = "session plan.md";

/** Quiet label for TUI session plan.md; other paths pass through. */
export function quietActivityPath(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string") return value;
  return activityIsVendorSessionPlan({ path: value }) ? VENDOR_SESSION_PLAN_CAPTION : value;
}
