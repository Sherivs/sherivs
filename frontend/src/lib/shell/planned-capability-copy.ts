/**
 * Strings for the planned-capability and not-found states (mission M3). Kept as one object per
 * locale so a translation can be added without touching the component. Only English exists today;
 * other locales fall back to it.
 */
import type { CardKind } from "./card-registry";

export interface PlannedCapabilityCopy {
  back: string;
  statusLabel: string;
  statusPlanned: string;
  purpose: (kind: CardKind, label: string) => string;
  noAction: string;
  figureHeading: string;
  figureNote: string;
  notFoundTitle: string;
  notFoundBody: (key: string) => string;
}

const en: PlannedCapabilityCopy = {
  back: "← Home",
  statusLabel: "Status",
  statusPlanned: "Planned, not built yet",
  purpose: (kind, label) => {
    switch (kind) {
      case "widget":
        return `${label} will show a summary from your organization's records here, with a full screen behind it.`;
      case "action":
        return `${label} will let you do this task from here.`;
      case "inbox":
        return `${label} will collect the items that need your attention here.`;
      default:
        return `${label} will open here as its own screen.`;
    }
  },
  noAction:
    "Nothing on this page can be changed yet. When the screen is built it will appear here for the people your administration has given access to.",
  figureHeading: "Current figure",
  figureNote: "Read from your organization's records.",
  notFoundTitle: "Section not found",
  notFoundBody: (key) =>
    `There is no section called “${key}”. The link may be old or mistyped. Go back home and open it from your workspace.`,
};

const COPY: Record<string, PlannedCapabilityCopy> = { en };

export function plannedCapabilityCopy(locale: string | undefined): PlannedCapabilityCopy {
  return (locale && COPY[locale]) || en;
}
