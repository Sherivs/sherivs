import { createFileRoute } from "@tanstack/react-router";
import { SherivsEmptyResource } from "@/components/sherivs-public/interior";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources/case-studies")({
  component: CaseStudyIndex,
  head: () => ({
    meta: [
      { title: `Case studies — ${PLATFORM_NAME}` },
      { name: "description", content: "Customer stories. None published yet." },
    ],
  }),
});

function CaseStudyIndex() {
  return (
    <article>
      <header className="sv-public-wrap border-b border-border py-16">
        <p className="sv-kicker">Resources · Case studies</p>
        <h1 className="sv-display mt-3">Case studies</h1>
      </header>
      <SherivsEmptyResource
        title="No case studies published"
        body="Customer stories are not invented. This index stays empty until an authorized publication exists."
      />
    </article>
  );
}
