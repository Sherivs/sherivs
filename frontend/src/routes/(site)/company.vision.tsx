import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/company/vision")({
  component: VisionPage,
  head: () =>
    publicHead({
      title: "Vision and mission",
      description:
        "Sherivs exists so institutions can connect people, agents, and twins in a governed computing environment — without confusing that ambition with what ships today.",
      path: "/company/vision",
    }),
});

function VisionPage() {
  return (
    <MarketingPage
      eyebrow="Company"
      title="Vision and mission"
      lead="A world where institutions can work together intelligently without surrendering control of identity, records, or policy."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "Company" },
        { href: "/company/vision", label: "Vision" },
      ]}
    >
      <Section labelledBy="mission-heading">
        <PageContainer className="max-w-3xl space-y-4 py-16 text-sm leading-relaxed text-sherivs-muted sm:text-base">
          <h2 id="mission-heading" className="font-display text-xl font-semibold text-sherivs-white">
            Mission
          </h2>
          <p>
            Build institutional computing: a shared environment that connects humans, organizations,
            AI agents, and digital twins, then turns authorized intelligence into verifiable action.
          </p>
          <p>
            We distinguish that mission from the current product. Education through Scholar can be used today. Other
            runtimes, a public developer platform, and a complete twin runtime are not claimed as
            generally available.
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
