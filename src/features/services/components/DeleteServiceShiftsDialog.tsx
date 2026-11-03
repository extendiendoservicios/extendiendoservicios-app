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
import { OwnerDeleteDialog } from '@/features/ownerDelete/components/OwnerDeleteDialog'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { localDateToIsoDate } from '@/features/settings/dateOnly'

/**
 * OD-22: «Eliminar turnos sin historia desde [fecha]» (solo el dueño).
 * Primero se elige la fecha (por defecto hoy); después se abre el diálogo de
 * borrado con su vista previa: cuántos turnos se borran y cuáles se saltean por
 * tener historia.
 */
function DeleteServiceShiftsDialog({
  serviceId,
  serviceName,
  open,
  onOpenChange,
}: {
  serviceId: string
  serviceName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [date, setDate] = useState<Date>(
    () => new Date(`${todayInBuenosAires()}T00:00:00`),
  )
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <OwnerDeleteDialog
        kind="service_shifts"
        id={serviceId}
        fromDate={localDateToIsoDate(date)}
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setConfirming(false)
          }
          onOpenChange(next)
        }}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Eliminar turnos de «${serviceName}»`}</DialogTitle>
          <DialogDescription>
            Elegí desde qué fecha. Se eliminan los turnos que no tienen
            historia; los que tienen fichajes, supervisiones u otros registros
            se saltean.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Desde</FieldLabel>
          <DatePicker
            aria-label="Eliminar turnos desde"
            value={date}
            onValueChange={(next) => next && setDate(next)}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => setConfirming(true)}>
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { DeleteServiceShiftsDialog }
