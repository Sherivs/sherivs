import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Lock as LockIcon } from "lucide-react";
import { SkeletonStatCard } from "@/components/skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { PageTips } from "@/components/page-tips";
import { cn } from "@/lib/utils";

/**
 * PortalPage — top-level page wrapper. Children fade/slide in with a
 * staggered delay so dashboards feel alive on every navigation.
 */
export function PortalPage({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 min-h-screen px-3 py-4 pb-20 sm:px-6 sm:py-8 sm:pb-8">
      <header
        className="mb-5 flex flex-col items-start gap-3 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4"
        style={{ animation: "slide-up 0.4s cubic-bezier(0.4,0,0.2,1) forwards" }}
      >
        <div className="w-full min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold tracking-tight break-words sm:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-xs text-[color:var(--text-secondary)] break-words sm:mt-2 sm:text-sm">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 [&>*]:h-9 [&>*]:text-xs sm:[&>*]:text-sm">
            {actions}
          </div>
        )}
      </header>
      <PageTips />
      <div className="uos-stagger flex flex-col gap-4 sm:gap-6">
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * GlassCard — frosted-glass surface with the hover lift the design system
 * uses everywhere. Pass className to extend padding/layout.
 */
export function GlassCard({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return <Tag className={`uos-glass p-5 ${className}`}>{children}</Tag>;
}

/**
 * StatCard — gradient-bordered tile with animated count-up for numeric values.
 * Strings/null/undefined are rendered as-is.
 */
export function StatCard({
  label,
  value,
  hint,
  isLoading = false,
}: {
  label: string;
  value: number | string | null | undefined;
  hint?: string;
  isLoading?: boolean;
}) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  const display = useCountUp(numeric ?? 0);
  if (isLoading) return <SkeletonStatCard />;

  const rendered =
    value === null || value === undefined || value === ""
      ? "—"
      : numeric !== null
        ? display.toLocaleString()
        : (value as string);

  return (
    <div className="uos-stat min-w-0 p-3 sm:p-5">
      <div className="truncate text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] sm:text-xs">
        {label}
      </div>
      <div className="mt-1.5 font-display text-xl font-bold tabular-nums truncate sm:mt-2 sm:text-3xl">
        {rendered}
      </div>
      {hint && (
        <div className="mt-1 truncate text-[11px] text-[color:var(--text-secondary)] sm:text-xs">
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * Count up from 0 to `target` over ~1200ms using requestAnimationFrame
 * with an ease-out cubic curve. Returns the integer in flight.
 */
function useCountUp(target: number | null, durationMs = 1200): number {
  const [v, setV] = useState(target ?? 0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    if (target === null) return;
    fromRef.current = 0;
    startRef.current = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const next = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setV(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return v;
}

export function EmptyCard({
  title,
  body,
  cta,
  action,
  icon,
}: {
  title: string;
  body: string;
  cta?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="uos-empty p-8 text-center">
      {icon && (
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[color:var(--surface-2,rgba(255,255,255,0.04))] text-[color:var(--text-secondary)]">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-[color:var(--text-secondary)]">{body}</p>
      {cta && (
        <p className="mt-4 text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
          {cta}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * RouteErrorBoundary — render-friendly error fallback that pairs with
 * TanStack Router's `errorComponent`. Logs the error and offers retry.
 */
export function RouteErrorBoundary({ error, reset }: { error: unknown; reset?: () => void }) {
  // Useful in the browser console for diagnosis.

  console.error("[route error]", error);
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="uos-card p-8 text-center">
        <div className="text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
          Error
        </div>
        <h2 className="mt-2 font-display text-xl font-bold">Something went wrong</h2>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)] break-words">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {reset && (
            <button
              onClick={() => reset()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Try again
            </button>
          )}
          <button
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

export function SectionGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {children}
    </div>
  );
}

export function FeatureLockedCard(
  props:
    | { title: string; requiredPlan: string; description?: string }
    | { featureName: string; requiredTier: string; description?: string },
) {
  const isNew = "featureName" in props;
  const heading = isNew ? props.featureName : props.title;
  const plan = isNew ? props.requiredTier : props.requiredPlan;
  const description = props.description;

  if (isNew) {
    return (
      <div className="uos-card p-8 flex flex-col items-center text-center overflow-hidden">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
          <LockIcon className="w-6 h-6 text-primary" />
        </div>
        <h3 className="font-display font-bold text-xl mb-1">{heading}</h3>
        <p className="text-primary/90 text-sm font-medium mb-2">
          Capability is enabled in this workspace
        </p>
        {description && (
          <p className="text-[color:var(--text-secondary)] text-sm max-w-xs">{description}</p>
        )}
        <div className="mt-5 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
          Open access
        </div>
      </div>
    );
  }

  return (
    <div className="uos-empty p-6 text-center">
      <div className="text-xs uppercase tracking-widest text-[color:var(--text-muted)]">Locked</div>
      <div className="mt-2 font-display text-base font-semibold">{heading}</div>
      <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
        Open access in this workspace.
      </p>
      {description && (
        <p className="mt-2 text-xs text-[color:var(--text-secondary)]">{description}</p>
      )}
    </div>
  );
}

/* ============================================================================
 * Skeleton primitives — built on `.uos-shimmer` so every loading state shares
 * the same shimmer curve. Use these in route loaders / suspense fallbacks.
 * ========================================================================= */

export function SkeletonLine({
  className = "",
  width = "100%",
  height = "0.85rem",
}: {
  className?: string;
  width?: string | number;
  height?: string | number;
}) {
  return (
    <div
      className={`uos-shimmer rounded-md ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonBlock({
  className = "",
  height = "10rem",
}: {
  className?: string;
  height?: string | number;
}) {
  return (
    <div className={`uos-shimmer rounded-2xl ${className}`} style={{ height }} aria-hidden="true" />
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-busy="true"
      aria-label="Loading statistics"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="uos-stat p-5">
          <SkeletonLine width="40%" height="0.7rem" />
          <div className="mt-3">
            <SkeletonLine width="60%" height="1.6rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({
  rows = 5,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 ${className}`} aria-busy="true" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="uos-card flex items-center gap-4 p-4">
          <div className="uos-shimmer size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <SkeletonLine width="55%" />
            <SkeletonLine width="35%" height="0.7rem" />
          </div>
          <SkeletonLine width="3rem" className="shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="uos-card overflow-hidden" aria-busy="true" aria-label="Loading table">
      <div
        className="grid gap-4 border-b border-[color:var(--glass-border)] px-4 py-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonLine key={i} width="60%" height="0.7rem" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-4 border-b border-[color:var(--glass-border)] px-4 py-4 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <SkeletonLine key={c} width={c === 0 ? "70%" : "50%"} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * PortalPageSkeleton — drop into a route's pendingComponent or Suspense
 * fallback for a full-page placeholder that matches PortalPage rhythm.
 */
export function PortalPageSkeleton({
  title,
  showStats = true,
  rows = 5,
}: {
  title?: string;
  showStats?: boolean;
  rows?: number;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-8">
        {title ? (
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        ) : (
          <SkeletonLine width="40%" height="1.8rem" />
        )}
        <div className="mt-3">
          <SkeletonLine width="25%" height="0.8rem" />
        </div>
      </header>
      <div className="flex flex-col gap-6">
        {showStats && <StatGridSkeleton />}
        <CardListSkeleton rows={rows} />
      </div>
    </div>
  );
}

/* ============================================================================
 * Pagination — URL search-param driven. Reads & writes `?page=N` (1-indexed)
 * on the current route. Keeps every other search param intact.
 * ========================================================================= */

const PAGE_PARAM = "page";

/** Read the current `?page=` value (1-indexed). */
export function useCurrentPage(): number {
  const search = useRouterState({ select: (s) => s.location.search }) as unknown as Record<
    string,
    unknown
  >;
  const raw = search?.[PAGE_PARAM];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * usePagination — slice a client-side array into pages, with URL-driven
 * `?page=N` state and a stable `goTo` navigator. For server-paginated
 * lists, call `useCurrentPage()` directly and pass it to your query.
 */
export function usePagination<T>(
  items: readonly T[] | null | undefined,
  pageSize: number,
): {
  page: number;
  pageCount: number;
  pageItems: T[];
  total: number;
  pageSize: number;
} {
  const page = useCurrentPage();
  return useMemo(() => {
    const list = items ?? [];
    const total = list.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;
    return {
      page: safePage,
      pageCount,
      total,
      pageSize,
      pageItems: list.slice(start, start + pageSize),
    };
  }, [items, page, pageSize]);
}

/**
 * PortalPagination — accessible pager that writes to `?page=`.
 * Hides itself when there is only one page.
 */
export function PortalPagination({
  page,
  pageCount,
  className = "",
}: {
  page: number;
  pageCount: number;
  className?: string;
}) {
  const navigate = useNavigate();
  if (pageCount <= 1) return null;

  const goTo = (next: number) => {
    const target = Math.min(Math.max(1, next), pageCount);
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        [PAGE_PARAM]: target === 1 ? undefined : target,
      })) as never,
      replace: false,
    });
  };

  const windowed = buildPageWindow(page, pageCount);

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={`flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      <span className="text-xs text-[color:var(--text-muted)]">
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-1">
        <PagerBtn onClick={() => goTo(page - 1)} disabled={page <= 1} ariaLabel="Previous page">
          <ChevronLeft className="size-4" />
        </PagerBtn>
        {windowed.map((p, idx) =>
          p === "…" ? (
            <span
              key={`gap-${idx}`}
              className="px-2 text-xs text-[color:var(--text-muted)]"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => goTo(p)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Go to page ${p}`}
              className={`min-w-9 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                p === page
                  ? "uos-tenant-bg"
                  : "bg-[color:var(--glass-bg)] hover:bg-[color:var(--glass-hover)]"
              }`}
            >
              {p}
            </button>
          ),
        )}
        <PagerBtn onClick={() => goTo(page + 1)} disabled={page >= pageCount} ariaLabel="Next page">
          <ChevronRight className="size-4" />
        </PagerBtn>
      </div>
    </nav>
  );
}

function PagerBtn({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="grid size-9 place-items-center rounded-lg bg-[color:var(--glass-bg)] transition hover:bg-[color:var(--glass-hover)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Build a windowed list of page numbers with ellipses around the current page. */
function buildPageWindow(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pageCount - 1) out.push("…");
  out.push(pageCount);
  return out;
}

// Re-export a Link wrapper for paginated breadcrumb-style nav, if a caller
// needs a real anchor instead of the button-driven pager above.
export function PageLink({
  toPage,
  children,
  className = "",
}: {
  toPage: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to="."
      search={
        ((prev: Record<string, unknown>) => ({
          ...prev,
          [PAGE_PARAM]: toPage === 1 ? undefined : toPage,
        })) as never
      }
      className={className}
    >
      {children}
    </Link>
  );
}

/* ============================================================================
 * EmptyState — design-system empty placeholder with icon + action slots.
 * ========================================================================= */

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-6 text-center",
        "glass-card",
        className,
      )}
    >
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/30">
          {icon}
        </div>
      )}
      <h3 className="text-white font-semibold text-lg mb-1">{title}</h3>
      {description && (
        <p className="text-white/50 text-sm max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ============================================================================
 * SectionHeader — consistent subheading within a PortalPage.
 * ========================================================================= */

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-white font-semibold text-lg">{title}</h2>
        {subtitle && <p className="text-white/40 text-xs mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
