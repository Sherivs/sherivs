/**
 * Sherivs brand marks.
 *
 * Symbol: three rails forming an "S" — reality above, evidence below, and a
 * luminous crossbar between them where intelligence becomes action. The crossbar
 * is the only element ever drawn in the signal colour.
 */
import { BRAND_NAME, BRAND_WORDMARK } from "@/lib/sherivs/brand";
import { cn } from "@/lib/utils";

export function SherivsSymbol({
  size = 28,
  animate = false,
  className,
  title,
}: {
  size?: number;
  /** Draws the crossbar once on mount. Honours prefers-reduced-motion. */
  animate?: boolean;
  className?: string;
  /** Provide when the mark stands alone (not next to the wordmark). */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M25 6.5H7.5V16"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M24.5 16V25.5H7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M7.5 16H24.5"
        stroke="var(--sv-signal)"
        strokeWidth="3"
        strokeLinecap="square"
        className={animate ? "sherivs-mark-bar" : undefined}
        pathLength={1}
      />
      {animate ? (
        <style>{`
          .sherivs-mark-bar{stroke-dasharray:1;stroke-dashoffset:1;animation:sherivs-mark-draw var(--sv-dur-deliberate,480ms) var(--sv-ease-emphasized,ease-out) 120ms forwards}
          @keyframes sherivs-mark-draw{to{stroke-dashoffset:0}}
          @media (prefers-reduced-motion:reduce){.sherivs-mark-bar{animation:none;stroke-dashoffset:0}}
        `}</style>
      ) : null}
    </svg>
  );
}

export function SherivsWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-semibold tracking-[0.2em]", className)}
      style={{ fontFamily: "var(--sv-font-sans)" }}
    >
      {BRAND_WORDMARK}
    </span>
  );
}

/** Symbol + wordmark. The accessible name is the brand name, announced once. */
export function SherivsLockup({
  size = 24,
  animate,
  className,
}: {
  size?: number;
  animate?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-[color:var(--sv-text)]", className)}>
      <SherivsSymbol size={size} animate={animate} />
      <SherivsWordmark className="text-[0.8125rem]" />
      <span className="sr-only">{BRAND_NAME}</span>
    </span>
  );
}

/** Partner lockup: Sherivs × partner, separated by a hairline. Partner text is supplied, never invented. */
export function PartnerLockup({ partnerName, className }: { partnerName: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <SherivsLockup />
      <span aria-hidden className="h-4 w-px bg-[color:var(--sv-line-strong)]" />
      <span className="text-sm text-[color:var(--sv-text-2)]">{partnerName}</span>
    </span>
  );
}
