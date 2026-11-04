import { defineConfig, devices } from "@playwright/test";

// The database, demo data and environment come from scripts/e2e.sh (`make e2e`).
if (!process.env.E2E_ADMIN_EMAIL) {
  throw new Error("Run the end-to-end tests with `make e2e`, which prepares a fresh library.");
}

const backend = "uv run uvicorn app.main:create_app --factory --host 127.0.0.1";

export default defineConfig({
  testDir: "./e2e",
  // One library shared by every test: run them one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "light",
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      // The theme follows the system by default, so this checks every page in dark mode too.
      name: "dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
      testMatch: "accessibility.spec.ts",
    },
  ],
  webServer: [
    {
      command: `APP_MODE=admin ${backend} --port 8100`,
      cwd: "../backend",
      url: "http://127.0.0.1:8100/api/health",
      reuseExistingServer: false,
    },
    {
      command: `APP_MODE=public ${backend} --port 8101`,
      cwd: "../backend",
      // The public app has no health endpoint; any file of the build proves it's up.
      url: "http://127.0.0.1:8101/favicon.svg",
      reuseExistingServer: false,
    },
  ],
});
