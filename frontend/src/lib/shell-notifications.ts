/**
 * CoreGrid — platform shell notifications surface contract (ADR-003, GAP-008).
 *
 * The bell in the global shell renders from THIS contract, never from raw
 * store rows: records are admitted only when they match the viewer context
 * the session resolution produced. The viewer context is server-resolved
 * session data — it is never accepted from client storage (AGENTS §26, §34);
 * anything that does not match the resolved context is withheld, never shown.
 *
 * The surface is a read model: marking read belongs to the store contract the
 * record source already implements. This module stays pure — no I/O, no
 * provider imports.
 */
export interface ShellNotificationViewer {
  /** Tenant the session resolution established for the viewer. */
  readonly tenantId: string;
  /** Recipient the session resolution established for the viewer. */
  readonly recipientId: string;
}

/** One notification record as the shell's source supplies it. */
export interface ShellNotificationRecord {
  readonly id: string;
  /** Recipient the record targets (resolved server-side at creation). */
  readonly recipientId: string;
  /** Tenant the record belongs to; null when the source does not expose it. */
  readonly tenantRef: string | null;
  readonly title: string | null;
  readonly message: string;
  readonly category: string | null;
  readonly isRead: boolean;
  readonly actionUrl: string | null;
  readonly createdAt: string;
}

export interface ShellNotificationItem {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly isRead: boolean;
  readonly actionUrl: string | null;
  readonly createdAt: string;
}

export interface ShellNotificationSurface {
  /** Admitted records, newest first, capped at the requested limit. */
  readonly items: readonly ShellNotificationItem[];
  readonly unreadCount: number;
  /** Records withheld by the fail-closed viewer/tenant check (audit visible). */
  readonly withheldCount: number;
}

export interface ShellNotificationSurfaceOptions {
  /** Maximum admitted items to return (default 10). */
  readonly limit?: number;
}

function admittedToItem(record: ShellNotificationRecord): ShellNotificationItem {
  return {
    id: record.id,
    title: record.title ?? record.category ?? "Notification",
    message: record.message,
    isRead: record.isRead,
    actionUrl: record.actionUrl,
    createdAt: record.createdAt,
  };
}

/**
 * Build the bell's read model: admit only records matching the resolved
 * viewer context (recipient always; tenant whenever the record carries one),
 * order newest first, and count what was withheld so nothing disappears
 * silently.
 */
export function buildNotificationSurface(
  records: readonly ShellNotificationRecord[],
  viewer: ShellNotificationViewer,
  options?: ShellNotificationSurfaceOptions,
): ShellNotificationSurface {
  const limit = options?.limit ?? 10;
  let withheldCount = 0;

  const admitted = records.filter((record) => {
    const recipientMatches = record.recipientId === viewer.recipientId;
    const tenantMatches = record.tenantRef === null || record.tenantRef === viewer.tenantId;
    if (recipientMatches && tenantMatches) return true;
    withheldCount += 1;
    return false;
  });

  const items = admitted
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(0, limit))
    .map(admittedToItem);

  return {
    items,
    unreadCount: admitted.filter((record) => !record.isRead).length,
    withheldCount,
  };
}
