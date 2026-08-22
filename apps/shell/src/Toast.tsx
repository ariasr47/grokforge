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

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

/** Stable API — consumers of push() do not re-render when toasts change. */
interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
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

function pushToast(message: string, kind: ToastKind = "info") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  toasts = [...toasts.slice(-4), { id, message, kind }];
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
          <span>{t.message}</span>
          <Button
            variant="ghost"
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
