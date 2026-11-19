import { useId, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import type { CardKind } from "@/lib/shell/card-registry";
import { plannedCapabilityCopy } from "@/lib/shell/planned-capability-copy";
import type { MetricTone } from "@/lib/shell/metrics";
import { ShellGlassIcon } from "./glass-icon";

export interface PlannedCapabilityStateProps {
  label: string;
  kind: CardKind;
  homeHref: string;
  Icon: ComponentType;
  /** "<role> in <organization>" line, as the other shell sections show it. */
  context?: string;
  /** A real figure the server already returned for this card; omitted when there is none. */
  figure?: { text: string; tone: MetricTone; note?: string } | null;
  locale?: string;
}

/**
 * Honest state for a card whose screen is not built (ADR-106). It names the capability and what it
 * will do, says plainly that it is planned, and offers no fake data and no fake actions. A figure is
 * shown only when the server returned one for this card.
 */
export function PlannedCapabilityState({
  label,
  kind,
  homeHref,
  Icon,
  context,
  figure,
  locale,
}: PlannedCapabilityStateProps) {
  const copy = plannedCapabilityCopy(locale);
  const headingId = useId();
  return (
    <section
      className="app-shell-section"
      data-testid="planned-capability-state"
      data-card-status="planned"
      aria-labelledby={headingId}
    >
      <Link to={homeHref as never} className="app-shell-back">
        {copy.back}
      </Link>
      <ShellGlassIcon size={44} tone="accent">
        <Icon />
      </ShellGlassIcon>
      <h1 id={headingId}>{label}</h1>
      {context ? <p className="app-shell-org">{context}</p> : null}
      <p data-testid="planned-capability-status">
        <strong>{copy.statusLabel}:</strong> {copy.statusPlanned}
      </p>
      <p data-testid="planned-capability-purpose">{copy.purpose(kind, label)}</p>
      {figure ? (
        <div className="app-shell-widget" data-testid="planned-capability-figure">
          <span>{copy.figureHeading}</span>
          <strong className={`app-shell-metric-${figure.tone}`}>{figure.text}</strong>
          <span>{figure.note ?? copy.figureNote}</span>
        </div>
      ) : null}
      <p className="app-shell-empty">{copy.noAction}</p>
    </section>
  );
}

export function CardNotFoundState({
  sectionKey,
  homeHref,
  locale,
}: {
  sectionKey: string;
  homeHref: string;
  locale?: string;
}) {
  const copy = plannedCapabilityCopy(locale);
  const headingId = useId();
  return (
    <section className="app-shell-section" data-testid="card-not-found" aria-labelledby={headingId}>
      <Link to={homeHref as never} className="app-shell-back">
        {copy.back}
      </Link>
      <h1 id={headingId}>{copy.notFoundTitle}</h1>
      <p className="app-shell-empty">{copy.notFoundBody(sectionKey)}</p>
    </section>
  );
}
