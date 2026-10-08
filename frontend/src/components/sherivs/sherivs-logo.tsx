import { cn } from "@/lib/utils";

/**
 * Sherivs brand mark (V1 experience foundation).
 *
 * A precision sigil: three concentric registration rings intersected by a
 * single institutional axis. Rings communicate layered governance (reality →
 * intelligence → action → evidence); the axis communicates authority and
 * auditability. Rendered as inline SVG so it inherits currentColor and needs
 * no image asset.
 */
export function SherivsMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Sherivs mark"
      className={cn("size-8", className)}
      fill="none"
    >
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle cx="16" cy="16" r="8.5" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="1.5" />
      <line x1="16" y1="1.5" x2="16" y2="30.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SherivsWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-lg font-bold tracking-[0.08em] uppercase", className)}>
      Sherivs
    </span>
  );
}

export function SherivsLockup({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <SherivsMark className={compact ? "size-6" : "size-8"} />
      {!compact && <SherivsWordmark />}
    </span>
  );
}
