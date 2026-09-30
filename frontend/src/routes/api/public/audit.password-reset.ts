import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PASSWORD_RESET_RATE_LIMIT, passwordResetRetryAfterMs } from "@/lib/auth-helpers";

const AUDIT_EVENTS = [
  "password_reset_requested",
  "password_reset_completed",
  "login_failed",
  "login_succeeded",
] as const;

const BodySchema = z.object({
  event: z.enum(AUDIT_EVENTS),
  email: z.string().email().max(254).optional(),
  user_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/public/audit/password-reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          // Never reveal validation details — always return success to avoid enumeration
          return Response.json({ ok: true });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let userId = parsed.user_id ?? null;
          let schoolId: string | null = null;

          if (parsed.email && !userId) {
            const { data: u } = await supabaseAdmin
              .from("users")
              .select("id, school_id")
              .eq("email", parsed.email)
              .maybeSingle();
            if (u) {
              userId = u.id;
              schoolId = u.school_id;
            }
          } else if (userId) {
            const { data: u } = await supabaseAdmin
              .from("users")
              .select("school_id")
              .eq("id", userId)
              .maybeSingle();
            if (u) schoolId = u.school_id;
          }

          const ip =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            null;

          // Rate limit only the *request* event (completion can't be abused).
          if (parsed.event === "password_reset_requested") {
            const since = new Date(Date.now() - PASSWORD_RESET_RATE_LIMIT.windowMs).toISOString();

            // Count recent attempts for this email AND this IP. Either over-limit blocks.
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
            if (ip) {
              filters.push(
                Promise.resolve(
                  supabaseAdmin
                    .from("audit_logs")
                    .select("created_at")
                    .eq("action", "password_reset_requested")
                    .eq("ip_address", ip)
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
            school_id: schoolId,
            user_id: userId,
            action: parsed.event,
            table_name: "auth.users",
            record_id: userId,
            new_value: {
              email: parsed.email ?? null,
              user_agent: request.headers.get("user-agent") ?? null,
            },
            ip_address: ip,
          });
        } catch {
          // Swallow — audit must never leak info or block UX
        }

        return Response.json({ ok: true });
      },
    },
  },
});
