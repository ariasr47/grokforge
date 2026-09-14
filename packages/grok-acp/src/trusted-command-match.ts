// Trusted command class IDs are grok-acp host policy, not a Forge auto-mode.
const CLASS_IDS = new Set([
  "npm", "npx", "cargo", "git:status", "git:diff", "git:log", "git:show",
]);

/** Chain / statement separators for dogfood cmd dialect (aligned with scanCmd). */
function hasChainOrStatementSeparator(command: string): boolean {
  let quote = false;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i]!;
    if (c === "^") {
      if (i + 1 >= command.length) return true;
      i += 1;
      continue;
    }
    if (c === '"') {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (c === "\r" || c === "\n") return true;
    if (c === "&" || c === "|") return true;
  }
  return false;
}

function tokenizeLeading(segment: string): string[] | null {
  const values: string[] = [];
  let value = "";
  let quote = false;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment[i]!;
    if (c === "^") {
      if (i + 1 >= segment.length) return null;
      value += segment[++i];
      continue;
    }
    if (c === '"') {
      quote = !quote;
      continue; // unquote
    }
    if (!quote && /\s/.test(c)) {
      if (value) {
        values.push(value);
        value = "";
      }
      continue;
    }
    value += c;
  }
  if (quote) return null;
  if (value) values.push(value);
  return values;
}

function leadingFamily(token: string): string {
  const base = token.replace(/^\.(\\|\/)/, "").split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(cmd|exe)$/i, "").toLowerCase();
}

/**
 * Returns the matched catalog class id if the command is a chain-hardened single-statement
 * leading catalog class present in `saved`, else null.
 * Git subcommand = first argument after leading git token (W1: no global-option skip).
 */
// Trusted class match is host policy, not a Forge auto-mode.
export function matchTrustedCommandClass(
  command: string,
  saved: ReadonlySet<string>,
): string | null {
  if (!command || !saved.size) return null;
  if (hasChainOrStatementSeparator(command)) return null;
  const tokens = tokenizeLeading(command.trim());
  if (!tokens || tokens.length === 0) return null;
  const family = leadingFamily(tokens[0]!);
  if (family === "npm" || family === "npx" || family === "cargo") {
    return saved.has(family) && CLASS_IDS.has(family) ? family : null;
  }
  if (family === "git") {
    const sub = (tokens[1] ?? "").toLowerCase();
    const id =
      sub === "status" || sub === "diff" || sub === "log" || sub === "show"
        ? (`git:${sub}` as const)
        : null;
    if (!id || !CLASS_IDS.has(id) || !saved.has(id)) return null;
    return id;
  }
  return null;
}
