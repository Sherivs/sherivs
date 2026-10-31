import type { ReactNode } from "react";
import {
  Breadcrumbs,
  GlassPanel,
  PageContainer,
  PageHero,
  PublicButton,
} from "@/components/public/ui";
import { JsonLd } from "@/components/public/json-ld";
import { breadcrumbJsonLd } from "@/lib/public-site/seo";

export function MarketingPage({
  eyebrow,
  title,
  lead,
  crumbs,
  actions,
  heroId,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  crumbs: readonly { href: string; label: string }[];
  actions?: ReactNode;
  heroId?: string;
  children: ReactNode;
}) {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs.map((c) => ({ name: c.label, path: c.href })))} />
      <PageContainer className="pt-8">
        <Breadcrumbs items={crumbs} />
      </PageContainer>
      <PageHero id={heroId} eyebrow={eyebrow} title={title} lead={lead} actions={actions} />
      {children}
      <PageContainer className="py-12">
        <GlassPanel className="flex flex-col items-center justify-center gap-3 px-6 py-8 text-center sm:flex-row sm:px-10">
          <PublicButton href="/onboarding">Get started</PublicButton>
          <PublicButton href="/contact" variant="secondary">
            Contact Sherivs
          </PublicButton>
        </GlassPanel>
      </PageContainer>
    </>
  );
}
