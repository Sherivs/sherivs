# RUNBOOK — Webhook signature drill (BLK-4 live signature-verified webhook evidence, operator procedure)

Status: **AUTHORED — GOVERNED, NOT EXECUTED.** H3-wave mission C-026 (team H3-026, Webhook
Drill Engineer, L-T-009). This runbook defines the operator procedure that produces the
live signature-verified webhook evidence that BLK-4 (COND-006) requires before any live
payment rail is enabled. **The drill described here has NOT been executed by this mission**
— no network call, no webhook delivery, no credential use. Execution is gated to a
coordinator-serialized window with TEST-MODE credentials only (§3); live rail keys are
refused by design at every gate this procedure touches.
Authority: AGENTS.md §26 (API governance), §29 (observability), §30 (secrets), §36
(payment security — signature validation, idempotency, audit, ownership validation, replay
protection; never trust frontend payment state), §42 (report format); campaign law in
`architecture/campaigns/H3-WAVE-CAMPAIGN.md` (no canonical access by teams; secrets never
printed; honesty over evidence); `COREGRID_V1_BLOCKERS.json` BLK-4 ("Live payment
validation requires the Paystack live/secret key... The contract is verified; live rails
are never faked"); threat ledger L-T-009
(`architecture/coregrid-mvp-architecture/security/THREAT_MITIGATIONS_LT.md`) — verdict
`PARTIAL`, OPEN remainder: *live signature-verified webhook evidence under BLK-4 before any
live payment rail — an operational proof, not a unit test.*
Evidence discipline mirrored from:
`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` (verbatim
logs, findings-not-passes honesty rules, cleanup verified by re-count, secret-free evidence
— names not values).

---

## 1. Golden questions (WHO / WHAT / WHERE / WHY / POLICY)

- **WHO:** the campaign coordinator (H3-000) holds the drill window and serializes it
  (the drill touches no database, but it shares the payment-provider surface with the
  BLK-4 payment-rail drill of E-043 — the coordinator runs one, then the other, never
  concurrently). The operator executing the drill is a named human engineer; results are
  reviewed by a second engineer before being recorded as platform state (AGENTS §21 —
  automation output is untrusted by default). Autonomous agents author and review the
  procedure; they do not execute live rails.
- **WHAT:** convert L-T-009's static claim — "signature verification and replay rejection
  are implemented and unit-proven" — into *executed evidence on a live webhook rail in
  Paystack TEST-MODE*: a real provider-signed webhook is received, its HMAC-SHA512
  signature is verified against the raw body, forged/tampered/replayed deliveries are
  rejected fail-closed, exactly-once processing holds through the replay guard and the
  universal idempotency contract, and every drill artifact is cleaned up with re-count
  evidence. No real money can move: TEST-MODE transactions are never completed and the
  drill never completes a charge.
- **WHERE:** a designated drill receiver endpoint (a dedicated test webhook receiver
  registered in the Paystack TEST-MODE dashboard) and the live Paystack TEST rails
  (`api.paystack.co` with an `sk_test_` key). NEVER a production serving environment,
  NEVER the canonical database (the drill writes nothing to any database; drill delivery
  records live in the drill receiver's own ephemeral log).
- **WHY:** BLK-4 is the recorded blocker ("live validation pending"); L-T-009 cannot move
  from PARTIAL to ENFORCED until a live provider-signed webhook is verified, negative
  probes are observed to fail closed, and the evidence is captured secret-free. A unit
  test with a fixture secret proves the code; only a live drill proves the *procedure* —
  that the deployed verification path accepts a genuine provider signature and rejects
  every forgery axis an attacker controls.
- **POLICY:** BLK-4 (open, never bypassed — `scripts/verify-launch-criteria.mjs` asserts it
  stays recorded and open); L-T-009 OPEN remainder; COND-006; AGENTS §36 payment security
  controls (each §36 control maps to a drill phase below); campaign law §6 (fail-closed
  `BLOCKED_NO_CREDENTIAL`, exit 2 pattern); AGENTS §30 (secrets never printed).

## 2. Cited contracts (by path — read, never modified by this mission)

| Artifact | Owner | Role in the drill |
| --- | --- | --- |
| `frontend/src/lib/payments/paystack-adapter.ts` | L-T-009 (enforced part) | `verifyPaystackSignature` — fail-closed HMAC-SHA512 over the RAW request body, hex digest in `x-paystack-signature`, constant-time compare; deny codes `missing_signature` / `malformed_signature` / `signature_mismatch`; `parsePaystackWebhook` fails closed on unknown events |
| `frontend/src/lib/payments/replay-guard.ts` | replay axis | `acceptPaymentEvent` — two rejection axes: seen event ids (`duplicate_event`) and event timestamps outside the 300s tolerance (`stale_event` / `future_event` / `unidentified_event`); stateless-in/stateless-out |
| `frontend/src/lib/command/idempotency.ts` | J-030 (L-T-012) | universal idempotency: replay (same key + same payload) returns the RECORDED outcome, no new external effect; collision rejected; TTL bounds replay trust |
| `frontend/src/lib/payments/payment-contract.ts` | payment contract | idempotency-key consumption surface the adapters use |
| `frontend/src/lib/payments/paystack-testmode.server.ts` | MISSION-R-32 | governed LIVE surface: TEST keys only (`sk_test_` prefix — `non_test_key` deny otherwise), audit-before-execute, `verifyOwnedPayment` ownership re-check against the canonical reference |
| `tests/unit/payments-paystack-testmode-live.test.ts` | MISSION-R-32 | the credential gate exemplar: `describe.skipIf(!LIVE_CREDENTIALS)` where `LIVE_CREDENTIALS = envKey.startsWith("sk_test_")`; a live key in the environment is refused like any other credential class |
| `tests/unit/payments-paystack-adapter.test.ts`, `tests/unit/payments-replay-guard.test.ts` | unit layer | the unit-proven baseline this drill upgrades to executed evidence |
| `scripts/verify-launch-criteria.mjs` | launch gate | asserts BLK-4 recorded and open; never bypassed by drill evidence — drill evidence is what justifies *closing* BLK-4, via the coordinator, not the drill itself |
| `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` | J-041 | evidence discipline this drill mirrors (honesty rules, cleanup verified by re-count, secret-free evidence) |
| `architecture/campaigns/h3/webhook-drill-evidence-template.md` | C-026 (this mission) | the evidence ledger template the executing operator fills (§7) |
| `docs/runbooks/payment-rail-drill.md` | E-043 | sibling BLK-4 drill (payment round-trip); serialized after/before this one by the coordinator; this drill owns the webhook axis only |

## 3. Gate law — when this drill may run, and with what credentials

1. **Coordinator-serialized execution only.** The drill runs inside a window held by the
   campaign coordinator (same exclusive-access discipline as the canonical apply, minus
   database access). A team, an agent, or a CI job running this drill outside the window
   is a campaign violation; its evidence is void.
2. **TEST-MODE credentials only.** The only credential class that enables the drill is a
   Paystack TEST secret key (`sk_test_…`), provisioned via the approved secrets channel
   (Cursor Dashboard → Secrets) as an environment variable NAME. Live rail keys
   (`sk_live_…`) are refused by design at every gate:
   - `validateTestModeKey` returns `non_test_key` — the governed live surface refuses the
     key before any call;
   - the drill gate re-validates the same prefix (the exemplar's `LIVE_CREDENTIALS`
     pattern) — a live key in the environment BLOCKS the drill like a missing one;
   - a refusing gate must never be "worked around" — no inline values, no alternate
     surface, no env shim.
3. **Fail closed on absence (exit 2 pattern).** With no credential present, the drill
   BLOCKS before any side effect: `BLOCKED_NO_CREDENTIAL` semantics — exit code 2, a
   clean block message, never an error traceback, never a retry against a guessed
   endpoint. Missing audit sink, missing receiver registration, or a non-test key class
   are equally clean blocks (AGENTS §36: audit-before-execute is mandatory — no mutation
   without its audit record).
4. **No secret values, ever (AGENTS §30).** The operator must never print, log, redirect,
   or paste a secret VALUE — not the key, not a computed signature derived from it (the
   digest is key-derived material; record its presence, length class, and verdict only,
   never the value). Terminal history, CI logs, and evidence files are all in scope. See
   §7's redaction discipline and the evidence template's secret-free rules.
5. **BLK-4 stays open during the drill.** The drill operates on the TEST rails precisely
   because BLK-4 forbids the live rails. Drill evidence does not itself lift BLK-4; the
   coordinator (and the human launch-gate owner) decides that from the archived evidence.

## 4. Modes and the exit-code contract

| Mode | Invocation | Network | Credentials |
| --- | --- | --- | --- |
| **Offline rehearsal** (described state) | `npx vitest run tests/unit/payments-paystack-adapter.test.ts tests/unit/payments-replay-guard.test.ts` | NONE | NONE — clearly-marked fixture secrets only |
| **Live drill** (gated) | coordinator window; TEST-MODE receiver + provider rails | Paystack TEST rails + drill receiver only | `sk_test_` key via env NAME only |

Exit codes (the exemplar battery semantics, campaign law §6):

| Code | Meaning | Operator action |
| --- | --- | --- |
| `0` | **PASS** — every §5 probe verified against the live rails | Archive evidence per §7; BLK-4 closure decision belongs to the coordinator |
| `1` | **FAIL / FINDING** — a probe failed (a forged signature was accepted, a tampered body processed, a replay produced a second effect, a known event was dropped, cleanup unverified) | Stop-the-line. Preserve artifacts, file a finding against L-T-009, do NOT claim live evidence. A drill FAIL while BLK-4 is open is a *pre-block catch*, not a production incident — but it blocks BLK-4 closure indefinitely |
| `2` | **BLOCKED_NO_CREDENTIAL** — nothing ran; gate refused (missing key, non-test key class, missing audit sink, missing receiver) | Provision via the approved channel and re-run inside the window. NEVER work around exit 2 |

## 5. Drill phases (live mode — every phase is an §36 control, executed)

| Phase | §36 control | What happens | Operator watch-point |
| --- | --- | --- | --- |
| 1 PREPARE | — | Register the drill receiver endpoint in the Paystack TEST dashboard; verify the receiver logs raw body + headers, verifies via `verifyPaystackSignature`, and applies `acceptPaymentEvent` + idempotency before any effect | Receiver must hold NO credential value and log NO signature values — presence and verdict only |
| 2 POSITIVE — genuine signature | signature validation | Complete a TEST-MODE charge with a Paystack test card through the hosted flow so the provider emits a genuine `charge.success` webhook; the receiver verifies the HMAC-SHA512 signature over the exact raw bytes | A 200-ack with an unverified signature would be the exact failure BLK-4 fears — verification MUST precede any acknowledgement that implies acceptance |
| 3 OWNERSHIP — server-resolved reference | ownership validation | The receiver resolves the transaction reference against the server-resolved canonical reference (amount/currency exactly match, `verifyOwnedPayment` posture) — never trusts webhook body amounts alone | A mismatch must DENY (`ownership_mismatch` posture), never absorb |
| 4 NEGATIVE — forged | signature validation (fail closed) | Re-deliver a hand-crafted body signed with a WRONG secret (a throwaway test secret, never the drill key) → expect `signature_mismatch`, no effect, no ack-as-valid | The forged delivery MUST be rejected before parse; anything else is a FINDING |
| 5 NEGATIVE — tampered | signature validation (fail closed) | Deliver the genuine body with one byte altered, signature still the provider's original → expect `signature_mismatch` | Constant-time compare over exact injected bytes — a "verify-then-reparse" gap would surface here |
| 6 NEGATIVE — missing/malformed | signature validation (fail closed) | Deliver with the header stripped, then with a non-hex value → expect `missing_signature` / `malformed_signature` | Fail-closed deny codes observed, not assumed |
| 7 NEGATIVE — replay (duplicate id) | replay protection | Redeliver the genuine webhook unchanged → `acceptPaymentEvent` returns `duplicate_event`; the financial effect happens exactly once (first delivery only) | Exactly-once is the pass condition; a second effect of ANY kind is a FINDING |
| 8 NEGATIVE — stale / future | replay protection | Deliver the genuine body with `occurredAt` shifted beyond the 300s tolerance (stale, then future) → `stale_event` / `future_event` | The tolerance axes are tested BOTH directions — the guard is symmetric |
| 9 IDEMPOTENCY — registered reference | idempotency | The first accepted delivery registered the idempotency key; a same-key/same-payload replay returns the RECORDED outcome with no new external effect; a same-key/different-payload replay is rejected (collision) | Replay-trust is TTL-bounded — an expired record must never replay a stale outcome |
| 10 UNKNOWN EVENT — fail closed | fail-closed parsing | An out-of-taxonomy event type (delivered via a signed test fixture through the receiver's local path) → `parsePaystackWebhook` rejects; no default-accept path | A "process anything signed" behavior is a FINDING — known events only |
| 11 CLEANUP | audit / hygiene | Remove every drill artifact: TEST-MODE transactions left pending (never completed — no card is charged beyond the provider's test ledger), receiver records, dashboard webhook registration. **Cleanup is verified by re-count** (RLS-battery discipline: `probe_cleaned=true`), and the audit sink records are reconciled — every accepted effect has exactly one audit record, every denied delivery a deny record | A failed or unverified cleanup is a FINDING (exit 1) even if every probe passed |

**VERDICT=PASS requires ALL phases: 11/11.** Ten-of-eleven is a FAIL — partial evidence is
not evidence (the all-checks-true shape of the M-R-101 recovery contract and the RLS
battery's per-table verdicts).

## 6. Honesty rules (outcomes that are NOT passes)

Lifted from the RLS isolation battery's discipline and bound to every drill operator:

- **A verified signature proves the signature, not the effect.** Phase 2 passes only when
  signature verification, ownership re-check, replay-guard acceptance, and the audit
  record ALL hold for the same delivery. An acknowledged webhook with a skipped ownership
  re-check is `INCONCLUSIVE` with a finding, never a pass.
- **Denials are the pass condition for negative probes** (Phases 4–8, 10). A negative
  probe that "succeeds" (delivery accepted) is the strongest possible FINDING — it is the
  forgery/replay path live.
- **Test-mode limitation is recorded, never glossed.** TEST rails exercise the same
  signature scheme and endpoints, but they are not the live rails. The evidence record
  must state `mode=test` explicitly (the governed surface already stamps it), and BLK-4
  closure reasoning must account for the residual difference (live-key class, live
  dashboard, live rail incidents).
- **Skipped is not run.** A gate that skips (`describe.skipIf` semantics, exit 2) proves
  nothing; the ledger records it as BLOCKED, never as a green row.
- **No retro-fitting.** Every log line in the evidence ledger is verbatim from the run.
  A line that does not appear in the captured output is not evidence; a claim without a
  captured line is void.

## 7. Evidence capture (secret-free discipline — names not values)

The executing operator fills `architecture/campaigns/h3/webhook-drill-evidence-template.md`
as the ledger, mirroring the RLS battery's artifact pattern:

- **Verbatim log excerpts** — the receiver's log lines and the drill runner's verdict
  lines, captured verbatim. Secret-free by construction: a credential appears ONLY as
  `key provenance: source=<approved-secrets-channel> class=sk_test_ prefix=<first 8 chars>
  (value never printed)` — the RLS battery's `prefix=eyJhbGciOi` pattern. Signature
  digests, authorization URLs, and access codes are likewise recorded as
  presence/length/verdict, never values.
- **Per-phase matrix** — phase → §36 control → observed deny/accept code → verdict, one
  row per phase, verdict `PASS` / `FINDING` / `INCONCLUSIVE` / `BLOCKED`.
- **Findings table** — every non-PASS row gets a finding: observed behavior, expected
  fail-closed behavior, cited module path, and severity. FINDINGS: 0 is a claim that must
  match the captured logs.
- **Cleanup verification** — the re-count evidence: probe transactions reconciled on the
  TEST ledger, receiver records emptied, webhook registration removed, audit records
  accounted one-to-one. `probe_cleaned=true` per artifact family or the drill exits 1.
- **Storage** — `architecture/proofs/` alongside the existing proof records
  (`CANONICAL_APPLY_RECORD_HARDENING.json` pattern), referenced from the L-T-009 ledger
  row when the coordinator ratifies. Artifacts live in the repo; raw delivery captures
  with redaction applied; nothing with secret-shaped material, ever.

## 8. Repetition plan

1. First execution: coordinator window, after E-043's runner and this runbook's cited
   contracts are all in place; TEST-MODE credential provisioned via the approved channel.
2. Re-run cadence: at every BLK-4-relevant change to the verification path
   (`paystack-adapter.ts` signature code, `replay-guard.ts` tolerance/axes,
   `idempotency.ts` semantics) and at the launch-gate review that considers closing BLK-4.
3. Any FAIL → finding against L-T-009; verdict reverts to PARTIAL regardless of prior
   state; BLK-4 closure is off the table until a clean re-run.
4. When (and only when) the human launch-gate owner lifts BLK-4, the same procedure
   re-runs against the live rails as a ratification step — live keys then enter through
   the same approved channel, same serialization, same secret-free evidence law. This
   runbook governs that future run too; only the credential class changes.