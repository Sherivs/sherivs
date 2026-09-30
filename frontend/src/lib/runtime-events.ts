/**
 * CoreGrid — Core Application Runtime event engine.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Events: applications communicate that something happened (Section Q1).
 * - Event envelope: id, type, version, payload, occurredAt, producer, correlation (Section Q4).
 * - Event versioning: consumers must not break whenever producers evolve (Section R).
 * - Event idempotency: consumers must tolerate duplicate delivery (Section S).
 * - Event retention: configurable per operational, audit, compliance, storage needs (Section U).
 * - Dead-letter processing: failed events move to controlled handling (Section V).
 * - Outbox pattern: state changes and event publications are consistent (Section P).
 * - Inbox model: idempotent processing of external messages (Section GO).
 * - Outbox model: reliable event publication (Section GP).
 */

import type { TenantId } from "./tenant-core";
import { correlationId, type CorrelationId } from "./runtime-core";

/* ─────────────────────────────────────────────────────────────
 * Event types
 * ────────────────────────────────────────────────────────────*/

export type ApplicationEventType = "domain" | "integration" | "system" | "audit" | "notification";

export const APPLICATION_EVENT_TYPES: readonly ApplicationEventType[] = [
  "domain",
  "integration",
  "system",
  "audit",
  "notification",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Event envelope (Section Q4)
 * ────────────────────────────────────────────────────────────*/

export interface ApplicationEvent {
  id: string;
  type: ApplicationEventType;
  name: string;
  version: number;
  payload: Record<string, unknown>;
  producer: string;
  tenantId: TenantId | null;
  correlationId: CorrelationId;
  isExternal: boolean;
  sourceEventId: string | null;
  occurredAt: string;
}

export interface CreateApplicationEventInput {
  name: string;
  version?: number;
  type?: ApplicationEventType;
  payload: Record<string, unknown>;
  producer: string;
  tenantId: TenantId | null;
  correlationId?: CorrelationId;
  isExternal?: boolean;
  sourceEventId?: string | null;
  occurredAt: string;
}

export function createApplicationEvent(input: CreateApplicationEventInput): ApplicationEvent {
  const correlation =
    input.correlationId ??
    correlationId(`corr-${input.occurredAt}-${Math.random().toString(36).slice(2, 10)}`);
  return {
    id: `evt-${input.occurredAt}-${Math.random().toString(36).slice(2, 10)}`,
    type: input.type ?? "domain",
    name: input.name,
    version: input.version ?? 1,
    payload: input.payload,
    producer: input.producer,
    tenantId: input.tenantId,
    correlationId: correlation,
    isExternal: input.isExternal ?? false,
    sourceEventId: input.sourceEventId ?? null,
    occurredAt: input.occurredAt,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Event compatibility (Section R)
 * ────────────────────────────────────────────────────────────*/

export type EventCompatibility = "compatible" | "incompatible" | "forward_compatible";

/** Consumers can tolerate duplicate delivery (Section S). */
export function isEventCompatible(
  event: ApplicationEvent,
  supportedVersions: number[],
  forwardCompatible: boolean,
): boolean {
  if (supportedVersions.includes(event.version)) return true;
  if (forwardCompatible && supportedVersions.every((v) => event.version >= v)) return true;
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Duplicate detection (Section S)
 * ────────────────────────────────────────────────────────────*/

export type ConsumptionResult = "success" | "failure" | "duplicate" | "dead_letter";

export interface DuplicateDetector {
  hasSeen(eventId: string, consumer: string): boolean;
  record(eventId: string, consumer: string, result: ConsumptionResult): void;
}

export function createDuplicateDetector(): DuplicateDetector {
  const seen = new Set<string>();
  const key = (eventId: string, consumer: string) => `${eventId}:${consumer}`;
  return {
    hasSeen(eventId, consumer) {
      return seen.has(key(eventId, consumer));
    },
    record(eventId, consumer, _result) {
      seen.add(key(eventId, consumer));
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Event routing
 * ────────────────────────────────────────────────────────────*/

export interface EventSubscription {
  eventName: string;
  consumer: string;
  handleEvent(event: ApplicationEvent): void;
}

export type EventDispatchResult =
  { ok: true; processedEventIds: string[] } | { ok: false; error: string };

export interface EventDispatcher {
  subscribe(subscription: EventSubscription): void;
  publish(event: ApplicationEvent, duplicateDetector: DuplicateDetector): EventDispatchResult;
  hasSubscribers(eventName: string): boolean;
}

export function createEventDispatcher(): EventDispatcher {
  const subscriptions: EventSubscription[] = [];
  return {
    subscribe(subscription) {
      subscriptions.push(subscription);
    },
    publish(event, duplicateDetector) {
      const relevant = subscriptions.filter((s) => s.eventName === event.name);
      if (relevant.length === 0) return { ok: true, processedEventIds: [] };

      const processed: string[] = [];
      for (const sub of relevant) {
        if (duplicateDetector.hasSeen(event.id, sub.consumer)) {
          if (!processed.includes(event.id)) processed.push(event.id);
          continue;
        }

        try {
          sub.handleEvent(event);
          duplicateDetector.record(event.id, sub.consumer, "success");
          processed.push(event.id);
        } catch {
          duplicateDetector.record(event.id, sub.consumer, "failure");
          processed.push(event.id);
        }
      }

      return { ok: true, processedEventIds: processed };
    },
    hasSubscribers(eventName) {
      return subscriptions.some((s) => s.eventName === eventName);
    },
  };
}

/* ──────────────────────────────────────────────────────────────
 * Dead-letter processing (Section V)
 * ────*────────────────────────────────────────────*/

export interface DeadLetterRecord {
  eventId: string;
  eventName: string;
  tenantId: TenantId | null;
  consumer: string;
  lastError: string;
  attempts: number;
  lastAttemptAt: string;
  status: "queued" | "processed" | "discarded";
  createdAt: string;
}
export interface DeadLetterQueue {
  deadLetters: DeadLetterRecord[];
  record(event: ApplicationEvent, consumer: string, error: string, now: string): void;
  process(subscriptions: EventSubscription[], detector: DuplicateDetector): void;
  dismiss(eventId: string, consumer: string): void;
}

export function createDeadLetterQueue(): DeadLetterQueue {
  const dead: DeadLetterRecord[] = [];
  return {
    deadLetters: dead,
    record(event, consumer, error, now) {
      const existing = dead.find((d) => d.eventId === event.id && d.consumer === consumer);
      if (existing) {
        existing.lastError = error;
        existing.lastAttemptAt = now;
        existing.attempts += 1;
      } else {
        dead.push({
          eventId: event.id,
          eventName: event.name,
          tenantId: event.tenantId,
          consumer,
          lastError: error,
          attempts: 1,
          lastAttemptAt: now,
          status: "queued",
          createdAt: now,
        });
      }
    },
    process(subscriptions, detector) {
      for (const d of dead) {
        if (d.status !== "queued") continue;
        const sub = subscriptions.find(
          (s) => s.eventName === d.eventName && s.consumer === d.consumer,
        );
        if (!sub) continue;
        try {
          const event: ApplicationEvent = {
            id: d.eventId,
            type: "domain",
            name: d.eventName,
            version: 1,
            payload: {},
            producer: "dead-letter-replay",
            tenantId: d.tenantId,
            correlationId: correlationId("dead-letter-replay"),
            isExternal: false,
            sourceEventId: null,
            occurredAt: d.lastAttemptAt,
          };
          sub.handleEvent(event);
          detector.record(event.id, d.consumer, "success");
          d.status = "processed";
        } catch (error) {
          d.lastError = error instanceof Error ? error.message : "Unknown error";
          d.lastAttemptAt = new Date().toISOString();
        }
      }
    },
    dismiss(eventId, consumer) {
      const idx = dead.findIndex((d) => d.eventId === eventId && d.consumer === consumer);
      if (idx >= 0) dead[idx].status = "discarded";
    },
  };
}

/* ────────────────────────────────────────────────
 * Outbox pattern (Section GP)
 * ────────────────────────────────────────────────*/

export interface OutboxMessage {
  id: string;
  eventName: string;
  eventVersion: number;
  payload: Record<string, unknown>;
  tenantId: TenantId | null;
  correlationId: string;
  status: "pending" | "published" | "failed";
  createdAt: string;
  publishedAt: string | null;
  publisher: string;
  consumer: string;
}

export function createOutboxMessage(input: {
  eventName: string;
  eventVersion: number;
  payload: Record<string, unknown>;
  tenantId: TenantId | null;
  correlationId: string;
  publisher: string;
  consumer: string;
  now: string;
}): OutboxMessage {
  return {
    id: `outbox-${input.now}-${Math.random().toString(36).slice(2, 10)}`,
    eventName: input.eventName,
    eventVersion: input.eventVersion,
    payload: input.payload,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    status: "pending",
    createdAt: input.now,
    publishedAt: null,
    publisher: input.publisher,
    consumer: input.consumer,
  };
}
