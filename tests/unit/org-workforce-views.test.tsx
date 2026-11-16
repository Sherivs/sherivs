import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ORG_AGENTS } from "../../frontend/src/lib/org-workforce/org-agents";
import {
  ADD_ONS_NOT_APPLIED,
  buildOrgRoster,
} from "../../frontend/src/lib/org-workforce/roster-view";
import {
  needsConfirmation,
  parseRoleContext,
  planCustomGrant,
  planOptionalChanges,
  planRemoveCustomGrant,
} from "../../frontend/src/lib/org-workforce/role-packet-view";
import {
  parsePolicyList,
  planPolicyChanges,
} from "../../frontend/src/lib/org-workforce/policy-view";
import {
  OrgAgentRosterPanel,
  RolePacketPanel,
  WorkspacePolicyPanel,
} from "../../frontend/src/components/app-shell/org-workforce-panels";

const tenant = (tier: string | null, active = true) => ({ tenantId: "t1", tier, active });

describe("ENGINE-19 agent roster", () => {
  it("lists all 17, split by plan, with counts that add up for every plan", () => {
    for (const [tier, included] of [
      ["trial", 1],
      ["starter", 5],
      ["growth", 12],
      ["professional", 16],
      ["enterprise", 17],
    ] as const) {
      const v = buildOrgRoster({ tenant: tenant(tier) });
      expect(v.included).toHaveLength(included);
      expect(v.included.length + v.upgrade.length).toBe(17);
      expect(v.summary).toMatchObject({ included, total: 17 });
      expect(v.upgrade.every((c) => c.status === "locked")).toBe(true);
    }
  });

  it("names the next plan and what it adds", () => {
    expect(buildOrgRoster({ tenant: tenant("trial") }).summary.next).toEqual({
      tier: "starter",
      label: "Starter",
      adds: 4,
    });
    expect(buildOrgRoster({ tenant: tenant("starter") }).summary.next).toEqual({
      tier: "growth",
      label: "Growth",
      adds: 7,
    });
    expect(buildOrgRoster({ tenant: tenant("enterprise") }).summary.next).toBeNull();
  });

  it("an unknown plan is shown as the trial", () => {
    const v = buildOrgRoster({ tenant: tenant("mystery") });
    expect(v).toMatchObject({ tier: "trial", planLabel: "Trial" });
    expect(v.included).toHaveLength(1);
  });

  it("an included agent can't be switched on until the add-on table exists, and says why", () => {
    const v = buildOrgRoster({ tenant: tenant("enterprise") });
    for (const c of v.included) {
      expect(c.status).toBe("available");
      expect(c.switchOn).toEqual({ enabled: false, disabledReason: ADD_ONS_NOT_APPLIED });
    }
    const applied = buildOrgRoster({ tenant: tenant("enterprise"), addOnsApplied: true });
    expect(applied.included.every((c) => c.switchOn.enabled)).toBe(true);
  });

  it("a locked agent says which plan includes it and can never be switched on", () => {
    const v = buildOrgRoster({ tenant: tenant("trial"), addOnsApplied: true });
    const fees = v.upgrade.find((c) => c.code === "org-fees")!;
    expect(fees).toMatchObject({
      minTierLabel: "Starter",
      switchOn: { enabled: false, disabledReason: "Included from the Starter plan." },
    });
  });

  it("an inactive organization shows no agent as runnable", () => {
    const v = buildOrgRoster({ tenant: tenant("enterprise", false), addOnsApplied: true });
    expect(v.organizationActive).toBe(false);
    expect(v.included.every((c) => c.status === "tenant_inactive" && !c.switchOn.enabled)).toBe(
      true,
    );
  });

  it("running agents sort first and every card says it starts in shadow", () => {
    const v = buildOrgRoster({
      tenant: tenant("starter"),
      members: [{ identityId: "b", role: "bursar", active: true, invitation: "accepted" }],
      enabledCodes: ["org-fees"],
      pausedCodes: ["org-attendance"],
    });
    expect(v.included[0]).toMatchObject({ code: "org-fees", status: "active" });
    expect(v.included.every((c) => c.startsInShadow)).toBe(true);
    expect(v.included.find((c) => c.code === "org-attendance")!.status).toBe("available");
  });

  it("capability counts match each agent's pack", () => {
    const v = buildOrgRoster({ tenant: tenant("enterprise") });
    for (const c of v.included) {
      const agent = ORG_AGENTS.find((a) => a.pack.code === c.code)!;
      expect(
        c.capabilities.reads + c.capabilities.needsApproval + c.capabilities.proposesOnly,
      ).toBe(agent.pack.capabilities.length);
    }
  });

  it("renders the roster, the upgrade section, and the disabled switch with its reason", () => {
    const html = renderToStaticMarkup(
      <OrgAgentRosterPanel view={buildOrgRoster({ tenant: tenant("starter") })} />,
    );
    expect(html).toContain("5 of 17 agents are included in your plan.");
    expect(html).toContain("Growth adds 7 more.");
    expect(html).toContain('data-testid="roster-upgrade"');
    expect(html).toContain(ADD_ONS_NOT_APPLIED);
    expect(html).toContain("Included from the Growth plan.");
    expect(html).toContain("disabled");
    const inactive = renderToStaticMarkup(
      <OrgAgentRosterPanel view={buildOrgRoster({ tenant: tenant("starter", false) })} />,
    );
    expect(inactive).toContain("Your organization is not active");
  });
});

const perm = (code: string, over: object = {}) => ({
  code,
  module: "m",
  label: `Label ${code}`,
  sensitivity: "internal",
  protected: false,
  ...over,
});
const CONTEXT = {
  role: {
    code: "bursar",
    name: "Bursar",
    category: "Finance",
    template: "bursar",
    custom: false,
    base_role: null,
  },
  scope: "org",
  data_sensitivity: "restricted",
  approval_limit_ngn: 500000,
  guardrails: [{ code: "audited", description: "Every action is audited" }],
  mandatory: [perm("fees.view")],
  optional: [
    { ...perm("payments.reconcile"), default_on: true, enabled: true },
    {
      ...perm("payments.refund", { sensitivity: "restricted", protected: true }),
      default_on: false,
      enabled: false,
    },
    { ...perm("reports.financial"), default_on: false, enabled: false },
  ],
  custom_grants: [{ id: "g1", permission: "news.publish", custom_key: null, context: {} }],
  sod_conflicts: ["auditor"],
};
const view = parseRoleContext(CONTEXT)!;

describe("ENGINE-19 role packet", () => {
  it("parses the server answer and rejects anything else", () => {
    expect(view.role).toMatchObject({ code: "bursar", custom: false });
    expect(view.mandatory.map((p) => p.code)).toEqual(["fees.view"]);
    expect(view.optional.map((p) => [p.code, p.enabled])).toEqual([
      ["payments.reconcile", true],
      ["payments.refund", false],
      ["reports.financial", false],
    ]);
    expect(view.customGrants).toEqual([{ id: "g1", permission: "news.publish", customKey: null }]);
    expect(view.conflictingTemplates).toEqual(["auditor"]);
    for (const bad of [null, undefined, "x", [], {}, { role: {} }, { role: { code: "a" } }]) {
      expect(parseRoleContext(bad)).toBeNull();
    }
    expect(parseRoleContext({ role: { code: "r", template: "t" } })).toMatchObject({
      mandatory: [],
      optional: [],
      customGrants: [],
    });
  });

  it("an optional permission with no explicit setting follows its default", () => {
    const v = parseRoleContext({
      ...CONTEXT,
      optional: [
        { ...perm("x"), default_on: true },
        { ...perm("y"), default_on: false },
      ],
    })!;
    expect(v.optional.map((p) => p.enabled)).toEqual([true, false]);
  });

  const plan = (desired: Record<string, boolean>, over: object = {}) =>
    planOptionalChanges({ orgId: "o1", view, desired, callerHoldsRole: false, ...over });

  it("plans one server call per real change and skips no-ops", () => {
    const p = plan({
      "payments.reconcile": false,
      "reports.financial": true,
      "reports.financial ": true,
    });
    expect(p.calls).toEqual(
      [
        {
          rpc: "role_set_optional",
          args: {
            p_org: "o1",
            p_role: "bursar",
            p_permission: "payments.reconcile",
            p_enabled: false,
          },
        },
        {
          rpc: "role_set_optional",
          args: {
            p_org: "o1",
            p_role: "bursar",
            p_permission: "reports.financial",
            p_enabled: true,
          },
        },
      ].sort((a, b) => String(a.args.p_permission).localeCompare(String(b.args.p_permission))),
    );
    expect(plan({ "payments.reconcile": true }).calls).toEqual([]);
  });

  it("a mandatory permission cannot be switched off and an unknown one is refused", () => {
    expect(plan({ "fees.view": false }).blocked).toEqual([
      { code: "fees.view", reason: "mandatory" },
    ]);
    expect(plan({ "nope.nope": true }).blocked).toEqual([
      { code: "nope.nope", reason: "not_in_packet" },
    ]);
    expect(plan({ "fees.view": false, "nope.nope": true }).calls).toEqual([]);
  });

  it("a sensitive permission waits for confirmation, then goes", () => {
    expect(needsConfirmation({ protected: true, sensitivity: "internal" })).toBe(true);
    expect(needsConfirmation({ protected: false, sensitivity: "restricted" })).toBe(true);
    expect(needsConfirmation({ protected: false, sensitivity: "confidential" })).toBe(false);
    const waiting = plan({ "payments.refund": true });
    expect(waiting).toMatchObject({ calls: [], awaitingConfirmation: ["payments.refund"] });
    expect(
      plan({ "payments.refund": true }, { confirmed: ["payments.refund"] }).calls,
    ).toHaveLength(1);
    // switching a sensitive permission OFF never needs confirmation
    const on = parseRoleContext({
      ...CONTEXT,
      optional: [
        { ...perm("payments.refund", { protected: true }), default_on: true, enabled: true },
      ],
    })!;
    expect(
      planOptionalChanges({
        orgId: "o1",
        view: on,
        desired: { "payments.refund": false },
        callerHoldsRole: false,
      }).calls,
    ).toHaveLength(1);
  });

  it("someone who holds the role cannot change it, whatever they ask for", () => {
    const p = plan(
      { "reports.financial": true, "payments.reconcile": false },
      { callerHoldsRole: true },
    );
    expect(p.calls).toEqual([]);
    expect(p.blocked.map((b) => b.reason)).toEqual(["you_hold_this_role", "you_hold_this_role"]);
  });

  const catalog = [
    { code: "news.publish", protected: false, sensitivity: "internal" },
    { code: "attendance.view", protected: false, sensitivity: "internal" },
    { code: "ndpa.dsar", protected: true, sensitivity: "restricted" },
    { code: "fees.view", protected: false, sensitivity: "internal" },
    { code: "payments.reconcile", protected: false, sensitivity: "internal" },
    { code: "reports.financial", protected: false, sensitivity: "internal" },
  ];
  const grant = (permission: string, over: object = {}) =>
    planCustomGrant({ orgId: "o1", view, permission, catalog, callerHoldsRole: false, ...over });

  it("a custom grant must be in the catalog and not already carried", () => {
    expect(grant("attendance.view").calls).toEqual([
      {
        rpc: "role_add_custom_grant",
        args: { p_org: "o1", p_role: "bursar", p_permission: "attendance.view" },
      },
    ]);
    expect(grant("zzz").blocked).toEqual([{ code: "zzz", reason: "not_in_catalog" }]);
    for (const carried of ["fees.view", "payments.reconcile", "news.publish"]) {
      expect(grant(carried).blocked).toEqual([{ code: carried, reason: "already_granted" }]);
    }
    expect(grant("reports.financial").blocked).toEqual([]);
  });

  it("a sensitive custom grant needs confirmation; holding the role blocks it", () => {
    expect(grant("ndpa.dsar")).toMatchObject({ calls: [], awaitingConfirmation: ["ndpa.dsar"] });
    expect(grant("ndpa.dsar", { confirmed: ["ndpa.dsar"] }).calls).toHaveLength(1);
    expect(grant("attendance.view", { callerHoldsRole: true }).blocked[0]!.reason).toBe(
      "you_hold_this_role",
    );
    expect(grant("attendance.view", { customKey: "k" }).calls[0]!.args).toMatchObject({
      p_custom_key: "k",
    });
  });

  it("removing a grant targets only a grant of this role, and not by the holder", () => {
    expect(planRemoveCustomGrant(view, "g1", false).calls).toEqual([
      { rpc: "role_remove_custom_grant", args: { p_grant: "g1" } },
    ]);
    expect(planRemoveCustomGrant(view, "other", false).blocked[0]!.reason).toBe("not_in_packet");
    expect(planRemoveCustomGrant(view, "g1", true).blocked[0]!.reason).toBe("you_hold_this_role");
  });

  const renderPacket = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <RolePacketPanel
        view={view}
        desired={{}}
        plan={{ calls: [], blocked: [], awaitingConfirmation: [] }}
        callerHoldsRole={false}
        busy={false}
        onToggle={() => {}}
        onConfirm={() => {}}
        onApply={() => {}}
        onRemoveGrant={() => {}}
        {...over}
      />,
    );

  it("renders the packet: locked mandatory, switchable optional, guardrails, conflicts, custom grants", () => {
    const html = renderPacket();
    expect(html).toContain("Bursar");
    expect(html).toContain("approves up to ₦500,000");
    expect(html).toContain("Never combine with: auditor.");
    expect(html).toContain("Every action is audited");
    expect(html).toContain('data-testid="perm-fees.view"');
    expect(html).toMatch(/perm-fees\.view"><input[^>]*disabled=""[^>]*checked=""/);
    expect(html).toContain('data-testid="sensitive-payments.refund"');
    expect(html).toContain('data-testid="packet-custom"');
    expect(html).toContain("Save 0 changes");
  });

  it("renders the self-hold notice, disables toggles, and shows blocked reasons and confirmation", () => {
    const held = renderPacket({ callerHoldsRole: true });
    expect(held).toContain('data-testid="self-hold"');
    expect(held).toContain("You hold this role");
    const waiting = renderPacket({
      plan: {
        calls: [],
        blocked: [{ code: "x.y", reason: "mandatory" }],
        awaitingConfirmation: ["payments.refund"],
      },
      desired: { "payments.refund": true },
    });
    expect(waiting).toContain("Confirm payments.refund");
    expect(waiting).toContain("always comes with the role");
  });
});

const POLICIES = {
  policies: [
    {
      key: "workspace.personalise",
      label: "Staff may personalise their workspace",
      default: true,
      enabled: true,
    },
    {
      key: "workspace.hide_finance",
      label: "Hide finance from teachers",
      default: false,
      enabled: false,
    },
  ],
  modules: [
    { key: "cbt", enabled: true },
    { key: "hostel", enabled: false },
  ],
};

describe("ENGINE-19 workspace policies", () => {
  const v = parsePolicyList(POLICIES)!;
  it("parses the server answer and rejects anything else", () => {
    expect(v.policies.map((p) => [p.key, p.enabled, p.defaultOn])).toEqual([
      ["workspace.personalise", true, true],
      ["workspace.hide_finance", false, false],
    ]);
    expect(v.modules).toEqual([
      { key: "cbt", enabled: true },
      { key: "hostel", enabled: false },
    ]);
    for (const bad of [null, "x", [], {}, { policies: "no" }])
      expect(parsePolicyList(bad)).toBeNull();
    expect(parsePolicyList({ policies: [] })).toEqual({ policies: [], modules: [] });
    expect(
      parsePolicyList({
        policies: [],
        modules: [{ key: "cbt" }, { key: "hostel", enabled: false }],
      })!.modules,
    ).toEqual([
      { key: "cbt", enabled: true },
      { key: "hostel", enabled: false },
    ]);
  });

  it("plans a call only for real changes and reports unknown keys", () => {
    const p = planPolicyChanges({
      orgId: "o1",
      view: v,
      policies: { "workspace.hide_finance": true, "workspace.personalise": true, bogus: true },
      modules: { hostel: true, cbt: true, ghost: false },
    });
    expect(p.calls).toEqual([
      {
        rpc: "workspace_policy_set",
        args: { p_org: "o1", p_policy: "workspace.hide_finance", p_enabled: true },
      },
      { rpc: "workspace_feature_set", args: { p_org: "o1", p_feature: "hostel", p_enabled: true } },
    ]);
    expect(p.unknown).toEqual(["bogus", "ghost"]);
  });

  it("renders policies and modules with the pending count", () => {
    const html = renderToStaticMarkup(
      <WorkspacePolicyPanel
        view={v}
        desiredPolicies={{}}
        desiredModules={{}}
        pendingChanges={2}
        busy={false}
        onPolicy={() => {}}
        onModule={() => {}}
        onApply={() => {}}
      />,
    );
    expect(html).toContain("Hide finance from teachers");
    expect(html).toContain("(off by default)");
    expect(html).toContain('data-testid="module-hostel"');
    expect(html).toContain("Save 2 changes");
  });
});
