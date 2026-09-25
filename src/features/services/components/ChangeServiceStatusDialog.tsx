import { useState } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, FieldLabel } from '@/components/ui/field'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { isApiError } from '@/api/errors'
import type { ServiceStatus } from '@/api/services'
import { useAuth } from '@/features/auth/AuthProvider'
import { SERVICE_STATUS_OPTIONS } from '@/features/services/schemas'
import { useSetServiceStatusMutation } from '@/features/services/queries'

/**
 * SERVICE-004 (acción "pausar"/"finalizar" de la lista de servicios de
 * ADM-21 y ADM-22): mismo patrón que `ChangeClientStatusDialog`/
 * `ChangeSiteStatusDialog` -- confirmación con la explicación del efecto de
 * cada estado (`06_API.md` sección 6: "Solo `active` genera turnos"), sin
 * motivo obligatorio (no está en la lista de `07_Design_System.md` sección
 * 2.4 que sí lo exige).
 */
const STATUS_EFFECT_DESCRIPTION: Record<ServiceStatus, string> = {
  active:
    'El servicio vuelve a generar turnos nuevos al ejecutar "Generar turnos del mes". Los turnos ya generados no cambian.',
  paused:
    'Deja de generar turnos nuevos hasta que se reactive. Los turnos ya generados no se tocan.',
  ended:
    'El servicio se da por finalizado. Los turnos ya generados no se tocan, pero no se van a generar turnos nuevos.',
}

function ChangeServiceStatusDialog({
  service,
  open,
  onOpenChange,
}: {
  service: { id: string; name: string; status: ServiceStatus }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const setServiceStatus = useSetServiceStatusMutation()
  // El estado actual no se ofrece: elegirlo no cambiaría nada.
  const statusOptions = SERVICE_STATUS_OPTIONS.filter(
    (option) => option.value !== service.status,
  )
  const firstOtherStatus = statusOptions[0]?.value ?? service.status
  const [nextStatus, setNextStatus] = useState<ServiceStatus>(firstOtherStatus)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNextStatus(firstOtherStatus)
    }
    onOpenChange(nextOpen)
  }

  async function handleConfirm() {
    try {
      await setServiceStatus.mutateAsync({
        id: service.id,
        status: nextStatus,
        updatedBy: auth.userId as string,
      })
      toast.success('Cambiamos el estado del servicio.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar el estado.',
      )
    }
  }

  return (
    <SimpleConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={`Cambiar estado de "${service.name}"`}
      description={STATUS_EFFECT_DESCRIPTION[nextStatus]}
      confirmLabel="Cambiar estado"
      isLoading={setServiceStatus.isPending}
      onConfirm={() => void handleConfirm()}
    >
      <Field>
        <FieldLabel htmlFor="service-next-status">Estado nuevo</FieldLabel>
        <Select
          value={nextStatus}
          onValueChange={(value) => setNextStatus(value as ServiceStatus)}
        >
          <SelectTrigger id="service-next-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </SimpleConfirmDialog>
  )
}

export { ChangeServiceStatusDialog }
