# H-084 — Server-Function Input-Validation Coverage Audit (AGENTS §27 Step 4: Validate)

| | |
|---|---|
| **Mission** | H-084 (Squad H — Quality & CI hardening) |
| **Role** | Zod Coverage Engineer, team H3-084 |
| **Authority** | AGENTS.md §26 (API Governance), §27 (Server Function Rule, step 4 "Validate"), §32 (Zod-validated contracts) |
| **Scope** | DOC-ONLY audit. No code changed; findings belong to module owners. |
| **Census point-in-time** | 2026-10-03, branch `cursor/p08-foundation-loop-classification-fe86`. 100 teams are working concurrently; the file census below is a snapshot and WILL drift. Re-enumerate before acting on any finding. |

---

## 1. Method

1. Enumerated every `*.functions.ts` under `frontend/src/` (the repo's server-function convention: TanStack Start `createServerFn` modules).
2. Read each module in full and classified every exported server function by how its inputs are validated:
   - **ZOD** — a non-empty Zod schema is parsed in `.validator()` before the handler runs (payload rejected at the framework boundary).
   - **ZOD-EMPTY** — `.validator()` parses `z.object({})` as a null-input guard (no payload accepted, but a malformed/oversized payload shape is still asserted).
   - **NO-INPUT** — the handler consumes no input at all and has no validator.
   - **NONE** — callable with no `.validator()` in the path.
3. Recorded line evidence for every classification and for each finding.
4. Classification key: the §27 order is authenticate → tenant → authorize → **validate** → execute → audit → return. This audit judges only step 4; where auth/tenant/authorize gaps were observed incidentally they are flagged, not adjudicated.

---

## 2. Census (point-in-time 2026-10-03)

**30 modules, 74 exported server functions.**

| # | Module (relative to `frontend/src/`) | Exported server fns | ZOD | ZOD-EMPTY | NO-INPUT | NONE |
|---|---|---:|---:|---:|---:|---:|
| 1 | `lib/push.functions.ts` | 2 | 1 | 0 | 1 | 0 |
| 2 | `lib/profile.functions.ts` | 3 | 2 | 0 | 1 | 0 |
| 3 | `lib/tenant-registry.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 4 | `lib/identity-registry.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 5 | `lib/foundation-loop.functions.ts` | 1 | 1 | 0 | 0 | 0 |
| 6 | `lib/kernel-reality.functions.ts` | 4 | 4 | 0 | 0 | 0 |
| 7 | `lib/register-runtime.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 8 | `lib/runtime/scholar/org-profile.functions.ts` | 2 | 1 | 1 | 0 | 0 |
| 9 | `lib/runtime/scholar/notification-digest.functions.ts` | 1 | 1 | 0 | 0 | 0 |
| 10 | `lib/runtime/scholar/bus-tracking.functions.ts` | 3 | 2 | 0 | 1 | 0 |
| 11 | `lib/runtime/scholar/lesson-plan-ai.functions.ts` | 1 | 1 | 0 | 0 | 0 |
| 12 | `lib/runtime/scholar/paystack.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 13 | `lib/runtime/scholar/teachers.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 14 | `lib/runtime/scholar/staff-accounts.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 15 | `lib/runtime/scholar/scholar-institution-config.functions.ts` | 4 | 1 | 0 | 3 | 0 |
| 16 | `lib/runtime/scholar/scholar-foundation-loop.functions.ts` | 1 | 1 | 0 | 0 | 0 |
| 17 | `lib/runtime/scholar/digital-twin.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 18 | `lib/runtime/scholar/expense-insights.functions.ts` | 1 | 0 | 0 | 1 | 0 |
| 19 | `lib/runtime/scholar/demo-provision.functions.ts` | 1 | 0 | 0 | 1 | 0 |
| 20 | `lib/runtime/scholar/driver-portal.functions.ts` | 4 | 3 | 0 | 1 | 0 |
| 21 | `lib/runtime/scholar/attendance.functions.ts` | 3 | 3 | 0 | 0 | 0 |
| 22 | `lib/runtime/scholar/messages-broadcast.functions.ts` | 1 | 1 | 0 | 0 | 0 |
| 23 | `lib/runtime/scholar/notifications-fanout.functions.ts` | 5 | 5 | 0 | 0 | 0 |
| 24 | `lib/runtime/scholar/provisioning.functions.ts` | 5 | 4 | 0 | 1 | 0 |
| 25 | `lib/runtime/scholar/facilities.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 26 | `lib/runtime/scholar/school-settings.functions.ts` | 1 | 1 | 0 | 0 | 0 |
| 27 | `lib/runtime/scholar/timetable.functions.ts` | 2 | 2 | 0 | 0 | 0 |
| 28 | `lib/runtime/scholar/scholar-feature-access.functions.ts` | 2 | 1 | 1 | 0 | 0 |
| 29 | `lib/runtime/scholar/scholar-role-assignments.functions.ts` | 7 | 2 | 5 | 0 | 0 |
| 30 | `lib/runtime/scholar/workforce-positions.functions.ts` | 4 | 2 | 2 | 0 | 0 |
| | **TOTAL** | **74** | **57** | **7** | **9** | **0** |

### Coverage summary

- **57 / 74 (77%)** validate a real input payload with a Zod schema at the `.validator()` boundary.
- **7 / 74 (9%)** guard a no-payload POST with `z.object({})` (the empty-object convention).
- **9 / 74 (12%)** consume no input and have no validator (GET readers and no-input POSTs — see §4.3).
- **0 / 74 functions accept unvalidated input payloads.** No server function in the census parses untrusted input without a schema.
- Note: 28 / 30 modules (93%) are fully Zod-covered; the two partial modules are `expense-insights` and `demo-provision` (both no-input POSTs), plus three no-input GETs in `scholar-institution-config`.

### Line-evidence exemplars of the classification boundaries

- ZOD, strict payload: `lib/foundation-loop.functions.ts:25-37` (`requestSchema`…`.strict()`) applied at `:229`.
- ZOD-EMPTY guard: `lib/runtime/scholar/scholar-role-assignments.functions.ts:178` (`z.object({}).parse(input)`).
- NO-INPUT GET: `lib/runtime/scholar/scholar-institution-config.functions.ts:232-234` (no `.validator`, handler reads only `context`).
- NONE (no validator, no auth middleware): `lib/runtime/scholar/demo-provision.functions.ts:198`.

---

## 3. What "covered" does and does not mean here

The `.validator()` parse runs before the handler, so schema-validated functions satisfy §27 step 4 at the boundary. Two quality tiers exist inside the ZOD class:

- **Tier A (schema is the only gate):** bounded, typed fields (`attendance.functions.ts:117-130`, `school-settings.functions.ts:133-141` discriminated union, `digital-twin.functions.ts:67-85` bounded JSON envelope).
- **Tier B (loose Zod envelope + downstream semantic validator):** the parse layer would accept malformed shapes; correctness depends on a second in-handler check. Tier B is acceptable as defense in depth but should not be the only layer. Both instances are Finding F-4.

---

## 4. Ranked findings

### F-1 — HIGH — `provisionDemoEnterprise` has no validator AND no auth middleware

- **File:** `frontend/src/lib/runtime/scholar/demo-provision.functions.ts:198-199`
- **Evidence:** the only exported server fn in the census with neither `.middleware([requireSupabaseAuth])` nor `.validator(...)`; the sole control is the `ALLOW_DEMO_PROVISIONING !== "true"` env check at `:205`. It takes no input payload, so *input* validation is vacuously satisfied — but the §27 pipeline is otherwise unguarded (no authenticate step), and it writes school/auth/subscription rows with fixed credentials.
- **Suggested schema / remediation (owner: demo-provision owner):**
  ```ts
  export const provisionDemoEnterprise = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .validator((i: unknown) => z.object({}).strict().parse(i))
    .handler(/* existing env gate + requirePlatformSuperAdmin(context.supabase, …) */);
  ```
  Fail-closed even when the env flag is left on by mistake.

### F-2 — MEDIUM — `verifyFeePayment` trusts an unvalidated provider response and provider-supplied fee id

- **File:** `frontend/src/lib/runtime/scholar/paystack.functions.ts:100-131`
- **Evidence:** input is validated (`verifySchema`, `:98`, `:102`). But the Paystack verify response is only `as`-cast (`:108-112`), and the fee row updated is keyed on `body.data.metadata?.fee_id` (`:117-127`) — provider-controlled data used without schema validation, tenant re-check, or amount comparison. This is the §21 pattern (AI/provider output is untrusted by default) applied to a payment provider; the sibling webhook path is documented as source of truth (`:8-10`), which limits severity, but this function still writes `fees.status/paid_amount` (`:120-125`).
- **Suggested schema (owner: payments owner):**
  ```ts
  const PaystackVerifyResponse = z.object({
    status: z.boolean(),
    message: z.string().max(500).optional(),
    data: z.object({
      status: z.string().max(40),
      amount: z.number().int().positive(),
      metadata: z.object({ fee_id: z.string().uuid() }).partial().optional(),
    }).optional(),
  });
  ```
  Then: parse the response, verify the fee row is visible to the caller (`school_id` scope, as `initFeePayment` does at `:42-48`), and compare `amount/100` against the fee's outstanding before updating.

### F-3 — MEDIUM — Naked POST server functions accept arbitrary payloads

- **Files / evidence:**
  - `frontend/src/lib/runtime/scholar/expense-insights.functions.ts:38-40` — `getExpenseInsights` is `method: "POST"` with no `.validator`; any JSON body is accepted and ignored.
  - `frontend/src/lib/push.functions.ts:30-32` — `sendTestPush` same pattern.
- **Impact:** low today (inputs unused), but these are unprotected write-shaped surfaces: any future handler edit that starts reading `data` silently inherits untrusted input. The empty-guard convention already exists (§2 ZOD-EMPTY).
- **Suggested schema:** `.validator((i: unknown) => z.object({}).strict().parse(i))` on both — `.strict()` also rejects junk the client sends by mistake.

### F-4 — MEDIUM — Loose Zod envelopes rely on downstream validators as the only real gate

- **Files / evidence:**
  - `frontend/src/lib/register-runtime.functions.ts:62-73` — `manifestEnvelopeSchema` is `.passthrough()` with unbounded `z.string()` fields and `z.unknown()` subtrees; semantic validation is deferred to `assertValidManifest` → `validateManifest` (`:87-92`), applied at `:139`.
  - `frontend/src/lib/runtime/scholar/scholar-institution-config.functions.ts:44-54` — `specPartsSchema` is `.passthrough()` with `z.array(z.unknown())`; deferred to `buildSchoolSpec` (`:124-127`).
- **Impact:** acceptable as layered design (the semantic validators do reject), but the parse layer alone accepts e.g. a 10 MB `name` string. Violates the spirit of §32 ("Zod-validated contracts") for the boundary itself.
- **Suggested schema (owner: kernel/runtime-registry owner):** bound the envelope — `id: z.string().min(1).max(160)`, `name: z.string().trim().min(1).max(200)`, `version: z.string().max(64)`, `capabilities: z.array(z.string().max(160)).max(100)` — keep `validateManifest` as the second layer. Same treatment for `spec_parts` once `SchoolBuildParts` field bounds are fixed.

### F-5 — LOW — Weak field constraints on user-controlled strings that reach notification rows

- **Files / evidence:**
  - `frontend/src/lib/runtime/scholar/notifications-fanout.functions.ts:222` — `pushNotification`'s `action_url: z.string().max(200).optional()`: no URL/path format check, and the value is copied into `notifications.action_url` (`:253`); a `javascript:` scheme or off-site link could be distributed to a whole tenant audience. Suggest `z.union([z.string().regex(/^\/[A-Za-z0-9/_?=&.-]*$/).max(200), z.string().url().max(200)])`.
  - `frontend/src/lib/runtime/scholar/notifications-fanout.functions.ts:267` — `notifyCalendarEvent`'s `start_date: z.string().min(8)`: accepts any 8+ chars; interpolate at `:305`. Suggest `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` (the pattern already used at `attendance.functions.ts:119`).
  - `frontend/src/lib/runtime/scholar/digital-twin.functions.ts:132` — `recipient_phone: z.string().trim().min(6).max(32)`: free-form string sent to the voice gateway at `:219`. Suggest `z.string().regex(/^\+?[0-9]{6,15}$/)` (E.164).

### F-6 — LOW — Exported non-server entry points bypass the validator layer

- **Files / evidence:**
  - `frontend/src/lib/foundation-loop.functions.ts:157-173` (`executeRecordFoundationLoop`) and `:248-254` (`rollbackFoundationExecution`) — exported plain async functions whose `data`/`executionId` parameters are TypeScript-typed but never schema-parsed (`executionId: string` has no uuid/format check; the server fn `recordFoundationLoop` at `:227-237` *is* validated, so only non-HTTP/test callers are exposed).
  - `frontend/src/lib/runtime/scholar/scholar-foundation-loop.functions.ts:131-137` — same shape for `executeScholarFoundationLoop` (validated only when reached via `scholarFoundationLoop` at `:297-299`).
- **Suggested remediation (owner: foundation-loop owner):** accept `z.infer<typeof requestSchema>` and `z.string().uuid()`-parse at the top of these helpers (they are the same trust boundary if any route/test can call them), or stop exporting them and export only the server fns.

### F-7 — INFO — No-input GET/POST readers lack the empty-guard convention

- **Files / evidence:** `lib/profile.functions.ts:36-38` (`getMyProfile`), `lib/runtime/scholar/bus-tracking.functions.ts:40-42` (`getMyBus`), `lib/runtime/scholar/driver-portal.functions.ts:57-59` (`getMyDriverBus`), `lib/runtime/scholar/scholar-institution-config.functions.ts:232`, `:293`, `:342` (three operating-model GETs), `lib/runtime/scholar/provisioning.functions.ts:71-72` (`checkPlatformBootstrap`).
- **Impact:** none today (no input consumed, all authenticated except `checkPlatformBootstrap`, which is a deliberate public bootstrap read with a boolean return). Listed for uniformity: applying the `z.object({}).strict()` guard everywhere makes "every server fn has a validator" a greppable invariant instead of a judgment call.
- **Suggested schema:** `.validator((i: unknown) => z.object({}).strict().parse(i))` uniformly.

### F-8 — INFO — Demarcation note (out of audit scope, forwarded to owners)

- `frontend/src/lib/runtime/scholar/demo-provision.functions.ts:14,22-36` — hard-coded demo credentials committed as fixture constants (returned by `provisionDemoEnterprise`). Input-validation is not the issue; secrets hygiene is. Forwarded to the secrets-hygiene owner (H-085 remit) — the literal values are deliberately not reproduced in this document.
- `frontend/src/lib/runtime/scholar/notifications-fanout.functions.ts:26,45,59` and `frontend/src/lib/runtime/scholar/staff-accounts.functions.ts:83,88` — `any`-typed client params. Forwarded to the strict-TS owner (H-083 remit).

---

## 5. Coverage table answer to the Golden Questions (§43)

- **WHO** consumes the inputs? Server-function handlers under `frontend/src/lib/**` (owners per module; findings routed above).
- **WHAT** is validated? Every client-supplied input payload of every exported `createServerFn` (74/74 either schema-parsed, empty-guarded, or input-free; zero unvalidated-payload functions).
- **WHERE** is validation enforced? In `.validator()` at the TanStack Start boundary — before `handler`, i.e. before execution (§27 step 4 ordering holds).
- **WHY** Zod? §32 mandates Zod-validated contracts; the boundary parse is the single choke point that makes "never trust the client" (§26) enforceable.
- **UNDER WHICH POLICY?** AGENTS.md §26/§27/§32; campaign law item 7 (H3-WAVE-CAMPAIGN.md); this audit is evidence, not authority.

## 6. Limitations

- Point-in-time census (§ header). Concurrent H3 squads are adding `frontend/src/lib/<slug>/contracts.ts` modules and test files; new `*.functions.ts` files may have appeared since the snapshot. The enumeration method (§1) is repeatable.
- This audit classifies *input validation* only. Authentication, tenant resolution, authorization, and audit steps were observed incidentally (and were present in all modules except F-1) but are not adjudicated here.
- Internal helpers, route handlers (`*.ts` routes, e.g. the Paystack webhook), and pure contract modules under `frontend/src/lib/<area>/contracts.ts` are outside the `*.functions.ts` census by mission definition.
