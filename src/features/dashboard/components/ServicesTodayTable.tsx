import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { cn } from 'cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { PersonCell } from '@/components/PersonCell'
import { StatusBadge } from '@/components/status'
import { avatarUrl } from '@/lib/avatarUrl'
import { formatMinutes, formatTime } from '@/lib/format'
import type { AttendanceBoardRow } from '@/api/attendance'
import { getAttendanceStatusBadgeInput } from '@/features/attendance/derive'
import {
  ALL_DAY_FILTER,
  filterByFranja,
  franjaOf,
  listFranjas,
} from '../servicesToday'
import { RowActions } from './RowActions'

interface ServicesTodayTableProps {
  rows: AttendanceBoardRow[]
  isLoading: boolean
  phones: Map<string, string | null> | undefined
  canRecord: (row: AttendanceBoardRow) => boolean
  canAssign: (shiftId: string) => boolean
  onRecord: (row: AttendanceBoardRow) => void
  onAssign: (row: AttendanceBoardRow) => void
}

/**
 * Tabla "Servicios de hoy" (DASH-003, `05` línea 36) sobre
 * `v_assignments_board`: empleado, cliente y sede, horario, inicio real,
 * estado y salida anticipada, con filtro por franja. Por debajo de 1024 px
 * `DataTable` la dibuja como tarjetas (DASH-006).
 */
function ServicesTodayTable({
  rows,
  isLoading,
  phones,
  canRecord,
  canAssign,
  onRecord,
  onAssign,
}: ServicesTodayTableProps) {
  const [franja, setFranja] = useState(ALL_DAY_FILTER)
  const franjas = useMemo(() => listFranjas(rows), [rows])
  // Si la franja elegida dejó de existir (el día cambió), vuelve a "todo el día".
  const effectiveFranja = franjas.includes(franja) ? franja : ALL_DAY_FILTER
  const filtered = useMemo(
    () => filterByFranja(rows, effectiveFranja),
    [rows, effectiveFranja],
  )

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
      header: 'Horario',
      meta: { card: 'meta', cardLabel: 'Horario' },
      cell: ({ row }) => franjaOf(row.original),
    },
    {
      id: 'checkIn',
      header: 'Inicio real',
      meta: { card: 'meta', cardLabel: 'Inicio real' },
      cell: ({ row }) =>
        row.original.checkInAt ? formatTime(row.original.checkInAt) : '—',
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
      meta: { card: 'actions' },
      cell: ({ row }) => {
        const assignable =
          canAssign(row.original.shiftId) &&
          (row.original.status === 'absence_notified' ||
            row.original.displayStatus === 'no_record')
        return (
          <RowActions
            shiftId={row.original.shiftId}
            phone={phones?.get(row.original.employeeId)}
            onRecord={
              canRecord(row.original) ? () => onRecord(row.original) : undefined
            }
            onAssign={assignable ? () => onAssign(row.original) : undefined}
          />
        )
      },
    },
  ]

  return (
    <section
      aria-label="Servicios de hoy"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card',
        // Reserva alto mientras carga (CLS de ADM-02, P17.4.1): el esqueleto
        // son pocas filas y la tabla real suele ser bastante más alta.
        isLoading && 'min-h-[28rem]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-text">
            Servicios de hoy
          </h2>
          <span className="rounded-full bg-surface-2 px-2 py-px text-[11.5px] font-medium text-text-2">
            {filtered.length}
          </span>
        </div>
        <Select value={effectiveFranja} onValueChange={setFranja}>
          <SelectTrigger aria-label="Filtrar por franja" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_DAY_FILTER}>Todo el día</SelectItem>
            {franjas.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        caption="Servicios de hoy"
        columns={columns}
        data={filtered}
        getRowId={(row) => row.id}
        isLoading={isLoading}
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
          title: 'No hay servicios para hoy',
        }}
      />
    </section>
  )
}

export { ServicesTodayTable }
