// ─── Phase 28 — Developer Platform ────────────────────────────
import { describe, it, expect } from "vitest";
import {
  createDeveloperOrganization,
  isProjectVisibleToOrg,
  createDeveloperProject,
  createProjectManifest,
  registerSdk,
  isProductionAccessPermitted,
  grantBreakGlassDevAccess,
  developerOrganizationId,
  developerProjectId,
  projectManifestId,
  sdkId,
} from "@/lib/dev-core";
import {
  registerApiEndpoint,
  canApplyBreakingApiChange,
  createApiExplorerRequest,
  publishSchemaVersion,
  isSchemaBackwardCompatible,
  createDataContract,
  apiEndpointId,
  schemaVersionId,
  dataContractId,
} from "@/lib/dev-api";
import {
  createDevEnvironment,
  isProductionEnvironmentPermitted,
  registerDevSecret,
  detectSecretExposure,
  createSandbox,
  isPermissionGrantedInScenario,
  createSyntheticIdentity,
  isTenantIsolationRespected,
  registerEventCatalogEntry,
  canGenerateSyntheticEvent,
  registerDevWebhook,
  isDevWebhookDeliveryValid,
  simulateDataAccess,
  devEnvironmentId,
  devSecretId,
  sandboxId,
  syntheticIdentityId,
  devWebhookId,
} from "@/lib/dev-env";
import {
  registerProjectTemplate,
  evaluateStaticAnalysis,
  validateDevPackage,
  buildDevPackage,
  createCiRun,
  canAdvanceCiStage,
  createReleaseChannel,
  canPromoteReleaseChannel,
  isSemanticVersion,
  createCanaryDeployment,
  setDevFeatureFlag,
  projectTemplateId,
  devPackageId,
  releaseChannelId,
} from "@/lib/dev-build";
import {
  consumeDevQuota,
  evaluateRateLimitBehavior,
  canInjectFailure,
  recordDevAuditEvent,
  evaluateGovernanceGates,
  isReleaseApproved,
  isDevAiDeploymentPermitted,
  isGeneratedCodeCompliant,
  isDependencyApproved,
  registerBuildArtifact,
  isDeveloperExitPermitted,
  isCompatibilityCellValid,
  devQuotaId,
  devAuditEventId,
} from "@/lib/dev-governance";
import type { TenantId } from "@/lib/tenant-core";

const TENANT = "tenant-a" as TenantId;
const OTHER = "tenant-b" as TenantId;
const ORG = developerOrganizationId("org-1");
const PROJECT = developerProjectId("proj-1");

describe("dev-core — Organizations & Projects (7, 8, 9, 10-18, 19)", () => {
  it("creates organization requiring owner", () => {
    const ok = createDeveloperOrganization({
      id: ORG,
      tenantId: TENANT,
      name: "DevCo",
      members: [{ developerRef: "dev-1", role: "owner" }],
    });
    expect(ok.ok).toBe(true);
    const bad = createDeveloperOrganization({
      id: developerOrganizationId("org-2"),
      tenantId: TENANT,
      name: "X",
      members: [{ developerRef: "dev-1", role: "developer" }],
    });
    expect(bad.ok).toBe(false);
  });
  it("enforces organization isolation", () => {
    expect(isProjectVisibleToOrg(ORG, ORG, false)).toBe(true);
    expect(isProjectVisibleToOrg(ORG, developerOrganizationId("org-other"), false)).toBe(false);
    expect(isProjectVisibleToOrg(ORG, developerOrganizationId("org-other"), true)).toBe(true);
  });
  it("creates project", () => {
    const r = createDeveloperProject({
      id: PROJECT,
      organizationId: ORG,
      ownerRef: "dev-1",
      name: "Attendance Agent",
      type: "agent",
      targetPhase: "07",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.visibility).toBe("private");
  });
  it("creates manifest", () => {
    const r = createProjectManifest({
      id: projectManifestId("m1"),
      projectId: PROJECT,
      version: "1.0.0",
      projectType: "agent",
      environments: ["production"],
      compatibleSherivsVersion: "2.0.0",
    });
    expect(r.ok).toBe(true);
  });
  it("rejects production manifest without compatibility", () => {
    expect(
      createProjectManifest({
        id: projectManifestId("m2"),
        projectId: PROJECT,
        version: "1",
        projectType: "agent",
        environments: ["production"],
      }).ok,
    ).toBe(false);
  });
  it("registers SDK", () => {
    const s = registerSdk({
      id: sdkId("sdk-1"),
      language: "typescript",
      version: "1.0.0",
      abstractions: ["identity", "tenants"],
    });
    expect(s.abstractions).toContain("tenants");
  });
});

describe("dev-core — Production Access (CY) & Break-Glass (CZ)", () => {
  it("production access requires all controls", () => {
    expect(
      isProductionAccessPermitted({
        developerRef: "dev-1",
        strongerAuthentication: true,
        appropriateRole: true,
        explicitAuthorization: true,
        auditable: true,
        riskControls: true,
      }),
    ).toBe(true);
    expect(
      isProductionAccessPermitted({
        developerRef: "dev-1",
        strongerAuthentication: true,
        appropriateRole: true,
        explicitAuthorization: false,
        auditable: true,
        riskControls: true,
      }),
    ).toBe(false);
  });
  it("break-glass requires reason and limited duration", () => {
    const ok = grantBreakGlassDevAccess({
      developerRef: "dev-1",
      reason: "Outage response",
      scope: ["prod-app-1"],
      durationMinutes: 60,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.access.expiresAt > ok.access.grantedAt).toBe(true);
    expect(
      grantBreakGlassDevAccess({
        developerRef: "dev-1",
        reason: "",
        scope: ["x"],
        durationMinutes: 60,
      }).ok,
    ).toBe(false);
  });
});

describe("dev-api — Catalog, Versioning, Schema (22, 23, 24, 25, 26, 41, 42, AJ)", () => {
  it("registers API endpoint", () => {
    const r = registerApiEndpoint({
      id: apiEndpointId("e1"),
      path: "/v1/students",
      style: "rest",
      version: "1",
      domain: "education",
      purpose: "List students",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endpoint.authenticationRequired).toBe(true);
  });
  it("rejects endpoint without purpose", () => {
    expect(
      registerApiEndpoint({
        id: apiEndpointId("e2"),
        path: "/v1/x",
        style: "rest",
        version: "1",
        domain: "e",
        purpose: "",
      }).ok,
    ).toBe(false);
  });
  it("breaking change requires migration plan", () => {
    const ok = canApplyBreakingApiChange({
      change: { kind: "breaking", description: "remove field" },
      migrationPlanRef: "mig-1",
      previousVersionSupported: true,
      deprecated: true,
    });
    expect(ok.allowed).toBe(true);
    const bad = canApplyBreakingApiChange({
      change: { kind: "breaking", description: "remove field" },
      migrationPlanRef: null,
      previousVersionSupported: false,
      deprecated: false,
    });
    expect(bad.allowed).toBe(false);
  });
  it("API explorer restricted to sandbox", () => {
    expect(createApiExplorerRequest({ endpointId: apiEndpointId("e1"), method: "GET" }).ok).toBe(
      true,
    );
    expect(
      createApiExplorerRequest({
        endpointId: apiEndpointId("e1"),
        method: "GET",
        environment: "development",
      }).ok,
    ).toBe(false);
  });
  it("schema compatibility detects breaking change", () => {
    const v1 = publishSchemaVersion({
      id: schemaVersionId("s1"),
      schemaKey: "student",
      version: 1,
      requiredFields: ["id", "name"],
      producerRef: "p1",
    });
    const v2 = publishSchemaVersion({
      id: schemaVersionId("s2"),
      schemaKey: "student",
      version: 2,
      requiredFields: ["id"],
      producerRef: "p1",
    });
    expect(isSchemaBackwardCompatible(v1, v2)).toBe(false);
    const v3 = publishSchemaVersion({
      id: schemaVersionId("s3"),
      schemaKey: "student",
      version: 3,
      requiredFields: ["id", "name", "age"],
      producerRef: "p1",
    });
    expect(isSchemaBackwardCompatible(v1, v3)).toBe(true);
  });
  it("creates data contract", () => {
    const d = createDataContract({
      id: dataContractId("dc1"),
      projectRef: PROJECT,
      dataConsumed: ["attendance"],
      sensitivity: "CONFIDENTIAL",
    });
    expect(d.sensitivity).toBe("CONFIDENTIAL");
  });
});

describe("dev-env — Environments & Secrets (V, W, 34, 35, 31-33)", () => {
  it("creates development environment", () => {
    const e = createDevEnvironment({
      id: devEnvironmentId("env-1"),
      projectRef: PROJECT,
      kind: "development",
      quotas: { api_calls: 1000 },
    });
    expect(e.kind).toBe("development");
  });
  it("production environment requires controls", () => {
    expect(
      isProductionEnvironmentPermitted({
        strongerAuthentication: true,
        explicitAuthorization: true,
        riskControls: true,
      }),
    ).toBe(true);
    expect(
      isProductionEnvironmentPermitted({
        strongerAuthentication: true,
        explicitAuthorization: false,
        riskControls: true,
      }),
    ).toBe(false);
  });
  it("development secrets only", () => {
    const ok = registerDevSecret({
      id: devSecretId("sec-1"),
      projectRef: PROJECT,
      environmentKind: "development",
      ref: "env:DB_PASSWORD",
      fingerprint: "fp",
    });
    expect(ok.ok).toBe(true);
    const bad = registerDevSecret({
      id: devSecretId("sec-2"),
      projectRef: PROJECT,
      environmentKind: "production",
      ref: "env:KEY",
      fingerprint: "fp",
    });
    expect(bad.ok).toBe(false);
  });
  it("detects committed secrets", () => {
    expect(detectSecretExposure("api_key = sk-abcdefghijklmnop")).toContain("api_key");
    expect(detectSecretExposure("-----BEGIN RSA PRIVATE KEY-----")).toContain("private_key");
    expect(detectSecretExposure("const x = 42;")).toEqual([]);
  });
  it("sandbox isolated from production", () => {
    expect(createSandbox({ id: sandboxId("sb-1"), projectRef: PROJECT }).ok).toBe(true);
    expect(
      createSandbox({ id: sandboxId("sb-2"), projectRef: PROJECT, productionIsolated: false }).ok,
    ).toBe(false);
  });
});

describe("dev-env — Simulation & Testing (36, 37, AB, 38, 39, AF, AH, AK)", () => {
  it("permission scenarios grant only full", () => {
    expect(
      isPermissionGrantedInScenario({ permission: "student.read", scenario: "full", valid: true }),
    ).toBe(true);
    expect(
      isPermissionGrantedInScenario({
        permission: "student.read",
        scenario: "denied",
        valid: true,
      }),
    ).toBe(false);
    expect(
      isPermissionGrantedInScenario({
        permission: "student.read",
        scenario: "expired",
        valid: true,
      }),
    ).toBe(false);
  });
  it("creates synthetic identity", () => {
    const i = createSyntheticIdentity({
      id: syntheticIdentityId("si-1"),
      tenantId: TENANT,
      role: "teacher",
      label: "Test Teacher",
    });
    expect(i.role).toBe("teacher");
  });
  it("enforces tenant isolation in tests", () => {
    expect(isTenantIsolationRespected(TENANT, TENANT)).toBe(true);
    expect(isTenantIsolationRespected(TENANT, OTHER)).toBe(false);
  });
  it("registers event catalog entry", () => {
    const e = registerEventCatalogEntry({
      eventName: "attendance.recorded",
      schemaRef: "sch-1",
      producerRef: "p1",
    });
    expect(e.deliveryGuarantees).toBe("at_least_once");
  });
  it("synthetic events never target production", () => {
    expect(canGenerateSyntheticEvent("sandbox" as never)).toBe(true);
    expect(canGenerateSyntheticEvent("production" as never)).toBe(false);
  });
  it("webhook delivery validates signature/replay/idempotency", () => {
    const w = registerDevWebhook({
      id: devWebhookId("wh-1"),
      projectRef: PROJECT,
      eventTypes: ["attendance.recorded"],
      endpoint: "https://x.example/hook",
      secretFingerprint: "fp",
    });
    expect(
      isDevWebhookDeliveryValid({
        webhook: w,
        signatureValid: true,
        eventAgeMinutes: 1,
        attempt: 1,
        idempotentKeyPresent: true,
      }).valid,
    ).toBe(true);
    expect(
      isDevWebhookDeliveryValid({
        webhook: w,
        signatureValid: false,
        eventAgeMinutes: 1,
        attempt: 1,
        idempotentKeyPresent: true,
      }).valid,
    ).toBe(false);
    expect(
      isDevWebhookDeliveryValid({
        webhook: w,
        signatureValid: true,
        eventAgeMinutes: 30,
        attempt: 1,
        idempotentKeyPresent: true,
      }).valid,
    ).toBe(false);
  });
  it("simulates data access", () => {
    expect(simulateDataAccess("permitted").granted).toBe(true);
    expect(simulateDataAccess("denied").granted).toBe(false);
    expect(simulateDataAccess("partial").partial).toBe(true);
    expect(simulateDataAccess("filtered").filtered).toBe(true);
  });
});

describe("dev-build — Templates, Analysis, Packages (28, 48, BB, BC, BF, BH)", () => {
  it("registers project template", () => {
    const t = registerProjectTemplate({
      id: projectTemplateId("t1"),
      projectType: "agent",
      name: "Agent Starter",
    });
    expect(t.files).toContain("coregrid.yaml");
  });
  it("evaluates static analysis", () => {
    expect(evaluateStaticAnalysis({}).passed).toBe(true);
    expect(evaluateStaticAnalysis({ failingChecks: ["security_analysis"] }).passed).toBe(false);
  });
  it("validates package", () => {
    const ok = validateDevPackage({
      manifestValid: true,
      dependenciesResolved: true,
      permissionsApproved: true,
      schemasValid: true,
      apisCompatible: true,
      securityScanPassed: true,
    });
    expect(ok.ok).toBe(true);
    const bad = validateDevPackage({
      manifestValid: true,
      dependenciesResolved: true,
      permissionsApproved: true,
      schemasValid: true,
      apisCompatible: true,
      securityScanPassed: false,
    });
    expect(bad.ok).toBe(false);
    expect(bad.failures).toContain("security");
  });
  it("builds package", () => {
    const p = buildDevPackage({
      id: devPackageId("pkg-1"),
      projectRef: PROJECT,
      version: "1.0.0",
      manifestRef: "m1",
      signed: true,
      sbomRef: "sbom-1",
    });
    expect(p.signed).toBe(true);
    expect(p.sbomRef).toBe("sbom-1");
  });
});

describe("dev-build — CI, Versioning, Channels, Canary (BI, BS, BT, BV, BW)", () => {
  it("CI run advances one stage at a time", () => {
    const run = createCiRun({ id: "ci-1", projectRef: PROJECT });
    expect(run.currentStage).toBe("commit");
    expect(canAdvanceCiStage("commit", "build")).toBe(true);
    expect(canAdvanceCiStage("commit", "publish")).toBe(false);
  });
  it("promotes release channels", () => {
    const c = createReleaseChannel({
      id: releaseChannelId("rc-1"),
      projectRef: PROJECT,
      kind: "alpha",
    });
    expect(c.kind).toBe("alpha");
    expect(canPromoteReleaseChannel("alpha", "beta")).toBe(true);
    expect(canPromoteReleaseChannel("stable", "alpha")).toBe(false);
  });
  it("validates semantic versions", () => {
    expect(isSemanticVersion("1.2.3")).toBe(true);
    expect(isSemanticVersion("1.2")).toBe(false);
  });
  it("canary respects traffic limits", () => {
    expect(
      createCanaryDeployment({
        projectRef: PROJECT,
        releaseRef: "r1",
        trafficFraction: 0.05,
        maxTrafficFraction: 0.2,
      }).ok,
    ).toBe(true);
    expect(
      createCanaryDeployment({
        projectRef: PROJECT,
        releaseRef: "r1",
        trafficFraction: 0.5,
        maxTrafficFraction: 0.2,
      }).ok,
    ).toBe(false);
  });
  it("sets feature flags", () => {
    const f = setDevFeatureFlag({ key: "new-ui", projectRef: PROJECT, enabled: true });
    expect(f.enabled).toBe(true);
  });
});

describe("dev-governance — Quotas, Audit, Gates (CA, CB, CC, CT, FF, FA)", () => {
  it("consumes developer quotas", () => {
    const q = {
      id: devQuotaId("q1"),
      projectRef: PROJECT,
      kind: "api_calls" as const,
      limit: 100,
      used: 90,
      windowRef: "w",
    };
    expect(consumeDevQuota(q, 5).ok).toBe(true);
    expect(consumeDevQuota(q, 20).ok).toBe(false);
  });
  it("evaluates rate limit behavior", () => {
    expect(evaluateRateLimitBehavior(80, 100).allowed).toBe(true);
    expect(evaluateRateLimitBehavior(120, 100).exceeded).toBe(true);
  });
  it("failure injection restricted to non-production", () => {
    expect(canInjectFailure("development")).toBe(true);
    expect(canInjectFailure("production")).toBe(false);
  });
  it("records audit events", () => {
    const e = recordDevAuditEvent({
      id: devAuditEventId("a1"),
      tenantId: TENANT,
      projectRef: PROJECT,
      type: "release",
      actorRef: "dev-1",
    });
    expect(e.type).toBe("release");
  });
  it("governance gates gate releases", () => {
    const ok = evaluateGovernanceGates([
      "code",
      "tests",
      "security",
      "compatibility",
      "policy",
      "approval",
      "release",
    ]);
    expect(ok.releaseable).toBe(true);
    const bad = evaluateGovernanceGates(["code", "tests"]);
    expect(bad.releaseable).toBe(false);
    expect(bad.missing).toContain("release");
  });
  it("high-risk releases require manual approval", () => {
    expect(isReleaseApproved({ highRisk: true, manualApprovalGranted: false })).toBe(false);
    expect(isReleaseApproved({ highRisk: false, manualApprovalGranted: false })).toBe(true);
  });
});

describe("dev-governance — AI, Dependency, Exit, Compatibility (CP, CQ, EQ, ER, FT, FU, EY)", () => {
  it("AI cannot auto-deploy destructive production changes", () => {
    expect(
      isDevAiDeploymentPermitted({
        destructive: true,
        explicitAuthorization: true,
        environmentKind: "production",
      }),
    ).toBe(true);
    expect(
      isDevAiDeploymentPermitted({
        destructive: true,
        explicitAuthorization: false,
        environmentKind: "production",
      }),
    ).toBe(false);
    expect(
      isDevAiDeploymentPermitted({
        destructive: false,
        explicitAuthorization: false,
        environmentKind: "development",
      }),
    ).toBe(true);
  });
  it("generated code must be inspectable/editable/testable/attributable", () => {
    expect(
      isGeneratedCodeCompliant({
        inspectable: true,
        editable: true,
        testable: true,
        attributable: true,
      }),
    ).toBe(true);
    expect(
      isGeneratedCodeCompliant({
        inspectable: true,
        editable: true,
        testable: false,
        attributable: true,
      }),
    ).toBe(false);
  });
  it("dependency policy restricts dependencies", () => {
    expect(
      isDependencyApproved({
        dependencyKey: "pkg-a",
        approvedDependencies: ["pkg-a", "pkg-b"],
        restrictedDependencies: [],
      }).approved,
    ).toBe(true);
    expect(
      isDependencyApproved({
        dependencyKey: "pkg-c",
        approvedDependencies: ["pkg-a"],
        restrictedDependencies: [],
      }).approved,
    ).toBe(false);
    expect(
      isDependencyApproved({
        dependencyKey: "pkg-x",
        approvedDependencies: [],
        restrictedDependencies: ["pkg-x"],
      }).approved,
    ).toBe(false);
  });
  it("registers build artifact with image scan", () => {
    const a = registerBuildArtifact({
      id: "art-1",
      projectRef: PROJECT,
      version: "1.0.0",
      checksumRef: "sha256:abc",
      imageScanPassed: true,
    });
    expect(a.imageScanPassed).toBe(true);
  });
  it("developer exit requires ownership retention", () => {
    expect(
      isDeveloperExitPermitted({
        metadataExportable: true,
        artifactsExportable: true,
        sourceOwnedByDeveloper: true,
      }),
    ).toBe(true);
    expect(
      isDeveloperExitPermitted({
        metadataExportable: true,
        artifactsExportable: true,
        sourceOwnedByDeveloper: false,
      }),
    ).toBe(false);
  });
  it("compatibility matrix validates versions", () => {
    const cell = {
      sherivsVersion: "2.0.0",
      sdkVersion: "1.0.0",
      apiVersion: "v1",
      schemaVersion: "1",
      runtimeVersion: "r1",
      productVersion: "1.0.0",
    };
    expect(isCompatibilityCellValid(cell, { sherivsVersion: ["2.0.0", "2.1.0"] })).toBe(true);
    expect(
      isCompatibilityCellValid(
        { ...cell, sherivsVersion: "3.0.0" },
        { sherivsVersion: ["2.0.0"] },
      ),
    ).toBe(false);
  });
});
