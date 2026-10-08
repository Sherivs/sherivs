/**
 * Governed experience configuration.
 *
 * Organization reality, runtime, capabilities, role, and theme compose a
 * configuration the UI may render. Arbitrary records do not become UI.
 */
import { z } from "zod";

export const experiencePlaneSchema = z.enum([
  "public",
  "organization-public",
  "application",
  "organization-workspace",
  "internal",
  "runtime",
]);

export type ExperiencePlane = z.infer<typeof experiencePlaneSchema>;

export const experienceConfigurationSchema = z
  .object({
    plane: experiencePlaneSchema,
    tenantId: z.string().min(1).nullable(),
    runtimeId: z.string().min(1).nullable(),
    actorId: z.string().min(1).nullable(),
    capabilities: z.array(z.string().min(1)),
    theme: z.enum(["light", "dark", "system"]),
    locale: z.string().min(2),
    timeZone: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.plane === "organization-workspace" || value.plane === "organization-public") &&
      !value.tenantId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["tenantId"],
        message: "An organization experience requires tenant context.",
      });
    }
    if (value.plane === "internal" && value.tenantId) {
      ctx.addIssue({
        code: "custom",
        path: ["tenantId"],
        message: "The Sherivs internal workspace is not a customer tenant.",
      });
    }
    if (value.plane === "runtime" && !value.runtimeId) {
      ctx.addIssue({
        code: "custom",
        path: ["runtimeId"],
        message: "A runtime experience requires an installed runtime id.",
      });
    }
    if (value.plane === "application" && !value.actorId) {
      ctx.addIssue({
        code: "custom",
        path: ["actorId"],
        message: "The application shell requires an authenticated actor.",
      });
    }
  });

export type ExperienceConfiguration = z.infer<typeof experienceConfigurationSchema>;

export function parseExperienceConfiguration(input: unknown) {
  return experienceConfigurationSchema.safeParse(input);
}

/** Navigation items appear only when every required capability is held. */
export function visibleByCapability<T extends { requires: readonly string[] }>(
  items: readonly T[],
  capabilities: readonly string[],
): T[] {
  const held = new Set(capabilities);
  return items.filter((item) => item.requires.every((capability) => held.has(capability)));
}
