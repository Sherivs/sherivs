# ADR-051: Reality Engine R1 taxonomy and discovery question registry (SV1-REALITY #332)

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator ratifies; R1 approved on #229, R2+ still gated) |
|| Date | 2026-11-05 |
|| Author | Copilot (SV1-REALITY R1) |
|| Mission | #332 (child of #229) |
|| Capabilities | Scholar runtime, practical search of onboarding reality (V1) |
|| Supersedes-in-part | None |
|| Cites | `docs/reality/R0-REUSE-MAP.md`, `docs/reality/R0-GAP-MATRIX-ROADMAP.md`, `docs/v1/V1-SCOPE-LOCK.md`, `AGENTS.md` §45, `frontend/src/lib/scholar/config-discovery.ts`, `frontend/src/lib/scholar/reality-graph.ts` |
|| Minimal ownership artifact | `frontend/src/lib/scholar/reality/` (code contract only) |

## Context

#229 needs a shared vocabulary and a question metadata contract before any graph, discovery UI or AI layer. R0 (#230) is documentation only. The owner limited V1 to school onboarding: understand a school's reality, adapt the software, and later feed approved public-safe data to the website. Tertiary, health and agriculture institutions, V2 and V3 are frozen.

## Options

### Option 1 — New persisted registry tables (rejected)
- **Consequences:** needs migrations and RLS, duplicates existing owners, and is outside #332 (no persistence).

### Option 2 — Typed in-code contract extending the Scholar namespace (ruled)
- **Consequences:** deterministic, testable, no data exposure. Costs: registry changes ship with code and a new content hash; answers are not stored until a later authorized phase.

## Recommendation (decision)

**Adopt Option 2.** Add `frontend/src/lib/scholar/reality/` with: the domain/institution taxonomy and entity/relationship vocabulary, each entity naming its existing owner module; question metadata (id, domain, institution types, answer type, visibility, required, dependencies, validation, follow-ups, config mapping, confidence requirement, website mapping); answer-state semantics (confirmed, inferred, unknown, conflicting, pending, not_applicable only where permitted); registry validation; and a deterministic content-hash version.

Invariants: unanswered is `unknown`, never "No"; AI output is at most `inferred`; branching uses confirmed answers only; website mapping defaults to not public and human-domain answers are never public; the website is presentation only. Config mapping targets the existing `scholar.institution.operating_model` attributes.

Scope for V1: institution types creche, primary, secondary, islamic, special_needs, multi_institution_group; packs core, primary, secondary. **Conflict recorded:** #332 acceptance lists university, polytechnic, college of education, nursing and agriculture packs; the owner's later V1 constraint excludes tertiary/future scope, so those packs are not implemented and need separate owner authorization.

### Explicit residual risk
Ontology may churn when R2 lands; the schema version and content hash make drift visible. No persistence, graph, UI, AI, website runtime or migration is included.

## Golden Questions

- **WHO:** admins answering onboarding questions (later phases). **WHAT:** metadata contract. **WHERE:** `frontend/src/lib/scholar/reality/`. **WHY:** adapt software to the school's reality without inventing facts. **UNDER WHICH POLICY:** #229 non-negotiables, V1 scope lock, AGENTS §45.

## UNKNOWNs

- Whether tertiary/health/agriculture packs are authorized for a later V1 slice.
- Public-site field keys must be reconciled with the website generator owner (#135) before R9.
