import { PLATFORM_NAME, PLATFORM_URL } from "@/lib/platform";
import {
  COMPANY_COUNTRY_CODE,
  COMPANY_LOCALITY,
  COMPANY_REGION,
  LEGAL_ENTITY_NAME,
  POSITIONING_STATEMENT,
} from "@/lib/public-site/company";
import { PUBLIC_CONTACTS, publishedCompanySocial } from "@/lib/public-site/contacts";

function publishedXHandle() {
  return publishedCompanySocial().find((item) => item.id === "x")?.handle;
}

export function publicHead({
  title,
  description,
  path,
  noindex = false,
  ogType = "website",
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  ogType?: "website" | "article";
}) {
  const url = path.startsWith("http") ? path : `${PLATFORM_URL}${path}`;
  const pageTitle = title.includes(PLATFORM_NAME) ? title : `${title} — ${PLATFORM_NAME}`;
  const xHandle = publishedXHandle();
  return {
    meta: [
      { title: pageTitle },
      { name: "description", content: description },
      { property: "og:title", content: pageTitle },
      { property: "og:description", content: description },
      { property: "og:type", content: ogType },
      { property: "og:url", content: url },
      { property: "og:image", content: `${PLATFORM_URL}/og-image.png` },
      { property: "og:site_name", content: PLATFORM_NAME },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: pageTitle },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: `${PLATFORM_URL}/og-image.png` },
      ...(xHandle ? [{ name: "twitter:site", content: xHandle }] : []),
      ...(noindex
        ? [{ name: "robots", content: "noindex, nofollow" }]
        : [{ name: "robots", content: "index, follow" }]),
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: PLATFORM_NAME,
    legalName: LEGAL_ENTITY_NAME,
    url: PLATFORM_URL,
    logo: `${PLATFORM_URL}/brand/sherivs-logo-512.png`,
    email: [PUBLIC_CONTACTS.info, PUBLIC_CONTACTS.hello, PUBLIC_CONTACTS.support],
    address: {
      "@type": "PostalAddress",
      addressLocality: COMPANY_LOCALITY,
      addressRegion: COMPANY_REGION,
      addressCountry: COMPANY_COUNTRY_CODE,
    },
    sameAs: publishedCompanySocial().map((item) => item.href),
  };
}

export function softwareJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PLATFORM_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: PLATFORM_URL,
    description: POSITIONING_STATEMENT,
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${PLATFORM_URL}${item.path}`,
    })),
  };
}

export function faqJsonLd(items: readonly { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function articleJsonLd(article: {
  title: string;
  summary: string;
  path: string;
  publishedAt: string;
  updatedAt: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: { "@type": "Organization", name: PLATFORM_NAME },
    publisher: {
      "@type": "Organization",
      name: PLATFORM_NAME,
      logo: { "@type": "ImageObject", url: `${PLATFORM_URL}/brand/sherivs-logo-512.png` },
    },
    mainEntityOfPage: `${PLATFORM_URL}${article.path}`,
  };
}
