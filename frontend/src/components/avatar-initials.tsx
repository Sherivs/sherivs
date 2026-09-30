import { useMemo } from "react";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-primary/15 text-primary",
  "bg-emerald-500/15 text-emerald-500",
  "bg-amber-500/15 text-amber-600",
  "bg-sky-500/15 text-sky-500",
  "bg-rose-500/15 text-rose-500",
  "bg-violet-500/15 text-violet-500",
];

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Avatar that renders an image when available and otherwise falls back to a
 * deterministic coloured circle with the person's initials (never a broken
 * image icon).
 */
export function AvatarInitials({
  name,
  src,
  size = 40,
  className,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const label = name?.trim() || "Unknown";
  const initials = useMemo(() => initialsOf(label), [label]);
  const color = useMemo(() => {
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 997;
    return PALETTE[h % PALETTE.length];
  }, [label]);

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        color,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials}
    </span>
  );
}

export default AvatarInitials;
