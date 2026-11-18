/**
 * Custom role and responsibility builder: pure rules (mission M4, ADR-116).
 *
 * Nothing here talks to the network. The database is the authority (ADR-114 guard on
 * `org_custom_roles`, the M4 definer functions, the M009 triggers); these functions give the admin
 * an explanation before the database refuses, and compute the "simulate as" workspace with the
 * existing manifest code (`resolveWorkspaceManifest`, `denialReason`).
 */
import { z } from "zod";
import { catalogItem, denialReason } from "@/lib/sherivs-ws/engine";
import { resolveWorkspaceManifest } from "@/lib/workspaces/manifest-resolver";
import {
  WORKSPACE_CATEGORIES,
  type RoleTemplate,
  type WorkspaceCategory,
  type WorkspaceManifest,
} from "@/lib/workspaces/contract";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------
export const ROLE_BUILDER_ERROR_CODES = [
  "UNAUTHENTICATED",
  "NO_ORGANIZATION",
  "FORBIDDEN",
  "VALIDATION",
  "PROTECTED_PERMISSION",
  "SOD_VIOLATION",
  "SCOPE_TOO_WIDE",
  "FOUR_EYES",
  "SELF_GRANT",
  "NOT_FOUND",
  "CONFLICT",
  "DELEGATION_EXCEEDS_SOURCE",
  "UNKNOWN",
] as const;
export type RoleBuilderErrorCode = (typeof ROLE_BUILDER_ERROR_CODES)[number];

/** Thrown by every M4 server function. The code travels in the message as `[CODE] text`. */
export class RoleBuilderError extends Error {
  readonly code: RoleBuilderErrorCode;
  constructor(code: RoleBuilderErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "RoleBuilderError";
    this.code = code;
  }
  get detail(): string {
    return this.message.replace(/^\[[A-Z_]+\] /, "");
  }
}

/** Client side: recover the typed code and the human text from a thrown server-function error. */
export function parseRoleBuilderError(error: unknown): {
  code: RoleBuilderErrorCode;
  message: string;
} {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = /^\[([A-Z_]+)\] ([\s\S]*)$/.exec(raw);
  if (match && (ROLE_BUILDER_ERROR_CODES as readonly string[]).includes(match[1]!)) {
    return { code: match[1] as RoleBuilderErrorCode, message: match[2]! };
  }
  return { code: "UNKNOWN", message: raw || "Something went wrong. Nothing was changed." };
}

/** Map a PostgREST / Postgres refusal to a typed error. Messages win over SQLSTATE. */
export function mapDatabaseError(error: { code?: string | null; message?: string | null }) {
  const message = error.message ?? "The database refused the change.";
  const text = message.toLowerCase();
  if (text.includes("four-eyes")) return new RoleBuilderError("FOUR_EYES", message);
  if (text.includes("separation of duties")) return new RoleBuilderError("SOD_VIOLATION", message);
  if (text.includes("protected permission"))
    return new RoleBuilderError("PROTECTED_PERMISSION", message);
  if (text.includes("no_self_role_grant")) return new RoleBuilderError("SELF_GRANT", message);
  if (text.includes("scope ceiling")) return new RoleBuilderError("SCOPE_TOO_WIDE", message);
  if (text.includes("delegation") && (text.includes("exceed") || text.includes("after its source")))
    return new RoleBuilderError("DELEGATION_EXCEEDS_SOURCE", message);
  switch (error.code) {
    case "42501":
      return new RoleBuilderError("FORBIDDEN", message);
    case "22023":
    case "23514":
    case "23505":
      return new RoleBuilderError("VALIDATION", message);
    case "42704":
      return new RoleBuilderError("NOT_FOUND", message);
    case "55000":
    case "40001":
      return new RoleBuilderError("CONFLICT", message);
    default:
      return new RoleBuilderError("UNKNOWN", message);
  }
}

/** Parse with zod; a failure becomes a VALIDATION error naming the first problem. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new RoleBuilderError("VALIDATION", `${where}${issue?.message ?? "invalid input"}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const SCOPE_CEILINGS = ["org", "campus", "faculty", "department", "class", "self"] as const;
export type ScopeCeiling = (typeof SCOPE_CEILINGS)[number];
const SCOPE_RANK: Record<ScopeCeiling, number> = {
  org: 0,
  campus: 1,
  faculty: 2,
  department: 3,
  class: 4,
  self: 5,
};

const sectionId = z
  .string()
  .regex(/^[a-z][a-z0-9_.-]{1,63}$/, "use lower-case letters, digits, _ . or -");
export const navSectionSchema = z.object({
  id: sectionId,
  label: z.string().trim().min(2).max(60),
});
export const layoutSchema = z
  .object({
    nav: z.array(navSectionSchema).max(3, "at most three navigation sections"),
    widgets: z
      .array(z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/))
      .max(12)
      .default([]),
  })
  .refine((layout) => new Set(layout.nav.map((s) => s.id)).size === layout.nav.length, {
    message: "navigation section ids must differ",
    path: ["nav"],
  });
export type RoleLayout = z.infer<typeof layoutSchema>;

const permissionCode = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, "unknown permission");
const uniqueList = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((list) => new Set(list).size === list.length, { message: "duplicates are not allowed" });

export const draftInputSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_.-]{1,59}$/, "use 2 to 60 lower-case letters, digits, _ . or -"),
  name: z.string().trim().min(3).max(120),
  baseTemplate: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/)
    .nullable(),
  permissions: uniqueList(permissionCode, 120),
  responsibilities: uniqueList(z.string().regex(/^[a-z][a-z0-9_.:-]{1,79}$/), 40).default([]),
  scopeCeiling: z.enum(SCOPE_CEILINGS),
  workspaceCategory: z.enum(WORKSPACE_CATEGORIES),
  layout: layoutSchema,
});
export type CustomRoleDraftInput = z.infer<typeof draftInputSchema>;

export const roleIdSchema = z.object({ id: z.string().uuid() });
export const roleCodeSchema = z.object({ code: z.string().regex(/^custom\.[a-z0-9_.-]{2,60}$/) });

export const responsibilityInputSchema = z.object({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_.-]{1,63}$/)
    .refine((code) => !code.startsWith("nav."), "the nav. prefix is reserved"),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).default(""),
  permissions: uniqueList(permissionCode, 40).refine((l) => l.length > 0, "pick a permission"),
  evidenceRequired: z.array(z.string().trim().min(2).max(120)).max(12).default([]),
  reviewCadenceDays: z.number().int().min(7).max(730).nullable(),
  dailyPriority: z.number().int().min(0).max(10000).default(100),
  navSection: navSectionSchema,
});
export type ResponsibilityInput = z.infer<typeof responsibilityInputSchema>;

export function customRoleCode(slug: string): string {
  return `custom.${slug}`;
}

/** Same rule as `public.custom_role_catalog_code` (the assignable catalogue code). */
export function assignableRoleCode(orgId: string, code: string): string {
  return `custom.${orgId.replace(/-/g, "")}.${code.slice("custom.".length)}`;
}

// ---------------------------------------------------------------------------
// Catalogue and preview
// ---------------------------------------------------------------------------
export interface CataloguePermission {
  code: string;
  label: string;
  module: string;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  protected: boolean;
}
export interface CatalogueTemplate {
  code: string;
  scope: ScopeCeiling;
  mandatory: string[];
  optional: string[];
  nav: string[];
  workspaceMode: "full" | "task_surface" | "none";
}
export interface SodRule {
  a: string;
  b: string;
  description: string;
}
export interface CatalogueResponsibility {
  id: string;
  code: string;
  label: string;
  kind: "core" | "add_on" | "custom";
  permissions: string[];
  description: string | null;
  evidenceRequired: string[];
  reviewCadenceDays: number | null;
}
export interface BuilderCatalogue {
  institutionType: string | null;
  templates: CatalogueTemplate[];
  permissions: CataloguePermission[];
  /** Non-protected permissions this institution's templates use (the "start from scratch" set). */
  allowedPermissions: string[];
  sodRules: SodRule[];
  responsibilities: CatalogueResponsibility[];
}

export interface SodViolation {
  a: string;
  b: string;
  description: string;
  /** Which side comes from the base template's mandatory set (cannot be unticked). */
  fromBase: string[];
  explanation: string;
}

export function analyseSod(
  permissions: readonly string[],
  baseMandatory: readonly string[],
  rules: readonly SodRule[],
): SodViolation[] {
  const held = new Set([...permissions, ...baseMandatory]);
  const base = new Set(baseMandatory);
  return rules
    .filter((rule) => held.has(rule.a) && held.has(rule.b))
    .sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .map((rule) => {
      const fromBase = [rule.a, rule.b].filter((code) => base.has(code));
      const removable = [rule.a, rule.b].filter((code) => !base.has(code));
      const fix = removable.length
        ? `Remove ${removable.join(" or ")}, or give that duty to another role.`
        : "The base template already combines them; pick another base template.";
      return {
        a: rule.a,
        b: rule.b,
        description: rule.description,
        fromBase,
        explanation: `${rule.a} and ${rule.b} cannot be held by one role: ${rule.description}. ${fix}`,
      };
    });
}

export type RiskLevel = "low" | "medium" | "high";
export interface RiskPreview {
  blocked: boolean;
  level: RiskLevel;
  sod: SodViolation[];
  protectedPermissions: string[];
  unknownPermissions: string[];
  outsideInstitution: string[];
  scopeProblem: string | null;
  navProblem: string | null;
  effectivePermissions: string[];
  reasons: string[];
}

function templateOf(catalogue: BuilderCatalogue, code: string | null) {
  return code ? (catalogue.templates.find((t) => t.code === code) ?? null) : null;
}

/** Read-only SoD and risk preview, from the database's own rules. */
export function previewDraft(draft: CustomRoleDraftInput, catalogue: BuilderCatalogue): RiskPreview {
  const byCode = new Map(catalogue.permissions.map((p) => [p.code, p]));
  const template = templateOf(catalogue, draft.baseTemplate);
  const reasons: string[] = [];
  const unknownPermissions = draft.permissions.filter((code) => !byCode.has(code));
  const protectedPermissions = draft.permissions.filter((code) => byCode.get(code)?.protected);
  const allowed = new Set([
    ...catalogue.allowedPermissions,
    ...(template ? [...template.mandatory, ...template.optional] : []),
  ]);
  const outsideInstitution = draft.permissions.filter(
    (code) => byCode.has(code) && !byCode.get(code)!.protected && !allowed.has(code),
  );
  const baseMandatory = template?.mandatory ?? [];
  const sod = analyseSod(draft.permissions, baseMandatory, catalogue.sodRules);
  let scopeProblem: string | null = null;
  if (draft.baseTemplate && !template) scopeProblem = `Unknown base template ${draft.baseTemplate}.`;
  else if (template && SCOPE_RANK[draft.scopeCeiling] < SCOPE_RANK[template.scope]) {
    scopeProblem = `Scope ${draft.scopeCeiling} is wider than the base template's ${template.scope}.`;
  }
  const navProblem =
    draft.layout.nav.length === 3
      ? null
      : `Choose exactly three navigation sections (now ${draft.layout.nav.length}).`;
  const effective = [...new Set([...baseMandatory, ...draft.permissions])].sort();
  const sensitivities = effective.map((code) => byCode.get(code)?.sensitivity);
  const level: RiskLevel = sensitivities.includes("restricted")
    ? "high"
    : sensitivities.includes("confidential")
      ? "medium"
      : "low";
  if (protectedPermissions.length)
    reasons.push(
      `Protected permissions can only come from a catalogue role: ${protectedPermissions.join(", ")}.`,
    );
  if (unknownPermissions.length)
    reasons.push(`Unknown permissions: ${unknownPermissions.join(", ")}.`);
  if (outsideInstitution.length)
    reasons.push(
      `Not used by any template of this institution type: ${outsideInstitution.join(", ")}.`,
    );
  for (const violation of sod) reasons.push(violation.explanation);
  if (scopeProblem) reasons.push(scopeProblem);
  if (navProblem) reasons.push(navProblem);
  if (level !== "low")
    reasons.push(
      level === "high"
        ? "Holds restricted permissions: review who will hold it."
        : "Holds confidential permissions.",
    );
  return {
    blocked:
      sod.length > 0 ||
      protectedPermissions.length > 0 ||
      unknownPermissions.length > 0 ||
      outsideInstitution.length > 0 ||
      scopeProblem !== null,
    level,
    sod,
    protectedPermissions,
    unknownPermissions,
    outsideInstitution,
    scopeProblem,
    navProblem,
    effectivePermissions: effective,
    reasons,
  };
}

/** Throw the typed error the database would raise, so a refused draft never reaches it. */
export function assertDraftAllowed(preview: RiskPreview): void {
  if (preview.protectedPermissions.length)
    throw new RoleBuilderError(
      "PROTECTED_PERMISSION",
      `Protected permission ${preview.protectedPermissions[0]} cannot be put in a custom role.`,
    );
  if (preview.unknownPermissions.length)
    throw new RoleBuilderError(
      "VALIDATION",
      `Unknown permission ${preview.unknownPermissions[0]}.`,
    );
  if (preview.outsideInstitution.length)
    throw new RoleBuilderError(
      "VALIDATION",
      `Permission ${preview.outsideInstitution[0]} is not available to this institution type.`,
    );
  if (preview.sod.length)
    throw new RoleBuilderError("SOD_VIOLATION", preview.sod[0]!.explanation);
  if (preview.scopeProblem) throw new RoleBuilderError("SCOPE_TOO_WIDE", preview.scopeProblem);
}

// ---------------------------------------------------------------------------
// Workspace computation (the same shape activation writes to the database)
// ---------------------------------------------------------------------------
/** A role's navigation responsibility rows, as `custom_role_activate` writes them. */
export interface RoleNavRow {
  id: string;
  code: string;
  label: string;
  dailyPriority: number;
  navId: string;
  navLabel: string;
  kind: "core" | "add_on" | "custom";
}

export function navRowsForLayout(roleCode: string, layout: RoleLayout): RoleNavRow[] {
  return layout.nav.map((section, index) => ({
    id: `${roleCode}#nav${index + 1}`,
    code: `nav.${index + 1}`,
    label: section.label,
    dailyPriority: index,
    navId: section.id,
    navLabel: section.label,
    kind: "custom",
  }));
}

export interface HolderWorkspaceInput {
  orgId: string;
  userId: string;
  roleCode: string;
  roleName: string;
  category: WorkspaceCategory;
  navRows: readonly RoleNavRow[];
  permissions: readonly string[];
  at: string;
  /** When set, the holder reaches the role through a delegation from this assignment owner. */
  delegatedFromUserId?: string;
}

/** The holder's workspace, computed by the existing manifest resolver. */
export function holderWorkspace(input: HolderWorkspaceInput): WorkspaceManifest | null {
  const template: RoleTemplate = {
    id: input.roleCode,
    code: input.roleCode,
    label: input.roleName,
    category: input.category,
    responsibilities: input.navRows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      kind: row.kind,
      permissionCodes: [],
      dailyPriority: row.dailyPriority,
      primaryNav: { id: row.navId, label: row.navLabel },
    })),
    permissions: [],
    approvalAuthorities: [],
    reportingRelationships: [],
  };
  const atMs = Date.parse(input.at);
  const from = new Date(atMs - 86_400_000).toISOString();
  const assignmentOwner = input.delegatedFromUserId ?? input.userId;
  return resolveWorkspaceManifest(
    { id: input.userId },
    { id: input.orgId, category: input.category },
    {
      assignments: [
        {
          id: "assignment",
          tenantId: input.orgId,
          userId: assignmentOwner,
          roleTemplateId: input.roleCode,
          scopeType: "institution",
          scopeRef: null,
          validFrom: from,
          validUntil: null,
          temporary: false,
          evidence: [],
          restrictions: [],
          status: "active",
        },
      ],
      roleTemplates: [template],
      delegations: input.delegatedFromUserId
        ? [
            {
              id: "delegation",
              assignmentId: "assignment",
              delegateUserId: input.userId,
              validFrom: from,
              validUntil: new Date(atMs + 86_400_000).toISOString(),
            },
          ]
        : [],
    },
    input.at,
  );
}

export interface SimulatedWidget {
  key: string;
  label: string;
  shown: boolean;
  reason: string | null;
}
export interface SimulationResult {
  manifest: WorkspaceManifest | null;
  primaryNav: { id: string; label: string }[];
  widgets: SimulatedWidget[];
  permissions: string[];
  note: string;
}

/** "Simulate as": the workspace a holder of the draft would see, over fixture data, no writes. */
export function simulateDraft(
  draft: CustomRoleDraftInput,
  catalogue: BuilderCatalogue,
  at: string,
): SimulationResult {
  const preview = previewDraft(draft, catalogue);
  const code = customRoleCode(draft.slug);
  const manifest = holderWorkspace({
    orgId: "simulated-organization",
    userId: "simulated-holder",
    roleCode: code,
    roleName: draft.name,
    category: draft.workspaceCategory,
    navRows: navRowsForLayout(code, draft.layout),
    permissions: preview.effectivePermissions,
    at,
  });
  const permSet = new Set(preview.effectivePermissions);
  const widgets = draft.layout.widgets.map((key): SimulatedWidget => {
    const item = catalogItem(key);
    if (!item || item.kind !== "widget") {
      return { key, label: key, shown: false, reason: "not a catalogue widget" };
    }
    const reason = denialReason(item, permSet, new Set(item.feature ? [item.feature] : []));
    return {
      key,
      label: item.label.en,
      shown: reason === null,
      reason: reason === "permission" ? "the role's permissions do not unlock it" : reason,
    };
  });
  return {
    manifest,
    primaryNav: manifest ? manifest.primaryNav.map((s) => ({ id: s.id, label: s.label })) : [],
    widgets,
    permissions: preview.effectivePermissions,
    note: "Simulated over fixture data: one holder, one organization, no records read or written.",
  };
}
