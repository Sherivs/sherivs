/**
 * Local demo only (VITE_WORKSPACE_VISUAL_FIXTURE=1 on a loopback host): the real
 * interview engine running in memory behind the real screen. Synthetic data; no
 * network, no storage, no server function is called.
 */
import { useMemo, useState } from "react";
import {
  InstitutionInterviewScreen,
  type InterviewApi,
} from "@/components/app-shell/institution-interview-screen";
import type { InterviewOutcome } from "@/lib/runtime/scholar/reality-interview.functions";
import {
  TYPE_QUESTION_ID,
  applyAnswer,
  approveInterview,
  buildInterviewView,
  clearAnswer,
  emptyInterview,
  parseInterview,
  type DiscoveryAnswer,
  type InterviewState,
} from "@/lib/scholar/reality";

const NOW = 1_800_000_000_000;
const human = (questionId: string, value: DiscoveryAnswer["value"]): DiscoveryAnswer => ({
  questionId,
  state: "confirmed",
  value,
  source: "human",
});

function seed(name: string): { state: InterviewState; notes: string[] } {
  let s = emptyInterview(NOW);
  const put = (a: DiscoveryAnswer) => {
    const r = applyAnswer(s, a, NOW);
    if (r.ok) s = r.state;
  };
  if (name === "fresh") return { state: s, notes: [] };
  if (name === "unsupported") {
    put(human(TYPE_QUESTION_ID, "islamic"));
    return { state: s, notes: [] };
  }
  put(human(TYPE_QUESTION_ID, "secondary"));
  put(human("core.layout.campus_count", 1));
  put(human("core.layout.campuses", ["Main campus"]));
  put(human("core.academics.calendar_kind", "term"));
  if (name === "progress") return { state: s, notes: [] };
  put(human("secondary.academics.structure", "combined"));
  put(human("secondary.academics.streams", ["science", "arts"]));
  put({ questionId: "core.academics.shifts", state: "unknown", source: "human" });
  put({ questionId: "core.services.boarding", state: "not_applicable", source: "human" });
  if (name === "ready") return { state: s, notes: [] };
  const a = approveInterview(s, "demo-admin", NOW + 60_000);
  if (a.ok) s = a.state;
  if (name === "approved") return { state: s, notes: [] };
  // "withdrawn": a stored approval that no longer matches is withdrawn with a note.
  const stored = JSON.parse(JSON.stringify(s));
  stored.answers["core.academics.calendar_kind"].value = "semester";
  const parsed = parseInterview(stored, NOW + 120_000);
  return { state: parsed.state, notes: [...parsed.notes] };
}

const SCENARIOS = [
  ["fresh", "Just started"],
  ["progress", "In progress"],
  ["ready", "Ready to approve"],
  ["approved", "Approved"],
  ["withdrawn", "Approval withdrawn"],
  ["unsupported", "Out-of-scope type"],
] as const;

function localApi(initial: { state: InterviewState; notes: string[] }): InterviewApi {
  let state = initial.state;
  const notes = initial.notes;
  const view = () => buildInterviewView(state, notes);
  const done = (
    r:
      | { ok: true; state: InterviewState }
      | { ok: false; issues: readonly { code: string; message: string }[] },
  ): InterviewOutcome => {
    if (r.ok) {
      state = r.state;
      return { ok: true, view: view() };
    }
    return { ok: false, issues: r.issues, view: view() };
  };
  return {
    get: async () => view(),
    submit: async (answer, rev) =>
      done(applyAnswer(state, { ...answer, source: "human" } as DiscoveryAnswer, NOW + 1000, rev)),
    clear: async (id, rev) => done(clearAnswer(state, id, NOW + 1000, rev)),
    approve: async (rev) => done(approveInterview(state, "demo-admin", NOW + 2000, rev)),
  };
}

export function InterviewFixture() {
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number][0]>("progress");
  const api = useMemo(() => localApi(seed(scenario)), [scenario]);
  return (
    <section aria-label="School interview demo" data-testid="interview-fixture">
      <p>
        <strong>Local demo — synthetic data.</strong> The real interview engine runs in memory;
        nothing is saved or sent.
      </p>
      <div
        role="group"
        aria-label="Demo scenario"
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      >
        {SCENARIOS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={scenario === key}
            onClick={() => setScenario(key)}
            data-testid={`interview-scenario-${key}`}
          >
            {label}
          </button>
        ))}
      </div>
      <InstitutionInterviewScreen key={scenario} api={api} />
    </section>
  );
}
