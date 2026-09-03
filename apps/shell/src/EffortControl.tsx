import { ChevronDown } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { EffortLevel } from "./api";
import { Icon } from "./ui/Icon";

const LEVELS: EffortLevel[] = ["auto", "fast", "expert", "heavy"];

const LABELS: Record<EffortLevel, string> = {
  auto: "Auto",
  fast: "Fast",
  expert: "Expert",
  heavy: "Heavy",
};

const HINTS: Record<EffortLevel, string> = {
  auto: "Use your default model settings (no extra reasoning override)",
  fast: "Faster model path + low reasoning — snappy, less deep",
  expert: "Your model + high reasoning — deeper answers, slower",
  heavy: "Stronger model path + high reasoning — longest waits, hardest work",
};

interface Props {
  value: EffortLevel;
  applied?: EffortLevel | null;
  onChange: (e: EffortLevel) => void;
  disabled?: boolean;
}

/**
 * The `Expert ⌄` composer chip. A quiet trigger showing the current level
 * (falling back to the level the model actually applied) that opens a small
 * menu listing Auto/Fast/Expert/Heavy with their existing hint copy —
 * Escape or an outside click closes it, same convention as ThreadHeader's
 * Overview popover.
 */
export const EffortControl = memo(function EffortControl({
  value,
  applied,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const showFallback = Boolean(applied && applied !== value);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const triggerLabel = LABELS[showFallback ? (applied as EffortLevel) : value];

  return (
    <div className="effort-control" ref={rootRef}>
      <button
        type="button"
        className="chip effort-trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={showFallback ? `Model adjusted effort to ${LABELS[applied as EffortLevel]}` : HINTS[value]}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{triggerLabel}</span>
        <Icon icon={ChevronDown} size={11} className="chip-ch" />
      </button>
      {open ? (
        <div className="menu effort-menu" role="menu" aria-label="Effort">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="menuitemradio"
              aria-checked={level === value}
              aria-label={LABELS[level]}
              title={HINTS[level]}
              className={`mi${level === value ? " on" : ""}`}
              onClick={() => {
                onChange(level);
                setOpen(false);
              }}
            >
              <span className="k">{LABELS[level]}</span>
              <span className="d">{HINTS[level]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});
