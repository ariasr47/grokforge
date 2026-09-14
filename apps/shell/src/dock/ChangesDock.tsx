import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import { Check, Eye, EyeOff, GitBranch, PanelRightClose } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { countDiffLines, splitDiffHunks } from "../projections/diffUtil";
import {
  appliedAutomaticallyNote,
  type ChangeMemberSettlement,
  type MutationKind,
  type PendingDiff,
  type RunChangeMember,
} from "../projections/runChangeList";
import { chipLabel, type RunVerifyMember } from "../projections/runVerifyList";
import { gitReviewRowChrome, type RunGitReviewMember } from "../projections/runGitReviewList";
import type { ActivityRecord } from "../projections/runReducer";

/** A file-change member plus the run it came from — the dock aggregates across
 *  every run in the session, so a revert action needs to know which run to post to. */
export type ChangesDockMember = RunChangeMember & { runId: string };

export type ChangesDockLoadState<Member> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; members: Member[] };

export type ChangesDockFilesState = ChangesDockLoadState<ChangesDockMember>;
/** Verify carries `runLive` because a summary over checks is only honest once
 * the run has finished — while it is live, more checks may still arrive. */
export type ChangesDockVerifyState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; members: RunVerifyMember[]; runLive: boolean };
export type ChangesDockGitState = ChangesDockLoadState<RunGitReviewMember>;

export const CHANGES_DOCK_LABEL = "Changes";
export const FILE_CHANGES_KIND_DELETED = "Deleted";
export const FILE_CHANGES_KIND_RENAMED = "Renamed";
export const FILE_CHANGES_APPLIED_HELPER = "Applied automatically · Trusted workspace";
export const FILE_CHANGES_LOADING = "Loading file changes…";
export const FILE_CHANGES_LOAD_FAILURE =
  "Couldn’t load this run’s file changes. Activity rows and diffs that already loaded stay available.";
export const FILES_EMPTY = "No pending file changes";
export const VERIFY_LOADING = "Loading verify results…";
export const VERIFY_LOAD_FAILURE =
  "Couldn’t load this run’s verify results. Activity rows that already loaded stay available.";
export const VERIFY_EMPTY = "No verify commands from this run";
export const GIT_REVIEW_LOADING = "Loading git review…";
export const GIT_REVIEW_LOAD_FAILURE =
  "Couldn’t load this run’s git review. Activity rows that already loaded stay available.";
export const GIT_REVIEW_EMPTY = "No git evidence from this run";
export const CHANGES_DOCK_REVIEW_NOTE = "Review lands when tests pass";
export const CHANGES_DOCK_REVIEW_BUTTON = "Review & commit…";

type RecoveryCopy = {
  control: string;
  guard: string;
  successTitle: string;
  successBody: string;
  conflictTitle: string;
  conflictBody: string;
};

function recoveryCopyFor(kind: MutationKind): RecoveryCopy {
  if (kind === "delete") {
    return {
      control: "Restore file",
      guard:
        "Restore this deleted file to its content from immediately before the delete. Forge will stop if the path exists again.",
      successTitle: "File restored",
      successBody: "The file was restored to its content from immediately before this delete.",
      conflictTitle: "File not restored",
      conflictBody:
        "The path exists again after Forge applied this delete, so Forge left it unchanged. Review the current path and this delete’s stored diff before deciding what to do next.",
    };
  }
  if (kind === "rename") {
    return {
      control: "Revert rename",
      guard: "Restore this file to its previous path. Forge will stop if the previous path is not safely restorable.",
      successTitle: "Rename reverted",
      successBody: "The file was restored to its previous path.",
      conflictTitle: "Rename not reverted",
      conflictBody:
        "The paths changed after Forge applied this rename, so Forge left them unchanged. Review the current paths and this rename’s stored diff before deciding what to do next.",
    };
  }
  return {
    control: "Revert edit",
    guard: "Restore this file to its state immediately before the edit. Forge will stop if the file has changed since.",
    successTitle: "Edit reverted",
    successBody: "The file was restored to its state immediately before this edit.",
    conflictTitle: "Edit not reverted",
    conflictBody:
      "The file changed after Forge applied this edit, so Forge left it unchanged. Review the current file and this edit’s diff before deciding what to do next.",
  };
}

const SETTLEMENT_LABEL: Record<ChangeMemberSettlement, string> = {
  pending: "Pending",
  applied: "Applied",
  accepted: "Accepted",
  rejected: "Rejected",
  reverted: "Reverted",
  conflict: "Conflict",
};

function splitPath(path: string): { dir: string; name: string } {
  const parts = path.split(/[/\\]/);
  const name = parts.pop() ?? path;
  return { dir: parts.length ? `${parts.join("/")}/` : "", name };
}

/** Rename display text — "from → to" once the rename has actually landed (or been
 *  reverted/conflicted); the old path alone while still pending or after a reject. */
function rowLabel(member: RunChangeMember): string {
  if (
    member.kind === "rename" &&
    member.fromPath &&
    member.toPath &&
    (member.settlement === "applied" ||
      member.settlement === "accepted" ||
      member.settlement === "reverted" ||
      member.settlement === "conflict")
  ) {
    return `${member.fromPath} → ${member.toPath}`;
  }
  return member.path;
}

export interface ChangesDockProps {
  files: ChangesDockFilesState;
  verify: ChangesDockVerifyState;
  git: ChangesDockGitState;
  /** The same pending-diff queue DiffPanel reads — accept/reject call the App
   *  handlers that already own it (acceptDiff/rejectDiff), never a new api call. */
  diffQueue: PendingDiff[];
  activityStatusById?: Map<string, ActivityRecord["status"]>;
  activityLifecycleById?: Map<string, ActivityRecord["lifecycle"]>;
  activityOutputById?: Map<string, unknown>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRevert?: (member: ChangesDockMember) => void;
  revertPendingEditId?: string | null;
  recoveryFlash?: Record<string, "reverted" | "conflict">;
  onCollapse: () => void;
  onOpenReview: () => void;
}

type Tab = "files" | "verify" | "git";

// A11Y-4: fixed DOM/tab order — Left/Right roving-tabindex navigation below
// walks this list, wrapping at the ends.
const TAB_ORDER: Tab[] = ["files", "verify", "git"];
const tabButtonId = (id: Tab) => `changes-tab-${id}`;
const tabPanelId = (id: Tab) => `changes-panel-${id}`;

function TabButton({
  id,
  active,
  onSelect,
  label,
  count,
}: {
  id: Tab;
  active: boolean;
  onSelect: (id: Tab) => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      id={tabButtonId(id)}
      role="tab"
      aria-selected={active}
      aria-controls={tabPanelId(id)}
      tabIndex={active ? 0 : -1}
      className={active ? "on" : ""}
      onClick={() => onSelect(id)}
    >
      <span>{label}</span>
      {typeof count === "number" && count > 0 ? <span className="n">{count}</span> : null}
    </button>
  );
}

function DiffPreview({ member }: { member: ChangesDockMember }) {
  const hunks = splitDiffHunks(member.diff ?? "");
  const hunk = hunks[0];
  if (!hunk) return null;
  return (
    <div className="diff">
      <div className="hh">
        {hunk.range ? <span>{hunk.range}</span> : null}
        {hunk.context ? <span>{hunk.context}</span> : null}
        {hunks.length > 1 ? (
          <span className="ha">
            <span>hunk 1 of {hunks.length}</span>
          </span>
        ) : null}
      </div>
      {hunk.lines.map((line, i) => (
        <div key={i} className={line.kind === "context" ? "ln" : `ln ${line.kind}`}>
          <span className="no">{line.no}</span>
          <span>{line.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

function FileRow({
  member,
  selected,
  diffOpen,
  queuedDiffId,
  recoveryFlash,
  onSelect,
  onAccept,
  onReject,
}: {
  member: ChangesDockMember;
  selected: boolean;
  diffOpen: boolean;
  queuedDiffId: string | null;
  recoveryFlash?: "reverted" | "conflict";
  onSelect: (editId: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const rowSettlement: ChangeMemberSettlement =
    recoveryFlash === "reverted" ? "reverted" : recoveryFlash === "conflict" ? "conflict" : member.settlement;
  const { dir, name } = splitPath(member.path);
  const label = rowLabel(member);
  const isArrow = label !== member.path;
  const counts = !member.diffUnavailable && member.diff ? countDiffLines(member.diff) : null;
  return (
    <div className={selected ? "frow sel" : "frow"}>
      <span className="fn" title={label}>
        {isArrow ? label : (
          <>
            {dir ? <span className="dir">{dir}</span> : null}
            {name}
          </>
        )}
      </span>
      {member.kind === "delete" ? <Chip tone="quiet">{FILE_CHANGES_KIND_DELETED}</Chip> : null}
      {member.kind === "rename" ? <Chip tone="quiet">{FILE_CHANGES_KIND_RENAMED}</Chip> : null}
      {counts ? (
        <span className="pm">
          <span className="stat-add">+{counts.added}</span> <span className="stat-del">−{counts.removed}</span>
        </span>
      ) : null}
      {queuedDiffId ? (
        <>
          <Button size="sm" variant="primary" className="mini ok" onClick={() => onAccept(queuedDiffId)}>
            Accept
          </Button>
          <Button size="sm" variant="ghost" className="mini" onClick={() => onReject(queuedDiffId)}>
            Reject
          </Button>
        </>
      ) : (
        <span className="frow-status">
          {rowSettlement === "accepted" ? <Icon icon={Check} size={12} /> : null}
          {SETTLEMENT_LABEL[rowSettlement]}
        </span>
      )}
      {!member.diffUnavailable ? (
        <Button
          size="sm"
          variant="ghost"
          className="icon-only"
          title={diffOpen ? "Hide diff" : "View diff"}
          aria-label={diffOpen ? "Hide diff" : "View diff"}
          onClick={() => onSelect(member.editId)}
        >
          <Icon icon={diffOpen ? EyeOff : Eye} size={13} />
        </Button>
      ) : null}
    </div>
  );
}

function FilesTab({
  members,
  diffQueue,
  onAccept,
  onReject,
  onRevert,
  revertPendingEditId,
  recoveryFlash,
}: {
  members: ChangesDockMember[];
  diffQueue: PendingDiff[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRevert?: (member: ChangesDockMember) => void;
  revertPendingEditId?: string | null;
  recoveryFlash?: Record<string, "reverted" | "conflict">;
}) {
  // Two independent concerns, matching the pre-dock design's split between
  // "is this row's diff open" (always started closed, DiffPanel-style) and
  // "does this row's own status/revert panel show" (the pre-dock FileChanges
  // list showed a row's status/revert panel immediately, no click needed):
  //  - selectedForDiff: which row's hunk preview is open — starts closed,
  //    toggled by View diff/Hide diff.
  //  - detailTarget: the row whose status panel (applied note, conflict/
  //    reverted text, revert control) shows below the list — the explicitly
  //    selected row if there is one, else the first row, so a single-file
  //    change is immediately actionable without an extra click.
  const [selectedForDiff, setSelectedForDiff] = useState<string | null>(null);

  // Stale-hunk handling: if the diff we had open is gone (accepted/rejected/
  // reverted away, or a newer run replaced the list), close it rather than
  // showing a preview that no longer corresponds to anything real.
  useEffect(() => {
    if (!selectedForDiff) return;
    if (members.some((m) => m.editId === selectedForDiff)) return;
    setSelectedForDiff(null);
  }, [members, selectedForDiff]);

  if (members.length === 0) {
    return <p className="changes-empty">{FILES_EMPTY}</p>;
  }

  const detailTarget =
    (selectedForDiff && members.find((m) => m.editId === selectedForDiff)) || members[0] || null;
  const diffTarget = detailTarget && detailTarget.editId === selectedForDiff ? detailTarget : null;
  const flash = detailTarget ? recoveryFlash?.[detailTarget.editId] ?? recoveryFlash?.[detailTarget.activityId] : undefined;
  const conflict = detailTarget ? detailTarget.settlement === "conflict" || flash === "conflict" : false;
  const reverted = detailTarget ? detailTarget.settlement === "reverted" || flash === "reverted" : false;
  const copy = detailTarget ? recoveryCopyFor(detailTarget.kind) : null;

  return (
    <>
      <div className="frows">
        {members.map((member) => {
          const queuedDiffId =
            member.settlement === "pending" && member.requestId && diffQueue.some((d) => d.id === member.requestId)
              ? member.requestId
              : null;
          return (
            <FileRow
              key={member.editId}
              member={member}
              selected={member.editId === detailTarget?.editId}
              diffOpen={member.editId === selectedForDiff}
              queuedDiffId={queuedDiffId}
              recoveryFlash={recoveryFlash?.[member.editId] ?? recoveryFlash?.[member.activityId]}
              onSelect={(id) => setSelectedForDiff((cur) => (cur === id ? null : id))}
              onAccept={onAccept}
              onReject={onReject}
            />
          );
        })}
      </div>
      {diffTarget && !diffTarget.diffUnavailable ? <DiffPreview member={diffTarget} /> : null}
      {detailTarget && conflict ? (
        <p className="changes-conflict" role="alert">
          <strong>{copy!.conflictTitle}</strong>
          <span>{copy!.conflictBody}</span>
        </p>
      ) : null}
      {detailTarget && reverted && !conflict ? (
        <p className="changes-reverted" role="status">
          <strong>{copy!.successTitle}</strong>
          <span>{copy!.successBody}</span>
        </p>
      ) : null}
      {detailTarget && detailTarget.settlement === "applied" && !conflict && !reverted ? (
        <p className="changes-applied-note">{appliedAutomaticallyNote(detailTarget.policyEffectiveMode)}</p>
      ) : null}
      {detailTarget && detailTarget.recoveryAvailable && !conflict && !reverted && revertPendingEditId !== detailTarget.editId ? (
        <div className="changes-revert">
          <p className="recovery-guard">{copy!.guard}</p>
          <Button variant="ghost" size="sm" onClick={() => onRevert?.(detailTarget)}>
            {copy!.control}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function VerifyTab({ members }: { members: RunVerifyMember[] }) {
  if (members.length === 0) return <p className="changes-empty">{VERIFY_EMPTY}</p>;
  return (
    <div className="sect">
      <div className="sl">
        <span>Verify</span>
      </div>
      {members.map((member) => {
        const label = chipLabel(member);
        const running = label === "Running";
        return (
          <div className="vrow" key={`${member.activityId}::${member.invocationId}`}>
            {running ? (
              <span className="tool-spinner" aria-hidden="true" />
            ) : label === "Passed" ? (
              <span className="ri" aria-hidden="true">
                <Icon icon={Check} size={12} />
              </span>
            ) : null}
            <code className="vn" title={member.command}>
              {member.command}
            </code>
            <span className={`vt vt-${label.toLowerCase().replace(/\s+/g, "-")}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

const GIT_KIND_LABEL: Record<RunGitReviewMember["kind"], string> = {
  status: "Status",
  diff: "Diff",
  log: "Log",
  show: "Show",
  pr: "PR",
};

function gitStdoutText(output: unknown): string | null {
  if (output && typeof output === "object" && "stdout" in output) {
    const stdout = (output as { stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.trim()) return stdout.trim();
  }
  if (typeof output !== "string") return null;
  const text = output.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { stdout?: unknown };
    if (typeof parsed.stdout === "string" && parsed.stdout.trim()) return parsed.stdout.trim();
  } catch {
    /* plain tool output */
  }
  return text;
}

function GitTab({
  members,
  activityStatusById,
  activityLifecycleById,
  activityOutputById,
}: {
  members: RunGitReviewMember[];
  activityStatusById?: Map<string, ActivityRecord["status"]>;
  activityLifecycleById?: Map<string, ActivityRecord["lifecycle"]>;
  activityOutputById?: Map<string, unknown>;
}) {
  if (members.length === 0) return <p className="changes-empty">{GIT_REVIEW_EMPTY}</p>;
  return (
    <div className="sect">
      <div className="sl">
        <span>Git</span>
      </div>
      {members.map((member) => {
        const fallbackStatus: ActivityRecord["status"] =
          member.execution === "pending" ? "running" : member.execution === "not_executed" ? "rejected" : "succeeded";
        const fallbackLifecycle: ActivityRecord["lifecycle"] = member.execution === "pending" ? "pending" : "terminal";
        const chrome = gitReviewRowChrome(
          member,
          activityStatusById?.get(member.activityId) ?? fallbackStatus,
          activityLifecycleById?.get(member.activityId) ?? fallbackLifecycle,
        );
        const running = chrome === "Running";
        const stdout = gitStdoutText(activityOutputById?.get(member.activityId));
        return (
          <div className="vrow" key={`${member.activityId}::${member.invocationId}`}>
            {running ? (
              <span className="tool-spinner" aria-hidden="true" />
            ) : (
              <span className="ri" aria-hidden="true">
                <Icon icon={GitBranch} size={12} />
              </span>
            )}
            <span className="git-kind">{GIT_KIND_LABEL[member.kind]}</span>
            <code className="vn" title={member.command}>
              {member.command}
            </code>
            {stdout ? <pre className="git-stdout">{stdout}</pre> : null}
            {chrome !== "ok" ? <span className={`vt vt-${chrome.toLowerCase().replace(/\s+/g, "-")}`}>{chrome}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function tabBody<Member>(
  loadState: ChangesDockLoadState<Member>,
  loading: string,
  ready: (members: Member[]) => ReactElement,
) {
  if (loadState.state === "loading") return <p className="changes-loading" role="status">{loading}</p>;
  if (loadState.state === "error") return <p className="changes-error" role="alert">{loadState.message}</p>;
  return ready(loadState.members);
}

function totalCounts(members: ChangesDockMember[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const member of members) {
    if (member.diffUnavailable || !member.diff) continue;
    const c = countDiffLines(member.diff);
    added += c.added;
    removed += c.removed;
  }
  return { added, removed };
}

export const ChangesDock = memo(function ChangesDock({
  files,
  verify,
  git,
  diffQueue,
  activityStatusById,
  activityLifecycleById,
  activityOutputById,
  onAccept,
  onReject,
  onRevert,
  revertPendingEditId,
  recoveryFlash,
  onCollapse,
  onOpenReview,
}: ChangesDockProps) {
  const [tab, setTab] = useState<Tab>("files");
  const filesReady = files.state === "ready" ? files.members : [];
  const verifyReady = verify.state === "ready" ? verify.members : [];
  const gitReady = git.state === "ready" ? git.members : [];
  const empty =
    files.state !== "loading" &&
    files.state !== "error" &&
    filesReady.length === 0 &&
    verify.state !== "loading" &&
    verify.state !== "error" &&
    verifyReady.length === 0 &&
    git.state !== "loading" &&
    git.state !== "error" &&
    gitReady.length === 0;
  const open = !empty;

  // A11Y-3: the dock opened without moving focus in; its own Collapse
  // button then unmounted it, dropping focus to <body>. `open` is a stable
  // boolean so this only fires on the real open/close transition (not on
  // every member-list update while already open).
  const dockRef = useRef<HTMLElement>(null);
  const openTriggerRef = useRef<Element | null>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      openTriggerRef.current = document.activeElement;
      dockRef.current?.focus({ preventScroll: true });
    } else if (!open && wasOpenRef.current) {
      const trigger = openTriggerRef.current as HTMLElement | null;
      // Only reclaim focus if it fell out to <body> — an explicit click
      // elsewhere already moved focus somewhere real; don't fight that.
      if (trigger?.focus && (!document.activeElement || document.activeElement === document.body)) {
        trigger.focus({ preventScroll: true });
      }
      openTriggerRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open]);

  if (empty) return null;

  const { added, removed } = totalCounts(filesReady);

  return (
    <aside
      className="changes"
      role="region"
      aria-label={CHANGES_DOCK_LABEL}
      ref={dockRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Local, not global: only fires while focus is inside the dock,
          // and stops here so App.tsx's window-level Escape chain (which
          // would otherwise fall through to cancelling a busy run) never
          // sees this keystroke.
          e.stopPropagation();
          onCollapse();
        }
      }}
    >
      <div className="chead">
        <span>{CHANGES_DOCK_LABEL}</span>
        <span className="sum">
          {filesReady.length} file{filesReady.length === 1 ? "" : "s"} ·{" "}
          <span className="stat-add">+{added}</span> <span className="stat-del">−{removed}</span>
        </span>
        <span className="spacer" />
        <Button variant="ghost" className="icon-only" title="Collapse" onClick={onCollapse}>
          <Icon icon={PanelRightClose} size={15} />
        </Button>
      </div>
      <div
        className="tabs"
        role="tablist"
        aria-label="Changes sections"
        onKeyDown={(e) => {
          // A11Y-4: roving tabindex + arrow keys — Left/Right move focus
          // between tabs and activate (automatic-activation pattern, same
          // as the existing click-to-select behavior).
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const idx = TAB_ORDER.indexOf(tab);
          const next = TAB_ORDER[(idx + dir + TAB_ORDER.length) % TAB_ORDER.length]!;
          setTab(next);
          document.getElementById(tabButtonId(next))?.focus();
        }}
      >
        <TabButton id="files" active={tab === "files"} onSelect={setTab} label="Files" count={filesReady.length} />
        <TabButton id="verify" active={tab === "verify"} onSelect={setTab} label="Verify" />
        <TabButton id="git" active={tab === "git"} onSelect={setTab} label="Git" />
      </div>
      <div
        className="changes-body"
        role="tabpanel"
        id={tabPanelId(tab)}
        aria-labelledby={tabButtonId(tab)}
      >
        {tab === "files"
          ? tabBody(files, FILE_CHANGES_LOADING, (members) => (
              <FilesTab
                members={members}
                diffQueue={diffQueue}
                onAccept={onAccept}
                onReject={onReject}
                onRevert={onRevert}
                revertPendingEditId={revertPendingEditId}
                recoveryFlash={recoveryFlash}
              />
            ))
          : null}
        {tab === "verify"
          ? tabBody(verify, VERIFY_LOADING, (members) => <VerifyTab members={members} />)
          : null}
        {tab === "git"
          ? tabBody(git, GIT_REVIEW_LOADING, (members) => (
              <GitTab
                members={members}
                activityStatusById={activityStatusById}
                activityLifecycleById={activityLifecycleById}
                activityOutputById={activityOutputById}
              />
            ))
          : null}
      </div>
      <div className="cfoot">
        <span>{CHANGES_DOCK_REVIEW_NOTE}</span>
        <span className="spacer" />
        <Button onClick={onOpenReview}>{CHANGES_DOCK_REVIEW_BUTTON}</Button>
      </div>
    </aside>
  );
});
