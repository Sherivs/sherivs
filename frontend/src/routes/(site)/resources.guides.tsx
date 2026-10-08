import { createFileRoute } from "@tanstack/react-router";
import { SherivsEmptyResource } from "@/components/sherivs-public/interior";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources/guides")({
  component: GuidesIndex,
  head: () => ({
    meta: [{ title: `Guides — ${PLATFORM_NAME}` }, { name: "description", content: "Operational guides. None published yet." }],
  }),
});

function GuidesIndex() {
  return (
    <article>
      <header className="sv-public-wrap border-b border-border py-16">
        <p className="sv-kicker">Resources · Guides</p>
        <h1 className="sv-display mt-3">Guides</h1>
      </header>
      <SherivsEmptyResource
        title="No guides published"
        body="Guides will appear here when they are authored. This index is not filled with placeholder articles."
      />
    </article>
  );
}
