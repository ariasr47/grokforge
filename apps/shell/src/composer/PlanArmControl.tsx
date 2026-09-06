import { memo } from "react";
import { Button } from "../ui/Button";
import {
  PLAN_ARM_BLOCKED_UNVOUCHED,
  PLAN_ARM_HELPER_ARMED,
  PLAN_ARM_OFFLINE,
  type PlanArmProjection,
} from "../projections/planArm";

export {
  PLAN_ARM_BLOCKED_UNVOUCHED,
  PLAN_ARM_HELPER_ARMED,
  PLAN_ARM_OFFLINE,
};

export type PlanArmControlProps = {
  projection: PlanArmProjection;
  onToggle?: (engaged: boolean) => void;
  onRetry?: () => void;
};

export const PlanArmControl = memo(function PlanArmControl({
  projection,
  onToggle,
  onRetry,
}: PlanArmControlProps) {
  if (projection.state === "absent_chat") return null;

  const armed = projection.state === "armed";
  const locked =
    projection.state === "blocked_unvouched" ||
    projection.state === "offline" ||
    projection.state === "disabled_no_workspace" ||
    projection.state === "disabled_busy_other" ||
    projection.state === "error";

  return (
    <div className="plan-arm" data-plan-arm={projection.state}>
      <span className="plan-arm-label sr-only" id="plan-arm-label">
        Plan
      </span>
      <button
        type="button"
        className={`plan-arm-chip${armed ? " active" : ""}`}
        aria-pressed={armed}
        aria-labelledby="plan-arm-label"
        disabled={locked}
        onClick={() => {
          if (locked) return;
          onToggle?.(!armed);
        }}
      >
        Plan
        {armed ? <span className="plan-arm-chip-mark" aria-hidden="true" /> : null}
      </button>
      {projection.state === "armed" ? (
        <p className="plan-arm-helper" role="status">
          {PLAN_ARM_HELPER_ARMED}
        </p>
      ) : null}
      {projection.state === "blocked_unvouched" ? (
        <p className="plan-arm-blocked" role="status">
          {PLAN_ARM_BLOCKED_UNVOUCHED}
        </p>
      ) : null}
      {projection.state === "offline" ? (
        <p className="plan-arm-offline" role="status">
          {PLAN_ARM_OFFLINE}
        </p>
      ) : null}
      {projection.state === "error" ? (
        <p className="plan-arm-error" role="alert">
          {projection.message}
          {onRetry ? (
            <Button variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </p>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {armed ? "Plan armed" : ""}
      </p>
    </div>
  );
});
