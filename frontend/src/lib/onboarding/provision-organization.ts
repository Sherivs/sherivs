/**
 * Sherivs — V1-008: the neutral organization-provisioning engine.
 *
 * Given a Zod-validated organization request and a registered
 * DomainProvisioningContribution, provisions — as ONE transactional unit —
 * the organization record, its workspaces, its people's identities and
 * memberships, and the domain's auxiliary records, resolving every person
 * role against the platform's two role vocabularies:
 *
 *   - neutral core roles (`rbac/neutral-roles.ts`), and
 *   - domain-configured role contributions (grants resolved through
 *     `rbac/domain-contribution.ts`'s combined table).
 *
 * TRANSACTIONALITY (AGENTS.md §28): PostgREST exposes no multi-statement
 * transaction from the JS client, so the engine executes its writes
 * sequentially under a compensation ledger — every created record is
 * undoable, and any step failure rolls the unit back in reverse order
 * (records deleted by id, provisioned auth accounts deleted) before
 * reporting a failure that names the failed step. Residual gap (reported in
 * progress/v1-wave/V1-008-report.md): native atomicity requires a Postgres
 * function/RPC; the ledger is the application-level enforcement.
 *
 * ROLE RESOLUTION is fail-closed BEFORE any write: an unresolvable request
 * role, a domain-contributed platform role without registered grants, a
 * duplicate person email, or a violation of the contribution's
 * peopleRequireAuthAccounts flag aborts the unit with zero substrate writes.
 *
 * Cross-domain isolation: a person role resolves ONLY through the requested
 * domain's own contribution vocabulary — a role registered by another domain
 * can never enter this unit (the provisioning registry additionally rejects
 * two domains claiming the same domain-contributed platform role).
 *
 * Boundary: isomorphic, vendor-agnostic. The Supabase admin client is
 * narrowed onto the structural contracts at the server boundary.
 */
import type { Permission } from "@/lib/identity";
import { NEUTRAL_ROLE_PERMISSIONS, isNeutralCoreRole } from "@/lib/rbac/neutral-roles";
import { resolveRoleGrants } from "@/lib/rbac/domain-contribution";
import { generateInitialPassword } from "./generated-credentials";
import type {
  DomainProvisioningContribution,
  ProvisioningContext,
  ResolvedPersonRole,
} from "./domain-provisioning";
import type {
  OrganizationProvisioningRequest,
  ProvisioningIdentityAdminClient,
  ProvisioningPerson,
  ProvisioningRecordRow,
  ProvisioningSubstrateClient,
} from "./provisioning-contract";

/* ─────────────────────────────────────────────────────────────
 * Outcome contracts
 * ────────────────────────────────────────────────────────────*/

export type ProvisioningLedgerEntry =
  | { readonly kind: "record"; readonly step: string; readonly table: string; readonly id: string }
  | { readonly kind: "auth_user"; readonly step: string; readonly id: string };

export interface ProvisionedMembership {
  readonly email: string;
  readonly fullName: string;
  readonly requestedRole: string;
  readonly platformRole: string;
  readonly vocabulary: "neutral-core" | "domain-contributed";
  readonly recordValue: string;
  readonly neutralSemantics: readonly string[];
  readonly grants: readonly Permission[];
  readonly recordId: string | null;
  readonly authUserId: string | null;
  /**
   * The provisioned account's initial password — generated once at
   * provisioning time and returned once to the caller (§30). Never logged,
   * never audited, never a constant.
   */
  readonly initialPassword: string | null;
}

export interface ProvisionedRecordRef {
  readonly table: string;
  readonly id: string;
}

export type ProvisioningOutcome =
  | {
      readonly ok: true;
      readonly domainId: string;
      readonly organization: ProvisionedRecordRef;
      readonly workspaces: Readonly<Record<string, ProvisionedRecordRef>>;
      readonly memberships: readonly ProvisionedMembership[];
      readonly auxiliary: Readonly<Record<string, ProvisionedRecordRef>>;
      readonly stepsExecuted: readonly string[];
    }
  | {
      readonly ok: false;
      readonly domainId: string;
      readonly failedStep: string;
      readonly reason: string;
      readonly stepsExecuted: readonly string[];
      readonly compensated: readonly ProvisioningLedgerEntry[];
      readonly compensationErrors: readonly string[];
    };

export interface ExecuteProvisioningInput {
  readonly request: OrganizationProvisioningRequest;
  readonly domain: DomainProvisioningContribution;
  readonly client: ProvisioningSubstrateClient;
  readonly identityAdmin?: ProvisioningIdentityAdminClient;
}

/* ─────────────────────────────────────────────────────────────
 * Role resolution (fail-closed, pre-write)
 * ────────────────────────────────────────────────────────────*/

/**
 * Resolve one requested person role through the domain's provisioning role
 * vocabulary. Returns null when the request role is not in the vocabulary —
 * the engine never guesses a role (and therefore can never leak another
 * domain's role into this unit).
 */
export function resolvePersonRole(
  domain: DomainProvisioningContribution,
  person: ProvisioningPerson,
): ResolvedPersonRole | null {
  const declaration = domain.roles.find((role) => role.accepts.includes(person.role));
  if (!declaration) return null;
  if (isNeutralCoreRole(declaration.platformRole)) {
    const platformRole = declaration.platformRole;
    return {
      requestedRole: person.role,
      platformRole,
      vocabulary: "neutral-core",
      recordValue: declaration.recordValue,
      neutralSemantics: [platformRole],
      grants: NEUTRAL_ROLE_PERMISSIONS[platformRole],
    };
  }
  // Domain-contributed role: grants must exist in the combined registration
  // table — an unregistered platform role is a fail-closed preflight error.
  return {
    requestedRole: person.role,
    platformRole: declaration.platformRole,
    vocabulary: "domain-contributed",
    recordValue: declaration.recordValue,
    neutralSemantics: declaration.neutralRoles,
    grants: resolveRoleGrants(declaration.platformRole),
  };
}

interface ResolvedPerson {
  readonly person: ProvisioningPerson;
  readonly resolved: ResolvedPersonRole;
}

/** Preflight: every person resolves, every constraint holds — before any write. */
export function preflightPeople(
  domain: DomainProvisioningContribution,
  request: OrganizationProvisioningRequest,
): { ok: true; people: readonly ResolvedPerson[] } | { ok: false; errors: readonly string[] } {
  const errors: string[] = [];
  const seenEmails = new Set<string>();
  const people: ResolvedPerson[] = [];

  for (const person of request.people) {
    const scope = `person ${person.email}`;
    if (seenEmails.has(person.email)) {
      errors.push(`${scope}: duplicate email — a person may appear once per provisioning unit`);
      continue;
    }
    seenEmails.add(person.email);

    const resolved = resolvePersonRole(domain, person);
    if (!resolved) {
      errors.push(
        `${scope}: role "${person.role}" is not in domain "${domain.domainId}"'s provisioning role vocabulary`,
      );
      continue;
    }
    if (resolved.vocabulary === "domain-contributed" && resolved.grants.length === 0) {
      errors.push(
        `${scope}: platform role "${resolved.platformRole}" has no registered capability grants — it is not a registered domain role`,
      );
      continue;
    }
    if (domain.peopleRequireAuthAccounts && !person.createAuthAccount) {
      errors.push(
        `${scope}: domain "${domain.domainId}" requires provisioned auth accounts for every person`,
      );
      continue;
    }
    people.push({ person, resolved });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, people };
}

/* ─────────────────────────────────────────────────────────────
 * Execution with compensation ledger
 * ────────────────────────────────────────────────────────────*/

class ProvisioningStepError extends Error {
  constructor(
    public readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = "ProvisioningStepError";
  }
}

export async function executeOrganizationProvisioning(
  input: ExecuteProvisioningInput,
): Promise<ProvisioningOutcome> {
  const { request, domain, client, identityAdmin } = input;

  const preflight = preflightPeople(domain, request);
  if (!preflight.ok) {
    return {
      ok: false,
      domainId: domain.domainId,
      failedStep: "preflight",
      reason: preflight.errors.join("; "),
      stepsExecuted: [],
      compensated: [],
      compensationErrors: [],
    };
  }

  /**
   * Mutable execution view; handed to builders through the readonly
   * `ProvisioningContext` contract (builders never mutate execution state).
   */
  interface MutableProvisioningContext {
    request: OrganizationProvisioningRequest;
    organizationId: string | null;
    workspaceIds: Record<string, string>;
    authAccountIds: Record<string, string>;
  }

  const mutableContext: MutableProvisioningContext = {
    request,
    organizationId: null,
    workspaceIds: {},
    authAccountIds: {},
  };
  const ledger: ProvisioningLedgerEntry[] = [];
  const stepsExecuted: string[] = [];
  const passwordsByEmail = new Map<string, string>();

  async function insertRecord(
    step: string,
    table: string,
    payload: Record<string, unknown>,
  ): Promise<{ row: ProvisioningRecordRow; id: string }> {
    const { data, error } = await client.from(table).insert(payload).select("id");
    if (error) throw new ProvisioningStepError(step, `substrate rejected insert on "${table}": ${error.message}`);
    if (!data || data.length === 0) {
      throw new ProvisioningStepError(step, `substrate returned no row for insert on "${table}"`);
    }
    const row = data[0]!;
    const id = row.id;
    if (typeof id !== "string" || id === "") {
      throw new ProvisioningStepError(step, `created row on "${table}" carries no readable id`);
    }
    ledger.push({ kind: "record", step, table, id });
    stepsExecuted.push(step);
    return { row, id };
  }

  async function provisionAuthAccount(person: ProvisioningPerson): Promise<string> {
    const step = `identity:${person.email}`;
    if (!identityAdmin) {
      throw new ProvisioningStepError(
        step,
        "no identity admin surface available — auth accounts cannot be provisioned",
      );
    }
    const password = generateInitialPassword();
    const { data, error } = await identityAdmin.createUser({
      email: person.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: person.fullName },
    });
    if (error) throw new ProvisioningStepError(step, `auth account rejected: ${error.message}`);
    const userId = data?.user?.id;
    if (!userId) throw new ProvisioningStepError(step, "auth account creation returned no user id");
    passwordsByEmail.set(person.email, password);
    ledger.push({ kind: "auth_user", step, id: userId });
    stepsExecuted.push(step);
    return userId;
  }

  async function compensate(): Promise<{
    compensated: readonly ProvisioningLedgerEntry[];
    errors: readonly string[];
  }> {
    const compensated: ProvisioningLedgerEntry[] = [];
    const errors: string[] = [];
    for (const entry of [...ledger].reverse()) {
      try {
        if (entry.kind === "auth_user") {
          if (!identityAdmin) {
            errors.push(`compensation ${entry.step}: no identity admin surface to delete ${entry.id}`);
            continue;
          }
          const { error } = await identityAdmin.deleteUser(entry.id);
          if (error) errors.push(`compensation ${entry.step}: ${error.message}`);
          else compensated.push(entry);
        } else {
          const { error } = await client.from(entry.table).delete().eq("id", entry.id);
          if (error) errors.push(`compensation ${entry.step}: ${error.message}`);
          else compensated.push(entry);
        }
      } catch (err) {
        errors.push(`compensation ${entry.step}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { compensated, errors };
  }

  try {
    /* 1. the organization record */
    const organization = await insertRecord(
      "organization",
      domain.organization.table,
      domain.organization.build(mutableContext),
    );
    mutableContext.organizationId = organization.id;

    /* 2. workspaces */
    const workspaceRefs: Record<string, ProvisionedRecordRef> = {};
    for (const workspace of domain.workspaces) {
      const created = await insertRecord(
        `workspace:${workspace.name}`,
        workspace.table,
        workspace.build(mutableContext),
      );
      mutableContext.workspaceIds[workspace.name] = created.id;
      workspaceRefs[workspace.name] = { table: workspace.table, id: created.id };
    }

    /* 3. identities for every person requesting one */
    for (const { person } of preflight.people) {
      if (!person.createAuthAccount) continue;
      mutableContext.authAccountIds[person.email] = await provisionAuthAccount(person);
    }

    /* 4. memberships with resolved role semantics */
    const memberships: ProvisionedMembership[] = [];
    for (const { person, resolved } of preflight.people) {
      const created = await insertRecord(
        `membership:${person.email}`,
        domain.membership.table,
        domain.membership.build(person, resolved, mutableContext),
      );
      memberships.push({
        email: person.email,
        fullName: person.fullName,
        requestedRole: resolved.requestedRole,
        platformRole: resolved.platformRole,
        vocabulary: resolved.vocabulary,
        recordValue: resolved.recordValue,
        neutralSemantics: resolved.neutralSemantics,
        grants: resolved.grants,
        recordId: created.id,
        authUserId: mutableContext.authAccountIds[person.email] ?? null,
        initialPassword: passwordsByEmail.get(person.email) ?? null,
      });
    }

    /* 5. domain auxiliary records (last: they reference everything above) */
    const auxiliaryRefs: Record<string, ProvisionedRecordRef> = {};
    for (const aux of domain.auxiliary) {
      const created = await insertRecord(
        `auxiliary:${aux.name}`,
        aux.table,
        aux.build(mutableContext),
      );
      auxiliaryRefs[aux.name] = { table: aux.table, id: created.id };
    }

    return {
      ok: true,
      domainId: domain.domainId,
      organization: { table: domain.organization.table, id: organization.id },
      workspaces: workspaceRefs,
      memberships,
      auxiliary: auxiliaryRefs,
      stepsExecuted,
    };
  } catch (err) {
    const failedStep = err instanceof ProvisioningStepError ? err.step : "unknown";
    const reason = err instanceof Error ? err.message : String(err);
    const { compensated, errors: compensationErrors } = await compensate();
    return {
      ok: false,
      domainId: domain.domainId,
      failedStep,
      reason,
      stepsExecuted,
      compensated,
      compensationErrors,
    };
  }
}
/* ─────────────────────────────────────────────────────────────
 * M6 (ADR-117): provisioning from an approved plan, natively atomic
 *
 * The residual gap named at the top of this file (native atomicity needs a
 * Postgres function) is closed for plan-based onboarding: the database
 * function `onboarding_provision_from_plan` writes the organization root, the
 * kernel and console records, the institution profile, the org units, the role
 * pack installation, the first-admin invitation, the website draft and the
 * application record in ONE transaction, and asserts that the organization has
 * no root gaps before commit. A failure rolls every row back; a second call for
 * a provisioned request returns the first result and writes nothing.
 *
 * This wrapper only calls it and maps errors to stable codes; it never decides
 * the organization, the plan or the approver (the database reads them from the
 * approved request).
 * ────────────────────────────────────────────────────────────*/

export type PlanProvisioningRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

export type PlanProvisioningFailureCode =
  | "not_allowed"
  | "not_found"
  | "stale_plan"
  | "invalid_plan"
  | "incomplete_organization"
  | "conflict"
  | "unavailable";

export type PlanProvisioningOutcome =
  | {
      readonly ok: true;
      readonly replay: boolean;
      readonly organizationId: string;
      readonly appliedResult: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly code: PlanProvisioningFailureCode };

export function planProvisioningFailureCode(
  error: { code?: string } | null | undefined,
): PlanProvisioningFailureCode {
  switch (error?.code) {
    case "42501":
      return "not_allowed";
    case "PT404":
      return "not_found";
    case "PT409":
      return "stale_plan";
    case "22023":
      return "invalid_plan";
    case "55000":
      return "incomplete_organization";
    case "23505":
      return "conflict";
    default:
      return "unavailable";
  }
}

export async function provisionApprovedPlan(
  rpc: PlanProvisioningRpc,
  input: {
    readonly requestId: string;
    readonly actorId: string;
    readonly expectedPlanHash: string;
    readonly websiteDraft: Readonly<Record<string, unknown>> | null;
  },
): Promise<PlanProvisioningOutcome> {
  const { data, error } = await rpc("onboarding_provision_from_plan", {
    p_request: input.requestId,
    p_actor: input.actorId,
    p_expected_plan_hash: input.expectedPlanHash,
    p_website_draft: input.websiteDraft,
    p_channel: "console",
  });
  if (error) return { ok: false, code: planProvisioningFailureCode(error) };
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "unavailable" };
  }
  const result = data as Record<string, unknown>;
  const organizationId = result.organization_id;
  if (typeof organizationId !== "string" || organizationId === "") {
    return { ok: false, code: "unavailable" };
  }
  return { ok: true, replay: result.replay === true, organizationId, appliedResult: result };
}
