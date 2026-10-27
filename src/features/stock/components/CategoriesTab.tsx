import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Pencil, Plus, Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { IconButton, IconButtonGroup } from '@/components/IconButton'
import { isApiError } from '@/api/errors'
import type { SupplyCategory } from '@/api/stock'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useReorderSupplyCategoriesMutation,
  useStockItemsQuery,
  useSupplyCategoriesQuery,
  useUpsertSupplyCategoryMutation,
} from '@/features/stock/queries'
import { moveCategory } from '@/features/stock/filters'
import { canManageStock } from '@/features/stock/permissions'
import { CategoryFormDialog } from './CategoryFormDialog'

/**
 * Pestaña «Categorías» de Insumos (IS-03): alta, edición, orden y baja. La
 * baja es una desactivación (no se borra, P-014) y el servidor la rechaza si
 * quedan artículos activos (`CATEGORY_IN_USE`). Sin `manage_stock` la lista
 * se ve pero sin botones de cambio (IS-21).
 */
function CategoriesTab() {
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const categoriesQuery = useSupplyCategoriesQuery()
  const itemsQuery = useStockItemsQuery()
  const upsert = useUpsertSupplyCategoryMutation()
  const reorder = useReorderSupplyCategoriesMutation()
  const [editing, setEditing] = useState<SupplyCategory | null>(null)
  const [creating, setCreating] = useState(false)

  const categories = categoriesQuery.data ?? []
  const activeCountByCategory = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of itemsQuery.data ?? []) {
      if (item.active) {
        counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1)
      }
    }
    return counts
  }, [itemsQuery.data])
  const nextSortOrder = categories.reduce(
    (max, category) => Math.max(max, category.sortOrder + 1),
    0,
  )

  async function handleMove(
    category: SupplyCategory,
    direction: 'up' | 'down',
  ) {
    const changes = moveCategory(categories, category.id, direction)
    if (changes.length === 0) return
    try {
      await reorder.mutateAsync(changes)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar el orden.',
      )
    }
  }

  async function handleToggleActive(category: SupplyCategory) {
    try {
      await upsert.mutateAsync({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        active: !category.active,
      })
      toast.success(
        category.active
          ? `Desactivamos la categoría «${category.name}».`
          : `Activamos la categoría «${category.name}».`,
      )
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar la categoría.',
      )
    }
  }

  const columns: DataTableColumnDef<SupplyCategory>[] = [
    {
      id: 'name',
      header: 'Categoría',
      enableSorting: false,
      meta: { card: 'title' },
      cell: ({ row }) => (
        <span className="font-semibold text-text">{row.original.name}</span>
      ),
    },
    {
      id: 'items',
      header: 'Artículos activos',
      enableSorting: false,
      meta: { card: 'meta', cardLabel: 'Artículos activos', align: 'end' },
      cell: ({ row }) => activeCountByCategory.get(row.original.id) ?? 0,
    },
    {
      id: 'status',
      header: 'Estado',
      enableSorting: false,
      meta: { card: 'trailing' },
      cell: ({ row }) =>
        row.original.active ? (
          <Badge variant="success" dot>
            Activa
          </Badge>
        ) : (
          <Badge variant="neutral" dot>
            Desactivada
          </Badge>
        ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: () => <span className="sr-only">Acciones</span>,
            enableSorting: false,
            meta: { card: 'actions', align: 'end' },
            cell: ({
              row,
            }: {
              row: { original: SupplyCategory; index: number }
            }) => {
              const category = row.original
              const busy = reorder.isPending || upsert.isPending
              return (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <IconButtonGroup>
                    <IconButton
                      icon={ArrowUp}
                      aria-label={`Subir la categoría ${category.name}`}
                      disabled={busy || row.index === 0}
                      onClick={() => void handleMove(category, 'up')}
                    />
                    <IconButton
                      icon={ArrowDown}
                      aria-label={`Bajar la categoría ${category.name}`}
                      disabled={busy || row.index === categories.length - 1}
                      onClick={() => void handleMove(category, 'down')}
                    />
                  </IconButtonGroup>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Pencil}
                    onClick={() => setEditing(category)}
                    aria-label={`Editar la categoría ${category.name}`}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleToggleActive(category)}
                    aria-label={`${category.active ? 'Desactivar' : 'Activar'} la categoría ${category.name}`}
                  >
                    {category.active ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              )
            },
          } satisfies DataTableColumnDef<SupplyCategory>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[12px] text-text-3">
          Las categorías ordenan y filtran los artículos. El orden de esta lista
          es el de la tabla de stock.
        </p>
        {canManage && (
          <Button icon={Plus} onClick={() => setCreating(true)}>
            Nueva categoría
          </Button>
        )}
      </div>

      <DataTable
        caption="Categorías de insumos"
        columns={columns}
        data={categories}
        getRowId={(row) => row.id}
        isLoading={categoriesQuery.isLoading}
        emptyState={{
          icon: Tags,
          title: 'Todavía no hay categorías',
          description: canManage
            ? 'Creá la primera con «Nueva categoría».'
            : undefined,
        }}
      />

      <CategoryFormDialog
        category={null}
        nextSortOrder={nextSortOrder}
        open={creating}
        onOpenChange={setCreating}
      />
      <CategoryFormDialog
        category={editing}
        nextSortOrder={nextSortOrder}
        open={editing != null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
    </div>
  )
}

export { CategoriesTab }
