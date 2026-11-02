export type StudentMovementType =
  | "promote"
  | "repeat"
  | "double_promote"
  | "conditional_promote"
  | "demote"
  | "internal_transfer"
  | "withdraw"
  | "graduate"
  | "readmit";

export interface MobilityAction {
  type: StudentMovementType;
  label: string;
  requiresDestination: boolean;
}

const ACADEMIC_MOVEMENTS: MobilityAction[] = [
  { type: "promote", label: "Promote", requiresDestination: true },
  { type: "repeat", label: "Repeat / retain", requiresDestination: true },
  { type: "double_promote", label: "Double promotion", requiresDestination: true },
  { type: "conditional_promote", label: "Conditional promotion", requiresDestination: true },
  { type: "demote", label: "Demote", requiresDestination: true },
];

export function hasMultiplePlacementDimensions(
  campusIds: readonly string[],
  sectionIds: readonly string[],
  shiftIds: readonly string[],
  armIds: readonly string[],
): boolean {
  return (
    new Set(campusIds).size > 1 ||
    new Set(sectionIds).size > 1 ||
    new Set(shiftIds).size > 1 ||
    new Set(armIds).size > 1
  );
}

export function mobilityActionsFor(
  permissions: ReadonlySet<string>,
  multiplePlacementDimensions: boolean,
  active: boolean,
): MobilityAction[] {
  if (!permissions.has("students.transfer")) return [];
  const actions = [...ACADEMIC_MOVEMENTS];
  if (multiplePlacementDimensions) {
    actions.push({
      type: "internal_transfer",
      label: "Campus / section / shift transfer",
      requiresDestination: true,
    });
  }
  if (active) {
    actions.push(
      { type: "withdraw", label: "Withdraw", requiresDestination: false },
      { type: "graduate", label: "Graduate", requiresDestination: false },
    );
  } else {
    actions.push({ type: "readmit", label: "Readmit", requiresDestination: true });
  }
  return actions;
}
