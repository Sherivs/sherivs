import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/contexts/app-context";
import { scholarWorkspaceHome } from "@/lib/runtime/nav-registry";
import { PublicSchoolSite } from "@/components/public/site";
import { CommandCentre } from "@/components/command-centre/command-centre";
import { SherivsPublicHome } from "@/components/public/sherivs-public-home";
import {
  PLATFORM_NAME,
  PLATFORM_TAGLINE,
  PLATFORM_PAGE_DESCRIPTION,
} from "@/lib/platform";
import { INSTALLED_RUNTIME_DESCRIPTION as SCHOLAR_RUNTIME_DESCRIPTION } from "@/lib/runtime/installed-runtimes";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      {
        name: "description",
        content: PLATFORM_PAGE_DESCRIPTION,
      },
      { property: "og:title", content: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      {
        property: "og:description",
        content: PLATFORM_PAGE_DESCRIPTION,
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://sherivs.com/" },
    ],
    links: [{ rel: "canonical", href: "https://sherivs.com/" }],
  }),
});

function Index() {
  const { loading, school, tenantSlug, role, profile, superAdmin } = useApp();
  const navigate = useNavigate();

  // Signed-in users (on the platform host, not a tenant site) → their dashboard
  useEffect(() => {
    if (!loading && role && !tenantSlug) {
      navigate({ to: scholarWorkspaceHome(role), replace: true });
    }
  }, [loading, role, tenantSlug, navigate]);

  // Per-tenant document title + meta description + OG image + JSON-LD
  useEffect(() => {
    if (!school) return;
    const prevTitle = document.title;
    const tagline =
      (school.hero_subheadline as string | null) ??
      (school.motto as string | null) ??
      "Official institutional website";
    document.title = `${school.name} — ${tagline}`;
    const desc = ((school.about as string | null) ?? tagline).slice(0, 300);

    function upsertMeta(attr: "name" | "property", key: string, value: string) {
      let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const prev = tag?.content ?? null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      } else {
        tag.content = value;
      }
      return () => {
        if (!tag) return;
        if (prev !== null) tag.content = prev;
        else tag.remove();
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
                contactType: "inquiries",
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
    return <div className="min-h-dvh grid place-items-center text-muted-foreground">Loading…</div>;
  }

  // Tenant context (subdomain OR ?school=slug) → render that organization's public site
  if (school) {
    return <PublicSchoolSite school={school} />;
  }

  // Platform super-admin operating surface
  if (profile?.super_admin || superAdmin) {
    return <CommandCentre />;
  }

  // Public visitor on sherivs.com (no tenant context) → render Sherivs Public Homepage
  return <SherivsPublicHome />;
}
