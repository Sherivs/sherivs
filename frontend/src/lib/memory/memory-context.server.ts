import {
  assembleContext,
  contextPayload,
  type ContextEnvelope,
  type ContextSensitivity,
} from "../context-assembly";
import { createMemoryTierAdapter } from "./memory-db-adapter.server";
import type { MemoryTierAdapter } from "./memory-adapter";

export interface GatewayMemoryContextRequest {
  scopeId: string;
  permissions: readonly string[];
  domains: readonly string[];
  maxSensitivity: ContextSensitivity;
  maxAgeSeconds: number;
  maxItems: number;
  maxChars: number;
  traceId?: string;
}

export interface AssembledMemoryContext {
  traceId: string;
  assembledContent: string;
  envelope: Extract<ContextEnvelope, { kind: "assembled" }>;
}

export async function assembleMemoryContext(
  input: GatewayMemoryContextRequest & {
    tenantRef: string;
    actorRef: string;
    purpose: string;
    missionRef?: string | null;
    now: string;
  },
  adapter?: MemoryTierAdapter,
): Promise<AssembledMemoryContext> {
  if (!input.scopeId.trim() || input.domains.length === 0 || input.domains.some((d) => !d.trim())) {
    throw new Error("AI memory context requires a declared scope and non-empty domains");
  }
  const memory = adapter ?? (await createMemoryTierAdapter());
  const retrieved = await memory.retrieve(
    {
      identityRef: input.actorRef,
      tenantId: input.tenantRef,
      scopeId: input.scopeId,
      missionRef: input.missionRef ?? null,
      permissions: input.permissions,
      purpose: input.purpose,
      maxAgeSeconds: input.maxAgeSeconds,
      maxResults: input.maxItems,
      requireNamespaces: input.domains,
    },
    { now: input.now },
  );
  const envelope = assembleContext(
    {
      tenantRef: input.tenantRef,
      actorRef: { userId: input.actorRef, role: "gateway", permissions: input.permissions },
      purpose: input.purpose,
      missionRef: input.missionRef ?? null,
      budget: { maxItems: input.maxItems, maxChars: input.maxChars },
      candidateSources: ["authorized_database_record"],
      memoryScope: { domains: input.domains, maxSensitivity: input.maxSensitivity },
      dataScope: { domains: input.domains, maxSensitivity: input.maxSensitivity },
      traceId: input.traceId,
    },
    retrieved.records.map((record) => ({
      id: record.id,
      tenantRef: record.tenantId,
      source: "authorized_database_record",
      sensitivity: record.sensitivity,
      freshnessAt: record.freshnessAt,
      content: contextPayload(record.content),
      requiredPermission: record.requiredPermission,
      purposeTags: record.domain.split(/[^a-z0-9]+/i).filter(Boolean),
    })),
    { maxAgeSeconds: input.maxAgeSeconds, now: input.now },
  );
  if (envelope.kind !== "assembled") {
    throw new Error(`AI memory context assembly failed: ${envelope.reason}`);
  }
  const recordById = new Map(retrieved.records.map((record) => [record.id, record]));
  const assembledContent = JSON.stringify(
    envelope.items.map((item) => ({
      id: item.id,
      domain: recordById.get(item.id)?.domain,
      sensitivity: item.sensitivity,
      freshnessAt: item.freshnessAt,
      trust: item.trust,
      content: item.content.content,
    })),
  );
  return { traceId: envelope.traceId, assembledContent, envelope };
}
