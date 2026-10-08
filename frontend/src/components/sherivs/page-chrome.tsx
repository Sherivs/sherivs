/**
 * Public page chrome: breadcrumbs (visible + structured data) and the page
 * title block. Breadcrumb labels come from the route registry.
 */
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { breadcrumbJsonLd, serializeJsonLd } from "@/lib/experience-system/content";
import type { SherivsPlane } from "@/lib/experience-system/design-tokens";
import { publicBreadcrumbs } from "@/lib/experience-system/public-routes";
import { Container, PlaneMarker, SvLink } from "./primitives";

export function Breadcrumbs({
  path,
  current,
}: {
  path: string;
  /** Label for a dynamic leaf that is not in the registry. */
  current?: string;
}) {
  const trail = [...publicBreadcrumbs(path)];
  if (current) trail.push({ label: current, path });
  if (trail.length < 2) return null;
  return (
    <>
      <nav aria-label="Breadcrumb" className="sv-small text-sv-text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          {trail.map((crumb, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={`${crumb.path}-${i}`} className="flex items-center gap-1.5">
                {last ? (
                  <span aria-current="page" className="text-sv-text">
                    {crumb.label}
                  </span>
                ) : (
                  <SvLink to={crumb.path} className="no-underline hover:text-sv-text hover:underline">
                    {crumb.label}
                  </SvLink>
                )}
                {!last && <ChevronRight aria-hidden="true" className="size-3.5 text-sv-text-subtle" />}
              </li>
            );
          })}
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd(trail)) }}
      />
    </>
  );
}

export function PageTitle({
  path,
  eyebrow,
  plane,
  title,
  lead,
  currentLabel,
  children,
}: {
  path: string;
  eyebrow?: string;
  plane?: SherivsPlane;
  title: ReactNode;
  lead?: ReactNode;
  currentLabel?: string;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-sv-border">
      <Container className="py-12 sm:py-16">
        <Breadcrumbs path={path} current={currentLabel} />
        <div className="sv-reading mt-8">
          {eyebrow && (
            <p className="mb-4">
              {plane ? (
                <PlaneMarker plane={plane}>{eyebrow}</PlaneMarker>
              ) : (
                <span className="sv-label text-sv-text-muted">{eyebrow}</span>
              )}
            </p>
          )}
          <h1 className="sv-display">{title}</h1>
          {lead && <p className="sv-body mt-5 text-sv-text-muted">{lead}</p>}
        </div>
        {children && <div className="mt-8">{children}</div>}
      </Container>
    </header>
  );
}

/** Plain-reading block used on prose-style pages. */
export function ProseBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Container className={className ?? "py-12 sm:py-16"}>
      <div className="sv-reading space-y-5 text-sv-text-muted">{children}</div>
    </Container>
  );
}
