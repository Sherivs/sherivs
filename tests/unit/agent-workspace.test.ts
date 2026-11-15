import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTION_MAP,
  validateActionCoverage,
} from "../../frontend/src/lib/jarvis-bridge/approval-bridge.server";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import { COMPLETION_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/completion-workforce-packs";
import { EXPANSION_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/expansion-workforce-packs";
import { PLATFORM_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/platform-workforce-packs";
import { tierRank, validateRolePack } from "../../frontend/src/lib/twin-engine/role-pack";
import { validateCharter, validateRoster } from "../../frontend/src/lib/workforce-charter/charter";
import { COMPLETION_CHARTERS } from "../../frontend/src/lib/workforce-charter/charters/completion-charters";
import { EXISTING_CHARTERS } from "../../frontend/src/lib/workforce-charter/charters/existing-charters";
import { EXPANSION_CHARTERS } from "../../frontend/src/lib/workforce-charter/charters/expansion-charters";
import {
  authorizeScope,
  validateWorkspace,
  validateWorkspaces,
  type AgentWorkspace,
  type ScopeRequest,
} from "../../frontend/src/lib/workforce-charter/workspace";
import { WORKFORCE_WORKSPACES } from "../../frontend/src/lib/workforce-charter/workspaces/workforce-workspaces";

const allPacks = [
  ...PLATFORM_WORKFORCE_PACKS,
  JARVIS_EXECUTIVE_PACK,
  ...EXPANSION_WORKFORCE_PACKS,
  ...COMPLETION_WORKFORCE_PACKS,
];
const allCharters = [...EXISTING_CHARTERS, ...EXPANSION_CHARTERS, ...COMPLETION_CHARTERS];
const packOf = (code: string) => allPacks.find((p) => p.code === code)!;
const charterOf = (code: string) => allCharters.find((c) => c.packCode === code)!;
const wsOf = (code: string) => WORKFORCE_WORKSPACES.find((w) => w.packCode === code)!;
const roster = allCharters.map((charter) => ({ charter, pack: packOf(charter.packCode) }));
const entries = allCharters.map((c) => ({ pack: packOf(c.packCode), charter: c }));
const rolesSql = readFileSync("database/proposals/ENGINE-13_workforce_roles.sql", "utf8");
const scopeSql = readFileSync("database/proposals/ENGINE-13_agent_workspace_scope.sql", "utf8");

const NEW_NAMES: Readonly<Record<string, string>> = {
  "onboarding-agent": "Bridge",
  "safeguarding-agent": "Warden",
  "qa-agent": "Gauge",
  "evaluation-agent": "Proctor",
  "marketing-agent": "Echo",
  "localisation-agent": "Griot",
  "data-agent": "Prism",
  "legal-agent": "Brief",
  "people-agent": "Keystone",
  "investor-agent": "Beacon",
};

const clone = (w: AgentWorkspace): AgentWorkspace =>
  JSON.parse(JSON.stringify(w)) as AgentWorkspace;
const problemsFor = (code: string, w: AgentWorkspace) =>
  validateWorkspace(w, packOf(code), charterOf(code));
const has = (problems: readonly string[], text: string) => problems.some((p) => p.includes(text));

describe("ENGINE-13 the ten remaining agents", () => {
  it("adds ten named agents in a fixed order", () => {
    expect(COMPLETION_WORKFORCE_PACKS.map((p) => p.code)).toEqual(Object.keys(NEW_NAMES));
    for (const [code, name] of Object.entries(NEW_NAMES)) {
      expect(charterOf(code).codename, code).toBe(name);
    }
    expect(COMPLETION_CHARTERS).toHaveLength(COMPLETION_WORKFORCE_PACKS.length);
  });

  it("every codename in the workforce is unique", () => {
    const names = allCharters.map((c) => c.codename.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(25);
  });

  it("every pack is valid, starts in shadow and never declares T4", () => {
    for (const p of COMPLETION_WORKFORCE_PACKS) {
      expect(validateRolePack(p), p.code).toEqual([]);
      expect(p.startsInShadow).toBe(true);
      expect(p.kind).toBe("platform_role");
      expect(p.memory.crossTenant).toBe(false);
      for (const c of p.capabilities) expect(tierRank(c.tier)).toBeLessThanOrEqual(tierRank("T3"));
    }
  });

  it("every charter is sound for its pack", () => {
    for (const c of COMPLETION_CHARTERS) {
      expect(validateCharter(c, packOf(c.packCode)), c.packCode).toEqual([]);
    }
  });

  it("the twenty-five agent roster has no problems and full action coverage", () => {
    expect(roster).toHaveLength(25);
    expect(validateRoster(roster)).toEqual([]);
    expect(validateActionCoverage(allPacks)).toEqual([]);
  });

  it("the evaluation agent is independent: assurance tier, sheriff only, verify duties, read-only", () => {
    const c = charterOf("evaluation-agent");
    expect(c.agentTier).toBe("assurance");
    expect(c.supervisor).toBe("sheriff");
    expect(c.accountable).toBe("sheriff");
    expect(c.killScope).toBe("agent");
    expect(c.handoffs).toEqual([]);
    expect(Object.values(c.duties)).not.toContain("originate");
    expect(packOf("evaluation-agent").capabilities.every((x) => x.connector === undefined)).toBe(
      true,
    );
    const assurance = allCharters.filter((x) => x.agentTier === "assurance").map((x) => x.packCode);
    expect(assurance.sort()).toEqual(["evaluation-agent", "sentinel-agent"]);
  });

  it("only two new agents hold a T3 capability, and the sheriff decides both", () => {
    const t3 = COMPLETION_WORKFORCE_PACKS.flatMap((p) =>
      p.capabilities.filter((c) => c.tier === "T3").map((c) => [p.code, c.id, c.approver] as const),
    );
    expect(t3).toEqual([
      ["marketing-agent", "publish.social.post", "sheriff"],
      ["people-agent", "request.access.grant", "sheriff"],
    ]);
  });

  it("marketing owns public posting; sales and JARVIS may only ask it; people only asks for access", () => {
    expect(charterOf("marketing-agent").t3Rules["publish.social.post"]).toBe("owner");
    expect(charterOf("sales-agent").t3Rules["publish.social.post"]).toBe(
      "delegate_requires_owner_proposal",
    );
    expect(charterOf("jarvis-executive").t3Rules["publish.social.post"]).toBe(
      "delegate_requires_owner_proposal",
    );
    expect(charterOf("people-agent").t3Rules["request.access.grant"]).toBe(
      "delegate_requires_owner_proposal",
    );
    expect(charterOf("jarvis-executive").t3Rules["request.access.grant"]).toBe("owner");
  });

  it("the four customer-visible sends are mapped to the existing approval action", () => {
    for (const id of [
      "send.welcome.pack",
      "notify.designated.lead",
      "send.newsletter",
      "send.legal.notice",
    ]) {
      expect(ACTION_MAP[id], id).toBe("send_customer_communications");
    }
  });

  it("only the safeguarding agent among the new ten holds restricted memory", () => {
    const restricted = COMPLETION_WORKFORCE_PACKS.filter(
      (p) => p.memory.maxSensitivity === "restricted",
    );
    expect(restricted.map((p) => p.code)).toEqual(["safeguarding-agent"]);
  });

  it("each new platform role and permission is in the role proposal and the applied migration", () => {
    for (const p of COMPLETION_WORKFORCE_PACKS) {
      for (const role of p.appliesTo) expect(rolesSql, role).toContain(`('${role}',`);
      for (const perm of p.permissions) expect(rolesSql, perm).toContain(`'${perm}'`);
    }
    const applied = readFileSync(
      "database/supabase/migrations/20261115000700_sherivs_engine11_13_platform_roles.sql",
      "utf8",
    );
    for (const p of COMPLETION_WORKFORCE_PACKS) {
      for (const role of p.appliesTo) expect(applied, role).toContain(`('${role}',`);
      for (const perm of p.permissions) expect(applied, perm).toContain(`'${perm}'`);
    }
    expect(applied).not.toMatch(/,\s*true,\s*\d+\)/);
    expect(rolesSql).toContain("APPLIED TO PRODUCTION");
    expect(rolesSql).not.toMatch(/,\s*true,\s*\d+\)/);
    expect(rolesSql).toContain("-- Rollback");
  });
});

describe("ENGINE-13 workspaces are complete and sound", () => {
  it("there is exactly one workspace per agent and every one is sound", () => {
    expect(WORKFORCE_WORKSPACES).toHaveLength(25);
    expect(validateWorkspaces(WORKFORCE_WORKSPACES, entries)).toEqual([]);
  });

  it("reports a missing, duplicated or unknown workspace", () => {
    const missing = WORKFORCE_WORKSPACES.filter((w) => w.packCode !== "legal-agent");
    expect(has(validateWorkspaces(missing, entries), "legal-agent: no workspace")).toBe(true);
    const dup = [...WORKFORCE_WORKSPACES, wsOf("legal-agent")];
    expect(has(validateWorkspaces(dup, entries), "duplicate workspace for legal-agent")).toBe(true);
    const extra = [
      ...WORKFORCE_WORKSPACES,
      { ...clone(wsOf("legal-agent")), packCode: "ghost-agent" },
    ];
    expect(has(validateWorkspaces(extra, entries), "unknown agent ghost-agent")).toBe(true);
  });

  it("every agent has the three base resources, with proposals as propose-only", () => {
    for (const w of WORKFORCE_WORKSPACES) {
      const byName = new Map(w.scopes.map((s) => [s.resource, s]));
      expect(byName.get("agent_runs")?.access, w.packCode).toBe("write_own");
      expect(byName.get("agent_memory")?.access, w.packCode).toBe("write_own");
      expect(byName.get("agent_proposals")?.access, w.packCode).toBe("propose");
    }
  });

  it("only support, compliance and safeguarding can reach organization rows, each under a stated rule", () => {
    const reaching = WORKFORCE_WORKSPACES.filter((w) =>
      w.scopes.some((s) => s.rowScope === "tenant_with_grant" || s.rowScope === "tenant_flagged"),
    ).map((w) => w.packCode);
    expect(reaching.sort()).toEqual(["compliance-agent", "safeguarding-agent", "support-agent"]);
    for (const w of WORKFORCE_WORKSPACES) {
      for (const s of w.scopes) {
        if (s.rowScope === "tenant_with_grant") {
          expect(s.grantMaxMinutes, `${w.packCode} ${s.resource}`).toBeLessThanOrEqual(120);
        }
        if (s.rowScope === "tenant_with_grant" || s.rowScope === "tenant_flagged") {
          expect(s.access).toBe("read");
        }
      }
    }
  });

  it("no scope exceeds its agent's context ceiling and nothing can delete", () => {
    for (const w of WORKFORCE_WORKSPACES) {
      const ceiling = charterOf(w.packCode).modelPolicy.contextCeiling;
      const rank = { public: 0, internal: 1, restricted: 2 } as const;
      for (const s of w.scopes) {
        expect(rank[s.sensitivity], `${w.packCode} ${s.resource}`).toBeLessThanOrEqual(
          rank[ceiling],
        );
        expect(["read", "write_own", "propose"]).toContain(s.access);
      }
    }
  });

  it("every agent states what it never does, starting with Never", () => {
    for (const w of WORKFORCE_WORKSPACES) {
      expect(w.boundaries.length, w.packCode).toBeGreaterThanOrEqual(3);
      for (const b of w.boundaries)
        expect(b.startsWith("Never "), `${w.packCode}: ${b}`).toBe(true);
    }
  });

  it("every agent has a workbench with a pause action and a proposals review action", () => {
    for (const w of WORKFORCE_WORKSPACES) {
      const kinds = w.ui.quickActions.map((a) => a.kind);
      expect(kinds, w.packCode).toContain("pause_agent");
      expect(kinds, w.packCode).toContain("review_proposals");
      for (const q of w.ui.queues) {
        expect(
          w.scopes.map((s) => s.resource),
          `${w.packCode} ${q.id}`,
        ).toContain(q.source);
      }
    }
  });

  it("the assurance agents never read organization rows or create work orders", () => {
    for (const code of ["sentinel-agent", "evaluation-agent"]) {
      const w = wsOf(code);
      expect(
        w.scopes.some(
          (s) => s.rowScope.startsWith("tenant_with") || s.rowScope === "tenant_flagged",
        ),
      ).toBe(false);
      expect(w.scopes.map((s) => s.resource)).not.toContain("work_orders");
    }
  });

  it("sales no longer lists posting among its boundaries as something it requests directly", () => {
    expect(wsOf("sales-agent").boundaries.join(" ")).toContain(
      "marketing agent owns public posting",
    );
  });
});

describe("ENGINE-13 workspace validator rejects every unsafe change", () => {
  const base = () => clone(wsOf("support-agent"));

  it("passes the untouched workspace", () => {
    expect(problemsFor("support-agent", base())).toEqual([]);
  });

  it("rejects a schema violation without throwing", () => {
    const bad = { ...base(), extra: true } as unknown;
    expect(
      validateWorkspace(bad, packOf("support-agent"), charterOf("support-agent")).length,
    ).toBeGreaterThan(0);
    expect(
      validateWorkspace(null, packOf("support-agent"), charterOf("support-agent")).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a workspace for the wrong agent", () => {
    const w = { ...base(), packCode: "finance-agent" };
    expect(has(problemsFor("support-agent", w), "workspace names finance-agent")).toBe(true);
  });

  it("rejects a duplicate resource and a missing base resource", () => {
    const dup = base();
    dup.scopes.push({ ...dup.scopes[0]! });
    expect(has(problemsFor("support-agent", dup), "duplicate resource")).toBe(true);
    const nobase = base();
    nobase.scopes = nobase.scopes.filter((s) => s.resource !== "agent_memory");
    expect(has(problemsFor("support-agent", nobase), "missing base resource agent_memory")).toBe(
      true,
    );
  });

  it("rejects data above the agent's context ceiling", () => {
    const w = clone(wsOf("finance-agent"));
    w.scopes.find((s) => s.resource === "payments_ledger")!.sensitivity = "restricted";
    expect(has(problemsFor("finance-agent", w), "above the agent's context ceiling")).toBe(true);
  });

  it("rejects writes and proposals on rows that are not the agent's own", () => {
    const w = base();
    const s = w.scopes.find((x) => x.resource === "knowledge_base")!;
    s.access = "write_own";
    expect(
      has(problemsFor("support-agent", w), "write_own is only allowed on own_agent rows"),
    ).toBe(true);
    s.access = "propose";
    expect(has(problemsFor("support-agent", w), "propose is only allowed on own_agent rows")).toBe(
      true,
    );
  });

  it("requires a grant limit on grant-scoped rows and forbids it elsewhere", () => {
    const w = base();
    delete w.scopes.find((s) => s.resource === "support_tickets")!.grantMaxMinutes;
    expect(has(problemsFor("support-agent", w), "tenant_with_grant needs grantMaxMinutes")).toBe(
      true,
    );
    const x = base();
    x.scopes.find((s) => s.resource === "knowledge_base")!.grantMaxMinutes = 30;
    expect(
      has(problemsFor("support-agent", x), "grantMaxMinutes is only allowed on tenant_with_grant"),
    ).toBe(true);
  });

  it("rejects organization rows for an agent whose charter sees no customer content", () => {
    const w = clone(wsOf("engineering-agent"));
    w.scopes.push({
      resource: "support_tickets",
      access: "read",
      rowScope: "tenant_with_grant",
      sensitivity: "internal",
      purpose: "Read a ticket while helping",
      grantMaxMinutes: 60,
    });
    expect(has(problemsFor("engineering-agent", w), "sees no customer content")).toBe(true);
  });

  it("keeps organization rows, metadata and aggregates read-only and non-restricted", () => {
    const w = base();
    const t = w.scopes.find((s) => s.resource === "support_tickets")!;
    t.access = "write_own";
    expect(has(problemsFor("support-agent", w), "organization rows are read-only")).toBe(true);
    const f = clone(wsOf("customer-success-agent"));
    const a = f.scopes.find((s) => s.resource === "usage_metrics")!;
    a.access = "propose";
    expect(has(problemsFor("customer-success-agent", f), "aggregate is read-only")).toBe(true);
    const g = clone(wsOf("customer-success-agent"));
    g.scopes.find((s) => s.resource === "tenant_registry")!.sensitivity = "restricted";
    expect(
      has(problemsFor("customer-success-agent", g), "tenant_metadata cannot be restricted"),
    ).toBe(true);
  });

  it("rejects an assurance agent that reads organization rows or creates work orders", () => {
    const w = clone(wsOf("sentinel-agent"));
    w.scopes.push({
      resource: "work_orders",
      access: "write_own",
      rowScope: "own_agent",
      sensitivity: "internal",
      purpose: "Hand work to another agent",
    });
    expect(
      has(problemsFor("sentinel-agent", w), "assurance agents do not create work orders"),
    ).toBe(true);
  });

  it("requires an agent with no organization rows to say it never reads organization content", () => {
    const w = clone(wsOf("engineering-agent"));
    w.boundaries = [
      "Never deploys, merges or pushes to a protected branch.",
      "Never holds a credential or a standing production login.",
      "Never disables a check or a guardrail to make a change pass.",
    ];
    expect(has(problemsFor("engineering-agent", w), "organization content is never read")).toBe(
      true,
    );
  });

  it("rejects a boundary that does not start with Never", () => {
    const w = base();
    w.boundaries[0] = "Always asks before it replies to a customer.";
    expect(has(problemsFor("support-agent", w), 'boundary must start with "Never"')).toBe(true);
  });

  it("rejects duplicate queues, queues over unknown data and missing mandatory actions", () => {
    const w = base();
    w.ui.queues.push({ ...w.ui.queues[0]! });
    expect(has(problemsFor("support-agent", w), "duplicate queue")).toBe(true);
    const x = base();
    x.ui.queues[0]!.source = "not_a_resource";
    expect(has(problemsFor("support-agent", x), "not in scopes")).toBe(true);
    const y = base();
    y.ui.quickActions = y.ui.quickActions.filter((a) => a.kind !== "pause_agent");
    expect(has(problemsFor("support-agent", y), "quick actions must include pause_agent")).toBe(
      true,
    );
    const z = base();
    z.ui.quickActions = z.ui.quickActions.filter((a) => a.kind !== "review_proposals");
    expect(
      has(problemsFor("support-agent", z), "quick actions must include review_proposals"),
    ).toBe(true);
    const d = base();
    d.ui.quickActions.push({ ...d.ui.quickActions[0]! });
    expect(has(problemsFor("support-agent", d), "duplicate quick action")).toBe(true);
  });

  it("requires proposals to be propose-only", () => {
    const w = base();
    w.scopes.find((s) => s.resource === "agent_proposals")!.access = "write_own";
    expect(has(problemsFor("support-agent", w), "agent_proposals must be propose access")).toBe(
      true,
    );
  });
});

describe("ENGINE-13 authorizeScope denies by default", () => {
  const NOW = new Date("2026-11-15T10:00:00Z");
  const at = (mins: number) => new Date(NOW.getTime() + mins * 60000);
  const support = wsOf("support-agent");
  const grant = (over: Partial<NonNullable<ScopeRequest["grant"]>> = {}) => ({
    tenantId: "t1",
    issuedAt: at(-10),
    expiresAt: at(30),
    revoked: false,
    ...over,
  });
  const ask = (over: Partial<ScopeRequest> = {}): ScopeRequest => ({
    agentCode: "support-agent",
    resource: "support_tickets",
    access: "read",
    tenantId: "t1",
    grant: grant(),
    now: NOW,
    ...over,
  });
  const deniedFor = (w: AgentWorkspace, r: ScopeRequest) => {
    const d = authorizeScope(w, r);
    return d.allowed ? "allowed" : d.reason;
  };

  it("allows a ticket read under an active grant for that organization", () => {
    expect(authorizeScope(support, ask())).toEqual({
      allowed: true,
      rowScope: "tenant_with_grant",
    });
  });

  it("denies another agent, an unlisted resource and a mode that was not granted", () => {
    expect(deniedFor(support, ask({ agentCode: "finance-agent" }))).toBe("wrong_agent");
    expect(deniedFor(support, ask({ resource: "payments_ledger" }))).toBe("unknown_resource");
    expect(deniedFor(support, ask({ access: "write_own" }))).toBe("access_not_granted");
    expect(deniedFor(support, ask({ resource: "knowledge_base", access: "propose" }))).toBe(
      "access_not_granted",
    );
  });

  it("denies a grant-scoped read with no organization, no grant, or a bad grant", () => {
    expect(deniedFor(support, ask({ tenantId: undefined }))).toBe("tenant_required");
    expect(deniedFor(support, ask({ grant: undefined }))).toBe("grant_required");
    expect(deniedFor(support, ask({ grant: grant({ revoked: true }) }))).toBe("grant_revoked");
    expect(deniedFor(support, ask({ grant: grant({ tenantId: "t2" }) }))).toBe(
      "grant_for_other_tenant",
    );
    expect(deniedFor(support, ask({ grant: grant({ expiresAt: at(0) }) }))).toBe("grant_expired");
    expect(deniedFor(support, ask({ grant: grant({ expiresAt: at(-1) }) }))).toBe("grant_expired");
    expect(deniedFor(support, ask({ grant: grant({ issuedAt: at(5), expiresAt: at(30) }) }))).toBe(
      "grant_not_yet_active",
    );
  });

  it("denies a grant longer than the scope allows and allows one exactly at the limit", () => {
    const limit = support.scopes.find((s) => s.resource === "support_tickets")!.grantMaxMinutes!;
    const exact = grant({ issuedAt: at(-1), expiresAt: at(limit - 1) });
    expect(deniedFor(support, ask({ grant: exact }))).toBe("allowed");
    const over = grant({ issuedAt: at(-1), expiresAt: at(limit) });
    expect(deniedFor(support, ask({ grant: over }))).toBe("grant_too_long");
  });

  it("fails closed when a grant-scoped resource has no stated limit", () => {
    const w = clone(support);
    delete w.scopes.find((s) => s.resource === "support_tickets")!.grantMaxMinutes;
    expect(deniedFor(w, ask())).toBe("grant_too_long");
  });

  it("allows platform records and own rows, and only the agent's own", () => {
    expect(
      authorizeScope(
        support,
        ask({ resource: "knowledge_base", tenantId: undefined, grant: undefined }),
      ),
    ).toEqual({
      allowed: true,
      rowScope: "platform",
    });
    const own = ask({ resource: "agent_memory", access: "write_own", rowOwner: "support-agent" });
    expect(authorizeScope(support, own)).toEqual({ allowed: true, rowScope: "own_agent" });
    expect(deniedFor(support, { ...own, rowOwner: "finance-agent" })).toBe("not_own_row");
    expect(deniedFor(support, { ...own, rowOwner: undefined })).toBe("not_own_row");
  });

  it("lets aggregate and metadata resources through only for non-individual requests", () => {
    const cs = wsOf("customer-success-agent");
    const base: ScopeRequest = {
      agentCode: "customer-success-agent",
      resource: "usage_metrics",
      access: "read",
      now: NOW,
    };
    expect(authorizeScope(cs, base)).toEqual({ allowed: true, rowScope: "aggregate" });
    expect(deniedFor(cs, { ...base, individualRecord: true })).toBe(
      "individual_record_not_allowed",
    );
    const meta = { ...base, resource: "tenant_registry" };
    expect(authorizeScope(cs, meta)).toEqual({ allowed: true, rowScope: "tenant_metadata" });
    expect(deniedFor(cs, { ...meta, individualRecord: true })).toBe(
      "individual_record_not_allowed",
    );
  });

  it("allows flagged rows only when the organization flagged them", () => {
    const sg = wsOf("safeguarding-agent");
    const r: ScopeRequest = {
      agentCode: "safeguarding-agent",
      resource: "safeguarding_reports",
      access: "read",
      tenantId: "t1",
      flaggedByTenant: true,
      now: NOW,
    };
    expect(authorizeScope(sg, r)).toEqual({ allowed: true, rowScope: "tenant_flagged" });
    expect(deniedFor(sg, { ...r, flaggedByTenant: false })).toBe("not_flagged_by_tenant");
    expect(deniedFor(sg, { ...r, flaggedByTenant: undefined })).toBe("not_flagged_by_tenant");
    expect(deniedFor(sg, { ...r, tenantId: undefined })).toBe("tenant_required");
  });

  it("never lets an agent without organization rows reach one", () => {
    for (const w of WORKFORCE_WORKSPACES) {
      if (["support-agent", "compliance-agent", "safeguarding-agent"].includes(w.packCode))
        continue;
      for (const s of w.scopes) {
        expect(s.rowScope, `${w.packCode} ${s.resource}`).not.toBe("tenant_with_grant");
        expect(s.rowScope, `${w.packCode} ${s.resource}`).not.toBe("tenant_flagged");
      }
    }
  });
});

describe("ENGINE-13 database proposal matches the workspace definitions", () => {
  it("is a proposal, deny-by-default, forced RLS, with a rollback", () => {
    expect(scopeSql).toContain("NOT APPLIED");
    expect(scopeSql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(scopeSql).toContain("FORCE ROW LEVEL SECURITY");
    expect(scopeSql).toContain("REVOKE ALL ON TABLE public.agent_workspace_scopes");
    expect(scopeSql).toContain("-- Rollback");
    expect(scopeSql).toContain("platform.audit.read");
    expect(scopeSql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL) ON TABLE [^;]*TO authenticated/);
    expect(scopeSql).toContain("REFERENCES public.platform_support_grants(id)");
    expect(scopeSql).toContain("interval '240 minutes'");
  });

  it("seeds exactly the scopes defined in code, no more and no fewer", () => {
    const seeded = [
      ...scopeSql.matchAll(
        /^ {2}\('([a-z0-9-]+)', '([a-z0-9_-]+)', '(\w+)', '(\w+)', '(\w+)', (\d+|NULL)\)/gm,
      ),
    ];
    const fromCode = WORKFORCE_WORKSPACES.flatMap((w) =>
      w.scopes.map(
        (s) =>
          `${w.packCode}|${s.resource}|${s.access}|${s.rowScope}|${s.sensitivity}|${s.grantMaxMinutes ?? "NULL"}`,
      ),
    );
    const fromSql = seeded.map((m) => m.slice(1).join("|"));
    expect(fromSql.sort()).toEqual(fromCode.sort());
    expect(fromSql).toHaveLength(fromCode.length);
  });
});
