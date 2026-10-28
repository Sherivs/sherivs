import { createFileRoute } from "@tanstack/react-router";
import { SiteView } from "@/components/website/site-view";
import { parseSiteSearch, siteHead } from "@/components/website/route-support";
import { getPublicSite } from "@/lib/website/public-site.functions";
import { SherivsHome } from "@/components/public/sherivs-home";
import { ApplicationUnavailable } from "@/components/public/application-unavailable";
import { AppEntryScreen } from "@/components/app-entry/app-entry-screen";
import { ConsoleGate } from "@/components/internal-console/console-gate";
import { resolveTenantDomain, resolveTenantSlug } from "@/lib/tenant";
import {
  PLATFORM_NAME,
  PLATFORM_PAGE_DESCRIPTION,
  PLATFORM_PAGE_TITLE,
  PLATFORM_URL,
} from "@/lib/platform";
import { resolveExperienceHost } from "@/lib/experience/experience-host";
import { isRetiredApplicationHostname } from "@/lib/experience/retired-application-host";
import { isAppEntryKind, parseAppEntryPanel } from "@/lib/experience/app-entry-host";
import { effectiveExperienceHostKind } from "@/lib/experience/console-host-routing";
import { readRequestHostname } from "@/lib/experience/experience-host.functions";
import { useApp } from "@/contexts/app-context";

async function loaderHostname(): Promise<string> {
  if (typeof window !== "undefined") return window.location.hostname;
  return readRequestHostname();
}

function retiredSurfaceLabel(hostname: string): string {
  const kind = resolveExperienceHost(hostname);
  if (kind === "internal") return "internal console";
  if (kind === "app") return "application";
  return "console";
}

export const Route = createFileRoute("/")({
  validateSearch: parseSiteSearch,
  loaderDeps: ({ search }) => ({ school: search.school, lang: search.lang }),
  loader: async ({ deps }) => {
    const hostname = await loaderHostname();
    const hostKind = effectiveExperienceHostKind(
      hostname,
      import.meta.env.VITE_SHERIVS_HOST_KIND_OVERRIDE as string | undefined,
    );
    // app.sherivs.com is the application splash — not the public homepage
    // and not the deleted workspace shell.
    if (isAppEntryKind(hostKind)) {
      return {
        hostname,
        hostKind,
        retired: false as const,
        appEntry: true as const,
        consoleEntry: false as const,
        surface: "application",
        site: null,
        preview: false,
        tenant: null,
        lang: deps.lang,
      };
    }
    // console.sherivs.com is the Internal Console — never the marketing homepage.
    if (hostKind === "internal") {
      return {
        hostname,
        hostKind,
        retired: false as const,
        appEntry: false as const,
        consoleEntry: true as const,
        surface: "internal console",
        site: null,
        preview: false,
        tenant: null,
        lang: deps.lang,
      };
    }
    // Gov, head, and group hosts must not SSR the public marketing homepage
    // or a hardcoded workspace shell.
    if (isRetiredApplicationHostname(hostname)) {
      return {
        hostname,
        hostKind,
        retired: true as const,
        appEntry: false as const,
        consoleEntry: false as const,
        surface: retiredSurfaceLabel(hostname),
        site: null,
        preview: false,
        tenant: null,
        lang: deps.lang,
      };
    }
    // Organization website (custom domain, <slug>.sherivs.com, or ?school= preview on the platform host).
    const res = await getPublicSite(deps.school);
    return {
      hostname,
      hostKind,
      retired: false as const,
      appEntry: false as const,
      consoleEntry: false as const,
      surface: null,
      site: res.site,
      preview: res.preview,
      tenant: res.tenant,
      lang: deps.lang,
    };
  },
  component: Index,
  head: ({ loaderData }) => {
    if (loaderData?.appEntry) {
      return {
        meta: [
          { title: PLATFORM_NAME },
          { name: "description", content: `Sign in to ${PLATFORM_NAME}.` },
          { name: "robots", content: "noindex, nofollow" },
        ],
      };
    }
    if (loaderData?.consoleEntry) {
      return {
        meta: [
          { title: `Internal Console — ${PLATFORM_NAME}` },
          { name: "robots", content: "noindex, nofollow" },
        ],
      };
    }
    if (loaderData?.retired) {
      return {
        meta: [
          { title: "Application not available — Sherivs" },
          { name: "robots", content: "noindex, nofollow" },
        ],
      };
    }
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
      title: PLATFORM_PAGE_TITLE,
    },
    {
      name: "description",
      content: PLATFORM_PAGE_DESCRIPTION,
    },
    {
      property: "og:title",
      content: PLATFORM_PAGE_TITLE,
    },
    {
      property: "og:description",
      content: PLATFORM_PAGE_DESCRIPTION,
    },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${PLATFORM_URL}/` },
    { property: "og:image", content: `${PLATFORM_URL}/og-image.png` },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: PLATFORM_PAGE_TITLE },
    { name: "twitter:description", content: PLATFORM_PAGE_DESCRIPTION },
    { name: "twitter:image", content: `${PLATFORM_URL}/og-image.png` },
  ],
  links: [{ rel: "canonical", href: `${PLATFORM_URL}/` }],
});

function Index() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const { loading } = useApp();

  if (data.appEntry) {
    return <AppEntryScreen panel={parseAppEntryPanel(search.panel)} />;
  }

  if (data.consoleEntry) {
    return <ConsoleGate hostKind={data.hostKind} />;
  }

  if (data.retired) {
    return <ApplicationUnavailable surface={data.surface ?? "application"} />;
  }

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
