import { useMemo, useRef, useState } from "react";
import { TwinBriefPanel } from "@/components/app-shell/twin-brief-panel";
import {
  createTwinBriefClient,
  type TwinBriefRequest,
  type TwinBriefTransport,
} from "@/lib/assistant/twin-brief-client";

/** Local, synthetic data only. Rendered by the DEV-only workspace preview. */
const T0 = Date.parse("2026-11-13T08:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

type Scenario = "normal" | "empty" | "unavailable" | "error";

function fixtureBrief(nowMs: number) {
  return {
    generatedAtMs: nowMs,
    omitted: 0,
    items: [
      {
        proposalId: "fx-1",
        kind: "recommendation",
        label: "Recommendation",
        summary: "Follow up with the family of a Year 7 student about three absences this week.",
        sourceKind: "record",
        sourceDescription: "Three absences in Week 45 (demo class 7A)",
        sourceAsOfMs: nowMs - 2 * HOUR,
        confidence: null,
        actionable: true,
      },
      {
        proposalId: "fx-2",
        kind: "playbook_step",
        label: "Playbook suggestion",
        summary: "Review the weekly attendance summary before Friday's staff meeting.",
        sourceKind: "playbook",
        sourceDescription: "Playbook teacher.weekly, step 1",
        sourceAsOfMs: nowMs - 30 * HOUR,
        confidence: null,
        actionable: false,
      },
      {
        proposalId: "fx-3",
        kind: "prediction",
        label: "Prediction",
        summary: "Attendance in class 7A may dip next week.",
        sourceKind: "model",
        sourceDescription: "Trend over the last six weeks (demo data)",
        sourceAsOfMs: nowMs - 3 * HOUR,
        confidence: 0.62,
        actionable: false,
      },
    ],
  };
}

export function TwinBriefFixture() {
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [offline, setOffline] = useState(false);
  const [skewMin, setSkewMin] = useState(0);
  const skew = useRef(0);
  skew.current = skewMin * MIN;
  const clock = useRef(() => T0 + skew.current).current;

  const client = useMemo(() => {
    const transport: TwinBriefTransport = async (request: TwinBriefRequest) => {
      if (scenario === "unavailable") throw new Error("not used");
      if (scenario === "error") return { nope: true };
      if (request.op === "brief") {
        return scenario === "empty"
          ? { generatedAtMs: clock(), items: [], omitted: 0 }
          : fixtureBrief(clock());
      }
      return { ok: true };
    };
    return createTwinBriefClient(scenario === "unavailable" ? undefined : transport);
  }, [scenario, clock]);

  return (
    <section aria-labelledby="twin-brief-fixture-heading" className="twin-brief-fixture">
      <h2 id="twin-brief-fixture-heading">Twin brief (demo data)</h2>
      <div className="twin-brief-fixture-controls">
        <label>
          Scenario
          <select
            aria-label="Twin brief scenario"
            value={scenario}
            onChange={(e) => {
              setScenario(e.target.value as Scenario);
              setSkewMin(0);
            }}
          >
            <option value="normal">Normal</option>
            <option value="empty">Empty</option>
            <option value="unavailable">Service not available</option>
            <option value="error">Server error</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={offline}
            onChange={(e) => setOffline(e.target.checked)}
            aria-label="Simulate offline"
          />{" "}
          Simulate offline
        </label>
        <button
          type="button"
          onClick={() => {
            skew.current += 20 * MIN;
            setSkewMin((m) => m + 20);
            // The panel re-reads the clock when the tab becomes visible again.
            document.dispatchEvent(new Event("visibilitychange"));
          }}
        >
          Advance clock 20 min
        </button>
      </div>
      <TwinBriefPanel
        client={client}
        contextKey="fixture|demo-school|teacher"
        clock={clock}
        forceOnline={!offline}
      />
    </section>
  );
}
