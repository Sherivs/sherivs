import type { PushCategory } from "@/lib/push/push-preferences.server";

type MessageOptions = {
  title?: string | null;
  body?: string | null;
  redacted?: boolean;
  safeguarding?: boolean;
};

function shouldUseGenericBody(options: MessageOptions, category: PushCategory): boolean {
  return (
    options.redacted === true ||
    options.safeguarding === true ||
    category === "fees" ||
    category === "grades"
  );
}

export function notificationBody(
  options: MessageOptions,
  category: PushCategory,
): { title: string; body: string } {
  if (shouldUseGenericBody(options, category)) {
    return {
      title: "Sherivs notification",
      body: "Open Sherivs to view this notification.",
    };
  }

  const fallbackBody = "You have a new notification in Sherivs.";
  return {
    title:
      typeof options.title === "string" && options.title.trim()
        ? options.title.trim()
        : "Sherivs notification",
    body:
      typeof options.body === "string" && options.body.trim() ? options.body.trim() : fallbackBody,
  };
}

export function androidChannelId(category: PushCategory): string {
  const map: Record<PushCategory, string> = {
    messages: "messages",
    announcements: "announcements",
    grades: "grades",
    attendance: "attendance",
    fees: "fees",
  };
  return map[category];
}
