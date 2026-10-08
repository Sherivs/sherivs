export interface InteriorSection {
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  readonly items?: readonly string[];
}

export interface InteriorPageModel {
  readonly eyebrow: string;
  readonly title: string;
  readonly lead: string;
  readonly sections: readonly InteriorSection[];
  readonly primaryCta?: { readonly to: string; readonly label: string };
  readonly secondaryCta?: { readonly to: string; readonly label: string };
}

export function SherivsInteriorPage({ page }: { readonly page: InteriorPageModel }) {
  return (
    <article className="sv-interior">
      <header className="sv-public-wrap border-b border-border py-16 sm:py-20">
        <p className="sv-kicker">{page.eyebrow}</p>
        <h1 className="sv-display mt-3 max-w-3xl">{page.title}</h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          {page.lead}
        </p>
        {(page.primaryCta || page.secondaryCta) && (
          <div className="mt-8 flex flex-wrap gap-3">
            {page.primaryCta && (
              <a href={page.primaryCta.to} className="sv-btn-signal rounded-md px-5 py-2.5 text-sm font-semibold">
                {page.primaryCta.label}
              </a>
            )}
            {page.secondaryCta && (
              <a
                href={page.secondaryCta.to}
                className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
              >
                {page.secondaryCta.label}
              </a>
            )}
          </div>
        )}
      </header>
      <div className="sv-public-wrap divide-y divide-border">
        {page.sections.map((section) => (
          <section
            key={section.id ?? section.title}
            id={section.id}
            aria-labelledby={section.id ? `${section.id}-heading` : undefined}
            className="grid gap-4 py-12 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-12"
          >
            <h2
              id={section.id ? `${section.id}-heading` : undefined}
              className="font-display text-xl font-semibold tracking-tight"
            >
              {section.title}
            </h2>
            <div>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {section.body}
              </p>
              {section.items && section.items.length > 0 && (
                <ul className="sv-plane-list mt-6">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

export function SherivsEmptyResource({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div className="sv-public-wrap py-16">
      <div className="sv-empty-state max-w-xl">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
