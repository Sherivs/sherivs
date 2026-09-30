// ─── Phase 21 — Global Cloud Fabric: cloud-core ──────────────────────
import { describe, it, expect } from "vitest";
import {
  createInfrastructurePlan,
  approvePlan,
  createRegion,
  registerProvider,
  createDeployment,
  createDisasterRecoveryPlan,
  detectDrift,
} from "@/lib/cloud-core";

describe("cloud-core — Infrastructure Plan", () => {
  it("creates pending plan", () => {
    const p = createInfrastructurePlan({
      id: "PLAN-001" as any,
      intent: {
        compute: { cpu: 16, memory: 64 },
        storage: { capacity: 500, class: "ssd" },
        network: { bandwidth: 10, latency: 5 },
        residency: ["us-east"],
        availability: 99.95,
        sovereignty: null,
      },
      provider: "aws" as any,
      region: "us-east-1" as any,
      zones: ["us-east-1a" as any],
      estimatedCost: 15000,
    });
    expect(p.status).toBe("pending");
  });

  it("rejects plan with no zones", () => {
    expect(() =>
      createInfrastructurePlan({
        id: "PLAN-002" as any,
        intent: {
          compute: { cpu: 8, memory: 32 },
          storage: { capacity: 100, class: "hdd" },
          network: { bandwidth: 5, latency: 10 },
          residency: ["eu-west"],
          availability: 99.9,
          sovereignty: null,
        },
        provider: "azure" as any,
        region: "eu-west" as any,
        zones: [],
        estimatedCost: 8000,
      }),
    ).toThrow();
  });

  it("approves pending plan", () => {
    const p = createInfrastructurePlan({
      id: "PLAN-003" as any,
      intent: {
        compute: { cpu: 4, memory: 16 },
        storage: { capacity: 50, class: "ssd" },
        network: { bandwidth: 1, latency: 20 },
        residency: ["us-west"],
        availability: 99.9,
        sovereignty: null,
      },
      provider: "gcp" as any,
      region: "us-west1" as any,
      zones: ["us-west1-a" as any],
      estimatedCost: 5000,
    });
    const approved = approvePlan(p);
    expect(approved.status).toBe("approved");
  });
});

describe("cloud-core — Region", () => {
  it("creates active region", () => {
    const r = createRegion({
      id: "us-east-1" as any,
      name: "US East (N. Virginia)",
      provider: "aws" as any,
      geographicalArea: "North America",
      sovereign: false,
    });
    expect(r.status).toBe("active");
    expect(r.sovereign).toBe(false);
  });
});

describe("cloud-core — Provider", () => {
  it("registers provider with capabilities", () => {
    const p = registerProvider({
      id: "aws" as any,
      name: "Amazon Web Services",
      version: "2026.08",
      capabilities: [{ name: "compute", supported: true, details: "EC2" }],
    });
    expect(p.status).toBe("active");
  });

  it("rejects provider with no capabilities", () => {
    expect(() =>
      registerProvider({ id: "x" as any, name: "X", version: "1.0", capabilities: [] }),
    ).toThrow();
  });
});

describe("cloud-core — Deployment", () => {
  it("creates deployment with providers", () => {
    const d = createDeployment({
      id: "DEPLOY-001",
      type: "hybrid",
      providers: ["aws" as any, "azure" as any],
      primaryRegion: "us-east-1" as any,
    });
    expect(d.status).toBe("active");
  });

  it("rejects deployment with no providers", () => {
    expect(() =>
      createDeployment({
        id: "DEPLOY-002",
        type: "public",
        providers: [],
        primaryRegion: "us-east-1" as any,
      }),
    ).toThrow();
  });
});

describe("cloud-core — Disaster Recovery", () => {
  it("creates untested DR plan", () => {
    const dr = createDisasterRecoveryPlan({
      id: "DR-001",
      rpo: 3600,
      rto: 7200,
      primaryRegion: "us-east-1" as any,
      secondaryRegion: "us-west-2" as any,
      failoverType: "automated",
    });
    expect(dr.status).toBe("untested");
  });

  it("rejects zero RPO", () => {
    expect(() =>
      createDisasterRecoveryPlan({
        id: "DR-002",
        rpo: 0,
        rto: 3600,
        primaryRegion: "us-east-1" as any,
        secondaryRegion: "us-west-2" as any,
        failoverType: "manual",
      }),
    ).toThrow();
  });
});

describe("cloud-core — Drift Detection", () => {
  it("detects drift when states differ", () => {
    expect(detectDrift({ cpu: 4 }, { cpu: 8 })).toBe(true);
  });

  it("reports no drift when states match", () => {
    expect(detectDrift({ cpu: 4, memory: 16 }, { memory: 16, cpu: 4 })).toBe(false);
  });
});
