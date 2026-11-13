/**
 * SV1-REALITY R3 (#334) — view model, form helpers, screen states and the
 * server-function boundary. No jsdom: the screen is rendered to static markup
 * and the server module is checked at the source level.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InterviewScreenView } from "../../frontend/src/components/app-shell/institution-interview-screen";
import {
  TYPE_QUESTION_ID,
  applyAnswer,
  approveInterview,
  buildInterviewView,
  displayValue,
  draftFromAnswer,
  draftToValue,
  emptyInterview,
  issueMessage,
  type DiscoveryAnswer,
  type InterviewState,
  type InterviewView,
  type QuestionView,
} from "../../frontend/src/lib/scholar/reality";

const T = 1_800_000_000_000;
const H = (questionId: string, value: DiscoveryAnswer["value"]): DiscoveryAnswer => ({
  questionId,
  state: "confirmed",
  value,
  source: "human",
});
function put(s: InterviewState, a: DiscoveryAnswer): InterviewState {
  const r = applyAnswer(s, a, T);
  if (!r.ok) throw new Error(a.questionId + ":" + r.issues.map((i) => i.code));
  return r.state;
}
function ready(): InterviewState {
  let s = put(emptyInterview(T), H(TYPE_QUESTION_ID, "primary"));
  s = put(s, H("core.layout.campus_count", 1));
  s = put(s, H("core.layout.campuses", ["Main campus"]));
  s = put(s, H("core.academics.calendar_kind", "term"));
  s = put(s, H("primary.academics.levels", ["nursery", "primary_1"]));
  return s;
}
const q = (view: InterviewView, id: string) => view.questions.find((x) => x.id === id)!;

function html(view: InterviewView, over: Partial<Parameters<typeof InterviewScreenView>[0]> = {}) {
  const noop = () => {};
  return renderToStaticMarkup(
    createElement(InterviewScreenView, {
      view,
      activeId: view.nextQuestionId,
      draft: "",
      fieldError: null,
      busy: false,
      message: null,
      confirmingApproval: false,
      onDraft: noop,
      onSave: noop,
      onUnknown: noop,
      onNotApplicable: noop,
      onEdit: noop,
      onClear: noop,
      onAskApprove: noop,
      onConfirmApprove: noop,
      onCancelApprove: noop,
      ...over,
    }),
  );
}

describe("R3 view model", () => {
  it("shows visible questions only, with input constraints, and counts dormant answers", () => {
    let s = put(emptyInterview(T), H(TYPE_QUESTION_ID, "primary"));
    s = put(s, H("primary.academics.arms_enabled", true));
    s = put(s, H("primary.academics.arm_names", ["A"]));
    s = put(s, H("primary.academics.arms_enabled", false));
    const v = buildInterviewView(s);
    expect(v.questions.map((x) => x.id)).not.toContain("primary.academics.arm_names");
    expect(v.dormantCount).toBe(1);
    expect(v.answers["primary.academics.arm_names"]).toBeUndefined();
    expect(q(v, "core.layout.campus_count")).toMatchObject({
      min: 1,
      max: 100,
      answerType: "number",
    });
    expect(q(v, "core.academics.calendar_kind").options).toContain("term");
  });
  it("carries no state, source or approver fields the client could send back", () => {
    const v = buildInterviewView(ready());
    expect(Object.keys(v).sort()).toEqual(
      [
        "answers",
        "approvalValid",
        "approvedAtMs",
        "blockers",
        "dormantCount",
        "manifestState",
        "nextQuestionId",
        "notes",
        "outOfScopeTypes",
        "progress",
        "questions",
        "revision",
        "type",
      ].sort(),
    );
    expect(JSON.stringify(v)).not.toMatch(/approvedBy|contentHash|registryHash|"source"/);
  });
  it("reports approval only while it is valid", () => {
    const a = approveInterview(ready(), "admin", T + 1);
    expect(a.ok).toBe(true);
    expect(buildInterviewView(a.state)).toMatchObject({
      approvalValid: true,
      manifestState: "approved",
    });
    const edited = put(a.state, H("core.people.head_position", "Head"));
    expect(buildInterviewView(edited)).toMatchObject({
      approvalValid: false,
      manifestState: "discovered",
      approvedAtMs: null,
    });
  });
  it("JSON round trip is lossless and serialisable", () => {
    const v = buildInterviewView(ready(), ["a note"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe("R3 form helpers", () => {
  const v = buildInterviewView(put(emptyInterview(T), H(TYPE_QUESTION_ID, "primary")));
  it("never turns a blank into No", () => {
    const bool = q(v, "primary.academics.arms_enabled");
    expect(draftToValue(bool, "")).toMatchObject({ ok: false });
    expect(draftToValue(bool, "false")).toEqual({ ok: true, value: false });
    expect(draftToValue(bool, "true")).toEqual({ ok: true, value: true });
    expect(draftFromAnswer(bool, undefined)).toBe("");
  });
  it("checks numbers, options, lists and text before sending", () => {
    const n = q(v, "core.layout.campus_count");
    expect(draftToValue(n, "")).toMatchObject({ ok: false });
    expect(draftToValue(n, "abc")).toMatchObject({ ok: false });
    expect(draftToValue(n, "0")).toMatchObject({ ok: false });
    expect(draftToValue(n, "101")).toMatchObject({ ok: false });
    expect(draftToValue(n, " 3 ")).toEqual({ ok: true, value: 3 });
    const single = q(v, "core.academics.calendar_kind");
    expect(draftToValue(single, "")).toMatchObject({ ok: false });
    expect(draftToValue(single, "weekly")).toMatchObject({ ok: false });
    expect(draftToValue(single, "term")).toEqual({ ok: true, value: "term" });
    const multi = q(v, "primary.academics.levels");
    expect(draftToValue(multi, [])).toMatchObject({ ok: false });
    expect(draftToValue(multi, ["primary_9"])).toMatchObject({ ok: false });
    expect(draftToValue(multi, ["nursery"])).toEqual({ ok: true, value: ["nursery"] });
    const text = q(v, "core.people.head_position");
    expect(draftToValue(text, "   ")).toMatchObject({ ok: false });
    expect(draftToValue(text, "x".repeat(121))).toMatchObject({ ok: false });
    const withCampus = buildInterviewView(
      put(put(emptyInterview(T), H(TYPE_QUESTION_ID, "primary")), H("core.layout.campus_count", 2)),
    );
    const list = q(withCampus, "core.layout.campuses");
    expect(draftToValue(list, " \n ")).toMatchObject({ ok: false });
    expect(draftToValue(list, "Main\n\n  Annex  ")).toEqual({ ok: true, value: ["Main", "Annex"] });
  });
  it("round-trips an answer through the editor", () => {
    const view = buildInterviewView(ready());
    const campuses = q(view, "core.layout.campuses");
    expect(draftFromAnswer(campuses, view.answers[campuses.id])).toBe("Main campus");
    expect(draftToValue(campuses, draftFromAnswer(campuses, view.answers[campuses.id]))).toEqual({
      ok: true,
      value: ["Main campus"],
    });
  });
  it("unanswered and unknown read as 'Not answered yet', never No", () => {
    const bool: QuestionView = q(v, "primary.academics.arms_enabled");
    expect(displayValue(bool, undefined)).toBe("Not answered yet");
    expect(displayValue(bool, { state: "unknown", value: null, candidates: null })).toBe(
      "Not answered yet",
    );
    expect(displayValue(bool, { state: "confirmed", value: false, candidates: null })).toBe("No");
  });
  it("issue messages are plain language and never echo raw codes", () => {
    for (const code of [
      "revision_conflict",
      "question_not_visible",
      "not_approvable",
      "weird_code",
    ]) {
      expect(issueMessage(code)).not.toMatch(/_/);
    }
  });
});

describe("R3 screen states", () => {
  it("fresh: asks the type question, 0 answered, no approve button", () => {
    const out = html(buildInterviewView(emptyInterview(T)));
    expect(out).toContain("What type of institution is this?");
    expect(out).toContain("0 of 1 answered");
    expect(out).toContain('data-status="draft"');
    expect(out).not.toContain("Approve answers");
    expect(out).toContain("I don’t know yet");
  });
  it("shows blockers by question and no approve control while work is open", () => {
    const view = buildInterviewView(put(emptyInterview(T), H(TYPE_QUESTION_ID, "primary")));
    const out = html(view);
    expect(out).toContain('data-testid="interview-blockers"');
    expect(out).toContain("Answer: How many campuses does the institution operate?");
    expect(out).not.toContain("Approve answers");
    expect(out).not.toContain("Yes, approve these answers");
  });
  it("ready: offers approval, then needs a second explicit confirmation", () => {
    const view = buildInterviewView(ready());
    const ask = html(view);
    expect(ask).toContain("Approve answers");
    expect(ask).toContain("Approving does not publish anything");
    expect(ask).not.toContain("Yes, approve these answers");
    const confirm = html(view, { confirmingApproval: true });
    expect(confirm).toContain("Yes, approve these answers");
    expect(confirm).toContain("Cancel");
    expect(confirm).toContain("Unanswered");
  });
  it("approved: says so, states nothing was published, offers no approve button", () => {
    const a = approveInterview(ready(), "admin", T + 1);
    const out = html(buildInterviewView(a.state));
    expect(out).toContain('data-status="approved"');
    expect(out).toContain("Changing any answer returns this to draft");
    expect(out).not.toContain("Approve answers");
  });
  it("unknown optional questions render as not answered, with no 'No' anywhere they were not answered", () => {
    const out = html(buildInterviewView(ready()), { activeId: null });
    const rows = out.split('data-testid="interview-row"').slice(1);
    const arms =
      rows.find((r) => r.includes("Does the school use arms")) ??
      rows.find((r) => r.includes("arms"));
    expect(arms ?? "").toContain("Not answered yet");
  });
  it("unsupported type: explains scope, asks nothing else, cannot be approved", () => {
    const view = buildInterviewView(put(emptyInterview(T), H(TYPE_QUESTION_ID, "islamic")));
    const out = html(view);
    expect(out).toContain('data-testid="interview-unsupported"');
    expect(out).toContain("nursery, primary and secondary");
    expect(out).not.toContain("Approve answers");
  });
  it("surfaces notes and messages in a polite live region", () => {
    const out = html(
      buildInterviewView(ready(), [
        "approval withdrawn: answers no longer match what was approved",
      ]),
      {
        message: { tone: "error", text: "Someone changed this interview" },
      },
    );
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("approval withdrawn");
    expect(out).toContain("Someone changed this interview");
  });
  it("is labelled: landmarks, progress bar semantics, per-row accessible names", () => {
    const out = html(buildInterviewView(ready()), { activeId: null });
    expect(out).toContain('aria-labelledby="interview-heading"');
    expect(out).toContain('role="progressbar"');
    expect(out).toMatch(/aria-label="Change: What type of institution is this\?"/);
    expect(out).toMatch(/aria-label="Clear answer: /);
  });
  it("marks public-safe fields as needing a separate website approval; nothing says it publishes", () => {
    const out = html(buildInterviewView(ready()));
    expect(out).toContain(
      "Nothing\n            is published unless you separately review".replace(
        "\n            ",
        " ",
      ),
    );
    expect(out).not.toMatch(
      /will be published|has been published|published now|is now (live|public)/i,
    );
  });
  it("renders hostile answer text as text", () => {
    const view = buildInterviewView(
      put(ready(), H("core.people.head_position", "<img src=x onerror=alert(1)>")),
      [],
    );
    const out = html(view, { activeId: null });
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain("&lt;img");
  });
});

describe("R3 server boundary (source level)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../frontend/src/lib/runtime/scholar/reality-interview.functions.ts"),
    "utf8",
  );
  it("every endpoint is behind the auth middleware and the school-admin scope", () => {
    expect((src.match(/createServerFn/g) ?? []).length).toBe(5); // import + 4 endpoints
    expect((src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length).toBe(4);
    expect((src.match(/await scope\(context\)/g) ?? []).length).toBe(4);
    expect(src).toContain("requireSchoolAdminScope");
  });
  it("input is strict and carries no tenant, state, source, approver or approval flag", () => {
    expect(src).toMatch(/answerInput = z\s*\.object\(\{[\s\S]*?\}\)\s*\.strict\(\)/);
    const inputBlock = src.slice(
      src.indexOf("const answerInput"),
      src.indexOf("export type InterviewOutcome"),
    );
    for (const forbidden of [
      "tenant",
      "school",
      "source",
      "approvedBy",
      "approval",
      "manifestState",
      "revisionHash",
    ]) {
      expect(inputBlock.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(src).toContain('source: "human"');
    expect(src).toMatch(/approveInterview\(state, context\.userId,/);
  });
  it("the tenant comes from the verified scope for every read and write", () => {
    expect((src.match(/p_tenant: schoolId/g) ?? []).length).toBe(2);
    expect(src).not.toMatch(/p_tenant: data\./);
  });
});

describe("R3 form validation is ours, not the browser's", () => {
  const screen = readFileSync(
    resolve(__dirname, "../../frontend/src/components/app-shell/institution-interview-screen.tsx"),
    "utf8",
  );
  it("the question form opts out of native validation so the announced message always shows", () => {
    expect(screen).toMatch(/<form[^>]*\bnoValidate\b[^>]*data-testid="interview-question"/);
  });
  it("invalid fields are marked and tied to the alert", () => {
    expect((screen.match(/aria-invalid=\{describedBy \? true : undefined\}/g) ?? []).length).toBe(
      2,
    );
    expect(screen).toContain('role="alert"');
  });
});
