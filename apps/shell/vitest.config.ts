import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.vitest.ts", "src/**/*.vitest.tsx"],
    css: false,
  },
});
