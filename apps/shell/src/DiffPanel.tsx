import { memo, useEffect, useMemo, useState } from "react";
import { splitUnifiedDiff } from "./diffUtil";
import { Button } from "./ui/Button";

export interface PendingDiff {
  id: string;
  path: string;
  diff: string;
}

interface Props {
  queue: PendingDiff[];
  activeId?: string | null;
  onActiveId?: (id: string | null) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

function colorizeUnified(diff: string) {
  return diff.replace(/\r\n/g, "\n").split("\n").map((line, i) => {
    let cls = "diff-line";
    if (line.startsWith("+") && !line.startsWith("+++")) cls += " plus";
    else if (line.startsWith("-") && !line.startsWith("---")) cls += " minus";
    else if (line.startsWith("@@")) cls += " hunk";
    else if (
      line.startsWith("diff ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    )
      cls += " meta";
    return (
      <div key={i} className={cls}>
        {line || " "}
      </div>
    );
  });
}

export const DiffPanel = memo(function DiffPanel({
  queue,
  activeId: controlledId,
  onActiveId,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: Props) {
  const [localId, setLocalId] = useState<string | null>(null);
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [collapsed, setCollapsed] = useState(false);

  const activeId = controlledId !== undefined ? controlledId : localId;
  const setActiveId = (id: string | null) => {
    onActiveId?.(id);
    if (controlledId === undefined) setLocalId(id);
  };

  const active = queue.find((d) => d.id === activeId) ?? queue[0] ?? null;

  useEffect(() => {
    if (queue.length && activeId && !queue.some((d) => d.id === activeId)) {
      setActiveId(queue[0]!.id);
    } else if (queue.length && !activeId) {
      setActiveId(queue[0]!.id);
    }
  }, [queue, activeId]);

  const split = useMemo(
    () =>
      active
        ? splitUnifiedDiff(active.diff)
        : { before: [] as string[], after: [] as string[], header: [] as string[] },
    [active],
  );

  const unified = useMemo(
    () => (active ? colorizeUnified(active.diff) : null),
    [active?.diff, active?.id],
  );

  if (!active || queue.length === 0) return null;

  const fileName = active.path.split(/[/\\]/).pop() || active.path;

  return (
    <div
      className="diff-pane"
      id="diff-panel"
      data-diff-panel
      role="region"
      aria-label={`Pending file edits (${queue.length})`}
    >
      <div className="diff-header">
        <button
          type="button"
          className="diff-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? "▸" : "▾"} {queue.length} pending file
          {queue.length === 1 ? "" : "s"}
        </button>
        <div className="diff-queue">
          {queue.map((d) => (
            <button
              key={d.id}
              type="button"
              className={d.id === active.id ? "active" : ""}
              onClick={() => {
                setActiveId(d.id);
                setCollapsed(false);
              }}
              title={d.path}
            >
              {d.path.split(/[/\\]/).pop()}
            </button>
          ))}
        </div>
        <div className="row diff-actions">
          <Button
            variant="ghost"
            className={mode === "unified" ? "active-toggle" : ""}
            onClick={() => setMode("unified")}
          >
            Unified
          </Button>
          <Button
            variant="ghost"
            className={mode === "split" ? "active-toggle" : ""}
            onClick={() => setMode("split")}
          >
            Side-by-side
          </Button>
          <Button
            variant="primary"
            onClick={() => onAccept(active.id)}
            title="Accept (A)"
          >
            Accept
          </Button>
          <Button
            variant="ghost"
            onClick={() => onReject(active.id)}
            title="Reject (R)"
          >
            Reject
          </Button>
          {queue.length > 1 && (
            <>
              <Button onClick={onAcceptAll}>
                Accept all
              </Button>
              <Button variant="ghost" onClick={onRejectAll}>
                Reject all
              </Button>
            </>
          )}
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="diff-path" title={active.path}>
            <span className="diff-file">{fileName}</span>
            <span className="diff-fullpath">{active.path}</span>
            <span className="diff-keys">A accept · R reject</span>
          </div>
          {mode === "unified" ? (
            <div className="diff-body unified">{unified}</div>
          ) : (
            <div className="diff-split">
              <pre className="diff-col before">
                {split.before.map((l, i) => (
                  <div key={`b${i}`} className="diff-line minus">
                    <span className="ln">{i + 1}</span>
                    {l || " "}
                  </div>
                ))}
              </pre>
              <pre className="diff-col after">
                {split.after.map((l, i) => (
                  <div key={`a${i}`} className="diff-line plus">
                    <span className="ln">{i + 1}</span>
                    {l || " "}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
});
