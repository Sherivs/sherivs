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
import { themeCss } from "@/lib/website/theme";
import { pageHasContent } from "@/lib/website/nav";
import type { Locale, Post, PublicSite, SiteDocument } from "@/lib/website/types";
import { BlockView, PostCard, type BlockCtx } from "./blocks";
import { fontFaceCss } from "./fonts";
import { Rich } from "./rich";

export interface SiteViewProps {
  site: PublicSite;
  slug: string;
  lang?: string | null;
  /** Platform-host preview (?school=slug): links keep the parameter. Custom domains/subdomains pass null. */
  preview?: string | null;
  /** Builder preview: render this document instead of the published one. */
  documentOverride?: SiteDocument;
  jsonLd?: string;
  /** v2: render one blog post (from website_public_post) inside the site chrome. */
  post?: Post | null;
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

export function SiteView({
  site,
  slug,
  lang,
  preview,
  documentOverride,
  jsonLd,
  post,
}: SiteViewProps) {
  const doc = documentOverride ?? effectiveDocument(site);
  const d = site.data;
  const l = resolveLocale(doc, lang);
  const def = doc.locales[0];
  const page = post ? null : findPage(doc, site, slug, l);
  const nav = useMemo(() => buildNav(doc, d, l, preview), [doc, d, l, preview]);
  const kind = orgKind({ data: d });
  const logo = safeUrl(doc.theme.logo ?? d.school.logo_url);
  const crest = safeUrl(doc.theme.crest) ?? logo;
  const ctx: BlockCtx = {
    locale: l,
    def,
    data: d,
    kind,
    link: (p) => withQuery(p, preview, l, def),
    logo,
    crest,
  };
  const css = useMemo(
    () => themeCss(doc.theme, kind) + fontFaceCss(doc.theme, kind),
    [doc.theme, kind],
  );
  const extra = doc.pages.filter((p) => !p.nav && p.slug !== "home" && pageHasContent(p, d, l));
  const home = pageHref("home", { lang: l, defaultLocale: def, school: preview });
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
    <div className="sw" lang={l} data-dark={doc.theme.dark ?? "auto"} data-kind={kind}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <a href="#sw-main" className="sw-skip">
        Skip to content
      </a>
      {s.phone || s.email || langs ? (
        <div className="sw-topbar">
          <div className="sw-wrap">
            {s.phone ? <a href={`tel:${s.phone.replace(/\s+/g, "")}`}>{s.phone}</a> : null}
            {s.email ? <a href={`mailto:${s.email}`}>{s.email}</a> : null}
            {langs ? <span className="sw-topbar-langs">{langs}</span> : null}
          </div>
        </div>
      ) : null}
      <header
        className="sw-header"
        data-long={nav.length > 6 ? "" : undefined}
        data-menu={nav.reduce((n, x) => n + x.label.length, 0) > 95 ? "" : undefined}
      >
        <div className="sw-wrap sw-header-row">
          <a className="sw-brand" href={home}>
            {logo ? (
              <img src={logo} alt="" width={48} height={48} />
            ) : (
              <span className="sw-mark" aria-hidden>
                {s.name.trim()[0]?.toUpperCase()}
              </span>
            )}
            <span className="sw-brand-text">
              <span className="sw-brand-name">{s.name}</span>
              {s.motto ? <span className="sw-brand-motto">{s.motto}</span> : null}
            </span>
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
        {post ? (
          <PostView post={post} c={ctx} site={site} />
        ) : page ? (
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
            <div className="sw-footer-brand">
              {crest ? <img src={crest} alt="" width={64} height={64} /> : null}
              <h2>{s.name}</h2>
              {s.motto ? <p className="sw-footer-motto">{s.motto}</p> : null}
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
            {extra.length ? (
              <div>
                <h2>{ui("policies", l)}</h2>
                <ul>
                  {extra.map((p) => (
                    <li key={p.slug}>
                      <a href={pageHref(p.slug, { lang: l, defaultLocale: def, school: preview })}>
                        {tx(p.title, l, def)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="sw-legal">
            <span>
              © {new Date().getUTCFullYear()} {s.name}
            </span>
            {langs ? <span className="sw-footer-langs">{langs}</span> : null}
            {doc.theme.credit !== false ? (
              <a className="sw-credit" href="https://sherivs.com" rel="noopener">
                {ui("website_by", l)}
              </a>
            ) : null}
          </div>
        </div>
      </footer>
      {jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
    </div>
  );
}

function PostView({ post, c, site }: { post: Post; c: BlockCtx; site: PublicSite }) {
  const title = tx(post.title, c.locale, c.def);
  const body = tx(post.body, c.locale, c.def);
  const ex = tx(post.excerpt, c.locale, c.def);
  const cover = safeUrl(post.cover_url);
  const more = (site.data.posts ?? []).filter((p) => p.slug !== post.slug).slice(0, 3);
  const date = new Date(post.published_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      <article className="sw-section sw-article">
        <div className="sw-wrap sw-article-wrap">
          <p className="sw-meta">{[post.category, date].filter(Boolean).join(" · ")}</p>
          <h1 className="sw-h1">{title}</h1>
          {ex ? <p className="sw-lede">{ex}</p> : null}
          {post.author_name ? (
            <p className="sw-meta">
              {ui("by", c.locale)} {post.author_name}
            </p>
          ) : null}
          {cover ? (
            <img className="sw-article-cover" src={cover} alt="" fetchPriority="high" />
          ) : null}
          {body ? <Rich text={body} className="sw-prose" /> : null}
        </div>
      </article>
      {more.length ? (
        <section className="sw-section" data-bg="muted">
          <div className="sw-wrap">
            <h2 className="sw-h2">{ui("related", c.locale)}</h2>
            <div className="sw-grid">
              {more.map((p) => (
                <PostCard key={p.id} p={p} c={c} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
