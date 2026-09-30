// ─── Phase 21 — Global Cloud Fabric: cloud-byoc ──────────────────────
import { describe, it, expect } from "vitest";
import {
  registerBYOC,
  establishTrust,
  createPermissionManifest,
  revokeBYOC,
  checkBYOCHealth,
} from "@/lib/cloud-byoc";

describe("cloud-byoc — Registration", () => {
  it("registers BYOC deployment", () => {
    const d = registerBYOC({
      id: "BYOC-001" as any,
      customerId: "cust-1",
      model: "customer_managed",
      provider: "aws",
      region: "us-east-1",
    });
    expect(d.status).toBe("registered");
    expect(d.model).toBe("customer_managed");
  });
});

describe("cloud-byoc — Trust Establishment", () => {
  it("establishes active trust", () => {
    const t = establishTrust({
      deploymentId: "BYOC-001" as any,
      oidcIssuer: "https://oidc.example.com",
      certificateThumbprint: "thumbprint-1",
    });
    expect(t.status).toBe("active");
    expect(t.oidcIssuer).toBe("https://oidc.example.com");
  });

  it("rejects missing OIDC issuer", () => {
    expect(() =>
      establishTrust({ deploymentId: "x" as any, oidcIssuer: "", certificateThumbprint: "x" }),
    ).toThrow();
  });
});

describe("cloud-byoc — Permission Manifest", () => {
  it("creates approved manifest", () => {
    const m = createPermissionManifest({
      deploymentId: "BYOC-001" as any,
      requiredPermissions: ["ec2:DescribeInstances", "s3:ListBucket"],
      actualPermissions: ["ec2:DescribeInstances", "s3:ListBucket"],
      approvedBy: "admin-1",
    });
    expect(m.status).toBe("approved");
    expect(m.requiredPermissions).toHaveLength(2);
  });

  it("rejects empty permissions", () => {
    expect(() =>
      createPermissionManifest({
        deploymentId: "x" as any,
        requiredPermissions: [],
        actualPermissions: [],
        approvedBy: "admin",
      }),
    ).toThrow();
  });
});

describe("cloud-byoc — Revocation", () => {
  it("initiates revocation", () => {
    const r = revokeBYOC({
      deploymentId: "BYOC-001" as any,
      reason: "Customer contract ended",
      authorizedBy: "admin-1",
    });
    expect(r.status).toBe("initiated");
    expect(r.dataExportRequired).toBe(true);
  });

  it("rejects revocation without reason", () => {
    expect(() =>
      revokeBYOC({ deploymentId: "x" as any, reason: "", authorizedBy: "admin" }),
    ).toThrow();
  });
});

describe("cloud-byoc — Health Check", () => {
  it("returns healthy when all connected", () => {
    const d = registerBYOC({
      id: "BYOC-001" as any,
      customerId: "cust-1",
      model: "customer_managed",
      provider: "aws",
      region: "us-east-1",
    });
    const h = checkBYOCHealth(d, true, true);
    expect(h.status).toBe("healthy");
  });

  it("returns degraded when control plane connected but agent unhealthy", () => {
    const d = registerBYOC({
      id: "BYOC-002" as any,
      customerId: "cust-2",
      model: "customer_managed",
      provider: "aws",
      region: "us-west-2",
    });
    const h = checkBYOCHealth(d, true, false);
    expect(h.status).toBe("degraded");
  });

  it("returns unknown when control plane disconnected", () => {
    const d = registerBYOC({
      id: "BYOC-003" as any,
      customerId: "cust-3",
      model: "customer_managed",
      provider: "aws",
      region: "eu-west-1",
    });
    const h = checkBYOCHealth(d, false, false);
    expect(h.status).toBe("unknown");
  });
});
