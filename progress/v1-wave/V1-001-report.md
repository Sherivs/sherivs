# V1-001 Report — Mission V1-001 (team PLATFORM): PWA build shipping + offline shell

Date: 2026-10-03
Branch: `cursor/p08-foundation-loop-classification-fe86` (work performed on this branch; no git commands run per mission LAW)

## Implemented

1. **publicDir mismatch fixed (minimal correct fix — single canonical public dir).**
   The Vite root is the repo root, so its publicDir is `/workspace/public` (this is why `/icons` already shipped). The PWA files lived in `frontend/public/` and were silently dropped from the build. Fix: moved `sw.js` and `robots.txt` from `frontend/public/` into `/workspace/public/` and removed the now-empty `frontend/public/` directory. No `vite.config.ts` change was needed — one canonical public dir now serves `/sw.js`, `/robots.txt`, `/favicon.ico` and `/icons/*`.
2. **`/favicon.ico` added.** Generated a real ICO at `/workspace/public/favicon.ico` (valid ICO container, 6-byte header + one directory entry + embedded 32×32 PNG, brand colour `#1d4ed8` with the white-frame mark, matching `scripts/generate-pwa-icons.mjs`). `/favicon.ico` now resolves both for browser default requests and for the push-notification `icon`/`badge` already declared in `sw.js`. No route-registration change was required (`__root.tsx` untouched; browser default `/favicon.ico` resolution covers it).
3. **Minimal offline shell added to the existing push service worker (`public/sw.js`).**
   - `install`: precaches the app shell (`/`) into cache `coregrid-app-shell-v1`, best-effort (an offline install never fails activation); `skipWaiting` preserved.
   - `fetch`: intercepts GET navigation requests only. Network-first: a successful (2xx) navigation response is cached via `cache.put` (clone); redirects/opaque/error responses are never cached. On network failure it serves the cached navigation for the visited URL (query-insensitive), else the precached shell, else a 503 text response.
   - Push (`push`) and `notificationclick` handlers are byte-for-byte behaviourally intact (verified by tests that exercise them in the sandbox).
4. **Unit tests added**: `tests/unit/pwa-offline-shell.test.ts` (13 tests), following repo conventions (node-environment Vitest, file-integrity checks rooted at repo root, strict TypeScript, no `any`).

## Files Changed

- `public/sw.js` — moved from `frontend/public/sw.js`; extended with the offline shell strategy (push logic preserved).
- `public/robots.txt` — moved from `frontend/public/robots.txt` (content unchanged).
- `public/favicon.ico` — new (generated ICO with embedded 32×32 PNG).
- `frontend/public/` — removed (empty after the move).
- `tests/unit/pwa-offline-shell.test.ts` — new.
- `vite.config.ts` — **not modified** (not needed; default publicDir `/workspace/public` verified by build).

## Architecture Impact

- Domain/Application layers untouched: this is an Infrastructure shipping concern (static asset publication) plus a browser-platform runtime concern (service worker). No server handlers, contracts, RLS, authorization, or tenant-context code changed.
- The single canonical public dir eliminates the split-brain where `dist/client` shipped icons but not the SW/robots; `dist/client` now contains exactly what `/` serves.
- The offline shell is navigation-only and app-relative (`scope: "/"`), so it cannot leak tenant-specific responses across origins; cached entries are per-origin by construction (Cache Storage is origin-scoped).
- No AI, Digital Twin, or Control-Plane surface touched.

## Tests

- New: `tests/unit/pwa-offline-shell.test.ts` — 13 passing:
  - Canonical public dir: `sw.js`, `robots.txt`, `favicon.ico` present; `frontend/public` gone.
  - Favicon integrity: ICO header `00000100`, 1 image, 32×32 entry, PNG signature at declared offset.
  - Manifest route integrity: every `src: "/icons/…"` declared by `frontend/src/lib/scholar/pwa/manifest-engine.ts` resolves to a real shipped PNG.
  - Service worker registration path: `frontend/src/lib/push-client.ts` registers `/sw.js` with `scope: "/"` and reuses `getRegistration("/sw.js")`; the registered URL resolves to the shipped file (which still registers `push` and `notificationclick` listeners).
  - Offline shell behaviour, exercised in a `vm` sandbox with mocked `caches`/`fetch`/`self` (service workers cannot run in jsdom): push/notificationclick intact; shell precached at install; successful navigations cached network-first; redirects not cached; offline fallback to cached navigation; offline fallback to precached shell; 503 when nothing is cached; non-GET/non-navigate requests never intercepted.
- Neighbour regression: `tests/unit/surface-renderers.test.ts` (owns the `public/icons` expectations) — 15 passing alongside the new file (28/28 total).

## Security Validation

- No secrets, tokens, or credentials introduced; the favicon generator (`/tmp/gen-favicon.mjs`) is a one-off outside the repo.
- The SW caches only same-origin GET navigations with 2xx status; Cache Storage is origin-scoped, so no cross-tenant or cross-origin data can enter the shell cache.
- No push behaviour was weakened: permission/subscription flow (`push-client.ts`) untouched; SW push handler verified unchanged by tests.
- The 503 offline fallback reveals nothing (plain static text).
- UI-only change; backend authorization/RLS surfaces untouched.

## Known Risks

- The precached shell is only the root document HTML; hashed asset bundles are not precached, so a cold offline load renders the HTML with missing assets until the user has visited routes online (which the network-first cache then covers). This is the agreed *minimal* shell, not full offline capability.
- `cache.put` on every successful navigation grows the cache unboundedly over long sessions; acceptable for V1, could later be bounded with an LRU trim.
- `tsc --noEmit` reports two **pre-existing** errors in `frontend/src/lib/communications/resend-email.server.ts` (lines 148/155, `string | null` vs `string | undefined`) — unrelated to this mission, present before the change, not fixed here (outside mission ownership).

## Remaining Work

- Coordinator to run the full `npm run verify` (per mission LAW it was not run here).
- Optional follow-ups (not authorized in V1-001 scope): cache-size bounding, runtime caching of hashed assets for a fuller offline experience, and wiring an "offline ready" signal into `frontend/src/components/offline-banner.tsx` (exists already; requires route/component change ownership).

## Verification Evidence (build + tests)

`npm run build` (vite build) — success in ~5.1s; `dist/client` contents:

```
dist/client/
├── assets/
├── favicon.ico        (00 00 01 00 ... 89 50 4e 47 — valid ICO + PNG)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── maskable-512.png
├── robots.txt
└── sw.js              (offline shell + push, copied from /workspace/public)
```

`npx vitest run tests/unit/pwa-offline-shell.test.ts` → `13 passed (13)`;
`npx vitest run tests/unit/surface-renderers.test.ts tests/unit/pwa-offline-shell.test.ts` → `28 passed (28)`.