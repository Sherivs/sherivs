import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/contexts/app-context";
import { SiteView } from "@/components/website/site-view";
import { parseSiteSearch, siteHead } from "@/components/website/route-support";
import { getPublicSite } from "@/lib/website/public-site.functions";
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
  validateSearch: parseSiteSearch,
  loaderDeps: ({ search }) => ({ school: search.school, lang: search.lang }),
  loader: async ({ deps }) => {
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
    // Organization website (custom domain, <slug>.sherivs.com, or ?school= preview on the platform host).
    const res = await getPublicSite(deps.school);
    return {
      hostname,
      hostKind,
      site: res.site,
      preview: res.preview,
      tenant: res.tenant,
      lang: deps.lang,
    };
  },
  component: Index,
  head: ({ loaderData }) => {
    if (loaderData?.site) {
      const h = siteHead(loaderData.site, "home", loaderData.lang, loaderData.preview);
      return { meta: h.meta, links: h.links };
    }
    if (loaderData?.tenant)
      return { meta: [{ title: "Site not available" }, { name: "robots", content: "noindex" }] };
    return platformHead();
  },
});

const platformHead = () => ({
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
});

function Index() {
  const data = Route.useLoaderData();
  const { loading, school, tenantSlug, role, profile, superAdmin, platformStaff } = useApp();
  const navigate = useNavigate();

  // Identity-based routing (§11): signed-in users on the platform host (not a
  // tenant site) go to their resolved identity destination.
  const identity = identityFromAppState({ superAdmin, profile, school, platformStaff });
  const onTenantSite = data.tenant || !!tenantSlug;
  useEffect(() => {
    if (!loading && (role || profile || superAdmin || platformStaff) && !onTenantSite) {
      navigate({ to: identity.destination, replace: true });
    }
  }, [
    loading,
    role,
    profile,
    superAdmin,
    platformStaff,
    onTenantSite,
    identity.destination,
    navigate,
  ]);

  // Organization website: server-rendered from the published document (or generated from live data).
  if (data.site) {
    const h = siteHead(data.site, "home", data.lang, data.preview);
    return (
      <SiteView
        site={data.site}
        slug="home"
        lang={data.lang}
        preview={data.preview}
        jsonLd={h.jsonLd}
      />
    );
  }
  if (data.tenant) {
    return (
      <div className="min-h-dvh grid place-items-center text-muted-foreground">
        This site is not available.
      </div>
    );
  }
  if (loading && (resolveTenantSlug() !== null || resolveTenantDomain() !== null)) {
    return <div className="min-h-dvh grid place-items-center text-muted-foreground">Loading…</div>;
  }
  // Sherivs public company homepage — PLANE 1.
  return <SherivsHome />;
}
