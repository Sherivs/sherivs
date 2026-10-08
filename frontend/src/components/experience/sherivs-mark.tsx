/**
 * Sherivs brand mark — three planes (reality, intelligence, action) with a
 * verification node. Not a glowing orb. Not a generic letter tile.
 */
import { PLATFORM_NAME } from "@/lib/platform";

export function SherivsMark({
  size = 28,
  title = PLATFORM_NAME,
}: {
  size?: number;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <rect x="3" y="4" width="26" height="6" rx="1.2" className="fill-foreground/90" />
      <rect x="3" y="13" width="18" height="6" rx="1.2" className="fill-foreground/55" />
      <rect x="3" y="22" width="12" height="6" rx="1.2" className="fill-foreground/30" />
      <circle cx="25" cy="25" r="3.2" className="fill-[color:var(--sherivs-signal)]" />
    </svg>
  );
}

export function SherivsLockup({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <SherivsMark size={compact ? 22 : 28} />
      <span className="font-display text-[0.95rem] font-semibold tracking-[0.18em] uppercase">
        {PLATFORM_NAME}
      </span>
    </span>
  );
}
