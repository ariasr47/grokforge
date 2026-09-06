import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FieldLayer } from "../chrome/FieldLayer";
import { ToastProvider } from "../thread/Toast";
import { applyPrefsToDom } from "../lib/prefs";
import { installCrashSink } from "../lib/crashSink";
import "../lib/fonts";
import "./styles.css";

applyPrefsToDom();
installCrashSink();

function reportReactError(kind: string, error: unknown, errorInfo: { componentStack?: string }) {
  const stack = errorInfo.componentStack || "";
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`react-${kind}: ${msg}${stack}`);
}

createRoot(document.getElementById("root")!, {
  onRecoverableError: (error, errorInfo) => reportReactError("recoverable", error, errorInfo),
  onUncaughtError: (error, errorInfo) => reportReactError("uncaught", error, errorInfo),
  onCaughtError: (error, errorInfo) => reportReactError("caught", error, errorInfo),
}).render(
  <StrictMode>
    <FieldLayer />
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
