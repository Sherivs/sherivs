import { createHash } from "node:crypto";

export function createNotificationIdempotencyKey(kind: string, sourceKey: string): string {
  const normalizedKind = kind.trim().toLowerCase();
  if (!normalizedKind || !sourceKey) {
    throw new Error("Notification idempotency keys require a kind and source key");
  }

  const digest = createHash("sha256").update(sourceKey).digest("hex");
  return `${normalizedKind}:${digest}`;
}
