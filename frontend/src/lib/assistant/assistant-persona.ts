const PERSONA_BY_ROLE: Readonly<Record<string, string>> = {
  admin: "My School Assistant",
  admin_officer: "My School Assistant",
  bursar: "My Bursary Assistant",
  driver: "My Route Assistant",
  form_teacher: "My Teaching Assistant",
  finance: "My Platform Finance Assistant",
  head_of_institution: "My Leadership Assistant",
  hod: "My Department Assistant",
  hq: "My Platform Assistant",
  engineering: "My Engineering Assistant",
  librarian: "My Library Assistant",
  nurse: "My Health Assistant",
  operations: "My Operations Assistant",
  parent: "My Family Assistant",
  platform_admin: "My Platform Assistant",
  platform_owner: "My Platform Assistant",
  principal: "My Leadership Assistant",
  proprietor: "My Organization Assistant",
  sales: "My Platform Sales Assistant",
  security: "My Security Assistant",
  student: "My Learning Companion",
  super_admin: "My Platform Assistant",
  support: "My Support Assistant",
  support_staff: "My Work Assistant",
  teacher: "My Teaching Assistant",
};

export function assistantPersonaForRole(role: string | null | undefined): string {
  return (role && PERSONA_BY_ROLE[role]) || "My Assistant";
}
