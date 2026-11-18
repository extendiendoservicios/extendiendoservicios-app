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
import { useShiftDetailQuery } from '@/features/planning/queries'
import {
  assignedText,
  existingShiftFromDetail,
  whenText,
  whereText,
  type ExistingShiftInfo,
} from '@/features/shifts/existingShift'

/**
 * OH-10: «Ya hay un turno». Aviso del alta cuando la sede ya tiene un turno
 * que se superpone (OF-02, `mode="overlap"`: se puede «Crear igual») o cuando
 * el servidor rechaza por `SHIFT_DATE_TAKEN` (`mode="taken"`: el servicio ya
 * tiene turno ese día, no se puede crear otro). En los dos casos se muestra el
 * turno que ya existe y se ofrece «Editar ese turno», para corregirlo en vez
 * de dejarlo duplicado.
 *
 * `info` ya viene completo con `SHIFT_DATE_TAKEN`; con la superposición solo
 * se conoce el id y el resto se lee del detalle del turno.
 */
function ExistingShiftDialog({
  shiftId,
  mode,
  message,
  info,
  onEdit,
  onCreateAnyway,
  onCancel,
}: {
  shiftId: string
  mode: 'overlap' | 'taken'
  message: string
  info?: ExistingShiftInfo | null
  onEdit: () => void
  /** Solo en `mode="overlap"`. */
  onCreateAnyway?: () => void
  onCancel: () => void
}) {
  const detailQuery = useShiftDetailQuery(info ? undefined : shiftId)
  const shown =
    info ??
    (detailQuery.data ? existingShiftFromDetail(detailQuery.data) : null)

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ya hay un turno</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        {shown ? (
          <div
            className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-[12.5px]"
            data-testid="existing-shift"
          >
            <p className="font-medium capitalize text-text">
              {whenText(shown)}
            </p>
            {whereText(shown) && (
              <p className="text-text-2">{whereText(shown)}</p>
            )}
            <p className="text-text-2">
              {shown.serviceName ?? 'Turno cargado a mano'}
            </p>
            <p className="text-text-2">{assignedText(shown.assigned)}</p>
          </div>
        ) : detailQuery.isLoading ? (
          <Skeleton className="h-20" />
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          {mode === 'overlap' && onCreateAnyway && (
            <Button type="button" variant="dark" onClick={onCreateAnyway}>
              Crear igual
            </Button>
          )}
          <Button type="button" onClick={onEdit}>
            Editar ese turno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ExistingShiftDialog }
