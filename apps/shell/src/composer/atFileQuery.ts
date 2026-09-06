function normPath(p: string): string {
  return p.toLowerCase().replaceAll("\\", "/");
}

/** Match @file queries on slash-normalized path or basename. */
export function atFileQueryMatches(file: string, q: string): boolean {
  if (!q) return true;
  const f = normPath(file);
  const n = normPath(q);
  if (f.includes(n)) return true;
  const base = f.split("/").pop() ?? "";
  return base.includes(n);
}

/** Lower is better — exact basename beats forge-keep-*.png for `@KEEP`. */
export function atFileQueryRank(file: string, q: string): number {
  if (!q) return 0;
  const f = normPath(file);
  const n = normPath(q);
  const base = f.split("/").pop() ?? "";
  if (base === n || base === `${n}.md`) return 0;
  if (base.startsWith(n)) return 1;
  if (f.endsWith(`/${n}`) || f.endsWith(`/${n}.md`)) return 2;
  if (base.includes(n)) return 3;
  return 4;
}

export function atFileSuggestions(files: readonly string[], q: string, limit = 8): string[] {
  return files
    .filter((f) => atFileQueryMatches(f, q))
    .sort((a, b) => {
      const d = atFileQueryRank(a, q) - atFileQueryRank(b, q);
      return d !== 0 ? d : a.localeCompare(b);
    })
    .slice(0, limit);
}
