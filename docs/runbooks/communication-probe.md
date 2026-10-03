# RUNBOOK — Communication provider probe (BLK-5, credential-gated operator procedure)

Status: **AUTHORED** — H3-wave mission E-044 (team H3-044, Communication Probe Engineer, Squad E —
Launch-gate drills). This runbook defines the operator procedure for the credential-gated
communication provider probe driven by `scripts/verify-communication-live.drill.mjs`. The offline
rehearsal is GOVERNED AND EXECUTED (unit suite `tests/unit/h3-044-communication-drill.test.ts`
green, zero network); the live handshake below is GOVERNED **NOT EXECUTED** — no live run has been
performed by this team, and no live evidence is claimed.

Authority: AGENTS.md §15 (identity/authorization/context separation), §20 (AI/provider gateway —
no scattered provider calls), §25 (provider-agnostic adapters), §29 (observability), §30 (secrets),
§31 (testing standard — access-failure matrix), §42 (report format); campaign law in
`architecture/campaigns/H3-WAVE-CAMPAIGN.md` (no canonical access by teams; secrets never printed;
honesty over evidence). Exemplars for exit semantics: `scripts/verify-rls-isolation-battery.mjs`
(exit 2 = BLOCKED_NO_CREDENTIAL) and `scripts/apply-canonical-hardening.mjs`.

Related contracts cited (read-only):

| Artifact | Owner (mission) | Role in the probe |
| --- | --- | --- |
| `scripts/verify-communication-live.drill.mjs` | E-044 (this runbook) | Runner: offline `--rehearse` validation + credential- AND sandbox-gated live handshake; exit 0/1/2 |
| `frontend/src/lib/communication-providers.ts` | Phase 10 (read-only) | Provider adapter catalogue (DISCOVERED lifecycle, credential-REFERENCE hygiene, fail-closed routing) — consumed as data, never invoked |
| `frontend/src/lib/notifications/notification-contract.ts` | Phase 10 (read-only) | Notification state machine; `delivered` reachable only via a provider receipt; restricted categories fail closed to `in_app` |
| `frontend/src/lib/notifications/email-adapter-contract.ts` | Phase 10 (read-only) | Record-only stub adapter (`NOT_FOR_LIVE_USE`) — the provider path's read-only consumption pattern; it can never deliver |
| `tests/unit/h3-044-communication-drill.test.ts` | E-044 | Offline gate tests: rehearsal PASS without network, credential/sandbox gates, secret hygiene, read-only module consumption proofs |

---

## 1. Golden questions (WHO / WHAT / WHERE / WHY / POLICY)

- **WHO:** a platform operator holding an operator-issued communication provider credential for an
  approved sandbox account, and a registered sandbox verification target. The operator is never an
  autonomous agent working alone: every live probe result is reviewed by a second engineer before
  being recorded (AGENTS §21 — AI/automation output is untrusted by default). Teams of the H3 wave
  never run the live mode themselves.
- **WHAT:** prove, with evidence, that the communication provider path is (a) fail-closed by
  construction — no external provider is usable, no send path is exercisable, nothing real is ever
  sent — and (b) verifiable: the ONE live network action the probe may take is a read-only
  verification handshake against an operator-supplied sandbox target. The probe NEVER sends a
  message, an email, an SMS, a push, or any other content.
- **WHERE:** `--rehearse` runs anywhere (zero network, zero database, zero credential). The live
  handshake runs ONLY against the operator-supplied sandbox target (`COREGRID_COMMUNICATION_
  SANDBOX_TARGET`, https required) — never against a provider production endpoint and never against
  the canonical environment.
- **WHY:** BLK-5 launch-gate law — communication egress must be proven blocked-by-default and
  provable-on-demand. A provider path that has never been handshake-verified is not integration;
  a provider path that can silently send is a liability.
- **POLICY:** the Phase-10 provider catalogue's lifecycle law (only `ACTIVE` providers route; every
  external provider ships `DISCOVERED` — no credential provisioned, routing refuses), the
  credential-REFERENCE hygiene law (`secret://|vault://|kms://|env://|internal://` scheme required;
  raw key material refused), the notification contract's receipt law (`delivered` is only reachable
  through a provider receipt), and this runner's exit-code contract (§2).

## 2. Modes and the exit-code contract

| Mode | Invocation | Network | Credentials |
| --- | --- | --- | --- |
| **Offline rehearsal** | `node scripts/verify-communication-live.drill.mjs --rehearse [provider-id]` | NONE — must pass with zero network | NONE — no secret is read |
| **Live handshake** | `node scripts/verify-communication-live.drill.mjs [provider-id]` | exactly ONE https GET to the operator sandbox | BOTH gates required: provider credential AND operator-supplied sandbox target |

Exit codes (interpret ONLY through this contract):

| Code | Meaning | Operator action |
| --- | --- | --- |
| `0` | PASS (rehearsal contracts hold / handshake verified) | record evidence, second-engineer review |
| `1` | FINDING (rehearsal invariant violated, or handshake did not succeed) | do NOT retry blindly; file a finding; fix contracts or target before any rerun |
| `2` | BLOCKED — `BLOCKED_NO_CREDENTIAL`, `BLOCKED_NO_SANDBOX_TARGET`, `BLOCKED_SANDBOX_TARGET`, or `BLOCKED_USAGE` | clean block, never an error traceback; supply the missing gate or fix the argument |

## 3. The gate order (live mode) — ALL gates fire BEFORE any network contact

1. **Usage gate.** Unknown flags or more than one positional → `BLOCKED_USAGE` (exit 2). The
   optional positional is a provider id from the Phase-10 catalogue (e.g. `sendgrid`); an
   undeclared id is refused.
2. **Credential gate.** `COREGRID_COMMUNICATION_PROVIDER_CREDENTIAL` unset → `BLOCKED_NO_CREDENTIAL`
   (exit 2) with "Nothing was probed and no network contact was made." Nothing else runs.
3. **Offline rehearsal.** The full `--rehearse` validation reruns; any finding aborts with exit 1,
   still with zero network contact.
4. **Sandbox gate.** `COREGRID_COMMUNICATION_SANDBOX_TARGET` unset → `BLOCKED_NO_SANDBOX_TARGET`
   (exit 2). **The operator-supplied sandbox target is REQUIRED BY DESIGN.** The probe has no
   built-in destination: without a target it cannot and does not contact anything.
5. **Sandbox validation.** The target must parse as an `https://` URL with no embedded
   credentials → otherwise `BLOCKED_SANDBOX_TARGET` (exit 2). Cleartext (http) targets are refused.
6. **Handshake.** Exactly ONE read-only `GET` against the sandbox target: no message payload,
   response body never read or written, redirects refused (`redirect: "error"` — a redirect could
   carry the credential to an unapproved host), 8-second timeout (parity with
   `DEFAULT_EMAIL_FAILURE_POLICY.timeoutMs`). 2xx → exit 0; anything else → exit 1 FINDING.

## 4. What the probe never does (send-nothing-real law)

- It never sends a message, email, SMS, WhatsApp, push, voice call, meeting invite, or social post.
  The declared probe plan contains **no send-capable step** — the plan schema's kind vocabulary has
  no send kind and the rehearsal fails closed if one appears.
- It never invokes a send path of the communication/notification server modules. It consumes those
  modules through their **data contracts only**: the embedded provider-catalogue mirror is
  deep-cross-checked by the unit suite against `PROVIDER_CATALOGUE`, and the provider path's
  runtime behavior is the record-only stub adapter (`NOT_FOR_LIVE_USE`), which resolves every send
  to `undeliverable("provider_not_configured")` even when a registry claims the provider is
  configured.
- It never asserts delivery. Per the notification contract, `delivered` is only reachable through a
  genuine provider `DeliveryReceipt`; a handshake status is not a delivery receipt and the probe
  records no notification state change.
- It never follows redirects, never reads or persists a response body, and never prints, logs, or
  writes the credential value or the full sandbox URL (host only).

## 5. Operator procedure (live handshake)

1. **Preconditions.** `--rehearse` passes (exit 0) on the exact commit under test. The offline
   rehearsal gates the live mode — if it fails, stop.
2. **Authorize the sandbox.** The sandbox account and verification target must be registered with
   the platform owner (approval recorded before the probe window). The target must be an `https://`
   verification/handshake endpoint of the sandbox provider — never a production sending endpoint.
3. **Set the gates.** Export `COREGRID_COMMUNICATION_PROVIDER_CREDENTIAL` (the sandbox provider
   credential) and `COREGRID_COMMUNICATION_SANDBOX_TARGET` (the https verification URL). Secret
   values stay in the operator's session env; they are never echoed into runbooks, tickets, or
   artifacts.
4. **Run once.** `node scripts/verify-communication-live.drill.mjs <provider-id>` — one invocation,
   one handshake. Never loop retries; a failed handshake is a FINDING needing human triage.
5. **Record evidence.** `communication-probe-live.json` / `.log` land in `COREGRID_ARTIFACTS_DIR`
   (default `/opt/cursor/artifacts`): mode, provider id, `credentialPresent: true` (boolean — the
   VALUE is never recorded), `sandboxTargetHost` (host only), `networkContact: true`,
   `sendCapable: false`, handshake status, findings. A second engineer reviews before the evidence
   is cited anywhere.
6. **Failures.** Exit 1 → file the finding, do not rerun until triaged. Exit 2 → supply the missing
   gate; this is a clean block, not an incident. If a probe failure coincides with a suspected real
   communication outage, follow `docs/runbooks/incident-lockdown.md`.

## 6. Mandatory access-failure matrix (§31, verified offline by the unit suite)

| Failure | Required behavior | Proven by |
| --- | --- | --- |
| No provider credential | `BLOCKED_NO_CREDENTIAL`, exit 2, nothing probed, no artifact | `tests/unit/h3-044-communication-drill.test.ts` |
| Credential present, no sandbox target | `BLOCKED_NO_SANDBOX_TARGET`, exit 2, no network contact | same |
| Non-https or unparseable sandbox target | `BLOCKED_SANDBOX_TARGET`, exit 2, before contact | same |
| Undeclared provider id | `BLOCKED_USAGE`, exit 2 | same |
| Secret value in any output/artifact | forbidden — sentinel asserted absent | same |
| Offline rehearsal touching network/database | forbidden — `networkContact=false`, `databaseContact=false` recorded and asserted | same |
| Send-capable step in the probe plan | forbidden — plan invariant, fails closed | same |

## 7. Residual risks and boundaries

- The live handshake proves **reachability + credential acceptance** of the sandbox verification
  path only. It does not prove end-to-end delivery (that requires a real provider receipt, which
  this probe must never fabricate and the sandbox drill is not authorized to produce).
- The embedded catalogue mirror is kept in lockstep with `frontend/src/lib/communication-providers.ts`
  by the unit suite's deep cross-check; when the catalogue changes, the mirror and test must be
  updated together (the test fails loudly otherwise).
- Per-provider handshake semantics (exact verification endpoint per provider) are intentionally
  generic: the operator supplies the sandbox target, keeping the drill provider-agnostic (§25). A
  future per-provider drill may specialize this runbook with an ADR.