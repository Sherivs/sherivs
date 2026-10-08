/**
 * Sherivs experience configuration contract.
 *
 * Conceptual:
 *   Organization reality + runtime + capabilities + role + permissions
 *   + context + theme + content = Experience Configuration
 *
 * The frontend consumes this typed contract. Arbitrary database rows do not
 * become UI without authorization and schema validation (AGENTS §26–27, §34).
 *
 * Version-target: V1.
 */
import { z } from "zod";

export const ExperiencePlaneSchema = z.enum([
  "public_sherivs",
  "public_organization",
  "application_shell",
  "organization_workspace",
  "internal_sherivs",
  "domain_runtime",
  "authentication",
  "account",
]);

export const ExperienceDensitySchema = z.enum(["compact", "comfortable"]);
export const ExperienceThemeSchema = z.enum(["light", "dark", "system"]);
export const ExperienceContrastSchema = z.enum(["standard", "high_contrast"]);

export const ExperienceNavItemSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(300),
  capability: z.string().min(1).max(120).optional(),
  runtime: z.string().min(1).max(120).optional(),
});

export const ExperienceConfigurationSchema = z.object({
  plane: ExperiencePlaneSchema,
  tenantId: z.string().min(1).max(128).nullable(),
  runtimeIds: z.array(z.string().min(1).max(120)).max(32),
  roleTitle: z.string().min(1).max(80),
  theme: ExperienceThemeSchema,
  density: ExperienceDensitySchema,
  contrast: ExperienceContrastSchema,
  locale: z.string().min(2).max(16),
  navigation: z.array(ExperienceNavItemSchema).max(200),
  capabilities: z.array(z.string().min(1).max(120)).max(400),
});

export type ExperienceConfiguration = z.infer<typeof ExperienceConfigurationSchema>;

export function parseExperienceConfiguration(input: unknown): ExperienceConfiguration {
  return ExperienceConfigurationSchema.parse(input);
}
