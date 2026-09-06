/** Vendor grok agent sometimes journals TUI `<system-reminder>` into the vouched answer. */
export function stripVendorSystemReminders(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const INTENT_LEAD =
  /^(I'll|I will|I am going to|I'm going to|Let me|Creating|Overwriting|Writing|Updating|Adding)\b/i;
const RUN_INTENT =
  /^(I'll|I will|I am going to|I'm going to|Let me)\b.{0,120}\b(run|running|execute|echo)\b/i;
const ROOT_RETRY =
  /^(The first (run|command)|I'll rerun)\b.{0,200}\b(workspace root|repo root)\b/i;
const WAIT_THEN_COUNTS =
  /^(The test\b|The run is still going\b|I'll wait\b|I will wait\b).{0,240}\b(wait|running|finish|runner)\b/i;
const RESULT_COUNTS =
  /\b\d+\s+pass\b|\bpass\s+\d+\b|\bExit code:\s*\d+\b/i;
const INSPECT_PREAMBLE =
  /^(I'll inspect|I will inspect|I'll read|I will read|I'll look|I have the\b[\s\S]{0,100}\b(layout|config|setup)\b|Next I'll write)\b/i;
const PLAN_DELIVERABLE =
  /\b(step plan|out of scope|STEPS-VISIBLE-OK)\b|^\d+\.\s/m;
const RUNNING_THEN_COUNTS =
  /^Running\b.{0,240}\b(test|command|specified|check|typecheck)\b/i;
const BARE_EXIT = /^\d+$/;
const PATH_TOKEN = /(?:[\w.-]+\/)+[\w.-]+\.\w+/g;

function pathsIn(text: string): string[] {
  return (text.match(PATH_TOKEN) ?? []).map((p) => p.replace(/\\/g, "/"));
}

/** Drop a short "I'll create…" lead-in when a later paragraph already names the same path. */
export function collapseIntentThenDoneParagraphs(text: string): string {
  const paras = text.split(/\n\n+/);
  if (paras.length < 2) return text;
  const kept: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    const trimmed = paras[i].trim();
    if (trimmed.length > 280) {
      kept.push(paras[i]);
      continue;
    }
    const later = paras.slice(i + 1);
    const laterHasBody = later.some((p) => p.trim().length > 0);
    if (ROOT_RETRY.test(trimmed) && laterHasBody) continue;
    if (WAIT_THEN_COUNTS.test(trimmed) && later.some((p) => RESULT_COUNTS.test(p))) continue;
    if (INSPECT_PREAMBLE.test(trimmed) && later.some((p) => PLAN_DELIVERABLE.test(p))) continue;
    if (
      RUNNING_THEN_COUNTS.test(trimmed) &&
      later.some((p) => RESULT_COUNTS.test(p) || BARE_EXIT.test(p.trim()))
    ) {
      continue;
    }
    if (!INTENT_LEAD.test(trimmed)) {
      kept.push(paras[i]);
      continue;
    }
    const paths = pathsIn(trimmed);
    const laterCovers =
      paths.length > 0 && later.some((p) => paths.every((path) => p.includes(path)));
    if (laterCovers || (RUN_INTENT.test(trimmed) && laterHasBody)) continue;
    kept.push(paras[i]);
  }
  return kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function cleanVendorAnswer(text: string): string {
  return collapseIntentThenDoneParagraphs(stripVendorSystemReminders(text));
}
