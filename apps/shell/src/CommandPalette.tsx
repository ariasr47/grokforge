import { useEffect, useMemo, useRef, useState } from "react";
import { OverlayDialog } from "./ui/Dialog";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}

export function CommandPalette({ open, actions, onClose }: Props) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = "command-palette-listbox";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(needle) ||
        a.hint?.toLowerCase().includes(needle) ||
        a.id.toLowerCase().includes(needle),
    );
  }, [actions, q]);

  const activeId =
    filtered[idx] != null ? `palette-opt-${filtered[idx]!.id}` : undefined;

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  useEffect(() => {
    if (idx >= filtered.length) setIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, idx]);

  const run = (a: PaletteAction) => {
    onClose();
    a.run();
  };

  return (
    <OverlayDialog
      isOpen={open}
      onClose={onClose}
      title="Command palette"
      overlayClassName="palette-overlay"
      modalClassName="palette"
    >
        <input
          ref={inputRef}
          className="palette-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a command…"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const a = filtered[idx];
              if (a) run(a);
            } else if (e.key === "Home") {
              e.preventDefault();
              setIdx(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setIdx(Math.max(0, filtered.length - 1));
            }
          }}
        />
        <ul
          id={listId}
          className="palette-list"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 && (
            <li className="palette-empty" role="presentation">
              No matches
            </li>
          )}
          {filtered.map((a, i) => (
            <li
              key={a.id}
              id={`palette-opt-${a.id}`}
              role="option"
              aria-selected={i === idx}
            >
              <button
                type="button"
                className={i === idx ? "active" : ""}
                tabIndex={-1}
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(a)}
              >
                <span className="palette-label">{a.label}</span>
                {a.hint && <span className="palette-hint">{a.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="palette-footer" aria-hidden="true">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
          <span>Ctrl+L chat</span>
          <span>Ctrl+N new</span>
        </div>
    </OverlayDialog>
  );
}
