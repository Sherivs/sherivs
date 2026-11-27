export type PushCategory = "messages" | "announcements" | "grades" | "attendance" | "fees";

export type NotificationPreferenceRow = {
  user_id: string;
  push_messages?: boolean | null;
  push_announcements?: boolean | null;
  push_grades?: boolean | null;
  push_attendance?: boolean | null;
  push_fees?: boolean | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string | null;
};

const CATEGORY_COLUMN: Record<PushCategory, keyof NotificationPreferenceRow> = {
  messages: "push_messages",
  announcements: "push_announcements",
  grades: "push_grades",
  attendance: "push_attendance",
  fees: "push_fees",
};

export const DEFAULT_PUSH_TIMEZONE = "Africa/Lagos";

function parseMinutes(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== "string") return null;
  const match = raw.trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function localMinute(nowMs: number, timezone: string): number {
  const read = (zone: string) => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone,
    });
    const parts = fmt.formatToParts(new Date(nowMs));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  };

  try {
    return read(timezone);
  } catch {
    return read(DEFAULT_PUSH_TIMEZONE);
  }
}

export function isWithinQuietHours(input: {
  quietStart: string | null | undefined;
  quietEnd: string | null | undefined;
  timezone: string | null | undefined;
  nowMs: number;
}): boolean {
  const start = parseMinutes(input.quietStart);
  const end = parseMinutes(input.quietEnd);
  if (start === null || end === null || start === end) return false;

  const minute = localMinute(input.nowMs, input.timezone?.trim() || DEFAULT_PUSH_TIMEZONE);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function canSendPushNow(
  row: NotificationPreferenceRow | undefined,
  category: PushCategory,
  nowMs: number,
): boolean {
  if (!row) return true;
  const column = CATEGORY_COLUMN[category];
  if (row[column] === false) return false;
  return !isWithinQuietHours({
    quietStart: row.quiet_hours_start ?? null,
    quietEnd: row.quiet_hours_end ?? null,
    timezone: row.timezone ?? DEFAULT_PUSH_TIMEZONE,
    nowMs,
  });
}
