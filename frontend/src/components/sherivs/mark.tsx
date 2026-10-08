/**
 * Sherivs brand marks (SHERIVS_COMPONENT_CATALOG.md §BRAND).
 *
 * The symbol is four stacked planes — the Reality → Intelligence → Action →
 * Evidence progression — read as infrastructure layers. It is drawn from
 * tokens only (currentColor + --sh-signal), so it is correct on every plane
 * and in both themes. No glow, no gradient.
 */
import { BRAND } from "@/lib/experience/brand";
import { cn } from "@/lib/utils";

export function SherivsSymbol({
  className,
  title = BRAND.name,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={cn("size-7 shrink-0", className)}
      fill="none"
    >
      <title>{title}</title>
      {/* evidence plane (base) */}
      <path d="M4 22.5 16 28.5 28 22.5" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.6" strokeLinejoin="round" />
      {/* action plane */}
      <path d="M4 17.5 16 23.5 28 17.5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" strokeLinejoin="round" />
      {/* intelligence plane */}
      <path d="M4 12.5 16 18.5 28 12.5" stroke="currentColor" strokeOpacity="0.8" strokeWidth="1.6" strokeLinejoin="round" />
      {/* reality plane (top, solid signal) */}
      <path d="M16 3.5 28 9.5 16 15.5 4 9.5Z" fill="var(--sh-signal)" />
    </svg>
  );
}

export function SherivsWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-[0.95rem] font-bold uppercase tracking-[0.22em] leading-none",
        className,
      )}
    >
      {BRAND.wordmark}
    </span>
  );
}

export function SherivsLockup({
  className,
  secondary,
}: {
  className?: string;
  /** Optional second line (runtime or workspace name), rendered as a quiet label. */
  secondary?: string | null;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-ink-1", className)}>
      <SherivsSymbol />
      <span className="flex flex-col leading-none">
        <SherivsWordmark />
        {secondary ? (
          <span className="mt-1 text-[0.625rem] font-medium uppercase tracking-[0.16em] text-ink-3">
            {secondary}
          </span>
        ) : null}
      </span>
    </span>
  );
}
