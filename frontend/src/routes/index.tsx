import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/contexts/app-context";
import { resolveMemberWorkspaceHome } from "@/lib/runtime/nav-registry";
import { PublicSchoolSite } from "@/components/public/site";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { SherivsHome } from "@/components/sherivs/home";
import { SystemState } from "@/components/sherivs/system-state";
import { publicPageHead } from "@/content/sherivs/seo";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => publicPageHead("/"),
});

function Index() {
  const { loading, school, tenantSlug, role, profile, superAdmin } = useApp();
  const navigate = useNavigate();

  // Signed-in users (on the platform host, not a tenant site) → their dashboard
  useEffect(() => {
    if (!loading && role && !tenantSlug) {
      navigate({ to: resolveMemberWorkspaceHome(role), replace: true });
    }
  }, [loading, role, tenantSlug, navigate]);

  // Per-tenant document title + meta description + OG image + JSON-LD
  useEffect(() => {
    if (!school) return;
    const prevTitle = document.title;
    const tagline =
      (school.hero_subheadline as string | null) ??
      (school.motto as string | null) ??
      "Official school website";
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
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = canonical?.href ?? null;
    if (canonical) canonical.href = window.location.href;
    cleanup.push(() => {
      if (canonical && previousCanonical) canonical.href = previousCanonical;
    });
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

  if (loading) {
    return (
      <div data-sx="" className="grid min-h-dvh place-items-center px-6">
        <SystemState kind="loading" title="Opening Sherivs" headingLevel="h1" />
      </div>
    );
  }

  // Tenant context (subdomain OR ?school=slug) renders that organization's public site.
  if (school) {
    return <PublicSchoolSite school={school} />;
  }

  return (
    <SherivsPublicShell>
      <SherivsHome />
    </SherivsPublicShell>
  );
}
