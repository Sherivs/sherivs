/**
 * CoreGrid — V1-008: platform onboarding server function.
 *
 * provisionOrganization — the platform-level, domain-neutral provisioning
 * entry point (§27 SERVER FUNCTION RULE):
 *
 *   1. AUTHENTICATE — requireSupabaseAuth middleware (verified bearer token).
 *   2. RESOLVE TENANT — control-plane scope: the request PROVISIONS a new
 *      tenant; no client-supplied tenant id is trusted anywhere.
 *   3. AUTHORIZE — requirePlatformSuperAdmin (fail closed, lifecycle
 *      threading + session attestation, same gate as createSchoolWithAdmin).
 *   4. VALIDATE — Zod request contract (organizationProvisioningRequestSchema)
 *      plus the engine's fail-closed preflight (role vocabulary, duplicate
 *      emails, contribution constraints).
 *   5. EXECUTE — executeOrganizationProvisioning over the sanctioned
 *      service-role substrate inside the compensation ledger (one
 *      transactional unit; failure rolls the unit back).
 *   6. AUDIT — writeAuditRecord (fail-closed); provisioned credentials are
 *      returned once to the caller and are NEVER logged or audited (§29/§30).
 *   7. RETURN PERMITTED DATA — the provisioning outcome; passwords surface
 *      exactly once, in the response, never in audit details.
 *
 * `client.server` (service-role) and the composition root are imported INSIDE
 * the handler so this file stays safe to import from components/routes.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { resolveDomainProvisioning } from "./domain-provisioning";
import { executeOrganizationProvisioning } from "./provision-organization";
import {
  organizationProvisioningRequestSchema,
  type ProvisioningIdentityAdminClient,
  type ProvisioningSubstrateClient,
} from "./provisioning-contract";

export type ProvisionOrganizationResponse = Awaited<
  ReturnType<typeof executeOrganizationProvisioning>
>;

export const provisionOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => organizationProvisioningRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<ProvisionOrganizationResponse> => {
    // Canonical Phase 08 role gate — platform super admin (fail closed).
    // Lifecycle threading: `lifecycle: null` opts into the lifecycle contract
    // while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    await requirePlatformSuperAdmin(context.supabase, {
      lifecycle: null,
      sessionValid:
        typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Composition root: load the known domain provisioning contributions
    // (each self-registers fail-closed). Adding a domain is one import there.
    await import("@/lib/onboarding/registered-contributions");

    const resolution = resolveDomainProvisioning(data.domainId);
    if (!resolution.ok) {
      throw new Error(resolution.errors.join("; "));
    }

    // Vendor boundary (§25): the sanctioned Supabase admin client is narrowed
    // onto the engine's structural contracts at this single adapter point —
    // the engine itself remains provider-agnostic.
    const client = supabaseAdmin as unknown as ProvisioningSubstrateClient;
    const identityAdmin = supabaseAdmin.auth.admin as unknown as ProvisioningIdentityAdminClient;

    const outcome = await executeOrganizationProvisioning({
      request: data,
      domain: resolution.contribution,
      client,
      identityAdmin,
    });

    if (!outcome.ok) {
      // The unit rolled back (compensation ledger); surface the failure with
      // its step and compensation state — a failed provisioning is never
      // silently reported as provisioned.
      const compensationNote =
        outcome.compensationErrors.length > 0
          ? `; compensation errors: ${outcome.compensationErrors.join("; ")}`
          : outcome.compensated.length > 0
            ? `; rolled back ${outcome.compensated.length} write(s)`
            : "; no writes persisted";
      throw new Error(
        `Organization provisioning failed at step "${outcome.failedStep}": ${outcome.reason}${compensationNote}`,
      );
    }

    // §27.6 AUDIT — fail-closed audit record. Control-plane scope: the
    // request provisions a NEW tenant (the actor holds no gate-resolved
    // membership in it), so tenantId is null. WHO: the actor's canonical
    // users row when one exists; a bootstrap-claimed super admin has none
    // (the bootstrap precondition), so — exactly like the claim audit — the
    // attribution degrades to the verified email claim with a null actor id
    // (audit_logs.user_id FKs public.users; a raw auth uid without a
    // canonical row is rejected, which failed the audit fail-closed).
    const actorRow = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", context.userId)
      .maybeSingle();
    if (actorRow.error) throw new Error(actorRow.error.message);
    const actorHasCanonicalRow = actorRow.data != null;
    const actorEmail =
      actorHasCanonicalRow ? null : ((context.claims as { email?: string })?.email ?? null);
    await writeAuditRecord(supabaseAdmin, {
      action: "onboarding.provision_organization",
      gate: "requirePlatformSuperAdmin",
      tenantId: null,
      actorId: actorHasCanonicalRow ? context.userId : null,
      actorEmail,
      table: outcome.organization.table,
      recordId: outcome.organization.id,
      outcome: "succeeded",
      details: {
        domain: data.domainId,
        organization_name: data.identity.name,
        people_count: data.people.length,
        // §29/§30: provisioned initial passwords are returned once to the
        // caller and are deliberately absent from audit details.
      },
    });

    return outcome;
  });