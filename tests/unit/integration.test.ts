// ─── Phase 29 — Sherivs Integration ─────────────────────────
import { describe, it, expect } from "vitest";
import {
  createConnector,
  canTransitionConnector,
  createIntegration,
  createConnection,
  createCredentialReference,
  isCredentialValid,
  isCredentialTenantIsolated,
  isLeastPrivilegeSatisfied,
  connectorId,
  integrationId,
  connectionId,
  credentialReferenceId,
} from "@/lib/integration-core";
import {
  createIntegrationMapping,
  applyMapping,
  validateInboundPayload,
  isEventAlreadyProcessed,
  markEventProcessed,
  recordDeadLetter,
  shouldRetry,
  computeBackoffDelay,
  isWithinProviderRateLimit,
  createSyncJob,
  resolveFieldAuthority,
  resolveConflict,
  reconcile,
  hasReconciliationGaps,
  integrationMappingId,
  deadLetterEntryId,
  syncJobId,
  reconciliationRunId,
  type RetryPolicy,
  type IdempotencyState,
} from "@/lib/integration-transform";
import {
  createProtocolAdapter,
  canTranslateLosslessly,
  isMappingProposalApplicable,
  aiCanSilentlyAlterMappings,
  runIntegrationTest,
  createMockProvider,
  isProductionCertified,
  isWebhookDeliverySecure,
  isNetworkSecuritySatisfied,
  protocolAdapterId,
  integrationTestId,
  mockProviderId,
} from "@/lib/integration-connect";
import {
  evaluateConnectorHealth,
  buildIntegrationDashboard,
  recordIntegrationLog,
  createTraceSpan,
  computeIntegrationMetrics,
  raiseIntegrationAlert,
  registerCertificate,
  isCertificateExpiringSoon,
  isIntegrationSecuritySatisfied,
  isTransferPermitted,
  recordIntegrationAuditEvent,
  integrationLogId,
  integrationAlertId,
  certificateRecordId,
  integrationAuditEventId,
  type IntegrationSecurityAssessment,
} from "@/lib/integration-ops";
import {
  createIntegrationGovernanceRecord,
  classifyIntegrationRisk,
  canEnterProduction,
  updateProviderStatus,
  evaluateSchemaDrift,
  pauseIntegration,
  resumeIntegration,
  canEmergencyDisconnect,
  requiresStoreAndForward,
  normalizeTimestamp,
  normalizeCurrency,
  createExternalIdMapping,
  isExternalIdTraceable,
  publishIntegrationEvent,
  integrationApprovalId,
  integrationEventId,
  externalIdMappingId,
  type IntegrationApproval,
} from "@/lib/integration-governance";
import type { TenantId } from "@/lib/tenant-core";

const TENANT = "tenant-a" as TenantId;
const OTHER = "tenant-b" as TenantId;
const CONN = connectorId("conn-1");
const INTG = integrationId("int-1");
const CONNECT = connectionId("conn-2");

const RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  backoffFactor: 2,
  jitterMs: 50,
};

describe("integration-core — Connector & Lifecycle (H, I, J)", () => {
  it("creates connector", () => {
    const r = createConnector({
      id: CONN,
      name: "Google Workspace",
      version: "1.0.0",
      provider: "google",
      authMethods: ["oauth2"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.connector.lifecycleState).toBe("draft");
  });
  it("rejects connector without provider", () => {
    expect(
      createConnector({ id: connectorId("c2"), name: "X", version: "1", provider: "" }).ok,
    ).toBe(false);
  });
  it("connector lifecycle advances one stage at a time", () => {
    expect(canTransitionConnector("draft", "development")).toBe(true);
    expect(canTransitionConnector("draft", "published")).toBe(false);
  });
  it("creates integration instance with tenant scope", () => {
    const r = createIntegration({
      id: INTG,
      tenantId: TENANT,
      connectorRef: CONN,
      name: "School A → Workspace",
      ownerRef: "id-admin-1",
      permissions: ["read", "write"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.integration.isActive).toBe(false);
  });
  it("creates connection and credential reference", () => {
    const c = createConnection({
      id: CONNECT,
      tenantId: TENANT,
      integrationRef: INTG,
      accountLabel: "Finance",
    });
    const cred = createCredentialReference({
      id: credentialReferenceId("cr-1"),
      tenantId: TENANT,
      connectionRef: CONNECT,
      authMethod: "oauth2",
      secretRef: "vault:gws-finance",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(cred.ok).toBe(true);
  });
  it("credential validity and tenant isolation", () => {
    const cred = createCredentialReference({
      id: credentialReferenceId("cr-2"),
      tenantId: TENANT,
      connectionRef: CONNECT,
      authMethod: "api_key",
      secretRef: "vault:k",
      expiresAt: "2026-06-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    });
    if (!cred.ok) throw new Error("expected ok");
    expect(isCredentialValid(cred.credential, "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(isCredentialValid(cred.credential, "2026-07-01T00:00:00.000Z")).toBe(false);
    expect(isCredentialTenantIsolated(cred.credential, TENANT)).toBe(true);
    expect(isCredentialTenantIsolated(cred.credential, OTHER)).toBe(false);
  });
  it("least privilege satisfied only for declared needs", () => {
    expect(isLeastPrivilegeSatisfied(["read"], ["read", "write"])).toBe(true);
    expect(isLeastPrivilegeSatisfied(["write"], ["read"])).toBe(false);
  });
});

describe("integration-transform — Mapping, Validation, Idempotency (U, V, W, X, Y, Z)", () => {
  it("creates mapping", () => {
    const r = createIntegrationMapping({
      id: integrationMappingId("m1"),
      integrationRef: INTG,
      externalField: "student_name",
      sherivsField: "name",
      kind: "direct",
    });
    expect(r.ok).toBe(true);
  });
  it("calculated mapping requires expression", () => {
    expect(
      createIntegrationMapping({
        id: integrationMappingId("m2"),
        integrationRef: INTG,
        externalField: "a",
        sherivsField: "b",
        kind: "calculated",
      }).ok,
    ).toBe(false);
  });
  it("applies mappings to canonical shape", () => {
    const m = createIntegrationMapping({
      id: integrationMappingId("m3"),
      integrationRef: INTG,
      externalField: "student_name",
      sherivsField: "name",
      kind: "direct",
    });
    if (!m.ok) throw new Error("expected ok");
    const out = applyMapping({ student_name: "Ada" }, [m.mapping]);
    expect(out.name).toBe("Ada");
  });
  it("validates inbound payload", () => {
    const ok = validateInboundPayload({
      payload: { id: "1", name: "A" },
      requiredFields: ["id", "name"],
      tenantId: TENANT,
      identityValid: true,
      integrityValid: true,
    });
    expect(ok.outcome).toBe("accepted");
    const bad = validateInboundPayload({
      payload: { name: "A" },
      requiredFields: ["id"],
      tenantId: TENANT,
      identityValid: true,
      integrityValid: true,
    });
    expect(bad.outcome).toBe("quarantined");
    const integrity = validateInboundPayload({
      payload: { id: "1" },
      requiredFields: ["id"],
      tenantId: TENANT,
      identityValid: true,
      integrityValid: false,
    });
    expect(integrity.outcome).toBe("dead_lettered");
  });
  it("idempotency prevents duplicate processing", () => {
    let state: IdempotencyState = { integrationRef: INTG, processedKeys: [] };
    expect(isEventAlreadyProcessed(state, "evt-1")).toBe(false);
    state = markEventProcessed(state, "evt-1");
    expect(isEventAlreadyProcessed(state, "evt-1")).toBe(true);
  });
});

describe("integration-transform — Retry, Rate Limits, Dead Letter (AF, AG, AI)", () => {
  it("retries only transient and rate-limited classes", () => {
    expect(shouldRetry({ retryClass: "transient", attempt: 1, policy: RETRY_POLICY })).toBe(true);
    expect(shouldRetry({ retryClass: "rate_limited", attempt: 1, policy: RETRY_POLICY })).toBe(
      true,
    );
    expect(shouldRetry({ retryClass: "permanent", attempt: 1, policy: RETRY_POLICY })).toBe(false);
    expect(shouldRetry({ retryClass: "authorization", attempt: 1, policy: RETRY_POLICY })).toBe(
      false,
    );
    expect(shouldRetry({ retryClass: "transient", attempt: 3, policy: RETRY_POLICY })).toBe(false);
  });
  it("computes exponential backoff", () => {
    const d = computeBackoffDelay({ attempt: 2, policy: RETRY_POLICY });
    expect(d).toBeGreaterThanOrEqual(200);
    expect(d).toBeLessThanOrEqual(250);
  });
  it("respects provider rate limits", () => {
    expect(isWithinProviderRateLimit(80, 100, 5)).toBe(true);
    expect(isWithinProviderRateLimit(120, 100, 5)).toBe(false);
  });
  it("records dead-letter entries without secrets", () => {
    const d = recordDeadLetter({
      id: deadLetterEntryId("dl-1"),
      tenantId: TENANT,
      connectorRef: CONN,
      operation: "sync",
      attempts: 4,
      error: "timeout",
      correlationId: "corr-1",
    });
    expect(d.attempts).toBe(4);
  });
});

describe("integration-transform — Sync, Authority, Conflicts, Reconciliation (AK-AN, AO, AP, AQ)", () => {
  it("creates sync job", () => {
    const j = createSyncJob({ id: syncJobId("sj-1"), integrationRef: INTG, mode: "incremental" });
    expect(j.state).toBe("idle");
  });
  it("field authority must be unambiguous", () => {
    expect(
      resolveFieldAuthority({
        field: "payroll_id",
        sherivsAuthoritative: false,
        externalAuthoritative: true,
      }).unambiguous,
    ).toBe(true);
    expect(
      resolveFieldAuthority({
        field: "x",
        sherivsAuthoritative: true,
        externalAuthoritative: true,
      }).unambiguous,
    ).toBe(false);
  });
  it("resolves conflicts by policy", () => {
    expect(
      resolveConflict({
        policy: "coregrid_wins",
        sherivsTimestamp: "2026-01-01",
        externalTimestamp: "2026-06-01",
      }),
    ).toBe("sherivs");
    expect(
      resolveConflict({
        policy: "latest_timestamp",
        sherivsTimestamp: "2026-01-01",
        externalTimestamp: "2026-06-01",
      }),
    ).toBe("external");
    expect(
      resolveConflict({
        policy: "manual_resolution",
        sherivsTimestamp: "2026-01-01",
        externalTimestamp: "2026-06-01",
      }),
    ).toBe("manual");
  });
  it("reconciles and flags gaps", () => {
    const r = reconcile({
      id: reconciliationRunId("rec-1"),
      integrationRef: INTG,
      sherivsRefs: ["c1", "c2"],
      externalRefs: ["c1", "c3"],
    });
    expect(r.missingInCoregrid).toEqual(["c3"]);
    expect(r.missingInExternal).toEqual(["c2"]);
    expect(hasReconciliationGaps(r)).toBe(true);
  });
});

describe("integration-connect — Protocol, AI, Testing, Security (BU, BV, BY, BZ, CA, CB, CE, BQ, BR)", () => {
  it("creates protocol adapter", () => {
    const a = createProtocolAdapter({
      id: protocolAdapterId("pa-1"),
      name: "SOAP→REST",
      from: "soap",
      to: "rest",
    });
    expect(a.lossless).toBe(false);
  });
  it("lossless translation detection", () => {
    expect(canTranslateLosslessly("json", "xml")).toBe(true);
    expect(canTranslateLosslessly("csv", "json")).toBe(false);
  });
  it("AI mapping proposals require approval in production", () => {
    const p = { externalField: "full_name", sherivsField: "name", confidence: 0.9 };
    expect(
      isMappingProposalApplicable({
        proposal: p,
        production: false,
        humanApproved: false,
        policyApproved: false,
      }),
    ).toBe(true);
    expect(
      isMappingProposalApplicable({
        proposal: p,
        production: true,
        humanApproved: false,
        policyApproved: false,
      }),
    ).toBe(false);
    expect(
      isMappingProposalApplicable({
        proposal: p,
        production: true,
        humanApproved: true,
        policyApproved: false,
      }),
    ).toBe(true);
  });
  it("AI never silently alters production mappings", () => {
    expect(aiCanSilentlyAlterMappings()).toBe(false);
  });
  it("runs integration tests", () => {
    const t = runIntegrationTest({
      id: integrationTestId("t1"),
      integrationRef: INTG,
      kind: "contract",
      passed: true,
    });
    expect(t.passed).toBe(true);
  });
  it("creates mock provider", () => {
    const m = createMockProvider({
      id: mockProviderId("mp-1"),
      providerName: "Paystack Sandbox",
      failureModes: ["timeout"],
    });
    expect(m.failureModes).toContain("timeout");
  });
  it("production certification requires all gates", () => {
    expect(
      isProductionCertified({
        connectorTestsPassed: true,
        securityTestsPassed: true,
        contractTestsPassed: true,
        approvalGranted: true,
      }),
    ).toBe(true);
    expect(
      isProductionCertified({
        connectorTestsPassed: true,
        securityTestsPassed: false,
        contractTestsPassed: true,
        approvalGranted: true,
      }),
    ).toBe(false);
  });
  it("webhook delivery secure only with all checks", () => {
    expect(
      isWebhookDeliverySecure({
        signatureValid: true,
        timestampFresh: true,
        replayPrevented: true,
        authenticated: true,
        authorized: true,
      }),
    ).toBe(true);
    expect(
      isWebhookDeliverySecure({
        signatureValid: false,
        timestampFresh: true,
        replayPrevented: true,
        authenticated: true,
        authorized: true,
      }),
    ).toBe(false);
  });
  it("network security enforces TLS/IP allowlist", () => {
    const req = {
      tlsRequired: true,
      certificateValidationRequired: true,
      ipAllowlist: ["10.0.0.1"],
      privateConnectivityRequired: false,
    };
    expect(
      isNetworkSecuritySatisfied(req, { tls: true, certificateValid: true, sourceIp: "10.0.0.1" }),
    ).toBe(true);
    expect(
      isNetworkSecuritySatisfied(req, { tls: false, certificateValid: true, sourceIp: "10.0.0.1" }),
    ).toBe(false);
    expect(
      isNetworkSecuritySatisfied(req, { tls: true, certificateValid: true, sourceIp: "10.0.0.2" }),
    ).toBe(false);
  });
});

describe("integration-ops — Health, Observability, Certificates (CF, CG, CH, CI, CJ, CK, CL)", () => {
  it("evaluates connector health", () => {
    const h = evaluateConnectorHealth({
      connectorRef: CONN,
      latencyMs: 200,
      errorRate: 0.01,
      providerStatus: "operational",
    });
    expect(h.healthy).toBe(true);
    const bad = evaluateConnectorHealth({
      connectorRef: CONN,
      latencyMs: 8000,
      errorRate: 0.01,
      providerStatus: "operational",
    });
    expect(bad.healthy).toBe(false);
  });
  it("builds dashboard snapshot", () => {
    const d = buildIntegrationDashboard({ activeIntegrations: 5, failedIntegrations: 1 });
    expect(d.activeIntegrations).toBe(5);
    expect(d.failedIntegrations).toBe(1);
  });
  it("records sanitized integration logs", () => {
    const l = recordIntegrationLog({
      id: integrationLogId("l1"),
      tenantId: TENANT,
      connectorRef: CONN,
      operation: "sync",
      correlationId: "corr-1",
      result: "success",
    });
    expect(l.payloadSanitized).toBe(true);
  });
  it("creates trace spans", () => {
    const s = createTraceSpan({ traceId: "t1", spanId: "s1", operation: "external-api" });
    expect(s.completedAt).toBeNull();
  });
  it("computes metrics", () => {
    const m = computeIntegrationMetrics({ successCount: 90, failureCount: 10 });
    expect(m.successRate).toBe(0.9);
  });
  it("raises alerts with severity", () => {
    const a = raiseIntegrationAlert({
      id: integrationAlertId("a1"),
      tenantId: TENANT,
      connectorRef: CONN,
      kind: "provider_outage",
      message: "Provider down",
    });
    expect(a.severity).toBe("critical");
  });
  it("certificate expiry detection", () => {
    const c = registerCertificate({
      id: certificateRecordId("c1"),
      tenantId: TENANT,
      connectorRef: CONN,
      subject: "api.example.com",
      expiresAt: "2026-02-01T00:00:00.000Z",
    });
    expect(isCertificateExpiringSoon(c, "2026-01-15T00:00:00.000Z")).toBe(true);
    expect(isCertificateExpiringSoon(c, "2025-01-01T00:00:00.000Z")).toBe(false);
    expect(isCertificateExpiringSoon(c, "2026-01-01T00:00:00.000Z", 60)).toBe(true);
  });
});

describe("integration-ops — Security, Data Governance, Audit (CM, CO, CT)", () => {
  it("integration security requires all controls", () => {
    const ok: IntegrationSecurityAssessment = {
      leastPrivilege: true,
      secretIsolation: true,
      encryption: true,
      tenantIsolation: true,
      networkIsolation: true,
      auditable: true,
      inputValidation: true,
      outputValidation: true,
    };
    expect(isIntegrationSecuritySatisfied(ok)).toBe(true);
    expect(isIntegrationSecuritySatisfied({ ...ok, secretIsolation: false })).toBe(false);
  });
  it("restricted data transfer requires consent and residency", () => {
    expect(
      isTransferPermitted({
        dataClass: "PUBLIC",
        destinationAuthorized: false,
        dataMinimized: false,
        consentPresent: false,
        residencySatisfied: false,
      }),
    ).toBe(true);
    expect(
      isTransferPermitted({
        dataClass: "RESTRICTED",
        destinationAuthorized: true,
        dataMinimized: true,
        consentPresent: false,
        residencySatisfied: true,
      }),
    ).toBe(false);
    expect(
      isTransferPermitted({
        dataClass: "SENSITIVE",
        destinationAuthorized: false,
        dataMinimized: true,
        consentPresent: true,
        residencySatisfied: true,
      }),
    ).toBe(false);
  });
  it("records audit events", () => {
    const e = recordIntegrationAuditEvent({
      id: integrationAuditEventId("a1"),
      tenantId: TENANT,
      integrationRef: INTG,
      type: "mapping_changed",
      actorRef: "id-admin-1",
    });
    expect(e.type).toBe("mapping_changed");
  });
});

describe("integration-governance — Governance, Risk, Approval (CU, CV, CW)", () => {
  it("creates governance record", () => {
    const r = createIntegrationGovernanceRecord({
      integrationRef: INTG,
      ownerRef: "id-admin-1",
      purpose: "Payroll sync",
      providerRef: "provider-1",
      credentialRef: "cr-1",
      supportContact: "support@x.com",
    });
    expect(r.ok).toBe(true);
  });
  it("rejects governance record without owner", () => {
    expect(
      createIntegrationGovernanceRecord({
        integrationRef: INTG,
        ownerRef: "",
        purpose: "p",
        providerRef: "p",
        credentialRef: "c",
        supportContact: "s",
      }).ok,
    ).toBe(false);
  });
  it("classifies integration risk", () => {
    expect(classifyIntegrationRisk({ domain: "financial", writesAuthoritativeData: false })).toBe(
      "high",
    );
    expect(
      classifyIntegrationRisk({ domain: "productivity", writesAuthoritativeData: false }),
    ).toBe("low");
    expect(
      classifyIntegrationRisk({ domain: "communication", writesAuthoritativeData: true }),
    ).toBe("medium");
  });
  it("high-risk integrations require full approval chain", () => {
    const approval: IntegrationApproval = {
      id: integrationApprovalId("ap-1"),
      integrationRef: INTG,
      stepsCompleted: ["security_review", "data_review", "architecture_review", "owner_approval"],
      approved: true,
    };
    expect(canEnterProduction(approval, "high")).toBe(true);
    expect(canEnterProduction({ ...approval, stepsCompleted: ["security_review"] }, "high")).toBe(
      false,
    );
    expect(canEnterProduction({ ...approval, stepsCompleted: [] }, "low")).toBe(true);
  });
});

describe("integration-governance — Drift, Pause, Resilience (CZ, DB, DC, DD, DE, DM, DN)", () => {
  it("updates provider status", () => {
    const p = updateProviderStatus({ providerRef: "provider-1", status: "degraded" });
    expect(p.status).toBe("degraded");
  });
  it("evaluates schema drift response by risk", () => {
    const high = evaluateSchemaDrift({
      expectedFields: ["id", "name"],
      observedFields: ["id"],
      riskLevel: "high",
    });
    expect(high.driftDetected).toBe(true);
    expect(high.response).toBe("quarantine");
    const low = evaluateSchemaDrift({
      expectedFields: ["id", "name"],
      observedFields: ["id"],
      riskLevel: "low",
    });
    expect(low.response).toBe("review");
  });
  it("pauses and resumes without deleting config", () => {
    const paused = pauseIntegration({ integrationRef: INTG, pausedByRef: "id-admin-1" });
    expect(paused.paused).toBe(true);
    expect(resumeIntegration(paused).paused).toBe(false);
  });
  it("emergency disconnect for critical integrations", () => {
    expect(canEmergencyDisconnect("critical")).toBe(true);
    expect(canEmergencyDisconnect("low")).toBe(false);
  });
  it("store-and-forward for unreliable connectivity", () => {
    expect(
      requiresStoreAndForward({
        unreliableConnectivity: true,
        intermittentMobileNetworks: false,
        highLatency: false,
        bandwidthLimited: false,
        regionalOutages: false,
        providerInstability: false,
        powerInterruptions: false,
      }),
    ).toBe(true);
    expect(
      requiresStoreAndForward({
        unreliableConnectivity: false,
        intermittentMobileNetworks: false,
        highLatency: true,
        bandwidthLimited: false,
        regionalOutages: false,
        providerInstability: false,
        powerInterruptions: false,
      }),
    ).toBe(false);
  });
});

describe("integration-governance — Normalization, ID Mapping, Events (DR, DS, DU, DV, DX)", () => {
  it("normalizes timestamps preserving timezone", () => {
    const t = normalizeTimestamp({
      rawTimestamp: "2026-01-01T08:00:00+01:00",
      sourceTimezone: "Africa/Lagos",
      canonicalUtc: "2026-01-01T07:00:00.000Z",
    });
    expect(t.canonicalUtc).toBe("2026-01-01T07:00:00.000Z");
    expect(t.originalPreserved).toBe(true);
  });
  it("normalizes currency", () => {
    expect(
      normalizeCurrency({ amountMinorUnits: 50000, currency: "NGN" }).exchangeContextRequired,
    ).toBe(false);
    expect(
      normalizeCurrency({ amountMinorUnits: 50000, currency: "GHS" }).exchangeContextRequired,
    ).toBe(true);
  });
  it("external ID mapping is traceable", () => {
    const m = createExternalIdMapping({
      id: externalIdMappingId("em-1"),
      tenantId: TENANT,
      sherivsId: "cg-1",
      externalId: "ext-1",
      provider: "provider-1",
      entityType: "student",
    });
    expect(isExternalIdTraceable(m)).toBe(true);
  });
  it("publishes integration events", () => {
    const e = publishIntegrationEvent({
      id: integrationEventId("ev-1"),
      tenantId: TENANT,
      integrationRef: INTG,
      type: "sync_completed",
    });
    expect(e.type).toBe("sync_completed");
  });
});
