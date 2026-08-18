import React, { useEffect, useRef, useState } from "react";
void React;
import {
  canAllChecksPassed,
  chipLabel,
  type RunVerifyListProjection,
  type RunVerifyMember,
} from "./runVerifyList";

export const VERIFY_HEADER = "Verify";
export const VERIFY_HELPER = "Check commands from this run.";
export const VERIFY_LOADING = "Loading verify results…";
export const VERIFY_LOAD_FAILURE =
  "Couldn’t load this run’s verify results. Activity rows that already loaded stay available.";
export const VERIFY_UNKNOWN_HELPER = "Outcome not available from this run’s evidence.";
export const VERIFY_OFFLINE =
  "Forge is offline. This run’s verify results so far are still shown. Reconnect to confirm later updates.";
export const VERIFY_LIVE_GROWING = "Updating as checks finish…";
export const VERIFY_ALL_PASSED = "All checks passed";
export const VERIFY_VIEW_OUTPUT = "View output";
export const VERIFY_RESULTS_AVAILABLE = "Verify results available";

const CHIP_MOD: Record<ReturnType<typeof chipLabel>, string> = {
  Passed: "pass",
  Failed: "fail",
  Unknown: "unknown",
  Running: "running",
  "Not run": "not-run",
};

export type VerifySectionProps = {
  projection: RunVerifyListProjection;
  offline?: boolean;
  onViewOutput?: (member: RunVerifyMember) => void;
  outputAvailableIds?: Set<string>;
};

function vouchedSummary(members: RunVerifyMember[]): { failed: number; passed: number; unknown: number } {
  let failed = 0;
  let passed = 0;
  let unknown = 0;
  for (const member of members) {
    const chip = chipLabel(member);
    if (chip === "Failed") failed += 1;
    else if (chip === "Passed") passed += 1;
    else if (chip === "Unknown") unknown += 1;
  }
  return { failed, passed, unknown };
}

function CommandRow({
  member,
  onViewOutput,
  showViewOutput,
}: {
  member: RunVerifyMember;
  onViewOutput?: (member: RunVerifyMember) => void;
  showViewOutput: boolean;
}) {
  const chip = chipLabel(member);
  return (
    <li className="verify-row">
      <div className="verify-row-head">
        <span
          className={`chip verify-chip verify-chip-${CHIP_MOD[chip]}`}
        >
          {chip === "Running" ? <span className="tool-spinner" aria-hidden="true" /> : null}
          {chip}
        </span>
        <code className="verify-command" title={member.command} aria-label={member.command}>
          {member.command}
        </code>
      </div>
      {chip === "Unknown" ? (
        <p className="verify-helper">{VERIFY_UNKNOWN_HELPER}</p>
      ) : null}
      {showViewOutput ? (
        <div className="verify-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => onViewOutput?.(member)}
          >
            {VERIFY_VIEW_OUTPUT}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function VerifySection({
  projection,
  offline = false,
  onViewOutput,
  outputAvailableIds,
}: VerifySectionProps) {
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const prevCount = useRef(0);
  const prevFailed = useRef(new Set<string>());

  useEffect(() => {
    if (projection.state !== "ready") {
      if (projection.state === "absent") prevCount.current = 0;
      return;
    }
    const count = projection.members.length;
    const failedIds = new Set(
      projection.members.filter((m) => chipLabel(m) === "Failed").map((m) => `${m.activityId}::${m.invocationId}`),
    );
    if (prevCount.current === 0 && count > 0) {
      setAnnounce(VERIFY_RESULTS_AVAILABLE);
    } else {
      for (const id of failedIds) {
        if (!prevFailed.current.has(id)) {
          setAnnounce("A check failed.");
          break;
        }
      }
    }
    prevCount.current = count;
    prevFailed.current = failedIds;
  }, [projection]);

  if (projection.state === "absent") return null;
  if (projection.state === "loading") {
    return (
      <section className="verify verify-loading-state" aria-label={VERIFY_HEADER}>
        <p className="verify-loading" role="status">{VERIFY_LOADING}</p>
      </section>
    );
  }
  if (projection.state === "error") {
    return (
      <section className="verify verify-error-state" aria-label={VERIFY_HEADER}>
        <p className="verify-error" role="alert">{projection.message}</p>
      </section>
    );
  }

  const members = projection.members;
  const tallies = vouchedSummary(members);
  const allPassed = canAllChecksPassed(projection);
  const showLive = projection.runLive && !offline && !allPassed;

  return (
    <section className="verify" aria-label={VERIFY_HEADER}>
      <header className="verify-header">
        <button
          type="button"
          className="verify-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <h2>{VERIFY_HEADER}</h2>
          <span className="chip verify-count" aria-label={`${members.length} checks`}>
            {members.length}
          </span>
          {tallies.failed > 0 ? <span className="verify-summary">{tallies.failed} failed</span> : null}
          {tallies.passed > 0 ? <span className="verify-summary">{tallies.passed} passed</span> : null}
          {tallies.unknown > 0 ? <span className="verify-summary">{tallies.unknown} unknown</span> : null}
        </button>
      </header>
      {offline ? <p className="verify-offline" role="status">{VERIFY_OFFLINE}</p> : null}
      {showLive ? <p className="verify-live" role="status">{VERIFY_LIVE_GROWING}</p> : null}
      {allPassed ? <p className="verify-all-passed" role="status">{VERIFY_ALL_PASSED}</p> : null}
      {open ? (
        <>
          <p className="verify-helper">{VERIFY_HELPER}</p>
          <ul className="verify-list">
            {members.map((member) => {
              const running = chipLabel(member) === "Running";
              const hasOutput = outputAvailableIds?.has(member.activityId) === true;
              return (
                <CommandRow
                  key={`${member.activityId}::${member.invocationId}`}
                  member={member}
                  onViewOutput={onViewOutput}
                  showViewOutput={!running || hasOutput}
                />
              );
            })}
          </ul>
        </>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  );
}
