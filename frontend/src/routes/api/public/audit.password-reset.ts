import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PASSWORD_RESET_RATE_LIMIT, passwordResetRetryAfterMs } from "@/lib/auth-helpers";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import {
  bindAuditActor,
  auditEventRequiresSession,
  isAuditIngestEvent,
  type DirectoryAuditUser,
} from "@/lib/security/audit-ingest";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { verifiedAuditUser } from "@/lib/security/verify-bearer";

const timeAuthority = new TimeAuthority(new SystemClock());

/** Unauthenticated endpoint that writes audit rows: cap per source address. */
const AUDIT_INGEST_LIMIT = { maxRequests: 30, windowMs: 60_000 } as const;

const BodySchema = z.object({
  event: z.string().max(64),
  email: z.string().email().max(254).optional(),
});

export const Route = createFileRoute("/api/public/audit/password-reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkPublicRateLimit } = await import("@/lib/security/public-rate-limit.server");
        const trustedIp = clientIpFromHeaders(request.headers);
        const limited = await checkPublicRateLimit(
          "audit-password-reset",
          trustedIp,
          AUDIT_INGEST_LIMIT,
        );
        if (!limited.allowed) {
          return Response.json(
            { ok: false, rate_limited: true, retry_after_ms: limited.retryAfterSeconds * 1000 },
            { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
          );
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          // Never reveal validation details — always return success to avoid enumeration
          return Response.json({ ok: true });
        }
        if (!isAuditIngestEvent(parsed.event)) return Response.json({ ok: true });

        const verified = auditEventRequiresSession(parsed.event)
          ? await verifiedAuditUser(request.headers.get("authorization"))
          : null;
        if (auditEventRequiresSession(parsed.event) && !verified) {
          return Response.json({ ok: false }, { status: 401 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let directory: DirectoryAuditUser | null = null;
          if (parsed.event === "password_reset_requested" && parsed.email) {
            const { data: u } = await supabaseAdmin
              .from("users")
              .select("id, school_id")
              .eq("email", parsed.email)
              .maybeSingle();
            if (u) directory = { userId: u.id, schoolId: u.school_id };
          } else if (verified) {
            const { data: u } = await supabaseAdmin
              .from("users")
              .select("school_id")
              .eq("id", verified.userId)
              .maybeSingle();
            directory = { userId: verified.userId, schoolId: u?.school_id ?? null };
          }

          const actor = bindAuditActor({
            event: parsed.event,
            verified,
            claimedEmail: parsed.email ?? null,
            directory,
          });
          if (!actor) return Response.json({ ok: false }, { status: 401 });

          // Rate limit only the *request* event (completion can't be abused).
          if (parsed.event === "password_reset_requested") {
            const since = new Date(
              timeAuthority.now().atMs - PASSWORD_RESET_RATE_LIMIT.windowMs,
            ).toISOString();

            const filters: Array<Promise<{ data: { created_at: string | null }[] | null }>> = [];
            if (parsed.email) {
              filters.push(
                Promise.resolve(
                  supabaseAdmin
                    .from("audit_logs")
                    .select("created_at")
                    .eq("action", "password_reset_requested")
                    .gte("created_at", since)
                    .filter("new_value->>email", "eq", parsed.email),
                ).then(({ data }) => ({ data })),
              );
            }
            if (trustedIp !== "unknown") {
              filters.push(
                Promise.resolve(
                  supabaseAdmin
                    .from("audit_logs")
                    .select("created_at")
                    .eq("action", "password_reset_requested")
                    .eq("ip_address", trustedIp)
                    .gte("created_at", since),
                ).then(({ data }) => ({ data })),
              );
            }

            const results = await Promise.all(filters);
            for (const r of results) {
              const clean = (r.data ?? []).filter(
                (x): x is { created_at: string } => !!x.created_at,
              );
              const wait = passwordResetRetryAfterMs(clean);
              if (wait > 0) {
                return Response.json(
                  {
                    ok: false,
                    rate_limited: true,
                    retry_after_ms: wait,
                  },
                  {
                    status: 429,
                    headers: {
                      "Retry-After": String(Math.ceil(wait / 1000)),
                    },
                  },
                );
              }
            }
          }

          await supabaseAdmin.from("audit_logs").insert({
            school_id: actor.schoolId,
            user_id: actor.userId,
            action: parsed.event,
            table_name: "auth.users",
            record_id: actor.userId,
            new_value: {
              email: actor.email,
              user_agent: request.headers.get("user-agent") ?? null,
            },
            ip_address: trustedIp === "unknown" ? null : trustedIp,
          });
        } catch {
          // Swallow — audit must never leak info or block UX
        }

        return Response.json({ ok: true });
      },
    },
  },
});
