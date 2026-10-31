/**
 * Notification digest — collapse the last 24h (or 7d) of unread in-app
 * notifications for every user with digest_frequency='daily' (or 'weekly')
 * into ONE summary notification per user. Admin-triggered for now; a pg_cron
 * job can call this same function on a schedule once the school is happy
 * with the cadence.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const Input = z.object({
  frequency: z.enum(["daily", "weekly"]).default("daily"),
});

export const sendNotificationDigests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const hours = data.frequency === "weekly" ? 168 : 24;
    const since = new Date(timeAuthority.now().atMs - hours * 3600_000).toISOString();

    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id")
      .eq("school_id", schoolId)
      .eq("digest_frequency", data.frequency);
    const targetIds = (prefs ?? []).map((p) => p.user_id as string);
    if (!targetIds.length) return { sent: 0 };

    let sent = 0;
    for (const uid of targetIds) {
      const { data: rows } = await supabase
        .from("notifications")
        .select("type, title, created_at, is_read")
        .eq("school_id", schoolId)
        .eq("user_id", uid)
        .eq("is_read", false)
        .gte("created_at", since)
        .neq("type", "digest")
        .limit(200);
      const list = rows ?? [];
      if (list.length < 2) continue; // digest only meaningful for ≥2 items

      const counts = list.reduce<Record<string, number>>((acc, r) => {
        const k = (r.type as string | null) ?? "other";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      const parts = Object.entries(counts)
        .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
        .join(", ");

      const { error } = await supabase.from("notifications").insert({
        school_id: schoolId,
        user_id: uid,
        title: `Your ${data.frequency} summary`,
        message: `${list.length} new updates in the last ${hours}h — ${parts}.`,
        type: "digest",
        action_url: "/home/notifications",
        is_read: false,
      });
      if (!error) sent += 1;
    }
    return { sent };
  });
