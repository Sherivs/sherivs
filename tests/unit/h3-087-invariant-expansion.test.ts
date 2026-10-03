/**
 * CoreGrid — H3-087: §27 posture checks for the H3 wave's NEW server-side
 * contract modules (Constitution §27; mission H-087, Squad H).
 *
 * The scholar-invariant suites (§27 per-function invariants) proved the full
 * AUTHENTICATE → RESOLVE TENANT → AUTHORIZE → VALIDATE → EXECUTE → AUDIT →
 * RETURN chain for the `createServerFn` families. The H3 wave added a new
 * class of server-side surface: pure contract modules whose types are the
 * server boundary — callers (and eventual route handlers) can only reach
 * execution through their validated envelopes. This suite extends the §27
 * posture proof to those modules, structurally (static source analysis,
 * scholar-invariant style) AND behaviorally (offline fail-closed execution):
 *
 * (a) SERVER-RESOLVED CONTEXT: tenant/actor/authority can never be derived
 *     from untrusted caller input — every identity-bearing field enters
 *     through a validated contract, is cross-checked against an INDEPENDENTLY
 *     declared tenant/context record, and ambient resolution (env vars,
 *     request headers, client-stamped tenant ids) does not exist in the
 *     module source.
 * (b) FAIL CLOSED: every missing / malformed / cross-tenant / unresolvable
 *     context denies with a typed, named code — there is no permissive
 *     default, no silent fallback, no vacuous pass.
 * (c) AUDIT EVIDENCE: every admission AND denial leaves a record (append-only
 *     in-memory ledgers or audit-bearing return values); denial is never
 *     silent (§18, §29).
 * (d) PERMITTED PROJECTIONS: returned surfaces are bounded, deep-frozen /
 *     strict views — digests instead of raw subjects, fail-closed snapshots
 *     for undeclared principals, secret-free egress audit fields, tenant-
 *     coherent read-only pages — and never leak authority beyond what the
 *     validated envelope admits.
 *
 * The manifest below is the spec; the source must match it. A §27 gap is
 * never accommodated — it is a failing assertion, recorded as a finding.
 *
 * Offline by construction: no database, no network, no secrets, fixed
 * instants everywhere (injected clocks), and the only `fetch` in scope is
 * egress-allowlist's guarded transport handoff, which the deny path provably
 * never invokes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  declareApprovalChain,
  gateExecutionOnResolution,
  openResolutionFlow,
  openResolutionFlowForAuthorizationOutcome,
  recordResolution,
  resolveFlow,
  routeToApprovalChain,
  ResolutionFlowError,
} from "@/lib/approval/chains";
import {
  parseResourceQuotaRegistry,
  ResourceQuotaAuthority,
  type ResourceQuotaAuditEvent,
} from "@/lib/reliability/quotas";
import type { AdapterClock } from "@/lib/adapters/failure-policy";
import type { LeaseHandleRef, LeaseTargetKind } from "@/lib/reliability/leases";
import {
  capabilityRegistryFromDeclarations,
  matchCapabilities,
  matchWorkerCapabilities,
} from "@/lib/agent-runtime/capability-matching";
import { defineWorkerDefinition } from "@/lib/workforce/worker-definition";
import { evaluateGate, evaluateGateReviews } from "@/lib/mission/gates";
import type { MissionEvidenceRecord } from "@/lib/mission/mission-contract";
import { enforceIndependence, independenceAllows } from "@/lib/assurance/independence-enforcement";
import type { IndependenceCheckInput } from "@/lib/assurance/independence-enforcement";
import { parseAuditPage, parseAuditQueryEnvelope } from "@/lib/audit/query-surface.contract";
import { EgressAllowlist } from "@/lib/ai-gateway/egress-allowlist";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LIB = join(ROOT, "frontend/src/lib");

/* ─────────────────────────────────────────────────────────────
 * The manifest — every H3-wave contract module under proof
 * ────────────────────────────────────────────────────────────*/

interface ModuleSpec {
  readonly id: string;
  readonly file: string;
  /** (a) server-resolved context markers that MUST appear in the source. */
  readonly contextMarkers: readonly RegExp[];
  /** (b) fail-closed deny vocabulary that MUST appear in the source. */
  readonly failClosedMarkers: readonly RegExp[];
  /** (c) audit-evidence markers that MUST appear in the source. */
  readonly auditMarkers: readonly RegExp[];
  /** (d) permitted-projection markers that MUST appear in the source. */
  readonly projectionMarkers: readonly RegExp[];
  readonly note?: string;
}

const MODULES: readonly ModuleSpec[] = [
  {
    id: "approval/chains",
    file: "approval/chains.ts",
    contextMarkers: [
      /z\.enum\(RESOLUTION_FLOW_DECISIONS\)/,
      /chain\.tenantId !== kase\.tenantId/,
      /parsed\.tenantId !== kase\.tenantId/,
      /record\.tenantId !== kase\.tenantId/,
    ],
    failClosedMarkers: [
      /decision_not_routable/,
      /case_not_routed/,
      /chain_tenant_mismatch/,
      /no_eligible_resolver/,
      /resolver_not_human/,
      /self_resolution_rejected/,
      /tenant_scope_mismatch/,
      /deadline_exceeded/,
      /evidence_required/,
      /forged_record_set|kind: "invalid"/,
    ],
    auditMarkers: [
      /interface ResolutionExecutionAudit/,
      /export function gateExecutionOnResolution/,
      /auditId: digestContent\(/,
    ],
    projectionMarkers: [
      /function deepFreeze/,
      /readonly subjectDigest: string;/,
      /outcome\.kind === "approved" \? "ALLOWED" : "DENIED"/,
    ],
    note: "§16/§21: only ESCALATE/REQUIRE_APPROVAL enter the flow; human closure gates execution; every gate decision (ALLOWED or DENIED) emits a §29 audit record.",
  },
  {
    id: "reliability/quotas",
    file: "reliability/quotas.ts",
    contextMarkers: [
      /principal\.tenantRef/,
      /bindingPrincipal\.tenantRef !== request\.principal\.tenantRef/,
      /\$\{ceiling\.scope\}:\$\{ceiling\.principalRef\}:\$\{ceiling\.resourceClass\}/,
    ],
    failClosedMarkers: [
      /undeclared_quota/,
      /quota_exhausted/,
      /lease_plane_unavailable/,
      /lease_not_active/,
      /invalid_input/,
      /admission fails closed/,
    ],
    auditMarkers: [
      /kind: "quota_consumed"/,
      /kind: "quota_denied"/,
      /auditTrail\(\): readonly ResourceQuotaAuditEvent\[\]/,
      /onEvent/,
    ],
    projectionMarkers: [
      /readonly QuotaScopeSnapshot\[\]/,
      /declared: false/,
      /limit: 0/,
      /quota: QuotaExhaustionDetail \| null;/,
    ],
    note: "fail-closed volume admission: undeclared (scope, principal, class) admits nothing; denials are audited events, never silent.",
  },
  {
    id: "agent-runtime/capability-matching",
    file: "agent-runtime/capability-matching.ts",
    contextMarkers: [
      /isIdentityUsable\(/,
      /capabilityRegistrySchema/,
      /declared\.has\(requirement\.capabilityId\)/,
    ],
    failClosedMarkers: [
      /unknown_capability/,
      /empty_requirements/,
      /duplicate_requirements/,
      /definition_lifecycle_unusable/,
      /FAIL_CLOSED_UNKNOWN_CAPABILITY_DETAIL/,
    ],
    auditMarkers: [
      /readonly unknown: readonly string\[\]/,
      /readonly code: CapabilityMatchDenyCode;/,
      /readonly detail: string;/,
    ],
    projectionMarkers: [
      /readonly matched: readonly string\[\]/,
      /\? "none" : "partial"/,
      /depth: "full"/,
    ],
    note: "authority is computed from PERSISTENT declared capability + lifecycle state, never from caller-claimed grants; partial overlap is observability, not authority.",
  },
  {
    id: "mission/gates",
    file: "mission/gates.ts",
    contextMarkers: [
      /declaration\.tenantId !== ctx\.tenantId/,
      /record\.tenantId !== tenantId/,
      /ctx\.tenantId\.trim\(\)\.length === 0/,
    ],
    failClosedMarkers: [
      /const gatePassedBrand: unique symbol = Symbol\("coregrid\.gate\.passed"\)/,
      /cross_tenant: gate is declared for tenant/,
      /invalid_evaluation_context/,
      /missing_evidence_kind/,
      /undeclared_gate/,
      /duplicate_submission/,
      /missingSubmissions/,
      /reviews\.length > 0 && blockedVerdicts\.length === 0/,
    ],
    auditMarkers: [
      /readonly reasons: readonly string\[\];/,
      /function blocked\(gateId: string, kind: GateKind, now: string, reasons: readonly string\[\]\)/,
    ],
    projectionMarkers: [
      /readonly \[gatePassedBrand\]: true;/,
      /basis: GatePassBasis;/,
      /satisfiedBy: resolved\.usable\.map/,
    ],
    note: "PASSED is branded and minted only inside the module after verification; BLOCKED always names its reasons; zero gates never pass.",
  },
  {
    id: "assurance/independence-enforcement",
    file: "assurance/independence-enforcement.ts",
    contextMarkers: [
      /independenceCheckInputSchema/,
      /verifierRef\.length === 0/,
      /performer\.status === "unrecorded"/,
      /performer\.status === "ambiguous"/,
    ],
    failClosedMarkers: [
      /self_verification_denied/,
      /binding_relationship_denied/,
      /unknown_relationship_type/,
      /unknown_relationship_status/,
      /invalid_relationship_evidence/,
      /relationship_evidence_incomplete/,
      /verifier_identity_unrecorded/,
      /performer_of_record_unrecorded/,
      /performer_of_record_ambiguous/,
    ],
    auditMarkers: [
      /interface IndependenceAuditRecord/,
      /eventKind: "independence_confirmed" \| "independence_denied"/,
      /function auditRecord\(/,
    ],
    projectionMarkers: [
      /audit: IndependenceAuditRecord/,
      /readonly denyReason: IndependenceDenyReason \| null;/,
      /readonly bindingRelationshipIds: readonly string\[\];/,
    ],
    note: "J-035: a worker cannot verify its own output; every determination — confirmed AND denied — returns an audit record (§18).",
  },
  {
    id: "audit/query-surface.contract",
    file: "audit/query-surface.contract.ts",
    contextMarkers: [
      /tenantId: tenantIdSchema/,
      /actorRef: actorRefSchema/,
      /record\.tenantId !== envelope\.tenantId/,
      /foreign\.length > 0/,
    ],
    failClosedMarkers: [
      /cross_tenant_record_refused/,
      /unbounded_time_window/,
      /unbounded_actor_scope/,
      /unbounded_page/,
      /unbounded_future_window/,
      /MAX_AUDIT_WINDOW_MS/,
      /MAX_PAGE_LIMIT/,
    ],
    auditMarkers: [
      /purpose limitation/,
      /purpose: z/,
    ],
    projectionMarkers: [
      /export function freezeAuditPage/,
      /Object\.freeze/,
      /z\.strictObject\(/,
    ],
    note: "tenant-bound, actor-scoped, time-bounded, purpose-bound read envelope; returned pages are deep-frozen and tenant-coherence-checked (RLS remains the boundary, §17).",
  },
  {
    id: "ai-gateway/egress-allowlist",
    file: "ai-gateway/egress-allowlist.ts",
    contextMarkers: [
      /EgressBindingSchema/,
      /binding\.providerClass === providerClass/,
      /decideForRouting\(/,
      /routing\.decision !== "allow"/,
    ],
    failClosedMarkers: [
      /unregistered_endpoint/,
      /non_https_scheme/,
      /embedded_credentials/,
      /endpoint_not_bound_to_provider/,
      /port_not_permitted|path_not_permitted|method_not_permitted/,
      /route_denied/,
      /invalid_clock/,
    ],
    auditMarkers: [
      /auditLog\(\): readonly EgressAuditRecord\[\]/,
      /interface EgressAuditRecord/,
      /private audit\(decision: EgressDecision/,
    ],
    projectionMarkers: [
      /scheme: string;/,
      /host: string;/,
      /port: string;/,
      /path: string;/,
      /method: string;/,
    ],
    note: "deny-by-default egress at the gateway boundary (§20/§25); audit records carry scheme/host/port/path/method only — never query strings, fragments, headers or bodies (§29).",
  },
];

/** (a) Trust-violation patterns that must not exist in ANY covered module. */
const FORBIDDEN: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
  { reason: "no ambient identity resolution via process.env (server-resolved context only)", pattern: /process\.env/ },
  { reason: "no header/cookie ambient identity reads", pattern: /headers\.get\(|cookies\(|getHeader\(|x-tenant/i },
  { reason: "no client-stamped tenant id trusted into a payload or query", pattern: /(?:tenantId|tenant_id|schoolId|school_id)\s*:\s*(?:input|data|raw|request|body|payload)\b/ },
  { reason: "no vendor SDK imports (§25 provider neutrality)", pattern: /from ["'](?:@supabase\/supabase-js|supabase-js|twilio|paystack|stripe)["']/ },
  { reason: "no database client or RPC binding in a pure contract module", pattern: /\bsupabase\b|\.rpc\(/ },
  { reason: "no z.any() (§32; H3 campaign law 7)", pattern: /z\.any\(\)/ },
  { reason: "no `any` type (§32; H3 campaign law 7)", pattern: /:\s*any\b/ },
  { reason: "no direct console logging of any kind (§29 secret hygiene)", pattern: /console\./ },
];

const STATIC_MODULES = MODULES.filter((m) => m.file !== "ai-gateway/egress-allowlist.ts");

/**
 * Strip comment lines so forbidden-pattern checks measure CODE, not the
 * module's own law documentation (headers legitimately say "no `any`").
 */
function codeOnly(src: string): string {
  return src
    .split("\n")
      .filter((line) => !/^\s*(?:\*|\/\*|\/\/)/.test(line))
    .join("\n");
}

/* ─────────────────────────────────────────────────────────────
 * Static §27 posture suites (scholar-invariant style)
 * ────────────────────────────────────────────────────────────*/

for (const mod of MODULES) {
  describe(`§27 contract-module posture — ${mod.id}`, () => {
    const src = readFileSync(join(LIB, mod.file), "utf8");

    it("inventory: module exists and is a substantive contract surface", () => {
      expect(src.length, `${mod.id}: module source must be present`).toBeGreaterThan(1_000);
    });

    it("(a) server-resolved context: validated contracts + cross-checks, no ambient trust", () => {
      expect(src, `${mod.id}: contracts must be zod-validated (§32)`).toMatch(/from ["']zod["']/);
      for (const marker of mod.contextMarkers) {
        expect(src, `${mod.id}: server-resolved context marker ${marker}`).toMatch(marker);
      }
    });

    it("(b) fail closed: typed deny vocabulary is present and named", () => {
      for (const marker of mod.failClosedMarkers) {
        expect(src, `${mod.id}: fail-closed marker ${marker}`).toMatch(marker);
      }
    });

    it("(c) audit: admission AND denial evidence markers are present", () => {
      for (const marker of mod.auditMarkers) {
        expect(src, `${mod.id}: audit-evidence marker ${marker}`).toMatch(marker);
      }
    });

    it("(d) permitted projections: bounded, frozen/strict return surfaces", () => {
      for (const marker of mod.projectionMarkers) {
        expect(src, `${mod.id}: permitted-projection marker ${marker}`).toMatch(marker);
      }
    });

    it("trust hygiene: none of the forbidden patterns appears in the source", () => {
      const code = codeOnly(src);
      for (const { reason, pattern } of FORBIDDEN) {
        expect(code, `${mod.id}: ${reason}`).not.toMatch(pattern);
      }
    });
  });
}

describe("§27 contract-module posture — cross-module transport hygiene", () => {
  it("no module performs network I/O; egress fetch exists only as the guarded handoff", () => {
    for (const mod of STATIC_MODULES) {
      const src = readFileSync(join(LIB, mod.file), "utf8");
      expect(src, `${mod.id}: pure contract module must contain no fetch`).not.toMatch(/fetch\(/);
    }
    const egress = readFileSync(join(LIB, "ai-gateway/egress-allowlist.ts"), "utf8");
    const fetches = egress.match(/fetch\(/g) ?? [];
    expect(fetches.length, "egress: exactly one transport channel").toBe(1);
    expect(egress, "egress: the only channel must be the guarded globalThis.fetch handoff").toMatch(
      /globalThis\.fetch\(url, init\)/,
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Behavioral §27 proofs — fail closed, offline, fixed instants
 * ────────────────────────────────────────────────────────────*/

const T0 = "2026-10-01T00:00:00.000Z";
const EVAL = "2026-10-03T00:00:00.000Z";
const FUTURE = "2026-10-10T00:00:00.000Z";
const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";

function flowErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ResolutionFlowError) return error.code;
    throw error;
  }
  throw new Error("expected the call to throw ResolutionFlowError");
}

describe("§27 behavior — approval/chains (ESCALATE/REQUIRE_APPROVAL resolution)", () => {
  const baseInput = {
    requestId: "req-1",
    tenantId: TENANT,
    policyId: "policy-1",
    decision: "REQUIRE_APPROVAL" as const,
    riskTier: "critical" as const,
    reason: "critical deployment requires human closure",
    requesterRef: "agent-ai-1",
    requesterKind: "ai" as const,
    requestedAt: T0,
    subject: { action: "deploy", target: "service-a" },
  };

  const chain = declareApprovalChain({
    chainId: "chain-1",
    tenantId: TENANT,
    capabilityRequired: "cap.approve",
    resolvers: [
      { resolverRef: "human-1", identityKind: "human", capabilities: ["cap.approve"] },
      { resolverRef: "human-2", identityKind: "human", capabilities: ["cap.approve"] },
      { resolverRef: "human-3", identityKind: "human", capabilities: ["cap.approve"] },
    ],
    resolveBy: FUTURE,
  });

  function approveInput(resolverRef: string, resolutionId: string) {
    return {
      resolutionId,
      verdict: "approve" as const,
      resolverRef,
      identityKind: "human" as const,
      tenantId: TENANT,
      capabilities: ["cap.approve"],
      decidedAt: EVAL,
      evidence: `independent approval by ${resolverRef}`,
    };
  }

  it("(a) terminal engine decisions never enter the flow (no re-deciding ALLOW/DENY/REDACT)", () => {
    for (const decision of ["ALLOW", "DENY", "REDACT"] as const) {
      expect(
        () =>
          openResolutionFlowForAuthorizationOutcome(
            { decision, reason: "engine terminal" },
            { ...baseInput, decision: undefined } as never,
          ),
        `terminal decision ${decision} must be unroutable`,
      ).toThrow();
      expect(flowErrorCode(() => openResolutionFlow({ ...baseInput, decision: decision as never }))).toBe(
        "invalid_input",
      );
    }
  });

  it("(b) fails closed on cross-tenant chains, impossible depths, AI resolvers and self-resolution", () => {
    const kase = openResolutionFlow(baseInput);

    // ApprovalChain freezes its resolvers; re-declare with mutable entries to
    // satisfy ApprovalChainConfig (the runtime data is unchanged).
    const foreignChain = declareApprovalChain({
      ...chain,
      chainId: "chain-foreign",
      tenantId: OTHER_TENANT,
      resolvers: chain.resolvers.map((entry) => ({ ...entry, capabilities: [...entry.capabilities] })),
    });
    const routed = routeToApprovalChain(kase, foreignChain);
    expect(routed.ok).toBe(false);
    expect(!routed.ok && routed.code).toBe("chain_tenant_mismatch");

    // critical mandates quorum (3); a two-person chain cannot satisfy it.
    const shallow = declareApprovalChain({
      ...chain,
      resolvers: chain.resolvers.slice(0, 2).map((entry) => ({ ...entry, capabilities: [...entry.capabilities] })),
    });
    const undersupplied = routeToApprovalChain(kase, shallow);
    expect(undersupplied.ok).toBe(false);
    expect(!undersupplied.ok && undersupplied.code).toBe("no_eligible_resolver");

    const routing = routeToApprovalChain(kase, chain);
    expect(routing.ok).toBe(true);

    expect(flowErrorCode(() =>
      recordResolution(kase, routing, chain, [], {
        ...approveInput("human-1", "res-1"),
        identityKind: "ai",
      }),
    )).toBe("resolver_not_human");

    // A human requester can never close its own case (§7 independence);
    // routine depth keeps the remaining pool eligible for the routing step.
    const humanCase = openResolutionFlow({
      ...baseInput,
      requesterRef: "human-1",
      requesterKind: "human",
      riskTier: "routine" as const,
    });
    const humanRouting = routeToApprovalChain(humanCase, chain);
    expect(humanRouting.ok).toBe(true);
    expect(flowErrorCode(() =>
      recordResolution(humanCase, humanRouting, chain, [], approveInput("human-1", "res-self")),
    )).toBe("self_resolution_rejected");

    expect(flowErrorCode(() =>
      recordResolution(kase, routing, chain, [], {
        ...approveInput("human-1", "res-3"),
        tenantId: OTHER_TENANT,
      }),
    )).toBe("tenant_scope_mismatch");

    expect(flowErrorCode(() =>
      recordResolution(kase, routing, chain, [], { ...approveInput("human-1", "res-4"), evidence: "   " }),
    )).toBe("evidence_required");
  });

  it("(c)+(d) the execution gate DENIES unmet flows, ALWAYS emits an audit record, and projects only digests", () => {
    const kase = openResolutionFlow(baseInput);
    const routing = routeToApprovalChain(kase, chain);
    expect(routing.ok).toBe(true);

    const one = recordResolution(kase, routing, chain, [], approveInput("human-1", "res-1"));
    const pending = resolveFlow(kase, routing, [one], EVAL);
    expect(pending.kind).toBe("pending");

    const denied = gateExecutionOnResolution(kase, pending, EVAL);
    expect(denied.gateDecision).toBe("DENIED");
    expect(denied.audit.gateDecision).toBe("DENIED");
    expect(denied.audit.caseId).toBe(kase.caseId);
    expect(denied.audit.subjectDigest).toBe(kase.subjectDigest);

    const two = recordResolution(kase, routing, chain, [one], approveInput("human-2", "res-2"));
    const three = recordResolution(kase, routing, chain, [one, two], approveInput("human-3", "res-3"));
    const approved = resolveFlow(kase, routing, [one, two, three], EVAL);
    expect(approved.kind).toBe("approved");

    const allowed = gateExecutionOnResolution(kase, approved, EVAL);
    expect(allowed.gateDecision).toBe("ALLOWED");
    expect(allowed.audit.gateDecision).toBe("ALLOWED");

    // (d) permitted projection: raw subject never appears on the case or the audit record.
    expect(Object.keys(kase)).not.toContain("subject");
    expect(Object.keys(denied.audit)).not.toContain("subject");
    expect(JSON.stringify(denied.audit)).not.toContain("deploy");
  });
});

describe("§27 behavior — reliability/quotas (fail-closed metered admission)", () => {
  const NOW = 1_780_000_000_000;
  const clock: AdapterClock = { nowMs: () => NOW, delay: async () => undefined };

  const provenance = { declaredBy: "operator-h3", authority: "campaign:H3", declaredAt: T0 };

  function authority(
    ceilings: {
      scope: "tenant" | "agent";
      principalRef: string;
      resourceClass: string;
      maxUnitsPerWindow: number;
      windowMs: number;
    }[],
    onEvent?: (event: ResourceQuotaAuditEvent) => void,
  ): ResourceQuotaAuthority {
    const parsed = parseResourceQuotaRegistry({ ceilings: ceilings.map((c) => ({ ...c, provenance })) });
    expect(parsed.ok, "fixture registry must parse").toBe(true);
    return new ResourceQuotaAuthority({
      registry: parsed.ok ? parsed.registry : undefined!,
      clock,
      ...(onEvent ? { onEvent } : {}),
    });
  }

  it("(b) undeclared principals admit nowhere — fail closed with a named code", () => {
    const quota = authority([
      { scope: "tenant", principalRef: TENANT, resourceClass: "inference.tokens", maxUnitsPerWindow: 100, windowMs: 60_000 },
    ]);
    const denied = quota.consume({ principal: { tenantRef: OTHER_TENANT, agentRef: null }, resourceClass: "inference.tokens", units: 1 });
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.reason).toBe("undeclared_quota");
    expect(!denied.ok && denied.quota).toBeNull();
  });

  it("(b) zero-limit ceilings deny everything; exhaustion denies with structured retry detail", () => {
    const quota = authority([
      { scope: "tenant", principalRef: TENANT, resourceClass: "inference.tokens", maxUnitsPerWindow: 0, windowMs: 60_000 },
      { scope: "tenant", principalRef: "tenant-cap", resourceClass: "inference.tokens", maxUnitsPerWindow: 10, windowMs: 60_000 },
    ]);
    const zero = quota.consume({ principal: { tenantRef: TENANT, agentRef: null }, resourceClass: "inference.tokens", units: 1 });
    expect(zero.ok).toBe(false);
    expect(!zero.ok && zero.reason).toBe("quota_exhausted");

    const full = quota.consume({ principal: { tenantRef: "tenant-cap", agentRef: null }, resourceClass: "inference.tokens", units: 10 });
    expect(full.ok).toBe(true);
    const over = quota.consume({ principal: { tenantRef: "tenant-cap", agentRef: null }, resourceClass: "inference.tokens", units: 1 });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.reason).toBe("quota_exhausted");
    expect(!over.ok && over.quota).not.toBeNull();
    expect(!over.ok && over.quota!.limit).toBe(10);
    expect(!over.ok && over.quota!.retryAtMs).toBeGreaterThan(NOW);
  });

  it("(b) a presented lease binding with no lease plane is a denial, never a bypass", () => {
    const quota = authority([
      { scope: "tenant", principalRef: TENANT, resourceClass: "inference.tokens", maxUnitsPerWindow: 100, windowMs: 60_000 },
    ]);
    const lease: LeaseHandleRef = {
      target: { kind: "resource" as LeaseTargetKind, ref: "res-1" },
      leaseId: "lease-1",
      fencingToken: 7,
      principal: { tenantRef: TENANT, agentRef: null },
    };
    const denied = quota.consume({
      principal: { tenantRef: TENANT, agentRef: null },
      resourceClass: "inference.tokens",
      units: 1,
      lease,
    });
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.reason).toBe("lease_plane_unavailable");
  });

  it("(d) snapshots project a fail-closed zero-capacity view for undeclared principals", () => {
    const quota = authority([
      { scope: "tenant", principalRef: TENANT, resourceClass: "inference.tokens", maxUnitsPerWindow: 5, windowMs: 60_000 },
    ]);
    const undeclared = quota.snapshot({ tenantRef: OTHER_TENANT, agentRef: null }, "inference.tokens");
    expect(undeclared.length).toBeGreaterThan(0);
    for (const view of undeclared) {
      expect(view.declared).toBe(false);
      expect(view.limit).toBe(0);
      expect(view.remainingInWindow).toBeNull();
    }
  });

  it("(c) every denial and consumption is an audited event; observability cannot break containment", () => {
    const events: unknown[] = [];
    const quota = authority(
      [
        { scope: "tenant", principalRef: TENANT, resourceClass: "inference.tokens", maxUnitsPerWindow: 1, windowMs: 60_000 },
      ],
      (event) => events.push(event),
    );
    expect(quota.consume({ principal: { tenantRef: TENANT, agentRef: null }, resourceClass: "inference.tokens", units: 1 }).ok).toBe(true);
    expect(quota.consume({ principal: { tenantRef: TENANT, agentRef: null }, resourceClass: "inference.tokens", units: 1 }).ok).toBe(false);
    expect(quota.consume({ principal: { tenantRef: OTHER_TENANT, agentRef: null }, resourceClass: "inference.tokens", units: 1 }).ok).toBe(false);

    const trail = quota.auditTrail();
    expect(trail.length).toBe(3);
    expect(trail.filter((e) => e.kind === "quota_denied").length).toBe(2);
    expect(trail.filter((e) => e.kind === "quota_consumed").length).toBe(1);
    expect(events.length).toBe(3);
    expect(quota.totals().denied).toBe(2);

    // A throwing observability sink must never break containment (§29).
    const brittle = authority(
      [{ scope: "tenant", principalRef: TENANT, resourceClass: "inference.tokens", maxUnitsPerWindow: 1, windowMs: 60_000 }],
      () => {
        throw new Error("sink down");
      },
    );
    expect(brittle.consume({ principal: { tenantRef: TENANT, agentRef: null }, resourceClass: "inference.tokens", units: 1 }).ok).toBe(true);
    expect(brittle.auditTrail().length).toBe(1);
  });
});

describe("§27 behavior — agent-runtime/capability-matching (explicit overlap only)", () => {
  const registry = capabilityRegistryFromDeclarations([
    { capabilityId: "cap.egress.read", description: "read-side egress classification" },
    { capabilityId: "cap.egress.write", description: "write-side egress classification" },
  ]);

  it("(b) an empty requirement set authorizes nothing (nothing from nothing)", () => {
    const result = matchCapabilities(registry, []);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("empty_requirements");
  });

  it("(b) unknown and duplicate requirements deny with the exact uncovered ids named", () => {
    const unknown = matchCapabilities(registry, [{ capabilityId: "cap.does.not.exist", purpose: "probe" }]);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.code).toBe("unknown_capability");
    expect(!unknown.ok && unknown.unknown).toEqual(["cap.does.not.exist"]);

    const duplicate = matchCapabilities(registry, [
      { capabilityId: "cap.egress.read", purpose: "probe" },
      { capabilityId: "cap.egress.read", purpose: "probe again" },
    ]);
    expect(duplicate.ok).toBe(false);
    expect(!duplicate.ok && duplicate.code).toBe("duplicate_requirements");
  });

  it("(b) partial overlap is reported as depth but NEVER authorizes", () => {
    const partial = matchCapabilities(registry, [
      { capabilityId: "cap.egress.read", purpose: "covered" },
      { capabilityId: "cap.missing", purpose: "uncovered" },
    ]);
    expect(partial.ok).toBe(false);
    expect(!partial.ok && partial.depth).toBe("partial");

    const full = matchCapabilities(registry, [
      { capabilityId: "cap.egress.read", purpose: "covered" },
      { capabilityId: "cap.egress.write", purpose: "covered" },
    ]);
    expect(full.ok).toBe(true);
    expect(full.ok && full.depth).toBe("full");
  });

  it("(a)+(b) an unusable worker lifecycle denies before any overlap is computed", () => {
    const built = defineWorkerDefinition({
      id: "worker-1",
      tenantScope: TENANT,
      identityRef: "identity-worker-1",
      classification: "ai",
      capabilities: [{ capabilityId: "cap.egress.read", description: "declared capability" }],
      authorityBounds: { maxRiskClass: "low", resourceScopes: ["scope.read"] },
      lifecycle: "suspended",
    });
    expect(built.ok, "fixture worker definition must validate").toBe(true);
    if (!built.ok) return;

    const required = [{ capabilityId: "cap.egress.read", purpose: "probe" }];
    const denied = matchWorkerCapabilities(built.definition, required);
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.code).toBe("definition_lifecycle_unusable");
  });
});

describe("§27 behavior — mission/gates (typed PASSED/BLOCKED verdicts)", () => {
  function evidence(overrides: Partial<MissionEvidenceRecord> = {}): MissionEvidenceRecord {
    return {
      evidenceId: "ev-1",
      missionId: "mission-1",
      taskId: null,
      evidenceKind: "security-review",
      producer: "producer-1",
      actorId: "actor-1",
      tenantId: TENANT,
      recordedAt: T0,
      provenance: "h3-087 fixture",
      integrity: "sha256-fixture-digest",
      lifecycle: "active",
      ...overrides,
    };
  }

  const declaration = {
    gateId: "gate-1",
    kind: "security" as const,
    tenantId: TENANT,
    reason: "security gate under proof",
    requiredEvidenceKinds: ["security-review"],
    notBefore: null,
    expiresAt: null,
  };
  const submission = {
    gateId: "gate-1",
    submittedBy: "submitter-1",
    submittedAt: T0,
    evidenceRefs: [{ evidenceId: "ev-1", evidenceKind: "security-review" }],
  };

  it("(b) PASSED only after evidence verification; missing evidence BLOCKS with named kinds", () => {
    const passed = evaluateGate(
      { declaration, submission, waiver: null },
      { tenantId: TENANT, now: EVAL, evidence: [evidence()] },
    );
    expect(passed.outcome).toBe("PASSED");

    const blocked = evaluateGate(
      { declaration, submission, waiver: null },
      { tenantId: TENANT, now: EVAL, evidence: [] },
    );
    expect(blocked.outcome).toBe("BLOCKED");
    if (blocked.outcome === "BLOCKED") {
      expect(blocked.reasons.some((r) => r.includes("missing_evidence_kind: security-review"))).toBe(true);
    }
  });

  it("(a) a cross-tenant evaluation context is BLOCKED — the gate never opens across tenants", () => {
    const verdict = evaluateGate(
      { declaration, submission, waiver: null },
      { tenantId: OTHER_TENANT, now: EVAL, evidence: [evidence()] },
    );
    expect(verdict.outcome).toBe("BLOCKED");
    if (verdict.outcome === "BLOCKED") {
      expect(verdict.reasons.some((r) => r.startsWith("cross_tenant:"))).toBe(true);
    }
  });

  it("(b) an empty gate set is never vacuously passed; missing submissions block the mission", () => {
    const empty = evaluateGateReviews([], { tenantId: TENANT, now: EVAL, evidence: [] });
    expect(empty.allPassed).toBe(false);
    expect(empty.passed).toHaveLength(0);
  });
});

describe("§27 behavior — assurance/independence-enforcement (no self-verification)", () => {
  const performer = "worker-human-001";

  function baseInput(overrides: Partial<IndependenceCheckInput> = {}): IndependenceCheckInput {
    return {
      itemId: "item-1",
      tenantScope: TENANT,
      policyRef: "policy-independence",
      verifier: { identityRef: "verifier-human-002", classification: "human" },
      performerOfRecord: { status: "recorded", identityRef: performer },
      relationshipEvidence: [],
      evidenceCompleteness: "complete",
      evaluatedAt: EVAL,
      ...overrides,
    };
  }

  it("(b)+(c) every determination — confirmed AND denied — carries an audit record", () => {
    const confirmed = enforceIndependence(baseInput());
    expect(confirmed.ok).toBe(true);
    expect(confirmed.audit.eventKind).toBe("independence_confirmed");
    expect(confirmed.audit.auditId.length).toBeGreaterThan(0);

    const selfDenied = enforceIndependence(
      baseInput({ verifier: { identityRef: performer, classification: "ai" } }),
    );
    expect(selfDenied.ok).toBe(false);
    expect(!selfDenied.ok && selfDenied.denyReason).toBe("self_verification_denied");
    expect(!selfDenied.ok && selfDenied.outcome).toBe("dependent");
    expect(selfDenied.audit.eventKind).toBe("independence_denied");
    expect(selfDenied.audit.selfVerificationAttempt).toBe(true);
  });

  it("(b) unresolvable or incomplete context blocks — never upgrades to independent", () => {
    const cases: readonly { readonly input: IndependenceCheckInput; readonly reason: string }[] = [
      {
        input: baseInput({ performerOfRecord: { status: "unrecorded" } }),
        reason: "performer_of_record_unrecorded",
      },
      {
        input: baseInput({ performerOfRecord: { status: "ambiguous", candidates: ["a", "b"] } }),
        reason: "performer_of_record_ambiguous",
      },
      {
        input: baseInput({
          verifier: { identityRef: "   ", classification: "human" },
        }),
        reason: "verifier_identity_unrecorded",
      },
      {
        input: baseInput({ evidenceCompleteness: "partial" }),
        reason: "relationship_evidence_incomplete",
      },
      {
        input: baseInput({
          relationshipEvidence: [
            {
              relationshipId: "rel-1",
              subjectId: "verifier-human-002",
              targetId: performer,
              type: "manages",
              scope: null,
              createdAt: T0,
              expiresAt: null,
              revokedAt: null,
              version: 1,
            },
          ],
        }),
        reason: "binding_relationship_denied",
      },
      {
        input: baseInput({
          relationshipEvidence: [
            {
              relationshipId: "rel-2",
              subjectId: "verifier-human-002",
              targetId: performer,
              type: "totally-unknown-type",
              scope: null,
              createdAt: T0,
              expiresAt: null,
              revokedAt: null,
              version: 1,
            },
          ],
        }),
        reason: "unknown_relationship_type",
      },
    ];
    for (const { input, reason } of cases) {
      const result = enforceIndependence(input);
      expect(result.ok, `expected deny ${reason}`).toBe(false);
      expect(!result.ok && result.denyReason, reason).toBe(reason);
      expect(result.audit.eventKind, `${reason}: denial must be observable`).toBe("independence_denied");
      expect(independenceAllows(input), `${reason}: boolean gate must agree`).toBe(false);
    }
  });

  it("(b) even a malformed input produces a typed invalid_input denial WITH audit evidence", () => {
    const malformed = { itemId: "", tenantScope: TENANT, policyRef: "p" } as unknown as IndependenceCheckInput;
    const result = enforceIndependence(malformed);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denyReason).toBe("invalid_input");
    expect(result.audit.eventKind).toBe("independence_denied");
  });
});

describe("§27 behavior — audit/query-surface.contract (tenant-bound read envelope)", () => {
  const envelope = {
    tenantId: TENANT,
    actorRef: "actor-1",
    purpose: "h3-087 §27 posture verification read",
    timeWindow: { fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-10-02T00:00:00.000Z" },
    filters: {},
    pagination: { limit: 50 },
  };

  const record = {
    tenantId: TENANT,
    actorRef: "actor-1",
    action: "command.execute",
    tableName: "cg_event",
    recordId: null,
    occurredAt: "2026-10-01T12:00:00.000Z",
  };

  it("(a) the envelope is tenant-bound and actor-scoped: missing context never parses", () => {
    const missingTenant = { ...envelope, tenantId: undefined };
    expect(parseAuditQueryEnvelope(missingTenant).ok).toBe(false);

    const missingActor = { ...envelope, actorRef: undefined };
    expect(parseAuditQueryEnvelope(missingActor).ok).toBe(false);

    const unboundedPage = { ...envelope, pagination: undefined };
    expect(parseAuditQueryEnvelope(unboundedPage).ok).toBe(false);
  });

  it("(a) there is no representable multi-tenant or wildcard scope: unknown keys are parse failures", () => {
    const widened = { ...envelope, tenantIds: [TENANT, OTHER_TENANT] };
    const result = parseAuditQueryEnvelope(widened);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/tenantIds|unrecognized|invalid/i);
    }
  });

  it("(b) unbounded windows and pages are refused (no unbounded audit reads)", () => {
    const tooWide = parseAuditQueryEnvelope({
      ...envelope,
      timeWindow: { fromIso: "2026-01-01T00:00:00.000Z", toIso: "2027-01-01T00:00:00.000Z" },
    });
    expect(tooWide.ok).toBe(false);

    const unordered = parseAuditQueryEnvelope({
      ...envelope,
      timeWindow: { fromIso: "2026-10-02T00:00:00.000Z", toIso: "2026-10-01T00:00:00.000Z" },
    });
    expect(unordered.ok).toBe(false);

    const overLimit = parseAuditQueryEnvelope({ ...envelope, pagination: { limit: 10_000 } });
    expect(overLimit.ok).toBe(false);

    const zeroLimit = parseAuditQueryEnvelope({ ...envelope, pagination: { limit: 0 } });
    expect(zeroLimit.ok).toBe(false);
  });

  it("(b)+(d) pages are refused when any record falls outside the envelope tenant; pages are frozen", () => {
    const ok = parseAuditPage({ records: [record], nextCursor: null, hasMore: false }, envelope);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(Object.isFrozen(ok.page)).toBe(true);
      expect(Object.isFrozen(ok.page.records)).toBe(true);
    }

    const foreign = parseAuditPage(
      { records: [{ ...record, tenantId: OTHER_TENANT }], nextCursor: null, hasMore: false },
      envelope,
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.code).toBe("cross_tenant_record_refused");
    }
  });
});

describe("§27 behavior — ai-gateway/egress-allowlist (deny-by-default gateway egress)", () => {
  const now = () => "2026-10-03T00:00:00.000Z";

  it("(b) an empty allowlist denies every endpoint; unregistered endpoints are typed denials", () => {
    const empty = new EgressAllowlist({ now });
    const denied = empty.decide({ url: "https://api.provider.example/v1", providerClass: "llm" });
    expect(denied.verdict).toBe("deny");
    expect(denied.verdict === "deny" && denied.code).toBe("unregistered_endpoint");
    expect(empty.auditLog().length).toBe(1);
  });

  it("(b) scheme, credentials, binding, path and method mismatches all fail closed", () => {
    const allowlist = new EgressAllowlist({
      now,
      bindings: [{ providerClass: "llm", endpoint: "https://api.provider.example/v1", methods: ["POST"] }],
    });
    const deny = (url: string, providerClass = "llm", method?: string) =>
      allowlist.decide({ url, providerClass, ...(method ? { method } : {}) });

    expect(deny("http://api.provider.example/v1").verdict === "deny").toBe(true);
    expect(deny("https://user:pass@api.provider.example/v1").verdict === "deny").toBe(true);

    const foreign = deny("https://api.provider.example/v1", "other-class", "POST");
    expect(foreign.verdict === "deny" && foreign.code).toBe("endpoint_not_bound_to_provider");

    expect(
      (deny("https://api.provider.example/other/path", "llm", "POST") as { code?: string }).code,
    ).toBe("path_not_permitted");
    expect(
      (deny("https://api.provider.example/v1", "llm", "DELETE") as { code?: string }).code,
    ).toBe("method_not_permitted");

    const allowed = deny("https://api.provider.example/v1/chat", "llm", "POST");
    expect(allowed.verdict).toBe("allow");
  });

  it("(c)+(d) audit records are secret-free projections: no query strings, no bodies", () => {
    const allowlist = new EgressAllowlist({
      now,
      bindings: [{ providerClass: "llm", endpoint: "https://api.provider.example/v1", methods: ["POST"] }],
    });
    const decision = allowlist.decide({
      url: "https://api.provider.example/v1/chat?api_key=fixture-secret-value",
      method: "POST",
      providerClass: "llm",
    });
    expect(decision.verdict).toBe("allow");
    expect(decision.verdict === "allow" && decision.path).toBe("/v1/chat");

    for (const entry of allowlist.auditLog()) {
      const serialized = JSON.stringify(entry);
      expect(serialized, "audit must never carry query material (§29)").not.toContain("api_key");
      expect(serialized).not.toContain("fixture-secret-value");
    }
  });

  it("(b) a deny decision never touches the transport; a broken clock denies with invalid_clock", async () => {
    const allowlist = new EgressAllowlist({
      now,
      bindings: [{ providerClass: "llm", endpoint: "https://api.provider.example/v1" }],
    });

    let transportCalls = 0;
    const outcome = allowlist.guardedFetch(
      { url: "https://unregistered.example.net/v1", providerClass: "llm" },
      async () => {
        transportCalls += 1;
        return {};
      },
    );
    const blocked = await outcome;
    expect(blocked.verdict).toBe("blocked");
    expect(transportCalls).toBe(0);

    let instant = "2026-10-03T00:00:00.000Z";
    const drifting = new EgressAllowlist({
      now: () => instant,
      bindings: [{ providerClass: "llm", endpoint: "https://api.provider.example/v1" }],
    });
    instant = "not-an-instant";
    const denied = drifting.decide({ url: "https://api.provider.example/v1", providerClass: "llm" });
    expect(denied.verdict).toBe("deny");
    expect(denied.verdict === "deny" && denied.code).toBe("invalid_clock");
  });
});
