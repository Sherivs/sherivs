/**
 * Sherivs brand primitives: symbol, wordmark, lockups.
 *
 * The symbol ("Stratum") is four offset planes that read as an S: the same four
 * planes the product is organized around — reality, intelligence, action,
 * evidence. In `planes` tone each bar carries its plane colour; elsewhere it is
 * a single currentColor mark.
 */
import type { CSSProperties, SVGProps } from "react";
import { cn } from "@/lib/utils";
import { SHERIVS_BRAND } from "@/lib/experience-system/sherivs-brand";

const BARS = [
  { x: 9, y: 3, w: 20, plane: "evidence" },
  { x: 3, y: 10.5, w: 14, plane: "action" },
  { x: 15, y: 18, w: 14, plane: "intelligence" },
  { x: 3, y: 25.5, w: 20, plane: "reality" },
] as const;

export interface SherivsSymbolProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  tone?: "current" | "planes";
  /** Staggered entrance. Respects reduced motion via the sv-root motion rules. */
  animated?: boolean;
  /** When set the symbol is announced; otherwise it is decorative. */
  title?: string;
}

export function SherivsSymbol({
  size = 28,
  tone = "current",
  animated = false,
  title,
  className,
  ...rest
}: SherivsSymbolProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {BARS.map((bar, i) => (
        <rect
          key={bar.plane}
          x={bar.x}
          y={bar.y}
          width={bar.w}
          height={3.5}
          rx={1.25}
          fill={tone === "planes" ? `var(--sv-plane-${bar.plane})` : "currentColor"}
          className={animated ? "sv-rise" : undefined}
          style={animated ? ({ "--i": i } as CSSProperties) : undefined}
        />
      ))}
    </svg>
  );
}

export function SherivsWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-semibold leading-none", className)}
      style={{ letterSpacing: "-0.03em", fontFamily: "var(--sv-font-sans)" }}
    >
      {SHERIVS_BRAND.name}
    </span>
  );
}

export function SherivsLockup({
  className,
  size = 26,
  tone = "planes",
  animated = false,
}: {
  className?: string;
  size?: number;
  tone?: "current" | "planes";
  animated?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <SherivsSymbol size={size} tone={tone} animated={animated} />
      <SherivsWordmark className="text-[1.15rem]" />
    </span>
  );
}

/** Product lockup, e.g. "Sherivs Scholar" — a product, not a separate brand. */
export function SherivsProductLockup({ product }: { product: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <SherivsSymbol size={22} tone="current" />
      <span className="font-semibold" style={{ letterSpacing: "-0.02em" }}>
        {product}
      </span>
    </span>
  );
}

/** Partner lockup: Sherivs mark beside a partner name, separated by a rule. */
export function SherivsPartnerLockup({ partner }: { partner: string }) {
  return (
    <span className="inline-flex items-center gap-3">
      <SherivsLockup size={22} tone="current" />
      <span aria-hidden="true" className="h-5 w-px bg-sv-border-strong" />
      <span className="text-sv-text-muted">{partner}</span>
    </span>
  );
}
