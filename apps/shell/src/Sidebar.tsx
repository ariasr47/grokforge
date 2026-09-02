/**
 * Single sidebar shell — content switches with product mode:
 * - Chat: flat conversation list (no git / folders)
 * - Code: gradient CTA → search → Needs-you group → workspaces (one level
 *   deep: workspace header, then its sessions — no further nesting)
 */
import { memo, useMemo, useState } from "react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  MessageSquarePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { ChatSession, SubagentRecord } from "./sessions";
import { chatListTitle, defaultSessionTitle, workspaceDisplayName } from "./sessions";
import { HOME_NAME_PLACEHOLDER } from "./chatPackComposer";
import { timeAgo } from "./timeAgo";
import type { ProductMode } from "./api";
import { VirtualList } from "./VirtualList";

export interface WorkspaceNode {
  path: string;
  name: string;
  branch: string | null;
  sessions: ChatSession[];
  expanded: boolean;
  active: boolean;
}

function statusDot(status?: string): string {
  if (status === "live") return "live";
  if (status === "busy") return "busy";
  return "idle";
}

interface SessionRowProps {
  sess: ChatSession;
  active: boolean;
  /** Code mode shows branch; Chat never does */
  showBranch?: boolean;
  branchLabel?: string | null;
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}

/** Chat's own row — unchanged; Code uses `CodeSessionRow` below. */
const SessionRow = memo(function SessionRow({
  sess,
  active,
  showBranch,
  branchLabel,
  onSelect,
  onRename,
  onDelete,
}: SessionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const untitled = defaultSessionTitle(sess.workspace);
  const [draft, setDraft] = useState(sess.title || untitled);

  if (renaming) {
    return (
      <form
        className="session-rename"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (t) onRename?.(t);
          setRenaming(false);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          aria-label="Rename session"
          onKeyDown={(e) => {
            if (e.key === "Escape") setRenaming(false);
          }}
        />
        <button type="submit" className="btn ghost">
          Save
        </button>
      </form>
    );
  }

  return (
    <div className={`session-row-wrap ${active ? "active" : ""}`}>
      <button
        type="button"
        className={`session-row ${active ? "active" : ""}`}
        onClick={onSelect}
        onDoubleClick={() => {
          if (onRename) {
            setDraft(sess.title || untitled);
            setRenaming(true);
          }
        }}
      >
        <span
          className={`dot ${statusDot(sess.status)}`}
          title={sess.status || "idle"}
        />
        <span className="session-body">
          <span
            className={`session-title${
              !showBranch && chatListTitle(sess) === HOME_NAME_PLACEHOLDER ? " is-placeholder" : ""
            }`}
          >
            {!showBranch ? chatListTitle(sess) : sess.title || untitled}
          </span>
          <span className="session-sub">
            {showBranch ? (
              <span className="branch">{branchLabel || "no-git"}</span>
            ) : null}
            <span className="session-time">{timeAgo(sess.updatedAt)}</span>
            {sess.status === "busy" && (
              <span className="badge running">streaming</span>
            )}
            {showBranch && sess.status === "live" && (
              <span className="badge running">agent</span>
            )}
          </span>
        </span>
      </button>
      <div className="session-ops">
        {onRename && (
          <Button
            variant="ghost"
            size="sm"
            className="sess-op icon-only"
            title="Rename"
            onClick={() => {
              setDraft(sess.title || untitled);
              setRenaming(true);
            }}
          >
            <Icon icon={Pencil} size={14} />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="sess-op icon-only"
            title="Delete"
            onClick={() => {
              if (
                window.confirm(`Delete “${sess.title || untitled}”?`)
              ) {
                onDelete();
              }
            }}
          >
            <Icon icon={Trash2} size={14} />
          </Button>
        )}
      </div>
    </div>
  );
});

interface CodeSessionRowProps {
  sess: ChatSession;
  active: boolean;
  /** Live-derived word for a Needs-you row: "approve" (permission/diff) or
   * "question" (recovery_confirmation/plan). Falls back to "approve" if the
   * live run projection hasn't caught up yet on a freshly reloaded flag. */
  reason?: "approve" | "question";
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}

/** Code's row: dot · single-line title · time-ago (or approve/question). */
const CodeSessionRow = memo(function CodeSessionRow({
  sess,
  active,
  reason,
  onSelect,
  onRename,
  onDelete,
}: CodeSessionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const untitled = defaultSessionTitle(sess.workspace);
  const [draft, setDraft] = useState(sess.title || untitled);
  const title = sess.title || untitled;

  if (renaming) {
    return (
      <form
        className="session-rename"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (t) onRename?.(t);
          setRenaming(false);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          aria-label="Rename session"
          onKeyDown={(e) => {
            if (e.key === "Escape") setRenaming(false);
          }}
        />
        <button type="submit" className="btn ghost">
          Save
        </button>
      </form>
    );
  }

  const dotClass = sess.needsYou
    ? "needs"
    : sess.status === "busy" || sess.status === "live"
      ? "live"
      : "done";

  return (
    <div className={`session-row-wrap ${active ? "active" : ""}`}>
      <button
        type="button"
        className={`row ${active ? "active" : ""}`}
        onClick={onSelect}
        onDoubleClick={() => {
          if (onRename) {
            setDraft(title);
            setRenaming(true);
          }
        }}
      >
        <span
          className={`dot ${dotClass}`}
          title={sess.needsYou ? "Needs you" : sess.status || "idle"}
        />
        <span className="t">{title}</span>
        <span className={`when${sess.needsYou ? " needs" : ""}`}>
          {sess.needsYou ? (reason ?? "approve") : timeAgo(sess.updatedAt)}
        </span>
      </button>
      <div className="session-ops">
        {onRename && (
          <Button
            variant="ghost"
            size="sm"
            className="sess-op icon-only"
            title="Rename"
            onClick={() => {
              setDraft(title);
              setRenaming(true);
            }}
          >
            <Icon icon={Pencil} size={14} />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="sess-op icon-only"
            title="Delete"
            onClick={() => {
              if (window.confirm(`Delete “${title}”?`)) {
                onDelete();
              }
            }}
          >
            <Icon icon={Trash2} size={14} />
          </Button>
        )}
      </div>
    </div>
  );
});

export interface SidebarProps {
  mode: ProductMode;
  /** Chat */
  chatSessions: ChatSession[];
  chatRootLabel?: string | null;
  showChatFiles?: boolean;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat?: (id: string, title: string) => void;
  onDeleteChat?: (id: string) => void;
  onBindChatFolder?: () => void;
  onClearChatFolder?: () => void;
  /** Code */
  workspaces: WorkspaceNode[];
  activeWorkspace: string | null;
  activeSessionId: string | null;
  onOpenFolder: () => void;
  onToggleFolder: (path: string) => void;
  onSelectWorkspace: (path: string) => void;
  onSelectCodeSession: (workspace: string, sessionId: string) => void;
  onNewCodeSession: (workspace: string) => void;
  onRenameCodeSession?: (
    workspace: string,
    sessionId: string,
    title: string,
  ) => void;
  onDeleteCodeSession?: (workspace: string, sessionId: string) => void;
  onSelectSubagent?: (
    workspace: string,
    sessionId: string,
    sub: SubagentRecord,
  ) => void;
  showSubagents?: boolean;
  /** Code: live word ("approve"/"question") per session id currently in the
   * Needs-you group, derived from the active run projection. */
  needsYouReasons?: Record<string, "approve" | "question">;
  /** Code footer: "Grok · subscription" / "Grok · API key" (topbar's own auth source). */
  authLabel?: string;
  /** Code footer: raw version string (e.g. "0.7.0"); rendered as "v0.7.0". */
  version?: string | null;
}

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const { mode } = props;
  const [query, setQuery] = useState("");

  const chatFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...props.chatSessions].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    if (!q) return list;
    return list.filter((s) =>
      (s.title || "New chat").toLowerCase().includes(q),
    );
  }, [props.chatSessions, query]);

  // Needs-you sessions are pulled out of their workspace's row list and
  // shown once, at the top — never duplicated in both places.
  const needsYouList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const flat = props.workspaces.flatMap((ws) =>
      ws.sessions.filter((s) => s.needsYou === true),
    );
    const filtered = q
      ? flat.filter((s) => (s.title || "").toLowerCase().includes(q))
      : flat;
    return filtered.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }, [props.workspaces, query]);

  const codeFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = props.workspaces.map((ws) => ({
      ...ws,
      sessions: ws.sessions.filter((s) => s.needsYou !== true),
    }));
    if (!q) return base;
    return base
      .map((ws) => ({
        ...ws,
        sessions: ws.sessions.filter(
          (s) =>
            (s.title || "").toLowerCase().includes(q) ||
            ws.name.toLowerCase().includes(q) ||
            ws.path.toLowerCase().includes(q),
        ),
        expanded: true,
      }))
      .filter(
        (ws) =>
          ws.sessions.length > 0 ||
          ws.name.toLowerCase().includes(q) ||
          ws.path.toLowerCase().includes(q),
      );
  }, [props.workspaces, query]);

  const hasWorkspaces = props.workspaces.length > 0;
  const ctaTarget = props.activeWorkspace ?? props.workspaces[0]?.path ?? null;
  const nothingToShow = needsYouList.length === 0 && codeFiltered.length === 0;

  return (
    <aside
      className={`sidebar side-shell mode-${mode}`}
      data-mode={mode}
      aria-label={mode === "chat" ? "Chat sessions" : "Code workspaces"}
    >
      {mode === "chat" ? (
        <>
          <div className="side-top">
            <Button
              variant="primary"
              className="open-folder-btn"
              onClick={props.onNewChat}
            >
              <Icon icon={MessageSquarePlus} size={15} />
              New chat
            </Button>
            <div className="side-top-search-row">
              <input
                className="session-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats…"
                aria-label="Search chats"
              />
            </div>
          </div>

          <div className="section-label">
            <span>Chats</span>
            <span className="hint">{props.chatSessions.length}</span>
          </div>
          <VirtualList
            className="tree side-body"
            items={chatFiltered}
            rowHeight={58}
            getKey={(sess) => sess.id}
            empty={
              <p className="tree-empty">
                {query
                  ? "No chats match."
                  : "No chats yet — start one. Separate from Code projects."}
              </p>
            }
            renderItem={(sess) => (
              <div className="session">
                <SessionRow
                  sess={sess}
                  active={sess.id === props.activeSessionId}
                  showBranch={false}
                  onSelect={() => props.onSelectChat(sess.id)}
                  onRename={
                    props.onRenameChat
                      ? (t) => props.onRenameChat!(sess.id, t)
                      : undefined
                  }
                  onDelete={
                    props.onDeleteChat
                      ? () => props.onDeleteChat!(sess.id)
                      : undefined
                  }
                />
              </div>
            )}
          />

          {props.showChatFiles !== false && (
            <div className="chat-files-panel">
              <div className="section-label">
                <span>Local files</span>
                <span className="hint">optional</span>
              </div>
              <p className="chat-files-copy">
                {props.chatRootLabel
                  ? `Tools can use: ${props.chatRootLabel}`
                  : "Private folder by default. Open a documents folder so Grok can read your files."}
              </p>
              <div className="row chat-files-actions">
                {props.onBindChatFolder && (
                  <Button onClick={props.onBindChatFolder}>
                    {props.chatRootLabel ? "Change folder…" : "Open folder…"}
                  </Button>
                )}
                {props.chatRootLabel && props.onClearChatFolder && (
                  <Button variant="ghost" onClick={props.onClearChatFolder}>
                    Use private folder
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rail">
          <button
            type="button"
            className="cta open-folder-btn"
            onClick={() => {
              if (hasWorkspaces) {
                if (ctaTarget) props.onNewCodeSession(ctaTarget);
              } else {
                props.onOpenFolder();
              }
            }}
          >
            <Icon icon={hasWorkspaces ? Plus : FolderOpen} size={14} />
            <span>{hasWorkspaces ? "New session" : "Open folder…"}</span>
          </button>

          <div className="search">
            <Icon icon={Search} size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions"
              aria-label="Search sessions"
            />
            <kbd>Ctrl+P</kbd>
          </div>

          <div className="rail-tree">
            {nothingToShow && (
              <p className="tree-empty">
                {query
                  ? "No sessions match."
                  : "Open a folder to pin a project. Agent sessions nest under each workspace."}
              </p>
            )}

            {needsYouList.length > 0 && (
              <div className="group needs-you">
                <div className="label">
                  <span>Needs you</span>
                  <span className="count amber">{needsYouList.length}</span>
                </div>
                {needsYouList.map((sess) => (
                  <CodeSessionRow
                    key={sess.id}
                    sess={sess}
                    active={
                      sess.workspace === props.activeWorkspace &&
                      sess.id === props.activeSessionId
                    }
                    reason={props.needsYouReasons?.[sess.id]}
                    onSelect={() =>
                      props.onSelectCodeSession(sess.workspace, sess.id)
                    }
                    onRename={
                      props.onRenameCodeSession
                        ? (t) =>
                            props.onRenameCodeSession!(sess.workspace, sess.id, t)
                        : undefined
                    }
                    onDelete={
                      props.onDeleteCodeSession
                        ? () => props.onDeleteCodeSession!(sess.workspace, sess.id)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}

            {codeFiltered.map((ws) => {
              const anyLive = ws.sessions.some(
                (s) => s.status === "busy" || s.status === "live",
              );
              return (
                <div className="group" key={ws.path}>
                  <button
                    type="button"
                    className="wshead"
                    onClick={() => props.onToggleFolder(ws.path)}
                    title={ws.path}
                    aria-expanded={ws.expanded}
                  >
                    <span className="ch">
                      <Icon icon={ws.expanded ? ChevronDown : ChevronRight} size={12} />
                    </span>
                    <span>{ws.name || workspaceDisplayName(ws.path)}</span>
                    <span className="br mono">{ws.branch || "no-git"}</span>
                    {anyLive && <span className="dot live" />}
                    <span className="count">{ws.sessions.length}</span>
                  </button>
                  {ws.expanded &&
                    ws.sessions.map((sess) => (
                      <CodeSessionRow
                        key={sess.id}
                        sess={sess}
                        active={
                          ws.path === props.activeWorkspace &&
                          sess.id === props.activeSessionId
                        }
                        onSelect={() =>
                          props.onSelectCodeSession(ws.path, sess.id)
                        }
                        onRename={
                          props.onRenameCodeSession
                            ? (t) =>
                                props.onRenameCodeSession!(ws.path, sess.id, t)
                            : undefined
                        }
                        onDelete={
                          props.onDeleteCodeSession
                            ? () => props.onDeleteCodeSession!(ws.path, sess.id)
                            : undefined
                        }
                      />
                    ))}
                </div>
              );
            })}
          </div>

          <div className="railfoot">
            <span className="avatar" aria-hidden="true" />
            <span>{props.authLabel ?? "Grok"}</span>
            <span className="ver mono">
              {props.version ? `v${props.version}` : "—"}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
});

/** @deprecated use Sidebar — kept for import compatibility */
export { Sidebar as SidebarTree };
