import type { ReactNode } from "react";

export function ExperienceSection({
  id,
  eyebrow,
  title,
  lead,
  children,
  aside,
  tone = "default",
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  aside?: ReactNode;
  tone?: "default" | "recessed" | "signal";
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`sherivs-section border-b border-border ${
        tone === "recessed" ? "bg-muted/20" : tone === "signal" ? "sherivs-signal-plane" : ""
      }`}
    >
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-12">
        <header className="lg:col-span-5">
          {eyebrow ? (
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h2 id={headingId} className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          {lead ? <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">{lead}</p> : null}
          {aside ? <div className="mt-8">{aside}</div> : null}
        </header>
        <div className="lg:col-span-7">{children}</div>
      </div>
    </section>
  );
}

export function Measure({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`max-w-prose text-base leading-7 text-muted-foreground ${className}`}>{children}</div>;
}

export function PlaneList({
  items,
}: {
  items: readonly { readonly id: string; readonly kicker: string; readonly title: string; readonly body: string }[];
}) {
  return (
    <ol className="divide-y divide-border border-y border-border">
      {items.map((item, index) => (
        <li key={item.id} className="grid gap-3 py-6 sm:grid-cols-[4.5rem_1fr] sm:gap-6">
          <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {item.kicker}
            </p>
            <h3 className="mt-1 font-display text-xl font-semibold tracking-tight">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ProcessStrip({
  steps,
}: {
  steps: readonly { readonly id: string; readonly label: string; readonly detail: string }[];
}) {
  return (
    <ol className="grid gap-0 sm:grid-cols-2 lg:grid-cols-6">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="border-t border-border py-5 sm:border-l sm:border-t-0 sm:px-4 first:sm:border-l-0"
        >
          <p className="font-mono text-[0.65rem] tracking-[0.18em] text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </p>
          <p className="mt-2 font-display text-sm font-semibold">{step.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export function BreadcrumbTrail({
  items,
}: {
  items: readonly { readonly href?: string; readonly label: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="inline-flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <a
                href={item.href}
                className="hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {item.label}
              </a>
            ) : (
              <span className="text-foreground">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
