import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const run = (a: PaletteAction) => {
    onClose();
    a.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!filtered.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % filtered.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const a = filtered[active];
      if (a) run(a);
    }
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
        placeholder="Type a command…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Command palette"
        autoComplete="off"
      />
      <div className="palette-list" role="listbox" aria-label="Commands">
        {filtered.length === 0 ? (
          <div className="palette-empty">No matches</div>
        ) : (
          filtered.map((a, i) => (
            <div
              key={a.id}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
            >
              <button
                type="button"
                className={`palette-option${i === active ? " active" : ""}`}
                onClick={() => run(a)}
              >
                <span className="palette-label">{a.label}</span>
                {a.hint ? <span className="palette-hint">{a.hint}</span> : null}
              </button>
            </div>
          ))
        )}
      </div>
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
