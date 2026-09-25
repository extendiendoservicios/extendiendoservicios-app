import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { DatePicker } from '@/components/DatePicker'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { StatusBadge } from '@/components/status'
import type { ShiftStatus as BadgeShiftStatus } from '@/components/status'
import type { ShiftListRow } from '@/api/shifts'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  addDaysToIsoDate,
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  canCancelShift,
  canManageShiftTime,
} from '@/features/shifts/permissions'
import { useShiftsByDateQuery } from '@/features/shifts/queries'
import { groupShiftsByFranja } from '@/features/shifts/grouping'
import { UpdatedAgo } from './UpdatedAgo'
import { CancelShiftDialog } from './CancelShiftDialog'

/** `"YYYY-MM-DD"` → `Date` para `DatePicker` (mismo criterio que `isoDateToDate` de `ServiceFormPage`). */
function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/**
 * ADM-05 "Planificación · día" completa (ASSIGN-010, `05` línea 39): lista
 * de turnos de una fecha, ordenados por hora, agrupados por franja, con
 * dotación y estado. Fecha navegable (anterior/siguiente/selector); polling
 * 30 s solo cuando la fecha es hoy (`02_Decisiones.md` P-005).
 *
 * "Abrir turno" navega a `/admin/turnos/:id` (ADM-06): la ruta ya existe en
 * `src/app/routes/adminRoutes.tsx`, aunque hoy siga siendo el placeholder
 * hasta que ADM-06 se construya en P11.3 -- el encargo pide dejar el enlace
 * a la ruta prevista sin inventar la pantalla.
 *
 * Sin filtros de cliente/sede/estado (`05` línea 39 no los pide para
 * ADM-05, a diferencia de ADM-03 y ADM-04): solo fecha navegable.
 */
interface ShiftsDayListProps {
  date: string
  onDateChange: (date: string) => void
}

function ShiftsDayList({ date, onDateChange }: ShiftsDayListProps) {
  const auth = useAuth()
  const actor = { roles: auth.roles, capabilities: auth.capabilities }
  const canManage = canManageShiftTime(actor)
  // "Cancelar" exige además `cancel_shifts` (06 sección 7), igual que el servidor.
  const canCancel = canCancelShift(actor)
  const [cancelTarget, setCancelTarget] = useState<ShiftListRow | null>(null)

  const isToday = date === todayInBuenosAires()
  const shiftsQuery = useShiftsByDateQuery(date, isToday)
  const franjaGroups = useMemo(
    () => groupShiftsByFranja(shiftsQuery.data ?? []),
    [shiftsQuery.data],
  )

  const columns: DataTableColumnDef<ShiftListRow>[] = [
    {
      id: 'time',
      header: 'Horario',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={`/admin/turnos/${row.original.id}`}
          className="font-semibold text-text hover:text-primary-800"
        >
          {row.original.startTime.slice(0, 5)}–
          {row.original.endTime.slice(0, 5)}
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
      id: 'staffing',
      header: 'Dotación',
      meta: { card: 'meta', cardLabel: 'Dotación', align: 'end' },
      cell: ({ row }) =>
        `${row.original.assignedCount}/${row.original.requiredStaff}`,
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'meta', cardLabel: 'Estado' },
      cell: ({ row }) => (
        <StatusBadge
          domain="shift"
          status={row.original.displayStatus as BadgeShiftStatus}
        />
      ),
    },
    {
      id: 'actions',
      header: 'Acciones',
      meta: { card: 'trailing' },
      cell: ({ row }) => {
        const shift = row.original
        const isEditable =
          shift.status === 'scheduled' || shift.status === 'assigned'
        const isCancellable = isEditable || shift.status === 'in_progress'
        return (
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to={`/admin/turnos/${shift.id}`}>Ver</Link>
            </Button>
            {canManage && isEditable && (
              <Button asChild variant="ghost" size="sm">
                <Link to={`/admin/turnos/${shift.id}/editar`}>Editar</Link>
              </Button>
            )}
            {canManage && isCancellable && canCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCancelTarget(shift)}
              >
                Cancelar
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          {isToday && shiftsQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={shiftsQuery.dataUpdatedAt} />
          )}
        </div>
        {canManage && (
          <Button asChild icon={Plus}>
            <Link to={`/admin/turnos/nuevo?fecha=${date}`}>Nuevo turno</Link>
          </Button>
        )}
      </div>

      <p className="text-[12.5px] text-text-3 capitalize">
        {formatDateOnly(date)}
      </p>

      {shiftsQuery.isLoading || franjaGroups.length === 0 ? (
        <DataTable
          caption={`Turnos del ${formatDateOnly(date)}`}
          columns={columns}
          data={[]}
          getRowId={(row) => row.id}
          isLoading={shiftsQuery.isLoading}
          emptyState={{
            icon: CalendarClock,
            title: 'No hay turnos para este día',
            description: canManage
              ? 'Generá el mes desde "Generar turnos del mes" o creá uno puntual con "Nuevo turno".'
              : undefined,
          }}
        />
      ) : (
        franjaGroups.map((group) => (
          <div key={group.franja} className="flex flex-col gap-2">
            <h3 className="text-[12.5px] font-semibold text-text-3">
              Franja {group.franja}
            </h3>
            <DataTable
              caption={`Turnos de la franja ${group.franja} del ${formatDateOnly(date)}`}
              columns={columns}
              data={group.shifts}
              getRowId={(row) => row.id}
            />
          </div>
        ))
      )}

      {cancelTarget && (
        <CancelShiftDialog
          shiftId={cancelTarget.id}
          shiftDate={cancelTarget.shiftDate}
          open={cancelTarget != null}
          onOpenChange={(open) => {
            if (!open) {
              setCancelTarget(null)
            }
          }}
        />
      )}
    </div>
  )
}

export { ShiftsDayList }
