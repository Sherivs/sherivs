import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { onboardingInputSchema } from "./organization-onboarding";
import { writeAuditRecord } from "@/lib/server/write-audit";

/**
 * Sherivs — organization provisioning (§21 onboarding pipeline, final step).
 *
 * The client submits the founder's DECLARED choices (identity, runtime,
 * name, slug) and nothing else. Authorization and identity are resolved
 * server-side:
 *
 *   1. requireSupabaseAuth — the caller is a verified session.
 *   2. The substrate function `create_organization_with_founder` is the
 *      SOLE customer path that writes organizations. It re-verifies —
 *      under the definer's privileges — that the caller is authenticated
 *      AND unlinked (no users row, no membership), that the runtime is
 *      provisionable, and that inputs are bounded. An already-linked actor
 *      cannot mint a second identity-store row through this path.
 *   3. The memberships-sync trigger (20261008000050) derives the founder's
 *      primary organization_membership from the identity-store row.
 *   4. The write is audited inside the substrate function (§28 immutable
 *      records); this wrapper adds the application-gate audit record.
 *
 * Errors surface as stable messages; the raw substrate message never
 * reaches the client (map through mapProvisioningError at the boundary).
 */

const provisioningValidator = onboardingInputSchema;

export const createOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => provisioningValidator.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as SupabaseClient<Database>;
    const userId = context.userId;

    // Defense in depth: the substrate re-checks this, but a linked actor
    // should be refused before any write attempt, with a clean message.
    const { data: existingProfile } = await db
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (existingProfile) {
      throw new Error("FOUNDER_ALREADY_LINKED");
    }

    const { data: orgId, error } = await db.rpc("create_organization_with_founder", {
      p_org_name: data.organizationName,
      p_org_slug: data.organizationSlug,
      p_full_name: data.founderName,
      p_runtime: data.runtime,
    });
    if (error) throw new Error(error.message);

    const organizationId = orgId as string | null;
    if (!organizationId) throw new Error("UNKNOWN");

    // Application-gate audit (the substrate records the event too).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await writeAuditRecord(supabaseAdmin, {
      action: "organization.onboard",
      gate: "requireSupabaseAuth",
      tenantId: organizationId,
      actorId: userId,
      table: "schools",
      recordId: organizationId,
      outcome: "succeeded",
      details: { runtime: data.runtime, slug: data.organizationSlug },
    });

    return { organizationId, slug: data.organizationSlug };
  });
