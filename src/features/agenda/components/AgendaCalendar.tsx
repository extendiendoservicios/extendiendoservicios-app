import { cn } from 'cn'
import type { AgendaItem } from '@/api/agenda'
import { agendaBlockStyle } from '../agendaColors'
import { eventSummary, type AgendaGridWeek } from '../agendaMonth'

export const WEEKDAY_LABELS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const

interface AgendaCalendarProps {
  weeks: AgendaGridWeek[]
  /** Hoy (`YYYY-MM-DD`), para resaltar el número. */
  today: string
  onOpenDay: (date: string) => void
}

/** Un evento como bloquecito de la celda, con su borde y relleno (AG-04). */
function EventBlock({ item }: { item: AgendaItem }) {
  return (
    <span
      className="block truncate rounded-sm border border-border bg-bg px-1.5 py-0.5 text-[11px] leading-snug"
      style={agendaBlockStyle(item.borderColor, item.fillColor)}
      title={eventSummary(item)}
    >
      {eventSummary(item) || 'Evento'}
    </span>
  )
}

/**
 * Calendario mensual de lunes a domingo (AG-04). El número de día es
 * automático, los feriados van en rojo, los días de otros meses atenuados y
 * cada celda muestra sus eventos como bloques con «+N» si no entran. Tocar
 * una celda abre el popup del día.
 */
function AgendaCalendar({ weeks, today, onOpenDay }: AgendaCalendarProps) {
  return (
    <div
      role="grid"
      aria-label="Calendario del mes"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div role="row" className="grid grid-cols-7 border-b border-border bg-bg">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            role="columnheader"
            className="px-2 py-1.5 text-center text-[11px] font-semibold text-text-2"
          >
            {label}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div
          key={week[0]?.date}
          role="row"
          className="grid grid-cols-7 border-b border-border last:border-b-0"
        >
          {week.map((day) => (
            <button
              key={day.date}
              type="button"
              role="gridcell"
              onClick={() => onOpenDay(day.date)}
              aria-label={`${day.dayNumber}${day.holidayName ? `, feriado: ${day.holidayName}` : ''}, ${day.events.length} ${day.events.length === 1 ? 'evento' : 'eventos'}`}
              className={cn(
                'flex min-h-24 flex-col items-stretch gap-1 border-r border-border p-1.5 text-left outline-none last:border-r-0 hover:bg-bg focus-visible:ring-3 focus-visible:ring-ring',
                !day.isCurrentMonth && 'bg-bg/60 opacity-50',
              )}
            >
              <span
                className={cn(
                  'text-[12px] font-semibold',
                  day.isHoliday ? 'text-danger' : 'text-text',
                  day.date === today &&
                    'inline-flex size-5 items-center justify-center self-start rounded-full bg-primary text-white',
                )}
                title={day.holidayName ?? undefined}
              >
                {day.dayNumber}
              </span>
              {day.shownEvents.map((event) => (
                <EventBlock key={event.id} item={event} />
              ))}
              {day.hiddenCount > 0 && (
                <span className="text-[11px] font-semibold text-text-2">
                  +{day.hiddenCount}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export { AgendaCalendar, EventBlock }
