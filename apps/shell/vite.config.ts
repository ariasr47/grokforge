import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const channel = (env.VITE_GROKFORGE_CHANNEL || process.env.GROKFORGE_CHANNEL || "prod")
    .toLowerCase();
  const isDevChannel =
    channel === "dev" ||
    channel === "tst" ||
    channel === "test" ||
    channel === "qa";
  const hostPort = Number(
    env.VITE_GROKFORGE_PORT ||
      process.env.GROKFORGE_PORT ||
      (isDevChannel ? 8788 : 8787),
  );
  // Prod Tauri → :5173; Dev Tauri conf uses :5174 so both can run side-by-side.
  const uiPort = Number(
    env.VITE_PORT || process.env.VITE_PORT || (isDevChannel ? 5174 : 5173),
  );

  return {
    plugins: [
      react(),
      ...(mode === "analyze"
        ? [visualizer({ filename: "dist/stats.html", gzipSize: true, open: false })]
        : []),
    ],
    define: {
      "import.meta.env.VITE_GROKFORGE_CHANNEL": JSON.stringify(
        isDevChannel ? "dev" : "prod",
      ),
      "import.meta.env.VITE_GROKFORGE_PORT": JSON.stringify(String(hostPort)),
    },
    server: {
      port: uiPort,
      strictPort: true,
      watch: {
        ignored: [
          "**/src-tauri/target/**",
          "**/src-tauri/target-dev/**",
          "**/node_modules/**",
        ],
      },
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${hostPort}`,
          changeOrigin: true,
        },
        "/ws": {
          target: `ws://127.0.0.1:${hostPort}`,
          ws: true,
        },
      },
    },
    clearScreen: false,
  };
});
