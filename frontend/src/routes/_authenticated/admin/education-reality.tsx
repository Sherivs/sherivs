import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

import { PortalPage } from "@/components/portal-shell";
import { getCurrentInstitutionOperatingModelDetail } from "@/lib/runtime/scholar/scholar-institution-config.functions";
import { educationRealityView } from "@/lib/education-reality-view";

/**
 * Phase 04 — Educational Reality Engine: workspace projection.
 *
 * Answers §1 of the phase document from REAL state: the institution's published
 * operating model (`cg_entity`, own tenant only, resolved server-side). When
 * nothing is published the page says so — it never renders a school that does not
 * exist, and it never invents counts.
 */
export const Route = createFileRoute("/_authenticated/admin/education-reality")({
  ssr: false,
  // Access is enforced by the /admin layout guard and, for the data itself, by the
  // canonical server-side gate in `getCurrentInstitutionOperatingModelDetail`
  // (the actor's own tenant). No role list is declared here: role catalogs are data.
  component: EducationRealityPage,
});

function EducationRealityPage() {
  const read = useServerFn(getCurrentInstitutionOperatingModelDetail);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["education-reality"],
    queryFn: () => read(),
  });

  const view = educationRealityView(data ?? null);

  return (
    <PortalPage
      title="Educational reality"
      subtitle="How this institution actually operates — read from its published operating model, not from assumptions."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">Operating model</h2>
        <p className="mt-2 text-sm text-muted-foreground">{view.summary}</p>
        {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <p className="mt-3 text-sm text-destructive">
            {error instanceof Error ? error.message : "Could not read the operating model"}
          </p>
        )}
        {view.status === "published" && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-semibold">{view.version}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Published</dt>
              <dd className="font-semibold">
                {view.publishedAt ? view.publishedAt.slice(0, 10) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Levels</dt>
              <dd className="font-semibold">{view.counts.levels}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Programmes</dt>
              <dd className="font-semibold">{view.counts.programmes}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Curricula</dt>
              <dd className="font-semibold">{view.counts.curricula}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Subjects</dt>
              <dd className="font-semibold">{view.counts.subjects}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">What the runtime represents</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {view.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          Reality graph vocabulary: {view.vocabulary.entityTypes.length} entity type(s),{" "}
          {view.vocabulary.relationshipTypes.length} relationship type(s) — bound to the kernel
          reality model, never redefined here.
        </p>
      </section>
    </PortalPage>
  );
}
