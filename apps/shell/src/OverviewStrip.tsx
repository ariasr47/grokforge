export interface RunOverview {
  tools: number;
  toolFails: number;
  filesTouched: string[];
  lastError: string | null;
  userTurns: number;
}

interface Props {
  overview: RunOverview;
  workspaceName: string | null;
}

export function OverviewStrip({ overview, workspaceName }: Props) {
  if (!workspaceName) return null;
  return (
    <div className="overview-strip" role="status" aria-label="Run overview">
      <span className="ov-item">
        <em>ws</em> {workspaceName}
      </span>
      <span className="ov-item">
        <em>turns</em> {overview.userTurns}
      </span>
      <span className="ov-item">
        <em>tools</em> {overview.tools}
        {overview.toolFails > 0 ? (
          <span className="ov-fail"> · {overview.toolFails} fail</span>
        ) : null}
      </span>
      <span className="ov-item" title={overview.filesTouched.join(", ") || "none"}>
        <em>files</em>{" "}
        {overview.filesTouched.length
          ? overview.filesTouched
              .slice(0, 3)
              .map((f) => f.split(/[/\\]/).pop())
              .join(", ") +
            (overview.filesTouched.length > 3
              ? ` +${overview.filesTouched.length - 3}`
              : "")
          : "—"}
      </span>
      {overview.lastError && (
        <span className="ov-item ov-err" title={overview.lastError}>
          <em>err</em> {overview.lastError.slice(0, 48)}
          {overview.lastError.length > 48 ? "…" : ""}
        </span>
      )}
    </div>
  );
}

export function computeOverview(
  messages: Array<{
    role: string;
    content: string;
    toolMeta?: { ok?: boolean; name?: string };
  }>,
  diffPaths: string[],
): RunOverview {
  let tools = 0;
  let toolFails = 0;
  let lastError: string | null = null;
  let userTurns = 0;
  const files = new Set<string>(diffPaths);

  for (const m of messages) {
    if (m.role === "user") userTurns += 1;
    if (m.role === "tool") {
      tools += 1;
      if (m.toolMeta?.ok === false) toolFails += 1;
    }
    if (m.role === "system" && m.content.startsWith("Error")) {
      lastError = m.content.replace(/^Error\s*(\([^)]*\))?:\s*/, "");
    }
    if (m.role === "system" && m.content.startsWith("Diff ")) {
      const path = m.content.replace(/^Diff \w+:\s*/, "").trim();
      if (path) files.add(path);
    }
  }

  return {
    tools,
    toolFails,
    filesTouched: [...files],
    lastError,
    userTurns,
  };
}
