/**
 * SV1-TWIN-04 — proposal-only recommendations, predictions, away brief,
 * playbooks and growth ledger. A twin never writes a canonical record.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { OperationContract } from "../../frontend/src/lib/scholar/api-contracts";
import {
  EMPTY_GROWTH_LEDGER,
  EMPTY_PROPOSAL_STORE,
  PROPOSAL_LABEL,
  acknowledgeProposal,
  appendGrowthEntry,
  approveProposal,
  composeAwayBrief,
  createProposal,
  dismissProposal,
  expireProposals,
  instantiatePlaybook,
  prepareExecution,
  recordExecutionOutcome,
  toCard,
  verifyGrowthLedger,
  type Actor,
  type NewProposal,
  type ProposalStore,
  type RolePlaybook,
} from "../../frontend/src/lib/scholar/personal-twin/proposals";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const CONTRACTS: OperationContract[] = [
  {
    id: "scholar.attendance.flag_followup",
    kind: "command",
    surface: "attendance",
    inputShape: "FollowupInput",
    outputKind: "Followup",
    requiresAuthorization: true,
  },
  {
    id: "scholar.attendance.summary",
    kind: "query",
    surface: "attendance",
    inputShape: "SummaryQuery",
    outputKind: "Summary",
    requiresAuthorization: true,
  },
  {
    id: "scholar.legacy.unauthenticated_command",
    kind: "command",
    surface: "attendance",
    inputShape: "X",
    outputKind: "Y",
    requiresAuthorization: false,
  },
];

const ME: Actor = {
  tenantRef: "t1",
  userRef: "u1",
  heldPermissions: ["attendance.take"],
};

function np(over: Partial<NewProposal> = {}): NewProposal {
  return {
    proposalId: "p1",
    kind: "recommendation",
    tenantRef: "t1",
    userRef: "u1",
    roleCode: "teacher",
    summary: "Follow up with the parent of student S-1 about three absences",
    source: {
      kind: "record",
      ref: "attendance:class-7a:wk45",
      asOfMs: NOW - HOUR,
      description: "Three absences in Week 45",
    },
    ttlMs: 24 * HOUR,
    correlationId: "corr-1",
    operationId: "scholar.attendance.flag_followup",
    inputRef: "ref:followup:1",
    requiredPermission: "attendance.take",
    ...over,
  };
}

function created(over: Partial<NewProposal> = {}, store: ProposalStore = EMPTY_PROPOSAL_STORE) {
  const r = createProposal(store, np(over), CONTRACTS, NOW);
  if (!r.ok) throw new Error(`create failed: ${r.reason}`);
  return r.store;
}

describe("creating proposals", () => {
  it("labels every proposal and keeps its source", () => {
    const s = created();
    const p = s.proposals[0];
    expect(p.label).toBe("Recommendation");
    expect(p.status).toBe("proposed");
    expect(p.source.description).toBe("Three absences in Week 45");
    for (const kind of Object.keys(PROPOSAL_LABEL)) {
      expect(PROPOSAL_LABEL[kind as keyof typeof PROPOSAL_LABEL].length).toBeGreaterThan(0);
    }
  });

  it("rejects a proposal with no usable source", () => {
    for (const source of [
      undefined,
      { kind: "record", ref: "", asOfMs: NOW, description: "x" },
      { kind: "record", ref: "r", asOfMs: NOW, description: " " },
      { kind: "record", ref: "r", asOfMs: Number.NaN, description: "x" },
    ]) {
      const r = createProposal(
        EMPTY_PROPOSAL_STORE,
        np({ source: source as never }),
        CONTRACTS,
        NOW,
      );
      expect(r).toMatchObject({ ok: false, reason: "source_required" });
    }
  });

  it("rejects malformed input, duplicates, long summaries and bad TTLs", () => {
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, np({ summary: " " }), CONTRACTS, NOW),
    ).toMatchObject({ reason: "invalid_proposal" });
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, np({ roleCode: "" }), CONTRACTS, NOW),
    ).toMatchObject({ reason: "invalid_proposal" });
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, np({ kind: "mutation" as never }), CONTRACTS, NOW),
    ).toMatchObject({ reason: "invalid_proposal" });
    expect(createProposal(created(), np(), CONTRACTS, NOW)).toMatchObject({
      reason: "duplicate_proposal",
    });
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, np({ summary: "x".repeat(281) }), CONTRACTS, NOW),
    ).toMatchObject({ reason: "summary_too_long" });
    for (const ttlMs of [0, -1, Number.NaN, 8 * 24 * HOUR]) {
      expect(createProposal(EMPTY_PROPOSAL_STORE, np({ ttlMs }), CONTRACTS, NOW)).toMatchObject({
        reason: "ttl_out_of_range",
      });
    }
  });

  it("only allows operations that are declared, are commands and require authorization", () => {
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, np({ operationId: "scholar.nope" }), CONTRACTS, NOW),
    ).toMatchObject({ reason: "operation_not_declared" });
    expect(
      createProposal(
        EMPTY_PROPOSAL_STORE,
        np({ operationId: "scholar.attendance.summary" }),
        CONTRACTS,
        NOW,
      ),
    ).toMatchObject({ reason: "operation_not_a_command" });
    expect(
      createProposal(
        EMPTY_PROPOSAL_STORE,
        np({ operationId: "scholar.legacy.unauthenticated_command" }),
        CONTRACTS,
        NOW,
      ),
    ).toMatchObject({ reason: "operation_not_a_command" });
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, np({ requiredPermission: null }), CONTRACTS, NOW),
    ).toMatchObject({ reason: "operation_needs_permission" });
  });

  it("goes through the AI safety boundary: a blank role cannot propose", () => {
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, np({ roleCode: "  " }), CONTRACTS, NOW),
    ).toMatchObject({ ok: false });
  });

  it("records rejected creations in the audit trail", () => {
    const r = createProposal(
      EMPTY_PROPOSAL_STORE,
      np({ operationId: "scholar.nope" }),
      CONTRACTS,
      NOW,
    );
    expect(r.store.audit.at(-1)).toMatchObject({
      kind: "rejected",
      detail: "operation_not_declared",
      correlationId: "corr-1",
    });
    expect(r.store.proposals).toHaveLength(0);
  });
});

describe("predictions never act", () => {
  const pred = (over: Partial<NewProposal> = {}) =>
    np({
      proposalId: "pr1",
      kind: "prediction",
      summary: "Class 7A attendance may dip next week",
      operationId: null,
      inputRef: null,
      requiredPermission: null,
      confidence: 0.62,
      ...over,
    });

  it("requires a confidence between 0 and 1 and no operation", () => {
    for (const confidence of [null, -0.1, 1.1, Number.NaN]) {
      expect(
        createProposal(EMPTY_PROPOSAL_STORE, pred({ confidence }), CONTRACTS, NOW),
      ).toMatchObject({ reason: "prediction_needs_confidence" });
    }
    expect(
      createProposal(
        EMPTY_PROPOSAL_STORE,
        pred({
          operationId: "scholar.attendance.flag_followup",
          requiredPermission: "attendance.take",
        }),
        CONTRACTS,
        NOW,
      ),
    ).toMatchObject({ reason: "prediction_cannot_target_operation" });
    expect(
      createProposal(EMPTY_PROPOSAL_STORE, pred({ inputRef: "ref:x" }), CONTRACTS, NOW),
    ).toMatchObject({ reason: "prediction_cannot_target_operation" });
  });

  it("can be acknowledged or dismissed but never approved", () => {
    const s = createProposal(EMPTY_PROPOSAL_STORE, pred(), CONTRACTS, NOW);
    if (!s.ok) throw new Error(s.reason);
    expect(approveProposal(s.store, "pr1", ME, NOW)).toMatchObject({
      ok: false,
      reason: "prediction_not_actionable",
    });
    const ack = acknowledgeProposal(s.store, "pr1", ME, NOW);
    expect(ack.ok).toBe(true);
    const dis = dismissProposal(s.store, "pr1", ME, NOW);
    expect(dis.ok).toBe(true);
    expect(toCard(s.proposal, NOW, 2 * HOUR).actionable).toBe(false);
    expect(toCard(s.proposal, NOW, 2 * HOUR).label).toBe("Prediction");
    expect(toCard(s.proposal, NOW, 2 * HOUR).confidence).toBe(0.62);
  });
});

describe("approve, dismiss and audit", () => {
  it("approval is consent only: nothing is handed off until prepareExecution", () => {
    const s = created();
    const a = approveProposal(s, "p1", ME, NOW + 1);
    if (!a.ok) throw new Error(a.reason);
    expect(a.proposal.status).toBe("approved");
    expect(a.store.audit.map((r) => r.kind)).toEqual(["created", "approved"]);
  });

  it("only the owning user in the same tenant can decide", () => {
    const s = created();
    expect(approveProposal(s, "p1", { ...ME, userRef: "u2" }, NOW)).toMatchObject({
      reason: "not_owner",
    });
    expect(approveProposal(s, "p1", { ...ME, tenantRef: "t2" }, NOW)).toMatchObject({
      reason: "tenant_mismatch",
    });
    expect(dismissProposal(s, "p1", { ...ME, userRef: "u2" }, NOW)).toMatchObject({
      reason: "not_owner",
    });
    expect(approveProposal(s, "nope", ME, NOW)).toMatchObject({ reason: "unknown_proposal" });
  });

  it("refuses approval without the required permission, and audits the refusal", () => {
    const s = created();
    const r = approveProposal(s, "p1", { ...ME, heldPermissions: ["students.view"] }, NOW);
    expect(r).toMatchObject({ ok: false, reason: "permission_not_held" });
    expect(r.store.audit.at(-1)).toMatchObject({
      kind: "rejected",
      detail: "approved:permission_not_held",
    });
    expect(r.store.proposals[0].status).toBe("proposed");
  });

  it("information-only proposals cannot be approved", () => {
    const s = created({ operationId: null, inputRef: null, requiredPermission: null });
    expect(approveProposal(s, "p1", ME, NOW)).toMatchObject({ reason: "information_only" });
    expect(acknowledgeProposal(s, "p1", ME, NOW).ok).toBe(true);
  });

  it("an actionable proposal cannot be acknowledged away", () => {
    expect(acknowledgeProposal(created(), "p1", ME, NOW)).toMatchObject({
      reason: "information_only",
    });
  });

  it("decides once; a second decision is rejected", () => {
    const s = created();
    const d = dismissProposal(s, "p1", ME, NOW);
    if (!d.ok) throw new Error(d.reason);
    expect(d.store.audit.map((r) => r.kind)).toEqual(["created", "dismissed"]);
    expect(approveProposal(d.store, "p1", ME, NOW)).toMatchObject({ reason: "not_open" });
    expect(dismissProposal(d.store, "p1", ME, NOW)).toMatchObject({ reason: "not_open" });
  });

  it("an expired proposal cannot be approved and is marked expired", () => {
    const s = created({ ttlMs: HOUR });
    const r = approveProposal(s, "p1", ME, NOW + 2 * HOUR);
    expect(r).toMatchObject({ ok: false, reason: "proposal_expired" });
    expect(r.store.proposals[0].status).toBe("expired");
    const swept = expireProposals(s, NOW + 2 * HOUR);
    expect(swept.proposals[0].status).toBe("expired");
    expect(expireProposals(s, NOW + 1).proposals[0].status).toBe("proposed");
  });
});

describe("hand-off to the existing authorized API", () => {
  function approved() {
    const a = approveProposal(created(), "p1", ME, NOW + 1);
    if (!a.ok) throw new Error(a.reason);
    return a.store;
  }

  it("returns a request for the declared operation, once, with an idempotency key", () => {
    const h = prepareExecution(approved(), "p1", ME, CONTRACTS, NOW + 2);
    if (!h.ok) throw new Error(h.reason);
    expect(h.request).toEqual({
      operationId: "scholar.attendance.flag_followup",
      inputRef: "ref:followup:1",
      onBehalfOf: { tenantRef: "t1", userRef: "u1" },
      proposalId: "p1",
      correlationId: "corr-1",
      idempotencyKey: "twin-proposal:p1",
    });
    expect(Object.isFrozen(h.request)).toBe(true);
    expect(h.store.proposals[0].status).toBe("handed_off");
    expect(prepareExecution(h.store, "p1", ME, CONTRACTS, NOW + 3)).toMatchObject({
      reason: "not_approved",
    });
  });

  it("refuses an unapproved proposal", () => {
    expect(prepareExecution(created(), "p1", ME, CONTRACTS, NOW)).toMatchObject({
      reason: "not_approved",
    });
  });

  it("re-checks the permission: a permission revoked after approval stops the handoff", () => {
    const r = prepareExecution(
      approved(),
      "p1",
      { ...ME, heldPermissions: [] },
      CONTRACTS,
      NOW + 2,
    );
    expect(r).toMatchObject({ ok: false, reason: "permission_not_held" });
    expect(r.store.proposals[0].status).toBe("approved");
  });

  it("re-checks the contract: a contract removed after approval stops the handoff", () => {
    expect(prepareExecution(approved(), "p1", ME, [], NOW + 2)).toMatchObject({
      reason: "operation_not_declared",
    });
    const downgraded = CONTRACTS.map((c) =>
      c.id === "scholar.attendance.flag_followup" ? { ...c, kind: "query" as const } : c,
    );
    expect(prepareExecution(approved(), "p1", ME, downgraded, NOW + 2)).toMatchObject({
      reason: "operation_not_a_command",
    });
  });

  it("refuses another user or tenant", () => {
    expect(
      prepareExecution(approved(), "p1", { ...ME, userRef: "u2" }, CONTRACTS, NOW),
    ).toMatchObject({ reason: "not_owner" });
    expect(
      prepareExecution(approved(), "p1", { ...ME, tenantRef: "t2" }, CONTRACTS, NOW),
    ).toMatchObject({ reason: "tenant_mismatch" });
  });

  it("records the outcome reported by the authorized operation", () => {
    const h = prepareExecution(approved(), "p1", ME, CONTRACTS, NOW + 2);
    if (!h.ok) throw new Error(h.reason);
    const done = recordExecutionOutcome(h.store, "p1", "succeeded", NOW + 3);
    expect(done.store.proposals[0].status).toBe("executed");
    expect(recordExecutionOutcome(done.store, "p1", "failed", NOW + 4).ok).toBe(false);
    const failed = recordExecutionOutcome(h.store, "p1", "denied", NOW + 3);
    expect(failed.store.proposals[0].status).toBe("execution_failed");
    expect(recordExecutionOutcome(created(), "p1", "succeeded", NOW).ok).toBe(false);
  });

  it("audits every step with the same correlation id", () => {
    const h = prepareExecution(approved(), "p1", ME, CONTRACTS, NOW + 2);
    if (!h.ok) throw new Error(h.reason);
    const done = recordExecutionOutcome(h.store, "p1", "succeeded", NOW + 3);
    expect(done.store.audit.map((r) => r.kind)).toEqual([
      "created",
      "approved",
      "handed_off",
      "execution_outcome",
    ]);
    expect(new Set(done.store.audit.map((r) => r.correlationId))).toEqual(new Set(["corr-1"]));
    expect(done.store.audit.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
  });
});

describe("cards and the away brief", () => {
  it("marks stale sources and never presents a proposal as done", () => {
    const s = created();
    const fresh = toCard(s.proposals[0], NOW, 2 * HOUR);
    expect(fresh).toMatchObject({ freshness: "fresh", label: "Recommendation", actionable: true });
    const stale = toCard(s.proposals[0], NOW + 3 * HOUR, 2 * HOUR);
    expect(stale.freshness).toBe("stale");
    expect(stale.sourceAgeMs).toBe(4 * HOUR);
    expect(stale.sourceDescription).toBe("Three absences in Week 45");
  });

  it("lists only my open, unexpired proposals created since I left, newest source first", () => {
    let s = created({ proposalId: "a", source: { ...np().source, asOfMs: NOW - 3 * HOUR } });
    s = created({ proposalId: "b", source: { ...np().source, asOfMs: NOW - HOUR } }, s);
    s = created({ proposalId: "c", userRef: "u2" }, s);
    s = created({ proposalId: "d", tenantRef: "t2" }, s);
    s = created({ proposalId: "e", ttlMs: 60_000 }, s);
    const d = dismissProposal(s, "a", ME, NOW);
    if (!d.ok) throw new Error(d.reason);
    s = created({ proposalId: "f", source: { ...np().source, asOfMs: NOW - 2 * HOUR } }, d.store);
    const brief = composeAwayBrief(s, ME, NOW - HOUR, NOW + 5 * 60_000, {
      maxItems: 10,
      staleAfterMs: 2 * HOUR,
    });
    expect(brief.items.map((i) => i.proposalId)).toEqual(["b", "f"]);
    expect(brief.proposalsOnly).toBe(true);
    expect(brief.counts.recommendation).toBe(2);
  });

  it("bounds the brief and reports what it left out", () => {
    let s = EMPTY_PROPOSAL_STORE;
    for (let i = 0; i < 6; i++) s = created({ proposalId: `x${i}` }, s);
    const brief = composeAwayBrief(s, ME, 0, NOW, { maxItems: 4, staleAfterMs: HOUR });
    expect(brief.items).toHaveLength(4);
    expect(brief.omitted).toBe(2);
    expect(composeAwayBrief(s, ME, 0, NOW, { maxItems: 0, staleAfterMs: HOUR }).items).toHaveLength(
      0,
    );
  });

  it("is empty for someone else, even in the same tenant", () => {
    const s = created();
    const brief = composeAwayBrief(s, { tenantRef: "t1", userRef: "u9" }, 0, NOW, {
      maxItems: 5,
      staleAfterMs: HOUR,
    });
    expect(brief.items).toHaveLength(0);
  });
});

describe("role playbooks", () => {
  const playbook: RolePlaybook = {
    playbookId: "teacher.weekly",
    roleCodes: ["teacher", "form_teacher"],
    steps: [
      {
        stepId: "s1",
        summary: "Review this week's absences",
        operationId: null,
        requiredPermission: null,
      },
      {
        stepId: "s2",
        summary: "Flag follow-ups for repeat absences",
        operationId: "scholar.attendance.flag_followup",
        requiredPermission: "attendance.take",
      },
      {
        stepId: "s3",
        summary: "Publish results",
        operationId: "scholar.attendance.flag_followup",
        requiredPermission: "results.publish",
      },
    ],
  };
  const ctx = {
    tenantRef: "t1",
    userRef: "u1",
    roleCode: "teacher",
    heldPermissions: ["attendance.take"],
    correlationId: "corr-pb",
    asOfMs: NOW,
    ttlMs: 24 * HOUR,
  };

  it("skips steps the person's permissions do not allow (a playbook can only narrow)", () => {
    const steps = instantiatePlaybook(playbook, ctx);
    expect(steps.map((s) => s.proposalId)).toEqual([
      "teacher.weekly:s1:corr-pb",
      "teacher.weekly:s2:corr-pb",
    ]);
    expect(steps.every((s) => s.kind === "playbook_step")).toBe(true);
    expect(steps.every((s) => s.source.kind === "playbook")).toBe(true);
  });

  it("produces nothing for a role the playbook does not cover", () => {
    expect(instantiatePlaybook(playbook, { ...ctx, roleCode: "bursar" })).toEqual([]);
  });

  it("instantiated steps go through the same creation checks", () => {
    let store = EMPTY_PROPOSAL_STORE;
    for (const step of instantiatePlaybook(playbook, ctx)) {
      const r = createProposal(store, step, CONTRACTS, NOW);
      expect(r.ok).toBe(true);
      store = r.store;
    }
    expect(store.proposals.map((p) => p.label)).toEqual([
      "Playbook suggestion",
      "Playbook suggestion",
    ]);
  });
});

describe("growth ledger", () => {
  const owner = { tenantRef: "t1", userRef: "u1" };

  it("records decided proposals and personal notes, append-only with a gap-free sequence", () => {
    const d = dismissProposal(created(), "p1", ME, NOW);
    if (!d.ok) throw new Error(d.reason);
    let ledger = EMPTY_GROWTH_LEDGER;
    const a = appendGrowthEntry(ledger, d.store, owner, { proposalId: "p1", note: null }, NOW);
    if (!a.ok) throw new Error(a.reason);
    ledger = a.ledger;
    const b = appendGrowthEntry(
      ledger,
      d.store,
      owner,
      { proposalId: null, note: "  Try a weekly check-in  " },
      NOW + 1,
    );
    if (!b.ok) throw new Error(b.reason);
    expect(b.ledger.entries.map((e) => [e.seq, e.kind, e.note])).toEqual([
      [1, "recommendation_dismissed", null],
      [2, "user_note", "Try a weekly check-in"],
    ]);
    expect(verifyGrowthLedger(b.ledger, owner)).toBe(true);
  });

  it("will not record an open proposal, a duplicate, another person's proposal or a blank note", () => {
    const s = created();
    expect(
      appendGrowthEntry(EMPTY_GROWTH_LEDGER, s, owner, { proposalId: "p1", note: null }, NOW),
    ).toMatchObject({
      reason: "proposal_still_open",
    });
    expect(
      appendGrowthEntry(
        EMPTY_GROWTH_LEDGER,
        s,
        { tenantRef: "t1", userRef: "u2" },
        { proposalId: "p1", note: null },
        NOW,
      ),
    ).toMatchObject({ reason: "not_owner" });
    expect(
      appendGrowthEntry(EMPTY_GROWTH_LEDGER, s, owner, { proposalId: "zz", note: null }, NOW),
    ).toMatchObject({
      reason: "unknown_proposal",
    });
    expect(
      appendGrowthEntry(EMPTY_GROWTH_LEDGER, s, owner, { proposalId: null, note: "  " }, NOW),
    ).toMatchObject({
      reason: "note_required",
    });
    expect(
      appendGrowthEntry(
        EMPTY_GROWTH_LEDGER,
        s,
        owner,
        { proposalId: null, note: "x".repeat(501) },
        NOW,
      ),
    ).toMatchObject({ reason: "note_too_long" });
    const d = dismissProposal(s, "p1", ME, NOW);
    if (!d.ok) throw new Error(d.reason);
    const once = appendGrowthEntry(
      EMPTY_GROWTH_LEDGER,
      d.store,
      owner,
      { proposalId: "p1", note: null },
      NOW,
    );
    if (!once.ok) throw new Error(once.reason);
    expect(
      appendGrowthEntry(once.ledger, d.store, owner, { proposalId: "p1", note: null }, NOW),
    ).toMatchObject({
      reason: "already_recorded",
    });
  });

  it("detects a tampered ledger", () => {
    const e = (seq: number, userRef = "u1") => ({
      seq,
      atMs: NOW,
      kind: "user_note" as const,
      tenantRef: "t1",
      userRef,
      proposalId: null,
      note: "n",
    });
    expect(verifyGrowthLedger({ entries: [e(1), e(2)] }, owner)).toBe(true);
    expect(verifyGrowthLedger({ entries: [e(1), e(3)] }, owner)).toBe(false);
    expect(verifyGrowthLedger({ entries: [e(1), e(2, "u2")] }, owner)).toBe(false);
  });
});

describe("property: no sequence of calls approves a prediction or hands off without approval", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it("holds over 3000 random operations", () => {
    const r = rng(20261113);
    let store = EMPTY_PROPOSAL_STORE;
    const actors: Actor[] = [
      ME,
      { ...ME, userRef: "u2" },
      { ...ME, heldPermissions: [] },
      { ...ME, tenantRef: "t2" },
    ];
    const handedOff = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const id = `r${Math.floor(r() * 12)}`;
      const actor = actors[Math.floor(r() * actors.length)];
      const now = NOW + i * 1000;
      const roll = r();
      if (roll < 0.25) {
        const isPred = r() < 0.4;
        store = createProposal(
          store,
          np({
            proposalId: id,
            kind: isPred ? "prediction" : "recommendation",
            operationId: isPred ? null : "scholar.attendance.flag_followup",
            inputRef: isPred ? null : "ref",
            requiredPermission: isPred ? null : "attendance.take",
            confidence: isPred ? 0.5 : null,
          }),
          CONTRACTS,
          now,
        ).store;
      } else if (roll < 0.5) store = approveProposal(store, id, actor, now).store;
      else if (roll < 0.62) store = dismissProposal(store, id, actor, now).store;
      else if (roll < 0.72) store = acknowledgeProposal(store, id, actor, now).store;
      else if (roll < 0.9) {
        const h = prepareExecution(store, id, actor, CONTRACTS, now);
        if (h.ok) {
          expect(handedOff.has(id)).toBe(false);
          handedOff.add(id);
        }
        store = h.store;
      } else store = expireProposals(store, now);

      for (const p of store.proposals) {
        if (p.kind === "prediction") {
          expect(["proposed", "dismissed", "acknowledged", "expired"]).toContain(p.status);
          expect(p.operationId).toBeNull();
        }
        if (p.status === "handed_off") expect(p.userRef).toBe("u1");
      }
    }
    // Every handoff has an approval record before it in the audit trail.
    for (const id of handedOff) {
      const kinds = store.audit.filter((a) => a.proposalId === id).map((a) => a.kind);
      expect(kinds.indexOf("approved")).toBeGreaterThanOrEqual(0);
      expect(kinds.indexOf("approved")).toBeLessThan(kinds.indexOf("handed_off"));
    }
    const seqs = store.audit.map((a) => a.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});

describe("guard: no twin code path writes canonical records", () => {
  const dir = resolve(__dirname, "../../frontend/src/lib/scholar/personal-twin");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("finds the twin modules", () => {
    expect(files).toEqual(
      expect.arrayContaining(["proposals.ts", "role-lens.ts", "sleep-wake.ts"]),
    );
  });

  it("no twin module touches a database client, server function, network or storage", () => {
    for (const f of files) {
      const src = strip(readFileSync(resolve(dir, f), "utf8"));
      for (const banned of [
        /@supabase\//,
        /integrations\/supabase/,
        /createServerFn/,
        /\bcreateClient\b/,
        /\.from\(\s*["'`]/,
        /\.(insert|upsert|delete)\s*\(/,
        /\.rpc\s*\(/,
        /\bfetch\s*\(/,
        /XMLHttpRequest/,
        /\bprocess\.env\b/,
        /\blocalStorage\b|\bsessionStorage\b/,
        /\bsetInterval\b|\bsetTimeout\b/,
      ]) {
        expect(src, `${f} matched ${banned}`).not.toMatch(banned);
      }
    }
  });

  it("twin modules import only from an explicit allowlist", () => {
    const allowed = [
      /^@\/lib\/agent-core$/,
      /^@\/lib\/agent-runtime\/ephemeral-lifecycle$/,
      /^\.\.\/ai-safety$/,
      /^\.\.\/api-contracts$/,
      /^\.\.\/roles\/[\w.-]+$/,
      /^\.\/[\w-]+$/,
    ];
    for (const f of files) {
      const src = strip(readFileSync(resolve(dir, f), "utf8"));
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(
          allowed.some((a) => a.test(spec)),
          `${f} imports ${spec}`,
        ).toBe(true);
      }
    }
  });
});
