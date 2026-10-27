import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  ClipboardCheck,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { useAuth } from '@/features/auth/AuthProvider'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { StockItem } from '@/api/stock'
import {
  useStockItemsQuery,
  useSupplyCategoriesQuery,
  useSupplyImageUrls,
} from '@/features/stock/queries'
import {
  DEFAULT_STOCK_FILTERS,
  filterStockItems,
  stockRowVariant,
  totalStockValue,
  type StockFilters,
} from '@/features/stock/filters'
import { canManageStock } from '@/features/stock/permissions'
import { formatMoney, formatQty } from '@/features/stock/money'
import { AdjustStockDialog } from './AdjustStockDialog'
import { ControlSheetAction } from './ControlSheetAction'
import { StockAlertBadge } from './StockAlertBadge'
import { SupplyImage } from './SupplyImage'

/**
 * Pestaña «Stock» de Insumos (IS-05, IS-24, IS-25): tabla con imagen chica,
 * código, artículo y presentación, categoría, stock, mínimo, costo, venta y
 * valor a costo; filas en amarillo («Bajo mínimo») o rojo («Sin stock») y el
 * total del valor del stock. Por fila: «Ajustar» y la ficha. En el celular
 * la tabla pasa a tarjetas (`DataTable` con `RowCard`).
 *
 * Sin `manage_stock` se ve todo, pero sin «Ingreso», «Retiro en nombre de»,
 * «Imprimir planilla», «Cargar control», «Nuevo artículo» ni «Ajustar»
 * (IS-21).
 */
function StockTab() {
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState<StockFilters>(() => ({
    ...DEFAULT_STOCK_FILTERS,
    // Las tarjetas del Resumen (IS-30) llevan acá con `?filtro=aviso`.
    onlyAlerts: searchParams.get('filtro') === 'aviso',
  }))
  const debouncedText = useDebouncedValue(filters.text)
  const [adjusting, setAdjusting] = useState<StockItem | null>(null)

  const itemsQuery = useStockItemsQuery()
  const categoriesQuery = useSupplyCategoriesQuery()

  const rows = useMemo(
    () =>
      filterStockItems(itemsQuery.data ?? [], {
        ...filters,
        text: debouncedText,
      }),
    [itemsQuery.data, filters, debouncedText],
  )
  const imageUrls = useSupplyImageUrls(rows.map((row) => row.imagePath))
  const total = totalStockValue(rows)
  const hasFilters =
    filters.text !== '' ||
    filters.categoryId !== 'all' ||
    filters.onlyAlerts ||
    filters.includeInactive

  const columns: DataTableColumnDef<StockItem>[] = [
    {
      id: 'image',
      header: 'Imagen',
      enableSorting: false,
      meta: { card: 'hidden', width: '3.5rem' },
      cell: ({ row }) => (
        <SupplyImage path={row.original.imagePath} urls={imageUrls} />
      ),
    },
    {
      id: 'code',
      header: 'Código',
      accessorFn: (item) => item.code.toLowerCase(),
      meta: { card: 'subtitle' },
      cell: ({ row }) => (
        <span className="font-mono text-[12px] whitespace-nowrap">
          {row.original.code}
          <span className="text-text-3 lg:hidden">
            {' · '}
            {row.original.categoryName}
          </span>
        </span>
      ),
    },
    {
      id: 'name',
      header: 'Artículo',
      accessorFn: (item) => item.name.toLowerCase(),
      meta: { card: 'title' },
      cell: ({ row }) => {
        const item = row.original
        return (
          <Link
            to={`/admin/insumos/${item.id}`}
            className="flex min-w-0 items-center gap-[9px] font-semibold text-text hover:text-primary-800 hover:underline max-md:min-h-11"
          >
            <SupplyImage
              path={item.imagePath}
              urls={imageUrls}
              className="lg:hidden"
            />
            <span className="min-w-0">
              {item.name}
              {item.presentation && (
                <span className="block text-[11px] font-normal text-text-3">
                  {item.presentation}
                </span>
              )}
              {!item.active && (
                <Badge variant="neutral-strike" className="mt-[2px]">
                  Inactivo
                </Badge>
              )}
            </span>
          </Link>
        )
      },
    },
    {
      id: 'category',
      header: 'Categoría',
      accessorFn: (item) => item.categoryName.toLowerCase(),
      meta: { card: 'hidden' },
      cell: ({ row }) => row.original.categoryName,
    },
    {
      id: 'stock',
      header: 'Stock',
      accessorFn: (item) => item.stockQty,
      meta: { card: 'trailing', align: 'end' },
      cell: ({ row }) => (
        <span className="flex flex-col items-end gap-[3px]">
          <span className="font-semibold tabular-nums">
            {formatQty(row.original.stockQty)}
          </span>
          <StockAlertBadge item={row.original} />
        </span>
      ),
    },
    {
      id: 'min',
      header: 'Mínimo',
      accessorFn: (item) => item.minQty ?? -1,
      meta: { card: 'meta', cardLabel: 'Mínimo', align: 'end' },
      cell: ({ row }) =>
        row.original.minQty == null ? '—' : formatQty(row.original.minQty),
    },
    {
      id: 'cost',
      header: 'Costo',
      accessorFn: (item) => item.costPrice,
      meta: { card: 'meta', cardLabel: 'Costo', align: 'end' },
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap">
          {formatMoney(row.original.costPrice)}
        </span>
      ),
    },
    {
      id: 'sale',
      header: 'Venta',
      accessorFn: (item) => item.salePrice,
      meta: { card: 'meta', cardLabel: 'Venta', align: 'end' },
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap">
          {formatMoney(row.original.salePrice)}
        </span>
      ),
    },
    {
      id: 'value',
      header: 'Valor a costo',
      accessorFn: (item) => item.stockValue,
      meta: { card: 'meta', cardLabel: 'Valor a costo', align: 'end' },
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap">
          {formatMoney(row.original.stockValue)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      meta: { card: 'actions', align: 'end' },
      cell: ({ row }) => {
        const item = row.original
        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManage && item.active && (
              <Button
                variant="ghost"
                size="sm"
                icon={SlidersHorizontal}
                onClick={() => setAdjusting(item)}
                aria-label={`Ajustar el stock de ${item.name}${item.presentation ? ` ${item.presentation}` : ''}`}
              >
                Ajustar
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link
                to={`/admin/insumos/${item.id}`}
                aria-label={`Abrir la ficha de ${item.name}${item.presentation ? ` ${item.presentation}` : ''}`}
              >
                Ficha
              </Link>
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {itemsQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={itemsQuery.dataUpdatedAt} />
          )}
          <Input
            icon={Search}
            placeholder="Buscar por código o nombre…"
            aria-label="Buscar por código o nombre"
            value={filters.text}
            onChange={(event) =>
              setFilters({ ...filters, text: event.target.value })
            }
            className="w-64"
          />
          <Select
            value={filters.categoryId}
            onValueChange={(value) =>
              setFilters({ ...filters, categoryId: value })
            }
          >
            <SelectTrigger aria-label="Filtrar por categoría">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {(categoriesQuery.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                  {category.active ? '' : ' (desactivada)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label
            htmlFor="stock-only-alerts"
            className="flex items-center gap-2 text-[12.5px] text-text-2"
          >
            <Switch
              id="stock-only-alerts"
              checked={filters.onlyAlerts}
              onCheckedChange={(checked) =>
                setFilters({ ...filters, onlyAlerts: checked })
              }
            />
            Solo con aviso
          </label>
          <label
            htmlFor="stock-include-inactive"
            className="flex items-center gap-2 text-[12.5px] text-text-2"
          >
            <Switch
              id="stock-include-inactive"
              checked={filters.includeInactive}
              onCheckedChange={(checked) =>
                setFilters({ ...filters, includeInactive: checked })
              }
            />
            Incluir inactivos
          </label>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" icon={PackagePlus}>
              <Link to="/admin/insumos/ingreso">Ingreso</Link>
            </Button>
            <Button asChild variant="ghost" icon={PackageMinus}>
              <Link to="/admin/insumos/retiro">Retiro en nombre de</Link>
            </Button>
            <ControlSheetAction
              items={itemsQuery.data ?? []}
              categories={categoriesQuery.data ?? []}
              defaultCategoryId={filters.categoryId}
            />
            <Button asChild variant="ghost" icon={ClipboardCheck}>
              <Link to="/admin/insumos/control">Cargar control</Link>
            </Button>
            <Button asChild icon={Plus}>
              <Link to="/admin/insumos/nuevo">Nuevo artículo</Link>
            </Button>
          </div>
        )}
      </div>

      <DataTable
        caption="Stock de insumos"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        isLoading={itemsQuery.isLoading}
        rowVariant={stockRowVariant}
        emptyState={{
          icon: PackageSearch,
          title: hasFilters
            ? 'No encontramos artículos con esos filtros'
            : 'Todavía no hay artículos cargados',
          description:
            !hasFilters && canManage
              ? 'Cargá el primero con «Nuevo artículo».'
              : undefined,
        }}
      />

      {!itemsQuery.isLoading && rows.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-[12px] text-text-3">
            {rows.length === 1 ? '1 artículo' : `${rows.length} artículos`}
            {hasFilters ? ' con los filtros elegidos' : ''}
          </p>
          <p className="text-[13px] font-semibold text-text">
            Valor del stock a costo:{' '}
            <span className="tabular-nums" data-testid="stock-total">
              {formatMoney(total)}
            </span>
          </p>
        </div>
      )}

      <AdjustStockDialog
        item={adjusting}
        open={adjusting != null}
        onOpenChange={(open) => {
          if (!open) setAdjusting(null)
        }}
      />
    </div>
  )
}

export { StockTab }
