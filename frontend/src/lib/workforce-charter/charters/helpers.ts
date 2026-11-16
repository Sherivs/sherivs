import { CHARTER_SCHEMA, type AgentCharter } from "../charter";

/** One evaluation suite per capability above T0, named by pack and capability. */
export const suites = (
  packCode: string,
  capabilityIds: readonly string[],
  minPassRate = 0.95,
): AgentCharter["evalSuites"] =>
  capabilityIds.map((capabilityId) => ({
    capabilityId,
    suiteId: `eval.${packCode}.${capabilityId}`,
    minPassRate,
  }));

export const ALL_PANELS: AgentCharter["dashboardPanels"] = [
  "charter",
  "context",
  "permissions",
  "autonomy",
  "budget",
  "proposals",
  "runs",
  "handoffs",
  "slos",
  "safety",
];

export const base = { schema: CHARTER_SCHEMA, dashboardPanels: ALL_PANELS } as const;
