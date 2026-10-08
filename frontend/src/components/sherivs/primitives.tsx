/**
 * Sherivs layout and content primitives.
 *
 * Layout is decided by information architecture, not by a card default: a Plane is a
 * full-bleed band with a tone (paper follows the theme, ink is always dark), a
 * SectionHeading carries the narrative index, and lists of facts render as ruled rows.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlaneTone = "paper" | "raised" | "ink";

export function Plane({
  tone = "paper",
  id,
  labelledBy,
  className,
  children,
  field = false,
}: {
  tone?: PlaneTone;
  id?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
  /** Draw the measurement field behind structural content. */
  field?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-sx-plane={tone === "ink" ? "ink" : undefined}
      className={cn(
        "relative border-t border-sx-line",
        tone === "raised" && "bg-sx-surface-2",
        tone === "ink" && "bg-sx-surface-0 text-sx-text",
        field && "sx-field",
        className,
      )}
    >
      <div className="sx-container py-20 sm:py-28 lg:py-32">{children}</div>
    </section>
  );
}

/** "01 — Category" narrative index. */
export function SectionIndex({ index, label }: { index: string; label: string }) {
  return (
    <p className="sx-label flex items-center gap-3">
      <span className="text-sx-signal">{index}</span>
      <span aria-hidden="true" className="h-px w-8 bg-sx-line-strong" />
      <span>{label}</span>
    </p>
  );
}

export function SectionHeading({
  id,
  index,
  label,
  title,
  lead,
  className,
  as: Heading = "h2",
}: {
  id: string;
  index?: string;
  label: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <header className={cn("grid gap-5 lg:grid-cols-12 lg:gap-10", className)}>
      <div className="lg:col-span-4">
        {index ? <SectionIndex index={index} label={label} /> : <p className="sx-label">{label}</p>}
      </div>
      <div className="lg:col-span-8">
        <Heading id={id} className={Heading === "h1" ? "sx-h1" : "sx-h2"}>
          {title}
        </Heading>
        {lead && <p className="sx-body-lg mt-5 sx-measure">{lead}</p>}
      </div>
    </header>
  );
}

export function PageHero({
  id,
  label,
  title,
  lead,
  children,
  aside,
}: {
  id: string;
  label: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-sx-plane="ink"
      className="sx-atmosphere relative overflow-hidden border-b border-sx-line"
    >
      <div aria-hidden="true" className="sx-field absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      <div className="sx-container relative grid gap-12 pt-20 pb-16 sm:pt-28 sm:pb-24 lg:grid-cols-12 lg:pt-36">
        <div className="lg:col-span-8">
          <div className="sx-label">{label}</div>
          <h1 id={id} className="sx-hero mt-6">
            {title}
          </h1>
          {lead && <p className="sx-body-lg mt-6 max-w-[58ch]">{lead}</p>}
          {children && <div className="mt-10 flex flex-wrap items-center gap-3">{children}</div>}
        </div>
        {aside && <div className="lg:col-span-4 lg:self-end">{aside}</div>}
      </div>
    </section>
  );
}

export function ActionLink({
  to,
  children,
  variant = "primary",
}: {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
}) {
  return (
    <Link to={to} className={cn("sx-button", `sx-button-${variant}`)}>
      {children}
      {variant !== "secondary" && <ArrowRight aria-hidden="true" className="size-4" />}
    </Link>
  );
}

/** Ruled list of facts: the default for enumerations, instead of a card grid. */
export function RuledList({
  items,
  columns = 1,
}: {
  items: readonly { title: ReactNode; detail: ReactNode; meta?: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <ul
      className={cn(
        "grid border-t border-sx-line-strong",
        columns === 2 && "md:grid-cols-2 md:gap-x-10",
        columns === 3 && "md:grid-cols-2 lg:grid-cols-3 md:gap-x-10",
      )}
    >
      {items.map((item, position) => (
        <li key={position} className="grid gap-2 border-b border-sx-line py-6">
          {item.meta && <div className="sx-label">{item.meta}</div>}
          <h3 className="sx-h4">{item.title}</h3>
          <p className="sx-small text-sx-muted">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export type IntelligenceKind =
  | "observation"
  | "inference"
  | "recommendation"
  | "action"
  | "evidence"
  | "verification";

export const INTELLIGENCE_KIND_LABEL: Record<IntelligenceKind, string> = {
  observation: "Observation",
  inference: "Inference",
  recommendation: "Recommendation",
  action: "Action",
  evidence: "Evidence",
  verification: "Verification",
};

/** Marks a block of AI or system output with its epistemic kind. */
export function KindBlock({
  kind,
  children,
  className,
}: {
  kind: IntelligenceKind;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-kind={kind} className={cn("sx-kind", className)}>
      <p className="sx-label" style={{ color: `var(--sx-${kind})` }}>
        {INTELLIGENCE_KIND_LABEL[kind]}
      </p>
      <div className="sx-small mt-1.5 text-sx-text">{children}</div>
    </div>
  );
}

export function StatusDot({
  tone,
  label,
}: {
  tone: "verification" | "action" | "danger" | "observation" | "signal";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="size-2 rounded-full" style={{ background: `var(--sx-${tone})` }} />
      <span className="sx-label" style={{ color: `var(--sx-${tone})` }}>
        {label}
      </span>
    </span>
  );
}
