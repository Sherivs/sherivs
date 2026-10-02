/**
 * CoreGrid — Phase 33 kernel backend: tenant reality recording (kernel wiring §2.2).
 *
 * Tenant-scoped server functions that record reality through the universal
 * substrate contracts (`kernel/reality.ts` pure drafts) into the cg_*
 * tables:
 *
 *   writeEntity        → cg_entity        (entity_type + attributes + provenance)
 *   writeRelationship  → cg_relationship  (typed, time-bounded edges, same tenant)
 *   writeObservation   → cg_observation   (truth-hierarchy kinds, never collapsed)
 *   recordEvent        → cg_event         (versioned outbox record, state=pending)
 *
 * Security posture (Plan §3):
 * - RLS is deny-by-default on `cg_*`; writes go through the service-role
 *   `client.server` import only.
 * - Authorization: `requireSupabaseAuth` then the canonical Phase 08
 *   school-admin gate → the actor's OWN school scope is the tenant boundary.
 *   Client-supplied tenant ids are never trusted (Constitution §26/§38).
 * - Every relationship/observation references entities that are first verified
 *   to belong to the actor's resolved tenant (service role bypasses RLS, so
 *   the tenant check is enforced here, in code, at the same boundary).
 * - Provenance: `actor_identity` (events) / `observer_identity` (observations)
 *   carry the acting user; entities carry source_type/source_ref/recorded_at.
 * - Events are inserted with `state='pending'` (outbox intent) and the
 *   caller's `idempotency_key`; delivery transitions are governed by
 *   `kernel/outbox.ts`.
 *
 * Status: AUTHORED — NOT_VALIDATED against a live database (kernel wiring plan
 * §1 must run first). Generated `Database` types lag the migration; the cg_*
 * surface is structural via `kernel-admin-client.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin, type KernelAdminClient } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import {
  DATA_CLASSIFICATIONS,
  OBSERVATION_KINDS,
  entityDraft,
  eventDraft,
  observationDraft,
  relationshipDraft,
  type DataClassification,
  type ObservationKind,
} from "@/lib/kernel/reality";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Validators
 * ────────────────────────────────────────────────────────────*/

const objectRecord = z.record(z.string(), z.unknown());
const optionalObject = objectRecord.optional();
const optionalNullableString = z.string().max(500).optional().nullable();
const optionalTimestamp = z.string().datetime().optional().nullable();
const confidenceSchema = z.number().min(0).max(1).optional().nullable();

const classificationSchema = z
  .enum(DATA_CLASSIFICATIONS as unknown as [string, ...string[]])
  .optional();
const kindSchema = z.enum(OBSERVATION_KINDS as unknown as [ObservationKind, ...ObservationKind[]]);

const writeEntitySchema = z.object({
  entity_type: z.string().trim().min(1).max(128),
  state: z.string().trim().max(120).optional().nullable(),
  classification: classificationSchema,
  attributes: optionalObject,
  source_type: z.string().trim().min(1).max(128).optional(),
  source_ref: optionalNullableString,
  observed_at: optionalTimestamp,
  valid_from: optionalTimestamp,
  valid_to: optionalTimestamp,
  confidence: confidenceSchema,
});

const writeRelationshipSchema = z.object({
  source_entity_id: z.string().uuid(),
  target_entity_id: z.string().uuid(),
  relation_type: z.string().trim().min(1).max(128),
  attributes: optionalObject,
  source_ref: optionalNullableString,
  observed_at: optionalTimestamp,
  valid_from: optionalTimestamp,
  valid_to: optionalTimestamp,
  confidence: confidenceSchema,
});

const writeObservationSchema = z.object({
  subject_entity_id: z.string().uuid(),
  kind: kindSchema,
  statement: optionalObject,
  source_ref: optionalNullableString,
  confidence: confidenceSchema,
  observed_at: optionalTimestamp,
});

const recordEventSchema = z.object({
  event_type: z.string().trim().min(1).max(200),
  aggregate_type: z.string().trim().min(1).max(200),
  aggregate_id: z.string().trim().min(1).max(500),
  payload: optionalObject,
  correlation_id: z.string().trim().max(200).optional().nullable(),
  idempotency_key: z.string().trim().min(8).max(200).optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
});

/* ─────────────────────────────────────────────────────────────
 * Shared helpers
 * ────────────────────────────────────────────────────────────*/

const DEFAULT_ENTITY_SOURCE_TYPE = "cg:kernel-reality:write_entity";
const OBSERVATION_SOURCE_TYPE = "cg:kernel-reality:write_observation";

async function loadAdmin(): Promise<KernelAdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return asKernelAdmin(supabaseAdmin);
}

/**
 * Tenant boundary for service-role writes: every referenced cg_entity must
 * exist AND belong to the actor's resolved school scope. Bypassed RLS is
 * replaced by this explicit check (Constitution §26/§38).
 */
async function assertEntitiesInScope(
  admin: KernelAdminClient,
  schoolId: string,
  ids: string[],
  label: string,
): Promise<void> {
  const { data, error } = await admin.from("cg_entity").select("id, tenant_id").in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; tenant_id: string | null }>;
  const found = new Map(rows.map((r) => [r.id, r.tenant_id]));
  for (const id of ids) {
    if (!found.has(id)) throw new Error(`${label} "${id}" does not exist or is out of scope`);
    if ((found.get(id) ?? null) !== schoolId) {
      throw new Error(`${label} "${id}" is outside the actor's tenant scope`);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * writeEntity
 * ────────────────────────────────────────────────────────────*/

export type WriteEntityResult = { ok: true; id: string };

export const writeEntity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => writeEntitySchema.parse(input))
  .handler(async ({ data, context }): Promise<WriteEntityResult> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const admin = await loadAdmin();
    const now = timeAuthority.now().at;

    const row = entityDraft(
      {
        entityType: data.entity_type,
        tenantId: schoolId,
        state: data.state ?? null,
        classification: (data.classification as DataClassification | undefined) ?? "INTERNAL",
        attributes: data.attributes ?? {},
        sourceType: data.source_type?.trim() || DEFAULT_ENTITY_SOURCE_TYPE,
        sourceRef: data.source_ref ?? null,
        observedAt: data.observed_at ?? null,
        validFrom: data.valid_from ?? null,
        validTo: data.valid_to ?? null,
        confidence: data.confidence ?? null,
      },
      now,
    );

    const { data: inserted, error } = await admin
      .from("cg_entity")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id as string };
  });

/* ─────────────────────────────────────────────────────────────
 * writeRelationship
 * ────────────────────────────────────────────────────────────*/

export type WriteRelationshipResult = { ok: true; id: string };

export const writeRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => writeRelationshipSchema.parse(input))
  .handler(async ({ data, context }): Promise<WriteRelationshipResult> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const admin = await loadAdmin();
    const now = timeAuthority.now().at;

    // Tenant boundary: both endpoints must already be entities in this tenant.
    await assertEntitiesInScope(
      admin,
      schoolId,
      [data.source_entity_id, data.target_entity_id],
      "Entity",
    );

    const row = relationshipDraft(
      {
        sourceEntityId: data.source_entity_id,
        targetEntityId: data.target_entity_id,
        relationType: data.relation_type,
        tenantId: schoolId,
        attributes: data.attributes ?? {},
        sourceRef: data.source_ref ?? null,
        observedAt: data.observed_at ?? null,
        validFrom: data.valid_from ?? null,
        validTo: data.valid_to ?? null,
        confidence: data.confidence ?? null,
      },
      now,
    );

    const { data: inserted, error } = await admin
      .from("cg_relationship")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id as string };
  });

/* ─────────────────────────────────────────────────────────────
 * writeObservation — truth-hierarchy kinds, never collapsed
 * ────────────────────────────────────────────────────────────*/

export type WriteObservationResult = { ok: true; id: string };

export const writeObservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => writeObservationSchema.parse(input))
  .handler(async ({ data, context }): Promise<WriteObservationResult> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const admin = await loadAdmin();
    const now = timeAuthority.now().at;

    // Tenant boundary: the observed subject must be an entity in this tenant.
    await assertEntitiesInScope(admin, schoolId, [data.subject_entity_id], "Subject entity");

    const row = observationDraft(
      {
        subjectEntityId: data.subject_entity_id,
        kind: data.kind as ObservationKind,
        statement: data.statement ?? {},
        observerIdentity: context.userId,
        tenantId: schoolId,
        sourceType: OBSERVATION_SOURCE_TYPE,
        sourceRef: data.source_ref ?? null,
        confidence: data.confidence ?? null,
        observedAt: data.observed_at ?? null,
      },
      now,
    );

    const { data: inserted, error } = await admin
      .from("cg_observation")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id as string };
  });

/* ─────────────────────────────────────────────────────────────
 * recordEvent — pending outbox record with exactly-once intent
 * ────────────────────────────────────────────────────────────*/

export type RecordEventResult = { ok: true; id: string; duplicated: boolean };

export const recordEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => recordEventSchema.parse(input))
  .handler(async ({ data, context }): Promise<RecordEventResult> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const admin = await loadAdmin();
    const now = timeAuthority.now().at;

    const idempotencyKey = data.idempotency_key ?? null;
    if (idempotencyKey) {
      const { data: existing, error: existingError } = await admin
        .from("cg_event")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) return { ok: true, id: existing.id as string, duplicated: true };
    }

    const row = eventDraft(
      {
        eventType: data.event_type,
        aggregateType: data.aggregate_type,
        aggregateId: data.aggregate_id,
        actorIdentity: context.userId,
        tenantId: schoolId,
        correlationId: data.correlation_id ?? null,
        idempotencyKey,
        payload: data.payload ?? {},
        occurredAt: data.occurred_at ?? undefined,
      },
      now,
    );

    const { data: inserted, error } = await admin
      .from("cg_event")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      // Unique `idempotency_key` backstop: a concurrent duplicate must resolve
      // to the existing row, not fail the operation.
      if (idempotencyKey) {
        const { data: existing, error: existingError } = await admin
          .from("cg_event")
          .select("id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (existingError) throw new Error(existingError.message);
        if (existing) return { ok: true, id: existing.id as string, duplicated: true };
      }
      throw new Error(error.message);
    }

    return { ok: true, id: inserted.id as string, duplicated: false };
  });
