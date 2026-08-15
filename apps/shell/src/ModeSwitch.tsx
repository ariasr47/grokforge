import { memo, useCallback } from "react";
import type { ProductMode } from "./api";

interface Props {
  mode: ProductMode;
  onChange: (m: ProductMode) => void;
  /** Quiet "Applying…" indicator only — never disables the control (SPEC §4: always available). */
  applying?: boolean;
}

const ORDER: ProductMode[] = ["chat", "code"];
const LABELS: Record<ProductMode, string> = { chat: "Chat", code: "Code" };

export const ModeSwitch = memo(function ModeSwitch({
  mode,
  onChange,
  applying,
}: Props) {
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (
        e.key !== "ArrowRight" &&
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowUp" &&
        e.key !== "ArrowDown"
      )
        return;
      e.preventDefault();
      const dir =
        e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const idx = ORDER.indexOf(mode);
      const next = ORDER[(idx + dir + ORDER.length) % ORDER.length]!;
      onChange(next);
    },
    [mode, onChange],
  );

  return (
    <div
      className="mode-switch"
      role="radiogroup"
      aria-label="Product mode"
    >
      {ORDER.map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={LABELS[m]}
            tabIndex={active ? 0 : -1}
            className={`mode-seg${active ? " active" : ""}`}
            onClick={() => onChange(m)}
            onKeyDown={onKeyDown}
          >
            {LABELS[m]}
            {active ? <span className="mode-seg-mark" aria-hidden="true" /> : null}
          </button>
        );
      })}
      {applying ? (
        <span className="mode-switch-applying" role="status" aria-live="polite">
          Applying…
        </span>
      ) : null}
    </div>
  );
});
