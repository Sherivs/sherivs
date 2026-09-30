import type { ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export type ResponsiveColumn<T> = {
  /** Header label. */
  header: ReactNode;
  /** Cell renderer for the row. */
  cell: (row: T) => ReactNode;
  /** Optional class for the header + cell (e.g. text-right, hidden md:table-cell). */
  className?: string;
  /** Optional key used for React lists. Defaults to header string. */
  key?: string;
};

export type ResponsiveTableProps<T> = {
  columns: ResponsiveColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  /** Renders a card-shaped row on mobile (< 640px). */
  mobileCard: (row: T) => ReactNode;
  /** Optional row click handler. */
  onRowClick?: (row: T) => void;
  /** Optional empty-state renderer. */
  emptyState?: ReactNode;
  /** Optional table caption for a11y. */
  caption?: string;
  /** Minimum table width on desktop to force horizontal scroll before columns collapse. */
  minWidth?: number | string;
  className?: string;
};

/**
 * ResponsiveTable — table on ≥sm, stacked card list on mobile.
 * The same data is rendered in both views; on mobile we hand off to `mobileCard`
 * so each row becomes a full-width, touch-friendly card.
 */
export function ResponsiveTable<T>({
  columns,
  data,
  rowKey,
  mobileCard,
  onRowClick,
  emptyState,
  caption,
  minWidth = 640,
  className,
}: ResponsiveTableProps<T>) {
  const isMobile = useMediaQuery("(max-width: 639px)");

  if (data.length === 0) {
    return (
      <>
        {emptyState ?? <p className="text-sm text-muted-foreground py-6 text-center">No data.</p>}
      </>
    );
  }

  if (isMobile) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {data.map((row) => (
          <div
            key={rowKey(row)}
            className={cn(
              "uos-card p-3 min-w-0",
              onRowClick && "cursor-pointer active:opacity-80 transition-opacity",
            )}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? "button" : undefined}
            tabIndex={onRowClick ? 0 : undefined}
          >
            {mobileCard(row)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("uos-scroll-x -mx-2 sm:mx-0", className)}>
      <table className="w-full text-sm" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="text-left text-xs text-muted-foreground border-b border-border">
          <tr>
            {columns.map((c, i) => (
              <th key={c.key ?? i} className={cn("p-2 font-medium", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                "border-b border-border/50",
                onRowClick && "cursor-pointer hover:bg-white/[0.03]",
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c, i) => (
                <td key={c.key ?? i} className={cn("p-2 py-3", c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
