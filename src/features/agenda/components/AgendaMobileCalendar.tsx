import { cn } from 'cn'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateOnly } from '@/features/settings/dateOnly'
import {
  eventSummary,
  type AgendaGridDay,
  type AgendaGridWeek,
} from '../agendaMonth'
import { agendaBlockStyle } from '../agendaColors'

interface AgendaMobileCalendarProps {
  weeks: AgendaGridWeek[]
  today: string
  onOpenDay: (date: string) => void
}

const SHORT_WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

/**
 * Calendario del celular (AG-20): una mini grilla del mes para saltar a un día
 * (los días con eventos llevan un punto) y, debajo, la lista de los días que
 * tienen eventos. Tocar un día abre el mismo popup del escritorio.
 */
function AgendaMobileCalendar({
  weeks,
  today,
  onOpenDay,
}: AgendaMobileCalendarProps) {
  const daysWithEvents = weeks
    .flat()
    .filter((day) => day.isCurrentMonth && day.events.length > 0)

  return (
    <div className="flex flex-col gap-3">
      <div
        role="grid"
        aria-label="Mini calendario del mes"
        className="rounded-lg border border-border bg-surface p-2"
      >
        <div role="row" className="grid grid-cols-7">
          {SHORT_WEEKDAYS.map((label, index) => (
            <div
              key={index}
              role="columnheader"
              className="py-1 text-center text-[11px] font-semibold text-text-3"
            >
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]?.date} role="row" className="grid grid-cols-7">
            {week.map((day) => (
              <MiniDay
                key={day.date}
                day={day}
                today={today}
                onOpenDay={onOpenDay}
              />
            ))}
          </div>
        ))}
      </div>

      {daysWithEvents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-4 text-center text-[13px] text-text-2">
          Este mes no tiene eventos. Tocá un día para agregar uno.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Días con eventos">
          {daysWithEvents.map((day) => (
            <li key={day.date}>
              <button
                type="button"
                onClick={() => onOpenDay(day.date)}
                className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    'text-[13px] font-semibold capitalize',
                    day.isHoliday ? 'text-danger' : 'text-text',
                  )}
                >
                  {formatDateOnly(day.date)}
                  {day.holidayName ? ` · ${day.holidayName}` : ''}
                </span>
                {day.events.map((event) => (
                  <span
                    key={event.id}
                    className="block rounded-sm border border-border bg-bg px-2 py-1 text-[12.5px] leading-snug"
                    style={agendaBlockStyle(event.borderColor, event.fillColor)}
                  >
                    {eventSummary(event) || 'Evento'}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="ghost"
        icon={Plus}
        onClick={() => onOpenDay(today)}
      >
        Agregar evento hoy
      </Button>
    </div>
  )
}

function MiniDay({
  day,
  today,
  onOpenDay,
}: {
  day: AgendaGridDay
  today: string
  onOpenDay: (date: string) => void
}) {
  return (
    <button
      type="button"
      role="gridcell"
      onClick={() => onOpenDay(day.date)}
      aria-label={`${day.dayNumber}${day.holidayName ? `, feriado` : ''}${day.events.length > 0 ? `, ${day.events.length} ${day.events.length === 1 ? 'evento' : 'eventos'}` : ''}`}
      className={cn(
        'relative flex h-11 flex-col items-center justify-center text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring',
        day.isHoliday ? 'text-danger' : 'text-text',
        !day.isCurrentMonth && 'opacity-40',
        day.date === today && 'rounded-full bg-primary/15 font-bold',
      )}
    >
      {day.dayNumber}
      {day.events.length > 0 && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 size-1.5 rounded-full bg-primary"
        />
      )}
    </button>
  )
}

export { AgendaMobileCalendar }
