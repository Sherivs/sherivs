import type { ReactNode } from "react";
import { Breadcrumbs, PageContainer, PageHero, PublicButton } from "@/components/public/ui";
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
      <div className="border-b border-[var(--sherivs-border)]">
        <PageContainer className="pt-8">
          <Breadcrumbs items={crumbs} />
        </PageContainer>
      </div>
      <PageHero id={heroId} eyebrow={eyebrow} title={title} lead={lead} actions={actions} />
      {children}
      <div className="border-t border-[var(--sherivs-border)]">
        <PageContainer className="flex flex-col gap-3 py-12 sm:flex-row">
          <PublicButton href="/request-demo">Request a demo</PublicButton>
          <PublicButton href="/contact" variant="secondary">
            Contact Sherivs
          </PublicButton>
        </PageContainer>
      </div>
    </>
  );
}
