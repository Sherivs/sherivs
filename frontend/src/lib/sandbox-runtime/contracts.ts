/**
 * CoreGrid — Phase 41 Reality Simulation & Autonomous Sandbox Engine contracts
 * (Squad G / mission G-061, Contract Architect).
 *
 * This module defines the typed, Zod-validated substrate surface for
 * sandbox provisioning, isolated execution runs, sandbox agent grants,
 * and proposal-only promotion out of a sandbox. It is a CONTRACT
 * module: pure, no I/O, no persistence, no vendor imports, no secrets,
 * offline-testable.
 *
 * TRUTH BOUNDARY (AGENTS §9 — canonical truth vs. intelligence):
 * A sandbox is a copy, never an authority. Everything inside a sandbox
 * is DERIVED: mirrored from permitted canonical state under a declared
 * redaction policy, and every execution result is a labelled, bounded,
 * expiring observation — never a measurement, never a canonical record.
 * The schema itself enforces the boundary:
 *   - provisioning carries `canonicalWriteback: z.literal(false)` and
 *     `isolation: z.literal("isolated")` — no other values parse;
 *   - canonical mirroring is grant-scoped, policy-scoped, and
 *     redaction-mandatory (the enum admits no "none");
 *   - sandbox credentials are literally non-production — a sandbox
 *     artifact that could inherit production credentials does not parse;
 *   - every sandbox is temporary: expiry is mandatory and inverted
 *     lifetimes fail closed;
 *   - the ONLY path from a sandbox toward a canonical surface is
 *     `decideSandboxPromotion`, which implements AGENTS §16/§21
 *     (Proposal → Validation → Policy → Approval → Audit) and fails
 *     closed: without a terminated (cleaned-up) sandbox, zero escape
 *     events, a declared policy, a matching non-expired approval, and
 *     an audit destination, the decision is DENY or REQUIRE_APPROVAL —
 *     never a silent write.
 *
 * OTHER LAWS ENCODED HERE:
 *   - Multi-tenancy (§13): every artifact carries tenant context, and
 *     cross-artifact tenant mismatch fails closed.
 *   - Purpose limitation (§16): provisioning, mirroring, runs, grants
 *     and promotion all require a declared purpose to parse.
 *   - Reproducibility & bounds: runs are deterministic (declared seed)
 *     and resource-bounded; an unbounded sandbox is invalid.
 *   - Provenance (§12): every artifact carries who/what/when/
 *     under-which-authority records.
 *   - Clock injection: all time flows from caller-supplied `nowMs`.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** Bump on any breaking change to the bundle shape. */
export const SANDBOX_CONTRACT_SCHEMA_VERSION = 1 as const;

/** Lifecycle of a sandbox reality instance. Only "active" sandboxes run. */
export const SANDBOX_LIFECYCLES = ["provisioning", "active", "suspended", "terminated"] as const;
export type SandboxLifecycle = (typeof SANDBOX_LIFECYCLES)[number];

/** Lifecycle of an execution run inside a sandbox. */
export const SANDBOX_RUN_STATUSES = ["pending", "running", "completed", "failed", "aborted"] as const;
export type SandboxRunStatus = (typeof SANDBOX_RUN_STATUSES)[number];

/** The only origin a sandbox artifact may declare (AGENTS §9). */
export const DERIVED_ORIGIN = "derived" as const;

/** The only execution mode this contract describes (fail-closed literal). */
export const SANDBOX_ISOLATION = "isolated" as const;

/** Sandbox credentials can never be production credentials (fail-closed literal). */
export const SANDBOX_CREDENTIAL_SCOPE = "non-production" as const;

/* ─────────────────────────────────────────────────────────────
 * Shared primitives
 * ────────────────────────────────────────────────────────────*/

/**
 * Provenance record (AGENTS §12): who produced the artifact, under
 * which authority, and when. Anonymous artifacts do not parse.
 */
export const ProvenanceSchema = z.object({
  declaredBy: z.string().min(1),
  authority: z.string().min(1),
  recordedAtMs: z.number().int().nonnegative(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * A reference to a canonical subject a sandbox may mirror. The
 * reference is opaque here and no mutation surface exists anywhere in
 * this module's schemas — sandboxes are readers of reality.
 */
export const SubjectRefSchema = z
  .string()
  .min(1)
  .refine((ref) => !ref.startsWith("/"), "subjectRef must be a logical reference, not a path");

export type SubjectRef = z.infer<typeof SubjectRefSchema>;

/**
 * A grant to mirror canonical state INTO a sandbox (AGENTS §19 data
 * minimization). Redaction is mandatory — the enum admits no
 * "unredacted" value — and the policy reference is mandatory: canonical
 * state leaves the canonical layer only under a declared policy,
 * purpose, and expiry.
 */
export const MirrorGrantSchema = z.object({
  grantId: z.string().min(1),
  tenantRef: z.string().min(1),
  subjectRefs: z.array(SubjectRefSchema).min(1, "a mirror grant must name the subjects it covers"),
  purpose: z.string().min(1),
  policyRef: z.string().min(1),
  redaction: z.enum(["minimized", "redacted"]),
  grantedBy: z.string().min(1),
  grantedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
});

export type MirrorGrant = z.infer<typeof MirrorGrantSchema>;

/** Hard execution bounds. A sandbox without declared bounds is invalid. */
export const ResourceBoundsSchema = z.object({
  maxComputeUnits: z.number().int().positive(),
  maxStorageMb: z.number().int().positive(),
  maxWallClockMs: z.number().int().positive(),
  maxConcurrentRuns: z.number().int().positive(),
});

export type ResourceBounds = z.infer<typeof ResourceBoundsSchema>;

/* ─────────────────────────────────────────────────────────────
 * Sandbox provisioning
 * ────────────────────────────────────────────────────────────*/

export const SandboxProvisioningSchema = z.object({
  schemaVersion: z.literal(SANDBOX_CONTRACT_SCHEMA_VERSION),
  sandboxId: z.string().min(1),
  /** Tenant context (AGENTS §13) — every sandbox is tenant-scoped. */
  tenantRef: z.string().min(1),
  /** Purpose limitation (AGENTS §16): why does this sandbox exist? */
  purpose: z.string().min(1),
  lifecycle: z.enum(SANDBOX_LIFECYCLES),
  /** Fail-closed by construction: only the isolated mode parses. */
  isolation: z.literal(SANDBOX_ISOLATION),
  /** Fail-closed by construction: sandbox credentials are never production credentials. */
  credentialScope: z.literal(SANDBOX_CREDENTIAL_SCOPE),
  /** Canonical subjects this sandbox may mirror (may be empty: an empty universe is valid). */
  mirrorGrants: z.array(MirrorGrantSchema).max(64),
  /** Mandatory execution bounds — an unbounded sandbox does not parse. */
  resourceBounds: ResourceBoundsSchema,
  createdAtMs: z.number().int().nonnegative(),
  /** Mandatory expiry: sandboxes are temporary realities (invariant cross-checked). */
  expiresAtMs: z.number().int().nonnegative(),
  /** The §9 boundary, unforgeable: a sandbox can never declare write access. */
  canonicalWriteback: z.literal(false),
  provenance: ProvenanceSchema,
}).refine((sandbox) => sandbox.expiresAtMs > sandbox.createdAtMs, {
  message: "sandbox lifetime is inverted: expiresAtMs must be strictly after createdAtMs",
  path: ["expiresAtMs"],
});

export type SandboxProvisioning = z.infer<typeof SandboxProvisioningSchema>;

/* ─────────────────────────────────────────────────────────────
 * Sandbox agent grants
 * ────────────────────────────────────────────────────────────*/

/**
 * A scoped, expiring, revocable grant for an agent to act INSIDE one
 * sandbox (AGENTS §5/§16: least scope, expiry honored). Agents may act
 * freely within their grants, but the grant admits no production
 * credentials and no canonical write path.
 */
export const AgentGrantSchema = z.object({
  grantId: z.string().min(1),
  sandboxId: z.string().min(1),
  tenantRef: z.string().min(1),
  agentRef: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1, "a grant without capabilities grants nothing"),
  /**
   * Declared scope, enforced at the decision gate: anything other than
   * the non-production literal is an escalation attempt and is DENIED.
   */
  credentialScope: z.string().min(1),
  purpose: z.string().min(1),
  grantedBy: z.string().min(1),
  grantedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  revoked: z.boolean().default(false),
});

export type AgentGrant = z.infer<typeof AgentGrantSchema>;

/* ─────────────────────────────────────────────────────────────
 * Execution runs and observations (derived intelligence)
 * ────────────────────────────────────────────────────────────*/

export const SandboxRunRequestSchema = z.object({
  runId: z.string().min(1),
  sandboxId: z.string().min(1),
  tenantRef: z.string().min(1),
  purpose: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedAtMs: z.number().int().nonnegative(),
  /** Deterministic seed: an unseeded run cannot be re-validated and does not parse. */
  seed: z.number().int().nonnegative(),
  /** Forward bound for THIS run, in model steps. */
  maxSteps: z.number().int().positive(),
  /** Fail-closed by construction: only the isolated mode parses. */
  executionIsolation: z.literal(SANDBOX_ISOLATION),
});

export type SandboxRunRequest = z.infer<typeof SandboxRunRequestSchema>;

/**
 * One recorded escape attempt (a boundary-crossing try from inside the
 * sandbox toward anything outside it). Detection is mandatory
 * bookkeeping; containment is cross-checked — an uncontained escape
 * fails the whole bundle closed.
 */
export const EscapeEventSchema = z.object({
  escapeId: z.string().min(1),
  sandboxId: z.string().min(1),
  tenantRef: z.string().min(1),
  /** Which boundary channel the attempt used (opaque, non-secret descriptor). */
  vector: z.string().min(1),
  detectedAtMs: z.number().int().nonnegative(),
  contained: z.boolean(),
});

export type EscapeEvent = z.infer<typeof EscapeEventSchema>;

/**
 * One derived observation produced by a run inside a sandbox. Labelled
 * `derived` (§9), expired by mandate, confidence-scored, and audited.
 */
export const SandboxObservationSchema = z.object({
  observationId: z.string().min(1),
  runId: z.string().min(1),
  sandboxId: z.string().min(1),
  tenantRef: z.string().min(1),
  /** The §9 label. `z.literal` admits nothing but "derived". */
  origin: z.literal(DERIVED_ORIGIN),
  /** Canonical subjects (mirrored into the sandbox) this observation concerns. */
  subjectRefs: z.array(SubjectRefSchema).min(1),
  /** Named result signal (e.g. a metric key). Units are declared, not guessed. */
  signal: z.string().min(1),
  unit: z.string().min(1),
  value: z.number().finite(),
  /** Confidence in [0, 1]. */
  confidence: z.number().min(0).max(1),
  step: z.number().int().nonnegative(),
  generatedAtMs: z.number().int().nonnegative(),
  /** Mandatory freshness bound: derived intelligence expires (invariant cross-checked). */
  validUntilMs: z.number().int().nonnegative(),
  /** Immutable audit record reference for the run that produced this observation (AGENTS §29). */
  auditRef: z.string().min(1),
  provenance: ProvenanceSchema,
});

export type SandboxObservation = z.infer<typeof SandboxObservationSchema>;

/** Actual resource consumption of a run, cross-checked against the sandbox bounds. */
export const ResourceUsageSchema = z.object({
  computeUnitsUsed: z.number().int().nonnegative(),
  storageMbUsed: z.number().int().nonnegative(),
  wallClockMsUsed: z.number().int().nonnegative(),
});

export type ResourceUsage = z.infer<typeof ResourceUsageSchema>;

/**
 * The complete, self-describing artifact of one sandbox execution:
 * provisioning, run request, run status, observations (only for
 * completed runs), escape events, and resource usage.
 */
export const SandboxRunBundleSchema = z.object({
  schemaVersion: z.literal(SANDBOX_CONTRACT_SCHEMA_VERSION),
  provisioning: SandboxProvisioningSchema,
  run: SandboxRunRequestSchema,
  status: z.enum(SANDBOX_RUN_STATUSES),
  observations: z.array(SandboxObservationSchema),
  escapeEvents: z.array(EscapeEventSchema),
  resourceUsage: ResourceUsageSchema,
});

export type SandboxRunBundle = z.infer<typeof SandboxRunBundleSchema>;

/* ─────────────────────────────────────────────────────────────
 * Validation (fail closed, typed issues)
 * ────────────────────────────────────────────────────────────*/

export type SandboxIssueCode =
  | "invalid_input"
  | "schema_version_unsupported"
  | "tenant_mismatch"
  | "sandbox_mismatch"
  | "sandbox_not_active"
  | "sandbox_expired"
  | "mirror_grant_expired"
  | "observations_before_completion"
  | "duplicate_observation"
  | "inverted_validity"
  | "inverted_sandbox_lifetime"
  | "bounds_exceeded"
  | "containment_breached"
  | "unknown_subject";

export interface SandboxIssue {
  code: SandboxIssueCode;
  detail: string;
}

export type SandboxValidationResult =
  | { readonly ok: true; readonly bundle: SandboxRunBundle }
  | { readonly ok: false; readonly issues: readonly SandboxIssue[] };

export interface ValidateSandboxBundleOptions {
  /** Caller-injected observation time (ms). Required for freshness checks. */
  nowMs?: number;
  /** Absolute cap any run step bound must respect (runaway-run guard). */
  maxRunSteps?: number;
}

function crossFieldIssues(bundle: SandboxRunBundle, options: ValidateSandboxBundleOptions): SandboxIssue[] {
  const issues: SandboxIssue[] = [];
  const { provisioning, run, status, observations, escapeEvents, resourceUsage } = bundle;

  if (run.sandboxId !== provisioning.sandboxId) {
    issues.push({
      code: "sandbox_mismatch",
      detail: `run ${run.runId} references sandbox ${run.sandboxId} but the bundle declares ${provisioning.sandboxId}`,
    });
  }
  if (run.tenantRef !== provisioning.tenantRef) {
    issues.push({
      code: "tenant_mismatch",
      detail: "run tenant context differs from the sandbox's tenant context; tenant isolation fails closed",
    });
  }
  if (provisioning.expiresAtMs <= provisioning.createdAtMs) {
    issues.push({
      code: "inverted_sandbox_lifetime",
      detail: `sandbox ${provisioning.sandboxId}: expiresAtMs must be strictly after createdAtMs`,
    });
  }
  if (provisioning.lifecycle !== "active") {
    issues.push({
      code: "sandbox_not_active",
      detail: `sandbox ${provisioning.sandboxId} has lifecycle "${provisioning.lifecycle}"; runs execute only in active sandboxes`,
    });
  }
  if (status === "completed" && observations.length === 0) {
    issues.push({
      code: "observations_before_completion",
      detail: `run status is "completed" but no observations are attached; completed runs must record their derived observations`,
    });
  }
  if (status !== "completed" && observations.length > 0) {
    issues.push({
      code: "observations_before_completion",
      detail: `run status is "${status}" but ${observations.length} observation(s) are attached; observations exist only for completed runs`,
    });
  }

  const mirrorSubjects = new Set<string>();
  for (const grant of provisioning.mirrorGrants) {
    for (const subject of grant.subjectRefs) mirrorSubjects.add(subject);
    if (options.nowMs !== undefined && grant.expiresAtMs <= options.nowMs) {
      issues.push({
        code: "mirror_grant_expired",
        detail: `mirror grant ${grant.grantId} expired at ${grant.expiresAtMs} (observed at ${options.nowMs})`,
      });
    }
  }

  const seenObservations = new Set<string>();
  for (const observation of observations) {
    if (seenObservations.has(observation.observationId)) {
      issues.push({
        code: "duplicate_observation",
        detail: `observationId ${observation.observationId} appears more than once`,
      });
    }
    seenObservations.add(observation.observationId);

    if (observation.runId !== run.runId || observation.sandboxId !== provisioning.sandboxId) {
      issues.push({
        code: "sandbox_mismatch",
        detail: `observation ${observation.observationId} belongs to run ${observation.runId} in sandbox ${observation.sandboxId}, not this execution`,
      });
    }
    if (observation.tenantRef !== provisioning.tenantRef) {
      issues.push({
        code: "tenant_mismatch",
        detail: `observation ${observation.observationId} carries a tenant context different from the sandbox's`,
      });
    }
    if (observation.validUntilMs <= observation.generatedAtMs) {
      issues.push({
        code: "inverted_validity",
        detail: `observation ${observation.observationId}: validUntilMs must be strictly after generatedAtMs`,
      });
    }
    if (options.nowMs !== undefined && observation.validUntilMs <= options.nowMs) {
      issues.push({
        code: "inverted_validity",
        detail: `observation ${observation.observationId} expired at ${observation.validUntilMs} (observed at ${options.nowMs}); expired derived intelligence is not usable`,
      });
    }
    for (const subject of observation.subjectRefs) {
      if (!mirrorSubjects.has(subject)) {
        issues.push({
          code: "unknown_subject",
          detail: `observation ${observation.observationId} references subject ${subject} that no mirror grant covers`,
        });
      }
    }
  }

  for (const escape of escapeEvents) {
    if (escape.sandboxId !== provisioning.sandboxId) {
      issues.push({
        code: "sandbox_mismatch",
        detail: `escape event ${escape.escapeId} references sandbox ${escape.sandboxId}, not ${provisioning.sandboxId}`,
      });
    }
    if (escape.tenantRef !== provisioning.tenantRef) {
      issues.push({
        code: "tenant_mismatch",
        detail: `escape event ${escape.escapeId} carries a tenant context different from the sandbox's`,
      });
    }
    if (!escape.contained) {
      issues.push({
        code: "containment_breached",
        detail: `escape event ${escape.escapeId} was not contained; the sandbox boundary is breached and everything inside fails closed`,
      });
    }
  }

  if (resourceUsage.computeUnitsUsed > provisioning.resourceBounds.maxComputeUnits) {
    issues.push({
      code: "bounds_exceeded",
      detail: `run ${run.runId} used ${resourceUsage.computeUnitsUsed} compute units beyond the sandbox bound ${provisioning.resourceBounds.maxComputeUnits}`,
    });
  }
  if (resourceUsage.storageMbUsed > provisioning.resourceBounds.maxStorageMb) {
    issues.push({
      code: "bounds_exceeded",
      detail: `run ${run.runId} used ${resourceUsage.storageMbUsed} MB beyond the sandbox bound ${provisioning.resourceBounds.maxStorageMb}`,
    });
  }
  if (resourceUsage.wallClockMsUsed > provisioning.resourceBounds.maxWallClockMs) {
    issues.push({
      code: "bounds_exceeded",
      detail: `run ${run.runId} used ${resourceUsage.wallClockMsUsed} ms beyond the sandbox bound ${provisioning.resourceBounds.maxWallClockMs}`,
    });
  }
  if (options.maxRunSteps !== undefined && run.maxSteps > options.maxRunSteps) {
    issues.push({
      code: "bounds_exceeded",
      detail: `run ${run.runId} step bound ${run.maxSteps} exceeds the governed maximum ${options.maxRunSteps}`,
    });
  }

  return issues;
}

/**
 * Validate a raw (untrusted) value as a sandbox run bundle. Shape
 * first (Zod), then cross-field invariants, then freshness against the
 * injected clock. All issues are collected, never truncated to the first.
 */
export function validateSandboxRunBundle(
  raw: unknown,
  options: ValidateSandboxBundleOptions = {},
): SandboxValidationResult {
  const parsed = SandboxRunBundleSchema.safeParse(raw);
  if (!parsed.success) {
    const rawVersion =
      raw !== null && typeof raw === "object" && "schemaVersion" in raw
        ? (raw as { schemaVersion?: unknown }).schemaVersion
        : undefined;
    const isVersionProblem = rawVersion !== undefined && rawVersion !== SANDBOX_CONTRACT_SCHEMA_VERSION;
    return {
      ok: false,
      issues: [
        isVersionProblem
          ? {
              code: "schema_version_unsupported",
              detail: "bundle schemaVersion is not supported by this validator",
            }
          : {
              code: "invalid_input",
              detail: parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("; "),
            },
      ],
    };
  }

  const bundle = parsed.data;
  const issues = crossFieldIssues(bundle, options);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, bundle };
}

/* ─────────────────────────────────────────────────────────────
 * Run gating (pure, clock-injected)
 * ────────────────────────────────────────────────────────────*/

export type RunAdmissionCode =
  | "admitted"
  | "not_active"
  | "sandbox_expired"
  | "tenant_mismatch"
  | "steps_unbounded";

export interface RunAdmission {
  readonly admitted: boolean;
  readonly reason: Exclude<RunAdmissionCode, "admitted"> | null;
}

/**
 * Whether a sandbox may admit another execution run RIGHT NOW.
 * Fail-closed: any doubt (unknown lifecycle, expired sandbox, tenant
 * drift, missing bound) resolves to "not admitted" with a named reason.
 */
export function admitRun(
  provisioning: SandboxProvisioning,
  run: SandboxRunRequest,
  options: { nowMs: number },
): RunAdmission {
  if (provisioning.lifecycle !== "active") {
    return { admitted: false, reason: "not_active" };
  }
  if (provisioning.expiresAtMs <= options.nowMs) {
    return { admitted: false, reason: "sandbox_expired" };
  }
  if (run.tenantRef !== provisioning.tenantRef) {
    return { admitted: false, reason: "tenant_mismatch" };
  }
  if (!(run.maxSteps > 0)) {
    return { admitted: false, reason: "steps_unbounded" };
  }
  return { admitted: true, reason: null };
}

/* ─────────────────────────────────────────────────────────────
 * Agent grant evaluation (pure, clock-injected)
 * ────────────────────────────────────────────────────────────*/

export type AgentGrantDenyReason =
  | "invalid_input"
  | "tenant_mismatch"
  | "sandbox_mismatch"
  | "not_active"
  | "sandbox_expired"
  | "grant_expired"
  | "grant_revoked"
  | "grant_outlives_sandbox"
  | "credential_scope_escalation";

export type AgentGrantDecision =
  | { readonly decision: "DENY"; readonly reason: AgentGrantDenyReason }
  | { readonly decision: "ALLOW" };

/**
 * Evaluate an agent grant against a sandbox. Fail-closed ordering:
 * shape, tenant, sandbox, lifecycle, expiry (sandbox first — a grant
 * can never outlive its sandbox), revocation, and credential scope:
 * a grant claiming any scope other than non-production is an
 * escalation attempt and is DENIED, never silently narrowed.
 */
export function evaluateAgentGrant(
  raw: unknown,
  provisioning: SandboxProvisioning,
  options: { nowMs: number },
): AgentGrantDecision {
  const parsed = AgentGrantSchema.safeParse(raw);
  if (!parsed.success) {
    return { decision: "DENY", reason: "invalid_input" };
  }
  const grant = parsed.data;

  if (grant.tenantRef !== provisioning.tenantRef) {
    return { decision: "DENY", reason: "tenant_mismatch" };
  }
  if (grant.sandboxId !== provisioning.sandboxId) {
    return { decision: "DENY", reason: "sandbox_mismatch" };
  }
  if (provisioning.lifecycle !== "active") {
    return { decision: "DENY", reason: "not_active" };
  }
  if (provisioning.expiresAtMs <= options.nowMs) {
    return { decision: "DENY", reason: "sandbox_expired" };
  }
  if (grant.expiresAtMs > provisioning.expiresAtMs) {
    return { decision: "DENY", reason: "grant_outlives_sandbox" };
  }
  if (grant.expiresAtMs <= options.nowMs) {
    return { decision: "DENY", reason: "grant_expired" };
  }
  if (grant.revoked) {
    return { decision: "DENY", reason: "grant_revoked" };
  }
  if (grant.credentialScope !== SANDBOX_CREDENTIAL_SCOPE) {
    return { decision: "DENY", reason: "credential_scope_escalation" };
  }
  return { decision: "ALLOW" };
}

/* ─────────────────────────────────────────────────────────────
 * The ONLY bridge toward canonical surfaces (§9/§16/§21)
 * ────────────────────────────────────────────────────────────*/

/**
 * A governed proposal to promote sandbox results toward a canonical
 * surface. This module can DECIDE such proposals; it can never execute
 * them — no write surface exists here. Execution, when a decision is
 * ALLOW, belongs to the owning domain phase under its own policy,
 * approval and audit machinery.
 */
export const SandboxPromotionProposalSchema = z.object({
  proposalId: z.string().min(1),
  tenantRef: z.string().min(1),
  sourceSandboxId: z.string().min(1),
  purpose: z.string().min(1),
  /**
   * Governing policy reference (AGENTS §16 — under which policy?).
   * Optional in shape, mandatory at the decision gate: a proposal
   * without one is DENIED, never silently routed.
   */
  policyRef: z.string().min(1).optional(),
  /** Where the audit record for the executed promotion will land (AGENTS §29). */
  auditDestinationRef: z.string().min(1).optional(),
  /** The derived observations (by id) the proposal rests on. Promotions cite evidence or nothing moves. */
  evidence: z.array(z.string().min(1)).min(1, "a promotion proposal must cite the observations it rests on"),
  /** Self-described terminal state of the source sandbox at proposal time. */
  sandboxSummary: z.object({
    lifecycle: z.enum(SANDBOX_LIFECYCLES),
    escapeEventCount: z.number().int().nonnegative(),
    observationCount: z.number().int().nonnegative(),
    provenance: ProvenanceSchema,
  }),
});

export type SandboxPromotionProposal = z.infer<typeof SandboxPromotionProposalSchema>;

/** A recorded human approval for a specific tenant + sandbox scope. */
export const PromotionApprovalSchema = z.object({
  approvalId: z.string().min(1),
  approvedBy: z.string().min(1),
  approvedAtMs: z.number().int().nonnegative(),
  /** Approvals expire (AGENTS §31: expired access fails). */
  expiresAtMs: z.number().int().nonnegative(),
  tenantRef: z.string().min(1),
  sandboxRefs: z.array(z.string().min(1)).min(1),
  revoked: z.boolean().default(false),
});

export type PromotionApproval = z.infer<typeof PromotionApprovalSchema>;

export type PromotionDenyReason =
  | "invalid_input"
  | "no_policy"
  | "no_audit_destination"
  | "no_evidence"
  | "sandbox_not_terminated"
  | "containment_breached"
  | "approval_mismatch_tenant"
  | "approval_mismatch_sandbox"
  | "approval_expired"
  | "approval_revoked";

export type PromotionDecision =
  | { readonly decision: "DENY"; readonly reason: PromotionDenyReason }
  | { readonly decision: "REQUIRE_APPROVAL" }
  | { readonly decision: "ALLOW" };

export interface DecidePromotionOptions {
  nowMs: number;
  approval?: PromotionApproval;
}

/**
 * Decide a sandbox promotion proposal. Fail-closed ordering:
 *   1. shape — an unparseable proposal is DENY ("invalid_input");
 *   2. policy — no declared policy, no decision surface: DENY;
 *   3. audit — no declared audit destination: DENY;
 *   4. evidence — the cited observations must exist (the summary must
 *      record at least as many observations as the proposal cites) and
 *      the proposal must cite at least one: DENY otherwise;
 *   5. cleanup — the source sandbox must be TERMINATED (fully cleaned
 *      up) before anything promotes out of it: DENY otherwise;
 *   6. containment — any escape event, contained or not, means the
 *      sandbox boundary did not hold: DENY;
 *   7. approval — absent → REQUIRE_APPROVAL (escalation, not a write);
 *      present but mismatched, expired, or revoked → DENY;
 *   8. otherwise ALLOW — the proposal MAY proceed to execution
 *      elsewhere, under the declared policy, with the approval and
 *      audit trail recorded. Nothing in this module executes it.
 */
export function decideSandboxPromotion(
  raw: unknown,
  options: DecidePromotionOptions,
): PromotionDecision {
  const parsed = SandboxPromotionProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { decision: "DENY", reason: "invalid_input" };
  }
  const proposal = parsed.data;

  if (proposal.policyRef === undefined || proposal.policyRef.trim().length === 0) {
    return { decision: "DENY", reason: "no_policy" };
  }
  if (proposal.auditDestinationRef === undefined) {
    return { decision: "DENY", reason: "no_audit_destination" };
  }
  if (proposal.evidence.length === 0 || proposal.sandboxSummary.observationCount < proposal.evidence.length) {
    return { decision: "DENY", reason: "no_evidence" };
  }
  if (proposal.sandboxSummary.lifecycle !== "terminated") {
    return { decision: "DENY", reason: "sandbox_not_terminated" };
  }
  if (proposal.sandboxSummary.escapeEventCount > 0) {
    return { decision: "DENY", reason: "containment_breached" };
  }

  const approval = options.approval;
  if (approval === undefined) {
    return { decision: "REQUIRE_APPROVAL" };
  }
  if (approval.tenantRef !== proposal.tenantRef) {
    return { decision: "DENY", reason: "approval_mismatch_tenant" };
  }
  if (!approval.sandboxRefs.includes(proposal.sourceSandboxId)) {
    return { decision: "DENY", reason: "approval_mismatch_sandbox" };
  }
  if (approval.expiresAtMs <= options.nowMs) {
    return { decision: "DENY", reason: "approval_expired" };
  }
  if (approval.revoked) {
    return { decision: "DENY", reason: "approval_revoked" };
  }

  return { decision: "ALLOW" };
}
