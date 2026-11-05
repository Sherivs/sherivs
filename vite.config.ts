import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";

const isVitest = process.env.VITEST === "true";

// Sentry source-map upload is optional: only when SENTRY_AUTH_TOKEN is set
// (e.g. in Vercel). Without it the build is unchanged and no maps are uploaded.
const sentryUpload = !isVitest && Boolean(process.env.SENTRY_AUTH_TOKEN);
// Release + environment for Sentry, from Vercel's build-time system env.
const sentryRelease = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VITE_SENTRY_RELEASE ?? "";
const sentryEnvironment =
  process.env.VERCEL_ENV ?? process.env.VITE_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "";

export default defineConfig({
  define: {
    "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(sentryRelease),
    "import.meta.env.VITE_SENTRY_ENVIRONMENT": JSON.stringify(sentryEnvironment),
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
          release: sentryRelease ? { name: sentryRelease } : undefined,
          sourcemaps: { filesToDeleteAfterUpload: ["./.output/**/*.map", "./dist/**/*.map"] },
          telemetry: false,
        })
      : []),
  ],
});
