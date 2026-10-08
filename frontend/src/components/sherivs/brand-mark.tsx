/**
 * Sherivs brand mark — logo, symbol and wordmark (V1).
 *
 * Canonical customer-facing brand expression. Inline SVG only (no raster
 * assets): crisp at every viewport, theme-aware via currentColor, zero
 * network cost. The mark is a layered depth sigil — concentric planes
 * evoking REALITY → INTELLIGENCE → ACTION → EVIDENCE.
 *
 * Version-target classification: V1.
 */

export function SherivsSymbol({ size = 28, label = "Sherivs" }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <rect
        x="7"
        y="7"
        width="18"
        height="18"
        rx="5"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="1.5"
      />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
      <circle
        cx="16"
        cy="16"
        r="6.5"
        stroke="currentColor"
        strokeOpacity="0.85"
        strokeWidth="1.5"
        strokeDasharray="2.5 2.5"
      />
    </svg>
  );
}

export function SherivsWordmark({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display font-bold tracking-tight ${className}`}
      aria-label="Sherivs"
    >
      <SherivsSymbol size={compact ? 22 : 28} />
      <span className={compact ? "text-base" : "text-lg"}>SHERIVS</span>
    </span>
  );
}
