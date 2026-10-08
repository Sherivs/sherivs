import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources/docs")({
  component: DocsIndex,
  head: () => ({
    meta: [
      { title: `Docs — ${PLATFORM_NAME}` },
      {
        name: "description",
        content: "Public documentation of installed platform capabilities.",
      },
    ],
  }),
});

function DocsIndex() {
  return (
    <article className="sv-public-wrap py-16 sm:py-20">
      <p className="sv-kicker">Resources · Docs</p>
      <h1 className="sv-display mt-3">Documentation</h1>
      <p className="mt-5 max-w-2xl text-base text-muted-foreground">
        These pages describe capabilities that exist in the running product. Internal engineering
        constitutions are not republished as marketing.
      </p>
      <ul className="sv-plane-list mt-10">
        <li>
          <Link to="/platform" className="font-semibold">
            Kernel capabilities
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">Installed platform primitives, by owner phase.</p>
        </li>
        <li>
          <Link to="/security" className="font-semibold">
            Security
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">Isolation, authorization, AI privacy, audit.</p>
        </li>
        <li>
          <Link to="/platform/governance" className="font-semibold">
            Governance
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">Policy outcomes and agent lifecycle.</p>
        </li>
      </ul>
    </article>
  );
}
