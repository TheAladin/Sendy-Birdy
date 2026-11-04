/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 127.0.0.1 rather than localhost: Node may resolve localhost to IPv6 (::1),
      // while uvicorn only listens on IPv4.
      "/api": "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    // e2e/ holds the Playwright tests, run separately by `make e2e`.
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // Room for several 5 s waits (see src/test/setup.ts) in one test on a slow machine.
    testTimeout: 20_000,
  },
});
