/**
 * CoreGrid — identity registry read contracts (Constitution §23).
 *
 * Single typed source for the worker/agent read surface served by the web's
 * `listIdentities` server function
 * (`frontend/src/lib/identity-registry.functions.ts`) and consumed by the
 * mobile identity client, which re-validates every row against its Zod
 * refinement of these shapes. Moved here verbatim from the web module; the
 * web module re-exports them so existing web imports are unchanged.
 */
import type { IdentityKind, IdentityState } from "./vocabulary";

export type IdentitySummary = {
  id: string;
  kind: IdentityKind;
  display_name: string;
  state: IdentityState;
  verified: boolean;
  tenant_id: string | null;
  created_at: string;
};

export type ListIdentitiesResult = {
  ok: true;
  /** The tenant boundary the read was scoped to (never client-supplied). */
  tenant_id: string;
  identities: IdentitySummary[];
};
