import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { createOfflineStore } from "@/lib/offline/indexeddb-store";
import { permittedNotificationLink } from "@/lib/shell/notification-links";
import { useAppShell } from "./shell-context";

type NotificationRow = {
  id: string;
  title: string | null;
  message: string;
  type: string | null;
  is_read: boolean | null;
  action_url: string | null;
  created_at: string | null;
};

type NotificationFilter = "all" | "unread" | "read";

export function NotificationCentre() {
  const app = useApp();
  const shell = useAppShell();
  const userId = app.profile?.id;
  const role = app.profile?.role;
  const schoolId = app.school?.id;
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (!userId || !schoolId || !role) {
        setRows([]);
        setLoading(false);
        setError(true);
        return;
      }
      setLoading(true);
      setError(false);
      const offline = createOfflineStore({ tenantId: schoolId, userId, role });
      const { data } = await offline.readThrough("messages", "notifications", async () => {
        const { data, error: loadError } = await supabase
          .from("notifications")
          .select("id, title, message, type, is_read, action_url, created_at")
          .eq("school_id", schoolId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100);
        if (loadError) throw loadError;
        return (data ?? []) as NotificationRow[];
      });
      setRows(data);
    } catch {
      setRows([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [role, schoolId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(
    () => rows.filter((row) => filter === "all" || Boolean(row.is_read) === (filter === "read")),
    [filter, rows],
  );
  const destinations = [...shell.nav, ...shell.drawer];

  async function markRead(row: NotificationRow) {
    if (!userId || !schoolId || row.is_read) return;
    setUpdating(row.id);
    try {
      const { error: updateError } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", row.id)
        .eq("school_id", schoolId)
        .eq("user_id", userId);
      if (updateError) {
        setError(true);
      } else {
        const nextRows = rows.map((item) =>
          item.id === row.id ? { ...item, is_read: true } : item,
        );
        setRows(nextRows);
        if (role) {
          await createOfflineStore({ tenantId: schoolId, userId, role })
            .write("messages", "notifications", nextRows)
            .catch(() => {});
        }
      }
    } catch {
      setError(true);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section
      className="app-shell-notification-centre"
      aria-labelledby="notification-centre-heading"
    >
      <div className="app-shell-section-title">
        <h2 id="notification-centre-heading">Notification centre</h2>
        <span>{rows.filter((row) => !row.is_read).length} unread</span>
      </div>
      <div
        className="app-shell-notification-filters"
        role="group"
        aria-label="Filter notifications"
      >
        {(["all", "unread", "read"] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={filter === value ? "is-active" : undefined}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "all" ? "All" : value === "unread" ? "Unread" : "Read"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="app-shell-empty" role="status">
          Loading notifications…
        </p>
      ) : null}
      {error ? (
        <p className="app-shell-empty" role="alert">
          Notifications could not be loaded or updated. Your account access was not changed.
          <button type="button" className="app-shell-link-button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      {!loading && !error && !visibleRows.length ? (
        <p className="app-shell-empty">No {filter === "all" ? "" : `${filter} `}notifications.</p>
      ) : null}
      <div className="app-shell-notification-list">
        {visibleRows.map((row) => {
          const href = permittedNotificationLink(row.action_url, destinations);
          const title = row.title?.trim() || row.type || "Notification";
          return (
            <article
              key={row.id}
              className={`app-shell-notification-card${row.is_read ? " is-read" : " is-unread"}`}
            >
              <div className="app-shell-notification-copy">
                <strong>{title}</strong>
                <p>{row.message}</p>
                <small>
                  {row.created_at ? new Date(row.created_at).toLocaleString() : "Time unavailable"}
                </small>
              </div>
              <div className="app-shell-notification-actions">
                {href ? <Link to={href as never}>Open</Link> : null}
                {!row.is_read ? (
                  <button
                    type="button"
                    disabled={updating === row.id}
                    onClick={() => void markRead(row)}
                  >
                    {updating === row.id ? "Saving…" : "Mark read"}
                  </button>
                ) : (
                  <span>Read</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
