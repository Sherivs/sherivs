/**
 * Organization Lifecycle Engine RPC stubs.
 * Server implementations live in organization.store.server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ORGANIZATION_ASSIGNMENT_TYPES,
  ORGANIZATION_LIFECYCLE_STATES,
  organizationQuestionnaireSchema,
} from "./organization-lifecycle";

const draftSchema = z.object({
  id: z.string().uuid().optional(),
  draft: organizationQuestionnaireSchema.partial(),
});

export const saveOrganizationDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => draftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { saveOrganizationDraft: save } = await import("./organization.store.server");
    return save(context as never, data);
  });

const idSchema = z.object({ id: z.string().uuid() });

export const submitOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { submitOrganization: submit } = await import("./organization.store.server");
    return submit(context as never, data.id);
  });

const transitionSchema = z.object({
  id: z.string().uuid(),
  toState: z.enum(ORGANIZATION_LIFECYCLE_STATES),
  reason: z.string().trim().max(200).optional(),
});

export const transitionOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => transitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { transitionOrganization: run } = await import("./organization.store.server");
    return run(context as never, data);
  });

export const provisionOrganizationCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { provisionOrganizationCase: run } = await import("./organization.store.server");
    return run(context as never, data.id);
  });

export const activateOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { activateOrganization: run } = await import("./organization.store.server");
    return run(context as never, data.id);
  });

export const suspendOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { suspendOrganization: run } = await import("./organization.store.server");
    return run(context as never, data.id);
  });

export const restoreOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { restoreOrganization: run } = await import("./organization.store.server");
    return run(context as never, data.id);
  });

export const deactivateOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { deactivateOrganization: run } = await import("./organization.store.server");
    return run(context as never, data.id);
  });

const listSchema = z.object({
  query: z.string().trim().max(80).optional(),
  state: z.enum(ORGANIZATION_LIFECYCLE_STATES).optional(),
});

export const listOrganizations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { listOrganizationDirectory } = await import("./organization.store.server");
    return listOrganizationDirectory(context as never, data);
  });

export const getOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getOrganizationDetail } = await import("./organization.store.server");
    return getOrganizationDetail(context as never, data.id);
  });

const assignSchema = z.object({
  organizationId: z.string().uuid(),
  staffId: z.string().uuid(),
  assignmentType: z.enum(ORGANIZATION_ASSIGNMENT_TYPES),
});

export const assignOrganizationStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => assignSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { assignOrganizationStaff: run } = await import("./organization.store.server");
    return run(context as never, data);
  });

const releaseSchema = z.object({ assignmentId: z.string().uuid() });

export const releaseOrganizationAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => releaseSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { releaseOrganizationAssignment: run } = await import("./organization.store.server");
    return run(context as never, data.assignmentId);
  });
