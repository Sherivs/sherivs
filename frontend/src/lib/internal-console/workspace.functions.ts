/**
 * Internal Console workspace writes as createServerFn RPC stubs.
 * Server implementations live in workspace.store.server.ts so this file
 * can be imported from components without pulling client.server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .optional(),
});

export const createSharedWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createSharedWorkspaceRecord } = await import("./workspace.store.server");
    return createSharedWorkspaceRecord(context as never, data);
  });

const memberSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const addWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { addSharedWorkspaceMember } = await import("./workspace.store.server");
    return addSharedWorkspaceMember(context as never, data);
  });

export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { removeSharedWorkspaceMember } = await import("./workspace.store.server");
    return removeSharedWorkspaceMember(context as never, data);
  });

const archiveSchema = z.object({ workspaceId: z.string().uuid() });

export const archiveSharedWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => archiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { archiveSharedWorkspaceRecord } = await import("./workspace.store.server");
    return archiveSharedWorkspaceRecord(context as never, data);
  });

const recentSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  href: z.string().regex(/^\/console(?:\/|$)/),
  kind: z.string().min(1).max(40),
  at: z.string().min(1),
});

export const rememberConsoleResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => recentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { rememberConsoleResourceRecord } = await import("./workspace.store.server");
    return rememberConsoleResourceRecord(context as never, data);
  });
