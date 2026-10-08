import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Sherivs document page wrapper (V1).
 *
 * Consistent hero + prose measure + currency note for public content pages
 * (legal, resources, company). Keeps every content page honest about when
 * it was last reviewed.
 */
export function DocPage({
  title,
  lead,
  updated,
  children,
}: {
  title: string;
  lead?: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-xs text-muted-foreground">
        <Link to="/sherivs" className="hover:text-foreground hover:underline">
          Sherivs
        </Link>{" "}
        / {title}
      </p>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </h1>
      {lead && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">{lead}</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Last reviewed: {updated}</p>
      <div className="sherivs-prose mt-8 grid gap-6 text-sm leading-relaxed sm:text-[15px]">
        {children}
      </div>
    </div>
  );
}

export function DocSection({ heading, children }: { heading: string; children: ReactNode }) {
  const id = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="font-display text-lg font-semibold">
        {heading}
      </h2>
      <div className="mt-2 grid gap-3 text-muted-foreground">{children}</div>
    </section>
  );
}
