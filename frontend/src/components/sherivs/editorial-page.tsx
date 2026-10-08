import type { ReactNode } from "react";
import { SHERIVS_BRAND } from "@/lib/brand/sherivs-brand";
import { publicFooterGroups, publicNavPages, type PublicPage } from "@/lib/experience/public-pages";
import { SECURITY_GUARANTEES } from "@/routes/(site)/-content/site-content";
import { formatTierPrice, MARKETING_TIERS } from "@/routes/(site)/-content/pricing-tiers";

function Mark({ title }: { title: string }) {
  return (
    <span className="sx-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="22" height="22">
        <rect x="4" y="6" width="16" height="2" fill="currentColor" />
        <rect x="4" y="15" width="24" height="2" fill="currentColor" />
        <rect x="4" y="24" width="10" height="2" fill="currentColor" />
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function SherivsFrame({
  children,
  home = false,
}: {
  children: ReactNode;
  home?: boolean;
}) {
  const nav = publicNavPages();
  const groups = publicFooterGroups();
  const year = 2026;

  return (
    <div className="sx-public">
      <header className="sx-header">
        <div className="sx-frame sx-header-row">
          <a href="/" className="sx-brand">
            <Mark title={SHERIVS_BRAND.customerName} />
            <span>{SHERIVS_BRAND.customerName}</span>
          </a>
          <nav aria-label="Primary" className="sx-nav">
            {nav.map((page) => (
              <a key={page.id} href={page.path}>
                {page.navLabel}
              </a>
            ))}
            <a href="/platform">Platform</a>
          </nav>
          <a className="sx-signin" href="/auth">
            Sign in
          </a>
        </div>
      </header>
      <main id="main-content" className={home ? "sx-home" : "sx-doc"}>
        {children}
      </main>
      <footer className="sx-footer">
        <div className="sx-frame sx-footer-grid">
          <div>
            <p className="sx-brand sx-brand-static">
              <Mark title="" />
              {SHERIVS_BRAND.customerName}
            </p>
            <p className="sx-footer-lead">{SHERIVS_BRAND.category}</p>
            <p className="sx-meta">{SHERIVS_BRAND.publicDomain}</p>
          </div>
          {[...groups.entries()].map(([group, pages]) => (
            <nav key={group} aria-label={group}>
              <p className="sx-kicker">{group}</p>
              <ul>
                {pages.map((page) => (
                  <li key={page.id}>
                    <a href={page.path}>{page.title}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="sx-frame sx-footer-base">
          <p>© {year} {SHERIVS_BRAND.customerName}</p>
          <p>
            <a href="/status">Status</a>
            <a href="/legal/privacy">Privacy</a>
            <a href="/legal/terms">Terms</a>
            <a href="/legal/accessibility">Accessibility</a>
            <a href="/legal/cookies">Cookies</a>
            <a href="/contact">Contact</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export function EditorialPage({ page }: { page: PublicPage }) {
  return (
    <SherivsFrame>
      <article className="sx-frame sx-article">
        <p className="sx-kicker">{page.kicker}</p>
        <h1>{page.title}</h1>
        <p className="sx-lead">{page.description}</p>
        {page.blocks.map((block, index) => {
          if (block.type === "prose") {
            return (
              <div key={index} className="sx-prose">
                {block.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            );
          }
          if (block.type === "definitions") {
            return (
              <dl key={index} className="sx-defs">
                {block.items.map((item) => (
                  <div key={item.term}>
                    <dt>{item.term}</dt>
                    <dd>{item.detail}</dd>
                  </div>
                ))}
              </dl>
            );
          }
          if (block.type === "process") {
            return (
              <ol key={index} className="sx-process">
                {block.steps.map((step, stepIndex) => (
                  <li key={step.label}>
                    <span>0{stepIndex + 1}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            );
          }
          return (
            <ul key={index} className="sx-links">
              {block.items.map((item) => (
                <li key={item.href + item.label}>
                  <a href={item.href}>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
          );
        })}
        {page.id === "security" && (
          <dl className="sx-defs">
            {SECURITY_GUARANTEES.map((guarantee) => (
              <div key={guarantee.id}>
                <dt>{guarantee.title}</dt>
                <dd>{guarantee.description}</dd>
              </div>
            ))}
          </dl>
        )}
        {page.id === "pricing" && (
          <div className="sx-prices">
            {MARKETING_TIERS.map((tier) => (
              <section key={tier.id} aria-labelledby={`tier-${tier.id}`}>
                <h2 id={`tier-${tier.id}`}>{tier.name}</h2>
                <p className="sx-price">
                  {formatTierPrice(tier.monthlyPrice)}
                  {tier.monthlyPrice !== null && <span> / month</span>}
                </p>
                <p>{tier.summary}</p>
                <ul>
                  {tier.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
                <a href="/auth">{tier.ctaLabel}</a>
              </section>
            ))}
          </div>
        )}
      </article>
    </SherivsFrame>
  );
}

export function pageHead(page: PublicPage) {
  const canonical = `${SHERIVS_BRAND.publicOrigin}${page.path}`;
  return {
    meta: [
      { title: `${page.title} — ${SHERIVS_BRAND.customerName}` },
      { name: "description", content: page.description },
      { property: "og:title", content: `${page.title} — ${SHERIVS_BRAND.customerName}` },
      { property: "og:description", content: page.description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
    ],
    links: [{ rel: "canonical", href: canonical }],
  };
}
