import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Official Sherivs logo (ribbon "S"). Raster marks are generated from the
 * master in public/brand/ (64/128/256 px) and served with a 2x srcSet.
 * Use <SherivsLogo> (mark + "Sherivs" wordmark as live text) everywhere the
 * brand appears; use <SherivsMark> alone only where space is tight.
 */
const MARKS = [64, 128, 256] as const;

function markFor(px: number): string {
  const size = MARKS.find((m) => m >= px) ?? 256;
  return `/brand/sherivs-mark-${size}.png`;
}

export function SherivsMark({
  size = 32,
  className = "",
  decorative = false,
}: {
  size?: number;
  className?: string;
  /** True when adjacent text already says "Sherivs" (alt="" avoids double announcement). */
  decorative?: boolean;
}) {
  return (
    <img
      src={markFor(size)}
      srcSet={`${markFor(size)} 1x, ${markFor(size * 2)} 2x`}
      width={size}
      height={size}
      alt={decorative ? "" : `${PLATFORM_NAME} logo`}
      aria-hidden={decorative || undefined}
      decoding="async"
      draggable={false}
      className={`shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Owner-supplied lowercase geometric wordmark. The raster is used as a
 * mask so the letterforms stay exact on light glass surfaces.
 */
export function SherivsWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`sherivs-wordmark ${className}`}>
      <img
        src="/brand/sherivs-app-wordmark.png"
        alt={PLATFORM_NAME}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}

export function SherivsLogo({
  size = 32,
  wordmark = true,
  className = "",
  wordmarkClassName = "text-lg",
  lettering = "text",
}: {
  size?: number;
  wordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
  /** `brand` uses the official wordmark letterforms; `text` is live type. */
  lettering?: "text" | "brand";
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} data-testid="sherivs-logo">
      <SherivsMark size={size} decorative={wordmark} />
      {wordmark && lettering === "brand" ? <SherivsWordmark /> : null}
      {wordmark && lettering === "text" ? (
        <span className={`font-display font-bold leading-none tracking-tight ${wordmarkClassName}`}>
          {PLATFORM_NAME}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Official lockup (S + typeset “Sherivs”) from the owner-supplied wordmark.
 * Letterforms are dark navy — use on light surfaces only. Public chrome uses
 * <SherivsLogo lettering="brand"> so the lowercase geometric wordmark matches
 * the owner-supplied letterforms on the light glass field.
 */
export function SherivsLockup({
  height = 40,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/sherivs-wordmark.png"
      alt={PLATFORM_NAME}
      height={height}
      decoding="async"
      draggable={false}
      className={`shrink-0 select-none ${className}`}
      style={{ height, width: "auto" }}
    />
  );
}
