# JARVIS Wave 6 Report — PLATFORM-020 (DECISIONS.md #211)

Date: 2026-10-07 · Executing agent: JARVIS wave 6 · Version-target classification: **V1** (organizational capability envelope; AGENTS.md §45 — V2/V3 frozen, untouched)

## Operator instruction

Carry-on prompt (this session): "I have grabbed the redis credentials and they will not inject into the VM until the next agent chat window" — activate the Redis (Upstash REST) credential pair end-to-end.

**Naming note:** the prompt names this work "PLATFORM-019 / DECISIONS #210 / wave 5", but those identifiers were consumed by the earlier 2026-10-07 session (per-org communication sender identity + CoreGrid API-key substrate, commit `ee5ff65`). This session therefore executes as **JARVIS wave 6 / PLATFORM-020 / DECISIONS.md #211** to keep the decision ledger monotonic.

## Implemented

1. **Credential injection verified (names only, §30):** the VM environment and `CLOUD_AGENT_ALL_SECRET_NAMES` both carry the Redis pair — under the Upstash console names `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, NOT the adapter contract names `REDIS_REST_URL`/`REDIS_REST_TOKEN` the prompt and runbook §1 step 5 specify. The credentials DID inject; the spelling differs. Shape diagnostics (booleans/statuses only — no values printed) showed a parsable URL hosting at `upstash.io` and a clean 62-char token.
2. **Capability probe run fail-closed → FINDING (exit 1):** with the stored-as-is values the adapter contract rejected the URL — its scheme reads `ttps://`, i.e. the leading `h` of `https://` was lost when the value was pasted into Cursor Secrets. Per the carry-on prompt's own rule ("Exit 1 = finding, record honestly, do NOT update the registry status"), the registry stays `NOT_CONFIGURED` and the distributed limiter stays in-process (Part 31).
3. **Diagnostic re-probe classified the finding precisely (in-memory repair only):** a wrapper restored the single leading character INSIDE the probe process env (never printed, never upserted, never committed) and re-ran the unchanged probe: adapter accepted the connection (mode: redis), PING http 200, governed rate-limit check through `rateLimiterFromEnv` → `allow`. Conclusion, evidence-backed: the token and data plane are fully valid; the ONLY defect is the one truncated character in the stored URL value. The moment the operator fixes that character (and ideally renames the secrets to the step-5 contract names), a fresh session's probe passes and activation completes with zero code changes.
4. **Probe tooling defect fixed (evidence-backed):** the diagnostic re-probe exposed a wave-4 bug in `scripts/infrastructure/redis-capability-probe.mjs` — the PING assertion expected `result === "OK"`, but Redis PING replies `PONG` (verified live: http 200, `result: "PONG"`). The probe had never run against a live endpoint (wave 4 recorded the credentials absent), so the bug was latent. Fixed to assert exactly `PONG`; with the repair, the probe exits 0 (CAPABILITY_PROVEN) in the diagnostic run.
5. **Vercel provisioning deliberately NOT run:** upserting the malformed URL would push a broken value to the app runtime, and re-upserting the other 18 unchanged variables adds no value. Recorded as skipped with the reason — not silently omitted (§65).
6. **Runbook updated honestly:** `docs/runbooks/provider-onboarding-guide.md` §1 gained a status block with the exact operator fix (one character; prefer renaming to `REDIS_REST_URL`/`REDIS_REST_TOKEN`), §10 checklist item annotated with the finding (stays unchecked — no fabricated `[x]`), changelog entry added.

## Files Changed

- `scripts/infrastructure/redis-capability-probe.mjs` (PING assertion `OK` → `PONG`; probe logic otherwise unchanged, still fail-closed)
- `docs/runbooks/provider-onboarding-guide.md` (§1 status block, §10 checklist finding annotation, changelog)
- `DECISIONS.md` (#211 — this entry)
- `progress/v1-wave/JARVIS-WAVE-6-REPORT.md` (this file)
- `frontend/src/lib/providers/provider-credentials.ts` — **deliberately NOT changed** (probe did not exit 0 with the stored credential; §65/Part 9 — the registry stays honest)
- Diagnostic scripts used this session were ephemeral under `/tmp` (alias + shape checks) and are intentionally not committed — they exist only to keep secret values inside process env.

## Architecture Impact

None beyond verification tooling: no schema, no adapter change (`redis-rate-limiter.server.ts` untouched), no `architecture/registry.json` change (shrink-only ratchet respected), no registry status change, no phase status change. The probe fix corrects a latent defect in wave-4 verification tooling; its semantics (read-only PING + one governed rate-limit check, fail-closed, §30-clean) are unchanged. Version-target: V1 only.

## Tests

- Probe runs (all output redirected to `/tmp`, statuses only):
  - Stored-as-is values: adapter contract rejection → **exit 1** (FINDING recorded; registry untouched).
  - In-memory-repaired URL (diagnostic only): **exit 0 — CAPABILITY_PROVEN** (PING http 200 → PONG + governed rate-limit check → allow) — after the PONG fix.
  - Payload status verified directly: http 200, `result: "PONG"`, no error field.
- Full gate `npm run verify` (typecheck + suites + registry/workforce/drift/neutrality/secrets gates + build) run before commit — exit 0 required.
- `tests/unit/providers/provider-credentials.test.ts` "keeps the optional Redis plane NOT_CONFIGURED until credentials exist" remains true and untouched — the honest state is still `NOT_CONFIGURED`.

## Security Validation

- §30: no secret value was ever printed, logged, echoed into a shell trace, or committed. All probe/shape-check output went to `/tmp/*.txt` and carries statuses and shape booleans only. The repaired URL existed solely inside the diagnostic process env.
- §65/Part 9: the registry claims only what the probe proves — with the stored credential it proves nothing beyond "malformed", so `NOT_CONFIGURED` stands. No fabricated OPERATIONAL status.
- Fail-closed posture preserved end-to-end: adapter contract rejects non-`https://` before any contact; the probe blocks without credentials; the limiter degrades to in-process (Part 31).
- §19 minimization: nothing was pushed to Vercel this wave; the malformed value was never synced anywhere.

## Known Risks

- The stored Cursor Secret `UPSTASH_REDIS_REST_URL` remains malformed (`ttps://…`) until the operator fixes it — the single remaining activation blocker. Everything else (token validity, data plane, adapter, probe) is proven ready.
- The secrets live under Upstash console names, so even a corrected value would not be picked up by `scripts/provision-vercel-env.mjs` or `rateLimiterFromEnv` without per-session aliasing. Recommended: rename both secrets to `REDIS_REST_URL` / `REDIS_REST_TOKEN` (runbook §1 step 5) so the platform consumes them natively.
- Database region remains unverified: the REST data plane cannot report the database's region, and DECISIONS.md #205 requires West-EU (eu-west-1 / eu-central-1). Only the operator can confirm (or recreate) the region in the Upstash console. If the database turns out to be US-region, recreate in EU and hand over NEW keys — nothing has consumed the old ones.
- If the truncated `h` came from a copy/paste habit rather than a one-off, re-grabbing both values freshly (rather than hand-editing) is safer.

## Remaining Work

- Operator (human-only, ONE step): fix `UPSTASH_REDIS_REST_URL` in Cursor Secrets (restore the leading `h`; value must start `https://`) — and preferably rename both secrets to `REDIS_REST_URL` / `REDIS_REST_TOKEN` per runbook §1 step 5. Then confirm the Upstash database region is West-EU (DECISIONS.md #205).
- Agent (next window, after the fix): run `node scripts/infrastructure/redis-capability-probe.mjs` (expect exit 0), run `node scripts/provision-vercel-env.mjs` (expect REDIS_REST_URL + REDIS_REST_TOKEN upserted), then flip both registry entries to `OPERATIONAL` / `capability_tested` with dated probe evidence.
- Still open from prior waves (unchanged): `TWILIO_FROM_NUMBER` (console step, deliberate hold), optional `SENTRY_DSN`, PostHog EU migration, Apple/Google enrollments.