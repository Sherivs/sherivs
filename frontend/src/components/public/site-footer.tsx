import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { FOOTER_GROUPS } from "@/lib/public-site/navigation";
import { PUBLIC_CONTACTS, PUBLIC_SOCIAL_LINKS } from "@/lib/public-site/contacts";
import { publishedPartners } from "@/lib/public-site/partners";
import { publishedCompliance } from "@/lib/public-site/compliance";
import { SherivsLogo } from "@/components/brand/sherivs-logo";

export function SiteFooter() {
  const partners = publishedPartners();
  const compliance = publishedCompliance();
  const social = PUBLIC_SOCIAL_LINKS.filter((item) => item.published);

  return (
    <footer className="border-t border-[var(--sherivs-border)] bg-[var(--sherivs-midnight)]">
      <div className="mx-auto grid w-full max-w-[var(--sherivs-container-wide)] gap-8 px-4 py-12 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-4 xl:grid-cols-6">
        <div className="xl:col-span-2">
          <SherivsLogo size={28} wordmarkClassName="text-base" />
          <p className="mt-3 max-w-xs text-sherivs-muted">{PLATFORM_TAGLINE}</p>
          <p className="mt-4 text-sherivs-muted">
            Sales{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.sales}`}>
              {PUBLIC_CONTACTS.sales}
            </a>
          </p>
          <p className="mt-1 text-sherivs-muted">
            Support{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.support}`}>
              {PUBLIC_CONTACTS.support}
            </a>
          </p>
        </div>
        {FOOTER_GROUPS.map((group) => (
          <nav key={group.id} aria-label={group.label} className="grid gap-2 content-start">
            <p className="text-xs font-semibold uppercase tracking-widest text-sherivs-muted">
              {group.label}
            </p>
            {group.items.map((item) => (
              <Link
                key={item.href}
                to={item.href as never}
                className="text-sherivs-muted hover:text-sherivs-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>

      {partners.length > 0 ? (
        <div className="mx-auto max-w-[var(--sherivs-container-wide)] px-4 pb-8 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-sherivs-muted">
            Verified technology integrations
          </p>
          <ul className="mt-3 flex flex-wrap gap-3 text-sm text-sherivs-muted">
            {partners.map((partner) => (
              <li key={partner.id} className="rounded-full border border-[var(--sherivs-border)] px-3 py-1">
                {partner.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {compliance.length > 0 ? (
        <div className="mx-auto max-w-[var(--sherivs-container-wide)] px-4 pb-8 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-sherivs-muted">
            Trust principles
          </p>
          <ul className="mt-3 flex flex-wrap gap-3 text-sm text-sherivs-muted">
            {compliance.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {social.length > 0 ? (
        <div className="mx-auto flex max-w-[var(--sherivs-container-wide)] flex-wrap gap-4 px-4 pb-6 sm:px-6">
          {social.map((item) => (
            <a key={item.href} href={item.href} rel="noopener noreferrer" className="text-sm text-sherivs-cyan">
              {item.label}
            </a>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col items-center justify-between gap-3 border-t border-[var(--sherivs-border)] px-4 py-4 text-xs text-sherivs-muted sm:flex-row sm:px-6">
        <p>
          © {new Date().getFullYear()} {PLATFORM_NAME}. Institutional computing for organizations.
        </p>
        <a href="#main-content" className="hover:text-sherivs-white">
          Back to top
        </a>
      </div>
    </footer>
  );
}
