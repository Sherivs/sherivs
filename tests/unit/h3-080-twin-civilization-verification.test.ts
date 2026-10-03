/**
 * CoreGrid — H3-080 phase-46 twin-civilization ADVERSARIAL VERIFICATION
 * (mission G-080, Squad G verifier role). Read-only adversarial suite
 * against the completed contract module
 * `frontend/src/lib/twin-civilization/contracts.ts` (landed by G-066).
 * This suite does NOT duplicate H3-066's contract tests: it attacks the
 * module the way an adversary would — grant escalation, authority forgery,
 * agreement replay across field-path renames, revocation resurrection,
 * cross-tenant smuggling, unredacted restricted data, and payload leakage
 * against the digest-only law. The module is imported READ-ONLY and is
 * never modified. Every attack must be contained with a typed denial;
 * attacks that succeed are pinned here as FINDING evidence and reported
 * to progress/h3-wave/H3-080.report.md (module is never patched by this
 * verifier).
 *
 * Pure offline: no network, no database, no secrets, no git.
 */
import { describe, expect, it } from "vitest";
import {
  FEDERATION_STATES,
  FEDERATION_TRANSITIONS,
  TWIN_PRESENCE_GRANTS,
  evaluateTwinDataAccessRequest,
  federationGate,
  parseFederationAgreement,
  parseSharedStateEnvelope,
  parseTwinRelationship,
  type FederationAgreement,
  type FederationState,
} from "../../frontend/src/lib/twin-civilization/contracts";

const NOW = "2026-10-03T00:00:00.000Z";
const LATER = "2027-10-03T00:00:00.000Z";
const DIGEST = "a".repeat(64);
const DECLARED_PATH = "state.metrics.load";

const PROVENANCE = {
  actorId: "agent:federation-worker-1",
  actorKind: "agent" as const,
  tenantId: "tenant_a",
  policyRef: "policy:federation-v1",
  traceId: "trace:fed-1",
  recordedAt: NOW,
};

type Fixture = Record<string, unknown>;

function twinRef(overrides: Fixture = {}, tenantId = "tenant_a"): Fixture {
  return {
    twinId: `twin:${tenantId}-1`,
    twinKind: "entity",
    ownerRef: "owner:org-1",
    homeTenantId: tenantId,
    currentStateDigest: DIGEST,
    historyRef: "history:twin-1",
    capabilities: ["capability:mirror-state"],
    policyRefs: ["policy:twin-governance-v1"],
    recordedAt: NOW,
    ...overrides,
  };
}

function agreementFixture(overrides: Fixture = {}): Fixture {
  return {
    agreementId: "fed:agreement-1",
    initiator: twinRef({}, "tenant_a"),
    counterparty: twinRef({ twinId: "twin:tenant_b-1" }, "tenant_b"),
    state: "PROPOSED",
    accessGrant: "none",
    sharedFieldPaths: [DECLARED_PATH],
    classification: "internal",
    effectiveFrom: NOW,
    expiresAt: LATER,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function envelopeFixture(overrides: Fixture = {}): Fixture {
  return {
    envelopeId: "env:1",
    agreementId: "fed:agreement-1",
    fieldPath: DECLARED_PATH,
    classification: "internal",
    redacted: false,
    payloadDigest: DIGEST,
    sourceTenantId: "tenant_a",
    destinationTenantId: "tenant_b",
    authority: "mirror",
    provenance: PROVENANCE,
    exchangedAt: NOW,
    ...overrides,
  };
}

function relationshipFixture(overrides: Fixture = {}): Fixture {
  return {
    relationshipId: "rel:1",
    agreementId: "fed:agreement-1",
    fromTwinId: "twin:tenant_a-1",
    toTwinId: "twin:tenant_b-1",
    kind: "federates_with",
    fromTenantId: "tenant_a",
    toTenantId: "tenant_b",
    confidence: { value: 0.8, derivedFrom: ["evidence_quality"], method: "policy-weighted" },
    provenance: PROVENANCE,
    mappedAt: NOW,
    ...overrides,
  };
}

function parsedAgreement(overrides: Fixture = {}): FederationAgreement {
  const parsed = parseFederationAgreement(agreementFixture(overrides));
  if (!parsed.ok) throw new Error(`fixture refused: ${parsed.reason}`);
  return parsed.value;
}

function activeAgreement(): FederationAgreement {
  return parsedAgreement({
    state: "ACTIVE",
    approvalRef: "approval:fed-1",
    sharedFieldPaths: [DECLARED_PATH],
  });
}

/* ─────────────────────────────────────────────────────────────
 * 1. accessGrant escalation — twin presence must never imply a grant
 * ────────────────────────────────────────────────────────────*/
describe("G-080: accessGrant escalation attempts", () => {
  it("refuses every forged grant value with a typed shape failure", () => {
    for (const forged of ["full", "read", "write", "admin", "none ", "None", "NONE", true, 1, null, ["none"]]) {
      const parsed = parseFederationAgreement(agreementFixture({ accessGrant: forged }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
    }
  });

  it("refuses an agreement whose accessGrant literal is stripped or replaced in transit", () => {
    const stripped = agreementFixture();
    delete stripped.accessGrant;
    expect(parseFederationAgreement(stripped).ok).toBe(false);
    const replaced = agreementFixture({ accessGrant: "none", extra: { grant: "escalated" } });
    const parsed = parseFederationAgreement(replaced);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("cannot be promoted to a grant even by a caller who forges the parsed artifact", () => {
    // A misbehaving caller bypasses the parser and fabricates an ACTIVE,
    // grant-bearing agreement. The gate may permit in-scope mirror exchange,
    // but the ONLY function that maps twin data to an access outcome still
    // refuses, and the set of grants derivable from twin presence stays empty.
    const forged = agreementFixture({
      accessGrant: "full",
      state: "ACTIVE",
      approvalRef: "approval:forged",
    }) as unknown as FederationAgreement;
    const gateResult = federationGate({
      action: "exchange_state",
      agreement: forged,
      fieldPath: DECLARED_PATH,
      now: NOW,
    });
    expect(gateResult.decision).toBe("ALLOW"); // mirror exchange only — not an access grant

    const verdict = evaluateTwinDataAccessRequest({
      twinId: "twin:tenant_b-1",
      requestedAction: "read",
      claimedTenantId: "tenant_b",
    });
    const grantedFlag: false = verdict.granted;
    expect(grantedFlag).toBe(false);
    expect(verdict.reason).toBe("TWIN_PRESENCE_IS_NOT_A_GRANT");
    const grants: readonly [] = TWIN_PRESENCE_GRANTS;
    expect(grants).toHaveLength(0);
  });

  it("refuses escalation via privileged twin capabilities or claimed tenancy", () => {
    const privileged = parsedAgreement({
      state: "ACTIVE",
      approvalRef: "approval:fed-1",
      initiator: twinRef({ capabilities: ["admin:escalate", "role:superuser"] }, "tenant_a"),
    });
    for (const claimed of [undefined, "tenant_a", "tenant_b", "*"]) {
      const attempt: { twinId: string; requestedAction: string; claimedTenantId?: string } = {
        twinId: privileged.initiator.twinId,
        requestedAction: "admin:escalate",
      };
      if (claimed !== undefined) attempt.claimedTenantId = claimed;
      const verdict = evaluateTwinDataAccessRequest(attempt);
      expect(verdict.granted).toBe(false);
      expect(verdict.reason).toBe("TWIN_PRESENCE_IS_NOT_A_GRANT");
    }
  });

  it("denies forged or case-mangled gate actions — the gate speaks only its vocabulary", () => {
    const active = activeAgreement();
    for (const action of ["grant_access", "issue_grant", "promote_envelope", "EXCHANGE_STATE", "exchange_state ", " exchange_state"]) {
      const denied = federationGate({ action, agreement: active, now: NOW });
      expect(denied.decision).toBe("DENY");
      if (denied.decision === "DENY") expect(denied.reason).toMatch(/unknown federation action/i);
    }
  });

  it("exposes no grant-issuing function on the module surface", async () => {
    const mod = await import("../../frontend/src/lib/twin-civilization/contracts");
    const fns = Object.entries(mod)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(fns).toEqual([
      "evaluateTwinDataAccessRequest",
      "federationGate",
      "isFederationTransitionAllowed",
      "isFieldPathInScope",
      "parseFederationAgreement",
      "parseSharedStateEnvelope",
      "parseTwinRelationship",
    ]);
    expect(fns.filter((name) => /grant/i.test(name) && name !== "evaluateTwinDataAccessRequest")).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. authority-mirror forgery
 * ────────────────────────────────────────────────────────────*/
describe("G-080: authority-mirror forgery attempts", () => {
  it("refuses every forged authority value with a typed shape failure", () => {
    for (const forged of ["grant", "owner", "write", "act", "Mirror", "MIRROR", "mirror ", true, 0]) {
      const parsed = parseSharedStateEnvelope(envelopeFixture({ authority: forged }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
    }
  });

  it("refuses an envelope whose authority literal is stripped", () => {
    const stripped = envelopeFixture();
    delete stripped.authority;
    const parsed = parseSharedStateEnvelope(stripped);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("contains prototype-pollution smuggling via a __proto__ own key — no pollution, clean output (KNOWN RISK: strict refusal is evaded)", () => {
    // zod strictObject silently strips a __proto__ own key instead of refusing
    // it with invalid_shape. The harmful effect is still contained: nothing
    // pollutes, and the parsed artifact carries none of the smuggled bytes.
    const smuggled: unknown = JSON.parse(
      JSON.stringify(envelopeFixture()).replace(/^(\{)/, '$1"__proto__":{"polluted":true},'),
    );
    const parsed = parseSharedStateEnvelope(smuggled);
    expect(parsed.ok).toBe(true); // strict refusal evaded — see report KNOWN RISK KR-3
    if (parsed.ok) {
      expect(Object.getPrototypeOf(parsed.value)).toBe(Object.prototype);
      expect(Object.getOwnPropertyNames(parsed.value)).not.toContain("__proto__");
      expect(JSON.stringify(parsed.value)).not.toContain("polluted");
    }
    const victim: Record<string, unknown> = {};
    expect(victim.polluted).toBeUndefined(); // no global prototype pollution
  });

  it("cannot launder a forged authority through a parsed envelope", () => {
    // Mutate a legitimately parsed envelope, then present it as fresh
    // untrusted input: the mutation is refused by the parser, and no
    // function on the surface accepts an envelope and returns a decision.
    const parsed = parseSharedStateEnvelope(envelopeFixture());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const mutated = parsed.value as unknown as Fixture;
      mutated.authority = "grant";
      const reparsed = parseSharedStateEnvelope(mutated);
      expect(reparsed.ok).toBe(false);
      if (!reparsed.ok) expect(reparsed.reason).toBe("invalid_shape");
    }
    const verdict = evaluateTwinDataAccessRequest({ twinId: "twin:tenant_a-1", requestedAction: "act_on_mirror" });
    expect(verdict.granted).toBe(false);
    const grants: readonly [] = TWIN_PRESENCE_GRANTS;
    expect(grants).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. agreement replay across field-path renames
 * ────────────────────────────────────────────────────────────*/
describe("G-080: agreement replay across field-path renames", () => {
  it("denies every rename variant of a declared path — the allowlist is exact", () => {
    const active = activeAgreement();
    for (const renamed of [
      "state.metrics.load_avg",
      "state.metrics.loadAvg",
      "state.metrics.load2",
      "state.metrics.load.avg",
      "state.metrics",
      "state",
      "state.metrics.loads",
      "STATE.METRICS.LOAD",
      "state.metrics.load.",
      " state.metrics.load",
      "state.metrics.load ",
      "",
    ]) {
      expect(isScope(active, renamed)).toBe(false);
      const denied = federationGate({
        action: "exchange_state",
        agreement: active,
        fieldPath: renamed,
        now: NOW,
      });
      expect(denied.decision).toBe("DENY");
    }
  });

  function isScope(agreement: FederationAgreement, path: string): boolean {
    return agreement.sharedFieldPaths.includes(path);
  }

  it("refuses unicode-homoglyph paths at the schema — no look-alike sneaks into scope", () => {
    const homoglyph = "state.metrics.lo\u0430d"; // Cyrillic 'а' inside "load"
    const active = activeAgreement();
    expect(isScope(active, homoglyph)).toBe(false);
    const envelope = envelopeFixture({ fieldPath: homoglyph });
    const parsed = parseSharedStateEnvelope(envelope);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("invalid_shape");
      expect(parsed.issues.some((issue) => issue.path === "fieldPath")).toBe(true);
    }
  });

  it("denies replay of an expired agreement even with a renamed path — the window precedes scope", () => {
    const active = activeAgreement();
    const denied = federationGate({
      action: "exchange_state",
      agreement: active,
      fieldPath: "state.metrics.load_replayed",
      now: LATER,
    });
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/expired/i);
  });

  it("denies replay against a PROPOSED agreement even with stolen authorization evidence", () => {
    const proposed = parsedAgreement({ approvalRef: "approval:stolen-from-approved" });
    const denied = federationGate({
      action: "exchange_state",
      agreement: proposed,
      fieldPath: DECLARED_PATH,
      now: NOW,
    });
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/PROPOSED/);
  });

  it("FINDING F1a: two agreements sharing one agreementId with divergent scopes both parse — the surface performs no cross-artifact replay binding", () => {
    const original = parseFederationAgreement(agreementFixture({ state: "ACTIVE", approvalRef: "approval:fed-1" }));
    const replayed = parseFederationAgreement(
      agreementFixture({
        state: "ACTIVE",
        approvalRef: "approval:fed-1",
        sharedFieldPaths: ["state.metrics.load_renamed"],
      }),
    );
    expect(original.ok).toBe(true);
    expect(replayed.ok).toBe(true); // FINDING: replay of the agreementId is not detected
    if (original.ok && replayed.ok) {
      // Containment that still holds: each gate evaluation honors only its
      // own artifact's scope — the renamed path never bleeds into the original.
      expect(
        federationGate({ action: "exchange_state", agreement: original.value, fieldPath: "state.metrics.load_renamed", now: NOW }).decision,
      ).toBe("DENY");
      expect(
        federationGate({ action: "exchange_state", agreement: replayed.value, fieldPath: DECLARED_PATH, now: NOW }).decision,
      ).toBe("DENY");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. terminal-revocation resurrection attempts
 * ────────────────────────────────────────────────────────────*/
describe("G-080: terminal-revocation resurrection attempts", () => {
  it("refuses every transition out of REVOKED across the full matrix", () => {
    for (const to of FEDERATION_STATES) {
      expect(FEDERATION_TRANSITIONS.REVOKED.includes(to)).toBe(false);
    }
    expect(FEDERATION_TRANSITIONS.REVOKED).toEqual([]);
    // Sanity: every other state can still reach REVOKED (severing stays easy).
    for (const from of FEDERATION_STATES.filter((state) => state !== "REVOKED")) {
      expect(FEDERATION_TRANSITIONS[from].includes("REVOKED")).toBe(true);
    }
  });

  it("has no reachable state from REVOKED in the transitive closure — resurrection is unreachable", () => {
    const reachable = (from: FederationState): Set<FederationState> => {
      const seen = new Set<FederationState>();
      const stack = [...FEDERATION_TRANSITIONS[from]];
      while (stack.length > 0) {
        const state = stack.pop() as FederationState;
        if (seen.has(state)) continue;
        seen.add(state);
        stack.push(...FEDERATION_TRANSITIONS[state]);
      }
      return seen;
    };
    expect(reachable("REVOKED").size).toBe(0);
    // Sanity: other states remain live (containment is surgical, not total).
    expect(reachable("PROPOSED").has("ACTIVE")).toBe(true);
    expect(reachable("APPROVED").has("ACTIVE")).toBe(true);
  });

  it("denies exchange on a revoked agreement — even with evidence, in-scope path and a live window", () => {
    const revoked = parsedAgreement({
      state: "REVOKED",
      approvalRef: "approval:fed-1",
      sharedFieldPaths: [DECLARED_PATH],
    });
    const denied = federationGate({
      action: "exchange_state",
      agreement: revoked,
      fieldPath: DECLARED_PATH,
      approvalRef: "approval:resurrection",
      now: NOW,
    });
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/REVOKED/);
  });

  it("contains resurrection-by-re-proposal: a fresh artifact cannot exchange without the full governed path", () => {
    // Stateless surface: a brand-new agreementId for the same parties parses
    // as a NEW proposal (this is re-approval, not resurrection of the revoked
    // artifact). Even carrying the old approval evidence it cannot exchange.
    const reproposal = parsedAgreement({
      agreementId: "fed:agreement-2",
      state: "PROPOSED",
      approvalRef: "approval:fed-1",
    });
    const denied = federationGate({
      action: "exchange_state",
      agreement: reproposal,
      fieldPath: DECLARED_PATH,
      now: NOW,
    });
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/PROPOSED/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. cross-tenant pairing / transfer smuggling
 * ────────────────────────────────────────────────────────────*/
describe("G-080: cross-tenant pairing and transfer smuggling", () => {
  it("refuses a same-tenant pairing — including the swap attack", () => {
    const parsed = parseFederationAgreement(
      agreementFixture({ counterparty: twinRef({ twinId: "twin:tenant_b-1", homeTenantId: "tenant_a" }, "tenant_a") }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("not_a_federation");
      expect(parsed.issues[0].path).toBe("counterparty.homeTenantId");
    }
  });

  it("refuses same-tenant envelope transfers in both directions", () => {
    for (const transfer of [
      { destinationTenantId: "tenant_a" },
      { sourceTenantId: "tenant_b" },
      { sourceTenantId: "tenant_x", destinationTenantId: "tenant_x" },
    ]) {
      const parsed = parseSharedStateEnvelope(envelopeFixture(transfer));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("cross_tenant_violation");
    }
  });

  it("FINDING F1b: a third-tenant envelope smuggled under a valid agreementId parses — tenant binding is not enforced by the surface", () => {
    // The agreement binds tenant_a ↔ tenant_b, but the envelope claims
    // tenant_x → tenant_y and still attributes itself to that agreement.
    const smuggled = parseSharedStateEnvelope(
      envelopeFixture({ sourceTenantId: "tenant_x", destinationTenantId: "tenant_y" }),
    );
    expect(smuggled.ok).toBe(true); // FINDING: parse succeeds — no agreement-aware validation
    if (smuggled.ok) {
      expect(smuggled.value.agreementId).toBe("fed:agreement-1");
      expect(smuggled.value.sourceTenantId).toBe("tenant_x");
    }
    // Containment that holds: the gate never consumes envelope tenants, so a
    // smuggled envelope still cannot widen the agreement's own scope.
    const active = activeAgreement();
    expect(
      federationGate({ action: "exchange_state", agreement: active, fieldPath: DECLARED_PATH, now: NOW }).decision,
    ).toBe("ALLOW");
    expect(
      federationGate({ action: "exchange_state", agreement: active, fieldPath: "tenant_x.secrets.raw", now: NOW }).decision,
    ).toBe("DENY");
  });

  it("FINDING F1c: a same-tenant relationship attributed to a cross-tenant agreement parses", () => {
    const smuggled = parseTwinRelationship(
      relationshipFixture({ fromTenantId: "tenant_c", toTenantId: "tenant_c" }),
    );
    expect(smuggled.ok).toBe(true); // FINDING: no cross-tenant invariant on relationships
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. restricted data without redaction
 * ────────────────────────────────────────────────────────────*/
describe("G-080: restricted-data-without-redaction attempts", () => {
  it("refuses an unredacted restricted envelope with the typed redaction_violation", () => {
    const parsed = parseSharedStateEnvelope(
      envelopeFixture({ classification: "restricted", redacted: false }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("redaction_violation");
      expect(parsed.issues[0].path).toBe("redacted");
      expect(parsed.issues[0].message).toMatch(/redacted before exchange/i);
    }
  });

  it("refuses case-mangled classification re-spellings — no near-miss evades the redaction rule", () => {
    for (const classification of ["Restricted", "RESTRICTED", "restrict ed", "restricted "]) {
      const parsed = parseSharedStateEnvelope(
        envelopeFixture({ classification, redacted: false }),
      );
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
    }
  });

  it("admits a properly redacted restricted envelope — containment is surgical", () => {
    const parsed = parseSharedStateEnvelope(
      envelopeFixture({ classification: "restricted", redacted: true }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("KNOWN RISK (documented, not fixed): the redaction demand keys on the sender-declared classification — a restricted payload mislabeled internal parses", () => {
    // The surface cannot verify the true classification of a payload; the
    // digest-only law still applies to whatever the sender declares. Recorded
    // as a known risk in the H3-080 report; downstream consumers must not
    // treat a parsed classification as ground truth.
    const mislabeled = parseSharedStateEnvelope(envelopeFixture({ classification: "internal" }));
    expect(mislabeled.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. payload leakage — the digest-only law
 * ────────────────────────────────────────────────────────────*/
describe("G-080: payload leakage attempts (digest-only law)", () => {
  const PAYLOAD = JSON.stringify({ secretField: "the mirrored content itself" });

  it("refuses payloads inlined under every candidate value key — the strict surface has no side doors", () => {
    for (const key of ["payload", "data", "content", "value", "body", "state", "blob", "contentBytes"]) {
      const parsed = parseSharedStateEnvelope(envelopeFixture({ [key]: PAYLOAD }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
    }
  });

  it("refuses payload-shaped digests — uppercase hex, short hex, JSON, objects", () => {
    for (const forgedDigest of ["A".repeat(64), "a".repeat(63), JSON.stringify({ payload: 1 }), { digest: DIGEST }, `${DIGEST}${DIGEST}`]) {
      const parsed = parseSharedStateEnvelope(envelopeFixture({ payloadDigest: forgedDigest }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
    }
  });

  it("refuses payloads inlined into bounded reference fields", () => {
    for (const key of ["fieldPath", "envelopeId", "agreementId"] as const) {
      const parsed = parseSharedStateEnvelope(envelopeFixture({ [key]: PAYLOAD }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
    }
    const oversizedActor = parseSharedStateEnvelope(
      envelopeFixture({
        provenance: { ...PROVENANCE, actorId: `agent:${PAYLOAD}` },
      }),
    );
    expect(oversizedActor.ok).toBe(false);
  });

  it("FINDING F2: payloads inlined into unbounded free-text fields (provenance.policyRef, confidence.method) parse cleanly — digest-only minimization is bypassable", () => {
    // FINDING: nonEmptyString fields have no maximum length, so an untrusted
    // sender can ride the payload inside provenance.policyRef.
    const leaked = parseSharedStateEnvelope(
      envelopeFixture({ provenance: { ...PROVENANCE, policyRef: PAYLOAD } }),
    );
    expect(leaked.ok).toBe(true); // FINDING: the leak parses — see H3-080 report F2
    if (leaked.ok) {
      const provenance = leaked.value.provenance;
      expect(provenance.policyRef.length).toBeGreaterThan(0);
      expect(provenance.policyRef).toContain("secretField");
    }
    // Same channel on relationships via confidence.method.
    const relationshipLeak = parseTwinRelationship(
      relationshipFixture({
        confidence: { value: 0.5, derivedFrom: ["agreement"], method: PAYLOAD },
      }),
    );
    expect(relationshipLeak.ok).toBe(true); // FINDING: the leak parses — see H3-080 report F2
    if (relationshipLeak.ok) {
      expect(relationshipLeak.value.confidence.method).toContain("secretField");
    }
  });

  it("FINDING F2 scope check: identifier-bounded provenance fields refuse the same payload — only the nonEmptyString fields leak", () => {
    for (const provenance of [
      { ...PROVENANCE, traceId: `trace:${PAYLOAD}` },
      { ...PROVENANCE, tenantId: PAYLOAD },
      { ...PROVENANCE, actorId: PAYLOAD },
    ]) {
      expect(parseSharedStateEnvelope(envelopeFixture({ provenance })).ok).toBe(false);
    }
  });
});
