import {
  Command,
  MessageSquare,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ProductMode, PublicState } from "./api";
import { appChannel, channelBadge, hostPort } from "./api";
import { BrandMark } from "./BrandMark";
import { ModeSwitch } from "./ModeSwitch";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

export function AppTopbar({
  productMode,
  modeSwitching,
  onSwitchMode,
  state,
  branchMap,
  chip,
  sessionWrite,
  sessionShell,
  hostOk,
  healthFailStreak,
  wsOk,
  engineRetryAllowed,
  onRetryHost,
  view,
  onToggleSettings,
  onOpenPalette,
}: {
  productMode: ProductMode;
  modeSwitching: boolean;
  onSwitchMode: (m: ProductMode) => void;
  state: PublicState | null;
  branchMap: Record<string, string | null>;
  chip: { className: string; text: string };
  sessionWrite: boolean;
  sessionShell: boolean;
  hostOk: boolean;
  healthFailStreak: number;
  wsOk: boolean;
  engineRetryAllowed: boolean;
  onRetryHost: () => void;
  view: "chat" | "settings";
  onToggleSettings: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand" title="Forge — agent shell">
        <BrandMark />
        <span className="brand-word">Forge</span>
        <span className="brand-mode">
          {productMode === "chat" ? "Chat" : "Code"}
        </span>
      </div>
      <ModeSwitch
        mode={productMode}
        applying={modeSwitching}
        onChange={onSwitchMode}
      />
      <div className="workspace-label" title={state?.workspace ?? ""}>
        {productMode === "chat" ? (
          state?.chatRoot ? (
            <>
              Files · <strong>{state.workspaceName || "folder"}</strong>
            </>
          ) : (
            "Chat · personal sandbox"
          )
        ) : state?.workspace ? (
          <>
            Project · <strong>{state.workspaceName}</strong>
            {branchMap[state.workspace] ? (
              <>
                {" "}
                <span className="branch top-branch">
                  {branchMap[state.workspace]}
                </span>
              </>
            ) : null}
          </>
        ) : (
          "No project open"
        )}
      </div>
      {channelBadge() ? (
        <span
          className={`chip channel-badge channel-${channelBadge()?.toLowerCase()}`}
          title={`${channelBadge()} channel · host :${hostPort() ?? "?"} · data ~/.grokforge${appChannel() === "dev" ? "-dev" : ""} (isolated from Prod)`}
        >
          {channelBadge()}
        </span>
      ) : null}
      <span
        className={chip.className}
        title={state ? `source: ${state.authSource}` : ""}
      >
        {chip.text}
      </span>
      {sessionWrite || sessionShell ? (
        <span className="chip api" title="Session allow policy">
          session
          {sessionWrite ? " write" : ""}
          {sessionShell ? " shell" : ""}
        </span>
      ) : null}
      <span
        className={`chip ${hostOk && healthFailStreak === 0 ? "api" : "signed-out"}`}
        title={wsOk ? "WebSocket connected" : "Reconnecting…"}
      >
        {healthFailStreak >= 1 ? "Engine · reconnecting" : "Engine · live"}
      </span>
      <Button
        variant="ghost"
        title="Command palette (Ctrl+K)"
        onClick={onOpenPalette}
      >
        <Icon icon={Command} size={15} />
        ⌘K
      </Button>
      {!hostOk && engineRetryAllowed ? (
        <Button onClick={onRetryHost}>
          <Icon icon={RefreshCw} size={15} />
          Reconnect
        </Button>
      ) : null}
      <Button variant="ghost" onClick={onToggleSettings}>
        {view === "settings" ? (
          <>
            <Icon icon={MessageSquare} size={15} />
            Chat
          </>
        ) : (
          <>
            <Icon icon={SettingsIcon} size={15} />
            Settings
          </>
        )}
      </Button>
    </header>
  );
}
