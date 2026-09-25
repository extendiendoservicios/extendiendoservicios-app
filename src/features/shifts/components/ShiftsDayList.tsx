import { useState } from 'react'
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
import { UpdatedAgo } from './UpdatedAgo'
import { CancelShiftDialog } from './CancelShiftDialog'

/** `"YYYY-MM-DD"` → `Date` para `DatePicker` (mismo criterio que `isoDateToDate` de `ServiceFormPage`). */
function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/**
 * ADM-05 "Planificación · día", versión mínima (SHIFT-010, `05` línea 39):
 * lista de turnos de una fecha, ordenados por hora, con dotación y estado.
 * Fecha navegable (anterior/siguiente/selector); polling 30 s solo cuando
 * la fecha es hoy (`02_Decisiones.md` P-005).
 *
 * Recorte a propósito (encargo P10.3): sin "abrir turno" a un detalle
 * completo -- ADM-06 es de F11, todavía es un placeholder
 * (`src/app/routes/adminRoutes.tsx`). Tampoco hay agrupación por franja ni
 * filtros de cliente/sede/estado (`05` los menciona para la versión
 * completa; acá alcanza con probar que la generación funciona, como pide el
 * encargo).
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

  const columns: DataTableColumnDef<ShiftListRow>[] = [
    {
      id: 'time',
      header: 'Horario',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <span className="font-semibold text-text">
          {row.original.startTime.slice(0, 5)}–
          {row.original.endTime.slice(0, 5)}
        </span>
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
        if (!canManage) {
          return null
        }
        return (
          <div className="flex items-center gap-2">
            {isEditable && (
              <Button asChild variant="ghost" size="sm">
                <Link to={`/admin/turnos/${shift.id}/editar`}>Editar</Link>
              </Button>
            )}
            {isCancellable && canCancel && (
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

      <DataTable
        caption={`Turnos del ${formatDateOnly(date)}`}
        columns={columns}
        data={shiftsQuery.data ?? []}
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
