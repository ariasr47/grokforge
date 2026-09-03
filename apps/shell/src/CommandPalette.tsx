import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { timeAgo } from "./timeAgo";
import { OverlayDialog } from "./ui/Dialog";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
}

/** One row in Ctrl+P's sessions mode — a session in any pinned Code
 *  workspace, not just the one currently open. */
export interface PaletteSessionRow {
  id: string;
  workspacePath: string;
  workspaceName: string;
  title: string;
  branch: string | null;
  updatedAt: number;
}

export type PaletteMode = "commands" | "sessions";

const DIALOG_TITLE: Record<PaletteMode, string> = {
  commands: "Command palette",
  sessions: "Search sessions",
};
const INPUT_PLACEHOLDER: Record<PaletteMode, string> = {
  commands: "Type a command…",
  sessions: "Search sessions…",
};

/** Right-aligned row meta for a session — workspace, branch when known, then
 *  time-ago — same "·"-joined shape the sessions rail and Home already use. */
export function paletteSessionMeta(
  row: Pick<PaletteSessionRow, "workspaceName" | "branch" | "updatedAt">,
): string {
  const parts = [row.workspaceName];
  if (row.branch) parts.push(row.branch);
  parts.push(timeAgo(row.updatedAt));
  return parts.join(" · ");
}

export function filterSessionRows(
  rows: readonly PaletteSessionRow[],
  query: string,
): PaletteSessionRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows.slice();
  return rows.filter(
    (r) =>
      r.title.toLowerCase().includes(needle) ||
      r.workspaceName.toLowerCase().includes(needle) ||
      (r.branch?.toLowerCase().includes(needle) ?? false),
  );
}

interface Props {
  open: boolean;
  /** Defaults to "commands" so every existing Ctrl+K call site is unchanged. */
  mode?: PaletteMode;
  actions: PaletteAction[];
  /** Only read in sessions mode. */
  sessions?: PaletteSessionRow[];
  /** Pre-filled into the input on open — Home's field/All-sessions link. */
  initialQuery?: string;
  onClose: () => void;
  onSelectSession?: (row: PaletteSessionRow) => void;
}

export function CommandPalette({
  open,
  mode = "commands",
  actions,
  sessions = [],
  initialQuery = "",
  onClose,
  onSelectSession,
}: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredActions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(needle) ||
        a.hint?.toLowerCase().includes(needle) ||
        a.id.toLowerCase().includes(needle),
    );
  }, [actions, q]);

  const filteredSessions = useMemo(
    () => filterSessionRows(sessions, q),
    [sessions, q],
  );

  const count =
    mode === "sessions" ? filteredSessions.length : filteredActions.length;

  useEffect(() => {
    if (!open) return;
    setQ(initialQuery);
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
    // Seeded once per open transition — see initialQuery's doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q, mode]);

  const runAction = (a: PaletteAction) => {
    onClose();
    a.run();
  };
  const selectSession = (row: PaletteSessionRow) => {
    onClose();
    onSelectSession?.(row);
  };
  const activate = (index: number) => {
    if (mode === "sessions") {
      const row = filteredSessions[index];
      if (row) selectSession(row);
    } else {
      const a = filteredActions[index];
      if (a) runAction(a);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!count) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % count);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + count) % count);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activate(active);
    }
  };

  return (
    <OverlayDialog
      isOpen={open}
      onClose={onClose}
      title={DIALOG_TITLE[mode]}
      overlayClassName="palette-overlay"
      modalClassName="palette"
    >
      <input
        ref={inputRef}
        className="palette-input"
        placeholder={INPUT_PLACEHOLDER[mode]}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={DIALOG_TITLE[mode]}
        autoComplete="off"
      />
      <div
        className="palette-list"
        role="listbox"
        aria-label={mode === "sessions" ? "Sessions" : "Commands"}
      >
        {mode === "sessions" ? (
          filteredSessions.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filteredSessions.map((row, i) => (
              <div
                key={row.id}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
              >
                <button
                  type="button"
                  className={`palette-option${i === active ? " active" : ""}`}
                  onClick={() => selectSession(row)}
                >
                  <span className="palette-label">{row.title}</span>
                  <span className="palette-hint">
                    {paletteSessionMeta(row)}
                  </span>
                </button>
              </div>
            ))
          )
        ) : filteredActions.length === 0 ? (
          <div className="palette-empty">No matches</div>
        ) : (
          filteredActions.map((a, i) => (
            <div
              key={a.id}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
            >
              <button
                type="button"
                className={`palette-option${i === active ? " active" : ""}`}
                onClick={() => runAction(a)}
              >
                <span className="palette-label">{a.label}</span>
                {a.hint ? <span className="palette-hint">{a.hint}</span> : null}
              </button>
            </div>
          ))
        )}
      </div>
      <div className="palette-footer" aria-hidden="true">
        <span>↑↓ move</span>
        <span>⏎ run</span>
        <span>esc close</span>
      </div>
    </OverlayDialog>
  );
}
