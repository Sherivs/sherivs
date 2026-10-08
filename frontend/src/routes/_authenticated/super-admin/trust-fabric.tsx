import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import { trustFabricReport } from "@/lib/trust-fabric-report";

/**
 * Phase 09 — Security & Trust Fabric (platform, control plane).
 *
 * Access is enforced by the super-admin layout guard and, for any data, by the
 * canonical server-side gate. This page declares NO role list of its own.
 *
 * Everything rendered here is exercised, not described: each invariant is checked
 * by calling the shipped trust machine, each exercised path reports what the code
 * returned, and the gaps the fabric still has are listed instead of implied away.
 *
 * The fabric produces trust, never permission (BS): Phase 08 answers "may this
 * action happen?", and nothing on this page grants anything.
 */
export const Route = createFileRoute("/_authenticated/super-admin/trust-fabric")({
  component: TrustFabricPage,
  head: () => ({ meta: [{ title: "Trust fabric — Sherivs" }] }),
});

function TrustFabricPage() {
  const report = trustFabricReport();
  const failing = report.invariants.filter((check) => !check.holds);

  return (
    <PortalPage
      title="Trust fabric"
      subtitle="Trust is a continuously evaluated relationship, not a boolean: what the fabric records, what it verifies, and what it does not yet do."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">Self-check</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {report.verdict.satisfied} of {report.verdict.invariantCount} invariants hold (each
          checked by calling the shipped machine, not by reading this page) ·{" "}
          {report.exercises.length} exercised paths · {report.verdict.reported} capabilities
          reported as not yet executable.
        </p>
        {failing.length > 0 ? (
          <p className="mt-3 text-sm text-destructive">
            Failing invariants:{" "}
            {failing.map((check) => `${check.id} — ${check.statement}`).join("; ")}
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No invariant is failing right now. A failure here is a regression, not a style issue.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Usable trust states for the fabric: {report.usability.usableStates.join(", ")}. The
          enforcement surface reads {report.usability.phase08UsableStates.join(", ")} — the two
          definitions differ on {report.usability.differOn.join(", ") || "nothing"}, which is
          reported rather than smoothed over. Terminal states:{" "}
          {report.usability.terminalStates.join(", ") || "none"}.
        </p>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Vocabulary</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          {[
            ["Trust states", report.vocabulary.states],
            ["Subject types", report.vocabulary.subjectTypes],
            ["Relationship types", report.vocabulary.relationshipTypes],
            ["Assertion types", report.vocabulary.assertionTypes],
            ["Score factors", report.vocabulary.scoreFactors],
            ["Revocation reasons", report.vocabulary.revocationReasons],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-display text-xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Invariants ({report.invariants.length})</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Invariant</th>
              <th className="py-2">Statement</th>
              <th className="py-2">Observed</th>
            </tr>
          </thead>
          <tbody>
            {report.invariants.map((check) => (
              <tr key={check.id} className="border-t border-border align-top">
                <td className="py-2 font-mono text-xs">{check.id}</td>
                <td className="py-2">{check.statement}</td>
                <td className="py-2 text-xs text-muted-foreground">{check.observed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">
          Exercised paths ({report.exercises.length})
        </h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Area</th>
              <th className="py-2">What the code returned</th>
              <th className="py-2">Guarded</th>
            </tr>
          </thead>
          <tbody>
            {report.exercises.map((exercise) => (
              <tr key={exercise.id} className="border-t border-border align-top">
                <td className="py-2">{exercise.area}</td>
                <td className="py-2 text-xs text-muted-foreground">{exercise.outcome}</td>
                <td className="py-2 text-xs">{exercise.refused ? "yes" : "NO — review"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">
          Reported gaps ({report.gaps.length}) — declared, not enforced
        </h2>
        <ul className="mt-4 space-y-3 text-sm">
          {report.gaps.map((gap) => (
            <li key={gap.id} className="border-t border-border pt-3">
              <span className="font-mono text-xs text-muted-foreground">{gap.id}</span>{" "}
              <span className="font-medium">{gap.area}</span>
              <p className="mt-1 text-xs text-muted-foreground">{gap.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </PortalPage>
  );
}
