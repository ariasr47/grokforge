import { BrandMark } from "../chrome/BrandMark";
import { SLOW_START_LINE } from "../projections/launchState";
import { Button } from "../ui/Button";

export function BootScreen({
  bootMsg,
  slowStart,
  diagRevealed,
  channel,
  onSaveDiagnostics,
}: {
  bootMsg: string;
  slowStart: boolean;
  diagRevealed: boolean;
  channel?: string | null;
  onSaveDiagnostics: () => void;
}) {
  return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="brand">
          <BrandMark className="brand-mark brand-mark-lg" />
          <span className="brand-word">Forge</span>
        </div>
        <p className="boot-msg">{slowStart ? SLOW_START_LINE : bootMsg}</p>
        <div className="boot-spinner" aria-hidden />
        {diagRevealed ? (
          <Button onClick={onSaveDiagnostics}>Save troubleshooting file</Button>
        ) : null}
        <p className="boot-hint">
          Agent shell · Grok first · Chat & Code
          {channel ? ` · ${channel}` : ""}
        </p>
      </div>
    </div>
  );
}
