"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowData,
  type SortingState,
  type TableOptions,
  type VisibilityState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headClassName?: string
    cellClassName?: string
    align?: "left" | "right" | "center"
    label?: React.ReactNode
  }
}

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  loading?: boolean
  loadingLabel?: React.ReactNode
  emptyLabel?: React.ReactNode
  noResultsLabel?: React.ReactNode
  initialSorting?: SortingState
  initialColumnFilters?: ColumnFiltersState
  initialColumnVisibility?: VisibilityState
  initialGlobalFilter?: string
  searchColumnId?: string
  searchPlaceholder?: string
  searchAriaLabel?: string
  className?: string
  tableOptions?: Partial<TableOptions<TData>>
  getRowId?: (row: TData, index: number) => string
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading,
  loadingLabel,
  emptyLabel,
  noResultsLabel,
  initialSorting,
  initialColumnFilters,
  initialColumnVisibility,
  initialGlobalFilter,
  searchColumnId,
  searchPlaceholder,
  searchAriaLabel,
  className,
  tableOptions,
  getRowId,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(
    initialSorting ?? []
  )
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialColumnFilters ?? []
  )
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility ?? {})
  const [globalFilter, setGlobalFilter] = React.useState(
    initialGlobalFilter ?? ""
  )

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns stateful helpers that React Compiler should skip.
  const table = useReactTable({
    data,
    columns,
    getRowId,
    ...tableOptions,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      ...tableOptions?.state,
    },
    onSortingChange: tableOptions?.onSortingChange ?? setSorting,
    onColumnFiltersChange:
      tableOptions?.onColumnFiltersChange ?? setColumnFilters,
    onColumnVisibilityChange:
      tableOptions?.onColumnVisibilityChange ?? setColumnVisibility,
    onGlobalFilterChange: tableOptions?.onGlobalFilterChange ?? setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel:
      tableOptions?.getFilteredRowModel ?? getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const colCount = Math.max(table.getVisibleLeafColumns().length, 1)
  const searchColumn = searchColumnId ? table.getColumn(searchColumnId) : null
  const searchValue = searchColumn
    ? String(searchColumn.getFilterValue() ?? "")
    : String(table.getState().globalFilter ?? "")
  const hasActiveSearch = searchValue.trim() !== ""

  return (
    <div>
      {searchPlaceholder && (
        <div className="flex py-4">
          <Input
            aria-label={searchAriaLabel ?? searchPlaceholder}
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => {
              if (searchColumn) {
                searchColumn.setFilterValue(event.target.value)
                return
              }
              table.setGlobalFilter(event.target.value)
            }}
            className="w-full sm:max-w-sm"
          />
        </div>
      )}

      <div className={cn("overflow-hidden rounded-lg border", className)}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta
                  const align = meta?.align
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        align === "right" && "text-right",
                        align === "center" && "text-center",
                        meta?.headClassName
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="py-10 text-center text-muted-foreground"
                >
                  {loadingLabel ?? "Loading..."}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta
                    const align = meta?.align
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          align === "right" && "text-right",
                          align === "center" && "text-center",
                          meta?.cellClassName
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            {!loading && table.getRowModel().rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="py-12 text-center text-muted-foreground"
                >
                  {hasActiveSearch && noResultsLabel
                    ? noResultsLabel
                    : (emptyLabel ?? "No results.")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

type SortableHeaderProps = {
  children: React.ReactNode
  isSorted: false | "asc" | "desc"
  onToggle: () => void
  align?: "left" | "right" | "center"
  className?: string
}

export function DataTableSortableHeader({
  children,
  isSorted,
  onToggle,
  align,
  className,
}: SortableHeaderProps) {
  const Icon =
    isSorted === "asc"
      ? ArrowUp
      : isSorted === "desc"
        ? ArrowDown
        : ChevronsUpDown
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      className={cn(
        "-ml-1 h-8 gap-1.5 px-2 font-medium data-[sorted=true]:text-foreground",
        align === "right" && "-mr-1 ml-auto",
        align === "center" && "mx-auto",
        className
      )}
      data-sorted={isSorted !== false}
    >
      {children}
      <Icon className="size-3.5 text-muted-foreground" />
    </Button>
  )
}
