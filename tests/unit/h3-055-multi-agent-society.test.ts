/**
 * CoreGrid — H3-055 phase-35 multi-agent society contract tests
 * (Squad G mission G-055, Contract Architect).
 *
 * Proves the fail-closed surface of `frontend/src/lib/multi-agent-society/
 * contracts.ts`: societies parse fail-closed, activate only on explicit
 * approval, hold exactly the intersection of their members' grants (authority
 * may shrink, never widen), coordinate only between attributable usable
 * members in the active state, resolve collective decisions without
 * manufacturing agreement from silence, keep collective output untrusted
 * until a participating member approves it, suspend as a unit or per member
 * without collateral, and keep a fully attributed append-only audit trail.
 *
 * Pure offline: no network, no database, no secrets, no wall-clock reads.
 */
import { describe, expect, it } from "vitest";
import {
  applySocietySuspension,
  effectiveMemberGrants,
  evaluateCollectiveAction,
  evaluateCoordination,
  isSocietyOperational,
  parseSocietyAuditTrail,
  parseSocietyDefinition,
  participatingMembers,
  registerCollectiveOutput,
  resolveCollectiveDecision,
  societyAuthorityIntersection,
  transitionSociety,
  validateCollectiveOutput,
  type ActionRef,
  type CollectiveDecision,
  type CoordinationMessage,
  type SocietyAuditEntry,
  type SocietyDefinition,
  type SocietyMember,
  type SocietyLifecycleState,
} from "../../frontend/src/lib/multi-agent-society/contracts";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (neutral vocabulary only)
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant_alpha";
const SOCIETY_REF = "society_alpha_01";

function member(overrides: Partial<SocietyMember> = {}): SocietyMember {
  return {
    memberRef: "actor_1",
    identityLifecycle: "active",
    role: "participant",
    grants: [],
    ...overrides,
  };
}

function society(overrides: Partial<SocietyDefinition> = {}): SocietyDefinition {
  return {
    societyRef: SOCIETY_REF,
    tenantRef: TENANT_A,
    purpose: "coordinate governed work between bounded actors",
    members: [
      member({ memberRef: "actor_1", grants: ["act.read"] as ActionRef[] }),
      member({ memberRef: "actor_2", grants: ["act.read", "act.write"] as ActionRef[] }),
    ],
    provenance: {
      declaredBy: "role:contract-architect",
      declaredAt: "2026-10-03T00:00:00.000Z",
      authority: "H3 wave mission G-055",
    },
    ...overrides,
  };
}

const ACTIVE: SocietyLifecycleState = "active";

function message(overrides: Partial<CoordinationMessage> = {}): CoordinationMessage {
  return {
    societyRef: SOCIETY_REF,
    fromRef: "actor_1",
    toRef: "actor_2",
    kind: "request",
    purpose: "align on bounded coordination step",
    correlationRef: "corr_01",
    ...overrides,
  };
}

function decision(overrides: Partial<CollectiveDecision> = {}): CollectiveDecision {
  return {
    societyRef: SOCIETY_REF,
    topic: "adopt a coordination rule",
    rule: "unanimous",
    ballot: [
      { voterRef: "actor_1", choice: "affirm", rationale: "bounded and attributable" },
      { voterRef: "actor_2", choice: "affirm", rationale: "bounded and attributable" },
    ],
    ...overrides,
  };
}

function entry(overrides: Partial<SocietyAuditEntry> = {}): SocietyAuditEntry {
  return {
    entryId: "entry_1",
    societyRef: SOCIETY_REF,
    kind: "coordination",
    attributedTo: ["actor_1", "actor_2"],
    summary: "coordination step attributed to both endpoints",
    ...overrides,
  };
}

function expectOk<T extends { ok: boolean }>(result: T): void {
  if (!result.ok) throw new Error(`expected ok, got deny: ${JSON.stringify(result)}`);
}

/* ─────────────────────────────────────────────────────────────
 * Society definition parsing (fail closed)
 * ────────────────────────────────────────────────────────────*/

describe("society definition parsing", () => {
  it("accepts a valid tenant-scoped society definition", () => {
    const parsed = parseSocietyDefinition(society());
    expectOk(parsed);
    if (parsed.ok) expect(parsed.society.members).toHaveLength(2);
  });

  it("denies a one-member society — a single-agent structure duplicates the agent runtime", () => {
    const parsed = parseSocietyDefinition(society({ members: [member()] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("denies an unbounded oversized membership", () => {
    const many = Array.from({ length: 1_025 }, (_, index) =>
      member({ memberRef: `actor_${index}` }),
    );
    const parsed = parseSocietyDefinition(society({ members: many }));
    expect(parsed.ok).toBe(false);
  });

  it("denies duplicate members — one actor holds exactly one seat", () => {
    const parsed = parseSocietyDefinition(
      society({
        members: [
          member({ memberRef: "actor_1", grants: ["act.read"] as ActionRef[] }),
          member({ memberRef: "actor_1", grants: [] }),
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("cross_record_invariant");
  });

  it("denies blank or whitespace-padded refs", () => {
    expect(parseSocietyDefinition(society({ societyRef: "  " })).ok).toBe(false);
    expect(parseSocietyDefinition(society({ tenantRef: " tenant_alpha " })).ok).toBe(false);
  });

  it("denies unknown fields on a member (strict shape, no smuggled authority)", () => {
    const smuggled = {
      ...society(),
      members: [
        { ...member(), tenantRef: "tenant_other" },
        member({ memberRef: "actor_2" }),
      ],
    };
    expect(parseSocietyDefinition(smuggled).ok).toBe(false);
  });

  it("denies unknown fields at the root of the definition", () => {
    expect(parseSocietyDefinition({ ...society(), tenantScope: "wider" }).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Lifecycle (approval-gated, fail closed)
 * ────────────────────────────────────────────────────────────*/

describe("society lifecycle", () => {
  it("activates a proposed society only with an explicit approval record", () => {
    const withoutApproval = transitionSociety("proposed", "active", null);
    expect(withoutApproval).toMatchObject({ ok: false, code: "approval_required" });
    const withApproval = transitionSociety("proposed", "active", {
      approvalRef: "approval_1",
      approvedBy: "human_owner",
    });
    expectOk(withApproval);
    if (withApproval.ok) expect(withApproval.state).toBe("active");
  });

  it("rejects a proposed society without approval (deny path is open, approval path is gated)", () => {
    expectOk(transitionSociety("proposed", "rejected", null));
  });

  it("suspends an active society without approval (containment must be instant)", () => {
    expectOk(transitionSociety("active", "suspended", null));
  });

  it("re-activates a suspended society only with approval", () => {
    const withoutApproval = transitionSociety("suspended", "active", null);
    expect(withoutApproval).toMatchObject({ ok: false, code: "approval_required" });
    expectOk(
      transitionSociety("suspended", "active", { approvalRef: "approval_2", approvedBy: "human_owner" }),
    );
  });

  it("dissolves only with approval and is terminal", () => {
    expect(transitionSociety("active", "dissolved", null)).toMatchObject({
      ok: false,
      code: "approval_required",
    });
    expectOk(
      transitionSociety("active", "dissolved", { approvalRef: "approval_3", approvedBy: "human_owner" }),
    );
    expect(transitionSociety("dissolved", "active", {
      approvalRef: "approval_4",
      approvedBy: "human_owner",
    })).toMatchObject({ ok: false, code: "transition_not_listed" });
  });

  it("denies unlisted transitions", () => {
    expect(transitionSociety("proposed", "suspended", null)).toMatchObject({
      ok: false,
      code: "transition_not_listed",
    });
    expect(transitionSociety("rejected", "active", null)).toMatchObject({
      ok: false,
      code: "transition_not_listed",
    });
  });

  it("treats only the active state as operational", () => {
    for (const state of ["proposed", "suspended", "dissolved", "rejected"] as const) {
      expect(isSocietyOperational(state)).toBe(false);
    }
    expect(isSocietyOperational("active")).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Intersection-of-grants authority
 * ────────────────────────────────────────────────────────────*/

describe("collective authority (intersection of grants)", () => {
  it("authorizes an action held by every member", () => {
    const result = evaluateCollectiveAction(society(), ACTIVE, "act.read" as ActionRef);
    expectOk(result);
  });

  it("denies an action not in the intersection and names every member lacking it", () => {
    const result = evaluateCollectiveAction(society(), ACTIVE, "act.write" as ActionRef);
    expect(result).toMatchObject({ ok: false, code: "action_not_in_intersection" });
    if (!result.ok) expect(result.missingFrom).toEqual(["actor_1"]);
  });

  it("denies any action when the intersection is empty — nothing is assumed", () => {
    const noGrants = society({
      members: [member({ grants: [] }), member({ grants: [] })],
    });
    expect(societyAuthorityIntersection(noGrants.members)).toEqual([]);
    expect(evaluateCollectiveAction(noGrants, ACTIVE, "act.read" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
  });

  it("computes the intersection as exactly the common grant set", () => {
    const members = [
      member({ memberRef: "actor_1", grants: ["act.a", "act.b"] as ActionRef[] }),
      member({ memberRef: "actor_2", grants: ["act.b", "act.c"] as ActionRef[] }),
      member({ memberRef: "actor_3", grants: ["act.b"] as ActionRef[] }),
    ];
    expect(societyAuthorityIntersection(members)).toEqual(["act.b"]);
  });

  it("collapses authority to nothing when any member's identity is unusable — suspension never widens", () => {
    const suspendedMember = society({
      members: [
        member({ memberRef: "actor_1", grants: ["act.read", "act.admin"] as ActionRef[] }),
        member({ memberRef: "actor_2", grants: ["act.read"] as ActionRef[], identityLifecycle: "suspended" }),
      ],
    });
    expect(effectiveMemberGrants(suspendedMember.members[1] as SocietyMember)).toEqual([]);
    expect(societyAuthorityIntersection(suspendedMember.members)).toEqual([]);
    expect(evaluateCollectiveAction(suspendedMember, ACTIVE, "act.read" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
    if (!evaluateCollectiveAction(suspendedMember, ACTIVE, "act.read" as ActionRef).ok) {
      const denied = evaluateCollectiveAction(suspendedMember, ACTIVE, "act.read" as ActionRef);
      if (!denied.ok) expect(denied.missingFrom).toEqual(["actor_2"]);
    }
  });

  it("denies collective actions outside the active state", () => {
    for (const state of ["proposed", "suspended", "dissolved", "rejected"] as const) {
      expect(evaluateCollectiveAction(society(), state, "act.read" as ActionRef)).toMatchObject({
        ok: false,
        code: "society_not_active",
      });
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Coordination (attribution + participation + operating state)
 * ────────────────────────────────────────────────────────────*/

describe("coordination evaluation", () => {
  it("allows coordination between participating members and attributes both endpoints", () => {
    const result = evaluateCoordination(society(), ACTIVE, message());
    expectOk(result);
    if (result.ok) expect(result.attributedTo).toEqual(["actor_1", "actor_2"]);
  });

  it("denies an unknown sender", () => {
    expect(evaluateCoordination(society(), ACTIVE, message({ fromRef: "actor_ghost" }))).toMatchObject({
      ok: false,
      code: "unknown_sender",
    });
  });

  it("denies an unknown recipient — coordination outside declared membership fails closed", () => {
    expect(evaluateCoordination(society(), ACTIVE, message({ toRef: "actor_ghost" }))).toMatchObject({
      ok: false,
      code: "unknown_recipient",
    });
  });

  it("denies coordination from a member whose identity is unusable", () => {
    const mixed = society({
      members: [
        member({ memberRef: "actor_1", identityLifecycle: "suspended" }),
        member({ memberRef: "actor_2" }),
      ],
    });
    expect(evaluateCoordination(mixed, ACTIVE, message())).toMatchObject({
      ok: false,
      code: "sender_not_participating",
    });
    expect(evaluateCoordination(mixed, ACTIVE, message({ fromRef: "actor_2", toRef: "actor_1" }))).toMatchObject({
      ok: false,
      code: "recipient_not_participating",
    });
  });

  it("denies coordination outside the active state", () => {
    expect(evaluateCoordination(society(), "suspended", message())).toMatchObject({
      ok: false,
      code: "society_not_active",
    });
  });

  it("denies a message aimed at a different society", () => {
    expect(evaluateCoordination(society(), ACTIVE, message({ societyRef: "society_other" }))).toMatchObject({
      ok: false,
      code: "society_mismatch",
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Collective decision rules
 * ────────────────────────────────────────────────────────────*/

describe("collective decision resolution", () => {
  it("resolves a full unanimous ballot to agreement with total attribution", () => {
    const result = resolveCollectiveDecision(society(), ACTIVE, decision());
    expectOk(result);
    if (result.ok) {
      expect(result.verdict).toBe("agreed");
      expect(result.attributedTo).toEqual(["actor_1", "actor_2"]);
      expect(result.quorumFloor).toBe(2);
    }
  });

  it("breaks unanimity on silence — full participation is the unanimous default floor", () => {
    const three = society({
      members: [
        member({ memberRef: "actor_1" }),
        member({ memberRef: "actor_2" }),
        member({ memberRef: "actor_3" }),
      ],
    });
    const partial = resolveCollectiveDecision(
      three,
      ACTIVE,
      decision({ ballot: [decision().ballot[0] as CollectiveDecision["ballot"][number]] }),
    );
    expect(partial).toMatchObject({ ok: false, code: "quorum_below_floor" });
  });

  it("breaks unanimity on a single rejection or abstention", () => {
    const dissent = resolveCollectiveDecision(
      society(),
      ACTIVE,
      decision({
        ballot: [
          { voterRef: "actor_1", choice: "affirm", rationale: "yes" },
          { voterRef: "actor_2", choice: "reject", rationale: "no" },
        ],
      }),
    );
    expectOk(dissent);
    if (dissent.ok) expect(dissent.verdict).toBe("no_agreement");

    const abstain = resolveCollectiveDecision(
      society(),
      ACTIVE,
      decision({
        ballot: [
          { voterRef: "actor_1", choice: "affirm", rationale: "yes" },
          { voterRef: "actor_2", choice: "abstain", rationale: "unsure" },
        ],
      }),
    );
    expectOk(abstain);
    if (abstain.ok) expect(abstain.verdict).toBe("no_agreement");
  });

  it("denies an empty ballot — nothing decides nothing", () => {
    expect(resolveCollectiveDecision(society(), ACTIVE, decision({ ballot: [] }))).toMatchObject({
      ok: false,
      code: "empty_ballot",
    });
  });

  it("denies unknown voters and duplicate votes", () => {
    expect(
      resolveCollectiveDecision(
        society(),
        ACTIVE,
        decision({ ballot: [{ voterRef: "actor_ghost", choice: "affirm", rationale: "x" }] }),
      ),
    ).toMatchObject({ ok: false, code: "unknown_voter" });
    expect(
      resolveCollectiveDecision(
        society(),
        ACTIVE,
        decision({
          ballot: [
            { voterRef: "actor_1", choice: "affirm", rationale: "x" },
            { voterRef: "actor_1", choice: "affirm", rationale: "y" },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, code: "duplicate_vote" });
  });

  it("denies a declared quorum floor below half the participation", () => {
    const three = society({
      members: [
        member({ memberRef: "actor_1" }),
        member({ memberRef: "actor_2" }),
        member({ memberRef: "actor_3" }),
      ],
    });
    expect(resolveCollectiveDecision(three, ACTIVE, decision({ quorumFloor: 1 }))).toMatchObject({
      ok: false,
      code: "quorum_below_floor",
    });
    // At exactly half (ceil(3/2) = 2) the declared floor is legal.
    expectOk(resolveCollectiveDecision(three, ACTIVE, decision({ quorumFloor: 2 })));
  });

  it("resolves a majority with a tie to no agreement, and a real majority to agreement", () => {
    const three = society({
      members: [
        member({ memberRef: "actor_1" }),
        member({ memberRef: "actor_2" }),
        member({ memberRef: "actor_3" }),
      ],
    });
    const tie = resolveCollectiveDecision(
      three,
      ACTIVE,
      decision({
        rule: "majority",
        ballot: [
          { voterRef: "actor_1", choice: "affirm", rationale: "yes" },
          { voterRef: "actor_2", choice: "reject", rationale: "no" },
          { voterRef: "actor_3", choice: "abstain", rationale: "unsure" },
        ],
      }),
    );
    expectOk(tie);
    if (tie.ok) expect(tie.verdict).toBe("no_agreement");

    const majority = resolveCollectiveDecision(
      three,
      ACTIVE,
      decision({
        rule: "majority",
        ballot: [
          { voterRef: "actor_1", choice: "affirm", rationale: "yes" },
          { voterRef: "actor_2", choice: "affirm", rationale: "yes" },
          { voterRef: "actor_3", choice: "reject", rationale: "no" },
        ],
      }),
    );
    expectOk(majority);
    if (majority.ok) expect(majority.verdict).toBe("agreed");
  });

  it("excludes observers from the voting participation", () => {
    const withObserver = society({
      members: [
        member({ memberRef: "actor_1" }),
        member({ memberRef: "actor_2" }),
        member({ memberRef: "actor_watcher", role: "observer" }),
      ],
    });
    expect(participatingMembers(withObserver.members).map((m) => m.memberRef)).toEqual([
      "actor_1",
      "actor_2",
    ]);
    expect(
      resolveCollectiveDecision(
        withObserver,
        ACTIVE,
        decision({ ballot: [{ voterRef: "actor_watcher", choice: "affirm", rationale: "watching" }] }),
      ),
    ).toMatchObject({ ok: false, code: "unknown_voter" });
  });

  it("denies decisions outside the active state or aimed at another society", () => {
    expect(resolveCollectiveDecision(society(), "suspended", decision())).toMatchObject({
      ok: false,
      code: "society_not_active",
    });
    expect(
      resolveCollectiveDecision(society(), ACTIVE, decision({ societyRef: "society_other" })),
    ).toMatchObject({ ok: false, code: "society_mismatch" });
  });

  it("an agreed verdict never widens authority — decisions and grants are separate gates", () => {
    const agreed = resolveCollectiveDecision(society(), ACTIVE, decision());
    expectOk(agreed);
    // The society still cannot act on a grant outside the intersection,
    // even though the collective decision agreed unanimously.
    expect(evaluateCollectiveAction(society(), ACTIVE, "act.write" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Collective output trust
 * ────────────────────────────────────────────────────────────*/

describe("collective output trust", () => {
  const output = {
    outputRef: "output_1",
    societyRef: SOCIETY_REF,
    correlationRef: "corr_02",
    summary: "derived collective result",
  };

  it("registers output as unvalidated — untrusted by default", () => {
    const record = registerCollectiveOutput(output);
    expect(record.validation).toBe("unvalidated");
  });

  it("flips to trusted only on an approved verdict from a participating member", () => {
    const approved = validateCollectiveOutput(society(), {
      outputRef: "output_1",
      validatorRef: "actor_1",
      verdict: "approved",
      reason: "validated against declared bounds",
    });
    expectOk(approved);
    if (approved.ok) expect(approved.trusted).toBe(true);

    const rejected = validateCollectiveOutput(society(), {
      outputRef: "output_1",
      validatorRef: "actor_1",
      verdict: "rejected",
      reason: "outside declared bounds",
    });
    expectOk(rejected);
    if (rejected.ok) expect(rejected.trusted).toBe(false);
  });

  it("denies validation by an unknown or unusable member", () => {
    expect(
      validateCollectiveOutput(society(), {
        outputRef: "output_1",
        validatorRef: "actor_ghost",
        verdict: "approved",
        reason: "unattributed",
      }),
    ).toMatchObject({ ok: false, code: "unknown_validator" });

    const mixed = society({
      members: [
        member({ memberRef: "actor_1", identityLifecycle: "archived" }),
        member({ memberRef: "actor_2" }),
      ],
    });
    expect(
      validateCollectiveOutput(mixed, {
        outputRef: "output_1",
        validatorRef: "actor_1",
        verdict: "approved",
        reason: "archived validator",
      }),
    ).toMatchObject({ ok: false, code: "validator_not_participating" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Suspension (unit or per-member, no collateral)
 * ────────────────────────────────────────────────────────────*/

describe("suspension semantics", () => {
  it("suspends the society as a unit without touching member records", () => {
    const result = applySocietySuspension(society(), ACTIVE, {
      societyRef: SOCIETY_REF,
      scope: "society",
      reason: "containment",
      declaredBy: "human_owner",
    });
    expectOk(result);
    if (result.ok) {
      expect(result.scope).toBe("society");
      expect(result.memberRef).toBeNull();
    }
    // Members remain individually intact — the unit is suspended, not the agents.
    expect(society().members.every((m) => m.identityLifecycle === "active")).toBe(true);
  });

  it("requires exactly one memberRef for member scope and denies unknown members", () => {
    expect(
      applySocietySuspension(society(), ACTIVE, {
        societyRef: SOCIETY_REF,
        scope: "member",
        reason: "containment",
        declaredBy: "human_owner",
      }),
    ).toMatchObject({ ok: false, code: "member_required" });
    expect(
      applySocietySuspension(society(), ACTIVE, {
        societyRef: SOCIETY_REF,
        scope: "member",
        memberRef: "actor_ghost",
        reason: "containment",
        declaredBy: "human_owner",
      }),
    ).toMatchObject({ ok: false, code: "unknown_member" });
    expect(
      applySocietySuspension(society(), ACTIVE, {
        societyRef: SOCIETY_REF,
        scope: "society",
        memberRef: "actor_1",
        reason: "scope mismatch",
        declaredBy: "human_owner",
      }),
    ).toMatchObject({ ok: false, code: "member_required" });
  });

  it("names the member for per-member suspension and does not suspend the whole society", () => {
    const result = applySocietySuspension(society(), ACTIVE, {
      societyRef: SOCIETY_REF,
      scope: "member",
      memberRef: "actor_2",
      reason: "containment of one actor",
      declaredBy: "human_owner",
    });
    expectOk(result);
    if (result.ok) expect(result.memberRef).toBe("actor_2");
    // Only the named member's lifecycle flips; the society stays operational.
    const after = society({
      members: [
        member({ memberRef: "actor_1", grants: ["act.read"] as ActionRef[] }),
        member({ memberRef: "actor_2", identityLifecycle: "suspended" }),
      ],
    });
    expect(isSocietyOperational(ACTIVE)).toBe(true);
    expect(societyAuthorityIntersection(after.members)).toEqual([]);
  });

  it("denies suspension outside the active state", () => {
    expect(
      applySocietySuspension(society(), "dissolved", {
        societyRef: SOCIETY_REF,
        scope: "society",
        reason: "too late",
        declaredBy: "human_owner",
      }),
    ).toMatchObject({ ok: false, code: "society_not_active" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Audit trail (append-only, attributed)
 * ────────────────────────────────────────────────────────────*/

describe("society audit trail", () => {
  it("parses a fully attributed trail", () => {
    const parsed = parseSocietyAuditTrail([entry(), entry({ entryId: "entry_2", kind: "formation" })]);
    expectOk(parsed);
    if (parsed.ok) expect(parsed.entries).toHaveLength(2);
  });

  it("denies an entry with no attribution — no anonymous collective action", () => {
    expect(parseSocietyAuditTrail([entry({ attributedTo: [] })]).ok).toBe(false);
  });

  it("denies duplicate entry ids — the trail is append-only and immutable", () => {
    const parsed = parseSocietyAuditTrail([entry(), entry()]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("cross_record_invariant");
  });

  it("denies malformed entries and oversized trails", () => {
    expect(parseSocietyAuditTrail([entry({ summary: "" })]).ok).toBe(false);
    const oversized = Array.from({ length: 65_537 }, (_, index) => entry({ entryId: `e_${index}` }));
    expect(parseSocietyAuditTrail(oversized).ok).toBe(false);
  });

  it("covers every society surface in the audit kind vocabulary", () => {
    const kinds = ["formation", "coordination", "decision", "suspension", "output_validation", "dissolution"] as const;
    for (const kind of kinds) {
      expect(parseSocietyAuditTrail([entry({ kind })]).ok).toBe(true);
    }
  });
});