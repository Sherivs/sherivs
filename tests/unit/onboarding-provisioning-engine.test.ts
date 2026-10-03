/**
 * CoreGrid — V1-008: organization-provisioning engine proof suite.
 *
 * Proves the four structural claims of the platform onboarding engine:
 *
 * (a) THE TRANSACTIONAL UNIT — one provisioning run creates the organization
 *     record, its workspaces, its people's identities + memberships and the
 *     domain's auxiliary records, with every person role resolved against the
 *     neutral core vocabulary (`rbac/neutral-roles.ts`) and the domain
 *     contribution registry (`rbac/domain-contribution.ts`).
 *
 * (b) SCHOLAR AS A DOMAIN CONTRIBUTION — the education runtime provisions
 *     through `onboarding/contributions/scholar-provisioning.ts` with zero
 *     Scholar vocabulary in the engine; the legacy createSchoolWithAdmin
 *     substrate mapping (schools / users.role / subscriptions) is reproduced
 *     byte-for-byte by configuration.
 *
 * (c) FAILURE DOES NOT LEAVE PARTIAL STATE — a mid-provision substrate
 *     rejection or identity failure rolls the WHOLE unit back through the
 *     compensation ledger in reverse order, and compensation errors are
 *     reported (never silently swallowed).
 *
 * (d) CROSS-DOMAIN ISOLATION — a Scholar provisioning can only resolve roles
 *     in Scholar's own vocabulary; roles registered by other domains, roles
 *     with no registered grants, and cross-domain platform-role claims are
 *     rejected fail-closed. All substrate clients are mocked (no real DB).
 */
import { describe, expect, it } from "vitest";
import { domainPermissionResource } from "@/lib/identity";
import {
  registerDomainAuthorization,
  resolveRoleGrants,
  type DomainRoleContribution,
} from "@/lib/rbac/domain-contribution";
import { NEUTRAL_ROLE_PERMISSIONS } from "@/lib/rbac/neutral-roles";
import "@/lib/onboarding/contributions/scholar-provisioning";
import {
  registerDomainProvisioning,
  registeredProvisioningDomainIds,
  resolveDomainProvisioning,
  type DomainProvisioningContribution,
} from "@/lib/onboarding/domain-provisioning";
import {
  executeOrganizationProvisioning,
  preflightPeople,
  resolvePersonRole,
} from "@/lib/onboarding/provision-organization";
import type {
  OrganizationProvisioningRequest,
  ProvisioningIdentityAdminClient,
  ProvisioningSubstrateClient,
} from "@/lib/onboarding/provisioning-contract";

/* ─────────────────────────────────────────────────────────────
 * Mock substrate harness (no real database is ever touched)
 * ────────────────────────────────────────────────────────────*/

interface InsertedRow {
  table: string;
  payload: Record<string, unknown>;
  id: string;
}

interface AuthCreated {
  email: string;
  password: string;
}

function createHarness() {
  const inserted: InsertedRow[] = [];
  const deleted: { table: string; id: string }[] = [];
  const authCreated: AuthCreated[] = [];
  const authDeleted: string[] = [];
  let insertCounter = 0;
  let authCounter = 0;
  let failInsertIndex: number | null = null;
  let failAuthIndex: number | null = null;
  let failDeletes = false;

  const client: ProvisioningSubstrateClient = {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => ({
        select: () => {
          const index = insertCounter;
          insertCounter += 1;
          if (failInsertIndex !== null && index === failInsertIndex) {
            return Promise.resolve({
              data: null,
              error: { message: `forced failure at insert #${index}` },
            });
          }
          const id = `row-${index + 1}`;
          inserted.push({ table, payload, id });
          return Promise.resolve({ data: [{ id, ...payload }], error: null });
        },
      }),
      delete: () => ({
        eq: (_column: string, value: unknown) => {
          if (failDeletes) {
            return Promise.resolve({ error: { message: "forced delete failure" } });
          }
          deleted.push({ table, id: value as string });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  const identityAdmin: ProvisioningIdentityAdminClient = {
    createUser: (input) => {
      const index = authCounter;
      authCounter += 1;
      if (failAuthIndex !== null && index === failAuthIndex) {
        return Promise.resolve({
          data: null,
          error: { message: `forced auth failure at account #${index}` },
        });
      }
      authCreated.push({ email: input.email, password: input.password });
      return Promise.resolve({ data: { user: { id: `auth-${index + 1}` } }, error: null });
    },
    deleteUser: (id: string) => {
      authDeleted.push(id);
      return Promise.resolve({ error: null });
    },
  };

  return {
    client,
    identityAdmin,
    inserted,
    deleted,
    authCreated,
    authDeleted,
    failOnInsert(index: number) {
      failInsertIndex = index;
    },
    failOnAuth(index: number) {
      failAuthIndex = index;
    },
    failAllDeletes() {
      failDeletes = true;
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Second-domain fixture ("catering") — registration + wiring
 * ────────────────────────────────────────────────────────────*/

const CATERING_RBAC_ROLES: readonly DomainRoleContribution[] = [
  {
    domainRole: "sous_chef",
    neutralRoles: ["WORKER"],
    permissions: [
      { resource: domainPermissionResource("kitchen"), action: "read", scope: null },
      { resource: domainPermissionResource("prep_list"), action: "update", scope: null },
    ],
    description: "Kitchen workforce producing prep work under the head chef's direction.",
  },
];

const cateringRbac = registerDomainAuthorization({
  domainId: "catering",
  roles: CATERING_RBAC_ROLES,
});

const CATERING_PROVISIONING: DomainProvisioningContribution = {
  domainId: "catering",
  description: "Test fixture: second domain proving the engine is domain-agnostic.",
  roles: [
    {
      accepts: ["manager"],
      platformRole: "org_owner",
      recordValue: "manager",
      neutralRoles: ["OWNER", "ADMINISTRATOR"],
      description: "Runs the catering operation (neutral core OWNER authority).",
    },
    {
      accepts: ["sous_chef"],
      platformRole: "sous_chef",
      recordValue: "sous_chef",
      neutralRoles: ["WORKER"],
      description: "Kitchen workforce role contributed through the rbac registry.",
    },
  ],
  organization: {
    table: "orgs",
    build: (ctx) => ({
      name: ctx.request.identity.name,
      slug: ctx.request.structure.slug ?? null,
      contact_email: ctx.request.identity.contactEmail ?? null,
      settings: ctx.request.structure.domainData ?? null,
    }),
  },
  workspaces: [
    {
      name: "front_of_house",
      table: "workspaces",
      build: (ctx) => ({
        organization_id: ctx.organizationId,
        name: "front_of_house",
      }),
    },
  ],
  membership: {
    table: "members",
    build: (person, resolved, ctx) => ({
      organization_id: ctx.organizationId,
      auth_user_id: ctx.authAccountIds[person.email] ?? null,
      email: person.email,
      full_name: person.fullName,
      role: resolved.recordValue,
    }),
  },
  auxiliary: [
    {
      name: "ledger",
      table: "ledgers",
      build: (ctx) => ({ organization_id: ctx.organizationId, opened: true }),
    },
  ],
};

function registerCatering(): void {
  if (!cateringRbac.ok) throw new Error(`catering rbac rejected: ${cateringRbac.errors.join("; ")}`);
  const provisioning = registerDomainProvisioning(CATERING_PROVISIONING);
  if (!provisioning.ok) throw new Error(`catering provisioning rejected: ${provisioning.errors.join("; ")}`);
}

registerCatering();

function cateringRequest(
  overrides?: Partial<{ people: OrganizationProvisioningRequest["people"] }>,
): OrganizationProvisioningRequest {
  return {
    domainId: "catering",
    identity: { name: "Bistro Nova", contactEmail: "ops@bistro.example", phone: null, address: null },
    structure: {
      slug: "bistro-nova",
      subscriptionTier: undefined,
      monthlyFee: undefined,
      domainData: { cuisine: "west_african" },
    },
    people: overrides?.people ?? [
      {
        fullName: "Rosa Diaz",
        email: "rosa@bistro.example",
        role: "manager",
        createAuthAccount: true,
      },
      {
        fullName: "Cole Nnamdi",
        email: "cole@bistro.example",
        role: "sous_chef",
        createAuthAccount: true,
      },
    ],
  };
}

/* ─────────────────────────────────────────────────────────────
 * (a) The transactional unit
 * ────────────────────────────────────────────────────────────*/

describe("(a) the transactional provisioning unit", () => {
  it("creates organization + workspace + identities + memberships + auxiliary as one run", async () => {
    const h = createHarness();
    const outcome = await executeOrganizationProvisioning({
      request: cateringRequest(),
      domain: CATERING_PROVISIONING,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.domainId).toBe("catering");
    expect(outcome.organization).toEqual({ table: "orgs", id: "row-1" });
    expect(outcome.workspaces.front_of_house).toEqual({ table: "workspaces", id: "row-2" });
    expect(outcome.auxiliary.ledger).toEqual({ table: "ledgers", id: "row-5" });
    expect(outcome.stepsExecuted).toEqual([
      "organization",
      "workspace:front_of_house",
      "identity:rosa@bistro.example",
      "identity:cole@bistro.example",
      "membership:rosa@bistro.example",
      "membership:cole@bistro.example",
      "auxiliary:ledger",
    ]);

    const org = h.inserted[0]!;
    expect(org.table).toBe("orgs");
    expect(org.payload).toMatchObject({
      name: "Bistro Nova",
      slug: "bistro-nova",
      contact_email: "ops@bistro.example",
      settings: { cuisine: "west_african" },
    });

    const workspace = h.inserted[1]!;
    expect(workspace.payload).toEqual({ organization_id: "row-1", name: "front_of_house" });

    expect(h.authCreated).toHaveLength(2);
    expect(h.authCreated[0]!.email).toBe("rosa@bistro.example");
    expect(h.authCreated[1]!.email).toBe("cole@bistro.example");

    const rosaRow = h.inserted[2]!;
    const coleRow = h.inserted[3]!;
    expect(rosaRow.table).toBe("members");
    expect(rosaRow.payload).toMatchObject({
      organization_id: "row-1",
      auth_user_id: "auth-1",
      role: "manager",
      email: "rosa@bistro.example",
    });
    expect(coleRow.payload).toMatchObject({
      organization_id: "row-1",
      auth_user_id: "auth-2",
      role: "sous_chef",
    });

    expect(h.deleted).toHaveLength(0);
    expect(h.authDeleted).toHaveLength(0);
  });

  it("resolves neutral-core roles from rbac/neutral-roles and domain contributions from the registry", async () => {
    const h = createHarness();
    const outcome = await executeOrganizationProvisioning({
      request: cateringRequest(),
      domain: CATERING_PROVISIONING,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const manager = outcome.memberships[0]!;
    expect(manager.platformRole).toBe("org_owner");
    expect(manager.vocabulary).toBe("neutral-core");
    expect(manager.grants).toEqual(NEUTRAL_ROLE_PERMISSIONS.org_owner);

    const sousChef = outcome.memberships[1]!;
    expect(sousChef.platformRole).toBe("sous_chef");
    expect(sousChef.vocabulary).toBe("domain-contributed");
    expect(sousChef.grants).toEqual(resolveRoleGrants("sous_chef"));
    expect(sousChef.grants.length).toBeGreaterThan(0);
    expect(sousChef.neutralSemantics).toEqual(["WORKER"]);
  });

  it("returns generated-once credentials exactly once, in the response only", async () => {
    const h = createHarness();
    const outcome = await executeOrganizationProvisioning({
      request: cateringRequest(),
      domain: CATERING_PROVISIONING,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const passwords = outcome.memberships.map((m) => m.initialPassword);
    for (const password of passwords) {
      expect(password).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{20,}$/);
    }
    expect(passwords[0]).not.toBe(passwords[1]);
    // Credentials ride the auth account creation only — they are never
    // persisted into any substrate payload.
    for (const row of h.inserted) {
      expect(JSON.stringify(row.payload)).not.toContain(passwords[0]!);
      expect(JSON.stringify(row.payload)).not.toContain(passwords[1]!);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * (b) Scholar provisioning through the DomainDefinition contribution
 * ────────────────────────────────────────────────────────────*/

describe("(b) Scholar provisions as a domain contribution, not engine code", () => {
  function scholarRequest(): OrganizationProvisioningRequest {
    return {
      domainId: "scholar",
      identity: {
        name: "St Marys College",
        contactEmail: "office@stmarys.example",
        phone: null,
        address: "1 College Road",
      },
      structure: { slug: "st-marys", subscriptionTier: "growth", monthlyFee: 5000 },
      people: [
        { fullName: "Ada Obi", email: "ada@stmarys.example", role: "admin", createAuthAccount: true },
        {
          fullName: "Bello Musa",
          email: "bello@stmarys.example",
          role: "teacher",
          createAuthAccount: true,
        },
      ],
    };
  }

  it("resolves the scholar contribution and reproduces the legacy substrate mapping", async () => {
    const resolution = resolveDomainProvisioning("scholar");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    const h = createHarness();
    const outcome = await executeOrganizationProvisioning({
      request: scholarRequest(),
      domain: resolution.contribution,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const org = h.inserted[0]!;
    expect(org.table).toBe("schools");
    expect(org.payload).toMatchObject({
      name: "St Marys College",
      slug: "st-marys",
      email: "office@stmarys.example",
      address: "1 College Road",
      subscription_tier: "growth",
      subscription_status: "active",
      monthly_fee: 5000,
      is_active: true,
    });

    const adaRow = h.inserted[1]!;
    const belloRow = h.inserted[2]!;
    expect(adaRow.table).toBe("users");
    expect(adaRow.payload).toMatchObject({
      id: "auth-1",
      school_id: "row-1",
      role: "admin",
      email: "ada@stmarys.example",
      is_active: true,
    });
    expect(belloRow.payload).toMatchObject({ role: "teacher", school_id: "row-1" });

    const subscription = h.inserted[3]!;
    expect(subscription.table).toBe("subscriptions");
    expect(subscription.payload).toEqual({
      school_id: "row-1",
      plan: "growth",
      status: "active",
      amount_paid: 0,
    });

    const admin = outcome.memberships[0]!;
    expect(admin.platformRole).toBe("school_admin");
    expect(admin.vocabulary).toBe("domain-contributed");
    expect(admin.grants).toEqual(resolveRoleGrants("school_admin"));
    expect(admin.grants.length).toBeGreaterThan(0);
    expect(admin.recordValue).toBe("admin");

    const teacher = outcome.memberships[1]!;
    expect(teacher.platformRole).toBe("teacher");
    expect(teacher.grants).toEqual(resolveRoleGrants("teacher"));
  });

  it("accepts the legacy request alias 'admin' and the canonical 'school_admin' to the same platform role", () => {
    const resolution = resolveDomainProvisioning("scholar");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    for (const role of ["admin", "school_admin"]) {
      const resolved = resolvePersonRole(resolution.contribution, {
        fullName: "X",
        email: "x@stmarys.example",
        role,
        createAuthAccount: true,
      });
      expect(resolved?.platformRole).toBe("school_admin");
      expect(resolved?.recordValue).toBe("admin");
    }
  });

  it("enforces the contribution's peopleRequireAuthAccounts constraint (Scholar memberships key on auth uids)", async () => {
    const resolution = resolveDomainProvisioning("scholar");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    const h = createHarness();
    const outcome = await executeOrganizationProvisioning({
      request: {
        ...scholarRequest(),
        people: [
          {
            fullName: "No Account",
            email: "ghost@stmarys.example",
            role: "teacher",
            createAuthAccount: false,
          },
        ],
      },
      domain: resolution.contribution,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failedStep).toBe("preflight");
    expect(outcome.reason).toContain("requires provisioned auth accounts");
    expect(h.inserted).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (c) Failure does not leave partial state
 * ────────────────────────────────────────────────────────────*/

describe("(c) failure mid-provision compensates the whole unit", () => {
  it("rolls back records + identities in reverse order when a membership insert fails", async () => {
    const h = createHarness();
    // Insert order: 0 org, 1 workspace, 2 rosa membership, 3 cole membership, 4 ledger.
    h.failOnInsert(2);
    const outcome = await executeOrganizationProvisioning({
      request: cateringRequest(),
      domain: CATERING_PROVISIONING,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.failedStep).toBe("membership:rosa@bistro.example");
    expect(outcome.reason).toContain("forced failure");
    expect(outcome.stepsExecuted).toEqual([
      "organization",
      "workspace:front_of_house",
      "identity:rosa@bistro.example",
      "identity:cole@bistro.example",
    ]);
    // Compensation runs in REVERSE creation order: records newest-first, and
    // BOTH provisioned identities are deleted (newest identity first).
    expect(h.deleted.map((d) => `${d.table}:${d.id}`)).toEqual([
      "workspaces:row-2",
      "orgs:row-1",
    ]);
    expect(h.authDeleted).toEqual(["auth-2", "auth-1"]);
    expect(outcome.compensated).toHaveLength(4);
    expect(outcome.compensationErrors).toHaveLength(0);
  });

  it("rolls back when a provisioned identity fails mid-run", async () => {
    const h = createHarness();
    h.failOnAuth(1); // cole's auth account fails
    const outcome = await executeOrganizationProvisioning({
      request: cateringRequest(),
      domain: CATERING_PROVISIONING,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.failedStep).toBe("identity:cole@bistro.example");
    expect(h.authDeleted).toEqual(["auth-1"]);
    expect(h.deleted.map((d) => `${d.table}:${d.id}`)).toEqual([
      "workspaces:row-2",
      "orgs:row-1",
    ]);
    expect(h.inserted).toHaveLength(2); // no membership rows were ever written
    expect(outcome.compensated).toHaveLength(3);
  });

  it("reports compensation errors instead of silently passing a failed rollback", async () => {
    const h = createHarness();
    h.failOnInsert(2);
    h.failAllDeletes();
    const outcome = await executeOrganizationProvisioning({
      request: cateringRequest(),
      domain: CATERING_PROVISIONING,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Auth compensations still succeed; the record compensations fail loudly.
    expect(outcome.compensated.map((entry) => entry.kind)).toEqual(["auth_user", "auth_user"]);
    expect(outcome.compensationErrors.length).toBe(2);
    expect(outcome.compensationErrors.every((e) => e.includes("forced delete failure"))).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (d) Cross-domain isolation + fail-closed preflight
 * ────────────────────────────────────────────────────────────*/

describe("(d) cross-domain isolation and fail-closed preflight", () => {
  it("rejects a role registered by ANOTHER domain — a Scholar unit can never grant catering capabilities", async () => {
    const resolution = resolveDomainProvisioning("scholar");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    const h = createHarness();
    const outcome = await executeOrganizationProvisioning({
      request: {
        domainId: "scholar",
        identity: { name: "St Marys College", contactEmail: null, phone: null, address: null },
        structure: {},
        people: [
          {
            fullName: "Intruder",
            email: "intruder@stmarys.example",
            role: "sous_chef",
            createAuthAccount: true,
          },
        ],
      },
      domain: resolution.contribution,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failedStep).toBe("preflight");
    expect(outcome.reason).toContain('"sous_chef" is not in domain "scholar"');
    // Zero writes, zero identities: isolation holds before anything touches the substrate.
    expect(h.inserted).toHaveLength(0);
    expect(h.authCreated).toHaveLength(0);
  });

  it("rejects a domain-contributed platform role with no registered capability grants", async () => {
    const ghost = registerDomainProvisioning({
      domainId: "ghost_domain",
      roles: [
        {
          accepts: ["ghost_operator"],
          platformRole: "ghost_operator",
          recordValue: "ghost_operator",
          neutralRoles: ["WORKER"],
          description: "A platform role that was never registered with the rbac registry.",
        },
      ],
      organization: { table: "ghost_orgs", build: () => ({}) },
      workspaces: [],
      membership: { table: "ghost_members", build: () => ({}) },
      auxiliary: [],
    });
    expect(ghost.ok).toBe(true);

    const ghostResolution = resolveDomainProvisioning("ghost_domain");
    expect(ghostResolution.ok).toBe(true);
    if (!ghostResolution.ok) return;

    const h = createHarness();
    const outcome = await executeOrganizationProvisioning({
      request: {
        domainId: "ghost_domain",
        identity: { name: "Ghost Co", contactEmail: null, phone: null, address: null },
        structure: {},
        people: [
          {
            fullName: "Spook",
            email: "spook@ghost.example",
            role: "ghost_operator",
            createAuthAccount: true,
          },
        ],
      },
      domain: ghostResolution.contribution,
      client: h.client,
      identityAdmin: h.identityAdmin,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain(
      'platform role "ghost_operator" has no registered capability grants',
    );
    expect(h.inserted).toHaveLength(0);
  });

  it("rejects duplicate person emails in one unit", () => {
    const resolution = resolveDomainProvisioning("scholar");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const preflight = preflightPeople(resolution.contribution, {
      domainId: "scholar",
      identity: { name: "St Marys College", contactEmail: null, phone: null, address: null },
      structure: {},
      people: [
        { fullName: "Twin A", email: "twin@stmarys.example", role: "teacher", createAuthAccount: true },
        { fullName: "Twin B", email: "twin@stmarys.example", role: "bursar", createAuthAccount: true },
      ],
    });
    expect(preflight.ok).toBe(false);
    if (preflight.ok) return;
    expect(preflight.errors.join(" ")).toContain("duplicate email");
  });

  it("the provisioning registry rejects a second domain claiming another domain's platform role", () => {
    const usurper = registerDomainProvisioning({
      domainId: "usurper",
      roles: [
        {
          accepts: ["fake_admin"],
          platformRole: "school_admin",
          recordValue: "fake_admin",
          neutralRoles: ["ADMINISTRATOR"],
          description: "Attempts to claim the Scholar-owned school_admin platform role.",
        },
      ],
      organization: { table: "usurper_orgs", build: () => ({}) },
      workspaces: [],
      membership: { table: "usurper_members", build: () => ({}) },
      auxiliary: [],
    });
    expect(usurper.ok).toBe(false);
    if (usurper.ok) return;
    expect(usurper.errors.join(" ")).toContain('already owned by domain "scholar"');
  });

  it("neutral core roles may be shared across domains' vocabularies (they are platform-owned)", () => {
    const events = registerDomainProvisioning({
      domainId: "events_co",
      roles: [
        {
          accepts: ["organizer"],
          platformRole: "org_owner",
          recordValue: "organizer",
          neutralRoles: ["OWNER"],
          description: "Event organizer resolving onto the platform-owned org_owner core role.",
        },
      ],
      organization: { table: "event_orgs", build: () => ({}) },
      workspaces: [],
      membership: { table: "event_members", build: () => ({}) },
      auxiliary: [],
    });
    expect(events.ok).toBe(true);
  });

  it("registration fails closed and atomically on malformed specs", () => {
    const badTable = registerDomainProvisioning({
      domainId: "bad_table_domain",
      roles: [
        {
          accepts: ["worker"],
          platformRole: "org_admin",
          recordValue: "worker",
          neutralRoles: ["WORKER"],
          description: "Malformed substrate table name.",
        },
      ],
      organization: { table: "Bad-Table", build: () => ({}) },
      workspaces: [],
      membership: { table: "members", build: () => ({}) },
      auxiliary: [],
    });
    expect(badTable.ok).toBe(false);
    expect(registeredProvisioningDomainIds()).not.toContain("bad_table_domain");

    const duplicate = registerDomainProvisioning(CATERING_PROVISIONING);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors[0]).toContain('already registered');

    const unknown = resolveDomainProvisioning("never_registered");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]).toContain("no registered provisioning contribution");
  });
});