/**
 * CoreGrid — H3-073 phase-35 multi-agent-society ADVERSARIAL VERIFICATION
 * (Squad G mission G-073, Verifier).
 *
 * Adversarial suite against the COMPLETED contract module
 * `frontend/src/lib/multi-agent-society/contracts.ts` (landed by H3-055;
 * imported READ-ONLY — this suite never modifies it and deepens, never
 * duplicates, the H3-055 suite `tests/unit/h3-055-multi-agent-society.test.ts`).
 *
 * Attack classes (mission G-073):
 *   A1  authority-widening attempts (union instead of intersection)
 *   A2  vote stuffing
 *   A3  quorum manipulation
 *   A4  dissolved-society zombie coordination
 *   A5  anonymous collective action
 *   A6  audit-trail forgery
 *   A7  cross-tenant membership smuggling
 *
 * Every attack is expected to be contained with a TYPED denial (a
 * discriminant-checked `ok: false` code/reason, or a schema-level
 * `invalid_shape`). Where an attack SUCCEEDS against the current module
 * surface, the test asserts the observed behavior and is labelled
 * `FINDING F-073-0X`; findings are recorded, NOT fixed here (verifier law).
 *
 * FINDINGS REGISTRY (evidence asserted below):
 *   F-073-01  Zombie output-trust: `validateCollectiveOutput` takes no
 *             society-lifecycle argument and is not state-gated — a member
 *             of a dissolved (or suspended) society can still flip collective
 *             output to `trusted: true`. Containment: the validator must be a
 *             current, usable member; blast radius limited to the derived
 *             output-trust flag (never authority).
 *   F-073-02  Output-validation forgery: a validation record is never bound
 *             to a registered output — `validateCollectiveOutput` receives no
 *             output record and never checks `outputRef` registration (nor
 *             parses the validation shape), so a validation for an arbitrary
 *             or never-registered outputRef yields `trusted: true`.
 *   F-073-03  Participation-shrink vote manufacture: declaring co-participants
 *             with unusable identity lifecycles shrinks the participation
 *             floor to 1, so a single affirm vote resolves a UNANIMOUS
 *             `agreed` verdict. Containment (verified, fail-closed): the same
 *             shrink collapses the society's grant intersection to NOTHING
 *             (unusable members contribute empty grant sets), so the
 *             manufactured verdict widens zero authority whatsoever.
 *   F-073-04  Free-text hygiene gap: identity refs are control-character
 *             free, but free-text fields (`purpose`, `summary`, `rationale`,
 *             `reason`, `provenance.declaredAt`, `provenance.authority`)
 *             accept blank, whitespace-only and control-character content —
 *             a log/audit-summary injection vector.
 *   F-073-05  Audit-trail truthfulness boundary: `parseSocietyAuditTrail`
 *             enforces shape + entry-id immutability only; a forged entry
 *             attributing arbitrary actors (even non-members) to a fabricated
 *             event parses as valid, and entries of different societies may
 *             be mixed into one trail. Truthfulness is owned upstream by the
 *             append-only store (by-design boundary, recorded for posture).
 *   F-073-06  Lifecycle-approval forgery: `transitionSociety` never parses
 *             the approval record against `societyApprovalSchema` — an
 *             approval with blank `approvalRef`/`approvedBy` activates a
 *             society at the function surface.
 *
 * Pure offline: no network, no database, no secrets, no wall-clock reads.
 */
import { describe, expect, it } from "vitest";
import {
  applySocietySuspension,
  ballotEntrySchema,
  collectiveDecisionSchema,
  coordinationMessageSchema,
  effectiveMemberGrants,
  evaluateCollectiveAction,
  evaluateCoordination,
  parseSocietyAuditTrail,
  parseSocietyDefinition,
  registerCollectiveOutput,
  resolveCollectiveDecision,
  societyApprovalSchema,
  societyAuthorityIntersection,
  societyMemberSchema,
  transitionSociety,
  validateCollectiveOutput,
  type ActionRef,
  type CollectiveDecision,
  type CoordinationMessage,
  type SocietyAuditEntry,
  type SocietyDefinition,
  type SocietyLifecycleState,
  type SocietyMember,
} from "../../frontend/src/lib/multi-agent-society/contracts";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (neutral vocabulary; distinct from the H3-055 suite)
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant_delta_a";
const TENANT_B = "tenant_delta_b";
const SOCIETY_A = "society_delta_73_a";
const SOCIETY_B = "society_delta_73_b";

const ATTACKER = "actor_delta_attacker";
const PEER = "actor_delta_peer";
const OUTSIDER = "actor_delta_outsider";

function member(overrides: Partial<SocietyMember> = {}): SocietyMember {
  return {
    memberRef: ATTACKER,
    identityLifecycle: "active",
    role: "participant",
    grants: [],
    ...overrides,
  };
}

function society(overrides: Partial<SocietyDefinition> = {}): SocietyDefinition {
  return {
    societyRef: SOCIETY_A,
    tenantRef: TENANT_A,
    purpose: "bounded adversarial verification society",
    members: [
      member({ memberRef: ATTACKER, grants: ["act.read"] as ActionRef[] }),
      member({ memberRef: PEER, grants: ["act.read"] as ActionRef[] }),
    ],
    provenance: {
      declaredBy: "role:verifier",
      declaredAt: "2026-10-03T00:00:00.000Z",
      authority: "H3 wave mission G-073",
    },
    ...overrides,
  };
}

const ACTIVE: SocietyLifecycleState = "active";

function message(overrides: Partial<CoordinationMessage> = {}): CoordinationMessage {
  return {
    societyRef: SOCIETY_A,
    fromRef: ATTACKER,
    toRef: PEER,
    kind: "request",
    purpose: "verify bounded coordination",
    correlationRef: "corr_73_01",
    ...overrides,
  };
}

function decision(overrides: Partial<CollectiveDecision> = {}): CollectiveDecision {
  return {
    societyRef: SOCIETY_A,
    topic: "verify collective decision containment",
    rule: "unanimous",
    ballot: [
      { voterRef: ATTACKER, choice: "affirm", rationale: "attributable vote" },
      { voterRef: PEER, choice: "affirm", rationale: "attributable vote" },
    ],
    ...overrides,
  };
}

function entry(overrides: Partial<SocietyAuditEntry> = {}): SocietyAuditEntry {
  return {
    entryId: "audit_73_01",
    societyRef: SOCIETY_A,
    kind: "coordination",
    attributedTo: [ATTACKER, PEER],
    summary: "forgery-probe audit entry",
    ...overrides,
  };
}

/** Snapshot helper: the module must be pure — evaluation mutates nothing. */
function snapshot(soc: SocietyDefinition): string {
  return JSON.stringify(soc);
}

/* ─────────────────────────────────────────────────────────────
 * A1 — authority-widening attempts (union instead of intersection)
 * ────────────────────────────────────────────────────────────*/

describe("A1: authority-widening (union instead of intersection)", () => {
  it("denies an action held only by the coordinator — role confers zero authority", () => {
    const rolePlay = society({
      members: [
        member({ memberRef: ATTACKER, role: "coordinator", grants: ["act.read", "act.admin"] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.read"] as ActionRef[] }),
      ],
    });
    const result = evaluateCollectiveAction(rolePlay, ACTIVE, "act.admin" as ActionRef);
    expect(result).toMatchObject({ ok: false, code: "action_not_in_intersection" });
    if (!result.ok) expect(result.missingFrom).toEqual([PEER]);
  });

  it("denies an action held by a majority but not every member — union is not authority", () => {
    const majority = society({
      members: [
        member({ memberRef: ATTACKER, grants: ["act.read", "act.export"] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.read", "act.export"] as ActionRef[] }),
        member({ memberRef: OUTSIDER, grants: ["act.read"] as ActionRef[] }),
      ],
    });
    expect(societyAuthorityIntersection(majority.members)).toEqual(["act.read"]);
    expect(evaluateCollectiveAction(majority, ACTIVE, "act.export" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
      missingFrom: [OUTSIDER],
    });
  });

  it("adding a member with a superset of grants never widens the intersection", () => {
    const two = [
      member({ memberRef: ATTACKER, grants: ["act.a", "act.b"] as ActionRef[] }),
      member({ memberRef: PEER, grants: ["act.a"] as ActionRef[] }),
    ];
    const supersetJoiner = member({ memberRef: OUTSIDER, grants: ["act.a", "act.b", "act.admin"] as ActionRef[] });
    const before = societyAuthorityIntersection(two);
    const after = societyAuthorityIntersection([...two, supersetJoiner]);
    expect(before).toEqual(["act.a"]);
    expect(after).toEqual(["act.a"]);
    // Union would be {act.a, act.b, act.admin} — none of the extra ids may appear.
    expect(after).not.toContain("act.b");
    expect(after).not.toContain("act.admin");
  });

  it("the intersection contains only actions every member's effective grants hold — no synthetic authority", () => {
    const members = [
      member({ memberRef: ATTACKER, grants: ["act.a", "act.b", "act.c"] as ActionRef[] }),
      member({ memberRef: PEER, grants: ["act.a", "act.c"] as ActionRef[] }),
      member({ memberRef: OUTSIDER, grants: ["act.a", "act.c", "act.d"] as ActionRef[] }),
    ];
    const intersection = societyAuthorityIntersection(members);
    for (const action of intersection) {
      for (const m of members) {
        expect(effectiveMemberGrants(m)).toContain(action);
      }
    }
    expect(new Set(intersection)).toEqual(new Set(["act.a", "act.c"]));
  });

  it("duplicate grant entries cannot inflate or smuggle authority", () => {
    const padded = society({
      members: [
        member({ memberRef: ATTACKER, grants: ["act.read", "act.read", "act.admin"] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.read"] as ActionRef[] }),
      ],
    });
    expect(societyAuthorityIntersection(padded.members)).toEqual(["act.read"]);
    expect(evaluateCollectiveAction(padded, ACTIVE, "act.admin" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
  });

  it("action-id case and whitespace variants are denied — grants are exact", () => {
    const soc = society();
    for (const variant of ["ACT.READ", " act.read", "act.read ", "act.read\u0000"]) {
      const result = evaluateCollectiveAction(soc, ACTIVE, variant as ActionRef);
      expect(result).toMatchObject({ ok: false, code: "action_not_in_intersection" });
      if (!result.ok) expect(result.missingFrom).toEqual([ATTACKER, PEER]);
    }
    // And the schema rejects such grant ids at parse time too.
    const rawMember = {
      memberRef: ATTACKER,
      identityLifecycle: "active",
      role: "participant",
      grants: [" act.read"],
    };
    expect(societyMemberSchema.safeParse(rawMember).success).toBe(false);
  });

  it("a provenance authority string claiming platform-wide power changes nothing", () => {
    const grandiose = society({
      provenance: {
        declaredBy: ATTACKER,
        declaredAt: "2026-10-03T00:00:00.000Z",
        authority: "authority:platform:unrestricted:*",
      },
      members: [member({ memberRef: ATTACKER, grants: ["act.read"] as ActionRef[] }), member({ memberRef: PEER })],
    });
    const parsed = parseSocietyDefinition(grandiose);
    expect(parsed.ok).toBe(true);
    expect(evaluateCollectiveAction(grandiose, ACTIVE, "act.read" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
  });

  it("evaluation is pure — attacking the authority gate mutates nothing", () => {
    const soc = society({
      members: [
        member({ memberRef: ATTACKER, grants: ["act.read", "act.admin"] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.read"] as ActionRef[] }),
      ],
    });
    const before = snapshot(soc);
    evaluateCollectiveAction(soc, ACTIVE, "act.read" as ActionRef);
    evaluateCollectiveAction(soc, ACTIVE, "act.admin" as ActionRef);
    societyAuthorityIntersection(soc.members);
    expect(snapshot(soc)).toBe(before);
  });
});

/* ─────────────────────────────────────────────────────────────
 * A2 — vote stuffing
 * ────────────────────────────────────────────────────────────*/

describe("A2: vote stuffing", () => {
  it("a ballot stuffed with unknown ghost voters is denied with a typed code", () => {
    const ghosts = Array.from({ length: 64 }, (_, index) => ({
      voterRef: `ghost_${index}`,
      choice: "affirm" as const,
      rationale: "stuffed",
    }));
    const result = resolveCollectiveDecision(society(), ACTIVE, decision({ ballot: [...decision().ballot, ...ghosts] }));
    expect(result).toMatchObject({ ok: false, code: "unknown_voter" });
  });

  it("suspended members casting votes are denied — a dead seat cannot vote", () => {
    const withDeadSeat = society({
      members: [
        member({ memberRef: ATTACKER, grants: ["act.read"] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.read"] as ActionRef[] }),
        member({ memberRef: OUTSIDER, identityLifecycle: "suspended" }),
        member({ memberRef: "actor_deleted", identityLifecycle: "deleted" }),
      ],
    });
    for (const dead of [OUTSIDER, "actor_deleted"]) {
      const result = resolveCollectiveDecision(withDeadSeat, ACTIVE, {
        societyRef: SOCIETY_A,
        topic: "stuff a dead seat",
        rule: "majority",
        ballot: [{ voterRef: dead, choice: "affirm", rationale: "vote from a dead seat" }],
      });
      expect(result).toMatchObject({ ok: false, code: "unknown_voter" });
    }
  });

  it("an observer cannot be used as a stuffing voter", () => {
    const withObserver = society({
      members: [
        member({ memberRef: ATTACKER, grants: ["act.read"] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.read"] as ActionRef[] }),
        member({ memberRef: OUTSIDER, role: "observer" }),
      ],
    });
    const result = resolveCollectiveDecision(withObserver, ACTIVE, decision({
      ballot: [
        { voterRef: ATTACKER, choice: "affirm", rationale: "x" },
        { voterRef: OUTSIDER, choice: "affirm", rationale: "observer stuffing" },
      ],
    }));
    expect(result).toMatchObject({ ok: false, code: "unknown_voter" });
  });

  it("one member cannot vote many times, even with mixed choices across repeats", () => {
    const result = resolveCollectiveDecision(society(), ACTIVE, decision({
      ballot: [
        { voterRef: ATTACKER, choice: "affirm", rationale: "x1" },
        { voterRef: ATTACKER, choice: "reject", rationale: "x2" },
        { voterRef: ATTACKER, choice: "affirm", rationale: "x3" },
      ],
    }));
    expect(result).toMatchObject({ ok: false, code: "duplicate_vote" });
  });

  it("a stuffed ballot above the ceiling is denied at the schema", () => {
    const stuffed = {
      societyRef: SOCIETY_A,
      topic: "ceiling bypass attempt",
      rule: "unanimous",
      ballot: Array.from({ length: 4_097 }, (_, index) => ({
        voterRef: index % 2 === 0 ? ATTACKER : PEER,
        choice: "affirm",
        rationale: "stuffed",
      })),
    };
    const parsed = collectiveDecisionSchema.safeParse(stuffed);
    expect(parsed.success).toBe(false);
  });

  it("ballot entries with a blank rationale are denied at the schema", () => {
    expect(
      ballotEntrySchema.safeParse({ voterRef: ATTACKER, choice: "affirm", rationale: "" }).success,
    ).toBe(false);
  });

  it("stuffing cannot decide for another society — mismatch denies before counting", () => {
    const result = resolveCollectiveDecision(society(), ACTIVE, decision({ societyRef: SOCIETY_B }));
    expect(result).toMatchObject({ ok: false, code: "society_mismatch" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * A3 — quorum manipulation
 * ────────────────────────────────────────────────────────────*/

describe("A3: quorum manipulation", () => {
  const fiveMembers = () =>
    society({
      members: ["a1", "a2", "a3", "a4", "a5"].map((ref) => member({ memberRef: ref })),
    });

  it("a declared floor of zero is denied", () => {
    expect(resolveCollectiveDecision(fiveMembers(), ACTIVE, decision({ quorumFloor: 0 }))).toMatchObject({
      ok: false,
      code: "quorum_below_floor",
    });
  });

  it("a floor below half the participation is denied", () => {
    expect(resolveCollectiveDecision(fiveMembers(), ACTIVE, decision({ quorumFloor: 1 }))).toMatchObject({
      ok: false,
      code: "quorum_below_floor",
    });
    expect(resolveCollectiveDecision(fiveMembers(), ACTIVE, decision({ quorumFloor: 2 }))).toMatchObject({
      ok: false,
      code: "quorum_below_floor",
    });
  });

  it("a fractional floor slips the integer rule only in the type, never past the function — and the schema denies it", () => {
    const fractional = resolveCollectiveDecision(fiveMembers(), ACTIVE, decision({ quorumFloor: 0.5 }));
    expect(fractional).toMatchObject({ ok: false, code: "quorum_below_floor" });
    expect(
      collectiveDecisionSchema.safeParse({
        societyRef: SOCIETY_A,
        topic: "fractional floor",
        rule: "unanimous",
        quorumFloor: 1.5,
        ballot: [{ voterRef: ATTACKER, choice: "affirm", rationale: "x" }],
      }).success,
    ).toBe(false);
  });

  it("a floor above the participation makes agreement unreachable — silence never becomes agreement", () => {
    const three = society({
      members: [member({ memberRef: "a1" }), member({ memberRef: "a2" }), member({ memberRef: "a3" })],
    });
    const fullBallot = decision({
      ballot: [
        { voterRef: "a1", choice: "affirm", rationale: "x" },
        { voterRef: "a2", choice: "affirm", rationale: "x" },
        { voterRef: "a3", choice: "affirm", rationale: "x" },
      ],
    });
    expect(resolveCollectiveDecision(three, ACTIVE, { ...fullBallot, quorumFloor: 4 })).toMatchObject({
      ok: false,
      code: "quorum_below_floor",
    });
  });

  it("a quorum-satisfied majority verdict still authorizes nothing — decision and authority remain separate gates", () => {
    const ten = society({
      members: Array.from({ length: 10 }, (_, index) => member({ memberRef: `m_${index}`, grants: [] })),
    });
    const agreed = resolveCollectiveDecision(ten, ACTIVE, decision({
      rule: "majority",
      quorumFloor: 5,
      ballot: [
        { voterRef: "m_0", choice: "affirm", rationale: "x" },
        { voterRef: "m_1", choice: "affirm", rationale: "x" },
        { voterRef: "m_2", choice: "affirm", rationale: "x" },
        { voterRef: "m_3", choice: "reject", rationale: "x" },
        { voterRef: "m_4", choice: "abstain", rationale: "x" },
      ],
    }));
    expect(agreed).toMatchObject({ ok: true, verdict: "agreed" });
    // Even with a manufactured `agreed` verdict, zero grant intersection means zero collective action.
    expect(evaluateCollectiveAction(ten, ACTIVE, "act.anything" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
  });

  it("FINDING F-073-03: declaring co-participants unusable shrinks the floor to 1 and a single affirm vote manufactures a unanimous verdict (recorded, not fixed)", () => {
    const shrunk = society({
      members: [
        member({ memberRef: ATTACKER, grants: ["act.read"] as ActionRef[] }),
        member({ memberRef: "co_1", identityLifecycle: "deleted" }),
        member({ memberRef: "co_2", identityLifecycle: "archived" }),
        member({ memberRef: "co_3", identityLifecycle: "suspended" }),
      ],
    });
    const manufactured = resolveCollectiveDecision(shrunk, ACTIVE, decision({
      ballot: [{ voterRef: ATTACKER, choice: "affirm", rationale: "sole surviving vote" }],
    }));
    // The attack SUCCEEDS on the verdict surface: unanimous agreement from one vote.
    expect(manufactured).toMatchObject({
      ok: true,
      verdict: "agreed",
      participatingCount: 1,
      quorumFloor: 1,
      attributedTo: [ATTACKER],
    });
    // Containment (verified, stronger than shrunk-to-own-grants): every
    // unusable member contributes an EMPTY grant set, so the society's grant
    // intersection collapses to NOTHING — the manufactured verdict widens
    // zero authority, not even the attacker's own individual grants.
    expect(societyAuthorityIntersection(shrunk.members)).toEqual([]);
    const heldByAttacker = evaluateCollectiveAction(shrunk, ACTIVE, "act.read" as ActionRef);
    expect(heldByAttacker).toMatchObject({ ok: false, code: "action_not_in_intersection" });
    if (!heldByAttacker.ok) {
      // The attacker alone holds act.read, so the dead members are the ones named.
      expect(heldByAttacker.missingFrom).toEqual(["co_1", "co_2", "co_3"]);
    }
    expect(evaluateCollectiveAction(shrunk, ACTIVE, "act.write" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
    if (!evaluateCollectiveAction(shrunk, ACTIVE, "act.write" as ActionRef).ok) {
      const denied = evaluateCollectiveAction(shrunk, ACTIVE, "act.write" as ActionRef);
      if (!denied.ok) {
        expect(denied.missingFrom).toEqual([ATTACKER, "co_1", "co_2", "co_3"]);
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * A4 — dissolved-society zombie coordination
 * ────────────────────────────────────────────────────────────*/

describe("A4: dissolved-society zombie coordination", () => {
  const DEAD: SocietyLifecycleState = "dissolved";
  const soc = society();

  it("a dissolved society coordinates nothing", () => {
    expect(evaluateCoordination(soc, DEAD, message())).toMatchObject({
      ok: false,
      code: "society_not_active",
    });
  });

  it("a dissolved society decides nothing", () => {
    expect(resolveCollectiveDecision(soc, DEAD, decision())).toMatchObject({
      ok: false,
      code: "society_not_active",
    });
  });

  it("a dissolved society performs no collective action — even actions in the old intersection", () => {
    expect(evaluateCollectiveAction(soc, DEAD, "act.read" as ActionRef)).toMatchObject({
      ok: false,
      code: "society_not_active",
    });
  });

  it("a dissolved society cannot be suspended, and dissolution is terminal against every target state", () => {
    expect(
      applySocietySuspension(soc, DEAD, {
        societyRef: SOCIETY_A,
        scope: "society",
        reason: "suspend the dead",
        declaredBy: ATTACKER,
      }),
    ).toMatchObject({ ok: false, code: "society_not_active" });
    for (const target of ["proposed", "active", "suspended", "dissolved", "rejected"] as const) {
      expect(
        transitionSociety(DEAD, target, { approvalRef: "approval_forged_73", approvedBy: ATTACKER }),
      ).toMatchObject({ ok: false, code: "transition_not_listed" });
    }
  });

  it("a suspended society also coordinates, decides and acts on nothing", () => {
    for (const state of ["suspended", "proposed", "rejected"] as const) {
      expect(evaluateCoordination(soc, state, message()).ok).toBe(false);
      expect(resolveCollectiveDecision(soc, state, decision()).ok).toBe(false);
      expect(evaluateCollectiveAction(soc, state, "act.read" as ActionRef).ok).toBe(false);
    }
  });

  it("FINDING F-073-01: a dissolved society's members can still validate collective output — the output-trust surface has no lifecycle gate (recorded, not fixed)", () => {
    // The output-trust surface takes no lifecycle state at all, so zombie
    // validation cannot be denied at the state gate the other surfaces use.
    const zombieValidation = validateCollectiveOutput(soc, {
      outputRef: "output_zombie_1",
      validatorRef: ATTACKER,
      verdict: "approved",
      reason: "validated after dissolution",
    });
    // The attack SUCCEEDS: trusted flips to true inside a dead society.
    expect(zombieValidation).toMatchObject({ ok: true, trusted: true, validatedBy: ATTACKER });
    // Registration is equally state-blind (structural evidence of the gap).
    const registered = registerCollectiveOutput({
      outputRef: "output_zombie_2",
      societyRef: SOCIETY_A,
      correlationRef: "corr_73_zombie",
      summary: "output minted after dissolution",
    });
    expect(registered.validation).toBe("unvalidated");
    // Containment boundary: the validator must still be a current, usable
    // member — zombie validation cannot be performed by an outsider.
    expect(
      validateCollectiveOutput(soc, {
        outputRef: "output_zombie_1",
        validatorRef: OUTSIDER,
        verdict: "approved",
        reason: "outsider validation",
      }),
    ).toMatchObject({ ok: false, code: "unknown_validator" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * A5 — anonymous collective action
 * ────────────────────────────────────────────────────────────*/

describe("A5: anonymous collective action", () => {
  it("a coordination message with a blank or whitespace sender/recipient is denied at the schema", () => {
    expect(coordinationMessageSchema.safeParse(message({ fromRef: "" })).success).toBe(false);
    expect(coordinationMessageSchema.safeParse(message({ fromRef: "   " })).success).toBe(false);
    expect(coordinationMessageSchema.safeParse(message({ toRef: "" })).success).toBe(false);
    expect(coordinationMessageSchema.safeParse(message({ toRef: "\u0000actor" })).success).toBe(false);
  });

  it("a coordination message with a blank correlation id is denied at the schema — no untraceable coordination", () => {
    expect(coordinationMessageSchema.safeParse(message({ correlationRef: "" })).success).toBe(false);
    expect(coordinationMessageSchema.safeParse(message({ correlationRef: " " })).success).toBe(false);
  });

  it("a sender not attributable to the membership is denied even with a well-formed message", () => {
    const result = evaluateCoordination(society(), ACTIVE, message({ fromRef: OUTSIDER }));
    expect(result).toMatchObject({ ok: false, code: "unknown_sender" });
  });

  it("an audit entry with zero attribution is denied — no anonymous collective action", () => {
    const parsed = parseSocietyAuditTrail([entry({ attributedTo: [] })]);
    expect(parsed).toMatchObject({ ok: false, reason: "invalid_shape" });
  });

  it("a vote from an unattributable placeholder voter is denied at the schema", () => {
    expect(ballotEntrySchema.safeParse({ voterRef: "", choice: "affirm", rationale: "x" }).success).toBe(false);
    expect(ballotEntrySchema.safeParse({ voterRef: "  ", choice: "affirm", rationale: "x" }).success).toBe(false);
  });

  it("an anonymous collective output authorizes nothing until an attributed validation names a member", () => {
    const anonymous = registerCollectiveOutput({
      outputRef: "output_anon_73",
      societyRef: SOCIETY_A,
      correlationRef: "corr_73_anon",
      summary: "collective output naming no agent",
    });
    expect(anonymous.validation).toBe("unvalidated");
    expect(anonymous.output).not.toHaveProperty("attributedTo");
    // An attributed validation by a participating member is the only trust path.
    const trusted = validateCollectiveOutput(society(), {
      outputRef: "output_anon_73",
      validatorRef: ATTACKER,
      verdict: "approved",
      reason: "attributed validation",
    });
    expect(trusted).toMatchObject({ ok: true, trusted: true, validatedBy: ATTACKER });
  });
});

/* ─────────────────────────────────────────────────────────────
 * A6 — audit-trail forgery
 * ────────────────────────────────────────────────────────────*/

describe("A6: audit-trail forgery", () => {
  it("a forged trail with duplicated entry ids is denied wholesale (append-only immutability)", () => {
    const parsed = parseSocietyAuditTrail([entry(), entry({ kind: "formation" })]);
    expect(parsed).toMatchObject({ ok: false, reason: "cross_record_invariant" });
    if (!parsed.ok) expect(parsed.issues[0]?.message).toContain("append-only and immutable");
  });

  it("the same entry id cannot be double-spent across kinds", () => {
    const parsed = parseSocietyAuditTrail([entry({ kind: "decision" }), entry({ kind: "suspension" })]);
    expect(parsed).toMatchObject({ ok: false, reason: "cross_record_invariant" });
  });

  it("an entry forged with an unknown kind is denied at the schema", () => {
    const parsed = parseSocietyAuditTrail([entry({ kind: "self_granted_emergency" as SocietyAuditEntry["kind"] })]);
    expect(parsed).toMatchObject({ ok: false, reason: "invalid_shape" });
  });

  it("an entry forged with control-character references is denied at the schema", () => {
    expect(parseSocietyAuditTrail([entry({ entryId: "audit\u0000forged" })]).ok).toBe(false);
    expect(parseSocietyAuditTrail([entry({ societyRef: "society\nforged" })]).ok).toBe(false);
    expect(parseSocietyAuditTrail([entry({ attributedTo: ["actor\u001binject"] })]).ok).toBe(false);
  });

  it("FINDING F-073-04: free-text fields accept blank, whitespace-only and control-character content — a summary/log injection vector (recorded, not fixed)", () => {
    // Refs are hardened; free text is not. The forged summary below parses.
    const injected = entry({ summary: "clean\u0000summary\nFAKE: approved by platform owner" });
    const parsed = parseSocietyAuditTrail([injected]);
    expect(parsed.ok).toBe(true);
    // Same gap on the society-definition surface (purpose + provenance text).
    const smuggled = {
      societyRef: SOCIETY_A,
      tenantRef: TENANT_A,
      purpose: "benign purpose\u0000\nFAKE: tenant owner approved",
      members: [
        { memberRef: ATTACKER, identityLifecycle: "active", role: "participant", grants: ["act.read"] },
        { memberRef: PEER, identityLifecycle: "active", role: "participant", grants: ["act.read"] },
      ],
      provenance: {
        declaredBy: ATTACKER,
        declaredAt: "2026-10-03T00:00:00.000Z\nnot-a-timestamp",
        authority: " ",
      },
    };
    const parsedSociety = parseSocietyDefinition(smuggled);
    // The attack SUCCEEDS at parse: control chars, blank authority and a
    // non-timestamp declaredAt are all accepted.
    expect(parsedSociety.ok).toBe(true);
    // Containment contrast: the same content in REF positions is denied.
    expect(parseSocietyDefinition({ ...smuggled, purpose: "ok", societyRef: "society\u0000x" }).ok).toBe(false);
  });

  it("FINDING F-073-05: a forged entry attributing non-member actors to a fabricated event parses as valid — the parser owns shape, not truthfulness (recorded, not fixed)", () => {
    const forged = entry({
      attributedTo: ["actor_never_existed_1", "actor_never_existed_2"],
      kind: "decision",
      summary: "forged decision record",
    });
    const parsed = parseSocietyAuditTrail([forged]);
    expect(parsed.ok).toBe(true);
    // Entries of ANOTHER society may be mixed into one trail without denial —
    // the trail parser has no society binding to check against.
    const mixed = parseSocietyAuditTrail([entry(), entry({ entryId: "audit_73_02", societyRef: SOCIETY_B })]);
    expect(mixed.ok).toBe(true);
  });

  it("FINDING F-073-06: lifecycle approval records are not schema-validated — a blank forged approval activates a society (recorded, not fixed)", () => {
    const forgedApproval = { approvalRef: "", approvedBy: "" };
    const activated = transitionSociety("proposed", "active", forgedApproval);
    // The attack SUCCEEDS at the function surface: activation with an
    // approval record that violates societyApprovalSchema.
    expect(activated).toMatchObject({ ok: true, state: "active" });
    // Containment contrast: the exported schema itself DOES deny the forged
    // record — the gap is that the transition function never consults it.
    expect(societyApprovalSchema.safeParse(forgedApproval).success).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * A7 — cross-tenant membership smuggling
 * ────────────────────────────────────────────────────────────*/

describe("A7: cross-tenant membership smuggling", () => {
  it("a member carrying a tenantRef field is denied — members hold no tenant of their own", () => {
    const smuggler = {
      memberRef: ATTACKER,
      identityLifecycle: "active",
      role: "participant",
      grants: ["act.read"],
      tenantRef: TENANT_B,
    };
    expect(societyMemberSchema.safeParse(smuggler).success).toBe(false);
    const soc = society({
      members: [smuggler as unknown as SocietyMember, member({ memberRef: PEER })],
    });
    const parsed = parseSocietyDefinition(soc);
    expect(parsed).toMatchObject({ ok: false, reason: "invalid_shape" });
  });

  it("a smuggled tenant-scope field at the definition root is denied", () => {
    const raw = {
      ...society(),
      members: [
        { memberRef: ATTACKER, identityLifecycle: "active", role: "participant", grants: ["act.read"] },
        { memberRef: PEER, identityLifecycle: "active", role: "participant", grants: ["act.read"] },
      ],
      memberTenantOverride: TENANT_B,
    };
    expect(parseSocietyDefinition(raw).ok).toBe(false);
  });

  it("an actor from another tenant's society cannot coordinate into this society by ref collision", () => {
    const tenantBSociety = society({
      societyRef: SOCIETY_B,
      tenantRef: TENANT_B,
      members: [
        member({ memberRef: "shared_actor_cross_tenant", grants: ["act.read"] as ActionRef[] }),
        member({ memberRef: "b_peer", grants: ["act.read"] as ActionRef[] }),
      ],
    });
    expect(parseSocietyDefinition(tenantBSociety).ok).toBe(true);
    // Same actor ref, but not a member of the tenant-A society under attack.
    const result = evaluateCoordination(society(), ACTIVE, message({ fromRef: "shared_actor_cross_tenant" }));
    expect(result).toMatchObject({ ok: false, code: "unknown_sender" });
    // And the tenant-B society will not accept messages aimed at the tenant-A society.
    expect(evaluateCoordination(tenantBSociety, ACTIVE, message())).toMatchObject({
      ok: false,
      code: "society_mismatch",
    });
  });

  it("membership in two societies across tenants does not merge authority across them", () => {
    const dual = "actor_dual_tenant";
    const tenantASociety = society({
      members: [
        member({ memberRef: dual, grants: ["act.tenant_a_only"] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.tenant_a_only"] as ActionRef[] }),
      ],
    });
    const tenantBSociety = society({
      societyRef: SOCIETY_B,
      tenantRef: TENANT_B,
      members: [
        member({ memberRef: dual, grants: ["act.tenant_b_only"] as ActionRef[] }),
        member({ memberRef: "b_peer", grants: ["act.tenant_b_only"] as ActionRef[] }),
      ],
    });
    // Each society gates its own intersection; neither consults the other.
    expect(societyAuthorityIntersection(tenantASociety.members)).toEqual(["act.tenant_a_only"]);
    expect(societyAuthorityIntersection(tenantBSociety.members)).toEqual(["act.tenant_b_only"]);
    expect(evaluateCollectiveAction(tenantASociety, ACTIVE, "act.tenant_b_only" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
    expect(evaluateCollectiveAction(tenantBSociety, ACTIVE, "act.tenant_a_only" as ActionRef)).toMatchObject({
      ok: false,
      code: "action_not_in_intersection",
    });
  });

  it("a cross-tenant grant id smuggled into one member's declared view cannot become society authority", () => {
    const smuggled = society({
      members: [
        member({ memberRef: ATTACKER, grants: ["act.read", `${TENANT_B}:act.admin`] as ActionRef[] }),
        member({ memberRef: PEER, grants: ["act.read"] as ActionRef[] }),
      ],
    });
    const result = evaluateCollectiveAction(smuggled, ACTIVE, `${TENANT_B}:act.admin` as ActionRef);
    expect(result).toMatchObject({ ok: false, code: "action_not_in_intersection" });
    if (!result.ok) expect(result.missingFrom).toEqual([PEER]);
  });

  it("even full cross-tenant collusion yields nothing beyond the declared views — the module issues no grants", () => {
    const colluding = society({
      members: [
        member({ memberRef: ATTACKER, grants: [`${TENANT_B}:act.admin`] as ActionRef[] }),
        member({ memberRef: PEER, grants: [`${TENANT_B}:act.admin`] as ActionRef[] }),
      ],
    });
    const before = snapshot(colluding);
    const result = evaluateCollectiveAction(colluding, ACTIVE, `${TENANT_B}:act.admin` as ActionRef);
    // The collusion succeeds only within the declared views — and the module
    // mutates nothing: grant ISSUANCE belongs to the authorization layer,
    // never to this surface.
    expect(result).toMatchObject({ ok: true, actionRef: `${TENANT_B}:act.admin` });
    if (result.ok) expect(result.heldBy).toEqual([ATTACKER, PEER]);
    expect(snapshot(colluding)).toBe(before);
  });
});