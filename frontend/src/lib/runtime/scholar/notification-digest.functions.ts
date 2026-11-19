/**
 * Notification digest — collapse the last 24h (or 7d) of eligible unread
 * in-app notifications for each user with the matching digest preference.
 * Admin-triggered for now; external delivery remains disabled.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import {
  digestWindowKey,
  filterDigestNotifications,
  isWithinQuietHours,
  type NotificationPreferences,
} from "@/lib/notifications/delivery-policy";
import { selectActiveMembershipRecipientIds } from "@/lib/notifications/membership-recipients";
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

    const nowMs = timeAuthority.now().atMs;
    const hours = data.frequency === "weekly" ? 168 : 24;
    const since = new Date(nowMs - hours * 3600_000).toISOString();
    const utcMinuteOfDay = new Date(nowMs).getUTCHours() * 60 + new Date(nowMs).getUTCMinutes();
    const windowKey = digestWindowKey(data.frequency, nowMs);
    const { createNotificationIdempotencyKey } =
      await import("@/lib/notifications/delivery-key.server");
    const idempotencyKey = createNotificationIdempotencyKey(
      "digest",
      `${data.frequency}\u0000${windowKey}`,
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prefs, error: preferencesError } = await supabaseAdmin
      .from("notification_preferences")
      .select(
        "user_id, digest_frequency, inapp_messages, inapp_announcements, inapp_grades, inapp_attendance, inapp_fees, quiet_hours_start, quiet_hours_end",
      )
      .eq("school_id", schoolId)
      .eq("digest_frequency", data.frequency);
    if (preferencesError) throw new Error(preferencesError.message);
    const preferenceIds = (prefs ?? []).map((p) => p.user_id as string);
    const { data: activeUsers, error: recipientError } = preferenceIds.length
      ? await supabaseAdmin.from("users").select("id").eq("is_active", true).in("id", preferenceIds)
      : { data: [], error: null };
    if (recipientError) throw new Error(recipientError.message);
    const activeUserIds = (activeUsers ?? []).map((user) => user.id as string);
    const { data: memberships, error: membershipError } = activeUserIds.length
      ? await supabaseAdmin
          .from("organization_memberships")
          .select("user_id, school_id, is_active")
          .eq("school_id", schoolId)
          .eq("is_active", true)
          .in("user_id", activeUserIds)
      : { data: [], error: null };
    if (membershipError) throw new Error(membershipError.message);
    const targetIds = selectActiveMembershipRecipientIds(
      preferenceIds,
      activeUserIds,
      memberships ?? [],
      schoolId,
    );
    const prefsByUser = new Map(
      (prefs ?? []).map((pref) => [
        pref.user_id as string,
        pref as NotificationPreferences & {
          user_id: string;
          digest_frequency: string;
        },
      ]),
    );

    let sent = 0;
    for (const uid of targetIds) {
      const pref = prefsByUser.get(uid);
      if (!pref || isWithinQuietHours(pref.quiet_hours_start, pref.quiet_hours_end, utcMinuteOfDay))
        continue;

      const { data: rows, error: notificationsError } = await supabaseAdmin
        .from("notifications")
        .select("type, title, created_at, is_read")
        .eq("school_id", schoolId)
        .eq("user_id", uid)
        .eq("is_read", false)
        .gte("created_at", since)
        .neq("type", "digest")
        .order("created_at", { ascending: false })
        .limit(200);
      if (notificationsError) throw new Error(notificationsError.message);
      const list = filterDigestNotifications(rows ?? [], pref, utcMinuteOfDay);
      if (list.length < 2) continue; // digest only meaningful for ≥2 items

      const counts = list.reduce<Record<string, number>>((acc, r) => {
        const k = (r.type as string | null) ?? "other";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      const parts = Object.entries(counts)
        .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
        .join(", ");

      const { data: inserted, error } = await supabaseAdmin
        .from("notifications")
        .upsert(
          {
            school_id: schoolId,
            user_id: uid,
            idempotency_key: idempotencyKey,
            title: `Your ${data.frequency} summary`,
            message: `${list.length} new updates in the last ${hours}h — ${parts}.`,
            type: "digest",
            action_url: "/home/notifications",
            is_read: false,
          },
          {
            onConflict: "school_id,user_id,idempotency_key",
            ignoreDuplicates: true,
          },
        )
        .select("id");
      if (error) throw new Error(error.message);
      sent += (inserted ?? []).length;
    }

    await writeAuditRecord(supabase, {
      action: "notifications.digest.create",
      gate: "requireSchoolAdminScope",
      tenantId: schoolId,
      actorId: context.userId,
      table: "notifications",
      outcome: "succeeded",
      details: { frequency: data.frequency, eligibleUsers: targetIds.length, inserted: sent },
    });
    return { sent };
  });
