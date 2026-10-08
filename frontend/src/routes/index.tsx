import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/contexts/app-context";
import { authenticatedDestinationForRole } from "@/lib/runtime/nav-registry";
import { PublicSchoolSite } from "@/components/public/site";
import { SherivsHome } from "@/components/sherivs/public/home";
import { PublicShell } from "@/components/sherivs/public/public-shell";
import { StateBlock } from "@/components/sherivs/primitives";
import { BRAND, BRAND_PAGE_DESCRIPTION, BRAND_PAGE_TITLE, canonicalUrl } from "@/lib/experience/brand";
import { resolveLandingPlane } from "@/lib/experience/landing.functions";

/**
 * `/` — context dispatcher.
 *
 *   tenant context (host or ?school=slug)  → that organization's public site
 *   signed in, linked, on the platform host → the person's resolved workspace
 *   anyone else                             → the Sherivs public homepage
 *
 * The post-auth destination is resolved from installed runtimes × authorized
 * capabilities (never a hardcoded runtime). Tenant context is resolved by
 * the app context, never trusted from the client beyond the slug lookup.
 */
export const Route = createFileRoute("/")({
  component: Index,
  // Resolved on the server from the request URL so the public homepage is
  // server-rendered for anonymous platform visitors (SEO) and organization
  // sites keep their loading state until tenant data arrives.
  loader: () => resolveLandingPlane(),
  head: () => ({
    meta: [
      { title: BRAND_PAGE_TITLE },
      { name: "description", content: BRAND_PAGE_DESCRIPTION },
      { property: "og:title", content: BRAND_PAGE_TITLE },
      { property: "og:description", content: BRAND_PAGE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonicalUrl("/") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/") }],
  }),
});

function Index() {
  const { loading, school, tenantSlug, role } = useApp();
  const landing = Route.useLoaderData();
  const navigate = useNavigate();

  const destination = !loading && role && !tenantSlug ? authenticatedDestinationForRole(role) : null;

  useEffect(() => {
    if (destination?.kind === "workspace") {
      navigate({ to: destination.path, replace: true });
    }
  }, [destination, navigate]);

  // Per-tenant document title + meta description + OG image + JSON-LD
  useEffect(() => {
    if (!school) return;
    const prevTitle = document.title;
    const tagline =
      (school.hero_subheadline as string | null) ??
      (school.motto as string | null) ??
      "Official website";
    document.title = `${school.name} — ${tagline}`;
    const desc = ((school.about as string | null) ?? tagline).slice(0, 300);

    function upsertMeta(attr: "name" | "property", key: string, value: string) {
      let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const prev = tag?.content ?? null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.content = value;
      return () => {
        if (!tag) return;
        if (prev === null) tag.remove();
        else tag.content = prev;
      };
    }

    const cleanup: Array<() => void> = [];
    cleanup.push(upsertMeta("name", "description", desc));
    cleanup.push(upsertMeta("property", "og:title", `${school.name}`));
    cleanup.push(upsertMeta("property", "og:description", desc));
    cleanup.push(upsertMeta("property", "og:type", "website"));
    cleanup.push(upsertMeta("property", "og:url", window.location.href));
    const logo = (school.logo_url as string | null) ?? null;
    if (logo) {
      cleanup.push(upsertMeta("property", "og:image", logo));
      cleanup.push(upsertMeta("name", "twitter:image", logo));
    }
    cleanup.push(upsertMeta("name", "twitter:card", logo ? "summary_large_image" : "summary"));

    // JSON-LD: EducationalOrganization + BreadcrumbList
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    const phone = (school.phone as string | null) ?? undefined;
    const email = (school.email as string | null) ?? undefined;
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "EducationalOrganization",
        name: school.name,
        description: desc,
        url: window.location.href,
        logo: logo ?? undefined,
        email,
        telephone: phone,
        address: (school.address as string | null)
          ? { "@type": "PostalAddress", streetAddress: school.address as string }
          : undefined,
        contactPoint:
          phone || email
            ? {
                "@type": "ContactPoint",
                contactType: "admissions",
                telephone: phone,
                email,
              }
            : undefined,
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: window.location.href },
        ],
      },
    ]);
    document.head.appendChild(ld);

    return () => {
      document.title = prevTitle;
      cleanup.forEach((fn) => fn());
      ld.remove();
    };
  }, [school]);

  // Organization context is known from the URL but its data has not loaded:
  // hold an honest loading state. On the platform plane the public homepage
  // renders immediately (server-side too); a signed-in visitor is redirected
  // by the effect above once their session resolves.
  if (loading && landing.tenantSlug) {
    return (
      <div className="grid min-h-dvh place-items-center bg-plane-0 px-4">
        <StateBlock kind="loading" title={`Resolving your ${BRAND.name} context`} compact />
      </div>
    );
  }

  // Tenant context (subdomain OR ?school=slug) → render that organization's public site
  if (school) {
    return <PublicSchoolSite school={school} />;
  }

  // Signed in and linked, but the authorized capability set resolves to no
  // workspace chrome: say so honestly instead of guessing a destination.
  if (destination?.kind === "unlinked") {
    return (
      <PublicShell>
        <div className="sh-container sh-section">
          <StateBlock
            kind="forbidden"
            title="No workspace is projected for this account yet"
            description="Your identity is signed in, but no installed runtime contributes a workspace for your current authorization. An administrator of your organization needs to assign you a role."
          />
        </div>
      </PublicShell>
    );
  }

  // Signed-in users are redirected by the effect above; render the public
  // homepage for everyone else (and briefly while the redirect commits).
  return (
    <PublicShell>
      <SherivsHome />
    </PublicShell>
  );
}
