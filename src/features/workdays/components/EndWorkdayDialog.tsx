import { toast } from 'sonner'
import { workdayAdminErrorMessage } from '@/api/workdaysAdmin'
import { useEndWorkdayMutation } from '../queries'
import { WorkdayActionDialog } from './WorkdayActionDialog'

interface EndWorkdayDialogProps {
  workdayId: string
  supervisorName: string
  /** Día de la jornada (`YYYY-MM-DD`). */
  workDate: string
  startedAt: string
  /** Hay una pausa abierta: se cierra a la hora de fin. */
  hasOpenPause: boolean
  /** Hay una supervisión abierta: queda «Sin cerrar». */
  hasOpenSupervision: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Finalizar jornada» desde la administración (OD-06, `admin_end_workday`):
 * para el coordinador que se olvidó o al que se le trabó la app. La hora de
 * fin se elige (por defecto ahora, nunca futura) y el motivo es obligatorio.
 * Cierra la pausa abierta a esa hora y deja la supervisión abierta como «Sin
 * cerrar», igual que el cierre automático (CJ-31).
 */
function EndWorkdayDialog({
  workdayId,
  supervisorName,
  workDate,
  startedAt,
  hasOpenPause,
  hasOpenSupervision,
  open,
  onOpenChange,
}: EndWorkdayDialogProps) {
  const end = useEndWorkdayMutation()

  async function handleSubmit(input: {
    at: string | undefined
    reason: string
  }) {
    try {
      await end.mutateAsync({ workdayId, ...input })
      toast.success(`Finalizamos la jornada de ${supervisorName}.`)
      onOpenChange(false)
    } catch (error) {
      toast.error(
        workdayAdminErrorMessage(error, 'No pudimos finalizar la jornada.'),
      )
    }
  }

  return (
    <WorkdayActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Finalizar la jornada de ${supervisorName}`}
      description={
        <>
          <span>
            Elegí a qué hora terminó (por defecto, ahora; no puede ser futura).
            La jornada queda como corregida por la administración, con el motivo
            y quién la finalizó.
          </span>
          <span>
            Si el coordinador está en pausa, la pausa se cierra a esa hora. Si
            tiene una supervisión abierta, se cierra a esa hora y queda con la
            marca «Sin cerrar».
          </span>
          {hasOpenPause && (
            <strong className="text-text">
              Ahora hay una pausa abierta: se va a cerrar.
            </strong>
          )}
          {hasOpenSupervision && (
            <strong className="text-text">
              Ahora hay una supervisión abierta: va a quedar «Sin cerrar».
            </strong>
          )}
        </>
      }
      timeLabel="Hora de fin"
      confirmLabel="Finalizar jornada"
      reasonPlaceholder="Por ejemplo: terminó a las 18:00 y se le trabó la app"
      destructive
      workDate={workDate}
      since={startedAt}
      isPending={end.isPending}
      onSubmit={(input) => void handleSubmit(input)}
    />
  )
}

export { EndWorkdayDialog }
