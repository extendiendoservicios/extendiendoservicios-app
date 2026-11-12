import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { HolidayShiftConflicts } from '@/api/settings'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { useRemoveHolidayShiftsMutation } from '@/features/settings/queries'
import { canCancelShift } from '@/features/shifts/permissions'

/** Texto de lo que se hizo, con lo borrado y lo salteado (OF-19b). */
export function describeRemovedHolidayShifts(result: {
  deletedShifts: number
  skippedCount: number
}): string {
  const deleted =
    result.deletedShifts === 1
      ? 'Eliminamos 1 turno.'
      : `Eliminamos ${result.deletedShifts} turnos.`
  if (result.skippedCount === 0) {
    return deleted
  }
  const skipped =
    result.skippedCount === 1
      ? 'Salteamos 1 turno que tiene historia.'
      : `Salteamos ${result.skippedCount} turnos que tienen historia.`
  return `${deleted} ${skipped}`
}

/**
 * OF-19b: después de crear un feriado, ofrece eliminar los turnos de ese día
 * de servicios que no trabajan feriados. Llama a `remove_holiday_shifts`, que
 * exige la capacidad `cancel_shifts`: sin ella se muestra la lista pero no el
 * botón.
 */
function HolidayShiftConflictsDialog({
  conflicts,
  onOpenChange,
}: {
  conflicts: HolidayShiftConflicts | null
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const removeShifts = useRemoveHolidayShiftsMutation()
  const canRemove = canCancelShift({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })

  async function handleRemove() {
    if (!conflicts) return
    try {
      const result = await removeShifts.mutateAsync(conflicts.date)
      toast.success(describeRemovedHolidayShifts(result))
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos eliminar los turnos del feriado.',
      )
    }
  }

  const count = conflicts?.deletableCount ?? 0
  return (
    <Dialog open={conflicts != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turnos en el feriado</DialogTitle>
          <DialogDescription>
            {`Hay ${count} ${count === 1 ? 'turno' : 'turnos'} ese día de servicios que no trabajan feriados. ¿Eliminarlos?`}
          </DialogDescription>
        </DialogHeader>
        {conflicts && (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
            {conflicts.shifts.map((shift) => (
              <li
                key={shift.shiftId}
                className="rounded-md border border-border p-2"
              >
                <p className="font-medium text-text">{shift.serviceName}</p>
                <p className="text-text-2">
                  {shift.clientName} · {shift.siteName} ·{' '}
                  {shift.startTime.slice(0, 5)} a {shift.endTime.slice(0, 5)}
                </p>
                <p className="text-[12px] text-text-3">
                  {formatDateOnly(shift.shiftDate)} ·{' '}
                  {shift.assignmentsCount === 1
                    ? '1 persona asignada'
                    : `${shift.assignmentsCount} personas asignadas`}
                  {shift.hasHistory && ' · Tiene historia: no se elimina'}
                </p>
              </li>
            ))}
          </ul>
        )}
        {!canRemove && (
          <p className="text-sm text-text-2">
            Para eliminarlos hace falta la capacidad Cancelar turnos.
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={removeShifts.isPending}
          >
            {canRemove ? 'Dejarlos' : 'Cerrar'}
          </Button>
          {canRemove && (
            <Button
              type="button"
              loading={removeShifts.isPending}
              onClick={() => void handleRemove()}
            >
              Eliminar los turnos
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { HolidayShiftConflictsDialog }
