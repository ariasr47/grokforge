/** Split a simple unified diff into before/after line lists for side-by-side. */
export function splitUnifiedDiff(diff: string): {
  before: string[];
  after: string[];
  header: string[];
} {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const header: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      header.push(line);
      if (line.startsWith("@@")) inHunk = true;
      continue;
    }
    if (!inHunk) {
      header.push(line);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      after.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      before.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    } else if (line.length) {
      after.push(line);
    }
  }
  return { before, after, header };
}
