import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { GeneratedSite } from "@/components/generated/generated-site";
import { featureCodesForReality } from "@/lib/scholar/capability-codes";
import { experiencePresetKeys } from "@/lib/scholar/experience/experience-presets";
import {
  buildGeneratedSiteView,
  classAudienceIndex,
  organizationClassLabel,
} from "@/lib/surfaces/generated-site-view";

export const Route = createFileRoute("/reality/$class")({
  component: RealityPreview,
  head: () => ({
    meta: [
      { title: "Generated environment — Sherivs" },
      {
        name: "description",
        content:
          "Every Sherivs organization class generates its own digital environment: sections, brand, navigation, manifest and internal workspaces derived from the organization's reality.",
      },
    ],
  }),
});

function RealityPreview() {
  const { class: orgType } = Route.useParams();
  const view = useMemo(() => buildGeneratedSiteView({ orgType }), [orgType]);
  const audiences = useMemo(() => classAudienceIndex(orgType), [orgType]);
  const codes = useMemo(() => featureCodesForReality(view.experience.reality), [view]);
  const otherClasses = useMemo(
    () => experiencePresetKeys().filter((key) => key !== orgType),
    [orgType],
  );

  useEffect(() => {
    const previous = document.title;
    document.title = `${organizationClassLabel(orgType)} — generated environment — Sherivs`;
    return () => {
      document.title = previous;
    };
  }, [orgType]);

  return (
    <GeneratedSite
      view={view}
      footer={
        <footer className="mx-auto w-full max-w-5xl space-y-4 px-4 pb-12">
          <section className="rounded-xl border border-border p-6">
            <h2 className="font-display text-sm font-semibold">
              Feature codes this reality installs ({codes.length})
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {codes.map((entry) => (
                <Badge
                  key={entry.code}
                  variant="secondary"
                  className="border-0 font-mono text-[10px]"
                >
                  {entry.code}
                </Badge>
              ))}
              {codes.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  None — this organization class declares no runtime features yet; its own
                  vocabulary arrives with its runtime (the kernel forces nothing).
                </p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border p-6">
            <h2 className="font-display text-sm font-semibold">Audiences this reality serves</h2>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {audiences.map((entry) => (
                <li key={entry.audience}>
                  <span className="font-medium text-foreground">{entry.audience}</span> ← roles in{" "}
                  {entry.roleCategories.join(", ")}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border p-6">
            <h2 className="font-display text-sm font-semibold">Other organization classes</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {otherClasses.map((key) => (
                <Link
                  key={key}
                  to="/reality/$class"
                  params={{ class: key }}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
                >
                  {organizationClassLabel(key)}
                </Link>
              ))}
            </div>
            <nav className="mt-3 flex flex-wrap gap-4 text-xs">
              <Link to="/" className="underline">
                Sherivs Control
              </Link>
              <Link to="/platform" className="underline">
                The platform
              </Link>
              <a href="/marketplace" className="underline">
                Marketplace catalog
              </a>
              <a
                href={`/manifest.webmanifest?class=${encodeURIComponent(orgType)}`}
                className="underline"
              >
                Served manifest
              </a>
            </nav>
          </section>
          <p className="text-[11px] text-muted-foreground">
            R40 — generated public-site renderer. Content is bound per tenant; this class preview is
            deliberately not tenant-bound and says so.
          </p>
        </footer>
      }
    />
  );
}
