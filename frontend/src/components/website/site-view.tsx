/**
 * Public site renderer (SPEC §4). Everything on screen comes from the organization's document and live data:
 * header nav is derived from pages that have content, sections render only visible blocks, the footer is built
 * from contact data. No per-organization branches and no fixed sections.
 */
import { useMemo } from "react";
import { blockVisible } from "@/lib/website/catalog";
import { orgKind } from "@/lib/website/generator";
import { LOCALE_NAMES, tx, ui } from "@/lib/website/i18n";
import { buildNav, pageHref, visibleSections } from "@/lib/website/nav";
import { effectiveDocument, findPage, resolveLocale } from "@/lib/website/seo";
import { safeUrl } from "@/lib/website/sanitize";
import { themeVars } from "@/lib/website/theme";
import type { Locale, PublicSite, SiteDocument } from "@/lib/website/types";
import { BlockView, type BlockCtx } from "./blocks";

export interface SiteViewProps {
  site: PublicSite;
  slug: string;
  lang?: string | null;
  /** Platform-host preview (?school=slug): links keep the parameter. Custom domains/subdomains pass null. */
  preview?: string | null;
  /** Builder preview: render this document instead of the published one. */
  documentOverride?: SiteDocument;
  jsonLd?: string;
}

function withQuery(
  path: string,
  preview: string | null | undefined,
  lang: Locale,
  def: Locale,
): string {
  if (!path.startsWith("/")) return path;
  const [p, q = ""] = path.split("?");
  const sp = new URLSearchParams(q);
  if (preview) sp.set("school", preview);
  if (lang !== def) sp.set("lang", lang);
  const s = sp.toString();
  return s ? `${p}?${s}` : p;
}

export function SiteView({ site, slug, lang, preview, documentOverride, jsonLd }: SiteViewProps) {
  const doc = documentOverride ?? effectiveDocument(site);
  const d = site.data;
  const l = resolveLocale(doc, lang);
  const def = doc.locales[0];
  const page = findPage(doc, site, slug, l);
  const nav = useMemo(() => buildNav(doc, d, l, preview), [doc, d, l, preview]);
  const ctx: BlockCtx = {
    locale: l,
    def,
    data: d,
    kind: orgKind({ data: d }),
    link: (p) => withQuery(p, preview, l, def),
  };
  const logo = safeUrl(doc.theme.logo ?? d.school.logo_url);
  const home = pageHref("home", { lang: l, defaultLocale: def, school: preview });
  const vars = themeVars(doc.theme) as React.CSSProperties;
  const langs =
    doc.locales.length > 1 ? (
      <nav className="sw-langs" aria-label={ui("language", l)}>
        {doc.locales.map((x) => (
          <a
            key={x}
            href={pageHref(slug, { lang: x, defaultLocale: def, school: preview })}
            hrefLang={x}
            lang={x}
            aria-current={x === l ? "true" : undefined}
          >
            {LOCALE_NAMES[x]}
          </a>
        ))}
      </nav>
    ) : null;
  const s = d.school;

  return (
    <div className="sw" style={vars} lang={l}>
      <a href="#sw-main" className="sw-skip">
        Skip to content
      </a>
      <header className="sw-header" data-long={nav.length > 6 ? "" : undefined}>
        <div className="sw-wrap sw-header-row">
          <a className="sw-brand" href={home}>
            {logo ? (
              <img src={logo} alt="" width={40} height={40} />
            ) : (
              <span className="sw-mark" aria-hidden>
                {s.name.trim()[0]?.toUpperCase()}
              </span>
            )}
            <span>{s.name}</span>
          </a>
          {nav.length > 1 ? (
            <>
              <nav className="sw-nav" aria-label="Main">
                {nav.map((n) => (
                  <a key={n.slug} href={n.href} aria-current={n.slug === slug ? "page" : undefined}>
                    {n.label}
                  </a>
                ))}
              </nav>
              <details className="sw-menu">
                <summary>{ui("menu", l)}</summary>
                <nav aria-label="Main">
                  {nav.map((n) => (
                    <a key={n.slug} href={n.href}>
                      {n.label}
                    </a>
                  ))}
                  {langs}
                </nav>
              </details>
            </>
          ) : null}
        </div>
      </header>
      <main id="sw-main" className="sw-main">
        {page &&
        page.slug !== "home" &&
        visibleSections(page, d, l)[0]?.blocks[0]?.type !== "hero" ? (
          <div className="sw-pagehead">
            <div className="sw-wrap">
              <h1>{tx(page.title, l, def)}</h1>
              {page.description ? <p>{tx(page.description, l, def)}</p> : null}
            </div>
          </div>
        ) : null}
        {page ? (
          visibleSections(page, d, l).map((sec) => {
            const hero = sec.blocks.length === 1 && sec.blocks[0].type === "hero";
            return hero ? (
              <section
                key={sec.id}
                className="sw-hero"
                data-variant={sec.blocks[0].variant ?? "centered"}
              >
                <BlockView b={sec.blocks[0]} c={ctx} />
              </section>
            ) : (
              <section
                key={sec.id}
                className="sw-section"
                data-bg={sec.background}
                data-layout={sec.layout}
              >
                <div className="sw-wrap">
                  {sec.blocks
                    .filter((b) => blockVisible(b, d, l))
                    .map((b) => (
                      <BlockView key={b.id} b={b} c={ctx} />
                    ))}
                </div>
              </section>
            );
          })
        ) : (
          <section className="sw-section">
            <div className="sw-wrap">
              <h1 className="sw-h2">{ui("not_found", l)}</h1>
              <a className="sw-btn" href={home}>
                {ui("back_home", l)}
              </a>
            </div>
          </section>
        )}
      </main>
      <footer className="sw-footer">
        <div className="sw-wrap">
          <div className="sw-footer-grid">
            <div>
              <h2>{s.name}</h2>
              {s.motto ? <p style={{ margin: 0 }}>{s.motto}</p> : null}
              {s.address ? <p>{s.address}</p> : null}
            </div>
            {s.phone || s.email ? (
              <div>
                <h2>{ui("contact_us", l)}</h2>
                <ul>
                  {s.phone ? (
                    <li>
                      <a href={`tel:${s.phone.replace(/\s+/g, "")}`}>{s.phone}</a>
                    </li>
                  ) : null}
                  {s.email ? (
                    <li>
                      <a href={`mailto:${s.email}`}>{s.email}</a>
                    </li>
                  ) : null}
                  {s.office_hours ? <li>{s.office_hours}</li> : null}
                </ul>
              </div>
            ) : null}
            {nav.length > 1 ? (
              <div>
                <h2>{ui("menu", l)}</h2>
                <ul>
                  {nav.map((n) => (
                    <li key={n.slug}>
                      <a href={n.href}>{n.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {langs ? (
              <div>
                <h2>{ui("language", l)}</h2>
                {langs}
              </div>
            ) : null}
          </div>
          <div className="sw-legal">
            <span>
              © {new Date().getUTCFullYear()} {s.name}
            </span>
            <a href="https://sherivs.com" rel="noopener">
              {ui("powered_by", l)}
            </a>
          </div>
        </div>
      </footer>
      {jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
    </div>
  );
}
