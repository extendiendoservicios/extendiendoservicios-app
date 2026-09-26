import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Phone, Search, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { DatePicker } from '@/components/DatePicker'
import { IconButton } from '@/components/IconButton'
import { PersonCell } from '@/components/PersonCell'
import { StatusBadge } from '@/components/status'
import { avatarUrl } from '@/lib/avatarUrl'
import { formatMinutes, formatTime } from '@/lib/format'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  addDaysToIsoDate,
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { AttendanceBoardRow } from '@/api/attendance'
import {
  getAttendanceStatusBadgeInput,
  getAvailableAttendanceActions,
} from '@/features/attendance/derive'
import { canManageAttendance } from '@/features/attendance/permissions'
import {
  useAttendanceBoardByDateQuery,
  useEmployeePhonesQuery,
} from '@/features/attendance/queries'
import { UpdatedAgo } from './UpdatedAgo'
import { RecordAttendanceSheet } from './RecordAttendanceSheet'

/** `"YYYY-MM-DD"` → `Date` para `DatePicker` (mismo criterio que `ShiftsDayList`). */
function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'expected', label: 'Esperado' },
  { value: 'delay_notified', label: 'Demora avisada' },
  { value: 'absence_notified', label: 'Ausencia avisada' },
  { value: 'present', label: 'Presente' },
  { value: 'finished', label: 'Finalizado' },
  { value: 'no_record', label: 'Sin registro' },
]

/**
 * ADM-10 "Asistencia de hoy" (ATT-011, ATT-012, `05` línea 49): tabla de
 * asignaciones de una fecha con estado de asistencia, filtros por estado,
 * cliente, sede y texto, fecha navegable, polling 30 s si la fecha es hoy.
 *
 * El filtro de sede se arma con las sedes presentes en la fecha elegida
 * (no hay una lista global de sedes en este dominio): decisión propia,
 * documentada en el reporte del encargo -- alcanza para un tablero por día.
 */
interface AttendanceTodayListProps {
  date: string
  onDateChange: (date: string) => void
}

function AttendanceTodayList({ date, onDateChange }: AttendanceTodayListProps) {
  const auth = useAuth()
  const canManage = canManageAttendance({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })

  const [textFilter, setTextFilter] = useState('')
  const debouncedText = useDebouncedValue(textFilter)
  const [statusFilter, setStatusFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [recordTarget, setRecordTarget] = useState<AttendanceBoardRow | null>(
    null,
  )

  const isToday = date === todayInBuenosAires()
  const boardQuery = useAttendanceBoardByDateQuery(
    date,
    {
      clientId: clientFilter === 'all' ? undefined : clientFilter,
      siteId: siteFilter === 'all' ? undefined : siteFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
    },
    isToday,
  )
  const rows = useMemo(() => boardQuery.data ?? [], [boardQuery.data])

  const employeeIds = useMemo(
    () => Array.from(new Set(rows.map((row) => row.employeeId))),
    [rows],
  )
  const phonesQuery = useEmployeePhonesQuery(employeeIds)

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      map.set(row.clientId, row.clientName)
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [rows])

  const siteOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      map.set(row.siteId, row.siteName)
    }
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [rows])

  const filteredRows = useMemo(() => {
    const text = debouncedText.trim().toLowerCase()
    if (!text) {
      return rows
    }
    return rows.filter((row) =>
      `${row.employeeFirstName} ${row.employeeLastName}`
        .toLowerCase()
        .includes(text),
    )
  }, [rows, debouncedText])

  const recordTargetActions = recordTarget
    ? getAvailableAttendanceActions({
        shiftStatus: recordTarget.shiftStatus,
        status: recordTarget.status,
        checkInAt: recordTarget.checkInAt,
        checkOutAt: recordTarget.checkOutAt,
        startsAt: recordTarget.startsAt,
      })
    : []

  const columns: DataTableColumnDef<AttendanceBoardRow>[] = [
    {
      id: 'employee',
      header: 'Empleado',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <PersonCell
          id={row.original.employeeId}
          name={`${row.original.employeeFirstName} ${row.original.employeeLastName}`}
          avatarSrc={
            row.original.employeeAvatarPath
              ? avatarUrl(row.original.employeeAvatarPath)
              : null
          }
        />
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
      header: 'Inicio real',
      meta: { card: 'meta', cardLabel: 'Inicio real' },
      cell: ({ row }) =>
        row.original.checkInAt ? formatTime(row.original.checkInAt) : '—',
    },
    {
      id: 'checkOut',
      header: 'Fin real',
      meta: { card: 'meta', cardLabel: 'Fin real' },
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
      id: 'earlyLeave',
      header: 'Salida anticipada',
      meta: { card: 'meta', cardLabel: 'Salida anticipada' },
      cell: ({ row }) =>
        row.original.minutesEarlyLeave != null &&
        row.original.minutesEarlyLeave > 0
          ? formatMinutes(row.original.minutesEarlyLeave)
          : '—',
    },
    {
      id: 'actions',
      header: 'Acciones',
      meta: { card: 'trailing' },
      cell: ({ row }) => {
        const rowActions = getAvailableAttendanceActions({
          shiftStatus: row.original.shiftStatus,
          status: row.original.status,
          checkInAt: row.original.checkInAt,
          checkOutAt: row.original.checkOutAt,
          startsAt: row.original.startsAt,
        })
        const phone = phonesQuery.data?.get(row.original.employeeId)
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to={`/admin/turnos/${row.original.shiftId}`}>
                Abrir turno
              </Link>
            </Button>
            {canManage && rowActions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRecordTarget(row.original)}
              >
                Registrar en nombre
              </Button>
            )}
            {phone && (
              <Button asChild variant="ghost" size="sm" icon={Phone}>
                <a href={`tel:${phone}`}>Llamar</a>
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          icon={ChevronLeft}
          aria-label="Día anterior"
          onClick={() => onDateChange(addDaysToIsoDate(date, -1))}
        />
        <DatePicker
          aria-label="Elegir fecha"
          value={isoDateToDate(date)}
          onValueChange={(next) =>
            next && onDateChange(localDateToIsoDate(next))
          }
          className="w-56"
        />
        <IconButton
          icon={ChevronRight}
          aria-label="Día siguiente"
          onClick={() => onDateChange(addDaysToIsoDate(date, 1))}
        />
        {!isToday && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDateChange(todayInBuenosAires())}
          >
            Hoy
          </Button>
        )}
        {isToday && boardQuery.dataUpdatedAt > 0 && (
          <UpdatedAgo dataUpdatedAt={boardQuery.dataUpdatedAt} />
        )}
      </div>

      <p className="text-[12.5px] text-text-3 capitalize">
        {formatDateOnly(date)}
        {!isToday && ' · solo lectura'}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          icon={Search}
          placeholder="Buscar por nombre…"
          value={textFilter}
          onChange={(event) => setTextFilter(event.target.value)}
          className="w-64"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Filtrar por estado" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger aria-label="Filtrar por cliente" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los clientes</SelectItem>
            {clientOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={siteFilter} onValueChange={setSiteFilter}>
          <SelectTrigger aria-label="Filtrar por sede" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sedes</SelectItem>
            {siteOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        caption={`Asistencia del ${formatDateOnly(date)}`}
        columns={columns}
        data={filteredRows}
        getRowId={(row) => row.id}
        isLoading={boardQuery.isLoading}
        rowVariant={(row) =>
          row.displayStatus === 'no_record' || row.status === 'absence_notified'
            ? 'crit'
            : row.status === 'delay_notified' ||
                (row.minutesEarlyLeave != null && row.minutesEarlyLeave > 0)
              ? 'warn'
              : undefined
        }
        emptyState={{
          icon: Users,
          title: 'No hay asignaciones para este día',
        }}
      />

      {recordTarget && (
        <RecordAttendanceSheet
          assignmentId={recordTarget.id}
          employeeName={`${recordTarget.employeeFirstName} ${recordTarget.employeeLastName}`}
          shiftDate={recordTarget.shiftDate}
          actions={recordTargetActions}
          open={recordTarget != null}
          onOpenChange={(open) => {
            if (!open) {
              setRecordTarget(null)
            }
          }}
        />
      )}
    </div>
  )
}

export { AttendanceTodayList }
