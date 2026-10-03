import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  // E2E convention (tests/README.md): specs run against a locally-started dev
  // server on PLAYWRIGHT_BASE_URL. Boot it automatically unless one already
  // listens; the client bundle needs the VITE_ Supabase names and the demo
  // provisioning fixture gate is enabled for e2e only (see .env.example).
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: "npm run dev -- --port 8080 --strictPort",
        url: "http://localhost:8080/coregrid",
        reuseExistingServer: true,
        timeout: 180_000,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
          VITE_SUPABASE_PUBLISHABLE_KEY:
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
            process.env.SUPABASE_PUBLISHABLE_KEY ??
            process.env.SUPABASE_ANON_KEY ??
            "",
          ALLOW_DEMO_PROVISIONING: process.env.ALLOW_DEMO_PROVISIONING ?? "true",
        },
      },
});
