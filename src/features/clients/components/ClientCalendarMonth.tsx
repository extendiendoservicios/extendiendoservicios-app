import { useState, type ReactNode } from 'react'
import { CRONOGRAMA_WEEKDAYS } from '@/features/employees/cronograma'
import {
  visibleBlocks,
  type ClientCalendarBlock,
  type ClientCalendarDay,
  type ClientCalendarMonth as ClientCalendarMonthModel,
} from '@/features/clients/clientCalendar'
import { ClientShiftBlock } from '@/features/clients/components/ClientShiftBlock'

interface ClientCalendarMonthProps {
  month: ClientCalendarMonthModel
  /** Resalta los turnos sin cubrir (D-12). */
  highlightUncovered?: boolean
  /** P34.2 (D-02): quien edita; en P34.1 todo es lectura. */
  canEdit?: boolean
  /** P34.2 (D-10): el ⋮ de cada turno. */
  renderActions?: (block: ClientCalendarBlock) => ReactNode
  /** P34.2 (D-11): el «+» de cada día. */
  renderDayAction?: (day: ClientCalendarDay) => ReactNode
  /** Hoja impresa: todos los turnos, sin «+N más» ni enlaces. */
  printing?: boolean
}

/**
 * Hoja mensual del calendario del cliente (P34.1, D-04): la misma del empleado
 * (encabezado negro, lunes a domingo, días de otro mes atenuados, feriado con
 * su nombre en rojo en la cabecera del día), sin celdas de licencia.
 */
function ClientCalendarMonth({
  month,
  highlightUncovered = false,
  canEdit = false,
  renderActions,
  renderDayAction,
  printing = false,
}: ClientCalendarMonthProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

  function toggleDay(date: string) {
    setExpandedDays((current) => {
      const next = new Set(current)
      if (next.has(date)) {
        next.delete(date)
      } else {
        next.add(date)
      }
      return next
    })
  }

  function renderDay(day: ClientCalendarDay) {
    const expanded = printing || expandedDays.has(day.date)
    const { shown, hidden } = visibleBlocks(day.blocks, expanded)
    return (
      <td
        key={day.date}
        data-testid={`dia-${day.date}`}
        data-kind={day.inMonth ? (day.holiday ? 'holiday' : 'day') : 'fuera'}
        className={`print-exact min-h-[21mm] border border-neutral-700 p-0 align-top ${
          day.inMonth
            ? 'bg-white text-black'
            : 'bg-neutral-100 text-neutral-400'
        }`}
      >
        <div className="flex h-full min-h-[21mm] flex-col">
          {day.inMonth && (
            <div
              className={`print-exact flex items-center gap-1 px-1 text-[10px] leading-4 font-bold tabular-nums xl:text-[11px] ${
                day.holiday ? 'bg-[#dc2626] text-white' : ''
              }`}
            >
              <span>{day.day}</span>
              {day.holiday && (
                <span
                  data-testid="feriado"
                  className="min-w-0 flex-1 truncate text-right uppercase"
                  title={day.holiday}
                >
                  {day.holiday}
                </span>
              )}
              {!printing && renderDayAction && (
                <span className={day.holiday ? '' : 'ml-auto'}>
                  {renderDayAction(day)}
                </span>
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-0.5">
            {shown.map((block) => (
              <ClientShiftBlock
                key={block.shiftId}
                block={block}
                canEdit={canEdit}
                highlighted={highlightUncovered && block.uncovered}
                actions={printing ? undefined : renderActions?.(block)}
                printing={printing}
              />
            ))}
            {!printing && hidden > 0 && (
              <button
                type="button"
                className="text-left text-[10px] font-bold text-primary hover:underline"
                aria-expanded={false}
                onClick={() => toggleDay(day.date)}
              >
                +{hidden} más
              </button>
            )}
            {!printing && expandedDays.has(day.date) && (
              <button
                type="button"
                className="text-left text-[10px] font-bold text-primary hover:underline"
                aria-expanded
                onClick={() => toggleDay(day.date)}
              >
                Ver menos
              </button>
            )}
          </div>
        </div>
      </td>
    )
  }

  return (
    <div
      data-testid="calendario-cliente"
      className="min-w-[700px] font-mono text-black lg:min-w-0 print:min-w-[860px]"
    >
      <h2 className="mb-1.5 text-[16px] font-bold">{month.title}</h2>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {CRONOGRAMA_WEEKDAYS.map((weekday) => (
              <th
                key={weekday}
                scope="col"
                className="print-exact border border-neutral-700 bg-neutral-800 py-0.5 text-[11px] font-bold text-white"
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week) => (
            <tr key={week[0]?.date}>{week.map(renderDay)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { ClientCalendarMonth }
