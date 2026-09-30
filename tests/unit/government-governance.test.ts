// ─── Phase 20 — Government Education Cloud: government-governance ────
import { describe, it, expect } from "vitest";
import type {
  NationalDashboard,
  BenchmarkEntry,
  GovernmentSLO,
  AuditRetentionPolicy,
  LegalHoldRecord,
  GovernmentDataRequest,
  ComplianceRegistry,
  ComplianceEvidence,
  ComplianceException,
  SupplierRegistry,
  ThirdPartyRisk,
  GovernmentDeploymentProfile,
  RiskRegisterEntry,
  GovernmentKPI,
  OutcomeFramework,
  EarlyWarningSignal,
  GovernmentIntervention,
  GovernmentAgentRegistry,
  GovernmentAIModel,
  GovernmentAcceptanceCriterion,
  GovernmentArchitecturalInvariant,
} from "@/lib/government-governance";

describe("government-governance — Dashboard", () => {
  it("creates valid national dashboard", () => {
    const d: NationalDashboard = {
      id: "DASH-NG-001",
      jurisdiction: "ng-fed",
      kpis: [{ name: "Enrollment Rate", value: 85, trend: "up" }],
      lastUpdated: "2026-08-27T10:00:00Z",
      status: "current",
    };
    expect(d.kpis[0].trend).toBe("up");
  });
});

describe("government-governance — SLO", () => {
  it("creates SLO with breach count", () => {
    const s: GovernmentSLO = {
      serviceName: "National ID Verification API",
      targetAvailability: 99.9,
      targetLatency: 200,
      measurementPeriod: "30d",
      currentAvailability: 99.95,
      breaches: 0,
    };
    expect(s.breaches).toBe(0);
  });
});

describe("government-governance — Audit Retention & Legal Hold", () => {
  it("creates immutable retention policy", () => {
    const p: AuditRetentionPolicy = {
      category: "financial",
      retentionYears: 7,
      immutable: true,
      legalHoldExempt: false,
    };
    expect(p.immutable).toBe(true);
  });

  it("creates active legal hold", () => {
    const h: LegalHoldRecord = {
      id: "LH-001",
      entityId: "entity-1",
      reason: "Pending litigation",
      authorizedBy: "judge-1",
      placedAt: "2026-08-01T00:00:00Z",
      releasedAt: null,
      status: "active",
    };
    expect(h.status).toBe("active");
  });

  it("creates data request", () => {
    const r: GovernmentDataRequest = {
      id: "DR-001",
      requesterId: "citizen-1",
      requestType: "access",
      dataSubject: "citizen-1",
      status: "submitted",
      submittedAt: "2026-08-01T00:00:00Z",
      resolvedAt: null,
    };
    expect(r.status).toBe("submitted");
  });
});

describe("government-governance — Compliance", () => {
  it("creates compliance registry", () => {
    const c: ComplianceRegistry = {
      id: "CR-001",
      name: "Data Protection Compliance",
      jurisdiction: "ng-fed",
      requirements: ["DPA-2023-1", "DPA-2023-2"],
      evidence: [],
      status: "unknown",
    };
    expect(c.requirements).toHaveLength(2);
  });

  it("creates compliance evidence", () => {
    const e: ComplianceEvidence = {
      id: "CE-001",
      requirementRef: "DPA-2023-1",
      evidenceType: "audit",
      validUntil: "2027-01-01",
      status: "valid",
    };
    expect(e.status).toBe("valid");
  });

  it("creates compliance exception", () => {
    const ex: ComplianceException = {
      id: "CEX-001",
      requirementRef: "REG-101",
      justification: "Technical limitation",
      approvedBy: "director-1",
      expiresAt: "2026-12-31",
      status: "active",
    };
    expect(ex.status).toBe("active");
  });
});
describe("government-governance — Supplier & Risk", () => {
  it("creates supplier record", () => {
    const s: SupplierRegistry = {
      id: "SUP-001",
      name: "EduCloud Ltd",
      service: "Cloud Infrastructure",
      jurisdiction: "ng-lagos",
      contractPeriod: { start: "2025-01-01", end: "2027-12-31" },
      status: "active",
    };
    expect(s.status).toBe("active");
  });

  it("creates risk entry with score", () => {
    const r: RiskRegisterEntry = {
      id: "RISK-001",
      description: "Data breach",
      likelihood: 2,
      impact: 5,
      riskScore: 10,
      mitigations: ["MFA", "RLS"],
      owner: "security-team",
      status: "identified",
    };
    expect(r.riskScore).toBe(10);
  });
});

describe("government-governance — KPI & Outcomes", () => {
  it("creates government KPI", () => {
    const k: GovernmentKPI = {
      id: "KPI-NG-001",
      name: "Primary Enrollment Rate",
      jurisdiction: "ng-fed",
      target: 95,
      current: 87,
      measurementMethod: "census",
      frequency: "annual",
    };
    expect(k.current).toBeLessThan(k.target);
  });

  it("creates outcome framework", () => {
    const o: OutcomeFramework = {
      id: "OF-001",
      name: "Education for All",
      jurisdiction: "ng-fed",
      outcomes: [{ name: "Access", target: 100, weight: 0.5 }],
    };
    expect(o.outcomes[0].weight).toBe(0.5);
  });
});

describe("government-governance — Early Warning", () => {
  it("creates warning signal", () => {
    const w: EarlyWarningSignal = {
      id: "EW-001",
      jurisdiction: "ng-lagos",
      indicator: "dropout_rate",
      value: 15,
      threshold: 10,
      severity: "high",
      detectedAt: "2026-08-27T00:00:00Z",
    };
    expect(w.severity).toBe("high");
  });
});

describe("government-governance — AI Registry", () => {
  it("creates AI agent entry", () => {
    const a: GovernmentAgentRegistry = {
      id: "AGENT-001",
      name: "Education Policy Analyzer",
      purpose: "Analyze policy compliance",
      jurisdiction: "ng-fed",
      modelId: "GPT-4",
      humanOversight: true,
      status: "approved",
      auditTrail: [],
    };
    expect(a.humanOversight).toBe(true);
  });

  it("creates AI model entry", () => {
    const m: GovernmentAIModel = {
      id: "MODEL-001",
      name: "GPT-4",
      version: "turbo-2024",
      provider: "OpenAI",
      jurisdiction: "ng-fed",
      approvedUseCases: ["text_analysis"],
      status: "approved",
    };
    expect(m.approvedUseCases).toContain("text_analysis");
  });
});

describe("government-governance — Acceptance & Invariants", () => {
  it("creates acceptance criterion", () => {
    const c: GovernmentAcceptanceCriterion = {
      id: "AC-001",
      description: "All API responses must be signed",
      category: "security",
      testable: true,
      acceptanceThreshold: "100% signed",
    };
    expect(c.testable).toBe(true);
  });

  it("creates architectural invariant", () => {
    const i: GovernmentArchitecturalInvariant = {
      id: "INV-001",
      statement: "Data never leaves sovereign jurisdiction without treaty",
      violationRisk: "critical",
    };
    expect(i.violationRisk).toBe("critical");
  });
});
