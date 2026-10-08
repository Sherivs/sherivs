import { PLATFORM_NAME } from "@/lib/platform";

interface BrandMarkProps {
  readonly size?: "sm" | "md" | "lg";
  readonly withWordmark?: boolean;
  readonly className?: string;
}

const SIZES = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-11 text-sm",
} as const;

/**
 * Sherivs symbol + optional wordmark.
 * The mark is a precision plane, not a glowing orb.
 */
export function SherivsBrandMark({
  size = "md",
  withWordmark = true,
  className = "",
}: BrandMarkProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className={`sv-mark grid place-items-center font-display font-bold tracking-tight ${SIZES[size]}`}
      >
        S
      </span>
      {withWordmark && (
        <span className="font-display font-bold tracking-tight text-foreground">{PLATFORM_NAME}</span>
      )}
    </span>
  );
}
