import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { DOCUMENTS, pageById, type PublicPage } from "@/lib/sherivs/pages";
import { MARKETING_TIERS, formatTierPrice } from "@/routes/(site)/-content/pricing-tiers";
import { SECURITY_GUARANTEES } from "@/routes/(site)/-content/site-content";
import { PublicShell } from "@/components/sherivs/public-shell";
import { PLATFORM_ORIGIN } from "@/lib/platform";

export function editorialHead(id: string) {
  const page = pageById(id);
  const title = page ? `${page.title} — Sherivs` : "Sherivs";
  const description = page?.description ?? "";
  const path = page?.path ?? "/";
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PLATFORM_ORIGIN}${path}` },
    ],
    links: [{ rel: "canonical", href: `${PLATFORM_ORIGIN}${path}` }],
  };
}

export function EditorialPage({ id, framed = false }: { id: string; framed?: boolean }) {
  const page = pageById(id);
  if (!page) {
    return <p className="sv-lede">This page is not published.</p>;
  }
  const body = <PageBody page={page} />;
  return framed ? <PublicShell>{body}</PublicShell> : body;
}

function PageBody({ page }: { page: PublicPage }) {
  return (
    <article className="sv-editorial">
      <header>
        <p className="sv-kicker">{page.kicker}</p>
        <h1>{page.title}</h1>
        <p className="sv-lede">{page.lede}</p>
      </header>

      {page.kind === "pricing" && <PricingList />}
      {page.kind === "docs-index" && <DocsIndex />}
      {page.kind === "empty" && <EmptyShelf title={page.title} />}
      {page.kind === "status" && <StatusReading />}
      {page.id === "security" && <GuaranteeList />}

      {page.sections.map((section) => (
        <section key={section.id} aria-labelledby={`${page.id}-${section.id}`}>
          <h2 id={`${page.id}-${section.id}`}>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}

      <Related path={page.path} />
    </article>
  );
}

function PricingList() {
  return (
    <ol className="sv-price-list">
      {MARKETING_TIERS.map((tier) => (
        <li key={tier.id}>
          <div>
            <h2>
              {tier.name}
              {tier.featured ? <span className="sv-note"> Recommended in the catalog</span> : null}
            </h2>
            <p className="sv-metric">
              {formatTierPrice(tier.monthlyPrice)}
              {tier.monthlyPrice !== null ? <span> / month</span> : null}
            </p>
            {tier.monthlyPrice !== null && tier.annualPrice !== null && tier.monthlyPrice > 0 && (
              <p>or {formatTierPrice(tier.annualPrice)} / year</p>
            )}
            <p>{tier.summary}</p>
          </div>
          <ul>
            {tier.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
          <Link to="/auth">{tier.ctaLabel}</Link>
        </li>
      ))}
    </ol>
  );
}

function DocsIndex() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DOCUMENTS;
    return DOCUMENTS.filter((doc) =>
      `${doc.title} ${doc.description} ${doc.lede}`.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <div>
      <label className="sv-search">
        <span>Search documentation</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          placeholder="reality, authorization, runtime"
        />
      </label>
      {results.length === 0 ? (
        <p className="sv-empty" role="status">
          No document matches that search.
        </p>
      ) : (
        <ul className="sv-doc-list">
          {results.map((doc) => (
            <li key={doc.id}>
              <a href={doc.path}>{doc.title}</a>
              <p>{doc.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocumentPage({ slug }: { slug: string }) {
  const page = DOCUMENTS.find((doc) => doc.path === `/resources/docs/${slug}`);
  if (!page) return <p className="sv-empty">This document is not published.</p>;
  return <PageBody page={page} />;
}

function EmptyShelf({ title }: { title: string }) {
  return (
    <p className="sv-empty" role="status">
      The {title.toLowerCase()} shelf has no entries. Nothing on this page is a placeholder article.
    </p>
  );
}

function GuaranteeList() {
  return (
    <dl className="sv-terms">
      {SECURITY_GUARANTEES.map((guarantee) => (
        <div key={guarantee.id}>
          <dt>{guarantee.title}</dt>
          <dd>{guarantee.description}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusReading() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/health.json", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { status?: unknown };
        setStatus(typeof body.status === "string" ? body.status : "unknown");
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, []);

  if (state === "loading") {
    return (
      <p className="sv-empty" role="status">
        Reading instance health…
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="sv-empty" role="alert">
        The health endpoint did not respond. This page will not invent a status.
      </p>
    );
  }
  return (
    <p className="sv-status" role="status">
      <span>Instance status</span>
      <strong>{status}</strong>
      <a href="/health.json">Open the health payload</a>
    </p>
  );
}

function Related({ path }: { path: string }) {
  const links = path.startsWith("/platform")
    ? [
        { href: "/platform", label: "Kernel registry" },
        { href: "/security", label: "Security" },
      ]
    : [
        { href: "/", label: "Home" },
        { href: "/platform", label: "Platform" },
      ];
  return (
    <nav className="sv-related" aria-label="Related">
      {links.map((link) => (
        <a key={link.href} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
