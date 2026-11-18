/**
 * M6 (mission E-016, ADR-117) — server logic behind /console/onboarding. Server-only.
 *
 * Every entry point:
 *   1. resolves the caller's console capability from the database with the caller's own session
 *      (has_internal_console_capability: active staff + platform role; no client claim is
 *      trusted, and a super-admin flag alone is not a staff role);
 *   2. requires AAL2 for approve and provision (same rule as provisionOrganizationCase);
 *   3. reads and writes only through service-role database functions that re-check the actor;
 *   4. writes an application-level audit record for the outcome, succeeded or not (the database
 *      functions audit each successful mutation in the same transaction as the mutation).
 *
 * The organization id, the plan, its hash and the approver are never taken from the client:
 * the client sends a request id and the plan hash it reviewed, and the database refuses any hash
 * that is not the current one. Approval needs a passkey assertion whose challenge binds the
 * staff member, the request, the decision and the plan hash (jarvis-bridge/step-up.ts).
 */
import { envelopePlan } from "@/lib/onboarding/plan";
import {
  diffPlans,
  isOnboardingRequestStatus,
  onboardingApprovalId,
  PLAN_HASH_PATTERN,
  queueAge,
  sortQueue,
  type OnboardingRequestStatus,
  type PlanDiffEntry,
} from "@/lib/onboarding/plan-review";
import {
  provisionApprovedPlan,
  type PlanProvisioningFailureCode,
  type PlanProvisioningRpc,
} from "@/lib/onboarding/provision-organization";
import { newStepUpNonce, stepUpChallenge, stepUpChallengeMatches } from "@/lib/jarvis-bridge/step-up";
import { validateOnboardingPlan, type ValidatedOnboardingPlan } from "@/lib/scholar/onboarding/plan-schema";
import { buildWebsiteDraft } from "@/lib/scholar/onboarding/website-draft";
import { FULL_REALITY_GRAPH } from "@/lib/scholar/reality/graph/full-graph";
import { generatePlan } from "@/lib/scholar/reality/graph/plan";
import type { GraphAnswers } from "@/lib/scholar/reality/graph/types";

export const CAP_READ = "platform.onboarding.read";
export const CAP_HANDLE = "platform.onboarding.handle";
export const CAP_MANAGE = "platform.tenants.manage";

/* ───────────────────────────── contracts ───────────────────────────── */

export interface ConsoleOnboardingContext {
  readonly userId: string;
}

/** Plain JSON (what the console screen receives). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const json = (v: unknown): Json => (v === undefined ? null : (JSON.parse(JSON.stringify(v)) as Json));

export interface DiffView {
  readonly path: string;
  readonly kind: PlanDiffEntry["kind"];
  readonly before: Json;
  readonly after: Json;
}

export type DbResult = { data: unknown; error: { code?: string; message?: string } | null };

export interface RequestRow {
  readonly id: string;
  readonly org_name: string;
  readonly institution_type: string;
  readonly state: string | null;
  readonly lga: string | null;
  readonly contact_name: string;
  readonly contact_email: string;
  readonly contact_phone: string | null;
  readonly contact_role: string | null;
  readonly note: string | null;
  readonly source: string;
  readonly status: string;
  readonly assigned_staff: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly generated_plan: unknown;
  readonly review_plan: unknown;
  readonly plan_hash: string | null;
  readonly plan_revision: number;
  readonly plan_graph_version: string | null;
  readonly plan_edited_by: string | null;
  readonly approved_plan_hash: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly provisioned_org_id: string | null;
  readonly provisioned_at: string | null;
}

export interface SessionRow {
  readonly graph_version: string;
  readonly answers: unknown;
  readonly completion_pct: number;
  readonly completed_at: string | null;
}

/** Narrow persistence surface (service role). The Supabase adapter is at the bottom. */
export interface OnboardingConsoleStore {
  listRequests(limit: number): Promise<RequestRow[]>;
  getRequest(id: string): Promise<RequestRow | null>;
  latestSession(requestId: string): Promise<SessionRow | null>;
  staffNames(ids: readonly string[]): Promise<Record<string, string>>;
  publishedPacks(): Promise<{ code: string; version: string }[]>;
  appliedResult(requestId: string): Promise<Record<string, unknown> | null>;
  rpc: PlanProvisioningRpc;
}

export interface StepUpService {
  assertionOptions(input: {
    userId: string;
    challenge: string;
  }): Promise<unknown>;
  verifyAssertion(input: {
    userId: string;
    response: unknown;
    challengeAccepted: (signed: string) => boolean;
  }): Promise<void>;
}

export interface AuditInput {
  readonly action: string;
  readonly recordId: string | null;
  readonly outcome: "succeeded" | "failed" | "denied";
  readonly details: Record<string, unknown>;
}

export interface OnboardingConsoleDeps {
  /** Capability check with the caller's own session (has_internal_console_capability). */
  hasCapability(capability: string): Promise<boolean>;
  /** Throws unless the session is AAL2 (where MFA is required). */
  assertAal2(): void;
  store: OnboardingConsoleStore;
  stepUp: StepUpService;
  audit(entry: AuditInput): Promise<void>;
  nowMs(): number;
  newNonce?: () => string;
}

export class OnboardingConsoleError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OnboardingConsoleError";
  }
}

/* ───────────────────────────── view models ───────────────────────────── */

export interface QueueRow {
  readonly id: string;
  readonly orgName: string;
  readonly institutionType: string;
  readonly status: OnboardingRequestStatus;
  readonly source: string;
  readonly createdAt: string;
  readonly age: string;
  readonly assignedStaffId: string | null;
  readonly assignedStaffName: string | null;
  readonly assignedToMe: boolean;
}

export interface QueueView {
  readonly rows: readonly QueueRow[];
  readonly can: { readonly handle: boolean; readonly manage: boolean };
}

export interface AnswerView {
  readonly questionId: string;
  readonly promptKey: string | null;
  readonly dataClass: string | null;
  readonly value: Json;
}

export interface RequestDetailView {
  readonly id: string;
  readonly orgName: string;
  readonly institutionType: string;
  readonly state: string | null;
  readonly lga: string | null;
  readonly contact: {
    readonly name: string;
    readonly email: string;
    readonly phone: string | null;
    readonly role: string | null;
  };
  readonly note: string | null;
  readonly source: string;
  readonly status: OnboardingRequestStatus;
  readonly createdAt: string;
  readonly age: string;
  readonly assignedStaffName: string | null;
  readonly assignedToMe: boolean;
  readonly interview: {
    readonly graphVersion: string;
    readonly completionPct: number;
    readonly completed: boolean;
    readonly answers: readonly AnswerView[];
  } | null;
  readonly plan: {
    readonly generated: Json;
    readonly underReview: Json;
    readonly hash: string | null;
    readonly revision: number;
    readonly graphVersion: string | null;
    readonly editedByMe: boolean;
    readonly edited: boolean;
    readonly diff: readonly DiffView[];
    readonly issues: readonly string[];
  };
  readonly approval: {
    readonly approvedHash: string | null;
    readonly approvedByName: string | null;
    readonly approvedAt: string | null;
  };
  readonly provisioned: {
    readonly organizationId: string | null;
    readonly at: string | null;
    readonly appliedResult: Json;
  };
  readonly publishedPacks: readonly { code: string; version: string }[];
  readonly can: {
    readonly handle: boolean;
    readonly manage: boolean;
    readonly approve: boolean;
  };
}

/* ───────────────────────────── helpers ───────────────────────────── */

async function requireAny(deps: OnboardingConsoleDeps, caps: readonly string[]): Promise<void> {
  for (const c of caps) if (await deps.hasCapability(c)) return;
  throw new OnboardingConsoleError("not_authorized");
}

function statusOf(v: string): OnboardingRequestStatus {
  if (!isOnboardingRequestStatus(v)) throw new OnboardingConsoleError("unknown_status");
  return v;
}

function dbCode(error: { code?: string } | null): string {
  switch (error?.code) {
    case "42501":
      return "not_authorized";
    case "PT404":
      return "not_found";
    case "PT409":
      return "stale";
    case "22023":
      return "invalid_plan";
    default:
      return "unavailable";
  }
}

const QUESTIONS = new Map(FULL_REALITY_GRAPH.questions.map((q) => [q.id, q]));

function answerViews(answers: unknown): AnswerView[] {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return Object.keys(answers as Record<string, unknown>)
    .sort()
    .map((id) => {
      const q = QUESTIONS.get(id);
      return {
        questionId: id,
        promptKey: q?.promptKey ?? null,
        dataClass: q?.dataClass ?? null,
        value: json((answers as Record<string, unknown>)[id]),
      };
    });
}

function asGraphAnswers(answers: unknown): GraphAnswers {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  const out: Record<string, string | number | boolean | readonly string[]> = {};
  for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v as string[];
  }
  return out;
}

/* ───────────────────────────── queue ───────────────────────────── */

export async function loadQueue(
  ctx: ConsoleOnboardingContext,
  deps: OnboardingConsoleDeps,
): Promise<QueueView> {
  await requireAny(deps, [CAP_READ, CAP_MANAGE]);
  const rows = await deps.store.listRequests(200);
  const names = await deps.store.staffNames(
    [...new Set(rows.map((r) => r.assigned_staff).filter((x): x is string => !!x))],
  );
  const now = deps.nowMs();
  const view = sortQueue(
    rows
      .filter((r) => isOnboardingRequestStatus(r.status))
      .map((r) => ({
        id: r.id,
        orgName: r.org_name,
        institutionType: r.institution_type,
        status: r.status as OnboardingRequestStatus,
        source: r.source,
        createdAt: r.created_at,
        age: queueAge(r.created_at, now),
        assignedStaffId: r.assigned_staff,
        assignedStaffName: r.assigned_staff ? (names[r.assigned_staff] ?? "Staff member") : null,
        assignedToMe: r.assigned_staff === ctx.userId,
      })),
  );
  return {
    rows: view,
    can: {
      handle: await deps.hasCapability(CAP_HANDLE),
      manage: await deps.hasCapability(CAP_MANAGE),
    },
  };
}

export async function loadRequestDetail(
  ctx: ConsoleOnboardingContext,
  deps: OnboardingConsoleDeps,
  requestId: string,
): Promise<RequestDetailView> {
  await requireAny(deps, [CAP_READ, CAP_MANAGE]);
  const r = await deps.store.getRequest(requestId);
  if (!r) throw new OnboardingConsoleError("not_found");
  const [session, packs, applied] = await Promise.all([
    deps.store.latestSession(requestId),
    deps.store.publishedPacks(),
    r.status === "provisioned" ? deps.store.appliedResult(requestId) : Promise.resolve(null),
  ]);
  const names = await deps.store.staffNames(
    [r.assigned_staff, r.approved_by].filter((x): x is string => !!x),
  );
  const handle = await deps.hasCapability(CAP_HANDLE);
  const manage = await deps.hasCapability(CAP_MANAGE);
  const status = statusOf(r.status);
  const validation = r.review_plan ? validateOnboardingPlan(r.review_plan) : null;
  const issues = validation && !validation.ok ? [...validation.issues] : [];
  if (validation?.ok) {
    const pack = validation.plan.rolePack;
    if (!packs.some((p) => p.code === pack.code && p.version === pack.version))
      issues.push(`rolePack: ${pack.code}@${pack.version} is not a published institution pack`);
  }
  const editedByMe = r.plan_edited_by === ctx.userId;
  await deps.audit({
    action: "onboarding.request.view",
    recordId: r.id,
    outcome: "succeeded",
    details: { status },
  });
  return {
    id: r.id,
    orgName: r.org_name,
    institutionType: r.institution_type,
    state: r.state,
    lga: r.lga,
    contact: {
      name: r.contact_name,
      email: r.contact_email,
      phone: r.contact_phone,
      role: r.contact_role,
    },
    note: r.note,
    source: r.source,
    status,
    createdAt: r.created_at,
    age: queueAge(r.created_at, deps.nowMs()),
    assignedStaffName: r.assigned_staff ? (names[r.assigned_staff] ?? "Staff member") : null,
    assignedToMe: r.assigned_staff === ctx.userId,
    interview: session
      ? {
          graphVersion: session.graph_version,
          completionPct: session.completion_pct,
          completed: session.completed_at !== null,
          answers: answerViews(session.answers),
        }
      : null,
    plan: {
      generated: json(r.generated_plan ?? null),
      underReview: json(r.review_plan ?? null),
      hash: r.plan_hash,
      revision: r.plan_revision,
      graphVersion: r.plan_graph_version,
      editedByMe,
      edited: r.plan_edited_by !== null,
      diff:
        r.generated_plan && r.review_plan
          ? diffPlans(r.generated_plan, r.review_plan).map((d) => ({
              path: d.path,
              kind: d.kind,
              before: json(d.before),
              after: json(d.after),
            }))
          : [],
      issues,
    },
    approval: {
      approvedHash: r.approved_plan_hash,
      approvedByName: r.approved_by ? (names[r.approved_by] ?? "Staff member") : null,
      approvedAt: r.approved_at,
    },
    provisioned: {
      organizationId: r.provisioned_org_id,
      at: r.provisioned_at,
      appliedResult: json(applied),
    },
    publishedPacks: packs,
    can: {
      handle,
      manage,
      approve:
        manage &&
        !editedByMe &&
        r.plan_hash !== null &&
        issues.length === 0 &&
        (status === "plan_ready" || status === "under_review" || status === "approved"),
    },
  };
}

/* ───────────────────────────── staff actions ───────────────────────────── */

async function runAudited<T>(
  deps: OnboardingConsoleDeps,
  action: string,
  recordId: string,
  details: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    await deps.audit({ action, recordId, outcome: "succeeded", details });
    return result;
  } catch (err) {
    const code = err instanceof OnboardingConsoleError ? err.code : "unavailable";
    await deps.audit({
      action,
      recordId,
      outcome: code === "not_authorized" ? "denied" : "failed",
      details: { ...details, code },
    });
    throw err instanceof OnboardingConsoleError ? err : new OnboardingConsoleError(code);
  }
}

export async function assignToSelf(
  ctx: ConsoleOnboardingContext,
  deps: OnboardingConsoleDeps,
  requestId: string,
): Promise<{ assigned: true }> {
  return runAudited(deps, "onboarding.request.assign", requestId, {}, async () => {
    await requireAny(deps, [CAP_HANDLE, CAP_MANAGE]);
    const { error } = await deps.store.rpc("onboarding_review_assign", {
      p_request: requestId,
      p_actor: ctx.userId,
    });
    if (error) throw new OnboardingConsoleError(dbCode(error));
    return { assigned: true } as const;
  });
}

export interface PlanWriteResult {
  readonly planHash: string;
  readonly revision: number;
  readonly status: OnboardingRequestStatus;
}

function planWriteResult(data: unknown): PlanWriteResult {
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const hash = row?.plan_hash;
  const revision = row?.plan_revision;
  const status = row?.status;
  if (typeof hash !== "string" || typeof revision !== "number" || !isOnboardingRequestStatus(status))
    throw new OnboardingConsoleError("unavailable");
  return { planHash: hash, revision, status };
}

/** Generate the plan from the completed interview with the M5a generator and store it. */
export async function generateRequestPlan(
  ctx: ConsoleOnboardingContext,
  deps: OnboardingConsoleDeps,
  input: { requestId: string; expectedRevision: number },
): Promise<PlanWriteResult> {
  return runAudited(deps, "onboarding.plan.generate", input.requestId, {}, async () => {
    await requireAny(deps, [CAP_HANDLE]);
    const session = await deps.store.latestSession(input.requestId);
    if (!session || session.completed_at === null)
      throw new OnboardingConsoleError("interview_incomplete");
    const answers = asGraphAnswers(session.answers);
    const envelope = envelopePlan({
      graphId: FULL_REALITY_GRAPH.graphId,
      graphVersion: FULL_REALITY_GRAPH.version,
      answers,
      plan: generatePlan(answers),
    });
    const checked = validateOnboardingPlan(envelope.plan);
    if (!checked.ok) throw new OnboardingConsoleError("invalid_plan");
    const { data, error } = await deps.store.rpc("onboarding_review_set_plan", {
      p_request: input.requestId,
      p_actor: ctx.userId,
      p_kind: "generated",
      p_plan: checked.plan,
      p_graph_version: FULL_REALITY_GRAPH.version.slice(0, 32),
      p_expected_revision: input.expectedRevision,
    });
    if (error) throw new OnboardingConsoleError(dbCode(error));
    return planWriteResult(data);
  });
}

/** Store a staff edit of the plan, validated against the plan schema first. */
export async function saveRequestPlanEdit(
  ctx: ConsoleOnboardingContext,
  deps: OnboardingConsoleDeps,
  input: { requestId: string; expectedRevision: number; plan: unknown },
): Promise<PlanWriteResult | { readonly invalid: readonly string[] }> {
  const checked = validateOnboardingPlan(input.plan);
  if (!checked.ok) {
    await deps.audit({
      action: "onboarding.plan.edit",
      recordId: input.requestId,
      outcome: "failed",
      details: { code: "invalid_plan", issues: checked.issues.length },
    });
    return { invalid: checked.issues };
  }
  return runAudited(deps, "onboarding.plan.edit", input.requestId, {}, async () => {
    await requireAny(deps, [CAP_HANDLE]);
    const { data, error } = await deps.store.rpc("onboarding_review_set_plan", {
      p_request: input.requestId,
      p_actor: ctx.userId,
      p_kind: "edited",
      p_plan: checked.plan,
      p_graph_version: null,
      p_expected_revision: input.expectedRevision,
    });
    if (error) throw new OnboardingConsoleError(dbCode(error));
    return planWriteResult(data);
  });
}

function approvalBinding(ctx: ConsoleOnboardingContext, requestId: string, planHash: string, nonce: string) {
  return {
    userId: ctx.userId,
    approvalId: onboardingApprovalId(requestId),
    decision: "approve" as const,
    nonce,
    subjectDigest: planHash,
  };
}

/** Step 1 of approval: a WebAuthn challenge bound to this request and this plan hash. */
export async function beginPlanApproval(
  ctx: ConsoleOnboardingContext,
  deps: OnboardingConsoleDeps,
  input: { requestId: string; planHash: string },
): Promise<{ options: unknown; nonce: string }> {
  return runAudited(deps, "onboarding.approval.begin", input.requestId, { plan_hash: input.planHash }, async () => {
    await requireAny(deps, [CAP_MANAGE]);
    deps.assertAal2();
    if (!PLAN_HASH_PATTERN.test(input.planHash)) throw new OnboardingConsoleError("stale");
    const r = await deps.store.getRequest(input.requestId);
    if (!r) throw new OnboardingConsoleError("not_found");
    if (r.plan_hash !== input.planHash) throw new OnboardingConsoleError("stale");
    if (!["plan_ready", "under_review", "approved"].includes(r.status))
      throw new OnboardingConsoleError("not_awaiting_approval");
    if (r.plan_edited_by === ctx.userId) throw new OnboardingConsoleError("editor_cannot_approve");
    const nonce = (deps.newNonce ?? newStepUpNonce)();
    const options = await deps.stepUp.assertionOptions({
      userId: ctx.userId,
      challenge: stepUpChallenge(approvalBinding(ctx, input.requestId, input.planHash, nonce)),
    });
    return { options, nonce };
  });
}

export type ApproveAndProvisionResult =
  | {
      readonly ok: true;
      readonly replay: boolean;
      readonly organizationId: string;
      readonly appliedResult: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly code: PlanProvisioningFailureCode | "invalid_plan" };

/**
 * Step 2: verify the passkey assertion against the binding (a different request, decision or
 * plan hash yields a different challenge and is refused), record the approval, then provision
 * in one database transaction.
 */
export async function approveAndProvision(
  ctx: ConsoleOnboardingContext,
  deps: OnboardingConsoleDeps,
  input: { requestId: string; planHash: string; nonce: string; response: unknown },
): Promise<ApproveAndProvisionResult> {
  await runAudited(deps, "onboarding.approval.step_up", input.requestId, { plan_hash: input.planHash }, async () => {
    await requireAny(deps, [CAP_MANAGE]);
    deps.assertAal2();
    if (!PLAN_HASH_PATTERN.test(input.planHash)) throw new OnboardingConsoleError("stale");
    const binding = approvalBinding(ctx, input.requestId, input.planHash, input.nonce);
    try {
      await deps.stepUp.verifyAssertion({
        userId: ctx.userId,
        response: input.response,
        challengeAccepted: (signed) => stepUpChallengeMatches(signed, binding),
      });
    } catch {
      throw new OnboardingConsoleError("step_up_failed");
    }
  });

  await runAudited(deps, "onboarding.plan.approve", input.requestId, { plan_hash: input.planHash }, async () => {
    const { error } = await deps.store.rpc("onboarding_review_approve", {
      p_request: input.requestId,
      p_actor: ctx.userId,
      p_expected_plan_hash: input.planHash,
      p_step_up_verified: true,
    });
    if (error) throw new OnboardingConsoleError(dbCode(error));
  });

  const r = await deps.store.getRequest(input.requestId);
  if (!r) return { ok: false, code: "not_found" };
  let plan: ValidatedOnboardingPlan | null = null;
  if (r.review_plan) {
    const checked = validateOnboardingPlan(r.review_plan);
    if (checked.ok) plan = checked.plan;
  }
  if (!plan && r.status !== "provisioned") {
    await deps.audit({
      action: "onboarding.provision",
      recordId: input.requestId,
      outcome: "failed",
      details: { code: "invalid_plan" },
    });
    return { ok: false, code: "invalid_plan" };
  }
  const websiteDraft = plan
    ? buildWebsiteDraft(
        {
          orgName: r.org_name,
          slugHint: "draft",
          contactEmail: r.contact_email,
          contactPhone: r.contact_phone,
          state: r.state,
        },
        plan,
      )
    : null;
  const outcome = await provisionApprovedPlan(deps.store.rpc, {
    requestId: input.requestId,
    actorId: ctx.userId,
    expectedPlanHash: input.planHash,
    websiteDraft: websiteDraft as unknown as Record<string, unknown> | null,
  });
  await deps.audit({
    action: "onboarding.provision",
    recordId: input.requestId,
    outcome: outcome.ok ? "succeeded" : outcome.code === "not_allowed" ? "denied" : "failed",
    details: outcome.ok
      ? { organization_id: outcome.organizationId, replay: outcome.replay, plan_hash: input.planHash }
      : { code: outcome.code, plan_hash: input.planHash },
  });
  return outcome;
}

/* ───────────────────────────── Supabase adapter ───────────────────────────── */

type Query = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> & {
  select(c: string): Query;
  eq(c: string, v: unknown): Query;
  in(c: string, v: readonly unknown[]): Query;
  order(c: string, o: { ascending: boolean; nullsFirst?: boolean }): Query;
  limit(n: number): Query;
  maybeSingle(): Query;
};
type AdminClient = {
  from(table: string): Query;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
};

const REQUEST_COLUMNS =
  "id, org_name, institution_type, state, lga, contact_name, contact_email, contact_phone, contact_role, note, source, status, assigned_staff, created_at, updated_at, generated_plan, review_plan, plan_hash, plan_revision, plan_graph_version, plan_edited_by, approved_plan_hash, approved_by, approved_at, provisioned_org_id, provisioned_at";

function must<T>(r: { data: unknown; error: unknown }): T {
  if (r.error) throw new OnboardingConsoleError("unavailable");
  return r.data as T;
}

export function supabaseOnboardingStore(admin: AdminClient): OnboardingConsoleStore {
  return {
    async listRequests(limit) {
      return (
        must<RequestRow[] | null>(
          await admin
            .from("onboarding_requests")
            .select(REQUEST_COLUMNS)
            .order("created_at", { ascending: true })
            .limit(limit),
        ) ?? []
      );
    },
    async getRequest(id) {
      return must<RequestRow | null>(
        await admin.from("onboarding_requests").select(REQUEST_COLUMNS).eq("id", id).maybeSingle(),
      );
    },
    async latestSession(requestId) {
      const rows =
        must<SessionRow[] | null>(
          await admin
            .from("reality_interview_sessions")
            .select("graph_version, answers, completion_pct, completed_at")
            .eq("request_id", requestId)
            .order("updated_at", { ascending: false })
            .limit(1),
        ) ?? [];
      return rows[0] ?? null;
    },
    async staffNames(ids) {
      if (ids.length === 0) return {};
      const rows =
        must<{ id: string; full_name: string }[] | null>(
          await admin.from("platform_staff").select("id, full_name").in("id", ids),
        ) ?? [];
      return Object.fromEntries(rows.map((r) => [r.id, r.full_name]));
    },
    async publishedPacks() {
      const rows =
        must<{ code: string; version: string }[] | null>(
          await admin
            .from("cg_role_pack")
            .select("code, version")
            .eq("kind", "institution_pack")
            .eq("status", "published"),
        ) ?? [];
      return rows;
    },
    async appliedResult(requestId) {
      const row = must<{ applied_result: Record<string, unknown> | null } | null>(
        await admin
          .from("onboarding_sessions")
          .select("applied_result")
          .eq("onboarding_request_id", requestId)
          .maybeSingle(),
      );
      return row?.applied_result ?? null;
    },
    rpc: (fn, args) => admin.rpc(fn, args),
  };
}
