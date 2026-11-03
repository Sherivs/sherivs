import { z } from "zod";

export const tenantShiftSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    kind: z.enum(["morning", "afternoon", "evening", "weekend", "full_day"]),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
  })
  .strict();

export const tenantCampusSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string().nullable(),
    isActive: z.boolean(),
    shifts: z.array(tenantShiftSchema),
  })
  .strict();

export const tenantHierarchySchema = z
  .object({
    organization: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
      })
      .strict(),
    campuses: z.array(tenantCampusSchema),
    unassignedShifts: z.array(tenantShiftSchema),
  })
  .strict();

export type TenantShift = z.infer<typeof tenantShiftSchema>;
export type TenantCampus = z.infer<typeof tenantCampusSchema>;
export type TenantHierarchy = z.infer<typeof tenantHierarchySchema>;
