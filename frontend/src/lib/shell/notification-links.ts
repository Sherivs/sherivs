export interface AllowedNotificationDestination {
  href: string;
  catalogTo: string;
}

export function permittedNotificationLink(
  actionUrl: string | null,
  destinations: readonly AllowedNotificationDestination[],
): string | null {
  if (!actionUrl || !actionUrl.startsWith("/") || actionUrl.startsWith("//")) return null;
  const allowed = destinations.find(
    (item) => item.href === actionUrl || item.catalogTo === actionUrl,
  );
  return allowed?.href ?? null;
}
