import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { DatePicker } from '@/components/DatePicker'
import { isApiError } from '@/api/errors'
import type { FixedApplyResult } from '@/api/services'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useApplyServiceFixedEmployeesMutation } from '@/features/services/queries'
import {
  describeSkipped,
  summarizeFixedApply,
} from '@/features/services/fixedApply'
import { localDateToIsoDate } from '@/features/settings/dateOnly'

/** Cuántas líneas de «salteados» se muestran como máximo. */
const MAX_SKIPPED_SHOWN = 12

/**
 * OD-11: después de guardar un servicio con cambios en sus empleados fijos,
 * pregunta «¿Aplicar a los turnos desde el [fecha]?» (fecha elegible, por
 * defecto hoy). Si se acepta, llama a `apply_service_fixed_employees` y muestra
 * el resultado: turnos actualizados y salteados con su motivo (turno y
 * empleado). `onFinish` se llama al cerrar, con o sin aplicar.
 */
function ApplyFixedEmployeesDialog({
  serviceId,
  onFinish,
}: {
  serviceId: string
  onFinish: () => void
}) {
  const [date, setDate] = useState<Date>(
    () => new Date(`${todayInBuenosAires()}T00:00:00`),
  )
  const [result, setResult] = useState<FixedApplyResult | null>(null)
  const apply = useApplyServiceFixedEmployeesMutation()

  async function handleApply() {
    try {
      setResult(
        await apply.mutateAsync({
          serviceId,
          fromDate: localDateToIsoDate(date),
        }),
      )
    } catch {
      // El mensaje del servidor se muestra debajo.
    }
  }

  const skipped = result?.skipped.slice(0, MAX_SKIPPED_SHOWN) ?? []
  const skippedHidden = (result?.skipped.length ?? 0) - skipped.length

  return (
    <Dialog open onOpenChange={(open) => !open && onFinish()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {result ? 'Resultado' : '¿Aplicar a los turnos?'}
          </DialogTitle>
          <DialogDescription>
            {result
              ? summarizeFixedApply(result)
              : 'Cambiaron los empleados fijos. En los turnos ya creados se quitan los fijos anteriores y se asignan los nuevos. No se tocan los turnos que ya empezaron, que tienen fichajes o avisos o que están cancelados, ni los empleados agregados a mano.'}
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <Field>
            <FieldLabel>Aplicar a los turnos desde el</FieldLabel>
            <DatePicker
              aria-label="Aplicar a los turnos desde el"
              value={date}
              onValueChange={(next) => next && setDate(next)}
              disabled={apply.isPending}
            />
          </Field>
        )}

        {apply.error && !result && (
          <p role="alert" className="text-[12.5px] text-danger">
            {isApiError(apply.error)
              ? apply.error.message
              : 'No pudimos aplicar los cambios a los turnos.'}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-2 text-[12.5px] text-text-2">
            <p>
              {`Asignaciones quitadas: ${result.assignmentsRemoved}. Asignaciones nuevas: ${result.assignmentsAdded}.`}
            </p>
            {skipped.length > 0 && (
              <>
                <p className="font-semibold text-text">Se saltearon:</p>
                <ul className="list-disc pl-4">
                  {skipped.map((item) => (
                    <li key={`${item.shiftId}-${item.employeeId ?? 'turno'}`}>
                      {describeSkipped(item)}
                    </li>
                  ))}
                </ul>
                {skippedHidden > 0 && <p>{`y ${skippedHidden} más.`}</p>}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={onFinish}>
              Listo
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onFinish}
                disabled={apply.isPending}
              >
                No aplicar
              </Button>
              <Button
                type="button"
                loading={apply.isPending}
                onClick={() => void handleApply()}
              >
                Aplicar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ApplyFixedEmployeesDialog }
