import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { X } from "lucide-react";

/** "needs" is amber (--accent3) — the Global Constraint reserving amber for
 *  "needs you" and nothing else. */
export type ToastKind = "info" | "success" | "error" | "needs";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
  /** Optional third slot between the text and the × — e.g. needs-you's Jump. */
  action?: ToastAction;
}

/** Leading dot color per kind — amber ("needs") never appears for any other
 *  kind, and no other kind ever borrows it. */
export function toastDotClass(kind: ToastKind): "ok" | "fail" | "needs" | "done" {
  if (kind === "success") return "ok";
  if (kind === "error") return "fail";
  if (kind === "needs") return "needs";
  return "done";
}

/** Pause outcome supersedes the in-flight cancel toast so Export is not covered. */
export function pauseToastSupersedes(existing: string, incoming: string): boolean {
  return existing === "Cancel requested" && incoming === "Stopped by you";
}

export function nextToastsAfterPush(prev: ToastItem[], incoming: ToastItem): ToastItem[] {
  const kept = prev.filter((t) => !pauseToastSupersedes(t.message, incoming.message));
  return [...kept.slice(-4), incoming];
}

/** Stable API — consumers of push() do not re-render when toasts change. */
interface ToastApi {
  push: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismiss: (id: string) => void;
}

const ApiCtx = createContext<ToastApi | null>(null);

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return toasts;
}

function pushToast(message: string, kind: ToastKind = "info", action?: ToastAction) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  toasts = nextToastsAfterPush(toasts, { id, message, kind, action });
  emit();
  window.setTimeout(() => dismissToast(id), 4200);
}

function dismissToast(id: string) {
  const next = toasts.filter((x) => x.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

function ToastViewport() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <span className={`dot ${toastDotClass(t.kind)}`} aria-hidden="true" />
          <span>{t.message}</span>
          {t.action ? (
            <Button size="sm" onClick={t.action.onClick}>
              {t.action.label}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="toast-x icon-only"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            <Icon icon={X} size={14} />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const api = useMemo<ToastApi>(
    () => ({
      push: pushToast,
      dismiss: dismissToast,
    }),
    [],
  );

  return (
    <ApiCtx.Provider value={api}>
      {children}
      <ToastViewport />
    </ApiCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ApiCtx);
  const fallback = useRef<ToastApi>({
    push: pushToast,
    dismiss: dismissToast,
  });
  return ctx ?? fallback.current;
}
