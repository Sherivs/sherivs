# R-WAVE REPORT — V1 Credential-Free Remediation Wave (closure)

Date: 2026-10-03 · Coordinator-run wave: 8 parallel engineering teams (R1–R8), strict disjoint file ownership, constitution-governed (AGENTS.md).

## Motivation

After the V1 program closed (14 missions, 4 waves, F-13 vertical slice 6 real / 2 typed skips, verify 8,690 green, RLS battery 42/42), the remaining work split into two honest categories: credential-gated items (BLK-2/3/4/5, store accounts — waiting on operator secrets) and credential-free engineering follow-ups recorded in the mission reports. This wave executed the latter with 8 teams.

## Results — all 8 missions complete, committed, verified

| Team | Mission | Outcome | Commit |
|---|---|---|---|
| R1 QA-CREDS | Legacy e2e credential remediation | 16 passed / 3 typed skips / 0 failures; hard-coded `Demo@2026!` eliminated (per-run fixture tenants via real auth-admin provisioning); secret scan clean | `2ea7853` |
| R2 QA-SIGNUP | Rate-limit-resilient signup harness | T2 proven backoff (5 attempts vs closed window, honest typed skip with verbatim backend message); assertions + typed-skip contract preserved | `48ce18c` |
| R3 MOBILE-CONTRACTS | Shared contracts package | `@coregrid/contracts` single source (vocabularies, foundation rows, identity contracts, 4,522-line DB types); drift shims deleted; structural single-source ratchet | `d0bf81f` |
| R4 HERMES-PORT | Hermes DB observation substrate | `cg_hermes_observation` append-only ledger (§12 provenance, §9 canonical-truth CHECK, exactly-once event consumption) + event→observation wiring; 70/70 tests | `37e0e7f` |
| R5 WORKFORCE-CLOCK | Workforce clock adoption | `deps.clock` single time authority; default path byte-identical (pre-edit fixture pin); trio 44/44, zero assertion changes | `39db9ea` |
| R6 COMMS-EVIDENCE | Delivery-evidence substrate | `cg_delivery_evidence` append-only attempt ledger (blocked sends are evidence; redacted recipients; outcome-coherence CHECK); `.env.example` comms entries; 61/61 tests | `f786c5f` |
| R7 WORKFORCE-SURFACE | Worker launch surface | Platform-super-gated `launchWorkerMission` server fn + super-admin route; typed `BLOCKED_NO_CREDENTIAL`; 20/20 tests | `d5b6d58` + `4f193c9` |
| R8 INFRA-OPS | Deploy substrate + ops runbook | `infrastructure/deploy/` (fail-closed compose, health-gated `deploy.sh` with automatic rollback, env-name manifest) + `OPERATIONS.md` mapping every gate to its env var | `93bbadd` |

## Coordinator integration pass

- Migrations `20261003000030` + `20261003000031` registered in `scripts/apply-canonical-hardening.mjs` (declared objects + privilege postures); mh-06 ratchet extended to 18 migrations (`f646762`); explicit `service_role` grant added to the delivery-evidence migration for posture consistency.
- Canonical apply **STATUS=PASS** (catalog-verified, checksummed, rollbacks bound).
- RLS isolation battery registry extended (`scripts/verification/rls-table-postures-r-wave.json`): **44/44 tables PASS** against the live database (`86fd349`).
- One real defect found by the verify build gate and fixed: R7's functions module statically imported `ai-gateway.server` into the client graph (routeTree → route → functions). Fixed by the house pattern — client-safe contract module (`worker-launch-contract.ts`), server-only runtime module (`worker-launch-runtime.server.ts`), dynamic imports inside handler bodies only; ratchet permanently enforces the split (`4f193c9`).
- Posture-file ratchets (h3-031/h3-034) extended for the new registry file.

## Final verification (closing tree)

- `npm run verify` exit 0: **8,801 passed / 0 failed / 5 skipped**; typecheck clean; registry/drift/neutrality/secrets gates PASS; client + server builds green.
- RLS battery: 44/44 PASS (zero-policy deny-by-default proven on both new substrates; policy-backed tables prove genuine cross-tenant isolation).
- E2E: legacy suite 16 passed / 3 typed skips / 0 failures (R1); vertical slice 6 passed / 2 typed skips / 0 failures (R2, baseline held).

## The 5 typed e2e skips are environment gaps, each auto-resuming when its dependency exists

1. T2 self-serve signup — Supabase auth email rate limit (operator: raise in Supabase dashboard, no credential needed).
2. Super-admin journey — `E2E_SUPER_ADMIN_EMAIL` / `E2E_SUPER_ADMIN_PASSWORD` secrets (operator-supplied).
3. Gallery — `school-media` storage bucket not provisioned on the backend (infrastructure step).
4. Driver preview card — `transport_buses` zero-policy posture leaves the driver assigned-bus surface without a client path (policy work owned by a future authorized migration).
5. T8 live AI worker — `AI_API_KEY` external gate (launch surface now EXISTS; see R7).

## Known risks / remaining work

- Migrations 30/31 are applied to the canonical project; rollbacks are bound in the manifest (exact-inverse, §38).
- R3 remaining: repoint the Supabase type generator output into `packages/contracts` (scripts/ ownership, coordinator follow-up; a stray regeneration fails the structural test loudly rather than drifting silently).
- R5 honest caveat: under an ADOPTED clock a past-TTL outcome report is refused rather than backdated (orphan recovery via substrate; unreachable on the default path) — documented for operators.
- R8 flagged drift: legacy `release.yml` raw `docker run` deploy path vs the new health-gated compose path — reconcile during the first live deploy (BLK-3).
- `.env.example` Supabase project-id comment references a stale project id (cosmetic; canonical project is `nwrflbpbhyiqdptmlccm`).
- Credential-gated wave (next): live deploy BLK-3, live payments BLK-4, live comms BLK-5, live AI execution T8, store submission — each unlocked by the operator secrets mapped in `architecture/campaigns/V1-PROGRAM/OPERATIONS.md`.
