import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from 'cn'
import {
  MONTH_NAMES,
  addMonths,
  fullDateLabel,
  isSelectable,
  monthRange,
} from './dates'

/**
 * Minicalendario de «Próximos días» (P32, D-05): un mes con flechas, un punto
 * en los días con turnos o servicios, el día elegido resaltado y los días
 * fuera de `min`..`max` deshabilitados. No deja navegar a meses sin días
 * habilitados. Es presentacional: el estado vive en la pantalla.
 */

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

export interface UpcomingCalendarProps {
  /** Mes que se ve, `"YYYY-MM"`. */
  month: string
  onMonthChange: (month: string) => void
  /** Día elegido, `"YYYY-MM-DD"`. */
  selected: string
  onSelect: (isoDate: string) => void
  /** Días con turnos o servicios (`"YYYY-MM-DD"`). */
  markedDates: ReadonlySet<string>
  /** Primer y último día elegibles. */
  min: string
  max: string
  /** Mientras carga el mes los puntos todavía no están. */
  loading?: boolean
}

export function UpcomingCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  markedDates,
  min,
  max,
  loading = false,
}: UpcomingCalendarProps) {
  const { to } = monthRange(month)
  const [year = 0, monthNumber = 1] = month.split('-').map(Number)
  const lastDay = Number(to.slice(8, 10))
  // Lunes = 0 ... domingo = 6.
  const offset =
    (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7
  const canGoBack = monthRange(addMonths(month, -1)).to >= min
  const canGoForward = monthRange(addMonths(month, 1)).from <= max

  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ]

  return (
    <section
      aria-label="Calendario de próximos días"
      aria-busy={loading}
      className="rounded-xl border border-border bg-surface p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          disabled={!canGoBack}
          aria-label="Mes anterior"
          className="flex size-11 items-center justify-center rounded-lg text-text outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-30"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <p
          aria-live="polite"
          className="text-[14px] font-bold text-text capitalize"
        >
          {MONTH_NAMES[monthNumber - 1]} {year}
        </p>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          disabled={!canGoForward}
          aria-label="Mes siguiente"
          className="flex size-11 items-center justify-center rounded-lg text-text outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-30"
        >
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((label, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="pb-1 text-center text-[11px] font-semibold text-text-3"
          >
            {label}
          </span>
        ))}
        {cells.map((day, index) => {
          if (day === null) {
            return <span key={`vacio-${index}`} />
          }
          const iso = `${month}-${String(day).padStart(2, '0')}`
          const enabled = isSelectable(iso, min, max)
          const isSelected = iso === selected
          const hasItems = markedDates.has(iso)
          return (
            <button
              key={iso}
              type="button"
              disabled={!enabled}
              onClick={() => onSelect(iso)}
              aria-label={`${fullDateLabel(iso)}${hasItems ? ', con servicios' : ''}`}
              aria-pressed={isSelected}
              aria-current={isSelected ? 'date' : undefined}
              data-has-items={hasItems ? 'true' : undefined}
              className={cn(
                'relative mx-auto flex size-11 flex-col items-center justify-center rounded-lg text-[13.5px] font-medium text-text outline-none focus-visible:ring-3 focus-visible:ring-ring',
                isSelected && 'bg-primary-800 text-white',
                !enabled && 'opacity-30',
              )}
            >
              {day}
              {hasItems && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute bottom-1 size-1.5 rounded-full',
                    isSelected ? 'bg-white' : 'bg-primary-800',
                  )}
                />
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
