import {
  api,
  ApiError,
  channelBadge,
  restartDesktopHost,
  MODEL_PRESETS,
  type PublicState,
  type TrustedCommandClassesView,
} from "../lib/api";
import { checkForAppUpdate, installAppUpdate, type UpdateStatus } from "../lib/desktopUpdate";
import {
  downloadSessionsExport,
  importSessionsJson,
  pickImportFile,
} from "../lib/sessionIO";
import { listSessions, type ChatSession } from "../lib/sessions";
import {
  SETTINGS_UNSIGNED_LINE,
  SHA_TITLE,
  shaSettingsLabel,
  type InstallerShaVoucher,
} from "../lib/installerHonesty";
import { patchPrefs, themeLabel, type Prefs } from "../lib/prefs";
import type { ToastKind } from "../thread/Toast";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Switch } from "../ui/Switch";
import { TextField } from "../ui/TextField";
import { Hint } from "../ui/Tooltip";
import { RefreshCw } from "lucide-react";
import { ConnectorsPanel } from "./ConnectorsPanel";
import { PolicyControls } from "../composer/PolicyControls";
import {
  TrustedCommandClassesControl,
  type TrustedCommandClassesStatus,
} from "../composer/TrustedCommandClassesControl";

/**
 * Mirrors `App.tsx`'s own (unexported) `OAuthPending` shape — the OAuth
 * device-code payload. Duplicated here rather than exporting App.tsx's copy
 * and importing it back (which would make a type-only App<->SettingsView
 * cycle for no real benefit): this shape is the OAuth server response
 * contract, not something the two files would ever need to evolve
 * independently without both call sites failing to typecheck anyway.
 */
interface OAuthPending {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}

export interface SettingsViewProps {
  tauri: boolean;
  buildInfo: {
    version?: string;
    channel?: string;
    channelLabel?: string;
    installerShaVoucher: InstallerShaVoucher;
  } | null;
  state: PublicState | null;
  /** App.tsx's own `chip = useMemo(() => statusChip(state), [state])`. */
  chip: { text: string; className: string };
  sessionId: string | null;
  hostOk: boolean;
  runStartedAt: number | null;
  /** Matches `applyState`'s real signature in App.tsx. */
  applyState: (payload: PublicState) => void;
  classesStatus: TrustedCommandClassesStatus;
  classesView: TrustedCommandClassesView | null;
  setClassesView: (view: TrustedCommandClassesView) => void;
  /** App.tsx's own `toast = useToast()`. Only `push` is read here. */
  toast: { push: (message: string, kind?: ToastKind) => void };
  startGrokSignIn: () => void;
  /** Matches `reportError`'s real signature in App.tsx. */
  reportError: (message: string, meta?: Record<string, unknown>) => void;
  engineRetryAllowed: boolean;
  bootApp: () => Promise<void>;
  oauth: OAuthPending | null;
  setOauth: (value: OAuthPending | null) => void;
  apiKeyDraft: string;
  setApiKeyDraft: (value: string) => void;
  modelDraft: string;
  setModelDraft: (value: string) => void;
  shellAllowlist: boolean;
  setShellAllowlist: (value: boolean) => void;
  connTest: string | null;
  setConnTest: (value: string) => void;
  exportStatus: string | null;
  prefs: Prefs;
  setPrefs: (value: Prefs) => void;
  updateStatus: UpdateStatus;
  setUpdateStatus: (value: UpdateStatus) => void;
  saveSettings: () => Promise<void>;
  exportSessionDiagnostics: () => Promise<void>;
  refreshTree: () => void;
  setSessionList: (value: ChatSession[]) => void;
  sessionPartition: string;
}

/**
 * Task 5: the Settings panel, moved verbatim out of `App()`'s JSX (the
 * `view === "settings"` branch). Every prop here is exactly one free
 * identifier the original block read from `App()`'s closure — derived
 * mechanically (paste the JSX, let typecheck name what's unresolved) rather
 * than an invented "settings state" bundle, so each one maps 1:1 back to the
 * same-named value/setter/callback in `App()`. Copy, class names, and DOM
 * structure are byte-for-byte what `App.tsx` rendered before this move.
 */
export function SettingsView({
  tauri,
  buildInfo,
  state,
  chip,
  sessionId,
  hostOk,
  runStartedAt,
  applyState,
  classesStatus,
  classesView,
  setClassesView,
  toast,
  startGrokSignIn,
  reportError,
  engineRetryAllowed,
  bootApp,
  oauth,
  setOauth,
  apiKeyDraft,
  setApiKeyDraft,
  modelDraft,
  setModelDraft,
  shellAllowlist,
  setShellAllowlist,
  connTest,
  setConnTest,
  exportStatus,
  prefs,
  setPrefs,
  updateStatus,
  setUpdateStatus,
  saveSettings,
  exportSessionDiagnostics,
  refreshTree,
  setSessionList,
  sessionPartition,
}: SettingsViewProps) {
  return (
    <div className="panel-settings">
      <div className="settings">
        <h1>Settings</h1>
        <p className="lead">
          Forge · sign in with Grok (flagship agent) or API key backup.
          Ctrl+K for commands.
        </p>
        <div className="callout">
          {tauri
            ? "Desktop Forge — the engine starts automatically."
            : "Browser UI — prefer npm run desktop for the native window."}
          <br />
          Version: <code>{buildInfo?.version || "—"}</code>
          {buildInfo?.channelLabel ? ` (${buildInfo.channelLabel})` : ""}
          <br />
          <span>
            {shaSettingsLabel(buildInfo?.installerShaVoucher)}
            {buildInfo?.installerShaVoucher.status === "live" &&
            typeof buildInfo.installerShaVoucher.value === "string" ? (
              <>
                {" "}
                <code className="installer-sha" title={SHA_TITLE}>
                  {buildInfo.installerShaVoucher.value}
                </code>
              </>
            ) : null}
          </span>
          <br />
          <span className="installer-unsigned-line">
            {SETTINGS_UNSIGNED_LINE}
          </span>
          <br />
          Logs:{" "}
          <code>{state?.logHint || "%USERPROFILE%\\.grokforge\\logs"}</code>
        </div>
        <p className="settings-meta">
          {channelBadge() ? `${channelBadge()} · ` : ""}
          {chip.text}
          {state?.authSource ? ` · ${state.authSource}` : ""}
        </p>
        {(() => {
          const policy = (state as PublicState & { permissionPolicy?: { effectiveMode?: string; fallbackReason?: string | null; status?: string } })?.permissionPolicy;
          return (
            <PolicyControls
              state={state}
              sessionId={sessionId}
              hostOk={hostOk}
              runStartedAt={runStartedAt}
              onApplyState={applyState}
            >
              <TrustedCommandClassesControl
                key={state?.workspace ?? "no-workspace"}
                status={
                  !state?.workspace
                    ? "no_workspace"
                    : !hostOk
                      ? "offline"
                      : classesStatus
                }
                policyMode={
                  policy?.effectiveMode === "trusted_workspace"
                    ? "trusted_workspace"
                    : policy?.effectiveMode === "review"
                      ? "review"
                      : null
                }
                confirmed={classesView ?? {
                  classes: [],
                  revision: "fallback",
                  source: "fallback",
                  fallbackReason: "missing",
                  savedForWorkspace: false,
                  catalog: [],
                }}
                onSave={async (classes, expectedRevision) => {
                  if (!sessionId || !state?.workspace) throw new Error("No session or workspace");
                  try {
                    const result = await api.saveTrustedCommandClasses({
                      sessionId,
                      workspace: state.workspace,
                      classes,
                      expectedRevision,
                    });
                    setClassesView(result.classes);
                    toast.push("Trusted command classes saved.", "success");
                  } catch (e) {
                    if (e instanceof ApiError && e.code === "class_revision_conflict") {
                      try {
                        const fresh = await api.trustedCommandClasses(state.workspace);
                        setClassesView(fresh.classes);
                      } catch {
                        /* keep last confirmed */
                      }
                    }
                    const code = e instanceof ApiError ? e.code : "class_save_failed";
                    throw Object.assign(e instanceof Error ? e : new Error("save failed"), { code });
                  }
                }}
              />
            </PolicyControls>
          );
        })()}
        <div className="row" style={{ marginBottom: 16 }}>
          <Button variant="primary" onClick={startGrokSignIn}>
            Sign in with Grok
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void api
                .oauthLogout()
                .then(applyState)
                .catch((e) => reportError(String(e), { source: "oauth" }))
            }
          >
            Sign out
          </Button>
          {engineRetryAllowed && (
            <Button onClick={() => void restartDesktopHost().then(() => bootApp())}>
              Restart engine
            </Button>
          )}
        </div>
        {oauth && (
          <div className="oauth-box">
            <h3>Complete sign-in</h3>
            <p>
              Open{" "}
              <a
                href={oauth.verification_uri_complete || oauth.verification_uri}
                target="_blank"
                rel="noreferrer"
              >
                {oauth.verification_uri}
              </a>
            </p>
            <p className="user-code">{oauth.user_code}</p>
            <Button
              variant="ghost"
              onClick={() => {
                void api.oauthCancel();
                setOauth(null);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        <div className="field">
          <label>Auth priority</label>
          <p className="hint" style={{ marginTop: 4 }}>
            1) SuperGrok / subscription pool · 2) API key backup ·{" "}
            Active:{" "}
            <strong>
              {state?.authSource || "none"}
              {state?.authMode ? ` (${state.authMode})` : ""}
            </strong>
          </p>
        </div>

        <ConnectorsPanel signedIn={state?.authSource === "oauth"} />
        <div className="field">
          <label htmlFor="apiKey">xAI API key (backup only)</label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            placeholder={
              state?.authSource === "config"
                ? "•••• saved — paste to replace"
                : "Optional if signed in with Grok"
            }
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="agentId">ACP agent backend</label>
          <select
            id="agentId"
            value={state?.agentId || "grok-acp"}
            onChange={(e) => {
              void api
                .settings({ agentId: e.target.value })
                .then(applyState)
                .catch((err) =>
                  reportError(
                    err instanceof Error ? err.message : String(err),
                  ),
                );
            }}
          >
            <option value="grok-acp">
              Grok (xAI) — ready
            </option>
            <option value="codex-acp" disabled>
              Codex (OpenAI) — planned
            </option>
            <option value="claude-acp" disabled>
              Claude (Anthropic) — planned
            </option>
          </select>
          <p className="hint" style={{ marginTop: 4 }}>
            Provider-agnostic shell · only Grok ships today.{" "}
            {state?.agentName
              ? `Active: ${state.agentName}.`
              : null}
          </p>
        </div>
        <TextField
          id="model"
          label="Model"
          value={modelDraft}
          onChange={setModelDraft}
          list="model-presets"
        />
        <datalist id="model-presets">
          {MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="model-presets row">
          {MODEL_PRESETS.map((m) => (
            <Button
              key={m}
              variant="ghost"
              className={modelDraft === m ? "active-toggle" : ""}
              onClick={() => setModelDraft(m)}
            >
              {m}
            </Button>
          ))}
        </div>
        <Switch
          isSelected={shellAllowlist}
          onChange={setShellAllowlist}
        >
          Enforce shell allowlist (npm, git, node, …)
        </Switch>
        {connTest && (
          <div className="conn-test" role="status">
            Connection: {connTest}
          </div>
        )}
        {exportStatus && (
          <div className="conn-test" role="status">
            Export: {exportStatus}
          </div>
        )}
        <div className="field">
          <span>Appearance</span>
          <div className="row">
            <Button
              onClick={() => {
                const next = patchPrefs({
                  theme: prefs.theme === "light" ? "voidglass" : "light",
                });
                setPrefs(next);
              }}
            >
              Theme: {themeLabel(prefs.theme)}
            </Button>
            <Button
              onClick={() => {
                const next = patchPrefs({
                  density:
                    prefs.density === "compact"
                      ? "comfortable"
                      : "compact",
                });
                setPrefs(next);
              }}
            >
              Density: {prefs.density}
            </Button>
            <Hint label="Reduce field motion and brand animations">
              <Button
                onClick={() => {
                  const next = patchPrefs({
                    motion: prefs.motion === "calm" ? "full" : "calm",
                  });
                  setPrefs(next);
                }}
              >
                Motion: {prefs.motion === "calm" ? "Calm" : "Full"}
              </Button>
            </Hint>
            <Hint label="Aurora is still. Stars twinkle.">
              <Button
                onClick={() => {
                  const next = patchPrefs({
                    field: prefs.field === "stars" ? "aurora" : "stars",
                  });
                  setPrefs(next);
                }}
              >
                Background: {prefs.field === "stars" ? "Stars" : "Aurora"}
              </Button>
            </Hint>
          </div>
        </div>
        <div className="field">
          <span>Shortcuts</span>
          <p className="settings-hint">
            {/* F6: Ctrl+N is new session (tinykeys $mod+KeyN); Ctrl+Shift+N
                is new chat (matches HomeScreen's own copy) — this panel
                previously paired Ctrl+N with "new chat", which is wrong. */}
            <kbd>Ctrl+K</kbd> palette · <kbd>Ctrl+N</kbd> new session ·{" "}
            <kbd>Ctrl+Shift+N</kbd> new chat · <kbd>Ctrl+L</kbd> composer ·{" "}
            <kbd>Y/N/S</kbd> permissions ·{" "}
            <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> line, or queue while busy
          </p>
        </div>
        <div className="field">
          <span>App updates</span>
          <p className="settings-hint">
            Ctrl+Alt+F summons Forge. Updates check GitHub releases.
          </p>
          <div className="row">
            <Button
              variant="ghost"
              disabled={updateStatus.kind === "checking"}
              onClick={() => {
                setUpdateStatus({ kind: "checking" });
                void checkForAppUpdate().then(setUpdateStatus);
              }}
            >
              <Icon icon={RefreshCw} size={15} />
              Check for updates
            </Button>
            {updateStatus.kind === "available" ? (
              <Button
                variant="primary"
                onClick={() => void installAppUpdate().then(setUpdateStatus)}
              >
                Install {updateStatus.version}
              </Button>
            ) : null}
          </div>
          {updateStatus.kind === "checking" ? (
            <p className="settings-hint">Checking…</p>
          ) : null}
          {updateStatus.kind === "none" ? (
            <p className="settings-hint">No update available.</p>
          ) : null}
          {updateStatus.kind === "error" ? (
            <p className="settings-hint" role="status">{updateStatus.message}</p>
          ) : null}
        </div>
        <div className="row">
          <Button variant="primary" onClick={() => void saveSettings()}>
            Save
          </Button>
          <Button
            onClick={() =>
              void api
                .testConnection()
                .then((r) =>
                  setConnTest(
                    r.probe.ok
                      ? `OK · ${r.authSource} · model ${r.model}`
                      : `Fail · ${r.probe.detail || "no credential"}`,
                  ),
                )
                .catch((e) => setConnTest(String(e)))
            }
          >
            Test connection
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void api
                .openLogs()
                .then((r) =>
                  setConnTest(r.path ? `Logs: ${r.path}` : "Opened logs"),
                )
                .catch((e) => setConnTest(String(e)))
            }
          >
            Open logs folder
          </Button>
          <Button variant="primary" onClick={() => void exportSessionDiagnostics()}>
            Export diagnostics
          </Button>
          <Button
            onClick={() => {
              try {
                toast.push(
                  `Exported ${downloadSessionsExport()}`,
                  "success",
                );
              } catch (e) {
                reportError(
                  e instanceof Error ? e.message : String(e),
                );
              }
            }}
          >
            Export sessions
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void pickImportFile().then((raw) => {
                if (!raw) return;
                const result = importSessionsJson(raw, "merge");
                if (!result.ok) {
                  reportError(result.error);
                  return;
                }
                refreshTree();
                setSessionList(listSessions(sessionPartition));
                toast.push(
                  `Imported ${result.sessions} sessions`,
                  "success",
                );
              });
            }}
          >
            Import sessions
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void api.settings({ clearKey: true }).then(applyState)
            }
          >
            Clear saved key
          </Button>
        </div>
      </div>
    </div>
  );
}
