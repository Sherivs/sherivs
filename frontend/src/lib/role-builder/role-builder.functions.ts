/**
 * Server functions of the custom role and responsibility builder (mission M4, ADR-121).
 * Every call authenticates, derives the organization from the caller and runs the database
 * functions with the caller's JWT (no service role), so four-eyes and audit stay in Postgres.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  draftInputSchema,
  parseInput,
  responsibilityInputSchema,
  roleCodeSchema,
  roleIdSchema,
} from "./role-builder-core";
import { supabaseRoleBuilderPort, type UserClient } from "./role-builder-port";
import {
  handleActivate,
  handleApprove,
  handleDefineResponsibility,
  handleHistory,
  handleLoadBuilder,
  handlePreview,
  handleSaveDraft,
  handleSimulate,
  handleSubmit,
  handleWithdraw,
} from "./role-builder-handlers";

type AuthContext = { supabase: unknown; userId: string };
const portFor = (context: AuthContext) =>
  supabaseRoleBuilderPort(context.supabase as UserClient, context.userId);

export const loadRoleBuilder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handleLoadBuilder(portFor(context)));

export const previewCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(draftInputSchema, input))
  .handler(async ({ data, context }) => handlePreview(portFor(context), data));

export const simulateCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(draftInputSchema, input))
  .handler(async ({ data, context }) =>
    handleSimulate(portFor(context), data, new TimeAuthority(new SystemClock()).now().at),
  );

export const saveCustomRoleDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(draftInputSchema, input))
  .handler(async ({ data, context }) => handleSaveDraft(portFor(context), data));

export const submitCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(roleIdSchema, input))
  .handler(async ({ data, context }) => handleSubmit(portFor(context), data));

export const withdrawCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(roleIdSchema, input))
  .handler(async ({ data, context }) => handleWithdraw(portFor(context), data));

export const approveCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(roleIdSchema, input))
  .handler(async ({ data, context }) => handleApprove(portFor(context), data));

export const activateCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(roleIdSchema, input))
  .handler(async ({ data, context }) => handleActivate(portFor(context), data));

export const customRoleHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(roleCodeSchema, input))
  .handler(async ({ data, context }) => handleHistory(portFor(context), data));

export const defineCustomResponsibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(responsibilityInputSchema, input))
  .handler(async ({ data, context }) => handleDefineResponsibility(portFor(context), data));
