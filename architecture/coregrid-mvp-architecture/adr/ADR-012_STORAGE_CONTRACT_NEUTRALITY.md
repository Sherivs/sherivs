# ADR-012: Legacy Storage-Contract Identifiers in Declarative Provisioning Migrations (neutrality-guard baseline extension)

| Field | Value |
|---|---|
| Status | PROPOSED (coordinator-adopted under the post-R-wave follow-up wave mandate; operator ratification requested — see Open Questions) |
| Date | 2026-10-03 |
| Author | Coordinator integration (post-R-wave T-wave, T-C follow-up) |
| Mission | T-C (STORAGE-PROVISION) integration |
| Capabilities | V1CAP-067 (domain-neutrality guard) |
| Cites | ADR-004 §Recommendation ("nothing may increase it without a new ADR" — this is that ADR); AGENTS §17/§25/§28; J-005/J-006 predicate law; ADR-004 T-C sequencing; R1 e2e finding; T-C report (`progress/v1-wave/T-C-report.md`) |
| Supersedes | Nothing (narrows the scope of one rule) |

## Context

MISSION-R-05's domain-neutrality guard (`scripts/verify-domain-neutrality.mjs`) scans every file under `database/supabase/migrations/` and fails on any (kind, file, token) violation group not present in `NEUTRALITY_GUARD_BASELINE.json`. Its own ratchet law (and ADR-004's) forbids adding baseline entries without a new ADR.

The post-R-wave T-C mission authored migration `20261003000040` — declarative, idempotent provisioning of the PRIVATE storage bucket that the school CMS gallery flow requires. The migration tripGers 19 guard hits in 3 groups (`vocabulary:school`, `structural:school_id`, `vocabulary:get_my_school_id`) because:

1. The bucket id is `school-media` — the identifier already consumed by the frontend contract (`frontend/src/components/admin/crud-list.tsx` → `supabase.storage.from("school-media")`) and by the five LIVE storage-object policies owned by the applied legacy migration `20260707223958` (authenticated CRUD tenant-scoped to the first path segment + an anon bucket-wide SELECT).
2. The migration's comments document that pre-existing policy set, which references `get_my_school_id()` and `school_id`.

The migration itself introduces NO new domain code: no domain table, no helper, no client-facing universal surface. It is a declarative pointer to an EXISTING legacy storage contract — the same vocabulary class the baseline already quarantines for its legacy owners (20260707223958 carries 18 baseline entries; the legacy schools substrate, 84).

## Options considered

**O-A — Rename the storage contract to a neutral id now.** Rejected for this wave: the five live policies are keyed on `bucket_id = 'school-media'`; renaming the bucket without re-authoring them orphans the policy set and silently breaks authorization. Re-authoring them neutrally is NOT expressible today: the only tenant binding on the legacy substrate is `public.users.school_id` (itself a guarded structural token — any new SQL referencing it fails the guard), no neutral tenant reference exists on the substrate, and the live neutral membership substrate holds zero bindings (the identical blocker recorded in the transport posture's `conversionPath`, ADR-class T-D). A partial rename is strictly worse than the status quo.

**O-B — Withdraw the provisioning from migrations (operator-work stance).** Rejected: the bucket would exist live but unversioned — AGENTS §28 makes the migration channel the state of record, and the canonical apply is the auditable provisioning path. The R1 typed-skip the migration exists to lift would return.

**O-C — Obfuscate the identifier in SQL (string concatenation).** Rejected outright: dodging a hygiene gate by construction is dishonest and breaks the guard's observability contract.

**O-D — Quarantine the contract-identifier references via THIS ADR (adopted).** The migration joins its legacy owners in the baseline until a dedicated storage-neutral conversion mission lands (bucket id + policy predicates + path contract + frontend constant, after the neutral-tenant substrate conversion exists). The shrink-only ratchet resumes immediately afterward: no further entries may be added without another ADR.

## Decision

1. The three observed violation groups for `database/supabase/migrations/20261003000040_coregrid_school_media_bucket.sql` are added to `NEUTRALITY_GUARD_BASELINE.json`, marked with this ADR as their authority (`streamIRef: "ADR-012"`).
2. The guard's doc-comment and the baseline's `ratchetPolicy` are amended to state the ADR mechanism explicitly (baseline growth requires a new ADR — per ADR-004's own sentence).
3. Recorded follow-up (conversionPath): a storage-neutral conversion mission (bucket id rename + policy re-authoring + frontend constant + e2e) is authorized to land ONLY after the neutral-tenant substrate conversion provides an expressible neutral predicate; at that point these three entries are REMOVED in the same change (shrink-only law resumes).
4. Security note (no regression): this ADR authorizes ZERO new privileges. The bucket remains PRIVATE, the envelope stays bounded (8 MB / image mime types), and the operative policy set is unchanged from its 20260707223958 state. The over-broad anon SELECT T-C flagged remains recorded as known risk in the T-C report, narrowed only by the future conversion.

## Golden Questions

- **WHO?** Coordinator (integration) authors; the operator ratifies; the future storage-neutral conversion mission removes the entries.
- **WHAT?** Three baseline quarantine groups for one provisioning migration's legacy contract-identifier references.
- **WHERE?** `NEUTRALITY_GUARD_BASELINE.json` + the guard's doc-comment; the migration itself is unchanged.
- **WHY?** The canonical apply channel must stay the versioned state of record for infrastructure provisioning (§28) while the neutrality ratchet stays honest (warn-every-run, never silent).
- **UNDER WHICH POLICY?** ADR-004's ADR-for-increase mechanism; AGENTS §25 (storage is provider infrastructure), §28 (migrations as state of record), §38 (this ADR is the change-management record).

## Open Questions

- Operator ratification of this PROPOSED ADR (the baseline entries take effect immediately to keep the verify gate coherent; ratification or amendment is requested in the wave report).
- Whether the future neutral-tenant substrate conversion should fold the media-storage path conversion in scope, or a separate mission follows it.
