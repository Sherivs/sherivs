import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import {
  communicationStewardReport,
  stewardReportSummary,
} from "@/lib/communication-steward-report";

/**
 * Phase 10 — Communication Platform: the Communication Steward surface.
 *
 * Access is enforced by the platform's own authorization layers, not by this page: the
 * route lives behind the authenticated portal and the control plane's server-side gate.
 * Nothing here declares a role list, and nothing here hides a failure — every check is
 * rendered with the observation that produced it, and every gap the platform has not
 * closed is named in the open.
 */
export const Route = createFileRoute("/_authenticated/super-admin/communication-steward")({
  component: CommunicationStewardPage,
  head: () => ({ meta: [{ title: "Communication steward — Sherivs" }] }),
});

function CommunicationStewardPage() {
  const report = communicationStewardReport();

  return (
    <PortalPage
      title="Communication steward"
      subtitle="Every organization subscribed to Sherivs communication receives an autonomous steward. This page states the authority it holds, the checks that prove the authority is bounded, and what the platform cannot yet do."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">
          Self-check: {report.passed}/{report.checks.length} passed
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{stewardReportSummary(report)}</p>
        <p className="mt-2 text-sm">
          {report.healthy
            ? "Every mandate rule behaved as its contract requires, on real organizations."
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
        <h2 className="font-display text-lg font-bold">Mandates in force</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.organizations.length} organizations provisioned · {report.vocabulary.actionKinds}{" "}
          action kinds, {report.vocabulary.personFacingActions} of which reach a person
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Organization</th>
              <th className="py-2">Tenant</th>
              <th className="py-2">Autonomy</th>
              <th className="py-2">Jurisdictions</th>
              <th className="py-2">Languages</th>
              <th className="py-2">Seats</th>
            </tr>
          </thead>
          <tbody>
            {report.organizations.map((organization) => (
              <tr key={organization.tenantId} className="border-t border-border">
                <td className="py-2">{organization.organizationName}</td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">
                  {organization.tenantId}
                </td>
                <td className="py-2">{organization.autonomy}</td>
                <td className="py-2">{organization.jurisdictions.join(", ") || "none"}</td>
                <td className="py-2">{organization.languages.join(", ") || "none"}</td>
                <td className="py-2">{organization.seats}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Provider routing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.providers.adapters} adapters · {report.providers.discovered} discovered ·{" "}
          {report.providers.live.length} live · {report.providers.channels} channels
        </p>
        <p className="mt-2 text-sm">
          Live today:{" "}
          <span className="font-mono text-[11px]">
            {report.providers.live.join(", ") || "none"}
          </span>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Catalogue findings: {report.providers.catalogueFindings.length}
        </p>
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
        <h2 className="font-display text-lg font-bold">What the platform cannot yet do</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.gaps.length} declared gaps. A steward decides what may be communicated; these are
          the parts that are not yet real, stated here rather than discovered by a customer.
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
