import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsEmptyResource } from "@/components/sherivs-public/interior";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources/blog")({
  component: PlatformBlogIndex,
  head: () => ({
    meta: [
      { title: `Blog — ${PLATFORM_NAME}` },
      {
        name: "description",
        content: "Sherivs writing. Organization blogs remain on tenant sites.",
      },
    ],
  }),
});

function PlatformBlogIndex() {
  return (
    <article>
      <header className="sv-public-wrap border-b border-border py-16">
        <p className="sv-kicker">Resources · Blog</p>
        <h1 className="sv-display mt-3">Blog</h1>
        <p className="mt-5 max-w-2xl text-muted-foreground">
          Platform writing will be listed here when published. Tenant organization blogs continue to
          live on each organization's public site.
        </p>
      </header>
      <SherivsEmptyResource
        title="No platform posts yet"
        body="Organization-authored posts are available on a tenant site via /blog when that organization has published them."
      />
      <p className="sv-public-wrap pb-16 text-sm">
        <Link to="/blog" className="font-semibold underline-offset-4 hover:underline">
          Open tenant blog route →
        </Link>
      </p>
    </article>
  );
}
