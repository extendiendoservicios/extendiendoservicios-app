import { Check, ImageOff, Pin, Play } from 'lucide-react'
import { cn } from 'cn'
import type { MediaGridGroup, MediaItem } from './types'

/**
 * `MediaGrid` (módulo H, §3): miniaturas de fotos y videos, sueltas o
 * agrupadas (por turno, por persona…), con selección múltiple opcional para
 * «Descargar ZIP».
 *
 * - Tocar una miniatura la abre (`onOpen`, con su posición en la lista
 *   plana, para el `index` de `MediaViewer`).
 * - Con `selectable`, cada miniatura tiene además una casilla de 44×44 px
 *   arriba a la izquierda; tocar la miniatura sigue abriendo el visor.
 * - Los archivos vencidos o quitados se ven como un cuadro gris con el
 *   motivo: del turno queda la constancia, no el archivo.
 */
export interface MediaGridProps {
  /** Una lista sin agrupar. Se ignora si hay `groups`. */
  items?: MediaItem[]
  /** Listas con título (p. ej. por turno). */
  groups?: MediaGridGroup[]
  /** Se llama al tocar una miniatura. `index` es la posición en la lista plana (grupos en orden). */
  onOpen?: (item: MediaItem, index: number) => void
  /** Activa la selección múltiple. */
  selectable?: boolean
  /** `id` de los archivos seleccionados. */
  selectedIds?: ReadonlyArray<string>
  onSelectedIdsChange?: (ids: string[]) => void
  /** Texto cuando no hay nada. Por defecto «Todavía no hay fotos ni videos.» */
  emptyMessage?: string
  className?: string
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function MediaGrid({
  items,
  groups,
  onOpen,
  selectable = false,
  selectedIds = [],
  onSelectedIdsChange,
  emptyMessage = 'Todavía no hay fotos ni videos.',
  className,
}: MediaGridProps) {
  const sections: MediaGridGroup[] = groups ?? [
    { id: 'all', title: '', items: items ?? [] },
  ]
  const hasGroups = groups !== undefined
  const selected = new Set(selectedIds)

  // Posición de cada archivo en la lista plana.
  const flatIndex = new Map<string, number>()
  let counter = 0
  for (const section of sections) {
    for (const item of section.items) flatIndex.set(item.id, counter++)
  }

  function setSelection(next: Set<string>) {
    onSelectedIdsChange?.(Array.from(next))
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection(next)
  }

  function toggleGroup(group: MediaGridGroup) {
    const selectable = group.items.filter((item) => !item.unavailable)
    const all = selectable.every((item) => selected.has(item.id))
    const next = new Set(selected)
    for (const item of selectable) {
      if (all) next.delete(item.id)
      else next.add(item.id)
    }
    setSelection(next)
  }

  if (counter === 0) {
    return (
      <p
        data-slot="media-grid"
        className={cn('py-6 text-center text-[13px] text-text-2', className)}
      >
        {emptyMessage}
      </p>
    )
  }

  return (
    <div
      data-slot="media-grid"
      className={cn('flex flex-col gap-5', className)}
    >
      {sections.map((section) => {
        const selectableItems = section.items.filter(
          (item) => !item.unavailable,
        )
        const allSelected =
          selectableItems.length > 0 &&
          selectableItems.every((item) => selected.has(item.id))
        return (
          <section
            key={section.id}
            aria-label={hasGroups ? section.title : undefined}
            className="flex flex-col gap-2"
          >
            {hasGroups && (
              <header className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[13px] font-semibold text-text">
                    {section.title}
                  </h3>
                  {section.subtitle && (
                    <p className="truncate text-[12px] text-text-2 tabular-nums">
                      {section.subtitle}
                    </p>
                  )}
                </div>
                {selectable && selectableItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(section)}
                    className="min-h-11 shrink-0 rounded-md px-2 text-[12.5px] font-semibold text-primary-800 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    {allSelected ? 'Quitar selección' : 'Seleccionar todo'}
                  </button>
                )}
              </header>
            )}
            <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {section.items.map((item) => (
                <GridCell
                  key={item.id}
                  item={item}
                  selectable={selectable && !item.unavailable}
                  selected={selected.has(item.id)}
                  onToggle={() => toggle(item.id)}
                  onOpen={() => onOpen?.(item, flatIndex.get(item.id) ?? 0)}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function GridCell({
  item,
  selectable,
  selected,
  onToggle,
  onOpen,
}: {
  item: MediaItem
  selectable: boolean
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const unavailable = item.unavailable
  return (
    <li
      className={cn(
        'relative aspect-square overflow-hidden rounded-md bg-secondary',
        selected && 'ring-3 ring-primary',
      )}
    >
      {unavailable ? (
        <div
          className="grid size-full place-content-center gap-1 px-1 text-center text-text-2"
          title={item.unavailableNote}
        >
          <ImageOff aria-hidden="true" className="mx-auto size-5" />
          <span className="text-[11.5px] leading-tight font-semibold">
            {unavailable === 'expired'
              ? 'Vencida'
              : unavailable === 'deleted'
                ? 'Eliminada'
                : 'Quitada'}
          </span>
          {item.unavailableNote && (
            <span className="text-[10.5px] leading-tight">
              {item.unavailableNote}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={item.label}
          className="absolute inset-0 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {item.thumbUrl ? (
            <img
              src={item.thumbUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className="size-full object-cover"
            />
          ) : (
            <span className="block size-full animate-pulse bg-secondary" />
          )}
        </button>
      )}

      {item.kind === 'video' && !unavailable && (
        <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-full bg-dark/80 px-2 py-0.5 text-[11.5px] font-semibold text-white tabular-nums">
          <Play aria-hidden="true" className="size-3 fill-white" />
          {item.durationSeconds != null
            ? formatDuration(item.durationSeconds)
            : 'Video'}
        </span>
      )}

      {item.keep && !unavailable && (
        <span
          title="Conservada"
          className="pointer-events-none absolute right-1 bottom-1 grid size-6 place-content-center rounded-full bg-primary-800 text-white"
        >
          <Pin aria-hidden="true" className="size-3" />
          <span className="sr-only">Conservada</span>
        </span>
      )}

      {selectable && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Seleccionar ${item.label}`}
          onClick={onToggle}
          className="group absolute top-0 left-0 grid size-11 place-content-center outline-none"
        >
          <span
            className={cn(
              'grid size-6 place-content-center rounded-full border-2 border-white bg-dark/50 text-white shadow-sm group-focus-visible:ring-3 group-focus-visible:ring-ring',
              selected && 'border-primary bg-primary',
            )}
          >
            {selected && (
              <Check aria-hidden="true" className="size-3.5 stroke-3" />
            )}
          </span>
        </button>
      )}
    </li>
  )
}
