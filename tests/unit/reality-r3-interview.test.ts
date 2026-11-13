/**
 * SV1-REALITY R3 (#334) — adaptive V1 school onboarding interview engine.
 * Seeded PRNG property tests; no database, network or AI.
 */
import { describe, expect, it } from "vitest";
import {
  QUESTION_REGISTRY,
  SUPPORTED_INTERVIEW_TYPES,
  TYPE_QUESTION_ID,
  applyAnswer,
  approveInterview,
  approvedSnapshot,
  blockers,
  clearAnswer,
  currentRegistryHash,
  dormantAnswerIds,
  emptyInterview,
  interviewContentHash,
  interviewType,
  isApprovalValid,
  nextQuestion,
  parseInterview,
  progress,
  review,
  visibleQuestions,
  visibleQuestionsIn,
  type DiscoveryAnswer,
  type DiscoveryQuestion,
  type InterviewState,
} from "../../frontend/src/lib/scholar/reality";

const T0 = 1_800_000_000_000;
const H = (questionId: string, value: DiscoveryAnswer["value"]): DiscoveryAnswer => ({
  questionId,
  state: "confirmed",
  value,
  source: "human",
});
const S = (
  questionId: string,
  state: DiscoveryAnswer["state"],
  extra: Partial<DiscoveryAnswer> = {},
): DiscoveryAnswer => ({
  questionId,
  state,
  source: "human",
  ...extra,
});

function must(state: InterviewState, a: DiscoveryAnswer, t = T0): InterviewState {
  const r = applyAnswer(state, a, t);
  if (!r.ok) throw new Error(`${a.questionId}: ${r.issues.map((i) => i.code).join(",")}`);
  return r.state;
}

function validValue(q: DiscoveryQuestion): DiscoveryAnswer["value"] {
  const v = q.validation;
  switch (q.answerType) {
    case "single":
      return v.options![0];
    case "multi":
      return [v.options![0]];
    case "bool":
      return true;
    case "number":
      return Math.min(Math.max(v.min ?? 1, 1), v.max ?? 1000);
    case "repeating_group":
    case "hierarchy":
      return ["Main campus"];
    case "date":
      return "2026-09-01";
    case "time":
      return "08:00";
    default:
      return "Head teacher";
  }
}

/** Answer every required visible question until none is open. */
function fill(type: string, t = T0): InterviewState {
  let s = must(emptyInterview(t), H(TYPE_QUESTION_ID, type), t);
  for (let i = 0; i < 60; i++) {
    const q = nextQuestion(s);
    if (!q || !q.required) break;
    s = must(s, H(q.id, validValue(q)), t);
  }
  return s;
}

describe("R3 interview: adapts to the school type", () => {
  it("starts with the type question only and says what is next", () => {
    const s = emptyInterview(T0);
    expect(visibleQuestions(s).map((q) => q.id)).toEqual([TYPE_QUESTION_ID]);
    expect(nextQuestion(s)?.id).toBe(TYPE_QUESTION_ID);
    expect(blockers(s)).toEqual([{ code: "type_unset", questionId: TYPE_QUESTION_ID }]);
  });

  it("supported types: nursery/creche, primary and JSS/SSS only", () => {
    expect([...SUPPORTED_INTERVIEW_TYPES]).toEqual(["creche", "primary", "secondary"]);
  });

  it("each supported type sees only questions registered for it", () => {
    for (const type of SUPPORTED_INTERVIEW_TYPES) {
      const s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, type));
      const ids = visibleQuestions(s).map((q) => q.id);
      for (const id of ids) {
        const q = QUESTION_REGISTRY.find((x) => x.id === id)!;
        expect(q.institutionTypes).toContain(type);
      }
      expect(ids).toContain("core.academics.calendar_kind");
    }
    const primary = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    expect(visibleQuestions(primary).map((q) => q.id)).toContain("primary.academics.levels");
    expect(visibleQuestions(primary).map((q) => q.id)).not.toContain(
      "secondary.academics.structure",
    );
    const secondary = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "secondary"));
    expect(visibleQuestions(secondary).map((q) => q.id)).toContain("secondary.academics.structure");
    expect(visibleQuestions(secondary).map((q) => q.id)).not.toContain("primary.academics.levels");
  });

  it("types outside this slice are refused and nothing else is asked", () => {
    for (const type of ["islamic", "special_needs", "multi_institution_group"]) {
      const s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, type));
      expect(interviewType(s).status).toBe("unsupported");
      expect(visibleQuestions(s).map((q) => q.id)).toEqual([TYPE_QUESTION_ID]);
      expect(blockers(s)).toEqual([{ code: "type_unsupported", questionId: TYPE_QUESTION_ID }]);
      expect(applyAnswer(s, H("core.layout.campus_count", 1), T0)).toMatchObject({ ok: false });
      expect(approveInterview(s, "admin-1", T0)).toMatchObject({ ok: false });
    }
  });

  it("a type that is only claimed, not confirmed, opens nothing", () => {
    for (const state of ["pending", "unknown"] as const) {
      const s = must(emptyInterview(T0), S(TYPE_QUESTION_ID, state));
      expect(visibleQuestions(s).map((q) => q.id)).toEqual([TYPE_QUESTION_ID]);
    }
  });

  it("branches from confirmed answers: arms, streams, campuses", () => {
    let s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    const ids = () => visibleQuestions(s).map((q) => q.id);
    expect(ids()).not.toContain("primary.academics.arm_names");
    s = must(s, H("primary.academics.arms_enabled", true));
    expect(ids()).toContain("primary.academics.arm_names");
    s = must(s, H("primary.academics.arms_enabled", false));
    expect(ids()).not.toContain("primary.academics.arm_names");

    expect(ids()).not.toContain("core.layout.campuses");
    s = must(s, H("core.layout.campus_count", 2));
    expect(ids()).toContain("core.layout.campuses");

    let sec = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "secondary"));
    const sids = () => visibleQuestions(sec).map((q) => q.id);
    expect(sids()).not.toContain("secondary.academics.streams");
    sec = must(sec, H("secondary.academics.structure", "jss_only"));
    expect(sids()).not.toContain("secondary.academics.streams");
    sec = must(sec, H("secondary.academics.structure", "sss_only"));
    expect(sids()).toContain("secondary.academics.streams");
  });

  it("never branches on an unconfirmed answer", () => {
    for (const state of ["pending", "unknown"] as const) {
      const s = must(
        must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary")),
        S("primary.academics.arms_enabled", state),
      );
      expect(visibleQuestions(s).map((q) => q.id)).not.toContain("primary.academics.arm_names");
    }
    const conflict = must(
      must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary")),
      S("primary.academics.arms_enabled", "conflicting", { candidates: [true, false] }),
    );
    expect(visibleQuestions(conflict).map((q) => q.id)).not.toContain(
      "primary.academics.arm_names",
    );
  });

  it("a question hidden by a branch cannot be answered", () => {
    const s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    expect(applyAnswer(s, H("primary.academics.arm_names", ["A"]), T0)).toMatchObject({
      ok: false,
      issues: [{ code: "question_not_visible" }],
    });
    expect(applyAnswer(s, H("secondary.academics.structure", "combined"), T0)).toMatchObject({
      ok: false,
    });
  });
});

describe("R3 interview: unknown is not No, and nothing is inferred", () => {
  it("an unanswered question reviews as unknown with no value", () => {
    const s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    const row = review(s).find((r) => r.questionId === "primary.academics.arms_enabled")!;
    expect(row.state).toBe("unknown");
    expect(row.value).toBeNull();
  });

  it("false and unknown are different answers", () => {
    const base = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    const no = must(base, H("primary.academics.arms_enabled", false));
    const dunno = must(base, S("primary.academics.arms_enabled", "unknown"));
    const rowNo = review(no).find((r) => r.questionId === "primary.academics.arms_enabled")!;
    const rowUnknown = review(dunno).find(
      (r) => r.questionId === "primary.academics.arms_enabled",
    )!;
    expect(rowNo).toMatchObject({ state: "confirmed", value: false });
    expect(rowUnknown).toMatchObject({ state: "unknown", value: null });
    expect(interviewContentHash(no)).not.toBe(interviewContentHash(dunno));
    expect(interviewContentHash(dunno)).toBe(interviewContentHash(base));
  });

  it("an unknown or value-carrying 'unknown' answer is rejected", () => {
    const base = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    expect(
      applyAnswer(base, S("primary.academics.arms_enabled", "unknown", { value: false }), T0),
    ).toMatchObject({
      ok: false,
    });
  });

  it("approving leaves unanswered optional questions unknown and out of the snapshot", () => {
    const done = approve(fill("primary"));
    const snap = approvedSnapshot(done);
    expect(snap.map((a) => a.questionId)).not.toContain("primary.academics.arms_enabled");
    expect(
      review(done).find((r) => r.questionId === "primary.academics.arms_enabled"),
    ).toMatchObject({
      state: "unknown",
      value: null,
    });
  });

  it("only human answers are accepted; AI and system output is refused", () => {
    const base = emptyInterview(T0);
    for (const source of ["ai", "system"] as const) {
      expect(applyAnswer(base, { ...H(TYPE_QUESTION_ID, "primary"), source }, T0)).toMatchObject({
        ok: false,
        issues: [{ code: "source_not_allowed" }],
      });
    }
    expect(
      applyAnswer(base, { ...H(TYPE_QUESTION_ID, "primary"), state: "inferred" }, T0),
    ).toMatchObject({ ok: false });
  });

  it("not_applicable only where the question allows it", () => {
    const base = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    expect(applyAnswer(base, S("core.services.boarding", "not_applicable"), T0)).toMatchObject({
      ok: true,
    });
    expect(applyAnswer(base, S("core.finance.fee_model", "not_applicable"), T0)).toMatchObject({
      ok: false,
    });
  });

  it("a conflict needs two candidates and carries no value", () => {
    const base = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    expect(
      applyAnswer(base, S("core.academics.shifts", "conflicting", { candidates: [true] }), T0),
    ).toMatchObject({ ok: false });
    expect(
      applyAnswer(
        base,
        S("core.academics.shifts", "conflicting", { candidates: [true, false] }),
        T0,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("R3 interview: input is validated and bounded", () => {
  const base = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
  it("rejects wrong types, out-of-range numbers and unlisted options", () => {
    expect(applyAnswer(base, H("core.layout.campus_count", 0), T0)).toMatchObject({ ok: false });
    expect(applyAnswer(base, H("core.layout.campus_count", 101), T0)).toMatchObject({ ok: false });
    expect(applyAnswer(base, H("core.layout.campus_count", "2" as never), T0)).toMatchObject({
      ok: false,
    });
    expect(applyAnswer(base, H("core.academics.calendar_kind", "weekly"), T0)).toMatchObject({
      ok: false,
    });
    expect(applyAnswer(base, H("primary.academics.levels", ["primary_9"]), T0)).toMatchObject({
      ok: false,
    });
    expect(applyAnswer(base, H("primary.academics.levels", []), T0)).toMatchObject({ ok: false });
  });
  it("bounds text and list sizes", () => {
    expect(applyAnswer(base, H("core.people.head_position", "x".repeat(121)), T0)).toMatchObject({
      ok: false,
    });
    const withCampuses = must(base, H("core.layout.campus_count", 1));
    expect(
      applyAnswer(withCampuses, H("core.layout.campuses", ["x".repeat(161)]), T0),
    ).toMatchObject({ ok: false, issues: [{ code: "item_too_long" }] });
    expect(
      applyAnswer(
        withCampuses,
        H(
          "core.layout.campuses",
          Array.from({ length: 101 }, () => "c"),
        ),
        T0,
      ),
    ).toMatchObject({ ok: false });
    expect(
      applyAnswer(
        withCampuses,
        { ...H("core.layout.campuses", ["A"]), evidenceRef: "e".repeat(201) },
        T0,
      ),
    ).toMatchObject({ ok: false });
  });
  it("unknown question ids are refused; extra properties never reach state", () => {
    expect(applyAnswer(base, H("core.nope.nothing", 1), T0)).toMatchObject({
      ok: false,
      issues: [{ code: "unknown_question" }],
    });
    const r = applyAnswer(
      base,
      { ...H("core.layout.campus_count", 2), role: "admin", approved: true } as never,
      T0,
    );
    expect(r.ok).toBe(true);
    expect(Object.keys(r.state.answers["core.layout.campus_count"]).sort()).toEqual([
      "questionId",
      "source",
      "state",
      "value",
    ]);
  });
  it("a rejected answer leaves the state object untouched", () => {
    const r = applyAnswer(base, H("core.layout.campus_count", 0), T0);
    expect(r.state).toBe(base);
  });
});

function approve(s: InterviewState, who = "admin-1", t = T0 + 1): InterviewState {
  const r = approveInterview(s, who, t);
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.message}:${i.questionId}`).join(";"));
  return r.state;
}

describe("R3 interview: save, resume, review and explicit approval", () => {
  it("completes for each supported type and approves only after an explicit step", () => {
    for (const type of SUPPORTED_INTERVIEW_TYPES) {
      const s = fill(type);
      expect(blockers(s)).toEqual([]);
      expect(s.manifestState).toBe("discovered");
      expect(approvedSnapshot(s)).toEqual([]);
      const a = approve(s);
      expect(a.manifestState).toBe("approved");
      expect(isApprovalValid(a)).toBe(true);
      expect(a.approval?.approvedBy).toBe("admin-1");
    }
  });

  it("refuses approval while a required question is open", () => {
    const s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    const r = approveInterview(s, "admin-1", T0);
    expect(r.ok).toBe(false);
    expect(blockers(s).every((b) => b.code === "required_open")).toBe(true);
    expect(blockers(s).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses approval while an answer is pending or conflicting, even on an optional question", () => {
    for (const a of [
      S("core.academics.shifts", "pending"),
      S("core.academics.shifts", "conflicting", { candidates: [true, false] }),
    ]) {
      const r = approveInterview(must(fill("primary"), a), "admin-1", T0);
      expect(r.ok).toBe(false);
    }
  });

  it("needs a named approver", () => {
    const s = fill("primary");
    for (const who of ["", "   ", "x".repeat(129), undefined as never, 7 as never]) {
      expect(approveInterview(s, who, T0)).toMatchObject({
        ok: false,
        issues: [{ code: "approver_required" }],
      });
    }
  });

  it("any later edit or clear withdraws the approval", () => {
    const a = approve(fill("primary"));
    const edited = must(a, H("core.people.head_position", "Principal"), T0 + 5);
    expect(edited).toMatchObject({ manifestState: "discovered", approval: null });
    expect(approvedSnapshot(edited)).toEqual([]);
    const cleared = clearAnswer(a, "core.academics.calendar_kind", T0 + 5);
    expect(cleared.ok && cleared.state).toMatchObject({
      manifestState: "discovered",
      approval: null,
    });
  });

  it("clearing returns a question to unknown, not to No", () => {
    const s = must(
      must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary")),
      H("primary.academics.arms_enabled", false),
    );
    const r = clearAnswer(s, "primary.academics.arms_enabled", T0);
    expect(r.ok).toBe(true);
    expect(
      review(r.state).find((x) => x.questionId === "primary.academics.arms_enabled"),
    ).toMatchObject({
      state: "unknown",
      value: null,
    });
    expect(clearAnswer(r.state, "primary.academics.arms_enabled", T0)).toMatchObject({
      ok: false,
      issues: [{ code: "nothing_to_clear" }],
    });
    expect(clearAnswer(r.state, "core.nope.nothing", T0)).toMatchObject({ ok: false });
  });

  it("stale editors are refused instead of overwriting (revision check on every change)", () => {
    const s = fill("primary");
    const rev = s.revision;
    const stale = rev - 1;
    expect(applyAnswer(s, H("core.people.head_position", "A"), T0, stale)).toMatchObject({
      ok: false,
      issues: [{ code: "revision_conflict" }],
    });
    expect(clearAnswer(s, "core.academics.calendar_kind", T0, stale)).toMatchObject({
      ok: false,
      issues: [{ code: "revision_conflict" }],
    });
    expect(approveInterview(s, "a", T0, stale)).toMatchObject({
      ok: false,
      issues: [{ code: "revision_conflict" }],
    });
    expect(applyAnswer(s, H("core.people.head_position", "A"), T0, rev)).toMatchObject({
      ok: true,
    });
  });

  it("progress counts unknown separately and reports open work", () => {
    const empty = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    const p0 = progress(empty);
    expect(p0.answered).toBe(1);
    expect(p0.requiredOpen).toBeGreaterThan(0);
    expect(p0.unknown).toBe(p0.visible - 1);
    const done = fill("primary");
    expect(progress(done).requiredOpen).toBe(0);
    expect(progress(done).activationOpen).toBe(0);
  });

  it("flags which approved answers are public-safe without publishing anything", () => {
    const snap = approvedSnapshot(approve(fill("primary")));
    const pub = snap.filter((a) => a.publicSafe);
    expect(pub.length).toBeGreaterThan(0);
    for (const a of snap) expect(a.publicSafe).toBe(a.websiteField !== null);
    expect(snap.find((a) => a.questionId === "core.people.head_position")).toBeUndefined();
  });
});

describe("R3 interview: hidden answers never feed a branch (synthetic chain)", () => {
  const base = QUESTION_REGISTRY.find((q) => q.id === TYPE_QUESTION_ID)!;
  const mk = (id: string, when: DiscoveryQuestion["visibleWhen"]): DiscoveryQuestion => ({
    ...base,
    id,
    answerType: "bool",
    validation: {},
    visibleWhen: when,
    dependsOn: when.map((c) => c.questionId),
    institutionTypes: ["primary"],
  });
  const chain = [
    base,
    mk("t.chain.a", []),
    mk("t.chain.b", [{ questionId: "t.chain.a", op: "equals", value: true }]),
    mk("t.chain.c", [{ questionId: "t.chain.b", op: "equals", value: true }]),
  ];
  const withAnswers = (a: boolean, b: boolean): InterviewState => ({
    ...must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary")),
    answers: {
      [TYPE_QUESTION_ID]: H(TYPE_QUESTION_ID, "primary"),
      "t.chain.a": H("t.chain.a", a),
      "t.chain.b": H("t.chain.b", b),
    },
  });
  it("shows c only while both a and b hold", () => {
    expect(visibleQuestionsIn(withAnswers(true, true), chain).map((q) => q.id)).toContain(
      "t.chain.c",
    );
  });
  it("a dormant b (a is false) does not open c even though b is true", () => {
    const ids = visibleQuestionsIn(withAnswers(false, true), chain).map((q) => q.id);
    expect(ids).not.toContain("t.chain.b");
    expect(ids).not.toContain("t.chain.c");
  });
});

describe("R3 interview: approved snapshot holds confirmed answers only", () => {
  it("not-applicable and unknown answers are approved as such but never exported as values", () => {
    let s = fill("primary");
    s = must(s, S("core.services.boarding", "not_applicable"));
    s = must(s, S("core.academics.shifts", "unknown"));
    const done = approve(s);
    const ids = approvedSnapshot(done).map((a) => a.questionId);
    expect(ids).not.toContain("core.services.boarding");
    expect(ids).not.toContain("core.academics.shifts");
    expect(approvedSnapshot(done).every((a) => a.value !== undefined && a.value !== null)).toBe(
      true,
    );
    expect(review(done).find((r) => r.questionId === "core.services.boarding")).toMatchObject({
      state: "not_applicable",
      value: null,
    });
  });
});

describe("R3 interview: dormant answers", () => {
  it("an answer hidden by a branch is kept for resume but never reviewed, hashed or approved", () => {
    let s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    s = must(s, H("primary.academics.arms_enabled", true));
    s = must(s, H("primary.academics.arm_names", ["A", "B"]));
    const shownHash = interviewContentHash(s);
    s = must(s, H("primary.academics.arms_enabled", false));
    expect(dormantAnswerIds(s)).toEqual(["primary.academics.arm_names"]);
    expect(review(s).map((r) => r.questionId)).not.toContain("primary.academics.arm_names");
    const without = must(
      must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary")),
      H("primary.academics.arms_enabled", false),
    );
    expect(interviewContentHash(s)).toBe(interviewContentHash(without));
    expect(interviewContentHash(s)).not.toBe(shownHash);
    // Switching the branch back resumes it.
    s = must(s, H("primary.academics.arms_enabled", true));
    expect(review(s).find((r) => r.questionId === "primary.academics.arm_names")?.value).toEqual([
      "A",
      "B",
    ]);
  });

  it("changing the school type makes the other type's answers dormant, not approved", () => {
    let s = fill("secondary");
    s = must(s, H(TYPE_QUESTION_ID, "primary"));
    expect(dormantAnswerIds(s)).toContain("secondary.academics.structure");
    const done = fill("primary");
    expect(approvedSnapshot(approve(done)).map((a) => a.questionId)).not.toContain(
      "secondary.academics.structure",
    );
  });
});

describe("R3 interview: resume from stored state", () => {
  it("round-trips through JSON unchanged, approval included", () => {
    const a = approve(fill("secondary"));
    const back = parseInterview(JSON.parse(JSON.stringify(a)), T0 + 99);
    expect(back.ok).toBe(true);
    expect(back.notes).toEqual([]);
    expect(back.state).toEqual(a);
    expect(isApprovalValid(back.state)).toBe(true);
  });

  it("garbage is never trusted and never throws", () => {
    for (const raw of [
      null,
      undefined,
      1,
      "x",
      [],
      {},
      { schemaVersion: 2 },
      { schemaVersion: 1, answers: 5 },
    ]) {
      const r = parseInterview(raw as never, T0);
      expect(r.state.answers).toEqual({} as never);
      expect(r.state.manifestState).toBe("discovered");
    }
  });

  it("a forged approval does not survive: edited answers, missing hash, wrong hash", () => {
    const good = approve(fill("primary"));
    const edited = JSON.parse(JSON.stringify(good));
    edited.answers["core.academics.calendar_kind"].value = "block";
    const r1 = parseInterview(edited, T0);
    expect(r1.state).toMatchObject({ manifestState: "discovered", approval: null });
    expect(r1.notes.join(" ")).toMatch(/approval withdrawn/);

    const forged = JSON.parse(JSON.stringify(fill("primary")));
    forged.manifestState = "approved";
    forged.approval = { approvedAtMs: T0, approvedBy: "someone", contentHash: "0000000000000000" };
    expect(parseInterview(forged, T0).state).toMatchObject({
      manifestState: "discovered",
      approval: null,
    });

    const noHash = JSON.parse(JSON.stringify(good));
    delete noHash.approval.contentHash;
    expect(parseInterview(noHash, T0).state.manifestState).toBe("discovered");
  });

  it("a forged approval on an incomplete interview is withdrawn even with a matching hash", () => {
    const partial = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    const forged = {
      ...partial,
      manifestState: "approved" as const,
      approval: { approvedAtMs: T0, approvedBy: "x", contentHash: interviewContentHash(partial) },
    };
    expect(parseInterview(JSON.parse(JSON.stringify(forged)), T0).state.manifestState).toBe(
      "discovered",
    );
    expect(isApprovalValid(forged)).toBe(false);
  });

  it("a changed question set withdraws the approval and says so", () => {
    const good = JSON.parse(JSON.stringify(approve(fill("primary"))));
    good.registryHash = "deadbeef";
    const r = parseInterview(good, T0);
    expect(r.state.manifestState).toBe("discovered");
    expect(r.notes.join(" ")).toMatch(/question set changed/);
    expect(r.state.registryHash).toBe(currentRegistryHash());
  });

  it("drops retired, invalid, non-human and unreadable stored answers with a note", () => {
    const raw = JSON.parse(JSON.stringify(fill("primary")));
    raw.answers["core.retired.question"] = {
      questionId: "core.retired.question",
      state: "confirmed",
      value: 1,
      source: "human",
    };
    raw.answers["core.layout.campus_count"] = {
      questionId: "core.layout.campus_count",
      state: "confirmed",
      value: -5,
      source: "human",
    };
    raw.answers["core.academics.shifts"] = {
      questionId: "core.academics.shifts",
      state: "confirmed",
      value: true,
      source: "ai",
    };
    raw.answers["core.services.boarding"] = "yes";
    const r = parseInterview(raw, T0);
    expect(Object.keys(r.state.answers)).not.toContain("core.retired.question");
    expect(Object.keys(r.state.answers)).not.toContain("core.layout.campus_count");
    expect(Object.keys(r.state.answers)).not.toContain("core.academics.shifts");
    expect(Object.keys(r.state.answers)).not.toContain("core.services.boarding");
    expect(r.notes.length).toBe(4);
  });

  it("stored property names that look like prototype pollution stay inert", () => {
    const raw = JSON.parse(
      '{"schemaVersion":1,"registryHash":"x","answers":{"__proto__":{"polluted":true},"constructor":{"questionId":"constructor"}},"revision":0}',
    );
    const r = parseInterview(raw, T0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(r.state.answers)).toEqual([]);
  });
});

describe("R3 interview: random edit sequences keep the invariants (3000 steps)", () => {
  it("approval is valid only if complete and unchanged; every accepted edit leaves discovered", () => {
    let seed = 0x5eed;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let s = emptyInterview(T0);
    let approvals = 0;
    let t = T0;
    for (let i = 0; i < 3000; i++) {
      t += 1;
      const roll = rnd();
      if (roll < 0.62) {
        const visible = visibleQuestions(s);
        const q = visible[Math.floor(rnd() * visible.length)];
        const kind = rnd();
        let answer: DiscoveryAnswer =
          kind < 0.7
            ? H(q.id, rnd() < 0.15 ? "bad-value" : (validValue(q) ?? null))
            : kind < 0.8
              ? S(q.id, "unknown")
              : kind < 0.9
                ? S(q.id, "pending")
                : S(q.id, "conflicting", {
                    candidates: [validValue(q) ?? null, validValue(q) ?? null],
                  });
        if (rnd() < 0.08 && q.id === TYPE_QUESTION_ID) {
          const types = ["creche", "primary", "secondary", "islamic"];
          answer = H(TYPE_QUESTION_ID, types[Math.floor(rnd() * types.length)]);
        }
        const before = s;
        const r = applyAnswer(s, answer, t);
        if (r.ok) {
          expect(r.state.manifestState).toBe("discovered");
          expect(r.state.approval).toBeNull();
          expect(r.state.revision).toBe(before.revision + 1);
          s = r.state;
        } else {
          expect(r.state).toBe(before);
        }
      } else if (roll < 0.72) {
        const ids = Object.keys(s.answers);
        if (ids.length) {
          const r = clearAnswer(s, ids[Math.floor(rnd() * ids.length)], t);
          if (r.ok) s = r.state;
        }
      } else if (roll < 0.9) {
        const r = approveInterview(s, "admin", t);
        expect(r.ok).toBe(blockers(s).length === 0);
        if (r.ok) {
          approvals += 1;
          s = r.state;
          expect(isApprovalValid(s)).toBe(true);
          expect(approvedSnapshot(s).length).toBeGreaterThan(0);
        }
      } else {
        const back = parseInterview(JSON.parse(JSON.stringify(s)), t);
        expect(back.state).toEqual(s);
      }
      // Global invariants after every step.
      if (s.manifestState === "approved") {
        expect(blockers(s)).toEqual([]);
        expect(isApprovalValid(s)).toBe(true);
      } else {
        expect(approvedSnapshot(s)).toEqual([]);
      }
      for (const a of Object.values(s.answers)) expect(a.source).toBe("human");
    }
    expect(approvals).toBeGreaterThan(5);
  });
});
