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
import { certificateLabel } from '@/lib/absenceReasons'
import { formatMinutes, formatTime } from '@/lib/format'
import type { AttendanceBoardRow } from '@/api/attendance'
import type { Role } from '@/api/users'
import { useAuth } from '@/features/auth/AuthProvider'
import { getAttendanceRowBadge } from '@/features/attendance/derive'
import {
  buildAttendanceEntries,
  entryCheckIn,
  entryCheckOut,
  entryFranja,
  personSignerLabel,
  printRoleLabels,
  sumWorkdayMinutes,
  sumWorkedMinutes,
  type AttendanceDetailEntry,
  type AttendanceSheetPerson,
} from '@/features/attendance/detailSheet'
import { useEmployeeAttendanceHistoryQuery } from '@/features/attendance/queries'
import { useEmployeeLeavesQuery } from '@/features/employees/queries'
import { useSupervisorWorkdaysQuery } from '@/features/workdays/queries'
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
import { GeoValidationCell } from '@/features/geo/components/GeoValidationCell'
import { timeCorrectedSuffix } from '@/features/geo/outsideZone'
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
    return `${kindLabel}: "${text}" (${certificateLabel(row.lastNoticeHasCertificate)})`
  }
  if (row.lastNoticeKind === 'absence') {
    const certificate = certificateLabel(row.lastNoticeHasCertificate)
    if (row.lastNoticeReasonCode) {
      return `${kindLabel}: ${ABSENCE_REASON_LABELS[row.lastNoticeReasonCode]} (${certificate})`
    }
    return `${kindLabel} (${certificate})`
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
    dni?: string | null
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
 * membretada imprimible; solo dueño y administradores).
 *
 * P24.4 (CJ-14, CJ-34): las horas de un coordinador son las de su jornada,
 * no la suma de sus supervisiones. La tabla lista solo los servicios como
 * empleado; si la persona es coordinadora, el total del período suma además
 * las horas netas de sus jornadas (`v_supervisor_workdays_admin`) y la hoja
 * imprimible lleva una sección por rol, con la suma al final.
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
  // Un coordinador que no es empleado no tiene turnos como empleado en la hoja.
  const includeServices = person.roles.includes('employee') || !isSupervisor

  const today = todayInBuenosAires()
  const [from, setFrom] = useState(addDaysToIsoDate(today, -DEFAULT_RANGE_DAYS))
  const [to, setTo] = useState(today)
  const [pagination, setPagination] = useState<DataTablePagination>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [isSheetOpen, setSheetOpen] = useState(false)

  const historyQuery = useEmployeeAttendanceHistoryQuery(profileId, from, to)
  const leavesQuery = useEmployeeLeavesQuery(profileId)
  const workdaysQuery = useSupervisorWorkdaysQuery(
    { supervisorId: profileId, dateFrom: from, dateTo: to },
    isSupervisor && canDownload && from <= to,
  )
  // La capa de datos las trae de la más nueva a la más vieja; la ficha las lleva en orden cronológico.
  const workdays = useMemo(
    () =>
      [...(workdaysQuery.data ?? [])].sort((a, b) =>
        a.workDate.localeCompare(b.workDate),
      ),
    [workdaysQuery.data],
  )

  const entries = useMemo(
    () => buildAttendanceEntries(historyQuery.data ?? []),
    [historyQuery.data],
  )
  const servicesMinutes = sumWorkedMinutes(entries)
  const workdaysMinutes = sumWorkdayMinutes(workdays)
  const totalMinutes = servicesMinutes + workdaysMinutes
  const isLoading =
    historyQuery.isLoading ||
    (canDownload && leavesQuery.isLoading) ||
    (isSupervisor && canDownload && workdaysQuery.isLoading)

  const pageRows = entries.slice(
    pagination.pageIndex * pagination.pageSize,
    pagination.pageIndex * pagination.pageSize + pagination.pageSize,
  )

  const sheetPerson = useMemo<AttendanceSheetPerson>(() => {
    const roleLabels = printRoleLabels(person.roles)
    return {
      name: person.name,
      dni: person.dni,
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
          to={`/admin/turnos/${row.original.row.shiftId}`}
          className="font-semibold text-text capitalize hover:text-primary-800"
        >
          {formatDateOnly(row.original.date)}
        </Link>
      ),
    },
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
        return value
          ? `${formatTime(value)}${timeCorrectedSuffix(row.original.row.checkInGeo)}`
          : '—'
      },
    },
    {
      id: 'checkOut',
      header: 'Fin',
      meta: { card: 'meta', cardLabel: 'Fin' },
      cell: ({ row }) => {
        const value = entryCheckOut(row.original)
        return value
          ? `${formatTime(value)}${timeCorrectedSuffix(row.original.row.checkOutGeo)}`
          : '—'
      },
    },
    {
      id: 'geo',
      header: 'Validación',
      meta: { card: 'meta', cardLabel: 'Validación' },
      cell: ({ row }) => (
        <GeoValidationCell
          checkIn={row.original.row.checkInGeo}
          checkOut={row.original.row.checkOutGeo}
        />
      ),
    },
    {
      id: 'workedHours',
      header: 'Horas trabajadas',
      meta: { card: 'meta', cardLabel: 'Horas trabajadas' },
      cell: ({ row }) => (
        <WorkedHoursCell
          workedMinutes={row.original.row.workedMinutes}
          plannedMinutes={row.original.row.plannedMinutes}
          minutesEarlyLeave={row.original.row.minutesEarlyLeave}
          checkInAt={row.original.row.checkInAt}
          checkOutAt={row.original.row.checkOutAt}
          displayStatus={row.original.row.displayStatus}
        />
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'meta', cardLabel: 'Estado' },
      cell: ({ row }) => (
        <StatusBadge {...getAttendanceRowBadge(row.original.row)} />
      ),
    },
    {
      id: 'notice',
      header: 'Aviso',
      meta: { card: 'meta', cardLabel: 'Aviso' },
      cell: ({ row }) => noticeLabel(row.original.row),
    },
    {
      id: 'notes',
      header: 'Observación',
      meta: { card: 'meta', cardLabel: 'Observación' },
      cell: ({ row }) => row.original.row.notes ?? '—',
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
            className="w-56"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-2">Hasta</span>
          <DatePicker
            aria-label="Hasta"
            value={isoDateToDate(to)}
            onValueChange={(next) => next && setTo(localDateToIsoDate(next))}
            className="w-56"
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
            {isSupervisor && canDownload && !isLoading && (
              <span className="block text-[11px] text-text-3">
                {includeServices &&
                  `Como empleado ${formatMinutes(servicesMinutes)} · `}
                Como coordinador (jornadas) {formatMinutes(workdaysMinutes)}
              </span>
            )}
          </div>
          {canDownload && (
            <Button
              variant="ghost"
              icon={FileText}
              disabled={isLoading || workdaysQuery.isError}
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
          leaves={leavesQuery.data}
          workdays={isSupervisor ? workdays : undefined}
          includeServices={includeServices}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  )
}

export { EmployeeAttendanceHistoryTab }
