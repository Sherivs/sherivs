/**
 * CoreGrid Mobile — identity (worker/agent) read contracts.
 *
 * Row shapes are the SINGLE-SOURCE contracts from `@coregrid/contracts`
 * (formerly mirrored by hand from the web's identity-registry server
 * functions — that mirror class is retired, Constitution §23). The list
 * response is validated fail-closed: tenant scoping is asserted against the
 * resolved tenant id, and unknown identity kinds/states are rejected rather
 * than rendered.
 */
import { z } from "zod";
import type { IdentitySummary as SharedIdentitySummary } from "@coregrid/contracts";
import { IDENTITY_KINDS, IDENTITY_STATES } from "@coregrid/contracts";

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

/* ── Compile-time pinning to the shared read contract (§23) ──────────────────
 * Fails mobile's typecheck if this schema and the shared IdentitySummary
 * (served by the web's listIdentities server function) ever diverge. */

type Identical<A, B> = A extends B ? (B extends A ? true : false) : false;

const identityParityChecks: readonly [true] = [
  undefined as unknown as Identical<IdentitySummary, SharedIdentitySummary>,
];
void identityParityChecks;
