import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import {
  clientVendorDefine,
  sentrySourceMapUploadEnabled,
  serverVendorDefine,
} from "./frontend/src/lib/observability/vendor-telemetry.ts";

const isVitest = process.env.VITEST === "true";

// Sentry/PostHog and source-map upload run only when APP_ENV / VITE_APP_ENV
// is exactly "staging". Production (including VERCEL_ENV=production) fails
// closed and the client keys are defined as empty strings so they are not
// bundled. See frontend/src/lib/observability/vendor-telemetry.ts.
const telemetryInput = {
  appEnv: process.env.APP_ENV,
  viteAppEnv: process.env.VITE_APP_ENV,
  vercelEnv: process.env.VERCEL_ENV,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  vitest: isVitest,
  release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VITE_SENTRY_RELEASE ?? "",
};
const sentryUpload = sentrySourceMapUploadEnabled(telemetryInput);

export default defineConfig({
  define: {
    ...clientVendorDefine(telemetryInput),
    ...serverVendorDefine(telemetryInput),
  },
  build: sentryUpload ? { sourcemap: "hidden" } : undefined,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./frontend/src", import.meta.url)),
    },
  },
  plugins: [
    // Skip the TanStack Start plugin under vitest — it fails in the test
    // environment (Cannot read properties of undefined (reading 'config')).
    ...(isVitest
      ? []
      : [
          tanstackStart({
            // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
            // nitro/vite builds from this
            srcDirectory: "./frontend/src",
            server: { entry: "server" },
            router: {
              codeSplittingOptions: {
                defaultBehavior: [
                  ["loader"],
                  ["component"],
                  ["pendingComponent"],
                  ["errorComponent"],
                  ["notFoundComponent"],
                ],
              },
            },
            // Fail the build if client bundles import server-only modules
            // (e.g. the service-role Supabase client) or the `server-only` specifier.
            importProtection: {
              behavior: "error",
              client: {
                files: ["**/*.server.ts", "**/server/**"],
                specifiers: ["server-only"],
              },
            },
          }),
          // Nitro compiles the SSR server into the Vercel Build Output API
          // (functions + routes). Without this plugin `vite build` emits only
          // static bundles and every deployment serves edge 404s (Vercel's
          // official TanStack Start deployment guide requires this plugin).
          nitro(),
        ]),
    react(),
    tailwindcss(),
    ...(sentryUpload
      ? sentryTanstackStart({
          org: process.env.SENTRY_ORG ?? "sherivs-technologies",
          project: process.env.SENTRY_PROJECT ?? "sherivs-web",
          authToken: process.env.SENTRY_AUTH_TOKEN,
          release: telemetryInput.release ? { name: telemetryInput.release } : undefined,
          sourcemaps: { filesToDeleteAfterUpload: ["./.output/**/*.map", "./dist/**/*.map"] },
          telemetry: false,
        })
      : []),
  ],
});
