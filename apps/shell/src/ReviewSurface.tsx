import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, CornerDownLeft } from "lucide-react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { inEditable } from "./inEditable";
import { countDiffLines, splitDiffHunks, type DiffHunk } from "./diffUtil";
import type { PendingDiff } from "./runChangeList";
import {
  FILES_EMPTY,
  FILE_CHANGES_LOADING,
  FILE_CHANGES_LOAD_FAILURE,
  GIT_REVIEW_EMPTY,
  GIT_REVIEW_LOADING,
  GIT_REVIEW_LOAD_FAILURE,
  VERIFY_EMPTY,
  VERIFY_LOADING,
  VERIFY_LOAD_FAILURE,
  type ChangesDockFilesState,
  type ChangesDockGitState,
  type ChangesDockMember,
  type ChangesDockVerifyState,
} from "./ChangesDock";
import { chipLabel } from "./runVerifyList";
import { formatToolOutput } from "./toolFormat";

/** `In <path> line N: <comment>` plus the hunk itself as context — verbatim, never
 *  reworded, so Grok sees exactly what the reviewer saw. */
export function composeLineCommentMessage(
  path: string,
  lineNo: number,
  comment: string,
  hunk: Pick<DiffHunk, "range" | "context" | "lines">,
): string {
  const head = `In ${path} line ${lineNo}: ${comment}`;
  const header = [hunk.range, hunk.context].filter(Boolean).join(" ");
  const body = hunk.lines.map((l) => l.text).join("\n");
  const context = [header, body].filter(Boolean).join("\n");
  return context ? `${head}\n\n${context}` : head;
}

/** The footer "Ask Grok to change this file…" field — scopes the request to the file
 *  the same way a line comment scopes it to a line, without inventing a hunk to attach. */
export function composeAskFileMessage(path: string, message: string): string {
  return `In ${path}: ${message}`;
}

/** Forge never runs git itself — this is a prompt asking Grok to, with whatever message
 *  currently sits in the (editable) commit-message field. */
export function composeCommitMessage(message: string): string {
  return `Commit the accepted files with this message:\n\n${message}`;
}

/** A file is committable once it needs no further decision: either a real Accept was
 *  recorded, or the edit landed with no diff/permission gate at all — the ordinary case
 *  in a trusted workspace. Both read as settled everywhere this surface counts or gates
 *  on "accepted": the file dot, the header progress, and the Commit button. */
function isSettledForCommit(settlement: ChangesDockMember["settlement"]): boolean {
  return settlement === "accepted" || settlement === "applied";
}

function fileDotClass(settlement: ChangesDockMember["settlement"]): "ok" | "conflict" | "idle" {
  if (isSettledForCommit(settlement)) return "ok";
  if (settlement === "conflict") return "conflict";
  // pending/rejected/reverted: neutral, never amber — a pending file is not "needs you".
  return "idle";
}

function splitPath(path: string): { dir: string; name: string } {
  const parts = path.split(/[/\\]/);
  const name = parts.pop() ?? path;
  return { dir: parts.length ? `${parts.join("/")}/` : "", name };
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

export interface ReviewSurfaceProps {
  /** The session/thread's own title — the meta line's leading clause. */
  threadTitle: string;
  files: ChangesDockFilesState;
  verify: ChangesDockVerifyState;
  git: ChangesDockGitState;
  /** Same pending-diff queue ChangesDock reads — accept/reject call the App handlers
   *  that already own it, never a new api call. */
  diffQueue: PendingDiff[];
  /** activityId -> that activity's raw `output` — for the verify raw-output block and
   *  (via runGitReviewList's draftCommitMessageFromGitReview) the commit-message draft.
   *  Only members with a real captured entry here ever render a raw-output block. */
  verifyOutputByActivityId?: Map<string, unknown>;
  /** From the engine's own git review evidence, or null when none is available —
   *  never a fabricated message. */
  commitMessageDraft?: { subject: string; body: string } | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onRevert?: (member: ChangesDockMember) => void;
  revertPendingEditId?: string | null;
  recoveryFlash?: Record<string, "reverted" | "conflict">;
  /** The `Thread` back button. */
  onBack: () => void;
  /** Every Review-surface send (line comment, ask-file, commit) goes through this —
   *  the exact same composer send path App.tsx already uses for the main thread. */
  onSendToGrok: (text: string) => void;
}

type ActiveComment = { hunkIndex: number; lineNo: number };

export function ReviewSurface({
  threadTitle,
  files,
  verify,
  git,
  diffQueue,
  verifyOutputByActivityId,
  commitMessageDraft = null,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onRevert,
  revertPendingEditId,
  recoveryFlash,
  onBack,
  onSendToGrok,
}: ReviewSurfaceProps) {
  const filesReady = files.state === "ready" ? files.members : [];
  const verifyReady = verify.state === "ready" ? verify.members : [];
  // "all green" is a claim about a finished set of checks. While the run is
  // live another check may still land, so the summary stays off until the run
  // is terminal AND every check it reported passed (Unknown, Running and
  // Not run all disqualify it via chipLabel).
  const verifyAllGreen =
    verify.state === "ready" &&
    verify.runLive === false &&
    verifyReady.length > 0 &&
    verifyReady.every((m) => chipLabel(m) === "Passed");
  const gitReady = git.state === "ready" ? git.members : [];

  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [activeComment, setActiveComment] = useState<ActiveComment | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  // A11Y-3: the line-comment editor autofocuses its textarea on open (the
  // `autoFocus` prop below) but neither Send nor Discard returned focus to
  // the line that opened it — closing dropped focus to <body>. Captured on
  // click (below) and restored here on the active->null transition.
  const activeLineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const prevActiveCommentRef = useRef<ActiveComment | null>(null);
  useEffect(() => {
    if (!activeComment && prevActiveCommentRef.current) {
      const trigger = activeLineTriggerRef.current;
      if (trigger?.focus && (!document.activeElement || document.activeElement === document.body)) {
        trigger.focus({ preventScroll: true });
      }
    }
    prevActiveCommentRef.current = activeComment;
  }, [activeComment]);
  const [askFileDraft, setAskFileDraft] = useState("");
  const [commitDraft, setCommitDraft] = useState(() =>
    commitMessageDraft ? [commitMessageDraft.subject, commitMessageDraft.body].filter(Boolean).join("\n\n") : "",
  );
  // The git/PR evidence commitMessageDraft is sourced from can still be loading when
  // the surface opens (prop starts null). Adopt the real draft the moment it lands —
  // but only that one null→value transition, and only while the operator hasn't
  // already typed into the field themselves (a deliberate edit always wins).
  const commitDraftTouchedRef = useRef(false);
  const prevCommitMessageDraftRef = useRef(commitMessageDraft);
  useEffect(() => {
    const wasNull = prevCommitMessageDraftRef.current == null;
    prevCommitMessageDraftRef.current = commitMessageDraft;
    if (wasNull && commitMessageDraft && !commitDraftTouchedRef.current) {
      setCommitDraft([commitMessageDraft.subject, commitMessageDraft.body].filter(Boolean).join("\n\n"));
    }
  }, [commitMessageDraft]);

  const selectedMember =
    (selectedEditId && filesReady.find((m) => m.editId === selectedEditId)) || filesReady[0] || null;

  const selectFile = useCallback((editId: string) => {
    setSelectedEditId(editId);
    setActiveComment(null);
    setCommentDraft("");
  }, []);

  const hunks = useMemo(
    () => (selectedMember && !selectedMember.diffUnavailable ? splitDiffHunks(selectedMember.diff ?? "") : []),
    [selectedMember],
  );

  const acceptedCount = filesReady.filter((m) => isSettledForCommit(m.settlement)).length;
  const { added, removed } = totalCounts(filesReady);

  const queuedRequestId =
    selectedMember &&
    selectedMember.settlement === "pending" &&
    selectedMember.requestId &&
    diffQueue.some((d) => d.id === selectedMember.requestId)
      ? selectedMember.requestId
      : null;

  const acceptSelected = useCallback(() => {
    if (queuedRequestId) onAccept(queuedRequestId);
  }, [queuedRequestId, onAccept]);
  const rejectSelected = useCallback(() => {
    if (queuedRequestId) onReject(queuedRequestId);
  }, [queuedRequestId, onReject]);
  const undoSelected = useCallback(() => {
    if (selectedMember) onRevert?.(selectedMember);
  }, [selectedMember, onRevert]);

  const commitIfPossible = useCallback(() => {
    if (acceptedCount === 0) return;
    onSendToGrok(composeCommitMessage(commitDraft.trim()));
  }, [acceptedCount, onSendToGrok, commitDraft]);

  const sendComment = useCallback(() => {
    if (!activeComment || !selectedMember) return;
    const hunk = hunks[activeComment.hunkIndex];
    const text = commentDraft.trim();
    if (!hunk || !text) return;
    onSendToGrok(composeLineCommentMessage(selectedMember.path, activeComment.lineNo, text, hunk));
    setActiveComment(null);
    setCommentDraft("");
  }, [activeComment, selectedMember, hunks, commentDraft, onSendToGrok]);

  const sendAskFile = useCallback(() => {
    if (!selectedMember) return;
    const text = askFileDraft.trim();
    if (!text) return;
    onSendToGrok(composeAskFileMessage(selectedMember.path, text));
    setAskFileDraft("");
  }, [selectedMember, askFileDraft, onSendToGrok]);

  // Review-surface-local keys (A/R/⇧A/⇧R/Ctrl+⇧A/Ctrl+⇧⏎) — self-contained so this
  // component owns and can be tested against its own shortcuts. Bare A/R and ⇧A/⇧R
  // resolve to the same action here: the engine only settles a whole file's diff at
  // once, so there is no separate hunk grain to distinguish "in focus" from "file".
  // Ctrl+⏎ (send a line comment) is intentionally NOT handled here — it only makes
  // sense from inside that comment's own textarea, so it's a local onKeyDown there.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (inEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (!e.shiftKey || e.altKey) return;
        if (e.code === "KeyA") {
          e.preventDefault();
          onAcceptAll();
        } else if (e.code === "Enter") {
          e.preventDefault();
          commitIfPossible();
        }
        return;
      }
      if (e.altKey) return;
      if (e.code === "KeyA") {
        e.preventDefault();
        acceptSelected();
      } else if (e.code === "KeyR") {
        e.preventDefault();
        rejectSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [acceptSelected, rejectSelected, onAcceptAll, commitIfPossible]);

  return (
    <div className="review" role="region" aria-label="Review changes">
      <div className="rhead">
        <button type="button" className="back" onClick={onBack}>
          <Icon icon={ChevronLeft} size={12} />
          <span>Thread</span>
        </button>
        <span className="title">Review changes</span>
        <span className="meta">
          {threadTitle ? `${threadTitle} · ` : ""}
          {filesReady.length} file{filesReady.length === 1 ? "" : "s"} ·{" "}
          <span className="mint">+{added}</span> <span className="rose">−{removed}</span>
        </span>
        <span className="spacer" />
        <div className="prog">
          <span>
            {acceptedCount} of {filesReady.length} accepted
          </span>
          <span className="bar">
            <i style={{ width: filesReady.length ? `${(acceptedCount / filesReady.length) * 100}%` : "0%" }} />
          </span>
        </div>
      </div>

      <div className="cols">
        <div className="files">
          <div className="sl">
            <span>Files</span>
            <span className="sl-count">{filesReady.length}</span>
          </div>
          {files.state === "loading" ? <p className="changes-loading">{FILE_CHANGES_LOADING}</p> : null}
          {files.state === "error" ? <p className="changes-error">{FILE_CHANGES_LOAD_FAILURE}</p> : null}
          {files.state === "ready" && filesReady.length === 0 ? <p className="changes-empty">{FILES_EMPTY}</p> : null}
          {filesReady.map((member) => {
            const { dir, name } = splitPath(member.path);
            const counts = !member.diffUnavailable && member.diff ? countDiffLines(member.diff) : null;
            const flash = recoveryFlash?.[member.editId] ?? recoveryFlash?.[member.activityId];
            const dotClass = flash === "conflict" ? "conflict" : flash === "reverted" ? "idle" : fileDotClass(member.settlement);
            return (
              <button
                type="button"
                key={member.editId}
                className={member.editId === selectedMember?.editId ? "frow sel" : "frow"}
                onClick={() => selectFile(member.editId)}
              >
                <i className={`dot ${dotClass}`} aria-hidden="true" />
                <span className="fn" title={member.path}>
                  {dir ? <span className="dir">{dir}</span> : null}
                  {name}
                </span>
                {counts ? (
                  <span className="pm">
                    <span className="mint">+{counts.added}</span> <span className="rose">−{counts.removed}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
          <p className="fnote">Edits are on disk, so checks run against them. Forge doesn’t run git itself.</p>
        </div>

        <div className="diffcol">
          {selectedMember ? (
            <>
              <div className="dhead">
                <span>{selectedMember.path}</span>
                <span className="sub">
                  {hunks.length} hunk{hunks.length === 1 ? "" : "s"} ·{" "}
                  {isSettledForCommit(selectedMember.settlement) ? hunks.length : 0} accepted
                </span>
                <span className="spacer" />
                {queuedRequestId ? (
                  <>
                    <Button size="sm" variant="primary" className="mini ok" onClick={acceptSelected}>
                      <span>Accept file</span>
                      <kbd aria-hidden="true">⇧A</kbd>
                    </Button>
                    <Button size="sm" variant="ghost" className="mini" onClick={rejectSelected}>
                      <span>Reject file</span>
                      <kbd aria-hidden="true">⇧R</kbd>
                    </Button>
                  </>
                ) : null}
                {!queuedRequestId && selectedMember.settlement === "accepted" ? (
                  revertPendingEditId === selectedMember.editId ? (
                    <span className="mini">Reverting…</span>
                  ) : selectedMember.recoveryAvailable ? (
                    <Button size="sm" variant="ghost" className="mini" onClick={undoSelected}>
                      Undo
                    </Button>
                  ) : null
                ) : null}
              </div>
              <div className="dbody">
                {hunks.map((hunk, hunkIndex) => {
                  // W3-5: match the sub-header and the header/dot/Commit
                  // button's own isSettledForCommit — an "applied" file (no
                  // permission gate, e.g. auto-applied under Trusted
                  // workspace) is just as settled as an "accepted" one
                  // everywhere else this surface counts on "accepted".
                  const accepted = isSettledForCommit(selectedMember.settlement);
                  return (
                    <div className={accepted ? "hunk accepted" : "hunk"} key={hunkIndex}>
                      <div className="hh">
                        {hunk.range ? <span>{hunk.range}</span> : null}
                        {hunk.context ? <span>{hunk.context}</span> : null}
                        <span className="ha">
                          {accepted ? <span className="mint">accepted</span> : null}
                        </span>
                      </div>
                      {hunk.lines.map((line, lineIdx) => {
                        const isActiveLine =
                          activeComment?.hunkIndex === hunkIndex && activeComment.lineNo === line.no;
                        const headingId = `review-comment-heading-${hunkIndex}-${lineIdx}`;
                        return (
                          <div key={lineIdx}>
                            <button
                              type="button"
                              className={line.kind === "context" ? "ln" : `ln ${line.kind}`}
                              aria-label={`Comment on line ${line.no}`}
                              onClick={(e) => {
                                if (!isActiveLine) activeLineTriggerRef.current = e.currentTarget;
                                setActiveComment(
                                  isActiveLine ? null : { hunkIndex, lineNo: line.no },
                                );
                                setCommentDraft("");
                              }}
                            >
                              <span className={isActiveLine ? "no active" : "no"}>{line.no}</span>
                              <span>{line.text || " "}</span>
                            </button>
                            {isActiveLine ? (
                              <div className="lc">
                                <div className="lch">
                                  <i className="dot" aria-hidden="true" />
                                  <span id={headingId}>Comment on line {line.no}</span>
                                  <span className="lcs">goes to Grok with this hunk as context</span>
                                </div>
                                <textarea
                                  className="lct"
                                  aria-labelledby={headingId}
                                  value={commentDraft}
                                  onChange={(e) => setCommentDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "Enter") {
                                      e.preventDefault();
                                      sendComment();
                                    }
                                  }}
                                  autoFocus
                                />
                                <div className="lca">
                                  <Button size="sm" variant="primary" className="mini ok" onClick={sendComment}>
                                    <span>Send to Grok</span>
                                    <kbd aria-hidden="true">Ctrl+⏎</kbd>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="mini"
                                    onClick={() => {
                                      setActiveComment(null);
                                      setCommentDraft("");
                                    }}
                                  >
                                    Discard
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <div className="ask">
                <input
                  type="text"
                  aria-label="Ask Grok to change this file…"
                  placeholder={`Ask Grok to change this file… for example “keep the old key as a deprecated alias”`}
                  value={askFileDraft}
                  onChange={(e) => setAskFileDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      sendAskFile();
                    }
                  }}
                />
                <button type="button" className="send" aria-label="Send" onClick={sendAskFile}>
                  <Icon icon={CornerDownLeft} size={13} />
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="vcol">
          <div>
            <div className="sl">
              <span>Verify</span>
              {verifyAllGreen ? <span className="mint sl-trail">all green</span> : null}
            </div>
            {verify.state === "loading" ? <p className="changes-loading">{VERIFY_LOADING}</p> : null}
            {verify.state === "error" ? <p className="changes-error">{VERIFY_LOAD_FAILURE}</p> : null}
            {verify.state === "ready" && verifyReady.length === 0 ? <p className="changes-empty">{VERIFY_EMPTY}</p> : null}
            {verifyReady.map((member) => {
              const label = chipLabel(member);
              return (
                <div className="vrow" key={`${member.activityId}::${member.invocationId}`}>
                  <i className={`dot ${label === "Passed" ? "ok" : label === "Failed" ? "conflict" : "idle"}`} aria-hidden="true" />
                  <code className="vn" title={member.command}>
                    {member.command}
                  </code>
                  <span className={`vt vt-${label.toLowerCase().replace(/\s+/g, "-")}`}>{label}</span>
                </div>
              );
            })}
            {verifyReady.map((member) => {
              const raw = verifyOutputByActivityId?.get(member.activityId);
              if (raw == null) return null;
              const text = formatToolOutput(raw);
              if (!text) return null;
              return (
                <pre className="tests" key={`out-${member.activityId}::${member.invocationId}`}>
                  <span className="tests-label">{member.command} · raw output</span>
                  {"\n"}
                  {text}
                </pre>
              );
            })}
          </div>

          <div>
            <div className="sl">
              <span>Git</span>
            </div>
            {git.state === "loading" ? <p className="changes-loading">{GIT_REVIEW_LOADING}</p> : null}
            {git.state === "error" ? <p className="changes-error">{GIT_REVIEW_LOAD_FAILURE}</p> : null}
            {git.state === "ready" && gitReady.length === 0 ? <p className="changes-empty">{GIT_REVIEW_EMPTY}</p> : null}
            <div className="field">
              <label className="fl" htmlFor="review-commit-message">
                Commit message · drafted by Grok, yours to edit
              </label>
              <textarea
                id="review-commit-message"
                className="commit-message-input"
                value={commitDraft}
                placeholder="No commit message drafted yet — write one, or ask Grok for one."
                onChange={(e) => {
                  commitDraftTouchedRef.current = true;
                  setCommitDraft(e.target.value);
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Enter") {
                    e.preventDefault();
                    commitIfPossible();
                  }
                }}
              />
            </div>
            <div className="commit-row">
              <Button variant="primary" disabled={acceptedCount === 0} onClick={commitIfPossible}>
                <span>
                  Commit {acceptedCount} accepted file{acceptedCount === 1 ? "" : "s"}
                </span>
                <kbd aria-hidden="true">Ctrl+⇧⏎</kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="foot">
        <span className="sum">
          Accept keeps a file as Grok wrote it. Reject restores the copy Forge kept before the run,
          where available.
        </span>
        <span className="spacer" />
        <Button variant="ghost" onClick={onRejectAll}>
          Reject all
        </Button>
        <Button onClick={onAcceptAll}>
          <span>Accept all</span>
          <kbd aria-hidden="true">Ctrl+⇧A</kbd>
        </Button>
      </div>
    </div>
  );
}
