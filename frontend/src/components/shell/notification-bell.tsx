/**
 * CoreGrid — platform shell: notifications bell (ADR-003 Option 1).
 *
 * Renders the notifications surface contract (`buildNotificationSurface`)
 * over records the session's server-resolved viewer context scopes. The bell
 * never renders raw store rows: admitting records, ordering and unread
 * counting all flow through the fail-closed contract.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type MouseEvent } from "react";
import { Bell, CheckCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import {
  buildNotificationSurface,
  type ShellNotificationRecord,
  type ShellNotificationViewer,
} from "@/lib/shell-notifications";

/** Raw row shape of the existing notification store the bell reads. */
interface NotificationRow {
  id: string;
  user_id: string;
  title: string | null;
  message: string;
  type: string | null;
  is_read: boolean | null;
  action_url: string | null;
  created_at: string;
  /** The store's tenant column — mapped to the contract's neutral tenantRef. */
  school_id: string;
}

function toRecord(row: NotificationRow): ShellNotificationRecord {
  return {
    id: row.id,
    recipientId: row.user_id,
    tenantRef: row.school_id,
    title: row.title,
    message: row.message,
    category: row.type,
    isRead: row.is_read ?? false,
    actionUrl: row.action_url,
    createdAt: row.created_at,
  };
}

function useShellNotificationSurface(viewer: ShellNotificationViewer | null, limit: number) {
  const query = useQuery<ShellNotificationRecord[]>({
    queryKey: ["shell-notification-surface", viewer?.tenantId, viewer?.recipientId],
    enabled: viewer !== null,
    queryFn: async () => {
      let request = supabase
        .from("notifications")
        .select(
          "id,user_id,title,message,type,is_read,action_url,created_at,school_id",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (viewer) {
        request = request
          .eq("user_id", viewer.recipientId)
          .eq("school_id", viewer.tenantId);
      }
      const { data, error } = await request;
      if (error) throw new Error(error.message);
      return ((data ?? []) as NotificationRow[]).map(toRecord);
    },
  });
  if (viewer === null) return null;
  return buildNotificationSurface(query.data ?? [], viewer, { limit });
}

export interface NotificationBellProps {
  /** Server-resolved viewer context; null renders an honest quiet bell. */
  readonly viewer: ShellNotificationViewer | null;
  /** Records are fetched through the surface contract; the cap keeps the menu honest. */
  readonly limit?: number;
}

export function NotificationBell({ viewer, limit = 10 }: NotificationBellProps) {
  const surface = useShellNotificationSurface(viewer, limit);
  const [marking, setMarking] = useState(false);
  const unread = surface?.unreadCount ?? 0;
  const items = surface?.items ?? [];

  async function markAllRead(event: MouseEvent) {
    event.preventDefault();
    if (!viewer || marking) return;
    setMarking(true);
    try {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", viewer.recipientId)
        .eq("school_id", viewer.tenantId)
        .eq("is_read", false);
    } finally {
      setMarking(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notifications
          </span>
          {unread > 0 && viewer && (
            <button
              type="button"
              onClick={markAllRead}
              disabled={marking}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <CheckCheck className="size-3" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nothing new right now.
            </p>
          ) : (
            items.map((item) => {
              const body = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{item.title}</span>
                    {!item.isRead && (
                      <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {item.message}
                  </span>
                </>
              );
              return item.actionUrl ? (
                <a
                  key={item.id}
                  href={item.actionUrl}
                  className="block rounded-md px-2 py-2 hover:bg-accent"
                >
                  {body}
                </a>
              ) : (
                <div key={item.id} className="rounded-md px-2 py-2">
                  {body}
                </div>
              );
            })
          )}
        </div>
        <div className="border-t border-border px-2 py-1.5">
          <a href="/notifications" className="block text-center text-xs text-primary hover:underline">
            View all
          </a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
