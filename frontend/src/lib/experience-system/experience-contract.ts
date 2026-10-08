/**
 * Sherivs Experience Contract — governed, schema-validated experience
 * configuration (brief §47).
 *
 *   Organization reality + runtime + capabilities + role + permissions
 *   + context + theme + content  =  Experience Configuration
 *
 * The frontend consumes THIS contract; arbitrary database data never becomes
 * UI directly. The resolver is pure and conservative:
 *
 *  - the internal (Sherivs operator) surface is a separate security boundary:
 *    it is refused unless the actor is a verified platform operator, and it is
 *    never merged into any tenant surface;
 *  - tenant surfaces require a tenant context supplied by the SERVER — a
 *    tenant id in client-controlled input is never trusted;
 *  - every navigation destination and command is filtered by the actor's
 *    authorized capabilities and the tenant's active runtimes;
 *  - high-risk commands resolve to REQUIRE_APPROVAL, never to a silent ALLOW;
 *  - filtering here is cosmetic. Backend authorization remains the boundary
 *    (AGENTS.md §34); this contract can only ever REMOVE options.
 */
import { z } from "zod";

export const EXPERIENCE_SURFACES = [
  "public",
  "organization-public",
  "workspace",
  "internal",
  "mobile",
  "pwa",
  "embedded",
  "conversational",
  "developer",
  "system",
] as const;
export type ExperienceSurface = (typeof EXPERIENCE_SURFACES)[number];

/** Surfaces that exist inside a tenant and therefore require tenant context. */
const TENANT_SURFACES: ReadonlySet<ExperienceSurface> = new Set([
  "organization-public",
  "workspace",
  "mobile",
  "pwa",
  "embedded",
  "conversational",
  "developer",
]);

export const EXPERIENCE_DECISIONS = [
  "ALLOW",
  "DENY",
  "REDACT",
  "ESCALATE",
  "REQUIRE_APPROVAL",
] as const;
export type ExperienceDecision = (typeof EXPERIENCE_DECISIONS)[number];

/* ── Catalog types ───────────────────────────────────────────────────── */

export interface DestinationSeed {
  readonly key: string;
  readonly label: string;
  readonly iconKey: string;
  readonly url: string;
  /** All required (AND). Empty = visible to any authenticated tenant member. */
  readonly capabilities: readonly string[];
  /** Runtime that must be active in the tenant; undefined = platform-owned. */
  readonly runtime?: string;
  /** `planned` destinations are part of the target IA but have no route yet. */
  readonly availability: "available" | "planned";
  readonly surfaces: readonly ExperienceSurface[];
}

export interface CommandSeed {
  readonly key: string;
  readonly label: string;
  readonly capabilities: readonly string[];
  readonly runtime?: string;
  readonly risk: "low" | "high";
  readonly availability: "available" | "planned";
  readonly surfaces: readonly ExperienceSurface[];
}

/* ── Input / output schemas ──────────────────────────────────────────── */

export const experienceInputSchema = z.object({
  surface: z.enum(EXPERIENCE_SURFACES),
  actor: z.object({
    authenticated: z.boolean(),
    /** Set only by the server after verifying a Sherivs operator identity. */
    platformOperator: z.boolean().default(false),
    capabilities: z.array(z.string()).default([]),
  }),
  tenant: z
    .object({
      id: z.string().min(1),
      activeRuntimes: z.array(z.string()).default([]),
      brandAccent: z.string().nullable().optional(),
    })
    .nullable(),
  locale: z.string().default("en"),
  timezone: z.string().default("UTC"),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  contrast: z.enum(["standard", "high"]).default("standard"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
});
export type ExperienceInput = z.input<typeof experienceInputSchema>;

const destinationSchema = z.object({
  key: z.string(),
  label: z.string(),
  iconKey: z.string(),
  url: z.string().startsWith("/"),
});
const commandSchema = z.object({
  key: z.string(),
  label: z.string(),
  decision: z.enum(["ALLOW", "REQUIRE_APPROVAL"]),
});

export const experienceConfigurationSchema = z.object({
  decision: z.enum(EXPERIENCE_DECISIONS),
  surface: z.enum(EXPERIENCE_SURFACES),
  tenantId: z.string().nullable(),
  reason: z.string().optional(),
  shell: z.enum(["public", "organization", "internal", "system"]),
  presentation: z.object({
    locale: z.string(),
    timezone: z.string(),
    theme: z.enum(["light", "dark", "system"]),
    contrast: z.enum(["standard", "high"]),
    density: z.enum(["comfortable", "compact"]),
  }),
  navigation: z.array(destinationSchema),
  commands: z.array(commandSchema),
});
export type ExperienceConfiguration = z.infer<typeof experienceConfigurationSchema>;

/* ── Resolver ────────────────────────────────────────────────────────── */

function shellFor(surface: ExperienceSurface): ExperienceConfiguration["shell"] {
  if (surface === "public") return "public";
  if (surface === "internal") return "internal";
  if (surface === "system") return "system";
  return "organization";
}

function denied(
  input: z.output<typeof experienceInputSchema>,
  reason: string,
  decision: ExperienceDecision = "DENY",
): ExperienceConfiguration {
  return {
    decision,
    surface: input.surface,
    tenantId: null,
    reason,
    shell: shellFor(input.surface),
    presentation: presentationOf(input),
    navigation: [],
    commands: [],
  };
}

function presentationOf(input: z.output<typeof experienceInputSchema>) {
  return {
    locale: input.locale,
    timezone: input.timezone,
    theme: input.theme,
    contrast: input.contrast,
    density: input.density,
  };
}

export interface ExperienceCatalog {
  readonly destinations: readonly DestinationSeed[];
  readonly commands: readonly CommandSeed[];
}

export function resolveExperienceConfiguration(
  rawInput: ExperienceInput,
  catalog: ExperienceCatalog,
): ExperienceConfiguration {
  const parsed = experienceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      decision: "DENY",
      surface: "system",
      tenantId: null,
      reason: "Invalid experience input",
      shell: "system",
      presentation: {
        locale: "en",
        timezone: "UTC",
        theme: "system",
        contrast: "standard",
        density: "comfortable",
      },
      navigation: [],
      commands: [],
    };
  }
  const input = parsed.data;

  // Public and system surfaces carry no tenant data and no authorized navigation.
  if (input.surface === "public" || input.surface === "system") {
    return {
      decision: "ALLOW",
      surface: input.surface,
      tenantId: null,
      shell: shellFor(input.surface),
      presentation: presentationOf(input),
      navigation: [],
      commands: [],
    };
  }

  if (!input.actor.authenticated && input.surface !== "organization-public") {
    return denied(input, "Authentication required");
  }

  if (input.surface === "internal") {
    if (!input.actor.platformOperator) {
      return denied(input, "Internal surface is restricted to verified Sherivs operators");
    }
    return build(input, null, catalog, new Set(input.actor.capabilities), new Set());
  }

  if (TENANT_SURFACES.has(input.surface) && input.tenant === null) {
    return denied(input, "Tenant context is required for this surface");
  }

  // Organization-public is anonymous by design: it exposes public sections only,
  // never authorized navigation or commands.
  if (input.surface === "organization-public") {
    return {
      decision: "ALLOW",
      surface: input.surface,
      tenantId: input.tenant?.id ?? null,
      shell: "organization",
      presentation: presentationOf(input),
      navigation: [],
      commands: [],
    };
  }

  return build(
    input,
    input.tenant?.id ?? null,
    catalog,
    new Set(input.actor.capabilities),
    new Set(input.tenant?.activeRuntimes ?? []),
  );
}

function build(
  input: z.output<typeof experienceInputSchema>,
  tenantId: string | null,
  catalog: ExperienceCatalog,
  capabilities: ReadonlySet<string>,
  runtimes: ReadonlySet<string>,
): ExperienceConfiguration {
  const permitted = <T extends { capabilities: readonly string[]; runtime?: string; availability: string; surfaces: readonly ExperienceSurface[] }>(
    seed: T,
  ) =>
    seed.availability === "available" &&
    seed.surfaces.includes(input.surface) &&
    seed.capabilities.every((c) => capabilities.has(c)) &&
    (seed.runtime === undefined || runtimes.has(seed.runtime));

  const seenNav = new Set<string>();
  const navigation = catalog.destinations
    .filter(permitted)
    .filter((d) => (seenNav.has(d.key) ? false : (seenNav.add(d.key), true)))
    .map(({ key, label, iconKey, url }) => ({ key, label, iconKey, url }));

  const commands = catalog.commands.filter(permitted).map((c) => ({
    key: c.key,
    label: c.label,
    decision: c.risk === "high" ? ("REQUIRE_APPROVAL" as const) : ("ALLOW" as const),
  }));

  return {
    decision: "ALLOW",
    surface: input.surface,
    tenantId,
    shell: shellFor(input.surface),
    presentation: presentationOf(input),
    navigation,
    commands,
  };
}

/* ── Universal organization workspace catalog (target IA) ────────────── */

const WS: readonly ExperienceSurface[] = ["workspace", "mobile", "pwa"];

const dest = (
  key: string,
  label: string,
  iconKey: string,
  url: string,
  capability: string | null,
  availability: DestinationSeed["availability"],
  runtime?: string,
): DestinationSeed => ({
  key,
  label,
  iconKey,
  url,
  capabilities: capability ? [capability] : [],
  availability,
  surfaces: WS,
  ...(runtime ? { runtime } : {}),
});

/**
 * The universal organization workspace information architecture. Everything
 * is capability-driven: nothing appears unless the tenant's runtimes and the
 * viewer's capabilities allow it. `planned` entries are the target IA with no
 * route yet — they are never rendered, so the shell cannot link to a page that
 * does not exist.
 */
export const UNIVERSAL_WORKSPACE_DESTINATIONS: readonly DestinationSeed[] = [
  dest("overview", "Overview", "layout-dashboard", "/command-centre", "workspace.overview.view", "available"),
  dest("reality", "Reality", "layers", "/runtime", "reality.view", "available"),
  dest("people", "People", "users", "/people", "people.view", "planned"),
  dest("teams", "Teams", "users-round", "/teams", "teams.view", "planned"),
  dest("work", "Work", "briefcase", "/work", "work.view", "planned"),
  dest("missions", "Missions", "target", "/missions", "missions.view", "planned"),
  dest("knowledge", "Knowledge", "book-open", "/knowledge", "knowledge.view", "planned"),
  dest("memory", "Memory", "brain", "/memory", "memory.view", "planned"),
  dest("communications", "Communications", "message-square", "/messages", "communications.view", "available"),
  dest("calendar", "Calendar", "calendar", "/calendar", "calendar.view", "planned"),
  dest("tasks", "Tasks", "check-square", "/tasks", "tasks.view", "planned"),
  dest("files", "Files", "folder", "/files", "files.view", "planned"),
  dest("data", "Data", "database", "/data", "data.view", "planned"),
  dest("reports", "Reports", "file-bar-chart", "/reports", "reports.view", "planned"),
  dest("automation", "Automation", "workflow", "/automation", "automation.view", "planned"),
  dest("ai-workforce", "AI Workforce", "bot", "/workforce", "workforce.view", "planned"),
  dest("integrations", "Integrations", "plug", "/integrations", "integrations.view", "planned"),
  dest("analytics", "Analytics", "chart-line", "/analytics", "analytics.view", "planned"),
  dest("governance", "Governance", "shield-check", "/governance", "governance.view", "planned"),
  dest("settings", "Settings", "settings", "/settings", "settings.view", "available"),
];

export const UNIVERSAL_COMMANDS: readonly CommandSeed[] = [
  { key: "open-notifications", label: "View notifications", capabilities: [], risk: "low", availability: "available", surfaces: WS },
  { key: "open-settings", label: "Open settings", capabilities: ["settings.view"], risk: "low", availability: "available", surfaces: WS },
  { key: "create-mission", label: "Create mission", capabilities: ["missions.create"], risk: "low", availability: "planned", surfaces: WS },
  { key: "invite-member", label: "Invite member", capabilities: ["people.invite"], risk: "high", availability: "planned", surfaces: WS },
  { key: "ask-jarvis", label: "Ask Jarvis", capabilities: ["jarvis.use"], risk: "low", availability: "planned", surfaces: WS },
  { key: "run-approved-action", label: "Run approved action", capabilities: ["actions.execute"], risk: "high", availability: "planned", surfaces: WS },
];

export const UNIVERSAL_CATALOG: ExperienceCatalog = {
  destinations: UNIVERSAL_WORKSPACE_DESTINATIONS,
  commands: UNIVERSAL_COMMANDS,
};
