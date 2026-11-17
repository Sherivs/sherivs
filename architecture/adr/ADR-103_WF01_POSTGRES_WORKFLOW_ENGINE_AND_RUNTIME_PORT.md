# ADR-103: Workflow Engine in Postgres Behind a Runtime Port (WF-01)

| Field                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED. The founder chose Option A on 2026-11-17 (13:02 WAT) and approved the schema on staging only. He approved the merge and the production apply in writing on 2026-11-17 (14:04 WAT); the apply follows a fresh backup.                                                                                                                                                                                                                                                                                                                                                      |
| Date                       | 2026-11-17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Author                     | Grok Bot executor (mission WF-01)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Creator                    | Grok Bot executor agent, mission WF-01 (provenance id W-001; workflow automation, staging only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Mission                    | WF-01 (workflow automation: ADR and neutral schema)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Capabilities               | Durable, tenant-isolated workflow definitions, versions, triggers, events, runs, step history and approvals; SKIP LOCKED claiming                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Cites                      | [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md) (private by default); [ADR-102](./ADR-102_M1_CANONICAL_ORGANIZATION_ROOT.md) (organization root = `public.schools`, option A); [ADR-081](./ADR-081_ENGINE_TOOL_BROKER_AND_CONNECTOR_VAULT.md) (tool broker); [ADR-083](./ADR-083_ENGINE_PLAYBOOK_RUNNER.md) (playbook runner); `frontend/src/lib/workflow/workflow-engine.ts`; `frontend/src/lib/automation-workflow.ts`; `scripts/verify-domain-neutrality.mjs`; `scripts/verify-migration-grants.mjs`; audit_chain (`20261022000200_sherivs_013…:83-125`) |
| Minimal ownership artifact | `database/supabase/migrations/20261117000400_sherivs_wf01_workflow_engine_schema.sql`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Context

Sherivs has a pure workflow evaluator (`workflow-engine.ts`, `workflow-contract.ts`) and automation model (`automation-workflow.ts`) that only tests import. Their headers defer persistence to "an approved migration". There is no table for workflow definitions, versions, runs, steps or tenant approvals. `jarvis_approval_requests` is platform-only. The WF-00 audit (17 Nov 2026) compared three runtimes:

- a Postgres-native engine on the existing Supabase EU project;
- Vercel Workflow;
- Cloudflare Workflows.

It recommended the first.

Constraints that shape the schema:

- The domain-neutrality guard fails CI on vertical vocabulary in `database/supabase/migrations/`, and its baseline only shrinks.
- Since SEC-M0 (ADR-101), new tables are private until a migration grants them, and `verify-migration-grants.mjs` fails a table with no GRANT or REVOKE.
- Two tenant keys exist in the codebase:
  - `org_id uuid` holds the organization root id. The newer org-scoped tables and the permission catalog use it: `has_permission(p_org uuid, …)` and `can_administer_org(uuid)`.
  - Kernel tables use a nullable text `tenant_id`/`tenant_ref` (`cg_event`, `cg_role_assignment`).
- Production has no organizations yet, so the choice costs no data migration.

## Options

### Option A: Postgres-native engine, runtime behind a port (ruled)

- **State:** definitions, versions, trigger bindings, events, runs, steps and approvals live in Supabase (eu-west-1) under forced RLS.
- **Runtime:** a stateless runner claims due work with `FOR UPDATE SKIP LOCKED`. It runs on Vercel at `/api/public/cron/workflow-tick`, protected by `CRON_SECRET`, and is ticked every minute by the `sherivs-cron` Cloudflare Worker.

- **Consequences:**
  - **For:**
    - $0 extra cost.
    - Tenant data stays in the EU project.
    - RLS, audit_chain and the vault are native.
    - It reuses the outbox, lease and claim patterns.
    - It adds no new processor of personal data.
  - **Against:**
    - We own retry, timer and sweep code.
    - Throughput is bounded by the database and the tick; WF-04 load-tests it.
    - A start can lag up to about 1 minute if a post-commit kick is lost.

### Option B: Vercel Workflow plus Queues (rejected for now)

- **Consequences:**
  - **For:** managed durable steps and approval hooks.
  - **Against:**
    - Run state sits in Vercel-managed storage, and its EU residency is unverified.
    - The free allowance is too small.
    - There is a Hobby-plan commercial-use concern.

### Option C: Cloudflare Workflows plus Queues (rejected for now; the swap target)

- **Consequences:**
  - **For:** the strongest durable runtime per dollar on Workers Paid.
  - **Against:**
    - Free limits (10 ms CPU, 50 subrequests) are too tight.
    - It is a second codebase.
    - It needs the database service key in a Worker secret.
    - EU residency of its state is unverified.

## Recommendation (decision)

**Option A.** The engine's durable state is the `wf_*` schema in the existing Supabase project. Its runtime sits behind a `WorkflowRuntimePort`, so a later move to Option C or B changes the driver, not the schema or the product.

### Runtime interface boundary

The schema owns state and invariants. The runtime owns side effects and time.

| Port operation (WF-03) | Database side (this ADR)                                                                            | Runtime side (later missions)                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `claim(worker, limit)` | `wf_claim_due_steps(worker, limit, lease_seconds)`, service role only, SKIP LOCKED, lease + attempt | Calls it each tick; heartbeats by extending `lease_expires_at`       |
| `advance(stepResult)`  | `wf_step_run` / `wf_run` status columns, guards (finished is final, attempts only grow)             | Evaluates the graph with `workflow-engine.ts`; writes `wf_run_event` |
| `schedule(step, at)`   | `next_attempt_at` (retry with backoff), `resume_at` (waits), `deadline_at` (run timeout)            | Computes backoff with jitter; sweeps timeouts                        |
| `kick()`               | none                                                                                                | Fire-and-forget call to the tick route after a commit                |
| side effects           | `idempotency_key` unique per organization on runs and steps                                         | Tool broker + `cg_tool_call_ledger`, keyed by the step's key         |

Rules the runtime must honour:

1. The organization is always read from the stored row (definition, run or step), never from a payload or caller.
2. Only published versions run.
3. Every external effect carries the step's idempotency key.
4. No personal data copies go into `payload`, `input_ref` or `output_ref`, only references.

### Tenant model

- **Key:** every table carries `org_id uuid NOT NULL`, the canonical organization root id. Under ADR-102 option A (founder, 2026-11-17) that is `public.schools.id`. This is the same key `audit_chain`, `usage_counters`, `org_entitlements` and the permission catalog use.
- **Text kernel refs:** these (`tenant_ref`, `cg_event.tenant_id`) are not stored as the key. The runtime resolves them to `org_id` through the existing 1:1 organization-to-kernel map before writing a `wf_event`. A missing map row means the event is refused.
- **Mismatch resolved:** the text/uuid tenant-key mismatch is resolved in favour of uuid. It is the type of the organization root, of every permission helper, and of audit_chain. `org_id::text` (canonical lowercase) is the bridge wherever a text ref is compared, as existing policies already do (`is_tenant_admin(org_id::text)`).
- **Within-tenant integrity:** every child reaches its parent through a composite `(org_id, id)` foreign key. A version, trigger, run, event, step, timeline entry or approval therefore cannot point into another organization, even when written by the service role.
- **No foreign key to the organization table in this file.** Naming that table would break the neutrality guard, and adding a baseline exception needs its own ADR. This matches `audit_chain`. Writes by people pass a permission check that only holds for an organization the person belongs to. The service role writes rows derived from stored definitions.

### Access model

- **Neutral wrapper:** `wf_can(org, perm)` is `can_administer_org(org) OR has_permission(org, perm)`, for signed-in people only. It accepts four permissions: `workflows.view`, `workflows.manage`, `workflows.run` and `workflows.approve`. WF-02 adds these to the permission catalog with separation of duties. Until then only organization administrators pass. Super-admin access is inherited from the existing `can_administer_org` rule.
- **Reads:** members with `workflows.view` can read. Platform staff holding the existing `platform.tenants.read` capability can read, but never write.
- **Writes by people:**
  - definitions, draft versions and trigger bindings only;
  - only in their own organization;
  - only with `workflows.manage`.

  Members cannot do any of these:
  - publish a version;
  - change the active version;
  - start a run;
  - write steps or events;
  - decide approvals.

  No client role may DELETE anything.

- **anon:** has nothing.
- **Service role:** it is the runtime and bypasses RLS by design. The composite foreign keys and guards still bind it.
- **Immutability:**
  - Published versions are immutable; the only change allowed is published → retired, by the service.
  - `org_id` and ids never change.
  - Finished runs and steps are final.
  - `wf_run_event` is append-only, including for the table owner.
- **Approvals:**
  - Organization-scoped.
  - Decided only by a person in the console (`decision_channel = 'console'`). Phone, SMS, WhatsApp, email and agents can never decide.
  - Never by the requester.
  - Expire within 30 days.
  - Final once decided.
- **Limits:**
  - per version: max steps per run, max run depth (loop guard), max loop iterations, default attempts, run timeout;
  - per run: depth and step count, checked against limits copied from the version;
  - per step: max attempts;
  - per trigger: fires per hour and de-duplication window;
  - per definition: concurrent runs and runs per hour.
- **Audit:** these changes append to `audit_chain` with the existing lock (7013), link and canonical hash:
  - definition created, updated and activated;
  - version created, draft updated, published and retired;
  - trigger created, updated, enabled and disabled;
  - run created, started and finished;
  - approval requested and decided.

  Step-level detail goes to `wf_run_event`.

### Rollback

`database/supabase/rollbacks/20261117000400_sherivs_wf01_workflow_engine_schema.sql` drops every WF-01 object in one transaction and verifies none remain. It drops workflow rows, so it is run before organizations depend on workflows, or after an export. It leaves audit_chain entries in place, because that chain is append-only. On a hosted project, the ledger row is removed afterwards. The runtime swap (Option C or B) is a separate decision and needs no rollback of this schema.

### Explicit residual risk

- **No foreign key to the organization root.** A row can name an organization id that does not exist, or that was later removed:
  - **Bound:** people can only write where they hold permission. The service role writes from stored definitions.
  - **Owner:** WF-12, which handles retention and orphan sweeps, and M6 provisioning.
- **The service role bypasses RLS.** A runtime bug could read across tenants. **Bound:** claim results carry the stored `org_id`, and composite keys stop cross-tenant writes. WF-03 tests that no runtime code takes `org_id` from input.
- **Only administrators can use workflows until WF-02** adds the permissions. This is fail-closed.
- **Throughput is unmeasured** until the WF-04 load test.

## Consequences (summary)

- **Positive:** persistence for the existing evaluator. Tenant isolation is proven by tests on the full migration history (CI) and on hosted Supabase (staging). No new vendor, no new cost.
- **Obligations:**
  - WF-02 adds the permissions and separation of duties.
  - WF-03 builds the port and tick, binds the org from rows, and enforces idempotency keys.
  - WF-04 schedules the tick and load-tests it.
  - WF-07 adds console approvals with passkey step-up.
  - WF-12 adds retention.
- **For the program:** WF-03 to WF-14 consume this schema.

## Golden Questions

- **WHO?** The WF missions build on it. Production apply and merge are founder decisions.
- **WHAT?** Durable workflow state in Postgres under forced RLS, keyed by the organization root id, with the runtime behind a port.
- **WHERE?** This file; the migration and rollback named above; tests in `tests/integration/wf01-*.local.*`.
- **WHY?** The evaluator has no persistence, and customer workflows need tenant-isolated, audited, durable state at $0.
- **UNDER WHICH POLICY?** ADR-101 (private by default), ADR-102 (organization root), the domain-neutrality guard, the founder's rules (no weakening of auth, RLS, tenant isolation or audit; production changes need written approval).

## UNKNOWNs

- The throughput of Option A, until WF-04.
- EU residency of Option B and Option C state, if either is reconsidered.
