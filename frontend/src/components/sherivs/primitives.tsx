/**
 * Sherivs layout & control primitives.
 *
 * Layout is chosen by information architecture, not defaulted to cards:
 *  - Section / Container      page rhythm and measure
 *  - DefinitionRows           label → explanation lists (instead of card grids)
 *  - PlaneMarker / PlaneRail  the Reality → Intelligence → Action → Evidence motif
 *  - SvLink / LinkButton      the one place router links are typed for public paths
 */
import { Link, type LinkProps } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  SHERIVS_PLANES,
  type SherivsPlane,
} from "@/lib/experience-system/design-tokens";

export function Container({
  children,
  wide = false,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  wide?: boolean;
  className?: string;
  as?: ElementType;
}) {
  return <Tag className={cn("sv-container", wide && "sv-container-wide", className)}>{children}</Tag>;
}

export function PlaneMarker({
  plane,
  children,
  className,
}: {
  plane: SherivsPlane;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span data-plane={plane} className={cn("sv-plane-marker sv-label text-sv-text-muted", className)}>
      {children}
    </span>
  );
}

/** Decorative four-segment rail; one segment per plane. */
export function PlaneRail({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("sv-plane-rail", className)}>
      {SHERIVS_PLANES.map((plane) => (
        <span key={plane} data-plane={plane} />
      ))}
    </div>
  );
}

export function Section({
  id,
  eyebrow,
  plane,
  title,
  lead,
  children,
  className,
  tone = "default",
  headingLevel = 2,
}: {
  id?: string;
  eyebrow?: string;
  plane?: SherivsPlane;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "default" | "sunken" | "ink";
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const labelledBy = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-sv-theme={tone === "ink" ? "dark" : undefined}
      className={cn(
        "py-16 sm:py-24",
        tone === "sunken" && "bg-sv-surface-sunken",
        tone === "ink" && "sv-ink",
        className,
      )}
    >
      <Container>
        <header className="sv-reading mb-10 sm:mb-14">
          {eyebrow && (
            <p className="mb-4">
              {plane ? (
                <PlaneMarker plane={plane}>{eyebrow}</PlaneMarker>
              ) : (
                <span className="sv-label text-sv-text-muted">{eyebrow}</span>
              )}
            </p>
          )}
          <Heading id={labelledBy} className={headingLevel === 1 ? "sv-hero" : "sv-h1"}>
            {title}
          </Heading>
          {lead && <p className="sv-body mt-5 text-sv-text-muted">{lead}</p>}
        </header>
        {children}
      </Container>
    </section>
  );
}

export interface DefinitionRow {
  readonly key: string;
  readonly term: ReactNode;
  readonly detail: ReactNode;
  readonly note?: ReactNode;
  readonly plane?: SherivsPlane;
}

/**
 * Term → explanation rows separated by hairlines. Used where a card grid would
 * flatten a hierarchy: the term is the scan target, the detail the reading.
 */
export function DefinitionRows({
  rows,
  className,
  headingLevel = 3,
}: {
  rows: readonly DefinitionRow[];
  className?: string;
  headingLevel?: 3 | 4;
}) {
  const Term = headingLevel === 3 ? "h3" : "h4";
  return (
    <ul className={cn("divide-y divide-[var(--sv-border)] border-y border-sv-border", className)}>
      {rows.map((row, i) => (
        <li
          key={row.key}
          data-plane={row.plane}
          className="sv-rise grid gap-x-10 gap-y-2 py-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]"
          style={{ ["--i" as string]: i }}
        >
          <Term className="sv-h4 flex items-baseline gap-3">
            {row.plane && <span aria-hidden="true" className="sv-plane-marker" />}
            {row.term}
          </Term>
          <div>
            <p className="text-sv-text-muted">{row.detail}</p>
            {row.note && <p className="sv-small mt-2 text-sv-text-subtle">{row.note}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Links & buttons ─────────────────────────────────────────────────── */

/**
 * Public-path link. Paths come from the typed public route registry, which a
 * unit test cross-checks against the generated route tree — the single cast to
 * the router's path type lives here.
 */
export function SvLink({
  to,
  className,
  children,
  onClick,
  ...rest
}: {
  to: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
} & Omit<LinkProps, "to" | "className" | "children" | "onClick">) {
  return (
    <Link to={to as LinkProps["to"]} className={className} onClick={onClick} {...rest}>
      {children}
    </Link>
  );
}

const BUTTON_BASE =
  "sv-pressable sv-touch inline-flex items-center justify-center gap-2 rounded-[var(--sv-radius-md)] px-5 font-medium no-underline h-[var(--sv-density-control-height)] disabled:opacity-[var(--sv-opacity-disabled)] disabled:pointer-events-none";
const BUTTON_VARIANTS = {
  primary: "bg-sv-accent text-sv-accent-fg hover:bg-sv-accent-hover",
  secondary: "border border-sv-border-strong text-sv-text hover:bg-sv-surface-3",
  ghost: "text-sv-text hover:bg-sv-surface-3",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function linkButtonClass(variant: ButtonVariant = "primary", className?: string): string {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], className);
}

export function LinkButton({
  to,
  variant = "primary",
  children,
  className,
}: {
  to: string;
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SvLink to={to} className={linkButtonClass(variant, className)}>
      {children}
    </SvLink>
  );
}

export function ExternalAnchor({
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cn("underline underline-offset-4 hover:text-sv-accent-text", className)} {...rest}>
      {children}
    </a>
  );
}
