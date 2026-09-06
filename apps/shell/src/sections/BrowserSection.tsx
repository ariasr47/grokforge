import React, { useEffect, useRef, useState } from "react";
void React;
import {
  BROWSER_AVAILABLE_ANNOUNCE,
  BROWSER_GENERIC_IDENTITY,
  BROWSER_HEADER,
  BROWSER_HELPER,
  BROWSER_LIVE_GROWING,
  BROWSER_LOADING,
  BROWSER_SNAPSHOT,
  BROWSER_SNAPSHOT_MUTED,
  BROWSER_STATUS_DONE,
  BROWSER_STATUS_FAILED,
  BROWSER_STATUS_RUNNING,
  BROWSER_TOOLTIP_DONE,
  BROWSER_TOOLTIP_FAILED,
  BROWSER_TOOLTIP_RUNNING,
  BROWSER_TOOLTIP_SNAPSHOT,
  BROWSER_UNAVAILABLE,
  type BrowserWorkProjection,
  type BrowserWorkRow,
} from "../projections/browserWorkProjection";

export type BrowserSectionProps = {
  projection: BrowserWorkProjection;
};

function statusChrome(row: BrowserWorkRow): {
  label: string;
  mod: string;
  title: string;
} | null {
  if (row.showLiveRunningChip) {
    return {
      label: BROWSER_STATUS_RUNNING,
      mod: "running",
      title: BROWSER_TOOLTIP_RUNNING,
    };
  }
  if (row.status === "done") {
    return { label: BROWSER_STATUS_DONE, mod: "done", title: BROWSER_TOOLTIP_DONE };
  }
  if (row.status === "failed") {
    return { label: BROWSER_STATUS_FAILED, mod: "failed", title: BROWSER_TOOLTIP_FAILED };
  }
  return null;
}

function identityAria(row: BrowserWorkRow): string {
  if (row.restore === "unrestorable") return `${BROWSER_GENERIC_IDENTITY} ${BROWSER_UNAVAILABLE}`;
  if (row.title && row.url) return `${row.title} ${row.url}`;
  return row.identityLabel;
}

function BrowserRow({ row }: { row: BrowserWorkRow }) {
  const chip = statusChrome(row);
  const primaryTitle = row.title ?? row.identityLabel;
  return (
    <li className="browser-work-row">
      <div className="browser-work-row-head">
        <div className="browser-work-identity-block">
          <code
            className="browser-work-identity"
            title={primaryTitle}
            aria-label={identityAria(row)}
          >
            {row.identityLabel}
          </code>
          {row.title && row.url ? (
            <code className="browser-work-url" title={row.url}>
              {row.url}
            </code>
          ) : null}
        </div>
        {row.restore === "unrestorable" ? (
          <span className="chip browser-work-unavailable">{BROWSER_UNAVAILABLE}</span>
        ) : chip ? (
          <span className={`chip browser-work-chip browser-work-chip-${chip.mod}`} title={chip.title}>
            {chip.mod === "running" ? <span className="tool-spinner" aria-hidden="true" /> : null}
            {chip.label}
          </span>
        ) : null}
      </div>
      {row.snapshotJournaled ? (
        <p className="browser-work-snapshot" title={BROWSER_TOOLTIP_SNAPSHOT}>
          {BROWSER_SNAPSHOT}
          {" "}
          <span className="browser-work-snapshot-muted">{BROWSER_SNAPSHOT_MUTED}</span>
        </p>
      ) : null}
    </li>
  );
}

function visibleRows(projection: BrowserWorkProjection): BrowserWorkRow[] | null {
  if (projection.state === "ready") return projection.members;
  if (projection.state === "loading") return projection.members;
  return null;
}

export function BrowserSection({ projection }: BrowserSectionProps) {
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
      members.filter((m) => m.status === "failed").map((m) => m.toolCallId),
    );
    if (prevCount.current === 0 && count > 0) {
      setAnnounce(BROWSER_AVAILABLE_ANNOUNCE);
    } else {
      for (const id of failedIds) {
        if (!prevFailed.current.has(id)) {
          setAnnounce(BROWSER_STATUS_FAILED);
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
      <section className="browser-work browser-work-error-state" aria-label={BROWSER_HEADER}>
        <p className="browser-work-error" role="alert">{projection.message}</p>
      </section>
    );
  }

  const loading = projection.state === "loading";
  const loadingWithoutRows = loading && (rows == null || rows.length === 0);
  const reconnectCopy = projection.state === "ready"
    ? (projection.offlineCopy ?? projection.reconnectCopy)
    : null;
  const liveGrowing = projection.state === "ready" ? projection.liveGrowing : false;
  const runningCount = projection.state === "ready"
    ? projection.runningCount
    : (rows ?? []).filter((r) => r.showLiveRunningChip).length;
  const doneCount = projection.state === "ready"
    ? projection.doneCount
    : (rows ?? []).filter((r) => r.status === "done").length;
  const failedCount = projection.state === "ready"
    ? projection.failedCount
    : (rows ?? []).filter((r) => r.status === "failed").length;
  const count = projection.state === "ready" ? projection.totalCount : (rows?.length ?? 0);
  const sectionCopy = loading ? projection.sectionCopy : null;

  if (loadingWithoutRows) {
    return (
      <section className="browser-work browser-work-loading-state" aria-label={BROWSER_HEADER}>
        <p className="browser-work-loading" role="status">{sectionCopy ?? BROWSER_LOADING}</p>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </section>
    );
  }

  return (
    <section
      className={`browser-work${loading ? " browser-work-loading-state" : ""}`}
      aria-label={BROWSER_HEADER}
    >
      <header className="browser-work-header">
        <button
          type="button"
          className="browser-work-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <h2>{BROWSER_HEADER}</h2>
          <span className="chip browser-work-count" aria-label={`${count} browser work`}>
            {count}
          </span>
          {runningCount > 0 ? <span className="browser-work-summary">{runningCount} running</span> : null}
          {doneCount > 0 ? <span className="browser-work-summary">{doneCount} done</span> : null}
          {failedCount > 0 ? <span className="browser-work-summary">{failedCount} failed</span> : null}
        </button>
      </header>
      {loading ? <p className="browser-work-loading" role="status">{sectionCopy ?? BROWSER_LOADING}</p> : null}
      {reconnectCopy ? <p className="browser-work-offline" role="status">{reconnectCopy}</p> : null}
      {liveGrowing ? <p className="browser-work-live" role="status">{BROWSER_LIVE_GROWING}</p> : null}
      {open ? (
        <>
          <p className="browser-work-helper">{BROWSER_HELPER}</p>
          {rows && rows.length > 0 ? (
            <ul className="browser-work-list">
              {rows.map((member) => (
                <BrowserRow key={member.toolCallId} row={member} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  );
}
