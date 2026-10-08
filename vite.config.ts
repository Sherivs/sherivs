import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

const isVitest = process.env.VITEST === "true";

export default defineConfig({
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
  ],
});
