/**
 * Sherivs public status — validation for the public health payload.
 *
 * The status page renders only what this schema accepts. A payload that does not match
 * is shown as "status unavailable", never coerced into a healthy-looking result.
 */
import { z } from "zod";

export const HealthStatusSchema = z.enum(["ok", "degraded", "failing"]);
export type PublicHealthStatus = z.infer<typeof HealthStatusSchema>;

export const HealthPayloadSchema = z.object({
  status: HealthStatusSchema,
  ts: z.iso.datetime(),
  uptime_s: z.number().nonnegative(),
  version: z.string().min(1).nullable(),
  checks: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        status: HealthStatusSchema,
        detail: z.string().max(200).optional(),
      }),
    )
    .max(50),
});
export type PublicHealthPayload = z.infer<typeof HealthPayloadSchema>;

export type HealthReading =
  | { kind: "reading"; payload: PublicHealthPayload }
  | { kind: "invalid" };

export function parseHealthPayload(raw: unknown): HealthReading {
  const result = HealthPayloadSchema.safeParse(raw);
  return result.success ? { kind: "reading", payload: result.data } : { kind: "invalid" };
}

export const HEALTH_STATUS_COPY: Record<PublicHealthStatus, { label: string; detail: string }> = {
  ok: {
    label: "Operational",
    detail: "The instance that served this page reports every check passing.",
  },
  degraded: {
    label: "Degraded",
    detail: "The instance is serving requests, but at least one dependency check is not passing.",
  },
  failing: {
    label: "Failing",
    detail: "The instance reports a failing check and may be drained from service.",
  },
};

/** "3 d 4 h", "5 h 12 min", "42 min" — coarse on purpose; this is not a metric chart. */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} d ${hours % 24} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${Math.max(minutes, 0)} min`;
}
