# Strict-TS Sweep — Repo-Wide `any` / `z.any()` Census (H-083)

- **Team:** H3-083 (Strict-TS Sweep Engineer, Squad H — Quality & CI hardening)
- **Census date:** 2026-10-03
- **Authority:** AGENTS.md §32 (Code Quality: strict TypeScript, avoid `any` unless justified); H3-WAVE-CAMPAIGN.md Campaign Law 7 ("Strict TypeScript, no `any`, no `z.any()`").
- **Scan scope:** `frontend/src/` and `scripts/` (`.ts`, `.tsx`, `.mjs`).
- **Fix scope (bounded ownership):** only `frontend/src/lib/reliability/`, `frontend/src/lib/security/`, `frontend/src/lib/observability/` — and only files NOT owned by another H3 team.

## Methodology

Two-pass `rg` census (word-prose pass + type-level pass), run 2026-10-03:

1. **Broad prose pass** (over-counts: matches the English word "any" in comments/strings):
   `rg -n --no-heading -e '\bany\b' -e 'z\.any\(\)' -e ': any' -e 'as any' -e '<any>' -e 'any\[\]' frontend/src/ scripts/ -g '*.ts' -g '*.tsx' -g '*.mjs'` → 708 raw matches, the vast majority English prose.
2. **Precise type-level pass** (the census of record; excludes prose via manual per-hit classification of every non-generated match):
   `rg -n --no-heading ':\s*any\b|as\s+any\b|<any>|\bany\[\]|z\.any\(|,\s*any\b|= any\b|\bany\s*\||\bany\s*\)|=>\s*any\b' frontend/src/ scripts/ -g '*.ts' -g '*.tsx' -g '*.mjs' -g '!frontend/src/routeTree.gen.ts'` → 130 matches over 52 files, each individually classified below.
3. `frontend/src/routeTree.gen.ts` counted separately: 154 matches (machine-generated).

Disposition classes:

- **justified-with-reason** — not a type-level `any` (prose in comments/strings/UI copy) or machine-generated code; no action.
- **must-fix** — type-level `any`/`z.any()` in a file inside H-083's bounded fix scope; fixed + tested.
- **pre-existing-out-of-scope** — type-level `any` in a file outside the bounded fix scope (existing app code, or a module owned by another H3 team); recorded as FINDING, not touched.

## Headline counts

| Metric | Count |
|---|---|
| Type-level `any` hits, H-083 scope dirs (`lib/reliability`, `lib/security`, `lib/observability`) | **0** |
| Type-level `z.any()` usages, entire repo (`frontend/src/` + `scripts/`) | **0** |
| Type-level `any` hits, repo-wide (non-generated) | **98** across 23 files — all pre-existing-out-of-scope FINDINGs |
| Type-level `any` hits, `scripts/` | **0** |
| Prose/comment/UI-copy matches of the word "any" (not type usages) | 32 across 29 files — justified |
| Machine-generated hits (`routeTree.gen.ts`) | 154 — justified (generated) |
| Files modified by H-083 | 0 (nothing to fix in scope) |

## Census detail — H-083 bounded scope (lib/reliability, lib/security, lib/observability)

Every hit enumerated; **zero type-level `any`/`z.any()`**. All matches are prose:

| File | Hits | Classification | Evidence |
|---|---|---|---|
| `frontend/src/lib/reliability/slo.ts` | 1 | justified-with-reason | prose inside an SLI description string ("Zero tolerance: any unauthorized retrieval…"), line 134 |
| `frontend/src/lib/reliability/recovery-targets.ts` | 1 | justified-with-reason | doc-comment prose ("any gap is…", line 330); module authored by A-002 this wave |
| `frontend/src/lib/observability/deployment-gate.ts` | 1 | justified-with-reason | doc-comment prose ("any 2xx other than…", line 244); module authored by E-042 this wave |
| `frontend/src/lib/security/trust-fabric.ts` | 3 | justified-with-reason | doc-comment prose ("any evidence record…", "any revoked assertion…", "any assertion past…", lines 137/348/352) |

Additional verification beyond `rg`: residual-form check (`= any`, `any |`, `any )`, `=> any`, `Promise<any>`, `Array<any>`, `Record<*, any>`) over the three scope dirs returned **zero matches**. H-083 therefore made **no code modifications** in scope and no regression test runs were required (no module changed).

## Census detail — other H3-wave new files ( Squad B/C/E/F/G contract modules)

All matches are doc-comment prose (e.g. "any invariant violation yields a typed failure") — **justified-with-reason**, no FINDING against any team:

`lib/self-improvement/contracts.ts` (2) · `lib/autonomous-economy/contracts.ts` (1) · `lib/zero-trust-defense/contracts.ts` (1) · `lib/sandbox-runtime/contracts.ts` (1) · `lib/evolution-engine/contracts.ts` (1) · `lib/governance-alignment/contracts.ts` (1) · `lib/simulation-engine/contracts.ts` (1) · `lib/kernel/phase-contracts/phase-49-autonomous-economy.ts` (1) · `lib/audit/query-surface.contract.ts` (1 — doc text affirming "no `any`, no `z.any()`") · `lib/ai-gateway/egress-allowlist.ts` (1) · `lib/ai-gateway/reasoning-provenance.ts` (1) · `lib/ai-gateway/runtime-defenses.ts` (1) · `lib/agent-runtime/ephemeral-lifecycle.ts` (1) · `lib/agent-runtime/capability-matching.ts` (1) · `lib/mission/gates.ts` (1) · `lib/payments/legacy-reconciliation.ts` (1) · `lib/kernel/event-security.ts` (1).

## FINDINGS — pre-existing type-level `any`, out of H-083 scope (must-fix backlog)

98 hits across 23 files, all pre-existing application code outside the three H-083-owned directories. Recorded for the coordinator/backlog; **not modified** (bounded ownership):

| File | Type-`any` hits | Representative usage |
|---|---|---|
| `frontend/src/routes/_authenticated/admin/operations.tsx` | 23 | `icon: any`, `(r: any)`, `const r: any = payload.new` |
| `frontend/src/routes/_authenticated/admin/intelligence.tsx` | 12 | `campaigns: any[]`, `(g: any)`, `<Link to={actionUrl as any}>` |
| `frontend/src/routes/_authenticated/admin/health-certificate.tsx` | 10 | `(a: any)`, `(c as any).note` |
| `frontend/src/routes/_authenticated/admin/health.tsx` | 7 | `(s: any)`, `(u: any)` |
| `frontend/src/routes/_authenticated/parent/bus-tracking.tsx` | 6 | `assigned_students: any`, `(payload.new as any)` |
| `frontend/src/routes/_authenticated/admin/digital-twin.tsx` | 5 | `Record<string, any>` ×4, `(r: any)` |
| `frontend/src/routes/_authenticated/admin/bus-management.tsx` | 5 | `(as any[])`, `onError: (e: any)` |
| `frontend/src/routes/_authenticated/admin/discipline.tsx` | 4 | `} as any;`, `(s: any)` |
| `frontend/src/routes/_authenticated/admin/library.tsx` | 3 | `(s: any)`, `(u: any)` |
| `frontend/src/routes/_authenticated/admin/hostel.tsx` | 3 | `(s: any)`, `(u: any)` |
| `frontend/src/routes/_authenticated/admin/buses.tsx` | 3 | `onError: (e: any)` |
| `frontend/src/lib/runtime/scholar/notifications-fanout.functions.ts` | 3 | `supabase: any`, `[k: string]: any` |
| `frontend/src/components/admin/facilities-forms.tsx` | 2 | `} as any,` |
| `frontend/src/lib/runtime/scholar/staff-accounts.functions.ts` | 2 | `admin: any`, `(u: any)` |
| `frontend/src/routes/_authenticated/admin/support.tsx` | 2 | `(c as any)[k]++`, `(e: any)` |
| `frontend/src/components/admin/crud-list.tsx` | 1 | `table: any;` |
| `frontend/src/lib/kernel-admin-client.ts` | 1 | `export type KernelAdminClient = any;` |
| `frontend/src/lib/security-role-gate.ts` | 1 | `type SupabaseRpcClient = any;` |
| `frontend/src/lib/push.server.ts` | 1 | `supabase: any` |
| `frontend/src/routes/rules.tsx` | 1 | `(school as any).school_rules` |
| `frontend/src/routes/privacy.tsx` | 1 | `(school as any).privacy_policy` |
| `frontend/src/routes/_authenticated/super-admin/support.tsx` | 1 | `onError: (e: any)` |
| `frontend/src/routes/_authenticated/admin/settings.tsx` | 1 | `{ tab, values } as any` |

Risk note (Constitution §26/§32): the `SupabaseRpcClient = any` and `KernelAdminClient = any` aliases and the `supabase: any` server-function parameters suppress type checking at authorization/data boundaries — highest-priority items in the backlog above.

## Justified — prose & generated matches

- `frontend/src/routeTree.gen.ts` — 154 matches, machine-generated by TanStack Router tooling; not hand-maintained; justified.
- Prose/comment/UI-copy (word "any", not a type): 32 hits across 29 files — `lib/security/trust-fabric.ts` (3, in scope, listed above) plus `lib/security-core.ts` (1), `lib/universal-roles.ts` (1, doc text about guarding *against* `as any` callers), `lib/academic-curriculum.ts` (1), `lib/marketplace-package.ts` (1), `lib/scholar/roles/role-definition.ts` (1), `lib/runtime/scholar/bus-tracking.functions.ts` (1), `routes/_authenticated/student/ai-tutor.tsx` (1, UI copy), `routes/_authenticated/student/dashboard.tsx` (1, UI copy), and the H3-wave contract modules listed in the previous section (18).

## z.any() specific result

- **0 actual `z.any()` usages** in `frontend/src/` and `scripts/`.
- 1 doc-comment mention (`lib/audit/query-surface.contract.ts:38`, text affirming the module contains none).

## Disposition of H-083's own deliverable

- Census authored (this document): yes.
- In-scope fixes: **none required** — the three owned directories are already strict-TS compliant (0 type-level `any`, 0 `z.any()`).
- Tests run: none — no in-scope module was modified, so there is no regression surface for H-083 (Campaign Law 9 applies only when a module is touched). This is reported honestly rather than fabricating a test run.