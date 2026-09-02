import { isTauri } from "./api";

// `@tauri-apps/api/window` is imported lazily, inside each click handler,
// so a non-Tauri build (the browser-dev path) never pulls the Tauri window
// API into its bundle at all — `isTauri()` below already keeps it from
// running there, this keeps it from even being loaded there.
async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/**
 * Frameless-window caption buttons (minimize / maximize / close). The
 * topbar (`AppTopbar.tsx`) carries `data-tauri-drag-region` so the window
 * can be dragged from its empty space; these buttons are separate elements
 * and are never drag regions themselves. Renders nothing outside Tauri —
 * the browser-dev path has no native window to control.
 */
export function WindowControls() {
  if (!isTauri()) return null;

  return (
    <div className="win">
      <button
        type="button"
        className="cap"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => {
          void currentWindow().then((w) => w.minimize());
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          aria-hidden="true"
        >
          <path d="M0 5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="cap"
        aria-label="Maximize"
        title="Maximize"
        onClick={() => {
          void currentWindow().then((w) => w.toggleMaximize());
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          aria-hidden="true"
        >
          <rect x="0.5" y="0.5" width="9" height="9" />
        </svg>
      </button>
      <button
        type="button"
        className="cap close"
        aria-label="Close"
        title="Close"
        onClick={() => {
          void currentWindow().then((w) => w.close());
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          aria-hidden="true"
        >
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
