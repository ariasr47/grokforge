import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FieldLayer } from "./FieldLayer";
import { ToastProvider } from "./Toast";
import { applyPrefsToDom } from "./prefs";
import { installCrashSink } from "./crashSink";
import "./fonts";
import "./styles.css";

applyPrefsToDom();
installCrashSink();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FieldLayer />
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
