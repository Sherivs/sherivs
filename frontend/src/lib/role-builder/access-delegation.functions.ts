/**
 * Server functions for access-review campaigns, delegations and the acting banner (M4, ADR-121).
 * Caller's JWT only; the organization comes from the caller.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { parseInput } from "./role-builder-core";
import type { UserClient } from "./role-builder-port";
import {
  campaignInputSchema,
  decisionInputSchema,
  delegationIdSchema,
  delegationInputSchema,
  handleDecide,
  handleGrantDelegation,
  handleListCampaigns,
  handleListDelegations,
  handleMyActingContext,
  handleRevokeDelegation,
  handleStartCampaign,
  supabaseAccessPort,
} from "./access-delegation";

type AuthContext = { supabase: unknown; userId: string };
const portFor = (context: AuthContext) =>
  supabaseAccessPort(context.supabase as UserClient, context.userId);
const nowMs = () => new TimeAuthority(new SystemClock()).now().atMs;

export const listAccessReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handleListCampaigns(portFor(context)));

export const startAccessReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(campaignInputSchema, input))
  .handler(async ({ data, context }) => handleStartCampaign(portFor(context), data, nowMs()));

export const decideAccessReviewItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(decisionInputSchema, input))
  .handler(async ({ data, context }) => handleDecide(portFor(context), data));

export const listDelegations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handleListDelegations(portFor(context)));

export const grantDelegation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(delegationInputSchema, input))
  .handler(async ({ data, context }) => handleGrantDelegation(portFor(context), data, nowMs()));

export const revokeDelegation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => parseInput(delegationIdSchema, input))
  .handler(async ({ data, context }) => handleRevokeDelegation(portFor(context), data));

export const getMyActingContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handleMyActingContext(portFor(context)));
