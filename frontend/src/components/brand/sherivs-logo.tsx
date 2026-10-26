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

export function SherivsLogo({
  size = 32,
  wordmark = true,
  className = "",
  wordmarkClassName = "text-lg",
}: {
  size?: number;
  wordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} data-testid="sherivs-logo">
      <SherivsMark size={size} decorative={wordmark} />
      {wordmark && (
        <span className={`font-display font-bold leading-none tracking-tight ${wordmarkClassName}`}>
          {PLATFORM_NAME}
        </span>
      )}
    </span>
  );
}

/**
 * Official lockup (S + typeset “Sherivs”) from the owner-supplied wordmark.
 * Letterforms are dark navy — use on light surfaces only. Dark public chrome
 * keeps <SherivsLogo> (compact S + live white text) for contrast.
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
