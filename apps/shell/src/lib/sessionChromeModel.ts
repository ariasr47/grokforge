/** Header/footer model id. After reload, session.appliedModel is null and
 *  session.model is the config default (`grok-4-fast`) while the last run's
 *  YOU line still has the applied id (`grok-4-fast-non-reasoning`). Prefer
 *  that last-run id so chrome matches the transcript. */
export function sessionChromeModel(opts: {
  appliedModel?: string | null;
  lastRunAppliedModel?: string | null;
  sessionModel?: string | null;
  draft?: string | null;
}): string | null {
  for (const value of [opts.appliedModel, opts.lastRunAppliedModel, opts.sessionModel, opts.draft]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
