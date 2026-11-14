import { describe, expect, it } from "vitest";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import { PLATFORM_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/platform-workforce-packs";
import {
  MANDATORY_PANELS,
  validateCharter,
  validateRoster,
  type AgentCharter,
  type RosterEntry,
} from "../../frontend/src/lib/workforce-charter/charter";
import {
  EXISTING_CHARTERS,
  JARVIS_CHARTER,
  OPERATIONS_CHARTER,
  SALES_CHARTER,
  SUPPORT_CHARTER,
} from "../../frontend/src/lib/workforce-charter/charters/existing-charters";
import type { RolePack } from "../../frontend/src/lib/twin-engine/role-pack";

const packs: readonly RolePack[] = [...PLATFORM_WORKFORCE_PACKS, JARVIS_EXECUTIVE_PACK];
const packOf = (code: string): RolePack => packs.find((p) => p.code === code)!;
const entries = (cs: readonly AgentCharter[] = EXISTING_CHARTERS): RosterEntry[] =>
  cs.map((charter) => ({ charter, pack: packOf(charter.packCode) }));
const check = (c: AgentCharter) => validateCharter(c, packOf(c.packCode));
const has = (problems: readonly string[], text: string) => problems.some((p) => p.includes(text));

/** The agents ENGINE-11 adds; until then these handoffs have no target. */
const PENDING_HANDOFFS = [
  "support-agent: handoff target customer-success-agent is not in the roster",
  "security-agent: handoff target compliance-agent is not in the roster",
  "finance-agent: handoff target revenue-assurance-agent is not in the roster",
  "sales-agent: handoff target customer-success-agent is not in the roster",
  "operations-agent: handoff target reliability-agent is not in the roster",
];

describe("ENGINE-10 charters of the existing agents", () => {
  it("every existing agent has a sound charter for its pack", () => {
    for (const c of EXISTING_CHARTERS) expect(check(c), c.packCode).toEqual([]);
    expect(EXISTING_CHARTERS).toHaveLength(packs.length);
  });

  it("the roster is sound except for handoffs to agents that ENGINE-11 adds", () => {
    expect(validateRoster(entries())).toEqual(PENDING_HANDOFFS);
  });

  it("T3 capabilities have exactly one owner and JARVIS only delegates the ones a department owns", () => {
    expect(JARVIS_CHARTER.t3Rules).toEqual({
      "publish.social.post": "delegate_requires_owner_proposal",
      "request.deploy": "delegate_requires_owner_proposal",
      "request.refund": "delegate_requires_owner_proposal",
      "request.access.grant": "owner",
    });
  });

  it("an agent with a customer-facing T2 send is accountable to the matching human role", () => {
    expect(SUPPORT_CHARTER.accountable).toBe("support");
    expect(JARVIS_CHARTER.accountable).toBe("sheriff");
  });
});

describe("ENGINE-10 charter rules", () => {
  it("rejects malformed charters with schema problems and no throw", () => {
    expect(validateCharter({}, packOf("support-agent")).length).toBeGreaterThan(0);
    expect(validateCharter(null, packOf("support-agent"))[0]).toMatch(/^schema:/);
    expect(has(check({ ...SUPPORT_CHARTER, extra: 1 } as never), "schema:")).toBe(true);
    expect(has(check({ ...SUPPORT_CHARTER, mission: "short" }), "mission")).toBe(true);
  });

  it("requires the charter to match its pack", () => {
    expect(
      has(validateCharter(SUPPORT_CHARTER, packOf("sales-agent")), "does not match pack"),
    ).toBe(true);
  });

  it("requires a duty for every capability and no duty for an unknown one", () => {
    const { "send.reply": _drop, ...rest } = SUPPORT_CHARTER.duties;
    expect(
      has(check({ ...SUPPORT_CHARTER, duties: rest }), "no duty declared for send.reply"),
    ).toBe(true);
    expect(
      has(
        check({
          ...SUPPORT_CHARTER,
          duties: { ...SUPPORT_CHARTER.duties, "ghost.cap": "observe" },
        }),
        "ghost.cap is not a capability",
      ),
    ).toBe(true);
  });

  it("requires a T3 rule for every T3 capability and none for others", () => {
    expect(
      has(
        check({ ...SALES_CHARTER, t3Rules: {} }),
        "no rule declared for T3 capability publish.social.post",
      ),
    ).toBe(true);
    expect(
      has(
        check({ ...SALES_CHARTER, t3Rules: { ...SALES_CHARTER.t3Rules, "qualify.lead": "owner" } }),
        "qualify.lead is not a T3 capability",
      ),
    ).toBe(true);
  });

  it("requires an evaluation suite for every capability above T0", () => {
    const missing = SUPPORT_CHARTER.evalSuites.filter((s) => s.capabilityId !== "send.reply");
    expect(
      has(
        check({ ...SUPPORT_CHARTER, evalSuites: missing }),
        "send.reply (T2) has no evaluation suite",
      ),
    ).toBe(true);
    const ghost = [
      ...SUPPORT_CHARTER.evalSuites,
      { capabilityId: "ghost.cap", suiteId: "eval.x", minPassRate: 0.95 },
    ];
    expect(
      has(check({ ...SUPPORT_CHARTER, evalSuites: ghost }), "ghost.cap is not a capability"),
    ).toBe(true);
  });

  it("rejects an evaluation bar below 90 percent", () => {
    const low = SUPPORT_CHARTER.evalSuites.map((s) => ({ ...s, minPassRate: 0.5 }));
    expect(has(check({ ...SUPPORT_CHARTER, evalSuites: low }), "schema:")).toBe(true);
  });

  it("keeps the model's context ceiling within the pack memory ceiling and consistent with customer content", () => {
    expect(
      has(
        check({
          ...SUPPORT_CHARTER,
          modelPolicy: { ...SUPPORT_CHARTER.modelPolicy, contextCeiling: "restricted" },
        }),
        "exceeds the pack memory ceiling",
      ),
    ).toBe(true);
    expect(
      has(
        check({
          ...SUPPORT_CHARTER,
          modelPolicy: { ...SUPPORT_CHARTER.modelPolicy, contextCeiling: "public" },
        }),
        "sees customer content but the context ceiling is public",
      ),
    ).toBe(true);
  });

  it("requires every mandatory dashboard panel and no duplicates", () => {
    for (const panel of MANDATORY_PANELS) {
      const panels = SUPPORT_CHARTER.dashboardPanels.filter((p) => p !== panel);
      expect(
        has(
          check({ ...SUPPORT_CHARTER, dashboardPanels: panels }),
          `missing mandatory panel ${panel}`,
        ),
        panel,
      ).toBe(true);
    }
    expect(
      has(
        check({
          ...SUPPORT_CHARTER,
          dashboardPanels: SUPPORT_CHARTER.dashboardPanels.map((p) =>
            p === "context" ? "charter" : p,
          ),
        }),
        "dashboardPanels: duplicates",
      ),
    ).toBe(true);
  });

  it("enforces the supervision line by tier", () => {
    expect(
      has(check({ ...SUPPORT_CHARTER, supervisor: "support-agent" }), "cannot supervise itself"),
    ).toBe(true);
    expect(
      has(check({ ...SUPPORT_CHARTER, supervisor: "sheriff" }), "not directly by the sheriff"),
    ).toBe(true);
    expect(
      has(check({ ...JARVIS_CHARTER, supervisor: "support-agent" }), "supervised by the sheriff"),
    ).toBe(true);
  });

  it("only assurance agents may verify, and tier T2+ duties must be originate or coordinate", () => {
    expect(
      has(
        check({
          ...OPERATIONS_CHARTER,
          duties: { ...OPERATIONS_CHARTER.duties, "monitor.platform": "verify" },
        }),
        "only assurance agents may hold a verify duty",
      ),
    ).toBe(true);
    expect(
      has(
        check({
          ...OPERATIONS_CHARTER,
          duties: { ...OPERATIONS_CHARTER.duties, "notify.tenants": "observe" },
        }),
        "notify.tenants is T2 but its duty is observe",
      ),
    ).toBe(true);
  });

  it("an observing or analysing duty cannot act through an external connector", () => {
    const c = {
      ...SALES_CHARTER,
      duties: { ...SALES_CHARTER.duties, "update.crm": "analyse" as const },
    };
    expect(has(check(c), "update.crm is analyse but acts through connector crm")).toBe(true);
  });
});

describe("ENGINE-10 assurance independence", () => {
  const auditPack: RolePack = {
    ...packOf("security-agent"),
    code: "audit-probe",
    capabilities: [
      {
        id: "review.ledger",
        title: "Review the ledger",
        tier: "T0",
        autonomy: "act_autonomously",
        requiresPermission: "platform.audit.read",
      },
    ],
    playbooks: [
      {
        id: "daily",
        title: "Daily review",
        wakeOn: ["schedule.daily"],
        steps: ["review.ledger"],
        maxRunsPerDay: 2,
      },
    ],
  };
  const auditor: AgentCharter = {
    ...SUPPORT_CHARTER,
    packCode: "audit-probe",
    agentTier: "assurance",
    accountable: "sheriff",
    supervisor: "sheriff",
    duties: { "review.ledger": "verify" },
    t3Rules: {},
    evalSuites: [],
    handoffs: [],
    killScope: "agent",
    modelPolicy: {
      purposes: ["summarization"],
      contextCeiling: "internal",
      seesCustomerContent: false,
    },
  };

  it("accepts a read-only assurance agent that reports to the sheriff", () => {
    expect(validateCharter(auditor, auditPack)).toEqual([]);
  });

  it("rejects an assurance agent that reports to an agent, originates, acts above T1, uses a connector, or has a wide kill scope", () => {
    expect(
      has(
        validateCharter({ ...auditor, supervisor: "jarvis-executive" }, auditPack),
        "reports to the sheriff",
      ),
    ).toBe(true);
    expect(
      has(
        validateCharter({ ...auditor, duties: { "review.ledger": "originate" } }, auditPack),
        "cannot originate",
      ),
    ).toBe(true);
    expect(
      has(
        validateCharter({ ...auditor, killScope: "workforce" }, auditPack),
        "paused individually, by the sheriff",
      ),
    ).toBe(true);
    const t2 = {
      ...auditPack,
      capabilities: [
        {
          ...auditPack.capabilities[0]!,
          tier: "T2" as const,
          autonomy: "act_with_approval" as const,
        },
      ],
    };
    expect(has(validateCharter(auditor, t2), "review.ledger is above T1")).toBe(true);
    const conn = {
      ...auditPack,
      capabilities: [{ ...auditPack.capabilities[0]!, connector: "email" }],
    };
    expect(has(validateCharter(auditor, conn), "acts through connector email")).toBe(true);
  });
});

describe("ENGINE-10 roster rules", () => {
  const clean = (cs: AgentCharter[]) =>
    validateRoster(entries(cs)).filter((p) => !PENDING_HANDOFFS.includes(p));

  it("rejects duplicates, unknown supervisors and handoff targets, self handoffs and supervision cycles", () => {
    expect(
      has(
        validateRoster([...entries(), ...entries([SUPPORT_CHARTER])]),
        "duplicate agent support-agent",
      ),
    ).toBe(true);
    expect(
      has(
        clean([{ ...SUPPORT_CHARTER, supervisor: "ghost-agent" }, ...EXISTING_CHARTERS.slice(1)]),
        "supervisor ghost-agent is not in the roster",
      ),
    ).toBe(true);
    expect(
      has(
        clean([
          {
            ...SUPPORT_CHARTER,
            handoffs: [{ to: "ghost-agent", workOrderKind: "x.y", when: "when needed" }],
          },
          ...EXISTING_CHARTERS.slice(1),
        ]),
        "handoff target ghost-agent",
      ),
    ).toBe(true);
    expect(
      has(
        clean([
          {
            ...SUPPORT_CHARTER,
            handoffs: [{ to: "support-agent", workOrderKind: "x.y", when: "when needed" }],
          },
          ...EXISTING_CHARTERS.slice(1),
        ]),
        "hands work off to itself",
      ),
    ).toBe(true);
    const cyc = [
      { ...SUPPORT_CHARTER, supervisor: "sales-agent" },
      { ...SALES_CHARTER, supervisor: "support-agent" },
      ...EXISTING_CHARTERS.filter((c) => !["support-agent", "sales-agent"].includes(c.packCode)),
    ];
    expect(has(clean(cyc), "supervision cycle")).toBe(true);
  });

  it("requires a department agent to be supervised by the executive agent", () => {
    const rest = EXISTING_CHARTERS.filter((c) => c.packCode !== "support-agent");
    expect(
      has(
        clean([{ ...SUPPORT_CHARTER, supervisor: "sales-agent" }, ...rest]),
        "must be supervised by the executive agent",
      ),
    ).toBe(true);
  });

  it("allows only one executive agent", () => {
    const second: AgentCharter = {
      ...OPERATIONS_CHARTER,
      agentTier: "executive",
      supervisor: "sheriff",
    };
    const rest = EXISTING_CHARTERS.filter((c) => c.packCode !== "operations-agent");
    expect(has(clean([second, ...rest]), "more than one executive agent")).toBe(true);
  });

  it("requires exactly one owner for every T3 capability", () => {
    const noOwner = {
      ...JARVIS_CHARTER,
      t3Rules: {
        ...JARVIS_CHARTER.t3Rules,
        "request.access.grant": "delegate_requires_owner_proposal" as const,
      },
    };
    expect(
      has(
        clean([noOwner, ...EXISTING_CHARTERS.filter((c) => c.packCode !== "jarvis-executive")]),
        "T3 request.access.grant: needs exactly one owner, found 0",
      ),
    ).toBe(true);
    const two = {
      ...JARVIS_CHARTER,
      t3Rules: { ...JARVIS_CHARTER.t3Rules, "request.deploy": "owner" as const },
    };
    expect(
      has(
        clean([two, ...EXISTING_CHARTERS.filter((c) => c.packCode !== "jarvis-executive")]),
        "T3 request.deploy: needs exactly one owner, found 2",
      ),
    ).toBe(true);
  });

  it("includes each charter's own problems, prefixed with the agent", () => {
    const bad = { ...SUPPORT_CHARTER, mission: "short" };
    expect(
      validateRoster(entries([bad, ...EXISTING_CHARTERS.slice(1)])).some((p) =>
        p.startsWith("support-agent: schema:"),
      ),
    ).toBe(true);
  });
});
