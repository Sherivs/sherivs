/**
 * Sherivs brand primitives: symbol, wordmark and lockups.
 *
 * The symbol is three offset strata — reality, intelligence, action — read top to
 * bottom as an S. Colors come from Sherivs tokens, so the mark is correct on every
 * plane and in forced-colors mode.
 */
import { cn } from "@/lib/utils";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";

export function SherivsMark({
  className,
  title,
}: {
  className?: string;
  /** Provide when the mark stands alone; omit when adjacent text names the brand. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <rect x="9" y="5" width="19" height="5.5" rx="1.25" fill="var(--sx-signal, currentColor)" />
      <rect x="4" y="13.25" width="24" height="5.5" rx="1.25" fill="currentColor" />
      <rect x="4" y="21.5" width="19" height="5.5" rx="1.25" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

export function SherivsWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-[family-name:var(--font-sx-display)] text-[1.0625rem] font-semibold tracking-[0.18em] uppercase",
        className,
      )}
    >
      {PLATFORM_NAME}
    </span>
  );
}

/** Mark + wordmark, optionally with the category descriptor or a runtime name. */
export function SherivsLockup({
  className,
  descriptor,
  runtime,
}: {
  className?: string;
  descriptor?: boolean;
  /** Runtime brand suffix, e.g. "Scholar" — renders as a separated secondary label. */
  runtime?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-sx-strong", className)}>
      <SherivsMark />
      <span className="flex flex-col leading-none">
        <span className="flex items-baseline gap-2">
          <SherivsWordmark />
          {runtime && (
            <span className="border-l border-sx-line-strong pl-2 font-[family-name:var(--font-sx-display)] text-[1.0625rem] font-medium tracking-tight text-sx-muted">
              {runtime}
            </span>
          )}
        </span>
        {descriptor && <span className="sx-label mt-1.5 text-[0.625rem]">{PLATFORM_TAGLINE}</span>}
      </span>
    </span>
  );
}
