/**
 * CoreGrid — AI Agent System memory interface.
 *
 * Implements `architecture/phase-07-ai-agent-system.md`:
 * - Phase 07 consumes memory services; it does not own the complete Memory &
 *   Context architecture (Section AR).
 * - Memory types: working, episodic, semantic, task, procedural (Section AR).
 * - Every memory operation specifies identity, tenant, purpose, classification (AS).
 * - Agents must not write arbitrary permanent memory without policy (Section AT).
 * - Agent-generated memory must be distinguishable from authoritative facts (AU).
 * - Context should retain provenance where practical (Section AV).
 * - Context packages contain task, permissions, relevant memory, tools, state,
 *   policies, constraints, provenance (Section AW).
 * - Context respects model limits, privacy, token budgets, relevance, classification (AX).
 * - External content must not automatically become trusted instructions (AY).
 * - Prompt injection defense: distinguish system instructions from untrusted data (AZ).
 * - Lower-trust content must not override higher-level policies (Section BA).
 * - Tool output is data unless explicitly trusted control information (Section BB).
 */

import type { TenantId } from "./tenant-core";
import type { AgentId, AgentMemoryCategory } from "./agent-core";

/* ─────────────────────────────────────────────
 * Branded IDs
 * ─────────────────────────────────────────────*/

export type MemoryEntryId = string & { readonly __brand: "MemoryEntryId" };
export type ContextPackageId = string & { readonly __brand: "ContextPackageId" };

export function memoryEntryId(raw: string): MemoryEntryId {
  return raw as MemoryEntryId;
}

export function contextPackageId(raw: string): ContextPackageId {
  return raw as ContextPackageId;
}

/* ─────────────────────────────────────────────
 * Memory entry (Sections AR, AS, AT, AU)
 * ─────────────────────────────────────────────*/

export type MemoryProvenance =
  | {
      kind: "authoritative";
      source: "database" | "device" | "user" | "administrator" | "external_api";
    }
  | { kind: "inference"; source: "agent"; agentId: AgentId }
  | { kind: "derived"; source: "computation" };

export interface MemoryEntry {
  id: MemoryEntryId;
  tenantId: TenantId;
  agentId: AgentId;
  category: AgentMemoryCategory;
  content: string;
  provenance: MemoryProvenance;
  dataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
  createdAt: string;
  expiresAt: string | null;
}

export interface MemoryAccessRequest {
  tenantId: TenantId;
  agentId: AgentId;
  category: AgentMemoryCategory;
  purpose: string;
  dataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
}

export type MemoryAccessResult =
  { ok: true; entries: MemoryEntry[] } | { ok: false; error: string };

export function readMemory(
  request: MemoryAccessRequest,
  entries: MemoryEntry[],
  allowedCategories: AgentMemoryCategory[],
  maxClassification: MemoryAccessRequest["dataClassification"],
): MemoryAccessResult {
  if (!allowedCategories.includes(request.category)) {
    return {
      ok: false,
      error: `Agent not permitted to access memory category ${request.category}`,
    };
  }
  const classificationRank: Record<string, number> = {
    PUBLIC: 0,
    TENANT_INTERNAL: 1,
    CONFIDENTIAL: 2,
    SENSITIVE: 3,
    RESTRICTED: 4,
  };
  if (classificationRank[request.dataClassification] > classificationRank[maxClassification]) {
    return { ok: false, error: "Memory access exceeds agent data classification" };
  }
  const filtered = entries.filter(
    (e) =>
      e.tenantId === request.tenantId &&
      e.agentId === request.agentId &&
      e.category === request.category &&
      classificationRank[e.dataClassification] <= classificationRank[maxClassification],
  );
  return { ok: true, entries: filtered };
}

export type MemoryWriteResult = { ok: true; entry: MemoryEntry } | { ok: false; error: string };

export function writeMemory(
  request: MemoryAccessRequest,
  content: string,
  provenance: MemoryProvenance,
  allowPersistentWrite: boolean,
  requireInferenceMarking: boolean,
  now: string,
): MemoryWriteResult {
  if (content.trim() === "") {
    return { ok: false, error: "Memory content is required" };
  }
  if (!allowPersistentWrite) {
    return { ok: false, error: "Agent is not permitted to write persistent memory (Section AT)" };
  }
  if (requireInferenceMarking && provenance.kind === "inference" && !provenance.source) {
    return { ok: false, error: "Inference memory must be marked as agent-generated (Section AU)" };
  }
  return {
    ok: true,
    entry: {
      id: memoryEntryId(`${request.agentId}:${now}`),
      tenantId: request.tenantId,
      agentId: request.agentId,
      category: request.category,
      content,
      provenance,
      dataClassification: request.dataClassification,
      createdAt: now,
      expiresAt: null,
    },
  };
}

/* ─────────────────────────────────────────────
 * Context packaging (Sections AW, AX, AY, AZ, BA, BB)
 * ─────────────────────────────────────────────*/

export interface ContextPackage {
  id: ContextPackageId;
  agentId: AgentId;
  tenantId: TenantId | null;
  taskSummary: string;
  permissions: string[];
  memoryEntries: MemoryEntry[];
  availableToolIds: string[];
  currentState: string;
  policies: string[];
  constraints: string[];
  provenance: string[];
  tokenBudget: number;
  createdAt: string;
  expiresAt: string | null;
}

export type BuildContextPackageResult =
  { ok: true; context: ContextPackage } | { ok: false; error: string };

export function buildContextPackage(
  agentId: AgentId,
  tenantId: TenantId | null,
  taskSummary: string,
  permissions: string[],
  memoryEntries: MemoryEntry[],
  availableToolIds: string[],
  currentState: string,
  policies: string[],
  constraints: string[],
  tokenBudget: number,
  now: string,
): BuildContextPackageResult {
  if (taskSummary.trim() === "") {
    return { ok: false, error: "Context package requires a task summary" };
  }
  if (tokenBudget <= 0) {
    return { ok: false, error: "Context package token budget must be positive (Section AX)" };
  }
  return {
    ok: true,
    context: {
      id: contextPackageId(`${agentId}:${now}`),
      agentId,
      tenantId,
      taskSummary,
      permissions,
      memoryEntries,
      availableToolIds,
      currentState,
      policies,
      constraints,
      provenance: memoryEntries.map((m) => `${m.provenance.kind}:${m.provenance.source}`),
      tokenBudget,
      createdAt: now,
      expiresAt: null,
    },
  };
}

/* ─────────────────────────────────────────────
 * Prompt injection defense (Sections AY, AZ, BA, BB)
 * ─────────────────────────────────────────────*/

export type ContentTrust = "system" | "user" | "tool_output" | "external";

export interface InstructionSource {
  content: string;
  trust: ContentTrust;
}

export function isTrustedInstruction(
  source: InstructionSource,
  systemPolicy: string[],
): { trusted: true } | { trusted: false; reason: string } {
  // System-level instructions are trusted; external content is data (Section BB).
  if (source.trust === "system") {
    return { trusted: true };
  }
  if (source.trust === "external" || source.trust === "tool_output") {
    return {
      trusted: false,
      reason: "External/tool content is data, not instructions (Section BB)",
    };
  }
  // User content may be trusted only if it does not conflict with system policy (Section BA).
  if (source.trust === "user") {
    if (systemPolicy.some((p) => source.content.includes(p))) {
      return {
        trusted: false,
        reason: "User content conflicts with higher-level policy (Section BA)",
      };
    }
    return { trusted: true };
  }
  return { trusted: false, reason: "Unknown content trust level" };
}
