import {
  ChevronDown,
  Folder,
  MessageSquare,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ProductMode, PublicState } from "./api";
import { BrandMark } from "./BrandMark";
import { ModeSwitch } from "./ModeSwitch";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { WindowControls } from "./WindowControls";

export function AppTopbar({
  productMode,
  modeSwitching,
  onSwitchMode,
  state,
  branchMap,
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
  hostOk: boolean;
  healthFailStreak: number;
  wsOk: boolean;
  engineRetryAllowed: boolean;
  onRetryHost: () => void;
  view: "chat" | "settings";
  onToggleSettings: () => void;
  onOpenPalette: () => void;
}) {
  // Single source of truth for the engine pill: the dot only pulses, and
  // the text only says "live", once the host has confirmed healthy AND the
  // 4s health poll hasn't started failing (SPEC's healthFailStreak — reacts
  // after 1 miss, same threshold the engine-stopped chrome uses).
  const engineLive = hostOk && healthFailStreak === 0;

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" title="Forge — agent shell">
        <BrandMark size={18} />
        <span className="brand-word">FORGE</span>
      </div>
      <button
        type="button"
        className="ws"
        title={state?.workspace ?? ""}
        onClick={onOpenPalette}
      >
        <Icon icon={Folder} size={14} />
        {productMode === "chat" ? (
          <span className="name">Chat</span>
        ) : state?.workspace ? (
          <>
            <span className="name">{state.workspaceName}</span>
            {branchMap[state.workspace] ? (
              <span className="ws-branch">{branchMap[state.workspace]}</span>
            ) : null}
          </>
        ) : (
          <span className="name">No project open</span>
        )}
        <Icon icon={ChevronDown} size={12} />
      </button>
      <ModeSwitch
        mode={productMode}
        applying={modeSwitching}
        onChange={onSwitchMode}
      />
      <div className="spacer" />
      <div
        className="engine"
        title={wsOk ? "WebSocket connected" : "Reconnecting…"}
      >
        <span
          className={`dot${engineLive ? " live" : ""}`}
          aria-hidden="true"
        />
        <span>{engineLive ? "Grok · live" : "Grok · reconnecting"}</span>
      </div>
      {!hostOk && engineRetryAllowed ? (
        <Button onClick={onRetryHost}>
          <Icon icon={RefreshCw} size={15} />
          Reconnect
        </Button>
      ) : null}
      <button
        type="button"
        className="kbd-btn"
        title="Command palette (Ctrl+K)"
        onClick={onOpenPalette}
      >
        Ctrl+K
      </button>
      <Button
        variant="ghost"
        className="icon-only"
        title={view === "settings" ? "Chat" : "Settings"}
        onClick={onToggleSettings}
      >
        <Icon
          icon={view === "settings" ? MessageSquare : SettingsIcon}
          size={16}
        />
      </Button>
      <WindowControls />
    </header>
  );
}
