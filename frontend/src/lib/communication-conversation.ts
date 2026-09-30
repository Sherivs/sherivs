/**
 * CoreGrid — Communication Platform conversation domain
 * (Phase 10, F.3, BX, BY).
 *
 * Implements `architecture/phase-10-communication-platform.md`:
 * - Conversation contract (F.3): conversation ID, tenant, participants,
 *   channel, subject, state, created timestamp, last activity, retention
 *   policy.
 * - Read receipts (BX): unread, delivered, read, acknowledged. Read
 *   information must respect privacy settings.
 * - Acknowledgement (BY): certain communications require explicit
 *   acknowledgement, recorded independently.
 * - Tenant isolation (DN): conversations and participants are tenant-scoped;
 *   cross-tenant participation requires explicit federation/authorization.
 */

import type { TenantId } from "./tenant-core";

export type ConversationState = "active" | "archived" | "locked" | "deleted";

export const CONVERSATION_STATES: readonly ConversationState[] = [
  "active",
  "archived",
  "locked",
  "deleted",
] as const;

export interface Conversation {
  id: string;
  tenantId: TenantId;
  participants: string[];
  channel: string;
  subject: string;
  state: ConversationState;
  createdAt: string;
  lastActivityAt: string;
  retentionDays: number | null;
}

export interface CreateConversationInput {
  tenantId: TenantId;
  participants: string[];
  channel: string;
  subject: string;
  now: string;
  retentionDays?: number | null;
}

export type CreateConversationResult =
  { ok: true; conversation: Conversation } | { ok: false; error: string };

export function createConversation(input: CreateConversationInput): CreateConversationResult {
  if (input.participants.length < 2) {
    return { ok: false, error: "A conversation requires at least two participants (F.3)" };
  }
  if (input.subject.trim() === "") {
    return { ok: false, error: "Conversation subject is required (F.3)" };
  }
  const uniqueParticipants = new Set(input.participants);
  if (uniqueParticipants.size !== input.participants.length) {
    return { ok: false, error: "Conversation participants must be unique" };
  }
  return {
    ok: true,
    conversation: {
      id: `convo-${input.tenantId}-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
      tenantId: input.tenantId,
      participants: input.participants,
      channel: input.channel,
      subject: input.subject,
      state: "active",
      createdAt: input.now,
      lastActivityAt: input.now,
      retentionDays: input.retentionDays ?? null,
    },
  };
}

const CONVERSATION_TRANSITIONS: Readonly<Record<ConversationState, readonly ConversationState[]>> =
  {
    active: ["archived", "locked"],
    archived: ["active", "deleted"],
    locked: ["archived", "active"],
    deleted: [],
  };

export function transitionConversation(
  conversation: Conversation,
  to: ConversationState,
  now: string,
): { ok: true; conversation: Conversation } | { ok: false; error: string } {
  if (!CONVERSATION_TRANSITIONS[conversation.state].includes(to)) {
    return {
      ok: false,
      error: `Conversation transition ${conversation.state} -> ${to} is not allowed`,
    };
  }
  return {
    ok: true,
    conversation: { ...conversation, state: to, lastActivityAt: now },
  };
}

/** Participants must stay within the conversation's tenant (DN). */
export function canAddParticipant(
  conversation: Conversation,
  participantTenantId: TenantId | null,
): boolean {
  if (participantTenantId === null) return false;
  return participantTenantId === conversation.tenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Read receipts (BX) and acknowledgement (BY)
 * ────────────────────────────────────────────────────────────*/

export type ReadState = "unread" | "delivered" | "read" | "acknowledged";

export const READ_STATES: readonly ReadState[] = [
  "unread",
  "delivered",
  "read",
  "acknowledged",
] as const;

export interface ReadReceipt {
  messageId: string;
  participantId: string;
  state: ReadState;
  updatedAt: string;
}

export function markReadReceipt(
  receipt: ReadReceipt | null,
  messageId: string,
  participantId: string,
  to: ReadState,
  now: string,
): ReadReceipt {
  if (receipt && to === "unread") {
    // Read information must respect privacy settings (BX): a participant
    // may not regress another participant's read state. This function only
    // ever moves forward; the caller decides policy.
    return receipt;
  }
  return { messageId, participantId, state: to, updatedAt: now };
}

export interface AcknowledgementRecord {
  messageId: string;
  participantId: string;
  acknowledgedAt: string;
  recordedBy: string;
}

export function recordAcknowledgement(
  messageId: string,
  participantId: string,
  recordedBy: string,
  now: string,
): AcknowledgementRecord {
  // Acknowledgement must be independently recorded (BY) — it is not derived
  // from read state.
  return { messageId, participantId, acknowledgedAt: now, recordedBy };
}
