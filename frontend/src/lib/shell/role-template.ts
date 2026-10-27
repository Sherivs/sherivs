import type { AppRole } from "@/lib/roles";

/** Map the live identity-store membership kind onto the catalog family template. */
export function templateForAppRole(role: AppRole): string {
  switch (role) {
    case "admin":
    case "principal":
      return "head_of_institution";
    case "hq":
      return "proprietor";
    case "bursar":
      return "bursar";
    case "teacher":
      return "teacher";
    case "parent":
      return "parent";
    case "student":
      return "student";
    case "driver":
      return "driver";
    case "super_admin":
      return "proprietor";
    default:
      return "support_staff";
  }
}

export function searchableSection(key: string, label: string): boolean {
  const hay = `${key} ${label}`.toLowerCase();
  return (
    hay.includes("student") ||
    hay.includes("learner") ||
    hay.includes("teacher") ||
    hay.includes("staff") ||
    hay.includes("child") ||
    hay.includes("message") ||
    hay.includes("fee") ||
    hay.includes("receipt") ||
    hay.includes("library") ||
    hay.includes("attendance") ||
    hay.includes("grade") ||
    hay.includes("exam") ||
    hay.includes("news") ||
    hay.includes("announce")
  );
}
