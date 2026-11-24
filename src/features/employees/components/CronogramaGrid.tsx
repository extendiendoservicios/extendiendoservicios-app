import { clientChipColors } from '@/features/planning/clientColors'
import {
  CRONOGRAMA_WEEKDAYS,
  type CronogramaDay,
  type CronogramaMonth,
  type CronogramaNote,
  type CronogramaShift,
} from '@/features/employees/cronograma'

export interface CronogramaPerson {
  employeeNumber: number
  name: string
}

/** Un turno: casillas de inicio y fin y, debajo, la franja con la sede en el color del cliente. */
function ShiftBlock({ shift }: { shift: CronogramaShift }) {
  const colors = clientChipColors(shift.colorIndex)
  return (
    <div className="print-keep-together flex flex-col" data-testid="turno">
      <div className="grid grid-cols-2 gap-px">
        <span className="border border-neutral-500 px-0.5 text-center text-[11px] leading-4 tabular-nums">
          {shift.start}
        </span>
        <span className="border border-neutral-500 px-0.5 text-center text-[11px] leading-4 tabular-nums">
          {shift.end}
        </span>
      </div>
      <span
        data-testid="sede"
        className="border border-t-0 border-neutral-500 px-0.5 text-center text-[10px] leading-[14px] font-bold [overflow-wrap:anywhere]"
        style={
          colors
            ? {
                backgroundColor: colors.background,
                color: colors.color,
                borderColor: colors.dot,
              }
            : { backgroundColor: '#e5e7eb', color: '#111827' }
        }
      >
        {shift.site}
      </span>
    </div>
  )
}

/** D-08: una observación del día, con su color; sale en la hoja impresa. */
function NoteBlock({ note }: { note: CronogramaNote }) {
  const colors = clientChipColors(note.colorIndex)
  return (
    <p
      data-testid="observacion"
      className="print-keep-together border border-neutral-500 px-0.5 text-[10px] leading-[14px] whitespace-pre-wrap [overflow-wrap:anywhere]"
      style={
        colors
          ? {
              backgroundColor: colors.background,
              color: colors.color,
              borderColor: colors.dot,
            }
          : { backgroundColor: '#e5e7eb', color: '#111827' }
      }
    >
      {note.body}
    </p>
  )
}

function DayCell({ day }: { day: CronogramaDay }) {
  const fullCell = day.kind === 'leave' || day.kind === 'holiday'
  const background =
    day.kind === 'holiday'
      ? 'bg-[#dc2626] text-white'
      : day.kind === 'leave'
        ? 'bg-neutral-300 text-black'
        : day.inMonth
          ? 'bg-white text-black'
          : 'bg-neutral-100 text-neutral-400'
  return (
    <td
      data-testid={`dia-${day.date}`}
      data-kind={day.inMonth ? day.kind : 'fuera'}
      className={`print-exact h-[21mm] border border-neutral-700 p-0 align-top ${background}`}
    >
      <div className="flex h-full min-h-[21mm]">
        <span className="w-5 shrink-0 border-r border-neutral-500 pt-0.5 text-center text-[11px] font-bold tabular-nums">
          {day.inMonth ? day.day : ''}
        </span>
        {fullCell ? (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              className={`flex items-center justify-center px-1 text-center text-[12px] font-bold [overflow-wrap:anywhere] ${
                day.notes.length > 0 ? 'pt-1' : 'flex-1'
              }`}
            >
              {day.label}
            </span>
            {day.notes.length > 0 && (
              <div className="flex min-w-0 flex-col gap-0.5 p-0.5 text-black">
                {day.notes.map((note) => (
                  <NoteBlock key={note.id} note={note} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-0.5">
            {day.holiday && (
              <span className="print-exact bg-[#dc2626] text-center text-[10px] leading-4 font-bold text-white">
                FERIADO
              </span>
            )}
            {day.shifts.map((shift) => (
              <ShiftBlock key={shift.key} shift={shift} />
            ))}
            {day.notes.map((note) => (
              <NoteBlock key={note.id} note={note} />
            ))}
          </div>
        )}
      </div>
    </td>
  )
}

/**
 * Hoja impresa del calendario (OD-01, OH-04): encabezado «MES DE …», líneas de firma,
 * «<legajo> <NOMBRE>» y la grilla de lunes a domingo. Es la misma pieza en la
 * pestaña y en la vista de impresión: se ve igual en pantalla y en papel.
 */
function CronogramaGrid({
  month,
  person,
}: {
  month: CronogramaMonth
  person: CronogramaPerson
}) {
  return (
    <div
      data-testid="cronograma"
      className="min-w-[860px] font-mono text-black"
    >
      <h2 className="text-[16px] font-bold">{month.title}</h2>
      <p className="mt-1 text-[12px] font-bold">
        FIRMA DE EMPLEADO: ______________________ ACLARACIÓN:
        ______________________ DNI: ______________
      </p>
      <p className="mt-1 mb-1.5 text-[14px] font-bold">
        {person.employeeNumber} {person.name.toUpperCase()}
      </p>
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
            <tr key={week[0]?.date}>
              {week.map((day) => (
                <DayCell key={day.date} day={day} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { CronogramaGrid }
