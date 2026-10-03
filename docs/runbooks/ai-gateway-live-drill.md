# RUNBOOK — AI gateway live drill (one governed inference, operator procedure)

Status: **AUTHORED** — H3-wave mission E-041 (team H3-041, AI Live Drill Engineer, BLK-2,
GOV-P63). This runbook defines the operator procedure for the credential-gated live drill
driven by `scripts/verify-ai-gateway-live.drill.mjs`. Until a live drill is executed under
this procedure by an approved operator, the BLK-2 AI gateway live path is **GOVERNED NOT
EXECUTED**: the existing proof posture is fail-closed unit evidence only
(`tests/unit/ai-gateway.test.ts` — unconfigured-deny semantics), never a live call.

Authority: AGENTS.md §20 (AI gateway — never scatter direct AI calls), §19 (AI privacy —
minimization before any model contact), §21 (AI output trust — output is untrusted by
default), §27 (server-function discipline), §29/§30 (observability without secrets),
§42 (report format); campaign law in `architecture/campaigns/H3-WAVE-CAMPAIGN.md`
(credential-gated code fails closed to BLOCKED_NO_CREDENTIAL; secrets never printed).

Related contracts cited (by path and contract only — no implementation dependency):

| Artifact | Role in the drill |
| --- | --- |
| `frontend/src/lib/ai-gateway.server.ts` (`invokeAiGateway`, `createAiGatewayProvider`) | The governed invocation path being drilled: BLK-2 unconfigured-deny, budget/rate pre-checks, metering, intelligence snapshot |
| `frontend/src/lib/metering/usage-ledger.ts` (`GATEWAY_PURPOSES`) | The declared organizational-intelligence purpose vocabulary the drill's purpose is drawn from |
| `frontend/src/lib/ai-gateway/model-registry.ts` | Declared routing truth; the drill invokes one declared model id through the gateway path |
| `frontend/src/lib/ai-gateway/egress-allowlist.ts` | The egress boundary law this drill respects: the only provider endpoint contacted is the declared gateway endpoint |
| `scripts/verify-ai-gateway-live.drill.mjs` | The drill runner (this runbook's executor) |

---

## 1. Golden questions (WHO / WHAT / WHERE / WHY / POLICY)

- **WHO:** a platform operator holding the approved drill window and the provisioned
  provider credential (via the approved secrets channel — Cursor Cloud Secrets or the
  Kubernetes secret path; never chat, never inline values). The operator is never an
  autonomous agent working alone: every live drill result is reviewed by a second engineer
  before it is recorded as platform state (AGENTS §21 — AI/automation output is untrusted
  by default).
- **WHAT:** prove that the BLK-2 gateway decision is *executed and verified, not assumed*:
  with a usable provider key, the gateway path completes exactly **ONE** governed
  inference — authenticated, context-resolved, authorized, validated, executed once (no
  retry, no fallback), audited, and emitted with minimal data.
- **WHERE:** the offline `--plan` mode runs anywhere (zero network, zero credentials).
  The live mode runs ONLY against the operator-declared `AI_GATEWAY_URL` — the same
  gateway endpoint the AI gateway server is configured with. No other provider endpoint,
  no direct provider API, no bypass path is ever contacted.
- **WHY:** BLK-2 gates every live intelligence capability (gateway live calls, AI worker
  link, agent runtime live testing). A gateway that has never completed one governed,
  metered, attributable inference is not a launch-ready gateway; it is configuration.
- **POLICY:** the exit-code contract of the runner (§2), the gateway's fail-closed
  invariants (BLK-2, Part 29 secret hygiene), §19 minimization, §21 output trust, and the
  one-invocation budget (billed, non-idempotent model calls are never retried).

## 2. Modes and the exit-code contract

| Mode | Invocation | Network | Credentials |
| --- | --- | --- | --- |
| **Offline plan** | `node scripts/verify-ai-gateway-live.drill.mjs --plan` | NONE | NONE — no credential is even read |
| **Live drill** | `node scripts/verify-ai-gateway-live.drill.mjs` | the declared gateway endpoint only, ONE POST | credential-gated; absence is a clean block, never a traceback |

Exit codes (exemplar battery semantics):

| Code | Meaning | Operator action |
| --- | --- | --- |
| `0` | **PASS / PLAN_OK** — the plan validates offline; or the live drill completed one clean governed inference (usage counts present, output digest recorded) | Archive evidence per §6; a PLAN_OK is never a substitute for the live drill |
| `1` | **DRILL_FINDING** — the gateway path did not complete one clean governed inference (provider HTTP error, timeout, malformed response, missing usage counts) | Treat as a FINDING: preserve artifacts, open a finding record, do NOT claim the BLK-2 gate proven |
| `2` | **BLOCKED_NO_CREDENTIAL / BLOCKED_NO_CONFIGURATION / BLOCKED_USAGE** — nothing ran; the block was detected BEFORE any network contact, no artifact written | Provision via the approved secrets channel (credential), complete config (`AI_DRILL_MODEL`, valid https `AI_GATEWAY_URL`), or fix the invocation. NEVER work around exit 2 with inline values |

## 3. Preconditions (all mandatory, in order)

1. **Approved drill window.** A named operator + a second reviewing engineer; a cost
   acknowledgment (the drill spends a negligible, capped number of tokens on the declared
   model).
2. **Credential provisioned by name.** `AI_API_KEY` present in the operator's environment
   via the approved secrets channel. The drill references it BY NAME only; the value is
   never printed, logged, or written (§30). Absent or empty ⇒ the runner exits `2` before
   resolving any endpoint — this is the designed behavior, not an error to fix in code.
3. **Configuration declared.**
   - `AI_GATEWAY_URL` — the gateway base URL (default `https://api.openai.com/v1`, the
     same default as `createAiGatewayProvider`). Must be https and must not embed
     credentials; violations exit `2` before any contact.
   - `AI_DRILL_MODEL` — the declared model id for the drill invocation (required; absent ⇒
     exit `2` before any contact).
4. **Offline plan check first.** Run `--plan`; it must print `STATUS=PLAN_OK` with
   `networkContact=false` before any live attempt is authorized.

## 4. Governed inference procedure (what the runner does, in order)

The runner applies the §27 server-function discipline to one model invocation:

1. **Authenticate** — `AI_API_KEY` gate, fail-closed (exit `2` before any side effect;
   empty/whitespace keys are not usable credentials, mirroring the gateway's trim
   semantics).
2. **Resolve context** — fixed drill identity, never a tenant workload:
   `tenantRef=control-plane/drill`, `actorRef=H3-041-ai-live-drill`,
   `purpose=classification` (from the declared organizational-intelligence purpose
   vocabulary).
3. **Authorize** — the invocation is authorized by this runbook; the runner records
   `authorizedBy=docs/runbooks/ai-gateway-live-drill.md` in its evidence.
4. **Validate** — https-only endpoint, no embedded credentials, declared model present.
5. **Execute** — exactly ONE `POST {AI_GATEWAY_URL}/chat/completions` with a fixed,
   non-personal, single-sentence drill prompt, `max_tokens=16`, `temperature=0`, one
   attempt, a hard 60s timeout, **no transport retry and no model fallback** (billed,
   non-idempotent effects are never blindly retried).
6. **Audit** — evidence written to `ai-gateway-live-drill.json` + `.log` in the artifacts
   directory (`COREGRID_ARTIFACTS_DIR`, default `/opt/cursor/artifacts`): endpoint
   host/path, model, purpose, invocation count, usage counts, duration, prompt digest,
   output digest. Secret values never appear; every emitted line is additionally scrubbed
   against the live key as defense in depth (Part 29).
7. **Return permitted data** — stdout carries token usage and a truncated output digest
   only. The raw completion text is **withheld**: AI output is untrusted by default
   (§21) and a drill must not inject unvetted model text into operator terminals or logs.

## 5. What PASS proves — and what it does not

A `STATUS=DRILL_PASS` run proves, with evidence:

- the declared gateway endpoint is reachable with the provisioned credential;
- one governed inference completed end-to-end (200 + completion content + usage counts);
- the invocation stayed inside the declared budget (invocationCount=1) and the drill
  emitted minimal, secret-free, digest-only evidence.

It does NOT prove: model quality, routing/fallback behavior under failure, budget/rate
limit enforcement under load, or egress-allowlist enforcement against non-declared
endpoints — those remain covered by their own contracts and tests
(`frontend/src/lib/ai-gateway/*`, `tests/unit/ai-gateway*.test.ts`). A live drill is a
launch-gate proof of the gateway path, not a substitute for the gateway's unit battery.

## 6. Evidence recording

| Slot | Artifact | Retention |
| --- | --- | --- |
| Drill record | `${COREGRID_ARTIFACTS_DIR}/ai-gateway-live-drill.json` | Attach to the launch-gate evidence pack; scrub-check before archiving |
| Drill log | `${COREGRID_ARTIFACTS_DIR}/ai-gateway-live-drill.log` | Same |
| Operator review | second-engineer sign-off line referencing the record's `executedAt` + `outputDigest` | Recorded in the wave evidence store |

Blocked runs (exit `2`) write NO artifacts by design — a block is not evidence of a drill,
it is evidence that nothing ran.

## 7. Failure handling

- **Exit 2:** do not retry with inline credential values. Provision the named secret, or
  complete `AI_DRILL_MODEL` / fix `AI_GATEWAY_URL`, re-run `--plan`, then re-run live.
- **Exit 1:** preserve the artifacts; classify the finding (`provider_http_error`,
  `timeout`, `malformed_response`, `incomplete_metering`); do not claim the BLK-2 gate
  proven. If the failure coincides with a suspected credential compromise, escalate per
  `docs/runbooks/incident-lockdown.md` and rotate the credential via the secrets channel.
- **Never:** print or paste the key value, raise `max_tokens`, send tenant or personal
  data, retry a failed attempt inside the drill, or contact any endpoint other than the
  declared `AI_GATEWAY_URL`.

## 8. Non-goals (explicit)

- No tenant data, memory, or user content is ever sent to the provider (§19 minimization).
- No completion text is emitted from the drill (§21 output trust).
- No dependency additions, no package.json changes, no edits to gateway modules — the
  drill is a self-contained verifier in the exemplar batteries' image.