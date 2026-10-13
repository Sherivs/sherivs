import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/contexts/app-context";
import { PublicSchoolSite } from "@/components/public/site";
import { SherivsPublicChrome, SherivsPublicHome } from "@/components/public/sherivs-public-home";
import { PLATFORM_PAGE_DESCRIPTION, PLATFORM_PAGE_TITLE } from "@/lib/platform";
import { resolveIdentityGateway } from "@/lib/identity/identity-gateway";
import {
  resolveExperienceHost,
  shouldRedirectCanonicalRootToAuth,
} from "@/lib/experience/experience-host";
import { readRequestHostname } from "@/lib/experience/experience-host.functions";
import { INSTALLED_RUNTIME_ID } from "@/lib/runtime/installed-runtimes";

async function loaderHostname(): Promise<string> {
  if (typeof window !== "undefined") return window.location.hostname;
  return readRequestHostname();
}

export const Route = createFileRoute("/")({
  loader: async () => {
    const hostname = await loaderHostname();
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
      { title: PLATFORM_PAGE_TITLE },
      { name: "description", content: PLATFORM_PAGE_DESCRIPTION },
      { property: "og:title", content: PLATFORM_PAGE_TITLE },
      { property: "og:description", content: PLATFORM_PAGE_DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Index() {
  const { hostKind: loaderHostKind } = Route.useLoaderData();
  const { loading, school, tenantSlug, role, profile, superAdmin, session } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    const decision = resolveIdentityGateway({
      authenticated: Boolean(session),
      role,
      superAdmin: Boolean(superAdmin),
      tenantSlug,
      organizationSlug: school?.slug ?? null,
      hasOrganizationMembership: Boolean(profile && role),
      installedRuntimeId: INSTALLED_RUNTIME_ID,
      hostKind: loaderHostKind,
    });
    if (decision.destination && decision.destination !== "/") {
      navigate({ to: decision.destination as never, replace: true });
    }
  }, [
    loading,
    session,
    role,
    superAdmin,
    profile,
    tenantSlug,
    school?.slug,
    loaderHostKind,
    navigate,
  ]);

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

    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    const phone = (school.phone as string | null) ?? undefined;
    const email = (school.email as string | null) ?? undefined;
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: school.name,
        description: desc,
        url: window.location.href,
        logo: logo ?? undefined,
        email,
        telephone: phone,
        address: (school.address as string | null)
          ? { "@type": "PostalAddress", streetAddress: school.address as string }
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

  if (school && !role && !superAdmin) {
    return <PublicSchoolSite school={school} />;
  }

  if (school && (role || superAdmin)) {
    return (
      <div className="min-h-dvh grid place-items-center text-muted-foreground">
        Opening workspace…
      </div>
    );
  }

  return (
    <SherivsPublicChrome>
      <SherivsPublicHome />
    </SherivsPublicChrome>
  );
}
