export type NotificationPreferenceCategory =
  "messages" | "announcements" | "grades" | "attendance" | "fees";

export type NotificationPreferences = {
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
} & Partial<Record<`inapp_${NotificationPreferenceCategory}`, boolean>>;

export const MANDATORY_NOTIFICATION_TYPES = ["security", "emergency"] as const;

const DIGEST_CATEGORIES: Readonly<Record<string, NotificationPreferenceCategory>> = {
  message: "messages",
  new_message: "messages",
  announcement: "announcements",
  calendar_event: "announcements",
  grades_published: "grades",
  attendance: "attendance",
  attendance_absent: "attendance",
  attendance_late: "attendance",
  fees_due: "fees",
};

export function isMandatoryNotificationType(type: string | null): boolean {
  return MANDATORY_NOTIFICATION_TYPES.includes(
    type as (typeof MANDATORY_NOTIFICATION_TYPES)[number],
  );
}

export function notificationPreferenceCategory(
  type: string | null,
): NotificationPreferenceCategory | null {
  return type ? (DIGEST_CATEGORIES[type] ?? null) : null;
}

export function isWithinQuietHours(
  start: string | null | undefined,
  end: string | null | undefined,
  utcMinuteOfDay: number,
): boolean {
  if (
    !start ||
    !end ||
    !Number.isInteger(utcMinuteOfDay) ||
    utcMinuteOfDay < 0 ||
    utcMinuteOfDay >= 1440
  )
    return false;

  const toMinutes = (value: string) => {
    const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
  };
  const startMinute = toMinutes(start);
  const endMinute = toMinutes(end);
  if (startMinute === null || endMinute === null || startMinute === endMinute) return false;

  return startMinute < endMinute
    ? utcMinuteOfDay >= startMinute && utcMinuteOfDay < endMinute
    : utcMinuteOfDay >= startMinute || utcMinuteOfDay < endMinute;
}

export function shouldDeliverInAppNotification(
  type: string | null,
  category: NotificationPreferenceCategory,
  preferences: NotificationPreferences | undefined,
  utcMinuteOfDay: number,
): boolean {
  if (isMandatoryNotificationType(type)) return true;
  if (!preferences) return true;
  if (preferences[`inapp_${category}`] === false) return false;
  return !isWithinQuietHours(
    preferences.quiet_hours_start,
    preferences.quiet_hours_end,
    utcMinuteOfDay,
  );
}

export function digestWindowKey(frequency: "daily" | "weekly", atMs: number): string {
  const date = new Date(atMs);
  if (frequency === "daily") return date.toISOString().slice(0, 10);

  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function filterDigestNotifications<T extends { type: string | null }>(
  notifications: readonly T[],
  preferences: NotificationPreferences | undefined,
  utcMinuteOfDay: number,
): T[] {
  return notifications.filter((notification) => {
    const category = notificationPreferenceCategory(notification.type);
    return (
      category !== null &&
      !isMandatoryNotificationType(notification.type) &&
      shouldDeliverInAppNotification(notification.type, category, preferences, utcMinuteOfDay)
    );
  });
}
