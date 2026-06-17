"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

export interface DataTableColumn<T> {
  /** Stable id — used for sort state and React keys. */
  id: string;
  /** Column header text or node. */
  header: React.ReactNode;
  /** Cell renderer. Return a React node or string. */
  cell: (row: T) => React.ReactNode;
  /** Allow the user to click the header to sort by this column. Requires
   *  `accessor` (or you can handle server-side sorting via `onSortChange`). */
  sortable?: boolean;
  /** Value used for client-side sorting. Defaults to `cell(row)` coerced to
   *  a primitive — prefer passing an explicit accessor for dates, numbers. */
  accessor?: (row: T) => string | number | Date | null | undefined;
  /** Horizontal alignment in both head and cell. Defaults to "left". */
  align?: "left" | "right" | "center";
  /** Optional CSS width (e.g. "12rem" or "10%"). */
  width?: string;
  /** ClassName applied to every cell in this column. */
  className?: string;
  /** When `mobileMode="cards"` is set, hide this column from the mobile card
   *  layout. Has no effect on the desktop table. */
  mobileHidden?: boolean;
  /** When `mobileMode="cards"`, this column's cell renders as the card title.
   *  At most one column should be marked primary. */
  primary?: boolean;
  /** When `mobileMode="cards"`, this column's cell renders as the card meta
   *  line below the title. At most one column should be marked secondary. */
  secondary?: boolean;
}

export interface DataTableSortState {
  id: string;
  dir: "asc" | "desc";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  /** Stable row key — required. */
  getRowId: (row: T) => string;
  /** Render a link for each row. When set, the row is a clickable <Link>. */
  getRowHref?: (row: T) => string | undefined;
  /** Called when the row itself is clicked. Ignored if `getRowHref` is set. */
  onRowClick?: (row: T) => void;
  /** Render extra action buttons at the end of each row. */
  rowActions?: (row: T) => React.ReactNode;
  /** Show a loading skeleton while `data === undefined`. */
  isLoading?: boolean;
  /** Empty state when `data.length === 0`. Defaults to a muted message. */
  empty?: React.ReactNode;
  /** Controlled sort. Omit for uncontrolled client-side sorting. */
  sort?: DataTableSortState | null;
  onSortChange?: (sort: DataTableSortState | null) => void;
  /** Extra class on the outer wrapper. */
  className?: string;
  /** Make the header sticky to the nearest scrolling ancestor. The caller
   *  is responsible for the scroll container. */
  stickyHeader?: boolean;
  /** Fill the parent's available height: the table renders inside a bordered
   *  card whose body scrolls (with a sticky header) while the card itself
   *  flexes to `flex-1`. Use under a `<PageShell full>` so the page never
   *  scrolls — only the table body does. Implies `stickyHeader`. */
  fillHeight?: boolean;
  /** Enable built-in client-side pagination over the (already-fetched) rows.
   *  Renders a `<DataTablePagination>` footer pinned below the table body.
   *  Set to the number of rows per page. */
  pageSize?: number;
  /** Row-count options offered in the pagination footer's "Rows per page"
   *  control. Omit to hide the selector. */
  pageSizeOptions?: number[];
  /** Label shown in the pagination footer when there are no rows. */
  paginationEmptyLabel?: string;
  /** Mobile rendering strategy below the `md` breakpoint.
   *  - `"scroll"` (default): keep the table; rely on horizontal scroll.
   *  - `"cards"`: stack one card per row, using `primary`/`secondary`/
   *    `mobileHidden` column metadata for layout. */
  mobileMode?: "scroll" | "cards";
  /** Mobile only: tap handler that fires INSTEAD of `getRowHref` /
   *  `onRowClick` when `mobileMode="cards"`. Use to open a
   *  `<MobileDetailSheet>` in-place instead of pushing a route. Has no
   *  effect on desktop or when `mobileMode !== "cards"`. */
  onMobileRowOpen?: (row: T) => void;
  /** Mobile only escape hatch — render a fully custom card body for
   *  each row when the column-driven layout doesn't fit (e.g. media
   *  rows, multi-line aggregates). Skips `primary`/`secondary` /
   *  `mobileHidden` and `rowActions` — caller owns the layout. */
  mobileRender?: (row: T) => React.ReactNode;
}

const ALIGN_CLASSES = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function DataTable<T>({
  columns,
  data,
  getRowId,
  getRowHref,
  onRowClick,
  rowActions,
  isLoading,
  empty,
  sort: controlledSort,
  onSortChange,
  className,
  stickyHeader,
  fillHeight,
  pageSize,
  pageSizeOptions,
  paginationEmptyLabel,
  mobileMode = "scroll",
  onMobileRowOpen,
  mobileRender,
}: DataTableProps<T>) {
  const [uncontrolledSort, setUncontrolledSort] = React.useState<DataTableSortState | null>(null);
  const sort = controlledSort !== undefined ? controlledSort : uncontrolledSort;
  const setSort = onSortChange ?? setUncontrolledSort;

  const paginated = typeof pageSize === "number" && pageSize > 0;
  const [page, setPage] = React.useState(1);
  const [currentPageSize, setCurrentPageSize] = React.useState(pageSize ?? 25);
  React.useEffect(() => {
    if (typeof pageSize === "number" && pageSize > 0) setCurrentPageSize(pageSize);
  }, [pageSize]);

  const effectiveSticky = stickyHeader || fillHeight;

  const columnsWithActions = React.useMemo(() => {
    if (!rowActions) return columns;
    const actionsCol: DataTableColumn<T> = {
      id: "__actions",
      header: <span className="sr-only">Actions</span>,
      cell: (row) => rowActions(row),
      align: "right",
      width: "1%",
      className: "whitespace-nowrap",
    };
    return [...columns, actionsCol];
  }, [columns, rowActions]);

  const sortedData = React.useMemo(() => {
    if (!data || !sort || onSortChange) return data;
    const col = columns.find((c) => c.id === sort.id);
    if (!col) return data;
    const get = col.accessor ?? ((row: T) => String(col.cell(row)));
    const copy = [...data];
    copy.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va instanceof Date && vb instanceof Date) return va.getTime() - vb.getTime();
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb));
    });
    if (sort.dir === "desc") copy.reverse();
    return copy;
  }, [data, sort, columns, onSortChange]);

  const totalCount = sortedData?.length ?? 0;
  const pageCount = paginated ? Math.max(1, Math.ceil(totalCount / currentPageSize)) : 1;
  const safePage = Math.min(page, pageCount);
  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const visibleData = React.useMemo(() => {
    if (!paginated || !sortedData) return sortedData;
    const start = (safePage - 1) * currentPageSize;
    return sortedData.slice(start, start + currentPageSize);
  }, [paginated, sortedData, safePage, currentPageSize]);

  function toggleSort(id: string) {
    if (sort?.id === id) {
      if (sort.dir === "asc") setSort({ id, dir: "desc" });
      else setSort(null);
    } else {
      setSort({ id, dir: "asc" });
    }
  }

  const tableEl = (
    <Table wrapperClassName={effectiveSticky ? "overflow-visible" : undefined}>
      <TableHeader className={effectiveSticky ? "sticky top-0 z-10" : undefined}>
        <TableRow>
          {columnsWithActions.map((col) => {
            const isSorted = sort?.id === col.id;
            const align = ALIGN_CLASSES[col.align ?? "left"];
            return (
              <TableHead
                key={col.id}
                style={col.width ? { width: col.width } : undefined}
                className={cn(align, col.className)}
              >
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.id)}
                    className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {col.header}
                    {isSorted ? (
                      sort.dir === "asc" ? (
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                      )
                    ) : (
                      <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading || data === undefined ? (
          <SkeletonRows columns={columnsWithActions.length} />
        ) : visibleData && visibleData.length > 0 ? (
          visibleData.map((row) => {
            const href = getRowHref?.(row);
            const clickable = href || onRowClick;
            return (
              <TableRow
                key={getRowId(row)}
                className={clickable ? "cursor-pointer" : undefined}
                onClick={onRowClick && !href ? () => onRowClick(row) : undefined}
              >
                {columnsWithActions.map((col) => {
                  const content = col.cell(row);
                  const align = ALIGN_CLASSES[col.align ?? "left"];
                  const body =
                    href && col.id !== "__actions" ? (
                      <Link
                        href={href}
                        className="block -mx-3 -my-3 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    );
                  return (
                    <TableCell key={col.id} className={cn(align, col.className)}>
                      {body}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={columnsWithActions.length} className="py-10 text-center text-muted-foreground">
              {empty ?? "No results."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const footer =
    paginated && data !== undefined && !isLoading ? (
      <div className="shrink-0 border-t px-3 py-2.5 sm:px-4">
        <DataTablePagination
          page={safePage}
          pageSize={currentPageSize}
          totalCount={totalCount}
          pageCount={pageCount}
          onPageChange={setPage}
          onPageSizeChange={
            pageSizeOptions
              ? (next) => {
                  setCurrentPageSize(next);
                  setPage(1);
                }
              : undefined
          }
          pageSizeOptions={pageSizeOptions}
          emptyLabel={paginationEmptyLabel ?? "No results"}
        />
      </div>
    ) : null;

  const wrapperClasses = cn(
    "rounded-md border bg-card text-card-foreground shadow-sm",
    stickyHeader ? "overflow-auto" : "overflow-hidden",
    className,
  );

  if (mobileMode !== "cards") {
    // Fill-height and/or paginated: wrap the table body in a scrolling region
    // and pin the pagination footer beneath it inside one bordered card.
    if (fillHeight || footer) {
      return (
        <div
          className={cn(
            "flex flex-col overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm",
            fillHeight && "min-h-0 flex-1",
            className,
          )}
        >
          <div className={fillHeight ? "min-h-0 flex-1 overflow-auto" : "overflow-auto"}>
            {tableEl}
          </div>
          {footer}
        </div>
      );
    }
    return <div className={wrapperClasses}>{tableEl}</div>;
  }

  return (
    <>
      <div className={cn(wrapperClasses, "hidden md:block")}>
        {fillHeight || footer ? (
          <div className="flex flex-col">
            <div className="overflow-auto">{tableEl}</div>
            {footer}
          </div>
        ) : (
          tableEl
        )}
      </div>
      <div className="md:hidden">
        <MobileCardList
          columns={columns}
          data={visibleData}
          isLoading={isLoading}
          empty={empty}
          getRowId={getRowId}
          getRowHref={onMobileRowOpen ? undefined : getRowHref}
          onRowClick={onMobileRowOpen ?? onRowClick}
          rowActions={rowActions}
          mobileRender={mobileRender}
          className={className}
        />
        {footer}
      </div>
    </>
  );
}

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columns }).map((__, j) => (
            <TableCell key={j}>
              <div className="h-4 w-full max-w-[12rem] animate-pulse rounded bg-muted" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

interface MobileCardListProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  isLoading?: boolean;
  empty?: React.ReactNode;
  getRowId: (row: T) => string;
  getRowHref?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  mobileRender?: (row: T) => React.ReactNode;
  className?: string;
}

function MobileCardList<T>({
  columns,
  data,
  isLoading,
  empty,
  getRowId,
  getRowHref,
  onRowClick,
  rowActions,
  mobileRender,
  className,
}: MobileCardListProps<T>) {
  const primary = columns.find((c) => c.primary);
  const secondary = columns.find((c) => c.secondary);
  const detailColumns = columns.filter(
    (c) => !c.primary && !c.secondary && !c.mobileHidden,
  );

  if (isLoading || data === undefined) {
    return (
      <div className={cn("space-y-3", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-md border bg-card shadow-sm"
          />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border bg-card py-10 text-center text-muted-foreground shadow-sm",
          className,
        )}
      >
        {empty ?? "No results."}
      </div>
    );
  }

  return (
    <ul className={cn("space-y-3", className)}>
      {data.map((row) => {
        const href = getRowHref?.(row);
        const actions = rowActions?.(row);
        const customBody = mobileRender?.(row);

        const cardBody = customBody ? (
          <div className="p-4">{customBody}</div>
        ) : (() => {
          const titleNode = primary ? primary.cell(row) : null;
          const subtitleNode = secondary ? secondary.cell(row) : null;
          return (
            <div className="space-y-3 p-4">
              <div className={cn("min-w-0 space-y-1", actions && "pr-12")}>
                {titleNode ? (
                  <div className="text-body font-semibold text-foreground break-words">
                    {titleNode}
                  </div>
                ) : null}
                {subtitleNode ? (
                  <div className="text-caption text-muted-foreground break-words">
                    {subtitleNode}
                  </div>
                ) : null}
              </div>
              {detailColumns.length > 0 ? (
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-caption sm:grid-cols-2">
                  {detailColumns.map((col) => {
                    const value = col.cell(row);
                    if (value === null || value === undefined || value === false) {
                      return null;
                    }
                    return (
                      <div
                        key={col.id}
                        className="flex flex-col gap-0.5 min-w-0"
                      >
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          {col.header}
                        </dt>
                        <dd className="text-body text-foreground break-words">
                          {value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : null}
            </div>
          );
        })();

        const interactive = Boolean(href || onRowClick);

        return (
          <li
            key={getRowId(row)}
            className={cn(
              "relative rounded-md border bg-card text-card-foreground shadow-sm",
              interactive && "transition-colors hover:bg-muted/40",
            )}
          >
            {href ? (
              <Link
                href={href}
                className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {cardBody}
              </Link>
            ) : onRowClick ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => onRowClick(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }}
                className="block w-full cursor-pointer rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {cardBody}
              </div>
            ) : (
              cardBody
            )}
            {actions && !customBody ? (
              <div
                className="absolute right-4 top-4 z-10"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                {actions}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
