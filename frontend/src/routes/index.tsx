import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/contexts/app-context";
import { PublicSchoolSite } from "@/components/public/site";
import { SherivsHome } from "@/components/public/sherivs-home";
import { identityFromAppState } from "@/lib/identity/context";
import { resolveTenantDomain, resolveTenantSlug } from "@/lib/tenant";
import { PLATFORM_NAME, PLATFORM_URL } from "@/lib/platform";
import {
  resolveExperienceHost,
  shouldRedirectCanonicalRootToAuth,
} from "@/lib/experience/experience-host";
import { headConsoleSlugFromHost } from "@/lib/head-console/host";
import { isGovHost } from "@/lib/gov/host";
import { readRequestHostname } from "@/lib/experience/experience-host.functions";

async function loaderHostname(): Promise<string> {
  if (typeof window !== "undefined") return window.location.hostname;
  return readRequestHostname();
}

export const Route = createFileRoute("/")({
  loader: async () => {
    const hostname = await loaderHostname();
    // SHERIVS-B01: console.<inst>.sherivs.com is the institution head console.
    if (headConsoleSlugFromHost(hostname)) throw redirect({ to: "/head" });
    // SHERIVS-B02: gov.sherivs.com and <state>.gov.sherivs.com open the government console.
    if (isGovHost(hostname)) throw redirect({ to: "/gov" });
    const hostKind = resolveExperienceHost(hostname);
    // App and console must not SSR the public marketing homepage.
    if (shouldRedirectCanonicalRootToAuth(hostKind)) {
      throw redirect({ to: "/auth" });
    }
    return { hostname, hostKind };
  },
  component: Index,
  head: () => ({
    meta: [
      {
        title: `${PLATFORM_NAME} — The operating intelligence for modern organizations`,
      },
      {
        name: "description",
        content:
          "Sherivs connects your organization's people, knowledge, workflows, communications, data, and AI workforce into one intelligent operating environment.",
      },
      {
        property: "og:title",
        content: `${PLATFORM_NAME} — Intelligent operating infrastructure for organizations`,
      },
      {
        property: "og:description",
        content:
          "One intelligent operating environment for organizations: people, knowledge, workflows, AI workforce, and operations — governed by design.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PLATFORM_URL}/` },
      { property: "og:image", content: `${PLATFORM_URL}/og-image.png` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${PLATFORM_URL}/og-image.png` },
    ],
    links: [{ rel: "canonical", href: `${PLATFORM_URL}/` }],
  }),
});

function Index() {
  const { loading, school, tenantSlug, role, profile, superAdmin, platformStaff } = useApp();
  const navigate = useNavigate();

  // Identity-based routing (§11): signed-in users on the platform host (not a
  // tenant site) go to their resolved identity destination — internal
  // workforce → /internal, organization member → their workspace home,
  // multiple memberships → the selector, unlinked → /welcome.
  const identity = identityFromAppState({ superAdmin, profile, school, platformStaff });
  useEffect(() => {
    if (!loading && (role || profile || superAdmin || platformStaff) && !tenantSlug) {
      navigate({ to: identity.destination, replace: true });
    }
  }, [
    loading,
    role,
    profile,
    superAdmin,
    platformStaff,
    tenantSlug,
    identity.destination,
    navigate,
  ]);

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
    // Platform context (sherivs.com host, server render, or no tenant
    // signal): render the public homepage immediately so crawlers and
    // browser previews receive the real hero/CTA markup instead of a
    // loading shell (§27 SEO, §28 performance). Tenant hosts keep the
    // loading state — their site content resolves asynchronously.
    if (resolveTenantSlug() === null && resolveTenantDomain() === null) {
      return <SherivsHome />;
    }
    return <div className="min-h-dvh grid place-items-center text-muted-foreground">Loading…</div>;
  }

  // Tenant context (subdomain OR ?school=slug) → render that school's public site
  if (school) {
    return <PublicSchoolSite school={school} />;
  }

  // Sherivs public company homepage — PLANE 1. The platform's internal
  // operating surface (Sherivs Control) lives behind authentication, never
  // on the public company site.
  return <SherivsHome />;
}
