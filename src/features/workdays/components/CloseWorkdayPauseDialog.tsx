import { toast } from 'sonner'
import { workdayAdminErrorMessage } from '@/api/workdaysAdmin'
import { useCloseWorkdayPauseMutation } from '../queries'
import { WorkdayActionDialog } from './WorkdayActionDialog'

interface CloseWorkdayPauseDialogProps {
  /** Id del evento `pause` abierto. */
  pauseEventId: string
  /** Inicio de la pausa: la reanudación tiene que ser posterior. */
  pauseStartedAt: string
  /** Día de la jornada (`YYYY-MM-DD`). */
  workDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Cerrar pausa» (OD-07, `admin_close_workday_pause`): reanuda la jornada de
 * un coordinador con la pausa abierta, a la hora que se indique (por defecto
 * ahora). Motivo obligatorio; queda la traza de CJ-32.
 */
function CloseWorkdayPauseDialog({
  pauseEventId,
  pauseStartedAt,
  workDate,
  open,
  onOpenChange,
}: CloseWorkdayPauseDialogProps) {
  const close = useCloseWorkdayPauseMutation()

  async function handleSubmit(input: {
    at: string | undefined
    reason: string
  }) {
    try {
      await close.mutateAsync({ eventId: pauseEventId, ...input })
      toast.success('Cerramos la pausa.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        workdayAdminErrorMessage(error, 'No pudimos cerrar la pausa.'),
      )
    }
  }

  return (
    <WorkdayActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cerrar la pausa"
      description={
        <span>
          La jornada se reanuda a la hora que elijas (por defecto, ahora; tiene
          que ser posterior al inicio de la pausa y no futura). Queda registrado
          el motivo y quién la cerró.
        </span>
      }
      timeLabel="Hora de reanudación"
      confirmLabel="Cerrar pausa"
      reasonPlaceholder="Por ejemplo: volvió a las 13:30 y no pudo reanudar desde la app"
      workDate={workDate}
      since={pauseStartedAt}
      isPending={close.isPending}
      onSubmit={(input) => void handleSubmit(input)}
    />
  )
}

export { CloseWorkdayPauseDialog }
