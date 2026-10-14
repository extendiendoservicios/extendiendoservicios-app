import { toast } from 'sonner'
import { isApiError } from '@/api/errors'
import { useUpdateShiftDetailsMutation } from '@/features/planning/queries'
import { RequiresPhotosToggle } from '@/features/shifts/components/RequiresPhotosToggle'

/**
 * Casilla «Pide fotos» de la cabecera del detalle (ADM-06, AJ4-03): guarda al
 * tildar o destildar con `update_shift_details`. La RPC siempre reemplaza la
 * observación con `p_notes` (null la borra), así que se reenvían la dotación,
 * la observación y «mostrar en la impresión» actuales del turno.
 */
interface ShiftRequiresPhotosControlProps {
  shiftId: string
  requiredStaff: number
  notes: string | null
  showInPrint: boolean | null
  requiresPhotos: boolean
}

function ShiftRequiresPhotosControl({
  shiftId,
  requiredStaff,
  notes,
  showInPrint,
  requiresPhotos,
}: ShiftRequiresPhotosControlProps) {
  const updateShiftDetails = useUpdateShiftDetailsMutation()

  async function handleChange(next: boolean) {
    try {
      await updateShiftDetails.mutateAsync({
        shiftId,
        requiredStaff,
        notes,
        showInPrint: showInPrint ?? undefined,
        requiresPhotos: next,
      })
      toast.success(
        next ? 'Ahora el turno pide fotos.' : 'El turno ya no pide fotos.',
      )
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos actualizar el turno.',
      )
    }
  }

  return (
    <RequiresPhotosToggle
      id={`shift-requires-photos-${shiftId}`}
      checked={requiresPhotos}
      disabled={updateShiftDetails.isPending}
      onCheckedChange={(next) => void handleChange(next)}
    />
  )
}

export { ShiftRequiresPhotosControl }
