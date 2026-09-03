/**
 * Single sidebar shell — content switches with product mode:
 * - Chat: `New chat` CTA → search → Homes (each chat session is its own
 *   home) → Pack (the current home's pinned files, read-only summary) →
 *   footer. No git / folders — folder choice lives in the Pack `Add` action.
 * - Code: gradient CTA → search → Needs-you group → workspaces (one level
 *   deep: workspace header, then its sessions — no further nesting)
 */
import { memo, useMemo, useState } from "react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import {
  ChevronDown,
  ChevronRight,
  FileText,
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

/** Violet / cyan / muted only — amber is reserved for needs-you and must
 *  never appear here. Same hash as HomeScreen's own `swatchColor` (stable
 *  per home id, so a home's dot matches wherever it is shown) — kept as an
 *  independent copy rather than a shared import so this file's "Files:"
 *  scope stays limited to Sidebar.tsx. */
const HOME_SWATCH_COLORS = ["#a78bfa", "#5ce1ff", "#8b93a7"] as const;
export function homeSwatchColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return HOME_SWATCH_COLORS[hash % HOME_SWATCH_COLORS.length]!;
}

/** Last path segment for a pinned pack file's display name; full path stays
 *  in the row's title tooltip. */
function packFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

interface HomeRowProps {
  sess: ChatSession;
  active: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}

/** Chat's "Homes" row (34px, swatch + name + right-aligned count). The
 *  count is the home's real message count — the data model has no separate
 *  "threads per home" concept to report, so this is the honest analog. */
const HomeRow = memo(function HomeRow({
  sess,
  active,
  onSelect,
  onRename,
  onDelete,
}: HomeRowProps) {
  const [renaming, setRenaming] = useState(false);
  const untitled = defaultSessionTitle(sess.workspace);
  const [draft, setDraft] = useState(sess.title || untitled);
  const title = chatListTitle(sess);

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
        className={`home${active ? " on" : ""}`}
        onClick={onSelect}
        onDoubleClick={() => {
          if (onRename) {
            setDraft(sess.title || untitled);
            setRenaming(true);
          }
        }}
      >
        <span className="hm" style={{ background: homeSwatchColor(sess.id) }} aria-hidden="true" />
        <span
          className={`t session-title${title === HOME_NAME_PLACEHOLDER ? " is-placeholder" : ""}`}
        >
          {title}
        </span>
        <span className="n">{sess.messages.length}</span>
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

interface CodeSessionRowProps {
  sess: ChatSession;
  active: boolean;
  /** Live-derived word for a Needs-you row: "approve" (permission/diff) or
   * "question" (recovery_confirmation/plan). Falls back to "approve" if the
   * live run projection hasn't caught up yet on a freshly reloaded flag. */
  reason?: "approve" | "question";
  /** True when this row sits nested under a workspace header — indents it
   * to match the design's `.row.sub`. Needs-you rows stay at the base indent. */
  sub?: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}

/** Code's row: dot · single-line title · time-ago (or approve/question). */
const CodeSessionRow = memo(function CodeSessionRow({
  sess,
  active,
  reason,
  sub,
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
        className={`row ${active ? "active" : ""}${sub ? " sub" : ""}`}
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
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat?: (id: string, title: string) => void;
  onDeleteChat?: (id: string) => void;
  /** Pack section: the active home's pinned files (ChatPackView.members.files).
   *  Only path is ever guaranteed — page/size are shown only if a future
   *  ChatPackView actually reports them; this shell never invents either. */
  chatPackFiles?: Array<{ path: string }>;
  /** Pack section's `Add` action — opens the folder/file picker (this is
   *  also how a chat root folder gets bound; there is no separate "Local
   *  files" panel any more). Add is hidden when this is not provided.
   *  Binding repoints the shared chat root for all of Chat, not just the
   *  active home — see the `Add` button's own title tooltip. */
  onBindChatFolder?: () => void;
  /** The bound folder's display name (App.tsx's own `chatRootLabel`), or
   *  null/undefined while Chat is on the private sandbox. Gates the
   *  "Use private folder" action below — that action has nothing to do
   *  while nothing is bound. */
  chatRootLabel?: string | null;
  /** Pack section's "Use private folder" action — the way back from a
   *  bound folder (api.setChatRoot(null)). Shown only while chatRootLabel
   *  is set AND this is provided; never deletes anything, it only switches
   *  Chat back to the private sandbox partition. */
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
  /** Footer (both modes): "Grok · subscription" / "Grok · API key" (topbar's own auth source). */
  authLabel?: string;
  /** Footer (both modes): raw version string (e.g. "0.7.0"); rendered as "v0.7.0". */
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
  const chatPackFiles = props.chatPackFiles ?? [];

  return (
    <aside
      className={`sidebar side-shell mode-${mode}`}
      data-mode={mode}
      aria-label={mode === "chat" ? "Chat sessions" : "Code workspaces"}
    >
      {mode === "chat" ? (
        <div className="rail">
          <button type="button" className="cta" onClick={props.onNewChat}>
            <Icon icon={MessageSquarePlus} size={14} />
            <span>New chat</span>
          </button>

          <div className="search">
            <Icon icon={Search} size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
            />
            <kbd>Ctrl+P</kbd>
          </div>

          <div className="rail-tree">
            <div className="group">
              <div className="label">
                <span>Homes</span>
              </div>
              {chatFiltered.length === 0 ? (
                <p className="tree-empty">
                  {query
                    ? "No chats match."
                    : "No chats yet — start one. Separate from Code projects."}
                </p>
              ) : (
                <VirtualList
                  className="tree"
                  items={chatFiltered}
                  rowHeight={34}
                  getKey={(sess) => sess.id}
                  renderItem={(sess) => (
                    <HomeRow
                      sess={sess}
                      active={sess.id === props.activeSessionId}
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
                  )}
                />
              )}
            </div>

            <div className="group">
              <div className="label">
                <span>Pack</span>
                <span className="label-actions">
                  {props.chatRootLabel && props.onClearChatFolder && (
                    <button
                      type="button"
                      className="act"
                      onClick={props.onClearChatFolder}
                      title="Returns Chat to the private sandbox. Chats saved under the bound folder stay there — bind it again to see them."
                    >
                      Use private folder
                    </button>
                  )}
                  {props.onBindChatFolder && (
                    <button
                      type="button"
                      className="act"
                      onClick={props.onBindChatFolder}
                      title="Binds a folder to all of Chat, not just this home"
                    >
                      Add
                    </button>
                  )}
                </span>
              </div>
              {chatPackFiles.map((f) => (
                <div className="file" key={f.path} title={f.path}>
                  <Icon icon={FileText} size={13} />
                  <span className="fn">{packFileName(f.path)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="railfoot">
            <span className="avatar" aria-hidden="true" />
            <span>{props.authLabel ?? "Grok"}</span>
            <span className="ver mono">
              {props.version ? `v${props.version}` : "—"}
            </span>
          </div>
        </div>
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
                        sub
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
