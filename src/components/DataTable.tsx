import * as React from 'react'
import {
  type ColumnDef,
  type ColumnSizingState,
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
import { CARD_LAYOUT_QUERY } from '@/lib/tableMode'
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
 * - En celular real (táctil y de menos de 768 px, `CARD_LAYOUT_QUERY`, OF-17)
 *   se renderiza como una lista de tarjetas (`RowCard`) en vez de una tabla;
 *   en computadora siempre hay tabla, con desplazamiento horizontal aunque
 *   el navegador esté agrandado. Cada columna dice, con
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
interface DataTableColumnMeta {
  /** Alineación de la celda en la tabla de escritorio. Default `'start'`. */
  align?: 'start' | 'end' | 'center'
  /**
   * Qué lugar ocupa esta columna en la tarjeta `RowCard` (celular táctil).
   * Sin indicar (o `'hidden'`), la columna no aparece en la tarjeta.
   * `'trailing'` es para algo corto al lado del título (un estado, un
   * botón); `'actions'` va en una fila propia al pie, para varios botones.
   */
  card?: 'title' | 'subtitle' | 'trailing' | 'meta' | 'actions' | 'hidden'
  /** Etiqueta que se muestra antes del valor cuando `card` es `'meta'`. */
  cardLabel?: string
  /**
   * Nombre de la columna para el lector de pantalla cuando el encabezado
   * no es un texto (por ejemplo, un botón propio). Lo usa el asa de ancho.
   */
  headerLabel?: string
  /**
   * Ancho de la columna (valor CSS: `'14%'`, `'9rem'`) en la tabla de
   * escritorio. Solo se usa con `fixedLayout`; sin él se ignora.
   */
  width?: string
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
  /**
   * Tabla de escritorio con `table-layout: fixed` y un `<colgroup>` con los
   * `meta.width` de cada columna: varias tablas con las mismas columnas
   * quedan alineadas entre sí. Sin el prop, los anchos se calculan por
   * contenido (comportamiento de siempre).
   */
  fixedLayout?: boolean
  /**
   * OH-01: alto acotado a esta cantidad de filas. La tabla se desplaza en
   * vertical dentro del bloque y el encabezado queda fijo (sticky), junto con
   * el desplazamiento horizontal y la primera columna fija. Sin el prop, la
   * tabla crece con todas sus filas. En tarjetas (celular) no aplica.
   */
  maxVisibleRows?: number
  /** OH-01: alto máximo en CSS (`'24rem'`); tiene prioridad sobre `maxVisibleRows`. */
  maxHeight?: string
  /**
   * OH-02: el borde entre dos encabezados se arrastra para cambiar el ancho
   * (cursor `col-resize`, sin líneas visibles). Doble clic en el borde vuelve
   * al ancho original; con el foco en el asa, flechas izquierda y derecha
   * (con Mayús, pasos grandes) y Inicio para restaurar. En tarjetas no aplica.
   */
  resizableColumns?: boolean
  /**
   * OH-02: clave para recordar en `localStorage` los anchos de columna y el
   * orden (si el orden es interno; con `sorting` controlado lo guarda quien lo
   * controla). Si el almacenamiento falla, la tabla anda igual, sin recordar.
   */
  persistKey?: string
  /**
   * El orden lo resuelve quien usa la tabla (lista paginada en el cliente o
   * en el servidor): `DataTable` solo muestra el estado del orden en los
   * encabezados y avisa con `onSortingChange`, pero no reordena `data`.
   */
  manualSorting?: boolean
  className?: string
}

/** OH-02: ancho mínimo y máximo de una columna redimensionada, en px. */
const RESIZE_MIN = 80
const RESIZE_MAX = 800
/** OH-02: paso de las flechas sobre el asa (con Mayús, el grande). */
const RESIZE_STEP = 16
const RESIZE_STEP_LARGE = 48

interface PersistedTableState {
  sizing?: ColumnSizingState
  sorting?: SortingState
}

function storageKey(persistKey: string) {
  return `datatable:${persistKey}`
}

/** Lee el estado recordado; cualquier falla (sin acceso, JSON roto) devuelve vacío. */
function readPersisted(persistKey: string | undefined): PersistedTableState {
  if (!persistKey) {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(storageKey(persistKey))
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    const { sizing, sorting } = parsed as PersistedTableState
    const result: PersistedTableState = {}
    if (sizing && typeof sizing === 'object') {
      const clean: ColumnSizingState = {}
      for (const [id, value] of Object.entries(sizing)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          clean[id] = value
        }
      }
      result.sizing = clean
    }
    if (Array.isArray(sorting)) {
      result.sorting = sorting.filter(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.desc === 'boolean',
      )
    }
    return result
  } catch {
    return {}
  }
}

function writePersisted(
  persistKey: string | undefined,
  state: PersistedTableState,
) {
  if (!persistKey) {
    return
  }
  try {
    window.localStorage.setItem(storageKey(persistKey), JSON.stringify(state))
  } catch {
    // Sin almacenamiento (modo privado, cuota): la tabla sigue andando.
  }
}

/**
 * Varias tablas con la misma `persistKey` en pantalla (por ejemplo, una por
 * franja o por grupo) comparten los anchos: cuando una cambia, avisa a las
 * demás para que las columnas sigan alineadas entre sí.
 */
type SizingListener = (key: string, sizing: ColumnSizingState) => void
const sizingListeners = new Set<SizingListener>()

function sameSizing(a: ColumnSizingState, b: ColumnSizingState) {
  const keysA = Object.keys(a)
  return (
    keysA.length === Object.keys(b).length &&
    keysA.every((key) => a[key] === b[key])
  )
}

function clampWidth(width: number) {
  return Math.min(RESIZE_MAX, Math.max(RESIZE_MIN, Math.round(width)))
}

/** Ancho mínimo por columna: las celdas no se parten en letras con zoom alto. */
const MIN_COLUMN_WIDTH = 'min-w-[7.5rem]'
/** Primera columna fija al desplazar en horizontal (con fondo opaco). */
const STICKY_HEAD = 'sticky left-0 z-[1] bg-[var(--table-header-bg)]'
const STICKY_CELL = 'sticky left-0 z-[1] bg-surface'

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
  fixedLayout = false,
  maxVisibleRows,
  maxHeight,
  resizableColumns = false,
  persistKey,
  manualSorting = false,
  className,
}: DataTableProps<TData>) {
  const showCards = useMediaQuery(CARD_LAYOUT_QUERY)
  // Lo recordado se lee una sola vez, al montar.
  const [persisted] = React.useState(() => readPersisted(persistKey))
  const [internalSorting, setInternalSorting] = React.useState<SortingState>(
    persisted.sorting ?? [],
  )
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>(
    resizableColumns ? (persisted.sizing ?? {}) : {},
  )
  const sorting = controlledSorting ?? internalSorting
  const handleSortingChange = onSortingChange ?? setInternalSorting

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, columnSizing },
    onSortingChange: handleSortingChange,
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: resizableColumns,
    manualSorting,
    // OH-02: el ciclo es ascendente, descendente, sin orden (también en números).
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  React.useEffect(() => {
    if (!persistKey) {
      return
    }
    writePersisted(persistKey, {
      sizing: resizableColumns ? columnSizing : undefined,
      sorting: controlledSorting ? undefined : internalSorting,
    })
    if (resizableColumns) {
      for (const listener of sizingListeners) {
        listener(persistKey, columnSizing)
      }
    }
  }, [
    persistKey,
    resizableColumns,
    columnSizing,
    controlledSorting,
    internalSorting,
  ])

  React.useEffect(() => {
    if (!persistKey || !resizableColumns) {
      return
    }
    const listener: SizingListener = (key, sizing) => {
      if (key === persistKey) {
        setColumnSizing((old) => (sameSizing(old, sizing) ? old : sizing))
      }
    }
    sizingListeners.add(listener)
    return () => {
      sizingListeners.delete(listener)
    }
  }, [persistKey, resizableColumns])

  const bounded = maxHeight != null || maxVisibleRows != null
  const boundedHeight =
    maxHeight ??
    (maxVisibleRows != null
      ? // Encabezado (~2.5 rem) más las filas (~3 rem; ~2.75 rem en compacta).
        `calc(2.5rem + ${maxVisibleRows} * ${compact ? '2.75rem' : '3rem'})`
      : undefined)

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

  if (showCards) {
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
      <Table
        className={fixedLayout ? 'table-fixed min-w-[48rem]' : 'min-w-max'}
        containerClassName={bounded ? 'overflow-y-auto' : undefined}
        containerStyle={
          boundedHeight ? { maxHeight: boundedHeight } : undefined
        }
      >
        <TableCaption>{caption}</TableCaption>
        {fixedLayout && (
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col
                key={column.id}
                style={{
                  width:
                    resizableColumns && columnSizing[column.id] != null
                      ? `${columnSizing[column.id]}px`
                      : getColumnMeta(column.columnDef)?.width,
                }}
              />
            ))}
          </colgroup>
        )}
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const align = getColumnMeta(header.column.columnDef)?.align
                const canSort = header.column.getCanSort()
                const sortDirection = header.column.getIsSorted()
                const resizedWidth = resizableColumns
                  ? columnSizing[header.column.id]
                  : undefined
                const canResize =
                  resizableColumns &&
                  !header.isPlaceholder &&
                  header.column.getCanResize()
                return (
                  <TableHead
                    key={header.id}
                    style={
                      resizedWidth != null && !fixedLayout
                        ? {
                            width: resizedWidth,
                            minWidth: resizedWidth,
                            maxWidth: resizedWidth,
                          }
                        : undefined
                    }
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
                      !fixedLayout &&
                        !header.isPlaceholder &&
                        resizedWidth == null &&
                        MIN_COLUMN_WIDTH,
                      resizableColumns && 'relative',
                      // OH-01 / DEF-P30-06: con alto acotado el encabezado queda
                      // fijo arriba, con fondo opaco y por encima de las celdas
                      // (z 1) y de las filas resaltadas; la esquina fija, por
                      // encima de todo. El borde inferior va como sombra
                      // interna porque el borde colapsado se desplaza con las filas.
                      bounded &&
                        'sticky top-0 z-[4] bg-[var(--table-header-bg)] shadow-[inset_0_-1px_0_var(--color-border)]',
                      header.index === 0 && STICKY_HEAD,
                      header.index === 0 && bounded && 'z-[5]',
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
                    {canResize && (
                      <ColumnResizer
                        label={`Cambiar el ancho de la columna ${
                          typeof header.column.columnDef.header === 'string'
                            ? header.column.columnDef.header
                            : (getColumnMeta(header.column.columnDef)
                                ?.headerLabel ??
                              getColumnMeta(header.column.columnDef)
                                ?.cardLabel ??
                              header.column.id)
                        }`}
                        width={resizedWidth}
                        onResize={(width) =>
                          setColumnSizing((old) => ({
                            ...old,
                            [header.column.id]: clampWidth(width),
                          }))
                        }
                        onReset={() =>
                          setColumnSizing((old) => {
                            const rest = { ...old }
                            delete rest[header.column.id]
                            return rest
                          })
                        }
                      />
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
                {row.getVisibleCells().map((cell, cellIndex) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      compact && 'px-[10px] py-[8px]',
                      !fixedLayout && MIN_COLUMN_WIDTH,
                      cellIndex === 0 && STICKY_CELL,
                      cellIndex === 0 &&
                        variant &&
                        TABLE_ROW_CLASS_NAME[variant],
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

/**
 * OH-02: asa invisible sobre el borde derecho del encabezado. Con el mouse se
 * arrastra (eventos de puntero, sirve también con el dedo en tabletas); con el
 * teclado, flechas izquierda/derecha. El ancho de partida es el que la celda
 * tiene en pantalla en ese momento, así que no hay saltos al empezar.
 */
/* Un `separator` con foco es un widget interactivo según WAI-ARIA (separador
   redimensionable); la regla de jsx-a11y no lo reconoce como tal. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
function ColumnResizer({
  label,
  width,
  onResize,
  onReset,
}: {
  label: string
  /** Ancho ya fijado por la persona (si no hay, el de contenido). */
  width: number | undefined
  onResize: (width: number) => void
  onReset: () => void
}) {
  const dragRef = React.useRef<{ startX: number; startWidth: number } | null>(
    null,
  )

  const measure = (element: HTMLElement) =>
    element.closest('th')?.getBoundingClientRect().width ?? width ?? RESIZE_MIN

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width ?? RESIZE_MIN)}
      aria-valuemin={RESIZE_MIN}
      aria-valuemax={RESIZE_MAX}
      tabIndex={0}
      data-slot="column-resizer"
      className="absolute top-0 right-0 z-[1] h-full w-2 cursor-col-resize touch-none select-none focus-visible:outline-2 focus-visible:outline-ring"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        dragRef.current = {
          startX: event.clientX,
          startWidth: measure(event.currentTarget),
        }
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (drag) {
          onResize(drag.startWidth + event.clientX - drag.startX)
        }
      }}
      onPointerUp={(event) => {
        dragRef.current = null
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          const base = width ?? measure(event.currentTarget)
          onResize(base + (event.key === 'ArrowRight' ? step : -step))
        } else if (event.key === 'Home') {
          event.preventDefault()
          onReset()
        }
      }}
    />
  )
}

/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */

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
  const actionsCell = cells.find(
    (cell) => getColumnMeta(cell.column.columnDef)?.card === 'actions',
  )

  return (
    <div
      data-slot="row-card"
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
      {actionsCell && (
        <div className="mt-[10px] border-t border-border pt-[10px]">
          {flexRender(
            actionsCell.column.columnDef.cell,
            actionsCell.getContext(),
          )}
        </div>
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
