import { memo } from "react";
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
  return (
    <div className="effort-control" role="group" aria-label="Effort">
      <span className="effort-label">Effort</span>
      <div className="effort-chips">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`effort-chip${value === level ? " active" : ""}`}
            disabled={disabled}
            title={HINTS[level]}
            onClick={() => onChange(level)}
          >
            {LABELS[level]}
          </button>
        ))}
      </div>
      {showFallback ? (
        <span className="effort-fallback" title="Model adjusted effort">
          Using {LABELS[applied!]}
        </span>
      ) : null}
    </div>
  );
});
