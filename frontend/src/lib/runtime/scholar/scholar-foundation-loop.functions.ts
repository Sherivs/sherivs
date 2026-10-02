/**
 * Scholar foundation validation server path (Gate 14, bounded).
 *
 * Scholar entity → universal cg_entity substrate → verified foundation loop.
 * The Scholar entity is created through the Scholar ontology boundary
 * (`runtime/scholar-foundation-flow.ts`) and its persisted row is carried
 * through the verified foundation loop to an independent verification record.
 * The same governed execution can bind the created entity into the reality
 * graph (`enrolls` / `teaches` via cg_relationship) and record its Scholar
 * domain event (e.g. `learner.enrolled` via cg_event) — always through the
 * runtime vocabulary, never new infrastructure.
 *
 * Security posture:
 * - Tenant comes from the school-admin scope; the client cannot set tenant or
 *   verification outcome.
 * - Service-role writes bypass RLS, so every referenced relationship target is
 *   verified to exist inside the actor's resolved tenant (same boundary rule
 *   as kernel-reality.functions.ts).
 * - Relationship and event vocabulary is validated against the Scholar
 *   ontology BEFORE any write; the event's aggregate must match the created
 *   entity's type.
 * - A replayed idempotency key returns the recorded execution without creating
 *   any new reality rows.
 *
 * No Scholar table is touched and no Scholar capability is rebuilt.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin, type KernelAdminClient } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { planFoundationLoop } from "@/lib/control-plane/foundation-loop";
import { auditFoundationLoop, persistFoundationPlan } from "@/lib/foundation-loop.functions";
import {
  buildScholarFoundationEntity,
  buildScholarFoundationEvent,
  buildScholarFoundationRelationship,
  assertScholarEventForEntity,
  assertScholarRelationshipVocabulary,
  scholarFoundationRequest,
  SCHOLAR_FOUNDATION_ACTION,
  SCHOLAR_FOUNDATION_ENTITY_TYPES,
  SCHOLAR_FOUNDATION_MISSION_ID,
  SCHOLAR_FOUNDATION_RELATIONSHIP_TYPES,
} from "@/lib/runtime/scholar-foundation-flow";
import { isScholarEventType, type ScholarEventType } from "@/lib/runtime/scholar-events";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const relationshipSchema = z
  .object({
    relationType: z.string().trim().min(1).max(128),
    targetEntityId: z.string().uuid(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const eventSchema = z
  .object({
    eventType: z.string().trim().min(1).max(200),
  })
  .strict();

const scholarSchema = z
  .object({
    entityType: z.string().trim().min(1).max(128),
    state: z.string().trim().max(120).optional().nullable(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
    relationships: z.array(relationshipSchema).max(4).optional(),
    event: eventSchema.optional(),
  })
  .strict();

export type ScholarFoundationResult = {
  ok: true;
  replayed: boolean;
  executionId: string;
  executionStatus: string;
  scholarEntityType: string;
  realityRef: string;
  verificationDecision: string | null;
  relationshipCount: number;
  recordedEvent: string | null;
};

async function loadAdmin(): Promise<KernelAdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return asKernelAdmin(supabaseAdmin);
}

/** Replay pre-check: an existing execution for the idempotency key short-circuits all writes. */
async function findReplayedExecution(
  admin: KernelAdminClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<{
  id: string;
  status: string;
  realityRef: string;
  verificationDecision: string | null;
} | null> {
  const { data: existing, error } = await admin
    .from("cg_execution_record")
    .select("id, status, reality_ref")
    .eq("tenant_id", tenantId)
    .eq("mission_id", SCHOLAR_FOUNDATION_MISSION_ID)
    .eq("idempotency_key", idempotencyKey)
    .eq("action", SCHOLAR_FOUNDATION_ACTION)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) return null;

  const { data: priorVerification, error: priorError } = await admin
    .from("cg_verification_result")
    .select("decision")
    .eq("execution_id", existing.id)
    .maybeSingle();
  if (priorError) throw new Error(priorError.message);
  return {
    id: String(existing.id),
    status: String(existing.status),
    realityRef: String(existing.reality_ref),
    verificationDecision: priorVerification ? String(priorVerification.decision) : null,
  };
}

export async function executeScholarFoundationLoop(input: {
  supabase: Parameters<typeof requireSchoolAdminScope>[0];
  userId: string;
  /** Authenticated request claims — attests session validity at the gate. */
  claims?: { exp: number };
  data: z.infer<typeof scholarSchema>;
}): Promise<ScholarFoundationResult> {
  // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
  // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
  // contract while flagging the identity lifecycle unverified (never silent);
  // session validity is attested from the verified token's exp claim when the
  // caller supplies claims, and left unverified (flagged) otherwise.
  const tenantId = await requireSchoolAdminScope(input.supabase, {
    lifecycle: null,
    sessionValid: input.claims ? tokenMsRemaining(input.claims.exp) > 0 : undefined,
  });
  const admin = await loadAdmin();
  const now = timeAuthority.now().at;

  const replayed = await findReplayedExecution(admin, tenantId, input.data.idempotencyKey);
  if (replayed) {
    return {
      ok: true,
      replayed: true,
      executionId: replayed.id,
      executionStatus: replayed.status,
      scholarEntityType: input.data.entityType,
      realityRef: replayed.realityRef,
      verificationDecision: replayed.verificationDecision,
      relationshipCount: 0,
      recordedEvent: null,
    };
  }

  // Scholar vocabulary is validated here, before any write (runtime owns it).
  const entityRow = buildScholarFoundationEntity(
    {
      entityType: input.data.entityType,
      state: input.data.state ?? null,
      attributes: input.data.attributes,
    },
    tenantId,
    now,
  );

  // Tenant boundary: every requested relationship target must be an existing
  // entity in the actor's scope, and the edge must satisfy the ontology's
  // source/target types with the entity being created.
  const relationships = input.data.relationships ?? [];
  const targetIds = [...new Set(relationships.map((r) => r.targetEntityId))];
  const targetTypes = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data: targets, error: targetError } = await admin
      .from("cg_entity")
      .select("id, tenant_id, entity_type")
      .in("id", targetIds);
    if (targetError) throw new Error(targetError.message);
    const rows = (targets ?? []) as Array<{
      id: string;
      tenant_id: string | null;
      entity_type: string;
    }>;
    const found = new Map(rows.map((row) => [row.id, row]));
    for (const id of targetIds) {
      const row = found.get(id);
      if (!row || (row.tenant_id ?? null) !== tenantId) {
        throw new Error(`relationship target "${id}" does not exist in the actor's tenant scope`);
      }
      targetTypes.set(id, row.entity_type);
    }
    for (const relation of relationships) {
      assertScholarRelationshipVocabulary(
        relation.relationType,
        input.data.entityType,
        targetTypes.get(relation.targetEntityId) ?? "",
      );
    }
  }

  // The event must be a registered Scholar event bound to the created entity.
  let eventType: ScholarEventType | null = null;
  if (input.data.event) {
    const candidate = input.data.event.eventType;
    if (!isScholarEventType(candidate)) {
      throw new Error(`event type "${candidate}" is not a registered Scholar event`);
    }
    assertScholarEventForEntity(candidate, input.data.entityType);
    eventType = candidate;
  }

  const { data: inserted, error: insertError } = await admin
    .from("cg_entity")
    .insert(entityRow)
    .select("id, tenant_id")
    .single();
  if (insertError) throw new Error(insertError.message);
  const realityRef = String(inserted.id);

  let relationshipCount = 0;
  for (const relation of relationships) {
    const row = buildScholarFoundationRelationship(
      {
        relationType: relation.relationType,
        sourceEntityId: realityRef,
        targetEntityId: relation.targetEntityId,
        attributes: relation.attributes,
      },
      tenantId,
      now,
    );
    const { error: relationshipError } = await admin.from("cg_relationship").insert(row);
    if (relationshipError) throw new Error(relationshipError.message);
    relationshipCount += 1;
  }

  if (eventType) {
    const eventRow = buildScholarFoundationEvent(
      {
        eventType,
        aggregateId: realityRef,
        actorIdentity: input.userId,
        correlationId: null,
        idempotencyKey: `scholar-foundation-validation:${input.data.idempotencyKey}`,
      },
      tenantId,
      now,
    );
    const { error: eventError } = await admin.from("cg_event").insert(eventRow);
    if (eventError) throw new Error(eventError.message);
  }

  const plan = planFoundationLoop({
    tenantId,
    actorId: input.userId,
    now,
    reality: { id: realityRef, tenantId: inserted.tenant_id ?? null },
    requestedRealityRef: realityRef,
    request: scholarFoundationRequest({
      executionId: crypto.randomUUID(),
      idempotencyKey: input.data.idempotencyKey,
      requestedAt: now,
    }),
  });

  const result = await persistFoundationPlan(plan, admin);
  await auditFoundationLoop({
    admin,
    tenantId,
    userId: input.userId,
    action: "scholar_foundation_loop",
    result,
    realityRef,
  });
  return {
    ok: true,
    replayed: result.replayed,
    executionId: result.executionId,
    executionStatus: result.executionStatus,
    scholarEntityType: input.data.entityType,
    realityRef,
    verificationDecision: result.verification?.decision ?? null,
    relationshipCount,
    recordedEvent: eventType,
  };
}

export const scholarFoundationLoop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => scholarSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScholarFoundationResult> =>
    executeScholarFoundationLoop({
      supabase: context.supabase,
      userId: context.userId,
      claims: context.claims,
      data,
    }),
  );

export {
  SCHOLAR_FOUNDATION_ENTITY_TYPES,
  SCHOLAR_FOUNDATION_MISSION_ID,
  SCHOLAR_FOUNDATION_RELATIONSHIP_TYPES,
};
