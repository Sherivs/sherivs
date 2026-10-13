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
    // Skip Start + Nitro under vitest — Start fails in the test environment
    // (Cannot read properties of undefined (reading 'config')).
    ...(isVitest
      ? []
      : [
          tanstackStart({
            // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
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
          // Start 1.168.60+ no longer auto-emits Nitro's Vercel Build Output.
          // Without this plugin, `vite build` writes dist/server only and Vercel
          // serves platform NOT_FOUND on every preview path.
          nitro(),
        ]),
    react(),
    tailwindcss(),
  ],
});
