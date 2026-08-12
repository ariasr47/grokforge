import { memo, useRef } from "react";
import type { ProductMode } from "./api";
import { api } from "./api";

interface Props {
  mode: ProductMode;
  onChange: (m: ProductMode) => void;
  busy?: boolean;
}

export const ModeSwitch = memo(function ModeSwitch({
  mode,
  onChange,
  busy,
}: Props) {
  const lastPrefetch = useRef<ProductMode | null>(null);

  const prefetch = (m: ProductMode) => {
    if (m === mode) return;
    if (lastPrefetch.current === m) return;
    lastPrefetch.current = m;
    void api.prefetchMode(m);
  };

  return (
    <div className="mode-switch" role="group" aria-label="App mode">
      <button
        type="button"
        className={`mode-seg${mode === "chat" ? " active" : ""}`}
        disabled={busy}
        onClick={() => onChange("chat")}
        onMouseEnter={() => prefetch("chat")}
        onFocus={() => prefetch("chat")}
      >
        Chat
      </button>
      <button
        type="button"
        className={`mode-seg${mode === "code" ? " active" : ""}`}
        disabled={busy}
        onClick={() => onChange("code")}
        onMouseEnter={() => prefetch("code")}
        onFocus={() => prefetch("code")}
      >
        Code
      </button>
    </div>
  );
});
