import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MonthPicker } from '@/components/MonthPicker'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CronogramaGrid,
  type CronogramaPerson,
} from '@/features/employees/components/CronogramaGrid'
import { CalendarioMonthEditor } from '@/features/employees/components/CalendarioMonthEditor'
import { PrintSheet } from '@/features/print/PrintSheet'
import {
  useEmployeeUpcomingAssignmentsQuery,
  useShiftsBoardRangeQuery,
} from '@/features/planning/queries'
import { useEmployeeLeavesQuery } from '@/features/employees/queries'
import { useHolidaysQuery } from '@/features/settings/queries'
import { buildCronogramaMonth } from '@/features/employees/cronograma'
import {
  formatMonthParam,
  resolveMonth,
} from '@/features/employees/calendarioMonth'
import { buildWeekBlocks } from '@/features/employees/cronogramaWeek'

/**
 * Pestaña «Calendario» de ADM-17 (OD-01 a OD-03, OH-04, OH-05). Muestra, mes
 * por mes, todo lo cargado en el calendario para el empleado (turnos no
 * cancelados, también los futuros), sus licencias y los feriados con el modelo
 * en papel de la empresa, y quien administra turnos lo edita ahí mismo.
 * «Imprimir» abre la hoja en A4 horizontal, igual que siempre.
 *
 * El mes elegido vive en la dirección (`mes=2027-01`, lo guarda la página con
 * `replace`): al abrir un turno y volver se queda en el mismo mes.
 */
function EmployeeCalendarioTab({
  profileId,
  person,
  canEdit = false,
  monthParam,
  onMonthChange,
}: {
  profileId: string
  person: CronogramaPerson
  /** Dueño o administrador con permiso sobre turnos y horarios: habilita la edición. */
  canEdit?: boolean
  /** `YYYY-MM` de la dirección; `null` o roto = mes actual. */
  monthParam?: string | null
  onMonthChange?: (monthParam: string) => void
}) {
  const [localParam, setLocalParam] = useState<string | null>(null)
  const effectiveParam = onMonthChange ? (monthParam ?? null) : localParam
  const { year, month: monthNumber } = resolveMonth(effectiveParam, new Date())
  const monthDate = useMemo(
    () => new Date(year, monthNumber - 1, 1),
    [year, monthNumber],
  )
  const [printing, setPrinting] = useState(false)

  function changeMonth(date: Date) {
    const next = formatMonthParam(date.getFullYear(), date.getMonth() + 1)
    if (onMonthChange) {
      onMonthChange(next)
    } else {
      setLocalParam(next)
    }
  }

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
  // Los turnos del mes (todos) hacen falta para editar: dotación, turnos sin cubrir y destinos.
  const shiftsQuery = useShiftsBoardRangeQuery(first, last, {}, canEdit)

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
  const allShifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data])
  const blocks = useMemo(
    () => buildWeekBlocks(assignmentsQuery.data ?? [], allShifts),
    [assignmentsQuery.data, allShifts],
  )

  const isLoading =
    assignmentsQuery.isLoading ||
    leavesQuery.isLoading ||
    holidaysQuery.isLoading ||
    (canEdit && shiftsQuery.isLoading)
  const hasError =
    assignmentsQuery.isError ||
    leavesQuery.isError ||
    holidaysQuery.isError ||
    (canEdit && shiftsQuery.isError)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker
          value={monthDate}
          onValueChange={changeMonth}
          aria-label="Mes del calendario"
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
          No pudimos cargar el calendario. Probá de nuevo en un momento.
        </p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <CalendarioMonthEditor
          profileId={profileId}
          personName={person.name}
          month={month}
          blocks={blocks}
          allShifts={allShifts}
          canEdit={canEdit}
        />
      )}

      {printing && (
        <PrintSheet
          documentTitle={`Calendario - ${person.name} - ${month.title}`}
          onClose={() => setPrinting(false)}
          orientation="landscape"
        >
          <CronogramaGrid month={month} person={person} />
        </PrintSheet>
      )}
    </div>
  )
}

export { EmployeeCalendarioTab }
