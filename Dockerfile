# syntax=docker/dockerfile:1
#
# CoreGrid Scholar — V1 single-VM production image (Part 31 economy path).
#
# Runtime shape (verified against `vite build` output):
#   dist/client/            static client assets
#   dist/server/server.js   fetch-style Start server entry (not a runnable server)
#   served by: node node_modules/srvx/bin/srvx.mjs --prod -s ../client dist/server/server.js
#
# Secrets law: NO secrets are baked into any layer. All environment
# (SUPABASE_URL, SUPABASE_ANON_KEY, ...) is injected at `docker run` time
# via --env-file / --env only. See infrastructure/README.md.

# ---------------------------------------------------------------------------
# Stage 1: install (full dependency tree — the server bundle imports
# externalized packages at runtime and srvx itself lives in the dev tree)
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2: build
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# VITE_PUBLIC_* build-time variables are injected as build args, never secrets.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: runtime (minimal, non-root)
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Build artifacts + the node_modules tree the server bundle resolves against.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Non-root: the `node` user ships with node:22-slim.
USER node

EXPOSE 3000

# Health contract: /health.json returns 200 for ok|degraded, 503 for failing.
# Uses node's built-in fetch — no curl/wget needed in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health.json').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "node_modules/srvx/bin/srvx.mjs", "--prod", "-s", "../client", "dist/server/server.js"]
