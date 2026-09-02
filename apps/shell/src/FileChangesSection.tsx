import React, { useState } from "react";
import { Button } from "./ui/Button";
void React;
import { fileChangesDiffLines, unifiedDiffLineClass } from "./diffUtil";
import type { RunChangeListProjection, RunChangeMember } from "./runChangeList";

export const FILE_CHANGES_HEADER = "File changes";
export const FILE_CHANGES_LOADING = "Loading file changes…";
export const FILE_CHANGES_LOAD_FAILURE =
  "Couldn’t load this run’s file changes. Activity rows and diffs that already loaded stay available.";
export const FILE_CHANGES_PENDING_HELPER = "Accept or reject in the action dock.";
export const FILE_CHANGES_APPLIED_HELPER = "Applied automatically · Trusted workspace";
export const FILE_CHANGES_DIFF_UNAVAILABLE = "Diff unavailable";
export const FILE_CHANGES_OFFLINE =
  "Forge is offline. This run’s file changes so far are still shown. Reconnect to confirm later updates.";
export const FILE_CHANGES_LIVE_GROWING = "Updating as edits land…";
export const FILE_CHANGES_REVERT_GUARD =
  "Restore this file to its state immediately before the edit. Forge will stop if the file has changed since.";
export const FILE_CHANGES_REVERT_SUCCESS_TITLE = "Edit reverted";
export const FILE_CHANGES_REVERT_SUCCESS_BODY =
  "The file was restored to its state immediately before this edit.";
export const FILE_CHANGES_REVERT_CONFLICT_TITLE = "Edit not reverted";
export const FILE_CHANGES_REVERT_CONFLICT_BODY =
  "The file changed after Forge applied this edit, so Forge left it unchanged. Review the current file and this edit’s diff before deciding what to do next.";

export const FILE_CHANGES_KIND_DELETED = "Deleted";
export const FILE_CHANGES_KIND_RENAMED = "Renamed";

export const FILE_CHANGES_RESTORE_FILE = "Restore file";
export const FILE_CHANGES_RESTORE_GUARD =
  "Restore this deleted file to its content from immediately before the delete. Forge will stop if the path exists again.";
export const FILE_CHANGES_RESTORE_SUCCESS_TITLE = "File restored";
export const FILE_CHANGES_RESTORE_SUCCESS_BODY =
  "The file was restored to its content from immediately before this delete.";
export const FILE_CHANGES_RESTORE_CONFLICT_TITLE = "File not restored";
export const FILE_CHANGES_RESTORE_CONFLICT_BODY =
  "The path exists again after Forge applied this delete, so Forge left it unchanged. Review the current path and this delete’s stored diff before deciding what to do next.";

export const FILE_CHANGES_REVERT_RENAME = "Revert rename";
export const FILE_CHANGES_REVERT_RENAME_GUARD =
  "Restore this file to its previous path. Forge will stop if the previous path is not safely restorable.";
export const FILE_CHANGES_REVERT_RENAME_SUCCESS_TITLE = "Rename reverted";
export const FILE_CHANGES_REVERT_RENAME_SUCCESS_BODY =
  "The file was restored to its previous path.";
export const FILE_CHANGES_REVERT_RENAME_CONFLICT_TITLE = "Rename not reverted";
export const FILE_CHANGES_REVERT_RENAME_CONFLICT_BODY =
  "The paths changed after Forge applied this rename, so Forge left them unchanged. Review the current paths and this rename’s stored diff before deciding what to do next.";

function rowLabel(member: RunChangeMember): { text: string; title: string } {
  if (
    member.kind === "rename" &&
    member.fromPath &&
    member.toPath &&
    (member.settlement === "applied" ||
      member.settlement === "accepted" ||
      member.settlement === "reverted" ||
      member.settlement === "conflict")
  ) {
    const text = `${member.fromPath} → ${member.toPath}`;
    return { text, title: text };
  }
  return { text: member.path, title: member.path };
}

function recoveryCopy(kind: RunChangeMember["kind"]) {
  if (kind === "delete") {
    return {
      control: FILE_CHANGES_RESTORE_FILE,
      guard: FILE_CHANGES_RESTORE_GUARD,
      successTitle: FILE_CHANGES_RESTORE_SUCCESS_TITLE,
      successBody: FILE_CHANGES_RESTORE_SUCCESS_BODY,
      conflictTitle: FILE_CHANGES_RESTORE_CONFLICT_TITLE,
      conflictBody: FILE_CHANGES_RESTORE_CONFLICT_BODY,
    };
  }
  if (kind === "rename") {
    return {
      control: FILE_CHANGES_REVERT_RENAME,
      guard: FILE_CHANGES_REVERT_RENAME_GUARD,
      successTitle: FILE_CHANGES_REVERT_RENAME_SUCCESS_TITLE,
      successBody: FILE_CHANGES_REVERT_RENAME_SUCCESS_BODY,
      conflictTitle: FILE_CHANGES_REVERT_RENAME_CONFLICT_TITLE,
      conflictBody: FILE_CHANGES_REVERT_RENAME_CONFLICT_BODY,
    };
  }
  return {
    control: "Revert edit",
    guard: FILE_CHANGES_REVERT_GUARD,
    successTitle: FILE_CHANGES_REVERT_SUCCESS_TITLE,
    successBody: FILE_CHANGES_REVERT_SUCCESS_BODY,
    conflictTitle: FILE_CHANGES_REVERT_CONFLICT_TITLE,
    conflictBody: FILE_CHANGES_REVERT_CONFLICT_BODY,
  };
}

const SETTLEMENT_CHIP: Record<Exclude<RunChangeMember["settlement"], "conflict">, string> = {
  pending: "Pending",
  applied: "Applied",
  accepted: "Accepted",
  rejected: "Rejected",
  reverted: "Reverted",
};

export type FileChangesSectionProps = {
  projection: RunChangeListProjection;
  runNonTerminal?: boolean;
  offline?: boolean;
  onViewDiff?: (member: RunChangeMember) => void;
  onHideDiff?: (member: RunChangeMember) => void;
  openEditId?: string | null;
  onRevert?: (member: RunChangeMember) => void;
  revertPendingEditId?: string | null;
  recoveryFlash?: Record<string, "reverted" | "conflict">;
  onFocusDock?: (requestId: string) => void;
};

function ColorizedDiff({ diff }: { diff: string }) {
  return (
    <div className="diff-body unified file-changes-diff" role="region" aria-label="Stored diff">
      {fileChangesDiffLines(diff).map((line, i) => (
        <div key={i} className={unifiedDiffLineClass(line)}>
          {line || " "}
        </div>
      ))}
    </div>
  );
}

function PathRow({
  member,
  open,
  onViewDiff,
  onHideDiff,
  onRevert,
  revertPending,
  flash,
  onFocusDock,
}: {
  member: RunChangeMember;
  open: boolean;
  onViewDiff?: (member: RunChangeMember) => void;
  onHideDiff?: (member: RunChangeMember) => void;
  onRevert?: (member: RunChangeMember) => void;
  revertPending: boolean;
  flash?: "reverted" | "conflict";
  onFocusDock?: (requestId: string) => void;
}) {
  const conflict = member.settlement === "conflict" || flash === "conflict";
  const reverted = member.settlement === "reverted" || flash === "reverted";
  const chipKind: Exclude<RunChangeMember["settlement"], "conflict"> | null =
    conflict || member.settlement === "conflict"
      ? null
      : reverted
        ? "reverted"
        : member.settlement;
  const showRevert = member.recoveryAvailable && !conflict && !reverted && !revertPending;
  const copy = recoveryCopy(member.kind);
  const label = rowLabel(member);
  const [expanded, setExpanded] = useState(
    () => member.settlement === "pending" || member.settlement === "applied" || Boolean(open),
  );
  return (
    <li className="file-changes-row">
      <details
        className="file-changes-path-details"
        open={expanded || open}
        onToggle={(ev) => {
          const nextOpen = (ev.currentTarget as HTMLDetailsElement).open;
          if (nextOpen === expanded) return;
          setExpanded(nextOpen);
          if (member.settlement === "pending" && member.requestId && nextOpen) {
            onFocusDock?.(member.requestId);
          }
        }}
      >
        <summary className="file-changes-row-head">
          <span className="file-changes-path" title={label.title} aria-label={label.title}>
            {label.text}
          </span>
          {member.kind === "delete" ? (
            <span className="chip file-changes-kind file-changes-kind-deleted">{FILE_CHANGES_KIND_DELETED}</span>
          ) : null}
          {member.kind === "rename" ? (
            <span className="chip file-changes-kind file-changes-kind-renamed">{FILE_CHANGES_KIND_RENAMED}</span>
          ) : null}
          {chipKind ? (
            <span className={`chip file-changes-chip file-changes-chip-${chipKind}`}>{SETTLEMENT_CHIP[chipKind]}</span>
          ) : null}
          {member.diffUnavailable ? null : (
            <span
              className="file-changes-actions"
              onClick={(e) => e.preventDefault()}
            >
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={open}
                onClick={() => (open ? onHideDiff?.(member) : onViewDiff?.(member))}
              >
                {open ? "Hide diff" : "View diff"}
              </Button>
            </span>
          )}
        </summary>
        {member.settlement === "pending" ? (
          <p className="file-changes-helper">{FILE_CHANGES_PENDING_HELPER}</p>
        ) : null}
        {member.settlement === "applied" && !conflict && !reverted ? (
          <p className="file-changes-helper">{FILE_CHANGES_APPLIED_HELPER}</p>
        ) : null}
        {conflict ? (
          <p className="file-changes-conflict" role="alert">
            <strong>{copy.conflictTitle}</strong>
            <span>{copy.conflictBody}</span>
          </p>
        ) : null}
        {reverted && !conflict ? (
          <p className="file-changes-reverted" role="status">
            <strong>{copy.successTitle}</strong>
            <span>{copy.successBody}</span>
          </p>
        ) : null}
        {member.diffUnavailable ? (
          <p className="file-changes-unavailable" role="status">{FILE_CHANGES_DIFF_UNAVAILABLE}</p>
        ) : null}
        {open && member.diff ? <ColorizedDiff diff={member.diff} /> : null}
        {showRevert ? (
          <div className="file-changes-revert">
            <p className="recovery-guard">{copy.guard}</p>
            <Button
              variant="ghost"
              disabled={revertPending}
              onClick={() => onRevert?.(member)}
            >
              {copy.control}
            </Button>
          </div>
        ) : null}
      </details>
    </li>
  );
}

export function FileChangesSection({
  projection,
  runNonTerminal,
  offline,
  onViewDiff,
  onHideDiff,
  openEditId,
  onRevert,
  revertPendingEditId,
  recoveryFlash,
  onFocusDock,
}: FileChangesSectionProps) {
  if (projection.state === "absent") return null;
  if (projection.state === "loading") {
    return (
      <section className="file-changes file-changes-loading-state" aria-label={FILE_CHANGES_HEADER}>
        <p className="file-changes-loading" role="status">{FILE_CHANGES_LOADING}</p>
      </section>
    );
  }
  if (projection.state === "error") {
    return (
      <section className="file-changes file-changes-error-state" aria-label={FILE_CHANGES_HEADER}>
        <p className="file-changes-error" role="alert">{projection.message}</p>
      </section>
    );
  }
  const members = projection.members;
  const applied = members.filter((m) => m.settlement === "applied").length;
  const pending = members.filter((m) => m.settlement === "pending").length;
  return (
    <section className="file-changes" aria-label={FILE_CHANGES_HEADER}>
      <header className="file-changes-header">
        <h2>{FILE_CHANGES_HEADER}</h2>
        <span className="chip file-changes-count" aria-label={`${members.length} file changes`}>
          {members.length}
        </span>
        {applied > 0 ? <span className="file-changes-summary">{applied} applied</span> : null}
        {pending > 0 ? <span className="file-changes-summary">{pending} pending</span> : null}
      </header>
      {offline ? <p className="file-changes-offline" role="status">{FILE_CHANGES_OFFLINE}</p> : null}
      {runNonTerminal && !offline ? (
        <p className="file-changes-live" role="status">{FILE_CHANGES_LIVE_GROWING}</p>
      ) : null}
      <ul className="file-changes-list">
        {members.map((member) => (
          <PathRow
            key={member.editId}
            member={member}
            open={openEditId === member.editId}
            onViewDiff={onViewDiff}
            onHideDiff={onHideDiff}
            onRevert={onRevert}
            revertPending={revertPendingEditId === member.editId}
            flash={recoveryFlash?.[member.editId] ?? recoveryFlash?.[member.activityId]}
            onFocusDock={onFocusDock}
          />
        ))}
      </ul>
    </section>
  );
}
