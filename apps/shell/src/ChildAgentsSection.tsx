import React, { useEffect, useRef, useState } from "react";
void React;
import {
  CHILD_AGENTS_AVAILABLE_ANNOUNCE,
  CHILD_AGENTS_HEADER,
  CHILD_AGENTS_HELPER,
  CHILD_AGENTS_LIVE_GROWING,
  CHILD_AGENTS_LOADING,
  CHILD_AGENTS_STATUS_DONE,
  CHILD_AGENTS_STATUS_FAILED,
  CHILD_AGENTS_STATUS_RUNNING,
  CHILD_AGENTS_TOOLTIP_DONE,
  CHILD_AGENTS_TOOLTIP_FAILED,
  CHILD_AGENTS_TOOLTIP_RUNNING,
  type ChildAgentsProjection,
  type ChildAgentsRow,
} from "./childAgentsProjection";

export type ChildAgentsSectionProps = {
  projection: ChildAgentsProjection;
};

function statusChrome(row: ChildAgentsRow): {
  label: string;
  mod: string;
  title: string;
} | null {
  if (row.showLiveRunningChip) {
    return {
      label: CHILD_AGENTS_STATUS_RUNNING,
      mod: "running",
      title: CHILD_AGENTS_TOOLTIP_RUNNING,
    };
  }
  if (row.status === "done") {
    return { label: CHILD_AGENTS_STATUS_DONE, mod: "done", title: CHILD_AGENTS_TOOLTIP_DONE };
  }
  if (row.status === "failed") {
    return { label: CHILD_AGENTS_STATUS_FAILED, mod: "failed", title: CHILD_AGENTS_TOOLTIP_FAILED };
  }
  return null;
}

function ChildRow({ row }: { row: ChildAgentsRow }) {
  const chip = statusChrome(row);
  return (
    <li className="child-agents-row">
      <div className="child-agents-row-head">
        <code
          className="child-agents-identity"
          title={row.identityLabel}
          aria-label={row.identityLabel}
        >
          {row.identityLabel}
        </code>
        {chip ? (
          <span className={`chip child-agents-chip child-agents-chip-${chip.mod}`} title={chip.title}>
            {chip.mod === "running" ? <span className="tool-spinner" aria-hidden="true" /> : null}
            {chip.label}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function visibleRows(projection: ChildAgentsProjection): ChildAgentsRow[] | null {
  if (projection.state === "ready") return projection.members;
  if (projection.state === "loading") return projection.members;
  return null;
}

export function ChildAgentsSection({ projection }: ChildAgentsSectionProps) {
  const [open, setOpen] = useState(true);
  const [announce, setAnnounce] = useState("");
  const prevCount = useRef(0);
  const prevFailed = useRef(new Set<string>());

  const rows = visibleRows(projection);

  useEffect(() => {
    if (projection.state === "absent") {
      prevCount.current = 0;
      prevFailed.current = new Set();
      return;
    }
    const members = rows ?? [];
    const count = members.length;
    const failedIds = new Set(
      members.filter((m) => m.status === "failed").map((m) => m.childId),
    );
    if (prevCount.current === 0 && count > 0) {
      setAnnounce(CHILD_AGENTS_AVAILABLE_ANNOUNCE);
    } else {
      for (const id of failedIds) {
        if (!prevFailed.current.has(id)) {
          setAnnounce(CHILD_AGENTS_STATUS_FAILED);
          break;
        }
      }
    }
    prevCount.current = count;
    prevFailed.current = failedIds;
  }, [projection, rows]);

  if (projection.state === "absent") return null;

  if (projection.state === "error") {
    return (
      <section className="child-agents child-agents-error-state" aria-label={CHILD_AGENTS_HEADER}>
        <p className="child-agents-error" role="alert">{projection.message}</p>
      </section>
    );
  }

  const loading = projection.state === "loading";
  const loadingWithoutRows = loading && (rows == null || rows.length === 0);
  const reconnectCopy = projection.state === "loading"
    ? projection.reconnectCopy
    : projection.state === "ready"
      ? (projection.offlineCopy ?? projection.reconnectCopy)
      : null;
  const liveGrowing = projection.state === "ready" ? projection.liveGrowing : false;
  const runningCount = projection.state === "ready" ? projection.runningCount : (rows ?? []).filter((r) => r.showLiveRunningChip).length;
  const doneCount = projection.state === "ready" ? projection.doneCount : (rows ?? []).filter((r) => r.status === "done").length;
  const failedCount = projection.state === "ready" ? projection.failedCount : (rows ?? []).filter((r) => r.status === "failed").length;
  const count = rows?.length ?? 0;

  if (loadingWithoutRows) {
    return (
      <section className="child-agents child-agents-loading-state" aria-label={CHILD_AGENTS_HEADER}>
        <p className="child-agents-loading" role="status">{CHILD_AGENTS_LOADING}</p>
        {reconnectCopy ? <p className="child-agents-offline" role="status">{reconnectCopy}</p> : null}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </section>
    );
  }

  return (
    <section
      className={`child-agents${loading ? " child-agents-loading-state" : ""}`}
      aria-label={CHILD_AGENTS_HEADER}
    >
      <header className="child-agents-header">
        <button
          type="button"
          className="child-agents-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <h2>{CHILD_AGENTS_HEADER}</h2>
          <span className="chip child-agents-count" aria-label={`${count} child agents`}>
            {count}
          </span>
          {runningCount > 0 ? <span className="child-agents-summary">{runningCount} running</span> : null}
          {doneCount > 0 ? <span className="child-agents-summary">{doneCount} done</span> : null}
          {failedCount > 0 ? <span className="child-agents-summary">{failedCount} failed</span> : null}
        </button>
      </header>
      {loading ? <p className="child-agents-loading" role="status">{CHILD_AGENTS_LOADING}</p> : null}
      {reconnectCopy ? <p className="child-agents-offline" role="status">{reconnectCopy}</p> : null}
      {liveGrowing ? <p className="child-agents-live" role="status">{CHILD_AGENTS_LIVE_GROWING}</p> : null}
      {open ? (
        <>
          <p className="child-agents-helper">{CHILD_AGENTS_HELPER}</p>
          {rows && rows.length > 0 ? (
            <ul className="child-agents-list">
              {rows.map((member) => (
                <ChildRow key={member.childId} row={member} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  );
}
