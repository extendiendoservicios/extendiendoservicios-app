import { useState, type ReactNode } from 'react'
import { Check, PackageSearch, Search } from 'lucide-react'
import { cn } from 'cn'
import type { SupplyCatalogItem } from '@/api/myStock'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { ALL_CATEGORIES, catalogCategories, filterCatalog } from '../logic'
import { SupplyThumb } from './SupplyThumb'

/**
 * Catálogo del celular (IS-20, IS-28): imagen, código, nombre y presentación,
 * con buscador y filtro por categoría. Nunca muestra cantidades ni precios;
 * los artículos agotados llevan la etiqueta «Sin stock».
 *
 * Se usa en tres lugares: la consulta de Insumos (sin acciones), «Retirar
 * insumos» (`renderTrailing`, a la derecha de cada fila) y «Avisar faltante»
 * (`onSelect`: la fila entera es un botón). Con `dimOutOfStock` los agotados
 * se ven atenuados y no admiten acción (no se pueden elegir para un retiro).
 */
export function CatalogBrowser({
  items,
  imageUrls,
  renderTrailing,
  onSelect,
  selectedId,
  dimOutOfStock = false,
}: {
  items: readonly SupplyCatalogItem[]
  imageUrls?: ReadonlyMap<string, string>
  /** Acción a la derecha de la fila. */
  renderTrailing?: (item: SupplyCatalogItem) => ReactNode
  /** Si se pasa, la fila entera es un botón que elige el artículo. */
  onSelect?: (item: SupplyCatalogItem) => void
  selectedId?: string | null
  dimOutOfStock?: boolean
}) {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(ALL_CATEGORIES)
  const categories = catalogCategories(items)
  const visible = filterCatalog(items, search, categoryId)

  return (
    <div className="flex flex-col gap-3">
      <Input
        mobile
        type="search"
        icon={Search}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por código o nombre…"
        aria-label="Buscar insumos"
      />
      {categories.length > 1 && (
        <div
          role="group"
          aria-label="Filtrar por categoría"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          <CategoryChip
            label="Todas"
            active={categoryId === ALL_CATEGORIES}
            onClick={() => setCategoryId(ALL_CATEGORIES)}
          />
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              label={category.name}
              active={categoryId === category.id}
              onClick={() => setCategoryId(category.id)}
            />
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No encontramos insumos"
          description={
            items.length === 0
              ? 'Todavía no hay insumos cargados.'
              : 'Probá con otra búsqueda o con otra categoría.'
          }
          className="py-6"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((item) => (
            <SupplyRow
              key={item.id}
              item={item}
              imageUrl={item.imagePath ? imageUrls?.get(item.imagePath) : null}
              dimmed={dimOutOfStock && item.outOfStock}
              selected={selectedId === item.id}
              onSelect={onSelect}
              trailing={renderTrailing?.(item)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-11 shrink-0 rounded-full border px-4 text-[13px] font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary-50 text-primary-800'
          : 'border-border bg-surface text-text-2',
      )}
    >
      {label}
    </button>
  )
}

function SupplyRow({
  item,
  imageUrl,
  dimmed,
  selected,
  onSelect,
  trailing,
}: {
  item: SupplyCatalogItem
  imageUrl?: string | null
  dimmed: boolean
  selected: boolean
  onSelect?: (item: SupplyCatalogItem) => void
  trailing?: ReactNode
}) {
  const body = (
    <>
      <SupplyThumb url={imageUrl} />
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[11px] font-semibold text-text-3">{item.code}</p>
        <p className="text-[14px] leading-snug font-semibold text-text">
          {item.name}
        </p>
        {item.presentation && (
          <p className="text-[12px] text-text-3">{item.presentation}</p>
        )}
        {item.outOfStock && (
          <Badge variant="danger" className="mt-1">
            Sin stock
          </Badge>
        )}
      </div>
    </>
  )

  const rowClass = cn(
    'flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-[10px]',
    selected ? 'border-primary bg-primary-50' : 'border-border',
    dimmed && 'opacity-60',
  )

  if (onSelect) {
    return (
      <li>
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(item)}
          className={cn(
            rowClass,
            'min-h-11 outline-none focus-visible:ring-3 focus-visible:ring-ring',
          )}
        >
          {body}
          {selected && (
            <Check
              aria-hidden="true"
              className="size-5 shrink-0 text-primary"
            />
          )}
        </button>
      </li>
    )
  }

  return (
    <li className={rowClass}>
      {body}
      {trailing}
    </li>
  )
}
