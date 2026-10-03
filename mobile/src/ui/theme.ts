/**
 * CoreGrid Mobile — design tokens (Phase 22 §J: shared design tokens).
 * Minimal token set for the mobile foundation; a fuller CoreGrid design
 * system shared with web is a reported follow-up (§23).
 */
export const palette = {
  background: "#0B1F3A",
  surface: "#122B4E",
  surfaceAlt: "#1A3763",
  border: "#27486F",
  text: "#E9F0FA",
  textMuted: "#9DB2CE",
  primary: "#3B82F6",
  primaryPressed: "#2F6BD8",
  danger: "#DC2626",
  warning: "#D97706",
  success: "#16A34A",
  neutral: "#64748B",
} as const;

export const statusColor = (status: string): string => {
  if (status === "admitted" || status === "verified" || status === "active") return palette.success;
  if (status === "denied" || status === "failed" || status === "suspended") return palette.danger;
  if (status === "rolled_back" || status === "inconclusive" || status === "archived") return palette.warning;
  if (status === "provisioned" || status === "human" || status === "agent") return palette.primary;
  return palette.neutral;
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const typography = {
  title: { fontSize: 22, fontWeight: "700" as const, color: palette.text },
  subtitle: { fontSize: 16, fontWeight: "600" as const, color: palette.text },
  body: { fontSize: 14, color: palette.text },
  muted: { fontSize: 13, color: palette.textMuted },
  label: { fontSize: 12, fontWeight: "600" as const, color: palette.textMuted, textTransform: "uppercase" as const },
} as const;

export const radius = { sm: 6, md: 10, lg: 14 } as const;