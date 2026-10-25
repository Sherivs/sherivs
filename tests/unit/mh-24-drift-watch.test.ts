import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * H2-24 (J-038) — structural + behavioral contract for
 * .github/workflows/drift-watch.yml, the CI workflow that consumes the
 * governed evolution baseline continuously:
 *
 *   1. the registry drift check (scripts/verify-registry-drift.mjs) runs on
 *      every push to main — undeclared drift fails CI, declared drift passes
 *      with its record attached;
 *   2. the domain-neutrality guard (scripts/verify-domain-neutrality.mjs)
 *      runs with its verdict grepped from the verifier's own output;
 *   3. the baseline-tamper tripwire fails any push where
 *      NEUTRALITY_GUARD_BASELINE.json changed while the neutrality verifier
 *      reports NEW violations (shrink-only ratchet — a baseline edit is only
 *      legitimate together with a corresponding evidence regeneration, i.e. a
 *      verifier PASS on the resulting tree).
 *
 * The tripwire decision function is extracted verbatim from the workflow
 * (marker-delimited) and executed here, so this suite tests the SHIPPED
 * logic, not a copy.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "drift-watch.yml");
const BASELINE_PATH = join(
  ROOT,
  "architecture",
  "coregrid-mvp-architecture",
  "NEUTRALITY_GUARD_BASELINE.json",
);
const DECLARATION_PATH = join(ROOT, "scripts", "verification", "registry-drift-declaration.json");

const requireJsYaml = createRequire(import.meta.url);
const yaml = requireJsYaml("js-yaml") as { load: (src: string) => unknown };

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
  if?: string;
  id?: string;
}

interface Job {
  name?: string;
  steps?: Step[];
}

interface TripwireInput {
  baselineChanged: boolean;
  declarationChanged: boolean;
  neutralityExit: number;
  verdict: string;
}

interface TripwireDecision {
  fail: boolean;
  kind: string;
  reason: string;
}

type TripwireDecisionFn = (input: TripwireInput) => TripwireDecision;

const workflowSource = readFileSync(WORKFLOW_PATH, "utf8");
// js-yaml's default schema resolves the unquoted YAML 1.1 key `on` to the
// boolean `true`; accept either representation so the test does not depend on
// that quirk.
const doc = yaml.load(workflowSource) as Record<string, unknown>;

function triggerSection(): Record<string, unknown> {
  const on = doc["on"] ?? (doc as unknown as Record<string, unknown>)[true as unknown as string];
  expect(on, "workflow must declare trigger events").toBeDefined();
  return (on ?? {}) as Record<string, unknown>;
}

function job(): Job {
  const jobs = doc.jobs as Record<string, Job> | undefined;
  expect(jobs, "workflow must declare at least one job").toBeDefined();
  const entries = Object.values(jobs ?? {});
  expect(entries.length, "workflow must declare exactly one job").toBe(1);
  return entries[0];
}

function steps(): Step[] {
  return job().steps ?? [];
}

function findStep(predicate: (s: Step) => boolean): Step | undefined {
  return steps().find(predicate);
}

function loadTripwireDecision(): TripwireDecisionFn {
  const tripwire = findStep((s) => (s.name ?? "").toLowerCase().includes("tripwire"));
  const run = tripwire?.run ?? "";
  const begin = "// TRIPWIRE-DECISION-BEGIN";
  const end = "// TRIPWIRE-DECISION-END";
  const i = run.indexOf(begin);
  const j = run.indexOf(end);
  expect(i, "tripwire decision markers must be present in the workflow").toBeGreaterThan(-1);
  expect(j, "tripwire decision markers must be present in the workflow").toBeGreaterThan(i);
  const body = run.slice(i + begin.length, j);
  const factory = new Function(`${body}\nreturn tripwireDecision;`) as () => TripwireDecisionFn;
  return factory();
}

describe("drift-watch workflow (H2-24 / J-038): consume the evolution baseline continuously", () => {
  it("parses as a workflow with the contracted triggers (push to master + weekly cron + manual)", () => {
    expect(doc.name).toBe("Drift Watch");
    const triggers = triggerSection();
    const push = triggers.push as { branches?: string[] } | undefined;
    expect(push?.branches).toContain("master");
    expect(triggers.workflow_dispatch).toBeDefined();
    const schedule = triggers.schedule as { cron: string }[] | undefined;
    expect(Array.isArray(schedule)).toBe(true);
    expect(schedule?.length).toBeGreaterThan(0);
    // 5-field cron with wildcard day-of-month/month and a pinned day-of-week:
    // a weekly cadence, not daily.
    for (const entry of schedule ?? []) {
      expect(entry.cron).toMatch(/^\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\d$/);
    }
  });

  it("is least-privilege and fully offline (contents: read, no secrets, no installs, no cache)", () => {
    expect(doc.permissions).toEqual({ contents: "read" });
    expect(workflowSource).not.toMatch(/secrets\./);
    expect(workflowSource).not.toMatch(/npm\s+(ci|install)/);
    expect(workflowSource).not.toMatch(/cache:/);
    expect(workflowSource).not.toMatch(/curl\s|wget\s/);
    for (const step of steps()) {
      if (step.uses) {
        expect(["actions/checkout@v4", "actions/setup-node@v4"]).toContain(step.uses);
      }
    }
  });

  it("runs the registry drift check and the domain-neutrality guard", () => {
    expect(
      findStep((s) => (s.run ?? "").includes("node scripts/verify-registry-drift.mjs")),
    ).toBeDefined();
    expect(
      findStep((s) => (s.run ?? "").includes("node scripts/verify-domain-neutrality.mjs")),
    ).toBeDefined();
  });

  it("greps the neutrality verdict from the verifier's own output and records it for the tripwire", () => {
    const neutrality = findStep((s) => (s.run ?? "").includes("verify-domain-neutrality.mjs"));
    expect(neutrality?.id).toBe("neutrality");
    expect(neutrality?.run).toContain("grep -oE 'STATUS=(PASS|FAIL)'");
    expect(neutrality?.run).toContain('echo "exit_code=$code"');
    expect(neutrality?.run).toContain('echo "verdict=');
    const tripwire = findStep((s) => (s.name ?? "").toLowerCase().includes("tripwire"));
    expect(tripwire?.env?.EVENT_BEFORE).toBe("${{ github.event.before }}");
    expect(tripwire?.env?.NEUTRALITY_EXIT).toBe("${{ steps.neutrality.outputs.exit_code }}");
    expect(tripwire?.env?.NEUTRALITY_VERDICT).toBe("${{ steps.neutrality.outputs.verdict }}");
  });

  it("diffs the baseline and declaration against the push's before-commit with full checkout history", () => {
    const checkout = findStep((s) => (s.uses ?? "").startsWith("actions/checkout@"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    const tripwire = findStep((s) => (s.name ?? "").toLowerCase().includes("tripwire"));
    const run = tripwire?.run ?? "";
    expect(run).toContain("--name-only");
    expect(run).toContain("architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json");
    expect(run).toContain("scripts/verification/registry-drift-declaration.json");
    // Single-quoted heredoc delimiter: no shell interpolation of the diff
    // arguments; execFileSync keeps git invocation fail-closed.
    expect(run).toContain("<<'NODE'");
    expect(run).toContain("execFileSync");
    // The wired artifact paths must actually exist — no typo'd tripwire.
    expect(() => readFileSync(BASELINE_PATH)).not.toThrow();
    expect(() => readFileSync(DECLARATION_PATH)).not.toThrow();
  });

  it("runs the tripwire even when earlier steps fail (single failure point, if: always())", () => {
    const tripwire = findStep((s) => (s.name ?? "").toLowerCase().includes("tripwire"));
    expect(tripwire?.if).toBe("always()");
  });
});

describe("baseline-tamper tripwire decision function (extracted verbatim from the workflow)", () => {
  const tripwireDecision = loadTripwireDecision();

  it("passes a clean run", () => {
    const d = tripwireDecision({
      baselineChanged: false,
      declarationChanged: false,
      neutralityExit: 0,
      verdict: "STATUS=PASS",
    });
    expect(d.fail).toBe(false);
  });

  it("allows a baseline edit accompanied by regenerated evidence (verifier PASS on the resulting tree)", () => {
    const d = tripwireDecision({
      baselineChanged: true,
      declarationChanged: false,
      neutralityExit: 0,
      verdict: "STATUS=PASS",
    });
    expect(d.fail).toBe(false);
  });

  it("fails the tamper case: baseline changed while the verifier reports NEW violations", () => {
    const d = tripwireDecision({
      baselineChanged: true,
      declarationChanged: false,
      neutralityExit: 1,
      verdict: "STATUS=FAIL",
    });
    expect(d.fail).toBe(true);
    expect(d.kind).toBe("baseline-tamper");
  });

  it("fails a plain neutrality failure without mislabeling it as tamper", () => {
    const d = tripwireDecision({
      baselineChanged: false,
      declarationChanged: false,
      neutralityExit: 1,
      verdict: "STATUS=FAIL",
    });
    expect(d.fail).toBe(true);
    expect(d.kind).not.toBe("baseline-tamper");
  });

  it("refuses to pass on a verdict it cannot read (fail-closed)", () => {
    for (const verdict of ["", "UNREADABLE", "STATUS=MAYBE", "pass"]) {
      const d = tripwireDecision({
        baselineChanged: false,
        declarationChanged: false,
        neutralityExit: 0,
        verdict,
      });
      expect(d.fail, `verdict ${JSON.stringify(verdict)} must not pass`).toBe(true);
    }
  });

  it("treats an unreadable exit code as unverifiable rather than passing", () => {
    const d = tripwireDecision({
      baselineChanged: false,
      declarationChanged: false,
      neutralityExit: Number.NaN,
      verdict: "STATUS=PASS",
    });
    expect(d.fail).toBe(true);
  });

  it("fails when the verdict contradicts the exit code in either direction", () => {
    expect(
      tripwireDecision({
        baselineChanged: false,
        declarationChanged: false,
        neutralityExit: 0,
        verdict: "STATUS=FAIL",
      }).fail,
    ).toBe(true);
    expect(
      tripwireDecision({
        baselineChanged: false,
        declarationChanged: false,
        neutralityExit: 1,
        verdict: "STATUS=PASS",
      }).fail,
    ).toBe(true);
  });

  it("does not fail on a declaration-only change (declaration honesty is gated by the drift check)", () => {
    const d = tripwireDecision({
      baselineChanged: false,
      declarationChanged: true,
      neutralityExit: 0,
      verdict: "STATUS=PASS",
    });
    expect(d.fail).toBe(false);
  });
});
