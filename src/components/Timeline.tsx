import { cn } from 'cn'

/**
 * Timeline (DS-011): `07` sección 2.4 — puntos `on`, `ok` y `crit`
 * (`.tl`/`.tl-i`/`.tl-t`/`.tl-s`, `Mockup/assets/ds2.css`). Historial de una
 * asignación (avisos, inicio, fin) en ADM-06.
 *
 * Un cuarto estado sin marcar (`pending`, sin clase modificadora en el
 * mockup: círculo hueco con borde `--border-strong`) sirve para eventos
 * todavía no ocurridos de un turno en curso.
 */
type TimelineItemVariant = 'pending' | 'on' | 'ok' | 'crit'

// Nota: las clases van completas y literales (no armadas con template
// strings) porque el analizador de Tailwind busca el texto tal cual en el
// código fuente — una clase compuesta en tiempo de ejecución (`before:${c}`)
// no aparece nunca en el archivo y no se generaría.
const DOT_VARIANT_CLASSES: Record<TimelineItemVariant, string> = {
  pending: 'before:border-border-strong before:bg-surface',
  on: 'before:border-primary before:bg-primary',
  ok: 'before:border-success before:bg-success',
  crit: 'before:border-danger before:bg-danger',
}

interface TimelineItem {
  id: string
  title: string
  /** Hora u otro dato corto ("08:02", "Hace 12 min"). */
  description?: string
  variant?: TimelineItemVariant
}

interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

function Timeline({ items, className }: TimelineProps) {
  return (
    <div className={cn('relative pl-[22px]', className)}>
      {/* Línea vertical (`.tl::before`, ds2.css). */}
      <div
        aria-hidden="true"
        className="absolute top-[6px] bottom-2 left-[6px] w-[2px] bg-border"
      />
      <ol className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              'relative pb-[15px] last:pb-0',
              'before:absolute before:top-1 before:-left-[19px] before:size-[10px] before:rounded-full before:border-[2.5px]',
              DOT_VARIANT_CLASSES[item.variant ?? 'pending'],
            )}
          >
            <p className="text-[12.5px] leading-[1.3] font-semibold text-text">
              {item.title}
            </p>
            {item.description && (
              <p className="mt-[2px] text-[11.5px] leading-[1.4] text-text-3">
                {item.description}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

export { Timeline }
export type { TimelineItem, TimelineItemVariant }
