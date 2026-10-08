/**
 * Sherivs Experience API — governed contracts for dynamic experience generation.
 *
 *   Organization reality + runtime + capabilities + role + permissions
 *   + context + theme + content  =  ExperienceConfiguration
 *
 * The frontend consumes `ExperienceConfiguration`, never raw database rows. Every
 * input here is SERVER-RESOLVED (identity, tenant, capabilities); this module
 * validates shape and applies the fail-closed rules, but it does not decide
 * authorization — backend authorization remains the boundary (AGENTS §34). Where
 * this module hides something, that is presentation; the server still enforces.
 *
 * Laws:
 *  - Fail closed: no session → the public shell and nothing else.
 *  - The Sherivs workspace shell requires a server-attested platform-staff flag;
 *    no client-supplied value can select it.
 *  - Runtime-specific surfaces appear only when that runtime is installed.
 *  - Output is Zod-validated before any UI may use it.
 */
import { z } from "zod";
import {
  resolveWorkspaceNav,
  type NavContribution,
  type WorkspaceNavSection,
} from "@/lib/workspace-engine/navigation";

export const SHELL_KINDS = ["public", "application", "organization", "sherivs-workspace"] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];

export const ExperienceInput = z.object({
  authenticated: z.boolean(),
  /** Server-attested: the session holds the platform-staff role. */
  platformStaff: z.boolean().default(false),
  tenantId: z.string().min(1).nullable().default(null),
  installedRuntimes: z.array(z.string()).default([]),
  /** Capabilities the server authorized for this identity in this tenant. */
  capabilities: z.array(z.string()).default([]),
  role: z.string().nullable().default(null),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  contrast: z.enum(["standard", "high"]).default("standard"),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  locale: z.string().default("en"),
  timezone: z.string().default("UTC"),
});
export type ExperienceInput = z.input<typeof ExperienceInput>;

export const GLOBAL_SYSTEMS = [
  "commandPalette",
  "universalSearch",
  "notificationCenter",
  "aiInterface",
  "helpCenter",
  "keyboardShortcuts",
  "accessibilityControls",
  "accountSettings",
] as const;
export type GlobalSystem = (typeof GLOBAL_SYSTEMS)[number];

export const ExperienceConfiguration = z.object({
  schema: z.literal("sherivs.experience/v1"),
  shell: z.enum(SHELL_KINDS),
  tenantId: z.string().nullable(),
  /** Systems the shell mounts. Presentation only; each is server-enforced when used. */
  systems: z.array(z.enum(GLOBAL_SYSTEMS)),
  navigation: z.array(
    z.object({
      sectionKey: z.string(),
      sectionLabel: z.string(),
      runtimeRef: z.string(),
      items: z.array(z.object({ key: z.string(), label: z.string(), url: z.string().startsWith("/") })),
    }),
  ),
  presentation: z.object({
    theme: z.enum(["light", "dark", "system"]),
    contrast: z.enum(["standard", "high"]),
    density: z.enum(["compact", "comfortable", "spacious"]),
    locale: z.string(),
    timezone: z.string(),
  }),
  /** Why the configuration looks the way it does — explainable by construction. */
  provenance: z.array(z.string()),
});
export type ExperienceConfiguration = z.infer<typeof ExperienceConfiguration>;

const AUTHENTICATED_SYSTEMS: readonly GlobalSystem[] = [
  "commandPalette",
  "universalSearch",
  "notificationCenter",
  "helpCenter",
  "keyboardShortcuts",
  "accessibilityControls",
  "accountSettings",
];

export interface ResolveExperienceOptions {
  /** Navigation contributions admitted by the installed-runtime registry. */
  readonly contributions: readonly NavContribution[];
  /** Feature gate for the AI surface (server-evaluated). */
  readonly aiInterfaceAuthorized?: boolean;
}

export function resolveExperience(
  rawInput: ExperienceInput,
  options: ResolveExperienceOptions,
): ExperienceConfiguration {
  const input = ExperienceInput.parse(rawInput);
  const presentation = {
    theme: input.theme,
    contrast: input.contrast,
    density: input.density,
    locale: input.locale,
    timezone: input.timezone,
  };

  if (!input.authenticated) {
    return ExperienceConfiguration.parse({
      schema: "sherivs.experience/v1",
      shell: "public",
      tenantId: null,
      systems: ["accessibilityControls", "helpCenter", "keyboardShortcuts"],
      navigation: [],
      presentation,
      provenance: ["no session: public shell only"],
    });
  }

  const provenance: string[] = ["session present"];
  const installed = new Set(input.installedRuntimes);
  const admitted = options.contributions.filter(
    (c) => c.runtimeRef === "platform" || installed.has(c.runtimeRef),
  );
  if (admitted.length < options.contributions.length) {
    provenance.push("contributions from runtimes that are not installed were dropped");
  }

  let shell: ShellKind;
  if (input.platformStaff) {
    shell = "sherivs-workspace";
    provenance.push("server-attested platform staff");
  } else if (input.tenantId) {
    shell = "organization";
    provenance.push("tenant resolved by server");
  } else {
    shell = "application";
    provenance.push("no tenant context: universal application shell");
  }

  const sections: readonly WorkspaceNavSection[] =
    shell === "application" ? [] : resolveWorkspaceNav(admitted, new Set(input.capabilities));
  if (shell === "organization" && sections.length === 0) {
    provenance.push("no authorized destinations: navigation is empty, not defaulted");
  }

  const systems: GlobalSystem[] = [...AUTHENTICATED_SYSTEMS];
  if (options.aiInterfaceAuthorized) {
    systems.push("aiInterface");
    provenance.push("AI interface authorized by server");
  }

  return ExperienceConfiguration.parse({
    schema: "sherivs.experience/v1",
    shell,
    tenantId: shell === "sherivs-workspace" ? null : input.tenantId,
    systems,
    navigation: sections.map((s) => ({
      sectionKey: s.sectionKey,
      sectionLabel: s.sectionLabel,
      runtimeRef: s.runtimeRef,
      items: s.items.map((i) => ({ key: i.key, label: i.label, url: i.url })),
    })),
    presentation,
    provenance,
  });
}

/* ───────────── Organization public experience engine ───────────── */

export const ORG_PUBLIC_SECTIONS = [
  { key: "identity", label: "Identity", requiresRuntime: null },
  { key: "hero", label: "Introduction", requiresRuntime: null },
  { key: "about", label: "About", requiresRuntime: null },
  { key: "programs", label: "Programs and services", requiresRuntime: null },
  { key: "locations", label: "Locations", requiresRuntime: null },
  { key: "leadership", label: "Leadership", requiresRuntime: null },
  { key: "departments", label: "Departments", requiresRuntime: null },
  { key: "events", label: "Events", requiresRuntime: null },
  { key: "announcements", label: "Announcements", requiresRuntime: null },
  { key: "resources", label: "Resources and documents", requiresRuntime: null },
  { key: "forms", label: "Public forms", requiresRuntime: null },
  { key: "contact", label: "Contact", requiresRuntime: null },
  { key: "careers", label: "Careers", requiresRuntime: null },
  { key: "news", label: "News", requiresRuntime: null },
  { key: "media", label: "Media", requiresRuntime: null },
  { key: "policies", label: "Policies", requiresRuntime: null },
  { key: "accessibility", label: "Accessibility", requiresRuntime: null },
  { key: "assistant", label: "Assistant", requiresRuntime: null },
  { key: "admissions", label: "Admissions", requiresRuntime: "runtime:scholar" },
] as const;
export type OrgPublicSectionKey = (typeof ORG_PUBLIC_SECTIONS)[number]["key"];

export interface OrgPublicInput {
  /** Section keys for which the organization has PUBLISHED content. */
  readonly publishedSections: readonly string[];
  readonly installedRuntimes: readonly string[];
  /** Server-evaluated: public AI assistant is authorized for this organization. */
  readonly assistantAuthorized?: boolean;
}

export interface OrgPublicSection {
  readonly key: OrgPublicSectionKey;
  readonly label: string;
}

/**
 * A section renders only if (a) the organization published content for it,
 * (b) any runtime it needs is installed, and (c) for the assistant, the server
 * authorized it. Unpublished or unauthorized sections are absent — not empty.
 */
export function resolveOrgPublicSections(input: OrgPublicInput): readonly OrgPublicSection[] {
  const published = new Set(input.publishedSections);
  const installed = new Set(input.installedRuntimes);
  return ORG_PUBLIC_SECTIONS.filter((s) => {
    if (s.requiresRuntime && !installed.has(s.requiresRuntime)) return false;
    if (s.key === "assistant") return input.assistantAuthorized === true;
    return published.has(s.key);
  }).map((s) => ({ key: s.key, label: s.label }));
}
