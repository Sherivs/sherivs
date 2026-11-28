/**
 * Server functions for tenant role overrides and the cached effective permissions (M2c, ADR-161).
 * Caller's JWT only; the organization comes from the caller.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import type { UserClient } from "./role-builder-port";
import { EffectivePermissionCache } from "./effective-permission-cache";
import {
  handleApproveOverride,
  handleCreateOverride,
  handleEndOverride,
  handleListOverrides,
  handleMyEffectivePermissions,
  parseOverrideId,
  parseOverrideInput,
  supabaseOverridePort,
  supabasePermissionSource,
} from "./role-overrides";

type AuthContext = { supabase: unknown; userId: string };
const client = (context: AuthContext) => context.supabase as UserClient;
const portFor = (context: AuthContext) => supabaseOverridePort(client(context), context.userId);
const nowMs = () => new TimeAuthority(new SystemClock()).now().atMs;

/** One cache per server process. Keys carry the organization and the user, so one person never reads another's rows. */
const permissionCache = new EffectivePermissionCache();

export const listRoleOverrides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handleListOverrides(portFor(context), nowMs()));

export const proposeRoleOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseOverrideInput(input))
  .handler(async ({ data, context }) =>
    handleCreateOverride(portFor(context), permissionCache, data),
  );

export const approveRoleOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseOverrideId(input))
  .handler(async ({ data, context }) =>
    handleApproveOverride(portFor(context), permissionCache, data.id),
  );

export const endRoleOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseOverrideId(input))
  .handler(async ({ data, context }) =>
    handleEndOverride(portFor(context), permissionCache, data.id),
  );

export const getMyEffectivePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    handleMyEffectivePermissions(
      portFor(context),
      (orgId) => supabasePermissionSource(client(context), orgId),
      permissionCache,
    ),
  );
