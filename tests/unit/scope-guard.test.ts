import { describe, expect, it } from "vitest";
import { WORKFORCE_WORKSPACES } from "../../frontend/src/lib/workforce-charter/workspaces/workforce-workspaces";
import type { ScopeGrant } from "../../frontend/src/lib/workforce-charter/workspace";
import {
  OP_KINDS,
  runAsAgent,
  type AgentOp,
  type GuardPorts,
  type GuardedOp,
  type OpKind,
  type ScopeAuditEntry,
  type ScopeFactsPort,
} from "../../frontend/src/lib/workforce-scope/scope-guard.server";

const NOW = new Date("2026-11-15T10:00:00Z");
const ACCESS: Record<OpKind, string> = {
  read_aggregate: "read",
  read_records: "read",
  write_own: "write_own",
  propose: "propose",
};

interface Rig {
  readonly ports: GuardPorts;
  readonly innerCalls: GuardedOp[];
  readonly audit: ScopeAuditEntry[];
}

function rig(
  over: Partial<{
    facts: Partial<ScopeFactsPort>;
    kill: boolean;
    paused: (code: string) => boolean;
    auditFails: boolean;
    innerFails: boolean;
    grantMinutes: (resource: string) => number;
  }> = {},
): Rig {
  const innerCalls: GuardedOp[] = [];
  const audit: ScopeAuditEntry[] = [];
  const facts: ScopeFactsPort = {
    grantFor: async (_a, tenantId): Promise<ScopeGrant> => ({
      tenantId,
      issuedAt: new Date(NOW.getTime() - 60_000),
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      revoked: false,
    }),
    isFlagged: async () => true,
    rowOwner: async (_r, _id) => "someone-else",
    ...over.facts,
  };
  return {
    innerCalls,
    audit,
    ports: {
      inner: {
        run: async (op) => {
          innerCalls.push(op);
          if (over.innerFails) throw new Error("secret row content");
          return { rows: 1 };
        },
      },
      facts,
      audit: {
        record: async (e) => {
          if (over.auditFails) throw new Error("down");
          audit.push(e);
        },
      },
      now: () => NOW,
      killSwitch: () => over.kill === true,
      isPaused: (code) => over.paused?.(code) ?? false,
    },
  };
}

const ws = (code: string) => WORKFORCE_WORKSPACES.find((w) => w.packCode === code)!;

describe("ENGINE-15 scope guard: every agent, scope and operation", () => {
  it("allows exactly what the workspace allows, and calls the data port only then", async () => {
    let checked = 0;
    for (const w of WORKFORCE_WORKSPACES) {
      for (const sc of w.scopes) {
        for (const kind of OP_KINDS) {
          const r = rig();
          const op: AgentOp = { kind, resource: sc.resource, tenantId: "org-a" };
          const out = await runAsAgent(r.ports, w.packCode, op);
          const accessOk = sc.access === ACCESS[kind];
          const individualBlocked =
            kind === "read_records" &&
            (sc.rowScope === "aggregate" || sc.rowScope === "tenant_metadata");
          const expected = accessOk && !individualBlocked;
          expect(out.ok, `${w.packCode} ${sc.resource} ${kind}`).toBe(expected);
          expect(r.innerCalls.length, `${w.packCode} ${sc.resource} ${kind}`).toBe(
            expected ? 1 : 0,
          );
          expect(r.audit).toHaveLength(expected ? 1 : 1);
          expect(r.audit[0]!.allowed).toBe(expected);
          checked++;
        }
      }
    }
    expect(checked).toBe(WORKFORCE_WORKSPACES.reduce((n, w) => n + w.scopes.length, 0) * 4);
  });

  it("an agent can never use another agent's resources", async () => {
    const support = ws("support-agent");
    const finance = ws("finance-agent");
    const only = finance.scopes.find(
      (s) => !support.scopes.some((x) => x.resource === s.resource),
    )!;
    const r = rig();
    const out = await runAsAgent(r.ports, "support-agent", {
      kind: "read_aggregate",
      resource: only.resource,
    });
    expect(out).toEqual({ ok: false, error: "unknown_resource" });
    expect(r.innerCalls).toEqual([]);
  });
});

describe("ENGINE-15 scope guard: the caller cannot claim anything", () => {
  it("the operation kind decides whether an individual record is read", async () => {
    const aggregateScope = ws("customer-success-agent").scopes.find(
      (s) => s.rowScope === "aggregate",
    )!;
    const r = rig();
    const asRecords = await runAsAgent(r.ports, "customer-success-agent", {
      kind: "read_records",
      resource: aggregateScope.resource,
      tenantId: "org-a",
    });
    expect(asRecords).toEqual({ ok: false, error: "individual_record_not_allowed" });
    const asAggregate = await runAsAgent(r.ports, "customer-success-agent", {
      kind: "read_aggregate",
      resource: aggregateScope.resource,
      tenantId: "org-a",
    });
    expect(asAggregate.ok).toBe(true);
  });

  it("extra fields smuggled onto the operation are not trusted", async () => {
    const r = rig({ facts: { grantFor: async () => null } });
    const forged = {
      kind: "read_records",
      resource: "support_tickets",
      tenantId: "org-a",
      grant: {
        tenantId: "org-a",
        issuedAt: new Date(0),
        expiresAt: new Date(9e15),
        revoked: false,
      },
      flaggedByTenant: true,
      rowOwner: "support-agent",
      individualRecord: false,
    } as unknown as AgentOp;
    expect(await runAsAgent(r.ports, "support-agent", forged)).toEqual({
      ok: false,
      error: "grant_required",
    });
    expect(r.innerCalls).toEqual([]);
  });

  it("a grant is looked up server-side and every defect is refused", async () => {
    const mk = (g: Partial<ScopeGrant> | null) =>
      rig({
        facts: {
          grantFor: async (_a, tenantId) =>
            g === null
              ? null
              : {
                  tenantId,
                  issuedAt: new Date(NOW.getTime() - 60_000),
                  expiresAt: new Date(NOW.getTime() + 30 * 60_000),
                  revoked: false,
                  ...g,
                },
        },
      });
    const op: AgentOp = { kind: "read_records", resource: "support_tickets", tenantId: "org-a" };
    const cases: [Partial<ScopeGrant> | null, string][] = [
      [null, "grant_required"],
      [{ revoked: true }, "grant_revoked"],
      [{ tenantId: "org-b" }, "grant_for_other_tenant"],
      [{ expiresAt: new Date(NOW.getTime() - 1) }, "grant_expired"],
      [{ issuedAt: new Date(NOW.getTime() + 1000) }, "grant_not_yet_active"],
      [
        {
          issuedAt: new Date(NOW.getTime() - 3 * 3600_000),
          expiresAt: new Date(NOW.getTime() + 3600_000),
        },
        "grant_too_long",
      ],
    ];
    for (const [g, reason] of cases) {
      const r = mk(g);
      expect(await runAsAgent(r.ports, "support-agent", op), reason).toEqual({
        ok: false,
        error: reason,
      });
      expect(r.innerCalls).toEqual([]);
    }
    const good = mk({});
    expect((await runAsAgent(good.ports, "support-agent", op)).ok).toBe(true);
  });

  it("without an organization, grant and flagged scopes are refused", async () => {
    const r = rig();
    expect(
      await runAsAgent(r.ports, "support-agent", {
        kind: "read_records",
        resource: "support_tickets",
      }),
    ).toEqual({
      ok: false,
      error: "tenant_required",
    });
    expect(
      await runAsAgent(r.ports, "safeguarding-agent", {
        kind: "read_records",
        resource: "safeguarding_reports",
      }),
    ).toEqual({
      ok: false,
      error: "tenant_required",
    });
  });

  it("flagged rows: a named row must be flagged, and a listing is forced to flagged rows only", async () => {
    const notFlagged = rig({ facts: { isFlagged: async () => false } });
    expect(
      await runAsAgent(notFlagged.ports, "safeguarding-agent", {
        kind: "read_records",
        resource: "safeguarding_reports",
        tenantId: "org-a",
        rowId: "r1",
      }),
    ).toEqual({ ok: false, error: "not_flagged_by_tenant" });
    const flagged = rig();
    const one = await runAsAgent(flagged.ports, "safeguarding-agent", {
      kind: "read_records",
      resource: "safeguarding_reports",
      tenantId: "org-a",
      rowId: "r1",
    });
    expect(one.ok).toBe(true);
    expect(flagged.innerCalls[0]!.restrictToFlagged).toBeUndefined();
    const list = rig({ facts: { isFlagged: async () => false } });
    expect(
      (
        await runAsAgent(list.ports, "safeguarding-agent", {
          kind: "read_records",
          resource: "safeguarding_reports",
          tenantId: "org-a",
        })
      ).ok,
    ).toBe(true);
    expect(list.innerCalls[0]!.restrictToFlagged).toBe(true);
  });

  it("own rows: a named row must belong to the agent, and a listing is forced to its own rows", async () => {
    const foreign = rig();
    expect(
      await runAsAgent(foreign.ports, "support-agent", {
        kind: "propose",
        resource: "agent_proposals",
        rowId: "p1",
      }),
    ).toEqual({ ok: false, error: "not_own_row" });
    const unknown = rig({ facts: { rowOwner: async () => null } });
    expect(
      await runAsAgent(unknown.ports, "support-agent", {
        kind: "propose",
        resource: "agent_proposals",
        rowId: "p1",
      }),
    ).toEqual({ ok: false, error: "not_own_row" });
    const own = rig({ facts: { rowOwner: async () => "support-agent" } });
    expect(
      (
        await runAsAgent(own.ports, "support-agent", {
          kind: "propose",
          resource: "agent_proposals",
          rowId: "p1",
        })
      ).ok,
    ).toBe(true);
    expect(own.innerCalls[0]!.restrictToOwner).toBeUndefined();
    const list = rig();
    expect(
      (
        await runAsAgent(list.ports, "support-agent", {
          kind: "propose",
          resource: "agent_proposals",
        })
      ).ok,
    ).toBe(true);
    expect(list.innerCalls[0]!.restrictToOwner).toBe("support-agent");
  });

  it("an agent code smuggled onto the operation never reaches the data port", async () => {
    const r = rig();
    const sneaky = {
      kind: "propose",
      resource: "agent_proposals",
      agentCode: "finance-agent",
    } as unknown as AgentOp;
    await runAsAgent(r.ports, "support-agent", sneaky);
    expect(r.innerCalls[0]!.agentCode).toBe("support-agent");
  });

  it("the audit records which organization was asked about", async () => {
    const r = rig();
    await runAsAgent(r.ports, "support-agent", {
      kind: "read_records",
      resource: "support_tickets",
      tenantId: "org-a",
    });
    expect(r.audit[0]).toMatchObject({
      tenantId: "org-a",
      allowed: true,
      reason: "tenant_with_grant",
    });
  });

  it("restrictions the caller tries to set are overwritten by the guard", async () => {
    const r = rig();
    const sneaky = {
      kind: "propose",
      resource: "agent_proposals",
      restrictToOwner: "someone-else",
      restrictToFlagged: false,
    } as unknown as AgentOp;
    await runAsAgent(r.ports, "support-agent", sneaky);
    expect(r.innerCalls[0]!.restrictToOwner).toBe("support-agent");
  });
});

describe("ENGINE-15 scope guard: fail closed", () => {
  const op: AgentOp = { kind: "read_aggregate", resource: "platform_health" };
  const agent = WORKFORCE_WORKSPACES.find((w) =>
    w.scopes.some((s) => s.resource === "platform_health"),
  )!.packCode;

  it("an unknown agent is refused and audited", async () => {
    const r = rig();
    expect(await runAsAgent(r.ports, "nobody", op)).toEqual({ ok: false, error: "unknown_agent" });
    expect(r.audit[0]).toMatchObject({
      agentCode: "nobody",
      allowed: false,
      reason: "unknown_agent",
    });
    expect(r.innerCalls).toEqual([]);
  });

  it("the kill switch stops everything, even an allowed call", async () => {
    const r = rig({ kill: true });
    expect(await runAsAgent(r.ports, agent, op)).toEqual({ ok: false, error: "kill_switch" });
    expect(r.innerCalls).toEqual([]);
  });

  it("a paused agent is refused everything, and only that agent", async () => {
    const r = rig({ paused: (c) => c === agent });
    expect(await runAsAgent(r.ports, agent, op)).toEqual({ ok: false, error: "agent_paused" });
    expect(r.innerCalls).toEqual([]);
    expect(r.audit[0]).toMatchObject({ allowed: false, reason: "agent_paused" });
    const other = WORKFORCE_WORKSPACES.find(
      (w) => w.packCode !== agent && w.scopes.some((s) => s.resource === "platform_health"),
    );
    expect(other).toBeDefined();
    expect((await runAsAgent(r.ports, other!.packCode, op)).ok).toBe(true);
  });

  it("a failing pause lookup refuses instead of assuming the agent is running", async () => {
    const r = rig({
      paused: () => {
        throw new Error("x");
      },
    });
    expect(await runAsAgent(r.ports, agent, op)).toEqual({ ok: false, error: "lookup_failed" });
    expect(r.innerCalls).toEqual([]);
  });

  it("an unrecognised operation kind is refused", async () => {
    const r = rig();
    const out = await runAsAgent(r.ports, agent, { ...op, kind: "delete" as OpKind });
    expect(out).toEqual({ ok: false, error: "invalid_operation" });
  });

  it("a failing lookup refuses instead of guessing", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("x");
    };
    const table: [Partial<ScopeFactsPort>, string, AgentOp][] = [
      [
        { grantFor: boom },
        "support-agent",
        { kind: "read_records", resource: "support_tickets", tenantId: "org-a" },
      ],
      [
        { isFlagged: boom },
        "safeguarding-agent",
        { kind: "read_records", resource: "safeguarding_reports", tenantId: "org-a", rowId: "r" },
      ],
      [
        { rowOwner: boom },
        "support-agent",
        { kind: "propose", resource: "agent_proposals", rowId: "p" },
      ],
    ];
    for (const [facts, who, op] of table) {
      const r = rig({ facts });
      expect(await runAsAgent(r.ports, who, op)).toEqual({ ok: false, error: "lookup_failed" });
      expect(r.innerCalls).toEqual([]);
      expect(r.audit[0]).toMatchObject({ allowed: false, reason: "lookup_failed" });
    }
  });

  it("an allowed call that cannot be audited does not run", async () => {
    const r = rig({ auditFails: true });
    expect(await runAsAgent(r.ports, agent, op)).toEqual({ ok: false, error: "audit_unavailable" });
    expect(r.innerCalls).toEqual([]);
  });

  it("a refusal stays a refusal when the audit is also down", async () => {
    const r = rig({ auditFails: true });
    expect(await runAsAgent(r.ports, "nobody", op)).toEqual({ ok: false, error: "unknown_agent" });
  });

  it("a data-port failure is reported without its message", async () => {
    const r = rig({ innerFails: true });
    const out = await runAsAgent(r.ports, agent, op);
    expect(out).toEqual({ ok: false, error: "data_unavailable" });
    expect(JSON.stringify(out)).not.toContain("secret row content");
  });

  it("audit entries carry no row content and name the decision", async () => {
    const r = rig();
    await runAsAgent(r.ports, agent, { ...op, payload: { name: "Ada Lovelace" } });
    expect(JSON.stringify(r.audit)).not.toContain("Ada");
    expect(r.audit[0]).toEqual({
      agentCode: agent,
      kind: "read_aggregate",
      resource: "platform_health",
      tenantId: null,
      allowed: true,
      reason: "platform",
      at: NOW.toISOString(),
    });
  });

  it("injected workspaces are used instead of the shipped ones", async () => {
    const r = rig();
    const only = [
      { ...ws(agent), scopes: ws(agent).scopes.filter((s) => s.resource !== "platform_health") },
    ];
    const out = await runAsAgent({ ...r.ports, workspaces: only }, agent, op);
    expect(out).toEqual({ ok: false, error: "unknown_resource" });
  });
});

describe("ENGINE-15 one choke point", () => {
  it("only the guard, the workspace module and the evaluation harness call authorizeScope", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(`grep -rln "authorizeScope(" frontend/src || true`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(out).toEqual([
      "frontend/src/lib/workforce-charter/workspace.ts",
      "frontend/src/lib/workforce-eval/eval-case.ts",
      "frontend/src/lib/workforce-scope/scope-guard.server.ts",
    ]);
  });
});
