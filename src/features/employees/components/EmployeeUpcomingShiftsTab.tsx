import { Link } from 'react-router'
import { CalendarClock } from 'lucide-react'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { StatusBadge } from '@/components/status'
import type { AssignmentBoardRow } from '@/api/assignments'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useEmployeeUpcomingAssignmentsQuery } from '@/features/planning/queries'
import { addDaysToIsoDate, formatDateOnly } from '@/features/settings/dateOnly'
import { formatShiftRange } from '@/features/shifts/openEnded'

/** Ventana de la pestaña: hoy y los próximos 30 días (AJ3-04). */
export const UPCOMING_SHIFTS_DAYS = 30

/** Orden por fecha y hora de inicio (la consulta ya viene ordenada; esto lo garantiza). */
export function sortUpcomingAssignments(
  rows: AssignmentBoardRow[],
): AssignmentBoardRow[] {
  return [...rows].sort(
    (a, b) =>
      a.shiftDate.localeCompare(b.shiftDate) ||
      a.startTime.localeCompare(b.startTime),
  )
}

/**
 * AJ3-04, pestaña «Próximos turnos» de ADM-17: asignaciones vigentes de la
 * persona desde hoy (hora de Buenos Aires) y los próximos 30 días. Los turnos
 * cancelados se muestran con el estado «Cancelado» (gris tachado) en lugar de
 * esconderse, igual que en la planificación: así se ve que se cayó un turno
 * que la persona tenía asignado. Las asignaciones quitadas no aparecen.
 */
function EmployeeUpcomingShiftsTab({ profileId }: { profileId: string }) {
  const from = todayInBuenosAires()
  const to = addDaysToIsoDate(from, UPCOMING_SHIFTS_DAYS)
  const query = useEmployeeUpcomingAssignmentsQuery(profileId, from, to)
  const rows = sortUpcomingAssignments(query.data ?? [])

  const columns: DataTableColumnDef<AssignmentBoardRow>[] = [
    {
      id: 'date',
      header: 'Fecha',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={`/admin/turnos/${row.original.shiftId}`}
          className="font-semibold text-text capitalize hover:text-primary-800"
        >
          {formatDateOnly(row.original.shiftDate)}
        </Link>
      ),
    },
    {
      id: 'schedule',
      header: 'Horario',
      meta: { card: 'meta', cardLabel: 'Horario' },
      cell: ({ row }) =>
        formatShiftRange(
          row.original.startTime,
          row.original.endTime,
          row.original.openEnded,
        ),
    },
    {
      id: 'client',
      header: 'Cliente · sede',
      meta: { card: 'subtitle' },
      cell: ({ row }) => (
        <span>
          {row.original.clientName} · {row.original.siteName}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'trailing' },
      cell: ({ row }) => (
        <StatusBadge domain="shift" status={row.original.shiftStatus} />
      ),
    },
  ]

  return (
    <DataTable
      caption="Próximos turnos"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      isLoading={query.isLoading}
      emptyState={{
        icon: CalendarClock,
        title: 'No hay turnos próximos para mostrar',
        description: `Esta persona no tiene turnos asignados en los próximos ${UPCOMING_SHIFTS_DAYS} días.`,
      }}
    />
  )
}

export { EmployeeUpcomingShiftsTab }
