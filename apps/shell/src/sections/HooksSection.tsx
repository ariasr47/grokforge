import React, { useEffect, useRef, useState } from "react";
void React;
import {
  HOOKS_AVAILABLE_ANNOUNCE,
  HOOKS_GENERIC_IDENTITY,
  HOOKS_HEADER,
  HOOKS_HELPER,
  HOOKS_LIVE_GROWING,
  HOOKS_LOADING,
  HOOKS_STATUS_DONE,
  HOOKS_STATUS_FAILED,
  HOOKS_STATUS_IDLE,
  HOOKS_STATUS_RUNNING,
  HOOKS_TOOLTIP_DONE,
  HOOKS_TOOLTIP_FAILED,
  HOOKS_TOOLTIP_IDLE,
  HOOKS_TOOLTIP_RUNNING,
  HOOKS_UNAVAILABLE,
  type HookRow,
  type HooksProjection,
} from "../projections/hooksProjection";

export type HooksSectionProps = {
  projection: HooksProjection;
};

function statusChrome(row: HookRow): {
  label: string;
  mod: string;
  title: string;
} | null {
  if (row.showLiveRunningChip) {
    return {
      label: HOOKS_STATUS_RUNNING,
      mod: "running",
      title: HOOKS_TOOLTIP_RUNNING,
    };
  }
  if (row.status === "idle") {
    return { label: HOOKS_STATUS_IDLE, mod: "idle", title: HOOKS_TOOLTIP_IDLE };
  }
  if (row.status === "done") {
    return { label: HOOKS_STATUS_DONE, mod: "done", title: HOOKS_TOOLTIP_DONE };
  }
  if (row.status === "failed") {
    return { label: HOOKS_STATUS_FAILED, mod: "failed", title: HOOKS_TOOLTIP_FAILED };
  }
  return null;
}

function identityAria(row: HookRow): string {
  if (row.restore === "unrestorable") return `${HOOKS_GENERIC_IDENTITY} ${HOOKS_UNAVAILABLE}`;
  return row.identityLabel;
}

function HookRowView({ row }: { row: HookRow }) {
  const chip = statusChrome(row);
  return (
    <li className="hooks-row">
      <div className="hooks-row-head">
        <code
          className="hooks-identity"
          title={row.identityLabel}
          aria-label={identityAria(row)}
        >
          {row.identityLabel}
        </code>
        {row.restore === "unrestorable" ? (
          <span className="chip hooks-unavailable">{HOOKS_UNAVAILABLE}</span>
        ) : chip ? (
          <span className={`chip hooks-chip hooks-chip-${chip.mod}`} title={chip.title}>
            {chip.mod === "running" ? <span className="tool-spinner" aria-hidden="true" /> : null}
            {chip.label}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function visibleRows(projection: HooksProjection): HookRow[] | null {
  if (projection.state === "ready") return projection.members;
  if (projection.state === "loading") return projection.members;
  if (projection.state === "error") return projection.members;
  return null;
}

export function HooksSection({ projection }: HooksSectionProps) {
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
      members.filter((m) => m.status === "failed").map((m) => m.hookId),
    );
    if (prevCount.current === 0 && count > 0) {
      setAnnounce(HOOKS_AVAILABLE_ANNOUNCE);
    } else {
      for (const id of failedIds) {
        if (!prevFailed.current.has(id)) {
          setAnnounce(HOOKS_STATUS_FAILED);
          break;
        }
      }
    }
    prevCount.current = count;
    prevFailed.current = failedIds;
  }, [projection, rows]);

  if (projection.state === "absent") return null;

  const loading = projection.state === "loading";
  const failed = projection.state === "error";
  const loadingWithoutRows = loading && (rows == null || rows.length === 0);
  const errorWithoutRows = failed && (rows == null || rows.length === 0);
  const reconnectCopy = projection.state === "ready"
    ? (projection.offlineCopy ?? projection.reconnectCopy)
    : null;
  const liveGrowing = projection.state === "ready" ? projection.liveGrowing : false;
  const runningCount = projection.state === "ready"
    ? projection.runningCount
    : (rows ?? []).filter((r) => r.showLiveRunningChip).length;
  const idleCount = projection.state === "ready"
    ? projection.idleCount
    : (rows ?? []).filter((r) => r.status === "idle").length;
  const doneCount = projection.state === "ready"
    ? projection.doneCount
    : (rows ?? []).filter((r) => r.status === "done").length;
  const failedCount = projection.state === "ready"
    ? projection.failedCount
    : (rows ?? []).filter((r) => r.status === "failed").length;
  const count = projection.state === "ready" ? projection.totalCount : (rows?.length ?? 0);
  const sectionCopy = loading ? projection.sectionCopy : null;
  const errorMessage = failed ? projection.message : null;

  if (loadingWithoutRows) {
    return (
      <section className="hooks hooks-loading-state" aria-label={HOOKS_HEADER}>
        <p className="hooks-loading" role="status">{sectionCopy ?? HOOKS_LOADING}</p>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </section>
    );
  }

  if (errorWithoutRows) {
    return (
      <section className="hooks hooks-error-state" aria-label={HOOKS_HEADER}>
        <p className="hooks-error" role="alert">{errorMessage}</p>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </section>
    );
  }

  return (
    <section
      className={`hooks${loading ? " hooks-loading-state" : ""}${failed ? " hooks-error-state" : ""}`}
      aria-label={HOOKS_HEADER}
    >
      <header className="hooks-header">
        <button
          type="button"
          className="hooks-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <h2>{HOOKS_HEADER}</h2>
          <span className="chip hooks-count" aria-label={`${count} hooks`}>
            {count}
          </span>
          {runningCount > 0 ? <span className="hooks-summary">{runningCount} running</span> : null}
          {idleCount > 0 ? <span className="hooks-summary">{idleCount} idle</span> : null}
          {doneCount > 0 ? <span className="hooks-summary">{doneCount} done</span> : null}
          {failedCount > 0 ? <span className="hooks-summary">{failedCount} failed</span> : null}
        </button>
      </header>
      {loading ? <p className="hooks-loading" role="status">{sectionCopy ?? HOOKS_LOADING}</p> : null}
      {errorMessage ? <p className="hooks-error" role="alert">{errorMessage}</p> : null}
      {reconnectCopy ? <p className="hooks-offline" role="status">{reconnectCopy}</p> : null}
      {liveGrowing ? <p className="hooks-live" role="status">{HOOKS_LIVE_GROWING}</p> : null}
      {open ? (
        <>
          <p className="hooks-helper">{HOOKS_HELPER}</p>
          {rows && rows.length > 0 ? (
            <ul className="hooks-list">
              {rows.map((member) => (
                <HookRowView key={member.hookId} row={member} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  );
}
