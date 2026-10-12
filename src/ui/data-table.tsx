import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { EmptyState } from "./empty-state";

export interface Column<Row> {
  /** Stable key for React. */
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Hide this column below a breakpoint so phones see the essentials only. */
  hideBelow?: "sm" | "md" | "lg";
  /** Extra classes for the th and td (e.g. a width: "w-40"). */
  className?: string;
}

const hideClasses = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;
const alignClasses = { left: "text-left", right: "text-right", center: "text-center" } as const;

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  /**
   * Makes each row navigable: the FIRST column's content becomes the link and its hit area
   * stretches over the whole row. Buttons/links in other cells need `relative z-10`.
   */
  rowHref?: (row: Row) => string | null;
  /** Rendered instead of the table when there are no rows. */
  empty?: ReactNode;
  caption?: string;
  /** Tighter rows for long lists. */
  dense?: boolean;
  /** Render without the outer border/radius (e.g. inside a Card with padding="none"). */
  bare?: boolean;
  /** Optional totals row(s) rendered in <tfoot>. */
  footer?: ReactNode;
  className?: string;
}

/**
 * A simple, accessible table. Server-compatible: pass `cell` renderers from a server
 * component. Scrolls horizontally on narrow screens; use `hideBelow` for secondary columns.
 */
export function DataTable<Row>({ columns, rows, rowKey, rowHref, empty, caption, dense = false, bare = false, footer, className }: DataTableProps<Row>) {
  if (rows.length === 0) {
    const fallback = empty ?? <EmptyState title="Nothing here yet" compact />;
    return bare ? <>{fallback}</> : <div className={cn("rounded-xl border border-line bg-surface shadow-card", className)}>{fallback}</div>;
  }
  const cellPad = dense ? "px-3 py-2" : "px-4 py-3";
  return (
    <div className={cn("min-w-0 overflow-x-auto", !bare && "rounded-xl border border-line bg-surface shadow-card", className)}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-surface-muted">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  cellPad,
                  "text-xs font-medium tracking-wide whitespace-nowrap text-ink-subtle uppercase",
                  alignClasses[col.align ?? "left"],
                  col.hideBelow && hideClasses[col.hideBelow],
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, index) => {
            const href = rowHref?.(row) ?? null;
            return (
              <tr key={rowKey(row, index)} className={cn("align-top", href && "relative transition-colors hover:bg-surface-muted")}>
                {columns.map((col, colIndex) => {
                  const content = col.cell(row, index);
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        cellPad,
                        "text-ink",
                        alignClasses[col.align ?? "left"],
                        col.align === "right" && "numeric whitespace-nowrap",
                        col.hideBelow && hideClasses[col.hideBelow],
                        col.className,
                      )}
                    >
                      {href && colIndex === 0 ? (
                        <Link href={href} className="font-medium text-ink after:absolute after:inset-0 hover:text-accent focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot className="border-t border-line-strong bg-surface-muted font-medium">{footer}</tfoot>}
      </table>
    </div>
  );
}
