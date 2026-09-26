import { useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock } from 'lucide-react'
import { DatePicker } from '@/components/DatePicker'
import {
  DataTable,
  type DataTableColumnDef,
  type DataTablePagination,
} from '@/components/DataTable'
import { StatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import type { AttendanceBoardRow } from '@/api/attendance'
import { getAttendanceStatusBadgeInput } from '@/features/attendance/derive'
import { useEmployeeAttendanceHistoryQuery } from '@/features/attendance/queries'
import {
  ABSENCE_REASON_LABELS,
  NOTICE_KIND_LABELS,
} from '@/features/attendance/reasonLabels'
import {
  addDaysToIsoDate,
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

const PAGE_SIZE = 20
const DEFAULT_RANGE_DAYS = 30

function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

function noticeLabel(row: AttendanceBoardRow): string {
  if (!row.lastNoticeKind) {
    return '—'
  }
  const kindLabel = NOTICE_KIND_LABELS[row.lastNoticeKind]
  if (row.lastNoticeKind === 'absence' && row.lastNoticeReasonCode) {
    return `${kindLabel}: ${ABSENCE_REASON_LABELS[row.lastNoticeReasonCode]}`
  }
  if (row.lastNoticeKind === 'delay' && row.lastNoticeMinutesLate != null) {
    return `${kindLabel}: ${row.lastNoticeMinutesLate} min`
  }
  return kindLabel
}

/**
 * ADM-12 "Historial de asistencia del empleado" (ATT-013, `05` línea 51):
 * pestaña "asistencia" de ADM-17. Lista por fecha con turno, franja, inicio
 * y fin reales, avisos y observación, sin totales (módulo F). Rango de
 * fechas editable (por defecto los últimos 30 días); paginado en el
 * cliente, mismo criterio que `EmployeesPage`.
 */
function EmployeeAttendanceHistoryTab({ profileId }: { profileId: string }) {
  const today = todayInBuenosAires()
  const [from, setFrom] = useState(addDaysToIsoDate(today, -DEFAULT_RANGE_DAYS))
  const [to, setTo] = useState(today)
  const [pagination, setPagination] = useState<DataTablePagination>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  const historyQuery = useEmployeeAttendanceHistoryQuery(profileId, from, to)
  const rows = historyQuery.data ?? []
  const pageRows = rows.slice(
    pagination.pageIndex * pagination.pageSize,
    pagination.pageIndex * pagination.pageSize + pagination.pageSize,
  )

  const columns: DataTableColumnDef<AttendanceBoardRow>[] = [
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
      id: 'schedule',
      header: 'Franja',
      meta: { card: 'meta', cardLabel: 'Franja' },
      cell: ({ row }) =>
        `${row.original.startTime.slice(0, 5)}–${row.original.endTime.slice(0, 5)}`,
    },
    {
      id: 'checkIn',
      header: 'Inicio',
      meta: { card: 'meta', cardLabel: 'Inicio' },
      cell: ({ row }) =>
        row.original.checkInAt ? formatTime(row.original.checkInAt) : '—',
    },
    {
      id: 'checkOut',
      header: 'Fin',
      meta: { card: 'meta', cardLabel: 'Fin' },
      cell: ({ row }) =>
        row.original.checkOutAt ? formatTime(row.original.checkOutAt) : '—',
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'meta', cardLabel: 'Estado' },
      cell: ({ row }) => (
        <StatusBadge
          domain="assignment"
          {...getAttendanceStatusBadgeInput(row.original)}
        />
      ),
    },
    {
      id: 'notice',
      header: 'Aviso',
      meta: { card: 'meta', cardLabel: 'Aviso' },
      cell: ({ row }) => noticeLabel(row.original),
    },
    {
      id: 'notes',
      header: 'Observación',
      meta: { card: 'meta', cardLabel: 'Observación' },
      cell: ({ row }) => row.original.notes ?? '—',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Desde</span>
          <DatePicker
            aria-label="Desde"
            value={isoDateToDate(from)}
            onValueChange={(next) => next && setFrom(localDateToIsoDate(next))}
            className="w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Hasta</span>
          <DatePicker
            aria-label="Hasta"
            value={isoDateToDate(to)}
            onValueChange={(next) => next && setTo(localDateToIsoDate(next))}
            className="w-44"
          />
        </div>
      </div>

      <DataTable
        caption="Historial de asistencia"
        columns={columns}
        data={pageRows}
        getRowId={(row) => row.id}
        isLoading={historyQuery.isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageCount={Math.ceil(rows.length / pagination.pageSize)}
        rowCount={rows.length}
        emptyState={{
          icon: CalendarClock,
          title: 'No hay asistencia para mostrar en este rango',
        }}
      />
    </div>
  )
}

export { EmployeeAttendanceHistoryTab }
