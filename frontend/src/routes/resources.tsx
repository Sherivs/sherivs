import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/resources")({
  component: ResourcesPage,
  head: () => ({
    meta: [
      { title: "Sherivs resources" },
      {
        name: "description",
        content:
          "Sherivs resources: writing, platform detail, security, and live status. Only published surfaces are listed.",
      },
      { property: "og:title", content: "Sherivs resources" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/resources` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/resources` }],
  }),
});

const RESOURCES = [
  {
    to: "/blog",
    title: "Blog",
    body: "Writing from the Sherivs team on institutions, intelligence and governance.",
  },
  {
    to: "/platform",
    title: "Kernel detail",
    body: "The contracted capabilities underneath every Sherivs surface, read from the platform registry.",
  },
  {
    to: "/security",
    title: "Security and governance",
    body: "Tenant isolation, layered authorization, audit and governed AI.",
  },
  {
    to: "/solutions/education",
    title: "Sherivs for education",
    body: "The installed education runtime on the governed kernel.",
  },
  {
    to: "/status",
    title: "Platform status",
    body: "Live machine health for this deployment, read from its own health endpoint.",
  },
] as const;

function ResourcesPage() {
  return (
    <SherivsPublicShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Resources
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-tight text-balance sm:text-5xl">
          Learn Sherivs from real surfaces.
        </h1>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Only published surfaces are listed here. Guides, case studies and API documentation appear
          in this index when they exist — not before.
        </p>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCES.map((resource) => (
            <li key={resource.to}>
              <Link
                to={resource.to}
                className="block h-full rounded-xl border border-border p-5 transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <h2 className="font-display text-base font-semibold">{resource.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {resource.body}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </SherivsPublicShell>
  );
}
