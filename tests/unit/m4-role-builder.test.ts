/**
 * M4 (ADR-121): custom role and responsibility builder. Every server-function handler's validation
 * and refusal paths, the SoD explanation, "simulate as", and the end-to-end story at unit level:
 * admin A creates, admin B approves, and a holder's computed workspace has exactly the configured
 * three navigation sections. The fake port mirrors the database rules proven by
 * tests/sql/m4-role-builder.sql (ADR-114 guard + M4 functions); no browser E2E runs here.
 */
import { describe, expect, it } from "vitest";
import {
  RoleBuilderError,
  analyseSod,
  assignableRoleCode,
  holderWorkspace,
  mapDatabaseError,
  parseRoleBuilderError,
  previewDraft,
  simulateDraft,
  type BuilderCatalogue,
  type CustomRoleDraftInput,
  type ResponsibilityInput,
  type RoleNavRow,
} from "@/lib/role-builder/role-builder-core";
import type {
  AuditEntry,
  CallerContext,
  CustomRoleVersion,
  RoleBuilderPort,
} from "@/lib/role-builder/role-builder-port";
import {
  handleActivate,
  handleApprove,
  handleDefineResponsibility,
  handleHistory,
  handleLoadBuilder,
  handlePreview,
  handleSaveDraft,
  handleSimulate,
  handleSubmit,
  handleWithdraw,
} from "@/lib/role-builder/role-builder-handlers";

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER_ORG = "bbbbbbbb-0000-0000-0000-000000000001";
const ADMIN_A = "a0000000-0000-0000-0000-0000000000a1";
const ADMIN_B = "a0000000-0000-0000-0000-0000000000a2";
const MEMBER = "a0000000-0000-0000-0000-0000000000a3";
const AT = "2026-11-18T09:00:00.000Z";

const CATALOGUE: BuilderCatalogue = {
  institutionType: "private_secondary",
  templates: [
    {
      code: "bursar_t",
      scope: "org",
      mandatory: ["fees.view", "payments.record_cash"],
      optional: ["reports.view"],
      nav: ["Collections", "Receipts", "Reports"],
      workspaceMode: "full",
    },
    {
      code: "clerk_t",
      scope: "department",
      mandatory: ["reports.view"],
      optional: [],
      nav: [],
      workspaceMode: "full",
    },
  ],
  permissions: [
    {
      code: "fees.view",
      label: "View fees",
      module: "fees",
      sensitivity: "internal",
      protected: false,
    },
    {
      code: "fees.collect",
      label: "Collect",
      module: "fees",
      sensitivity: "confidential",
      protected: false,
    },
    {
      code: "payments.record_cash",
      label: "Cash",
      module: "payments",
      sensitivity: "confidential",
      protected: false,
    },
    {
      code: "payments.reconcile",
      label: "Reconcile",
      module: "payments",
      sensitivity: "confidential",
      protected: false,
    },
    {
      code: "payroll.approve",
      label: "Approve payroll",
      module: "payroll",
      sensitivity: "restricted",
      protected: true,
    },
    {
      code: "reports.view",
      label: "Reports",
      module: "reports",
      sensitivity: "internal",
      protected: false,
    },
    {
      code: "expenses.create",
      label: "Raise",
      module: "expenses",
      sensitivity: "internal",
      protected: false,
    },
    {
      code: "expenses.approve",
      label: "Approve",
      module: "expenses",
      sensitivity: "confidential",
      protected: false,
    },
  ],
  allowedPermissions: [
    "expenses.approve",
    "expenses.create",
    "fees.collect",
    "fees.view",
    "payments.reconcile",
    "payments.record_cash",
    "reports.view",
  ],
  sodRules: [
    {
      a: "payments.record_cash",
      b: "payments.reconcile",
      description: "Cash recorded by a person is reconciled by someone else",
    },
    { a: "expenses.create", b: "expenses.approve", description: "Raiser and approver must differ" },
  ],
  responsibilities: [],
};

const NAV = [
  { id: "collections", label: "Collections" },
  { id: "receipts", label: "Receipts" },
  { id: "reports", label: "Reports" },
];
const draft = (patch: Partial<CustomRoleDraftInput> = {}): CustomRoleDraftInput => ({
  slug: "fees_desk",
  name: "Fees desk",
  baseTemplate: "bursar_t",
  permissions: ["fees.view", "payments.record_cash", "fees.collect", "reports.view"],
  responsibilities: [],
  scopeCeiling: "org",
  workspaceCategory: "administrative_operations",
  layout: { nav: NAV, widgets: ["w.fee_collection"] },
  ...patch,
});

/** In-memory port that applies the same rules as the database. */
class FakePort implements RoleBuilderPort {
  me: CallerContext = { userId: ADMIN_A, orgId: ORG, isAdmin: true };
  rows: (CustomRoleVersion & { orgId: string })[] = [];
  audit: AuditEntry[] = [];
  catalogueRoles = new Map<
    string,
    { navRows: RoleNavRow[]; permissions: string[]; name: string }
  >();
  responsibilities: ResponsibilityInput[] = [];
  calls: string[] = [];
  private seq = 0;

  as(userId: string, patch: Partial<CallerContext> = {}) {
    this.me = { userId, orgId: ORG, isAdmin: true, ...patch };
    return this;
  }
  private log(id: string, action: string) {
    this.audit.push({ recordId: id, action, actor: this.me.userId, at: AT });
  }
  private mine(id: string) {
    const row = this.rows.find((r) => r.id === id && r.orgId === this.me.orgId);
    if (!row) throw mapDatabaseError({ code: "42704", message: "custom role not found" });
    return row;
  }
  async caller() {
    return this.me;
  }
  async loadCatalogue() {
    return CATALOGUE;
  }
  async listVersions(orgId: string) {
    return this.rows.filter((r) => r.orgId === orgId).map(({ orgId: _o, ...r }) => r);
  }
  async auditFor(_orgId: string, ids: string[]) {
    return this.audit.filter((a) => ids.includes(a.recordId));
  }
  async saveDraft(d: CustomRoleDraftInput & { code: string }) {
    this.calls.push("saveDraft");
    const latest = this.rows
      .filter((r) => r.orgId === this.me.orgId && r.code === d.code)
      .sort((a, b) => b.version - a.version)[0];
    if (latest?.status === "pending_approval")
      throw mapDatabaseError({ code: "55000", message: "this role is waiting for approval" });
    const fields = {
      name: d.name,
      baseTemplate: d.baseTemplate,
      permissions: d.permissions,
      responsibilities: d.responsibilities,
      scopeCeiling: d.scopeCeiling,
      workspaceCategory: d.workspaceCategory,
      layout: d.layout,
    };
    if (latest?.status === "draft") {
      Object.assign(latest, fields);
      this.log(latest.id, "scholar.org_custom_roles.update");
      return latest.id;
    }
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    this.rows.push({
      id,
      orgId: this.me.orgId!,
      code: d.code,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      createdBy: this.me.userId,
      approvedBy: null,
      approvedAt: null,
      createdAt: AT,
      updatedAt: AT,
      ...fields,
    });
    this.log(id, "scholar.org_custom_roles.insert");
    return id;
  }
  async submit(id: string) {
    const row = this.mine(id);
    row.status = "pending_approval";
    this.log(id, "scholar.org_custom_roles.update");
  }
  async withdraw(id: string) {
    const row = this.mine(id);
    row.status = "draft";
    this.log(id, "scholar.org_custom_roles.update");
  }
  async approve(id: string) {
    const row = this.mine(id);
    // ADR-114 guard: approver is the caller and not the creator.
    if (row.createdBy === this.me.userId)
      throw mapDatabaseError({
        code: "42501",
        message: "four-eyes: a custom role is activated by a second administrator, not its creator",
      });
    for (const other of this.rows)
      if (other.orgId === row.orgId && other.code === row.code && other.status === "active")
        other.status = "retired";
    row.status = "active";
    row.approvedBy = this.me.userId;
    row.approvedAt = AT;
    this.log(id, "scholar.org_custom_roles.update");
  }
  async activate(id: string) {
    const row = this.mine(id);
    const code = assignableRoleCode(row.orgId, row.code);
    const template = CATALOGUE.templates.find((t) => t.code === row.baseTemplate)!;
    // Same shape as custom_role_activate: nav i -> responsibility with daily_priority i.
    this.catalogueRoles.set(code, {
      name: row.name,
      permissions: [...new Set([...template.mandatory, ...row.permissions])],
      navRows: row.layout.nav.map((n, i) => ({
        id: `nav-${i}`,
        code: `nav.x.${i + 1}`,
        label: n.label,
        dailyPriority: i,
        navId: n.id,
        navLabel: n.label,
        kind: "custom",
      })),
    });
    this.log(id, "role_assignment_audit_events.role_catalog");
    return code;
  }
  async defineResponsibility(input: ResponsibilityInput) {
    this.responsibilities.push(input);
    return "11111111-1111-4111-8111-111111111111";
  }
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(RoleBuilderError);
  await promise.catch((e: RoleBuilderError) => expect(e.code).toBe(code));
};

describe("M4 typed errors", () => {
  it("carries the code through a thrown message and maps database refusals", () => {
    const parsed = parseRoleBuilderError(new RoleBuilderError("FOUR_EYES", "second admin"));
    expect(parsed).toEqual({ code: "FOUR_EYES", message: "second admin" });
    expect(parseRoleBuilderError(new Error("boom")).code).toBe("UNKNOWN");
    expect(mapDatabaseError({ code: "42501", message: "four-eyes: x" }).code).toBe("FOUR_EYES");
    expect(mapDatabaseError({ code: "42501", message: "separation of duties: a + b" }).code).toBe(
      "SOD_VIOLATION",
    );
    expect(mapDatabaseError({ code: "42501", message: "protected permission x" }).code).toBe(
      "PROTECTED_PERMISSION",
    );
    expect(mapDatabaseError({ code: "42501", message: "no_self_role_grant" }).code).toBe(
      "SELF_GRANT",
    );
    expect(mapDatabaseError({ code: "42501", message: "not allowed" }).code).toBe("FORBIDDEN");
    expect(mapDatabaseError({ code: "22023", message: "bad" }).code).toBe("VALIDATION");
    expect(mapDatabaseError({ code: "42704", message: "missing" }).code).toBe("NOT_FOUND");
    expect(mapDatabaseError({ code: "55000", message: "pending" }).code).toBe("CONFLICT");
    expect(
      mapDatabaseError({
        code: "22023",
        message: "a delegation cannot end after its source assignment",
      }).code,
    ).toBe("DELEGATION_EXCEEDS_SOURCE");
  });
});

describe("M4 caller and organization", () => {
  it("refuses an unauthenticated caller, a caller without organization, and a non-admin", async () => {
    const port = new FakePort();
    port.me = { userId: "", orgId: ORG, isAdmin: true };
    await expectCode(handleLoadBuilder(port), "UNAUTHENTICATED");
    port.me = { userId: MEMBER, orgId: null, isAdmin: false };
    await expectCode(handleLoadBuilder(port), "NO_ORGANIZATION");
    port.as(MEMBER, { isAdmin: false });
    for (const run of [
      handleLoadBuilder(port),
      handleSaveDraft(port, draft()),
      handlePreview(port, draft()),
      handleSimulate(port, draft(), AT),
      handleDefineResponsibility(port, {
        code: "duty",
        label: "Duty",
        permissions: ["fees.view"],
        reviewCadenceDays: 30,
        navSection: { id: "duty", label: "Duty" },
      }),
    ])
      await expectCode(run, "FORBIDDEN");
    expect(port.calls).toEqual([]);
  });

  it("never takes the organization from input: a client org_id is ignored", async () => {
    const port = new FakePort().as(ADMIN_A);
    const { id } = await handleSaveDraft(port, { ...draft(), orgId: OTHER_ORG });
    expect(port.rows.find((r) => r.id === id)?.orgId).toBe(ORG);
  });
});

describe("M4 draft validation", () => {
  const port = () => new FakePort().as(ADMIN_A);
  it.each([
    ["a bad code", { slug: "Bad Code!" }],
    ["a short name", { name: "ab" }],
    ["duplicate permissions", { permissions: ["fees.view", "fees.view"] }],
    ["an unknown scope", { scopeCeiling: "planet" }],
    ["an unknown workspace category", { workspaceCategory: "elsewhere" }],
    [
      "four navigation sections",
      { layout: { nav: [...NAV, { id: "four", label: "Four" }], widgets: [] } },
    ],
    ["duplicate navigation ids", { layout: { nav: [NAV[0], NAV[0]], widgets: [] } }],
    [
      "a malformed navigation id",
      { layout: { nav: [{ id: "Has Space", label: "Ok" }], widgets: [] } },
    ],
  ])("refuses %s", async (_label, patch) => {
    const p = port();
    await expectCode(handleSaveDraft(p, { ...draft(), ...patch }), "VALIDATION");
    expect(p.calls).toEqual([]);
  });

  it("refuses a protected permission before the database sees it", async () => {
    const p = port();
    await expectCode(
      handleSaveDraft(p, draft({ permissions: ["fees.view", "payroll.approve"] })),
      "PROTECTED_PERMISSION",
    );
    expect(p.calls).toEqual([]);
  });

  it("refuses a scope wider than the base template", async () => {
    await expectCode(
      handleSaveDraft(
        port(),
        draft({ baseTemplate: "clerk_t", permissions: ["reports.view"], scopeCeiling: "org" }),
      ),
      "SCOPE_TOO_WIDE",
    );
  });

  it("blocks a SoD-violating draft with an explanation", async () => {
    const p = port();
    const bad = draft({ permissions: ["fees.view", "payments.reconcile"] });
    const preview = await handlePreview(p, bad);
    expect(preview.blocked).toBe(true);
    expect(preview.sod).toHaveLength(1);
    expect(preview.sod[0]).toMatchObject({
      a: "payments.record_cash",
      b: "payments.reconcile",
      fromBase: ["payments.record_cash"],
    });
    expect(preview.sod[0]!.explanation).toBe(
      "payments.record_cash and payments.reconcile cannot be held by one role: Cash recorded by a person is reconciled by someone else. Remove payments.reconcile, or give that duty to another role.",
    );
    const error = await handleSaveDraft(p, bad).catch((e: RoleBuilderError) => e);
    expect(error).toBeInstanceOf(RoleBuilderError);
    expect((error as RoleBuilderError).code).toBe("SOD_VIOLATION");
    expect((error as RoleBuilderError).detail).toContain("Cash recorded by a person");
    expect(p.calls).toEqual([]);
  });

  it("explains a SoD pair that comes entirely from the base template", () => {
    const [v] = analyseSod([], ["expenses.create", "expenses.approve"], CATALOGUE.sodRules);
    expect(v!.explanation).toContain("pick another base template");
  });

  it("rates risk from sensitivity and flags permissions outside the institution", () => {
    const low = previewDraft(
      draft({ baseTemplate: null, permissions: ["reports.view"] }),
      CATALOGUE,
    );
    expect(low.level).toBe("low");
    expect(previewDraft(draft(), CATALOGUE).level).toBe("medium");
    const outside = previewDraft(draft({ permissions: ["fees.view"] }), {
      ...CATALOGUE,
      allowedPermissions: [],
      templates: [],
    });
    expect(outside.scopeProblem).toBe("Unknown base template bursar_t.");
  });
});

describe("M4 simulate as", () => {
  it("computes the holder workspace with the existing manifest resolver, without writes", async () => {
    const port = new FakePort().as(ADMIN_A);
    const result = await handleSimulate(port, draft(), AT);
    expect(result.primaryNav).toEqual([
      { id: "collections", label: "Collections" },
      { id: "receipts", label: "Receipts" },
      { id: "reports", label: "Reports" },
    ]);
    expect(result.manifest?.category).toBe("administrative_operations");
    expect(result.permissions).toEqual([
      "fees.collect",
      "fees.view",
      "payments.record_cash",
      "reports.view",
    ]);
    expect(port.calls).toEqual([]);
    expect(port.rows).toEqual([]);
  });

  it("gives no workspace for fewer than three sections and explains hidden widgets", () => {
    const two = simulateDraft(
      draft({ layout: { nav: NAV.slice(0, 2), widgets: ["w.nothing"] } }),
      CATALOGUE,
      AT,
    );
    expect(two.manifest).toBeNull();
    expect(two.widgets).toEqual([
      { key: "w.nothing", label: "w.nothing", shown: false, reason: "not a catalogue widget" },
    ]);
  });
});

describe("M4 approval workflow handlers", () => {
  it("refuses submit with fewer than three sections, and transitions in the wrong state", async () => {
    const port = new FakePort().as(ADMIN_A);
    const { id } = await handleSaveDraft(
      port,
      draft({ layout: { nav: NAV.slice(0, 2), widgets: [] } }),
    );
    await expectCode(handleSubmit(port, { id }), "VALIDATION");
    await expectCode(handleApprove(port.as(ADMIN_B), { id }), "CONFLICT");
    await expectCode(handleActivate(port, { id }), "CONFLICT");
    await expectCode(handleSubmit(port, { id: "not-a-uuid" }), "VALIDATION");
    await expectCode(
      handleSubmit(port, { id: "99999999-9999-4999-8999-999999999999" }),
      "NOT_FOUND",
    );
  });

  it("refuses editing while pending (database CONFLICT) and allows it after withdraw", async () => {
    const port = new FakePort().as(ADMIN_A);
    const { id } = await handleSaveDraft(port, draft());
    await handleSubmit(port, { id });
    await expectCode(handleSaveDraft(port, draft({ name: "Fees desk two" })), "CONFLICT");
    await handleWithdraw(port, { id });
    await handleSaveDraft(port, draft({ name: "Fees desk two" }));
    expect(port.rows).toHaveLength(1);
    expect(port.rows[0]!.name).toBe("Fees desk two");
  });

  it("refuses the creator's approval cleanly, and surfaces the database's own four-eyes refusal", async () => {
    const port = new FakePort().as(ADMIN_A);
    const { id } = await handleSaveDraft(port, draft());
    await handleSubmit(port, { id });
    const error = await handleApprove(port, { id }).catch((e: RoleBuilderError) => e);
    expect((error as RoleBuilderError).code).toBe("FOUR_EYES");
    // If the handler's check were bypassed, the database refusal maps to the same code.
    const dbError = await port.approve(id).catch((e: RoleBuilderError) => e);
    expect((dbError as RoleBuilderError).code).toBe("FOUR_EYES");
    expect(port.rows[0]!.status).toBe("pending_approval");
  });

  it("refuses activating a scratch role for assignment", async () => {
    const port = new FakePort().as(ADMIN_A);
    const { id } = await handleSaveDraft(
      port,
      draft({ baseTemplate: null, permissions: ["reports.view"] }),
    );
    await handleSubmit(port, { id });
    await handleApprove(port.as(ADMIN_B), { id });
    await expectCode(handleActivate(port, { id }), "VALIDATION");
  });

  it("refuses a malformed history code", async () => {
    await expectCode(handleHistory(new FakePort(), { code: "fees_desk" }), "VALIDATION");
  });
});

describe("M4 end to end (unit level): A creates, B approves, holder sees exactly the three sections", () => {
  it("runs the whole story and keeps an audit trail", async () => {
    const port = new FakePort();
    const { id } = await handleSaveDraft(port.as(ADMIN_A), draft());
    await handleSubmit(port, { id });
    await expectCode(handleApprove(port, { id }), "FOUR_EYES");
    await handleApprove(port.as(ADMIN_B), { id });
    const { roleCode } = await handleActivate(port, { id });
    expect(roleCode).toBe("custom.aaaaaaaa000000000000000000000001.fees_desk");

    const role = port.catalogueRoles.get(roleCode)!;
    const workspace = holderWorkspace({
      orgId: ORG,
      userId: MEMBER,
      roleCode,
      roleName: role.name,
      category: "administrative_operations",
      navRows: role.navRows,
      permissions: role.permissions,
      at: AT,
    });
    expect(workspace?.primaryNav.map((s) => s.label)).toEqual([
      "Collections",
      "Receipts",
      "Reports",
    ]);
    expect(workspace?.primaryNav).toHaveLength(3);
    expect(workspace?.sidePanel).toHaveLength(3);

    // A delegate covering the holder sees the same three sections.
    const delegated = holderWorkspace({
      orgId: ORG,
      userId: ADMIN_A,
      delegatedFromUserId: MEMBER,
      roleCode,
      roleName: role.name,
      category: "administrative_operations",
      navRows: role.navRows,
      permissions: role.permissions,
      at: AT,
    });
    expect(delegated?.primaryNav.map((s) => s.id)).toEqual(["collections", "receipts", "reports"]);

    const history = await handleHistory(port, { code: "custom.fees_desk" });
    expect(history.versions.map((v) => `${v.version}:${v.status}`)).toEqual(["1:active"]);
    expect(history.audit.map((a) => [a.action, a.actor])).toEqual([
      ["scholar.org_custom_roles.insert", ADMIN_A],
      ["scholar.org_custom_roles.update", ADMIN_A],
      ["scholar.org_custom_roles.update", ADMIN_B],
      ["role_assignment_audit_events.role_catalog", ADMIN_B],
    ]);

    // Version 2 retires version 1 on approval.
    const v2 = await handleSaveDraft(port.as(ADMIN_A), draft({ permissions: ["fees.view"] }));
    await handleSubmit(port, { id: v2.id });
    await handleApprove(port.as(ADMIN_B), { id: v2.id });
    const after = await handleHistory(port, { code: "custom.fees_desk" });
    expect(after.versions.map((v) => `${v.version}:${v.status}`)).toEqual([
      "2:active",
      "1:retired",
    ]);
  });
});

describe("M4 custom responsibility builder", () => {
  const base = {
    code: "duty_master",
    label: "Duty master",
    description: "Week duty",
    permissions: ["fees.view"],
    evidenceRequired: ["Duty rota signed"],
    reviewCadenceDays: 30,
    navSection: { id: "duty", label: "Duty" },
  };
  it("saves name, description, permissions, evidence and cadence", async () => {
    const port = new FakePort().as(ADMIN_A);
    await handleDefineResponsibility(port, base);
    expect(port.responsibilities[0]).toMatchObject({
      code: "duty_master",
      evidenceRequired: ["Duty rota signed"],
      reviewCadenceDays: 30,
      dailyPriority: 100,
    });
  });
  it.each([
    ["no permission", { permissions: [] }, "VALIDATION"],
    ["a cadence under a week", { reviewCadenceDays: 3 }, "VALIDATION"],
    ["the reserved nav. prefix", { code: "nav.mine" }, "VALIDATION"],
    ["an unknown permission", { permissions: ["ghost.perm"] }, "VALIDATION"],
    ["a protected permission", { permissions: ["payroll.approve"] }, "PROTECTED_PERMISSION"],
    ["a SoD pair", { permissions: ["expenses.create", "expenses.approve"] }, "SOD_VIOLATION"],
  ])("refuses %s", async (_label, patch, code) => {
    const port = new FakePort().as(ADMIN_A);
    await expectCode(handleDefineResponsibility(port, { ...base, ...patch }), code);
    expect(port.responsibilities).toEqual([]);
  });
});
