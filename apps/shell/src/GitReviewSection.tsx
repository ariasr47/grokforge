import React, { useEffect, useRef, useState } from "react";
void React;
import { Button } from "./ui/Button";
import {
  gitReviewRowChrome,
  type GitReviewKind,
  type RunGitReviewListProjection,
  type RunGitReviewMember,
} from "./runGitReviewList";
import type { ActivityRecord } from "./runReducer";

export const GIT_REVIEW_HEADER = "Git review";
export const GIT_REVIEW_HELPER = "Git evidence from this run.";
export const GIT_REVIEW_LOADING = "Loading git review…";
export const GIT_REVIEW_LOAD_FAILURE =
  "Couldn’t load this run’s git review. Activity rows that already loaded stay available.";
export const GIT_REVIEW_UNAVAILABLE = "Evidence not available from this run.";
export const GIT_REVIEW_OFFLINE =
  "Forge is offline. This run’s git review so far is still shown. Reconnect to confirm later updates.";
export const GIT_REVIEW_LIVE_GROWING = "Updating as git evidence arrives…";
export const GIT_REVIEW_VIEW_OUTPUT = "View output";
export const GIT_REVIEW_AVAILABLE = "Git review available";
export const GIT_REVIEW_PR_AVAILABLE = "PR evidence available";

const KIND_LABEL: Record<GitReviewKind, string> = {
  status: "Status",
  diff: "Diff",
  log: "Log",
  show: "Show",
  pr: "PR",
};

const KIND_SUMMARY: Record<GitReviewKind, string> = {
  status: "status",
  diff: "diff",
  log: "log",
  show: "show",
  pr: "PR",
};

const KIND_ORDER: GitReviewKind[] = ["status", "diff", "log", "show", "pr"];

const EXEC_CHIP_MOD: Record<"Not run" | "Running" | "Failed", string> = {
  "Not run": "not-run",
  Running: "running",
  Failed: "fail",
};

export type GitReviewSectionProps = {
  projection: RunGitReviewListProjection;
  offline?: boolean;
  onViewOutput?: (member: RunGitReviewMember) => void;
  outputAvailableIds?: Set<string>;
  activityStatusById?: Map<string, ActivityRecord["status"]>;
  activityLifecycleById?: Map<string, ActivityRecord["lifecycle"]>;
};

function kindCounts(members: RunGitReviewMember[]): Record<GitReviewKind, number> {
  const counts: Record<GitReviewKind, number> = {
    status: 0,
    diff: 0,
    log: 0,
    show: 0,
    pr: 0,
  };
  for (const member of members) counts[member.kind] += 1;
  return counts;
}

function rowChrome(
  member: RunGitReviewMember,
  activityStatusById?: Map<string, ActivityRecord["status"]>,
  activityLifecycleById?: Map<string, ActivityRecord["lifecycle"]>,
) {
  const fallbackStatus: ActivityRecord["status"] =
    member.execution === "pending" ? "running" : member.execution === "not_executed" ? "rejected" : "succeeded";
  const fallbackLifecycle: ActivityRecord["lifecycle"] =
    member.execution === "pending" ? "pending" : "terminal";
  const status = activityStatusById?.get(member.activityId) ?? fallbackStatus;
  const lifecycle = activityLifecycleById?.get(member.activityId) ?? fallbackLifecycle;
  return gitReviewRowChrome(member, status, lifecycle);
}

function EvidenceRow({
  member,
  chrome,
  onViewOutput,
  showViewOutput,
}: {
  member: RunGitReviewMember;
  chrome: ReturnType<typeof gitReviewRowChrome>;
  onViewOutput?: (member: RunGitReviewMember) => void;
  showViewOutput: boolean;
}) {
  const execChip = chrome === "Not run" || chrome === "Running" || chrome === "Failed" ? chrome : null;
  return (
    <li className="git-review-row">
      <div className="git-review-row-head">
        <span className={`chip git-review-kind git-review-kind-${member.kind}`}>
          {KIND_LABEL[member.kind]}
        </span>
        {execChip ? (
          <span className={`chip git-review-chip git-review-chip-${EXEC_CHIP_MOD[execChip]}`}>
            {execChip === "Running" ? <span className="tool-spinner" aria-hidden="true" /> : null}
            {execChip}
          </span>
        ) : null}
        <code className="git-review-command" title={member.command} aria-label={member.command}>
          {member.command}
        </code>
      </div>
      {chrome === "unavailable" ? (
        <p className="git-review-helper">{GIT_REVIEW_UNAVAILABLE}</p>
      ) : null}
      {showViewOutput ? (
        <div className="git-review-actions">
          <Button
            variant="ghost"
            onClick={() => onViewOutput?.(member)}
          >
            {GIT_REVIEW_VIEW_OUTPUT}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function GitReviewSection({
  projection,
  offline = false,
  onViewOutput,
  outputAvailableIds,
  activityStatusById,
  activityLifecycleById,
}: GitReviewSectionProps) {
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const prevCount = useRef(0);
  const prevPrIds = useRef(new Set<string>());

  useEffect(() => {
    if (projection.state !== "ready") {
      if (projection.state === "absent") {
        prevCount.current = 0;
        prevPrIds.current = new Set();
      }
      return;
    }
    const count = projection.members.length;
    const prIds = new Set(
      projection.members.filter((m) => m.kind === "pr").map((m) => `${m.activityId}::${m.invocationId}`),
    );
    let nextAnnounce = "";
    if (prevCount.current === 0 && count > 0) nextAnnounce = GIT_REVIEW_AVAILABLE;
    for (const id of prIds) {
      if (!prevPrIds.current.has(id)) {
        nextAnnounce = GIT_REVIEW_PR_AVAILABLE;
        break;
      }
    }
    if (nextAnnounce) setAnnounce(nextAnnounce);
    prevCount.current = count;
    prevPrIds.current = prIds;
  }, [projection]);

  if (projection.state === "absent") return null;
  if (projection.state === "loading") {
    return (
      <section className="git-review git-review-loading-state" aria-label={GIT_REVIEW_HEADER}>
        <p className="git-review-loading" role="status">{GIT_REVIEW_LOADING}</p>
      </section>
    );
  }
  if (projection.state === "error") {
    return (
      <section className="git-review git-review-error-state" aria-label={GIT_REVIEW_HEADER}>
        <p className="git-review-error" role="alert">{projection.message}</p>
      </section>
    );
  }

  const members = projection.members;
  const counts = kindCounts(members);
  const showLive = projection.runLive && !offline;

  return (
    <section className="git-review" aria-label={GIT_REVIEW_HEADER}>
      <header className="git-review-header">
        <button
          type="button"
          className="git-review-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <h2>{GIT_REVIEW_HEADER}</h2>
          <span className="chip git-review-count" aria-label={`${members.length} git review members`}>
            {members.length}
          </span>
          {KIND_ORDER.map((kind) =>
            counts[kind] > 0 ? (
              <span key={kind} className="git-review-summary">
                {counts[kind]} {KIND_SUMMARY[kind]}
              </span>
            ) : null,
          )}
        </button>
      </header>
      {offline ? <p className="git-review-offline" role="status">{GIT_REVIEW_OFFLINE}</p> : null}
      {showLive ? <p className="git-review-live" role="status">{GIT_REVIEW_LIVE_GROWING}</p> : null}
      {open ? (
        <>
          <p className="git-review-helper">{GIT_REVIEW_HELPER}</p>
          <ul className="git-review-list">
            {members.map((member) => {
              const chrome = rowChrome(member, activityStatusById, activityLifecycleById);
              const running = chrome === "Running";
              const hasOutput = outputAvailableIds?.has(member.activityId) === true;
              return (
                <EvidenceRow
                  key={`${member.activityId}::${member.invocationId}`}
                  member={member}
                  chrome={chrome}
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
