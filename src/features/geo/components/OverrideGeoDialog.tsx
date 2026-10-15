import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { GeoRecordType } from '@/api/geo'
import { geoErrorMessage } from '../errors'
import { useOverrideGeoValidationMutation } from '../queries'

interface OverrideGeoDialogProps {
  recordType: GeoRecordType
  recordId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Marcar como válido» (B-09, `override_geo_validation`): diálogo con motivo
 * obligatorio. El resultado original se conserva; se ve como «Validado
 * (corregido)» y queda registrado quién y cuándo.
 */
function OverrideGeoDialog({
  recordType,
  recordId,
  open,
  onOpenChange,
}: OverrideGeoDialogProps) {
  const override = useOverrideGeoValidationMutation()

  async function handleConfirm(reason: string) {
    try {
      await override.mutateAsync({ recordType, recordId, reason })
      toast.success('Marcamos el fichaje como válido.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        geoErrorMessage(error, 'No pudimos marcar el fichaje como válido.'),
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Marcar como válido"
      description="El resultado original queda guardado. Se va a ver como «Validado (corregido)», con tu nombre y el motivo."
      reasonLabel="Motivo"
      reasonPlaceholder="Por ejemplo: el GPS no anda en el subsuelo del edificio"
      confirmLabel="Marcar como válido"
      cancelLabel="Volver"
      isLoading={override.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export { OverrideGeoDialog }
