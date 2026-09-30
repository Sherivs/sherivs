import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  SectionGrid,
  StatCard,
  PortalPagination,
  usePagination,
} from "@/components/portal-shell";
import { PushNotificationCard } from "@/components/push-notification-card";

export const Route = createFileRoute("/_authenticated/notifications")({
  ssr: false,
  component: NotificationsPage,
});

type Notif = {
  id: string;
  title: string | null;
  message: string;
  type: string | null;
  is_read: boolean | null;
  action_url: string | null;
  created_at: string;
};

type Prefs = {
  user_id: string;
  school_id: string;
  email_messages: boolean;
  email_announcements: boolean;
  email_grades: boolean;
  email_attendance: boolean;
  email_fees: boolean;
  inapp_messages: boolean;
  inapp_announcements: boolean;
  inapp_grades: boolean;
  inapp_attendance: boolean;
  inapp_fees: boolean;
  digest_frequency: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
};

const CATS: Array<{
  key: "messages" | "announcements" | "grades" | "attendance" | "fees";
  label: string;
  hint: string;
}> = [
  { key: "messages", label: "Messages", hint: "Direct messages from staff or parents" },
  { key: "announcements", label: "Announcements", hint: "School news and updates" },
  { key: "grades", label: "Grades & report cards", hint: "When new grades are published" },
  { key: "attendance", label: "Attendance", hint: "Daily attendance summaries and alerts" },
  { key: "fees", label: "Fees & invoices", hint: "Invoices, receipts and reminders" },
];

function NotificationsPage() {
  const { school, authUser, profile } = useApp();
  const qc = useQueryClient();
  const schoolId = school?.id;
  const me = authUser?.id;
  const [tab, setTab] = useState<"feed" | "prefs">("feed");

  const list = useQuery<Notif[]>({
    queryKey: ["notifications", schoolId, me],
    enabled: !!schoolId && !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,title,message,type,is_read,action_url,created_at")
        .eq("school_id", schoolId!)
        .eq("user_id", me!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Notif[];
    },
  });

  useEffect(() => {
    if (!schoolId || !me) return;
    const channel = supabase
      .channel("notifications-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${me}` },
        () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schoolId, me, qc]);

  const unread = (list.data ?? []).filter((n) => !n.is_read).length;

  async function markAll() {
    if (!me || !schoolId) return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", me)
      .eq("school_id", schoolId)
      .eq("is_read", false);
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markOne(id: string) {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <PortalPage title="Notifications" subtitle={`Signed in as ${profile?.full_name ?? "—"}`}>
      <SectionGrid>
        <StatCard label="Total" value={list.data?.length ?? 0} />
        <StatCard label="Unread" value={unread} />
        <StatCard label="School" value={school?.name ?? "—"} />
      </SectionGrid>

      <div className="mt-6">
        <PushNotificationCard />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("feed")}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
              tab === "feed" ? "bg-primary text-primary-foreground" : "border border-border"
            }`}
          >
            <Bell className="size-4" /> Feed
            {unread > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">
                {unread}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("prefs")}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
              tab === "prefs" ? "bg-primary text-primary-foreground" : "border border-border"
            }`}
          >
            <SettingsIcon className="size-4" /> Preferences
          </button>
        </div>
        {tab === "feed" && unread > 0 && (
          <button onClick={markAll} className="rounded-md border border-border px-3 py-1.5 text-sm">
            Mark all read
          </button>
        )}
      </div>

      {tab === "feed" ? (
        <NotificationsFeed loading={list.isLoading} items={list.data ?? []} onMarkOne={markOne} />
      ) : (
        <PrefsPanel schoolId={schoolId!} userId={me!} />
      )}
    </PortalPage>
  );
}

function NotificationsFeed({
  loading,
  items,
  onMarkOne,
}: {
  loading: boolean;
  items: Notif[];
  onMarkOne: (id: string) => void;
}) {
  const { page, pageCount, pageItems } = usePagination(items, 20);
  if (loading) {
    return <div className="uos-card mt-4 p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="uos-card mt-4 p-6 text-sm text-muted-foreground">No notifications yet.</div>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      <div className="uos-card divide-y divide-border">
        {pageItems.map((n) => (
          <article
            key={n.id}
            className={`flex items-start gap-3 p-4 ${
              !n.is_read ? "border-l-2 border-primary bg-muted/20" : ""
            }`}
          >
            <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate font-semibold">{n.title || (n.type ?? "Notification")}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-sm">{n.message}</p>
              <div className="mt-2 flex items-center gap-3">
                {n.action_url && (
                  <a
                    href={n.action_url}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Open
                  </a>
                )}
                {!n.is_read && (
                  <button
                    onClick={() => onMarkOne(n.id)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Check className="size-3" /> Mark read
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      <PortalPagination page={page} pageCount={pageCount} />
    </div>
  );
}

function PrefsPanel({ schoolId, userId }: { schoolId: string; userId: string }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const q = useQuery<Prefs | null>({
    queryKey: ["notif-prefs", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Prefs | null;
    },
  });

  const [draft, setDraft] = useState<Prefs | null>(null);
  useEffect(() => {
    if (q.data) setDraft(q.data);
    else if (q.isSuccess && !q.data)
      setDraft({
        user_id: userId,
        school_id: schoolId,
        email_messages: true,
        email_announcements: true,
        email_grades: true,
        email_attendance: true,
        email_fees: true,
        inapp_messages: true,
        inapp_announcements: true,
        inapp_grades: true,
        inapp_attendance: true,
        inapp_fees: true,
        digest_frequency: "instant",
        quiet_hours_start: null,
        quiet_hours_end: null,
      });
  }, [q.data, q.isSuccess, userId, schoolId]);

  if (!draft) {
    return <p className="mt-4 text-sm text-muted-foreground">Loading preferences…</p>;
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert(draft!, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      setStatus(error.message);
    } else {
      setStatus("Saved");
      void qc.invalidateQueries({ queryKey: ["notif-prefs"] });
    }
  }

  return (
    <div className="uos-card mt-4 p-6">
      <header className="mb-4">
        <h2 className="font-display text-lg font-semibold">Notification preferences</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which categories deliver in-app and which also send email.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium">In-app</th>
              <th className="py-2 pr-4 font-medium">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {CATS.map((c) => {
              const inappKey = `inapp_${c.key}` as keyof Prefs;
              const emailKey = `email_${c.key}` as keyof Prefs;
              return (
                <tr key={c.key}>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">{c.hint}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <input
                      type="checkbox"
                      checked={Boolean(draft[inappKey])}
                      onChange={(e) =>
                        setDraft({ ...draft, [inappKey]: e.target.checked } as Prefs)
                      }
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <input
                      type="checkbox"
                      checked={Boolean(draft[emailKey])}
                      onChange={(e) =>
                        setDraft({ ...draft, [emailKey]: e.target.checked } as Prefs)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Email digest
          </label>
          <select
            value={draft.digest_frequency}
            onChange={(e) => setDraft({ ...draft, digest_frequency: e.target.value })}
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="instant">Instant — send each email as it happens</option>
            <option value="daily">Daily — one email per day</option>
            <option value="weekly">Weekly — one email per week</option>
            <option value="off">Off — no emails (in-app only)</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Quiet hours
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Emails inside this window are held until later.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="time"
              value={draft.quiet_hours_start ?? ""}
              onChange={(e) => setDraft({ ...draft, quiet_hours_start: e.target.value || null })}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="time"
              value={draft.quiet_hours_end ?? ""}
              onChange={(e) => setDraft({ ...draft, quiet_hours_end: e.target.value || null })}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            {(draft.quiet_hours_start || draft.quiet_hours_end) && (
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...draft, quiet_hours_start: null, quiet_hours_end: null })
                }
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </div>

      {status && (
        <p className={`mt-3 text-xs ${status === "Saved" ? "text-emerald-400" : "text-rose-400"}`}>
          {status}
        </p>
      )}
    </div>
  );
}
