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
import type { SiteDetail, SiteStatus } from '@/api/sites'
import { SITE_STATUS_OPTIONS } from '@/features/sites/schemas'
import { useSetSiteStatusMutation } from '@/features/sites/queries'
import { useAuth } from '@/features/auth/AuthProvider'

/**
 * SITE-006 (`05` línea 76, acción "cambiar estado" de ADM-22): mismo patrón
 * que `ChangeClientStatusDialog` (CLIENT-006, P08.3) -- confirmación con la
 * explicación del efecto de cada estado (`06_API.md` sección 5: "Inactiva:
 * sin turnos nuevos → SITE_NOT_ACTIVE"), sin motivo obligatorio (no está en
 * la lista de `07_Design_System.md` sección 2.4 que sí lo exige).
 */
const STATUS_EFFECT_DESCRIPTION: Record<SiteStatus, string> = {
  active:
    'La sede vuelve a admitir turnos nuevos. Los turnos ya generados no cambian.',
  inactive:
    'Los turnos ya generados no se tocan, pero no se van a poder generar ni crear turnos nuevos en esta sede mientras esté inactiva.',
}

function ChangeSiteStatusDialog({
  site,
  open,
  onOpenChange,
}: {
  site: SiteDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const auth = useAuth()
  const setSiteStatus = useSetSiteStatusMutation(site.clientId)
  // El estado actual no se ofrece: elegirlo no cambiaría nada.
  const statusOptions = SITE_STATUS_OPTIONS.filter(
    (option) => option.value !== site.status,
  )
  const firstOtherStatus = statusOptions[0]?.value ?? site.status
  const [nextStatus, setNextStatus] = useState<SiteStatus>(firstOtherStatus)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNextStatus(firstOtherStatus)
    }
    onOpenChange(nextOpen)
  }

  async function handleConfirm() {
    try {
      await setSiteStatus.mutateAsync({
        id: site.id,
        status: nextStatus,
        updatedBy: auth.userId as string,
      })
      toast.success('Cambiamos el estado de la sede.')
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
      title="Cambiar estado de la sede"
      description={STATUS_EFFECT_DESCRIPTION[nextStatus]}
      confirmLabel="Cambiar estado"
      isLoading={setSiteStatus.isPending}
      onConfirm={() => void handleConfirm()}
    >
      <Field>
        <FieldLabel htmlFor="site-next-status">Estado nuevo</FieldLabel>
        <Select
          value={nextStatus}
          onValueChange={(value) => setNextStatus(value as SiteStatus)}
        >
          <SelectTrigger id="site-next-status" className="w-full">
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

export { ChangeSiteStatusDialog }
