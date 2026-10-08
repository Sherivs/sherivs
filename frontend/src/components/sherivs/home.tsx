import { Link } from "@tanstack/react-router";
import { HOME_NARRATIVE } from "@/lib/sherivs/narrative";
import { SHERIVS_BRAND } from "@/lib/sherivs/brand";

/**
 * The public narrative. A numbered reading, not a stack of cards.
 */
export function HomeNarrative() {
  const [intro, ...rest] = HOME_NARRATIVE;
  return (
    <article className="sv-narrative">
      <header className="sv-hero">
        <p className="sv-kicker">{SHERIVS_BRAND.category}</p>
        <h1 id="sherivs-hero">{intro.title}</h1>
        <p className="sv-hero-standfirst">{intro.paragraphs[0]}</p>
        <p className="sv-lede">{intro.paragraphs[1]}</p>
        <div className="sv-hero-actions">
          <Link to="/request-demo" className="sv-link-solid">
            Request access
          </Link>
          <Link to="/platform" className="sv-link-quiet">
            Explore the platform
          </Link>
        </div>
      </header>

      <nav className="sv-index" aria-label="On this page">
        <ol>
          {rest.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>
                <span>{section.index}</span>
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {rest.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-heading`}
          className="sv-section"
        >
          <p className="sv-index-num">{section.index}</p>
          <div>
            <h2 id={`${section.id}-heading`}>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.terms && (
              <dl className="sv-terms">
                {section.terms.map((term) => (
                  <div key={term.label}>
                    <dt>{term.label}</dt>
                    <dd>{term.text}</dd>
                  </div>
                ))}
              </dl>
            )}
            {section.sequence && (
              <ol className="sv-sequence">
                {section.sequence.map((step, index) => (
                  <li key={step.label}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{step.label}</h3>
                      <p>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {section.id === "architecture" && (
              <p>
                <Link to="/platform">Read the kernel registry</Link>
              </p>
            )}
            {section.id === "cta" && (
              <div className="sv-hero-actions">
                <Link to="/auth" className="sv-link-solid">
                  Create account
                </Link>
                <Link to="/pricing" className="sv-link-quiet">
                  Published pricing
                </Link>
              </div>
            )}
          </div>
        </section>
      ))}
    </article>
  );
}
