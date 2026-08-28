import React, { useEffect, useRef, useState } from "react";
void React;
import {
  MCP_AVAILABLE_ANNOUNCE,
  MCP_GENERIC_IDENTITY,
  MCP_HEADER,
  MCP_HELPER,
  MCP_LIVE_GROWING,
  MCP_LOADING,
  MCP_STATUS_CONNECTED,
  MCP_STATUS_ERROR,
  MCP_STATUS_IDLE,
  MCP_TOOLTIP_CONNECTED,
  MCP_TOOLTIP_ERROR,
  MCP_TOOLTIP_IDLE,
  MCP_UNAVAILABLE,
  type McpServerRow,
  type McpServersProjection,
} from "./mcpServersProjection";

export type McpServersSectionProps = {
  projection: McpServersProjection;
};

function statusChrome(row: McpServerRow): {
  label: string;
  mod: string;
  title: string;
} | null {
  if (row.showLiveConnectedChip) {
    return {
      label: MCP_STATUS_CONNECTED,
      mod: "connected",
      title: MCP_TOOLTIP_CONNECTED,
    };
  }
  if (row.status === "idle") {
    return { label: MCP_STATUS_IDLE, mod: "idle", title: MCP_TOOLTIP_IDLE };
  }
  if (row.status === "error") {
    return { label: MCP_STATUS_ERROR, mod: "error", title: MCP_TOOLTIP_ERROR };
  }
  return null;
}

function identityAria(row: McpServerRow): string {
  if (row.restore === "unrestorable") return `${MCP_GENERIC_IDENTITY} ${MCP_UNAVAILABLE}`;
  return row.identityLabel;
}

function McpRow({ row }: { row: McpServerRow }) {
  const chip = statusChrome(row);
  return (
    <li className="mcp-servers-row">
      <div className="mcp-servers-row-head">
        <code
          className="mcp-servers-identity"
          title={row.identityLabel}
          aria-label={identityAria(row)}
        >
          {row.identityLabel}
        </code>
        {row.restore === "unrestorable" ? (
          <span className="chip mcp-servers-unavailable">{MCP_UNAVAILABLE}</span>
        ) : chip ? (
          <span className={`chip mcp-servers-chip mcp-servers-chip-${chip.mod}`} title={chip.title}>
            {chip.label}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function visibleRows(projection: McpServersProjection): McpServerRow[] | null {
  if (projection.state === "ready") return projection.members;
  if (projection.state === "loading") return projection.members;
  if (projection.state === "error") return projection.members;
  return null;
}

export function McpServersSection({ projection }: McpServersSectionProps) {
  const [open, setOpen] = useState(true);
  const [announce, setAnnounce] = useState("");
  const prevCount = useRef(0);
  const prevError = useRef(new Set<string>());

  const rows = visibleRows(projection);

  useEffect(() => {
    if (projection.state === "absent") {
      prevCount.current = 0;
      prevError.current = new Set();
      return;
    }
    const members = rows ?? [];
    const count = members.length;
    const errorIds = new Set(
      members.filter((m) => m.status === "error").map((m) => m.serverId),
    );
    if (prevCount.current === 0 && count > 0) {
      setAnnounce(MCP_AVAILABLE_ANNOUNCE);
    } else {
      for (const id of errorIds) {
        if (!prevError.current.has(id)) {
          setAnnounce(MCP_STATUS_ERROR);
          break;
        }
      }
    }
    prevCount.current = count;
    prevError.current = errorIds;
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
  const connectedCount = projection.state === "ready"
    ? projection.connectedCount
    : (rows ?? []).filter((r) => r.showLiveConnectedChip).length;
  const idleCount = projection.state === "ready"
    ? projection.idleCount
    : (rows ?? []).filter((r) => r.status === "idle").length;
  const errorCount = projection.state === "ready"
    ? projection.errorCount
    : (rows ?? []).filter((r) => r.status === "error").length;
  const count = projection.state === "ready" ? projection.totalCount : (rows?.length ?? 0);
  const sectionCopy = loading ? projection.sectionCopy : null;
  const errorMessage = failed ? projection.message : null;

  if (loadingWithoutRows) {
    return (
      <section className="mcp-servers mcp-servers-loading-state" aria-label={MCP_HEADER}>
        <p className="mcp-servers-loading" role="status">{sectionCopy ?? MCP_LOADING}</p>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </section>
    );
  }

  if (errorWithoutRows) {
    return (
      <section className="mcp-servers mcp-servers-error-state" aria-label={MCP_HEADER}>
        <p className="mcp-servers-error" role="alert">{errorMessage}</p>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </section>
    );
  }

  return (
    <section
      className={`mcp-servers${loading ? " mcp-servers-loading-state" : ""}${failed ? " mcp-servers-error-state" : ""}`}
      aria-label={MCP_HEADER}
    >
      <header className="mcp-servers-header">
        <button
          type="button"
          className="mcp-servers-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <h2>{MCP_HEADER}</h2>
          <span className="chip mcp-servers-count" aria-label={`${count} MCP servers`}>
            {count}
          </span>
          {connectedCount > 0 ? <span className="mcp-servers-summary">{connectedCount} connected</span> : null}
          {idleCount > 0 ? <span className="mcp-servers-summary">{idleCount} idle</span> : null}
          {errorCount > 0 ? <span className="mcp-servers-summary">{errorCount} error</span> : null}
        </button>
      </header>
      {loading ? <p className="mcp-servers-loading" role="status">{sectionCopy ?? MCP_LOADING}</p> : null}
      {errorMessage ? <p className="mcp-servers-error" role="alert">{errorMessage}</p> : null}
      {reconnectCopy ? <p className="mcp-servers-offline" role="status">{reconnectCopy}</p> : null}
      {liveGrowing ? <p className="mcp-servers-live" role="status">{MCP_LIVE_GROWING}</p> : null}
      {open ? (
        <>
          <p className="mcp-servers-helper">{MCP_HELPER}</p>
          {rows && rows.length > 0 ? (
            <ul className="mcp-servers-list">
              {rows.map((member) => (
                <McpRow key={member.serverId} row={member} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </section>
  );
}
