import { memo, useCallback } from "react";
import type { EffortLevel } from "./api";

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

export const EffortControl = memo(function EffortControl({
  value,
  applied,
  onChange,
  disabled,
}: Props) {
  const showFallback = applied && applied !== value;

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
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      const idx = LEVELS.indexOf(value);
      const next = LEVELS[(idx + dir + LEVELS.length) % LEVELS.length]!;
      onChange(next);
    },
    [value, onChange],
  );

  return (
    <div className="effort-control">
      <span className="effort-label" id="effort-control-label">
        Effort
      </span>
      <div
        className="effort-chips"
        role="radiogroup"
        aria-labelledby="effort-control-label"
      >
        {LEVELS.map((level) => {
          const active = value === level;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={LABELS[level]}
              tabIndex={active ? 0 : -1}
              className={`effort-chip${active ? " active" : ""}`}
              disabled={disabled}
              title={HINTS[level]}
              onClick={() => onChange(level)}
              onKeyDown={onKeyDown}
            >
              {LABELS[level]}
              {active ? (
                <span className="effort-chip-mark" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
      {showFallback ? (
        <span className="effort-fallback" title="Model adjusted effort">
          Using {LABELS[applied!]}
        </span>
      ) : null}
    </div>
  );
});
