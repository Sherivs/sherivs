# JARVIS J6 verification evidence pack

Mission SV1-JARVIS-06 (issue #296). Scope: verify the JARVIS-01..05 contracts against each row of the J0 threat model
([J0-inventory-gap-and-threat-model.md](./J0-inventory-gap-and-threat-model.md)). Everything here is offline: fixed instants,
synthetic identities, no network, no database, no production contact. Nothing is claimed deployed.

## How to reproduce

```
npx vitest run tests/unit/jarvis tests/unit/hermes tests/unit/workforce-capability-registry.test.ts
node scripts/verify-provenance-metadata.mjs
# local PostgreSQL evidence for the approval inbox (disposable DB only):
PGOPTIONS='-c jarvis02.test_disposable_database=on' psql -h 127.0.0.1 -p <port> -v ON_ERROR_STOP=1 \
  -f tests/integration/jarvis02-approval-inbox.local.sql <disposable-db>
```

## Row-by-row evidence

All tests are in `tests/unit/jarvis-threat-model-verification.test.ts`. A coverage test fails if the J0 threat table gains or loses a row without a matching block here.

| #   | Threat (J0 row)                                     | What is proven                                                                                                                                                                                                                 | Block                           | Remaining gap (not proven)                                                                                                          |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Prompt injection                                    | Only the closed action vocabulary routes; injected strings as actions are denied in every playbook; injected text in events is restated verbatim as data and changes no decision; injected identity fields do not pass checks. | `threat 1`                      | That every real ingestion path (tickets, email, chat, calls) calls these contracts. No ingestion adapter exists yet.                |
| 2   | Cross-tenant / personal data                        | Tenant-scoped authority is refused; T4 cross-tenant mixing denied by playbooks, risk policy and Hermes; tenant export is never direct (Support proposes it for a sheriff).                                                     | `threat 2`                      | No JARVIS context builder exists; server/RLS enforcement on tenant data is outside these contracts.                                 |
| 3   | Impersonation / self-approval / authority expansion | Requester cannot approve; AI identities cannot decide; unregistered capability and expired grant deny; governance/audit-changing actions denied by every playbook.                                                             | `threat 3`                      | No console-agent identity registration or role binding exists.                                                                      |
| 4   | T3 bypass through approval, retry or phone          | Full chain: missing passkey, wrong role, voice/WhatsApp/SMS approval, early execution and wrong-action evidence are all refused; sheriff console approval allows once; replay denied.                                          | `threat 4`                      | The real passkey ceremony is not wired; the contract records the verified result only.                                              |
| 5   | Duplicate, stale or partial action                  | Idempotent proposals; single-use approvals; drifted preconditions block execution and leave the approval unused; idempotent escalation rungs.                                                                                  | `threat 5`                      | No proposal-to-executor orchestration, compensation or independent verification step exists.                                        |
| 6   | Credential, secret, spend abuse                     | No playbook declares secrets, spend, production DB or deploy; `credentials: "none"`; registrations carry no credential fields; such requests are denied before any approval.                                                   | `threat 6`                      | Credential-broker scope and budget binding per agent are not implemented here.                                                      |
| 7   | Audit alteration / missing provenance               | Every step, including rejections, is appended to a monotonic, correlated event log; T4 audit deletion and guardrail bypass denied by all layers. DB side: append-only and forced RLS shown by the local harness (32 checks).   | `threat 7` + `jarvis02` harness | The hash-linked platform audit chain is not written by JARVIS yet; there is no JARVIS event catalogue or cross-channel correlation. |
| 8   | Runaway loops / cost exhaustion                     | A 1000-request loop is capped at the budget; kill switch halts at once, resists a non-sheriff release, and resumes only on a sheriff passkey release.                                                                          | `threat 8`                      | Controls are not persisted; no global operational stop store.                                                                       |
| 9   | Spoofed call / accidental live escalation           | Bad signature, forged token, wrong sender and replay rejected; an "approve" reply is only an acknowledgement; test mode never plans a real contact; live needs owner enablement and a recorded human authorization.            | `threat 9`                      | No sender adapter or provider webhook exists; Africa's Talking integration remains separate and unmerged.                           |
| 10  | Grok feed as write or exfiltration path             | Feed is allowlisted aggregate, deeply frozen, and contains none of the ids, tenants, actors, digests or text fed in as sentinels.                                                                                              | `threat 10`                     | No authenticated transport for the feed exists; only the data shape is proven.                                                      |

## Kill switch and budget, end to end

- Budget exhaustion, kill-switch engagement, refusal of non-sheriff release, sheriff release and resumption in a new window: `jarvis-hermes-routing.test.ts` (end-to-end sequence) and `threat 8`.
- Mutation proof: removing the budget check, the kill-switch check, or the sheriff-release rule each makes tests fail.

## Cross-module mutation proof (this PR)

| Mutation                                    | Tests failing |
| ------------------------------------------- | ------------- |
| Remove the T3 passkey requirement           | 2             |
| Let phone channels approve                  | 1             |
| Let an executed approval replay             | 1             |
| Stop denying T4 in the risk policy          | 1             |
| Ignore the inbound signature                | 1             |
| Disable the budget                          | 1             |
| Let undeclared actions through the playbook | 2             |

## Honest limits

- This verifies contracts, not deployments. Nothing here ran against a live system, and JARVIS is not wired into Hermes' cycle, a database writer, or any channel.
- CI could not run (org billing hold); results above are local. Re-run all checks after billing is restored.
