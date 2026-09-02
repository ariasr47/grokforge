/**
 * Single sidebar shell — content switches with product mode:
 * - Chat: flat conversation list (no git / folders)
 * - Code: pinned workspaces → sessions (existing tree)
 */
import { memo, useMemo, useState } from "react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { FolderOpen, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
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
  /** Shared footer / chrome */
  pathInput?: string;
  onPathInputChange?: (v: string) => void;
  onPathOpen?: () => void;
  viewTab?: "messages" | "settings";
  onViewTab?: (v: "messages" | "settings") => void;
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

  const codeFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.workspaces;
    return props.workspaces
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

  return (
    <aside
      className={`sidebar side-shell mode-${mode}`}
      data-mode={mode}
      aria-label={mode === "chat" ? "Chat sessions" : "Code workspaces"}
    >
      <div className="side-mode-banner" aria-hidden>
        <span className={`side-mode-pill ${mode}`}>
          {mode === "chat" ? "Chat" : "Code"}
        </span>
        <span className="side-mode-hint">
          {mode === "chat"
            ? "Your conversations"
            : "Projects & agent sessions"}
        </span>
      </div>

      <div className="side-top">
        {mode === "chat" ? (
          <Button
            variant="primary"
            className="open-folder-btn"
            onClick={props.onNewChat}
          >
            <Icon icon={MessageSquarePlus} size={15} />
            New chat
          </Button>
        ) : props.workspaces.length === 0 ? (
          <Button
            variant="primary"
            className="open-folder-btn"
            onClick={props.onOpenFolder}
          >
            <Icon icon={FolderOpen} size={15} />
            Open folder…
          </Button>
        ) : null}
        <div className="side-top-search-row">
          <input
            className="session-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "chat" ? "Search chats…" : "Search projects & sessions…"
            }
            aria-label={mode === "chat" ? "Search chats" : "Search sessions"}
          />
          {mode === "code" && props.workspaces.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="open-folder-btn open-folder-btn-compact icon-only"
              onClick={props.onOpenFolder}
              title="Open folder…"
              aria-label="Open folder…"
            >
              <Icon icon={FolderOpen} size={15} />
            </Button>
          ) : null}
        </div>
      </div>

      {mode === "chat" ? (
        <>
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
        <>
          <div className="section-label">
            <span>Pinned workspaces</span>
            <span className="hint">folders · branches</span>
          </div>
          <div className="tree side-body">
            {codeFiltered.length === 0 && (
              <p className="tree-empty">
                {query
                  ? "No sessions match."
                  : "Open a folder to pin a project. Agent sessions nest under each workspace."}
              </p>
            )}
            {codeFiltered.map((ws) => (
              <div
                key={ws.path}
                className={`folder ${ws.expanded ? "expanded" : ""} ${
                  ws.active ? "active-ws" : ""
                }`}
              >
                <div className="folder-head-row">
                  <button
                    type="button"
                    className="folder-chevron"
                    aria-label={ws.expanded ? "Collapse" : "Expand"}
                    onClick={() => props.onToggleFolder(ws.path)}
                  >
                    {ws.expanded ? "▾" : "▸"}
                  </button>
                  <button
                    type="button"
                    className="folder-main"
                    onClick={() => props.onSelectWorkspace(ws.path)}
                    title={ws.path}
                  >
                    <span className="folder-name">
                      {ws.name || workspaceDisplayName(ws.path)}
                      <span className="pin">pinned</span>
                    </span>
                    <span className="folder-path">{ws.path}</span>
                    {ws.branch && (
                      <span className="branch folder-branch">{ws.branch}</span>
                    )}
                  </button>
                  <span className="folder-count">{ws.sessions.length}</span>
                </div>
                {ws.expanded && (
                  <div className="folder-body">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="new-session-btn"
                      onClick={() => props.onNewCodeSession(ws.path)}
                    >
                      <Icon icon={MessageSquarePlus} size={14} />
                      New session
                    </Button>
                    {ws.sessions.map((sess) => {
                      const isActive =
                        ws.path === props.activeWorkspace &&
                        sess.id === props.activeSessionId;
                      const subs = sess.subagents ?? [];
                      return (
                        <div key={sess.id} className="session">
                          <SessionRow
                            sess={sess}
                            active={isActive}
                            showBranch
                            branchLabel={sess.branch || ws.branch || "no-git"}
                            onSelect={() =>
                              props.onSelectCodeSession(ws.path, sess.id)
                            }
                            onRename={
                              props.onRenameCodeSession
                                ? (t) =>
                                    props.onRenameCodeSession!(
                                      ws.path,
                                      sess.id,
                                      t,
                                    )
                                : undefined
                            }
                            onDelete={
                              props.onDeleteCodeSession
                                ? () =>
                                    props.onDeleteCodeSession!(
                                      ws.path,
                                      sess.id,
                                    )
                                : undefined
                            }
                          />
                          {mode !== "code" &&
                            props.showSubagents !== false &&
                            subs.length > 0 && (
                              <div
                                className="subagents"
                                aria-label="Subagents"
                              >
                                {subs.map((sub) => (
                                  <button
                                    key={sub.id}
                                    type="button"
                                    className="subagent"
                                    onClick={() =>
                                      props.onSelectSubagent?.(
                                        ws.path,
                                        sess.id,
                                        sub,
                                      )
                                    }
                                  >
                                    <span
                                      className={`sub-ico ${
                                        sub.role === "explore"
                                          ? "explore"
                                          : sub.role === "plan"
                                            ? "plan"
                                            : ""
                                      }`}
                                    />
                                    <span>
                                      <span className="sub-name">
                                        {sub.name}
                                      </span>
                                      <span className="sub-meta">
                                        <span className="sub-role">
                                          {sub.role}
                                        </span>
                                        <span className="branch">
                                          {sub.branch ||
                                            sess.branch ||
                                            ws.branch ||
                                            "—"}
                                        </span>
                                      </span>
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {props.workspaces.length > 0 ? (
            <details className="sidebar-path-row sidebar-path-more">
              <summary>Paste a path</summary>
              <div className="sidebar-path-fields">
                <input
                  id="workspace-path"
                  value={props.pathInput ?? ""}
                  onChange={(e) => props.onPathInputChange?.(e.target.value)}
                  placeholder="Paste project path…"
                  aria-label="Workspace path"
                />
                <Button onClick={() => props.onPathOpen?.()}>
                  Open
                </Button>
              </div>
            </details>
          ) : (
            <div className="sidebar-path-row">
              <input
                id="workspace-path"
                value={props.pathInput ?? ""}
                onChange={(e) => props.onPathInputChange?.(e.target.value)}
                placeholder="Paste project path…"
                aria-label="Workspace path"
              />
              <Button onClick={() => props.onPathOpen?.()}>
                Open
              </Button>
            </div>
          )}
        </>
      )}

      <div className="nav-tabs sidebar-nav-tabs">
        <button
          type="button"
          className={props.viewTab !== "settings" ? "active" : ""}
          onClick={() => props.onViewTab?.("messages")}
        >
          Messages
        </button>
        <button
          type="button"
          className={props.viewTab === "settings" ? "active" : ""}
          onClick={() => props.onViewTab?.("settings")}
        >
          Settings
        </button>
      </div>

      <div className="side-foot">
        {mode === "chat" ? (
          <>
            Chat history is separate from Code.
            <br />
            <kbd>Ctrl+N</kbd> new chat · <kbd>Ctrl+K</kbd> commands
          </>
        ) : (
          <>
            Sessions nest under pinned folders.
            <br />
            <kbd>Ctrl+K</kbd> · <kbd>Ctrl+L</kbd> composer · <kbd>Ctrl+N</kbd>
          </>
        )}
      </div>
    </aside>
  );
});

/** @deprecated use Sidebar — kept for import compatibility */
export { Sidebar as SidebarTree };
