import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import {
  academicIntelligenceReport,
  academicReportSummary,
} from "@/lib/academic-intelligence-report";

/**
 * Phase 11 — Academic Learning Intelligence: the phase surface.
 *
 * Access is enforced by the platform's own authorization layers, not by this page: the route
 * sits behind the authenticated portal and the control plane's server-side gate. Nothing here
 * declares a role list, and nothing here hides a failure — every check is rendered with the
 * observation that produced it, and every gap the phase has not closed is named in the open.
 */
export const Route = createFileRoute("/_authenticated/super-admin/academic-intelligence")({
  component: AcademicIntelligencePage,
  head: () => ({ meta: [{ title: "Academic intelligence — CoreGrid" }] }),
});

function AcademicIntelligencePage() {
  const report = academicIntelligenceReport();

  return (
    <PortalPage
      title="Academic intelligence"
      subtitle="What this phase computes about learning, the checks that prove it computes it correctly, and what it cannot yet do."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">
          Self-check: {report.passed}/{report.checks.length} passed
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{academicReportSummary(report)}</p>
        <p className="mt-2 text-sm">
          {report.healthy
            ? "Every academic engine behaved as its contract requires, on a real curriculum."
            : `Failing: ${report.failingChecks.join(", ")}`}
        </p>
        <ul className="mt-4 space-y-2">
          {report.checks.map((check) => (
            <li key={check.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {check.ok ? "✓" : "✗"} {check.id}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{check.proves}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{check.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Declared vocabulary</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ["Curriculum levels", report.vocabulary.curriculumLevels],
            ["Competency levels", report.vocabulary.competencyLevels],
            ["Assessment types", report.vocabulary.assessmentTypes],
            ["Cognitive levels", report.vocabulary.cognitiveLevels],
            ["Risk types", report.vocabulary.riskTypes],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-display text-lg font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Enforced rules</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Rule</th>
              <th className="py-2">Enforced by</th>
              <th className="py-2">Proved by</th>
            </tr>
          </thead>
          <tbody>
            {report.rules.map((rule) => (
              <tr key={rule.id} className="border-t border-border">
                <td className="py-2">{rule.rule}</td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">
                  {rule.enforcedBy}
                </td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">
                  {rule.provedBy}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">What the phase cannot yet do</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.gaps.length} declared gaps. The intelligence is real; these are the parts that are
          not, stated here rather than discovered later.
        </p>
        <ul className="mt-4 space-y-3">
          {report.gaps.map((gap) => (
            <li key={gap.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">{gap.id}</p>
              <p className="mt-1 text-sm">{gap.gap}</p>
              <p className="mt-1 text-xs text-muted-foreground">{gap.consequence}</p>
              <p className="mt-1 text-xs text-muted-foreground">Owner: {gap.owner}</p>
            </li>
          ))}
        </ul>
      </section>
    </PortalPage>
  );
}
