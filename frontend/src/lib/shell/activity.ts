import { appShellSectionPath } from "./paths";
import type { CardData } from "@/lib/sherivs-ws/live";

export interface ShellActivityItem {
  key: string;
  title: string;
  detail: string;
  icon: string;
  href: string;
}

/**
 * Role activity is derived from the live widget payload and inbox catalog.
 * Never invented: no Digital Twin rows, no fake timestamps.
 */
export function composeActivity(input: {
  inbox: readonly { key: string; label: string; icon: string }[];
  widgets?: readonly { key: string; label: string; icon: string }[];
  cards: Record<string, CardData>;
}): ShellActivityItem[] {
  const fromLists: ShellActivityItem[] = [];
  for (const widget of input.widgets ?? []) {
    const rows = input.cards[widget.key]?.list ?? [];
    for (const [title, detail] of rows.slice(0, 3)) {
      fromLists.push({
        key: `${widget.key}:${title}`,
        title,
        detail,
        icon: widget.icon,
        href: appShellSectionPath(widget.key),
      });
    }
  }
  if (fromLists.length) return fromLists.slice(0, 6);
  return input.inbox.slice(0, 6).map((item) => ({
    key: item.key,
    title: item.label,
    detail: "Enabled for this role",
    icon: item.icon,
    href: appShellSectionPath(item.key),
  }));
}
