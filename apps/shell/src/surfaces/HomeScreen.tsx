/**
 * Task 13 — Home screen (docs/design/forge-next/Home.dc.html). Replaces
 * EmptyStates' old `ready`/`no-workspace` kinds: the landing surface shown
 * whenever the engine is up, the operator is signed in, and no transcript
 * is on screen. Unlike the old per-mode empty states, Home is mode-agnostic
 * — it is the one place that can jump into either a Code workspace or a
 * Chat home, so both "Recent" (Code) and "Chat homes" render regardless of
 * which product mode happens to be selected right now.
 *
 * House/guest split: every fact rendered here comes from a prop supplied by
 * the caller (App.tsx), sourced from real, already-computed state — nothing
 * is invented. Two facts the brief asked for turned out not to exist
 * anywhere in the app:
 *   - There is no OS user name available anywhere (grepped `state`,
 *     `desktopBridge`, `api.ts` — no such field). `greetingName` is honest
 *     about this: pass `null` and the greeting renders with no name at all
 *     ("Good morning.") rather than a placeholder like "there".
 *   - There is no "what finished since your last visit" signal (no
 *     last-seen timestamp is persisted anywhere). So there is deliberately
 *     no prop for it on `HomeScreenProps` — not even one a future caller
 *     could be tempted to fill with a guess. The needs-you count is the
 *     only subline fact this screen can ever show.
 */
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FolderOpen, MessageSquarePlus, Plus, Search, ArrowUp } from "lucide-react";
import { BrandMark } from "../chrome/BrandMark";
import { Icon } from "../ui/Icon";
import { timeAgo } from "../lib/timeAgo";
import { MAX_PER_WS } from "../lib/sessions";

export interface HomeNeedsYouItem {
  workspace: string;
  id: string;
  title: string;
  /** Live-derived word, same vocabulary as the sidebar's Needs-you rows. */
  reason?: "approve" | "question";
}

export interface HomeRecentWorkspace {
  path: string;
  name: string;
  /** Last-known branch for this workspace's most recent session, or null
   *  when none is on record — rendered as an omission, never a guess. */
  branch: string | null;
  sessionCount: number;
  lastSessionId: string;
  lastTitle: string;
  updatedAt: number;
}

export interface HomeChatHome {
  id: string;
  title: string;
  /** Truncated preview of the most recent message, or null when the home
   *  has no messages yet. */
  preview: string | null;
  updatedAt: number;
}

export interface HomeFooterFacts {
  version: string | null;
  /** Installer-honesty line (installerHonesty.ts), or null when this isn't
   *  a packaged, unsigned Windows install. */
  installerWarning: string | null;
  /** e.g. "Grok · subscription" / "Grok · API key" — same copy as the rail footer. */
  authLabel: string;
  /** channelBadge() — "DEV" / "TST", or null on prod. */
  channel: string | null;
  /** W3-10: isPackagedWindowsInstallerSession() (installerHonesty.ts) — real
   *  Tauri + user-agent check, not an assumption. The "· Windows" suffix
   *  below is omitted, not hardcoded, when this session can't verify it. */
  isPackagedWindows: boolean;
}

export interface HomeScreenProps {
  /** Injectable clock for deterministic greeting tests; defaults to now. */
  now?: Date;
  greetingName: string | null;
  needsYou: HomeNeedsYouItem[];
  recentWorkspaces: HomeRecentWorkspace[];
  chatHomes: HomeChatHome[];
  footer: HomeFooterFacts;
  onFieldQuery: (text: string) => void;
  onOpenNeedsYou: (workspace: string, id: string) => void;
  onOpenWorkspace: (path: string, lastSessionId: string) => void;
  onOpenChatHome: (id: string) => void;
  onAllSessions: () => void;
  onNewChatHome: () => void;
  onOpenFolder: () => void;
  onNewSession: () => void;
  onNewChat: () => void;
}

export function greetingLine(now: Date, name: string | null): string {
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return name ? `Good ${part}, ${name}.` : `Good ${part}.`;
}

const SWATCH_COLORS = ["var(--accent2)", "var(--accent)", "var(--muted)"];
/** Deterministic per-home accent — cosmetic only, no fact is claimed by it. */
function swatchColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return SWATCH_COLORS[hash % SWATCH_COLORS.length]!;
}

type RovingItem =
  | { kind: "needs"; key: string; workspace: string; id: string }
  | { kind: "workspace"; key: string; path: string; lastSessionId: string }
  | { kind: "home"; key: string; id: string };

// App re-renders on every streamed token while a run is live; memoizing
// keeps Home inert (no wasted reconciliation of ~20 rows) on ticks where
// none of its own props actually changed — which matters because Home CAN
// be on screen mid-stream (e.g. the moment right after a mode switch,
// before the next turn's first message lands).
export const HomeScreen = memo(function HomeScreen(props: HomeScreenProps) {
  const {
    now = new Date(),
    greetingName,
    needsYou,
    recentWorkspaces,
    chatHomes,
    footer,
    onFieldQuery,
    onOpenNeedsYou,
    onOpenWorkspace,
    onOpenChatHome,
    onAllSessions,
    onNewChatHome,
    onOpenFolder,
    onNewSession,
    onNewChat,
  } = props;

  const [fieldValue, setFieldValue] = useState("");
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const rovingItems: RovingItem[] = useMemo(
    () => [
      ...needsYou.map(
        (n): RovingItem => ({ kind: "needs", key: `needs:${n.id}`, workspace: n.workspace, id: n.id }),
      ),
      ...recentWorkspaces.map(
        (w): RovingItem => ({ kind: "workspace", key: `ws:${w.path}`, path: w.path, lastSessionId: w.lastSessionId }),
      ),
      ...chatHomes.map((c): RovingItem => ({ kind: "home", key: `home:${c.id}`, id: c.id })),
    ],
    [needsYou, recentWorkspaces, chatHomes],
  );
  const indexByKey = useMemo(() => {
    const m = new Map<string, number>();
    rovingItems.forEach((item, i) => m.set(item.key, i));
    return m;
  }, [rovingItems]);

  // The first Needs-you item (or, absent any, the first item at all) takes
  // focus once, on mount — never re-stolen by a later data refresh.
  const focusedOnMount = useRef(false);
  useEffect(() => {
    if (focusedOnMount.current) return;
    if (rovingItems.length === 0) return;
    focusedOnMount.current = true;
    itemRefs.current[0]?.focus();
  }, [rovingItems]);

  const activate = (item: RovingItem) => {
    if (item.kind === "needs") onOpenNeedsYou(item.workspace, item.id);
    else if (item.kind === "workspace") onOpenWorkspace(item.path, item.lastSessionId);
    else onOpenChatHome(item.id);
  };

  const onItemKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      itemRefs.current[Math.min(index + 1, rovingItems.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemRefs.current[Math.max(index - 1, 0)]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(rovingItems[index]!);
    }
  };

  const needsYouCount = needsYou.length;
  const subline =
    needsYouCount > 0
      ? `${needsYouCount} session${needsYouCount === 1 ? "" : "s"} ${needsYouCount === 1 ? "needs" : "need"} you.`
      : null;

  return (
    <div className="home">
      <div className="home-hero">
        <BrandMark className="brand-mark brand-mark-lg" />
        <h1>{greetingLine(now, greetingName)}</h1>
        {subline && (
          <p className="home-sub">
            <strong className="amber">{subline}</strong>
          </p>
        )}
      </div>

      <div className="home-field">
        <Icon icon={Search} size={16} />
        <input
          className="home-field-input"
          value={fieldValue}
          onChange={(e) => {
            setFieldValue(e.target.value);
            onFieldQuery(e.target.value);
          }}
          placeholder="Search sessions…"
          aria-label="Search sessions"
        />
        <button
          type="button"
          className="home-go"
          onClick={() => onFieldQuery(fieldValue)}
          aria-label="Search"
        >
          <Icon icon={ArrowUp} size={16} />
        </button>
      </div>

      {/* W3-6: @ file and / command hints lived here but only mean anything
          in the composer — this field only searches sessions (onFieldQuery
          → openPalette("sessions", …)). Dropped rather than left to promise
          composer behavior this field doesn't have. */}
      <div className="home-hints">
        <span><kbd>Ctrl+O</kbd> open folder</span>
        <span><kbd>Ctrl+N</kbd> new session</span>
        <span><kbd>Ctrl+Shift+N</kbd> new chat</span>
      </div>

      <div className="home-grid">
        <div className="home-col">
          {needsYouCount > 0 && (
            <>
              <div className="home-sl">
                <span>Needs you</span>
                <span className="amber">{needsYouCount}</span>
              </div>
              {needsYou.map((n) => {
                const key = `needs:${n.id}`;
                const idx = indexByKey.get(key)!;
                const focused = focusedKey === key;
                return (
                  <button
                    key={key}
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    type="button"
                    className={`home-item needs${focused ? " focus" : ""}`}
                    onClick={() => onOpenNeedsYou(n.workspace, n.id)}
                    onFocus={() => setFocusedKey(key)}
                    onKeyDown={(e) => onItemKeyDown(e, idx)}
                  >
                    <span className="home-ic">
                      <span className="dot needs" />
                    </span>
                    <span className="home-tx">
                      <span className="home-t">{n.title}</span>
                    </span>
                    <span className="home-when needs">{n.reason ?? "approve"}</span>
                    {focused && <kbd className="home-k">⏎</kbd>}
                  </button>
                );
              })}
            </>
          )}

          <div className={`home-sl${needsYouCount > 0 ? " home-sl-gap" : ""}`}>
            <span>Recent</span>
            <button type="button" className="home-act" onClick={onAllSessions}>
              All sessions
            </button>
          </div>
          {recentWorkspaces.length === 0 ? (
            <p className="home-empty">Open a folder to start your first workspace.</p>
          ) : (
            recentWorkspaces.map((w) => {
              const key = `ws:${w.path}`;
              const idx = indexByKey.get(key)!;
              const focused = focusedKey === key;
              return (
                <button
                  key={key}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  className={`home-item${focused ? " focus" : ""}`}
                  onClick={() => onOpenWorkspace(w.path, w.lastSessionId)}
                  onFocus={() => setFocusedKey(key)}
                  onKeyDown={(e) => onItemKeyDown(e, idx)}
                >
                  <span className="home-ic">
                    <Icon icon={FolderOpen} size={14} />
                  </span>
                  <span className="home-tx">
                    <span className="home-t">
                      {w.name}
                      {/* W3-10: sessions.ts only stamps a session's branch
                          once and never overwrites an already-set value
                          (ensureActiveSession/setWorkspaceBranchAll both
                          check `!found.branch` first) — this is the branch
                          as of the last session opened here, not a live git
                          read. The title says so; the chip stays compact. */}
                      {w.branch && (
                        <span
                          className="mono home-branch"
                          title={`${w.branch} — as of the last session opened here, not a live git read`}
                        >
                          {w.branch}
                        </span>
                      )}
                    </span>
                    <span className="home-s">
                      {/* W3-10: the stored list is capped at MAX_PER_WS — at
                          the cap an older session already silently fell off,
                          so "N" alone can't be told apart from "N or more". */}
                      {w.sessionCount}
                      {w.sessionCount >= MAX_PER_WS ? "+" : ""} session
                      {w.sessionCount === 1 ? "" : "s"} · {w.lastTitle}
                    </span>
                  </span>
                  <span className="home-when">{timeAgo(w.updatedAt)}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="home-col">
          <div className="home-sl">
            <span>Chat homes</span>
            <button type="button" className="home-act" onClick={onNewChatHome}>
              New home
            </button>
          </div>
          {chatHomes.length === 0 ? (
            <p className="home-empty">Start a chat to create your first home.</p>
          ) : (
            chatHomes.map((c) => {
              const key = `home:${c.id}`;
              const idx = indexByKey.get(key)!;
              const focused = focusedKey === key;
              return (
                <button
                  key={key}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  className={`home-item${focused ? " focus" : ""}`}
                  onClick={() => onOpenChatHome(c.id)}
                  onFocus={() => setFocusedKey(key)}
                  onKeyDown={(e) => onItemKeyDown(e, idx)}
                >
                  <span className="home-hm" style={{ background: swatchColor(c.id) }} />
                  <span className="home-tx">
                    <span className="home-t">{c.title}</span>
                    {c.preview && <span className="home-s">{c.preview}</span>}
                  </span>
                  <span className="home-when">{timeAgo(c.updatedAt)}</span>
                </button>
              );
            })
          )}

          <div className="home-sl home-sl-gap">
            <span>Start</span>
          </div>
          <button type="button" className="home-quick" onClick={onOpenFolder}>
            <Icon icon={FolderOpen} size={14} />
            <span>Open a folder as a Code workspace</span>
            <kbd>Ctrl+O</kbd>
          </button>
          <button type="button" className="home-quick" onClick={onNewSession}>
            <Icon icon={Plus} size={14} />
            <span>New session in the last workspace</span>
            <kbd>Ctrl+N</kbd>
          </button>
          <button type="button" className="home-quick" onClick={onNewChat}>
            <Icon icon={MessageSquarePlus} size={14} />
            <span>New chat in a home</span>
            <kbd>Ctrl+Shift+N</kbd>
          </button>
        </div>
      </div>

      <div className="home-foot">
        <span>
          {`Forge${footer.version ? ` ${footer.version}` : ""}${footer.isPackagedWindows ? " · Windows" : ""}`}
        </span>
        {footer.installerWarning && <span className="home-warn">{footer.installerWarning}</span>}
        <span className="home-foot-spacer" />
        <span>{footer.authLabel}</span>
        {footer.channel && <span>{footer.channel}</span>}
      </div>
    </div>
  );
});
