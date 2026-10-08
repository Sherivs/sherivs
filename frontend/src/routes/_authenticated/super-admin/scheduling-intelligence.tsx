import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import { buildSchedulingIntelligenceReport } from "@/lib/scheduling-intelligence-report";

/**
 * Phase 12 — Scheduling & Timetable Intelligence: the phase surface.
 *
 * Access is enforced by the platform's own authorization layers, not by this page: the route sits
 * behind the authenticated portal and the control plane's server-side gate. Nothing here declares
 * a role list, and nothing here hides a failure — every check is rendered with the observation
 * that produced it, and every gap the phase has not closed is named in the open.
 */
export const Route = createFileRoute("/_authenticated/super-admin/scheduling-intelligence")({
  component: SchedulingIntelligencePage,
  head: () => ({ meta: [{ title: "Scheduling intelligence — Sherivs" }] }),
});

/** How each kind of organization names the same scheduling concepts — supplied as data. */
const ORGANIZATION_VOCABULARY: readonly (readonly string[])[] = [
  ["Education", "Lecture", "Learner, instructor, cohort", "Room, laboratory, hall"],
  ["Healthcare", "Procedure or clinic slot", "Patient, clinician, nurse", "Theatre, ward, bay"],
  ["Logistics", "Delivery window", "Driver, crew", "Vehicle, dock"],
  ["Warehousing", "Wave or task", "Picker, operator", "Bay, forklift, aisle"],
  ["Government", "Hearing or session", "Delegate, secretary", "Committee room"],
  ["Manufacturing", "Shift run", "Operator, technician", "Line, cell, tool"],
];

function SchedulingIntelligencePage() {
  const report = buildSchedulingIntelligenceReport();

  return (
    <PortalPage
      title="Scheduling intelligence"
      subtitle="What this platform computes about constrained allocation, the checks that prove it computes it correctly, and what it cannot yet do."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">
          Self-check: {report.totals.enforced}/{report.checks.length} enforced
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{report.summary}</p>
        <p className="mt-2 text-sm">
          {report.totals.failed === 0
            ? "Every scheduling engine behaved as its contract requires, against real collisions."
            : `Failing: ${report.checks
                .filter((check) => check.status === "FAILED")
                .map((check) => check.id)
                .join(", ")}`}
        </p>
        <ul className="mt-4 space-y-2">
          {report.checks.map((check) => (
            <li key={check.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {check.status === "ENFORCED" ? "✓" : check.status === "FAILED" ? "✗" : "○"}{" "}
                {check.id} — {check.name}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{check.evidence}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">
          The same capability, in each organization's own words
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing in the engine assumes one institution's roles. An organization supplies its own
          activity types, resource types and calendars, and experiences scheduling as its own.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Organization</th>
              <th className="py-2">Schedulable activity</th>
              <th className="py-2">Participants</th>
              <th className="py-2">Resources</th>
            </tr>
          </thead>
          <tbody>
            {ORGANIZATION_VOCABULARY.map((row) => (
              <tr key={row[0]} className="border-t border-border">
                <td className="py-2 font-semibold">{row[0]}</td>
                <td className="py-2">{row[1]}</td>
                <td className="py-2">{row[2]}</td>
                <td className="py-2">{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Declared vocabulary</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Conflict types", report.totals.conflictTypes],
            ["Resolution strategies", report.totals.resolutionStrategies],
            ["Score dimensions", report.totals.scoreDimensions],
            ["Declared gaps", report.totals.gaps],
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
              <th className="py-2">Held by</th>
              <th className="py-2">Proved by</th>
            </tr>
          </thead>
          <tbody>
            {report.rules.map((rule) => (
              <tr key={rule.id} className="border-t border-border">
                <td className="py-2">{rule.statement}</td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">{rule.module}</td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">{rule.suite}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">What the phase cannot yet do</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.gaps.length} declared gaps. The engines are real; these are the parts that are
          not, stated here rather than discovered later.
        </p>
        <ul className="mt-4 space-y-3">
          {report.gaps.map((gap) => (
            <li key={gap.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">{gap.id}</p>
              <p className="mt-1 text-sm">{gap.statement}</p>
              <p className="mt-1 text-xs text-muted-foreground">{gap.why}</p>
              <p className="mt-1 text-xs text-muted-foreground">Owner: {gap.owner}</p>
            </li>
          ))}
        </ul>
      </section>
    </PortalPage>
  );
}
