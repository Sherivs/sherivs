/**
 * Sherivs experience primitives (V1).
 *
 * Canonical building blocks shared by public, shell and workspace surfaces:
 * - SherivsNarrativeSection: numbered narrative chapters (never generic
 *   hero→cards); enforces eyebrow / title / lead / measure hierarchy.
 * - EvidenceTag: visible trust primitive (source, verification state).
 * - AiStateMark: distinguishes observation / inference / recommendation /
 *   action in AI surfaces.
 *
 * No buttons, no images, no forms here: primitives compose inside surfaces
 * that own their interaction contracts (the public site, for example, links
 * every CTA to a real route).
 *
 * Version-target classification: V1.
 */
import type { ReactNode } from "react";

export type AiMarkKind = "observation" | "inference" | "recommendation" | "action";

export function SherivsNarrativeSection({
  index,
  eyebrow,
  title,
  lead,
  children,
  labelledBy,
}: {
  /** Chapter number, e.g. "03". Rendered as "03 —". */
  index: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className="sherivs-rise">
      <p className="sherivs-eyebrow">
        {index} — {eyebrow}
      </p>
      <h2 id={labelledBy} className="mt-3 text-balance font-display text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
      {lead ? (
        <p className="sherivs-narrative mt-3 text-pretty text-muted-foreground">{lead}</p>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </section>
  );
}

export function EvidenceTag({
  state,
  children,
}: {
  state: "verified" | "unverified" | "denied";
  children: ReactNode;
}) {
  return (
    <span className="sherivs-evidence-tag">
      <span className="sherivs-evidence-dot" data-state={state} aria-hidden="true" />
      {children}
    </span>
  );
}

export function AiStateMark({ kind, children }: { kind: AiMarkKind; children: ReactNode }) {
  return (
    <span className="sherivs-ai-mark" data-kind={kind}>
      {children}
    </span>
  );
}
