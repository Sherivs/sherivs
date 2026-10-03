# RUNBOOK — Unified drill schedule (the CoreGrid drill calendar)

Status: **AUTHORED** — H3-wave mission F-050 (team H3-050, Drill Scheduler, Squad F —
Observability & operations). This document is the **calendar and scheduling authority**
for every CoreGrid drill surface. It answers WHEN each drill runs, UNDER WHICH GATE it
may run, WHERE its evidence lands, and WHAT its verdict semantics are. It does NOT
contain any drill's operator procedure: every procedure is owned by its mission's
runbook, cited below by path and mission ID. If a sibling runbook and this calendar
disagree on a technical fact *inside* that sibling's scope, the sibling runbook wins
and a scheduling divergence is recorded against this file (§8).

Authority: AGENTS.md §29 (observability), §30 (secrets), §31 (testing standard), §42
(report format — never claim completion without evidence); H3 campaign law
(`architecture/campaigns/H3-WAVE-CAMPAIGN.md`: Law 4 no git, Law 5 no canonical access
by teams, Law 6 secrets never printed, Law 10 honesty); evidence discipline exemplar
`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`.

Cadence law for this calendar: a drill that has never been executed by its owning
mission is **GOVERNED NOT EXECUTED** — its calendar slots are reservations, not claims.
The first scheduled execution of every surface requires (a) its sibling runbook landed,
(b) its runner/contracts landed and accepted, (c) the coordinator's serialized window.
This file records reservations honestly; it records executions only when their evidence
exists.

---

## 1. Golden questions (WHO / WHAT / WHERE / WHY / POLICY)

- **WHO:** the campaign coordinator (H3-000) owns the calendar and serializes every
  live-surface window; named human operators execute; every result is second-engineer
  reviewed before it becomes platform state (AGENTS §21 — automation output is
  untrusted by default). Sibling missions own the procedures; F-050 owns only the
  schedule.
- **WHAT:** the full set of recurring drill surfaces — recovery drill, restore
  rehearsal, webhook signature drill, AI gateway live drill, payment-rail drill,
  communication probe, RLS isolation battery — consolidated into one calendar with one
  shared verdict vocabulary.
- **WHERE:** this file. The drill *targets* are defined per surface by the sibling
  runbooks (drill target / TEST rails / canonical project under exclusive lock); this
  calendar never widens a surface's WHERE.
- **WHY:** a drill that has no cadence decays into a one-time proof; a drill surface
  without a calendar slot is silently retired. Recovery executed and verified, not
  assumed — on schedule, not on hope (M-R-101 invariant).
- **POLICY:** AGENTS §29–31, §42; campaign law 5/6/10; per-surface policy cited in §3;
  exit-code contract §5 (exemplar battery semantics, campaign law §6).

## 2. The calendar at a glance

| # | Surface | Owner (mission) | Procedure (path) | Runner / instrument | Cadence | Gating | Evidence ledger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Recovery drill | A-004 (runbook) / A-001 (runner) | `docs/runbooks/recovery-drill.md` | `scripts/verify-recovery-drill.mjs` | Every canonical apply wave + scheduled recurring slot (§4) | Offline: none. Live: credential-gated, coordinator-serialized | Per `recovery-drill.md` §7 (artifacts + recovery state truth) |
| 2 | Restore rehearsal | A-005 | `docs/runbooks/restore-rehearsal-checklist.md` | The checklist sheet itself (no runner execution by default) | Quarterly + before reliance on new/changed restore tooling | No live execution by default; coordinator window if ever executed live | Completed checklist sheet stored with the run's artifacts (EV-09) |
| 3 | Webhook signature drill | C-026 | `docs/runbooks/webhook-signature-drill.md` | Coordinator-window drill per that runbook (TEST-MODE only) | On every BLK-4-relevant change to the verification path + at the BLK-4 launch-gate review | Credential-gated (`sk_test_` class only), coordinator-serialized, mutually serialized with #4 | `architecture/campaigns/h3/webhook-drill-evidence-template.md` → `architecture/proofs/` |
| 4 | AI gateway live drill | E-041 (BLK-2) | `docs/runbooks/ai-gateway-live-drill.md` (concurrent authoring) | `scripts/verify-ai-gateway-live.drill.mjs` (concurrent authoring) | On gateway egress/credential/routing contract changes + quarterly recurring slot | Credential-gated (`BLOCKED_NO_CREDENTIAL`, exit 2), coordinator-serialized | Per that runbook's evidence slots (RLS-battery discipline) |
| 5 | Payment-rail drill | E-043 (BLK-4) | `docs/runbooks/payment-rail-drill.md` (concurrent authoring) | `scripts/verify-payments-live.drill.mjs` (concurrent authoring; TEST-MODE, refuses live keys by design) | On payment-adapter/rail contract changes + at the BLK-4 launch-gate review + quarterly recurring slot | Credential-gated (TEST-MODE only), coordinator-serialized, mutually serialized with #3 | Per that runbook's evidence slots (RLS-battery discipline) |
| 6 | Communication probe | E-044 (BLK-5) | `docs/runbooks/communication-probe.md` (concurrent authoring) | `scripts/verify-communication-live.drill.mjs` (concurrent authoring) | On communication-provider contract changes + quarterly recurring slot | Credential-gated (`BLOCKED_NO_CREDENTIAL`, exit 2), coordinator-serialized | Per that runbook's evidence slots (RLS-battery discipline) |
| 7 | RLS isolation battery | J-041 (contract; runbook operational) | `docs/runbooks/rls-battery.md` | `scripts/verify-rls-isolation-battery.mjs` | After every canonical apply; after any RLS/policy/grant-touching migration; before Stage-4 launch gates; on suspicion of a tenant-boundary break; periodic per that runbook §1(5) | Live: credential-gated (management-API + anon/service-role roles per that runbook §2), coordinator-serialized on exclusive canonical access. Offline: `--help` / `--dry-parse-scope` ungated | Ratification dossier `RLS_ISOLATION_BATTERY.md` §7 (live-executed record; 36/36 PASS 2026-10-02) |

Surfaces 4–6 note: the E-041/E-043/E-044 runbooks and runners are being authored by
concurrent teams in this wave. This calendar cites them **by path and mission ID only**
— it does not assume their internals, credential variable names, or phase lists. Until
each lands and its acceptance is recorded, its slots are reservations under
GOVERNED NOT EXECUTED.

## 3. Per-surface schedule cards

### 3.1 Recovery drill (A-001 runner, A-004 runbook)

- **Cadence.** (a) After every canonical apply wave, serialized after the apply before
  the recovery state is relied upon (`docs/runbooks/canonical-apply.md` ordering, cited
  by `recovery-drill.md` §9); (b) one scheduled recurring slot per cadence period
  (§4) — the drill proves recovery continuously, not once; (c) before reliance on any
  new backup/restore tooling.
- **Gating.** The offline `--rehearse` mode is ungated and must pass with zero network
  and zero credentials before any live run. The live mode is **credential-gated
  (coordinator-serialized)**: credentials enter as env-var NAMES via the approved
  secrets channel; absence is a clean block, never a traceback. Exclusive canonical
  access is required when the target is canonical — the recovery drill and the RLS
  battery (#7) MUST NOT run concurrently (`rls-battery.md` §1 serialization note).
- **Evidence ledger.** Per `recovery-drill.md` §7: structured results + verbatim
  transcript under `/opt/cursor/artifacts/`, recorded alongside the recovery state
  truth (the M-R-101 ratification record); secret-free (names, never values).
- **Verdict semantics.** Exit 0 = PASS (rehearsal: contracts validate; live: restore
  identity, canary identity, evidence integrity, verified cleanup — ALL true, per the
  all-checks-true shape). Exit 1 = FAIL/FINDING (no recovery claim; preserve
  artifacts; escalate to `docs/runbooks/incident-lockdown.md` if a real incident is in
  flight). Exit 2 = `BLOCKED_NO_CREDENTIAL` (nothing ran; provision and re-run inside
  the window). A missed scheduled slot is a scheduling finding, not a silent skip.

### 3.2 Restore rehearsal (A-005)

- **Cadence.** One completed rehearsal sheet per cadence period (§4) as a dry,
  evidence-recorded walk-through (no live execution by default); additionally before
  the platform relies on any new or changed restore tooling, and after any change to
  the backup-manifest or recovery-targets contracts (A-003/A-002).
- **Gating.** By design the rehearsal executes nothing live — it is a checklist
  instrument, so it is **not credential-gated and not coordinator-serialized** in its
  default mode. If a rehearsal step ever requires live execution, it inherits the
  recovery drill's gating (credential-gated, coordinator-serialized) and the canonical
  exclusive-access law. Divergence between sheet and drill runbook resolves in favor
  of `recovery-drill.md` (the precedence rule declared in
  `restore-rehearsal-checklist.md` §0; the resulting FINDING is recorded in that
  sheet's findings section).
- **Evidence ledger.** The completed checklist sheet itself, stored with the run's
  artifacts (EV-09 in `restore-rehearsal-checklist.md`); empty slots are honest
  (step did not happen); no slot may ever carry a secret value.
- **Verdict semantics.** Step-level PASS/FAIL with stop-the-line: a failed or skipped
  step stops the rehearsal and is recorded in the sheet's findings section. A sheet
  with an unfilled-but-required slot is INCOMPLETE, not PASS. The rehearsal proves
  procedure readiness; it never substitutes for surface #1's executed recovery drill.

### 3.3 Webhook signature drill (C-026, L-T-009 / BLK-4 webhook axis)

- **Cadence.** On every BLK-4-relevant change to the verification path (signature
  verification, replay guard, idempotency semantics — the trigger list is
  `webhook-signature-drill.md` §8) and at the launch-gate review that considers
  closing BLK-4; otherwise on the recurring slot (§4).
- **Gating.** **Credential-gated (`sk_test_` class only) and coordinator-serialized.**
  Live rail keys are refused by design at every gate; absence or a non-test key class
  is a clean block (exit 2 pattern). Runs in the SAME window family as the payment-rail
  drill (#4 below — see §6): the coordinator runs one, then the other, never
  concurrently, because both exercise the payment-provider surface.
- **Evidence ledger.** The executing operator fills
  `architecture/campaigns/h3/webhook-drill-evidence-template.md` (owner C-026); stored
  under `architecture/proofs/` when ratified; secret-free by construction
  (provenance-style notation only).
- **Verdict semantics.** Exit 0 = PASS requires ALL phases (11/11 — ten-of-eleven is a
  FAIL). Exit 1 = FAIL/FINDING (a forged signature accepted, a replay producing a
  second effect, or an unverified cleanup each revert L-T-009 to PARTIAL and block
  BLK-4 closure until a clean re-run). Exit 2 = `BLOCKED_NO_CREDENTIAL`. Skipped is
  not run: a blocked gate is recorded BLOCKED, never a green row. BLK-4 stays open
  during the drill; only the coordinator closes it from archived evidence.

### 3.4 AI gateway live drill (E-041, BLK-2)

- **Cadence.** On every change to the AI gateway's governed live surface (credential
  gate, egress allowlist boundary — cf. C-025's `egress-allowlist.ts` contract, routing,
  fallback) and one scheduled recurring slot per cadence period (§4).
- **Gating.** **Credential-gated and coordinator-serialized.** Per campaign law §6 and
  the battery exemplar: without the required credential the drill blocks clean —
  `BLOCKED_NO_CREDENTIAL` semantics (exit 2), never an error traceback, never a retry
  against a guessed endpoint. Offline gate tests (`tests/unit/h3-041-ai-drill.test.ts`)
  are the ungated surface and run anywhere. Governed AI-privacy law applies end to end
  (AGENTS §19–20: only authorized, minimized, redacted context leaves for the model).
- **Evidence ledger.** Per `docs/runbooks/ai-gateway-live-drill.md` (E-041) once
  landed; the discipline is the RLS battery's (verbatim logs, findings-not-passes,
  secret-free evidence — names, not values).
- **Verdict semantics.** The shared exit-code contract of §5 (0/1/2) with the
  all-checks-true PASS shape; until the E-041 runbook lands, this calendar binds only
  the exit codes and honesty rules, not the phase list.

### 3.5 Payment-rail drill (E-043, BLK-4 rail axis)

- **Cadence.** On every change to the payment adapter / rail surface, at the BLK-4
  launch-gate review, and one scheduled recurring slot per cadence period (§4).
  Mutually serialized with the webhook drill (#3): same window family, one then the
  other (§6).
- **Gating.** **Credential-gated (TEST-MODE only) and coordinator-serialized.** The
  drill refuses live keys by design (E-043 mission contract; the
  `paystack-testmode.server.ts` governed surface denies `non_test_key`). Absence of a
  TEST credential = clean block, exit 2. AGENTS §36 controls (signature validation,
  idempotency, audit, ownership validation, replay protection) bind the round-trip;
  the frontend payment state is never trusted.
- **Evidence ledger.** Per `docs/runbooks/payment-rail-drill.md` (E-043) once landed;
  RLS-battery discipline; TEST-MODE limitation recorded explicitly
  (`mode=test`), never glossed.
- **Verdict semantics.** Shared exit-code contract of §5. BLK-4 closure is a
  coordinator decision made from the combined archived evidence of BOTH BLK-4
  surfaces (#3 and #5) — a clean run of one surface alone never closes the blocker.

### 3.6 Communication probe (E-044, BLK-5)

- **Cadence.** On every change to the communication-provider contract/adapter surface
  and one scheduled recurring slot per cadence period (§4).
- **Gating.** **Credential-gated and coordinator-serialized** per the exemplar pattern:
  missing provider credential → `BLOCKED_NO_CREDENTIAL` (exit 2), clean block, no
  side effects, no secret values ever printed (AGENTS §30; campaign law §6).
- **Evidence ledger.** Per `docs/runbooks/communication-probe.md` (E-044) once landed;
  RLS-battery discipline (verbatim excerpts, per-probe matrix, findings table).
- **Verdict semantics.** Shared exit-code contract of §5; delivery of a probe message
  is never a pass by itself — the probe passes only when its checks (delivery,
  failure-path, cleanup) all hold, per the all-checks-true shape.

### 3.7 RLS isolation battery (J-041 contract; operational)

- **Cadence.** As enumerated by `rls-battery.md` §1 (cited, not duplicated): after
  every canonical apply; after any migration touching RLS, policies, or grants; before
  Stage-4 launch gates; on suspicion of a tenant-boundary break (it is the
  containment-verification tool named by `docs/runbooks/incident-lockdown.md`); and
  periodically / on demand from an incident review. In calendar terms this is the
  highest-frequency surface: it anchors every canonical-apply window (§6).
- **Gating.** Live run: **credential-gated and coordinator-serialized on exclusive
  canonical access** (policy-backed probes seed through the privileged management
  channel; it must not run concurrently with a canonical apply or the recovery drill).
  Offline surfaces (`--help`, `--dry-parse-scope`) are ungated and run anywhere.
  Service-role usage is opt-in behind `COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1` and
  printed as used — never the default, never left on.
- **Evidence ledger.** The ratification dossier
  `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`
  (§7 discipline: verbatim logs, cleanup verified by re-count, `probe_cleaned=true`,
  secret-free provenance notation).
- **Verdict semantics.** Per-table verdicts; PASS only when every in-scope table's
  checks hold (the live 36/36 record is the exemplar). Exit 1 = findings fail the
  run; exit 2 = blocked on credentials. Any battery FAIL on the tenant-isolation axis
  is treated as a potential live incident: escalate per
  `docs/runbooks/incident-lockdown.md`, do not merely file a finding.

## 4. Recurring cadence slots

The coordinator holds the calendar. Event-driven triggers (§2 and §3 cards) always
outrank the recurring slots. The recurring slots for surfaces that are not already
event-anchored to every canonical apply:

| Slot | Surfaces scheduled |
| --- | --- |
| Every canonical apply wave | #7 RLS battery (after the apply), #1 recovery drill (after the battery) — this ordering is the §6 serialization rule |
| Quarterly (first coordinator window of the quarter) | #1 recovery drill (scheduled instance), #2 restore rehearsal sheet, #4 AI live drill, #5 payment-rail drill, #6 communication probe |
| Launch-gate reviews (Stage-4 and BLK reviews) | #3 webhook drill, #5 payment-rail drill (BLK-4 evidence must be fresh at review time), plus #7 before any Stage-4 gate |

First-execution reservations (GOVERNED NOT EXECUTED — no evidence exists yet):

1. **Recovery drill live** — first window after A-001's acceptance (offline rehearsal
   PASS, zero network; unit suite green) and A-004's runbook review.
2. **Webhook signature drill** — first window after E-043's runner, C-026's evidence
   template, and the cited contracts are all in place (its runbook §8).
3. **AI gateway live drill / payment-rail drill / communication probe** — first
   windows after E-041 / E-043 / E-044 land their runners, runbooks, and offline gate
   tests, respectively.
4. **Restore rehearsal** — first completed sheet may be produced at any time (no live
   execution required); the first scheduled quarterly slot is the target.

A slot executed before its reservation prerequisites are recorded is void evidence
(same rule as the webhook drill's window law): honesty over green rows (campaign
law 10).

## 5. Shared verdict vocabulary (one contract for all surfaces)

Every surface in this calendar shares the exemplar battery's exit-code semantics
(campaign law §6; cited by each sibling runbook):

| Code | Name | Meaning | Calendar consequence |
| --- | --- | --- | --- |
| `0` | **PASS** | Every check verified — the all-checks-true shape; partial evidence is not evidence | Slot satisfied; evidence archived per the surface's ledger |
| `1` | **FAIL / FINDING** | At least one check failed (or cleanup unverified, or a negative probe was accepted) | Slot NOT satisfied; findings recorded; re-run required; per-surface consequence applies (e.g. L-T-009 → PARTIAL, BLK-4 closure blocked) |
| `2` | **BLOCKED_NO_CREDENTIAL** | Nothing ran; a gate refused (missing credential, wrong credential class, missing audit sink/receiver) | Slot NOT satisfied and NOT failed — reschedule inside a properly provisioned window; never work around exit 2 |

Binding honesty rules across all surfaces (from the RLS battery discipline, mirrored by
every sibling runbook): skipped is not run — a blocked gate is recorded BLOCKED, never
a green row; an ambiguous result is INCONCLUSIVE with a finding, never a pass;
evidence is verbatim and immutable (append dated addenda, never edit artifacts);
credential facts are recorded as provenance (source, class, prefix at most), never
values (AGENTS §30). A calendar slot claimed PASS without citable evidence in its
ledger is a §42 violation and void.

## 6. Serialization graph (what may never run concurrently)

The coordinator schedules live windows so that no two of the following share a window
unless explicitly independent:

- **Canonical exclusive-access family:** #7 RLS battery, #1 recovery drill (live), and
  any canonical apply. Fixed order within an apply wave: **apply → RLS battery →
  recovery drill** (the battery re-proves posture live first; the drill then proves
  recovery on the verified posture — this ordering follows `rls-battery.md` §1 and the
  recovery runbook's §9 dependency on the apply, and the coordinator may not invert
  it without a recorded decision).
- **Payment-provider family:** #3 webhook signature drill and #5 payment-rail drill —
  one, then the other, never concurrently (shared provider surface, per
  `webhook-signature-drill.md` §1).
- **Independent within a window:** #2 restore rehearsal (default mode — no live
  execution), and the ungated offline surfaces (`--rehearse`, `--dry-parse-scope`,
  offline gate tests) may run at any time, including outside windows.
- #4 AI live drill and #6 communication probe do not touch the database or the payment
  provider, but they still run only inside coordinator windows under the same
  secret-free evidence law — calendar uniformity is itself the control (an operator
  who learns one window discipline learns all seven surfaces).

## 7. Missed, failed, and drifted slots

- **Missed recurring slot:** recorded as a scheduling finding against this calendar
  (not against the drill); the next window must include the overdue surface.
- **FAILED slot (exit 1):** blocks dependent decisions (launch-gate items, BLK
  closures, recovery-state reliance) until a clean re-run; findings owned per the
  surface's runbook.
- **BLOCKED slot (exit 2):** reschedule; two consecutive blocks on the same surface
  escalate to the coordinator as a provisioning problem, not a drill problem.
- **Contract drift:** if a sibling runbook, runner, or contract changes such that a
  card above goes stale, the stale card is a finding (the recovery runbook's §10 rule
  applies calendar-wide): update this file in the same change or record the
  divergence.

## 8. Change control for this calendar

This document is owned by mission F-050. Sibling missions own their procedures and
never edit this file; F-050 never edits sibling runbooks. Cadence or serialization
changes here require coordinator acknowledgment (the coordinator owns the windows).
New drill surfaces enter this calendar only with a mission ID, a procedure path, a
gating classification, and an evidence ledger — a surface missing any of the four is
not schedulable and must not be added.