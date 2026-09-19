import * as React from 'react'
import {
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { cn } from 'cn'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { TABLE_ROW_CLASS_NAME, type TableRowVariant } from '@/components/status'

/**
 * DataTable (DS-008): `07` sección 2.3 sobre TanStack Table 8 (ADR-021 — la
 * 9 existe pero cambia toda su API pública a un modelo "por slots"
 * incompatible con el patrón de shadcn/ui, e incluso su propia capa de
 * compatibilidad con la 8 está marcada `@deprecated`; ver reporte).
 *
 * - Ordenamiento por columna: siempre local, sobre el array `data` que
 *   recibe (si `sorting`/`onSortingChange` vienen controlados desde afuera,
 *   es responsabilidad de quien lo usa volver a pedir `data` ordenada al
 *   servidor si hiciera falta — acá no hay forma de distinguir "ordená vos"
 *   de "ya te la mandé ordenada").
 * - Paginación por rango, controlada desde afuera (`pagination`,
 *   `onPaginationChange`, `pageCount`/`rowCount`): `data` es siempre
 *   exactamente lo que hay que mostrar en la página actual (ya recortado
 *   por quien lo usa, típicamente el servidor) — `DataTable` nunca corta
 *   `data` sola.
 * - Por debajo de 1024 px (`05` sección 7) se renderiza como una lista de
 *   tarjetas (`RowCard`) en vez de una tabla: cada columna dice, con
 *   `meta.card`, qué parte de la tarjeta ocupa (`title`, `subtitle`,
 *   `trailing`, `meta` o `hidden` — default si no se indica).
 *
 * `meta.align`/`meta.card`/`meta.cardLabel`: TanStack Table permite ampliar
 * `ColumnMeta` por fusión de declaraciones (`declare module
 * '@tanstack/react-table'`), pero el linteo con información de tipos
 * (`projectService` de typescript-eslint) no la resuelve bien — la marca
 * como insegura al leerla, sea la ampliación local a este archivo o en un
 * `.d.ts` aparte. En vez de pelear con eso, `DataTableColumnDef` define el
 * `meta` propio por intersección, sin tocar el tipo de la librería: como
 * `ColumnMeta` de la librería hoy no declara ningún campo, es estructuralmente
 * compatible con cualquier forma de `meta` propia (todos los campos son
 * opcionales), así que no hace falta ningún casteo ni en `columns` (la
 * entrada) ni en `getColumnMeta` (la lectura).
 */
const DESKTOP_QUERY = '(min-width: 1024px)'

interface DataTableColumnMeta {
  /** Alineación de la celda en la tabla de escritorio. Default `'start'`. */
  align?: 'start' | 'end' | 'center'
  /**
   * Qué lugar ocupa esta columna en la tarjeta `RowCard` (< 1024 px).
   * Sin indicar (o `'hidden'`), la columna no aparece en la tarjeta.
   */
  card?: 'title' | 'subtitle' | 'trailing' | 'meta' | 'hidden'
  /** Etiqueta que se muestra antes del valor cuando `card` es `'meta'`. */
  cardLabel?: string
}

type DataTableColumnDef<TData> = ColumnDef<TData> & {
  meta?: DataTableColumnMeta
}

interface DataTablePagination {
  pageIndex: number
  pageSize: number
}

interface DataTableEmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
}

interface DataTableProps<TData> {
  columns: DataTableColumnDef<TData>[]
  data: TData[]
  getRowId?: (row: TData, index: number) => string
  /** Nombre accesible de la tabla (`<caption class="sr-only">`). */
  caption: string
  /** `.tbl.compact` (ds.css): menos padding, avatar de 26 px. */
  compact?: boolean
  isLoading?: boolean
  /** Filas de esqueleto mientras `isLoading`. Default 5. */
  skeletonRows?: number
  emptyState?: DataTableEmptyStateProps
  /** `07` sección 3: pinta la fila completa (`crit`/`warn`) según su estado. */
  rowVariant?: (row: TData) => TableRowVariant | undefined
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  /** Página y tamaño controlados desde afuera — ver comentario del componente. */
  pagination?: DataTablePagination
  onPaginationChange?: (pagination: DataTablePagination) => void
  /** Total de páginas, si se conoce (habilita/deshabilita "Siguiente"). */
  pageCount?: number
  /** Total de filas, si se conoce ("Mostrando 1–10 de 42"). */
  rowCount?: number
  className?: string
}

function getColumnMeta<TData>(
  columnDef: DataTableColumnDef<TData>,
): DataTableColumnMeta | undefined {
  return columnDef.meta
}

function getAlignClassName(align: 'start' | 'end' | 'center' | undefined) {
  if (align === 'end') {
    return 'text-right'
  }
  if (align === 'center') {
    return 'text-center'
  }
  return undefined
}

function DataTable<TData>({
  columns,
  data,
  getRowId,
  caption,
  compact = false,
  isLoading = false,
  skeletonRows = 5,
  emptyState,
  rowVariant,
  sorting: controlledSorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  pageCount,
  rowCount,
  className,
}: DataTableProps<TData>) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([])
  const sorting = controlledSorting ?? internalSorting
  const handleSortingChange = onSortingChange ?? setInternalSorting

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting },
    onSortingChange: handleSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const rows = table.getRowModel().rows

  if (isLoading) {
    return (
      <DataTableSkeleton
        columnCount={columns.length}
        rowCount={skeletonRows}
        compact={compact}
        className={className}
      />
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No hay datos para mostrar."
        {...emptyState}
        className={className}
      />
    )
  }

  const pager = pagination && onPaginationChange && (
    <DataTablePager
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      pageCount={pageCount}
      rowCount={rowCount}
      currentRowCount={rows.length}
    />
  )

  if (!isDesktop) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <span className="sr-only">{caption}</span>
        {rows.map((row) => (
          <RowCard
            key={row.id}
            row={row}
            variant={rowVariant?.(row.original)}
          />
        ))}
        {pager}
      </div>
    )
  }

  return (
    <div className={className}>
      <Table>
        <TableCaption>{caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const align = getColumnMeta(header.column.columnDef)?.align
                const canSort = header.column.getCanSort()
                const sortDirection = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      !canSort
                        ? undefined
                        : sortDirection === 'asc'
                          ? 'ascending'
                          : sortDirection === 'desc'
                            ? 'descending'
                            : 'none'
                    }
                    className={cn(
                      compact && 'px-[10px] py-[8px]',
                      getAlignClassName(align),
                    )}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'inline-flex items-center gap-[3px] text-inherit uppercase hover:text-text-2',
                          align === 'end' && 'flex-row-reverse',
                        )}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {sortDirection === 'asc' ? (
                          <ChevronUp aria-hidden="true" className="size-3" />
                        ) : sortDirection === 'desc' ? (
                          <ChevronDown aria-hidden="true" className="size-3" />
                        ) : (
                          <ChevronsUpDown
                            aria-hidden="true"
                            className="size-3 text-text-3/70"
                          />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const variant = rowVariant?.(row.original)
            return (
              <TableRow
                key={row.id}
                className={variant ? TABLE_ROW_CLASS_NAME[variant] : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      compact && 'px-[10px] py-[8px]',
                      getAlignClassName(
                        getColumnMeta(cell.column.columnDef)?.align,
                      ),
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {pager}
    </div>
  )
}

function DataTableSkeleton({
  columnCount,
  rowCount,
  compact,
  className,
}: {
  columnCount: number
  rowCount: number
  compact: boolean
  className?: string
}) {
  return (
    <div
      role="status"
      aria-label="Cargando datos…"
      className={cn('flex flex-col gap-[10px] p-[14px]', className)}
    >
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4">
          {Array.from({ length: Math.min(columnCount, 5) }, (_, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cn(
                'flex-1',
                compact ? 'h-[14px]' : 'h-[16px]',
                colIndex === 0 && 'max-w-40',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function RowCard<TData>({
  row,
  variant,
}: {
  row: Row<TData>
  variant?: TableRowVariant
}) {
  const cells = row.getVisibleCells()
  const titleCell = cells.find(
    (cell) => getColumnMeta(cell.column.columnDef)?.card === 'title',
  )
  const subtitleCell = cells.find(
    (cell) => getColumnMeta(cell.column.columnDef)?.card === 'subtitle',
  )
  const trailingCell = cells.find(
    (cell) => getColumnMeta(cell.column.columnDef)?.card === 'trailing',
  )
  const metaCells = cells.filter(
    (cell) => getColumnMeta(cell.column.columnDef)?.card === 'meta',
  )

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface p-[14px] shadow-card',
        variant && TABLE_ROW_CLASS_NAME[variant],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {titleCell &&
            flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
          {subtitleCell && (
            <div className="mt-[2px] text-[11px] text-text-3">
              {flexRender(
                subtitleCell.column.columnDef.cell,
                subtitleCell.getContext(),
              )}
            </div>
          )}
        </div>
        {trailingCell && (
          <div className="shrink-0">
            {flexRender(
              trailingCell.column.columnDef.cell,
              trailingCell.getContext(),
            )}
          </div>
        )}
      </div>
      {metaCells.length > 0 && (
        <dl className="mt-[10px] grid grid-cols-2 gap-x-3 gap-y-[6px] border-t border-border pt-[10px]">
          {metaCells.map((cell) => {
            const label = getColumnMeta(cell.column.columnDef)?.cardLabel
            return (
              <div key={cell.id} className="min-w-0">
                {label && (
                  <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
                    {label}
                  </dt>
                )}
                <dd className="truncate text-xs text-text-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}

function DataTablePager({
  pagination,
  onPaginationChange,
  pageCount,
  rowCount,
  currentRowCount,
}: {
  pagination: DataTablePagination
  onPaginationChange: (pagination: DataTablePagination) => void
  pageCount?: number
  rowCount?: number
  currentRowCount: number
}) {
  const { pageIndex, pageSize } = pagination
  const from = currentRowCount === 0 ? 0 : pageIndex * pageSize + 1
  const to = pageIndex * pageSize + currentRowCount
  const canGoPrevious = pageIndex > 0
  const canGoNext =
    pageCount != null
      ? pageIndex < pageCount - 1
      : rowCount != null
        ? to < rowCount
        : true

  return (
    <div className="flex items-center justify-between border-t border-border px-[14px] py-[10px] text-[11px] text-text-3">
      <span>
        Mostrando {from}–{to}
        {rowCount != null ? ` de ${rowCount}` : ''}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canGoPrevious}
          onClick={() =>
            onPaginationChange({ pageIndex: pageIndex - 1, pageSize })
          }
        >
          Anterior
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canGoNext}
          onClick={() =>
            onPaginationChange({ pageIndex: pageIndex + 1, pageSize })
          }
        >
          Siguiente
        </Button>
      </div>
    </div>
  )
}

export { DataTable }
export type {
  DataTableProps,
  DataTablePagination,
  DataTableColumnDef,
  DataTableColumnMeta,
}
