# RUNBOOK — Deployment monitoring gate (BLK-3 serving-URL gate, operator procedure)

Status: **AUTHORED** — H3-wave mission E-042 (team H3-042, Deployment Monitor Engineer,
Squad E launch-gate drills, BLK-3). This runbook defines the operational procedure for
observing a deployment's serving URL through the gate contract in
`frontend/src/lib/observability/deployment-gate.ts` (authored by the same mission). The
gate is a READ-ONLY observer: it issues HTTP GET probes and a typed verdict; it never
mutates deployment state, never restarts services, and never applies a fix itself.
Authority: AGENTS.md §29 (observability), §30 (secrets), §21 (AI/automation output is
untrusted by default — gate verdicts are reviewed, not obeyed blindly), §42 (report
format); campaign law in `architecture/campaigns/H3-WAVE-CAMPAIGN.md` (no canonical
access by teams; secrets never printed; honesty over evidence).

Related contracts cited (read-only composition):

| Artifact | Owner | Role in the gate |
| --- | --- | --- |
| `frontend/src/lib/observability/deployment-gate.ts` | E-042 | Typed gate contract: poll results, bounded retry/backoff, fail-closed config validation, PASS/BLOCKED verdict |
| `frontend/src/lib/observability/health.ts` | V5.3 Part 30 | Health taxonomy reused read-only: `HealthStatus` (ok / degraded / failing), `aggregateStatus` (worst-of), `isHealthStatus` |
| `frontend/src/lib/observability/structured-log.ts` | V5.3 Part 30 | Secret-safe evidence: `serializeError` (`Name: message` only), key redaction |
| `tests/unit/h3-042-deployment-gate.test.ts` | E-042 | Offline battery: mocked transport only — zero network, zero database |
| `docs/runbooks/incident-lockdown.md` | L-T-011 | Escalation path when a gate BLOCKED coincides with a real incident |
| `scripts/verify-recovery-drill.mjs` (sibling BLK work, Squad A) | A-001 | Exemplar of the fail-closed BLOCKED_NO_CREDENTIAL discipline this gate mirrors |

---

## 1. Golden questions (WHO / WHAT / WHERE / WHY / POLICY)

- **WHO:** a platform operator holding the approved deployment window. The gate verdict
  is evidence for a human decision, never a self-executing action: every BLOCKED (and
  every PASS that authorizes promotion) is reviewed by a second engineer before being
  recorded as platform state (AGENTS §21).
- **WHAT:** prove that a deployment is *observed serving, not assumed serving*: the
  gate probes the deployment's serving URL(s), classifies each poll as typed
  `ok | degraded | failing`, and issues a bounded-verdict `PASS` or `BLOCKED`.
- **WHERE:** offline evaluation (unit battery, mocked transport) runs anywhere with
  zero network. Live observation runs ONLY against the deployment's own serving URL —
  the same surface the deployment exposes publicly. The gate never touches the
  database, the canonical project, or any credential-gated endpoint.
- **WHY:** a deployment that answers with errors, slowly, or with an unhealthy health
  report is not launched — it is merely reachable. BLK-3 turns serving quality into a
  governed, evidence-bearing gate instead of an assumption.
- **POLICY:** fail-closed law (invalid configuration blocks before any probe); the
  bounded retry/backoff policy of the contract (§4); the secrets law (§5 — monitored
  URLs and all evidence are secret-free by construction); AGENTS §29/§30.

## 2. What the deployment gate must observe

For each configured serving URL, one poll attempt observes exactly:

1. **Transport outcome** — the URL answered (with an HTTP status) or threw (timeout,
   DNS, connection refused). A thrown transport is retryable.
2. **HTTP status** — must equal `expectedHttpStatus` (default 200). A 5xx is
   retryable; a 4xx, a non-expected 2xx, a 3xx, and a 1xx are deterministic failures
   and are NOT retried.
3. **Latency** — measured per attempt against `degradedLatencyMs`. A successful probe
   slower than the budget is classified `degraded`, not `ok`. Latency alone never
   triggers a retry.
4. **Health report body (optional, `inspectBody`)** — when enabled, a 200 body must
   parse as a JSON object carrying a valid `status` per the `./health` contract
   (`isHealthStatus`). The poll's status is then the worst-of of the latency
   classification and the body status (`aggregateStatus`). An invalid body fails the
   probe immediately (`invalid health report body`) — fail-closed.

The gate MUST NOT observe anything else: no cookies, no auth headers, no tenant data,
no response bodies beyond the optional health-status field. Observation is read-only.

## 3. Modes and the verdict contract

| Mode | How it runs | Network | Credentials |
| --- | --- | --- | --- |
| **Offline evaluation** | `npx vitest run tests/unit/h3-042-deployment-gate.test.ts` | NONE — mocked transport | NONE |
| **Live observation** | an operator (or governed automation) calls `evaluateDeploymentGate({ config, transport })` with a real transport | the configured serving URL(s) only | NONE — the serving URL must be public; URLs carrying credentials are REJECTED (§5) |

The gate's public verdict contract (mirrors the battery exit-code discipline):

| Verdict | Meaning | Operator action |
| --- | --- | --- |
| `PASS` | every probe is unambiguously `ok` (expected status, within latency budget, valid body when inspected) | Record evidence per §6; PASS still requires second-engineer review before promotion |
| `BLOCKED` — invalid configuration | the config failed validation; NOTHING was probed (`config: null`, `probes: []`) | Fix the named reason; never work around a rejected URL (e.g. by moving a token out of the query string into a header inside the gate — the gate takes no credentials) |
| `BLOCKED` — `degraded` aggregate | all probes answered but at least one is `degraded` (slow, or health body reports degraded) | Investigate latency/health before promotion; a human authority may issue a governed waiver, recorded as evidence — degradation is never silently upgraded to ok |
| `BLOCKED` — `failing` aggregate | at least one probe is `failing` (attempts exhausted, non-expected status, invalid body) | Treat as a launch stop: preserve evidence, do NOT promote; if a real incident coincides, escalate per `docs/runbooks/incident-lockdown.md` |

Only `ok` passes. There is no partial pass, no third verdict, and no silent
degradation of a BLOCKED into a PASS.

## 4. Bounded retry/backoff policy (the numbers are the contract)

Per serving URL:

- **Attempts:** at most `maxAttempts` total tries, schema-hard-capped at 5 (default 3).
- **Retryable:** transport errors (throw) and HTTP 5xx.
- **Not retryable (deterministic):** 4xx, any 2xx other than `expectedHttpStatus`,
  3xx/1xx, and — under `inspectBody` — an invalid health body.
- **Backoff:** before attempt n (n ≥ 2), delay =
  `min(backoffBaseMs × backoffMultiplier^(n−2), backoffMaxMs)`, rounded to an integer
  ms. Defaults: 250 ms, ×2, capped at 2000 ms → schedule 250, 500, 1000, 2000.
- **Bounded total observation time:** worst case per URL is
  `maxAttempts × (requestTimeoutMs + backoffMaxMs)`; worst case for the whole gate is
  `urls ×` that. With schema caps (8 urls × 5 attempts × 30 s timeout + 15 s backoff)
  the gate can never run away.
- **Timeouts:** the gate passes `requestTimeoutMs` to the transport per attempt; the
  transport owns honoring it. The gate never waits unbounded on a transport.

## 5. Fail-closed and secrets law

- **Invalid configuration blocks before any probe.** A config that fails schema
  validation, repeats a URL, or contains any rejected URL produces `verdict: BLOCKED`
  with named reasons, `config: null`, and an untouched transport. Nothing is guessed.
- **Monitored URLs must be secret-free by construction.** Rejected: unparseable URLs,
  non-http/https schemes, embedded userinfo (`user:pass@…`), query strings (tokens
  must never appear in a monitored URL or in recorded evidence), and fragments.
  `servingUrlProblem` names every violation.
- **Evidence is secret-safe:** transport failures are recorded via `serializeError`
  (`Name: message` only — never stack traces, never raw payloads), probe results carry
  the validated URL, HTTP status, latency, and delays — nothing else.
- **Never log secrets:** operators must not paste raw curl output, headers, or bodies
  into evidence; only the gate result object (§6) is recorded.

## 6. Evidence discipline (BLK-3)

Every live gate observation is recorded as evidence BEFORE any promotion decision:

1. **Record the full gate result object** as returned by `evaluateDeploymentGate`:
   `verdict`, `blockedReasons`, `aggregate`, `probes[]` (each with `url`, `status`,
   `attempts`, `httpStatus`, `latency_ms`, `error`, `delays_ms`), `startedAt`,
   `finishedAt`. The object is secret-free by construction (§5).
2. **Record provenance:** who ran the gate, against which deployment/commit, when.
3. **Two-person rule:** the recorded verdict is reviewed by a second engineer before
   being treated as platform state (AGENTS §21 — automation output is untrusted).
4. **Honesty:** never record a PASS that was not observed by the contract, never
   reclassify a BLOCKED as a PASS after the fact, never trim failed probes from the
   evidence. A missing or falsified evidence record is a FINDING, not a gate result.
5. **Retention:** evidence is an audit record — append-only; corrections are recorded
   as new entries that cite the original, never edits in place.

## 7. Block semantics and operator actions (BLK-3 procedure, in order)

1. **Declare the config** (serving URLs, `expectedHttpStatus`, latency budget,
   retry/backoff bounds, `inspectBody`). Keep `urls` minimal — one URL per deployment
   surface; never point the gate at credential-gated or tenant-scoped endpoints.
2. **Offline first, always:** the unit battery must be green (`npx vitest run
   tests/unit/h3-042-deployment-gate.test.ts`) before any live observation. A red
   battery is a stop-the-line event — the CONTRACT is wrong before any URL is probed.
3. **Live observation:** run `evaluateDeploymentGate` with the real transport during
   the deployment window, immediately after the deployment becomes routable.
4. **Read the verdict through §3's table.** BLOCKED → do not promote; classify the
   reason (invalid configuration / degraded / failing) and act per the table.
5. **Re-observe after remediation.** Each observation is a fresh gate run with fresh
   evidence; remediation is never claimed from a stale result.
6. **Escalate** per `docs/runbooks/incident-lockdown.md` when a BLOCKED coincides
   with a real incident.

## 8. Relationship to the other launch blocks

BLK-3 is the serving-surface gate of the launch-gate drill family (Squad E): BLK-2
governs the AI live drill, BLK-4 the payment rail, BLK-5 communication. The blocks are
independent evidence producers; a PASS from BLK-3 never implies a PASS from the
others, and vice versa. BLK-3 composes with the health endpoint contract (`./health`)
read-only: it consumes the `HealthStatus` taxonomy and the worst-of aggregation, it
never writes health state and never substitutes for the health endpoint itself.

## 9. Honesty law

This runbook is AUTHORED, not executed: no live deployment observation has been run by
this mission, and none is claimed. The only executed evidence is the offline unit
battery with a mocked transport (zero network, zero database). The live procedure
above becomes executable exactly as written once an operator holds a deployment
window; until then it is GOVERNED NOT EXECUTED.