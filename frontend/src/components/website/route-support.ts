/** Shared head() + search parsing for public site routes (index and /pages/$slug). */
import siteCss from "./website.css?url";
import { siteSeo } from "@/lib/website/seo";
import { effectiveDocument } from "@/lib/website/seo";
import { orgKind } from "@/lib/website/generator";
import type { Post, PublicSite } from "@/lib/website/types";
import { fontPreloads } from "./fonts";

export function siteHead(
  site: PublicSite,
  slug: string,
  lang: string | undefined,
  preview: string | null,
  post?: Post | null,
) {
  const seo = siteSeo(site, slug, lang, post);
  const doc = effectiveDocument(site);
  const kind = orgKind({ data: site.data });
  return {
    meta: [
      { title: seo.title },
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.og.title },
      { property: "og:description", content: seo.og.description },
      { property: "og:type", content: seo.og.type },
      { name: "theme-color", content: seo.themeColor },
      { name: "apple-mobile-web-app-title", content: seo.og.site_name },
      ...(post ? [{ property: "article:published_time", content: post.published_at }] : []),
      { property: "og:url", content: seo.og.url },
      { property: "og:site_name", content: seo.og.site_name },
      ...(seo.og.image ? [{ property: "og:image", content: seo.og.image }] : []),
      { name: "twitter:card", content: seo.og.image ? "summary_large_image" : "summary" },
      // Platform-host previews (?school=) must not compete with the school's own domain in search.
      ...(preview ? [{ name: "robots", content: "noindex" }] : []),
    ],
    links: [
      { rel: "stylesheet", href: siteCss },
      {
        rel: "icon",
        href:
          preview && seo.icon.href === "/site-icon.svg"
            ? `/site-icon.svg?school=${preview}`
            : seo.icon.href,
        ...(seo.icon.type ? { type: seo.icon.type } : {}),
      },
      { rel: "apple-touch-icon", href: seo.icon.href },
      ...fontPreloads(doc.theme, kind).map((href) => ({
        rel: "preload",
        href,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
      })),
      ...((site.data.posts?.length ?? 0) > 0
        ? [
            {
              rel: "alternate",
              type: "application/rss+xml",
              title: seo.og.site_name,
              href: "/rss.xml",
            },
          ]
        : []),
      { rel: "canonical", href: seo.canonical },
      ...seo.alternates.map((a) => ({ rel: "alternate", hrefLang: a.hreflang, href: a.href })),
    ],
    jsonLd: seo.jsonLd,
  };
}
