import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: "Contact Sherivs" },
      {
        name: "description",
        content:
          "How to reach Sherivs: request a demo, create an account, or work through your organization administrator.",
      },
      { property: "og:title", content: "Contact Sherivs" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/contact` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/contact` }],
  }),
});

function ContactPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="Contact"
        lead="The fastest route depends on who you are. Every path below is real — this page lists no addresses, inboxes or phone numbers that do not exist."
        updated="2026-10-08"
      >
        <DocSection heading="Evaluate Sherivs for your organization">
          <p>
            <Link to="/request-demo" className="underline underline-offset-4">
              Request a demo
            </Link>{" "}
            to start a conversation about running your institution on Sherivs.
          </p>
        </DocSection>
        <DocSection heading="Create an account">
          <p>
            <Link to="/auth" className="underline underline-offset-4">
              Sign up or sign in
            </Link>
            . After account creation, an administrator links your identity to your
            organization&apos;s tenant with the roles and policies that apply to you.
          </p>
        </DocSection>
        <DocSection heading="Already inside an organization">
          <p>
            Members reach support through their organization administrator, who manages membership,
            roles and access for their tenant. Platform health is always visible at{" "}
            <Link to="/status" className="underline underline-offset-4">
              /status
            </Link>
            .
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
