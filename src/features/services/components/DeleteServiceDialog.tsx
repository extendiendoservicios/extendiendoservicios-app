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
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/api/errors'
import type { ServiceDeleteBlockReason } from '@/api/services'
import {
  useDeleteServiceMutation,
  useServiceDeletePreviewQuery,
} from '@/features/services/queries'
import { formatDateOnly } from '@/features/settings/dateOnly'

/** Cuántas fechas de turnos bloqueantes se listan como máximo. */
const MAX_BLOCKING_DATES = 5

const REASON_TEXT: Record<ServiceDeleteBlockReason, string> = {
  ATTENDANCE_RECORDS: 'fichajes registrados',
  ATTENDANCE_NOTICES: 'avisos de asistencia (demora, ausencia o en camino)',
  SUPERVISIONS: 'supervisiones',
}

/** «fichajes y supervisiones», «fichajes, avisos y supervisiones». Orden fijo. */
export function describeBlockingReasons(
  reasons: readonly ServiceDeleteBlockReason[],
): string {
  const texts = (Object.keys(REASON_TEXT) as ServiceDeleteBlockReason[])
    .filter((reason) => reasons.includes(reason))
    .map((reason) => REASON_TEXT[reason])
  if (texts.length <= 1) {
    return texts[0] ?? ''
  }
  return `${texts.slice(0, -1).join(', ')} y ${texts.at(-1)}`
}

/**
 * AJ3-01: eliminar un servicio. Primero consulta `service_delete_preview`:
 * si se puede, pide confirmar con la cantidad de turnos y asignaciones que
 * se van con él; si no, explica qué lo bloquea y ofrece «Dar de baja»
 * (`onDeactivate` abre el diálogo de cambiar estado). Sin motivo
 * obligatorio: no está en la lista de `07` sección 2.4.
 */
function DeleteServiceDialog({
  service,
  open,
  onOpenChange,
  onDeleted,
  onDeactivate,
}: {
  service: { id: string; name: string }
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se llama después de borrar (por ejemplo, para volver al listado). */
  onDeleted?: () => void
  /** «Dar de baja»: abre el cambio de estado del servicio. */
  onDeactivate: () => void
}) {
  const previewQuery = useServiceDeletePreviewQuery(
    open ? service.id : undefined,
  )
  const deleteService = useDeleteServiceMutation()
  const preview = previewQuery.data

  async function handleConfirm() {
    try {
      await deleteService.mutateAsync(service.id)
      toast.success(`Eliminamos el servicio «${service.name}».`)
      onOpenChange(false)
      onDeleted?.()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos eliminar el servicio.',
      )
    }
  }

  const blocking = preview?.blockingShifts ?? []
  const blockingReasons = [...new Set(blocking.flatMap((s) => s.reasons))]
  const shownDates = blocking.slice(0, MAX_BLOCKING_DATES)
  const hiddenDates = blocking.length - shownDates.length

  let description = ''
  if (previewQuery.isLoading) {
    description = 'Revisando qué se va a eliminar…'
  } else if (preview?.canDelete) {
    const shifts = `${preview.shiftsToDelete} ${preview.shiftsToDelete === 1 ? 'turno' : 'turnos'}`
    const assignments = `${preview.assignmentsToDelete} ${preview.assignmentsToDelete === 1 ? 'asignación' : 'asignaciones'}`
    description = `Se van a eliminar el servicio, ${shifts} y ${assignments}. No se puede deshacer.`
  } else if (preview) {
    description = 'Este servicio no se puede eliminar.'
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Eliminar «${service.name}»`}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {previewQuery.isLoading && <Skeleton className="h-12" />}

        {previewQuery.isError && (
          <p role="alert" className="text-[12.5px] text-danger">
            {isApiError(previewQuery.error)
              ? previewQuery.error.message
              : 'No pudimos revisar el servicio.'}
          </p>
        )}

        {preview && !preview.canDelete && (
          <div className="flex flex-col gap-2 text-[12.5px] text-text-2">
            <p>
              {`Hay ${blocking.length} ${
                blocking.length === 1 ? 'turno' : 'turnos'
              } con ${describeBlockingReasons(blockingReasons)}, y eso no se borra.`}
            </p>
            <p>
              Fechas:{' '}
              {shownDates.map((s) => formatDateOnly(s.shiftDate)).join(', ')}
              {hiddenDates > 0 ? ` y ${hiddenDates} más` : ''}.
            </p>
            <p>
              Si el servicio ya no se presta, dalo de baja: deja de generar
              turnos y el historial se conserva.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={deleteService.isPending}
          >
            Cancelar
          </Button>
          {preview && !preview.canDelete && (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false)
                onDeactivate()
              }}
            >
              Dar de baja
            </Button>
          )}
          {preview?.canDelete && (
            <Button
              type="button"
              variant="destructive"
              loading={deleteService.isPending}
              onClick={() => void handleConfirm()}
            >
              Eliminar servicio
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { DeleteServiceDialog }
