import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "default";

const variants: Record<BadgeVariant, string> = {
  success: "status-badge status-success",
  warning: "status-badge status-warning",
  danger: "status-badge status-danger",
  info: "status-badge status-info",
  default: "status-badge bg-white/10 text-white/70",
};

export function EnterpriseBadge({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return <span className={cn(variants[variant], className)}>{children}</span>;
}
