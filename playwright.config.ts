import { defineConfig, devices } from "@playwright/test";

/**
 * Production guard: e2e journeys create and delete tenants, auth users and
 * audit rows. They must NEVER run against the production Supabase project or
 * the production site. Point SUPABASE_URL / PLAYWRIGHT_BASE_URL at a local or
 * dedicated non-production stack.
 */
const PRODUCTION_MARKERS = ["nwrflbpbhyiqdptmlccm", "sherivs.com"];
const e2eTargets = [
  process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_URL,
  process.env.PLAYWRIGHT_BASE_URL,
].filter((v): v is string => typeof v === "string" && v.length > 0);
if (e2eTargets.some((t) => PRODUCTION_MARKERS.some((m) => t.toLowerCase().includes(m)))) {
  throw new Error(
    "Refusing to run e2e against production. Use a local or non-production Supabase project and base URL.",
  );
}

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
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 800 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
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
          VITE_WORKSPACE_VISUAL_FIXTURE: process.env.VITE_WORKSPACE_VISUAL_FIXTURE ?? "1",
        },
      },
});
