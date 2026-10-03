/**
 * CoreGrid Mobile — identity (worker/agent) read contracts.
 *
 * Mirrors `IdentitySummary` / `ListIdentitiesResult` from the web
 * application's identity-registry server functions
 * (frontend/src/lib/identity-registry.functions.ts). The list response is
 * validated fail-closed: tenant scoping is asserted against the resolved
 * tenant id, and unknown identity kinds/states are rejected rather than
 * rendered.
 */
import { z } from "zod";
import { IDENTITY_KINDS, IDENTITY_STATES } from "./vocabulary";

export const identitySummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(IDENTITY_KINDS),
  display_name: z.string().trim().min(1),
  state: z.enum(IDENTITY_STATES),
  verified: z.boolean(),
  tenant_id: z.string().uuid().nullable(),
  created_at: z.string().trim().min(1),
});

export type IdentitySummary = z.infer<typeof identitySummarySchema>;

export const listIdentitiesResponseSchema = z
  .object({
    ok: z.literal(true),
    tenant_id: z.string().uuid(),
    identities: z.array(identitySummarySchema),
  })
  .refine((response) => response.identities.every((row) => row.tenant_id === null || row.tenant_id === response.tenant_id), {
    message: "identity rows cross the declared tenant boundary",
  });

export type ListIdentitiesResponse = z.infer<typeof listIdentitiesResponseSchema>;