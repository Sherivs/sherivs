/**
 * CoreGrid — Phase 04 Scholar runtime: institution operating-model wiring
 * (first Scholar-on-CoreGrid server-function vertical).
 *
 * Scholar is a RUNTIME on CoreGrid, never a subsystem: this family publishes
 * the institution's operating model as a UNIVERSAL KERNEL entity
 * (`cg_entity`, entity_type `scholar.institution.operating_model`) — the
 * kernel stays vocabulary-free, Phase 04 owns the education semantics.
 * No new table, no parallel schema, no duplication.
 *
 * Server-function rule (Constitution §26/§27/§38):
 *   1 Authenticate — requireSupabaseAuth
 *   2 Resolve tenant — requireSchoolAdminScope (actor's OWN school; a
 *     client-supplied tenant id is NEVER trusted)
 *   3 Authorize — canonical P08 role gate (school_admin/principal)
 *   4 Validate — pure Scholar contracts (school-builder + blueprint)
 *   5 Execute — service-role write to cg_entity (deny-by-default RLS),
 *     superseding the previous version through cg_entity.superseded_by
 *   6 Audit — cg_event record on the Scholar config event
 *   7 Return permitted data only
 *
 * Status: AUTHORED — follows the DB-VALIDATED kernel substrate path
 * (20260903000000); HTTP-layer invocation pending an app runtime, matching the
 * L2 registry families. DB path is exercised live by
 * scripts/verify-scholar-config-wiring.mjs.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { entityDraft, eventDraft } from "@/lib/kernel/reality";
import { buildSchoolSpec, type SchoolBuildParts } from "@/lib/scholar/school-builder";
import { createBlueprint } from "@/lib/scholar/blueprint";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

export const SCHOLAR_OPERATING_MODEL_ENTITY = "scholar.institution.operating_model";
export const SCHOLAR_CONFIG_EVENT = "scholar.institution.operating_model.published";

const specPartsSchema = z
  .object({
    levels: z.array(z.unknown()).optional(),
    programmes: z.array(z.unknown()).optional(),
    shifts: z.array(z.unknown()).optional(),
    hours: z.unknown().optional(),
    languages: z.array(z.unknown()).optional(),
    campuses: z.array(z.unknown()).optional(),
    policies: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const publishSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  spec_parts: specPartsSchema,
});

export type PublishOperatingModelResult = {
  ok: true;
  entity_id: string;
  tenant_id: string;
  version: number;
  superseded_previous: boolean;
};

interface StoredOperatingModel {
  id: string;
  version: number;
}

const CONFIG_ATTRIBUTES_KIND = "operating_model";

function operatingModelAttributes(
  spec: SchoolBuildParts,
  blueprint: {
    blueprint_id: string;
    version: number;
    author: string;
    reason: string;
    previous_version: number | null;
    published_at: string;
  },
) {
  return { kind: CONFIG_ATTRIBUTES_KIND, blueprint, spec };
}

async function latestOperatingModel(
  admin: ReturnType<typeof asKernelAdmin>,
  tenantId: string,
): Promise<StoredOperatingModel | null> {
  const { data, error } = await admin
    .from("cg_entity")
    .select("id, attributes")
    .eq("tenant_id", tenantId)
    .eq("entity_type", SCHOLAR_OPERATING_MODEL_ENTITY)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latest operating model read failed: ${error.message}`);
  if (!data) return null;
  const attributes = (data.attributes ?? {}) as { blueprint?: { version?: number } };
  return { id: data.id as string, version: attributes.blueprint?.version ?? 0 };
}

export const publishInstitutionOperatingModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => publishSchema.parse(input))
  .handler(async ({ data, context }): Promise<PublishOperatingModelResult> => {
    // 2/3 — tenant boundary + authorization come from the resolved role scope.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const tenantId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    // 4 — validate through the pure Scholar contracts (A3 + A4); never accept
    // an inconsistent operating model.
    const built = buildSchoolSpec(data.spec_parts as SchoolBuildParts);
    if (!built.ok) {
      throw new Error(`institution configuration invalid: ${built.issues.join("; ")}`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);
    const now = timeAuthority.now().at;

    const previous = await latestOperatingModel(admin, tenantId);
    const version = (previous?.version ?? 0) + 1;
    const blueprintId = `bp:${tenantId}:${version}:${timeAuthority.now().atMs.toString(36)}`;

    const blueprint = createBlueprint({
      spec: built.spec,
      blueprintId,
      author: context.userId,
      reason: data.reason,
      now,
      previous: previous ? { version: previous.version } : null,
    });
    if (!blueprint.ok) {
      throw new Error(`blueprint creation failed: ${blueprint.issues.join("; ")}`);
    }

    // 5 — persist as a universal kernel entity (service role, deny-by-default
    // RLS on cg_*).
    const row = entityDraft(
      {
        entityType: SCHOLAR_OPERATING_MODEL_ENTITY,
        tenantId,
        state: "active",
        classification: "INTERNAL",
        attributes: operatingModelAttributes(data.spec_parts as SchoolBuildParts, {
          blueprint_id: blueprint.blueprint.header.blueprintId,
          version: blueprint.blueprint.header.version,
          author: blueprint.blueprint.header.author,
          reason: blueprint.blueprint.header.reason,
          previous_version: blueprint.blueprint.header.previousVersion,
          published_at: blueprint.blueprint.header.timestamp,
        }),
        sourceType: "configuration",
        sourceRef: blueprintId,
        observedAt: now,
        validFrom: now,
      },
      now,
    );

    const { data: inserted, error: insertError } = await admin
      .from("cg_entity")
      .insert(row)
      .select("id")
      .single();
    if (insertError) throw new Error(`operating model insert failed: ${insertError.message}`);

    // Version chain through the substrate's own superseded_by column.
    let supersededPrevious = false;
    if (previous) {
      const { error: supersedeError } = await admin
        .from("cg_entity")
        .update({ state: "superseded", superseded_by: inserted.id as string })
        .eq("id", previous.id);
      if (supersedeError) throw new Error(`supersede failed: ${supersedeError.message}`);
      supersededPrevious = true;
    }

    // 6 — audit through the kernel event contract (observability, §29/§138).
    const audit = eventDraft(
      {
        eventType: SCHOLAR_CONFIG_EVENT,
        aggregateType: "cg_entity",
        aggregateId: inserted.id as string,
        actorIdentity: context.userId,
        tenantId,
        idempotencyKey: blueprintId,
        payload: { version, superseded_previous: supersededPrevious },
        occurredAt: now,
      },
      now,
    );
    const { error: auditError } = await admin.from("cg_event").insert(audit);
    if (auditError) throw new Error(`operating model audit failed: ${auditError.message}`);

    return {
      ok: true,
      entity_id: inserted.id as string,
      tenant_id: tenantId,
      version,
      superseded_previous: supersededPrevious,
    };
  });

export type CurrentOperatingModelDetailResult = {
  entity_id: string;
  tenant_id: string;
  version: number;
  reason: string;
  published_at: string;
  /** Serialized spec — clients re-validate through the pure Scholar contracts. */
  spec_json: string | null;
} | null;

/**
 * Read the CURRENT operating model INCLUDING its spec — own tenant only.
 * The spec is returned as a JSON string (fully serializable); consumers parse
 * it and re-validate with the pure scholar validators before rendering.
 */
export const getCurrentInstitutionOperatingModelDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CurrentOperatingModelDetailResult> => {
    // Lifecycle threading: see publishInstitutionOperatingModel for the signal
    // semantics (unverified lifecycle flagged; session attested from exp).
    const tenantId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);

    const { data, error } = await admin
      .from("cg_entity")
      .select("id, tenant_id, attributes")
      .eq("tenant_id", tenantId)
      .eq("entity_type", SCHOLAR_OPERATING_MODEL_ENTITY)
      .eq("state", "active")
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`operating model detail read failed: ${error.message}`);
    if (!data) return null;

    const attributes = (data.attributes ?? {}) as {
      blueprint?: { version?: number; reason?: string; published_at?: string };
      spec?: object;
    };
    let specJson: string | null = null;
    try {
      specJson = JSON.stringify(attributes.spec ?? {});
    } catch {
      specJson = null;
    }
    return {
      entity_id: data.id as string,
      tenant_id: (data.tenant_id as string) ?? tenantId,
      version: attributes.blueprint?.version ?? 0,
      reason: attributes.blueprint?.reason ?? "",
      published_at: attributes.blueprint?.published_at ?? "",
      spec_json: specJson,
    };
  });

export type OperatingModelVersionSummary = {
  entity_id: string;
  version: number;
  reason: string;
  published_at: string;
  state: string;
};

export type OperatingModelVersionListResult = {
  tenant_id: string;
  versions: OperatingModelVersionSummary[];
};

/**
 * Version history (time-machine read over the kernel substrate version chain).
 * Chronological (oldest first); each row's blueprint header carries the chain.
 */
export const listInstitutionOperatingModelVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperatingModelVersionListResult> => {
    // Lifecycle threading: see publishInstitutionOperatingModel for the signal
    // semantics (unverified lifecycle flagged; session attested from exp).
    const tenantId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);

    const { data, error } = await admin
      .from("cg_entity")
      .select("id, state, attributes")
      .eq("tenant_id", tenantId)
      .eq("entity_type", SCHOLAR_OPERATING_MODEL_ENTITY)
      .order("valid_from", { ascending: true });
    if (error) throw new Error(`operating model history read failed: ${error.message}`);

    const versions: OperatingModelVersionSummary[] = (data ?? [])
      .map((row: { id?: unknown; state?: unknown; attributes?: unknown }) => {
        const attributes = (row.attributes ?? {}) as {
          blueprint?: { version?: number; reason?: string; published_at?: string };
        };
        return {
          entity_id: row.id as string,
          version: attributes.blueprint?.version ?? 0,
          reason: attributes.blueprint?.reason ?? "",
          published_at: attributes.blueprint?.published_at ?? "",
          state: (row.state as string) ?? "",
        };
      })
      .sort(
        (a: OperatingModelVersionSummary, b: OperatingModelVersionSummary) => a.version - b.version,
      );

    return { tenant_id: tenantId, versions };
  });

export type CurrentOperatingModelResult = {
  entity_id: string;
  tenant_id: string;
  version: number;
  reason: string;
  published_at: string;
} | null;

/** Read the CURRENT operating model for the actor's own tenant only. */
export const getCurrentInstitutionOperatingModel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CurrentOperatingModelResult> => {
    // Lifecycle threading: see publishInstitutionOperatingModel for the signal
    // semantics (unverified lifecycle flagged; session attested from exp).
    const tenantId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);

    const { data, error } = await admin
      .from("cg_entity")
      .select("id, tenant_id, attributes")
      .eq("tenant_id", tenantId)
      .eq("entity_type", SCHOLAR_OPERATING_MODEL_ENTITY)
      .eq("state", "active")
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`operating model read failed: ${error.message}`);
    if (!data) return null;

    const attributes = (data.attributes ?? {}) as {
      blueprint?: { version?: number; reason?: string; published_at?: string };
    };
    return {
      entity_id: data.id as string,
      tenant_id: (data.tenant_id as string) ?? tenantId,
      version: attributes.blueprint?.version ?? 0,
      reason: attributes.blueprint?.reason ?? "",
      published_at: attributes.blueprint?.published_at ?? "",
    };
  });
