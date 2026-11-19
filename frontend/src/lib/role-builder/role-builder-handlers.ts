/**
 * Server-side handlers of the custom role and responsibility builder (ADR-121). Pure over a
 * `RoleBuilderPort`, so every validation and refusal path is unit-tested without a network.
 * `role-builder.functions.ts` wraps each one in `createServerFn` with the caller's JWT.
 */
import { z } from "zod";
import {
  RoleBuilderError,
  assertDraftAllowed,
  customRoleCode,
  draftInputSchema,
  parseInput,
  previewDraft,
  responsibilityInputSchema,
  roleIdSchema,
  simulateDraft,
  type BuilderCatalogue,
  type RiskPreview,
  type SimulationResult,
} from "./role-builder-core";
import type {
  AuditEntry,
  CallerContext,
  CustomRoleVersion,
  RoleBuilderPort,
} from "./role-builder-port";

export interface AdminContext extends CallerContext {
  orgId: string;
}

/** The organization always comes from the caller; the builder is admin only. */
export async function requireAdmin(port: RoleBuilderPort): Promise<AdminContext> {
  const caller = await port.caller();
  if (!caller.userId) throw new RoleBuilderError("UNAUTHENTICATED", "Sign in again.");
  if (!caller.orgId) throw new RoleBuilderError("NO_ORGANIZATION", "Choose an organization first.");
  if (!caller.isAdmin)
    throw new RoleBuilderError(
      "FORBIDDEN",
      "Only an administrator of this organization can build roles.",
    );
  return caller as AdminContext;
}

export async function handleLoadBuilder(port: RoleBuilderPort): Promise<{
  catalogue: BuilderCatalogue;
  versions: CustomRoleVersion[];
  me: string;
}> {
  const admin = await requireAdmin(port);
  const [catalogue, versions] = await Promise.all([
    port.loadCatalogue(admin.orgId),
    port.listVersions(admin.orgId),
  ]);
  return { catalogue, versions, me: admin.userId };
}

export async function handlePreview(port: RoleBuilderPort, input: unknown): Promise<RiskPreview> {
  const draft = parseInput(draftInputSchema, input);
  const admin = await requireAdmin(port);
  return previewDraft(draft, await port.loadCatalogue(admin.orgId));
}

export async function handleSimulate(
  port: RoleBuilderPort,
  input: unknown,
  at: string,
): Promise<SimulationResult> {
  const draft = parseInput(draftInputSchema, input);
  const admin = await requireAdmin(port);
  return simulateDraft(draft, await port.loadCatalogue(admin.orgId), at);
}

export async function handleSaveDraft(
  port: RoleBuilderPort,
  input: unknown,
): Promise<{ id: string; preview: RiskPreview }> {
  const draft = parseInput(draftInputSchema, input);
  const admin = await requireAdmin(port);
  const preview = previewDraft(draft, await port.loadCatalogue(admin.orgId));
  assertDraftAllowed(preview);
  const id = await port.saveDraft({ ...draft, code: customRoleCode(draft.slug) });
  return { id, preview };
}

async function versionById(port: RoleBuilderPort, admin: AdminContext, id: string) {
  const version = (await port.listVersions(admin.orgId)).find((v) => v.id === id);
  if (!version) throw new RoleBuilderError("NOT_FOUND", "That custom role does not exist here.");
  return version;
}

export async function handleSubmit(port: RoleBuilderPort, input: unknown): Promise<void> {
  const { id } = parseInput(roleIdSchema, input);
  const admin = await requireAdmin(port);
  const version = await versionById(port, admin, id);
  if (version.status !== "draft")
    throw new RoleBuilderError("CONFLICT", "Only a draft can be submitted.");
  if (version.layout.nav.length !== 3)
    throw new RoleBuilderError(
      "VALIDATION",
      "A custom role has exactly three navigation sections.",
    );
  await port.submit(id);
}

export async function handleWithdraw(port: RoleBuilderPort, input: unknown): Promise<void> {
  const { id } = parseInput(roleIdSchema, input);
  await requireAdmin(port);
  await port.withdraw(id);
}

/** Second-admin approval. The database refuses the creator; this gives the same answer first. */
export async function handleApprove(port: RoleBuilderPort, input: unknown): Promise<void> {
  const { id } = parseInput(roleIdSchema, input);
  const admin = await requireAdmin(port);
  const version = await versionById(port, admin, id);
  if (version.status !== "pending_approval")
    throw new RoleBuilderError("CONFLICT", "Only a role waiting for approval can be approved.");
  if (version.createdBy === admin.userId)
    throw new RoleBuilderError(
      "FOUR_EYES",
      "four-eyes: a custom role is approved by a second administrator, not its creator.",
    );
  await port.approve(id);
}

export async function handleActivate(
  port: RoleBuilderPort,
  input: unknown,
): Promise<{ roleCode: string }> {
  const { id } = parseInput(roleIdSchema, input);
  const admin = await requireAdmin(port);
  const version = await versionById(port, admin, id);
  if (version.status !== "active")
    throw new RoleBuilderError("CONFLICT", "Only an approved custom role can be activated.");
  if (!version.baseTemplate)
    throw new RoleBuilderError(
      "VALIDATION",
      "A role started from scratch cannot be assigned until it has a base template.",
    );
  return { roleCode: await port.activate(id) };
}

export async function handleHistory(
  port: RoleBuilderPort,
  input: unknown,
): Promise<{ versions: CustomRoleVersion[]; audit: AuditEntry[] }> {
  const { code } = parseInput(
    z.object({ code: z.string().regex(/^custom\.[a-z0-9_.-]{2,60}$/) }),
    input,
  );
  const admin = await requireAdmin(port);
  const versions = (await port.listVersions(admin.orgId))
    .filter((v) => v.code === code)
    .sort((a, b) => b.version - a.version);
  const audit = await port.auditFor(
    admin.orgId,
    versions.map((v) => v.id),
  );
  return { versions, audit };
}

export async function handleDefineResponsibility(
  port: RoleBuilderPort,
  input: unknown,
): Promise<{ id: string }> {
  const responsibility = parseInput(responsibilityInputSchema, input);
  const admin = await requireAdmin(port);
  const catalogue = await port.loadCatalogue(admin.orgId);
  const byCode = new Map(catalogue.permissions.map((p) => [p.code, p]));
  const bad = responsibility.permissions.find((code) => !byCode.has(code));
  if (bad) throw new RoleBuilderError("VALIDATION", `Unknown permission ${bad}.`);
  const protectedCode = responsibility.permissions.find((code) => byCode.get(code)?.protected);
  if (protectedCode)
    throw new RoleBuilderError(
      "PROTECTED_PERMISSION",
      `Protected permission ${protectedCode} cannot be granted by a responsibility.`,
    );
  const preview = previewDraft(
    {
      slug: "responsibility",
      name: responsibility.label,
      baseTemplate: null,
      permissions: responsibility.permissions,
      responsibilities: [],
      scopeCeiling: "org",
      workspaceCategory: "administrative_operations",
      layout: { nav: [], widgets: [] },
    },
    catalogue,
  );
  if (preview.sod.length) throw new RoleBuilderError("SOD_VIOLATION", preview.sod[0]!.explanation);
  return { id: await port.defineResponsibility(responsibility) };
}
