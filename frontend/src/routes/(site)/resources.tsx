import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources")({
  component: ResourcesPage,
  head: () => ({
    meta: [
      { title: `Resources — ${PLATFORM_NAME}` },
      { name: "description", content: PUBLIC_PAGES.resources.lead },
    ],
  }),
});

function ResourcesPage() {
  return (
    <>
      <SherivsInteriorPage page={PUBLIC_PAGES.resources} />
      <nav aria-label="Resource indexes" className="sv-public-wrap grid gap-3 pb-16 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/resources/docs", label: "Docs" },
          { href: "/resources/guides", label: "Guides" },
          { href: "/resources/blog", label: "Blog" },
          { href: "/resources/case-studies", label: "Case studies" },
        ].map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="border border-border px-4 py-3 text-sm font-semibold hover:bg-accent"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </>
  );
}
