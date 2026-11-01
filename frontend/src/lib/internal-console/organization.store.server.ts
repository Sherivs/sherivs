/**
 * Server-only Organization Lifecycle Engine.
 * Not imported from client components.
 */
import { isMissingRelation, store } from "./store";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { assertInternalAal2 } from "@/lib/security/mfa-server";
import { assertConsoleCapability, hasConsoleCapability } from "./console-access.server";
import {
  ORGANIZATION_ACCESS_EFFECTS,
  ORGANIZATION_ONBOARDING_STEPS,
  canTransitionOrganization,
  currentOnboardingStep,
  isOrganizationLifecycleState,
  medianHours,
  organizationQuestionnaireSchema,
  questionnaireReady,
  slugifyOrganizationName,
  summarizeOrganizationStates,
  type OrganizationAssignmentRecord,
  type OrganizationAssignmentType,
  type OrganizationDetail,
  type OrganizationDirectoryRow,
  type OrganizationDraft,
  type OrganizationLifecycleState,
  type OrganizationMetricsSnapshot,
  type OrganizationOnboardingStep,
} from "./organization-lifecycle";

const timeAuthority = new TimeAuthority(new SystemClock());

type Admin = Awaited<ReturnType<typeof admin>>;

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type Ctx = {
  supabase: { rpc: RpcClient["rpc"] };
  claims: { exp: number; aal?: unknown };
  userId: string;
};

type OrgRow = {
  id: string;
  school_id: string | null;
  slug: string | null;
  display_name: string;
  legal_name: string | null;
  org_type: "school";
  country: string | null;
  region: string | null;
  city: string | null;
  lifecycle_state: string;
  questionnaire: OrganizationDraft;
  questionnaire_step: string;
  intended_runtime: "scholar";
  enabled_runtime: "scholar" | null;
  provisioning_error: string | null;
  outstanding_requirements: unknown;
  created_by: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  activated_by: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  provisioned_at: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  deactivated_at: string | null;
};

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertStaff(context: Ctx) {
  const { data, error } = await (context.supabase as unknown as RpcClient).rpc("is_platform_staff");
  if (error || data !== true) throw new Error("Not authorized");
}

async function assertCapability(
  context: Ctx,
  capability: string,
  aal2 = false,
  platformOperationsAction?: string,
): Promise<boolean> {
  if (aal2) assertInternalAal2(context.claims);
  return assertConsoleCapability(context, capability, platformOperationsAction);
}

async function audit(
  context: Ctx,
  action: string,
  recordId: string | null,
  details: Record<string, unknown>,
  outcome: "succeeded" | "failed" = "succeeded",
) {
  await writeAuditRecord(await admin(), {
    action: `platform_organization.${action}`,
    gate: "has_internal_console_capability:platform.tenants.manage",
    tenantId: null,
    actorId: context.userId,
    table: "platform_organization",
    recordId,
    outcome,
    details,
  });
}

function asState(value: string): OrganizationLifecycleState {
  if (!isOrganizationLifecycleState(value)) throw new Error("Unknown organization state.");
  return value;
}

function asStep(value: string): OrganizationOnboardingStep {
  return ORGANIZATION_ONBOARDING_STEPS.includes(value as OrganizationOnboardingStep)
    ? (value as OrganizationOnboardingStep)
    : "identity";
}

function requirementList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function directoryRow(
  row: OrgRow,
  ownerName: string | null,
  assignmentCount: number,
): OrganizationDirectoryRow {
  return {
    id: row.id,
    displayName: row.display_name,
    orgType: row.org_type,
    lifecycleState: asState(row.lifecycle_state),
    country: row.country,
    region: row.region,
    city: row.city,
    intendedRuntime: row.intended_runtime,
    enabledRuntime: row.enabled_runtime,
    schoolId: row.school_id,
    slug: row.slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    provisionedAt: row.provisioned_at,
    activatedAt: row.activated_at,
    onboardingOwnerName: ownerName,
    assignmentCount,
  };
}

function contactFrom(draft: OrganizationDraft) {
  if (!draft.contactName && !draft.contactEmail) return null;
  return {
    name: draft.contactName ?? null,
    email: draft.contactEmail ?? null,
    phone: draft.contactPhone ?? null,
    title: draft.contactTitle ?? null,
    method: draft.contactMethod ?? null,
  };
}

const OPERATIONS_ORG_COLUMNS =
  "id, school_id, slug, display_name, org_type, country, region, city, lifecycle_state, questionnaire_step, intended_runtime, enabled_runtime, outstanding_requirements, created_by, submitted_by, reviewed_by, activated_by, created_at, updated_at, submitted_at, provisioned_at, activated_at, suspended_at, deactivated_at";

async function loadOrg(db: Admin, id: string, operationsSummary = false): Promise<OrgRow> {
  const { data, error } = await store(db)
    .from("platform_organization")
    .select(operationsSummary ? OPERATIONS_ORG_COLUMNS : "*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingRelation(error)) throw new Error("Organization store is not configured.");
    throw new Error(error.message);
  }
  if (!data) throw new Error("Organization not found.");
  return data as OrgRow;
}

async function recordTransition(
  db: Admin,
  organizationId: string,
  fromState: OrganizationLifecycleState | null,
  toState: OrganizationLifecycleState,
  actorId: string,
  reason: string | null,
) {
  const { error } = await store(db).from("platform_organization_transition").insert({
    organization_id: organizationId,
    from_state: fromState,
    to_state: toState,
    actor_id: actorId,
    reason,
  });
  if (error && !isMissingRelation(error)) throw new Error(error.message);
}

async function applyState(
  db: Admin,
  context: Ctx,
  row: OrgRow,
  toState: OrganizationLifecycleState,
  patch: Record<string, unknown>,
  reason: string,
) {
  const from = asState(row.lifecycle_state);
  if (!canTransitionOrganization(from, toState)) {
    throw new Error(`Cannot change organization state from ${from} to ${toState}.`);
  }
  const now = timeAuthority.now().at;
  const { error } = await store(db)
    .from("platform_organization")
    .update({
      ...patch,
      lifecycle_state: toState,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("lifecycle_state", from);
  if (error) throw new Error(error.message);
  await recordTransition(db, row.id, from, toState, context.userId, reason);
  await audit(context, `state.${toState}`, row.id, { from, to: toState, reason });
}

async function assignmentsFor(
  db: Admin,
  organizationIds: string[],
): Promise<Map<string, OrganizationAssignmentRecord[]>> {
  const out = new Map<string, OrganizationAssignmentRecord[]>();
  if (!organizationIds.length) return out;
  const { data, error } = await store(db)
    .from("platform_organization_assignment")
    .select(
      "id, organization_id, staff_id, assignment_type, status, assigned_by, assigned_at, released_at",
    )
    .in("organization_id", organizationIds);
  if (error) {
    if (isMissingRelation(error)) return out;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{
    id: string;
    organization_id: string;
    staff_id: string;
    assignment_type: OrganizationAssignmentType;
    status: "active" | "released";
    assigned_by: string | null;
    assigned_at: string;
    released_at: string | null;
  }>;
  const staffIds = [...new Set(rows.map((row) => row.staff_id))];
  const names = new Map<string, string>();
  if (staffIds.length) {
    const { data: staff } = await db
      .from("platform_staff")
      .select("id, full_name, email")
      .in("id", staffIds);
    for (const person of staff ?? []) names.set(person.id, person.full_name || person.email);
  }
  for (const row of rows) {
    const list = out.get(row.organization_id) ?? [];
    list.push({
      id: row.id,
      organizationId: row.organization_id,
      staffId: row.staff_id,
      staffName: names.get(row.staff_id) ?? null,
      assignmentType: row.assignment_type,
      status: row.status,
      assignedBy: row.assigned_by,
      assignedAt: row.assigned_at,
      releasedAt: row.released_at,
    });
    out.set(row.organization_id, list);
  }
  return out;
}

export async function loadOrganizationMetrics(
  db: Admin,
  scope?: {
    organizationIds?: string[];
    includePlatformMetrics?: boolean;
    operationsSummary?: boolean;
  },
): Promise<{
  organizationMetrics: OrganizationMetricsSnapshot;
  scholarTenants: number | null;
  registeredUsers: number | null;
  activeUsers30d: number | null;
  rows: OrgRow[];
}> {
  const empty: OrganizationMetricsSnapshot = {
    available: false,
    source: "platform_organization not configured",
    total: null,
    active: null,
    onboarding: null,
    suspended: null,
    failedProvisioning: null,
    submitted: null,
    conversionRate: null,
    medianOnboardingHours: null,
  };
  let request = store(db)
    .from("platform_organization")
    .select(scope?.operationsSummary ? OPERATIONS_ORG_COLUMNS : "*");
  if (scope) {
    if (scope.organizationIds) {
      request =
        scope.organizationIds.length > 0
          ? request.in("id", scope.organizationIds)
          : request.limit(0);
    }
  }
  const { data, error } = await request.order("updated_at", { ascending: false }).limit(500);
  if (error) {
    if (isMissingRelation(error)) {
      return {
        organizationMetrics: empty,
        scholarTenants: null,
        registeredUsers: null,
        activeUsers30d: null,
        rows: [],
      };
    }
    throw new Error(error.message);
  }
  const rows = (data ?? []) as OrgRow[];
  const summary = summarizeOrganizationStates(rows.map((row) => asState(row.lifecycle_state)));
  const durations = rows
    .filter((row) => row.submitted_at && row.activated_at)
    .map((row) => (Date.parse(row.activated_at ?? "") - Date.parse(row.submitted_at ?? "")) / 36e5)
    .filter((value) => Number.isFinite(value) && value >= 0);
  let scholarTenants: number | null = null;
  let registeredUsers: number | null = null;
  let activeUsers30d: number | null = null;
  if (!scope || scope.includePlatformMetrics !== false) {
    const metrics = await store(db).rpc("platform_control_plane_metrics");
    if (!metrics.error && metrics.data && typeof metrics.data === "object") {
      const payload = metrics.data as Record<string, unknown>;
      scholarTenants = typeof payload.schools_total === "number" ? payload.schools_total : null;
      registeredUsers =
        typeof payload.registered_users === "number" ? payload.registered_users : null;
      activeUsers30d =
        typeof payload.active_users_30d === "number" ? payload.active_users_30d : null;
    }
  }
  return {
    organizationMetrics: {
      available: true,
      source: "platform_organization",
      ...summary,
      medianOnboardingHours: medianHours(durations),
    },
    scholarTenants,
    registeredUsers,
    activeUsers30d,
    rows,
  };
}

export async function loadAssignedSupportOrganizationIds(
  db: Admin,
  userId: string,
): Promise<string[]> {
  const { data, error } = await store(db)
    .from("platform_organization_assignment")
    .select("organization_id")
    .eq("staff_id", userId)
    .eq("assignment_type", "support")
    .eq("status", "active");
  if (error) {
    if (isMissingRelation(error)) return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{ organization_id: string }>;
  return [...new Set(rows.map((row) => row.organization_id))];
}

export async function listOrganizationDirectory(
  context: Ctx,
  input: { query?: string; state?: string },
): Promise<{
  organizations: OrganizationDirectoryRow[];
  store: "database";
  metrics: OrganizationMetricsSnapshot;
}> {
  await assertStaff(context);
  let operationsSummary = false;
  if (
    await hasConsoleCapability(context, "platform.operations.read", "organization.summary.read")
  ) {
    operationsSummary = await assertCapability(
      context,
      "platform.operations.read",
      false,
      "organization.summary.read",
    );
  } else {
    await assertCapability(context, "platform.tenants.read");
  }
  const db = await admin();
  const supportOnly =
    (await hasConsoleCapability(context, "platform.support.handle")) &&
    !(await hasConsoleCapability(context, "platform.tenants.manage"));
  const organizationIds = supportOnly
    ? await loadAssignedSupportOrganizationIds(db, context.userId)
    : undefined;
  const { rows, organizationMetrics } = await loadOrganizationMetrics(
    db,
    supportOnly
      ? { organizationIds, includePlatformMetrics: false }
      : operationsSummary
        ? { operationsSummary: true }
        : undefined,
  );
  const assignments = await assignmentsFor(
    db,
    rows.map((row) => row.id),
  );
  const query = (input.query ?? "").trim().toLowerCase();
  const organizations = rows
    .filter((row) => (input.state ? row.lifecycle_state === input.state : true))
    .filter((row) =>
      query
        ? `${row.display_name} ${row.country ?? ""} ${row.city ?? ""} ${row.lifecycle_state}`
            .toLowerCase()
            .includes(query)
        : true,
    )
    .map((row) => {
      const assigned = assignments.get(row.id) ?? [];
      const owner = assigned.find(
        (item) => item.assignmentType === "onboarding_owner" && item.status === "active",
      );
      return directoryRow(
        row,
        owner?.staffName ?? null,
        assigned.filter((item) => item.status === "active").length,
      );
    });
  return { organizations, store: "database", metrics: organizationMetrics };
}

export async function getOrganizationDetail(context: Ctx, id: string): Promise<OrganizationDetail> {
  await assertStaff(context);
  const operationsSummary = await hasConsoleCapability(
    context,
    "platform.operations.read",
    "organization.summary.read",
  );
  if (!operationsSummary) await assertCapability(context, "platform.tenants.read");
  const db = await admin();
  const supportOnly =
    (await hasConsoleCapability(context, "platform.support.handle")) &&
    !(await hasConsoleCapability(context, "platform.tenants.manage"));
  if (supportOnly && !(await loadAssignedSupportOrganizationIds(db, context.userId)).includes(id)) {
    throw new Error("Organization not found.");
  }
  const row = await loadOrg(db, id, operationsSummary);
  const assigned = (await assignmentsFor(db, [id])).get(id) ?? [];
  const owner = assigned.find(
    (item) => item.assignmentType === "onboarding_owner" && item.status === "active",
  );
  const canSeeContact =
    context.userId === row.created_by ||
    assigned.some((item) => item.staffId === context.userId && item.status === "active");
  let privileged = canSeeContact;
  if (!privileged) {
    privileged = await hasConsoleCapability(context, "platform.tenants.manage");
  }
  const { data: transitions } = await store(db)
    .from("platform_organization_transition")
    .select(
      operationsSummary
        ? "id, from_state, to_state, created_at"
        : "id, from_state, to_state, actor_id, reason, created_at",
    )
    .eq("organization_id", id)
    .order("created_at", { ascending: false })
    .limit(40);
  const state = asState(row.lifecycle_state);
  return {
    ...directoryRow(
      row,
      owner?.staffName ?? null,
      assigned.filter((item) => item.status === "active").length,
    ),
    legalName: operationsSummary ? null : row.legal_name,
    questionnaire: operationsSummary ? {} : (row.questionnaire ?? {}),
    questionnaireStep: asStep(row.questionnaire_step),
    provisioningError: operationsSummary ? null : row.provisioning_error,
    outstandingRequirements: requirementList(row.outstanding_requirements),
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    activatedBy: row.activated_by,
    contact: !operationsSummary && privileged ? contactFrom(row.questionnaire ?? {}) : null,
    assignments: assigned,
    transitions: (
      (transitions ?? []) as Array<{
        id: string;
        from_state: string | null;
        to_state: string;
        actor_id: string | null;
        reason: string | null;
        created_at: string;
      }>
    ).map((item) => ({
      id: item.id,
      fromState:
        item.from_state && isOrganizationLifecycleState(item.from_state) ? item.from_state : null,
      toState: asState(item.to_state),
      actorId: operationsSummary ? null : item.actor_id,
      reason: operationsSummary ? null : item.reason,
      at: item.created_at,
    })),
    accessEffects:
      state === "suspended"
        ? ORGANIZATION_ACCESS_EFFECTS.suspend
        : state === "deactivated"
          ? ORGANIZATION_ACCESS_EFFECTS.deactivate
          : state === "active"
            ? ORGANIZATION_ACCESS_EFFECTS.activate
            : state === "ready_for_activation" ||
                state === "provisioning" ||
                state === "provisioning_failed"
              ? ORGANIZATION_ACCESS_EFFECTS.provision
              : null,
  };
}

function questionnairePatch(draft: OrganizationDraft) {
  const step = currentOnboardingStep(draft);
  return {
    display_name: draft.displayName?.trim() || "Untitled organization",
    legal_name: draft.legalName?.trim() || null,
    org_type: draft.orgType ?? "school",
    country: draft.country?.trim() || null,
    region: draft.region?.trim() || null,
    city: draft.city?.trim() || null,
    intended_runtime: draft.intendedRuntime ?? "scholar",
    questionnaire: draft,
    questionnaire_step: step,
  };
}

export async function saveOrganizationDraft(
  context: Ctx,
  input: { id?: string; draft: OrganizationDraft },
): Promise<{ id: string }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  const now = timeAuthority.now().at;
  const patch = questionnairePatch(input.draft);
  if (input.id) {
    const row = await loadOrg(db, input.id);
    if (row.lifecycle_state !== "draft" && row.lifecycle_state !== "submitted") {
      throw new Error("Only draft or returned submissions can be edited.");
    }
    const { error } = await store(db)
      .from("platform_organization")
      .update({ ...patch, updated_at: now })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    await audit(context, "draft.save", input.id, { step: patch.questionnaire_step });
    return { id: input.id };
  }
  const { data, error } = await store(db)
    .from("platform_organization")
    .insert({
      ...patch,
      lifecycle_state: "draft",
      created_by: context.userId,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingRelation(error)) throw new Error("Organization store is not configured.");
    throw new Error(error.message);
  }
  const id = (data as { id: string }).id;
  await recordTransition(db, id, null, "draft", context.userId, "created");
  await audit(context, "create", id, { displayName: patch.display_name });
  return { id };
}

export async function submitOrganization(context: Ctx, id: string): Promise<{ id: string }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  const row = await loadOrg(db, id);
  const parsed = organizationQuestionnaireSchema.safeParse(row.questionnaire);
  if (!parsed.success || !questionnaireReady(row.questionnaire)) {
    throw new Error("Complete the required onboarding steps before submitting.");
  }
  const from = asState(row.lifecycle_state);
  if (from !== "draft" && from !== "submitted") {
    throw new Error("Only a draft can be submitted.");
  }
  const now = timeAuthority.now().at;
  if (from === "draft") {
    await applyState(
      db,
      context,
      row,
      "submitted",
      {
        submitted_by: context.userId,
        submitted_at: now,
        questionnaire_step: "review",
        slug: row.slug ?? slugifyOrganizationName(row.display_name),
      },
      "submitted",
    );
  } else {
    const { error } = await store(db)
      .from("platform_organization")
      .update({ updated_at: now, questionnaire_step: "review" })
      .eq("id", id);
    if (error) throw new Error(error.message);
    await audit(context, "submit", id, { alreadySubmitted: true });
  }
  return { id };
}

export async function transitionOrganization(
  context: Ctx,
  input: { id: string; toState: OrganizationLifecycleState; reason?: string },
): Promise<{ id: string; state: OrganizationLifecycleState }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  const row = await loadOrg(db, input.id);
  const now = timeAuthority.now().at;
  const extra: Record<string, unknown> = {};
  if (input.toState === "under_review") {
    extra.reviewed_by = context.userId;
    extra.reviewed_at = now;
  }
  if (input.toState === "submitted") extra.reviewed_at = now;
  await applyState(db, context, row, input.toState, extra, input.reason ?? input.toState);
  return { id: input.id, state: input.toState };
}

async function uniqueSchoolSlug(db: Admin, base: string): Promise<string> {
  let slug = slugifyOrganizationName(base);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data, error } = await db.from("schools").select("id").eq("slug", slug).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
    slug = slugifyOrganizationName(`${base}-${attempt + 2}`);
  }
  return slugifyOrganizationName(`${base}-${contextSlice()}`);
}

async function provisionSchoolForOrganization(
  db: Admin,
  organization: OrgRow,
  slug: string,
): Promise<string> {
  const { data, error } = await store(db).rpc("provision_platform_organization_school", {
    p_organization_id: organization.id,
    p_school_slug: slug,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("School provisioning returned no school id.");
  return data;
}

function contextSlice(): string {
  return timeAuthority.now().atMs.toString(36).slice(-6);
}

export async function provisionOrganizationCase(
  context: Ctx,
  id: string,
): Promise<{ id: string; schoolId: string; state: OrganizationLifecycleState }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  let row = await loadOrg(db, id);
  const from = asState(row.lifecycle_state);
  if (
    from === "under_review" ||
    from === "provisioning_failed" ||
    from === "ready_for_activation"
  ) {
    await applyState(db, context, row, "provisioning", { provisioning_error: null }, "provision");
    row = await loadOrg(db, id);
  } else if (from !== "provisioning") {
    throw new Error("Provisioning can start only after review.");
  }

  try {
    let schoolId = row.school_id;
    if (!schoolId) {
      const slug = row.slug ?? (await uniqueSchoolSlug(db, row.display_name));
      try {
        schoolId = await provisionSchoolForOrganization(db, row, slug);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/duplicate|unique/i.test(message)) throw error;
        const retrySlug = await uniqueSchoolSlug(db, `${row.display_name}-org`);
        schoolId = await provisionSchoolForOrganization(db, row, retrySlug);
      }
    }
    const now = timeAuthority.now().at;
    const { error: updateErr } = await store(db)
      .from("platform_organization")
      .update({
        slug: row.slug ?? slugifyOrganizationName(row.display_name),
        enabled_runtime: "scholar",
        provisioned_at: row.provisioned_at ?? now,
        provisioning_error: null,
        outstanding_requirements: ["invite_organization_administrator"],
        updated_at: now,
      })
      .eq("id", id);
    if (updateErr) throw new Error(updateErr.message);
    row = await loadOrg(db, id);
    await applyState(
      db,
      context,
      row,
      "ready_for_activation",
      { provisioning_error: null },
      "provisioned",
    );
    await audit(context, "provision", id, { schoolId, runtime: "scholar" });
    return { id, schoolId: schoolId as string, state: "ready_for_activation" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provisioning failed";
    const failed = await loadOrg(db, id);
    if (asState(failed.lifecycle_state) === "provisioning") {
      await applyState(
        db,
        context,
        failed,
        "provisioning_failed",
        { provisioning_error: message.slice(0, 400) },
        "provisioning failed",
      );
    }
    await audit(context, "provision", id, { error: message.slice(0, 200) }, "failed");
    throw new Error(message);
  }
}

export async function activateOrganization(context: Ctx, id: string): Promise<{ id: string }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  const row = await loadOrg(db, id);
  if (!row.school_id) throw new Error("Provisioning is not complete.");
  const now = timeAuthority.now().at;
  const { error: schoolErr } = await db
    .from("schools")
    .update({
      is_active: true,
      subscription_status: "active",
      updated_at: now,
    })
    .eq("id", row.school_id);
  if (schoolErr) throw new Error(schoolErr.message);
  await applyState(
    db,
    context,
    row,
    "active",
    { activated_by: context.userId, activated_at: now, enabled_runtime: "scholar" },
    "activated",
  );
  return { id };
}

export async function suspendOrganization(context: Ctx, id: string): Promise<{ id: string }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  const row = await loadOrg(db, id);
  const now = timeAuthority.now().at;
  if (row.school_id) {
    const { error } = await db
      .from("schools")
      .update({ is_active: false, subscription_status: "suspended", updated_at: now })
      .eq("id", row.school_id);
    if (error) throw new Error(error.message);
  }
  await applyState(db, context, row, "suspended", { suspended_at: now }, "suspended");
  return { id };
}

export async function restoreOrganization(context: Ctx, id: string): Promise<{ id: string }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  const row = await loadOrg(db, id);
  const now = timeAuthority.now().at;
  if (row.school_id) {
    const { error } = await db
      .from("schools")
      .update({ is_active: true, subscription_status: "active", updated_at: now })
      .eq("id", row.school_id);
    if (error) throw new Error(error.message);
  }
  await applyState(db, context, row, "active", { suspended_at: null }, "restored");
  return { id };
}

export async function deactivateOrganization(context: Ctx, id: string): Promise<{ id: string }> {
  await assertCapability(context, "platform.tenants.manage", true);
  const db = await admin();
  const row = await loadOrg(db, id);
  const now = timeAuthority.now().at;
  if (row.school_id) {
    const { error } = await db
      .from("schools")
      .update({ is_active: false, updated_at: now })
      .eq("id", row.school_id);
    if (error) throw new Error(error.message);
  }
  await applyState(
    db,
    context,
    row,
    "deactivated",
    { deactivated_at: now, enabled_runtime: null },
    "deactivated",
  );
  return { id };
}

export async function assignOrganizationStaff(
  context: Ctx,
  input: { organizationId: string; staffId: string; assignmentType: OrganizationAssignmentType },
): Promise<{ id: string }> {
  const operationsActor = await hasConsoleCapability(
    context,
    "platform.operations.assign",
    "organization.assign_operations",
  );
  if (operationsActor) {
    if (input.assignmentType !== "operations") throw new Error("Not authorized");
    await assertCapability(
      context,
      "platform.operations.assign",
      true,
      "organization.assign_operations",
    );
  } else {
    await assertCapability(context, "platform.tenants.manage", true);
  }
  const db = await admin();
  await loadOrg(db, input.organizationId);
  const { data: staff, error: staffErr } = await db
    .from("platform_staff")
    .select("id, status")
    .eq("id", input.staffId)
    .maybeSingle();
  if (staffErr) throw new Error(staffErr.message);
  if (!staff || staff.status !== "active") throw new Error("Only active staff can be assigned.");
  if (input.assignmentType === "onboarding_owner") {
    const { error: releaseErr } = await store(db)
      .from("platform_organization_assignment")
      .update({
        status: "released",
        released_at: timeAuthority.now().at,
        released_by: context.userId,
      })
      .eq("organization_id", input.organizationId)
      .eq("assignment_type", "onboarding_owner")
      .eq("status", "active");
    if (releaseErr && !isMissingRelation(releaseErr)) throw new Error(releaseErr.message);
  }
  const { data, error } = await store(db)
    .from("platform_organization_assignment")
    .insert({
      organization_id: input.organizationId,
      staff_id: input.staffId,
      assignment_type: input.assignmentType,
      status: "active",
      assigned_by: context.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await audit(context, "assign", input.organizationId, {
    staffId: input.staffId,
    assignmentType: input.assignmentType,
  });
  return { id: (data as { id: string }).id };
}

export async function releaseOrganizationAssignment(
  context: Ctx,
  assignmentId: string,
): Promise<{ ok: true }> {
  const db = await admin();
  const operationsActor = await hasConsoleCapability(
    context,
    "platform.operations.assign",
    "organization.assign_operations",
  );
  if (operationsActor) {
    const { data: assignment, error: assignmentError } = await store(db)
      .from("platform_organization_assignment")
      .select("assignment_type")
      .eq("id", assignmentId)
      .eq("status", "active")
      .maybeSingle();
    if (assignmentError) throw new Error(assignmentError.message);
    if (
      !(assignment as { assignment_type?: string } | null) ||
      (assignment as { assignment_type?: string }).assignment_type !== "operations"
    ) {
      throw new Error("Assignment not found.");
    }
    await assertCapability(
      context,
      "platform.operations.assign",
      true,
      "organization.assign_operations",
    );
  } else {
    await assertCapability(context, "platform.tenants.manage", true);
  }
  const { data, error } = await store(db)
    .from("platform_organization_assignment")
    .update({
      status: "released",
      released_at: timeAuthority.now().at,
      released_by: context.userId,
    })
    .eq("id", assignmentId)
    .eq("status", "active")
    .select("id, organization_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { id: string; organization_id: string } | null;
  if (!row) throw new Error("Assignment not found.");
  await audit(context, "assignment.release", row.organization_id, { assignmentId });
  return { ok: true };
}

export async function loadViewerAssignments(
  db: Admin,
  userId: string,
): Promise<OrganizationAssignmentRecord[]> {
  const { data, error } = await store(db)
    .from("platform_organization_assignment")
    .select(
      "id, organization_id, staff_id, assignment_type, status, assigned_by, assigned_at, released_at",
    )
    .eq("staff_id", userId)
    .eq("status", "active");
  if (error) {
    if (isMissingRelation(error)) return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{
    id: string;
    organization_id: string;
    staff_id: string;
    assignment_type: OrganizationAssignmentType;
    status: "active" | "released";
    assigned_by: string | null;
    assigned_at: string;
    released_at: string | null;
  }>;
  if (!rows.length) return [];
  const orgIds = rows.map((row) => row.organization_id);
  const { data: orgs } = await store(db)
    .from("platform_organization")
    .select("id, display_name")
    .in("id", orgIds);
  const names = new Map(
    ((orgs ?? []) as Array<{ id: string; display_name: string }>).map((row) => [
      row.id,
      row.display_name,
    ]),
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    staffId: row.staff_id,
    staffName: names.get(row.organization_id) ?? null,
    assignmentType: row.assignment_type,
    status: row.status,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
    releasedAt: row.released_at,
  }));
}
