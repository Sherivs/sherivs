/**
 * Operational status vocabulary for the Internal Console.
 *
 * Health-check evidence is mapped here. A passing application process is
 * never labelled as proof that every workflow is functioning.
 */
export const CONSOLE_HEALTH_STATES = [
  "operational",
  "degraded",
  "unavailable",
  "unknown",
  "maintenance",
] as const;
export type ConsoleHealthState = (typeof CONSOLE_HEALTH_STATES)[number];

export const CONSOLE_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type ConsoleSeverity = (typeof CONSOLE_SEVERITIES)[number];

export const CONSOLE_HEALTH_LABELS: Record<ConsoleHealthState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  unavailable: "Unavailable",
  unknown: "Unknown",
  maintenance: "Maintenance",
};

export function mapProcessHealth(status: string | null | undefined): ConsoleHealthState {
  if (status === "ok") return "operational";
  if (status === "degraded") return "degraded";
  if (status === "failing") return "unavailable";
  return "unknown";
}

export function overallFromCards(states: readonly ConsoleHealthState[]): ConsoleHealthState {
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("maintenance")) return "maintenance";
  if (states.length === 0 || states.every((s) => s === "unknown")) return "unknown";
  if (states.includes("unknown")) return "degraded";
  return "operational";
}
