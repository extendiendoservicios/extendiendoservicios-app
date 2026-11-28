import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgendaItem } from '@/api/agenda'
import { PrintableLetterhead } from '@/features/print/PrintableLetterhead'
import '@/features/planning/components/calendarPrint.css'
import { agendaBlockStyle, noteVisibleFill } from '../agendaColors'
import {
  NEW_SLOTS,
  eventSummary,
  groupNewBySlot,
  newItemTitle,
  notesOf,
  type AgendaGridWeek,
} from '../agendaMonth'
import { formatBudget } from '../schemas'
import { WEEKDAY_LABELS } from './AgendaCalendar'

interface AgendaPrintButtonProps {
  /** «noviembre 2026». */
  monthLabel: string
  weeks: AgendaGridWeek[]
  items: AgendaItem[]
}

/** Lo que se ve en el papel de un evento: hora, trabajo, lugar y demás. */
function eventPrintLines(item: AgendaItem): string[] {
  return [
    [item.timeText, item.workType].filter(Boolean).join(' · '),
    item.place ?? '',
    item.clientPerson ?? '',
    item.people ?? '',
    item.observation ?? '',
  ].filter((line) => line !== '')
}

/**
 * Hoja impresa de la Agenda (AG-19): A4 apaisado con el membrete, el mes, el
 * calendario con sus eventos y colores, los Nuevos y las Notas. La lista diaria
 * y la calculadora no se imprimen. Los colores salen impresos
 * (`print-color-adjust: exact`, de `calendarPrint.css`).
 */
function AgendaPrintSheet({
  monthLabel,
  weeks,
  items,
}: AgendaPrintButtonProps) {
  const columns = groupNewBySlot(items)
  const notes = notesOf(items)
  const hasNew = columns.some((column) => column.length > 0)

  return (
    <div className="agenda-print text-[9pt]">
      <PrintableLetterhead
        title={`Agenda · ${monthLabel}`}
        issuedAt={new Date()}
      />
      <table aria-label="Calendario del mes">
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label) => (
              <th
                key={label}
                className="border border-black bg-neutral-100 px-1 py-0.5 text-[8pt]"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]?.date}>
              {week.map((day) => (
                <td
                  key={day.date}
                  className="h-[22mm] border border-black p-0.5 align-top"
                  style={{ opacity: day.isCurrentMonth ? 1 : 0.4 }}
                >
                  <div
                    className="text-[8pt] font-bold"
                    style={{ color: day.isHoliday ? '#c62828' : '#111' }}
                  >
                    {day.dayNumber}
                  </div>
                  {day.events.map((event) => (
                    <div
                      key={event.id}
                      className="mb-0.5 rounded-sm border border-neutral-400 px-0.5 text-[7pt] leading-tight"
                      style={agendaBlockStyle(
                        event.borderColor,
                        event.fillColor,
                      )}
                    >
                      {eventPrintLines(event).join(' / ') ||
                        eventSummary(event)}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {hasNew && (
        <section className="mt-3" style={{ breakInside: 'avoid' }}>
          <h2 className="mb-1 text-[10pt] font-bold">Nuevos</h2>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: NEW_SLOTS }, (_, slot) => (
              <div key={slot} className="flex flex-col gap-1">
                {(columns[slot] ?? []).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-sm border border-neutral-400 p-1 text-[7.5pt] leading-tight"
                    style={agendaBlockStyle(item.borderColor, item.fillColor)}
                  >
                    <p className="font-bold">{newItemTitle(item)}</p>
                    {item.clientName &&
                      item.clientName !== newItemTitle(item) && (
                        <p>{item.clientName}</p>
                      )}
                    {item.address && <p>{item.address}</p>}
                    {item.daysHours && <p>{item.daysHours}</p>}
                    {item.budget != null && (
                      <p>$ {formatBudget(item.budget)}</p>
                    )}
                    {item.observation && <p>{item.observation}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="mt-3" style={{ breakInside: 'avoid' }}>
          <h2 className="mb-1 text-[10pt] font-bold">Notas</h2>
          <ul className="flex flex-col gap-0.5">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-sm border border-neutral-300 px-1.5 py-0.5"
                style={{
                  ...agendaBlockStyle(note.borderColor, noteVisibleFill(note)),
                  whiteSpace: 'pre-wrap',
                }}
              >
                • {note.body}
                {note.resolved ? ' (resuelto)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** «Imprimir» (AG-19): monta la hoja en un portal y llama a `window.print()`. */
function AgendaPrintButton(props: AgendaPrintButtonProps) {
  const [printing, setPrinting] = useState(false)
  const title = `Agenda · ${props.monthLabel}`

  useEffect(() => {
    if (!printing) {
      return
    }
    const previousTitle = document.title
    document.title = title
    const finish = () => setPrinting(false)
    window.addEventListener('afterprint', finish)
    // Un cuadro después de montar la hoja, para que el navegador la dibuje.
    const frame = window.requestAnimationFrame(() => window.print())
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', finish)
      document.title = previousTitle
    }
  }, [printing, title])

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        icon={Printer}
        onClick={() => setPrinting(true)}
      >
        Imprimir
      </Button>
      {printing &&
        createPortal(
          // Misma clase que el calendario de Planificación: reusa su hoja A4 apaisada.
          <div className="calendar-print-portal" data-testid="agenda-print">
            <AgendaPrintSheet {...props} />
          </div>,
          document.body,
        )}
    </>
  )
}

export { AgendaPrintButton, AgendaPrintSheet }
