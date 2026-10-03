# EVIDENCE TEMPLATE — Webhook signature drill (BLK-4 live signature-verified webhook evidence)

Author: C-026 (team H3-026, Webhook Drill Engineer, L-T-009), H3 wave, 2026-10-03.
Status: **TEMPLATE — unfilled by design.** This is the evidence ledger the executing
operator fills during the coordinator-serialized drill window defined in
`docs/runbooks/webhook-signature-drill.md`. It mirrors the evidence discipline of the RLS
isolation battery ledger
(`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`): verbatim
logs, per-probe matrix, findings, cleanup verification by re-count, and secret-free
evidence — **credential NAMES, classes, and verdicts only, never values**.

LAW: A ledger section left with its placeholder text is UNFILLED. Do not delete
placeholders to fake completeness; do not write PASS without a captured verbatim line
beneath it. Honesty over evidence (campaign law §10).

---

## 0. Run header (fill verbatim from the drill run)

```
COREGRID WEBHOOK SIGNATURE DRILL — L-T-009 / BLK-4 evidence run
window=    (coordinator window id / opened-by / opened-at UTC)
mode=      (test | live — test while BLK-4 stands; live only post-BLK-4-closure per runbook §8)
operator=  (named human engineer; second-engineer reviewer recorded in §6)
receiver=  (drill receiver endpoint identifier — URL host only, no path tokens)
key provenance: source=<approved-secrets-channel> class=<sk_test_ | sk_live_ post-closure> prefix=<first 8 chars> (value never printed)
honesty rule: a verified signature proves the signature, not the effect; DENY is the pass condition for every negative probe; skipped/blockless is BLOCKED, never green.
```

## 1. Gate record (exit-code contract, runbook §4)

| Gate | Required result | Observed (verbatim) | Verdict |
| --- | --- | --- | --- |
| Coordinator window held | window id logged before any side effect | _verbatim line_ | PASS / FINDING |
| Credential class | `sk_test_` prefix accepted (or drill BLOCKED on any other class) | _verbatim gate line_ | PASS / BLOCKED |
| Live-key refusal (by design) | an `sk_live_`-class value, if ever present in env, is refused: `non_test_key`, exit 2 | _verbatim gate line or NOT_EXERCISED + why_ | PASS / BLOCKED |
| Audit sink present | audit-before-execute wired; missing sink → exit 2, never a mutation | _verbatim gate line_ | PASS / BLOCKED |
| Offline rehearsal | unit baseline green: `npx vitest run tests/unit/payments-paystack-adapter.test.ts tests/unit/payments-replay-guard.test.ts` | _exit code + summary line_ | PASS / FINDING |

## 2. Per-phase probe matrix (one row per drill phase, runbook §5)

Verdicts: `PASS` / `FINDING` / `INCONCLUSIVE` / `BLOCKED`. Every row must be backed by a
verbatim log line in §3.

| # | Phase | §36 control | Expected observed code/decision | Observed (verbatim) | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | PREPARE — receiver registered, verifies-before-ack, no secret values logged | — | receiver ready | | |
| 2 | POSITIVE — genuine provider-signed `charge.success` verified | signature validation | `verifyPaystackSignature` ok; effect recorded once | | |
| 3 | OWNERSHIP — server-resolved reference re-checked (amount/currency exact) | ownership validation | match accepted; mismatch denied | | |
| 4 | NEGATIVE — forged body, wrong signing secret | signature validation | `signature_mismatch`, no effect | | |
| 5 | NEGATIVE — tampered body, original provider signature | signature validation | `signature_mismatch`, no effect | | |
| 6 | NEGATIVE — missing header / non-hex header | signature validation | `missing_signature` / `malformed_signature`, no effect | | |
| 7 | NEGATIVE — replay, unchanged redelivery | replay protection | `duplicate_event`; exactly-once holds (no second effect) | | |
| 8 | NEGATIVE — stale (>300s) and future (<-300s) timestamps | replay protection | `stale_event` / `future_event` | | |
| 9 | IDEMPOTENCY — same key+payload replays recorded outcome; same key+other payload rejected | idempotency (J-030) | replay → recorded outcome, no new effect; collision rejected; TTL-bounded | | |
| 10 | UNKNOWN EVENT — out-of-taxonomy type via signed local fixture | fail-closed parsing | `parsePaystackWebhook` rejects; no default-accept | | |
| 11 | CLEANUP — probe transactions reconciled (never completed), receiver records emptied, registration removed, audit records 1:1 | audit / hygiene | `probe_cleaned=true` per artifact family (re-count verified) | | |

**VERDICT=PASS requires 11/11.** Summary line (fill verbatim once decided):

```
STATUS=<PASS|FAIL> — <n>/11 phases prove the declared posture: <one-line summary of what was proven live>. Proven against the <test|live> rails, not reasoned.
```

## 3. Verbatim evidence excerpts

Paste captured log lines EXACTLY as emitted (no paraphrase, no cleanup, no added
interpretation). Redaction law: before pasting, apply the secret-free transform — replace
any key/digest/authorization-url/access-code occurrence with
`<REDACTED:<what-it-was>>`; the redaction itself is logged here as a one-line note per
redacted artifact. Anything that survives redaction is evidence; anything redacted is
recorded as present-not-valued (RLS battery `prefix=` pattern).

### 3a. Positive-path delivery (phases 2–3)

```
<verbatim receiver + verify lines: verification ok, ownership ok, effect id, audit id>
```

### 3b. Negative-path deliveries (phases 4–6)

```
<verbatim deny lines with deny codes: signature_mismatch / missing_signature / malformed_signature>
```

### 3c. Replay and idempotency (phases 7–9)

```
<verbatim lines: duplicate_event / stale_event / future_event; replayed=<recorded outcome> secondEffectCount=0; collision rejected>
```

### 3d. Fail-closed parsing (phase 10)

```
<verbatim lines: unknown event rejected, no default-accept path>
```

### 3e. Cleanup verification (phase 11)

```
<verbatim re-count lines: probe_cleaned=true per artifact family — transactions=<n reconciled> receiverRecords=<n before/after> registration=<removed> auditRecords=<accepted:1:1, denied:counted>>
```

## 4. Findings

| # | Phase | Observed behavior | Expected fail-closed behavior | Cited module | Severity | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| _F-1_ | | | | | | |

FINDINGS: **<count>**. Any non-PASS matrix row MUST have a finding row here, and the §2
summary line must not read PASS while any finding is open.

## 5. Environment-state truth

| Field | Value |
| --- | --- |
| Drill window | _window id, opened/closed UTC_ |
| Mode | _test_ (while BLK-4 stands) |
| Receiver identifier | _host only_ |
| Credential class + provenance source | _class + channel name, never value_ |
| Evidence storage location | _e.g. architecture/proofs/…_ |
| Verdict | _PASS / FAIL / BLOCKED_ |
| Recorded by / reviewed by | _named engineers_ |

## 6. Reviewer attestation (AGENTS §21 — automation output is untrusted by default)

```
I attest I reviewed the captured logs against this ledger, that every PASS row is backed
by a verbatim line, that no secret value appears anywhere in the ledger or artifacts, and
that the cleanup re-count was observed, not asserted.
reviewer=  date=
```

## 7. Downstream handoff (what this ledger feeds)

1. **L-T-009 ledger row** — the OPEN remainder in
   `architecture/coregrid-mvp-architecture/security/THREAT_MITIGATIONS_LT.md` cites this
   ledger when the coordinator ratifies the evidence (owner of record: L-H-020).
2. **BLK-4 closure decision** — `COREGRID_V1_BLOCKERS.json` closure belongs to the
   launch-gate owner; this ledger is the webhook-axis input. The sibling payment-rail
   ledger (`docs/runbooks/payment-rail-drill.md`, E-043) covers the round-trip axis.
3. **Re-run cadence** — per runbook §8: any change to the signature path, replay guard
   tolerance/axes, or idempotency semantics, and every launch-gate review.