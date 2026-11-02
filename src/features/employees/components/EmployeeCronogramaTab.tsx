import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MonthPicker } from '@/components/MonthPicker'
import { Skeleton } from '@/components/ui/skeleton'
import { PrintSheet } from '@/features/print/PrintSheet'
import { clientChipColors } from '@/features/planning/clientColors'
import { useEmployeeUpcomingAssignmentsQuery } from '@/features/planning/queries'
import { useEmployeeLeavesQuery } from '@/features/employees/queries'
import { useHolidaysQuery } from '@/features/settings/queries'
import {
  buildCronogramaMonth,
  CRONOGRAMA_WEEKDAYS,
  type CronogramaDay,
  type CronogramaMonth,
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
          <span className="flex flex-1 items-center justify-center px-1 text-center text-[12px] font-bold [overflow-wrap:anywhere]">
            {day.label}
          </span>
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
          </div>
        )}
      </div>
    </td>
  )
}

/**
 * Hoja del cronograma (OD-01): encabezado «MES DE …», líneas de firma,
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

/**
 * OD-01 a OD-03: pestaña «Cronograma» de ADM-17. Muestra, mes por mes, todo
 * lo cargado en el calendario para el empleado (turnos no cancelados, también
 * los futuros), sus licencias y los feriados, con el modelo en papel de la
 * empresa. «Imprimir» abre la misma hoja en A4 horizontal.
 */
function EmployeeCronogramaTab({
  profileId,
  person,
}: {
  profileId: string
  person: CronogramaPerson
}) {
  const [monthDate, setMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  )
  const [printing, setPrinting] = useState(false)
  const year = monthDate.getFullYear()
  const monthNumber = monthDate.getMonth() + 1

  const first = `${year}-${String(monthNumber).padStart(2, '0')}-01`
  const last = `${year}-${String(monthNumber).padStart(2, '0')}-${String(
    new Date(year, monthNumber, 0).getDate(),
  ).padStart(2, '0')}`
  const assignmentsQuery = useEmployeeUpcomingAssignmentsQuery(
    profileId,
    first,
    last,
  )
  const leavesQuery = useEmployeeLeavesQuery(profileId)
  const holidaysQuery = useHolidaysQuery(year)

  const month = useMemo(
    () =>
      buildCronogramaMonth({
        year,
        month: monthNumber,
        assignments: assignmentsQuery.data ?? [],
        leaves: leavesQuery.data ?? [],
        holidays: holidaysQuery.data ?? [],
      }),
    [
      year,
      monthNumber,
      assignmentsQuery.data,
      leavesQuery.data,
      holidaysQuery.data,
    ],
  )

  const isLoading =
    assignmentsQuery.isLoading ||
    leavesQuery.isLoading ||
    holidaysQuery.isLoading
  const hasError =
    assignmentsQuery.isError || leavesQuery.isError || holidaysQuery.isError

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker
          value={monthDate}
          onValueChange={setMonthDate}
          aria-label="Mes del cronograma"
        />
        <Button
          icon={Printer}
          variant="dark"
          disabled={isLoading || hasError}
          onClick={() => setPrinting(true)}
        >
          Imprimir
        </Button>
      </div>

      {hasError ? (
        <p role="alert" className="text-[13px] text-danger">
          No pudimos cargar el cronograma. Probá de nuevo en un momento.
        </p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-white p-3">
          <CronogramaGrid month={month} person={person} />
        </div>
      )}

      {printing && (
        <PrintSheet
          documentTitle={`Cronograma - ${person.name} - ${month.title}`}
          onClose={() => setPrinting(false)}
          orientation="landscape"
        >
          <CronogramaGrid month={month} person={person} />
        </PrintSheet>
      )}
    </div>
  )
}

export { CronogramaGrid, EmployeeCronogramaTab }
