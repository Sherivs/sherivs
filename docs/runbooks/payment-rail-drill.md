# RUNBOOK — Payment rail drill (BLK-4 TEST-MODE round-trip evidence, operator procedure)

Status: **AUTHORED — GOVERNED, NOT EXECUTED.** H3-wave mission E-043 (team H3-043,
Payment Rail Drill Engineer, BLK-4). This runbook defines the operator procedure that
produces the executed TEST-MODE payment-rail evidence that BLK-4 (COND-006) requires
before any live payment rail is enabled. **The drill described here has NOT been
executed by this mission** — no network call, no provider contact, no credential use.
Execution is gated to a coordinator-serialized window with TEST-MODE credentials only
(§3); live rail keys (`sk_live_…`) are refused by design at every gate this procedure
touches.

Authority: AGENTS.md §26 (API governance), §27 (server-function rule — the governed
round executes through the same audited, validated surface), §29 (observability), §30
(secrets), §36 (payment security — signature validation, idempotency, audit, ownership
validation, replay protection; never trust frontend payment state), §42 (report
format); campaign law in `architecture/campaigns/H3-WAVE-CAMPAIGN.md` (no canonical
access by teams; secrets never printed; honesty over evidence; `BLOCKED_NO_CREDENTIAL`
exit-2 pattern); `COREGRID_V1_BLOCKERS.json` BLK-4 ("Live payment validation requires
the Paystack live/secret key… The contract is verified; live rails are never faked");
runbook `docs/runbooks/webhook-signature-drill.md` (sibling BLK-4 drill — C-026 owns
the webhook/signature axis; this runbook owns the payment round-trip axis; the
coordinator runs the two drills serialized, never concurrently).

---

## 1. Golden questions (WHO / WHAT / WHERE / WHY / POLICY)

- **WHO:** the campaign coordinator (H3-000) holds the drill window and serializes it
  (this drill shares the payment-provider surface with C-026's webhook drill — one runs
  after the other, never concurrently). The operator executing the drill is a named
  human engineer; results are reviewed by a second engineer before being recorded as
  platform state (AGENTS §21 — automation output is untrusted by default). Autonomous
  agents author and review the procedure; they do not execute payment rails.
- **WHAT:** convert BLK-4's static claim into *executed evidence on a live Paystack
  TEST-MODE round-trip* driven through the governed testmode server module: a canonical
  server-resolved `PaymentReference` (tenant, purpose, minor-unit amount — never client
  payment state) is initialized on the TEST rails with the derived idempotency key
  registered as the provider-side reference; the provider's record is re-verified
  against the SAME canonical reference (ownership validation); a deliberately mismatched
  expected amount is DENIED (`ownership_mismatch` — the denial is the pass condition);
  every mutating step carries its audit record (audit-before-execute); the TEST-MODE
  transaction is left pending BY DESIGN — the drill never completes a charge and never
  moves money.
- **WHERE:** the live Paystack TEST rails (`api.paystack.co` with an `sk_test_` key)
  through the governed surface only. NEVER a production serving environment, NEVER the
  canonical database (the drill writes nothing to any database; evidence lands in the
  artifact directory as secret-free JSON + log).
- **WHY:** BLK-4 is the recorded blocker ("live validation pending"). A unit test with
  a fixture secret proves the code; only a live TEST-MODE drill proves the *procedure* —
  that the governed round-trip initializes on real provider rails, that ownership
  validation holds against the provider's own record, and that an amount/currency
  mismatch is refused fail-closed rather than absorbed.
- **POLICY:** BLK-4 (open, never bypassed — `scripts/verify-launch-criteria.mjs` asserts
  it stays recorded and open); COND-006; AGENTS §36 controls (each maps to a drill
  phase below); campaign law §6 (fail-closed `BLOCKED_NO_CREDENTIAL`, exit 2 pattern);
  AGENTS §30 (secrets never printed).

## 2. Cited contracts (by path — read, never modified by this mission)

| Artifact | Owner | Role in the drill |
| --- | --- | --- |
| `frontend/src/lib/payments/paystack-testmode.server.ts` | MISSION-R-32 | the governed LIVE surface the round executes through: TEST keys only (`sk_test_` — `non_test_key` deny otherwise), audit-before-execute (a throwing sink denies the mutation), `verifyOwnedPayment` ownership re-check, idempotency key registered as the provider-side reference, declared failure policy (bounded timeout, single-attempt mutation, circuit breaker) |
| `frontend/src/lib/payments/payment-contract.ts` | payment contract | `PaymentReference` canonical ownership envelope, `validatePaymentReference` fail-closed validation, `deriveIdempotencyKey` (deterministic — the replay-protection key) |
| `frontend/src/lib/payments/paystack-adapter.ts` | L-T-009 (C-026) | webhook translation + signature axis — exercised by the SIBLING drill, not this one |
| `frontend/src/lib/adapters/failure-policy.ts` | J-045 | the declared failure policy the governed surface runs every network call through |
| `scripts/verify-payments-live.drill.mjs` | E-043 (this mission) | the credential-gated runner: gate → audit → initialize → verify-owned → negative-ownership → cleanup/by-design; exit codes 0/1/2 per §4 |
| `tests/unit/h3-043-payments-drill.test.ts` | E-043 (this mission) | OFFLINE gate tests: exit-2 semantics, live-key refusal, argument validation, secret hygiene — never executes a live round |
| `tests/unit/payments-paystack-testmode.test.ts`, `tests/unit/payments-paystack-testmode-live.test.ts` | MISSION-R-32 | the unit baseline + the `describe.skipIf(!LIVE_CREDENTIALS)` credential-gate exemplar this runner's gate mirrors |
| `scripts/verify-launch-criteria.mjs` | launch gate | asserts BLK-4 recorded and open; never bypassed by drill evidence — drill evidence is what justifies *closing* BLK-4, via the coordinator, not the drill itself |
| `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` | J-041 | evidence discipline mirrored here (verbatim logs, findings-not-passes honesty rules, secret-free artifacts) |
| `docs/runbooks/webhook-signature-drill.md` | C-026 | sibling BLK-4 drill (webhook/signature axis); serialized with this one by the coordinator |

## 3. Gate law — when this drill may run, and with what credentials

1. **Coordinator-serialized execution only.** The drill runs inside a window held by the
   campaign coordinator (exclusive-access discipline, no database involved). A team, an
   agent, or a CI job running the round outside the window is a campaign violation; its
   evidence is void.
2. **TEST-MODE credentials only.** The only credential class that enables the drill is
   a Paystack TEST secret key (`sk_test_…`), provisioned via the approved secrets
   channel (Cursor Dashboard → Secrets) as the environment variable NAME
   `PAYSTACK_SECRET_KEY`. Live rail keys are refused by design at EVERY gate:
   - the runner's gate classifies the credential BEFORE any network contact — a live
     key (`sk_live_…`), or any other non-test class, blocks exactly like a missing key
     (`BLOCKED_NO_CREDENTIAL`, exit 2, constant-shaped secret-free message);
   - the governed surface independently re-validates the key class
     (`validateTestModeKey` → `non_test_key`) before any provider call — defense in
     depth, never a single point of refusal;
   - a refusing gate must never be "worked around" — no inline values, no alternate
     surface, no env shim.
3. **Fail closed on absence (exit 2 pattern).** With no credential present, the drill
   BLOCKS before any side effect: `BLOCKED_NO_CREDENTIAL` semantics — exit code 2, a
   clean block message, never an error traceback, never a retry against a guessed
   endpoint. Nothing is probed; no network contact is made; no artifact is written.
4. **No secret values, ever (AGENTS §30).** The operator must never print, log,
   redirect, or paste a secret VALUE — not the key, not an authorization URL or access
   code (provider-issued material is recorded as presence/verdict only). Terminal
   history, CI logs, and evidence files are all in scope. The runner records key
   provenance as `source=env class=sk_test_ (value never printed)` — the name, the
   class, never the value.
5. **BLK-4 stays open during the drill.** The drill operates on the TEST rails precisely
   because BLK-4 forbids the live rails. Drill evidence does not itself lift BLK-4; the
   coordinator (and the human launch-gate owner) decides that from the archived
   evidence.

## 4. Modes and the exit-code contract

| Mode | Invocation | Network | Credentials |
| --- | --- | --- | --- |
| **Offline rehearsal** | `node scripts/verify-payments-live.drill.mjs --rehearse` | NONE | NONE — no credential is read; exercises the gate's credential-class vectors and the contract/reference/idempotency vectors through the real modules |
| **Offline unit gate tests** | `npx vitest run tests/unit/h3-043-payments-drill.test.ts` | NONE | NONE — fixture-shaped strings only; never executes a live round |
| **TEST-MODE round** (gated) | coordinator window; `node scripts/verify-payments-live.drill.mjs` | Paystack TEST rails only (`api.paystack.co`) | `sk_test_` key via env NAME only |

Exit codes (the exemplar battery semantics, campaign law §6):

| Code | Meaning | Operator action |
| --- | --- | --- |
| `0` | **PASS** — every round step verified against the TEST rails (or rehearsal clean) | Archive artifacts per §7; BLK-4 closure decision belongs to the coordinator |
| `1` | **FAIL / FINDING** — a round step failed (initialize denied, owned-verify mismatched, negative-ownership probe ACCEPTED, audit/record defect) | Stop-the-line. Preserve artifacts, file a finding against BLK-4's ledger, do NOT claim live evidence. A drill FAIL while BLK-4 is open is a *pre-block catch*, not a production incident — but it blocks BLK-4 closure indefinitely |
| `2` | **BLOCKED_NO_CREDENTIAL** — nothing ran; the gate refused before ANY network contact (missing key, live-key refusal, non-test class, unknown argument `BLOCKED_USAGE`) | Provision via the approved channel and re-run inside the window. NEVER work around exit 2 |

## 5. Drill phases (TEST-MODE round — every phase is an §36 control, executed)

| Phase | §36 control | What happens | Operator watch-point |
| --- | --- | --- | --- |
| 1 GATE | credential-class enforcement | The runner classifies `PAYSTACK_SECRET_KEY` (missing / test / live / other) BEFORE any network contact; only `sk_test_` proceeds; the governed surface re-validates independently | A live key must block exactly like a missing one; the block message names the CLASS, never the value |
| 2 AUDIT | audit-before-execute | The §36 audit sink is installed; the governed surface awaits it BEFORE the mutating initialize call | If the sink were to throw, the mutation is DENIED — no payment mutation without its audit record |
| 3 REFERENCE_VALIDATION | ownership validation (server-resolved plan) | The canonical drill reference (tenant, server-resolved payer, minor-unit amount, canonical purpose ref) is validated fail-closed | Amounts/currency come from the runner's server-side plan — NEVER from client payment state |
| 4 INITIALIZE | idempotency | `initializePaystackTestTransaction` calls the TEST rails; the derived idempotency key travels as the provider-side transaction reference, so replays of the same payment dedupe server-side | The reference is registered server-side — this IS the replay protection; a second initialize of the same reference must never double-charge |
| 5 VERIFY_OWNED | ownership validation | `verifyOwnedPayment` re-checks the provider's record against the SAME canonical reference — provider-recorded amount and currency must match exactly | A mismatch must DENY (`ownership_mismatch` posture), never absorb; the provider's word alone is never ownership evidence |
| 6 NEGATIVE_OWNERSHIP | ownership validation (fail closed) | The same provider reference is re-verified against a deliberately mismatched expected amount (+1 minor unit) → expect `ownership_mismatch` | Denial IS the pass condition. An ACCEPTED mismatch is the strongest possible FINDING — the ownership-validation gap BLK-4 fears, live |
| 7 CLEANUP / BY-DESIGN | audit / hygiene | The TEST-MODE transaction is left PENDING — the drill never completes a charge, never moves money; audit records are reconciled (exactly one per executed mutation); artifacts written secret-free | `databaseContact=false` is asserted in the record; nothing to delete on the provider beyond the test-ledger entry the drill never completes |

**VERDICT=PASS requires ALL phases: 7/7.** Six-of-seven is a FAIL — partial evidence is
not evidence (the RLS battery's per-table verdict discipline).

## 6. Honesty rules (outcomes that are NOT passes)

- **A successful initialize proves the rails, not ownership.** Phase 4 passes only when
  the owned re-check (Phase 5) AND the audit record hold for the same transaction. An
  initialized transaction with a skipped ownership re-check is `INCONCLUSIVE` with a
  finding, never a pass.
- **Denial is the pass condition for the negative probe** (Phase 6). A mismatch that is
  accepted is the strongest possible FINDING — the ownership path failed open.
- **Test-mode limitation is recorded, never glossed.** TEST rails exercise the same
  endpoints, credential classes, and validation code, but they are not the live rails.
  The evidence record states `rails=TEST` explicitly, and BLK-4 closure reasoning must
  account for the residual difference (live-key class, live dashboard, live rail
  incidents, real money).
- **Blocked is not run.** An exit-2 gate proves the gate, not the rail; the ledger
  records it as BLOCKED, never as a green row.
- **No retro-fitting.** Every log line in the evidence ledger is verbatim from the run.
  A claim without a captured line is void.
- **The drill never completes a charge.** Any operator action that completes the
  TEST-MODE transaction (or a live transaction of any kind) is outside this runbook and
  voids the run's evidence.

## 7. Evidence capture (secret-free discipline — names not values)

The executing operator archives the runner's artifacts and mirrors the RLS battery's
evidence pattern:

- **Verbatim log excerpts** — the runner's verdict lines, captured verbatim.
  Secret-free by construction: a credential appears ONLY as
  `key provenance: source=env class=sk_test_ (value never printed)`; authorization URLs
  and access codes appear as presence/verdict only (`present=true`), never values.
- **Per-phase matrix** — phase → §36 control → observed outcome/deny code → verdict,
  one row per phase, verdict `PASS` / `FINDING` / `INCONCLUSIVE` / `BLOCKED`.
- **Findings table** — every non-PASS row gets a finding: observed behavior, expected
  fail-closed behavior, cited module path, and severity. `FINDINGS: 0` is a claim that
  must match the captured logs.
- **Cleanup/by-design evidence** — the record's `cleanup` line (transaction left
  pending by design, audit record count reconciled, `databaseContact=false`).
- **Storage** — the runner writes `payments-drill-test-round.json/.log` (round) and
  `payments-drill-rehearsal.json/.log` (rehearsal) into the artifact directory
  (`COREGRID_ARTIFACTS_DIR`, default `/opt/cursor/artifacts`). Nothing with
  secret-shaped material is ever written; the coordinator files the round record under
  `architecture/proofs/` alongside the existing proof records when ratifying.

## 8. Repetition plan

1. First execution: coordinator window, after this runner, the governed surface, and
   C-026's webhook drill prerequisites are all in place; TEST-MODE credential
   provisioned via the approved channel.
2. Re-run cadence: at every BLK-4-relevant change to the governed surface
   (`paystack-testmode.server.ts`, `payment-contract.ts`, `adapters/failure-policy.ts`)
   and at the launch-gate review that considers closing BLK-4.
3. Any FAIL → finding against the BLK-4 ledger; BLK-4 closure is off the table until a
   clean re-run.
4. When (and only when) the human launch-gate owner lifts BLK-4, the payment round-trip
   re-runs against the live rails as a ratification step — live keys then enter through
   the same approved channel, same serialization, same secret-free evidence law. This
   runbook governs that future run too; the credential-class gate must be explicitly
   re-authorized for the live class by that human decision (the runner as authored
   refuses live keys by design, and no drill evidence alone changes that).