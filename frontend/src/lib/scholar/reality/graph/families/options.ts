/**
 * M5a (E-009) — option lists shared by more than one family module. Kept here
 * so that no family module imports another family module.
 */
export const SECTION_OPTIONS = ["creche", "nursery", "primary", "jss", "sss"] as const;

export const PRIVATE_CURRICULA = [
  "nigerian_national",
  "british",
  "american",
  "montessori",
  "islamiyya_integrated",
] as const;

export const PRIVATE_INTAKE_MODES = [
  "open_rolling",
  "cycle_with_entrance_exam",
  "cycle_without_exam",
] as const;

export const TRADE_OPTIONS = [
  "electrical_installation",
  "motor_vehicle_mechanics",
  "carpentry_joinery",
  "welding_fabrication",
  "building_construction",
  "computer_craft",
  "catering_craft",
  "garment_making",
  "other",
] as const;
