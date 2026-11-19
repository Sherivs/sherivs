# ADR-109: SV1-LITE Outbox Contract, Context Tagging and the Wipe Rule

| Field                      | Value                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder review required; web app only, no migration)                                                                            |
| Date                       | 2026-11-17                                                                                                                                |
| Author                     | Claude Code agent (mission M16, SV1-LITE part)                                                                                            |
| Creator                    | Claude Code agent, mission E-012 (M16 SV1-LITE offline layer)                                                                             |
| Mission                    | M16 (SV1-LITE 01 to 05, web app)                                                                                                          |
| Capabilities               | One generic offline outbox; every queued item carries the context that created it; leaving a context never carries data into the next one |
| Cites                      | Master brief §5.1 item 5, §12.1 M16, §13.1; `docs/v1/V1-GAP-REPORT.md` LITE-01 to LITE-05; issue #232                                     |
| Minimal ownership artifact | `frontend/src/lib/offline/outbox.ts`, `frontend/src/lib/offline/context-exit.ts`                                                          |

## Context

The web app already had a tenant-scoped IndexedDB store (`indexeddb-store.ts`, scope key = organization, user, role) and an attendance queue on it. It lacked a generic outbox, a warning before unsent work is wiped, a visible sync state with last-sync time and failures, a reusable Data Saver pattern, and a versioned app-shell cache cleared on sign-out.

## Decision

1. **One outbox, same store.** Generic outbox rows (`type: "outbox"`) live in the existing scope-indexed `outbox` object store beside the legacy attendance/score rows. Legacy code filters them out (`isLegacyMutation`), so existing queues behave exactly as before. No second database, no new dependency.
2. **Contract.** `enqueue(kind, payload, idempotencyKey)`; row id is derived from scope and idempotency key, so a second enqueue with the same key returns the existing row. Sent rows stay as payload-free tombstones for 7 days so a late duplicate is still recognised: the client never sends one key twice. States: `queued -> sending -> sent`, or `failed`. Drain is ordered (enqueue sequence). A thrown error re-queues with exponential backoff (2 s doubling, capped at 5 min) and stops the drain to keep order; after 5 attempts the row is `failed` (`retries_exhausted`). A connectivity error stops the drain without spending an attempt. A row found in `sending` at drain start (page closed mid-request) becomes `failed` (`interrupted_send`) and is only re-sent on an explicit retry, with the same idempotency key. A Web Lock (when the browser has one) stops two tabs draining at once.
3. **Context tagging.** Every row carries `{userId, organizationId, role}`. A drain sends a row only if its tag equals the outbox's context and the currently active context; mismatched rows are refused and left untouched, and the drain stops as soon as the active context changes. Enqueue is refused when the outbox's context is no longer active.
4. **Conflict rule: server wins.** A rejection makes the row `failed` with the server's reason, keeps its payload, and is never retried automatically. The person sees which item failed and why (indicator list) and may remove it. Rows leave the outbox only when sent, or by an explicit discard by the person.
5. **Wipe rule.** On a person-initiated sign-out or organization/role switch, unsent items of the current context are counted (legacy pending and conflicts, outbox queued, sending and failed). If there are any, the person chooses: send now, or discard (with the count shown). Keeping them for later is not offered, because they must never be sent under another context; staying in the current context is allowed. After the switch succeeds, the previous scope (cached reads, legacy rows, outbox rows, last-sync marker) is deleted. On sign-out everything is deleted, as before, plus the versioned app-shell caches.
6. **Forced exits** (session ended elsewhere, an administrator changed the role) cannot ask first. Data is still wiped; before wiping, only a count of unsent items per user id is stored locally, and the next time that same person opens the shell the indicator tells them. No content survives.
7. **App-shell cache.** The service worker already cached only the public root shell. Its cache name is now built from a version prefix and every older `sherivs-app-shell-*` version is deleted on activate; the page deletes all versions on sign-out.

## Consequences

- No producer has been migrated onto the generic outbox yet; the attendance queue keeps its own path. New offline features should use `createOutbox` and `registerOutboxSender`.
- The server must still treat the idempotency key as the dedup key; the client rule alone cannot cover an interrupted send.
- The indicator now shows items waiting, items needing review, last sync time (Africa/Lagos) and a Retry action.
