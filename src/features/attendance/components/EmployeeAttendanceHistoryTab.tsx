import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/DatePicker'
import {
  DataTable,
  type DataTableColumnDef,
  type DataTablePagination,
} from '@/components/DataTable'
import { StatusBadge } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { formatMinutes, formatTime } from '@/lib/format'
import type { AttendanceBoardRow } from '@/api/attendance'
import type { Role } from '@/api/users'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/features/auth/session'
import { getAttendanceStatusBadgeInput } from '@/features/attendance/derive'
import {
  buildAttendanceEntries,
  ENTRY_KIND_LABELS,
  entryCheckIn,
  entryCheckOut,
  entryFranja,
  personSignerLabel,
  sumWorkedMinutes,
  type AttendanceDetailEntry,
  type AttendanceSheetPerson,
} from '@/features/attendance/detailSheet'
import { useEmployeeAttendanceHistoryQuery } from '@/features/attendance/queries'
import {
  ABSENCE_REASON_LABELS,
  NOTICE_KIND_LABELS,
} from '@/features/attendance/reasonLabels'
import { useSupervisionsAdminQuery } from '@/features/supervisions/queries'
import {
  addDaysToIsoDate,
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { AttendanceDetailSheet } from './AttendanceDetailSheet'
import { WorkedHoursCell } from './WorkedHoursCell'

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
  const text = row.lastNoticeReasonText?.trim()
  if (
    row.lastNoticeKind === 'absence' &&
    row.lastNoticeReasonCode === 'other' &&
    text
  ) {
    return `${kindLabel}: "${text}"`
  }
  if (row.lastNoticeKind === 'absence' && row.lastNoticeReasonCode) {
    return `${kindLabel}: ${ABSENCE_REASON_LABELS[row.lastNoticeReasonCode]}`
  }
  if (row.lastNoticeKind === 'delay' && row.lastNoticeMinutesLate != null) {
    return `${kindLabel}: ${row.lastNoticeMinutesLate} min`
  }
  return kindLabel
}

interface EmployeeAttendanceHistoryTabProps {
  profileId: string
  /** Datos de la persona para la hoja imprimible y para saber si es supervisor. */
  person: {
    name: string
    employeeNumber: number
    roles: Role[]
  }
}

/**
 * ADM-12 "Historial de asistencia del empleado" (ATT-013, `05` línea 51):
 * pestaña "asistencia" de ADM-17. Lista por fecha con turno, franja, inicio
 * y fin reales, horas trabajadas, avisos y observación. Rango de fechas
 * editable (por defecto los últimos 30 días); paginado en el cliente, mismo
 * criterio que `EmployeesPage`.
 *
 * AJ-06: arriba del detalle, en la misma fila que los selectores de fecha,
 * va el total de horas del período y el botón «Descargar detalle» (hoja
 * membretada imprimible; solo dueño y administradores). Si la persona es
 * supervisora, se suman sus supervisiones (`v_supervisions_admin`) al mismo
 * listado, distinguidas por la columna «Tipo» (Servicio / Supervisión).
 */
function EmployeeAttendanceHistoryTab({
  profileId,
  person,
}: EmployeeAttendanceHistoryTabProps) {
  const auth = useAuth()
  const canDownload = auth.roles.some(
    (role) => role === 'owner' || role === 'admin',
  )
  const isSupervisor = person.roles.includes('supervisor')

  const today = todayInBuenosAires()
  const [from, setFrom] = useState(addDaysToIsoDate(today, -DEFAULT_RANGE_DAYS))
  const [to, setTo] = useState(today)
  const [pagination, setPagination] = useState<DataTablePagination>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [isSheetOpen, setSheetOpen] = useState(false)

  const historyQuery = useEmployeeAttendanceHistoryQuery(profileId, from, to)
  const supervisionsQuery = useSupervisionsAdminQuery(
    { supervisorId: profileId, dateFrom: from, dateTo: to },
    false,
    isSupervisor,
  )

  const entries = useMemo(
    () =>
      buildAttendanceEntries(
        historyQuery.data ?? [],
        isSupervisor ? (supervisionsQuery.data ?? []) : [],
      ),
    [historyQuery.data, supervisionsQuery.data, isSupervisor],
  )
  const totalMinutes = sumWorkedMinutes(entries)
  const isLoading =
    historyQuery.isLoading || (isSupervisor && supervisionsQuery.isLoading)

  const pageRows = entries.slice(
    pagination.pageIndex * pagination.pageSize,
    pagination.pageIndex * pagination.pageSize + pagination.pageSize,
  )

  const sheetPerson = useMemo<AttendanceSheetPerson>(() => {
    const roleLabels = person.roles
      .filter((role) => role === 'employee' || role === 'supervisor')
      .map((role) => ROLE_LABELS[role])
    return {
      name: person.name,
      employeeNumber: person.employeeNumber,
      roleLabels,
      signerLabel: personSignerLabel(roleLabels),
    }
  }, [person])

  const columns: DataTableColumnDef<AttendanceDetailEntry>[] = [
    {
      id: 'date',
      header: 'Fecha',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={
            row.original.kind === 'service'
              ? `/admin/turnos/${row.original.row.shiftId}`
              : `/admin/supervisiones/${row.original.row.id}`
          }
          className="font-semibold text-text capitalize hover:text-primary-800"
        >
          {formatDateOnly(row.original.date)}
        </Link>
      ),
    },
    ...(isSupervisor
      ? [
          {
            id: 'kind',
            header: 'Tipo',
            meta: { card: 'trailing' },
            cell: ({ row }) => (
              <Badge
                variant={
                  row.original.kind === 'service' ? 'neutral' : 'primary'
                }
              >
                {ENTRY_KIND_LABELS[row.original.kind]}
              </Badge>
            ),
          } satisfies DataTableColumnDef<AttendanceDetailEntry>,
        ]
      : []),
    {
      id: 'client',
      header: 'Cliente · sede',
      meta: { card: 'subtitle' },
      cell: ({ row }) => (
        <span>
          {row.original.row.clientName} · {row.original.row.siteName}
        </span>
      ),
    },
    {
      id: 'schedule',
      header: 'Franja',
      meta: { card: 'meta', cardLabel: 'Franja' },
      cell: ({ row }) => entryFranja(row.original),
    },
    {
      id: 'checkIn',
      header: 'Inicio',
      meta: { card: 'meta', cardLabel: 'Inicio' },
      cell: ({ row }) => {
        const value = entryCheckIn(row.original)
        return value ? formatTime(value) : '—'
      },
    },
    {
      id: 'checkOut',
      header: 'Fin',
      meta: { card: 'meta', cardLabel: 'Fin' },
      cell: ({ row }) => {
        const value = entryCheckOut(row.original)
        return value ? formatTime(value) : '—'
      },
    },
    {
      id: 'workedHours',
      header: 'Horas trabajadas',
      meta: { card: 'meta', cardLabel: 'Horas trabajadas' },
      cell: ({ row }) => (
        <WorkedHoursCell
          workedMinutes={row.original.row.workedMinutes}
          plannedMinutes={row.original.row.plannedMinutes}
          minutesEarlyLeave={
            row.original.kind === 'service'
              ? row.original.row.minutesEarlyLeave
              : null
          }
          checkInAt={row.original.row.checkInAt}
          checkOutAt={row.original.row.checkOutAt}
        />
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'meta', cardLabel: 'Estado' },
      cell: ({ row }) =>
        row.original.kind === 'service' ? (
          <StatusBadge
            domain="assignment"
            {...getAttendanceStatusBadgeInput(row.original.row)}
          />
        ) : (
          <StatusBadge domain="supervision" status={row.original.row.status} />
        ),
    },
    {
      id: 'notice',
      header: 'Aviso',
      meta: { card: 'meta', cardLabel: 'Aviso' },
      cell: ({ row }) =>
        row.original.kind === 'service' ? noticeLabel(row.original.row) : '—',
    },
    {
      id: 'notes',
      header: 'Observación',
      meta: { card: 'meta', cardLabel: 'Observación' },
      cell: ({ row }) =>
        (row.original.kind === 'service'
          ? row.original.row.notes
          : row.original.row.generalNotes) ?? '—',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
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
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div
            className="rounded-lg border border-border bg-surface px-3 py-1.5"
            aria-label="Total de horas del período"
          >
            <span className="text-[11px] font-semibold text-text-2">
              Total del período{' '}
            </span>
            <span className="text-[15px] font-bold text-text tabular-nums">
              {isLoading ? '…' : formatMinutes(totalMinutes)}
            </span>
          </div>
          {canDownload && (
            <Button
              variant="ghost"
              icon={FileText}
              disabled={isLoading}
              onClick={() => setSheetOpen(true)}
            >
              Descargar detalle
            </Button>
          )}
        </div>
      </div>

      <DataTable
        caption="Historial de asistencia"
        columns={columns}
        data={pageRows}
        getRowId={(row) => row.key}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageCount={Math.ceil(entries.length / pagination.pageSize)}
        rowCount={entries.length}
        emptyState={{
          icon: CalendarClock,
          title: 'No hay asistencia para mostrar en este rango',
        }}
      />

      {isSheetOpen && (
        <AttendanceDetailSheet
          person={sheetPerson}
          from={from}
          to={to}
          entries={entries}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}

export { EmployeeAttendanceHistoryTab }
