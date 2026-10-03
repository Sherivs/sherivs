/**
 * CoreGrid — H3-061 sandbox-runtime contract tests (mission G-061).
 *
 * Proves the phase-41 substrate contracts are Zod-typed, fail-closed,
 * and domain-neutral, and that the §9 truth boundary is enforced by
 * construction: a sandbox is a copy, never an authority — isolation is
 * a literal, credentials are literally non-production, canonical
 * mirroring is grant-scoped and redaction-mandatory, everything inside
 * a sandbox is derived and expires, and the only bridge toward a
 * canonical surface is `decideSandboxPromotion`, which fails closed
 * (DENY / REQUIRE_APPROVAL) without a terminated sandbox, zero escape
 * events, a declared policy, a matching non-expired approval, cited
 * evidence and an audit destination.
 * Pure offline: no network, no database, no secrets.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DERIVED_ORIGIN,
  SANDBOX_CONTRACT_SCHEMA_VERSION,
  SANDBOX_CREDENTIAL_SCOPE,
  SANDBOX_ISOLATION,
  SandboxRunBundleSchema,
  SandboxObservationSchema,
  SandboxProvisioningSchema,
  SandboxRunRequestSchema,
  PromotionApprovalSchema,
  admitRun,
  decideSandboxPromotion,
  evaluateAgentGrant,
  validateSandboxRunBundle,
  type PromotionApproval,
  type SandboxProvisioning,
  type SandboxRunRequest,
} from "../../frontend/src/lib/sandbox-runtime/contracts";

const NOW_MS = 1_767_225_600_000; // 2026-01-01T00:00:00.000Z — injected, never the wall clock

const PROVENANCE = {
  declaredBy: "role:contract-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-061",
  recordedAtMs: NOW_MS - 60_000,
};

const BOUNDS = {
  maxComputeUnits: 100,
  maxStorageMb: 512,
  maxWallClockMs: 60_000,
  maxConcurrentRuns: 4,
};

const USAGE = {
  computeUnitsUsed: 10,
  storageMbUsed: 64,
  wallClockMsUsed: 5_000,
};

function provisioning(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SANDBOX_CONTRACT_SCHEMA_VERSION,
    sandboxId: "sandbox-1",
    tenantRef: "tenant-a",
    purpose: "isolated execution of a candidate change",
    lifecycle: "active",
    isolation: SANDBOX_ISOLATION,
    credentialScope: SANDBOX_CREDENTIAL_SCOPE,
    mirrorGrants: [
      {
        grantId: "mirror-1",
        tenantRef: "tenant-a",
        subjectRefs: ["subject:1", "subject:2"],
        purpose: "bounded mirrored state for the experiment",
        policyRef: "policy:mirror-minimum",
        redaction: "minimized",
        grantedBy: "role:sandbox-operator",
        grantedAtMs: NOW_MS - 120_000,
        expiresAtMs: NOW_MS + 600_000,
      },
    ],
    resourceBounds: { ...BOUNDS },
    createdAtMs: NOW_MS - 300_000,
    expiresAtMs: NOW_MS + 300_000,
    canonicalWriteback: false,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function grant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    grantId: "grant-1",
    sandboxId: "sandbox-1",
    tenantRef: "tenant-a",
    agentRef: "agent:1",
    capabilities: ["capability:read-mirrored-state"],
    credentialScope: SANDBOX_CREDENTIAL_SCOPE,
    purpose: "act inside the sandbox under least scope",
    grantedBy: "role:sandbox-operator",
    grantedAtMs: NOW_MS - 60_000,
    expiresAtMs: NOW_MS + 120_000,
    revoked: false,
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run-1",
    sandboxId: "sandbox-1",
    tenantRef: "tenant-a",
    purpose: "measure the candidate change under declared bounds",
    requestedBy: "role:sandbox-operator",
    requestedAtMs: NOW_MS - 30_000,
    seed: 42,
    maxSteps: 10,
    executionIsolation: SANDBOX_ISOLATION,
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observationId: "obs-1",
    runId: "run-1",
    sandboxId: "sandbox-1",
    tenantRef: "tenant-a",
    origin: DERIVED_ORIGIN,
    subjectRefs: ["subject:1"],
    signal: "throughput",
    unit: "events-per-step",
    value: 100,
    confidence: 0.8,
    step: 5,
    generatedAtMs: NOW_MS - 10_000,
    validUntilMs: NOW_MS + 60_000,
    auditRef: "audit:run-1",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SANDBOX_CONTRACT_SCHEMA_VERSION,
    provisioning: provisioning(),
    run: run(),
    status: "completed",
    observations: [observation()],
    escapeEvents: [],
    resourceUsage: { ...USAGE },
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposalId: "proposal-1",
    tenantRef: "tenant-a",
    sourceSandboxId: "sandbox-1",
    purpose: "promote a validated sandbox result toward a canonical surface",
    policyRef: "policy:promotion",
    auditDestinationRef: "audit:promotion",
    evidence: ["obs-1"],
    sandboxSummary: {
      lifecycle: "terminated",
      escapeEventCount: 0,
      observationCount: 1,
      provenance: PROVENANCE,
    },
    ...overrides,
  };
}

function approval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvalId: "approval-1",
    approvedBy: "role:human-governor",
    approvedAtMs: NOW_MS - 30_000,
    expiresAtMs: NOW_MS + 300_000,
    tenantRef: "tenant-a",
    sandboxRefs: ["sandbox-1"],
    revoked: false,
    ...overrides,
  };
}

function parsedProvisioning(overrides: Record<string, unknown> = {}): SandboxProvisioning {
  return SandboxProvisioningSchema.parse(provisioning(overrides));
}

function parsedRun(overrides: Record<string, unknown> = {}): SandboxRunRequest {
  return SandboxRunRequestSchema.parse(run(overrides));
}

function parsedApproval(overrides: Record<string, unknown> = {}): PromotionApproval {
  return PromotionApprovalSchema.parse(approval(overrides));
}

describe("sandbox provisioning schema", () => {
  it("accepts a complete, active, tenant-scoped sandbox with bounded resources", () => {
    expect(SandboxProvisioningSchema.safeParse(provisioning()).success).toBe(true);
  });

  it("accepts an empty-universe sandbox with no mirror grants", () => {
    expect(SandboxProvisioningSchema.safeParse(provisioning({ mirrorGrants: [] })).success).toBe(true);
  });

  it("fails closed on canonical writeback: the literal admits only `false` (AGENTS §9)", () => {
    expect(SandboxProvisioningSchema.safeParse(provisioning({ canonicalWriteback: true })).success).toBe(false);
    expect(
      SandboxProvisioningSchema.safeParse(provisioning({ canonicalWriteback: "approved" })).success,
    ).toBe(false);
  });

  it("fails closed on isolation: only the isolated mode parses", () => {
    expect(SandboxProvisioningSchema.safeParse(provisioning({ isolation: "shared" })).success).toBe(false);
    expect(SandboxProvisioningSchema.safeParse(provisioning({ isolation: "production" })).success).toBe(false);
  });

  it("fails closed on credential scope: sandbox credentials are never production credentials", () => {
    expect(
      SandboxProvisioningSchema.safeParse(provisioning({ credentialScope: "production" })).success,
    ).toBe(false);
  });

  it("rejects purpose-less sandboxes — purpose limitation is mandatory (AGENTS §16)", () => {
    expect(SandboxProvisioningSchema.safeParse(provisioning({ purpose: "" })).success).toBe(false);
  });

  it("rejects unbounded sandboxes — every resource bound must be positive", () => {
    expect(
      SandboxProvisioningSchema.safeParse(
        provisioning({ resourceBounds: { ...BOUNDS, maxWallClockMs: 0 } }),
      ).success,
    ).toBe(false);
    expect(
      SandboxProvisioningSchema.safeParse(
        provisioning({ resourceBounds: { ...BOUNDS, maxComputeUnits: -1 } }),
      ).success,
    ).toBe(false);
  });

  it("rejects anonymous sandboxes — provenance is mandatory (AGENTS §12)", () => {
    const raw = provisioning();
    delete (raw as Record<string, unknown>).provenance;
    expect(SandboxProvisioningSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects inverted sandbox lifetimes — sandboxes are temporary by mandate", () => {
    expect(SandboxProvisioningSchema.safeParse(provisioning({ expiresAtMs: NOW_MS - 300_000 })).success).toBe(false);
    expect(SandboxProvisioningSchema.safeParse(provisioning({ expiresAtMs: NOW_MS - 300_001 })).success).toBe(false);
  });

  it("rejects anonymous mirror grants and grants without declared policy", () => {
    const missingPolicy = provisioning({
      mirrorGrants: [
        {
          grantId: "mirror-1",
          tenantRef: "tenant-a",
          subjectRefs: ["subject:1"],
          purpose: "mirroring",
          redaction: "minimized",
          grantedBy: "role:sandbox-operator",
          grantedAtMs: NOW_MS,
          expiresAtMs: NOW_MS + 1,
        },
      ],
    });
    expect(SandboxProvisioningSchema.safeParse(missingPolicy).success).toBe(false);
  });

  it("fails closed on mirror redaction: the enum admits no unredacted mirroring (AGENTS §19)", () => {
    const raw = provisioning();
    (raw.mirrorGrants as Record<string, unknown>[])[0].redaction = "none";
    expect(SandboxProvisioningSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects mirror grants that name no subjects", () => {
    const raw = provisioning();
    (raw.mirrorGrants as Record<string, unknown>[])[0].subjectRefs = [];
    expect(SandboxProvisioningSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects path-shaped subject refs — references are logical, never filesystem paths", () => {
    const raw = provisioning();
    (raw.mirrorGrants as Record<string, unknown>[])[0].subjectRefs = ["/etc/passwd"];
    expect(SandboxProvisioningSchema.safeParse(raw).success).toBe(false);
  });
});

describe("sandbox run request schema", () => {
  it("rejects unseeded runs — reproducibility is mandatory", () => {
    expect(SandboxRunBundleSchema.safeParse(bundle({ run: run({ seed: undefined }) })).success).toBe(false);
  });

  it("rejects unbounded runs — zero or negative step bounds are invalid", () => {
    expect(SandboxRunBundleSchema.safeParse(bundle({ run: run({ maxSteps: 0 }) })).success).toBe(false);
  });

  it("fails closed on execution isolation: only the isolated mode parses", () => {
    expect(SandboxRunBundleSchema.safeParse(bundle({ run: run({ executionIsolation: "inline" }) })).success).toBe(false);
  });
});

describe("validateSandboxRunBundle", () => {
  it("accepts a complete, valid, completed bundle", () => {
    const result = validateSandboxRunBundle(bundle(), { nowMs: NOW_MS });
    expect(result.ok).toBe(true);
  });

  it("fails closed on an unsupported schema version", () => {
    const result = validateSandboxRunBundle(bundle({ schemaVersion: 999 }), { nowMs: NOW_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("schema_version_unsupported");
  });

  it("fails closed on unparseable input", () => {
    const result = validateSandboxRunBundle({ not: "a sandbox bundle" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("invalid_input");
  });

  it("fails closed when the run references a different sandbox", () => {
    const result = validateSandboxRunBundle(bundle({ run: run({ sandboxId: "sandbox-2" }) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "sandbox_mismatch")).toBe(true);
  });

  it("fails closed on tenant mismatch between run and sandbox (AGENTS §13)", () => {
    const result = validateSandboxRunBundle(bundle({ run: run({ tenantRef: "tenant-b" }) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "tenant_mismatch")).toBe(true);
  });

  it("fails closed when the sandbox is not active — runs execute only in active sandboxes", () => {
    for (const lifecycle of ["provisioning", "suspended", "terminated"]) {
      const result = validateSandboxRunBundle(
        bundle({ provisioning: provisioning({ lifecycle }) }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some((i) => i.code === "sandbox_not_active")).toBe(true);
    }
  });

  it("rejects observations attached to a non-completed run", () => {
    const result = validateSandboxRunBundle(bundle({ status: "running" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "observations_before_completion")).toBe(true);
    }
  });

  it("rejects a completed run that recorded no observations — completed runs must record results", () => {
    const result = validateSandboxRunBundle(bundle({ observations: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "observations_before_completion")).toBe(true);
    }
  });

  it("rejects duplicate observations", () => {
    const result = validateSandboxRunBundle(bundle({ observations: [observation(), observation()] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "duplicate_observation")).toBe(true);
  });

  it("fails closed on inverted validity and on expired derived intelligence (AGENTS §31)", () => {
    const inverted = validateSandboxRunBundle(
      bundle({ observations: [observation({ validUntilMs: NOW_MS - 20_000 })] }),
    );
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.issues.some((i) => i.code === "inverted_validity")).toBe(true);

    const expired = validateSandboxRunBundle(bundle(), { nowMs: NOW_MS + 120_000 });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.issues.some((i) => i.code === "inverted_validity")).toBe(true);
  });

  it("fails closed when an observation references a subject no mirror grant covers", () => {
    const result = validateSandboxRunBundle(
      bundle({ observations: [observation({ subjectRefs: ["subject:9"] })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "unknown_subject")).toBe(true);
  });

  it("fails closed on expired mirror grants against the injected clock", () => {
    const raw = provisioning();
    (raw.mirrorGrants as Record<string, unknown>[])[0].expiresAtMs = NOW_MS - 1;
    const result = validateSandboxRunBundle(
      bundle({ provisioning: raw, observations: [] as unknown[], status: "failed" }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "mirror_grant_expired")).toBe(true);
  });

  it("fails closed on an uncontained escape — a breached boundary fails everything closed", () => {
    const result = validateSandboxRunBundle(
      bundle({
        escapeEvents: [
          { escapeId: "esc-1", sandboxId: "sandbox-1", tenantRef: "tenant-a", vector: "credential-reuse", detectedAtMs: NOW_MS - 5_000, contained: false },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "containment_breached")).toBe(true);
  });

  it("fails closed when resource usage exceeds the sandbox bounds", () => {
    for (const usage of [
      { ...USAGE, computeUnitsUsed: BOUNDS.maxComputeUnits + 1 },
      { ...USAGE, storageMbUsed: BOUNDS.maxStorageMb + 1 },
      { ...USAGE, wallClockMsUsed: BOUNDS.maxWallClockMs + 1 },
    ]) {
      const result = validateSandboxRunBundle(bundle({ resourceUsage: usage }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.some((i) => i.code === "bounds_exceeded")).toBe(true);
    }
  });

  it("enforces the governed maximum run-step bound when supplied", () => {
    const result = validateSandboxRunBundle(bundle({ run: run({ maxSteps: 1_000_000 }) }), {
      maxRunSteps: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === "bounds_exceeded")).toBe(true);
  });
});

describe("admitRun", () => {
  it("admits a run into an active, unexpired, tenant-matched sandbox", () => {
    const decision = admitRun(parsedProvisioning(), parsedRun(), { nowMs: NOW_MS });
    expect(decision).toEqual({ admitted: true, reason: null });
  });

  it("refuses runs when the sandbox is not active", () => {
    const decision = admitRun(parsedProvisioning({ lifecycle: "suspended" }), parsedRun(), { nowMs: NOW_MS });
    expect(decision).toEqual({ admitted: false, reason: "not_active" });
  });

  it("refuses runs in an expired sandbox — expired access fails (AGENTS §31)", () => {
    const decision = admitRun(parsedProvisioning(), parsedRun(), { nowMs: NOW_MS + 300_001 });
    expect(decision).toEqual({ admitted: false, reason: "sandbox_expired" });
  });

  it("refuses runs whose tenant context drifts from the sandbox", () => {
    const decision = admitRun(parsedProvisioning(), parsedRun({ tenantRef: "tenant-b" }), { nowMs: NOW_MS });
    expect(decision).toEqual({ admitted: false, reason: "tenant_mismatch" });
  });
});

describe("evaluateAgentGrant", () => {
  it("allows a scoped, expiring, non-production grant inside an active sandbox", () => {
    const decision = evaluateAgentGrant(grant(), parsedProvisioning(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "ALLOW" });
  });

  it("denies unparseable grants", () => {
    const decision = evaluateAgentGrant({ grantId: "grant-1" }, parsedProvisioning(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "invalid_input" });
  });

  it("denies grants for another tenant", () => {
    const decision = evaluateAgentGrant(grant({ tenantRef: "tenant-b" }), parsedProvisioning(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "tenant_mismatch" });
  });

  it("denies grants scoped to a different sandbox", () => {
    const decision = evaluateAgentGrant(grant({ sandboxId: "sandbox-2" }), parsedProvisioning(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "sandbox_mismatch" });
  });

  it("denies grants while the sandbox is not active", () => {
    const decision = evaluateAgentGrant(grant(), parsedProvisioning({ lifecycle: "provisioning" }), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "not_active" });
  });

  it("denies grants once the sandbox has expired", () => {
    const decision = evaluateAgentGrant(grant(), parsedProvisioning(), { nowMs: NOW_MS + 300_001 });
    expect(decision).toEqual({ decision: "DENY", reason: "sandbox_expired" });
  });

  it("denies grants that outlive their sandbox — grants can never extend past the sandbox", () => {
    const decision = evaluateAgentGrant(grant({ expiresAtMs: NOW_MS + 300_001 }), parsedProvisioning(), {
      nowMs: NOW_MS,
    });
    expect(decision).toEqual({ decision: "DENY", reason: "grant_outlives_sandbox" });
  });

  it("denies expired grants (AGENTS §31: expired access fails)", () => {
    const decision = evaluateAgentGrant(grant({ expiresAtMs: NOW_MS + 1 }), parsedProvisioning(), { nowMs: NOW_MS + 1 });
    expect(decision).toEqual({ decision: "DENY", reason: "grant_expired" });
  });

  it("denies revoked grants (AGENTS §31: revoked access fails)", () => {
    const decision = evaluateAgentGrant(grant({ revoked: true }), parsedProvisioning(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "grant_revoked" });
  });

  it("denies credential-scope escalation attempts instead of silently narrowing them", () => {
    const decision = evaluateAgentGrant(grant({ credentialScope: "production" }), parsedProvisioning(), {
      nowMs: NOW_MS,
    });
    expect(decision).toEqual({ decision: "DENY", reason: "credential_scope_escalation" });
  });
});

describe("decideSandboxPromotion — the only bridge toward canonical surfaces (§9/§16/§21)", () => {
  it("allows a fully governed proposal: policy, audit, evidence, terminated sandbox, approval", () => {
    const decision = decideSandboxPromotion(proposal(), {
      nowMs: NOW_MS,
      approval: parsedApproval(),
    });
    expect(decision).toEqual({ decision: "ALLOW" });
  });

  it("denies unparseable proposals", () => {
    const decision = decideSandboxPromotion({ nope: true }, { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "invalid_input" });
  });

  it("denies proposals without a declared policy", () => {
    const decision = decideSandboxPromotion(proposal({ policyRef: undefined }), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "no_policy" });
  });

  it("denies proposals without an audit destination", () => {
    const decision = decideSandboxPromotion(proposal({ auditDestinationRef: undefined }), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "DENY", reason: "no_audit_destination" });
  });

  it("denies proposals whose evidence exceeds the recorded observations", () => {
    const decision = decideSandboxPromotion(
      proposal({
        evidence: ["obs-1", "obs-2", "obs-3"],
        sandboxSummary: {
          lifecycle: "terminated",
          escapeEventCount: 0,
          observationCount: 1,
          provenance: PROVENANCE,
        },
      }),
      { nowMs: NOW_MS },
    );
    expect(decision).toEqual({ decision: "DENY", reason: "no_evidence" });
  });

  it("denies proposals from a sandbox that is not terminated — cleanup precedes promotion", () => {
    for (const lifecycle of ["provisioning", "active", "suspended"]) {
      const decision = decideSandboxPromotion(
        proposal({ sandboxSummary: { lifecycle, escapeEventCount: 0, observationCount: 1, provenance: PROVENANCE } }),
        { nowMs: NOW_MS },
      );
      expect(decision).toEqual({ decision: "DENY", reason: "sandbox_not_terminated" });
    }
  });

  it("denies proposals from a sandbox with any escape event — containment precedes promotion", () => {
    const decision = decideSandboxPromotion(
      proposal({
        sandboxSummary: {
          lifecycle: "terminated",
          escapeEventCount: 1,
          observationCount: 1,
          provenance: PROVENANCE,
        },
      }),
      { nowMs: NOW_MS },
    );
    expect(decision).toEqual({ decision: "DENY", reason: "containment_breached" });
  });

  it("requires approval when no approval is supplied — escalation, never a silent write", () => {
    const decision = decideSandboxPromotion(proposal(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "REQUIRE_APPROVAL" });
  });

  it("denies approvals scoped to another tenant", () => {
    const decision = decideSandboxPromotion(proposal(), {
      nowMs: NOW_MS,
      approval: parsedApproval({ tenantRef: "tenant-b" }),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_mismatch_tenant" });
  });

  it("denies approvals scoped to a different sandbox", () => {
    const decision = decideSandboxPromotion(proposal(), {
      nowMs: NOW_MS,
      approval: parsedApproval({ sandboxRefs: ["sandbox-9"] }),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_mismatch_sandbox" });
  });

  it("denies expired approvals (AGENTS §31)", () => {
    const decision = decideSandboxPromotion(proposal(), {
      nowMs: NOW_MS + 300_001,
      approval: parsedApproval(),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_expired" });
  });

  it("denies revoked approvals (AGENTS §31)", () => {
    const decision = decideSandboxPromotion(proposal(), {
      nowMs: NOW_MS,
      approval: parsedApproval({ revoked: true }),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "approval_revoked" });
  });
});

describe("domain neutrality and purity self-checks", () => {
  it("the derived-origin literal admits nothing but 'derived' (AGENTS §9)", () => {
    expect(SandboxObservationSchema.safeParse(observation({ origin: "canonical" })).success).toBe(false);
    expect(SandboxObservationSchema.safeParse(observation({ origin: "observed" })).success).toBe(false);
    expect(SandboxObservationSchema.safeParse(observation({ origin: DERIVED_ORIGIN })).success).toBe(true);
  });

  it("the contract version is pinned to the supported literal", () => {
    expect(SANDBOX_CONTRACT_SCHEMA_VERSION).toBe(1);
  });
});

describe("module hygiene (static, read-only)", () => {
  const source = readFileSync(
    new URL("../../frontend/src/lib/sandbox-runtime/contracts.ts", import.meta.url),
    "utf8",
  );
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("contains no TypeScript any and no z.any (strict TypeScript law)", () => {
    expect(codeOnly).not.toMatch(/:\s*any\b/);
    expect(codeOnly).not.toMatch(/\bas any\b/);
    expect(codeOnly).not.toMatch(/\bz\.any\b/);
  });

  it("contains no domain vocabulary (J-037)", () => {
    for (const token of [
      "scholar", "student", "teacher", "school", "classroom", "curriculum", "exam", "examination",
      "grading", "attendance", "tuition", "admission", "lesson", "library", "enrollment",
      "academic", "payroll", "vibeora",
    ]) {
      expect(new RegExp(`\\b${token}\\b`, "i").test(source)).toBe(false);
    }
  });

  it("imports only zod — no vendor, no sibling H3, no I/O modules", () => {
    const imports = [...source.matchAll(/^import .* from "(.+?)";?$/gm)].map((match) => match[1]);
    expect(imports).toEqual(["zod"]);
  });
});
